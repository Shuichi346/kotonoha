"""Workspace paths shared by preparation and runtime."""

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "mlx-community/Hy-MT2-1.8B-4bit"
MODEL_REVISION = "e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912"
MODEL_DIR = ROOT / "models" / "hy-mt2-1.8b-4bit"
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
