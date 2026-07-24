#!/usr/bin/env bash
# Foxy Jumpscare - one-time setup for Linux.
#
# Run this ONCE. It copies the app to a permanent location, makes it launch
# itself at every login, and starts it right now. After this you never touch a
# terminal again and you can delete the folder you extracted this from.
#
# Double-click it in your file manager (choose "Run"), or from a terminal:
#     bash install.sh
set -euo pipefail

APP="FoxyJumpscare"
SRC="$(cd "$(dirname "$0")" && pwd)"

# Respect XDG overrides but fall back to the standard locations. These match
# where the app itself looks, so the in-app "Run at startup" checkbox and this
# script manage the exact same autostart file.
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DEST="$DATA_HOME/$APP"
BIN="$DEST/$APP"

if [ ! -f "$SRC/$APP" ]; then
  echo "error: '$APP' is not next to this script." >&2
  echo "Run install.sh from inside the extracted FoxyJumpscare folder." >&2
  exit 1
fi

echo "Installing Foxy Jumpscare..."

# 1. Permanent home, so deleting or moving the download can't break autostart.
mkdir -p "$DEST"
cp -f "$SRC/$APP" "$DEST/"
cp -f "$SRC/foxy.mp4" "$DEST/"
if [ -f "$SRC/foxy.ico" ]; then cp -f "$SRC/foxy.ico" "$DEST/"; fi
chmod +x "$BIN"

# 2. Launch at every login. XDG autostart is honoured by GNOME, KDE, XFCE,
#    Cinnamon, MATE, etc. This is the same file the in-app checkbox writes.
mkdir -p "$CONFIG_HOME/autostart"
cat > "$CONFIG_HOME/autostart/foxyjumpscare.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Foxy Jumpscare
Exec="$BIN"
Icon=$DEST/foxy.ico
Terminal=false
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF

# 3. App-menu entry, so Settings is reachable without ever opening a terminal.
mkdir -p "$DATA_HOME/applications"
cat > "$DATA_HOME/applications/foxyjumpscare.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Foxy Jumpscare
Comment=Rare fullscreen jumpscare - open settings
Exec="$BIN" --settings
Icon=$DEST/foxy.ico
Terminal=false
Categories=Utility;
EOF

# 4. Start it now, detached, so a reboot isn't needed to prove it works and
#    closing this terminal (if you used one) won't kill it.
pkill -x "$APP" 2>/dev/null || true
nohup "$BIN" >/dev/null 2>&1 &
disown 2>/dev/null || true

echo
echo "Done."
echo "  - It's running now, and starts on its own every time you log in."
echo "  - Installed to: $DEST"
echo "  - You can delete the folder you extracted this from."
echo "  - Find it later: open your app menu and search 'Foxy' (opens settings)."
echo "  - Turn it off for good: run uninstall.sh (next to this file)."
