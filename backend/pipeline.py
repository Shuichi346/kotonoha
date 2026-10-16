"""Streaming capture, transcription, and bounded translation scheduling."""

import asyncio
import contextlib
import json
import math
import struct
import time
import uuid
from collections.abc import Awaitable, Callable

from backend.runtime import CapturePermissionError, receive_event

Send = Callable[[dict], Awaitable[None]]


class LiveSession:
    def __init__(self, runtime, translator, send: Send, source: str, target: str):
        self.runtime = runtime
        self.translator = translator
        self.send = send
        self.source = source
        self.target = target
        self.stopping = asyncio.Event()
        self.queue = asyncio.Queue(maxsize=3)
        self.task = None
        self._workers = []
        self._partial = ""
        self._offset = 0.0
        self._processed = 0.0
        self._previous_end = 0.0
        self._commits_sent = 0
        self._commits_seen = 0
        self._flush_commit_target = None

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        self.stopping.set()
        if self.task:
            try:
                await asyncio.wait_for(asyncio.shield(self.task), timeout=90)
            except TimeoutError:
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)

    async def submit(self, text: str, start: float, end: float):
        if not text.strip():
            return
        item = (text.strip(), start, end, time.monotonic())
        if self.queue.full():
            # Preserve the active translation and newest waiting utterances.
            self.queue.get_nowait()
            self.queue.task_done()
            await self.send(
                {
                    "type": "status",
                    "state": "listening",
                    "message": "翻訳の遅延を抑えるため、古い未処理の発話をスキップしました。",
                }
            )
        self.queue.put_nowait(item)

    async def translate_queue(self):
        while True:
            item = await self.queue.get()
            try:
                text, start, end, received = item
                result = await asyncio.wait_for(
                    self.translator.translate(text, self.source, self.target), timeout=30
                )
                await self.send(
                    {
                        "type": "subtitle",
                        "id": uuid.uuid4().hex,
                        "source": text,
                        "text": result,
                        "start": start,
                        "end": end,
                        "latency_ms": round((time.monotonic() - received) * 1000),
                    }
                )
            finally:
                self.queue.task_done()

    async def receive(self, socket):
        while True:
            event = await receive_event(socket)
            kind = event.get("type", "")
            self._processed = max(self._processed, float(event.get("audio_processed", 0)))
            if kind.endswith(".delta"):
                self._partial += event.get("delta", "")
                await self.send({"type": "partial", "text": self._partial})
            elif kind.endswith(".completed"):
                words = event.get("words") or []
                start = self._offset + float(words[0]["start"]) if words else self._previous_end
                end = self._offset + (float(words[-1]["end"]) if words else self._processed)
                end = max(start, end)
                await self.submit(event.get("transcript", ""), start, end)
                self._previous_end = end
                self._partial = ""
                await self.send({"type": "partial", "text": ""})
            elif kind == "input_audio_buffer.committed":
                self._offset += self._processed
                self._processed = 0.0
                self._commits_seen += 1
                if (
                    self._flush_commit_target is not None
                    and self._commits_seen >= self._flush_commit_target
                ):
                    return

    async def stream_audio(self, process, socket):
        uncommitted = 0
        remainder = b""
        while True:
            pcm = await process.stdout.read(3200)
            if not pcm:
                if self.stopping.is_set():
                    return
                error = await process.stderr.read(8192)
                if b"capture_permission_required" in error:
                    raise CapturePermissionError()
                raise RuntimeError(
                    error.decode(errors="replace").strip() or "音声キャプチャが終了しました。"
                )
            pcm = remainder + pcm
            even_size = len(pcm) - len(pcm) % 2
            pcm, remainder = pcm[:even_size], pcm[even_size:]
            if not pcm:
                continue
            samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
            rms = math.sqrt(sum(x * x for x in samples) / max(1, len(samples))) / 32768
            await self.send({"type": "level", "value": min(1.0, rms * 5)})
            await socket.send(pcm)
            uncommitted += len(pcm)
            # Bound continuous-speech context and NeMo's per-buffer upload limit.
            if uncommitted >= 15 * 32000:
                self._commits_sent += 1
                await socket.send(json.dumps({"type": "input_audio_buffer.commit"}))
                uncommitted = 0

    async def run(self):
        try:
            await self.runtime.check_capture_permission()
            if self.stopping.is_set():
                return
            await self.send(
                {
                    "type": "status",
                    "state": "starting",
                    "message": "ローカルの翻訳・文字起こしモデルを読み込んでいます。",
                }
            )
            await asyncio.wait_for(self.translator.load(), timeout=60)
            if self.stopping.is_set():
                return
            await self.runtime.ensure()
            if self.stopping.is_set():
                return
            async with self.runtime.connection() as socket:
                created = await asyncio.wait_for(receive_event(socket), timeout=10)
                if created.get("type") != "session.created":
                    raise RuntimeError("NeMo セッションを開始できませんでした。")
                await socket.send(
                    json.dumps(
                        {
                            "type": "session.update",
                            "session": {
                                "sample_rate": 16000,
                                "language": self.source,
                                "automatic_punctuation": True,
                                "word_timestamps": True,
                                "endpointing_ms": 600,
                            },
                        }
                    )
                )
                updated = await asyncio.wait_for(receive_event(socket), timeout=10)
                if updated.get("type") != "session.updated":
                    raise RuntimeError("NeMo の音声設定に失敗しました。")
                process = await self.runtime.capture()
                await self.send({"type": "status", "state": "listening"})
                producer = asyncio.create_task(self.stream_audio(process, socket))
                consumer = asyncio.create_task(self.receive(socket))
                translator = asyncio.create_task(self.translate_queue())
                stop = asyncio.create_task(self.stopping.wait())
                self._workers = [producer, consumer, translator, stop]
                done, _ = await asyncio.wait(self._workers, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    if task is not stop and not (task is producer and self.stopping.is_set()):
                        task.result()
                        raise RuntimeError("字幕処理が予期せず終了しました。")
                # Stop capture first; the commit flushes the last unfinished ASR utterance.
                await self.runtime.stop_capture()
                producer.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await producer
                self._commits_sent += 1
                self._flush_commit_target = self._commits_sent
                await socket.send(json.dumps({"type": "input_audio_buffer.commit"}))
                await asyncio.wait_for(asyncio.shield(consumer), timeout=15)
                # Observe worker failures while draining pending translations.
                drain = asyncio.create_task(self.queue.join())
                self._workers.append(drain)
                done, _ = await asyncio.wait(
                    [drain, translator], timeout=60, return_when=asyncio.FIRST_COMPLETED
                )
                if translator in done:
                    translator.result()
                if drain not in done:
                    raise RuntimeError("残りの翻訳を60秒以内に完了できませんでした。")
        except asyncio.CancelledError:
            raise
        except CapturePermissionError as error:
            with contextlib.suppress(Exception):
                await self.send({"type": "error", "code": error.code, "message": str(error)})
        except Exception as error:
            with contextlib.suppress(Exception):
                await self.send(
                    {
                        "type": "error",
                        "message": str(error) or "モデルの処理が制限時間を超えました。",
                    }
                )
        finally:
            for task in self._workers:
                task.cancel()
            if self._workers:
                await asyncio.gather(*self._workers, return_exceptions=True)
            await self.runtime.stop_capture()
            with contextlib.suppress(Exception):
                await self.send({"type": "level", "value": 0})
                await self.send({"type": "status", "state": "stopped"})
