"""Own the local NeMo server and the short-lived system audio capture process."""

import asyncio
import contextlib
import json
import os
import secrets
from urllib.parse import urlencode

import httpx
from websockets.asyncio.client import connect

from backend.config import ASR_DIR, ASR_PORT, CAPTURE, asr_ready, nemo_binary


async def terminate(process: asyncio.subprocess.Process | None):
    if process is None or process.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=3)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


class NemoRuntime:
    def __init__(self):
        self.process = None
        self.capture_process = None
        self.key = secrets.token_urlsafe(32)
        self._log_task = None
        self.last_error = ""

    async def ensure(self):
        if self.process is not None and self.process.returncode is None:
            return
        binary = nemo_binary()
        if not binary or not asr_ready():
            raise RuntimeError(
                "文字起こしモデルがありません。npm run prepare:models を実行してください。"
            )
        self.process = await asyncio.create_subprocess_exec(
            binary,
            "serve",
            "--asr-model",
            "nemotron-3.5",
            "--device",
            "metal",
            "--host",
            "127.0.0.1",
            "--port",
            str(ASR_PORT),
            "--no-ui",
            "--api-key",
            self.key,
            "--asr.endpointing.enable",
            "--asr.endpointing.stop_history_eou_ms",
            "600",
            "--max-upload-mb",
            "4096",
            env={**os.environ, "NEMO_SPEECH_MODEL_DIR": str(ASR_DIR)},
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._log_task = asyncio.create_task(self._read_log())
        # Keep startup bounded while allowing the Metal engine to compile its kernels.
        async with httpx.AsyncClient(timeout=1.0, trust_env=False) as client:
            for _ in range(240):
                if self.process.returncode is not None:
                    raise RuntimeError(f"NeMo を起動できません: {self.last_error[-600:]}")
                try:
                    response = await client.get(f"http://127.0.0.1:{ASR_PORT}/ready")
                    if response.is_success and response.json().get("ready"):
                        models = await client.get(
                            f"http://127.0.0.1:{ASR_PORT}/v1/models",
                            headers={"Authorization": f"Bearer {self.key}"},
                        )
                        if models.is_success:
                            return
                except (httpx.HTTPError, ValueError):
                    pass
                await asyncio.sleep(0.25)
        await self.close()
        raise RuntimeError("NeMo の起動が60秒以内に完了しませんでした。")

    async def _read_log(self):
        async for line in self.process.stderr:
            self.last_error = (self.last_error + "\n" + line.decode(errors="replace").strip())[
                -4000:
            ]

    def connection(self):
        query = urlencode({"api_key": self.key})
        return connect(
            f"ws://127.0.0.1:{ASR_PORT}/v1/audio/transcriptions/realtime?{query}",
            open_timeout=10,
            close_timeout=3,
            max_size=2**20,
            proxy=None,
        )

    async def capture(self):
        if not CAPTURE.is_file():
            raise RuntimeError(
                "音声キャプチャが未ビルドです。npm run build:native を実行してください。"
            )
        self.capture_process = await asyncio.create_subprocess_exec(
            str(CAPTURE),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return self.capture_process

    async def stop_capture(self):
        await terminate(self.capture_process)
        self.capture_process = None

    async def close(self):
        await self.stop_capture()
        await terminate(self.process)
        self.process = None
        if self._log_task:
            self._log_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._log_task
            self._log_task = None


async def receive_event(socket):
    message = json.loads(await socket.recv())
    if message.get("type") == "error":
        raise RuntimeError(message.get("error", {}).get("message", "NeMo error"))
    return message
