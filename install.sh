#!/usr/bin/env bash
# TouchRoute installer.
#   curl -fsSL https://raw.githubusercontent.com/lalomorales22/touchroute/main/install.sh | bash
# Options (after `bash -s --`):  --no-login   don't start TouchRoute when you log in
set -euo pipefail

REPO="lalomorales22/touchroute"
APP_NAME="TouchRoute"
LOGIN=1
for arg in "$@"; do
  case "$arg" in
    --no-login) LOGIN=0 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) ;;
  Linux) fail "TouchRoute for Linux is coming soon (up to 5 fingers). Watch https://github.com/$REPO" ;;
  MINGW* | MSYS* | CYGWIN*) fail "TouchRoute for Windows is coming soon (up to 5 fingers). Watch https://github.com/$REPO" ;;
  *) fail "TouchRoute doesn't support $(uname -s) yet." ;;
esac

[ "$(uname -m)" = "arm64" ] || fail "This build is for Apple silicon Macs. Intel support is coming."

URL="https://github.com/$REPO/releases/latest/download/TouchRoute-macos-arm64.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading TouchRoute…"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip" || fail "Download failed. Check your connection, or grab the app from https://github.com/$REPO/releases"
ditto -x -k "$TMP/app.zip" "$TMP"
[ -d "$TMP/$APP_NAME.app" ] || fail "The download didn't contain $APP_NAME.app."

DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }

pkill -x touchroute 2>/dev/null || true
rm -rf "$DEST/$APP_NAME.app"
ditto "$TMP/$APP_NAME.app" "$DEST/$APP_NAME.app"
# The app isn't notarized yet; this keeps macOS from refusing to open it.
xattr -dr com.apple.quarantine "$DEST/$APP_NAME.app" 2>/dev/null || true
say "Installed to $DEST/$APP_NAME.app"

AGENT="$HOME/Library/LaunchAgents/com.lalomorales.touchroute.plist"
if [ "$LOGIN" = 1 ]; then
  mkdir -p "$(dirname "$AGENT")"
  cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lalomorales.touchroute</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/open</string><string>-a</string><string>$DEST/$APP_NAME.app</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
  say "TouchRoute will start when you log in. (Remove $AGENT to stop that.)"
fi

open "$DEST/$APP_NAME.app"

if ! command -v claude >/dev/null 2>&1; then
  echo
  echo "Tip: install Claude Code to set up touches by describing them: https://claude.com/claude-code"
fi
echo
say "Done. Look for the dots in the top right of your screen."
say "Try it: hold five fingers still on your trackpad for five seconds, then let go."
