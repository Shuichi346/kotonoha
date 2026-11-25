# Changelog

## 2026-11-21

### Fixed

- Drained the capture helper's remaining PCM before the final ASR commit, and sized stop deadlines for the active translation plus all three waiting utterances.
- Interrupted and reaped timed-out/cancelled translation work before permitting restart, with a shared request deadline and cleanup of the owned engine/socket.
- Preserved staged relative Python aliases and invalidated older staging fingerprints; architecture verification now inspects the runtime selected by the app manifest.
- Retained history rows by subtitle ID and avoided repeated timestamp formatting during partial recognition updates.
- Batched preference writes asynchronously with atomic replacement and quit flushing; rebuilt native menus and notified the backend only when the interface language changed.
- Restored the installed app's missing local runtime snapshot so its authenticated backend and audio-permission helper could start again.
- Opened permission setup after unknown or failed access checks, kept explicit request/settings actions reachable, invalidated stale capture authorization, and preserved successful permission results before model status became available.
- Distinguished missing runtime and unavailable backend failures from audio authorization across Electron IPC, including startup errors before the renderer loads; blocked translation and replaced misleading permission prompts with localized service recovery guidance.
- Documented AppCleaner-before-build ordering and settings-only reset, and verified the current source build workflow without generated project files.

### Changed

- Revised both root READMEs around current features, prerequisites, installation, and usage; removed preference-migration and obsolete runtime narratives, simplified setup explanations, and grouped custom-path configuration under Development.
- Updated Electron to 45.4.1, Playwright to 1.65.1, Vite to 8.3.8, FastAPI to 0.165.0, Hugging Face Hub to 2.4.0, websockets to 17.4, and Python development tools to their latest stable releases. Refreshed compatible transitive dependencies in both lockfiles, preserved exact npm pins, and made asynchronous fixture scope explicit.
- Extended hidden packaged startup verification to check the actual Electron runtime version against its dependency pin; produced a separate arm64 local build using the updated dependency graph.
- Raised the application/backend version to 0.2.0 for the PLaMo migration, synchronized npm/uv metadata, and derived macOS app/build versions from package.json to keep About/Finder version information aligned.
- Replaced Hy-MT2/MLX translation with the requested pinned PLaMo 3 Translate 0.8B Q8_0 GGUF through a persistent, authenticated llama.cpp Metal worker on a private Unix socket. Added exact-file download/hash verification and the installed llama.cpp build prerequisite; removed MLX Python dependencies.
- Updated model labels and operating documentation, limited language choices to model-supported pairs, and migrated saved Portuguese language fields while retaining caption appearance. Created a separate verified arm64 app without replacing previous builds.

## 2026-10-17

### Fixed

- Automatically selected five backup ports per local service when the primary port was occupied; updated all HTTP/WebSocket connections to the selected ports and replaced old-app conflict guidance with localized exhaustion instructions.
- Enlarged initial and retry permission requests into full-width red buttons and moved retry above auxiliary actions.
- Centered tab labels within visible 44 px high click targets and removed invisible spacing from empty history counts; retained keyboard navigation.

### Added

- Added `scripts/build-app.sh` to check tools and compatibility, install locked dependencies, prepare shared models, build a separate local app, and verify arm64 support in one invocation; added `--check` for diagnostics only.

### Changed

- Moved local app packaging before installation/launch in both READMEs and documented the single-command workflow and generated-artifact startup check.
- Renamed the local repository folder to kotonoha, repaired virtual-environment paths, and aligned the Python project name and README clone directory examples.

## 2026-10-16

### Added

- Added a Settings tab with the interface Language selector and a saved 5/10/15/20/30-second finalization request interval, applied on the next translation start with the existing 15-second default.
- Added a Japanese/English first-use audio permission guide with separate permission, confirmation, and translation actions, settings access, and retry guidance.
- Added an arm64 macOS app with independent transparent, always-on-top translated subtitles and a separate control window.
- Added system-output capture through ScreenCaptureKit, streaming NeMo transcription, and local MLX TranslateGemma translation.
- Added language and caption controls, click-through mode, menu-bar shortcuts, in-memory history, and TXT/SRT export.
- Added authenticated local services, bounded queues, final utterance flush, process cleanup, local model preparation, and scripted verification.
- Added an English implementation plan documenting the delivered architecture, dependency-ordered steps, acceptance evidence, bounded verification, and resumption rules.

### Changed

- Switched model preparation and loading to per-user shared Hugging Face/NeMo caches, reused the installed NeMo CLI, and removed model copies from new runtime snapshots while preserving existing files.
- Documented per-user clone/build prerequisites, tool installation, shared-cache behavior, and moving a locally built app into Applications in both READMEs.
- Replaced TranslateGemma 4B with the pinned Hy-MT2 1.8B MLX 4bit model, its native translation prompt/EOS, recommended sampling settings, and a 512-token subtitle cap with localized overflow errors.
- Updated model readiness labels and preparation, and limited new runtime snapshots to the selected translator and ASR model while retaining previous models and app builds.
- Reduced the initial controller to at most 480×640 and placed it in a separate band above subtitles, adapting to the display work area.
- Explicitly enabled regular macOS Dock/menu behavior and application activation when restoring controls through a user action.
- Changed new subtitle defaults to 30 px with original text off, preserved saved preferences, and enabled the locked subtitle window on normal startup.
- Kept the interface-language selector labeled `Language` in both Japanese and English for discoverability.
- Renamed the application to kotonoha and retained legacy subtitle preferences without modifying the old profile.
- Added a persisted Japanese/English interface preference, defaulting to Japanese and independent of translation languages, across windows, menus, and service messages.
- Replaced the app icon with the supplied cropped emblem, the menu-bar text with a Retina leaf template icon, and the subtitle toolbar gear with sliders.

### Fixed

- Restricted controller toggle clicks to the switch itself so descriptions and row whitespace no longer change settings; retained keyboard access and accessible names.
- Replaced raw recording-permission failures with localized setup guidance and blocked model loading/capture until access is confirmed; permission requests no longer start translation.
- Removed the packaged startup dependency on the protected Documents checkout by staging the local runtime in Application Support.
- Guarded controller activation after window destruction and during shutdown, and prevented background errors from forcing focus or opening a blocking startup error dialog.
- Started subtitles hidden and click-through, replaced the screen-saver level with floating, and reset mouse/keyboard input on hide, error, stop, and quit.
- Made empty subtitle windows light gray without hover and exposed unlocked positioning bounds; locked caption playback disables drag regions and preserves transparency.
- Corrected duplicate Retina scaling that clipped the 2x menu-bar leaf icon, and added transparent-margin and silhouette regression checks.
