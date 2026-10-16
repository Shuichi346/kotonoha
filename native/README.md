# macOS system audio helper

`./native/build.sh --verify` builds the Apple silicon helper for macOS 26+, creates an ad-hoc signed `LiveCaptionAudio.app`, and checks the binary architecture, resampler, and current permission without capturing audio. Xcode command-line tools and the macOS SDK are required. Compilation has a 120-second limit; each verification invocation has a 15-second limit.

The Python backend executes `native/bin/audio-capture`. This wrapper immediately replaces itself with `native/bin/LiveCaptionAudio.app/Contents/MacOS/audio-capture`, preserving stdin/stdout/stderr and the PID. The app bundle and embedded Info.plist provide the name `LiveCaption Audio` and bundle identifier `jp.realtime-translation.audio-capture`. Distribution requires a proper Developer ID signing identity; development rebuilds can require macOS permission approval again.

## Process protocol

- No arguments: request Screen & System Audio Recording permission when necessary, then emit continuous raw signed 16-bit little-endian mono PCM at 16,000 samples/second on stdout. There is no WAV header and no framing; the backend must accumulate even-byte samples and frame them for ASR.
- `--check`: return one JSON object on stdout, for example `{"available":false,"permission":"required","sample_rate":16000,"channels":1,"format":"pcm_s16le"}`. This preflight never prompts and exits successfully even when permission is missing. The backend must inspect `available`.
- `--self-test`: synthesize a 48 kHz stereo tone, run the same stateful conversion used by capture, and verify PCM duration, downmix amplitude, frequency, and little-endian decoding. Diagnostics go to stderr; stdout stays empty.
- SIGINT or SIGTERM: stop ScreenCaptureKit, flush the converter, and exit. Keep draining stdout while awaiting shutdown. Closing the output pipe is treated as an audio delivery failure.
- Exit status: `0` for normal shutdown or successful verification; `77` for missing permission; `64` for invalid arguments; `1` for startup/other errors; `2` for stream failure; `3` for conversion/output failure.

All diagnostics are written to stderr. Do not merge stderr into the PCM pipe. ScreenCaptureKit samples system output at 48 kHz stereo; AVAudioConverter owns state across callbacks and emits 16 kHz PCM16 mono. A small resampling tail may be emitted during shutdown.

The helper excludes its own process audio and disables microphone capture. ScreenCaptureKit uses the first available display as its content filter, with a minimal 2 × 2 screen configuration; only the audio stream output is registered. Video is never delivered to the application or recorded. No virtual audio driver or microphone access is needed.

## Permission and validation limits

Initial system-audio capture is an explicit user operation. macOS may ask for permission and may require restarting capture after permission changes in System Settings → Privacy & Security → Screen & System Audio Recording. A terminal or parent application can also appear in macOS privacy attribution during development.

Compilation, arm64 inspection, DSP self-test, and permission preflight are automated checks. Actual system-audio delivery, OS permission prompts, and shutdown during live capture require an authorized interactive session and are not exercised by `--verify`. The helper needs a logged-in graphical macOS session and an available display. It cannot capture protected media when macOS or the playback application restricts it.

API references: [ScreenCaptureKit capture](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos), [capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio), and the installed Xcode SDK headers for `SCStream`, `CMSampleBufferCopyPCMDataIntoAudioBufferList`, and `AVAudioConverter`.
