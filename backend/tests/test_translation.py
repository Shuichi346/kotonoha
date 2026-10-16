"""Verify the Hy-MT2 adapter without loading MLX or capturing audio."""

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.app import TARGETS
from backend.config import MODEL_DIR, MODEL_ID, MODEL_REVISION
from backend.messages import localize
from backend.translation import LANGUAGE_NAMES, Translator, translation_messages


@pytest.mark.parametrize(
    ("target", "name"),
    [
        ("en", "English"),
        ("ja", "Japanese"),
        ("zh", "Chinese"),
        ("ko", "Korean"),
        ("de", "German"),
        ("fr", "French"),
        ("es", "Spanish"),
        ("it", "Italian"),
        ("pt", "Portuguese"),
    ],
)
def test_prompt_uses_full_target_name_and_keeps_source_text(target, name):
    text = "原文\nDo not alter this text."
    messages = translation_messages(text, "ja", target)
    assert len(messages) == 1 and messages[0]["role"] == "user"
    assert f"into {name}." in messages[0]["content"]
    assert messages[0]["content"].endswith("\n\n" + text)


def test_model_selection_and_language_contract():
    assert MODEL_ID == "mlx-community/Hy-MT2-1.8B-4bit"
    assert MODEL_DIR.name == MODEL_REVISION
    assert MODEL_DIR.parent.name == "snapshots"
    assert MODEL_DIR.parent.parent.name == "models--mlx-community--Hy-MT2-1.8B-4bit"
    assert MODEL_REVISION == "e5c6fe56c7b3bc77fae5ae92db31f2178f1e6912"
    assert TARGETS <= LANGUAGE_NAMES.keys()
    with pytest.raises(ValueError, match="対応していない"):
        translation_messages("Hello", "en", "unknown")


@pytest.fixture
def adapter(monkeypatch):
    tokenizer = Mock()
    tokenizer.apply_chat_template.return_value = "rendered prompt"
    tokenizer.encode.return_value = [120000, 4, 5]
    model = object()
    load = Mock(return_value=(model, tokenizer))
    generate = Mock(
        return_value=iter(
            [
                SimpleNamespace(text=" 日本", finish_reason=None),
                SimpleNamespace(text="語 ", finish_reason="stop"),
            ]
        )
    )
    sampler, processors = Mock(return_value=object()), Mock(return_value=[])
    monkeypatch.setitem(sys.modules, "mlx_lm", SimpleNamespace(load=load, stream_generate=generate))
    monkeypatch.setitem(
        sys.modules,
        "mlx_lm.sample_utils",
        SimpleNamespace(
            make_sampler=sampler,
            make_logits_processors=processors,
        ),
    )
    monkeypatch.setattr("backend.translation.translation_ready", lambda: True)
    translator = Translator()
    yield translator, tokenizer, load, generate, sampler, processors
    translator.close()


def test_adapter_uses_native_template_eos_and_subtitle_generation_settings(adapter):
    translator, tokenizer, load, generate, sampler, processors = adapter
    assert translator._translate("Hello", "en", "ja") == "日本語"
    tokenizer.apply_chat_template.assert_called_once_with(
        translation_messages("Hello", "en", "ja"), tokenize=False, add_generation_prompt=True
    )
    tokenizer.encode.assert_called_once_with("rendered prompt", add_special_tokens=False)
    tokenizer.add_eos_token.assert_not_called()
    sampler.assert_called_once_with(temp=0.7, top_p=0.6, top_k=20)
    processors.assert_called_once_with(repetition_penalty=1.05)
    assert generate.call_args.kwargs["max_tokens"] == 512
    assert generate.call_args.kwargs["prompt"] == [120000, 4, 5]
    assert translator._translate("Unchanged", "en", "en") == "Unchanged"
    load.assert_called_once_with(str(MODEL_DIR))
    generate.assert_called_once()


def test_adapter_rejects_partial_output_at_token_limit(adapter):
    translator, _, _, generate, _, _ = adapter
    generate.return_value = iter([SimpleNamespace(text="incomplete", finish_reason="length")])
    with pytest.raises(ValueError, match="翻訳結果が長すぎ") as error:
        translator._translate("Hello", "en", "ja")
    assert localize(str(error.value), "en") == (
        "The translation is too long. Resume with shorter speech segments."
    )


def test_adapter_rejects_excessive_input_before_generation(adapter):
    translator, tokenizer, _, generate, _, _ = adapter
    tokenizer.encode.return_value = list(range(1701))
    with pytest.raises(ValueError, match="発話が長すぎ"):
        translator._translate("long input", "en", "ja")
    generate.assert_not_called()
