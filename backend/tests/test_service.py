import asyncio
import contextlib
import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import SessionManager, create_app
from backend.pipeline import LiveSession
from backend.translation import translation_messages


class FakeTranslator:
    async def load(self):
        pass

    async def translate(self, text, source, target):
        return f"訳:{text}"

    def close(self):
        pass


class FakeSocket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.incoming.put_nowait({"type": "session.created"})
        self.sent = []

    async def send(self, message):
        self.sent.append(message)
        if isinstance(message, str):
            kind = json.loads(message)["type"]
            if kind == "session.update":
                await self.incoming.put({"type": "session.updated"})
            elif kind == "input_audio_buffer.commit":
                await self.incoming.put(
                    {
                        "type": "conversation.item.input_audio_transcription.completed",
                        "transcript": "Last words",
                        "audio_processed": 1.0,
                        "words": [{"start": 0.1, "end": 0.9}],
                    }
                )
                await self.incoming.put({"type": "input_audio_buffer.committed"})

    async def recv(self):
        return json.dumps(await self.incoming.get())


class FakeRuntime:
    def __init__(self):
        self.socket = FakeSocket()
        self.process = type("Process", (), {})()
        self.process.stdout = None
        self.process.stderr = None
        self.stopped = False

    async def check_capture_permission(self):
        pass

    async def ensure(self):
        pass

    @contextlib.asynccontextmanager
    async def connection(self):
        yield self.socket

    async def capture(self):
        self.process.stdout = asyncio.StreamReader()
        self.process.stderr = asyncio.StreamReader()
        # Deliberately split a PCM sample between reads.
        self.process.stdout.feed_data(b"\x01")
        return self.process

    async def stop_capture(self):
        if not self.stopped and self.process.stdout is not None:
            self.stopped = True
            self.process.stdout.feed_data(b"\x00\x02\x00")
            self.process.stdout.feed_eof()
            self.process.stderr.feed_eof()
            await asyncio.sleep(0)
        self.stopped = True

    async def close(self):
        await self.stop_capture()


def test_authentication_and_status(monkeypatch):
    monkeypatch.setattr("backend.app.translation_ready", lambda: False)
    manager = SessionManager(FakeRuntime(), FakeTranslator())
    with TestClient(create_app("secret", manager)) as client:
        assert client.get("/api/status").status_code == 401
        assert client.get("/api/status", headers={"Authorization": "secret"}).status_code == 401
        assert (
            client.get("/api/status", headers={"Authorization": "Bearer wrong"}).status_code == 401
        )
        status = client.get("/api/status", headers={"Authorization": "Bearer secret"})
        assert status.status_code == 200
        assert status.json()["translation"]["ready"] is False
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/live?token=wrong"):
                pass
        with client.websocket_connect("/api/live?token=secret") as socket:
            socket.send_json({"type": "start", "source": "zz", "target": "ja"})
            assert socket.receive_json()["type"] == "error"
            socket.send_json([])
            assert socket.receive_json()["type"] == "error"


@pytest.mark.parametrize("commit_interval_seconds", [5, 10, 15, 20, 30])
async def test_stop_commits_final_utterance_and_translates_before_stopped(commit_interval_seconds):
    events = []
    runtime = FakeRuntime()
    listening = asyncio.Event()

    async def send(event):
        events.append(event)
        if event.get("state") == "listening":
            listening.set()

    session = LiveSession(runtime, FakeTranslator(), send, "en", "ja", commit_interval_seconds)
    session.start()
    await asyncio.wait_for(listening.wait(), 2)
    await asyncio.wait_for(session.stop(), 2)
    subtitle = next(event for event in events if event["type"] == "subtitle")
    assert subtitle["text"] == "訳:Last words"
    assert subtitle["start"] == 0.1 and subtitle["end"] == 0.9
    assert events.index(subtitle) < len(events) - 1
    assert events[-1] == {"type": "status", "state": "stopped"}
    assert runtime.stopped
    assert b"\x01\x00\x02\x00" in runtime.socket.sent
    configuration = json.loads(runtime.socket.sent[0])
    assert configuration["session"]["endpointing_ms"] == 600
    assert [json.loads(item)["type"] for item in runtime.socket.sent if isinstance(item, str)] == [
        "session.update",
        "input_audio_buffer.commit",
    ]


@pytest.mark.parametrize("commit_interval_seconds", [None, 5, 10, 15, 20, 30])
async def test_periodic_commit_tracks_selected_pcm_duration(commit_interval_seconds):
    interval = 15 if commit_interval_seconds is None else commit_interval_seconds
    options = {} if commit_interval_seconds is None else {"commit_interval_seconds": interval}
    session = LiveSession(FakeRuntime(), FakeTranslator(), AsyncMock(), "en", "ja", **options)
    session.stopping.set()
    process = type("Process", (), {})()
    process.stdout = asyncio.StreamReader()
    process.stdout.feed_data(bytes(2 * interval * 32000 + 2))
    process.stdout.feed_eof()
    audio_bytes = 0
    commit_positions = []

    async def record(message):
        nonlocal audio_bytes
        if isinstance(message, bytes):
            audio_bytes += len(message)
        else:
            assert json.loads(message) == {"type": "input_audio_buffer.commit"}
            commit_positions.append(audio_bytes)

    socket = type("Socket", (), {})()
    socket.send = record
    await asyncio.wait_for(session.stream_audio(process, socket), 2)
    assert commit_positions == [interval * 32000, 2 * interval * 32000]
    assert audio_bytes == 2 * interval * 32000 + 2
    assert session._commits_sent == 2


@pytest.mark.parametrize("value", [True, False, 10.0, "10", None, 0, -5, 6, 31, [], {}])
async def test_session_rejects_invalid_commit_interval_before_starting(value):
    manager = SessionManager(FakeRuntime(), FakeTranslator())
    with pytest.raises(ValueError, match="確定要求の間隔"):
        await manager.start(object(), AsyncMock(), "en", "ja", value)
    assert manager.session is None
    with pytest.raises(ValueError, match="確定要求の間隔"):
        LiveSession(manager.runtime, manager.translator, AsyncMock(), "en", "ja", value)


@pytest.mark.parametrize("commit_interval_seconds", [None, 5, 10, 15, 20, 30])
def test_websocket_start_forwards_commit_interval(commit_interval_seconds):
    runtime = FakeRuntime()
    runtime.capture = AsyncMock()
    manager = SessionManager(runtime, FakeTranslator())
    manager.start = AsyncMock()
    with TestClient(create_app("secret", manager)) as client:
        with client.websocket_connect("/api/live?token=secret") as socket:
            message = {"type": "start", "source": "ja", "target": "en"}
            if commit_interval_seconds is not None:
                message["commit_interval_seconds"] = commit_interval_seconds
            socket.send_json(message)
            # The next error synchronizes processing of the preceding start message.
            socket.send_json({"type": "invalid"})
            assert socket.receive_json()["type"] == "error"
            manager.start.assert_awaited_once()
            assert manager.start.await_args.args[2:] == (
                "ja",
                "en",
                15 if commit_interval_seconds is None else commit_interval_seconds,
            )
            runtime.capture.assert_not_awaited()


@pytest.mark.parametrize("value", [True, False, 10.0, "10", None, 0, -5, 6, 31, [], {}])
@pytest.mark.parametrize("language", ["ja", "en"])
def test_websocket_rejects_invalid_commit_interval_before_session_creation(value, language):
    manager = SessionManager(FakeRuntime(), FakeTranslator())
    manager.start = AsyncMock()
    with TestClient(create_app("secret", manager)) as client:
        with client.websocket_connect("/api/live?token=secret") as socket:
            socket.send_json(
                {
                    "type": "start",
                    "source": "ja",
                    "target": "en",
                    "ui_language": language,
                    "commit_interval_seconds": value,
                }
            )
            assert socket.receive_json() == {
                "type": "error",
                "message": (
                    "Choose a commit request interval of 5, 10, 15, 20, or 30 seconds."
                    if language == "en"
                    else "確定要求の間隔は5、10、15、20、30秒から選択してください。"
                ),
            }
            manager.start.assert_not_awaited()


async def test_queue_bounds_latency_and_keeps_newest_utterance():
    events = []
    session = LiveSession(
        FakeRuntime(), FakeTranslator(), AsyncMock(side_effect=events.append), "en", "ja"
    )
    for i in range(5):
        await session.submit(str(i), i, i + 1)
    assert session.queue.qsize() == 3
    assert [session.queue.get_nowait()[0] for _ in range(3)] == ["2", "3", "4"]
    assert len(events) == 2


async def test_exclusive_capture_and_owner_stop():
    runtime = FakeRuntime()
    manager = SessionManager(runtime, FakeTranslator())
    owner, other = object(), object()
    session = await manager.start(owner, AsyncMock(), "en", "ja")
    with pytest.raises(ValueError, match="別の字幕"):
        await manager.start(other, AsyncMock(), "en", "ja")
    await manager.stop(other)
    assert manager.session is session
    await asyncio.wait_for(manager.stop(owner), 2)
    assert manager.session is None
    await manager.close()


async def test_translation_failure_is_reported_and_capture_is_released():
    translator = FakeTranslator()
    translator.load = AsyncMock(side_effect=RuntimeError("model unavailable"))
    events = []
    runtime = FakeRuntime()
    session = LiveSession(runtime, translator, AsyncMock(side_effect=events.append), "en", "ja")
    await session.run()
    assert {"type": "error", "message": "model unavailable"} in events
    assert runtime.stopped
    assert events[-1]["state"] == "stopped"


def test_hy_mt2_translation_prompt():
    message = translation_messages("Hello", "en", "ja")[0]
    assert message == {
        "role": "user",
        "content": "Translate the following text into Japanese. Note that you should only "
        "output the translated result without any additional explanation:\n\nHello",
    }


def test_hy_mt2_preserves_checkpoint_stop_tokens(monkeypatch):
    import sys
    from types import SimpleNamespace
    from unittest.mock import Mock

    from backend.translation import Translator

    tokenizer = Mock()
    monkeypatch.setitem(
        sys.modules, "mlx_lm", SimpleNamespace(load=lambda path: (object(), tokenizer))
    )
    monkeypatch.setattr("backend.translation.translation_ready", lambda: True)
    translator = Translator()
    translator._load()
    tokenizer.add_eos_token.assert_not_called()
    translator.close()


async def test_periodic_commit_does_not_finish_stop_before_final_commit():
    runtime = FakeRuntime()
    session = LiveSession(runtime, FakeTranslator(), AsyncMock(), "en", "ja")
    session.stopping.set()
    session._flush_commit_target = 2
    session._commits_sent = 2
    socket = FakeSocket()
    await socket.incoming.get()
    await socket.incoming.put({"type": "input_audio_buffer.committed"})
    await socket.incoming.put(
        {
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": "Tail",
            "audio_processed": 2,
        }
    )
    await socket.incoming.put({"type": "input_audio_buffer.committed"})
    await asyncio.wait_for(session.receive(socket), 1)
    assert session.queue.get_nowait()[0] == "Tail"
    assert session._commits_seen == 2


def test_interface_language_localizes_readiness_and_websocket_errors(monkeypatch):
    monkeypatch.setattr("backend.app.translation_ready", lambda: False)
    manager = SessionManager(FakeRuntime(), FakeTranslator())
    with TestClient(create_app("secret", manager)) as client:
        english = client.get(
            "/api/status",
            headers={"Authorization": "Bearer secret", "Accept-Language": "en-US,en;q=0.9"},
        )
        japanese = client.get("/api/status", headers={"Authorization": "Bearer secret"})
        assert "translation model is missing" in english.json()["translation"]["detail"]
        assert "翻訳モデルがありません" in japanese.json()["translation"]["detail"]
        with client.websocket_connect("/api/live?token=secret") as socket:
            socket.send_json({"type": "start", "source": "zz", "ui_language": "en"})
            assert socket.receive_json()["message"] == "This language is not supported."
            socket.send_json({"type": "ui_language", "ui_language": "ja"})
            socket.send_json({"type": "invalid"})
            assert socket.receive_json()["message"] == "対応していない操作です。"


def test_locale_events_never_translate_transcript_or_subtitle_content():
    from backend.messages import header_language, localize_event

    assert header_language("en;q=0,ja;q=1") == "ja"
    assert header_language("en-US,ja;q=0.5") == "en"
    for kind in ["subtitle", "partial"]:
        event = {"type": kind, "text": "翻訳済みの字幕", "source": "Original words"}
        assert localize_event(event, "en") == event


def test_permission_request_requires_auth_and_never_starts_translation(monkeypatch):
    permission = AsyncMock(
        return_value={
            "ready": False,
            "permission": "required",
            "detail": "翻訳を始める前に、システム音声の許可を設定してください。",
        }
    )
    monkeypatch.setattr("backend.app.capture_permission", permission)
    translator = FakeTranslator()
    translator.load = AsyncMock()
    runtime = FakeRuntime()
    runtime.capture = AsyncMock()
    manager = SessionManager(runtime, translator)
    with TestClient(create_app("secret", manager)) as client:
        for headers in [{}, {"Authorization": "Bearer wrong"}]:
            assert client.post("/api/capture/permission", headers=headers).status_code == 401
        permission.assert_not_called()
        result = client.post(
            "/api/capture/permission",
            headers={"Authorization": "Bearer secret", "Accept-Language": "en"},
        )
        assert result.status_code == 200
        assert result.json() == {
            "ready": False,
            "permission": "required",
            "detail": "Set up system audio permission before starting translation.",
        }
        permission.assert_awaited_once_with(request=True)
        assert manager.session is None
        translator.load.assert_not_awaited()
        runtime.capture.assert_not_awaited()


@pytest.mark.parametrize("should_request", [False, True])
async def test_permission_helper_uses_only_explicit_permission_commands(
    monkeypatch, tmp_path, should_request
):
    from types import SimpleNamespace

    from backend.runtime import capture_permission

    helper = tmp_path / "audio-capture"
    helper.touch()
    monkeypatch.setattr("backend.runtime.CAPTURE", helper)
    process = SimpleNamespace(
        returncode=0,
        communicate=AsyncMock(return_value=(b'{"available":true,"permission":"granted"}', b"")),
    )
    spawn = AsyncMock(return_value=process)
    monkeypatch.setattr("backend.runtime.asyncio.create_subprocess_exec", spawn)
    result = await capture_permission(request=should_request)
    assert result["permission"] == "granted" and result["ready"]
    assert spawn.call_args.args == (
        str(helper),
        "--request-permission" if should_request else "--check",
    )


async def test_permission_timeout_reaps_helper_and_returns_recoverable_status(
    monkeypatch, tmp_path
):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from backend.runtime import capture_permission

    helper = tmp_path / "audio-capture"
    helper.touch()
    monkeypatch.setattr("backend.runtime.CAPTURE", helper)
    process = SimpleNamespace(
        returncode=None,
        communicate=AsyncMock(return_value=(b"", b"")),
        kill=Mock(),
        wait=AsyncMock(),
    )
    monkeypatch.setattr(
        "backend.runtime.asyncio.create_subprocess_exec", AsyncMock(return_value=process)
    )

    # Mirror asyncio.wait_for's signature so this fake can verify its timeout.
    async def expire(awaitable, timeout):  # noqa: ASYNC109
        assert timeout == 60
        await awaitable
        raise TimeoutError

    monkeypatch.setattr("backend.runtime.asyncio.wait_for", expire)
    result = await capture_permission(request=True)
    assert result["permission"] == "unknown" and not result["ready"]
    process.kill.assert_called_once()
    process.wait.assert_awaited_once()


async def test_missing_permission_is_reported_before_models_or_capture_start():
    from backend.messages import localize_event
    from backend.runtime import CapturePermissionError

    events = []
    runtime = FakeRuntime()
    runtime.check_capture_permission = AsyncMock(side_effect=CapturePermissionError())
    runtime.ensure = AsyncMock()
    runtime.capture = AsyncMock()
    translator = FakeTranslator()
    translator.load = AsyncMock()
    session = LiveSession(runtime, translator, AsyncMock(side_effect=events.append), "en", "ja")
    await session.run()
    error = events[0]
    assert error["type"] == "error" and error["code"] == "capture_permission_required"
    assert "許可を確認" in error["message"]
    assert "Check permission" in localize_event(error, "en")["message"]
    assert events[-1] == {"type": "status", "state": "stopped"}
    translator.load.assert_not_awaited()
    runtime.ensure.assert_not_awaited()
    runtime.capture.assert_not_awaited()


async def test_capture_permission_revoked_after_preflight_has_structured_error():
    events = []
    runtime = FakeRuntime()

    async def denied_capture():
        runtime.process.stdout = asyncio.StreamReader()
        runtime.process.stderr = asyncio.StreamReader()
        runtime.process.stdout.feed_eof()
        runtime.process.stderr.feed_data(b"audio-capture: capture_permission_required\n")
        runtime.process.stderr.feed_eof()
        return runtime.process

    runtime.capture = denied_capture
    runtime.stop_capture = AsyncMock()
    session = LiveSession(
        runtime, FakeTranslator(), AsyncMock(side_effect=events.append), "en", "ja"
    )
    await asyncio.wait_for(session.run(), 2)
    error = next(event for event in events if event["type"] == "error")
    assert error["code"] == "capture_permission_required"
    assert "audio-capture:" not in error["message"]
    assert events[-1]["state"] == "stopped"
