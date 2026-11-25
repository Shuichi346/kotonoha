"""Shared cache discovery stays offline and rejects incomplete or unrelated models."""

import hashlib
import json
import os
import subprocess
import sys
from unittest.mock import Mock

import pytest

from backend import config, prepare
from backend.runtime import NemoRuntime


def test_huggingface_cache_overrides_and_pinned_snapshot(tmp_path):
    for overrides, root in [
        ({"HF_HOME": str(tmp_path / "home")}, tmp_path / "home/hub"),
        ({"HF_HUB_CACHE": str(tmp_path / "hub")}, tmp_path / "hub"),
    ]:
        env = {key: value for key, value in os.environ.items() if not key.startswith("HF_")}
        result = subprocess.run(
            [sys.executable, "-c", "from backend.config import MODEL_DIR; print(MODEL_DIR)"],
            env={**env, **overrides},
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        assert result.stdout.strip() == str(
            root
            / "models--mradermacher--plamo-3-translate-0.8b-GGUF/snapshots"
            / config.MODEL_REVISION
        )


def test_translation_readiness_requires_exact_gguf_and_engine(tmp_path, monkeypatch):
    artifact = tmp_path / config.MODEL_FILENAME
    monkeypatch.setattr(config, "MODEL_PATH", artifact)
    monkeypatch.setattr(config, "MODEL_SIZE", 8)
    monkeypatch.setattr(config, "llama_binary", lambda: "/installed/llama-server")
    assert not config.translation_ready()
    artifact.with_name("different.gguf").write_bytes(b"GGUFdata")
    assert not config.translation_ready()
    artifact.write_bytes(b"GGUFbad")
    assert not config.translation_ready()
    artifact.write_bytes(b"wrong!!!")
    assert not config.translation_ready()
    artifact.write_bytes(b"GGUFdata")
    assert config.translation_ready()
    monkeypatch.setattr(config, "llama_binary", lambda: None)
    assert not config.translation_ready()


def test_configured_engine_does_not_fall_back_to_another_installation(tmp_path, monkeypatch):
    binary = tmp_path / "llama-server"
    monkeypatch.setenv("KOTONOHA_LLAMA_SERVER", str(binary))
    assert config.llama_binary() is None
    binary.touch()
    assert config.llama_binary() == str(binary)


@pytest.fixture
def nemo_cache(tmp_path, monkeypatch):
    prefix = tmp_path / "installed"
    binary = prefix / "bin/nemo-speech"
    binary.parent.mkdir(parents=True)
    binary.touch()
    index = prefix / "share/nemo-speech/model-index.json"
    index.parent.mkdir(parents=True)
    data = {
        "schema_version": 1,
        "models": [
            {
                "aliases": ["nemotron-3.5"],
                "repo": "nvidia/nemotron-3.5-asr-streaming-0.6b",
                "revision": "installed-revision",
                "artifacts": [{"role": "asr", "type": "file", "filename": "asr.gguf", "size": 4}],
            }
        ],
    }
    index.write_text(json.dumps(data))
    cache = tmp_path / "cache"
    artifact = cache / data["models"][0]["repo"] / "installed-revision/asr.gguf"
    artifact.parent.mkdir(parents=True)
    monkeypatch.setattr(config, "nemo_binary", lambda: str(binary))
    monkeypatch.setattr(config, "ASR_DIR", cache)
    monkeypatch.delenv("NEMO_SPEECH_MODEL_INDEX", raising=False)
    return artifact, index, data


def test_asr_readiness_uses_installed_index_and_exact_artifact(nemo_cache):
    artifact, _, _ = nemo_cache
    artifact.with_name("unrelated.gguf").write_bytes(b"data")
    assert not config.asr_ready()
    artifact.write_bytes(b"bad")
    assert not config.asr_ready()
    artifact.write_bytes(b"data")
    assert config.asr_ready()


def test_asr_readiness_honors_index_override_and_fails_closed(nemo_cache, monkeypatch):
    artifact, index, data = nemo_cache
    artifact.write_bytes(b"data")
    override = index.with_name("override.json")
    monkeypatch.setenv("NEMO_SPEECH_MODEL_INDEX", str(override))
    assert not config.asr_ready()
    override.write_text("invalid")
    assert not config.asr_ready()
    data["models"][0]["revision"] = "different-revision"
    override.write_text(json.dumps(data))
    assert not config.asr_ready()


@pytest.fixture
def preparation(tmp_path, monkeypatch):
    artifact = tmp_path / config.MODEL_FILENAME
    artifact.write_bytes(b"GGUFsynthetic model")
    download = Mock(return_value=str(artifact))
    run = Mock()
    monkeypatch.setattr("huggingface_hub.hf_hub_download", download)
    monkeypatch.setattr(prepare.subprocess, "run", run)
    monkeypatch.setattr(prepare, "nemo_binary", lambda: "/installed/nemo-speech")
    monkeypatch.setattr(prepare, "llama_binary", lambda: "/installed/llama-server")
    monkeypatch.setattr(prepare, "MODEL_SHA256", hashlib.sha256(artifact.read_bytes()).hexdigest())
    monkeypatch.setattr(sys, "argv", ["prepare"])
    return artifact, download, run


def test_preparation_downloads_only_pinned_gguf_and_preserves_cache_overrides(preparation):
    _, download, run = preparation
    previous = os.environ.copy()
    prepare.main()
    assert os.environ == previous
    download.assert_called_once_with(
        config.MODEL_ID,
        filename=config.MODEL_FILENAME,
        revision=config.MODEL_REVISION,
    )
    run.assert_called_once_with(
        ["/installed/nemo-speech", "pull", config.ASR_MODEL],
        check=True,
        timeout=1800,
    )


def test_preparation_rejects_hash_mismatch_before_asr_download(preparation, monkeypatch):
    _, download, run = preparation
    monkeypatch.setattr(prepare, "MODEL_SHA256", "0" * 64)
    with pytest.raises(SystemExit, match="SHA-256"):
        prepare.main()
    download.assert_called_once()
    run.assert_not_called()


@pytest.mark.parametrize("missing", ["nemo_binary", "llama_binary"])
def test_missing_tools_cannot_trigger_download(preparation, monkeypatch, missing):
    _, download, run = preparation
    monkeypatch.setattr(prepare, missing, lambda: None)
    with pytest.raises(SystemExit, match="nemo-speech|llama-server"):
        prepare.main()
    download.assert_not_called()
    run.assert_not_called()


async def test_missing_asr_cache_cannot_launch_or_download(monkeypatch):
    launch = Mock()
    monkeypatch.setattr("backend.runtime.nemo_binary", lambda: "/installed/nemo-speech")
    monkeypatch.setattr("backend.runtime.asr_ready", lambda: False)
    monkeypatch.setattr("backend.runtime.asyncio.create_subprocess_exec", launch)
    with pytest.raises(RuntimeError, match="prepare:models"):
        await NemoRuntime().ensure()
    launch.assert_not_called()
