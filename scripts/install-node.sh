#!/usr/bin/env bash
# Установка узла с systemd. Порядок регистрации описан в docs/operations.md.
set -euo pipefail

# ───────────────────────── CONFIG (blank = ask) ─────────────────────────
PANEL_URL="${PANEL_URL:-}"             # https://host[:port][/subpath] of the panel   (bootstrap: -host)
NODE_TOKEN="${NODE_TOKEN:-}"           # one-time enrollment key from the Nodes screen (bootstrap: -key)
NODE_NAME="${NODE_NAME:-}"             # local label for this box's systemd unit + final message only (NOT the panel name; blank = hostname)
ENDPOINT_IP="${ENDPOINT_IP:-}"         # public IP/host clients dial for THIS node's wg
MANAGE_IFACES="${MANAGE_IFACES:-}"     # e.g. "awg0"  (blank = manage all detected)
ADOPTED_IFACES="${ADOPTED_IFACES:-}"   # interfaces migrated in by convert.sh — shown as "already on this node", not orphan/docker
ADOPTED_ENDPOINTS="${ADOPTED_ENDPOINTS:-}"   # "name=host,…" convert.sh hands over: the endpoint each migrated interface's clients already dial
# sudo-rs может оставить скрипт в фоне. В этой группе процессов чтение /dev/tty вызовет SIGTTIN.
_swg_tty_fg(){ local s f p e i IFS=' '; { read -r s </proc/$$/stat; } 2>/dev/null || return 0; read -ra f <<< "${s##*) }"
  [ "${f[2]:-}" = "${f[5]:-}" ] && return 0; [ "${f[5]:-0}" -gt 0 ] 2>/dev/null || return 1
  for i in 1 2 3 4; do p="${f[1]:-0}"; [ "$p" -gt 1 ] 2>/dev/null || return 0; e="$(readlink "/proc/$p/exe" 2>/dev/null)" || e=""
    case "${e##*/}" in sudo*) case "$e" in *sudo-rs*|*cargo*) return 1;; esac
      case "$("$e" --version 2>/dev/null)" in sudo-rs*) return 1;; esac; return 0;; esac
    { read -r s <"/proc/$p/stat"; } 2>/dev/null || return 0; read -ra f <<< "${s##*) }"; done; return 0; }
SWG_TTY=/dev/tty; _swg_tty_fg || SWG_TTY=/dev/null
swg_tty_ok(){ [ "$SWG_TTY" = /dev/tty ] && { : </dev/tty; } 2>/dev/null; }
if [ "$SWG_TTY" = /dev/null ] && [ -z "${SWG_TTY_WARNED:-}" ] && { : </dev/tty; } 2>/dev/null; then   # said once per run
  printf '%s\n' "! This terminal cannot be read: the script runs in its background, which \`curl … | sudo bash\` does under sudo-rs (Ubuntu 26.04's sudo). Questions take their defaults. To answer them, run: sudo bash -c \"\$(curl -fsSL <bootstrap.sh URL>)\" -- <arguments>" >&2
  export SWG_TTY_WARNED=1
fi
if [ -z "${DEBIAN_FRONTEND:-}" ] && ! swg_tty_ok; then export DEBIAN_FRONTEND=noninteractive; fi
WG_MTU="${WG_MTU:-1280}"               # interface MTU — 1280 leaves headroom for turn-proxy obfuscation
_GIVEN_DNS="${DNS:-}"                  # given on this run (env / convert.sh) — else a re-install keeps the node's own (node_dns_json)
DNS="${DNS:-1.1.1.1}"
TLS_VERIFY="${TLS_VERIFY:-}"           # yes = verify panel's cert (real CA); no = self-signed
TLS_FINGERPRINT="${TLS_FINGERPRINT:-}" # optional: pin panel cert sha256 (hex) instead of verify
INTERVAL="${INTERVAL:-5}"              # sync period, seconds
AGENT_DIR="${AGENT_DIR:-/opt/swg-agent}"
NODED_DIR="${NODED_DIR:-/opt/swg-noded}"
# ────────────────────────────────────────────────────────────────────────

# --dry-run wherever it stands: only a FIRST argument counted, and bootstrap.sh passes its flags through in the order they
# were typed — `… node --yes --dry-run` ran a REAL install (1.8.8 qualification, round 12; install-host.sh the same).
DRYRUN=false; for _a in "$@"; do case "$_a" in --dry-run) DRYRUN=true;; esac; done
PREFIX=""; $DRYRUN && PREFIX="$(pwd)/dryrun"
_WROTE=wrote; $DRYRUN && _WROTE="would write"   # a dry run writes the preview copy, not the file it names (1.8.8 deferred #13)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"
SRC="$REPO/src"
. "$SCRIPT_DIR/lib/common.sh"   # shared helpers: v_iface/v_subnet/v_hostport, next_free_port, dl_turn_bin
# Refuse on a declaratively managed host BEFORE anything is written — a node laid down here would
# be invisible to the host's own tooling. Defined in lib/common.sh, above; a `--dry-run` still runs.
refuse_on_declarative_host 'services.swg-node = { enable = true; ... };'

# ── colours / styling (honour NO_COLOR + non-tty) ──
if { [ -t 1 ] || [ -n "${SWG_FORCE_COLOR:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RESET=$'\033[0m'
  C_BLUE=$'\033[38;5;39m'; C_GREEN=$'\033[32m'; C_GREY=$'\033[90m'; C_CYAN=$'\033[36m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_BL=$'\033[38;5;33m'; C_BROWN=$'\033[38;5;130m'
else BOLD=""; RESET=""; C_BLUE=""; C_GREEN=""; C_GREY=""; C_CYAN=""; C_RED=""; C_YEL=""; C_BL=""; C_BROWN=""; fi
b(){   printf '%s%s%s' "$BOLD" "$*" "$RESET"; }
bb(){  printf '%s%s%s%s' "$BOLD" "$C_BLUE" "$*" "$RESET"; }   # bold + blue (summary highlights)
col(){ local _c="$1"; shift; printf '%s%s%s' "$_c" "$*" "$RESET"; }
conf_get(){ grep -iE "^[[:space:]]*$2[[:space:]]*=" "$1" 2>/dev/null | sed -n 1p | sed 's/.*=[[:space:]]*//; s/[[:space:]]*$//'; }
# one styled interface row (green name + proto + endpoint:port + address) for the manage-loop lists, matching the SUMMARY.
iface_row(){ local n="$1" conf proto ep lp addr _c   # set -e safe; prefer a just-queued spec (no conf yet), else the conf
  is_sys_iface "$n" && return 0   # panel-managed mesh links are never shown in a user-facing interface list
  if [ -n "${SPEC_CMD[$n]:-}" ]; then proto="${SPEC_CMD[$n]}"; lp="${SPEC_PORT[$n]:-}"; addr="${SPEC_ADDR[$n]:-}"; ep="${SPEC_EP[$n]:-}"
  else conf="${IF_CONF[$n]:-}"; proto="${IF_CMD[$n]:-?}"; ep="${IF_ENDPOINT[$n]:-${ENDPOINT_IP:-}}"
    { [ -n "$conf" ] && [ -f "$conf" ]; } || for _c in "/etc/amnezia/amneziawg/$n.conf" "/etc/wireguard/$n.conf"; do [ -f "$_c" ] && { conf="$_c"; break; }; done   # IF_CONF missed it (e.g. an adopted iface) → find the on-disk conf by name so port/addr aren't '?'
    lp="$(conf_get "$conf" ListenPort || true)"; addr="$(conf_get "$conf" Address || true)"; fi
  [ -n "$ep" ] || ep="$(detect_public_ip 2>/dev/null || true)"
  case "${proto:-?}" in ''|'?') case "$n" in awg*) proto=awg;; wg*) proto=wg;; esac;; esac   # unknown proto → infer from the name (awg0 ⇒ AmneziaWG)
  printf '    %s%s%s  %s%-10s%s  %s:%s  %s\n' "$C_GREEN" "$(printf '%-10s' "$n")" "$RESET" "$BOLD" "$(proto_label "${proto:-?}")" "$RESET" "${ep:-?}" "${lp:-?}" "${addr:-?}"; }
local_ifaces(){ { node_ifaces; wdtt_local | cut -f1; } 2>/dev/null | awk 'NF' | sort -u; }
iface_onboarded(){ local c="${IF_CONF[$1]:-}"; [ -n "$c" ] && grep -q '^#swg:onboarded' "$c" 2>/dev/null; }
info(){ _nlguard; echo "${C_BLUE}▸${RESET} ${BOLD}$*${RESET}"; }   # ▸ light-blue, bold (universal action flag)
sub(){  _nlguard; echo "${C_BL}::${RESET} $*"; }                    # :: blue sub-item / progress detail
ok(){   _nlguard; echo "${C_GREEN}✓${RESET} $*"; }
warn(){ _nlguard; echo "${C_BROWN}!${RESET} $*" >&2; }
die(){  echo "${C_RED}✗ $*${RESET}" >&2; exit 1; }
have(){ command -v "$1" >/dev/null 2>&1; }
run(){ if $DRYRUN; then echo "    [skip] $*"; else "$@"; fi; }
# bring an interface up QUIETLY — wg/awg-quick spew a "[#] ip link add…" trace; swallow it on success and
# surface the captured output (indented) only on failure, so a real error still shows. bringup <tool> <iface>
bringup(){ local tool="$1" ifn="$2" out
  if $DRYRUN; then echo "    [skip] $tool up $ifn"; return 0; fi
  if out="$("$tool" up "$ifn" 2>&1)"; then return 0
  else [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/      /' >&2; return 1; fi; }
writef(){ local p="$1" m="${2:-644}" full="$PREFIX$1"; mkdir -p "$(dirname "$full")"; cat > "$full"; chmod "$m" "$full" 2>/dev/null || true; ok "${_WROTE:-wrote} $p ($m)"; }
menu(){ printf '  %s\n      %s\n\n' "$1" "$2"; }
key(){  printf '%s[%s]%s%s'   "$C_BLUE"        "$1" "$2" "$RESET"; }   # whole label blue:        key  a 'mneziawg'           → [a]mneziawg
keyd(){ printf '%s%s[%s]%s%s' "$BOLD" "$C_BLUE" "$1" "$2" "$RESET"; }   # default label bold+blue: keyd a 'mneziawg (default)'  → [a]mneziawg (default)
STEP="${STEP_BASE:-1}"; step(){ [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; echo "$(b "Step $STEP. $1")${2:+   $2}"; STEP=$((STEP+1)); }   # skip the leading blank when a prompt already printed one

_tty(){ swg_tty_ok; }
ask(){ local v p="$1" d="${2:-}"; if [ -n "${!3:-}" ]; then [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; _given "$p" "${!3}"; _pnl; return; fi
  [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; if _tty; then read -rp "  $p${d:+ [$(col "$C_BLUE" "$d")]}: " v <"${SWG_TTY:-/dev/tty}" || true; else _notty "$p" "$d"; fi; printf -v "$3" '%s' "${v:-$d}"; _pnl; }
ask_yn(){ local v p="$1" d="${2:-y}"; if [ -n "${!3:-}" ]; then [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; _given "$p" "${!3}"; _pnl; return; fi
  [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; if _tty; then read -rp "  $p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " v <"${SWG_TTY:-/dev/tty}" || true; else _notty "$p" "$([ "$d" = y ] && echo yes || echo no)"; fi
  v="${v:-$d}"; case "$v" in [Yy]*) printf -v "$3" yes;; *) printf -v "$3" no;; esac; _pnl; }

# ── input validators (0 = ok) ──
v_proto(){   case "$1" in a|awg|amneziawg|w|wg|wireguard) return 0;; *) return 1;; esac; }
v_ip(){      printf '%s' "$1" | grep -cE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' >/dev/null || return 1
             local o; for o in ${1//./ }; do [ "$o" -le 255 ] 2>/dev/null || return 1; done; return 0; }
v_host(){    v_ip "$1" && return 0; case "$1" in ""|*" "*|*[!a-zA-Z0-9.-]*) return 1;; *) return 0;; esac; }
v_httpsurl(){ case "$1" in https://*|http://*) v_host "$(x="${1#http://}"; x="${x#https://}"; x="${x%%/*}"; printf '%s' "${x%%:*}")";; *) v_host "$(x="${1%%/*}"; printf '%s' "${x%%:*}")";; esac; }   # no scheme ok → https:// is prepended after the prompt
v_port(){    case "$1" in ""|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
port_free(){ local p="$1" n   # UDP port not already bound AND not already taken by an interface queued this session
  for n in ${SPEC_ORDER[@]+"${SPEC_ORDER[@]}"}; do [ "${SPEC_PORT[$n]:-}" = "$p" ] && return 1; done
  have ss || return 0; [ -z "$(ss -lnuH "sport = :$p" 2>/dev/null)" ]; }
v_freeport(){ v_port "$1" && port_free "$1"; }
# smart default ports: first install offers the base; later ones offer (highest used OF THAT KIND)+1, then the
# next host-free port. turn = TP_LISTEN units; wg/awg = highest ListenPort across confs, never below 51820+queued.
turn_default_port(){ detect_turn; local hi=0 lis p; if [ "${#TP_LISTEN[@]}" -gt 0 ]; then for lis in "${TP_LISTEN[@]}"; do p="${lis##*:}"; case "$p" in ''|*[!0-9]*) :;; *) [ "$p" -gt "$hi" ] && hi="$p";; esac; done; fi; [ "$hi" -gt 0 ] && next_free_port $((hi+1)) || next_free_port 56000; }
v_name(){    case "$1" in ""|*[!a-zA-Z0-9_-]*) return 1;; esac; [ "${#1}" -le 40 ]; }
v_token(){   [ -n "$1" ] && [ "${#1}" -ge 8 ]; }   # v_iface/v_subnet/v_hostport now in lib/common.sh

_notty(){ printf '  %s: %s  %s\n' "$1" "$(b "${2:-(blank)}")" "(no terminal — default taken)"; }
# …and an answer the caller already GAVE (-flag / env): the step still says what it is, or a preset run reads a step
# header with nothing under it ("Step 4. Node name for THIS box", then the next step — 1.8.8 qualification).
_given(){ printf '  %s: %s  %s\n' "$1" "$(b "${2:-(blank)}")" "(given — not asked)"; }
# ask_choice <prompt> <default> <var> "<opt…>"  — re-prompts on bad input; ' --force' overrides
ask_choice(){ local p="$1" d="$2" var="$3" opts="$4" v o forced rc i
  if [ -n "${!var:-}" ]; then for o in $opts; do [ "${!var}" = "$o" ] && { _given "$p" "${!var}"; _pnl; return; }; done
    warn "ignoring invalid $var='${!var}' (expected: $opts)"; fi
  while :; do
    if _tty && read -rp "  $p [$(col "$C_BLUE" "$d")]: " v <"${SWG_TTY:-/dev/tty}"; then rc=0; else rc=1; v=""; _tty || _notty "$p" "$d"; fi
    v="${v:-$d}"; forced=no
    case "$v" in *' --force') v="${v% --force}"; v="${v%"${v##*[![:space:]]}"}"; forced=yes;; esac
    case "$v" in ""|*[!0-9]*) :;; *) i=1; for o in $opts; do [ "$i" = "$v" ] && { v="$o"; break; }; i=$((i+1)); done;; esac   # [N] -> the Nth option
    for o in $opts; do [ "$v" = "$o" ] && { printf -v "$var" '%s' "$v"; _pnl; return; }; done
    [ "$forced" = yes ] && { warn "forcing unrecognised value: $v"; printf -v "$var" '%s' "$v"; _pnl; return; }
    [ $rc -ne 0 ] && die "‘$v’ is not one of: $opts (and no interactive input to re-prompt)"
    warn "‘$v’ isn't one of: $(col "$C_BLUE" "$opts")"
    echo "  re-enter, or append $(b ' --force') to use your value anyway"
  done; }

# ask_valid <prompt> <default> <var> <validator> <hint> [derived]  — re-prompts on bad input; ' --force' overrides.
# A valid value already in <var> is said ("given — not asked"), unless `derived`: the caller filled it in itself.
ask_valid(){ local p="$1" d="$2" var="$3" fn="$4" hint="$5" v forced rc
  if [ -n "${!var:-}" ]; then "$fn" "${!var}" && { [ "${6:-}" = derived ] || { [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; _given "$p" "${!var}"; _pnl; }; return; }
    warn "ignoring invalid $var='${!var}' ($hint)"; fi
  [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""
  while :; do
    if _tty && read -rp "  $p${d:+ [$(col "$C_BLUE" "$d")]}: " v <"${SWG_TTY:-/dev/tty}"; then rc=0; else rc=1; v=""; _tty || _notty "$p" "$d"; fi
    v="${v:-$d}"; forced=no
    case "$v" in *' --force') v="${v% --force}"; v="${v%"${v##*[![:space:]]}"}"; forced=yes;; esac
    if "$fn" "$v"; then printf -v "$var" '%s' "$v"; _pnl; return; fi
    [ "$forced" = yes ] && { warn "forcing: $v"; printf -v "$var" '%s' "$v"; _pnl; return; }
    [ $rc -ne 0 ] && die "no valid value for ‘$p’ (got '${v:-empty}') and no interactive input to re-prompt"
    warn "$hint"
    echo "  re-enter, or append $(b ' --force') to use it anyway"
  done; }

detect_public_ip(){ # best public IPv4: default-route source, then first hostname -I
  local ip; ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | sed -n 1p || true)"
  case "$ip" in 127.*) ip="";; esac                                                   # never the loopback — clients can't reach it
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^127\.' | sed -n 1p || true)"
  printf '%s' "$ip"; }

# ── idempotent re-install: read the current install's panel URL/token + per-interface endpoints, to
#    offer as defaults (so re-running keeps everything). Fresh install = run the uninstaller first.
EXIST_URL=""; EXIST_TOKEN=""; EXIST_EP=""; EXIST_REF=""; EXIST_FP=""; EXIST_VERIFY=""; EXIST_DNS_JSON=""; EXISTING=no
read_existing(){
  { [ -f /etc/swg-agent/config.json ] && have python3; } || return 0
  EXISTING=yes
  # the node's client DNS as its config has it (a list of names/addresses) — see node_dns_json
  EXIST_DNS_JSON="$(python3 -c 'import json;d=json.load(open("/etc/swg-agent/config.json")).get("dns");print(json.dumps(d) if isinstance(d,list) and d and all(isinstance(x,str) and x.strip() for x in d) else "")' 2>/dev/null || true)"
  EXIST_EP="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("endpoint_host","") or "")' 2>/dev/null || true)"
  EXIST_REF="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("node") or {}).get("update_ref") or "")' 2>/dev/null || true)"
  EXIST_URL="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("panel",{}).get("url",""))' 2>/dev/null || true)"
  EXIST_TOKEN="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("panel",{}).get("token",""))' 2>/dev/null || true)"
  EXIST_FP="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("panel",{}).get("fingerprint","") or "")' 2>/dev/null || true)"
  # (default False, as swg-noded reads it: a config that never said `verify` is a node that never CA-verified)
  EXIST_VERIFY="$(python3 -c 'import json;print("yes" if (json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("verify",False) else "no")' 2>/dev/null || echo no)"
  while IFS='|' read -r n ep; do [ -n "$n" ] && [ -z "${IF_ENDPOINT[$n]:-}" ] && IF_ENDPOINT[$n]="$ep"; done < <(python3 -c '
import json
for n,ic in (json.load(open("/etc/swg-agent/config.json")).get("interfaces") or {}).items():
    e=ic.get("endpoint_host","")
    if e: print("%s|%s"%(n,e))' 2>/dev/null || true)
  return 0   # the while-loop falls through non-zero if the last iface's endpoint was already set; bare-called at NODE SETUP start
}
detect_wan(){ ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sed -n 1p; }

declare -A IF_CMD IF_CONF IF_ENDPOINT; declare -a SELECTED CREATED   # IF_ENDPOINT: per-interface public IP clients dial; CREATED: ifaces made this run
declare -A SPEC_CMD SPEC_PROTO SPEC_PORT SPEC_SUBNET SPEC_ADDR SPEC_WAN SPEC_EP SPEC_DIR; declare -a SPEC_ORDER=()   # queued interfaces (prompted now, installed at the end by apply_specs)
detect_wg(){ # every CONVENTIONAL wg/awg location, not just the ones we install into — a box configured by a
  # distro package, an upstream installer or by hand is exactly what adoption exists for, and it used to be invisible.
  IF_CMD=(); IF_CONF=(); local f n d
  for d in /etc/amnezia /etc/amneziawg /usr/local/etc/amneziawg; do
    [ -d "$d" ] || continue
    while IFS= read -r f; do [ -e "$f" ] || continue; n="$(basename "$f" .conf)"; IF_CMD[$n]=awg; IF_CONF[$n]="$f"
    done < <(find "$d" -maxdepth 3 -type f -name '*.conf' 2>/dev/null)
  done
  for d in /etc/wireguard /usr/local/etc/wireguard; do
    [ -d "$d" ] || continue
    for f in "$d"/*.conf; do [ -e "$f" ] || continue; n="$(basename "$f" .conf)"; IF_CMD[$n]=wg; IF_CONF[$n]="$f"; done
  done
}
ensure_wg_tools_once(){ # <awg|wg> [again] — ensure_wg_tools, once per run per tool: the answer cannot change within one, and the
  local _v="_WGT_RC_$1" _a="_WGT_AGAIN_$1" _rc
  if [ -n "${!_v:-}" ] && { [ "${!_v}" = 0 ] || [ -z "${2:-}" ] || [ -n "${!_a:-}" ]; }; then return "${!_v}"; fi
  [ -z "${2:-}" ] || printf -v "$_a" '%s' 1
  ensure_wg_tools "$1" && _rc=0 || _rc=$?
  printf -v "$_v" '%s' "$_rc"
  return "$_rc"
}
ensure_wg_tools(){ # ensure_wg_tools <awg|wg> — install tools + kernel module if missing (idempotent, non-fatal -> 0/1).
  local cmd="$1"
  if [ "$cmd" = wg ]; then
    have wg || { if $DRYRUN || have apt-get; then info "installing WireGuard tools via apt — this can take a minute…"; run apt-get update -qq || true; run apt-get install -y wireguard || true; else warn "WireGuard tools not found and no apt-get on this system — install 'wireguard' with your package manager, then re-run"; fi; }
    $DRYRUN && return 0
    have wg && { modprobe wireguard 2>/dev/null || true; return 0; }
    return 1
  fi
  awg_go_needs_install && { awg_go_pinned || warn "AmneziaWG: the pinned userspace fallback could not be fetched — awg interfaces depend on the kernel module alone until an update installs it"; }   # missing, or one of our earlier pinned builds
  if have awg && modprobe amneziawg 2>/dev/null; then                 # already fully working (tool + loadable module) —
    $DRYRUN || awg_compat_patch_installed >/dev/null || true          # …its source fixed for the NEXT kernel (PR #218)
    return 0
  fi
  # graceful degrade on a non-apt distro (Fedora/RHEL/Arch/Alpine): don't silently limp — tell the operator exactly
  # what to install with their own package manager. apt paths below stay for Debian/Ubuntu.
  $DRYRUN || have apt-get || { warn "AmneziaWG not installed — no apt-get on this system; install dkms, linux-headers-$(uname -r) and amneziawg-dkms with your package manager, then re-run"; return 1; }
  local _ppa=""
  if _ppa="$(awg_ppa_suite)"; then   # Ubuntu, or a system built on it: the amnezia PPA serves its series (lib/common.sh)
    info "installing AmneziaWG (tools + DKMS kernel module) from the amnezia PPA for Ubuntu $_ppa — this can take a minute…"
    run apt-get update -qq || true
    awg_ppa_add "$_ppa"
    run apt-get update -qq || true
    run apt-get install -y dkms "linux-headers-$(uname -r)" || run apt-get install -y dkms linux-headers-generic || true
    ensure_awg_headers_follow || true   # D4: headers for the NEXT kernel too, so DKMS builds it when it arrives
    awg_dkms_drop_unowned   # D4: one DKMS owner — the package's
    awg_ppa_module_install && build_awg_module   # a module that does not compile on this kernel is given up on, not retried
  else
    info "installing AmneziaWG from source (tools + DKMS kernel module) — its packages are published for Ubuntu only, and this is $(awg_os_name) — this can take a few minutes…"
    run apt-get update -qq || true
  fi
  $DRYRUN && return 0
  have awg && modprobe amneziawg 2>/dev/null && return 0
  # Built, and refused for its signing key (Secure Boot): the steps, once, and straight to userspace — a source build
  # would compile the same module to the same refusal.
  if have awg && awg_mod_key_rejected; then
    awg_key_refused_note
    ensure_awg_userspace && return 0
    return 1
  fi
  awg_build_from_source && { info "AmneziaWG: kernel datapath (built from source)"; return 0; }
  # Still no module: no headers for this kernel, or an LXC/OpenVZ guest that cannot load one at all. Fall
  # back to userspace so the node can still serve AmneziaWG — awg-quick picks it up by itself.
  if ensure_awg_userspace; then
    have awg && have awg-quick || return 1   # a datapath, not the tools
    warn "AmneziaWG will run on the SLOWER userspace datapath — no loadable kernel module on $(uname -r).$(
      have apt-get && awg_tools_drive_3x && ! [ -e "/lib/modules/$(uname -r)/build" ] && printf ' %s' 'Installing matching linux-headers and re-running the installer switches it to the kernel module.')"
    return 0
  fi
  return 1
}
build_awg_module(){ # FORCE the amneziawg DKMS module to COMPILE for the RUNNING kernel — `apt install amneziawg` is
  run dkms autoinstall -k "$(uname -r)" 2>/dev/null || run dkms autoinstall 2>/dev/null || true
  awg_dkms_build_all_kernels   # D4: every installed kernel with headers — an installed-but-not-booted kernel included
  modprobe amneziawg 2>/dev/null && return 0
  awg_mod_key_rejected && return 1   # built, refused for its key (Secure Boot) — a reinstall would only build it again
  awg_dkms_reinstall || return 1   # the source fixed again and dpkg finished; given up when it does not compile (lib/common.sh)
  run dkms autoinstall -k "$(uname -r)" 2>/dev/null || true
  run modprobe amneziawg 2>/dev/null || true
}
ensure_smart_tools(){ # nftables (smart-routing marking) + dnsmasq (domain-tier set filling) — idempotent, non-fatal
  have nft     || { run apt-get update -qq || true; run apt-get install -y nftables || true; }
  # masked FIRST: its postinst starts it, the start fails on :53 (systemd-resolved) and the first install printed an error
  # for a unit masked a moment later anyway; a masked unit is not started (1.8.8 deferred #5(b))
  have dnsmasq || { run apt-get update -qq || true; run systemctl mask dnsmasq 2>/dev/null || true; run apt-get install -y dnsmasq || true; }
  have ipset   || { run apt-get update -qq || true; run apt-get install -y ipset    || true; }   # kernel-SNI mode (xt_string learn → ipset); degrades to userspace SNI if absent
  run systemctl disable --now dnsmasq 2>/dev/null || true
  run systemctl mask dnsmasq 2>/dev/null || true
  run systemctl reset-failed dnsmasq 2>/dev/null || true
}
server_addr(){ have python3 || die "python3 required for the tunnel address (also needed by the daemon)"
  python3 - "$1" <<'PY'
import ipaddress, sys
n = ipaddress.ip_network(sys.argv[1], strict=False)
print(f"{next(n.hosts())}/{n.prefixlen}")
PY
}
# pick a default tunnel subnet that isn't already taken — by a queued spec OR a persisted interface — so a
# 2nd interface doesn't collide with a non-default subnet the user chose for the 1st (and v_subnet_free rejects a typed dup).
_net24(){ local ip="${1%%/*}" m="${1##*/}"; [ "$1" = "$m" ] && m=24; printf '%s.0/%s' "${ip%.*}" "$m"; }   # 10.9.0.1/24 → 10.9.0.0/24
subnet_used(){ local s n a; s="$(_net24 "$1")"
  for n in ${SPEC_ORDER[@]+"${SPEC_ORDER[@]}"}; do [ -n "${SPEC_SUBNET[$n]:-}" ] && [ "$(_net24 "${SPEC_SUBNET[$n]}")" = "$s" ] && return 0; done
  for n in "${!IF_CONF[@]}"; do a="$(sed -n 's/^[[:space:]]*Address[[:space:]]*=[[:space:]]*\([0-9./]*\).*/\1/p' "${IF_CONF[$n]}" 2>/dev/null | sed -n 1p)"; [ -n "$a" ] && [ "$(_net24 "$a")" = "$s" ] && return 0; done
  return 1; }
node_dns_json(){
  if [ -n "${_GIVEN_DNS:-}" ]; then python3 -c 'import json,sys;print(json.dumps([sys.argv[1]]))' "$_GIVEN_DNS"
  elif [ -n "${EXIST_DNS_JSON:-}" ]; then printf '%s\n' "$EXIST_DNS_JSON"
  else python3 -c 'import json,sys;print(json.dumps([sys.argv[1]]))' "${DNS:-1.1.1.1}"; fi; }
# default subnet = (highest used 10.X.0.0/24 second-octet)+1, then the next free above it (10.8 if none).
next_free_subnet(){ local hi=7 n a o
  for n in ${SPEC_ORDER[@]+"${SPEC_ORDER[@]}"}; do a="${SPEC_SUBNET[$n]:-}"; [ -n "$a" ] || continue; o="$(_net24 "$a" | cut -d. -f2)"; case "$o" in ''|*[!0-9]*) :;; *) [ "$o" -gt "$hi" ] && hi="$o";; esac; done
  for n in "${!IF_CONF[@]}"; do a="$(conf_get "${IF_CONF[$n]}" Address)"; [ -n "$a" ] || continue; o="$(_net24 "$a" | cut -d. -f2)"; case "$o" in ''|*[!0-9]*) :;; *) [ "$o" -gt "$hi" ] && hi="$o";; esac; done
  o=$((hi+1)); while [ "$o" -lt 255 ] && subnet_used "10.$o.0.0/24"; do o=$((o+1)); done; echo "10.$o.0.0/24"; }
v_subnet_free(){ v_subnet "$1" || return 1; subnet_used "$1" && return 1; return 0; }
apply_specs(){ # install tools + write confs + bring up every queued interface, then prune failures
  [ "${#SPEC_ORDER[@]}" -gt 0 ] || return 0
  local name proto port subnet addr conf cmd priv dir wan up down upok ep obf failed=""
  echo; info "Setting up ${#SPEC_ORDER[@]} interface(s)…"
  for name in "${SPEC_ORDER[@]}"; do
    cmd="${SPEC_CMD[$name]}"; proto="${SPEC_PROTO[$name]}"; port="${SPEC_PORT[$name]}"; subnet="${SPEC_SUBNET[$name]}"
    addr="${SPEC_ADDR[$name]}"; wan="${SPEC_WAN[$name]}"; ep="${SPEC_EP[$name]}"; dir="${SPEC_DIR[$name]}"; conf="$dir/$name.conf"
    if ! ensure_wg_tools_once "$cmd" again; then warn "couldn't install $cmd tools — skipping interface '$name'"; failed="$failed $name"; continue; fi
    up="$(nat_hook_up "${subnet}" "${wan}")"   # reap-then-add: one copy whatever was there (lib/common.sh)
    down="$(nat_hook_down "${subnet}" "${wan}")"
    printf 'net.ipv4.ip_forward = 1\nnet.ipv4.conf.all.route_localnet = 1\n' | writef /etc/sysctl.d/99-swg-forward.conf 644
    run sysctl -q -w net.ipv4.ip_forward=1
    run sysctl -q -w net.ipv4.conf.all.route_localnet=1   # lets Force-DNS DNAT client :53 to loopback dnsmasq (else silent DNS blackhole)
    if $DRYRUN; then priv="<generated-on-real-run>"
    elif ! priv="$("$cmd" genkey 2>/dev/null)" || [ -z "$priv" ]; then warn "'$cmd genkey' failed — skipping interface '$name'"; failed="$failed $name"; continue; fi
    obf=""
    if [ "$cmd" = awg ] && ! obf="$(awg_initial_obfuscation "$SRC")"; then
      warn "couldn't generate AmneziaWG parameters — skipping interface '$name'"; failed="$failed $name"; continue
    fi
    { printf '[Interface]\nPrivateKey = %s\nAddress = %s\nListenPort = %s\nMTU = %s\n' "$priv" "$addr" "$port" "$WG_MTU"
      printf 'PostUp = %s\nPostDown = %s\n' "$up" "$down"
      if [ -n "$obf" ]; then printf '%s\n' "$obf"; fi; } | writef "$conf" 600
    if ! $DRYRUN && ip link show "$name" >/dev/null 2>&1; then
      warn "interface '$name' already exists as a leftover (e.g. a removed docker node left its host-netns iface) — replacing it with the new one"
      awg-quick down "$name" >/dev/null 2>&1 || wg-quick down "$name" >/dev/null 2>&1 || true   # clean teardown if it can
      ip link delete dev "$name" >/dev/null 2>&1 || true                                        # ALWAYS force-delete the netdev (down may exit 0 without removing it)
    fi
    # bring up — NON-FATAL: a port/subnet clash must not abort the whole install (set -e)
    upok=yes
    if [ "$cmd" = awg ]; then bringup awg-quick "$name" || upok=no; [ "$upok" = yes ] && { run systemctl enable --quiet "awg-quick@$name" || true; }
    else                     bringup wg-quick  "$name" || upok=no; [ "$upok" = yes ] && { run systemctl enable --quiet "wg-quick@$name"  || true; }; fi
    if [ "$upok" = no ]; then
      warn "couldn't bring up '$name' (a port or subnet may already be in use) — removing its conf; try again with different values"
      run rm -f "$conf"; failed="$failed $name"; continue
    fi
    IF_CMD[$name]="$cmd"; IF_CONF[$name]="$conf"; IF_ENDPOINT[$name]="$ep"; LAST_IFACE="$name"
    ok "created $proto interface $(col "$C_GREEN" "$name") on :$port (server $addr, NAT out $wan)"
  done
  if [ -n "$failed" ]; then   # drop interfaces that failed to come up from the selected set
    local keep=() n; for n in ${SELECTED[@]+"${SELECTED[@]}"}; do _in "$n" "$failed" || keep+=("$n"); done; SELECTED=(${keep[@]+"${keep[@]}"})
  fi
}
# ── interface picker helpers (bare-metal) ──
node_ifaces(){ # interfaces this node already manages — config.json keys WHOSE CONF STILL EXISTS. A dangling entry
  { [ -f /etc/swg-agent/config.json ] && have python3; } || return 0
  python3 -c 'import json, os
for n, ic in (json.load(open("/etc/swg-agent/config.json")).get("interfaces") or {}).items():
    if isinstance(ic, dict) and os.path.exists(ic.get("conf", "")): print(n)' 2>/dev/null || true
}
_in(){ case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }
reconstruct_live_orphans(){
  $DRYRUN && return 0
  command -v ip >/dev/null 2>&1 || return 0
  local tool dir n sc addr sub wan up down _allow=""
  [ "${SWG_CONVERT:-}" = 1 ] || return 0
  _allow=" $(printf '%s' "${ADOPTED_IFACES:-}" | tr ', ' '  ') "
  wan="$(ip route show default 2>/dev/null | awk '!d{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); d=1; break}}' || true)"; [ -n "$wan" ] || wan=eth0
  for tool in awg wg; do
    command -v "$tool" >/dev/null 2>&1 || continue
    dir=/etc/amnezia/amneziawg; [ "$tool" = wg ] && dir=/etc/wireguard
    for n in $("$tool" show interfaces 2>/dev/null || true); do
      [ -n "$n" ] || continue
      if [ -f "/etc/amnezia/amneziawg/$n.conf" ] || [ -f "/etc/wireguard/$n.conf" ]; then continue; fi   # already managed
      _in "$n" "$_allow" || continue   # not one of the interfaces THIS convert is migrating → leave it for the panel to offer as a candidate
      sc="$("$tool" showconf "$n" 2>/dev/null || true)"; [ -n "$sc" ] || continue
      addr="$(ip -o -4 addr show "$n" 2>/dev/null | awk 'NR==1{print $4}' || true)"; [ -n "$addr" ] || continue
      sub="$(printf '%s' "${addr%/*}" | awk -F. '{print $1"."$2"."$3".0"}' || true)/${addr#*/}"
      up="$(nat_hook_up "${sub}" "${wan}")"   # reap-then-add: one copy whatever was there (lib/common.sh)
      down="$(nat_hook_down "${sub}" "${wan}")"
      mkdir -p "$dir" 2>/dev/null || true
      { is_sys_iface "$n" || echo '#swg:onboarded'; printf '%s\n' "$sc" | awk -v a="$addr" -v u="$up" -v d="$down" '
        function flush(  i) { if (np == 0) return
          for (i = 1; i <= np; i++) if (ka || peer[i] !~ /^[ \t]*[Ee]ndpoint[ \t]*=/) print peer[i]
          np = 0; ka = 0 }
        /^[ \t]*AdvancedSecurity[ \t]*=/ { next }
        /^[ \t]*(ContentPaddingAddition|RekeyAfterTime|RekeyTimeout|RejectAfterTime|KeepaliveTimeout|MaxHandshakeAttempts|RandomTrailers|DisableCookies)[ \t]*=[ \t]*(0|off)[ \t]*$/ { next }
        /^[ \t]*\[Interface\]/ { flush(); print; print "Address = " a; print "MTU = 1420"; print "PostUp = " u; print "PostDown = " d; next }
        /^[ \t]*\[Peer\]/      { flush(); peer[++np] = $0; next }
        np > 0                  { peer[++np] = $0; if ($0 ~ /^[ \t]*[Pp]ersistentKeepalive[ \t]*=/) ka = 1; next }
                                { print }
        END                     { flush() }'; } > "$dir/$n.conf" 2>/dev/null && chmod 600 "$dir/$n.conf" 2>/dev/null || true
      info "  detected running interface $(b "$n") with no config on disk — rebuilt its conf so it's managed (peers kept)"
    done
  done
  return 0
}
choose_ifaces(){ # let the user pick which detected interfaces to manage; 'new' creates more
  reconstruct_live_orphans   # rebuild confs for running wg/awg ifaces that have none on disk → detected below
  migrate_docker_ifaces      # docker→bare convert: list the migrated interfaces + "Transfer? (Y/n)"; declined ⇒ drop them (must run AFTER reconstruct, before detect_wg, so a drop sticks)
  detect_wg
  manage_ifaces_resolve            # sets MANAGE_IFACES; must NOT be called in $( ) — see the function
  if [ -n "$MANAGE_IFACES" ]; then
    IFS=',' read -ra SELECTED <<< "$MANAGE_IFACES"
  elif [ -n "${ADOPTED_IFACES:-}" ]; then
    IFS=', ' read -ra SELECTED <<< "$ADOPTED_IFACES"
  else
    local n _mine; local -a cand=()
    _mine=" $(local_ifaces | tr '\n' ' ') "
    for n in "${!IF_CMD[@]}"; do
      is_sys_iface "$n" && continue
      case "$_mine" in *" $n "*) continue;; esac   # already managed by this node → local, not a candidate
      cand+=("$n")
    done
    if [ "${#cand[@]}" -gt 0 ]; then
      echo; info "Found ${#cand[@]} wg/awg/wdtt interface(s) NOT managed by the panel — adopt them from the panel (Node → Interfaces → adoption candidates):"; echo
      for n in "${cand[@]}"; do iface_row "$n"; done; echo
    else
      info "No unmanaged wg/awg/wdtt interfaces found on this box — nothing to adopt."
    fi
    SELECTED=(); while IFS= read -r n; do [ -n "$n" ] && SELECTED+=("$n"); done < <(node_ifaces)
  fi
  [ "${SWG_CONVERT:-}" = 1 ] || apply_node_switch
}
apply_node_switch(){
  local _n _ep n _c
  if [ "${SWG_CONVERT:-}" = 1 ] && ! $DRYRUN && command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; then
    info "Switching over — stopping the docker node, then bringing the interfaces up bare-metal…"
    lc_teardown_docker "${SWG_DOCKER_DIR:-/opt/swg-panel-docker}"
    for _n in ${SELECTED[@]+"${SELECTED[@]}"}; do _n="${_n// /}"; [ -n "$_n" ] && command -v ip >/dev/null 2>&1 && ip link show "$_n" >/dev/null 2>&1 && ip link delete dev "$_n" 2>/dev/null || true; done
  fi
  apply_specs   # install tools + write confs + bring up every queued interface now (after all prompts)
  detect_wg
  for n in "${SELECTED[@]}"; do n="${n// /}"; [ -n "$n" ] || continue   # the guard the line above already has
    [ -n "${IF_CMD[$n]:-}" ] || { [ -e "/etc/amnezia/amneziawg/$n.conf" ] && { IF_CMD[$n]=awg; IF_CONF[$n]="/etc/amnezia/amneziawg/$n.conf"; } || { IF_CMD[$n]=wg; IF_CONF[$n]="/etc/wireguard/$n.conf"; }; }
    [ -n "${IF_ENDPOINT[$n]:-}" ] && continue   # interfaces just created already have an endpoint
    is_sys_iface "$n" && continue               # a mesh link: the panel sets where it dials, clients never do
    # a CONFIGURED node endpoint (-endpoint / ENDPOINT_IP, or the one this node already had — see NODE SETUP) is what
    # the interface advertises: left blank here, it falls back to it exactly as before this run, never re-detected
    case "${ENDPOINT_IP:-}" in ""|127.*|localhost) ;; *) echo "    Kept $(bb "$ENDPOINT_IP") (this node's endpoint) for $(col "$C_GREEN" "$n")"; continue;; esac
    _ep="$(detect_public_ip)"; IF_ENDPOINT[$n]="$_ep"   # auto endpoint clients dial (change it later in the panel)
    echo "    Used $(bb "$_ep") endpoint IP for $(col "$C_GREEN" "$n")"; done
  [ "${#SELECTED[@]}" -gt 0 ] && echo
  # bring up any adopted interface whose conf is here but isn't running yet (transfer-from-docker / conversion)
  info "Bringing up the node's interfaces (starting each one — this can take a moment for many)…"
  for n in "${SELECTED[@]}"; do n="${n// /}"; [ -z "$n" ] && continue
    ip link show "$n" >/dev/null 2>&1 && continue          # already up → leave it
    _c="${IF_CMD[$n]:-awg}"; ensure_wg_tools_once "$_c" again || continue
    if [ "$_c" = awg ]; then bringup awg-quick "$n" && { run systemctl enable --quiet "awg-quick@$n" || true; } || warn "couldn't bring up adopted '$n' — check $(b "${IF_CONF[$n]:-}")"
    else                     bringup wg-quick  "$n" && { run systemctl enable --quiet "wg-quick@$n"  || true; } || warn "couldn't bring up adopted '$n' — check $(b "${IF_CONF[$n]:-}")"; fi
  done
  # The LOCAL set — what this node manages after this run: wg/awg from config.json + its WDTT instances (whose
  # interfaces have no .conf, so they'd otherwise look absent). Listed, not re-asked: a re-install keeps them.
  local _l _li _lls _lsub; local -a _loc=()
  while IFS= read -r _l; do [ -n "$_l" ] && _loc+=("$_l"); done < <({ local_ifaces; printf '%s\n' ${SELECTED[@]+"${SELECTED[@]}"}; } | tr -d ' ' | awk 'NF && !s[$0]++' | drop_sys_ifaces)
  if [ "${#_loc[@]}" -gt 0 ]; then
    echo; info "Found ${#_loc[@]} wg/awg/wdtt local interface(s) on this box:"; echo
    detect_wg
    for _l in "${_loc[@]}"; do
      if [ -n "${IF_CMD[$_l]:-}" ]; then iface_row "$_l"; else
        IFS="$(printf '\t')" read -r _li _lls _lsub < <(wdtt_local | awk -F'\t' -v i="$_l" '$1==i') || true   # EOF => rc 1; set -e would abort the whole install
        [ -n "$_li" ] && wdtt_row "$_li" "$_lls" "$_lsub"
      fi
    done; echo
  else info "No local interfaces yet — this node is managed from the panel (Interfaces → Load new interface)."; fi
  _l="$(printf '%s\n' ${SELECTED[@]+"${SELECTED[@]}"} | tr -d ' ' | drop_sys_ifaces | awk 'NF' | tr '\n' ' ')"
  [ -n "${_l// /}" ] && ok "Managing: $(b "$(col "$C_GREEN" "${_l% }")")" || true
}

# turn-proxy (vk-turn-proxy)
TURN_DIR="${TURN_DIR:-/opt/vk-turn-proxy}"
TURN_RECORD="${TURN_RECORD:-/etc/swg-agent/turn-proxy.json}"
declare -A TP_LISTEN TP_CONNECT TP_WRAP
gen_wrap_key(){ $DRYRUN && { echo "GENERATED-ON-REAL-RUN"; return 0; }   # 32-byte key as 64 hex chars
  openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
turn_wrap_flags(){ local k; case "$1" in
  anton48)      k="$(gen_wrap_key)"; printf -- '-wrap-srtp -wrap-key %s' "$k";;
  samosvalishe) k="$(gen_wrap_key)"; printf -- '-obf-profile rtpopus -obf-key %s' "$k";;
  WINGS-N)      k="$(gen_wrap_key)"; printf -- '-wrap-mode on -wrap-key %s' "$k";;
  Moroka8)      k="$(gen_wrap_key)"; printf -- '-wrap -wrap-key %s' "$k";;   # verified from its README: -wrap -wrap-key
  *) printf '';; esac; }
turn_wg_ports(){   # echo "<iface>:<ListenPort>" for every interface managed in the wg/awg step
  local n p
  for n in ${SELECTED[@]+"${SELECTED[@]}"}; do
    [ -n "${IF_CONF[$n]:-}" ] || continue
    is_sys_iface "$n" && continue   # a mesh link is no turn-proxy's forward target
    p="$(grep -iE '^[[:space:]]*ListenPort[[:space:]]*=' "${IF_CONF[$n]}" 2>/dev/null | sed -n 1p | sed 's/.*=[[:space:]]*//; s/[^0-9].*//')"
    [ -n "$p" ] && printf '%s:%s\n' "$n" "$p"
  done
  return 0   # a final iface with no ListenPort would otherwise leave the loop non-zero → trips set -e at ports="$(turn_wg_ports)"
}
detect_turn(){   # any systemd unit whose ExecStart carries both -listen and -connect is a turn-proxy
  TP_LISTEN=(); TP_CONNECT=(); TP_WRAP=(); local u name exe lis con wk envf params
  for u in /etc/systemd/system/*.service; do
    [ -e "$u" ] || continue
    exe="$(sed -n 's/^ExecStart=//p' "$u" 2>/dev/null | sed -n 1p)"
    case "$exe" in *-listen*-connect*|*-connect*-listen*) ;; *) continue;; esac
    name="$(basename "$u" .service)"
    case "$exe" in
      *'${SWG_'*)   # EnvironmentFile form — read listen/connect/params out of turn.env
        envf="$(sed -n 's/^EnvironmentFile=-\{0,1\}//p' "$u" 2>/dev/null | sed -n 1p)"
        lis="$(sed -n 's/^SWG_DIAL=//p' "$envf" 2>/dev/null | sed -n 1p)"   # SWG_DIAL = what clients dial when it differs from the bind (swg-noded turn_bind); SWG_LISTEN is what it binds
        [ -n "$lis" ] || lis="$(sed -n 's/^SWG_LISTEN=//p' "$envf" 2>/dev/null | sed -n 1p)"
        con="$(sed -n 's/^SWG_CONNECT=//p' "$envf" 2>/dev/null | sed -n 1p)"
        params="$(sed -n 's/^SWG_PARAMS=//p' "$envf" 2>/dev/null | sed -n 1p)"
        wk="$(printf '%s\n' "$params" | sed -n 's/.*-wrap-key[ =]\{1,\}\([^ ]*\).*/\1/p')"
        [ -n "$wk" ] || wk="$(printf '%s\n' "$params" | sed -n 's/.*-obf-key[ =]\{1,\}\([^ ]*\).*/\1/p')" ;;   # free-turn-proxy uses -obf-key
      *)            # legacy baked-ExecStart form
        lis="$(printf '%s\n' "$exe" | sed -n 's/.*-listen[ =]\{1,\}\([^ ]*\).*/\1/p')"
        con="$(printf '%s\n' "$exe" | sed -n 's/.*-connect[ =]\{1,\}\([^ ]*\).*/\1/p')"
        wk="$(printf '%s\n' "$exe" | sed -n 's/.*-wrap-key[ =]\{1,\}\([^ ]*\).*/\1/p')"
        [ -n "$wk" ] || wk="$(printf '%s\n' "$exe" | sed -n 's/.*-obf-key[ =]\{1,\}\([^ ]*\).*/\1/p')" ;;
    esac
    TP_LISTEN[$name]="$lis"; TP_CONNECT[$name]="$con"; TP_WRAP[$name]="$wk"
  done
}
turn_latest_tag(){ $DRYRUN && { echo "v0.0.0"; return 0; }   # turn_latest_tag <owner/repo>
  curl -fsSL --connect-timeout 10 --max-time 20 "https://api.github.com/repos/$1/releases/latest" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tag_name",""))' 2>/dev/null || true; }
install_turn_binary(){ # <fork> <owner/repo> <listen ip:port> <connect ip:port> <extra-flags> [<Listen on ip>]
  local fork="$1" owner="$2" listen="$3" connect="$4" extra="$5" pin="${6:-}" arch dir bin svc url ver port inst fdir sbin
  case "$pin" in *[!0-9.]*|"") pin="";; esac   # an IPv4 address or nothing (swg-noded checks it is on the box)
  [ "$owner" = "samosvalishe/free-turn-proxy" ] && owner="hackdiaz-dev/free-turn-proxy"   # repo deleted 2026-10; hackdiaz-dev carries it on (a record from before the move names the old one)
  case "$(uname -m)" in x86_64|amd64) arch=amd64;; aarch64|arm64) arch=arm64;; *) arch="";; esac
  # detect-and-REFUSE: the forks publish server-linux-amd64/arm64 only. Never fall back to amd64 on an unknown arch —
  # that fetched a wrong x86-64 binary → 404 / "Exec format error". Skip the turn-proxy with a clear message instead.
  [ -n "$arch" ] || { warn "no turn-proxy build for $(uname -m) — forks publish amd64/arm64 only; skipping this turn-proxy"; return 0; }
  # key each instance by <fork>-<port> so one fork can run many times (different ports + wrap keys)
  port="${listen##*:}"; inst="$fork-$port"; svc="vk-turn-proxy-$inst"
  fdir="$TURN_DIR/.bin/$fork"; sbin="$fdir/server"   # ONE binary per fork — shared by every instance
  dir="$TURN_DIR/$inst"; bin="$dir/server"            # this instance: turn.env + a 'server' symlink → the shared binary
  if [ -e "/etc/systemd/system/$svc.service" ]; then warn "turn-proxy $svc already exists — pick another port"; return 0; fi
  url="https://github.com/$owner/releases/latest/download/server-linux-$arch"
  mkdir -p "$PREFIX$fdir" "$PREFIX$dir"
  if $DRYRUN; then echo "    [skip] reuse-or-download the $fork binary → $sbin"
  elif [ -x "$PREFIX$sbin" ]; then info "reusing the $fork binary already downloaded ($sbin)"
  else
    info "Installing $owner ($listen → $connect) — downloading the binary from GitHub (up to ~2 min)…"
    if ! { dl_turn_bin "$owner" "$arch" "$PREFIX$sbin" && chmod +x "$PREFIX$sbin"; }; then
      warn "download failed for $owner — skipping this turn-proxy (retry later, or set SWG_TURN_MIRROR=<proxy> and re-run)"; return 0
    fi
  fi
  $DRYRUN || ln -sfn "../.bin/$fork/server" "$PREFIX$bin"   # ExecStart points here; resolves to the shared binary
  ver="$(turn_latest_tag "$owner")"
  printf '%s\n' "$owner"          | writef "$fdir/repo.txt" 644
  printf '%s\n' "${ver:-unknown}" | writef "$fdir/version.txt" 644
  writef "$dir/turn.env" 600 <<EOF
SWG_LISTEN=${listen}
${pin:+SWG_PIN=${pin}
}SWG_CONNECT=${connect}
SWG_PARAMS=${extra}
EOF
  writef "/etc/systemd/system/$svc.service" 600 <<EOF
[Unit]
Description=vk-turn-proxy ($owner) — ${listen} → ${connect}
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=-${dir}/turn.env
ExecStart=${bin} -listen \${SWG_LISTEN} -connect \${SWG_CONNECT} \$SWG_PARAMS
Restart=on-failure
RestartSec=3
$TURN_HARDENING

[Install]
WantedBy=multi-user.target
EOF
  run systemctl daemon-reload
  if [ -n "${TURN_DEFER_START:-}" ]; then   # docker→bare convert: the docker turn-proxy still holds the port → enable now, start at the switch
    run systemctl enable --quiet "$svc" || true
    ok "prepared turn-proxy $(col "$C_GREEN" "$inst") ($owner ${ver:-?}) — $listen → $connect (starts at the switch)"
  else
    run systemctl enable --quiet --now "$svc" || warn "couldn't start $svc"
    ok "installed turn-proxy $(col "$C_GREEN" "$inst") ($owner ${ver:-?}) — $listen → $connect"
  fi
}
# docker→bare convert: recreate the docker node's turn-proxies as bare systemd units (deferred — started at the
# switch), as the FIRST thing in Step 2 (so it reads interfaces-then-turns); the fork menu below then adds more.
migrate_docker_turns(){
  [ "${SWG_CONVERT:-}" = 1 ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local rec="${SWG_DOCKER_DIR:-/opt/swg-panel-docker}/data/node/turn-proxy.json" list svc owner lis con params fork _yn
  if [ ! -f "$rec" ] && command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; then
    mkdir -p "$(dirname "$rec")"; docker cp swg-node:/var/lib/swg-noded/turn-proxy.json "$rec" 2>/dev/null || true   # robust vs an empty ./data bind mount
  fi
  [ -f "$rec" ] || return 0
  list="$(python3 - "$rec" <<'PY' 2>/dev/null
import json, sys
try: d=json.load(open(sys.argv[1])); tps=d.get("turn_proxies") or []
except Exception: tps=[]
for t in (tps if isinstance(tps,list) else []):
    if t.get("service"): print("\t".join([t.get("service",""), t.get("owner",""), t.get("listen",""), t.get("connect",""), t.get("bind_ip") or "-", (t.get("params") or "")]))
PY
)"
  [ -n "$list" ] || return 0
  echo; info "Turn-proxies to migrate from the docker node:"; echo
  # pin before params, "-" when none: tab is IFS whitespace, so an empty field would collapse and shift params into it
  while IFS="$(printf '\t')" read -r svc owner lis con pin params; do [ -n "$svc" ] && printf '    %s%s%s  %s → %s\n' "$C_GREEN" "$svc" "$RESET" "${lis:-?}" "${con:-?}"; done <<EOF
$list
EOF
  echo
  # Approach B: auto-carry — always migrate the existing turn-proxies (no prompt). New ones are created from the panel.
  while IFS="$(printf '\t')" read -r svc owner lis con pin params; do
    [ -n "$svc" ] && [ -n "$owner" ] || continue
    fork="${svc#vk-turn-proxy-}"; fork="${fork%-*}"
    TURN_DEFER_START=1 install_turn_binary "$fork" "$owner" "$lis" "$con" "$params" "${pin#-}"
  done <<EOF
$list
EOF
}
migrate_docker_ifaces(){
  [ "${SWG_CONVERT:-}" = 1 ] || return 0
  local ifs n c pr lp addr _yn _mep
  ifs="$(for c in /etc/amnezia/amneziawg/*.conf /etc/wireguard/*.conf; do [ -f "$c" ] && basename "$c" .conf; done 2>/dev/null | sort -u || true)" || true; ifs="$(echo $ifs)"
  [ -n "$ifs" ] || return 0
  echo; info "Interfaces to migrate from the docker node:"; echo
  local _w=10; for n in $ifs; do [ "${#n}" -le "$_w" ] || _w="${#n}"; done   # name column as wide as the longest (a mesh link, swg_<8 hex>, is 12)
  _mep="${ENDPOINT_IP:-}"; case "$_mep" in 127.*|"") _mep="$(detect_public_ip 2>/dev/null || true)";; esac   # public endpoint clients dial (this box) — show it like the node's own interface list
  for n in $ifs; do c="/etc/amnezia/amneziawg/$n.conf"; pr=AmneziaWG; [ -f "$c" ] || { c="/etc/wireguard/$n.conf"; pr=WireGuard; }
    lp="$(sed -n 's/^[[:space:]]*ListenPort[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$c" | sed -n 1p)"
    addr="$(sed -n 's/^[[:space:]]*Address[[:space:]]*=[[:space:]]*\([0-9./]*\).*/\1/p' "$c" | sed -n 1p)"
    printf '    %s%-*s%s %-9s  %s:%-6s %s\n' "$C_GREEN" "$_w" "$n" "$RESET" "$pr" "${_mep:-?}" "${lp:-?}" "${addr:-?}"; done
  echo
  # Approach B: auto-carry — always keep the migrated interface confs (no prompt). They're adopted below and
  # surface in the panel; new interfaces are created there.
  echo
}
# turn-proxy forward-to value: accept an interface NAME (resolved to 127.0.0.1:<its listen port>) or a custom ip:port.
write_turn_record(){   # record detected turn-proxies for the panel (Phase 2: direct-vs-turn + wrap key for client configs)
  detect_turn; local json="" sep="" n
  for n in "${!TP_LISTEN[@]}"; do
    json+="$sep    { \"service\": \"$n\", \"listen\": \"${TP_LISTEN[$n]}\", \"connect\": \"${TP_CONNECT[$n]}\", \"wrap_key\": \"${TP_WRAP[$n]}\" }"; sep=$',\n'
  done
  writef "$TURN_RECORD" 640 <<EOF
{
  "turn_proxies": [
$json
  ]
}
EOF
}

[ "$(id -u)" = 0 ] || $DRYRUN || die "run as root (or use --dry-run)"
$DRYRUN || { have python3 || die "python3 (>= 3.7) is required — install it with your package manager, then re-run"; \
  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 7) else 1)' \
    || die "this box's python3 ($(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo '?')) is too old — swg-noded needs Python >= 3.7; install a newer python3 and re-run"; }
$DRYRUN && { info "DRY RUN — files render under ./dryrun, nothing executes."; rm -rf "$PREFIX"; }

if [ "${SWG_CONVERT:-}" != 1 ] && [ "${FORCE_ALONGSIDE:-}" != 1 ] && ! $DRYRUN \
     && command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; then
  die "this box already runs the swg-node CONTAINER, and a bare-metal install beside it would leave two
     daemons syncing the same node id and fighting over the same interfaces.

     Run the panel's command through bootstrap.sh instead of calling this script directly: it detects the
     docker install and offers to CONVERT it (settings, users and peers preserved) or to re-install it as
     docker — which is the choice this script, on its own, cannot offer.

     To install a NODE here anyway (the container is somebody else's, or is on its way out), re-run with
     FORCE_ALONGSIDE=1."
fi

if [ "${SWG_TURN_ADD:-}" = 1 ]; then
  # Approach B: turn-proxies are managed from the PANEL — no "add more" menu here. convert.sh has already carried the
  # existing turn-proxies; just (re)write the record and restart the daemon so the panel sees the carried set.
  write_turn_record
  run systemctl restart swg-noded || warn "couldn't restart swg-noded — carried turn-proxies reach the panel on its next start"
  exit 0
fi

# ═══════════════ NODE SETUP ═══════════════
echo; info "BARE-METAL SWG NODE SETUP"
$DRYRUN || seal_archives   # every recovery archive an earlier build left becomes root's alone (lib/common.sh, F90)
read_existing
case "$EXIST_EP" in 127.*|localhost|"::1") EXIST_EP="";; esac   # never hand clients a loopback
[ -n "$ENDPOINT_IP" ] || ENDPOINT_IP="$EXIST_EP"
# …and a docker → bare-metal convert says what each migrated interface's clients dial ("name=host,…" — convert.sh's
# docker_iface_endpoints): kept per interface, under whatever this box already records for it.
for _ae in $(printf '%s' "$ADOPTED_ENDPOINTS" | tr ',' ' '); do
  _an="${_ae%%=*}"; _ah="${_ae#*=}"
  [ -n "$_an" ] && [ "$_an" != "$_ae" ] && [ -n "$_ah" ] && [ -z "${IF_ENDPOINT[$_an]:-}" ] && IF_ENDPOINT[$_an]="$_ah"
done
if [ "$EXISTING" = yes ]; then
  info "Existing node install detected — keeping your interfaces + data. Press $(b Enter) to keep each value (to start fresh, run the uninstaller first)."
fi

# Panel connection — normally supplied by the install command's -host / -key flags; on a re-install
# the current values are offered as defaults so you can just press Enter.
if $DRYRUN; then ask "Panel URL (https://host[/subpath])" "$EXIST_URL" PANEL_URL
else ask_valid "Panel URL (https://host[/subpath])" "$EXIST_URL" PANEL_URL v_httpsurl "enter the panel's https:// URL (pass -host to skip this)"; fi
# token: a re-install reuses the existing one SILENTLY (no prompt — re-typing it is useless/error-prone);
# a fresh install (or no stored token) still asks. -key always wins.
if [ -n "$NODE_TOKEN" ]; then :                                                # provided via -key
elif [ "$EXISTING" = yes ] && [ -n "$EXIST_TOKEN" ]; then NODE_TOKEN="$EXIST_TOKEN"
# a dry run asks too, but must not die without one (it writes nothing) — and a key is never echoed, dry run or not
elif $DRYRUN; then ask_secret "Node enrollment key (from the Nodes screen)" "$EXIST_TOKEN" NODE_TOKEN true ""
else ask_secret "Node enrollment key (from the Nodes screen)" "$EXIST_TOKEN" NODE_TOKEN v_token "paste the key from Nodes → Add node (pass -key to skip this)"; fi
case "$PANEL_URL" in https://*) ;; http://*) _url_is_loopback "$PANEL_URL" || warn "panel URL is http:// — the key would travel in clear. Continue only if you know why.";; *) PANEL_URL="https://$PANEL_URL";; esac   # no scheme → default https://

# print the sha256 hex of the panel's TLS cert (unverified fetch), or nothing on failure. Matches the node's
# `fingerprint` format: hashlib.sha256(DER).hexdigest(), lowercase, no colons.
_panel_fp(){ python3 - "$1" <<'PY' 2>/dev/null || true
import ssl,socket,hashlib,sys,urllib.parse
r=sys.argv[1]; u=urllib.parse.urlparse(r if '://' in r else 'https://'+r)
host=u.hostname; port=u.port or 443
ctx=ssl._create_unverified_context()
with socket.create_connection((host,port),timeout=6) as s:
    with ctx.wrap_socket(s,server_hostname=host) as ss:
        der=ss.getpeercert(True)
if der: print(hashlib.sha256(der).hexdigest())
PY
}

if [ -z "$TLS_VERIFY" ] && [ -z "$TLS_FINGERPRINT" ] && [ -n "$EXIST_FP" ] && [ "${PANEL_URL%/}" = "${EXIST_URL%/}" ]; then
  _fp_now=""; $DRYRUN || _fp_now="$(_panel_fp "$PANEL_URL")"
  if [ -z "$_fp_now" ] || [ "$_fp_now" = "$(printf '%s' "$EXIST_FP" | tr -d ':' | tr 'A-F' 'a-f')" ]; then
    TLS_FINGERPRINT="$EXIST_FP"; TLS_VERIFY=no
    if [ -n "$_fp_now" ]; then ok "keeping the panel cert pin (sha256 ${EXIST_FP:0:16}…) — the panel still presents that certificate"
    elif $DRYRUN;        then sub "keeping the panel cert pin (sha256 ${EXIST_FP:0:16}…) — dry run, not re-checked against the panel"
    else warn "couldn't reach the panel to re-check its certificate — keeping the existing pin (sha256 ${EXIST_FP:0:16}…)"; fi
  elif panel_pin_changed "$EXIST_FP" "$_fp_now" "$PANEL_URL"; then
    if [ "${PIN_TO_CA:-}" = yes ]; then TLS_VERIFY=yes; TLS_FINGERPRINT=""; else TLS_FINGERPRINT="$_fp_now"; TLS_VERIFY=no; fi
  else pin_kept_stop; fi
fi
if [ -z "$TLS_VERIFY" ] && [ -z "$TLS_FINGERPRINT" ] && [ "$EXISTING" = yes ] && [ "$EXIST_VERIFY" = yes ] && [ -z "$EXIST_FP" ] \
   && [ "${PANEL_URL%/}" = "${EXIST_URL%/}" ]; then
  ask_yn "Verify the panel's TLS certificate? (this node verifies it through its CA)" y TLS_VERIFY
  [ "$TLS_VERIFY" = yes ] || TLS_VERIFY=""
fi
if [ -z "$TLS_VERIFY" ] && [ -z "$TLS_FINGERPRINT" ]; then
  _tls_def=y; _tls_why="auto-detected default"
  if [ -n "$PANEL_URL" ] && ! $DRYRUN; then
    _rc=0; curl -sS --max-time 6 -o /dev/null "${PANEL_URL%/}/healthz" 2>/dev/null || _rc=$?   # capture rc WITHOUT letting set -e abort — a self-signed/unreachable panel (the case this block exists for) makes curl exit non-zero
    if { [ "$_rc" = 60 ] || [ "$_rc" = 51 ]; } && curl -sSk --max-time 6 -o /dev/null "${PANEL_URL%/}/healthz" 2>/dev/null; then
      if panel_cert_expired "$PANEL_URL"; then   # lib/common.sh
        # an EXPIRED real certificate: keep CA verification (see panel_cert_expired) — never pin it
        warn "The panel's TLS certificate has EXPIRED (or is not valid yet) — it is not self-signed, so this node keeps verifying it. It syncs as soon as the panel's certificate is renewed; renew it on the panel host."
      else
        _tls_def=n
      fi
    fi
  fi
  if $DRYRUN && [ -n "$PANEL_URL" ]; then _TLS_DRY_UNPROBED=1; _tls_why="not probed in a dry run — default"; fi
  # SELF-SIGNED panel → PIN its certificate (trust-on-first-use) so the sync is MITM-protected by default,
  # instead of running unverified. Real-CA panels keep CA verification (pinning them would break on renewal).
  if [ "$_tls_def" = n ] && [ -n "$PANEL_URL" ] && ! $DRYRUN; then
    _fp="$(_panel_fp "$PANEL_URL")"
    if [ -n "$_fp" ]; then
      TLS_FINGERPRINT="$_fp"; TLS_VERIFY=no
      info "Panel cert is self-signed — pinning it (sha256 ${_fp:0:16}…) so a man-in-the-middle can't impersonate the panel."
    fi
  fi
  # real-CA (or the fingerprint fetch failed) → ask, defaulting to the secure choice
  if [ -z "$TLS_FINGERPRINT" ]; then
    ask_yn "Verify the panel's TLS certificate? ($_tls_why: $([ "$_tls_def" = y ] && echo yes || echo 'no — self-signed'))" "$_tls_def" TLS_VERIFY
  fi
fi

if [ "$EXISTING" = yes ] && ! $DRYRUN && [ "${SWG_CONVERT:-}" != 1 ] && [ -n "$EXIST_URL" ] && [ -n "$EXIST_TOKEN" ]; then
  rm -rf /var/lib/swg-noded/iface-keys 2>/dev/null || true
  LC_URL="$PANEL_URL"; LC_TOKEN="$NODE_TOKEN"; LC_VERIFY="${TLS_VERIFY:-no}"; LC_FP="${TLS_FINGERPRINT:-}"
  lc_init reinstall lc_emit_post
  LC_SUCCESS="reinstalled-updated"
  _SUM_BEFORE="$(installed_sum "$AGENT_DIR" "$NODED_DIR")"   # "…and updated" only if the install changes these (see the end)
fi

NODE_NAME="${NODE_NAME:-$(hostname -s 2>/dev/null || hostname)}"   # local label (systemd unit + final message)
PUSH_NAME=""; _cur=""
if { [ "$EXISTING" = yes ] || [ "${SWG_CONVERT:-}" = 1 ]; } && [ -n "$NODE_TOKEN" ] && [ -n "$PANEL_URL" ] && ! $DRYRUN; then
  _whoami_why=""
  if _wj="$(SWG_TOK="$NODE_TOKEN" panel_req GET "${PANEL_URL%/}/api/node/whoami" "${TLS_VERIFY:-no}" "${TLS_FINGERPRINT:-}" 8 2>/dev/null)"; then
    _cur="$(printf '%s' "$_wj" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("data") or {}).get("name") or "")' 2>/dev/null || true)"
    [ -n "$_cur" ] || _whoami_why="its answer named no node"
  else _whoami_why="${_wj:-no answer}"; fi
  step "Node name for THIS box"
  [ -n "$_cur" ] || info "the panel did not say what it calls this node (${_whoami_why}) — its name there is left as it is unless you type another"
  ask_valid "Node name for THIS box" "${_cur:-$NODE_NAME}" PUSH_NAME v_name "1–40 chars: letters, digits, - or _"
  [ "$PUSH_NAME" = "${_cur:-$NODE_NAME}" ] && PUSH_NAME=""    # what was offered → nothing to push
fi

# push a box-name change (if the operator entered a new one above)
if { [ "$EXISTING" = yes ] || [ "${SWG_CONVERT:-}" = 1 ]; } && ! $DRYRUN && [ -n "$PUSH_NAME" ]; then
  SWG_TOK="$NODE_TOKEN" SWG_BODY="$(python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1]}))' "$PUSH_NAME")" \
    panel_req POST "${PANEL_URL%/}/api/node/rename" "${TLS_VERIFY:-no}" "${TLS_FINGERPRINT:-}" 8 >/dev/null 2>&1 || true
fi

step "Datapath tooling"
echo
ensure_smart_tools || true            # nftables (smart routing) + dnsmasq (Force-DNS host tier)
ensure_wg_tools_once awg || true      # AmneziaWG tools + DKMS kernel module (default interface type)
ensure_wg_tools_once wg  || true      # plain WireGuard tools too — either type works when created later
choose_ifaces                         # detect + display + auto-adopt everything found (convert: incl. migrated confs)
migrate_docker_turns                  # docker→bare convert: carry existing turn-proxies (auto, no prompt)
write_turn_record                     # record carried turns for the panel (fresh install: writes an empty set)

if [ "${SWG_CONVERT:-}" = 1 ]; then
  apply_node_switch
  for _u in /etc/systemd/system/vk-turn-proxy-*.service; do [ -e "$_u" ] || continue; run systemctl enable --now "$(basename "$_u")" || true; done
fi

# ───────────────────────── install binaries ─────────────────────────
info "Agent + daemon"
for f in swg-agent swg-noded; do [ -f "$SRC/$f" ] || die "missing $f in $SRC"; done
mkdir -p "$PREFIX$AGENT_DIR" "$PREFIX$NODED_DIR"; cp "$SRC/swg-agent" "$PREFIX$AGENT_DIR/"; cp "$SRC/swg-noded" "$PREFIX$NODED_DIR/"
[ -f "$SRC/swg-sni" ] && { cp "$SRC/swg-sni" "$PREFIX$NODED_DIR/"; chmod 755 "$PREFIX$NODED_DIR/swg-sni"; }   # SNI-router classifier (routing_mode=sni)
[ -f "$SRC/swg-relay" ] && { cp "$SRC/swg-relay" "$PREFIX$NODED_DIR/"; chmod 755 "$PREFIX$NODED_DIR/swg-relay"; }   # TCP-terminating relay (accelerated mesh legs); inert until the panel asks for it
chmod 755 "$PREFIX$AGENT_DIR/swg-agent" "$PREFIX$NODED_DIR/swg-noded"; ok "installed agent + daemon"
[ -f "$REPO/VERSION" ] && cp "$REPO/VERSION" "$PREFIX$NODED_DIR/" || true   # version stamp (update.sh reports it)
mkdir -p "$PREFIX/var/lib/swg-noded" "$PREFIX/var/log/swg-agent" "$PREFIX/etc/swg-agent"

# Pre-install wg + awg tools regardless of what interfaces (if any) are configured now — so creating
# an interface later from the panel "just works" (the sandboxed agent can't apt-install at runtime).
info "Installing WireGuard + AmneziaWG tools (for future interface creation)"
ensure_wg_tools_once wg again || warn "wireguard tools not installed — wg interface creation will need them"   # apt only: retried (IN-18)
ensure_wg_tools_once awg || warn "amneziawg tools not installed (the amnezia ppa is Ubuntu-only) — awg interface creation will need them"
ensure_smart_tools  # nftables + dnsmasq for Phase-3 smart routing (domain tier); harmless if already present

# ───────────────────────── config.json (pull-only HTTPS) ─────────────────────────
IFJSON=""; sep=""
for n in "${SELECTED[@]}"; do n="${n// /}"; [ -z "$n" ] && continue
  _onb=""; iface_onboarded "$n" && _onb=', "onboarded": true'   # add-only (adopted interface — keep its peers)
  IFJSON+="$sep    \"$n\": { \"cmd\": [\"${IF_CMD[$n]}\"], \"conf\": \"${IF_CONF[$n]}\", \"endpoint_host\": \"${IF_ENDPOINT[$n]:-}\"${_onb} }"; sep=$',\n'; done
# node-level endpoint_host is now a fallback (the panel uses each interface's own when blank); default it to the first interface's
if [ -z "$ENDPOINT_IP" ]; then for n in "${SELECTED[@]}"; do [ -n "${IF_ENDPOINT[$n]:-}" ] && { ENDPOINT_IP="${IF_ENDPOINT[$n]}"; break; }; done; fi
[ -z "$ENDPOINT_IP" ] && ENDPOINT_IP="$(detect_public_ip)"
VERIFY_JSON=$([ "$TLS_VERIFY" = yes ] && echo true || echo false)
FP=""; [ -n "$TLS_FINGERPRINT" ] && FP=$',\n    "fingerprint": "'"$TLS_FINGERPRINT"'"'
printf '%s' "$EXIST_REF" | grep -cE '^[0-9a-f]{7,40}$' >/dev/null && EXIST_REF=""
printf '%s' "$EXIST_REF" | grep -cE '^[A-Za-z0-9._/-]{1,100}$' >/dev/null || EXIST_REF=""
_swg_ref="${SWG_REF:-${EXIST_REF:-main}}"
DNS_JSON="$(node_dns_json)"
writef /etc/swg-agent/config.json 640 <<EOF
{
  "interfaces": {
$IFJSON
  },
  "endpoint_host": "${ENDPOINT_IP}",
  "dns": ${DNS_JSON},
  "panel": {
    "url": "${PANEL_URL}",
    "token": "${NODE_TOKEN}",
    "verify": ${VERIFY_JSON}${FP}
  },
  "node": {
    "interval": ${INTERVAL},
    "agent": "${AGENT_DIR}/swg-agent",
    "sudo": false,
    "update_ref": "${_swg_ref}"
  }
}
EOF
warn "config.json holds the node key (mode 640, root:root). Treat it as a secret."

# daemon service (root)
_PNAME="${PUSH_NAME:-${_cur:-$NODE_NAME}}"
writef /etc/systemd/system/swg-noded.service 644 <<EOF
[Unit]
Description=swg-noded (HTTPS sync to panel) — ${_PNAME}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODED_DIR}/swg-noded
Environment=SWG_AGENT_CONFIG=/etc/swg-agent/config.json
Environment=SWG_NODED_STATE=/var/lib/swg-noded
Restart=on-failure
RestartSec=3
# ⚠️ Do NOT add NoNewPrivileges. It withholds no privilege this root daemon does not already hold,
# and a process carrying it cannot be switched into an AppArmor profile — so where the WireGuard tools
# are confined the kernel refuses to EXEC them and no interface can be created at all.
ProtectSystem=true
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
# the device-access tables must not outlive a downgrade — see noded_reach_sweep_dropin (lib/common.sh)
noded_reach_sweep_dropin "$NODED_DIR" | writef "/etc/systemd/system/$NODED_REACH_SWEEP_DROPIN" 644
# swg's own journal, held to its budget (lib/common.sh), and the command that reads it
if swg_log_ns_ok; then swg_log_ns_text swg-node | writef "/etc/systemd/system/swg-noded.service.d/$SWG_LOG_NS_DROPIN" 644; else swg_log_ns_clear; fi
if [ -f "$SRC/swg-logs" ]; then writef /usr/local/bin/swg-logs 755 < "$SRC/swg-logs"; fi

# enable
ensure_wg_apparmor

info "Enable daemon"
run systemctl daemon-reload
run systemctl enable --quiet swg-noded
# restart (not just enable --now): on a RE-RUN that added interfaces, swg-noded is already running and
# reads config.json only at startup — so without a restart the new interfaces never reach the panel.
run systemctl restart swg-noded || warn "couldn't start swg-noded"   # turn-proxies already up (convert) → first report carries them
$DRYRUN || [ -n "${SWG_CONVERT:-}${SWG_TURN_ADD:-}" ] || rm -f /var/lib/swg-recovery 2>/dev/null || true

# during a convert, skip this summary entirely — convert.sh prints ONE final combined summary (interfaces +
# turn-proxies) after. The switch is done here (interfaces + turn-proxies + daemon all up).
if [ "${SWG_CONVERT:-}" = 1 ]; then
  echo; ok "Node '$(bb "$_PNAME")' is up — fully converted to bare-metal (interfaces + turn-proxies)."
  exit 0
fi
# "re-installed AND UPDATED" only when the programs changed — the same build re-installed is plain "re-installed"
# (install-host.sh does the same; install-docker.sh compares image ids)
if [ "${LC_SUCCESS:-}" = reinstalled-updated ] && [ -n "${_SUM_BEFORE:-}" ] && [ "$(installed_sum "$AGENT_DIR" "$NODED_DIR")" = "$_SUM_BEFORE" ]; then
  LC_SUCCESS=reinstalled
fi
# ⚠️ A DRY RUN HAS NOTHING TO SUMMARISE (install-host.sh / install-docker.sh): print_summary describes the box as it IS,
# so a dry run of a node said "install complete" over the summary of whatever else the box runs (q6: its Docker panel).
if $DRYRUN; then
  echo; ok "Dry run of the bare-metal node $([ "$EXISTING" = yes ] && echo re-install || echo install) finished — nothing was installed or changed."
  echo "    The node would sync to $(b "$PANEL_URL") ($([ -n "$TLS_FINGERPRINT" ] && echo "panel cert pinned, sha256 ${TLS_FINGERPRINT:0:16}…" || { [ -n "${_TLS_DRY_UNPROBED:-}" ] && echo "its certificate is not checked in a dry run — the real run verifies a CA one or pins a self-signed one" || { [ "$VERIFY_JSON" = false ] && echo "certificate NOT verified" || echo "CA-verified"; }; }))."
else
echo; ok "Node '$(bb "$_PNAME")' install complete."
print_summary "$([ "$EXISTING" = yes ] && echo RE-INSTALL || echo INSTALL)"
[ -n "$TLS_FINGERPRINT" ] && echo "  TLS       panel cert pinned (sha256 ${TLS_FINGERPRINT:0:16}…) — MITM-protected"
[ "$VERIFY_JSON" = false ] && [ -z "$TLS_FINGERPRINT" ] && echo "  TLS       ${C_BROWN}not verifying the panel cert${RESET} — set TLS_FINGERPRINT to pin it (MITM protection)"
fi
if $DRYRUN; then echo; ok "DRY RUN done — inspect ./dryrun"; fi   # NB: an `if` (not `$DRYRUN && {…}`) so a non-dry-run doesn't make the script's LAST command exit non-zero (convert.sh read that as "install-node.sh reported an error")
echo     # one blank line after the summary block (consistency)
exit 0   # reaching here = success (every fatal error die'd with exit 1 earlier; a single interface that couldn't come up is a non-fatal warning)
