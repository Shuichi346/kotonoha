"""Shared cache discovery stays offline and rejects incomplete or unrelated models."""

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
            root / "models--mlx-community--Hy-MT2-1.8B-4bit/snapshots" / config.MODEL_REVISION
        )


def test_translation_readiness_requires_tokenizer_and_all_weight_shards(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MODEL_DIR", tmp_path)
    assert not config.translation_ready()
    for name in ["config.json", "tokenizer_config.json", "tokenizer.json"]:
        (tmp_path / name).write_text("{}")
    (tmp_path / "model-1.safetensors").write_bytes(b"weights")
    assert config.translation_ready()
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"a": "model-1.safetensors", "b": "model-2.safetensors"}})
    )
    assert not config.translation_ready()
    (tmp_path / "model-2.safetensors").write_bytes(b"weights")
    assert config.translation_ready()
    (tmp_path / "model-2.safetensors").write_bytes(b"")
    assert not config.translation_ready()
    (tmp_path / "model.safetensors.index.json").write_text("invalid")
    assert not config.translation_ready()


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


def test_preparation_uses_shared_caches_without_workspace_overrides(monkeypatch):
    download, run = Mock(), Mock()
    monkeypatch.setattr("huggingface_hub.snapshot_download", download)
    monkeypatch.setattr(prepare.subprocess, "run", run)
    monkeypatch.setattr(prepare, "nemo_binary", lambda: "/installed/nemo-speech")
    monkeypatch.setattr(sys, "argv", ["prepare"])
    previous = os.environ.copy()
    prepare.main()
    assert os.environ == previous
    assert download.call_args.args == (config.MODEL_ID,)
    assert download.call_args.kwargs["revision"] == config.MODEL_REVISION
    assert "local_dir" not in download.call_args.kwargs
    assert "cache_dir" not in download.call_args.kwargs
    assert run.call_args.args == (["/installed/nemo-speech", "pull", config.ASR_MODEL],)
    assert "env" not in run.call_args.kwargs


async def test_missing_asr_cache_cannot_launch_or_download(monkeypatch):
    launch = Mock()
    monkeypatch.setattr("backend.runtime.nemo_binary", lambda: "/installed/nemo-speech")
    monkeypatch.setattr("backend.runtime.asr_ready", lambda: False)
    monkeypatch.setattr("backend.runtime.asyncio.create_subprocess_exec", launch)
    with pytest.raises(RuntimeError, match="prepare:models"):
        await NemoRuntime().ensure()
    launch.assert_not_called()
