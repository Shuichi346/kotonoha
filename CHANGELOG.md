# Changelog

## 2026-10-16

### Added

- Added an arm64 macOS app with independent transparent, always-on-top translated subtitles and a separate control window.
- Added system-output capture through ScreenCaptureKit, streaming NeMo transcription, and local MLX TranslateGemma translation.
- Added language and caption controls, click-through mode, menu-bar shortcuts, in-memory history, and TXT/SRT export.
- Added authenticated local services, bounded queues, final utterance flush, process cleanup, local model preparation, and scripted verification.
- Added an English implementation plan documenting the delivered architecture, dependency-ordered steps, acceptance evidence, bounded verification, and resumption rules.

### Changed

- Renamed the application to kotonoha and retained legacy subtitle preferences without modifying the old profile.
- Added a persisted Japanese/English interface preference, defaulting to Japanese and independent of translation languages, across windows, menus, and service messages.
- Replaced the app icon with the supplied cropped emblem, the menu-bar text with a Retina leaf template icon, and the subtitle toolbar gear with sliders.

### Fixed

- Corrected duplicate Retina scaling that clipped the 2x menu-bar leaf icon, and added transparent-margin and silhouette regression checks.
