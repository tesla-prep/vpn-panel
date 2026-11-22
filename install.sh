#!/usr/bin/env bash
# install.sh ? fetch and run the tesla-prep/vpn-panel installer.
# Usage: sudo bash install.sh [docker] [host|master|node] [--dry-run]

{
set -euo pipefail
_bootstrap="$(mktemp)"
trap 'rm -f "$_bootstrap"' EXIT
export SWG_BOOTSTRAP_URL="${SWG_BOOTSTRAP_URL:-https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/bootstrap.sh}"
curl -fsSL --connect-timeout 20 --max-time 120 "$SWG_BOOTSTRAP_URL" -o "$_bootstrap"
bash "$_bootstrap" "$@"
exit
}
