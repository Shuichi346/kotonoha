# kotoba Implementation Plan

## Progress Status

This is the single authoritative implementation and acceptance checklist. It was written retrospectively on 2026-10-16 after implementation, then reconciled with the working tree and existing session evidence. Checked items represent completed work or explicitly described evidence; writing this plan does not itself establish a test pass. No product changes or test reruns are requested by this documentation task.

- [x] P1 — Reconcile the requested product, architecture, existing implementation, and acceptance evidence.
- [x] I1 — Establish the Node.js and Python environments and committed lockfiles.
- [x] I2 — Implement native system-output capture and its PCM contract.
- [x] I3 — Prepare the requested models and implement the local inference pipeline.
- [x] I4 — Implement the independent subtitle window and separate controller.
- [x] I5 — Integrate authenticated IPC, service ownership, and process cleanup.
- [x] I6 — Package the local arm64 macOS application.
- [x] V1 — Frontend type checking and production build passed.
- [x] V2 — Four scripted UI tests passed.
- [x] V3 — Eight backend tests and Ruff checks passed.
- [x] V4 — Native build, resampling self-test, permission preflight, and signing checks passed.
- [x] V5 — Real ASR-to-translation baseline evidence and subsequent EOS regression were reconciled.
- [x] V6 — Real NeMo endpointing produced a final transcript before any client commit.
- [x] V7 — Packaged application startup, IPC, model status, and shutdown checks passed.
- [x] V8 — The packaged application and native runtime components support arm64.
- [x] D1 — Finish repository documentation updates and review documentation consistency.

Current: Complete
Next: None

Save this tracker after each implementation step or independent verification unit. Show the full checklist at execution start, phase boundaries, and completion; use changed lines with Current/Next for ordinary updates, unless the user requests shorter reporting. Do not create a second checklist in another file. Narrative rationale belongs in NOTES.md and component documentation.

## Outcome and Scope

The user watches a video in its existing application while kotoba displays translated subtitles in an independent window on the same display. The subtitle surface must look like subtitles: transparent canvas, outlined white text, and controls visible only during interaction. The user can place it above the video or elsewhere on the display, keep it above other applications, resize it, and hide the separate controller.

Explicit requirements are Mac system-output input, translated subtitle output, the requested TranslateGemma and Nemotron models, and a subtitle-only window that coexists with the video application. The selected implementation uses Node.js/Electron/React for the interface, Python for model orchestration and translation, NeMo-Speech.cpp for ASR, and a narrow Swift helper for system audio. Local inference, permission-aware startup, and bounded processing are implementation decisions supporting that workflow.

Target Apple silicon only: macOS 26+, arm64 execution, no Intel builds, universal app distributions, Rosetta workflows, or Intel compatibility testing. Use native arm64-compatible runtimes and helpers. A dependency requiring Intel execution is a blocker.

The delivered app is a local development build linked to this checkout's Python environment and models. A portable installer, Developer ID distribution, notarization, video embedding, microphone transcription, cloud services, and automatic recording are outside this implementation. No numerical latency or translation-quality guarantee was established. The user reported on 2026-10-16 that the current app runs comfortably; preserve the working application while maintaining its documentation.

## Existing System and Evidence

- Repository root: `/Users/shuichi/Documents/GitHub/Real-time-translation`.
- App artifact: `release/kotoba-darwin-arm64/kotoba.app`.
- Node.js 26.10.0 and npm 12.2.0 were observed during implementation. The manifest requires Node.js >=26.5 and npm >=12.0.1, with project-local engine enforcement.
- Python 3.13.11 is managed by uv in `.venv`; `pyproject.toml`, `.python-version`, and `uv.lock` define the Python environment.
- The implementation uses Electron 44.7.2, React 19.3.1, Vite 8.3.4, TypeScript 7.0.2, and Playwright 1.64.1. The Python evidence records mlx-lm 0.32.1 and MLX 0.32.4. The installed arm64 NeMo CLI is 0.2.0.
- Requested models are downloaded into ignored `models/translation` and `models/asr`, approximately 2.8 GiB combined. Dependency trees, builds, native binaries, and scratch data remain ignored.
- Existing evidence is available in this session, NOTES.md, backend/README.md, and native/README.md. Reuse valid evidence; do not rerun checks to populate this plan.
- The user's comfort report is user-reported operational evidence. It does not specify a player, language pair, measured latency, or exhaustive interaction coverage. The agent has not captured the user's live system audio or performed an AI-operated visual inspection.

## Architecture and Contracts

### Audio and inference

`native/bin/audio-capture` executes the signed helper bundle under `native/bin/LiveCaptionAudio.app`. ScreenCaptureKit supplies system output, without microphone capture or delivered video samples. The helper emits only little-endian, mono, signed PCM16 at 16,000 samples/second on stdout; diagnostics go to stderr. Preserve split PCM samples across pipe reads and drain the final output during shutdown.

`backend/app.py` serves authenticated HTTP and WebSocket traffic on `127.0.0.1:8765`. Electron supplies a random `RT_TOKEN`. HTTP uses a Bearer header; `/api/live` authenticates the token query parameter. Never log the query credential. `GET /api/status` returns capture, ASR, and translation readiness without loading models. Capture preflight uses the bounded, nonprompting native `--check`; permission state is distinct from actual audio delivery.

The live socket accepts `start` with source/target codes and `stop`. It emits status, partial transcription, translated subtitle, audio-level, and error events. A subtitle includes ID, source text, translated text, start/end times, and translation latency. Permit one capture owner; a different client cannot stop that owner's session.

`backend/runtime.py` owns NeMo on authenticated loopback port 8766, with Metal and the requested `nemotron-3.5` model. It connects to `/v1/audio/transcriptions/realtime`, configures 16 kHz input, and sends binary PCM16. Enable token-silence endpointing with `--asr.endpointing.enable` and threshold `--asr.endpointing.stop_history_eou_ms 600`. The Boolean enable flag takes no trailing value. Periodic 15-second commits bound continuous speech; stop commits the unfinished utterance and drains pending translation before reporting stopped.

`backend/translation.py` keeps the requested `mlx-community/translategemma-4b-it-4bit` model on one persistent MLX worker. Use structured content with `source_lang_code`, `target_lang_code`, and `text`, and register `<end_of_turn>` as EOS. Models stay warm between sessions. A queue holds three waiting utterances; overload drops the oldest waiting work with a status message while preserving active work and recent speech. Latency is measured from final-ASR receipt, not from video playback.

### Desktop and interface

`desktop/main.mjs` owns the controller and an independent frameless, transparent, always-on-top subtitle window. `frontend/Controls.tsx` contains configuration and history; `frontend/Overlay.tsx` renders only subtitles and transient hover controls. Preserve drag/resize behavior, text size, original-text display, optional background opacity, subtitle expiry, and click-through mode. The controller can be hidden without hiding captions. The menu-bar item and Command+Shift+K restore controls; Command+Shift+L toggles click-through.

Use the narrow bridge in `desktop/preload.cjs` with context isolation and renderer sandboxing. Keep Node access and credentials out of the renderer, validate IPC senders, and block arbitrary navigation/new windows. Report errors in the controller. Store preferences locally; keep only the latest 1,000 subtitle entries in memory until quit. TXT/SRT writes require the explicit export action. SRT is an approximate transcript timeline, not synchronization with the source video.

Start windows from `app.whenReady().then(...)`; do not block main-module evaluation on a top-level readiness wait. Launch Python in an owned process group. Quit requests graceful shutdown, then kills that group after the bounded grace period to avoid orphaned model or capture processes.

`scripts/package.mjs` packages darwin arm64 and writes the checkout root to `Contents/Resources/runtime.json`. The app uses that checkout's `.venv`, backend, native helper, and models. Moving the checkout requires regenerating the local app; packaging does not create a self-contained distribution.

### Source references

These official references were consulted during the original implementation; this documentation update adds no version-specific dependency change:

- [NeMo server and realtime protocol](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md), [API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md), and [ASR configuration](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/asr/configuration.md).
- [Requested ASR model](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) and [requested MLX translation model](https://huggingface.co/mlx-community/translategemma-4b-it-4bit).
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos). Installed Xcode SDK headers supplied signatures where the web documentation required JavaScript.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [ES modules](https://www.electronjs.org/docs/latest/tutorial/esm), and [BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window). `getBackgroundColor()` returns RGB and omits alpha; combine that contract with transparent renderer styling when testing.

## Implementation Sequence

These are the dependency-ordered construction steps for the delivered solution. Their checked status above reflects existing work, not a request to rebuild a working app.

| ID | Outcome and location | Required action | Dependencies | Acceptance evidence |
| --- | --- | --- | --- | --- |
| I1 | Reproducible environment: package.json, package-lock.json, .npmrc, pyproject.toml, uv.lock, .python-version, .gitignore | Preserve declared runtimes, npm/uv workflows, ES modules, local environments, and ignored generated artifacts. | None | Existing runtime/version observations, manifests/locks, and V1/V3. |
| I2 | Native helper: native/Sources/AudioCapture.swift, native/Info.plist, native/build.sh | Capture system output on explicit Start, preserve PCM framing, support permission preflight and signal-driven shutdown, and maintain bundle identity. | I1 | V4 and V8; automated checks never start real capture. |
| I3 | Local inference: backend/config.py, prepare.py, runtime.py, translation.py, pipeline.py, app.py | Prepare both models; implement authenticated streaming, exclusive session ownership, endpointing, bounded translation, and final flush. | I1, I2 | V3, V5, V6, and status evidence in V7. |
| I4 | Subtitle and controller UI: frontend/, desktop/preload.cjs | Render independently from video applications; implement transparent captions, separate controls, settings, history, and exports without sample text pretending to be inference. | I1 | V1/V2 and the window/IPC evidence in V7. |
| I5 | Desktop lifecycle: desktop/main.mjs, desktop/transcript.mjs | Own windows, authenticated services, shortcuts, validated IPC, persistence, errors, and process-group cleanup. | I2, I3, I4 | V2/V3 cover their respective contracts; V7 covers packaged integration and shutdown. |
| I6 | Local app: scripts/package.mjs, scripts/launch.mjs, release/kotoba-darwin-arm64/kotoba.app | Build for arm64, preserve runtime.json linkage, and document the local-development distribution boundary. | I5 | Existing package artifact, V7, and V8. |

No destructive migration is involved. Preserve unrelated files and the currently working app. If runtime.json points to a moved checkout, inspect the path before rebuilding; do not delete models or environments as a speculative fix. Permission errors require their actual OS remedy. Packaging overwrites the generated local app, so do not rebuild it during this documentation-only task or while it is being used.

## Finite Verification and Recorded Results

All commands below already exist. For commands without an internal deadline, use a process timeout, for example `/usr/bin/perl -e 'alarm shift; exec @ARGV or die $!' SECONDS COMMAND ...`, with the table's limit. Bound output to a concise result or a small failure excerpt; retain necessary diagnostics without credentials. Do not install tooling solely for extra confidence.

| Unit | Command or evidence source | Prerequisites and finite limit | Pass condition and recorded evidence |
| --- | --- | --- | --- |
| V1 | `npm run build` | Existing node_modules; 30 seconds per type/build stage. | TypeScript and Vite succeed. Passed on execution 2 after Vite CSS declarations were added. |
| V2 | `npm test` | Matching Playwright Chromium; macOS process permissions; 90-second suite limit. | Four tests pass: controls, transparent event-driven captions/expiry, history/export/error handling, and transcript formatting. Passed on execution 3 after browser installation and sandbox prerequisites were resolved. |
| V3 | `uv run --locked python -m pytest -q`; `uv run --locked ruff check backend`; `uv run --locked ruff format --check backend` | Prepared .venv; 60 seconds for pytest and 30 seconds for each Ruff check. | Eight deterministic tests and both Ruff checks passed. Covers auth, capture ownership, PCM framing, bounded queue, final flush, translation failures, commit races, and EOS registration. |
| V4 | `./native/build.sh --verify`; recorded codesign/plist/shell validation | Xcode SDK and arm64 toolchain; compilation 120 seconds, verification subprocesses 15 seconds each; 180-second outer limit. | Native build passed on execution 3. Resampling, PCM endianness, permission preflight, signing, plist, and shell checks passed. No real system audio was captured. |
| V5 | Earlier `uv run --locked python -m backend.smoke .scratch/jfk.wav` result, followed by the EOS regression in V3 | Both prepared models, authorized GPU execution, mono 16 kHz PCM16 fixture; smoke has a 120-second limit. `.scratch/jfk.wav` is local and ignored; later runs require a suitable available fixture. | Baseline produced 99 partials, expected English text, and Japanese translation in 26.83 seconds including startup. It passed on execution 3 after two Metal sandbox failures. This full run preceded EOS/endpointing fixes; V3 verifies EOS registration and V6 verifies updated endpointing. Do not claim a post-fix full-flow rerun. |
| V6 | `uv run --locked python -m backend.endpoint_smoke .scratch/jfk.wav` | Prepared ASR model, authorized GPU execution, fixture; 60-second overall limit. | Passed on execution 2 after correcting Boolean CLI syntax. A nonempty final arrived at audio time 3.30 seconds before any client commit; total check time 11.01 seconds. No translator or real capture was started. |
| V7 | `node scripts/smoke-desktop.mjs`; recorded bounded loopback socket checks after it closed | Built local .app, prepared backend/models, permission to launch the scripted desktop test; 45-second smoke limit, 1-second timeout per shutdown socket probe. | Passed on execution 3: two windows, authenticated status, both models ready, working IPC, transparent renderer styling, and zero renderer exceptions. Native preflight reported permission granted. After shutdown neither port 8765 nor 8766 remained listening. This is not a live video-capture test. |
| V8 | `npm run check:architecture` | Packaged app, native helper, Python and MLX environment, installed NeMo; 30-second outer limit. | Passed: arm64 available in 33 inspected Mach-O components and in Python/NeMo. Packaging targets only darwin arm64; do not add Intel execution paths. |
| D1 | Review documentation changes, validate local references/manifest command names and tracker IDs, and run `git diff --check` | Documentation files only; 30-second limit per inspection. | PLANS.md is in English, contains one authoritative tracker, accurately attributes evidence, preserves the operating app, and links to real repository paths. Diff review must also include newly created/untracked files, which ordinary git diff omits. |

The current task reuses V1–V8 and performs only D1. Stop verification after this finite set is satisfied; no watch sessions, repeated full suites, additional frameworks, or coverage targets are required. No Rust tier is applicable because this solution contains no Rust code. Actual capture and player-specific behavior are separate human recommendations, not permanently pending automated gates.

Do not use computer-use features for verification: no AI-driven screen observation, interactive clicking, typing, or navigation in a browser or native app, including CUA. Existing finite scripted browser/UI tests may run through their test runner. Use terminal commands, APIs, logs, and deterministic tests. Do not start real system audio capture during automated checks; only an explicit user Start action initiates it.

### Retry, recovery, and resumption rules

Each verification unit has a default budget of one initial execution and two post-repair reruns, counted across edits and interruptions. Preserve the recorded counts above. Unknown historical counts must not be guessed as zero; consult recorded evidence before a justified rerun. Documentation work and new chats do not reset budgets. Do not rename or subdivide a failed check, change tools, or broaden the suite to obtain more attempts.

Reuse passing evidence while relevant source, configuration, dependencies, tests, and inputs remain unchanged. Invalidate only evidence affected by a real change, and rerun within its remaining budget. If the budget is exhausted, the same failure recurs without a new diagnosis, or a check needs disproportionate infrastructure, leave the affected item unchecked and record the diagnostic and exact next action. Continue independent authorized work.

For an unresolved coding issue whose repair remains uncertain, recommend raising reasoning effort by one available level; do not claim a proven model limitation or change settings yourself. Record attempted approaches, cumulative attempts, the diagnostic, and the known effort level. Name current/next levels only if reliably known. Only after the user confirms a higher level and requests resumption may that same issue receive a new bounded round, normally three executions, retaining cumulative history. At the highest level or without confirmation, report the blocker and a concrete next diagnostic. Known missing permissions, credentials, dependencies, or services need their specific remedy instead. There is no unresolved such blocker in this documentation task.

Before resuming, read applicable instructions and this whole plan, inspect Git status and the first unmet requirement, and reconcile actual artifacts with the tracker. Do not rerun completed work automatically. Check whether an uncertain external or non-idempotent operation already succeeded before retrying it. A plan step grants no new permission for deletion, deployment, publication, purchases, commits, pushes, or external messages.

## Recommended Operation Checks (After Completion)

These are optional user operation recommendations, outside the required tracker. They were not performed by the agent. The user's report that the app runs comfortably is recorded separately and is not expanded into claims about specific unreported flows.

1. Play a video in the usual application and explicitly start English → Japanese translation. Expected: translated captions appear in kotoba's independent window while video playback remains in its existing app.
2. Select subtitle-only mode, move/resize captions, and toggle click-through with Command+Shift+L. Expected: captions stay visible and the video can receive clicks when unlocked interaction is not needed; Command+Shift+K restores controls.
3. Stop translation, then quit the app when convenient. Expected: subtitle processing stops, no additional transcript is automatically saved, and owned services exit. Permission prompts, if encountered, are handled through macOS settings rather than worked around.

Executor handoff: after implementation and required automated checks are complete, include a short “Recommended operation checks (after completion)” list with concrete actions and expected results. Label it as agent-unperformed recommendations. Never ask the user to test during production or make a response a prerequisite for coding completion. Report genuinely blocked automated checks honestly; do not use these recommendations to conceal incomplete work. If no meaningful operation check applies to a later documentation-only change, say so briefly. Set Current to Complete and Next to None only when the requested work and its required acceptance evidence are complete.
