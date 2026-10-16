"""Authenticated loopback-only service used by the Electron main process."""

import asyncio
import contextlib
import hmac
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect

from backend.config import asr_ready, nemo_binary, translation_ready
from backend.messages import header_language, localize, localize_event, ui_language
from backend.pipeline import LiveSession, validate_commit_interval
from backend.runtime import NemoRuntime, capture_permission
from backend.translation import Translator

# Curated transcription-ready and broad-coverage languages exposed by the app.
SOURCES = {
    "en",
    "ja",
    "de",
    "es",
    "fr",
    "it",
    "pt",
    "zh",
    "ko",
    "ru",
    "ar",
    "hi",
    "nl",
    "tr",
    "vi",
    "uk",
    "pl",
    "sv",
    "cs",
    "nb",
    "da",
    "bg",
    "fi",
    "hr",
    "sk",
    "hu",
    "ro",
    "et",
}
TARGETS = SOURCES | {"ar", "hi", "ru", "nl", "sv", "pl", "tr", "uk", "vi", "th", "id"}


class SessionManager:
    def __init__(self, runtime=None, translator=None):
        self.runtime = runtime or NemoRuntime()
        self.translator = translator or Translator()
        self.session = None
        self.lock = asyncio.Lock()

    async def start(self, owner, send, source, target, commit_interval_seconds=15):
        commit_interval_seconds = validate_commit_interval(commit_interval_seconds)
        async with self.lock:
            if self.session and not self.session.task.done():
                raise ValueError("別の字幕セッションが実行中です。先に停止してください。")
            self.session = LiveSession(
                self.runtime, self.translator, send, source, target, commit_interval_seconds
            )
            self.session.owner = owner
            self.session.start()
            return self.session

    async def stop(self, owner):
        async with self.lock:
            if self.session and self.session.owner is owner:
                await self.session.stop()
                self.session = None

    async def close(self):
        if self.session:
            await self.session.stop()
        await self.runtime.close()
        self.translator.close()


def create_app(token: str | None = None, manager: SessionManager | None = None):
    secret = token if token is not None else os.environ.get("RT_TOKEN", "")
    sessions = manager or SessionManager()
    permission_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        yield
        await sessions.close()

    app = FastAPI(
        title="kotonoha",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    def authorized(value):
        return bool(secret) and hmac.compare_digest((value or "").encode(), secret.encode())

    @app.post("/api/capture/permission")
    async def request_capture_permission(
        authorization: str | None = Header(default=None),
        accept_language: str | None = Header(default=None),
    ):
        if not (authorization or "").startswith("Bearer ") or not authorized(
            (authorization or "").removeprefix("Bearer ")
        ):
            raise HTTPException(status_code=401, detail="Unauthorized")
        language = header_language(accept_language)
        if sessions.session and not sessions.session.task.done():
            result = await capture_permission()
            return {**result, "detail": localize(result["detail"], language)}
        if permission_lock.locked():
            return {
                "ready": False,
                "permission": "unknown",
                "detail": localize(
                    "音声の許可を確認中です。macOS のダイアログを確認してください。", language
                ),
            }
        async with permission_lock:
            result = await capture_permission(request=True)
        return {**result, "detail": localize(result["detail"], language)}

    @app.get("/api/status")
    async def status(
        authorization: str | None = Header(default=None),
        accept_language: str | None = Header(default=None),
    ):
        if not (authorization or "").startswith("Bearer ") or not authorized(
            (authorization or "").removeprefix("Bearer ")
        ):
            raise HTTPException(status_code=401, detail="Unauthorized")
        result = {
            "capture": await capture_permission(),
            "asr": {
                "ready": bool(nemo_binary()) and asr_ready(),
                "detail": "Nemotron 3.5 · Metal"
                if nemo_binary() and asr_ready()
                else "NeMo CLI とモデルが必要です。npm run prepare:models を実行してください。",
            },
            "translation": {
                "ready": translation_ready(),
                "detail": "Hy-MT2 1.8B · MLX 4-bit"
                if translation_ready()
                else "翻訳モデルがありません。npm run prepare:models を実行してください。",
            },
        }
        language = header_language(accept_language)
        for component in result.values():
            component["detail"] = localize(component["detail"], language)
        return result

    @app.websocket("/api/live")
    async def live(socket: WebSocket):
        if not authorized(socket.query_params.get("token")):
            await socket.close(code=1008)
            return
        await socket.accept()
        owner = object()
        send_lock = asyncio.Lock()
        language = "ja"

        async def send(event, selected_language=None):
            async with send_lock:
                await socket.send_json(localize_event(event, selected_language or language))

        try:
            while True:
                try:
                    message = await socket.receive_json()
                    if not isinstance(message, dict):
                        raise ValueError("JSON オブジェクトを送信してください。")
                    kind = message.get("type")
                    if kind == "start":
                        language = ui_language(message.get("ui_language"))
                        source, target = message.get("source", "en"), message.get("target", "ja")
                        if source not in SOURCES or target not in TARGETS:
                            raise ValueError("対応していない言語です。")
                        commit_interval_seconds = validate_commit_interval(
                            message.get("commit_interval_seconds", 15)
                        )
                        await sessions.start(owner, send, source, target, commit_interval_seconds)
                    elif kind == "ui_language":
                        language = ui_language(message.get("ui_language"))
                    elif kind == "stop":
                        await sessions.stop(owner)
                    else:
                        raise ValueError("対応していない操作です。")
                except (ValueError, TypeError) as error:
                    await send({"type": "error", "message": str(error)})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            with contextlib.suppress(Exception):
                await sessions.stop(owner)

    return app


app = create_app()


def main():
    if not os.environ.get("RT_TOKEN"):
        raise SystemExit(
            "RT_TOKEN is required. Launch via the desktop app or set a random bearer token."
        )
    import uvicorn

    # Access logs could expose the WebSocket query token; the service never logs requests.
    port = int(os.environ.get("RT_PORT", "8765"))
    if port not in {8765, 8767}:
        raise SystemExit("Unsupported local service port")
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
