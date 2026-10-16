<table>
  <thead>
    <tr>
      <th style="text-align:center"><a href="README_ja.md">日本語</a></th>
      <th style="text-align:center"><a href="README.md">English</a></th>
    </tr>
  </thead>
</table>

<p align="center">
  <img src="assets/kotonoha.png" alt="kotonoha app icon" width="96">
</p>

# kotonoha

**Live translated subtitles for the audio playing on your Mac.**

Keep watching in YouTube, your browser, or your usual video player. kotonoha captures Mac system audio, transcribes it locally, and displays translated captions in a separate, transparent window above your other apps.

Built for **Apple silicon Macs running macOS 26 or later**. Transcription and translation run on your Mac after model download, without a cloud inference API, microphone, or virtual audio driver.

<p align="center">
  <img src="githubreadme/2026-10-16-18-09-28.png" alt="kotonoha controls and an empty subtitle window on the Mac desktop" width="480">
</p>

The compact controller and subtitle window are independent. The light-gray guide shows the subtitle area while it is empty; during playback, the surrounding window is transparent.

[Features](#features) · [Setup](#setup) · [Usage](#usage) · [Local app packaging](#local-app-packaging) · [Development](#development)

## Features

- **Subtitles over your existing apps.** Move and resize the floating subtitle window, then lock it so clicks pass through to the app below.
- **Local speech and translation.** Nemotron 3.5 transcribes through NeMo-Speech.cpp with Metal; Hy-MT2 1.8B, quantized to 4-bit, translates through MLX.
- **Nine selectable languages.** English, Japanese, German, French, Spanish, Italian, Portuguese, Chinese, and Korean are available for both audio and subtitles.
- **Adjustable display.** Set text size, original-text visibility, background opacity, and caption expiry. New preferences use 30 px text with original text off.
- **Japanese and English controls.** Change the interface language independently of the audio/subtitle language pair.
- **Session history and export.** Review the latest 1,000 caption entries and explicitly export TXT or SRT. History stays in memory and is cleared when the app quits.

### English audio → Japanese subtitles

<p align="center">
  <img src="githubreadme/2026-10-16-18-11-06.png" alt="An English YouTube video with Japanese subtitles from kotonoha and its controller alongside" width="480">
</p>

### Japanese audio → English subtitles

<p align="center">
  <img src="githubreadme/2026-10-16-18-12-36.png" alt="A Japanese performance video with English subtitles from kotonoha and its controller alongside" width="480">
</p>

These screenshots show the app in use; they are examples, not accuracy or latency benchmarks.

## Setup

Each user **clones this repository and builds on their own Mac**. The packaged `.app` uses that user's installed Python/NeMo, shared model caches, and locally staged runtime; copying another user's `.app` alone is not supported. This is not a standalone signed and notarized installer.

### Requirements

| Requirement | Version / detail |
| --- | --- |
| Mac | Apple silicon (arm64), macOS 26+ |
| Desktop session | Logged-in graphical session with an available display |
| Node.js / npm | Node.js 26.5+ and npm 12.0.1+ |
| Python | Python 3.13, managed with `uv` |
| Native toolchain | Xcode command-line tools with a macOS SDK |
| Speech runtime | arm64 `nemo-speech` CLI with Metal support; verified with 0.2.0 |
| Model preparation | Internet access to download the speech and translation models |

### Prepare the tools once

Install Git and the macOS SDK/Swift toolchain using Xcode or `xcode-select --install`. Install [Node.js](https://nodejs.org/en/download) **26.5 or later** with **npm 12.0.1 or later**, and [uv](https://docs.astral.sh/uv/getting-started/installation/). On a Mac with Homebrew, uv and Python can be prepared with:

```sh
brew install uv
uv python install 3.13
```

Install the Metal-enabled arm64 CLI using the [official NeMo-Speech.cpp installer](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/install.md), unless it is already installed:

```sh
curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh | sh
```

Open a new terminal, then check the tools:

```sh
git --version
xcrun swift --version
node --version
npm --version
uv --version
nemo-speech --version
nemo-speech doctor
```

Confirm an arm64 installation and Metal support. NeMo 0.2.0 is the tested version. The app reuses the installed CLI, checking `PATH` and then `~/.local/bin/nemo-speech`; it does not build or bundle another copy. For a nonstandard installation, set `NEMO_SPEECH_BIN` to its absolute executable path. Source builds must also provide the model index via `NEMO_SPEECH_MODEL_INDEX` if it is not at `<resolved executable prefix>/share/nemo-speech/model-index.json`.

### Install and launch

Copy this repository's clone URL from GitHub's **Code** menu. Replace `REPOSITORY_URL` below with that URL:

```sh
git clone REPOSITORY_URL Real-time-translation
cd Real-time-translation
npm ci
npm run setup:electron
uv sync --locked
npm run build:native
npm run prepare:models
npm start
```

Use the committed `package-lock.json` and `uv.lock`. `npm start` checks frontend types, builds the interface, and launches Electron.

`npm run prepare:models` prepares the shared caches below, reusing files already present. No manual model-path selection is needed. The two active models total approximately 1.7 GiB; allow additional space for dependencies and app builds. Refer to each model card for its terms.

| Model | Default shared cache |
| --- | --- |
| [Hy-MT2-1.8B-4bit](https://huggingface.co/mlx-community/Hy-MT2-1.8B-4bit) | `~/.cache/huggingface/hub` |
| [Nemotron 3.5 ASR](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), managed by NeMo | `~/Library/Caches/NeMoSpeech/models` |

The translator uses the exact revision pinned in [backend/config.py](backend/config.py), not whichever revision is newest in the cache. NeMo selects `nemotron-3.5` from its installed model index. The app honors `HF_HOME` / `HF_HUB_CACHE` and `NEMO_SPEECH_MODEL_DIR` in its launch environment; use the defaults for Finder launches, which do not inherit shell configuration. Preparation and launch must use the same settings. See the [Hugging Face cache guide](https://huggingface.co/docs/huggingface_hub/guides/manage-cache) and [NeMo cache guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/cli.md#models-and-cache).

Models are not copied into the checkout or packaged runtime. Existing `models/` folders and older runtime snapshots are preserved but are not used by new builds. Keep the shared cache files available; after removing them, rerun `npm run prepare:models`. Startup/status checks do not download models or load them into memory.

Models load when translation first starts and stay warm between sessions. Once prepared, transcription and translation use local model files.

## Usage

### First translation

1. Open kotonoha. The interface defaults to Japanese; choose **設定 → Language → English** for English controls.
2. Complete the audio-access guide if it appears. Use its explicit permission action, allow access in macOS, then return and check permission. This setup step does not start translation.
3. On **Live translation**, choose the audio language and subtitle language, for example **English → 日本語**.
4. Play a video in another app and click **Start translation**. The first start may take time while models load.
5. Read the translated captions in the floating window. Choose **Show subtitles only** to hide the controller while you watch.
6. Click **Stop translation** when finished. The app finishes the final utterance and pending translations before reporting that it has stopped.

The subtitle window initially appears locked, with an empty-area guide. Starting a session clears and hides it until the first translated caption. When locked, clicks pass through it; unlock it to move or resize it. Stopping translation hides and resets the subtitle window.

### Controls and shortcuts

| Action | How |
| --- | --- |
| Show the controller | **⌘⇧K**, or use the leaf-shaped menu-bar icon |
| Lock / unlock subtitles | **⌘⇧L** |
| Move or resize subtitles | Unlock, then drag inside the subtitle area or resize its edges |
| Change caption appearance | **Live translation**; expand **Adjust appearance** for more options |
| Change interface language | **Settings → Language** |
| Adjust finalization requests | **Settings → Finalization request interval**, while translation is stopped |
| Export captions | **History → TXT** or **SRT** |
| Quit the app and its services | **⌘Q**, or **Quit kotonoha** in the menu bar |

Closing the controller hides it while the app keeps running. Quit kotonoha to end all owned audio and model processes. Settings persist between launches; legacy kotoba preferences are imported without overwriting the old profile.

The finalization interval offers **5, 10, 15, 20, or 30 seconds**, defaults to **15 seconds**, and applies on the next Start. It sends extra requests during continuous speech; natural speech-boundary detection remains enabled at 600 ms. This setting is not a guaranteed caption delay.

### Permissions and troubleshooting

| Symptom | What to check |
| --- | --- |
| Audio access is required | Use the app's guide. In **System Settings → Privacy & Security → Screen & System Audio Recording**, enable the relevant entry; macOS may show **kotonoha** or **LiveCaption Audio**. Return to the app and check access again. Restart kotonoha if macOS requires it. |
| A model shows **Setup needed** | Run `npm run prepare:models`; confirm the arm64 `nemo-speech` executable is available. |
| Startup reports a service conflict | Quit another running kotonoha build before launching. Production services use loopback ports 8765 and 8766. |
| Captions are missing | Confirm the audio language, video playback, and subtitle-window visibility. Some protected media cannot be captured. |
| Captions fall behind | Translation speed depends on audio and hardware. When its bounded queue fills, the app skips older waiting utterances and reports this in the status. |

Speech recognition and translation can make mistakes, especially with names, numbers, accents, overlapping voices, or specialized language. SRT exports use an approximate session timeline and are not synchronized to a source video file. The app does not automatically record audio or save transcripts; export history before quitting if you need it.

## Local app packaging

After setup and model preparation:

```sh
npm run package
npm run check:architecture
```

The build creates `release/kotonoha-darwin-arm64/kotonoha.app`. You may move this app into `/Applications` on the same Mac and open it in Finder after quitting any other kotonoha build.

Packaging stages the Python environment, backend, and native capture helper into versioned snapshots under:

```text
~/Library/Application Support/kotonoha/runtime/
```

`Contents/Resources/runtime.json` inside the app selects its snapshot. Packaged startup does not read dependencies from the source checkout. Keep the selected snapshot, installed base Python, NeMo executable and model index, and shared model caches available on this Mac, even after moving the `.app`. Repackage after changing backend code, Python dependencies, or the native helper. A changed translator revision also needs model preparation and repackaging. New snapshots contain no model weights; older snapshots and model folders remain untouched. Other users follow the clone/setup/build steps on their own Macs.

## Development

### Architecture

```text
Mac system audio
  → Swift / ScreenCaptureKit (16 kHz mono PCM16)
  → NeMo-Speech.cpp / Metal (streaming transcription)
  → Hy-MT2 / MLX (translation)
  → Electron subtitle window
```

| Directory | Responsibility |
| --- | --- |
| [frontend/](frontend/) | React, TypeScript, and Vite controller and subtitle views |
| [desktop/](desktop/) | Electron windows, menus, shortcuts, preferences, IPC, exports, and process ownership |
| [backend/](backend/) | Python 3.13 / FastAPI service, streaming speech pipeline, and persistent MLX translator |
| [native/](native/) | Swift system-audio capture helper; microphone capture is disabled and video samples are not delivered or stored |
| [scripts/](scripts/) | Build, model-runtime staging, packaging, architecture checks, and desktop smoke checks |

Electron main owns the local service credentials. The Python service listens on authenticated loopback port **8765**, and NeMo uses **8766**. The renderer has no Node access. Quitting terminates the backend process group and its owned services.

`npm run dev:web` previews the interface in a browser. Live capture and the independent overlay require Electron.

### Verification commands

```sh
npm run build
npx playwright install chromium
npm test
node --test tests/desktop.test.mjs
uv run --locked python -m pytest -q
uv run --locked ruff check backend
uv run --locked ruff format --check backend
./native/build.sh --verify
```

Install Chromium once before running the scripted UI tests. The frontend scripts enforce finite build and test limits. Native verification checks the build, architecture, resampler, and permission status without requesting access or capturing audio.

After packaging, check the actual app with:

```sh
npm run check:architecture
node scripts/smoke-desktop.mjs
```

The hidden desktop smoke uses a temporary profile and port **8767**, checks startup and IPC, and intercepts Start before capture. It does not verify real audio delivery or macOS permission-dialog interaction.

Protocol details and model-validation evidence are in [backend/README.md](backend/README.md); capture and permission behavior are in [native/README.md](native/README.md). [PLANS.md](PLANS.md) tracks implementation acceptance, and [NOTES.md](NOTES.md) records design rationale.
