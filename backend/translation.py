"""Run the pinned GGUF on one persistent, privately authenticated llama.cpp worker."""

import asyncio
import re
import secrets
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from backend.config import MODEL_PATH, llama_binary, translation_ready

# Restrict the existing app languages to the model's documented language coverage.
LANGUAGE_CODES = {
    code: code
    for code in (
        "en",
        "ja",
        "de",
        "es",
        "fr",
        "it",
        "ko",
        "ru",
        "ar",
        "hi",
        "nl",
        "vi",
        "pl",
        "bg",
        "hr",
        "sk",
        "hu",
        "et",
        "th",
        "id",
    )
}
LANGUAGE_CODES["zh"] = "zh-hans"
MAX_OUTPUT_TOKENS = 512
STOP_TOKENS = ["<|plamo:tag|>", "<|plamo:bos|>"]


def translation_prompt(text: str, source: str, target: str) -> str:
    if source not in LANGUAGE_CODES or target not in LANGUAGE_CODES:
        raise ValueError("対応していない言語です。")
    if "<|plamo:" in text:
        raise ValueError("対応していない入力形式です。")
    # llama.cpp inserts BOS. PFML3 goes directly to completions, with no chat wrapper.
    return (
        "<|plamo:tag|>dataset<|plamo:msg|>translation"
        f"<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>{LANGUAGE_CODES[source]}"
        f"<|plamo:msg|>{text}"
        f"<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>{LANGUAGE_CODES[target]}"
        "<|plamo:msg|>"
    )


class Translator:
    def __init__(self):
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gguf-translation")
        self._process = None
        self._client = None
        self._directory = None

    async def load(self):
        await asyncio.get_running_loop().run_in_executor(self._pool, self._load)

    def _load(self):
        if self._process is not None and self._process.poll() is None:
            return
        self._release()
        binary = llama_binary()
        if not binary:
            raise RuntimeError(
                "llama-server がありません。llama.cpp 1.0.0 以降を導入してください。"
            )
        if not translation_ready():
            raise RuntimeError(
                "翻訳モデルがありません。npm run prepare:models を実行してください。"
            )
        version = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, check=True, timeout=10
        )
        match = re.search(r"version:\s*(\d+)\.(\d+)\.(\d+)", version.stdout + version.stderr)
        if not match or tuple(map(int, match.groups())) < (1, 0, 0):
            raise RuntimeError("llama.cpp 1.0.0 以降が必要です。")
        # Use a short, private UDS path: no TCP listener, port conflicts or public Web UI.
        self._directory = tempfile.TemporaryDirectory(prefix="kotonoha-", dir="/tmp")
        socket = str(Path(self._directory.name) / "translation.sock")
        key = secrets.token_urlsafe(32)
        self._client = httpx.Client(
            transport=httpx.HTTPTransport(uds=socket),
            base_url="http://localhost",
            headers={"Authorization": f"Bearer {key}"},
            timeout=60,
            trust_env=False,
        )
        try:
            # Inherit the owned Python process group so Electron also reaps this child on quit.
            self._process = subprocess.Popen(
                [
                    binary,
                    "--model",
                    str(MODEL_PATH),
                    "--host",
                    socket,
                    "--api-key",
                    key,
                    "--ctx-size",
                    "4096",
                    "--parallel",
                    "1",
                    "--gpu-layers",
                    "all",
                    "--no-webui",
                    "--log-disable",
                    # Bypass server chat-parser discovery: PFML3 needs target_lang, while
                    # this app exclusively uses raw /completion and never this fallback.
                    "--no-jinja",
                    "--chat-template",
                    "chatml",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if self._process.poll() is not None:
                    raise RuntimeError("翻訳エンジンを起動できませんでした。")
                try:
                    response = self._client.get("/health", timeout=1)
                    if response.status_code == 200:
                        self._client.get("/v1/models", timeout=1).raise_for_status()
                        return
                except httpx.TransportError:
                    pass
                time.sleep(0.1)
            raise RuntimeError("翻訳エンジンの起動が60秒以内に完了しませんでした。")
        except BaseException:
            self._release()
            raise

    async def translate(self, text: str, source: str, target: str) -> str:
        return await asyncio.get_running_loop().run_in_executor(
            self._pool, self._translate, text, source, target
        )

    def _translate(self, text: str, source: str, target: str) -> str:
        prompt = translation_prompt(text, source, target)
        if source == target:
            return text
        self._load()
        try:
            # Count with the runtime tokenizer, parsing PFML3 and inserting BOS exactly once.
            tokens = self._client.post(
                "/tokenize", json={"content": prompt, "add_special": True, "parse_special": True}
            )
            tokens.raise_for_status()
            tokens = tokens.json()["tokens"]
            if len(tokens) > 1700:
                raise ValueError("発話が長すぎます。短い区切りの音声で再開してください。")
            response = self._client.post(
                "/completion",
                json={
                    "prompt": tokens,
                    "n_predict": MAX_OUTPUT_TOKENS,
                    "temperature": 0,
                    "repeat_penalty": 1.0,
                    "stop": STOP_TOKENS,
                    "stream": False,
                    "cache_prompt": True,
                },
            )
            response.raise_for_status()
            result = response.json()
            if result.get("stop_type") == "limit" or result.get("truncated"):
                raise ValueError("翻訳結果が長すぎます。短い区切りの音声で再開してください。")
            if result.get("stop_type") not in {"eos", "word"}:
                raise RuntimeError("翻訳を完了できませんでした。")
            text = result["content"].strip()
            if not text or "<|plamo:" in text:
                raise RuntimeError("翻訳を完了できませんでした。")
            return text
        except httpx.TimeoutException as error:
            raise RuntimeError("モデルの処理が制限時間を超えました。") from error
        except (httpx.HTTPError, KeyError, TypeError, AttributeError) as error:
            raise RuntimeError("翻訳を完了できませんでした。") from error

    def _release(self):
        if self._process is not None:
            if self._process.poll() is None:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=5)
            self._process = None
        if self._client is not None:
            self._client.close()
            self._client = None
        if self._directory is not None:
            self._directory.cleanup()
            self._directory = None

    def close(self):
        self._pool.shutdown(wait=True, cancel_futures=True)
        self._release()
