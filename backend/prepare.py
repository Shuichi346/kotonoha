"""Prepare shared model caches explicitly, never during capture."""

import argparse
import hashlib
import subprocess
from pathlib import Path

from backend.config import (
    ASR_DIR,
    ASR_MODEL,
    MODEL_FILENAME,
    MODEL_ID,
    MODEL_PATH,
    MODEL_REVISION,
    MODEL_SHA256,
    llama_binary,
    nemo_binary,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Download models (the default).")
    args = parser.parse_args()
    del args
    binary = nemo_binary()
    if not binary:
        raise SystemExit(
            "nemo-speech が見つかりません。NeMo-Speech.cpp の arm64 CLI を導入してください。"
        )
    if not llama_binary():
        raise SystemExit("llama-server がありません。llama.cpp 1.0.0 以降を導入してください。")
    from huggingface_hub import hf_hub_download

    print(f"Downloading {MODEL_ID} → {MODEL_PATH}", flush=True)
    downloaded = hf_hub_download(
        MODEL_ID,
        filename=MODEL_FILENAME,
        revision=MODEL_REVISION,
    )
    with Path(downloaded).open("rb") as model:
        if hashlib.file_digest(model, "sha256").hexdigest() != MODEL_SHA256:
            raise SystemExit("翻訳モデルの SHA-256 が一致しません。")
    print(f"Downloading Nemotron 3.5 → {ASR_DIR}", flush=True)
    subprocess.run(
        [binary, "pull", ASR_MODEL],
        check=True,
        timeout=1800,
    )
    print("Models ready. Start the desktop app with npm start.", flush=True)


if __name__ == "__main__":
    main()
