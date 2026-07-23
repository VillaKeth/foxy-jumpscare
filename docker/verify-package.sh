#!/bin/bash
# Unpacks the shippable tarball on a machine with no .NET and runs it, the way
# the recipient would. Mount the archive at /pkg/FoxyJumpscare-linux-x64.tar.gz
# and a writable /out for screenshots.
set -u

OUT=${OUT:-/out}
FAIL=0
note() { echo; echo "=== $* ==="; }
ok()   { echo "  PASS  $*"; }
bad()  { echo "  FAIL  $*"; FAIL=1; }

mkdir -p "$OUT"; rm -f "$OUT"/*.png "$OUT"/*.log

note "the machine we are pretending to be"
( . /etc/os-release && echo "$PRETTY_NAME" )
if command -v dotnet >/dev/null 2>&1; then
  bad "dotnet is installed - this image cannot prove self-containment"
else
  ok "no dotnet on this machine, as intended"
fi

note "unpack, exactly as INSTALL.txt says"
cd /root || exit 1
TAR=$(ls /pkg/*.tar.gz 2>/dev/null | head -1)
[ -n "$TAR" ] || { bad "no tarball mounted at /pkg"; exit 1; }
echo "archive: $(basename "$TAR")  ($(du -h "$TAR" | cut -f1))"
tar -xzf "$TAR" || { bad "extract failed"; exit 1; }
cd FoxyJumpscare || { bad "expected a FoxyJumpscare/ directory in the archive"; exit 1; }
ls -la

# A tar built on Windows loses this, and the recipient hits "permission denied".
[ -x ./FoxyJumpscare ] && ok "binary is executable straight out of the archive" \
                       || bad "binary is not executable - recipient must chmod +x"

for f in foxy.mp4 foxy.ico INSTALL.txt; do
  [ -f "$f" ] && ok "$f shipped" || bad "$f missing from the archive"
done

note "X server and window manager"
Xvfb :99 -screen 0 1920x1080x24 >"$OUT/xvfb.log" 2>&1 &
sleep 3
export DISPLAY=:99
openbox >"$OUT/openbox.log" 2>&1 &
sleep 2

note "idle detection (no input, so it must climb)"
IDLE=$(./FoxyJumpscare --probe-idle 2>&1 | tee "$OUT/probe.log" | grep -oP '(?<=idle      : )[0-9.]+')
echo "$IDLE" | tr '\n' ' '; echo
FIRST=$(echo "$IDLE" | head -1); LAST=$(echo "$IDLE" | tail -1)
if [ -z "$FIRST" ]; then
  bad "the binary produced no output at all - did it even start?"
  head -20 "$OUT/probe.log"
else
  awk -v a="$FIRST" -v b="$LAST" 'BEGIN { exit !(b > a + 1.5) }' \
    && ok "runs with no .NET installed, idle climbs ($FIRST -> $LAST)" \
    || bad "idle did not climb ($FIRST -> $LAST)"
fi

note "settings window"
timeout 40 ./FoxyJumpscare --settings >"$OUT/settings.log" 2>&1 &
APP=$!
sleep 10
import -display :99 -window root "$OUT/settings.png" 2>/dev/null
xwininfo -root -tree 2>/dev/null | grep -q "Foxy Jumpscare" \
  && ok "settings window opens" || bad "no settings window"
kill $APP 2>/dev/null; wait $APP 2>/dev/null

note "the actual scare"
export FOXY_TRACE=1
timeout 40 ./FoxyJumpscare --test-scare >"$OUT/scare.log" 2>&1 &
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
[ "$FRAMES" -gt 0 ] && ok "$FRAMES frames decoded" || bad "0 frames decoded"
awk -v m="$BEST" 'BEGIN { exit !(m > 0.06) }' \
  && ok "scare covers the screen (peak mean $BEST)" \
  || bad "scare too dark or too small (peak mean $BEST)"

# Config must land in the XDG location INSTALL.txt tells them to delete.
note "leaves settings where we say it does"
find /root/.config -iname '*oxy*' 2>/dev/null | head -3
[ -d /root/.config/FoxyJumpscare ] && ok "config in ~/.config/FoxyJumpscare" \
                                   || bad "config not where INSTALL.txt claims"

pkill openbox 2>/dev/null; pkill Xvfb 2>/dev/null
note "result"
[ $FAIL -eq 0 ] && echo "SHIPPABLE" || echo "NOT SHIPPABLE YET"
exit $FAIL
