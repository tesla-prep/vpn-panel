#!/usr/bin/env bash
# Установка панели с systemd для ролей host и master.
set -euo pipefail

# ───────────────────────── CONFIG (blank = ask) ─────────────────────────
METHOD="${METHOD:-baremetal}"          # baremetal (systemd). For Docker, use docker-compose instead.
ROLE="${ROLE:-}"                       # master (panel + this box is an entry server) | host (panel only)
HOST_NODE_NAME="${HOST_NODE_NAME:-}"   # node name for THIS box (master only)
HOST_ENDPOINT_IP="${HOST_ENDPOINT_IP:-}" # public IP clients dial for this box's wg (master only)
_EP_GIVEN="$HOST_ENDPOINT_IP"            # …as the operator GAVE it, before any default fills it (seeds the panel's node record)
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
MANAGE_IFACES="${MANAGE_IFACES:-}"     # e.g. "awg0"  (blank = manage all detected; master only)
WG_MTU="${WG_MTU:-1280}"               # interface MTU — 1280 leaves headroom for turn-proxy obfuscation

PANEL_DOMAIN="${PANEL_DOMAIN:-}"       # panel URL: IP, host, or host/subpath (e.g. vpn.example.com/swg). Blank = this host's IP.
STORE_CONFIGS="${STORE_CONFIGS:-true}"   # keep client configs on the panel so QR/download stay available (set false for no secrets at rest)

SERVE_MODE="${SERVE_MODE:-}"           # internal (self-contained) | nginx | caddy | skip  (blank = ask)
# TLS — how to obtain the certificate:
TLS_MODE="${TLS_MODE:-}"               # cloudflare | letsencrypt | selfsigned | skip  (blank = ask)
_TLS_GIVEN="$TLS_MODE"                 # …as GIVEN (env, unattended), before any prompt or default touches it
ACME_EMAIL="${ACME_EMAIL:-}"           # account email for letsencrypt/cloudflare
CF_TOKEN="${CF_TOKEN:-}"               # cloudflare: API token with Zone:DNS:Edit
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"     # cloudflare: optional account id
CF_ORIGIN_TOKEN="${CF_ORIGIN_TOKEN:-${CF_ORIGIN_KEY:-}}"  # cf15: API token with Zone:SSL and Certificates:Edit (the Origin CA Key is deprecated)
CERT_FULLCHAIN="${CERT_FULLCHAIN:-}"   # skip-with-own-cert: path to fullchain.pem
CERT_KEY="${CERT_KEY:-}"               # skip-with-own-cert: path to private key.pem
BASIC_USER="${BASIC_USER:-admin}"
BASIC_PASS="${BASIC_PASS:-}"           # blank -> random, printed at the end (a GIVEN one never is — see the summary)
_PASS_GIVEN=no; [ -n "$BASIC_PASS" ] && _PASS_GIVEN=yes

# Remote nodes are NOT listed here — add them in the panel's Nodes screen, which
# issues a one-time token + an install-node.sh command to run on each server.

# paths / identities (defaults are sane)
PANEL_DIR="${PANEL_DIR:-/opt/swg-panel}"
SUB_DIR="${SUB_DIR:-/opt/swg-sub}"     # the public subscription surface (swg-sub); off until enabled in the panel
_SUB_PORT_GIVEN="${SUB_PORT:-}"        # …as GIVEN (env), before the default — a re-install otherwise keeps the one it had
SUB_PORT="${SUB_PORT:-8444}"           # swg-sub's listener (overridable in Settings → Subscriptions)
LOCAL_PORT="${LOCAL_PORT:-8088}"       # dedicated STABLE plain-HTTP loopback port a co-located (master) node dials at ROOT; a public flip never moves it. Bumped below if it clashes with PORT/SUB_PORT.
SUB_DOMAIN="${SUB_DOMAIN:-}"           # subscription page hostname, for the printed reverse-proxy config (blank = placeholder)
_SUB_BIND_GIVEN="${SUB_BIND:-}"        # …as GIVEN (env): install.conf keeps a given one for the next re-install
SUB_BIND="${SUB_BIND:-0.0.0.0}"        # swg-sub bind addr; set to 127.0.0.1 in reverse-proxy modes so only the proxy reaches it
SUB_USER="${SUB_USER:-swgsub}"         # swg-sub's own unprivileged user (group swg, read-only) — NOT the panel user
AGENT_DIR="${AGENT_DIR:-/opt/swg-agent}"
NODED_DIR="${NODED_DIR:-/opt/swg-noded}"
ETC_DIR="${ETC_DIR:-/etc/swg-panel}"
STATE_DIR="${STATE_DIR:-/var/lib/swg-panel}"
STATS_DIR="${STATS_DIR:-/var/www/wgstats}"
PANEL_USER="${PANEL_USER:-swgpanel}"
PORT="${PORT:-}"
PANEL_BASE="${PANEL_BASE:-}"           # derived from PANEL_DOMAIN's path (e.g. /swg); blank = served at root
TLS_DIR="${TLS_DIR:-/etc/swg-panel/tls}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/acme}"
# ────────────────────────────────────────────────────────────────────────

DRYRUN=false; _prev=""
for _a in "$@"; do
  case "$_a" in --dry-run) DRYRUN=true;; esac
  case "$_prev" in -pass|--pass|-password) BASIC_PASS="$_a"; _PASS_GIVEN=yes;; -user|--user|-username) BASIC_USER="$_a";; esac
  _prev="$_a"
done
PREFIX=""; $DRYRUN && PREFIX="$(pwd)/dryrun"
_WROTE=wrote; $DRYRUN && _WROTE="would write"   # a dry run writes the preview copy, not the file it names (1.8.8 deferred #13)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"
SRC="$REPO/src"
. "$SCRIPT_DIR/lib/common.sh"   # shared helpers: v_iface/v_subnet/v_hostport, next_free_port, dl_turn_bin
# Refuse on a declaratively managed host BEFORE anything is written — the panel laid down here would
# be invisible to the host's own tooling. Defined in lib/common.sh, above; a `--dry-run` still runs.
refuse_on_declarative_host 'services.swg-panel = { enable = true; ... };'
PALETTE=("#34d399" "#22d3ee" "#c084e8" "#f0913c" "#e8c04b" "#60a5fa" "#f0596b")

# ── colours / styling (honour NO_COLOR + non-tty) ──
if { [ -t 1 ] || [ -n "${SWG_FORCE_COLOR:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RESET=$'\033[0m'
  C_BLUE=$'\033[38;5;39m'; C_GREEN=$'\033[32m'; C_GREY=$'\033[90m'; C_CYAN=$'\033[36m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_BL=$'\033[38;5;33m'; C_BROWN=$'\033[38;5;130m'
else BOLD=""; RESET=""; C_BLUE=""; C_GREEN=""; C_GREY=""; C_CYAN=""; C_RED=""; C_YEL=""; C_BL=""; C_BROWN=""; fi
b(){   printf '%s%s%s' "$BOLD" "$*" "$RESET"; }
bb(){  printf '%s%s%s%s' "$BOLD" "$C_BLUE" "$*" "$RESET"; }   # bold + blue (handoff URL / login)
col(){ local _c="$1"; shift; printf '%s%s%s' "$_c" "$*" "$RESET"; }
conf_get(){ grep -iE "^[[:space:]]*$2[[:space:]]*=" "$1" 2>/dev/null | sed -n 1p | sed 's/.*=[[:space:]]*//; s/[[:space:]]*$//'; }
# one styled interface row (green name + proto + endpoint:port + address) for the manage-loop lists, matching the SUMMARY.
iface_row(){ local n="$1" conf proto ep lp addr   # set -e safe; prefer a just-queued spec (no conf yet), else the conf
  is_sys_iface "$n" && return 0   # panel-managed mesh links are never shown in a user-facing interface list
  if [ -n "${SPEC_CMD[$n]:-}" ]; then proto="${SPEC_CMD[$n]}"; lp="${SPEC_PORT[$n]:-}"; addr="${SPEC_ADDR[$n]:-}"; ep="${SPEC_EP[$n]:-}"
  else conf="${IF_CONF[$n]:-}"; proto="${IF_CMD[$n]:-?}"; ep="${IF_ENDPOINT[$n]:-${HOST_ENDPOINT_IP:-}}"
    lp="$(conf_get "$conf" ListenPort || true)"; addr="$(conf_get "$conf" Address || true)"; fi
  [ -n "$ep" ] || ep="$(detect_public_ip 2>/dev/null || true)"
  printf '    %s%s%s  %s%-10s%s  %s:%s  %s\n' "$C_GREEN" "$(printf '%-10s' "$n")" "$RESET" "$BOLD" "$(proto_label "${proto:-?}")" "$RESET" "${ep:-?}" "${lp:-?}" "${addr:-?}"; }
local_ifaces(){ { node_ifaces; wdtt_local | cut -f1; } 2>/dev/null | awk 'NF' | sort -u; }
kept_panel_ifaces(){ [ -f "$STATE_DIR/nodes.json" ] && [ -n "${HOST_NODE_NAME:-}" ] && have python3 || return 0
  python3 - "$STATE_DIR/nodes.json" "$HOST_NODE_NAME" <<'PY' 2>/dev/null | drop_sys_ifaces || true
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
for v in (d.values() if isinstance(d, dict) else []):
    if isinstance(v, dict) and v.get("name") == sys.argv[2]:
        for n, ov in (v.get("ifaces") or {}).items():
            if not (isinstance(ov, dict) and ov.get("system")):
                print(n)
        break
PY
}
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
writef(){ # writef <abs_path> <mode>   (content on stdin)
  local p="$1" m="${2:-644}" full="$PREFIX$1"; mkdir -p "$(dirname "$full")"; cat > "$full"
  chmod "$m" "$full" 2>/dev/null || true; ok "${_WROTE:-wrote} $p ($m)"; }
writef_atomic(){ # writef_atomic <abs_path> <mode>   (content on stdin)
  local p="$1" m="${2:-644}" full="$PREFIX$1"; mkdir -p "$(dirname "$full")"; cat > "$full.new"
  chmod "$m" "$full.new" 2>/dev/null || true; mv -f "$full.new" "$full"; ok "${_WROTE:-wrote} $p ($m)"; }
menu(){ printf '  %s\n      %s\n\n' "$1" "$2"; }   # menu <styled-label> <description>
key(){  printf '%s[%s]%s%s'   "$C_BLUE"        "$1" "$2" "$RESET"; }   # whole label blue:        key  a 'mneziawg'           → [a]mneziawg
keyd(){ printf '%s%s[%s]%s%s' "$BOLD" "$C_BLUE" "$1" "$2" "$RESET"; }   # default label bold+blue: keyd a 'mneziawg (default)'  → [a]mneziawg (default)
keyg(){ printf '%s[%s]%s%s'   "$C_GREY"        "$1" "$2" "$RESET"; }   # de-emphasised label grey:  keyg n 'one'                → [n]one
STEP="${STEP_BASE:-1}"; step(){ [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; echo "$(b "Step $STEP. $1")${2:+   $2}"; STEP=$((STEP+1)); }   # sequential; skip the leading blank when a prompt already printed one

_tty(){ swg_tty_ok; }
ask(){ local v p="$1" d="${2:-}"; if [ -n "${!3:-}" ]; then [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; _given "$p" "${!3}"; _pnl; return; fi
  echo; if _tty; then read -rp "  $p${d:+ [$(col "$C_BLUE" "$d")]}: " v <"${SWG_TTY:-/dev/tty}" || true; else _notty "$p" "$d"; fi; printf -v "$3" '%s' "${v:-$d}"; }
ask_yn(){ local v p="$1" d="${2:-y}"; if [ -n "${!3:-}" ]; then [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; _given "$p" "${!3}"; _pnl; return; fi
  [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; if _tty; then read -rp "  $p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " v <"${SWG_TTY:-/dev/tty}" || true; else _notty "$p" "$([ "$d" = y ] && echo yes || echo no)"; fi
  v="${v:-$d}"; case "$v" in [Yy]*) printf -v "$3" yes;; *) printf -v "$3" no;; esac; _pnl; }

# ── input validators (0 = ok) ──
v_role(){    case "$1" in master|host) return 0;; *) return 1;; esac; }
v_tls(){     case "$1" in cloudflare|letsencrypt|selfsigned|skip) return 0;; *) return 1;; esac; }
v_serve(){   case "$1" in internal|nginx|caddy|skip) return 0;; *) return 1;; esac; }
v_proto(){   case "$1" in a|awg|amneziawg|w|wg|wireguard) return 0;; *) return 1;; esac; }
v_ip(){      printf '%s' "$1" | grep -cE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' >/dev/null || return 1
             local o; for o in ${1//./ }; do [ "$o" -le 255 ] 2>/dev/null || return 1; done; return 0; }
v_host(){    v_ip "$1" && return 0; case "$1" in ""|*" "*|*[!a-zA-Z0-9.-]*) return 1;; *) return 0;; esac; }
v_url(){     case "$1" in ""|*" "*) return 1;; esac
             local h="${1#http://}"; h="${h#https://}"; h="${h%%/*}"; h="${h%%:*}"; v_host "$h"; }
v_port(){    case "$1" in ""|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
port_free(){ local p="$1" n   # UDP port not already bound AND not already taken by an interface queued this session
  for n in ${SPEC_ORDER[@]+"${SPEC_ORDER[@]}"}; do [ "${SPEC_PORT[$n]:-}" = "$p" ] && return 1; done
  have ss || return 0; [ -z "$(ss -lnuH "sport = :$p" 2>/dev/null)" ]; }
v_freeport(){ v_port "$1" && port_free "$1"; }
# host TCP port $1 is held by OUR panel's systemd service (a re-install) → not a real conflict. Identify it by
# the listener PID's cgroup so it holds on any port, not just :443 (mirrors docker's panel_owns_port).
panel_owns_port(){ have ss || return 1; local pid
  pid="$(ss -lntpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | sed -n 1p | cut -d= -f2 || true)"
  [ -n "$pid" ] && grep -qs swg-panel-server "/proc/$pid/cgroup"; }
panel_probe_url(){
  if [ "$_HAS_LOCAL_NODE" = yes ]; then printf 'http://127.0.0.1:%s/' "$LOCAL_PORT"; return 0; fi
  local sch=http
  [ "$SERVE_MODE" = internal ] && [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ] && sch=https
  printf '%s://127.0.0.1:%s%s/healthz' "$sch" "$PORT" "${PANEL_BASE:-}"; }
# smart default ports: first install offers the base; later ones offer (highest used OF THAT KIND)+1, then the
# next host-free port. turn = TP_LISTEN units; wg/awg = highest ListenPort across confs, never below 51820+queued.
turn_default_port(){ detect_turn; local hi=0 lis p; if [ "${#TP_LISTEN[@]}" -gt 0 ]; then for lis in "${TP_LISTEN[@]}"; do p="${lis##*:}"; case "$p" in ''|*[!0-9]*) :;; *) [ "$p" -gt "$hi" ] && hi="$p";; esac; done; fi; [ "$hi" -gt 0 ] && next_free_port $((hi+1)) || next_free_port 56000; }
v_name(){    case "$1" in ""|*[!a-zA-Z0-9_-]*) return 1;; esac; [ "${#1}" -le 40 ]; }
v_user(){    case "$1" in ""|*:*|*" "*) return 1;; esac; [ "${#1}" -le 40 ]; }
v_email(){   case "$1" in ?*@?*.?*) return 0;; *) return 1;; esac; }
v_cfport(){  case "$1" in 443|2053|2083|2087|2096|8443) return 0;; *) return 1;; esac; }  # ports Cloudflare's proxy forwards (HTTPS)
# 0 iff $1 is a public, routable IPv4 literal — excludes RFC1918 / loopback / link-local / CGNAT.
# Let's Encrypt only issues IP certs for public IPs, so this gates the letsencrypt-ip TLS option.
ip_public(){ case "$1" in *[!0-9.]*|*.*.*.*.*|*..*) return 1;; *.*.*.*) ;; *) return 1;; esac
  local a b; a="${1%%.*}"; b="${1#*.}"; b="${b%%.*}"
  case "$a" in
    0|10|127) return 1;;
    172) case "$b" in 1[6-9]|2[0-9]|3[01]) return 1;; esac;;
    192) case "$b" in 168) return 1;; esac;;
    169) case "$b" in 254) return 1;; esac;;
    100) case "$b" in 6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]) return 1;; esac;;
  esac
  return 0; }
# 0 iff the cert file $1 is valid for host $2 — i.e. $2 appears as a SAN (DNS/IP) or the CN. Used to decide
# whether a re-install can REUSE the existing cert: a cert issued for a different host/IP can't be reused here.
cert_covers_host(){ local cert="$1" host="$2" txt
  [ -s "$cert" ] && command -v openssl >/dev/null 2>&1 || return 1
  txt="$( { openssl x509 -in "$cert" -noout -ext subjectAltName; openssl x509 -in "$cert" -noout -subject; } 2>/dev/null || true)"
  if printf '%s' "$txt" | grep -cE "(DNS:|IP Address:|CN ?= ?)${host//./\\.}(\$|[^0-9A-Za-z.-])" >/dev/null; then return 0; fi
  return 1; }
cert_self_signed(){ local i s   # 0 iff the cert $1 is its own issuer — one mk_selfsigned made, never a CA's
  command -v openssl >/dev/null 2>&1 || return 1
  i="$(openssl x509 -in "$1" -noout -issuer 2>/dev/null | sed 's/^issuer= *//')"
  s="$(openssl x509 -in "$1" -noout -subject 2>/dev/null | sed 's/^subject= *//')"
  [ -n "$i" ] && [ "$i" = "$s" ]; }
# v_iface/v_subnet/v_hostport now in lib/common.sh

# No terminal: say which answer was taken for the prompt that could not be shown — else an unattended log reads a step
# header with nothing under it (1.8.8 qualification). Same line as install-docker.sh's and install-node.sh's.
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
    if declare -F "${fn}_why" >/dev/null 2>&1; then warn "$("${fn}_why" "$v")"; else warn "$hint"; fi
    echo "  re-enter, or append $(b ' --force') to use it anyway"
  done; }

detect_public_ip(){ # best public IPv4: default-route source, then first hostname -I (never the loopback)
  local ip; ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | sed -n 1p || true)"
  case "$ip" in 127.*) ip="";; esac                                                   # never the loopback — clients can't reach it
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^127\.' | sed -n 1p || true)"
  printf '%s' "$ip"; }
detect_wan(){ ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sed -n 1p; }

answer_to_url(){ # answer_to_url <answer> -> echoes a URL, or nothing if the answer is neither
  local a="$1"
  case "$a" in
    ''|*[!0-9]*) ;;                # has a non-digit → judge it as a host/URL below
    *) v_port "$a" && { printf '%s:%s%s' "${PANEL_HOST_NOPORT:-localhost}" "$a" "${PANEL_BASE:-}"; return 0; }
       return 1;;
  esac
  if v_url "$a"; then printf '%s' "$a"; return 0; fi
  return 1
}

parse_panel_url(){ # parse_panel_url <input> -> sets PANEL_HOST_NOPORT, PANEL_BASE, URL_PORT
  local u="$1" hostport rest
  u="${u#http://}"; u="${u#https://}"; u="${u%/}"
  hostport="${u%%/*}"                       # host[:port]
  rest="${u#"$hostport"}"                    # remaining /path (may be empty)
  PANEL_BASE="$rest"; [ "$PANEL_BASE" = "/" ] && PANEL_BASE=""
  PANEL_BASE="${PANEL_BASE%/}"               # no trailing slash
  case "$hostport" in
    *:*) PANEL_HOST_NOPORT="${hostport%%:*}"; URL_PORT="${hostport##*:}";;
    *)   PANEL_HOST_NOPORT="$hostport"; URL_PORT="";;
  esac
}

# ───────────────────────── wg/awg detection ─────────────────────────
declare -A IF_CMD IF_CONF IF_ENDPOINT; declare -a CREATED   # IF_ENDPOINT: per-interface public IP clients dial; CREATED: ifaces made this run
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
# ── interface picker helpers (bare-metal master) ──
node_ifaces(){ # interfaces this node already manages — config.json keys WHOSE CONF STILL EXISTS. A dangling entry
  # (conf file gone, no live device — e.g. a docker host-net interface orphaned by teardown) is a GHOST: skip it
  # so it's never shown as "already on this node" and re-adopted with blank fields (which then re-writes the ghost).
  { [ -f /etc/swg-agent/config.json ] && have python3; } || return 0
  python3 -c 'import json, os
for n, ic in (json.load(open("/etc/swg-agent/config.json")).get("interfaces") or {}).items():
    if isinstance(ic, dict) and os.path.exists(ic.get("conf", "")): print(n)' 2>/dev/null | drop_sys_ifaces || true
}
_in(){ case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }
choose_ifaces(){ # let the user pick which detected interfaces to manage; 'new' creates more
  local -a BACK=()   # the kept panel's own interfaces, live here (see the record-only branch)
  detect_wg
  manage_ifaces_resolve            # sets MANAGE_IFACES; must NOT be called in $( ) — see the function
  if [ -n "$MANAGE_IFACES" ]; then
    IFS=',' read -ra SELECTED <<< "$MANAGE_IFACES"
  else
    detect_wg
    local n _mine _kept; local -a cand=()
    _mine=" $(local_ifaces | tr '\n' ' ') "
    _kept=" $(kept_panel_ifaces | tr '\n' ' ') "
    for n in "${!IF_CMD[@]}"; do
      is_sys_iface "$n" && continue
      case "$_mine" in *" $n "*) continue;; esac   # already managed by this node → local, not a candidate
      case "$_kept" in *" $n "*) ip link show "$n" >/dev/null 2>&1 && { BACK+=("$n"); continue; };; esac
      cand+=("$n")
    done
    if [ "${#BACK[@]}" -gt 0 ]; then
      echo; info "Found ${#BACK[@]} wg/awg interface(s) the panel already manages for this node — it takes them back on its first sync:"; echo
      for n in "${BACK[@]}"; do iface_row "$n"; done; echo
    fi
    if [ "${#cand[@]}" -gt 0 ]; then
      echo; info "Found ${#cand[@]} wg/awg/wdtt interface(s) NOT managed by the panel — adopt them from the panel (Node → Interfaces → adoption candidates):"; echo
      for n in "${cand[@]}"; do iface_row "$n"; done; echo
    elif [ "${#BACK[@]}" -eq 0 ]; then
      info "No unmanaged wg/awg/wdtt interfaces found on this box — nothing to adopt."
    fi
    SELECTED=()   # record-only: nothing auto-adopted; the panel decides per candidate (adopt / ignore)
  fi
  apply_specs   # install tools + write confs + bring up every queued interface now (after all prompts)
  detect_wg
  local _ep
  for n in "${SELECTED[@]}"; do n="${n// /}"; [ -n "${IF_CMD[$n]:-}" ] || { [ -e "/etc/amnezia/amneziawg/$n.conf" ] && { IF_CMD[$n]=awg; IF_CONF[$n]="/etc/amnezia/amneziawg/$n.conf"; } || { IF_CMD[$n]=wg; IF_CONF[$n]="/etc/wireguard/$n.conf"; }; }
    [ -n "${IF_ENDPOINT[$n]:-}" ] && continue   # interfaces just created already have an endpoint
    # the endpoint the operator GAVE (HOST_ENDPOINT_IP) is what the interface advertises — left blank here it falls
    # back to it; re-detecting pinned the default-route address instead (install-node.sh does the same, see there)
    case "${HOST_ENDPOINT_IP:-}" in ""|127.*|localhost) ;; *) echo "    Kept $(bb "$HOST_ENDPOINT_IP") (this node's endpoint) for $(col "$C_GREEN" "$n")"; continue;; esac
    _ep="$(detect_public_ip)"; IF_ENDPOINT[$n]="$_ep"   # auto endpoint clients dial (change it later in the panel)
    echo "    Used $(bb "$_ep") endpoint IP for $(col "$C_GREEN" "$n")"; done
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
  elif [ "${#BACK[@]}" -eq 0 ]; then info "No local interfaces yet — this node is managed from the panel (Interfaces → Load new interface)."; fi
  _l="$(printf '%s\n' ${SELECTED[@]+"${SELECTED[@]}"} | tr -d ' ' | drop_sys_ifaces | awk 'NF' | tr '\n' ' ')"
  [ -n "${_l// /}" ] && ok "Managing: $(b "$(col "$C_GREEN" "${_l% }")")" || true
}

# turn-proxy (vk-turn-proxy)
TURN_DIR="${TURN_DIR:-/opt/vk-turn-proxy}"
TURN_RECORD="${TURN_RECORD:-/etc/swg-agent/turn-proxy.json}"
declare -A TP_LISTEN TP_CONNECT TP_WRAP
gen_wrap_key(){ $DRYRUN && { echo "GENERATED-ON-REAL-RUN"; return 0; }   # 32-byte key as 64 hex chars
  openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Per-fork obfuscation flags (verified from each binary's -h). Echoes the flags WITH a
# freshly generated -wrap-key baked in.
turn_wrap_flags(){ local k; case "$1" in
  anton48)      k="$(gen_wrap_key)"; printf -- '-wrap-srtp -wrap-key %s' "$k";;
  samosvalishe) k="$(gen_wrap_key)"; printf -- '-wrap -wrap-key %s' "$k";;
  WINGS-N)      k="$(gen_wrap_key)"; printf -- '-wrap-mode on -wrap-key %s' "$k";;
  Moroka8)      k="$(gen_wrap_key)"; printf -- '-wrap -wrap-key %s' "$k";;   # verified from its README: -wrap -wrap-key
  *) printf '';; esac; }
turn_wg_ports(){   # echo "<iface>:<ListenPort>" for every interface managed in the wg/awg step
  local n p
  for n in ${SELECTED[@]+"${SELECTED[@]}"}; do
    [ -n "${IF_CONF[$n]:-}" ] || continue
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
        wk="$(printf '%s\n' "$params" | sed -n 's/.*-wrap-key[ =]\{1,\}\([^ ]*\).*/\1/p')" ;;
      *)            # legacy baked-ExecStart form
        lis="$(printf '%s\n' "$exe" | sed -n 's/.*-listen[ =]\{1,\}\([^ ]*\).*/\1/p')"
        con="$(printf '%s\n' "$exe" | sed -n 's/.*-connect[ =]\{1,\}\([^ ]*\).*/\1/p')"
        wk="$(printf '%s\n' "$exe" | sed -n 's/.*-wrap-key[ =]\{1,\}\([^ ]*\).*/\1/p')" ;;
    esac
    TP_LISTEN[$name]="$lis"; TP_CONNECT[$name]="$con"; TP_WRAP[$name]="$wk"
  done
}
turn_latest_tag(){ $DRYRUN && { echo "v0.0.0"; return 0; }   # turn_latest_tag <owner/repo>
  curl -fsSL --connect-timeout 10 --max-time 20 "https://api.github.com/repos/$1/releases/latest" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tag_name",""))' 2>/dev/null || true; }
install_turn_binary(){ # <fork> <owner/repo> <listen ip:port> <connect ip:port> <extra-flags>
  local fork="$1" owner="$2" listen="$3" connect="$4" extra="$5" arch dir bin svc url ver port inst fdir sbin
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
  printf '%s\n' "$owner"        | writef "$fdir/repo.txt" 644
  printf '%s\n' "${ver:-unknown}" | writef "$fdir/version.txt" 644
  # listen/connect/params live in turn.env so a panel edit only rewrites it + restarts (no daemon-reload)
  writef "$dir/turn.env" 600 <<EOF
SWG_LISTEN=${listen}
SWG_CONNECT=${connect}
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
  run systemctl daemon-reload; run systemctl enable --quiet --now "$svc" || warn "couldn't start $svc"
  ok "installed turn-proxy $(col "$C_GREEN" "$inst") ($owner ${ver:-?}) — $listen → $connect"
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
    have wg && { modprobe wireguard 2>/dev/null || true; return 0; }   # wireguard is in-tree on modern kernels
    return 1
  fi
  awg_go_needs_install && { awg_go_pinned || warn "AmneziaWG: the pinned userspace fallback could not be fetched — awg interfaces depend on the kernel module alone until an update installs it"; }   # missing, or one of our earlier pinned builds
  if have awg && modprobe amneziawg 2>/dev/null; then                 # already fully working (tool + loadable module) —
    $DRYRUN || awg_compat_patch_installed >/dev/null || true          # …its source fixed for the NEXT kernel (PR #218)
    return 0
  fi
  # graceful degrade on a non-apt distro (Fedora/RHEL/Arch/Alpine): tell the operator what to install by hand rather
  # than silently limp on with no datapath. The apt paths below stay for Debian/Ubuntu.
  $DRYRUN || have apt-get || { warn "AmneziaWG not installed — no apt-get on this system; install dkms, linux-headers-$(uname -r) and amneziawg-dkms with your package manager, then re-run"; return 1; }
  local _ppa=""
  if _ppa="$(awg_ppa_suite)"; then   # Ubuntu, or a system built on it: the amnezia PPA serves its series (lib/common.sh)
    info "installing AmneziaWG (tools + DKMS kernel module) from the amnezia PPA for Ubuntu $_ppa — this can take a minute…"
    run apt-get update -qq || true
    awg_ppa_add "$_ppa"
    run apt-get update -qq || true
    # REQUIRED so amneziawg-dkms can build against THIS kernel; try the exact headers, fall back to the meta package.
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
build_awg_module(){ # FORCE the amneziawg DKMS module to COMPILE for the RUNNING kernel. Critical: `apt install
  run dkms autoinstall -k "$(uname -r)" 2>/dev/null || run dkms autoinstall 2>/dev/null || true
  awg_dkms_build_all_kernels   # D4: every installed kernel with headers — an installed-but-not-booted kernel included
  modprobe amneziawg 2>/dev/null && return 0
  awg_mod_key_rejected && return 1   # built, refused for its key (Secure Boot) — a reinstall would only build it again
  awg_dkms_reinstall || return 1   # the source fixed again and dpkg finished; given up when it does not compile (lib/common.sh)
  run dkms autoinstall -k "$(uname -r)" 2>/dev/null || true
  run modprobe amneziawg 2>/dev/null || true
}
ensure_smart_tools(){ # nftables (smart-routing marking, every mode) + dnsmasq (Force-DNS host tier) — idempotent, non-fatal
  have nft     || { run apt-get update -qq || true; run apt-get install -y nftables || true; }
  # masked FIRST: its postinst starts it, the start fails on :53 (systemd-resolved) and the first install printed an error
  # for a unit masked a moment later anyway; a masked unit is not started (1.8.8 deferred #5(b))
  have dnsmasq || { run apt-get update -qq || true; run systemctl mask dnsmasq 2>/dev/null || true; run apt-get install -y dnsmasq || true; }
  have ipset   || { run apt-get update -qq || true; run apt-get install -y ipset    || true; }   # kernel-SNI mode (xt_string learn → ipset); degrades to userspace SNI if absent
  run systemctl disable --now dnsmasq 2>/dev/null || true
  run systemctl mask dnsmasq 2>/dev/null || true
  run systemctl reset-failed dnsmasq 2>/dev/null || true
}
server_addr(){ # server_addr <cidr> -> "<first-host>/<prefix>"
  have python3 || die "python3 is required to compute the tunnel address (it's also needed by the daemon)"
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
# default subnet = (highest used 10.X.0.0/24 second-octet)+1, then the next free above it (10.8 if none).
next_free_subnet(){ local hi=7 n a o
  for n in ${SPEC_ORDER[@]+"${SPEC_ORDER[@]}"}; do a="${SPEC_SUBNET[$n]:-}"; [ -n "$a" ] || continue; o="$(_net24 "$a" | cut -d. -f2)"; case "$o" in ''|*[!0-9]*) :;; *) [ "$o" -gt "$hi" ] && hi="$o";; esac; done
  for n in "${!IF_CONF[@]}"; do a="$(conf_get "${IF_CONF[$n]}" Address)"; [ -n "$a" ] || continue; o="$(_net24 "$a" | cut -d. -f2)"; case "$o" in ''|*[!0-9]*) :;; *) [ "$o" -gt "$hi" ] && hi="$o";; esac; done
  o=$((hi+1)); while [ "$o" -lt 255 ] && subnet_used "10.$o.0.0/24"; do o=$((o+1)); done; echo "10.$o.0.0/24"; }
# default interface index = (highest numeric suffix across existing + queued names)+1 (awg3,wg4 → 5).
v_subnet_free(){ v_subnet "$1" || return 1; subnet_used "$1" && return 1; return 0; }
apply_specs(){ # install tools + write confs + bring up every queued interface, then prune failures
  ensure_smart_tools   # nftables (smart-routing marking) + dnsmasq (Force-DNS host tier) for this master's local node
  [ "${#SPEC_ORDER[@]}" -gt 0 ] || return 0
  local name proto port subnet addr conf cmd priv dir wan up down upok ep obf failed=""
  echo; info "Setting up ${#SPEC_ORDER[@]} interface(s)…"
  for name in "${SPEC_ORDER[@]}"; do
    cmd="${SPEC_CMD[$name]}"; proto="${SPEC_PROTO[$name]}"; port="${SPEC_PORT[$name]}"; subnet="${SPEC_SUBNET[$name]}"
    addr="${SPEC_ADDR[$name]}"; wan="${SPEC_WAN[$name]}"; ep="${SPEC_EP[$name]}"; dir="${SPEC_DIR[$name]}"; conf="$dir/$name.conf"
    if ! ensure_wg_tools_once "$cmd" again; then warn "couldn't install $cmd tools — skipping interface '$name'"; failed="$failed $name"; continue; fi
    # gateway plumbing: forward + masquerade the tunnel subnet out the WAN (bound to iface lifecycle)
    up="$(nat_hook_up "${subnet}" "${wan}")"   # reap-then-add: one copy whatever was there (lib/common.sh)
    down="$(nat_hook_down "${subnet}" "${wan}")"
    printf 'net.ipv4.ip_forward = 1\nnet.ipv4.conf.all.route_localnet = 1\n' | writef /etc/sysctl.d/99-swg-forward.conf 644
    run sysctl -q -w net.ipv4.ip_forward=1
    run sysctl -q -w net.ipv4.conf.all.route_localnet=1   # lets Force-DNS DNAT client :53 to loopback dnsmasq (else silent DNS blackhole on this master's local node)
    if $DRYRUN; then priv="<generated-on-real-run>"
    elif ! priv="$("$cmd" genkey 2>/dev/null)" || [ -z "$priv" ]; then warn "'$cmd genkey' failed — skipping interface '$name'"; failed="$failed $name"; continue; fi
    obf=""
    if [ "$cmd" = awg ] && ! obf="$(awg_initial_obfuscation "$SRC")"; then
      warn "couldn't generate AmneziaWG parameters — skipping interface '$name'"; failed="$failed $name"; continue
    fi
    { printf '[Interface]\nPrivateKey = %s\nAddress = %s\nListenPort = %s\nMTU = %s\n' "$priv" "$addr" "$port" "$WG_MTU"
      printf 'PostUp = %s\nPostDown = %s\n' "$up" "$down"
      if [ -n "$obf" ]; then printf '%s\n' "$obf"; fi; } | writef "$conf" 600
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

# ───────────────────────── prompts ─────────────────────────
[ "$(id -u)" = 0 ] || $DRYRUN || die "run as root (or use --dry-run)"
$DRYRUN || { have python3 || die "python3 (>= 3.8) is required — install it with your package manager, then re-run"; \
  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' \
    || die "this box's python3 ($(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo '?')) is too old — the panel needs Python >= 3.8; install a newer python3 and re-run"; }
$DRYRUN && { info "DRY RUN — files render under ./dryrun, nothing executes."; rm -rf "$PREFIX"; }

# ═══════════════ I. PANEL SETUP ═══════════════
echo; info "BARE-METAL SWG PANEL SETUP"
ensure_swap   # low-RAM/zero-swap boxes OOM the panel on list-resolve spikes — add swap before anything heavy
$DRYRUN || seal_archives   # every recovery archive an earlier build left becomes root's alone (lib/common.sh, F90)
guard_second_panel baremetal   # a Docker panel already live here would answer beside this one — see lib/common.sh

# Idempotent re-install: detect an existing panel UP FRONT and offer its saved answers as the
# defaults for every step (mirrors the docker installer's .env reuse). To start fresh, uninstall first.
EXISTING_HOST=no; KEEP_AUTH=no
DOM_SAVED=""; BASE_SAVED=""; PORT_SAVED=""; TLS_SAVED=""; SERVE_SAVED=""; ROLE_SAVED=""; EMAIL_SAVED=""; NODENAME_SAVED=""; ENDPOINT_SAVED=""; LOCAL_PORT_SAVED=""
SUB_PORT_SAVED=""; SUB_BIND_SAVED=""
_unit=/etc/systemd/system/swg-panel-server.service
if [ -f "$ETC_DIR/auth" ] || [ -f "$_unit" ]; then
  EXISTING_HOST=yes; KEEP_AUTH=yes
  [ "${BASIC_USER:-admin}" = admin ] && [ -f "$ETC_DIR/auth" ] && BASIC_USER="$(cut -d: -f1 "$ETC_DIR/auth" 2>/dev/null || echo admin)"
  if [ -f "$ETC_DIR/install.conf" ]; then                 # snapshot of the previous install's answers
    DOM_SAVED="$(sed -n 's/^PANEL_DOMAIN=//p'        "$ETC_DIR/install.conf" | sed -n 1p)"
    BASE_SAVED="$(sed -n 's/^PANEL_BASE=//p'         "$ETC_DIR/install.conf" | sed -n 1p)"
    PORT_SAVED="$(sed -n 's/^PORT=//p'               "$ETC_DIR/install.conf" | sed -n 1p)"
    TLS_SAVED="$(sed -n 's/^TLS_MODE=//p'            "$ETC_DIR/install.conf" | sed -n 1p)"
    SERVE_SAVED="$(sed -n 's/^SERVE_MODE=//p'        "$ETC_DIR/install.conf" | sed -n 1p)"
    [ -z "$SUB_DOMAIN" ] && SUB_DOMAIN="$(sed -n 's/^SUB_DOMAIN=//p' "$ETC_DIR/install.conf" | sed -n 1p)"
    ROLE_SAVED="$(sed -n 's/^ROLE_SEL=//p'           "$ETC_DIR/install.conf" | sed -n 1p)"
    EMAIL_SAVED="$(sed -n 's/^ACME_EMAIL=//p'        "$ETC_DIR/install.conf" | sed -n 1p)"
    NODENAME_SAVED="$(sed -n 's/^HOST_NODE_NAME=//p' "$ETC_DIR/install.conf" | sed -n 1p)"
    ENDPOINT_SAVED="$(sed -n 's/^HOST_ENDPOINT_IP=//p' "$ETC_DIR/install.conf" | sed -n 1p)"
    LOCAL_PORT_SAVED="$(sed -n 's/^LOCAL_PORT=//p'   "$ETC_DIR/install.conf" | sed -n 1p)"
    SUB_PORT_SAVED="$(sed -n 's/^SUB_PORT=//p'       "$ETC_DIR/install.conf" | sed -n 1p)"
    SUB_BIND_SAVED="$(sed -n 's/^SUB_BIND=//p'       "$ETC_DIR/install.conf" | sed -n 1p)"
    CF_TOKEN_SAVED="$(sed -n 's/^CF_TOKEN=//p'               "$ETC_DIR/install.conf" | sed -n 1p)"
    CF_ORIGIN_TOKEN_SAVED="$(sed -n 's/^CF_ORIGIN_TOKEN=//p' "$ETC_DIR/install.conf" | sed -n 1p)"
  fi
  # fallback for installs predating install.conf: recover PORT + subpath from the running unit
  [ -z "$PORT_SAVED" ] && [ -f "$_unit" ] && PORT_SAVED="$(sed -n 's/^Environment=SWG_PANEL_PORT=//p' "$_unit" | sed -n 1p)"
  [ -z "$BASE_SAVED" ] && [ -f "$_unit" ] && BASE_SAVED="$(sed -n 's/^Environment=SWG_PANEL_BASE=//p' "$_unit" | sed -n 1p)"
  # …and swg-sub's port from its own unit, for an install.conf that has none (below: F92)
  [ -z "$SUB_PORT_SAVED" ] && SUB_PORT_SAVED="$(sed -n 's/^Environment=SWG_SUB_PORT=//p' /etc/systemd/system/swg-sub.service 2>/dev/null | sed -n 1p || true)"   # || true: no unit → sed fails, and set -e must not end the run
  # not during a convert: that state is the one the conversion itself just staged (install-docker.sh, same note)
  if [ -n "${SWG_CONVERT_DIR:-}" ]; then :
  elif [ -f "$_unit" ]; then info "Existing panel install detected — keeping your login, users, nodes + certs; your previous settings are the defaults below. To start fresh, run the uninstaller first."
  else info "Found this panel's kept data (login, certificate, users, nodes) — re-installing it as it was; its previous settings are the defaults below. To start fresh, uninstall again and delete the data."; fi
elif [ -f "$STATE_DIR/panel-settings.json" ] || [ -f "$STATE_DIR/nodes.json" ]; then
  { IFS= read -r DOM_SAVED; IFS= read -r PORT_SAVED; IFS= read -r BASE_SAVED; IFS= read -r TLS_SAVED
    IFS= read -r NODENAME_SAVED; IFS= read -r ENDPOINT_SAVED; } < <(python3 - "$STATE_DIR" <<'PYKEPT' 2>/dev/null || true
import hashlib, json, os, socket, sys
from urllib.parse import urlparse
st = sys.argv[1]
def load(n):
    try:
        d = json.load(open(os.path.join(st, n)))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}
acc = load("panel-settings.json").get("access") or {}
u = urlparse(((acc.get("panel") or {}).get("url") or "").strip())
base = (u.path or "").rstrip("/")
mid = ""
for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
    try:
        mid = open(p).read().strip()
    except Exception:
        mid = ""
    if mid:
        break
nid = hashlib.sha256(((mid or socket.gethostname()) + "|swg-local-node").encode()).hexdigest()[:12]
me = load("nodes.json").get(nid) or {}
for v in (u.hostname or "", str(u.port or ""), base, (acc.get("tls") or {}).get("mode") or "",
          me.get("name") or "", me.get("endpoint_host") or ""):
    print(str(v).replace("\n", " "))
PYKEPT
)
  [ -n "$NODENAME_SAVED" ] && ROLE_SAVED=master
  [ -n "$DOM_SAVED$NODENAME_SAVED" ] && info "Found this panel's data from an earlier uninstall — its address ($(b "${DOM_SAVED:-?}${PORT_SAVED:+:$PORT_SAVED}${BASE_SAVED}")) and node name ($(b "${NODENAME_SAVED:-?}")) are the defaults below. Its login and certificate were not kept, so a new login is minted and nodes pinned to the old certificate need their installer re-run."
fi
if [ -z "$_SUB_PORT_GIVEN" ] && [ -n "$SUB_PORT_SAVED" ] && v_port "$SUB_PORT_SAVED"; then SUB_PORT="$SUB_PORT_SAVED"; fi
if [ -z "$_SUB_BIND_GIVEN" ] && [ -n "$SUB_BIND_SAVED" ]; then SUB_BIND="$SUB_BIND_SAVED"; fi
SET_PASS=no
if [ "$KEEP_AUTH" = yes ] && [ "$_PASS_GIVEN" = yes ] && [ -s "$ETC_DIR/auth" ] && ! login_holds "$ETC_DIR/auth" "$BASIC_USER" "$BASIC_PASS"; then
  SET_PASS=yes
  if $DRYRUN; then info "dry run — would set a new panel login ($(b "$BASIC_USER")): the password given is not the one it has"
  else info "Setting a new panel login ($(b "$BASIC_USER")) — the password given is not the one it has; it replaces it."; fi
fi
if [ -z "$HOST_ENDPOINT_IP" ] && { [ "$EXISTING_HOST" = yes ] || [ -n "$ENDPOINT_SAVED" ]; }; then   # (the latter: an older uninstall's kept store)
  _aep="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("endpoint_host") or "")' 2>/dev/null || true)"
  case "$_aep" in 127.*|localhost|"::1") _aep="";; esac
  HOST_ENDPOINT_IP="${_aep:-$ENDPOINT_SAVED}"
fi

if [ "$EXISTING_HOST" = yes ] && ! $DRYRUN; then
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  LC_FILE="$STATE_DIR/host_proc"
  if [ -f /etc/swg-agent/config.json ]; then   # a local node exists (master) → also drive its tile
    LC_URL="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("url",""))' 2>/dev/null || true)"
    LC_TOKEN="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("token",""))' 2>/dev/null || true)"
    LC_VERIFY="$(python3 -c 'import json;print("yes" if (json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("verify",True) else "no")' 2>/dev/null || echo no)"
    # …and its pin, if it has one: every call that carries the token checks the panel with it (panel_req, lib/common.sh)
    LC_FP="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("fingerprint") or "")' 2>/dev/null || true)"
  fi
  lc_emit_host(){ lc_emit_file "$1" "${2:-}"; lc_emit_post "$1" "${2:-}"; }   # host_proc + (master) the local node
  # SWG_LC_PARENT=1 ⇒ convert.sh (a docker→bare host/master convert) owns the lifecycle terminal, so it can emit
  # "converted" WITH its final summary instead of us firing it mid-flow before the node phase. Skip our own lc_init.
  [ "${SWG_LC_PARENT:-}" = 1 ] || lc_init "${SWG_CONVERT_DIR:-reinstall}" lc_emit_host   # convert.sh passes convert-bare → "converting/converted to bare-metal"
  [ -z "${SWG_CONVERT_DIR:-}" ] && LC_SUCCESS="reinstalled-updated"   # plain re-install installs the latest; a convert keeps its converted-bare success
  # …"and updated" only if it actually changed what is installed (checked against this, before the summary)
  _SUM_BEFORE="$(installed_sum "$PANEL_DIR" "$SUB_DIR" "$NODED_DIR" "$AGENT_DIR" /usr/local/bin/swg-netctl /usr/local/bin/swg-passwd)"
  # …and after an uninstall that kept the data there are no programs to compare: the version the panel last ran is the
  # one thing left that tells a same-build re-install from an update (the panel writes it at every start)
  [ -n "$_SUM_BEFORE" ] || _VER_BEFORE="$(head -1 "$STATE_DIR/panel_version" 2>/dev/null || true)"
fi
_NOW="--now"; [ "${SWG_DEFER_START:-}" = 1 ] && _NOW=""

# Server role — skipped when already chosen (e.g. by bootstrap.sh)
ROLE_SEL=""
case "$ROLE" in master|host+node) ROLE_SEL=master;; host) ROLE_SEL=host;; node) die "for a node-only box run install-node.sh, not this script";; esac
if [ -z "$ROLE_SEL" ]; then
  step "Server role"
  menu "$(col "$C_BLUE" '[1]') $(keyd m 'aster (default)')" "Masternode — this server will host the panel and run WG/AWG interfaces"
  menu "$(col "$C_BLUE" '[2]') $(keyd h 'ost')"            "This server will host only the panel. WG/AWG nodes will be deployed separately"
  ask_choice "Select role (number, letter or name)" "${ROLE_SAVED:-master}" ROLE_SEL "master host"
fi
case "$ROLE_SEL" in master) ROLE="host+node";; host) ROLE="host";; esac
HOST_HAS_WG=no; [ "$ROLE" = "host+node" ] && HOST_HAS_WG=yes

# panel URL (may include a subpath, e.g. vpn.example.com/swg)
step "Panel URL"
echo
echo "      Where the panel is reached — an IP, a host, or a host with a subpath to"
echo "      live under an existing site (e.g. $(b 'vpn.example.com/swg'))."
echo
DEF_URL="${PANEL_DOMAIN:-}"; _URL_GIVEN="${PANEL_DOMAIN:-}"   # (a -domain / PANEL_DOMAIN the caller gave — said below, not asked)
if [ -n "$DEF_URL" ]; then
  case "$DEF_URL" in *:*) :;; *) { [ -n "${PORT:-}" ] && [ "$PORT" != 443 ]; } && DEF_URL="$DEF_URL:$PORT";; esac
  case "$DEF_URL" in */*) :;; *) [ -n "${PANEL_BASE:-}" ] && [ "${PANEL_BASE:-}" != / ] && DEF_URL="$DEF_URL$PANEL_BASE";; esac
fi
if [ -z "$DEF_URL" ] && [ -n "$DOM_SAVED" ]; then DEF_URL="$DOM_SAVED"          # re-install: rebuild the saved host[:port][/subpath]
  { [ -n "$PORT_SAVED" ] && [ "$PORT_SAVED" != 443 ]; } && DEF_URL="$DEF_URL:$PORT_SAVED"
  [ -n "$BASE_SAVED" ] && DEF_URL="$DEF_URL$BASE_SAVED"
fi
[ -z "$DEF_URL" ] && { DEF_URL="$(detect_public_ip)"; [ -z "$DEF_URL" ] && DEF_URL=localhost; }
# a GIVEN domain (with its port/subpath, composed above) is the answer: said "(given — not asked)". It was asked
# anyway, and with no terminal read "(no terminal — default taken)" about a value that was given (1.8.8 qualification).
if [ -n "$_URL_GIVEN" ]; then PANEL_DOMAIN="$DEF_URL"; else PANEL_DOMAIN=""; fi
ask_valid "Enter panel URL (https://…)" "$DEF_URL" PANEL_DOMAIN v_url "enter a host or IP, optionally with a /subpath (e.g. vpn.example.com/swg)"
while :; do
  parse_panel_url "$PANEL_DOMAIN"
  # is the port the panel will use free on this host? (catches nginx/apache or a prior panel)
  _pp="${URL_PORT:-443}"
  if [ "${_forced:-}" != "$_pp" ] && [ "${SWG_DEFER_START:-}" != 1 ] && ! $DRYRUN && have ss && [ -n "$(ss -lntH "sport = :$_pp" 2>/dev/null)" ] && ! panel_owns_port "$_pp"; then
    _who="$(ss -lntpH "sport = :$_pp" 2>/dev/null | grep -oE '"[^"]+"' | sed -n 1p | tr -d '"' || true)"
    echo; warn "port $(col "$C_YEL" ":$_pp") is already in use${_who:+ (by $(col "$C_YEL" "$_who"))}"
    echo "    Running the panel $(b standalone)? Give it a free port, e.g. $(b "${PANEL_HOST_NOPORT}:8443")."
    echo "    Serving it $(b behind) that web server (the next step offers nginx/caddy)? Then $(bb force) is fine."
    printf '  Enter a different URL, or type %s to keep :%s anyway: ' "$(bb force)" "$_pp"
    read -r _url_ans 2>/dev/null <"${SWG_TTY:-/dev/tty}" || { _url_ans=force; echo "$(b force)  (no terminal — default taken)"; }   # said, not a blank line
    case "$(printf '%s' "$_url_ans" | tr -d '[:space:]')" in
      force|FORCE) _forced="$_pp";;
      "") :;;
      *) if _u="$(answer_to_url "$(printf '%s' "$_url_ans" | tr -d '[:space:]')")"; then PANEL_DOMAIN="$_u"
         else warn "‘$_url_ans’ is neither a port (1-65535) nor a host/URL — try again."; fi;;
    esac
    continue
  fi
  { [ -z "$URL_PORT" ] || v_cfport "$URL_PORT"; } && break   # no port or a Cloudflare-proxyable one → fine
  echo
  warn "Port $(col "$C_YEL" "$URL_PORT") is NOT a standard HTTPS port Cloudflare's proxy (orange cloud) forwards."
  echo "         Cloudflare proxies HTTPS only on: $(b '443, 2053, 2083, 2087, 2096, 8443')."
  echo "         Behind the orange cloud the panel on $URL_PORT is unreachable, so $(b cloudflare)/$(b cf15)"
  echo "         certificates won't work. ($(b letsencrypt)/$(b selfsigned) on a directly-reachable port is fine.)"
  echo
  printf '  To keep the port %s type %s, or enter a new URL to change: ' "$URL_PORT" "$(bb proceed)"
  read -r _url_ans 2>/dev/null <"${SWG_TTY:-/dev/tty}" || { _url_ans=proceed; echo "$(b proceed)  (no terminal — default taken)"; }   # said, not a blank line
  case "$(printf '%s' "$_url_ans" | tr -d '[:space:]')" in
    proceed|"") break;;                                           # keep the current port
    *) if _u="$(answer_to_url "$(printf '%s' "$_url_ans" | tr -d '[:space:]')")"; then PANEL_DOMAIN="$_u"   # adopt it; loop re-parses + re-checks
       else warn "‘$_url_ans’ is neither a port (1-65535) nor a host/URL — try again."; fi ;;
  esac
done
PANEL_DOMAIN="$PANEL_HOST_NOPORT"
[ -z "$PANEL_DOMAIN" ] && PANEL_DOMAIN=localhost
[ -n "$PANEL_BASE" ] && ok "panel will be served under subpath ${PANEL_BASE}/"

# TLS certificate
step "TLS certificate"
echo
_url_is_domain=no; case "$PANEL_DOMAIN" in *[a-zA-Z]*) case "$PANEL_DOMAIN" in *.*) _url_is_domain=yes;; esac;; esac
_ip_public=no; [ "$_url_is_domain" = yes ] || { ip_public "$PANEL_DOMAIN" && _ip_public=yes; }
# default = each branch's recommended primary (NOT the saved mode — a saved letsencrypt-ip is meaningless on a
# domain URL, etc.; 'reuse' below is the real "keep what you had" and wins as default when the cert still fits).
if   [ "$_url_is_domain" = yes ]; then _tls_opts="letsencrypt cloudflare cf15 selfsigned none l c cf 15 15years 15cf s self n skip sk"; _tls_def=l
elif [ "$_ip_public" = yes ];     then _tls_opts="letsencrypt-ip selfsigned none lip ip letsencrypt l s n skip sk"; _tls_def=letsencrypt-ip
else                                   _tls_opts="selfsigned none s n skip sk";                                    _tls_def=s; fi
_reuse_avail=no
if { [ "$EXISTING_HOST" = yes ] || [ -n "${SWG_CONVERT_DIR:-}" ]; } && [ -f "$PREFIX$TLS_DIR/fullchain.pem" ] && [ -f "$PREFIX$TLS_DIR/key.pem" ] \
   && cert_covers_host "$PREFIX$TLS_DIR/fullchain.pem" "$PANEL_DOMAIN"; then
  _reuse_avail=yes; _tls_opts="reuse $_tls_opts r"; _tls_def=r
fi
# exactly ONE "(default)" marker: reuse when offered, otherwise each branch's primary option carries it
if [ "$_reuse_avail" = yes ]; then _le_lbl="$(key l 'etsencrypt')";            _lip_lbl="$(key l 'etsencrypt-ip')";            _ss_lbl="$(key s 'elfsigned')"
else                               _le_lbl="$(keyd l 'etsencrypt (default)')"; _lip_lbl="$(keyd l 'etsencrypt-ip (default)')"; _ss_lbl="$(keyd s 'elfsigned (default)')"; fi
[ -z "$TLS_MODE" ] && [ -n "$CERT_FULLCHAIN" ] && [ -n "$CERT_KEY" ] && TLS_MODE=skip
case "$TLS_MODE" in manual|none) TLS_MODE=skip;; esac
# the loop re-asks (warn) instead of aborting if a cert is chosen that doesn't match the URL (e.g. env preset)
while :; do
  _tn=0
  [ "$_reuse_avail" = yes ] && { _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $(keyd r 'euse (default)')"       "Keep the existing $(b "${TLS_SAVED:-cert}") certificate — it already covers $(b "$PANEL_DOMAIN"), no re-issue (recommended for a re-install)"; }
  if [ "$_url_is_domain" = yes ]; then
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $_le_lbl"                           "Let's Encrypt cert via acme.sh HTTP-01 (needs port 80 reachable)"
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $(key c 'loudflare') + letsencrypt" "Let's Encrypt cert, validated via Cloudflare DNS-01 (no port 80) — needs a Zone:DNS:Edit+Read token + email"
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $(key 15 'years cloudflare')"       "Cloudflare Origin certificate, 15 years — ONLY valid behind Cloudflare's proxy (orange cloud); needs an API token (Zone → SSL and Certificates → Edit)"
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $(key s 'elfsigned')"               "OK for testing"
  elif [ "$_ip_public" = yes ]; then
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $_lip_lbl"                          "Trusted Let's Encrypt cert for this IP — short-lived (~6 days), auto-renews daily via acme.sh (needs :80 reachable + a direct/grey-cloud IP)"
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $(key s 'elfsigned')"               "Self-signed — the browser warns once (zero-maintenance, no port 80)"
  else
    _tn=$((_tn+1)); menu "$(col "$C_BLUE" "[$_tn]") $_ss_lbl"                           "Self-signed cert — the browser warns once (the realistic choice for an IP)"
  fi
  _tn=$((_tn+1)); menu "$(col "$C_GREY" "[$_tn]") $(keyg n 'one')"                     "No certificate issued — bring your own / terminate TLS elsewhere (plain HTTP otherwise)"
  [ "$_url_is_domain" = yes ] || [ "$_ip_public" = yes ] || sub "Let's Encrypt needs a public domain or public IP — hidden because $(b "$PANEL_DOMAIN") is private / not routable."
  ask_choice "Select TLS certificate (number, letter or name)" "$_tls_def" TLS_MODE "$_tls_opts"
  # map the choice to a canonical TLS_MODE. On an IP menu every 'letsencrypt' alias (l / ip / letsencrypt)
  # means the IP cert; 'none'/'n' is the display name for the no-cert mode (kept internally as 'skip').
  if [ "$_ip_public" = yes ]; then
    case "$TLS_MODE" in r) TLS_MODE=reuse;; l|ip|lip|letsencrypt|letsencrypt-ip) TLS_MODE=letsencrypt-ip;; s|selfsigned) TLS_MODE=selfsigned;; n|none|sk|skip) TLS_MODE=skip;; esac
  else
    case "$TLS_MODE" in r) TLS_MODE=reuse;; l) TLS_MODE=letsencrypt;; c|cf) TLS_MODE=cloudflare;; 15|15years|15cf) TLS_MODE=cf15;; s|self) TLS_MODE=selfsigned;; n|none|sk|skip) TLS_MODE=skip;; esac
  fi
  case "$TLS_MODE" in
    letsencrypt|cloudflare|cf15)   # domain-only — warn + re-ask if the URL isn't a domain
      if [ "$_url_is_domain" != yes ]; then
        echo; warn "$(b "$TLS_MODE") needs a domain (FQDN), but the panel URL ($(b "$PANEL_DOMAIN")) is an IP. Pick $([ "$_ip_public" = yes ] && printf 'letsencrypt-ip, ')selfsigned or none, or re-run with a domain URL."
        echo; TLS_MODE=""; continue; fi ;;
    letsencrypt-ip)                # public-IP-only — warn + re-ask otherwise
      if [ "$_ip_public" != yes ]; then
        echo; warn "$(b letsencrypt-ip) needs a public IP, but the panel URL is $(b "$PANEL_DOMAIN"). Pick $([ "$_url_is_domain" = yes ] && printf 'letsencrypt, ')selfsigned or none."
        echo; TLS_MODE=""; continue; fi ;;
  esac
  break
done
case "$TLS_MODE" in
  letsencrypt) ask_valid "ACME account email"                                     "${ACME_EMAIL:-$EMAIL_SAVED}" ACME_EMAIL v_email "enter a valid email, e.g. you@example.com";;
  letsencrypt-ip) warn "letsencrypt-ip issues a $(b 'short-lived (~6 day)') cert for $(b "$PANEL_DOMAIN") — acme.sh renews it daily; if renewal is down for ~6 days the cert expires."
               warn "Needs host port $(col "$C_YEL" ':80') reachable for HTTP-01 and the IP hit directly (grey-cloud / no proxy)."
               ask_valid "ACME account email"                                     "${ACME_EMAIL:-$EMAIL_SAVED}" ACME_EMAIL v_email "enter a valid email, e.g. you@example.com";;
  cloudflare)  ask_secret "Cloudflare API token (needs Zone:DNS:Edit + Zone:Read)" "${CF_TOKEN_SAVED:-}" CF_TOKEN  v_cftoken "paste a scoped API token (40 chars)"   # saved value is the DEFAULT — Enter keeps it, and it is re-validated
               ask_valid "ACME account email"                                     "${ACME_EMAIL:-$EMAIL_SAVED}" ACME_EMAIL v_email "enter a valid email, e.g. you@example.com";;
  cf15)        warn "cf15 issues a Cloudflare Origin cert — it is ONLY trusted behind Cloudflare's proxy."
               warn "$PANEL_DOMAIN must be on Cloudflare with the orange cloud ON; a direct hit to the origin shows an untrusted cert."
               if [ -n "$URL_PORT" ] && ! v_cfport "$URL_PORT"; then
                 warn "port $(col "$C_YEL" "$URL_PORT") is NOT one Cloudflare's proxy forwards (only 443, 2053, 2083, 2087, 2096, 8443) —"
                 warn "the panel would be unreachable through the orange cloud. Use one of those ports (or Cloudflare Spectrum), or grey-cloud the record and accept an untrusted direct cert."
               fi
               ask_secret "Cloudflare API token (Zone → SSL and Certificates → Edit)" "${CF_ORIGIN_TOKEN_SAVED:-}" CF_ORIGIN_TOKEN v_cforigin "paste a scoped API token — the legacy Origin CA Key is deprecated (sunset 2026-09-30)";;
esac
# reuse → keep the existing cert; carry the previous real mode forward (serve logic + install.conf) and flag
# REUSE_TLS so the cert step skips re-issue. (reuse matched no case above, so no FQDN check / cred prompt ran.)
REUSE_TLS=no
if [ "$TLS_MODE" = reuse ]; then REUSE_TLS=yes; TLS_MODE="${TLS_SAVED:-selfsigned}"; ok "reusing the existing certificate in $TLS_DIR — no re-issue (TLS mode: $(b "$TLS_MODE"))"; fi
if [ "$REUSE_TLS" = no ] && [ "$_reuse_avail" = yes ] && [ "$TLS_MODE" = selfsigned ] \
   && case "$_TLS_GIVEN" in s|self|selfsigned) true;; *) false;; esac \
   && cert_self_signed "$PREFIX$TLS_DIR/fullchain.pem"; then
  REUSE_TLS=yes
  ok "keeping the existing self-signed certificate — it already covers $(b "$PANEL_DOMAIN"), so the nodes pinned to it keep syncing (remove $TLS_DIR first to issue a new one)"
fi

# web server
step "Web server"
echo
# re-install → offer to KEEP the current web-server mode (default), same as the TLS step. Accept the first
# letter OR the full word (both are listed as options).
_srv_opts="internal nginx caddy skip i n c s"; _srv_def=i; _int_lbl="$(keyd i 'nternal (default)')"; _sn=0
if [ "$EXISTING_HOST" = yes ] && [ -n "$SERVE_SAVED" ]; then
  _sn=$((_sn+1)); menu "$(col "$C_BLUE" "[$_sn]") $(keyd r 'euse (default)')"  "Keep the current web-server mode from this install ($(b "$SERVE_SAVED")) — recommended for a re-install"
  _srv_opts="reuse $_srv_opts r"; _srv_def=r; _int_lbl="$(key i 'nternal')"
fi
_sn=$((_sn+1)); menu "$(col "$C_BLUE" "[$_sn]") $_int_lbl"        "Self-contained, no separate web-server is required"
_sn=$((_sn+1)); menu "$(col "$C_BLUE" "[$_sn]") $(key n 'ginx')"  "Web content will be served via an Nginx reverse proxy"
_sn=$((_sn+1)); menu "$(col "$C_BLUE" "[$_sn]") $(key c 'addy')"  "Web content will be served via a Caddy reverse proxy"
_sn=$((_sn+1)); menu "$(col "$C_BLUE" "[$_sn]") $(key s 'kip')"   "You'll run your own reverse proxy — prints ready nginx + Caddy configs for the panel + subscription page (installs nothing)"
case "$SERVE_MODE" in standalone) SERVE_MODE=internal;; esac
ask_choice "Select web server (number, letter or name)" "$_srv_def" SERVE_MODE "$_srv_opts"
case "$SERVE_MODE" in r) SERVE_MODE=reuse;; i) SERVE_MODE=internal;; n) SERVE_MODE=nginx;; c) SERVE_MODE=caddy;; s) SERVE_MODE=skip;; esac
[ "$SERVE_MODE" = reuse ] && SERVE_MODE="${SERVE_SAVED:-internal}"

# subscription-page hostname for the printed reverse-proxy config (manual mode only; blank = placeholder)
[ "$SERVE_MODE" = skip ] && ask "Subscription page hostname for the proxy config (blank to fill in later)" "" SUB_DOMAIN

# port: internal serves the public port itself; proxy/manual modes keep the panel on a loopback port
if [ "$SERVE_MODE" = internal ]; then
  [ -z "$PORT" ] && PORT="${URL_PORT:-${PORT_SAVED:-443}}"
  ask_valid "Public HTTPS port for the panel" "$PORT" PORT v_port "port must be 1–65535" derived   # the panel URL's own port — validated, not a question
else
  [ -z "$PORT" ] && PORT="${URL_PORT:-${PORT_SAVED:-8088}}"
fi

# dedicated stable loopback port for a co-located node: prefer the saved value (keep it stable across re-installs),
# recover from a pre-install.conf unit, then bump off any clash with PORT/SUB_PORT so all three can bind at once.
[ -n "$LOCAL_PORT_SAVED" ] && LOCAL_PORT="$LOCAL_PORT_SAVED"
[ -z "$LOCAL_PORT_SAVED" ] && [ -f "$_unit" ] && { _lp="$(sed -n 's/^Environment=SWG_PANEL_LOCAL_PORT=//p' "$_unit" | sed -n 1p)"; [ -n "$_lp" ] && LOCAL_PORT="$_lp"; }
while [ "$LOCAL_PORT" = "$PORT" ] || [ "$LOCAL_PORT" = "$SUB_PORT" ]; do LOCAL_PORT=$((LOCAL_PORT + 1)); done

_HAS_LOCAL_NODE=no; { [ "$HOST_HAS_WG" = yes ] || [ "${SWG_HAS_LOCAL_NODE:-}" = 1 ]; } && _HAS_LOCAL_NODE=yes
if [ -f /etc/swg-agent/config.json ]; then
  _au="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("url",""))' 2>/dev/null || true)"
  case "$_au" in *127.0.0.1*|*localhost*)
    _HAS_LOCAL_NODE=yes
    _ap="$(printf '%s' "$_au" | sed -nE 's#^https?://[^:/]+:([0-9]+).*#\1#p')"
    [ -n "$_ap" ] && LOCAL_PORT="$_ap" ;;   # bind exactly what the co-located node already dials
  esac
fi

[ "$KEEP_AUTH" != yes ] && [ -z "$BASIC_PASS" ] && BASIC_PASS="$(head -c12 /dev/urandom | base64 | tr -d '/+=' | cut -c1-16)"
if [ "$KEEP_AUTH" != yes ] && [ "${BASIC_USER}" = admin ]; then BASIC_USER="admin$(( RANDOM % 900 + 100 ))"; fi

# ═══════════════ II. NODE SETUP (master only) ═══════════════
declare -a SELECTED
if [ "$HOST_HAS_WG" = yes ]; then
  echo; info "BARE-METAL SWG NODE SETUP"
  step "Node name for THIS box"
  # default to the name the PANEL currently has for this box's local node (it may have been renamed in the
  # UI) — matched by verifying the agent token against each nodes.json token_hash; else saved name, else host.
  _pn="$(panel_node_name "$STATE_DIR/nodes.json" /etc/swg-agent/config.json)"
  _HOST_NAME_DEFAULT="${_pn:-${NODENAME_SAVED:-$(hostname -s 2>/dev/null || hostname)}}"   # what is offered — see the rename below
  ask_valid "Node name for THIS box" "$_HOST_NAME_DEFAULT" HOST_NODE_NAME v_name "1–40 chars: letters, digits, - or _"
  step "Datapath tooling"
  echo
  ensure_smart_tools || true                    # nftables (smart routing, every mode) + dnsmasq (Force-DNS host tier)
  ensure_wg_tools_once awg || true              # AmneziaWG tools + DKMS kernel module (the default interface type)
  ensure_wg_tools_once wg  || true              # plain WireGuard tools too — either type works when created later
  choose_ifaces                                 # non-interactive: detect + display + auto-adopt everything found
fi

echo; info "Plan: method=$METHOD role=$ROLE serve=$SERVE_MODE tls=$TLS_MODE base=${PANEL_BASE:-/} store_configs=$STORE_CONFIGS"

if [ "$EXISTING_HOST" = yes ] && ! $DRYRUN && [ "$HOST_HAS_WG" = yes ] && [ -n "${LC_URL:-}" ] && [ -n "${LC_TOKEN:-}" ]; then
  _cur="$(SWG_TOK="$LC_TOKEN" panel_req GET "${LC_URL%/}/api/node/whoami" "${LC_VERIFY:-no}" "${LC_FP:-}" 8 2>/dev/null | python3 -c 'import json,sys;print((json.load(sys.stdin).get("data") or {}).get("name") or "")' 2>/dev/null || true)"
  [ -n "$HOST_NODE_NAME" ] && [ "$HOST_NODE_NAME" != "${_cur:-${_HOST_NAME_DEFAULT:-}}" ] && { SWG_TOK="$LC_TOKEN" SWG_BODY="$(python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1]}))' "$HOST_NODE_NAME")" \
    panel_req POST "${LC_URL%/}/api/node/rename" "${LC_VERIFY:-no}" "${LC_FP:-}" 8 >/dev/null 2>&1 || true; }
fi

# ───────────────────────── users / dirs ─────────────────────────
info "Users, groups, directories"
run groupadd -f swg
id "$PANEL_USER" >/dev/null 2>&1 || run useradd -r -g swg -d "$STATE_DIR" -s /usr/sbin/nologin "$PANEL_USER"
# usermod only when it would CHANGE something: on an existing user it printed "usermod: no changes" on every re-install.
usermod_to(){ [ "$(getent passwd "$1" 2>/dev/null | cut -d: -f6)" = "$2" ] && [ "$(id -gn "$1" 2>/dev/null)" = "$3" ] && return 0
  run usermod -d "$2" -g "$3" "$1"; }
usermod_to "$PANEL_USER" "$STATE_DIR" swg
if [ -f "$SRC/swg-sub" ]; then
  id "$SUB_USER" >/dev/null 2>&1 || run useradd -r -g swg -d "$SUB_DIR" -s /usr/sbin/nologin "$SUB_USER"
  usermod_to "$SUB_USER" "$SUB_DIR" swg
fi
for d in "$PANEL_DIR" "$ETC_DIR" "$STATE_DIR" "$STATS_DIR"; do mkdir -p "$PREFIX$d"; done
run chown "$PANEL_USER:swg" "$STATE_DIR"; run chmod 750 "$STATE_DIR"   # group(swg) traverse → swg-sub can reach the files it may read
run chown -R "$PANEL_USER:swg" "$STATE_DIR"
$DRYRUN || netctl_dirs_heal "$STATE_DIR"
# subs/ (vault + token map + blobs + serve.json) — group-traversable so swg-sub reaches the token map,
# blobs, and serve.json; the vault inside stays 0600 (owner-only) so swg-sub still can't read it.
mkdir -p "$PREFIX$STATE_DIR/subs/blobs"; run chown -R "$PANEL_USER:swg" "$STATE_DIR/subs"; run chmod 750 "$STATE_DIR/subs" "$STATE_DIR/subs/blobs"
run chown "$PANEL_USER:swg" "$STATS_DIR"; run chmod 2775 "$STATS_DIR"   # panel writes node snapshots here for the dashboard
run chown -R "$PANEL_USER:swg" "$STATS_DIR"
# the panel user must rewrite the auth file (Account tab) — that's an atomic temp+rename in
# ETC_DIR, so the dir needs group(swg) write; setgid keeps new files in group swg.
run chown root:swg "$ETC_DIR"; run chmod 2775 "$ETC_DIR"
[ "$STORE_CONFIGS" = true ] && { mkdir -p "$PREFIX$STATE_DIR/configs"; run chown "$PANEL_USER:swg" "$STATE_DIR/configs"; run chmod 750 "$STATE_DIR/configs"; }

# ───────────────────────── panel files ─────────────────────────
info "Panel application"
for f in swg-panel-server index.html app.css app.js reconcile.js; do
  [ -f "$SRC/$f" ] || die "missing $f in $SRC"
done
[ -d "$SRC/js" ] || die "missing js/ in $SRC"   # the SPA's ES modules
[ -d "$SRC/m" ] || die "missing m/ in $SRC"     # the phone UI: m.css, the app manifest, icons
mkdir -p "$PREFIX$PANEL_DIR"; cp "$SRC/swg-panel-server" "$PREFIX$PANEL_DIR/"; chmod 755 "$PREFIX$PANEL_DIR/swg-panel-server"
for f in index.html app.css app.js reconcile.js turn-artifacts.js; do mkdir -p "$PREFIX$PANEL_DIR"; cp "$SRC/$f" "$PREFIX$PANEL_DIR/"; done
mkdir -p "$PREFIX$PANEL_DIR/vendor"; cp -a "$SRC/vendor/." "$PREFIX$PANEL_DIR/vendor/"   # qrcode + vendored Preact/htm ESM (buildless SPA)
mkdir -p "$PREFIX$PANEL_DIR/m"; cp -a "$SRC/m/." "$PREFIX$PANEL_DIR/m/"     # m/ = the phone UI (docs/MOBILE-PLAN.md), a DIRECTORY like js/
mkdir -p "$PREFIX$PANEL_DIR/js"; cp -a "$SRC/js/." "$PREFIX$PANEL_DIR/js/"   # js/ = the SPA's ES modules (docs/APP-JS-SPLIT-PLAN.md) — copied as a DIRECTORY, like vendor/, so adding a module never touches this loop
# A dropped or truncated module is a blank panel with no message (see verify_js_tree). Check the copy
# we just made, while the operator is here to see it.
if ! _jsbad="$(verify_js_tree "$SRC/js" "$PREFIX$PANEL_DIR/js")"; then
  warn "the SPA module tree is INCOMPLETE after copying — the panel will load blank:"
  printf '    %s\n' $_jsbad
  echo "    Re-run the installer from a complete source tree."
fi
[ -f "$REPO/VERSION" ] && cp "$REPO/VERSION" "$PREFIX$PANEL_DIR/" || true   # version stamp (update.sh reports it)
[ -f "$SRC/swg-passwd" ] && { mkdir -p "$PREFIX/usr/local/bin"; cp "$SRC/swg-passwd" "$PREFIX/usr/local/bin/swg-passwd"; chmod 755 "$PREFIX/usr/local/bin/swg-passwd"; }   # `sudo swg-passwd` — reset the panel login like the system passwd (mkdir so --dry-run's $PREFIX tree exists)
ok "installed panel + SPA to $PANEL_DIR"

# subscription surface (swg-sub)
if [ -f "$SRC/swg-sub" ]; then
  info "Subscription server (swg-sub)"
  mkdir -p "$PREFIX$SUB_DIR/vendor"
  cp "$SRC/swg-sub" "$PREFIX$SUB_DIR/"; chmod 755 "$PREFIX$SUB_DIR/swg-sub"
  for f in $SUB_WEB; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$PREFIX$SUB_DIR/"; done
  [ -f "$SRC/vendor/qrcode.js" ] && cp "$SRC/vendor/qrcode.js" "$PREFIX$SUB_DIR/vendor/"
  [ -f "$REPO/VERSION" ] && cp "$REPO/VERSION" "$PREFIX$SUB_DIR/" || true
  # swg-sub's OWN TLS dir — its cert lives here (never the panel's key). swg-netctl/acme write it as root;
  # group swg (swgsub) reads it. Separate from — and NOT the — masked panel tls dir.
  mkdir -p "$PREFIX/etc/swg-sub/tls"; run chown root:swg /etc/swg-sub/tls; run chmod 750 /etc/swg-sub/tls
  # …and a certificate KEPT in it by an uninstall comes back root:root — give it the group swg-sub reads with (netctl's modes)
  for _sf in /etc/swg-sub/tls/fullchain.pem /etc/swg-sub/tls/key.pem; do [ -f "$PREFIX$_sf" ] && run chown root:swg "$_sf"; done
  [ -f "$PREFIX/etc/swg-sub/tls/key.pem" ] && run chmod 640 /etc/swg-sub/tls/key.pem
  ok "installed swg-sub to $SUB_DIR (disabled until enabled in the panel)"
fi
mkdir -p "$PREFIX$STATE_DIR"; [ -f "$PREFIX$STATE_DIR/users.json" ] || { echo '{}' > "$PREFIX$STATE_DIR/users.json"; run chown "$PANEL_USER:swg" "$STATE_DIR/users.json"; run chmod 640 "$STATE_DIR/users.json"; ok "seeded empty users.json"; }

# ───────────────────────── host-as-node (this box is also an entry server) ─────────────────────────
LOCAL_TOKHASH=""
if [ "$HOST_HAS_WG" = yes ]; then
  info "This box as a node: agent + swg-noded (syncs to the local panel over HTTPS)"
  mkdir -p "$PREFIX$AGENT_DIR"; cp "$SRC/swg-agent" "$PREFIX$AGENT_DIR/"; chmod 755 "$PREFIX$AGENT_DIR/swg-agent"
  mkdir -p "$PREFIX$NODED_DIR"; cp "$SRC/swg-noded" "$PREFIX$NODED_DIR/"; chmod 755 "$PREFIX$NODED_DIR/swg-noded"
  [ -f "$SRC/swg-sni" ] && { cp "$SRC/swg-sni" "$PREFIX$NODED_DIR/"; chmod 755 "$PREFIX$NODED_DIR/swg-sni"; }   # SNI-router classifier (routing_mode=sni)
  [ -f "$SRC/swg-relay" ] && { cp "$SRC/swg-relay" "$PREFIX$NODED_DIR/"; chmod 755 "$PREFIX$NODED_DIR/swg-relay"; }   # TCP-terminating relay (accelerated mesh legs); inert until the panel asks for it
  [ -f "$REPO/VERSION" ] && cp "$REPO/VERSION" "$PREFIX$NODED_DIR/" || true
  mkdir -p "$PREFIX/var/lib/swg-noded" "$PREFIX/var/log/swg-agent"

  # the local node dials the panel's dedicated STABLE plain-HTTP loopback port, served at ROOT (no subpath).
  # A public address/port/path/cert flip never moves this port, so the co-located node never strands.
  LOCAL_PANEL_URL="http://127.0.0.1:${LOCAL_PORT}"

  _keep_agent=no; _agent_purl=""
  if [ -f "$PREFIX/etc/swg-agent/config.json" ]; then
    _agent_purl="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("url",""))' 2>/dev/null || true)"
    case "$_agent_purl" in *127.0.0.1*|*localhost*) _keep_agent=yes;; esac
  fi
  if [ "$_keep_agent" = yes ]; then
    _newifs=""; _sep=""
    for n in ${SELECTED[@]+"${SELECTED[@]}"}; do n="${n// /}"; [ -z "$n" ] && continue
      _onb=""; iface_onboarded "$n" && _onb=', "onboarded": true'
      _newifs+="$_sep\"$n\": {\"cmd\": [\"${IF_CMD[$n]}\"], \"conf\": \"${IF_CONF[$n]}\", \"endpoint_host\": \"${IF_ENDPOINT[$n]:-}\"${_onb}}"; _sep=","; done
    _merged=""
    if [ -n "$_newifs" ] && ! $DRYRUN; then
      _merged="$(python3 - "{$_newifs}" "$PREFIX/etc/swg-agent/config.json" <<'PY'
import json,sys
newifs=json.loads(sys.argv[1]); p=sys.argv[2]
d=json.load(open(p)); ifs=d.setdefault("interfaces",{})
added=[k for k in newifs if k not in ifs]     # only ADD new ones — never clobber an interface the panel/user already tuned
for k in added: ifs[k]=newifs[k]
if added: json.dump(d,open(p,"w"),indent=2)
print(",".join(added))
PY
)" || _merged=""
    fi
    # migrate the kept config to the dedicated stable loopback port (older masters dialled 127.0.0.1:<public-port><base>,
    # which strands on a public flip). Token stays put — only the URL moves to the flip-proof root port.
    if ! $DRYRUN; then python3 - "$PREFIX/etc/swg-agent/config.json" "$LOCAL_PANEL_URL" <<'PY' || true
import json,sys
p,url=sys.argv[1],sys.argv[2]
d=json.load(open(p)); pan=d.setdefault("panel",{})
if pan.get("url")!=url: pan["url"]=url; pan["verify"]=False; json.dump(d,open(p,"w"),indent=2)
PY
    fi
    _dns_set=""
    if [ -n "${DNS:-}" ] && ! $DRYRUN; then
      _dns_set="$(python3 - "$PREFIX/etc/swg-agent/config.json" "$DNS" <<'PY' 2>/dev/null || true
import json,sys
p,dns=sys.argv[1],sys.argv[2]
d=json.load(open(p))
if d.get("dns")!=[dns]:
    d["dns"]=[dns]; json.dump(d,open(p,"w"),indent=2); print(dns)
PY
)"
    fi
    ok "keeping existing /etc/swg-agent/config.json (local node already enrolled)${_merged:+ + added interface(s): $(col "$C_GREEN" "$_merged")}${_dns_set:+ — its client DNS set to $(b "$_dns_set") (DNS= given)}"
  else
    [ -f "$PREFIX/etc/swg-agent/config.json" ] && info "re-pointing the local node to this panel (was syncing to ${_agent_purl:-another panel})"
    # auto-enroll: mint a token for the local node; its hash goes into nodes.json below
    LOCAL_TOKEN="$(head -c18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')"
    LOCAL_TOKHASH="$(python3 -c 'import hashlib,os,base64,sys;t=sys.argv[1].encode();s=os.urandom(16);h=hashlib.pbkdf2_hmac("sha256",t,s,200000);print("pbkdf2_sha256$200000$"+base64.b64encode(s).decode()+"$"+base64.b64encode(h).decode())' "$LOCAL_TOKEN")"
    IFJSON=""; sep=""
    for n in "${SELECTED[@]}"; do n="${n// /}"; [ -z "$n" ] && continue
      _onb=""; iface_onboarded "$n" && _onb=', "onboarded": true'   # add-only (adopted interface — keep its peers)
      IFJSON+="$sep    \"$n\": { \"cmd\": [\"${IF_CMD[$n]}\"], \"conf\": \"${IF_CONF[$n]}\", \"endpoint_host\": \"${IF_ENDPOINT[$n]:-}\"${_onb} }"; sep=$',\n'; done
    # node-level endpoint_host is now a fallback (panel uses each interface's own); default it to the first interface's
    if [ -z "$HOST_ENDPOINT_IP" ]; then for n in "${SELECTED[@]}"; do [ -n "${IF_ENDPOINT[$n]:-}" ] && { HOST_ENDPOINT_IP="${IF_ENDPOINT[$n]}"; break; }; done; fi
    [ -z "$HOST_ENDPOINT_IP" ] && HOST_ENDPOINT_IP="$(detect_public_ip)"
    _swg_node_ref="${SWG_REF:-main}"
    _dns_json="$(python3 - "${DNS:-}" <<'PY' 2>/dev/null || echo '["1.1.1.1"]'
import json, sys
if sys.argv[1]:
    print(json.dumps([sys.argv[1]])); raise SystemExit
try:
    d = json.load(open("/etc/swg-agent/config.json")).get("dns")
except Exception:
    d = None
print(json.dumps(d if isinstance(d, list) and d and all(isinstance(x, str) and x.strip() for x in d) else ["1.1.1.1"]))
PY
)"
    writef /etc/swg-agent/config.json 640 <<EOF
{
  "interfaces": {
$IFJSON
  },
  "endpoint_host": "${HOST_ENDPOINT_IP}",
  "dns": ${_dns_json},
  "panel": {
    "url": "${LOCAL_PANEL_URL}",
    "token": "${LOCAL_TOKEN}",
    "verify": false
  },
  "node": {
    "interval": 5,
    "agent": "${AGENT_DIR}/swg-agent",
    "sudo": false,
    "update_ref": "${_swg_node_ref}"
  }
}
EOF
  fi
  # swg-noded runs as ROOT (samples kernel wg + runs the agent which writes /etc). ProtectSystem=true keeps /etc writable.
  writef /etc/systemd/system/swg-noded.service 644 <<EOF
[Unit]
Description=swg-noded (HTTPS sync to local panel) — ${HOST_NODE_NAME}
After=network-online.target swg-panel-server.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODED_DIR}/swg-noded
Environment=SWG_AGENT_CONFIG=/etc/swg-agent/config.json
Environment=SWG_NODED_STATE=/var/lib/swg-noded
Restart=on-failure
RestartSec=3
# ⚠️ NO NoNewPrivileges HERE — see install-node.sh's copy of this unit for why. It withheld no
# privilege this root daemon did not already hold, and it blocked the AppArmor profile transition that
# wg-quick needs to exec ip/wg at all.
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
  ensure_wg_apparmor
fi

# ───────────────────────── nodes.json + fleet.json ─────────────────────────
info "nodes.json + fleet.json"
if [ "$HOST_HAS_WG" = yes ] && [ -n "$LOCAL_TOKHASH" ]; then
  LOCAL_NODE_ID="$(python3 - "$PREFIX$STATE_DIR/nodes.json" "$HOST_NODE_NAME" 2>/dev/null <<'PYID'
import json, sys, hashlib
path, name = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path)); assert isinstance(d, dict)
except Exception:
    d = {}
nid = next((v.get("id") or k for k, v in d.items() if isinstance(v, dict) and v.get("name") == name), "")
if not nid:
    mid = ""
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            mid = open(p).read().strip()
        except Exception:
            mid = ""
        if mid:
            break
    if not mid:
        import socket; mid = socket.gethostname()
    nid = hashlib.sha256((mid + "|swg-local-node").encode()).hexdigest()[:12]
print(nid)
PYID
)"
  [ -n "$LOCAL_NODE_ID" ] || LOCAL_NODE_ID="$HOST_NODE_NAME"
  _EP_SEED=""
  if [ -n "$_EP_GIVEN" ]; then
    if host_is_local "$_EP_GIVEN"; then _EP_SEED="$_EP_GIVEN"
    else sub "HOST_ENDPOINT_IP=$_EP_GIVEN is not an address of this box (behind NAT?) — clients still dial it, but it is left out of the panel's node record (the listen address it pre-fills for turn-proxies)"; fi
  fi
  _NODES_MERGED="$(python3 - "$PREFIX$STATE_DIR/nodes.json" "$LOCAL_NODE_ID" "$HOST_NODE_NAME" "${PALETTE[0]}" "$LOCAL_TOKHASH" "$_EP_SEED" <<'PYNODES'
import json, sys, time
path, nid, name, color, tokhash, ep_given = sys.argv[1:7]
try:
    d = json.load(open(path))
    assert isinstance(d, dict)
except Exception:
    d = {}
# An older install may hold THIS box under a different key (a random id from before ids were made stable).
# Drop that twin, or the panel lists the same server twice and only one of them has the token we just minted.
for k in [k for k, v in list(d.items()) if isinstance(v, dict) and v.get("name") == name and k != nid]:
    d.pop(k, None)
cur = d.get(nid) if isinstance(d.get(nid), dict) else {}
cur.update({"id": nid, "name": name, "token_hash": tokhash, "stats_file": "stats-%s.json" % nid})
# token_sha is the fast-lookup index for the PREVIOUS token, and find_node_by_token skips the pbkdf2 fallback
# for any entry that has one — so keeping it beside a freshly minted token_hash locks the node out for good
# ("sync HTTP 401: invalid node token", for ever). Drop it; the panel re-indexes on the node's first sync.
cur.pop("token_sha", None)
cur.setdefault("color", color)
cur.setdefault("endpoint_host", "")
# ⚠️ THE ENDPOINT THE OPERATOR GAVE, into the record the PANEL reads. It went only into the agent config, so the panel's
# own node record stayed '' — the panel then fills it from the node's first PUBLIC address and a box with none (a LAN,
# a NAT'd lab) never got one: mesh peers had nothing to dial and a ghost interface's recreate fell back to the node's
# first IP (10.0.2.15 on the qualification guests, installed with HOST_ENDPOINT_IP=192.168.77.1). Only an explicit
# value, and only into an empty field: a detected default is exactly what the panel's own fill does better, and an
# endpoint already set — by the operator in the Nodes screen, or that fill — is theirs.
if ep_given.strip() and not (cur.get("endpoint_host") or "").strip():
    cur["endpoint_host"] = ep_given.strip()
cur.setdefault("created", int(time.time()))
d[nid] = cur
json.dump(d, sys.stdout, indent=1)
PYNODES
)"
  # A merge that produced nothing (unreadable python, OOM, …) must not become an empty node store: keep what is
  # already on disk and let the panel carry on, rather than silently unenrolling the fleet.
  if [ -n "$_NODES_MERGED" ]; then printf '%s\n' "$_NODES_MERGED" | writef "$STATE_DIR/nodes.json" 600
  else warn "  could not rebuild nodes.json — leaving the existing node store untouched"; fi
elif [ ! -f "$PREFIX$STATE_DIR/nodes.json" ]; then
  writef "$STATE_DIR/nodes.json" 600 <<EOF
{}
EOF
fi
run chown "$PANEL_USER:swg" "$STATE_DIR/nodes.json" 2>/dev/null || true
writef /etc/swg-panel/fleet.json 640 <<EOF
{
  "roster_path":   "${STATE_DIR}/users.json",
  "nodes_path":    "${STATE_DIR}/nodes.json",
  "stats_dir":     "${STATS_DIR}",
  "store_configs": ${STORE_CONFIGS},
  "config_dir":    "${STATE_DIR}/configs",
  "node_interval": 5
}
EOF
run chown "$PANEL_USER:swg" "$ETC_DIR/fleet.json" 2>/dev/null || true

# Install snapshot — the next run of this installer reads it back to default every prompt (root-only).
writef "$ETC_DIR/install.conf" 600 <<EOF
# swg-panel install settings — re-running the installer offers these as defaults. Safe to edit/delete.
ROLE_SEL=${ROLE_SEL}
PANEL_DOMAIN=${PANEL_DOMAIN}
PANEL_BASE=${PANEL_BASE}
PORT=${PORT}
LOCAL_PORT=${LOCAL_PORT}
SUB_PORT=${SUB_PORT}
SUB_BIND=${_SUB_BIND_GIVEN:-${SUB_BIND_SAVED:-}}
TLS_MODE=${TLS_MODE}
SERVE_MODE=${SERVE_MODE}
SUB_DOMAIN=${SUB_DOMAIN:-}
ACME_EMAIL=${ACME_EMAIL}
CF_TOKEN=${CF_TOKEN:-}
CF_ORIGIN_TOKEN=${CF_ORIGIN_TOKEN:-}
HOST_NODE_NAME=${HOST_NODE_NAME:-}
HOST_ENDPOINT_IP=${HOST_ENDPOINT_IP:-}
EOF
run chown root:swg "$ETC_DIR/install.conf" 2>/dev/null || true   # a KEPT one comes back root:root (uninstall) — the group a fresh one gets
# Seed the panel's OWN Access & TLS settings from the answers just given — see seed_access_settings, lib/common.sh.
if ! $DRYRUN && have python3; then
  # the panel serves its own certificate only in the internal serve mode, and there with "skip" only on a certificate
  # given to it — every other install is plain HTTP behind a proxy, whose TLS type is "" (N4)
  _seed_proxied=yes
  if [ "$SERVE_MODE" = internal ] && { [ "$TLS_MODE" != skip ] || { [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ]; }; }; then
    _seed_proxied=no; fi
  PANEL_DOMAIN="$PANEL_DOMAIN" PANEL_BASE="$PANEL_BASE" PORT="$PORT" TLS_MODE="$TLS_MODE" PROXIED="$_seed_proxied" \
  ACME_EMAIL="${ACME_EMAIL:-}" CF_TOKEN="${CF_TOKEN:-}" CF_ORIGIN_TOKEN="${CF_ORIGIN_TOKEN:-}" \
  seed_access_settings "$STATE_DIR/panel-settings.json"
  chown "$PANEL_USER:swg" "$STATE_DIR/panel-settings.json" 2>/dev/null || true
  chmod 600 "$STATE_DIR/panel-settings.json" 2>/dev/null || true
fi

# ───────────────────────── panel-server service ─────────────────────────
write_panel_unit(){   # bind/TLS/base depend on SERVE_MODE; called from the serve section
  local bind="127.0.0.1" extra=""
  extra="Environment=SWG_PANEL_AUTH=${ETC_DIR}/auth"            # panel does its own login in every serve mode
  [ -n "$PANEL_BASE" ] && extra="$extra
Environment=SWG_PANEL_BASE=${PANEL_BASE}"
  [ "$_HAS_LOCAL_NODE" = yes ] && extra="$extra
Environment=SWG_PANEL_LOCAL_PORT=${LOCAL_PORT}"          # co-located node present: dedicated stable plain-HTTP loopback it dials at ROOT (also the convert-master case where ROLE=host)
  if [ "$SERVE_MODE" = internal ]; then
    bind="0.0.0.0"                                              # internal mode faces the network directly
    [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ] && extra="$extra
Environment=SWG_PANEL_TLS_CERT=${CERT_FULLCHAIN}
Environment=SWG_PANEL_TLS_KEY=${CERT_KEY}"
    [ "${PORT}" -lt 1024 ] 2>/dev/null && extra="$extra
AmbientCapabilities=CAP_NET_BIND_SERVICE"
  fi
  writef /etc/systemd/system/swg-panel-server.service 644 <<EOF
[Unit]
Description=swg-panel broker
After=network.target

[Service]
Type=simple
User=${PANEL_USER}
ExecStart=${PANEL_DIR}/swg-panel-server
Environment=SWG_PANEL_FLEET=${ETC_DIR}/fleet.json
Environment=SWG_PANEL_WEB=${PANEL_DIR}
Environment=SWG_PANEL_HOST=${bind}
Environment=SWG_PANEL_PORT=${PORT}
Environment=SWG_UPDATE_TRIGGER=${STATE_DIR}/.update-request
${extra}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${ETC_DIR} ${STATE_DIR} ${STATS_DIR}
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  if swg_log_ns_ok; then swg_log_ns_text swg-panel | writef "/etc/systemd/system/swg-panel-server.service.d/$SWG_LOG_NS_DROPIN" 644; else swg_log_ns_clear; fi
  if getent group systemd-journal >/dev/null 2>&1; then   # the live log viewer reads the panel's own journal
    swg_journal_text | writef "/etc/systemd/system/swg-panel-server.service.d/$SWG_JOURNAL_DROPIN" 644; fi
  if [ -f "$SRC/swg-logs" ]; then writef /usr/local/bin/swg-logs 755 < "$SRC/swg-logs"; fi   # reads swg's journals (lib/common.sh)
  mk_update_unit                                   # wire one-click host self-update (root, own cgroup)
}

write_sub_unit(){   # swg-sub: the public subscription surface. Read-only; inert until enabled in the panel.
  [ -f "$PREFIX$SUB_DIR/swg-sub" ] || return 0      # only if the binary shipped in this bundle
  local subextra=""
  [ "${SUB_PORT}" -lt 1024 ] 2>/dev/null && subextra="AmbientCapabilities=CAP_NET_BIND_SERVICE
"
  writef /etc/systemd/system/swg-sub.service 644 <<EOF
[Unit]
Description=swg-sub subscription surface (public, read-only)
After=network.target

[Service]
Type=simple
User=${SUB_USER}
Group=swg
ExecStart=${SUB_DIR}/swg-sub
Environment=SWG_SUB_FLEET=${ETC_DIR}/fleet.json
Environment=SWG_SUB_WEB=${SUB_DIR}
Environment=SWG_SUB_HOST=${SUB_BIND}
Environment=SWG_SUB_PORT=${SUB_PORT}
Environment=SWG_SUB_TRUST_XFF=${SUB_TRUST_XFF:-0}
${subextra}Restart=on-failure
RestartSec=2
# hardening — read-only (no ReadWritePaths), and the secrets are masked at the kernel level so even a
# bug in this internet-facing process cannot open the login hash, the TLS key, the subscription-key
# vault, panel-settings (webhook secrets), or any stored configs, regardless of file permissions.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
RestrictNamespaces=true
RestrictSUIDSGID=true
LockPersonality=true
InaccessiblePaths=-${ETC_DIR}/auth -${TLS_DIR} -${STATE_DIR}/subs/vault.json -${STATE_DIR}/subs/escrow.json -${STATE_DIR}/panel-settings.json -${STATE_DIR}/configs

[Install]
WantedBy=multi-user.target
EOF
  if swg_log_ns_ok; then swg_log_ns_text swg-panel | writef "/etc/systemd/system/swg-sub.service.d/$SWG_LOG_NS_DROPIN" 644; else swg_log_ns_clear; fi
}

write_netctl(){
  [ -f "$SRC/swg-netctl" ] || return 0
  run mkdir -p "$PREFIX/usr/local/bin"; cp "$SRC/swg-netctl" "$PREFIX/usr/local/bin/swg-netctl"; chmod 755 "$PREFIX/usr/local/bin/swg-netctl"
  $DRYRUN || rm -f /run/swg-netctl.due   # the idle gate runs the new build on the next tick, its log work with it (as update.sh)
  # queue/ — panel-owned so ONLY the panel can enqueue (group swg can't write); status/ — root-written, group-readable by the panel.
  mkdir -p "$PREFIX$STATE_DIR/netctl/queue" "$PREFIX$STATE_DIR/netctl/status"
  run chown "$PANEL_USER:swg" "$STATE_DIR/netctl" "$STATE_DIR/netctl/queue"; run chmod 750 "$STATE_DIR/netctl" "$STATE_DIR/netctl/queue"
  run chown root:swg "$STATE_DIR/netctl/status"; run chmod 750 "$STATE_DIR/netctl/status"
  $DRYRUN || netctl_dirs_heal "$STATE_DIR"   # claims/ back to root (the chown -R above handed it to the panel) — F96
  writef /etc/systemd/system/swg-netctl.service 644 <<EOF
[Unit]
Description=swg-panel privileged network/TLS helper (drains the panel's request queue)
# The .path trigger starts this oneshot once per queued request; a single Access apply enqueues several
# (issue-cert, set-listen, restart) in a row, so the default 5-starts-per-10s limit trips easily and would
# fail the .path unit permanently (queue then drains only on the 10s timer → ~50s applies). This drainer is
# MEANT to start frequently, so disable the rate limit.
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/swg-netctl run
Environment=SWG_PANEL_USER=${PANEL_USER}
Environment=SWG_PANEL_GROUP=swg
Environment=SWG_STATE_DIR=${STATE_DIR}
Environment=SWG_ETC_DIR=${ETC_DIR}
# ⚠️ WITHOUT THIS the helper inherits no HOME from systemd and acme.sh falls back to "\$HOME/.acme.sh"
# = /.acme.sh — a SECOND store that acme's cron (--home ${ACME_HOME}) never renews, so every cert the
# panel issued at runtime expired silently at 90 days. Pin it; do not rely on HOME.
Environment=LE_WORKING_DIR=${ACME_HOME}
EOF
  if swg_log_ns_ok; then swg_log_ns_text swg-panel | writef "/etc/systemd/system/swg-netctl.service.d/$SWG_LOG_NS_DROPIN" 644; else swg_log_ns_clear; fi
  # The idle gate (lib/common.sh): the timer below still starts the unit every 10 s, but the helper runs only for a
  # request, a settings save or its own due time — an idle tick costs bash builtins, not a Python start.
  swg_netctl_due_text | writef_atomic /usr/local/bin/swg-netctl-due 755
  swg_netctl_due_dropin_text | writef "/etc/systemd/system/swg-netctl.service.d/$SWG_NETCTL_DUE_DROPIN" 644
  writef /etc/systemd/system/swg-netctl.path 644 <<EOF
[Unit]
Description=watch for swg-netctl requests from the panel

[Path]
DirectoryNotEmpty=${STATE_DIR}/netctl/queue
Unit=swg-netctl.service

[Install]
WantedBy=paths.target
EOF
  writef /etc/systemd/system/swg-netctl.timer 644 <<EOF
[Unit]
Description=poll for swg-netctl requests (fallback for the path watch)

[Timer]
OnActiveSec=10s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  run systemctl daemon-reload
  run systemctl enable --quiet --now swg-netctl.path 2>/dev/null || warn "couldn't enable swg-netctl.path"
  run systemctl enable --quiet --now swg-netctl.timer 2>/dev/null || warn "couldn't enable swg-netctl.timer"
}

mk_update_unit(){
  [ -n "${_UPDATE_UNIT_DONE:-}" ] && return 0; _UPDATE_UNIT_DONE=1   # write_panel_unit runs twice (placeholder→real cert); the TLS-independent self-update units only need writing once
  _swg_ref="${SWG_REF:-main}"
  swg_update_wrapper_text "$_swg_ref" | writef_atomic /usr/local/bin/swg-update 755   # the one text (lib/common.sh)
  swg_update_check_text | writef /usr/local/bin/swg-update-check 755   # the one text (lib/common.sh)
  writef /etc/systemd/system/swg-update.service 644 <<EOF
[Unit]
Description=swg-panel one-click self-update (swg programs only)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/swg-update-check
EOF
  if swg_log_ns_ok; then swg_log_ns_text swg-panel | writef "/etc/systemd/system/swg-update.service.d/$SWG_LOG_NS_DROPIN" 644; else swg_log_ns_clear; fi
  writef /etc/systemd/system/swg-update.timer 644 <<EOF
[Unit]
Description=poll for a swg one-click update request

[Timer]
OnActiveSec=30s
OnUnitActiveSec=30s

[Install]
WantedBy=timers.target
EOF
  run rm -f /etc/systemd/system/swg-update.path   # retire the old inotify watch (it never saw a docker container's write)
  if [ ! -e "$PREFIX$STATE_DIR/.update-request" ]; then printf '' | writef "$STATE_DIR/.update-request" 660; fi   # pre-create ONLY when missing
  run chown "$PANEL_USER:swg" "$STATE_DIR/.update-request" 2>/dev/null || true
  run chmod 660 "$STATE_DIR/.update-request" 2>/dev/null || true
  run touch /var/lib/swg-update.stamp   # stamp AFTER the trigger so the pre-created trigger doesn't fire a spurious first update
  run systemctl daemon-reload
  run systemctl disable --now swg-update.path >/dev/null 2>&1 || true
  run systemctl enable --quiet --now swg-update.timer || warn "couldn't enable swg-update.timer (one-click host update)"
}

# (no push receiver — nodes connect outbound over HTTPS; enroll them in the Nodes screen)

_sub_off=no; [ -e "$PREFIX/etc/systemd/system/swg-sub.service" ] && ! $DRYRUN && ! systemctl is-enabled --quiet swg-sub 2>/dev/null \
  && ! systemctl is-active --quiet swg-sub 2>/dev/null \
  && ! { [ -f "$PREFIX/etc/systemd/system/swg-panel-server.service" ] && bare_panel_parked; } && _sub_off=yes
if [ -f "$PREFIX$SUB_DIR/swg-sub" ] && [ ! -e "$PREFIX/etc/systemd/system/swg-sub.service" ]; then write_sub_unit; run systemctl daemon-reload; fi

# ───────────────────────── login + TLS + serve mode ─────────────────────────
mk_auth_file(){   # panel login file (pbkdf2) — used by every serve mode so the Account tab works
  mkdir -p "$PREFIX$ETC_DIR"
  if $DRYRUN; then echo "    [skip] write ${ETC_DIR}/auth (pbkdf2 login for $BASIC_USER)"
    printf '%s:pbkdf2_sha256$200000$DRYRUN$DRYRUN\n' "$BASIC_USER" > "$PREFIX$ETC_DIR/auth"
  else
    python3 - "$BASIC_USER" "$BASIC_PASS" > "$PREFIX$ETC_DIR/auth" <<'PYAUTH'
import sys, os, hashlib, base64
u, pw = sys.argv[1], sys.argv[2]
salt = os.urandom(16); it = 200000
h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, it)
print("%s:pbkdf2_sha256$%d$%s$%s" % (u, it, base64.b64encode(salt).decode(), base64.b64encode(h).decode()))
PYAUTH
  fi
  chmod 640 "$PREFIX$ETC_DIR/auth" 2>/dev/null || true; run chown root:swg "$ETC_DIR/auth"
  if [ -f "$PREFIX$STATE_DIR/subs/vault.json" ] && [ ! -f "$PREFIX$STATE_DIR/subs/vault.reset" ]; then
    if $DRYRUN; then echo "    [skip] drop ${STATE_DIR}/subs/vault.reset (an existing vault must be reconnected under the new login)"
    else
      printf 'reset\n' > "$PREFIX$STATE_DIR/subs/vault.reset" 2>/dev/null || true   # same one-word marker swg-passwd writes; only its existence is read
      chmod 640 "$PREFIX$STATE_DIR/subs/vault.reset" 2>/dev/null || true
      run chown root:swg "$STATE_DIR/subs/vault.reset" 2>/dev/null || true
      warn "an Encryption Vault from a previous install is still here, wrapped under the OLD panel password. Nothing was lost — at your next sign-in the panel will ask to reconnect it, with that old password or the encryption key you saved."
    fi
  fi
  ok "login: $BASIC_USER  (stored hashed in ${ETC_DIR}/auth)"
}
cert_perms(){ run chown root:swg "$TLS_DIR" "$TLS_DIR/fullchain.pem" "$TLS_DIR/key.pem" 2>/dev/null || true   # the dir too: a KEPT one comes back root:root (uninstall)
  chmod 644 "$PREFIX$TLS_DIR/fullchain.pem" 2>/dev/null || true; chmod 640 "$PREFIX$TLS_DIR/key.pem" 2>/dev/null || true; }
san_for(){ case "$1" in *[a-zA-Z]*) echo "DNS:$1";; *) echo "IP:$1";; esac; }
ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
find_acme(){ ACME=""; local a; for a in /root/.acme.sh/acme.sh "${HOME:-/root}/.acme.sh/acme.sh" "$(command -v acme.sh 2>/dev/null || true)"; do [ -n "$a" ] && [ -x "$a" ] && { ACME="$a"; return 0; }; done; return 1; }
# every acme.sh invocation goes through this, so none of them can pick up an ambient store
acme(){ run "$ACME" --home "$ACME_HOME" "$@"; }
acme_has_cert(){
  local h d; h="$ACME_HOME"
  for d in "$h/${1}_ecc" "$h/${1}"; do
    [ -s "$d/fullchain.cer" ] || continue
    head -1 "$d/${1}.cer" 2>/dev/null | grep -c 'BEGIN CERTIFICATE' >/dev/null && return 0
  done
  return 1; }
acme_clear_unusable(){
  $DRYRUN && return 0
  local d="$ACME_HOME/${1}_ecc"
  [ -d "$d" ] || return 0
  # usable = the file --install-cert READS, plus a leaf that really is a PEM (≤3.1.3 caches a CA 404 as the cert)
  if [ -s "$d/fullchain.cer" ] && head -1 "$d/${1}.cer" 2>/dev/null | grep -c 'BEGIN CERTIFICATE' >/dev/null; then return 0; fi
  warn "clearing a failed acme entry for $(b "$1") — a domain key with no certificate, which would make every re-issue fail with \"Domain key exists\""
  rm -rf "$d"; }
ACME_MIN=3.1.4
acme_version(){ "$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sed -n 1p; }
ensure_acme(){
  if find_acme; then
    ensure_acme_cron "$ACME" "$ACME_HOME"   # cron + acme.sh's renewal entry: the ONLY renewer, never there on a box installed without cron (lib/common.sh)
    local v; v="$(acme_version "$ACME")"
    if [ -n "$v" ] && [ "$v" != "$ACME_MIN" ] \
       && [ "$(printf '%s\n%s\n' "$v" "$ACME_MIN" | sort -V | sed -n 1p)" = "$v" ]; then
      info "acme.sh $v is older than $ACME_MIN — upgrading (older builds record a failed issuance as a cert)"
      acme --upgrade || warn "acme.sh upgrade failed — continuing on $v"
    fi
    return 0
  fi
  ensure_acme_cron   # cron FIRST: acme.sh's installer refuses to install without crontab, and registers its renewal only where it is
  info "Installing acme.sh"; run sh -c "curl -fsSL https://get.acme.sh | sh -s email=${ACME_EMAIL:-admin@$PANEL_DOMAIN}"
  find_acme && { ensure_acme_cron "$ACME" "$ACME_HOME"; return 0; }; $DRYRUN && { ACME=/root/.acme.sh/acme.sh; return 0; }
  die "acme.sh not found after install — install it manually or use TLS=selfsigned/skip"; }
ensure_renewer_for_reuse(){
  case "${TLS_MODE:-}" in
    letsencrypt|letsencrypt-ip|cloudflare)
      find_acme && { ensure_acme_cron "$ACME" "$ACME_HOME"; return 0; }
      ( ensure_acme ) || warn "acme.sh isn't installed — renewals and address changes will fail until it is";;
  esac; return 0; }

prune_stale_acme_installs(){
  $DRYRUN && return 0
  local h conf d rp ecc; h="$ACME_HOME"   # same store as acme_has_cert — see the note there
  for conf in "$h"/*/*.conf; do
    [ -f "$conf" ] || continue
    d="$(sed -n "s/^Le_Domain='\{0,1\}\([^']*\).*/\1/p" "$conf" | sed -n 1p)"
    [ -n "$d" ] && [ "$d" != "$PANEL_DOMAIN" ] || continue
    rp="$(sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$conf" | sed -n 1p)"
    case "$rp" in "$TLS_DIR"/*)
      ecc=""; case "$(dirname "$conf")" in *_ecc) ecc="--ecc";; esac
      warn "removing stale acme entry $(b "$d") — it also installs into $TLS_DIR and would clobber $(b "$PANEL_DOMAIN")'s cert"
      acme --remove -d "$d" $ecc || true
      rm -rf "$(dirname "$conf")" ;;
    esac
  done
}
_acme_rp(){ realpath -m -- "$1" 2>/dev/null || printf '%s' "$1"; }   # the SAME resolution on both sides of the compare
acme_foreign_target(){
  $DRYRUN && return 0
  local conf="$ACME_HOME/${1}_ecc/${1}.conf" k t r
  [ -f "$conf" ] || return 0
  for k in Le_RealFullChainPath Le_RealCertPath Le_RealKeyPath; do
    t="$(sed -n "s/^$k='\{0,1\}\([^']*\).*/\1/p" "$conf" | sed -n 1p)"
    [ -n "$t" ] || continue
    r="$(_acme_rp "$t")"
    case "$r" in "$(_acme_rp "$TLS_DIR/fullchain.pem")"|"$(_acme_rp "$TLS_DIR/key.pem")"|\
                 "$(_acme_rp /etc/swg-sub/tls/fullchain.pem)"|"$(_acme_rp /etc/swg-sub/tls/key.pem)") continue;; esac
    printf '%s' "$t"; return 0
  done; }
# Copy acme.sh's current certificate for $1 into $TLS_DIR without touching the entry. 0 on success.
acme_copy_foreign(){
  local d="$ACME_HOME/${1}_ecc"
  cp "$d/fullchain.cer" "$CERT_FULLCHAIN.adopting" && cp "$d/${1}.key" "$CERT_KEY.adopting" \
    && mv -f "$CERT_FULLCHAIN.adopting" "$CERT_FULLCHAIN" && mv -f "$CERT_KEY.adopting" "$CERT_KEY"; }
mk_selfsigned(){ CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"; mkdir -p "$PREFIX$TLS_DIR"
  if $DRYRUN; then echo "    [skip] openssl self-signed -> $TLS_DIR (CN=$PANEL_DOMAIN)"; : > "$PREFIX$CERT_FULLCHAIN"; : > "$PREFIX$CERT_KEY"
  else run openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$CERT_KEY" -out "$CERT_FULLCHAIN" -subj "/CN=${PANEL_DOMAIN}" -addext "subjectAltName=$(san_for "$PANEL_DOMAIN")"; fi
  cert_perms; if $DRYRUN; then ok "dry run — would create a self-signed certificate for ${PANEL_DOMAIN} (10y)"; else ok "self-signed certificate for ${PANEL_DOMAIN} (10y)"; fi; }
tls_fallback_selfsigned(){
  local asked="$TLS_MODE"; mk_selfsigned; TLS_MODE=selfsigned; $DRYRUN && return 0
  sed -i 's/^TLS_MODE=.*/TLS_MODE=selfsigned/' "$ETC_DIR/install.conf" 2>/dev/null || true
  if have python3; then PANEL_DOMAIN="$PANEL_DOMAIN" PANEL_BASE="$PANEL_BASE" PORT="$PORT" TLS_MODE=selfsigned PROXIED=no \
    seed_access_settings "$STATE_DIR/panel-settings.json" || true
    chown "$PANEL_USER:swg" "$STATE_DIR/panel-settings.json" 2>/dev/null || true; chmod 600 "$STATE_DIR/panel-settings.json" 2>/dev/null || true; fi
  warn "recorded as self-signed — to try $asked again once the cause above is fixed: Settings → Access & TLS, or re-run the installer"; }
reuse_cert(){   # re-install with REUSE_TLS=yes: keep the cert already in $TLS_DIR, no re-issue
  if [ -f "$PREFIX$TLS_DIR/fullchain.pem" ] && [ -f "$PREFIX$TLS_DIR/key.pem" ]; then
    CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"; cert_perms; ok "keeping the existing certificate in $TLS_DIR"
  else warn "no existing certificate in $TLS_DIR — generating a self-signed one"; mk_selfsigned; fi; }
use_provided_certs(){   # skip-with-own-cert: copy caller-supplied cert into $TLS_DIR; 0 if used, 1 if none
  [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ] || return 1
  mkdir -p "$PREFIX$TLS_DIR"
  $DRYRUN || { cp "$CERT_FULLCHAIN" "$PREFIX$TLS_DIR/fullchain.pem"; cp "$CERT_KEY" "$PREFIX$TLS_DIR/key.pem"; }
  CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"; cert_perms
  ok "using provided certificate (copied into $TLS_DIR)"; return 0; }
mk_cf_origin(){   # cf15: request a 15-year Cloudflare Origin certificate via the CF API
  # Auth is a Bearer API token (Zone:SSL and Certificates:Edit). The old Origin CA Key /
  # X-Auth-User-Service-Key header is deprecated by Cloudflare (sunset 2026-09-30).
  CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"; mkdir -p "$PREFIX$TLS_DIR"
  [ -n "${CF_ORIGIN_TOKEN:-}" ] || die "cf15 needs CF_ORIGIN_TOKEN (API token with Zone:SSL and Certificates:Edit)"
  if $DRYRUN; then echo "    [skip] request Cloudflare Origin certificate (15y, origin-ecc) for $PANEL_DOMAIN"
    : > "$PREFIX$CERT_FULLCHAIN"; : > "$PREFIX$CERT_KEY"; cert_perms; ok "cf15 origin certificate (dry-run placeholder)"; return 0; fi
  local key csr cert
  key="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)" || die "openssl: EC key generation failed"
  csr="$(printf '%s\n' "$key" | openssl req -new -key /dev/stdin -subj "/CN=${PANEL_DOMAIN}" 2>/dev/null)" || die "openssl: CSR generation failed"
  info "Requesting a 15-year Cloudflare Origin certificate for $PANEL_DOMAIN…"
  cert="$(CF_ORIGIN_TOKEN="$CF_ORIGIN_TOKEN" python3 - "$PANEL_DOMAIN" "$csr" <<'PY'
import sys, os, json, urllib.request, urllib.error
domain, csr = sys.argv[1], sys.argv[2]
body = json.dumps({"hostnames": [domain], "requested_validity": 5475,
                   "request_type": "origin-ecc", "csr": csr}).encode()
req = urllib.request.Request("https://api.cloudflare.com/client/v4/certificates", data=body, method="POST",
      headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["CF_ORIGIN_TOKEN"]})
try:
    with urllib.request.urlopen(req, timeout=30) as r: d = json.load(r)
except urllib.error.HTTPError as e:
    d = json.load(e)
except Exception as e:
    sys.stderr.write(str(e)); sys.exit(1)
if d.get("success"): sys.stdout.write(d["result"]["certificate"])
else: sys.stderr.write(json.dumps(d.get("errors", d))[:300]); sys.exit(1)
PY
)" || die "Cloudflare Origin CA request failed — check the API token (Zone:SSL and Certificates:Edit) and that $PANEL_DOMAIN is on this Cloudflare account"
  printf '%s\n' "$cert" > "$PREFIX$CERT_FULLCHAIN"
  printf '%s\n' "$key"  > "$PREFIX$CERT_KEY"
  cert_perms; ok "issued Cloudflare Origin certificate (15y) for ${PANEL_DOMAIN} — valid only behind Cloudflare's proxy"; }   # (a dry run returned above)

# ---- internal: the panel serves its own TLS; cert lands in $TLS_DIR ----
obtain_cert_internal(){
  mkdir -p "$PREFIX$TLS_DIR"
  [ "${REUSE_TLS:-no}" = yes ] && { reuse_cert; ensure_renewer_for_reuse; return 0; }
  case "$TLS_MODE" in
    skip) use_provided_certs || { CERT_FULLCHAIN=""; CERT_KEY=""; ok "TLS skipped — panel will serve plain HTTP"; }; return 0;;
    selfsigned) mk_selfsigned;;
    cf15) mk_cf_origin;;
    letsencrypt|letsencrypt-ip|cloudflare)
      ensure_acme
      local args=(--issue -d "$PANEL_DOMAIN" --server letsencrypt --keylength ec-256)
      # IP certs MUST be short-lived (~6 days); --days 3 makes acme.sh's daily cron renew ~2 days in (≈4-day buffer)
      [ "$TLS_MODE" = letsencrypt-ip ] && args+=(--certificate-profile shortlived --days 3)
      if [ "$TLS_MODE" = cloudflare ]; then [ -n "$CF_TOKEN" ] || die "cloudflare needs a CF token (re-run Step 3, or set CF_TOKEN)"
        export CF_Token="$CF_TOKEN"; [ -n "$CF_ACCOUNT_ID" ] && export CF_Account_ID="$CF_ACCOUNT_ID"; args+=(--dns dns_cf)
        info "Issuing $PANEL_DOMAIN via Let's Encrypt — DNS-01 challenge through Cloudflare (can take ~30–60s while DNS propagates)…"
      else args+=(--standalone)
        if ! $DRYRUN && have ss && [ -n "$(ss -lntH "sport = :80" 2>/dev/null)" ]; then
          local _w80 _g80=""; _w80="$(ss -lntpH "sport = :80" 2>/dev/null | grep -oE '"[^"]+"' | sed -n 1p | tr -d '"' || true)"
          echo; warn "letsencrypt HTTP-01 needs host port $(col "$C_YEL" ":80"), but it's in use${_w80:+ (by $(col "$C_YEL" "$_w80"))} — issuance will fail"
          echo "    :80 is fixed by ACME (independent of the panel's port). Free it, or re-run and pick $(b cloudflare) (DNS-01), $(b cf15), or $(b selfsigned)."
          [ "${SWG_CONVERT_DIR:-}" = convert-bare ] && echo "    During this convert :80 is held by the $(b 'docker panel still serving') until the switch — pick $(b reuse) to keep the certificate you already have (no re-issue, no :80)."
          ask_yn "Try acme standalone on :80 anyway?" n _g80
          [ "$_g80" = yes ] || die "aborted — free :80 or pick a TLS method that doesn't need it, then re-run"
        fi
        info "Issuing $PANEL_DOMAIN via Let's Encrypt — HTTP-01 (acme standalone needs :80 free)…"
      fi
      [ -n "$ACME_EMAIL" ] && { acme --register-account -m "$ACME_EMAIL" --server letsencrypt || true; }
      # Re-run? acme.sh already holds a cert for this domain → install it instead of re-issuing.
      # Renewals run from acme's cron. (First install on a clean box has no cert → issue below.)
      if ! $DRYRUN && acme_has_cert "$PANEL_DOMAIN"; then
        ok "acme.sh already has a cert for $PANEL_DOMAIN — installing it (auto-renews via acme's cron)"
      else
        acme_clear_unusable "$PANEL_DOMAIN"       # a previous failure's leftover would refuse this order too
        local rc=0; acme "${args[@]}" || rc=$?
        # acme.sh exit 2 = RENEW_SKIP (a valid cert already exists, not due for renewal) — that's fine.
        if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
          if $DRYRUN || acme_has_cert "$PANEL_DOMAIN"; then
            warn "acme.sh exit $rc, but a cert for $PANEL_DOMAIN already exists — installing it."
          else
            acme_clear_unusable "$PANEL_DOMAIN"   # leave nothing that would mask this error next time
            warn "issuance failed (acme.sh exit $rc) — falling back to a self-signed cert."; tls_fallback_selfsigned; return
          fi
        fi
      fi
      CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"
      prune_stale_acme_installs
      local _foreign; _foreign="$(acme_foreign_target "$PANEL_DOMAIN")"
      if [ -n "$_foreign" ]; then
        # the panel serves this TLS itself, so its sync-acme keeps the copy current — leave the target alone
        warn "acme.sh installs $(b "$PANEL_DOMAIN")'s certificate for another program ($(b "$_foreign")) — leaving that as it is; the panel takes each renewal from acme.sh itself"
        if ! acme_copy_foreign "$PANEL_DOMAIN"; then
          warn "could not copy acme.sh's certificate for $PANEL_DOMAIN — falling back to a self-signed cert."
          tls_fallback_selfsigned; return
        fi
      elif ! acme --install-cert -d "$PANEL_DOMAIN" --ecc --key-file "$CERT_KEY" --fullchain-file "$CERT_FULLCHAIN" \
          --reloadcmd "chown root:swg $TLS_DIR/fullchain.pem $TLS_DIR/key.pem; chmod 640 $TLS_DIR/key.pem; systemctl kill -s HUP swg-panel-server.service 2>/dev/null || true"; then
        warn "acme.sh could not install the certificate for $PANEL_DOMAIN — falling back to a self-signed cert."
        tls_fallback_selfsigned; return
      fi
      cert_perms; if $DRYRUN; then ok "dry run — would issue + install a certificate via $TLS_MODE (auto-renews)"; else ok "issued + installed certificate via $TLS_MODE (auto-renews)"; fi;;
    *) die "TLS must be cloudflare|letsencrypt|letsencrypt-ip|selfsigned|skip";;
  esac
}
serve_internal(){
  write_panel_unit
  run systemctl daemon-reload
  run systemctl enable --quiet $_NOW swg-panel-server
  obtain_cert_internal
  write_panel_unit
  run systemctl daemon-reload
  if [ "${SWG_DEFER_START:-}" != 1 ] && [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ]; then run systemctl restart swg-panel-server; fi
  # …and RECORD a rule we actually opened, so uninstall.sh can take back exactly that one (it outlived every
  # uninstall). ufw says "Skipping adding existing rule" for one it already had — somebody else's, never recorded.
  if command -v ufw >/dev/null 2>&1; then
    _ufw_out="$(run ufw allow "${PORT}/tcp" 2>/dev/null || true)"
    if ! $DRYRUN && [ -n "$_ufw_out" ] && ! printf '%s' "$_ufw_out" | grep -c 'Skipping' >/dev/null; then
      grep -qsx "${PORT}/tcp" "$ETC_DIR/ufw-added" || echo "${PORT}/tcp" >> "$ETC_DIR/ufw-added"
      chmod 600 "$ETC_DIR/ufw-added" 2>/dev/null || true
    fi
  fi
  local sch="https"; [ -n "${CERT_FULLCHAIN:-}" ] || sch="http"
  [ "$sch" = http ] && warn "TLS skipped — login travels in the clear. Use selfsigned/letsencrypt/cloudflare for real use."
  ok "Internal: panel serves ${sch}://${PANEL_DOMAIN}:${PORT}${PANEL_BASE}/ directly (no extra web server)"
}

# ---- reverse-proxy (nginx / caddy): panel on loopback, proxy terminates TLS ----
setup_tls_proxy(){   # issue/locate a cert into $TLS_DIR for a reverse proxy to use
  [ "${REUSE_TLS:-no}" = yes ] && { reuse_cert; ensure_renewer_for_reuse; return 0; }
  case "$TLS_MODE" in
    selfsigned) mk_selfsigned;;
    cf15) mk_cf_origin;;
    skip) use_provided_certs || { CERT_FULLCHAIN=""; CERT_KEY=""; ok "TLS skipped — proxy will serve plain HTTP (or add your own cert)"; }; return 0;;
    letsencrypt|letsencrypt-ip|cloudflare)
      mkdir -p "$PREFIX$TLS_DIR"; ensure_acme
      local args=(--issue -d "$PANEL_DOMAIN" --server letsencrypt --keylength ec-256)
      [ "$TLS_MODE" = letsencrypt-ip ] && args+=(--certificate-profile shortlived --days 3)   # short-lived IP cert
      if [ "$TLS_MODE" = cloudflare ]; then [ -n "$CF_TOKEN" ] || die "cloudflare needs a CF token (re-run Step 3, or set CF_TOKEN)"
        export CF_Token="$CF_TOKEN"; [ -n "$CF_ACCOUNT_ID" ] && export CF_Account_ID="$CF_ACCOUNT_ID"; args+=(--dns dns_cf)
        info "Issuing $PANEL_DOMAIN via Let's Encrypt — DNS-01 challenge through Cloudflare (can take ~30–60s while DNS propagates)…"
      elif [ "$SERVE_MODE" = nginx ]; then args+=(--webroot "$ACME_WEBROOT")    # nginx already serves :80 for the challenge
      else args+=(--standalone); fi                                            # caddy not up yet → acme can hold :80
      [ -n "$ACME_EMAIL" ] && { acme --register-account -m "$ACME_EMAIL" --server letsencrypt || true; }
      local reload="systemctl reload nginx"; [ "$SERVE_MODE" = caddy ] && reload="systemctl reload caddy"
      # Re-run? install the existing cert instead of re-issuing. First install → no cert → issue.
      if ! $DRYRUN && acme_has_cert "$PANEL_DOMAIN"; then
        ok "acme.sh already has a cert for $PANEL_DOMAIN — installing it (auto-renews via acme's cron)"
      else
        acme_clear_unusable "$PANEL_DOMAIN"       # a previous failure's leftover would refuse this order too
        local rc=0; acme "${args[@]}" || rc=$?
        if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ] && ! { $DRYRUN || acme_has_cert "$PANEL_DOMAIN"; }; then
          acme_clear_unusable "$PANEL_DOMAIN"     # leave nothing that would mask this error next time
          warn "issuance failed (acme.sh exit $rc) — proxy will serve plain HTTP."; CERT_FULLCHAIN=""; CERT_KEY=""; return 0
        fi
      fi
      CERT_FULLCHAIN="$TLS_DIR/fullchain.pem"; CERT_KEY="$TLS_DIR/key.pem"
      prune_stale_acme_installs
      # Another program's entry: copy, never take its install target — the same rule as the internal-serve block.
      # The panel's 6-hourly sync-acme runs behind a proxy too, and reloads nginx/caddy when it brings a renewal across.
      local _foreign; _foreign="$(acme_foreign_target "$PANEL_DOMAIN")"
      if [ -n "$_foreign" ]; then
        warn "acme.sh installs $(b "$PANEL_DOMAIN")'s certificate for another program ($(b "$_foreign")) — leaving that as it is; the panel takes each renewal from acme.sh itself"
        if ! acme_copy_foreign "$PANEL_DOMAIN"; then
          warn "could not copy acme.sh's certificate for $PANEL_DOMAIN — proxy will serve plain HTTP."
          CERT_FULLCHAIN=""; CERT_KEY=""; return 0
        fi
      # same rule as the internal-serve block above: a failed install must not abort the installer.
      # Here the proxy is the TLS terminator, so degrade exactly as issuance failure does — plain HTTP.
      elif ! acme --install-cert -d "$PANEL_DOMAIN" --ecc --key-file "$CERT_KEY" --fullchain-file "$CERT_FULLCHAIN" --reloadcmd "$reload"; then
        warn "acme.sh could not install the certificate for $PANEL_DOMAIN — proxy will serve plain HTTP."
        CERT_FULLCHAIN=""; CERT_KEY=""; return 0
      fi
      cert_perms; if $DRYRUN; then ok "dry run — would issue + install a certificate via $TLS_MODE"; else ok "issued + installed certificate via $TLS_MODE"; fi;;
    *) die "TLS must be cloudflare|letsencrypt|letsencrypt-ip|selfsigned|skip";;
  esac
}
proxy_loc(){ [ -n "$PANEL_BASE" ] && printf '%s/' "$PANEL_BASE" || printf '/'; }   # nginx location path

write_vhost(){   # write_vhost bootstrap|tls    (nginx)
  local loc; loc="$(proxy_loc)"
  if [ "$1" = tls ]; then
    writef /etc/nginx/sites-available/swg-panel.conf 644 <<EOF
server {
    listen 80;
    server_name ${PANEL_DOMAIN};
    location ^~ /.well-known/acme-challenge/ { root ${ACME_WEBROOT}; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name ${PANEL_DOMAIN};
    ssl_certificate ${CERT_FULLCHAIN};
    ssl_certificate_key ${CERT_KEY};

    location ${loc} {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$http_host;   # \$http_host keeps the PORT; \$host strips it, and the address-change confirm compares Host against host:port
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  else
    writef /etc/nginx/sites-available/swg-panel.conf 644 <<EOF
server {
    listen 80;
    server_name ${PANEL_DOMAIN};
    location ^~ /.well-known/acme-challenge/ { root ${ACME_WEBROOT}; }
    location ${loc} {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$http_host;   # \$http_host keeps the PORT; \$host strips it, and the address-change confirm compares Host against host:port
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi
  if [ -d /etc/nginx/sites-enabled ]; then run ln -sf /etc/nginx/sites-available/swg-panel.conf /etc/nginx/sites-enabled/swg-panel.conf
  elif [ -d /etc/nginx/conf.d ]; then cp "$PREFIX/etc/nginx/sites-available/swg-panel.conf" "$PREFIX/etc/nginx/conf.d/swg-panel.conf"; fi
}
serve_nginx(){
  SUB_BIND=127.0.0.1; SUB_TRUST_XFF=1        # the panel vhost is auto-managed; swg-sub stays on loopback until you proxy it too
  mkdir -p "$PREFIX$ACME_WEBROOT"
  write_panel_unit
  run systemctl daemon-reload; run systemctl enable --quiet $_NOW swg-panel-server
  write_vhost bootstrap
  run nginx -t && run systemctl reload nginx || warn "nginx -t failed (is nginx installed?) — fix, then: systemctl reload nginx"
  setup_tls_proxy
  if [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ]; then
    write_vhost tls
    run nginx -t && run systemctl reload nginx || warn "nginx -t failed after enabling TLS — check $CERT_FULLCHAIN"
    ok "nginx: TLS enabled for https://${PANEL_DOMAIN}${PANEL_BASE}/"
  else warn "nginx: serving on :80 without TLS — front with TLS before exposing."; fi
  note_sub_proxy
}

ensure_caddy_import(){   # make the main Caddyfile import our drop-in
  local main=/etc/caddy/Caddyfile
  if $DRYRUN; then echo "    [skip] ensure 'import conf.d/*.caddy' in $main"; return 0; fi
  mkdir -p /etc/caddy/conf.d; touch "$main"
  grep -qF 'conf.d/*.caddy' "$main" 2>/dev/null || printf '\nimport conf.d/*.caddy\n' >> "$main"
}
write_caddy_site(){
  local site="$PANEL_DOMAIN" tls="" handle="handle"
  [ -n "$PANEL_BASE" ] && handle="handle ${PANEL_BASE}/*"
  if [ -n "${CERT_FULLCHAIN:-}" ] && [ -n "${CERT_KEY:-}" ]; then tls="    tls ${CERT_FULLCHAIN} ${CERT_KEY}"
  elif [ "$TLS_MODE" = selfsigned ]; then tls="    tls internal"
  elif [ "$TLS_MODE" = skip ]; then site="http://${PANEL_DOMAIN}"; fi
  writef /etc/caddy/conf.d/swg-panel.caddy 644 <<EOF
${site} {
${tls}
    ${handle} {
        reverse_proxy 127.0.0.1:${PORT}
    }
}
EOF
  ensure_caddy_import
}
serve_caddy(){
  SUB_BIND=127.0.0.1; SUB_TRUST_XFF=1        # the panel site is auto-managed; swg-sub stays on loopback until you proxy it too
  have caddy || warn "caddy not found — install it (https://caddyserver.com), then re-run or 'systemctl reload caddy'"
  write_panel_unit
  run systemctl daemon-reload; run systemctl enable --quiet $_NOW swg-panel-server
  setup_tls_proxy            # caddy isn't up yet, so acme standalone (:80) is free for letsencrypt
  write_caddy_site
  run systemctl reload caddy 2>/dev/null || run systemctl restart caddy 2>/dev/null || warn "couldn't (re)load caddy — start it after checking /etc/caddy/conf.d/swg-panel.caddy"
  local sch="https"; { [ "$TLS_MODE" = skip ] && [ -z "${CERT_FULLCHAIN:-}" ]; } && sch="http"
  ok "caddy: serving ${sch}://${PANEL_DOMAIN}${PANEL_BASE}/"
  note_sub_proxy
}

# ---- manual reverse proxy ("skip"): bind panel + swg-sub to loopback and print ready nginx/caddy configs
# ---- (gen_proxy_conf / print_proxy_configs live in lib/common.sh, shared with install-docker). Installs nothing.
sub_shipped(){ [ -f "$PREFIX$SUB_DIR/swg-sub" ]; }

note_sub_proxy(){   # auto modes manage the PANEL vhost only; point the operator at the sub block for later
  sub_shipped || return 0
  sub "swg-sub is on 127.0.0.1:${SUB_PORT} (off until enabled in the panel). When you turn subscriptions on, add a proxy block for ${SUB_DOMAIN:-your sub hostname} → 127.0.0.1:${SUB_PORT} (same shape as the panel block)."
}

serve_skip(){
  SUB_BIND=127.0.0.1; SUB_TRUST_XFF=1        # behind the operator's proxy → loopback + trust the proxy's X-Forwarded-For
  write_panel_unit
  run systemctl daemon-reload; run systemctl enable --quiet $_NOW swg-panel-server
  ok "Panel on 127.0.0.1:${PORT}${PANEL_BASE}$(sub_shipped && printf ', swg-sub on 127.0.0.1:%s' "${SUB_PORT}") — configure your web server to proxy to them."
  print_proxy_configs "$ETC_DIR/reverse-proxy" "$PANEL_DOMAIN" "127.0.0.1:${PORT}" "$PANEL_BASE" \
    "$(sub_shipped && printf '%s' "${SUB_DOMAIN:-sub.example.com}")" "127.0.0.1:${SUB_PORT}"
}

info "Login + TLS ($SERVE_MODE)"
if [ "$KEEP_AUTH" = yes ] && [ "${SET_PASS:-no}" != yes ]; then ok "keeping existing login ($BASIC_USER)"; run chmod 640 "$ETC_DIR/auth"; run chown root:swg "$ETC_DIR/auth"
else mk_auth_file; fi
case "$SERVE_MODE" in
  internal) serve_internal;;
  nginx)    serve_nginx;;
  caddy)    serve_caddy;;
  skip)     serve_skip;;
esac

# ───────────────────────── enable ─────────────────────────
info "Enable services"
run systemctl daemon-reload
[ "$HOST_HAS_WG" = yes ] && { run systemctl enable --quiet swg-noded; run systemctl restart swg-noded || warn "couldn't start swg-noded"; }   # restart so a re-run picks up newly-added interfaces (config.json is read only at startup)
run systemctl enable --quiet $_NOW swg-panel-server
if [ "${SWG_DEFER_START:-}" != 1 ] && ! $DRYRUN; then
  _pu="$(panel_probe_url)"
  _pw=0; while [ $_pw -lt 12 ] && ! curl -kfsS -o /dev/null --max-time 2 "$_pu" 2>/dev/null; do sleep 1; _pw=$((_pw+1)); done
  if ! curl -kfsS -o /dev/null --max-time 2 "$_pu" 2>/dev/null; then
    _bp="$PORT"
    if panel_owns_port "$_bp"; then
      warn "the panel is running (it holds :$_bp) but did not answer $_pu within ${_pw}s"
      echo "    What went wrong:  swg-logs panel -n 30"
    else
      PANEL_UP=no
      _bw="$(ss -lntpH "sport = :$_bp" 2>/dev/null | grep -oE '"[^"]+"' | sed -n 1p | tr -d '"' || true)"
      warn "the panel did NOT start — it is installed but not running"
      if [ -n "$_bw" ]; then
        echo "    port :$_bp is already held by $(col "$C_YEL" "$_bw")."
        if [ "$SERVE_MODE" = internal ]; then
          echo "    Give the panel a free port (re-run with PANEL_DOMAIN=${PANEL_DOMAIN}:8443),"
          echo "    or serve it behind that web server (SERVE_MODE=nginx)."
        else
          echo "    Give the panel a free loopback port (re-run with PORT=<free port>)."
        fi
      fi
      echo "    What went wrong:  swg-logs panel -n 30"
    fi
  fi
fi
if [ -f "$PREFIX$SUB_DIR/swg-sub" ]; then   # inert until enabled in Settings → Subscriptions
  _subu="$PREFIX/etc/systemd/system/swg-sub.service"; _subu_was="$(cat "$_subu" 2>/dev/null || true)"
  _sub_was_up=no; ! $DRYRUN && systemctl is-active --quiet swg-sub 2>/dev/null && _sub_was_up=yes
  write_sub_unit; run systemctl daemon-reload
  if [ "$_sub_off" = yes ]; then ok "swg-sub left disabled and stopped, as it was (systemctl enable --now swg-sub to serve subscriptions)"
  else run systemctl enable --quiet $_NOW swg-sub || warn "couldn't start swg-sub"; fi
  if [ "$_sub_was_up" = yes ] && [ "$(cat "$_subu" 2>/dev/null || true)" != "$_subu_was" ]; then
    if run systemctl restart swg-sub; then ok "swg-sub restarted — its unit changed (it listens on ${SUB_BIND}:${SUB_PORT} unless the panel's Settings set another address)"
      if ! $DRYRUN && [ "${SWG_DEFER_START:-}" != 1 ] && systemctl is-active --quiet swg-panel-server 2>/dev/null; then
        run systemctl restart swg-panel-server && sub "the panel restarted, so its settings record swg-sub's new address"
      fi
    else warn "swg-sub's unit changed but it could not be restarted — it runs the old one until: systemctl restart swg-sub"; fi
  fi
fi
write_netctl   # privileged network/TLS helper for the panel's Access & TLS settings (root; drains a validated queue)
if ! $DRYRUN && [ -n "$(ls -A "$STATE_DIR/netctl/queue" 2>/dev/null)" ]; then run timeout 60 systemctl start swg-netctl.service 2>/dev/null || true; fi
[ "$SERVE_MODE" = nginx ] && { run nginx -t && run systemctl reload nginx || warn "nginx -t failed; fix the vhost then: systemctl reload nginx"; }

# ⚠️ "RE-INSTALLED AND UPDATED" ONLY WHEN SOMETHING WAS. A re-install of the same build said "updated" on every run —
# the panel's header then announced an update that never happened. Same files before and after → plain "re-installed".
if [ "${LC_SUCCESS:-}" = reinstalled-updated ] && [ -n "${_SUM_BEFORE:-}" ] \
   && [ "$(installed_sum "$PANEL_DIR" "$SUB_DIR" "$NODED_DIR" "$AGENT_DIR" /usr/local/bin/swg-netctl /usr/local/bin/swg-passwd)" = "$_SUM_BEFORE" ]; then
  LC_SUCCESS=reinstalled
elif [ "${LC_SUCCESS:-}" = reinstalled-updated ] && [ -z "${_SUM_BEFORE:-}" ] && [ -n "${_VER_BEFORE:-}" ] \
   && [ "$_VER_BEFORE" = "$(head -1 "$REPO/VERSION" 2>/dev/null)" ]; then
  LC_SUCCESS=reinstalled
fi
# SUMMARY
if [ -z "${SWG_CONVERT_DIR:-}" ]; then
echo
if $DRYRUN; then
  _dsch=https; [ "$TLS_MODE" = skip ] && [ -z "${CERT_FULLCHAIN:-}" ] && _dsch=http
  _dps=":$PORT"; case "$PORT" in 443|80|"") _dps="";; esac
  ok "Dry run of the bare-metal $ROLE_SEL $([ "$EXISTING_HOST" = yes ] && echo re-install || echo install) finished — nothing was installed or changed."
  echo "    The panel would be served at $(b "$_dsch://$PANEL_DOMAIN$_dps$PANEL_BASE/") (TLS $(b "$TLS_MODE"))."
else
# The files are all in place either way, so this still prints the summary (the operator needs the login and
# the paths) — but it must not call a dead panel a success.
if [ "${PANEL_UP:-yes}" = no ]; then warn "Host install finished, but the panel is NOT running (see above)."
else ok "Host install complete."; fi
if [ "$KEEP_AUTH" != yes ] || [ "${SET_PASS:-no}" = yes ]; then
  if [ "$_PASS_GIVEN" = yes ]; then export SWG_SUMMARY_PASS_GIVEN=1; else export SWG_SUMMARY_PASS="$BASIC_PASS"; fi
fi
print_summary "$([ "$EXISTING_HOST" = yes ] && echo RE-INSTALL || echo INSTALL)"
unset SWG_SUMMARY_PASS SWG_SUMMARY_PASS_GIVEN
fi
else ok "panel installed on bare-metal — continuing…"; fi   # convert: brief line; convert.sh prints the unified summary
if $DRYRUN; then echo; ok "DRY RUN done — inspect ./dryrun"; fi   # `if` (not `&&`) so a real run doesn't exit the script non-zero on its last command
