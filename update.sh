#!/usr/bin/env bash
# update.sh -- update an existing panel or node from tesla-prep/vpn-panel.

{
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$repo/scripts/update.sh" ] && [ -f "$repo/scripts/lib/common.sh" ]; then
  exec bash "$repo/scripts/update.sh" "$@"
fi

bootstrap="$(mktemp)"
trap 'rm -f "$bootstrap"' EXIT
export SWG_BOOTSTRAP_URL="${SWG_BOOTSTRAP_URL:-https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/bootstrap.sh}"
curl -fsSL --connect-timeout 20 --max-time 120 "$SWG_BOOTSTRAP_URL" -o "$bootstrap"
bash "$bootstrap" update "$@"
exit
}
