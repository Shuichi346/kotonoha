"""Verify that real NeMo emits a final on silence before any client commit."""

import argparse
import asyncio
import json
import time
import wave
from pathlib import Path

from backend.runtime import NemoRuntime, receive_event


async def check(path: Path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, 16000, 2):
            raise ValueError("Fixture must be mono 16 kHz PCM16 WAV")
        pcm = audio.readframes(audio.getnframes()) + bytes(32000)
    runtime = NemoRuntime()
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
                            "language": "en",
                            "endpointing_ms": 600,
                        },
                    }
                )
            )
            await receive_event(socket)

            async def first_final():
                while True:
                    event = await receive_event(socket)
                    if event["type"].endswith(".completed") and event.get("transcript", "").strip():
                        return event

            receiver = asyncio.create_task(first_final())
            try:
                for offset in range(0, len(pcm), 3200):
                    await socket.send(pcm[offset : offset + 3200])
                event = await asyncio.wait_for(receiver, timeout=20)
                # This check never sends input_audio_buffer.commit or invokes capture/translation.
                print(
                    json.dumps(
                        {
                            "endpointing": "passed",
                            "final_before_commit": True,
                            "transcript": event["transcript"],
                            "audio_processed": event.get("audio_processed"),
                            "elapsed_seconds": round(time.monotonic() - started, 2),
                        }
                    )
                )
            finally:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
    finally:
        await runtime.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    args = parser.parse_args()
    asyncio.run(asyncio.wait_for(check(args.wav), timeout=60))


if __name__ == "__main__":
    main()
