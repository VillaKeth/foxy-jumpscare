#!/bin/bash
# Runs INSIDE the verification container. Builds the Avalonia app, then proves
# the three things a compile cannot: idle detection returns a climbing value,
# the settings window renders, and the overlay decodes video fullscreen.
#
# Mounts:  /src  read-only source        /out  screenshots + logs come back here
# Exits non-zero if any check fails, so this is usable as a gate.
set -u

SRC=/src
WORK=/work
OUT=${OUT:-/out}
FAIL=0

note() { echo; echo "=== $* ==="; }
ok()   { echo "  PASS  $*"; }
bad()  { echo "  FAIL  $*"; FAIL=1; }

mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/*.log

note "distro"
( . /etc/os-release && echo "$PRETTY_NAME" )
dotnet --version

note "libvlc as the distro ships it"
# Deliberately checking that the UNVERSIONED symlink is absent: its presence
# would mean a -dev package is installed and the resolver is not being tested.
ls /usr/lib*/libvlc.so.5 /usr/lib*/*/libvlc.so.5 2>/dev/null | head -2
if ls /usr/lib*/libvlc.so /usr/lib*/*/libvlc.so >/dev/null 2>&1; then
  echo "  NOTE: unversioned libvlc.so present - resolver not exercised"
else
  ok "only libvlc.so.5 present, so VlcNative must do the work"
fi

note "build"
rm -rf "$WORK"; mkdir -p "$WORK/desktop"
cp -r "$SRC/desktop/FoxyJumpscare.Avalonia" "$WORK/desktop/"
cp -r "$SRC/desktop/FoxyJumpscare.Core" "$WORK/desktop/"
cp -r "$SRC/assets" "$WORK/"
find "$WORK" -type d \( -name bin -o -name obj \) -exec rm -rf {} + 2>/dev/null
cd "$WORK/desktop/FoxyJumpscare.Avalonia" || exit 1

if dotnet build -c Release 2>&1 | tee "$OUT/build.log" | tail -4; then
  grep -q " 0 Error(s)" "$OUT/build.log" && ok "builds clean" || bad "build errors"
else
  bad "build failed"
fi
BIN="$WORK/desktop/FoxyJumpscare.Avalonia/bin/Release/net8.0"

note "X server with MIT-SCREEN-SAVER, plus a window manager"
Xvfb :99 -screen 0 1920x1080x24 >"$OUT/xvfb.log" 2>&1 &
sleep 3
export DISPLAY=:99
openbox >"$OUT/openbox.log" 2>&1 &
sleep 2
xdpyinfo | grep -q MIT-SCREEN-SAVER \
  && ok "MIT-SCREEN-SAVER present" || bad "no MIT-SCREEN-SAVER - idle cannot be tested"
xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id" \
  && ok "window manager running" || bad "no WM - fullscreen cannot be tested"

note "idle detection (no input, so it must climb)"
IDLE=$(dotnet "$BIN/FoxyJumpscare.dll" --probe-idle 2>&1 | tee "$OUT/probe.log" | grep -oP '(?<=idle      : )[0-9.]+')
echo "$IDLE" | tr '\n' ' '; echo
FIRST=$(echo "$IDLE" | head -1); LAST=$(echo "$IDLE" | tail -1)
# Six samples 500ms apart: a working read ends near 2.5s. A per-call
# reconnect resets the counter and pins every sample at ~0.5s.
awk -v a="$FIRST" -v b="$LAST" 'BEGIN { exit !(b > a + 1.5) }' \
  && ok "idle climbs ($FIRST -> $LAST)" \
  || bad "idle did not climb ($FIRST -> $LAST) - X connection is being reopened"

note "settings window renders"
timeout 40 dotnet "$BIN/FoxyJumpscare.dll" --settings >"$OUT/settings.log" 2>&1 &
APP=$!
sleep 12
import -display :99 -window root "$OUT/settings.png" 2>/dev/null
# -tree, not -children: a window manager reparents the app window into its own
# frame, so the only immediate child of root is openbox's decoration and the
# real title sits a level deeper.
if xwininfo -root -tree 2>/dev/null | grep -q "Foxy Jumpscare"; then
  ok "window mapped with the right title"
else
  bad "no Foxy Jumpscare window on screen"
fi
kill $APP 2>/dev/null; wait $APP 2>/dev/null

note "overlay decodes video, fullscreen"
export FOXY_TRACE=1
timeout 40 dotnet "$BIN/FoxyJumpscare.dll" --test-scare >"$OUT/scare.log" 2>&1 &
APP=$!
sleep 1.2
BEST=0
for i in $(seq -w 1 10); do
  import -display :99 -window root "$OUT/frame-$i.png" 2>/dev/null
  M=$(identify -format '%[fx:mean]' "$OUT/frame-$i.png" 2>/dev/null || echo 0)
  awk -v m="$M" -v b="$BEST" 'BEGIN { exit !(m > b) }' && BEST=$M && cp "$OUT/frame-$i.png" "$OUT/overlay.png"
  sleep 0.35
done
wait $APP 2>/dev/null

FRAMES=$(grep -oP '(?<=closing: )\d+(?= frames)' "$OUT/scare.log" | tail -1)
FRAMES=${FRAMES:-0}
[ "$FRAMES" -gt 0 ] && ok "$FRAMES frames decoded" || bad "0 frames - libvlc did not load or decode"
grep -q "Unable to load shared library 'libvlc'" "$OUT/scare.log" \
  && bad "libvlc could not be resolved" || ok "libvlc resolved"
# A fullscreen 1920x1080 scare is far brighter than a corner-sized one; pure
# black means nothing was ever painted.
awk -v m="$BEST" 'BEGIN { exit !(m > 0.06) }' \
  && ok "overlay covers the screen (peak mean $BEST)" \
  || bad "overlay too dark or too small (peak mean $BEST) - not fullscreen?"

pkill openbox 2>/dev/null; pkill Xvfb 2>/dev/null
note "result"
[ $FAIL -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
