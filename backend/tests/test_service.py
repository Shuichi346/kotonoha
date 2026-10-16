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


async def test_stop_commits_final_utterance_and_translates_before_stopped():
    events = []
    runtime = FakeRuntime()
    listening = asyncio.Event()

    async def send(event):
        events.append(event)
        if event.get("state") == "listening":
            listening.set()

    session = LiveSession(runtime, FakeTranslator(), send, "en", "ja")
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


def test_translategemma_structured_prompt():
    message = translation_messages("Hello", "en", "ja")[0]
    assert message == {
        "role": "user",
        "content": [
            {"type": "text", "source_lang_code": "en", "target_lang_code": "ja", "text": "Hello"}
        ],
    }


def test_community_model_turn_terminator_is_a_stop_token(monkeypatch):
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
    tokenizer.add_eos_token.assert_called_once_with("<end_of_turn>")
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
