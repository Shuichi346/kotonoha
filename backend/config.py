"""Workspace paths shared by preparation and runtime."""

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "mlx-community/translategemma-4b-it-4bit"
MODEL_DIR = ROOT / "models" / "translation"
ASR_DIR = ROOT / "models" / "asr"
CAPTURE = ROOT / "native" / "bin" / "audio-capture"
ASR_PORT = 8766


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
    return (MODEL_DIR / "config.json").is_file() and any(MODEL_DIR.glob("*.safetensors"))


def asr_ready() -> bool:
    return ASR_DIR.is_dir() and any(ASR_DIR.rglob("*.gguf"))
