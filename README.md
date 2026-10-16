# kotoba — Real-time translation subtitles for Mac

Watch a video in your usual player and keep translated captions in a separate, transparent window. Captions stay above other applications, can be dragged or resized, and can pass clicks through to the video. The control window can be hidden while captions remain visible.

The app captures **Mac system output**, including YouTube in a browser. It uses the requested Nemotron 3.5 model through NeMo-Speech.cpp for streaming transcription, then TranslateGemma 4B through MLX for translation. Inference runs locally after model download. No microphone or virtual audio driver is required.

## Open the app on this Mac

The built app is `release/kotoba-darwin-arm64/kotoba.app`. Open it in Finder, choose the audio and subtitle languages, and click **翻訳を開始**. On first use, macOS may request Screen & System Audio Recording permission for **LiveCaption Audio** or the parent app. Allow the request in System Settings → Privacy & Security → Screen & System Audio Recording, then restart translation if required. Models load before audio capture starts.

Start playing the video. Captions appear in the independent subtitle window after speech is recognized and translated. Use **字幕だけにする** to hide the controls. The video continues in its own application.

| Action | Operation |
|---|---|
| Move captions | Drag inside the subtitle window; controls appear on hover |
| Resize captions | Resize the subtitle window at its edge |
| Show controls again | **⌘⇧K**, or the **字** menu-bar item |
| Pass clicks through to video / unlock | **⌘⇧L** |
| Adjust text | Change font size, original-text display, background opacity, and expiry in the controls |
| Stop translation | **翻訳を停止**, or the menu-bar **翻訳を停止** command |
| Quit completely | **⌘Q** or menu-bar **kotobaを終了** |

Closing the controls hides them. Quit the app to stop all owned audio/model processes. Errors reopen the controls. Caption history keeps the latest 1,000 entries in memory until the app quits; export TXT or SRT before quitting if needed. SRT timing is an approximate transcript timeline, not synchronization with a video file.

**This is a local development app.** Its packaged interface uses the Python environment, models, and native helper in this repository. Keep this folder in place. It is not a standalone signed/notarized installer for another Mac. Moving the repository requires rebuilding the app.

## Development setup

Requires Apple silicon, macOS **26+**, Node.js **26.5+**, npm **12.0.1+**, Python **3.13** managed by `uv`, Xcode command-line tools, and an arm64 `nemo-speech` CLI. The development machine already has NeMo-Speech.cpp 0.2.0. If setting up another machine, follow the [official NeMo installation instructions](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/installation.md). `NEMO_SPEECH_BIN` can specify its executable path.

```sh
npm ci
npm run setup:electron
uv sync --locked
npm run build:native
npm run prepare:models
npm start
```

The models occupy about 2.8 GiB in ignored `models/`; they are already downloaded on this Mac. Model preparation contacts Hugging Face and NVIDIA's configured model source. Once prepared, application inference uses local files. The translation model's own [Gemma terms](https://huggingface.co/mlx-community/translategemma-4b-it-4bit) and the ASR model's [terms](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) apply.

Create the local `.app` again with `npm run package`. Packaging targets **darwin arm64 only**. `npm run dev:web` previews the controls; live audio and the overlay require Electron and do not work in a normal browser.

## Implementation

- `frontend/`: React + TypeScript + Vite controls and subtitle-only view. A transparent canvas, outlined white text, hover-only controls, and no persistent chrome make the overlay look like subtitles.
- `desktop/`: Electron owns two independent windows, a menu-bar controller, shortcuts, IPC, and the Python process group. The renderer has no Node access; the main process validates IPC senders and owns local credentials.
- `backend/`: Python 3.13 + FastAPI, NeMo streaming WebSocket, and a persistent MLX worker. Models remain warm between sessions. The backend listens on authenticated loopback port **8765**, and owns NeMo on **8766**. Neither listener is exposed to the network.
- `native/`: Swift ScreenCaptureKit helper produces 16 kHz mono PCM16. Video samples are never delivered or stored.

English, Japanese, German, French, Spanish, Italian, Portuguese, Chinese, and Korean are exposed in the controls. Quality varies by audio, accent, language, and content. Captions appear after speech boundaries; translation is not instantaneous. Continuous speech is committed every 15 seconds. A bounded translation queue skips old waiting utterances with a status message if inference falls behind.

## Automated verification

```sh
npm run build
npm test
uv run --locked python -m pytest -q
uv run --locked ruff check backend
uv run --locked ruff format --check backend
./native/build.sh --verify
npm run check:architecture
node scripts/smoke-desktop.mjs
```

Commands should be run with finite limits. Frontend build tasks have 30-second limits per stage; UI tests have a 90-second suite limit; the desktop launch check has a 45-second limit and does **not** start recording. The native build has a 120-second limit and its verification commands have 15-second limits. The architecture check requires a packaged app and prepared Python environment. GPU inference, browser process startup, and the desktop launch check may require execution outside a restrictive sandbox.

On 2026-10-16, the frontend build, four UI tests, eight backend tests, Ruff checks, native resampling/self-test, architecture inspection, and the packaged desktop smoke passed. The desktop smoke verified two windows, authenticated backend status, prepared models, and no renderer exceptions. Its nonprompting native preflight reported recording permission granted; actual audio delivery was not tested.

Scripted UI tests cover controls, transparent captions, real event rendering with a fake bridge, caption expiry, history/export, and error display. Backend tests cover authentication, single-session ownership, final utterance flush, PCM framing, queue pressure, and translation stop tokens. Real-model fixture evidence and protocol details are in [backend/README.md](backend/README.md); capture conversion and permission boundaries are in [native/README.md](native/README.md).

Actual playback capture and macOS permission UI have not been exercised in automated verification. Protected media may restrict capture. The recommended final operation check is to grant permission, play a short English YouTube video, select English → 日本語, and confirm Japanese captions beside or over the video, then stop translation. No screenshots or AI-operated browser/native UI were used for verification, following the requested preparation skills.
