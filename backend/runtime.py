"""Own the local NeMo server and the short-lived system audio capture process."""

import asyncio
import contextlib
import json
import secrets
from urllib.parse import urlencode

import httpx
from websockets.asyncio.client import connect

from backend.config import ASR_MODEL, CAPTURE, asr_ready, nemo_binary
from backend.ports import ASR_PORTS, PortsUnavailableError, bind_first_available


class CapturePermissionError(RuntimeError):
    code = "capture_permission_required"

    def __init__(self):
        super().__init__(
            "システム音声の許可がまだ確認できません。設定で kotonoha を許可したあと、"
            "「許可を確認」を押してください。"
            "オンでも確認できない場合は kotonoha を再起動してください。"
        )


async def capture_permission(*, request: bool = False):
    """Check/request authorization without starting capture or loading any model."""
    if not CAPTURE.is_file():
        return {"ready": False, "detail": "npm run build:native を実行してください。"}
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            str(CAPTURE),
            "--request-permission" if request else "--check",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        output, _ = await asyncio.wait_for(process.communicate(), timeout=60 if request else 5)
        if process.returncode != 0:
            raise ValueError("Permission helper failed")
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("permission") not in {"granted", "required"}:
            raise ValueError("Invalid permission status")
        ready = result.get("available") is True and result["permission"] == "granted"
        return {
            "ready": ready,
            "permission": result["permission"],
            "detail": "ScreenCaptureKit · 16 kHz PCM"
            if ready
            else "翻訳を始める前に、システム音声の許可を設定してください。",
        }
    except (OSError, ValueError, TimeoutError):
        return {
            "ready": False,
            "permission": "unknown",
            "detail": "音声の許可を確認できません。macOS のダイアログを閉じて、"
            "もう一度確認してください。",
        }
    finally:
        if process and process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()


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
        self.port = None
        self.key = secrets.token_urlsafe(32)
        self._log_task = None
        self.last_error = ""

    async def check_capture_permission(self):
        result = await capture_permission()
        if result.get("permission") == "required":
            raise CapturePermissionError()
        if not result["ready"]:
            raise RuntimeError(result["detail"])

    async def ensure(self):
        if self.process is not None and self.process.returncode is None:
            return
        binary = nemo_binary()
        if not binary or not asr_ready():
            raise RuntimeError(
                "文字起こしモデルがありません。npm run prepare:models を実行してください。"
            )
        try:
            # One deadline covers all candidates, including a bind race in the external CLI.
            async with asyncio.timeout(60):
                for port in ASR_PORTS:
                    try:
                        with bind_first_available((port,)):
                            pass
                    except PortsUnavailableError:
                        continue
                    self.port = port
                    self.last_error = ""
                    await self._launch(binary)
                    if await self._wait_ready():
                        return
                    # The CLI cannot inherit our probe socket. Retry only a confirmed bind
                    # conflict, including another process claiming the port after the probe.
                    conflict = any(
                        phrase in self.last_error.lower()
                        for phrase in ("address already in use", "eaddrinuse", "addrinuse")
                    )
                    if not conflict:
                        try:
                            with bind_first_available((port,)):
                                pass
                        except PortsUnavailableError:
                            conflict = True
                    detail = self.last_error[-600:]
                    await self.close()
                    if not conflict:
                        raise RuntimeError(f"NeMo を起動できません: {detail}")
                raise PortsUnavailableError(ASR_PORTS)
        except TimeoutError as error:
            await self.close()
            raise RuntimeError("NeMo の起動が60秒以内に完了しませんでした。") from error
        except BaseException:
            await self.close()
            raise

    async def _launch(self, binary):
        self.process = await asyncio.create_subprocess_exec(
            binary,
            "serve",
            "--asr-model",
            ASR_MODEL,
            "--device",
            "metal",
            "--host",
            "127.0.0.1",
            "--port",
            str(self.port),
            "--no-ui",
            "--api-key",
            self.key,
            "--asr.endpointing.enable",
            "--asr.endpointing.stop_history_eou_ms",
            "600",
            "--max-upload-mb",
            "4096",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._log_task = asyncio.create_task(self._read_log())

    async def _wait_ready(self):
        async with httpx.AsyncClient(timeout=1.0, trust_env=False) as client:
            while True:
                if self.process.returncode is not None:
                    await self._log_task
                    return False
                try:
                    response = await client.get(f"http://127.0.0.1:{self.port}/ready")
                    if response.is_success and response.json().get("ready"):
                        models = await client.get(
                            f"http://127.0.0.1:{self.port}/v1/models",
                            headers={"Authorization": f"Bearer {self.key}"},
                        )
                        if models.is_success and self.process.returncode is None:
                            return True
                except (httpx.HTTPError, ValueError):
                    pass
                await asyncio.sleep(0.25)

    async def _read_log(self):
        async for line in self.process.stderr:
            self.last_error = (self.last_error + "\n" + line.decode(errors="replace").strip())[
                -4000:
            ]

    def connection(self):
        query = urlencode({"api_key": self.key})
        return connect(
            f"ws://127.0.0.1:{self.port}/v1/audio/transcriptions/realtime?{query}",
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
        self.port = None
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
