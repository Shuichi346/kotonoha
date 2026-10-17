"""Local runtime paths and offline readiness for shared model caches."""

import json
import os
import shutil
from pathlib import Path

from huggingface_hub.constants import HF_HUB_CACHE

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "mlx-community/Hy-MT2-1.8B-4bit"
MODEL_REVISION = "e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912"
MODEL_DIR = (
    Path(HF_HUB_CACHE) / f"models--{MODEL_ID.replace('/', '--')}" / "snapshots" / MODEL_REVISION
)
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
        if not all(
            (MODEL_DIR / name).is_file()
            for name in ("config.json", "tokenizer_config.json", "tokenizer.json")
        ):
            return False
        index = MODEL_DIR / "model.safetensors.index.json"
        if index.is_file():
            weights = set(json.loads(index.read_text())["weight_map"].values())
        else:
            weights = {file.name for file in MODEL_DIR.glob("*.safetensors")}
        return bool(weights) and all((MODEL_DIR / name).stat().st_size > 0 for name in weights)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


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
