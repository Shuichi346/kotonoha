# Local backend

Use Python 3.13 and `uv sync --locked`. The project-local interpreter and MLX native extension run as arm64. `npm run prepare:models` downloads TranslateGemma and the pinned Nemotron GGUF into ignored `models/`. `NEMO_SPEECH_BIN` can override the installed native CLI. NeMo's cache override is `NEMO_SPEECH_MODEL_DIR`, always set to this workspace's `models/asr`.

Electron sets a random `RT_TOKEN` and starts `.venv/bin/python -m backend.app`. The backend listens only on `127.0.0.1:8765`. It refuses CLI startup without a token. HTTP requests require `Authorization: Bearer TOKEN`; the WebSocket uses `/api/live?token=TOKEN`. Access logging is disabled to avoid logging query credentials. Do not expose either local listener to the network.

`GET /api/status` returns `{capture, asr, translation}`, each with `ready` and `detail`. Capture uses the native helper's bounded, nonprompting `--check` and includes `permission`. Status does not load either model. `POST /api/capture/permission` requires the same Bearer authentication and returns a top-level capture status. It invokes only `--request-permission`, with a 60-second deadline and process cleanup. Concurrent permission requests are deduplicated, and an active session permits only a nonprompting check. Both endpoints honor `Accept-Language` for detail text.

The WebSocket accepts `{type:"start", source:"en", target:"ja", ui_language:"ja"}` and `{type:"stop"}`. The optional UI language defaults to Japanese; `Accept-Language` selects readiness detail language, and `{type:"ui_language", ui_language:"en"}` changes subsequent socket messages immediately without changing transcription or translated subtitle content. Production uses port 8765; `RT_PORT=8767` is reserved for isolated, nonrecording desktop smoke tests. Events are `status` (`starting`, `listening`, `stopped`), `partial`, `subtitle` (`id`, `source`, `text`, `start`, `end`, `latency_ms`), `level` (0–1), and `error` (`message`). Only one session may own capture. A different socket cannot stop it. Disconnect drains and stops its session.

Start checks permission before loading models. Missing permission emits an error with `code: "capture_permission_required"` and a localized recovery message, then `stopped`; it never requests access implicitly. A native permission rejection after preflight uses the same structured error. Once permission is confirmed, the first start loads TranslateGemma onto one persistent MLX worker and starts an authenticated NeMo server at `127.0.0.1:8766` with Metal and token-silence endpointing enabled at 600 ms. Both models stay warm between sessions. System audio capture begins only after models and the ASR WebSocket are ready. PCM pipe boundaries are not audio-frame boundaries; the reader preserves split samples. Periodic 15-second commits bound continuous-speech context. Ordinary pauses can finalize much earlier through endpointing. Stop drains native output, commits the unfinished utterance, and translates remaining queued text before sending `stopped`.

The translation queue holds at most three waiting utterances. Saturation drops the oldest waiting utterance and emits a visible status message; active work and newest audio remain. Translation latency measures elapsed time from final-ASR receipt, including queue wait, and excludes the ASR/model startup period. Input/output timestamps are seconds on the capture timeline. The community TranslateGemma tokenizer requires explicitly adding `<end_of_turn>` to its EOS set; removing this produces repeated control tokens and unnecessary decoding.

Automated checks:

```sh
uv run --locked python -m pytest -q
uv run --locked ruff check backend
uv run --locked ruff format --check backend
```

A model-only smoke uses any mono 16 kHz PCM16 WAV, with an internal 120-second limit:

```sh
uv run --locked python -m backend.smoke /absolute/path/fixture.wav
```

This starts both actual models and never invokes system capture. A sandbox without GPU access can fail Metal initialization; run model inference in a context that permits the GPU. `backend.tests` use fakes and require neither GPU permission nor macOS recording permission. Actual system capture and OS permission UI are recommended user operation checks after implementation, not automated acceptance claims.

Development evidence (2026-10-16): eight deterministic tests passed; Ruff lint and format checks passed. Python 3.13.11, `mlx-lm` 0.32.1, MLX 0.32.4, NeMo-Speech.cpp 0.2.0. A real JFK fixture produced 99 partials, the expected English transcription, and Japanese translation in 26.83 seconds including startup. That run exposed missing turn-stop metadata; a focused regression now verifies EOS registration. Native recording was not started. The full real-model check was executed three times (two known sandbox Metal-denial failures, then one successful permitted run); avoid repeating that check without a concrete changed acceptance requirement.

A focused NeMo-only endpoint acceptance is available as `uv run --locked python -m backend.endpoint_smoke /absolute/path/fixture.wav`. It feeds the fixture plus one second of zero PCM, receives concurrently, never sends a client commit, and must receive a nonempty final within an overall 60-second limit. It does not load TranslateGemma or invoke system capture. The NeMo CLI's boolean `--asr.endpointing.enable` flag takes no following value; `true` is parsed as an unexpected argument.

Endpoint acceptance result (2026-10-16): passed on its second execution after repairing that boolean syntax. Actual Metal inference emitted `And so my fellow Americans` as a final at 3.30 seconds of processed audio, before any client commit; total startup and check time was 11.01 seconds. The first execution reported the unsupported `true` argument. This focused check verifies the updated production launch flags and 600 ms token-silence endpointing independently from the earlier full ASR→MLX smoke budget. No further rerun is needed while this behavior remains unchanged.

Branding/language update evidence (2026-10-16): ten deterministic tests passed, including localized readiness/error messages and preservation of transcript/subtitle content; Ruff checks passed. The existing real-model checks above were not rerun because inference mechanics were unchanged.
