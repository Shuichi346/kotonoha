"""Keep MLX model operations on a single persistent worker thread."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from backend.config import MODEL_DIR, translation_ready


def translation_messages(text: str, source: str, target: str) -> list[dict]:
    # TranslateGemma requires one structured content entry, not a generic chat prompt.
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "source_lang_code": source,
                    "target_lang_code": target,
                    "text": text,
                }
            ],
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
        # The community conversion omits this turn terminator from its generation metadata.
        self._tokenizer.add_eos_token("<end_of_turn>")

    async def translate(self, text: str, source: str, target: str) -> str:
        return await asyncio.get_running_loop().run_in_executor(
            self._pool, self._translate, text, source, target
        )

    def _translate(self, text: str, source: str, target: str) -> str:
        self._load()
        if source == target:
            return text
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler

        prompt = self._tokenizer.apply_chat_template(
            translation_messages(text, source, target), tokenize=False, add_generation_prompt=True
        )
        # The input context is 2K tokens; segment long utterances instead of silently truncating.
        if len(self._tokenizer.encode(prompt)) > 1700:
            raise ValueError("発話が長すぎます。短い区切りの音声で再開してください。")
        return generate(
            self._model,
            self._tokenizer,
            prompt=prompt,
            max_tokens=256,
            sampler=make_sampler(temp=0.0),
            verbose=False,
        ).strip()

    def close(self):
        self._pool.shutdown(wait=True, cancel_futures=True)
