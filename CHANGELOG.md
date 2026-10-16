# Changelog

## 2026-10-16

### Added

- Added a Japanese/English first-use audio permission guide with separate permission, confirmation, and translation actions, settings access, and retry guidance.
- Added an arm64 macOS app with independent transparent, always-on-top translated subtitles and a separate control window.
- Added system-output capture through ScreenCaptureKit, streaming NeMo transcription, and local MLX TranslateGemma translation.
- Added language and caption controls, click-through mode, menu-bar shortcuts, in-memory history, and TXT/SRT export.
- Added authenticated local services, bounded queues, final utterance flush, process cleanup, local model preparation, and scripted verification.
- Added an English implementation plan documenting the delivered architecture, dependency-ordered steps, acceptance evidence, bounded verification, and resumption rules.

### Changed

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
