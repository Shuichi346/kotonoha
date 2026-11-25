"""Local runtime paths and offline readiness for shared model caches."""

import json
import os
import shutil
from pathlib import Path

from huggingface_hub.constants import HF_HUB_CACHE

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "mradermacher/plamo-3-translate-0.8b-GGUF"
MODEL_REVISION = "3a3ba78e02c862bc3b136a30625d7157666c827f"
MODEL_FILENAME = "plamo-3-translate-0.8b.Q8_0.gguf"
MODEL_SIZE = 948896256
MODEL_SHA256 = "49b3e9b986c01f9b5feff9d482476fe46b2cebea8369ed8614303a1021ad6f88"
MODEL_DIR = (
    Path(HF_HUB_CACHE) / f"models--{MODEL_ID.replace('/', '--')}" / "snapshots" / MODEL_REVISION
)
MODEL_PATH = MODEL_DIR / MODEL_FILENAME
ASR_MODEL = "nemotron-3.5"
ASR_DIR = Path(
    os.environ.get("NEMO_SPEECH_MODEL_DIR", Path.home() / "Library/Caches/NeMoSpeech/models")
)
CAPTURE = ROOT / "native" / "bin" / "audio-capture"


def nemo_binary() -> str | None:
    configured = os.environ.get("NEMO_SPEECH_BIN")
    if configured:
        return configured if Path(configured).is_file() else None
    return shutil.which("nemo-speech") or (
        str(Path.home() / ".local/bin/nemo-speech")
        if (Path.home() / ".local/bin/nemo-speech").is_file()
        else None
    )


def translation_ready() -> bool:
    try:
        with MODEL_PATH.open("rb") as model:
            return (
                MODEL_PATH.stat().st_size == MODEL_SIZE
                and model.read(4) == b"GGUF"
                and llama_binary() is not None
            )
    except OSError:
        return False


def llama_binary() -> str | None:
    configured = os.environ.get("KOTONOHA_LLAMA_SERVER")
    if configured:
        return configured if Path(configured).is_file() else None
    return shutil.which("llama-server") or (
        "/opt/homebrew/bin/llama-server"
        if Path("/opt/homebrew/bin/llama-server").is_file()
        else None
    )


def asr_ready() -> bool:
    binary = nemo_binary()
    if not binary:
        return False
    # Use the installed CLI's index so an unrelated GGUF or old revision cannot satisfy readiness.
    index = Path(
        os.environ.get(
            "NEMO_SPEECH_MODEL_INDEX",
            Path(binary).resolve().parent.parent / "share/nemo-speech/model-index.json",
        )
    )
    try:
        data = json.loads(index.read_text())
        if data["schema_version"] != 1:
            return False
        for model in data["models"]:
            if ASR_MODEL not in model.get("aliases", []):
                continue
            artifacts = [item for item in model["artifacts"] if item["role"] == "asr"]
            return bool(artifacts) and all(
                item["type"] == "file"
                and (ASR_DIR / model["repo"] / model["revision"] / item["filename"]).stat().st_size
                == item["size"]
                for item in artifacts
            )
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
    return False
