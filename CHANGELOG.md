# Changelog

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
