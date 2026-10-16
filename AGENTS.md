# Project instructions

- Use `PLANS.md` as the authoritative implementation and acceptance tracker. Reconcile its completed items with current evidence before resuming work; keep rationale in `NOTES.md` and do not duplicate progress checklists elsewhere.
- This project creates an Apple silicon macOS 26+ local desktop app. Keep the subtitle view independent from the controller and other video applications. Keep its canvas transparent and its persistent UI limited to caption text.
- Use Node.js 26.5+ / npm 12.0.1+, the committed npm lockfile, and Python 3.13 through `uv` with `uv.lock`. The packaged `.app` resolves its Python runtime from this checkout via `Contents/Resources/runtime.json`; it is a local development build.
- `npm run build` checks frontend types and builds Vite. `npm test` runs finite scripted UI tests. Backend checks are `uv run --locked python -m pytest -q`, `uv run --locked ruff check backend`, and `uv run --locked ruff format --check backend`. Native verification is `./native/build.sh --verify`; inspect packaged architecture with `npm run check:architecture`.
- Do not start real system audio capture during automated checks. `native/bin/audio-capture --check` never prompts. Actual capture begins only from an explicit user Start action.
- Preserve the PCM contract: stdout contains only little-endian 16 kHz mono PCM16; stderr contains diagnostics. Preserve odd-byte remainders between pipe reads and drain output during shutdown.
- Keep both local services on loopback, authenticate HTTP/WebSocket clients, keep credentials in Electron main, and do not log WebSocket query tokens. Own and terminate the Python process group on quit.
- The NeMo launch must enable token-silence endpointing. TranslateGemma requires structured language content and the `<end_of_turn>` EOS token. Preserve the final commit and translation drain before reporting stopped.
- Keep models and generated builds ignored. Preserve only the latest 1,000 transcript entries in memory; no automatic recording or transcript file writes.
