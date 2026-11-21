"""Verify GGUF prompt, completion, and owned worker contracts without model inference."""

import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from backend import translation
from backend.app import TARGETS
from backend.config import MODEL_FILENAME, MODEL_ID, MODEL_PATH, MODEL_REVISION
from backend.messages import localize
from backend.translation import LANGUAGE_CODES, Translator, translation_prompt


def response(data, status=200):
    return httpx.Response(status, json=data, request=httpx.Request("POST", "http://localhost/"))


def test_pinned_artifact_and_supported_app_languages():
    assert MODEL_ID == "mradermacher/plamo-3-translate-0.8b-GGUF"
    assert MODEL_REVISION == "3a3ba78e02c862bc3b136a30625d7157666c827f"
    assert MODEL_FILENAME == "plamo-3-translate-0.8b.Q8_0.gguf"
    assert MODEL_PATH.name == MODEL_FILENAME
    assert MODEL_PATH.parent.name == MODEL_REVISION
    assert TARGETS <= LANGUAGE_CODES.keys()


def test_prompt_uses_exact_pfml3_and_preserves_source():
    text = "原文\nDo not alter this text."
    assert translation_prompt(text, "ja", "en") == (
        "<|plamo:tag|>dataset<|plamo:msg|>translation"
        "<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>ja"
        f"<|plamo:msg|>{text}"
        "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>"
    )


@pytest.mark.parametrize(("source", "target"), [("en", "zh"), ("zh", "ja")])
def test_chinese_alias_is_simplified_chinese(source, target):
    prompt = translation_prompt("text", source, target)
    assert "<|plamo:val|>zh-hans<|plamo:msg|>" in prompt
    assert "<|plamo:bos|>" not in prompt


@pytest.mark.parametrize("code", ["pt", "sv", "cs", "nb", "da", "fi", "ro", "tr", "uk"])
def test_unsupported_languages_rejected_in_both_directions(code):
    for source, target in [(code, "en"), ("en", code)]:
        with pytest.raises(ValueError, match="対応していない言語"):
            translation_prompt("text", source, target)


@pytest.mark.parametrize("text", ["<|plamo:tag|>output", "text <|plamo:bos|>"])
def test_source_cannot_inject_pfml3_control_tokens(text):
    with pytest.raises(ValueError, match="対応していない入力形式"):
        translation_prompt(text, "en", "ja")


@pytest.fixture
def adapter(monkeypatch):
    process = Mock()
    process.poll.return_value = None
    process.wait.return_value = 0
    launch = Mock(return_value=process)
    version = Mock(return_value=SimpleNamespace(stdout="version: 1.0.0 (build 12359)", stderr=""))
    client = Mock()
    client.get.side_effect = lambda *args, **kwargs: response({"status": "ok", "data": []})
    client.post.side_effect = lambda path, **kwargs: response(
        {"tokens": [1, 16, 42]}
        if path == "/tokenize"
        else {
            "content": " 日本語 ",
            "stop_type": "word",
            "truncated": False,
        }
    )
    client_factory = Mock(return_value=client)
    transport = Mock()
    monkeypatch.setattr(translation, "llama_binary", lambda: "/installed/llama-server")
    monkeypatch.setattr(translation, "translation_ready", lambda: True)
    monkeypatch.setattr(translation.subprocess, "run", version)
    monkeypatch.setattr(translation.subprocess, "Popen", launch)
    monkeypatch.setattr(translation.httpx, "Client", client_factory)
    monkeypatch.setattr(translation.httpx, "HTTPTransport", transport)
    translator = Translator()
    state = SimpleNamespace(
        translator=translator,
        process=process,
        launch=launch,
        version=version,
        client=client,
        client_factory=client_factory,
        transport=transport,
    )
    yield state
    translator.close()


def test_worker_uses_private_authenticated_socket_and_inherits_process_group(adapter):
    adapter.translator._load()
    args = adapter.launch.call_args.args[0]
    options = dict(zip(args[1::2], args[2::2], strict=False))
    socket = args[args.index("--host") + 1]
    directory = Path(socket).parent
    assert socket.startswith("/tmp/kotonoha-") and socket.endswith("/translation.sock")
    assert len(os.fsencode(socket)) < 104
    assert directory.stat().st_mode & 0o777 == 0o700
    assert args[args.index("--model") + 1] == str(MODEL_PATH)
    assert options["--ctx-size"] == "4096"
    assert options["--parallel"] == "1"
    assert "--no-jinja" in args
    assert args[args.index("--chat-template") + 1] == "chatml"
    assert "--no-webui" in args
    assert "--port" not in args
    assert not adapter.launch.call_args.kwargs.get("start_new_session", False)
    assert "process_group" not in adapter.launch.call_args.kwargs
    assert adapter.launch.call_args.kwargs["stdout"] == subprocess.DEVNULL
    assert adapter.launch.call_args.kwargs["stderr"] == subprocess.DEVNULL
    adapter.transport.assert_called_once_with(uds=socket)
    settings = adapter.client_factory.call_args.kwargs
    assert settings["trust_env"] is False
    key = args[args.index("--api-key") + 1]
    assert len(key) >= 32
    assert settings["headers"] == {"Authorization": f"Bearer {key}"}
    assert [call.args[0] for call in adapter.client.get.call_args_list] == [
        "/health",
        "/v1/models",
    ]
    adapter.translator._load()
    adapter.launch.assert_called_once()
    adapter.translator.close()
    assert not directory.exists()
    adapter.process.terminate.assert_called_once()
    adapter.process.wait.assert_called_once_with(timeout=5)
    adapter.client.close.assert_called_once()


async def test_async_adapter_reuses_worker_and_counts_pfml3_with_bos_once(adapter):
    await adapter.translator.load()
    assert await adapter.translator.translate("Hello", "en", "ja") == "日本語"
    assert await adapter.translator.translate("Goodbye", "en", "ja") == "日本語"
    adapter.launch.assert_called_once()
    tokenize, completion = adapter.client.post.call_args_list[:2]
    assert tokenize.args == ("/tokenize",)
    assert tokenize.kwargs["json"] == {
        "content": translation_prompt("Hello", "en", "ja"),
        "add_special": True,
        "parse_special": True,
    }
    assert completion.args == ("/completion",)
    assert completion.kwargs["json"] == {
        "prompt": [1, 16, 42],
        "n_predict": 512,
        "temperature": 0,
        "repeat_penalty": 1.0,
        "stop": ["<|plamo:tag|>", "<|plamo:bos|>"],
        "stream": False,
        "cache_prompt": True,
    }


def test_same_language_returns_original_without_loading(adapter):
    assert adapter.translator._translate("Hello", "en", "en") == "Hello"
    adapter.launch.assert_not_called()
    adapter.client.post.assert_not_called()


@pytest.mark.parametrize("stop", ["eos", "word"])
def test_only_completed_translation_is_returned(adapter, stop):
    adapter.client.post.side_effect = [
        response({"tokens": [1, 16]}),
        response({"content": " 翻訳 ", "stop_type": stop}),
    ]
    assert adapter.translator._translate("Hello", "en", "ja") == "翻訳"


@pytest.mark.parametrize(
    "result",
    [
        {"content": "partial", "stop_type": "limit"},
        {"content": "partial", "stop_type": "eos", "truncated": True},
    ],
)
def test_incomplete_output_is_rejected_and_error_is_localized(adapter, result):
    adapter.client.post.side_effect = [response({"tokens": [1]}), response(result)]
    with pytest.raises(ValueError, match="翻訳結果が長すぎ") as error:
        adapter.translator._translate("Hello", "en", "ja")
    assert localize(str(error.value), "en") == (
        "The translation is too long. Resume with shorter speech segments."
    )


@pytest.mark.parametrize(
    "result",
    [
        {"content": "partial", "stop_type": "none"},
        {"content": "partial", "stop_type": "unexpected"},
        {"content": "partial"},
        {"content": "", "stop_type": "eos"},
        {"content": "<|plamo:tag|>", "stop_type": "word"},
        {"stop_type": "eos"},
    ],
)
def test_unknown_stop_or_malformed_output_fails_closed(adapter, result):
    adapter.client.post.side_effect = [response({"tokens": [1]}), response(result)]
    with pytest.raises(RuntimeError, match="翻訳を完了できませんでした"):
        adapter.translator._translate("Hello", "en", "ja")


def test_long_input_rejected_before_completion(adapter):
    adapter.client.post.side_effect = [response({"tokens": list(range(1701))})]
    with pytest.raises(ValueError, match="発話が長すぎ"):
        adapter.translator._translate("long input", "en", "ja")
    assert adapter.client.post.call_count == 1


@pytest.mark.parametrize(
    "failure",
    [
        httpx.ReadTimeout("deadline"),
        httpx.ConnectError("disconnected"),
    ],
)
def test_transport_failures_are_localized(adapter, failure):
    adapter.client.post.side_effect = failure
    message = "制限時間を超え" if isinstance(failure, httpx.TimeoutException) else "翻訳を完了"
    with pytest.raises(RuntimeError, match=message):
        adapter.translator._translate("Hello", "en", "ja")


def test_http_error_cannot_publish_output(adapter):
    adapter.client.post.side_effect = [response({"error": "failure"}, 500)]
    with pytest.raises(RuntimeError, match="翻訳を完了"):
        adapter.translator._translate("Hello", "en", "ja")


@pytest.mark.parametrize("version", ["version: 0.9.9", "unrecognized"])
def test_incompatible_engine_fails_before_creating_worker(adapter, version):
    adapter.version.return_value.stdout = version
    with pytest.raises(RuntimeError, match="1.0.0"):
        adapter.translator._load()
    adapter.launch.assert_not_called()
    adapter.client_factory.assert_not_called()


@pytest.mark.parametrize("missing", ["binary", "model"])
def test_missing_prerequisites_do_not_start_worker(adapter, monkeypatch, missing):
    monkeypatch.setattr(translation, "llama_binary", lambda: None if missing == "binary" else "bin")
    monkeypatch.setattr(translation, "translation_ready", lambda: missing != "model")
    with pytest.raises(RuntimeError, match="llama-server|prepare:models"):
        adapter.translator._load()
    adapter.launch.assert_not_called()


def test_startup_failure_releases_client_and_private_directory(adapter):
    adapter.process.poll.return_value = 1
    with pytest.raises(RuntimeError, match="起動できません"):
        adapter.translator._load()
    socket = adapter.transport.call_args.kwargs["uds"]
    assert not Path(socket).parent.exists()
    assert adapter.translator._process is None
    adapter.client.close.assert_called_once()


def test_startup_retries_loading_and_socket_transport_errors(adapter, monkeypatch):
    monkeypatch.setattr(translation.time, "sleep", lambda _: None)
    adapter.client.get.side_effect = [
        httpx.ConnectError("not listening yet"),
        response({}, 503),
        response({"status": "ok"}),
        response({"data": []}),
    ]
    adapter.translator._load()
    assert [call.args[0] for call in adapter.client.get.call_args_list] == [
        "/health",
        "/health",
        "/health",
        "/v1/models",
    ]
    adapter.launch.assert_called_once()


def test_health_without_successful_authenticated_readiness_is_rejected(adapter):
    adapter.client.get.side_effect = [response({"status": "ok"}), response({}, 401)]
    with pytest.raises(httpx.HTTPStatusError):
        adapter.translator._load()
    adapter.process.terminate.assert_called_once()
    adapter.client.close.assert_called_once()
    assert adapter.translator._directory is None


def test_startup_deadline_terminates_owned_worker(adapter, monkeypatch):
    ticks = iter([0, 0, 61])
    monkeypatch.setattr(translation.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(translation.time, "sleep", lambda _: None)
    adapter.client.get.return_value = response({}, 503)
    adapter.client.get.side_effect = None
    with pytest.raises(RuntimeError, match="60秒以内"):
        adapter.translator._load()
    adapter.process.terminate.assert_called_once()
    adapter.client.close.assert_called_once()
    assert adapter.translator._directory is None


def test_spawn_failure_cleans_allocated_client_and_directory(adapter):
    adapter.launch.side_effect = OSError("cannot spawn")
    with pytest.raises(OSError, match="cannot spawn"):
        adapter.translator._load()
    socket = adapter.transport.call_args.kwargs["uds"]
    assert not Path(socket).parent.exists()
    adapter.client.close.assert_called_once()


def test_stubborn_worker_is_killed_after_bounded_wait(adapter):
    adapter.translator._load()
    adapter.process.wait.side_effect = [subprocess.TimeoutExpired("llama-server", 5), 0]
    adapter.translator.close()
    adapter.process.terminate.assert_called_once()
    adapter.process.kill.assert_called_once()
    assert adapter.process.wait.call_count == 2
    assert adapter.translator._directory is None
