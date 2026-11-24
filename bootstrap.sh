#!/usr/bin/env bash
set -euo pipefail

usage='Usage: printf "%s\n" TOKEN | bash bootstrap.sh node -host URL [-endpoint HOST] [-revision SHA]
       bash bootstrap.sh update node [-revision SHA]'

die() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

action=install
case "${1:-}" in
    -h|--help) printf '%s\n' "$usage"; exit 0 ;;
    node) shift ;;
    update)
        [[ ${2:-} == node ]] || die "$usage"
        action=update
        shift 2
        ;;
    *) die "$usage" ;;
esac

host=
endpoint=
revision=
while (( $# )); do
    [[ -n ${2:-} ]] || die "$usage"
    case "$1" in
        -host) [[ $action == install ]] || die "$usage"; host=$2 ;;
        -endpoint) [[ $action == install ]] || die "$usage"; endpoint=$2 ;;
        -revision) revision=$2 ;;
        *) die "$usage" ;;
    esac
    shift 2
done

[[ $action == update || -n $host ]] || die "$usage"
[[ -z $revision || $revision =~ ^[a-f0-9]{40}$ ]] || die 'Invalid source revision.'
[[ $EUID == 0 ]] || die 'Run this script as root or with sudo.'

args=("$action" node)
if [[ $action == install ]]; then
    args+=(--token-stdin --panel-url "$host")
    if [[ -n $endpoint ]]; then args+=(--node-endpoint "$endpoint"); fi
fi
if [[ -n $revision ]]; then args+=(--revision "$revision"); fi

script=$(mktemp)
trap 'rm -f -- "$script"' EXIT
curl -q -fsSL --proto '=https' --retry 3 -o "$script" \
    "https://raw.githubusercontent.com/tesla-prep/vpn-panel/${revision:-main}/swg.sh" </dev/null
bash "$script" "${args[@]}"
