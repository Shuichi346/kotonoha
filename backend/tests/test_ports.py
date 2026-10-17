"""Port conflicts are exercised without loading models or capturing system audio."""

import asyncio
import errno
import json
import os
import select
import subprocess
import sys
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from websockets.sync.client import connect

from backend.messages import localize_event
from backend.ports import API_PORTS, ASR_PORTS, PortsUnavailableError, bind_first_available
from backend.runtime import NemoRuntime


def occupy(stack):
    listener = stack.enter_context(bind_first_available((0,)))
    return listener.getsockname()[1]


def test_pools_have_five_backups_and_exclude_smoke_port():
    assert API_PORTS[0] == 8765 and ASR_PORTS[0] == 8766
    assert len(set(API_PORTS)) == len(set(ASR_PORTS)) == 6
    assert not set(API_PORTS) & set(ASR_PORTS)
    assert 8767 not in (*API_PORTS, *ASR_PORTS)


def test_selection_skips_five_occupied_ports_and_retains_exclusive_listener():
    with ExitStack() as stack:
        busy = tuple(occupy(stack) for _ in range(5))
        with bind_first_available((*busy, 0)) as chosen:
            assert chosen.getsockname()[0] == "127.0.0.1"
            with pytest.raises(PortsUnavailableError):
                bind_first_available((chosen.getsockname()[1],))
        # Occupied listeners remain owned by the fixture after selection and shutdown.
        with pytest.raises(PortsUnavailableError) as error:
            bind_first_available(busy)
        assert error.value.ports == busy
        english = localize_event({"type": "error", "message": str(error.value)}, "en")
        assert "All local service ports are in use" in english["message"]
        assert all(str(port) in english["message"] for port in busy)


def test_non_conflict_bind_errors_are_not_hidden(monkeypatch):
    listener = Mock()
    listener.bind.side_effect = PermissionError(errno.EACCES, "denied")
    monkeypatch.setattr("backend.ports.socket.socket", Mock(return_value=listener))
    with pytest.raises(PermissionError):
        bind_first_available(API_PORTS)
    listener.close.assert_called_once()


def launch_api(ports, token="secret", requested="8765"):
    # Only readiness is replaced; run the actual bound-socket Uvicorn startup and routes.
    script = f"""
import backend.app as service
async def permission():
    return {{"ready": False, "permission": "required", "detail": "test"}}
service.capture_permission = permission
service.API_PORTS = {ports!r}
service.main()
"""
    return subprocess.Popen(
        [sys.executable, "-c", script],
        env={**os.environ, "RT_TOKEN": token, "RT_PORT": requested},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def report(child):
    assert select.select([child.stdout], [], [], 15)[0], "API startup did not report a port"
    return json.loads(child.stdout.readline())


def test_actual_api_fallback_serves_authenticated_http_and_websocket():
    with ExitStack() as stack:
        busy = tuple(occupy(stack) for _ in range(5))
        child = launch_api((*busy, 0))
        try:
            selected = report(child)
            assert selected["type"] == "service_port"
            port = selected["port"]
            assert port not in busy
            base = f"http://127.0.0.1:{port}"
            with httpx.Client(timeout=10, trust_env=False) as client:
                assert client.get(f"{base}/api/status").status_code == 401
                assert (
                    client.get(
                        f"{base}/api/status", headers={"Authorization": "Bearer secret"}
                    ).status_code
                    == 200
                )
            with connect(f"ws://127.0.0.1:{port}/api/live?token=secret", proxy=None) as ws:
                ws.send(json.dumps({"type": "ui_language", "ui_language": "en"}))
                ws.send(json.dumps({"type": "unsupported"}))
                assert "not supported" in json.loads(ws.recv(timeout=5))["message"]
        finally:
            child.terminate()
            child.communicate(timeout=10)
        with bind_first_available((port,)):
            pass
        with pytest.raises(PortsUnavailableError):
            bind_first_available(busy)


def test_actual_api_exhaustion_reports_ports_and_does_not_start_service():
    with ExitStack() as stack:
        busy = tuple(occupy(stack) for _ in range(6))
        child = launch_api(busy)
        assert report(child) == {"type": "ports_unavailable", "ports": list(busy)}
        child.communicate(timeout=10)
        assert child.returncode != 0


def test_smoke_port_never_falls_back_to_production():
    with ExitStack() as stack:
        try:
            stack.enter_context(bind_first_available((8767,)))
        except PortsUnavailableError:
            pass
        child = launch_api((0,), requested="8767")
        assert report(child) == {"type": "ports_unavailable", "ports": [8767]}
        child.communicate(timeout=10)
        assert child.returncode != 0


@pytest.fixture
def nemo(monkeypatch):
    monkeypatch.setattr("backend.runtime.nemo_binary", lambda: "/fake/nemo-speech")
    monkeypatch.setattr("backend.runtime.asr_ready", lambda: True)
    processes = []

    async def spawn(*args, **kwargs):
        stderr = asyncio.StreamReader()
        stderr.feed_eof()
        process = SimpleNamespace(returncode=None, stderr=stderr, wait=AsyncMock())
        process.terminate = Mock(side_effect=lambda: setattr(process, "returncode", 0))
        processes.append(process)
        return process

    launch = AsyncMock(side_effect=spawn)
    monkeypatch.setattr("backend.runtime.asyncio.create_subprocess_exec", launch)
    return NemoRuntime(), launch, processes


async def test_nemo_skips_occupied_ports_and_uses_selected_port_for_http_and_ws(monkeypatch, nemo):
    runtime, launch, processes = nemo
    urls = []

    async def get(url, **kwargs):
        urls.append(url)
        if url.endswith("/v1/models"):
            assert kwargs["headers"] == {"Authorization": f"Bearer {runtime.key}"}
        return httpx.Response(200, json={"ready": True})

    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.side_effect = get
    monkeypatch.setattr("backend.runtime.httpx.AsyncClient", Mock(return_value=client))
    connection = Mock()
    monkeypatch.setattr("backend.runtime.connect", connection)
    with ExitStack() as stack:
        busy = tuple(occupy(stack) for _ in range(5))
        with bind_first_available((0,)) as spare:
            selected = spare.getsockname()[1]
        monkeypatch.setattr("backend.runtime.ASR_PORTS", (*busy, selected))
        await runtime.ensure()
        args = launch.call_args.args
        assert args[args.index("--port") + 1] == str(selected)
        assert args[args.index("--host") + 1] == "127.0.0.1"
        assert "--asr.endpointing.enable" in args
        assert urls == [
            f"http://127.0.0.1:{selected}/ready",
            f"http://127.0.0.1:{selected}/v1/models",
        ]
        runtime.connection()
        assert connection.call_args.args[0].startswith(f"ws://127.0.0.1:{selected}/")
        await runtime.ensure()
        assert launch.await_count == 1
        await runtime.close()
        processes[0].terminate.assert_called_once()
        assert runtime.port is None


async def test_nemo_retries_a_cli_bind_race_but_not_other_failures(monkeypatch, nemo):
    runtime, launch, processes = nemo
    monkeypatch.setattr("backend.runtime.ASR_PORTS", (0, 0))

    async def ready():
        if len(processes) == 1:
            runtime.last_error = "Address already in use (os error 48)"
            runtime.process.returncode = 1
            return False
        return True

    monkeypatch.setattr(runtime, "_wait_ready", ready)
    await runtime.ensure()
    assert launch.await_count == 2
    await runtime.close()

    async def failed():
        runtime.last_error = "Invalid model configuration"
        runtime.process.returncode = 1
        return False

    monkeypatch.setattr(runtime, "_wait_ready", failed)
    with pytest.raises(RuntimeError, match="Invalid model configuration"):
        await runtime.ensure()
    assert launch.await_count == 3
    assert runtime.process is None


async def test_nemo_exhaustion_never_launches_another_process(monkeypatch, nemo):
    runtime, launch, _ = nemo
    with ExitStack() as stack:
        busy = tuple(occupy(stack) for _ in range(6))
        monkeypatch.setattr("backend.runtime.ASR_PORTS", busy)
        with pytest.raises(PortsUnavailableError) as error:
            await runtime.ensure()
        assert error.value.ports == busy
        launch.assert_not_awaited()
        assert runtime.process is None


async def test_nemo_timeout_and_cancellation_clean_up_owned_child(monkeypatch, nemo):
    runtime, _, processes = nemo
    monkeypatch.setattr("backend.runtime.ASR_PORTS", (0,))

    async def timeout():
        raise TimeoutError

    monkeypatch.setattr(runtime, "_wait_ready", timeout)
    with pytest.raises(RuntimeError, match="60秒"):
        await runtime.ensure()
    processes[0].terminate.assert_called_once()

    async def cancelled():
        raise asyncio.CancelledError

    monkeypatch.setattr(runtime, "_wait_ready", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await runtime.ensure()
    processes[1].terminate.assert_called_once()
    assert runtime.process is None
