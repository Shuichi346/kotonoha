# kotonoha — Real-time translation subtitles for Mac

Watch a video in your usual player and keep translated captions in a separate, transparent window. Captions stay above other applications, can be dragged or resized, and can pass clicks through to the video. The control window can be hidden while captions remain visible.

The app captures **Mac system output**, including YouTube in a browser. It uses the requested Nemotron 3.5 model through NeMo-Speech.cpp for streaming transcription, then TranslateGemma 4B through MLX for translation. Inference runs locally after model download. No microphone or virtual audio driver is required.

## Open the app on this Mac

The current startup and overlay correction build is `release/startup-fix/kotonoha-darwin-arm64/kotonoha.app`. Ordinary `npm run package` produces `release/kotonoha-darwin-arm64/kotonoha.app`. Open it in Finder, choose the audio and subtitle languages, and click **翻訳を開始**. On first use, macOS may request Screen & System Audio Recording permission for **LiveCaption Audio** or the parent app. Allow the request in System Settings → Privacy & Security → Screen & System Audio Recording, then restart translation if required. Models load before audio capture starts. The packaged Python/model runtime is staged outside Documents so it does not require access to the source checkout at launch.

The interface defaults to Japanese. Choose **表示言語 → English** to switch the controls, menus, subtitle toolbar, and service messages to English. This preference is saved independently of the audio/subtitle language pair. Legacy settings are read from the former kotoba profile without modifying it; new settings are saved in the kotonoha profile. Quit the old app before opening the new one because production audio services use the same loopback port.

Start playing the video. Captions appear in the independent subtitle window after speech is recognized and translated. It starts hidden with clicks passing through to the app below. Use **字幕だけにする** to hide the controls. The video continues in its own application. When the visible subtitle window is empty, a light-gray guide shows its entire area without hovering. Unlocking also shows its interactive bounds; locking restores transparent caption playback.

| Action | Operation |
|---|---|
| Move captions | Unlock with **⌘⇧L**, then drag inside the subtitle window; controls appear on hover |
| Resize captions | Unlock, then resize the subtitle window at its edge |
| Show controls again | **⌘⇧K**, or the leaf-shaped menu-bar icon |
| Pass clicks through to video / unlock | **⌘⇧L** |
| Adjust text | Change font size, original-text display, background opacity, and expiry in the controls |
| Stop translation | **翻訳を停止**, or the menu-bar **翻訳を停止** command |
| Quit completely | **⌘Q** or menu-bar **kotonohaを終了** |

Closing the controls hides them. Quit the app to stop all owned audio/model processes. Errors hide and lock the subtitles and show the controls without forcing keyboard focus. Hiding the subtitle window also resets it to click-through mode. Caption history keeps the latest 1,000 entries in memory until the app quits; export TXT or SRT before quitting if needed. SRT timing is an approximate transcript timeline, not synchronization with a video file.

**This is a local development app.** Packaging copies the Python environment, backend, models, and native helper to a versioned snapshot under `~/Library/Application Support/kotonoha/runtime/`; `Contents/Resources/runtime.json` selects that snapshot. Keep the snapshot and this Mac's installed base Python and NeMo executable available. The source checkout is used for development and rebuilding, not packaged startup. Repackage after backend, dependency, model, or helper changes. This is not a standalone signed/notarized installer for another Mac.

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

The app icon uses the supplied emblem, cropped from its outer background with a transparent macOS icon margin. The menu bar uses a monochrome leaf template with a Retina representation; the subtitle toolbar uses a sliders symbol. `node scripts/build-icons.mjs` regenerates PNG/ICNS assets from `assets/icon-source.png` using the installed macOS tools.

Create the local `.app` again with `npm run package`. Packaging targets **darwin arm64 only**. `npm run dev:web` previews the controls; live audio and the overlay require Electron and do not work in a normal browser.

## Implementation

- `frontend/`: React + TypeScript + Vite controls and subtitle-only view. Caption playback uses a transparent canvas and outlined white text. Empty windows and unlocked positioning show a gray guide; toolbar controls appear only while interacting in unlocked mode.
- `desktop/`: Electron owns two independent windows, a menu-bar controller, shortcuts, IPC, and the Python process group. The renderer has no Node access; the main process validates IPC senders and owns local credentials.
- `backend/`: Python 3.13 + FastAPI, NeMo streaming WebSocket, and a persistent MLX worker. Models remain warm between sessions. The backend listens on authenticated loopback port **8765**, and owns NeMo on **8766**. Neither listener is exposed to the network.
- `native/`: Swift ScreenCaptureKit helper produces 16 kHz mono PCM16. Video samples are never delivered or stored.

English, Japanese, German, French, Spanish, Italian, Portuguese, Chinese, and Korean are exposed in the controls. Quality varies by audio, accent, language, and content. Captions appear after speech boundaries; translation is not instantaneous. Continuous speech is committed every 15 seconds. A bounded translation queue skips old waiting utterances with a status message if inference falls behind.

## Automated verification

```sh
npm run build
npm test
node --test tests/desktop.test.mjs
xcrun swift -module-cache-path .scratch/icon-module-cache scripts/check-menu-icons.swift
uv run --locked python -m pytest -q
uv run --locked ruff check backend
uv run --locked ruff format --check backend
./native/build.sh --verify
npm run check:architecture
node scripts/smoke-desktop.mjs
```

Commands should be run with finite limits. The menu-icon regression check has a 30-second limit and checks transparent edges, logical size, and 1x/2x silhouette agreement. Frontend build tasks have 30-second limits per stage; UI tests have a 90-second suite limit; the desktop launch check has a 45-second limit and does **not** start recording. The native build has a 120-second limit and its verification commands have 15-second limits. The architecture check requires a packaged app and prepared Python environment. GPU inference, browser process startup, and the desktop launch check may require execution outside a restrictive sandbox.

After the 2026-10-16 branding/language update, the frontend build, six scripted UI tests, three desktop preference tests, ten backend tests, Ruff checks, arm64 architecture inspection, and packaged desktop smoke passed. Native resampling/self-test and real-model inference evidence from the original implementation were reused because inference and DSP were unchanged. The desktop smoke verified two windows, authenticated backend status, prepared models, English menus, persisted UI language, transparent subtitle styling, and no renderer exceptions. It uses an isolated temporary profile and backend port 8767 to leave the running production app untouched; recording is never started. Its nonprompting native preflight reported recording permission granted; actual audio delivery was not tested.

Scripted UI tests cover controls, transparent captions, real event rendering with a fake bridge, caption expiry, history/export, and error display. Backend tests cover authentication, single-session ownership, final utterance flush, PCM framing, queue pressure, and translation stop tokens. Real-model fixture evidence and protocol details are in [backend/README.md](backend/README.md); capture conversion and permission boundaries are in [native/README.md](native/README.md).

Actual playback capture and macOS permission UI have not been exercised in automated verification. Protected media may restrict capture. The recommended final operation check is to grant permission, play a short English YouTube video, select English → 日本語, and confirm Japanese captions beside or over the video, then stop translation. No screenshots or AI-operated browser/native UI were used for verification, following the requested preparation skills.
npm run package
The startup/overlay correction additionally passed five lifecycle/runtime tests, six scripted UI tests (including gray empty/expired windows and transparent locked captions), and a hidden smoke against the final `release/startup-fix` artifact. The smoke verifies mouse-ignore API transitions and focusability, not physical clicks in another app. A restricted child-Python probe passed with the source checkout denied; the first-launch macOS permission dialog itself remains untested. To smoke this correction explicitly, set `KOTONOHA_SMOKE_APP=release/startup-fix/kotonoha-darwin-arm64/kotonoha.app/Contents/MacOS/kotonoha` when running `node scripts/smoke-desktop.mjs`.
