#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPO="https://github.com/amurcanov/proxy-turn-vk-android"
UPSTREAM_SHA="51057cc552cdb7db4fee8cc04e6feb84569490b5"   # pinned; bump deliberately + re-test the patch
SRC_SUBDIR="app/src/main/assets/linux-server"

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/wdtt-server}"
PATCH="$HERE/wdtt-swgpanel.patch"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[wdtt] cloning $UPSTREAM_REPO @ $UPSTREAM_SHA"
git clone --quiet "$UPSTREAM_REPO" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$UPSTREAM_SHA"

cd "$WORK/src/$SRC_SUBDIR"
echo "[wdtt] applying wdtt-swgpanel.patch"
patch -p1 < "$PATCH"

echo "[wdtt] building static binary (GOARCH=${GOARCH:-host})"
export CGO_ENABLED=0 GOOS=linux
[ -n "${GOARCH:-}" ] && export GOARCH
go build -trimpath -ldflags="-s -w" -o "$OUT" .

echo "[wdtt] built: $OUT"
"$OUT" -h 2>&1 | grep -E '^\s+-(iface|wg-addr|desired|no-nat|max-passwords)' || true
