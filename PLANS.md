# kotonoha Implementation Plan

## Progress Status

This is the single authoritative implementation and acceptance checklist. The original implementation was documented retrospectively on 2026-10-16. P1–D1 retain its baseline evidence; R1–RD1 track the subsequent user-requested kotonoha branding and interface-language update. Checked items represent completed work or the explicitly described evidence, not a test pass inferred from writing this plan.

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

- [x] R1 — Rename the app, preserve legacy preferences, and localize desktop controls.
- [x] R2 — Finish Japanese/English interface and backend message localization (Japanese default).
- [x] R3 — Crop the supplied artwork, install app/menu-bar icons, and replace the subtitle settings glyph.
- [x] RV1 — Pass affected frontend build, desktop preference tests, and scripted locale/overlay tests.
- [x] RV2 — Pass backend locale regressions and Ruff checks without changing inference behavior.
- [x] RV3 — Package kotonoha for arm64 and verify icon resources, architecture, localized IPC, and isolated startup.
- [x] RD1 — Update documentation and record final evidence.

- [x] M1 — Remove duplicate Retina scaling and regenerate the menu template assets.
- [x] MV1 — Verify point/pixel dimensions, transparent margins, and 1x/2x silhouette agreement.
- [x] MP1 — Create a corrected app build and verify its archived template assets.
- [x] MD1 — Record the root cause and corrected verification evidence.

- [x] S1 — Guard window actions during shutdown and remove focus/overlay behaviors that risk interfering with OS permission dialogs.
- [x] S2 — Stage the local Python/models/helper runtime in the app's Application Support directory instead of Documents.
- [x] SV1 — Pass focused lifecycle/runtime regression tests and build checks.
- [x] S3 — Make an empty subtitle window light gray without hover, expose unlocked bounds, and disable focus/drag behavior in click-through mode.
- [x] SV3 — Verify empty/expired captions and locked/unlocked input transitions using bounded scripted checks.
- [x] SV2 — Package and verify the actual repaired artifact, including a restricted-environment startup check without displaying windows or recording.
- [x] SD1 — Update operating documentation and record exact limitations.

- [x] A1 — Separate permission-only requests from capture and add localized, structured permission failures.
- [x] A2 — Explain permissions before requesting them, confirm access, then allow explicit translation start.
- [x] AV1 — Verify affected frontend, IPC, backend, and native behavior without permission prompts or capture.
- [x] AV2 — Package a separate arm64 correction and run the hidden desktop smoke.
- [x] AD1 — Record the flow, evidence, and remaining OS-interaction limits.

- [x] C1 — Default to 30 px, subtitles on/original off, keep Language discoverable, and restrict toggle activation to the switch itself.
- [x] CV1 — Verify new defaults, preserved saved settings, switch click boundaries, and keyboard access.
- [x] CP1 — Package the correction separately and verify the final artifact.
- [x] CD1 — Record the behavior and acceptance evidence.

- [x] W1 — Size and position the controller above subtitles and explicitly use a regular Dock/menu application.
- [x] WV1 — Verify display geometry, user-only app activation, compact controls, and packaged integration.
- [x] WD1 — Package separately and record final evidence.

Current: Complete — Compact startup placement and regular Dock/menu behavior are packaged and verified within the stated OS-appearance limits.
Next: None.

Save this tracker after each implementation step or independent verification unit. Show the full checklist at execution start, phase boundaries, and completion; use changed lines with Current/Next for ordinary updates, unless the user requests shorter reporting. Do not create a second checklist in another file. Narrative rationale belongs in NOTES.md and component documentation.

## Branding and Interface-Language Update — 2026-10-16

The user requested the name **kotonoha**, a Japanese/English interface with Japanese as default, the supplied cropped emblem as the app icon, a proper menu-bar icon, and a replacement for the flower-like subtitle settings glyph. Preserve the working translation pipeline and the independent transparent subtitle window.

R1 changes package/display/export names and Electron resources, migrates settings from the old kotoba profile without deleting or overwriting it, and localizes menus, errors, and titles. R2 adds a persisted `uiLanguage` preference independent from source/target languages, localizes the React views and backend status/errors, and propagates language changes immediately. R3 adds artwork-derived PNG/ICNS assets, a monochrome leaf template image with Retina representation, and a sliders glyph for subtitle settings. Dependencies: R1/R2 proceed together; R3 is independent; package verification follows all three.

Keep the already running app available. The new artifact is `release/kotonoha-darwin-arm64/kotonoha.app`; preserve the previous generated build. Desktop tests use an isolated temporary profile and backend port 8767 and do not start capture. Keep the native helper's bundle identity for existing recording permissions. No app notarization or inference changes are introduced.

The earlier V1–V8 checkboxes are historical baseline evidence. The affected behavior is accepted by the new RV units, with at most three executions per unit (initial plus two focused repairs), counted across this interruption. No new checks were executed before this resume. Current evidence: build, three desktop preference tests, six UI tests, and ten backend tests passed on their first executions; backend Ruff lint passed on execution 2 after bilingual dictionary line wrapping, and Ruff format passed. Icon conversion passed on execution 2 after allowing the standard macOS converter outside the restrictive sandbox. The new package, architecture inspection, and isolated desktop smoke passed on their first executions; native menu language, persisted UI preference, model readiness, transparent captions, and zero renderer errors were verified. The packaged icon hash matches the supplied-artwork-derived ICNS, and the isolated backend exited cleanly. RV1 uses `npm run build` (30 seconds per stage), `node --test tests/desktop.test.mjs` (30-second outer limit), and `npm test` (90-second suite limit). RV2 uses the existing pytest (60 seconds) and Ruff lint/format commands (30 seconds each), plus focused locale tests. RV3 packages with `node scripts/package.mjs` (120-second outer limit), inspects ICNS/PNG/template files and arm64 components (30 seconds), and runs `node scripts/smoke-desktop.mjs` (45 seconds). These limits apply to distinct existing checks; do not rename failures to reset retries. Reuse native DSP and model-inference evidence because their code is unchanged. Stop once affected checks pass. No AI-driven computer-use or screenshot inspection, and no real capture during checks.

Recommended operation checks after completion, not agent-run gates: open kotonoha, change interface language and relaunch to confirm persistence, and inspect the new Dock/menu-bar icons and subtitle toolbar. Model output language must still follow the source/target selections. Update repository documentation after implementation; no user-operated check is required to finish coding.

## Outcome and Scope

The user watches a video in its existing application while kotonoha displays translated subtitles in an independent window on the same display. The subtitle surface must look like subtitles: transparent canvas, outlined white text, and controls visible only during interaction. The user can place it above the video or elsewhere on the display, keep it above other applications, resize it, and hide the separate controller.

Explicit requirements are Mac system-output input, translated subtitle output, the requested TranslateGemma and Nemotron models, and a subtitle-only window that coexists with the video application. The selected implementation uses Node.js/Electron/React for the interface, Python for model orchestration and translation, NeMo-Speech.cpp for ASR, and a narrow Swift helper for system audio. Local inference, permission-aware startup, and bounded processing are implementation decisions supporting that workflow.

Target Apple silicon only: macOS 26+, arm64 execution, no Intel builds, universal app distributions, Rosetta workflows, or Intel compatibility testing. Use native arm64-compatible runtimes and helpers. A dependency requiring Intel execution is a blocker.

The delivered app is a local development build linked to this checkout's Python environment and models. A portable installer, Developer ID distribution, notarization, video embedding, microphone transcription, cloud services, and automatic recording are outside this implementation. No numerical latency or translation-quality guarantee was established. The user reported on 2026-10-16 that the current app runs comfortably; preserve that working behavior while applying the requested branding and language improvements.

## Existing System and Evidence

- Repository root: `/Users/shuichi/Documents/GitHub/Real-time-translation`.
- App artifact: `release/kotonoha-darwin-arm64/kotonoha.app`.
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

`scripts/package.mjs` packages darwin arm64 and stages `.venv`, backend, native helper, and models through `scripts/stage-runtime.mjs` into a versioned Application Support snapshot. It writes that root to `Contents/Resources/runtime.json`. Packaged startup must not depend on the Documents checkout. The installed base Python and NeMo executable are still required; packaging does not create a self-contained distribution.

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
| I6 | Local app: scripts/package.mjs, scripts/launch.mjs, release/kotonoha-darwin-arm64/kotonoha.app | Build for arm64, preserve runtime.json linkage, and document the local-development distribution boundary. | I5 | Existing package artifact, V7, and V8. |

No destructive migration is involved. Preserve unrelated files and the currently working app. Inspect runtime.json and its snapshot before rebuilding; do not delete models or environments as a speculative fix. Packaging overwrites its selected generated app; use a separate output directory for corrections when the existing copy may be in use.

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

The original documentation task reused V1–V8 and performed only D1; the subsequent branding/language update uses RV1–RV3 above, while reusing unaffected native DSP and model-inference evidence. Stop verification after this finite set is satisfied; no watch sessions, repeated full suites, additional frameworks, or coverage targets are required. No Rust tier is applicable because this solution contains no Rust code. Actual capture and player-specific behavior are separate human recommendations, not permanently pending automated gates.

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

## Retina Template Correction — 2026-10-16

The user supplied evidence that the 2x menu template was clipped. Inspecting the installed AppKit context confirmed that setting a 36-pixel bitmap to 18 points already creates a 2x context transform; the generator incorrectly applied an additional explicit 2x scale. Remove only the redundant scaling. Keep the original app artwork, UI, and inference behavior unchanged.

Acceptance is bounded to the affected asset pipeline: regenerate the PNG assets (60 seconds); run `xcrun swift -module-cache-path .scratch/icon-module-cache scripts/check-menu-icons.swift` (30 seconds), requiring 18/36 pixel rasters with equal 18-point size, transparent outer margins, and mean alpha difference below 0.07 after reducing the 2x silhouette; package the correction (120 seconds) and compare archived image bytes (30 seconds). Each check has at most three executions. The first icon-check execution found test-script compilation errors and counts toward that budget; repair these before the next run. No application UI, capture, GPU, or full test suite needs to run for a template-only change. Preserve running apps; a separate corrected package may be produced for safe replacement after quit. Update this tracker and the repository notes with exact results.

Retina correction results: generation succeeded; mask verification passed on execution 2 after fixing test compilation. The 1x/2x bounds are [1,1,15,15] and [3,3,32,31] and the reduced-mask mean alpha difference is 0.0057. The separate `release/retina-fix/kotonoha-darwin-arm64/kotonoha.app` package passed on execution 1; archive bytes match both corrected PNG assets and its executable is arm64. Native rendering and model mechanics are unchanged. The running build was preserved. Recommended operation check (not performed by the agent): quit the previous app and open this separate correction build; the entire leaf should appear in the menu bar.

## Startup and Permission-Dialog Safety — 2026-10-16

The user reported Python `PermissionError` reading Documents/.venv/pyvenv.cfg, an uncaught destroyed-controller exception on activation, and unresponsive/dimmed macOS settings plus the Documents permission dialog. Treat the interaction symptoms as user evidence; do not claim the exact window-server mechanism is proven. Remove the risky screen-saver overlay level, default to click-through, keep subtitles hidden before capture is explicitly started, and hide them on errors/stop/quit. Background failures must not focus-steal. Guard callbacks after window destruction and during shutdown.

The existing checkout-linked runtime causes protected-folder access when Finder launches the app without Codex/terminal privileges. Packaging must stage Python dependencies, backend, native helper, and models into a versioned local `~/Library/Application Support/kotonoha/runtime/` snapshot, with no dependency symlinks back into Documents. Retain the native helper identity, local model choices, UI settings, and loopback authentication. Runtime files outside the workspace require the normal command approval; prepare the staging script first. Do not change macOS privacy settings or start capture during verification.

Finite checks: focused Node lifecycle/staging tests (30 seconds), existing build (30 seconds per stage), runtime staging/package (180 seconds each, bounded output), actual packaged startup using a hidden test profile/port8767 (60 seconds), and macOS sandbox-exec profile denying checkout access for a headless child Python/status check (30 seconds). Inspect arm64 and exact runtime linkage. Limit each verification unit to initial plus two focused repair reruns. Existing model/DSP and icon-mask evidence remains valid. Update the tracker after each unit and keep failure evidence distinct from a passed Finder/permission-dialog interaction, which the agent must not claim to have performed.

Startup fix evidence so far: five Node tests passed on execution 2 after fixing /var versus /private/var path canonicalization in runtime staging; frontend type/build passed on execution 1. Staging and packaging passed on execution 1. With the checkout explicitly denied by sandbox-exec, the staged Python site module, backend import, and both model readiness checks passed on execution 1. The repaired app points to `/Users/shuichi/Library/Application Support/kotonoha/runtime/3d3c64aff15c1c13` and its executable is arm64. The original kotoba artifact was not present at its former release path during inspection; no old app was deleted or modified by this fix.

Final follow-up: S3 uses an always-visible light-gray guide for empty subtitle windows, tinted positioning bounds when unlocked, and no drag regions or keyboard focus in locked mode. The user reported successful startup only after allowing Documents access and identified that as the second launch; retain first-launch coverage as unverified. SV1 finished with five tests passing on execution 3 and build passing on execution 3 after the UI follow-up. SV3's six UI tests passed on its second execution, after the first was blocked at browser launch by sandbox permissions. Packaging completed three times for canonical, retina-fix, and final startup-fix outputs; the final artifact is `release/startup-fix/kotonoha-darwin-arm64/kotonoha.app`. SV2's second hidden packaged smoke passed with both models ready, safe mouse-ignore transitions, focusability disabled when locked, guarded activation after controller destruction, and no renderer errors. The final executable is arm64 and its app-icon hash matches the tracked asset. No further check reruns are needed. A broader all-Documents denial probe was declined and not executed; the narrower checkout-denial probe passed. SD1 updated README, CHANGELOG, NOTES, and durable project instructions. Actual first-launch OS permission interaction and physical cross-app clicks remain explicitly outside the automated evidence; recommended human checks are a completion handoff, not acceptance gates.

## Permission Onboarding — 2026-10-16

The supplied screenshots show permission UI and a raw English helper failure interleaved with translation startup. Separate the operations: nonprompting startup status → explanatory permission guide when access is missing → explicit permission-only request → user confirms access → separate explicit translation Start. Never begin capture or model loading from a permission action. Preserve existing granted permissions and helper identity; recheck actual access rather than trusting a saved onboarding flag. A declined/pending permission is setup guidance, not a generic processing failure. Display localized recovery actions and reserve errors for genuine failures.

A1 owns native/backend permission contracts; A2 owns the Electron bridge and accessible Japanese/English guide. AV1 runs the changed frontend build (30 seconds per stage), finite Playwright suite (90 seconds), Node tests (30 seconds), backend pytest (60 seconds), Ruff lint/format (30 seconds each), and native build/self-test/nonprompting preflight (existing script limits). Each affected verification unit has initial plus two focused repair attempts for this new source change; earlier evidence remains historical. Browser plugin is unavailable, so use the existing scripted Playwright runner. Preserve the plan's restriction on AI-driven UI interaction and screenshot inspection; scripted screenshots may be generated as evidence. No real capture or permission request is allowed during automated checks. AV2 produces a separate `release/permission-guide` package (180 seconds), verifies arm64 (30 seconds), and runs the hidden isolated smoke (60 seconds). Reuse unaffected model-inference and icon-mask evidence. Keep the user's existing README edits and running app untouched. AD1 updates the sole tracker and concise repository notes.

Permission-guide evidence in progress: Node 26.10.0/npm 12.2.0 satisfy the manifest. Eight desktop tests passed on execution 1. Backend pytest passed on execution 3 (reserved pytest parameter name, then a fake EOF shutdown race repaired); Ruff lint passed on execution 2 and format passed on execution 1. Final native build, signing/arm64, resampler self-test and nonprompting preflight passed on execution 2 after mapping stream permission errors. Frontend build passed on executions 1 and 2 as the UI was refined. UI execution 1 was blocked by sandbox Mach-port denial; approved execution 2 passed seven tests and exposed delayed dialog close overriding reopen plus raw helper text in collapsed diagnostics. Both were repaired for execution 3. No real permission request or capture has been run.

AV1 complete: the final frontend build passed on execution 2 and all nine finite UI tests passed on execution 3. Scripted assertions cover initial guide, separate request/confirmation/start, denied/deferred permission, busy controls, Escape/focus containment, recovery/settings, locale changes, no raw helper text, and 450×680 dialog bounds. The 510×850 flow recorded zero browser warnings/errors and generated screenshots under /private/tmp; no AI screenshot inspection was performed. Eight Node tests, sixteen backend tests, Ruff, and final native checks retain the results recorded above.

Final review found an additional settings-first/request-failure retry path after AV1 passed: the primary action changed to checking before any successful native request, leaving no prompt retry. Keep the existing confirmation action and expose a separate explicit permission-request action while unconfirmed. This is a new review finding, not a retry of a failed AV1 test. A single additional focused settings-first/failure/retry regression (30 seconds, at most initial plus two repairs) verifies this path without repeating the passing nine-test suite. Final build passed on execution 3. Packaging execution 1 hit the Application Support write sandbox; approved execution 2 staged snapshot b6cd2528b334e6b4 and succeeded. Repackage once after the reviewed UI retry addition, then inspect the final bytes and smoke only that artifact.

AV2/AD1 complete: the additional settings-first/request-failure regression passed on its first execution. Final packaging passed on execution 3 and reuses independent runtime snapshot `/Users/shuichi/Library/Application Support/kotonoha/runtime/b6cd2528b334e6b4`. The final artifact is `release/permission-guide/kotonoha-darwin-arm64/kotonoha.app`; archived frontend JavaScript, permission IPC, main module, and ICNS bytes match final source/assets. Architecture inspection passed on execution 1 for 33 bundled components plus Python/NeMo; `KOTONOHA_CHECK_APP` selects this actual correction rather than an older default app. Hidden packaged smoke passed on execution 1: two windows, authenticated backend, both models ready, permission bridge available, stopped capture state, safe locked/hidden overlay, and zero renderer errors. Granted preflight is not proof of first-use OS prompts or audio delivery. No existing app was stopped or overwritten. Documentation and whitespace review passed; the pre-existing root README edit remains untouched.

Recommended operation check after completion (not performed by the agent): quit the currently running old app and open the separate permission-guide artifact. If macOS access is missing, the guide should precede any OS prompt. Complete permission setup, confirm access, then explicitly Start translation. If Settings is on but access remains unconfirmed, follow the guide to restart kotonoha. These human OS interactions are recommendations, not unfinished coding gates.


## Subtitle Defaults and Switch Click Boundaries — 2026-10-16

Use 30 px and original text off for both the renderer's initial settings and new desktop profiles. After the user's follow-up, normal startup shows the locked, click-through subtitle guide without focusing it; hidden smoke runs remain invisible. Startup errors, subsequent start/stop/error/quit still hide/reset the overlay. The explicit follow-up supersedes the earlier hidden-at-start default. Keep the interface-language label as `Language` in both dictionaries, so English speakers can locate it while the UI is Japanese. Preserve explicitly saved subtitle sizes, including legacy profile migration. Replace each controller toggle's row-wide label with a noninteractive row and an explicitly named checkbox switch. Only its visible 40×24 control area may activate on mouse clicks; description text and row whitespace must not toggle. Preserve keyboard Space, accessible names, and focus indication.

Affected checks are the frontend build (30 seconds per stage), Node tests (30 seconds), finite UI suite (90 seconds, mocked bridge, no capture), separate `release/controls-fix` package (180 seconds), archive/arm64 inspection (30 seconds), and hidden packaged smoke (60 seconds, temporary profile/port 8767). Each new-source verification unit permits an initial execution and two focused repairs. Reuse unchanged backend/native/model/icon evidence and the existing independent runtime snapshot. No AI-driven UI interaction or screenshot inspection; the scripted regression checks all three switches for inert text/whitespace and functioning click/Space activation. No real recording or OS permission prompts.

Initial C1 checks passed: build execution 1, eight desktop tests, eleven UI tests, package execution 2 after sandbox write approval, arm64/archive inspection, and hidden smoke. While finalizing, the user added subtitles-on/original-off defaults and confirmed the complete trio, then requested an English language-selector label even in Japanese UI. Incorporate these into the same correction. Build execution 2 and nine desktop tests passed after the defaults addition. UI, final build, package, and smoke will be refreshed only for this new source; retain their cumulative counts. Startup visibility is covered with window stubs to verify locked/nonfocusable/showInactive behavior and hidden/quitting/destroyed guards, without displaying windows during automated checks.

Final C1/CV1/CP1/CD1 evidence: frontend build execution 3 passed; nine desktop tests passed on execution 2; all eleven UI tests passed on execution 2. Final package execution 3 succeeded at `release/controls-fix/kotonoha-darwin-arm64/kotonoha.app`, reusing runtime snapshot `b6cd2528b334e6b4`. Archive hashes match final preferences, main/window-actions modules, frontend JavaScript/CSS, and tracked ICNS. Final arm64 inspection (execution 2) verified 33 bundled components plus Python/NeMo. Hidden packaged smoke (execution 2) passed with a fresh profile, 30 px/original-off defaults, two windows, ready models, stopped capture, permission IPC, locked/nonfocusable overlay handling, and zero renderer errors. Normal startup visibility is verified through deterministic window stubs; hidden smoke intentionally displays no windows. All requested settings and behavior are complete. Documentation/whitespace review passed. Existing saved caption preferences and running apps remain untouched. Optional human operation check, not performed: quit the old app and open the controls-fix artifact; its locked gray subtitle guide should appear without taking focus, and only switch controls should toggle. Saved font/original preferences take precedence over new-profile defaults.


## Compact Startup and Regular macOS App — 2026-10-16

The supplied screenshots show the tall controller extending into the subtitle guide. Replace the fixed 510×850 startup window with a controller up to 480×640, clamped to the display work area and a separate band above the initial subtitle rectangle, with at least 16 px separation. Keep a lower minimum height so smaller screens can scroll the controls rather than forcing the window into captions. Apply placement only at startup; preserve later user moves/resizes.

Explicitly select regular macOS activation policy and show the Dock icon, retain the kotonoha application menu, and activate the application on explicit controller restoration. Mark the parent package as neither LSUIElement nor LSBackgroundOnly. Keep native audio helper identity/LSUIElement unchanged. Existing parent Info.plist had no background/agent flags, so the exact missing-Dock runtime cause is not established by the screenshots. Preserve background error and caption focus safety; no unconditional focus stealing or real capture in checks.

Finite checks: Node tests (30 seconds), UI suite with compact viewport regression (90 seconds), separate `release/window-fix` packaging (180 seconds), exact archive/arm64 inspection (30 seconds), and hidden temporary-profile desktop smoke (60 seconds). The smoke checks actual bounds, focusability, Dock visibility, and menu data without clicking the native menu bar or taking screenshots. Each unit permits initial plus two focused repairs for this source change. Reuse unchanged frontend build/native/backend/model/icon evidence; no dependency changes. Record actual OS menu-bar appearance as untested by the agent. Preserve existing uncommitted work and running apps.

WV1/WD1 complete: eleven Node tests and twelve UI tests passed on execution 1, including work-area separation for five display layouts and scrolling controls at 480×600. Packaging `release/window-fix/kotonoha-darwin-arm64/kotonoha.app` passed on execution 1 and reuses runtime `b6cd2528b334e6b4`. Final main/window-action/layout archive bytes match source. Parent LSUIElement/LSBackgroundOnly are false, the native helper remains an agent, and arm64 inspection passed for 33 bundled components plus Python/NeMo. Hidden packaged smoke passed on execution 1: Dock visibility true, controller focusable with bounds (720,73,480,640), subtitles (410,754,1100,240), 41 px separation, work area (0,31,1920,1003), valid kotonoha application menu, both models ready, capture stopped, and zero renderer errors. No actual OS menu-bar inspection or recording was performed. Official Electron activation-policy documentation and installed Electron 44.7.2 typings informed implementation; BrowserWindow documentation access failed in the web tool and succeeded through the required trafilatura fallback. No frontend/native/backend source changed, so their unaffected build/inference checks were reused. Documentation and whitespace review passed. Recommended operation check after completion (not performed): quit the previous build, open the window-fix artifact, and confirm Dock presence plus the kotonoha menu at upper left while using the controller; the controller should sit above subtitles on launch. No running app was terminated or overwritten.
