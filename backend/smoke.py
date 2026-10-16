"""Exercise both real local models against a PCM WAV without starting system capture."""

import argparse
import asyncio
import json
import time
import wave
from pathlib import Path

from backend.runtime import NemoRuntime, receive_event
from backend.translation import Translator


async def check(path: Path, source: str, target: str):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, 16000, 2):
            raise ValueError("Fixture must be mono 16 kHz PCM16 WAV")
        pcm = audio.readframes(audio.getnframes())
    runtime, translator = NemoRuntime(), Translator()
    started = time.monotonic()
    try:
        await runtime.ensure()
        async with runtime.connection() as socket:
            await receive_event(socket)
            await socket.send(
                json.dumps(
                    {
                        "type": "session.update",
                        "session": {
                            "sample_rate": 16000,
                            "language": source,
                            "word_timestamps": True,
                        },
                    }
                )
            )
            await receive_event(socket)
            for offset in range(0, len(pcm), 3200):
                await socket.send(pcm[offset : offset + 3200])
            await socket.send(json.dumps({"type": "input_audio_buffer.commit"}))
            texts = []
            partials = 0
            first_final_audio_seconds = None
            while True:
                event = await receive_event(socket)
                if event["type"].endswith(".completed"):
                    texts.append(event.get("transcript", ""))
                    if first_final_audio_seconds is None:
                        first_final_audio_seconds = event.get("audio_processed")
                elif event["type"].endswith(".delta"):
                    partials += 1
                elif event["type"] == "input_audio_buffer.committed":
                    break
        text = " ".join(texts).strip()
        if not text:
            raise RuntimeError("Real ASR produced no transcript")
        await translator.load()
        translated = await translator.translate(text, source, target)
        if "<｜hy_" in translated or "<end_of_turn>" in translated:
            raise RuntimeError("Translation leaked a model turn terminator")
        if not translated:
            raise RuntimeError("Real translation produced no text")
        print(
            json.dumps(
                {
                    "source": text,
                    "translation": translated,
                    "partials": partials,
                    "finals": len(texts),
                    "first_final_audio_seconds": first_final_audio_seconds,
                    "elapsed_seconds": round(time.monotonic() - started, 2),
                },
                ensure_ascii=False,
            )
        )
    finally:
        await runtime.close()
        translator.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--source", default="en")
    parser.add_argument("--target", default="ja")
    args = parser.parse_args()
    asyncio.run(asyncio.wait_for(check(args.wav, args.source, args.target), timeout=120))


if __name__ == "__main__":
    main()
