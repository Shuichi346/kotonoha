"""Download the two requested models to this workspace (never during capture)."""

import argparse
import os
import subprocess

from backend.config import ASR_DIR, MODEL_DIR, MODEL_ID, MODEL_REVISION, nemo_binary


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
    os.environ.setdefault("HF_HOME", str(MODEL_DIR.parent / ".huggingface"))
    from huggingface_hub import snapshot_download

    print(f"Downloading {MODEL_ID} → {MODEL_DIR}", flush=True)
    # Exclude training/source artifacts; all model and tokenizer files remain available offline.
    snapshot_download(
        MODEL_ID,
        revision=MODEL_REVISION,
        local_dir=str(MODEL_DIR),
        allow_patterns=["*.json", "*.jinja", "*.model", "*.safetensors", "README.md"],
    )
    print(f"Downloading Nemotron 3.5 → {ASR_DIR}", flush=True)
    subprocess.run(
        [binary, "pull", "nemotron-3.5"],
        env={**os.environ, "NEMO_SPEECH_MODEL_DIR": str(ASR_DIR)},
        check=True,
        timeout=1800,
    )
    print("Models ready. Start the desktop app with npm start.", flush=True)


if __name__ == "__main__":
    main()
