#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "${1:-}" in
    ""|--check) ;;
    --help|-h)
        echo 'Usage: ./scripts/build-app.sh [--check]'
        echo 'Check prerequisites, install locked dependencies, prepare models, and build a local arm64 app.'
        echo '--check only checks tools; it does not install dependencies or download models.'
        exit 0 ;;
    *) echo "Unknown option: $1 (use --help)" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then echo 'Only one option is supported.' >&2; exit 2; fi

failures=0
output=''
problem() {
    echo "ERROR: $*" >&2
    failures=$((failures + 1))
}
probe() {
    printf '\n> '
    printf '%q ' "$@"
    printf '\n'
    # Bound tool diagnostics without starting services or recording.
    if output=$(/usr/bin/perl -e 'alarm shift; exec @ARGV or die $!' 30 "$@"); then
        printf '%s\n' "$output"
    else
        printf '%s\n' "$output" >&2
        problem "Command failed: $*"
        return 1
    fi
}
minimum_version() {
    local actual="$1" minimum="$2" label="$3"
    local major minor patch required_major required_minor required_patch
    if [[ ! "$actual" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        problem "Cannot read $label version: $actual (requires $minimum or later)."
        return
    fi
    major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"
    IFS=. read -r required_major required_minor required_patch <<< "$minimum"
    if (( major < required_major || (major == required_major && minor < required_minor) ||
          (major == required_major && minor == required_minor && patch < required_patch) )); then
        problem "$label $minimum or later is required (found $actual)."
    fi
}

echo 'kotonoha — local app build / ローカルアプリ作成'
if probe uname -s; then
    [[ "$output" == Darwin ]] || problem 'macOS 26 or later is required.'
fi
if probe uname -m; then
    [[ "$output" == arm64 ]] || problem 'Use an Apple silicon Mac and a native arm64 terminal (disable Rosetta).'
fi
if probe sw_vers -productVersion; then
    if [[ "$output" =~ ^([0-9]+)\. ]]; then
        (( BASH_REMATCH[1] >= 26 )) || problem 'macOS 26 or later is required.'
    else
        problem "Cannot read macOS version: $output"
    fi
fi
probe git --version || :
if probe xcrun swift --version; then
    [[ "$output" == *'Target: arm64-apple-macosx'* ]] || problem 'An arm64 macOS Swift toolchain is required.'
fi
if probe xcrun --sdk macosx --show-sdk-version; then
    if [[ "$output" =~ ^([0-9]+)\. ]]; then
        (( BASH_REMATCH[1] >= 26 )) || problem 'A macOS 26 or later SDK is required; select a current Xcode toolchain.'
    else
        problem "Cannot read macOS SDK version: $output"
    fi
fi
if probe node --version; then minimum_version "$output" 26.5.0 Node.js; fi
if probe npm --version; then minimum_version "$output" 12.0.1 npm; fi
probe uv --version || :

# Match backend/config.py, including explicit installations outside PATH.
nemo="${NEMO_SPEECH_BIN:-}"
if [[ -z "$nemo" ]]; then
    nemo="$(command -v nemo-speech || true)"
    if [[ -z "$nemo" && -x "$HOME/.local/bin/nemo-speech" ]]; then nemo="$HOME/.local/bin/nemo-speech"; fi
fi
if [[ -n "$nemo" && "$nemo" == /* && -x "$nemo" ]]; then
    export NEMO_SPEECH_BIN="$nemo"
    probe "$nemo" --version || :
    if probe "$nemo" doctor; then
        [[ "$output" =~ (^|[[:space:]])backend_metal([[:space:]]|$) ]] || problem 'nemo-speech must include backend_metal support.'
    fi
    probe xcrun lipo -verify_arch arm64 "$nemo" || :
else
    problem 'Install the arm64 Metal-enabled nemo-speech CLI, or set NEMO_SPEECH_BIN to its absolute executable path.'
fi

if (( failures > 0 )); then
    printf '\nPrerequisite checks failed (%s). See README.md / README_ja.md; fix the tools and rerun.\n' "$failures" >&2
    exit 1
fi
printf '\nPrerequisite checks passed. / 環境チェックに成功しました。\n'
if [[ "${1:-}" == --check ]]; then exit 0; fi

# Each invocation keeps previous packages intact, including the legacy default path.
export KOTONOHA_PACKAGE_OUT="${KOTONOHA_PACKAGE_OUT:-$ROOT/release/build-$(date +%Y%m%d-%H%M%S)-$$}"
app="$KOTONOHA_PACKAGE_OUT/kotonoha-darwin-arm64/kotonoha.app"
if [[ -e "$app" || -L "$app" ]]; then
    echo "Refusing to replace an existing app: $app. Choose another KOTONOHA_PACKAGE_OUT." >&2
    exit 1
fi
export UV_PROJECT_ENVIRONMENT="$ROOT/.venv"
step=''
trap 'status=$?; printf "\nBuild failed at: %s (exit %s). Fix the reported error and rerun.\n" "$step" "$status" >&2; exit "$status"' ERR
run() {
    step="$*"
    printf '\n> %s\n' "$step"
    "$@"
}
run npm ci
run npm run setup:electron
run uv sync --locked --python 3.13
run uv run --locked python -c 'import platform, sys; print(sys.version); print(platform.machine()); sys.exit(0 if sys.version_info[:2] == (3, 13) and platform.machine() == "arm64" else "Python 3.13 arm64 is required.")'
run npm run prepare:models
run npm run package
export KOTONOHA_CHECK_APP="$app"
run npm run check:architecture
if [[ ! -x "$app/Contents/MacOS/kotonoha" || ! -f "$app/Contents/Resources/runtime.json" ]]; then
    echo "Incomplete app bundle: $app" >&2
    exit 1
fi
printf '\nApp created / アプリを作成しました:\n%s\n' "$app"
echo 'Move it to /Applications on this Mac, then open it in Finder. / このMacの /Applications へ移動し、Finderで開いてください。'
