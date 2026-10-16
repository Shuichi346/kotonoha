"""Localize service UI messages without modifying transcription or translation text."""

# Keep bilingual entries separate so their display widths remain readable.
# fmt: off
MESSAGES = {
    "別の字幕セッションが実行中です。先に停止してください。":
        "Another subtitle session is running. Stop it first.",
    "npm run build:native を実行してください。":
        "Run npm run build:native.",
    "開始時に画面とシステム音声の許可が必要です。":
        "Screen and system audio permission is required when starting.",
    "音声キャプチャの状態を取得できません。":
        "Unable to check audio capture status.",
    "翻訳を始める前に、システム音声の許可を設定してください。":
        "Set up system audio permission before starting translation.",
    "音声の許可を確認できません。macOS のダイアログを閉じて、もう一度確認してください。":
        "Unable to check audio permission. Close the macOS dialog, then check again.",
    "音声の許可を確認中です。macOS のダイアログを確認してください。":
        "Checking audio permission. Check the macOS dialog.",
    "システム音声の許可がまだ確認できません。設定で kotonoha を許可したあと、"
    "「許可を確認」を押してください。オンでも確認できない場合は kotonoha を再起動してください。":
        "System audio permission has not been confirmed. Enable kotonoha in System Settings, "
        "then choose Check permission. If it is already enabled, restart kotonoha.",
    "NeMo CLI とモデルが必要です。npm run prepare:models を実行してください。":
        "The NeMo CLI and model are required. Run npm run prepare:models.",
    "翻訳モデルがありません。npm run prepare:models を実行してください。":
        "The translation model is missing. Run npm run prepare:models.",
    "文字起こしモデルがありません。npm run prepare:models を実行してください。":
        "The transcription model is missing. Run npm run prepare:models.",
    "JSON オブジェクトを送信してください。":
        "Send a JSON object.",
    "対応していない言語です。":
        "This language is not supported.",
    "確定要求の間隔は5、10、15、20、30秒から選択してください。":
        "Choose a commit request interval of 5, 10, 15, 20, or 30 seconds.",
    "対応していない操作です。":
        "This operation is not supported.",
    "翻訳の遅延を抑えるため、古い未処理の発話をスキップしました。":
        "Skipped older pending speech to reduce translation delay.",
    "音声キャプチャが終了しました。":
        "Audio capture ended.",
    "ローカルの翻訳・文字起こしモデルを読み込んでいます。":
        "Loading local translation and transcription models.",
    "NeMo セッションを開始できませんでした。":
        "Unable to start the NeMo session.",
    "NeMo の音声設定に失敗しました。":
        "Unable to configure NeMo audio.",
    "字幕処理が予期せず終了しました。":
        "Subtitle processing ended unexpectedly.",
    "残りの翻訳を60秒以内に完了できませんでした。":
        "Remaining translations did not finish within 60 seconds.",
    "モデルの処理が制限時間を超えました。":
        "Model processing timed out.",
    "NeMo の起動が60秒以内に完了しませんでした。":
        "NeMo did not finish starting within 60 seconds.",
    "音声キャプチャが未ビルドです。npm run build:native を実行してください。":
        "Audio capture has not been built. Run npm run build:native.",
    "発話が長すぎます。短い区切りの音声で再開してください。":
        "The utterance is too long. Resume with shorter speech segments.",
    "翻訳結果が長すぎます。短い区切りの音声で再開してください。":
        "The translation is too long. Resume with shorter speech segments.",
}
# fmt: on


def ui_language(value: object) -> str:
    """Unrecognized preferences preserve the Japanese default."""
    return "en" if value == "en" else "ja"


def header_language(value: str | None) -> str:
    """Honor supported Accept-Language preferences, including regional variants."""
    candidates = []
    for item in (value or "").split(","):
        language, *parameters = item.strip().lower().split(";")
        quality = 1.0
        for parameter in parameters:
            if parameter.strip().startswith("q="):
                try:
                    quality = float(parameter.strip()[2:])
                except ValueError:
                    quality = 0.0
        language = language.split("-")[0]
        if language in {"ja", "en"} and 0 < quality <= 1:
            candidates.append((quality, language))
    return max(candidates, key=lambda candidate: candidate[0])[1] if candidates else "ja"


def localize(message: str, language: str, *, error: bool = False) -> str:
    if message in MESSAGES:
        return MESSAGES[message] if language == "en" else message
    prefix = "NeMo を起動できません: "
    if message.startswith(prefix):
        return ("Unable to start NeMo: " if language == "en" else prefix) + message[len(prefix) :]
    if error:
        # Keep useful external diagnostics intact, with context in the selected UI language.
        return ("Processing failed: " if language == "en" else "処理に失敗しました: ") + message
    return message


def localize_event(event: dict, language: str) -> dict:
    if event.get("type") in {"status", "error"} and isinstance(event.get("message"), str):
        return {
            **event,
            "message": localize(event["message"], language, error=event["type"] == "error"),
        }
    return event
