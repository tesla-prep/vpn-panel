#!/usr/bin/env bash
# Сборка qWDTT из зафиксированного коммита. См. README.md.
set -euo pipefail

UPSTREAM_REPO="https://github.com/SpaceNeuroX/proxy-turn-vk-android"
UPSTREAM_SHA="a296c57eaba69bb9479a24f9157856490890e47d"   # v1.4.4, 2026-09-13; our build label 1.4.4-2. Bump deliberately + re-test the patch
SRC_SUBDIR="server"       # was "." — server.go + admin_api.go moved here in v1.4.3

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/qwdtt-server}"
PATCH="$HERE/qwdtt-swgpanel.patch"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[qwdtt] cloning $UPSTREAM_REPO @ $UPSTREAM_SHA"
git clone --quiet "$UPSTREAM_REPO" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$UPSTREAM_SHA"

cd "$WORK/src/$SRC_SUBDIR"
echo "[qwdtt] applying qwdtt-swgpanel.patch"
patch -p1 < "$PATCH"

echo "[qwdtt] building static binary (GOARCH=${GOARCH:-host})"
export CGO_ENABLED=0 GOOS=linux
[ -n "${GOARCH:-}" ] && export GOARCH
go build -trimpath -ldflags="-s -w" -o "$OUT" .

echo "[qwdtt] built: $OUT"
"$OUT" -h 2>&1 | grep -E '^\s+-(iface|wg-addr|desired|no-nat|max-passwords|fixed-config|api-addr|raw-iface|raw-addr)' || true
