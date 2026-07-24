#!/usr/bin/env bash
# Foxy Jumpscare - undo everything install.sh set up: stop it, remove the
# autostart entry, the menu entry, the installed copy, and the settings.
#
# Double-click it (choose "Run"), or from a terminal:  bash uninstall.sh
set -uo pipefail

APP="FoxyJumpscare"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

pkill -x "$APP" 2>/dev/null || true
rm -f  "$CONFIG_HOME/autostart/foxyjumpscare.desktop"
rm -f  "$DATA_HOME/applications/foxyjumpscare.desktop"
rm -rf "$DATA_HOME/$APP"
rm -rf "$CONFIG_HOME/FoxyJumpscare"   # saved settings + countdown

echo "Foxy Jumpscare removed. It will not come back at login."
