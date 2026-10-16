#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/bin/LiveCaptionAudio.app"
BINARY="$APP/Contents/MacOS/audio-capture"
mkdir -p "$APP/Contents/MacOS" "$ROOT/.build/module-cache"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
SWIFTC="$(xcrun --find swiftc)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
# The alarm bounds compilation and survives exec into swiftc.
/usr/bin/perl -e 'alarm shift; exec @ARGV or die $!' 120 "$SWIFTC" \
    -swift-version 6 -parse-as-library -O -target arm64-apple-macosx26.0 -sdk "$SDK" \
    -module-cache-path "$ROOT/.build/module-cache" \
    -framework ScreenCaptureKit -framework AVFAudio -framework CoreMedia -framework CoreGraphics \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/Info.plist" \
    "$ROOT/Sources/AudioCapture.swift" -o "$BINARY"
/usr/bin/codesign --force --sign - --identifier jp.realtime-translation.audio-capture "$APP"
cat > "$ROOT/bin/audio-capture" <<'WRAPPER'
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/LiveCaptionAudio.app/Contents/MacOS/audio-capture" "$@"
WRAPPER
chmod +x "$ROOT/bin/audio-capture"
/usr/bin/file "$BINARY"
/usr/bin/lipo -verify_arch arm64 "$BINARY"
if [[ "$(/usr/bin/lipo -archs "$BINARY")" != "arm64" ]]; then
    echo "Unexpected non-arm64 architecture in audio capture helper." >&2
    exit 1
fi
if [[ "${1:-}" == "--verify" ]]; then
    /usr/bin/perl -e 'alarm shift; exec @ARGV or die $!' 15 "$ROOT/bin/audio-capture" --self-test
    /usr/bin/perl -e 'alarm shift; exec @ARGV or die $!' 15 "$ROOT/bin/audio-capture" --check
fi
