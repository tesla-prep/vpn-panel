#!/usr/bin/env bash
set -euo pipefail

usage='Usage: printf "%s\n" TOKEN | bash bootstrap.sh node -host URL [-endpoint HOST] [-revision SHA]'

die() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

case "${1:-}" in
    -h|--help) printf '%s\n' "$usage"; exit 0 ;;
    node) shift ;;
    *) die "$usage" ;;
esac

host=
endpoint=
revision=
while (( $# )); do
    [[ -n ${2:-} ]] || die "$usage"
    case "$1" in
        -host) host=$2 ;;
        -endpoint) endpoint=$2 ;;
        -revision) revision=$2 ;;
        *) die "$usage" ;;
    esac
    shift 2
done

[[ -n $host ]] || die "$usage"
[[ -z $revision || $revision =~ ^[a-f0-9]{40}$ ]] || die 'Invalid source revision.'
[[ $EUID == 0 ]] || die 'Run this script as root or with sudo.'

args=(install node --token-stdin --panel-url "$host")
if [[ -n $endpoint ]]; then args+=(--node-endpoint "$endpoint"); fi
if [[ -n $revision ]]; then args+=(--revision "$revision"); fi

script=$(mktemp)
trap 'rm -f -- "$script"' EXIT
curl -q -fsSL --proto '=https' --retry 3 -o "$script" \
    "https://raw.githubusercontent.com/tesla-prep/vpn-panel/${revision:-main}/swg.sh" </dev/null
bash "$script" "${args[@]}"
