#!/usr/bin/env bash
# Статическая сборка серверной части WDTT. См. README.md.
set -euo pipefail

PIN="${WDTT_ILDARMAGA_PIN:-ef697994bc7ac650b81623484933d930c5cd766b}"   # pinned upstream commit
REPO="https://github.com/ildarmaga/wdtt.git"
HERE="$(cd "$(dirname "$0")" && pwd)"
PATCH="$HERE/wdtt-ildarmaga.patch"
WORK="${WDTT_BUILD_DIR:-$(mktemp -d)}"
ARCH="${GOARCH:-amd64}"
OUT="${1:-$HERE/wdtt-ildarmaga-server-$ARCH}"

echo "[build] clone $REPO @ $PIN"
git clone --quiet "$REPO" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$PIN"

echo "[build] apply $PATCH"
git -C "$WORK/src" apply "$PATCH"

echo "[build] compile server-only, static (GOARCH=$ARCH, CGO off)"
( cd "$WORK/src/server" && GOWORK=off CGO_ENABLED=0 GOARCH="$ARCH" go build -trimpath -o "$OUT" ./cmd )

echo "[build] done -> $OUT"
sha256sum "$OUT"
