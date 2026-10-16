"""Keep MLX model operations on a single persistent worker thread."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from backend.config import MODEL_DIR, translation_ready

LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ko": "Korean",
    "ru": "Russian",
    "ar": "Arabic",
    "hi": "Hindi",
    "nl": "Dutch",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "uk": "Ukrainian",
    "pl": "Polish",
    "sv": "Swedish",
    "cs": "Czech",
    "nb": "Norwegian",
    "da": "Danish",
    "bg": "Bulgarian",
    "fi": "Finnish",
    "hr": "Croatian",
    "sk": "Slovak",
    "hu": "Hungarian",
    "ro": "Romanian",
    "et": "Estonian",
    "th": "Thai",
    "id": "Indonesian",
}
MAX_OUTPUT_TOKENS = 512


def translation_messages(text: str, source: str, target: str) -> list[dict]:
    target_name = LANGUAGE_NAMES.get(target)
    if target_name is None:
        raise ValueError("対応していない言語です。")
    # Hy-MT2 detects the source language and expects full target-language names.
    return [
        {
            "role": "user",
            "content": (
                f"Translate the following text into {target_name}. Note that you should only "
                f"output the translated result without any additional explanation:\n\n{text}"
            ),
        }
    ]


class Translator:
    def __init__(self):
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-translation")
        self._model = None
        self._tokenizer = None

    async def load(self):
        await asyncio.get_running_loop().run_in_executor(self._pool, self._load)

    def _load(self):
        if self._model is not None:
            return
        if not translation_ready():
            raise RuntimeError(
                "翻訳モデルがありません。npm run prepare:models を実行してください。"
            )
        from mlx_lm import load

        self._model, self._tokenizer = load(str(MODEL_DIR))

    async def translate(self, text: str, source: str, target: str) -> str:
        return await asyncio.get_running_loop().run_in_executor(
            self._pool, self._translate, text, source, target
        )

    def _translate(self, text: str, source: str, target: str) -> str:
        self._load()
        if source == target:
            return text
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_logits_processors, make_sampler

        prompt = self._tokenizer.apply_chat_template(
            translation_messages(text, source, target), tokenize=False, add_generation_prompt=True
        )
        prompt = self._tokenizer.encode(prompt, add_special_tokens=False)
        # Bound per-utterance work to keep caption latency predictable.
        if len(prompt) > 1700:
            raise ValueError("発話が長すぎます。短い区切りの音声で再開してください。")
        chunks = []
        for response in stream_generate(
            self._model,
            self._tokenizer,
            prompt=prompt,
            max_tokens=MAX_OUTPUT_TOKENS,
            sampler=make_sampler(temp=0.7, top_p=0.6, top_k=20),
            logits_processors=make_logits_processors(repetition_penalty=1.05),
        ):
            chunks.append(response.text)
            if response.finish_reason == "length":
                raise ValueError("翻訳結果が長すぎます。短い区切りの音声で再開してください。")
        return "".join(chunks).strip()

    def close(self):
        self._pool.shutdown(wait=True, cancel_futures=True)
