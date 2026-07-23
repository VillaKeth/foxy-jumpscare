#!/bin/bash
# Build and run the Linux verification containers. Run from a Linux shell with
# Docker (on this project that is WSL: `wsl -d Ubuntu -u root`).
#
#   ./docker/run-linux-verify.sh            # Ubuntu only
#   ./docker/run-linux-verify.sh all        # Ubuntu + Fedora
#
# Screenshots and logs land in docker/out/<distro>/.
set -u
cd "$(dirname "$0")" || exit 1
REPO=$(cd .. && pwd)

# The source is copied out of the repo rather than bind-mounted from it: on
# Windows the repo lives on /mnt/c, which is slow enough over 9p to skew the
# run, and a copy also keeps bin/obj from the host build out of the container.
STAGE=/tmp/foxy-src
rm -rf "$STAGE"; mkdir -p "$STAGE"
for d in desktop assets; do cp -r "$REPO/$d" "$STAGE/"; done
find "$STAGE" -type d \( -name bin -o -name obj -o -name node_modules \) -exec rm -rf {} + 2>/dev/null

run_one() {
  local name=$1 dockerfile=$2
  echo
  echo "############ $name ############"
  docker build -q -f "$dockerfile" -t "foxy-verify-$name" . || return 1
  mkdir -p "out/$name"
  docker run --rm \
    -v "$STAGE:/src:ro" \
    -v "$PWD/out/$name:/out" \
    "foxy-verify-$name"
}

RC=0
run_one ubuntu linux-verify.ubuntu.Dockerfile || RC=1
if [ "${1:-}" = "all" ]; then
  run_one fedora linux-verify.fedora.Dockerfile || RC=1
fi

echo
echo "artifacts in $PWD/out/"
exit $RC
