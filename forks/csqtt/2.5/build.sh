#!/usr/bin/env bash
# Сборка csqtt ветки 2.5. См. ../README.md.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CSQTT_REPO="https://github.com/Afteroid/csqttr.git" \
CSQTT_PIN="001caa48e342caac8758db8ed4d12305faea6954" \
CSQTT_PATCH="$HERE/csqtt-swgpanel-2.5.3.patch" \
CSQTT_SRC_FALLBACK="https://github.com/SanityProtocol/swg-panel/releases/download/csqtt-2.5.3/csqtt-2.5.3-swgpanel-src.tar.gz 6b2ee135f7fb6b4cdd0c30b0f44fc8643eb1f459806b37e75cd630523735c5ad 7860f56b81de843c8943c271c3e1e8212666f1afce5d3b2a9098650a6b08a2ad" \
  exec bash "$HERE/../build.sh" "$@"
