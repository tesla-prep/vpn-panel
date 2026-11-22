#!/usr/bin/env bash
# Выбор способа установки и роли. Параметры описаны в docs/operations.md.
# Bash разбирает всю группу до выполнения, поэтому оборванная загрузка не начнёт установку.
{
set -euo pipefail
# sudo-rs может оставить скрипт в фоне. В этой группе процессов чтение /dev/tty вызовет SIGTTIN.
_swg_tty_fg(){ local s f p e i IFS=' '; { read -r s </proc/$$/stat; } 2>/dev/null || return 0; read -ra f <<< "${s##*) }"
  [ "${f[2]:-}" = "${f[5]:-}" ] && return 0; [ "${f[5]:-0}" -gt 0 ] 2>/dev/null || return 1
  for i in 1 2 3 4; do p="${f[1]:-0}"; [ "$p" -gt 1 ] 2>/dev/null || return 0; e="$(readlink "/proc/$p/exe" 2>/dev/null)" || e=""
    case "${e##*/}" in sudo*) case "$e" in *sudo-rs*|*cargo*) return 1;; esac
      case "$("$e" --version 2>/dev/null)" in sudo-rs*) return 1;; esac; return 0;; esac
    { read -r s <"/proc/$p/stat"; } 2>/dev/null || return 0; read -ra f <<< "${s##*) }"; done; return 0; }
SWG_TTY=/dev/tty; _swg_tty_fg || SWG_TTY=/dev/null
swg_tty_ok(){ [ "$SWG_TTY" = /dev/tty ] && { : </dev/tty; } 2>/dev/null; }
SWG_ARGS=("$@")   # as given — the command the warning below hands back is built from them
cd / 2>/dev/null || cd "${TMPDIR:-/tmp}" 2>/dev/null || true
REPO="${SWG_REPO:-https://github.com/tesla-prep/vpn-panel}"
_ref_from_url(){   # https://raw.githubusercontent.com/<owner>/<repo>/<ref>/bootstrap.sh  → <ref>
  printf '%s' "${1:-}" | sed -nE \
    -e 's#^https?://raw\.githubusercontent\.com/[^/]+/[^/]+/([^/]+)/.*#\1#p' \
    -e 's#^https?://[^/]+/[^/]+/[^/]+/raw/([^/]+)/.*#\1#p' | sed -n 1p
}
REF="${SWG_REF:-}"
[ -z "$REF" ] && REF="$(_ref_from_url "${SWG_BOOTSTRAP_URL:-}")"
REF="${REF:-main}"
export SWG_REF="$REF"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then BOLD=$'\033[1m'; RESET=$'\033[0m'; C_BLUE=$'\033[38;5;39m'; C_BL=$'\033[38;5;33m'; C_BROWN=$'\033[38;5;130m'; C_RED=$'\033[31m'; else BOLD=""; RESET=""; C_BLUE=""; C_BL=""; C_BROWN=""; C_RED=""; fi
b(){ printf '%s%s%s' "$BOLD" "$*" "$RESET"; }
col(){ local c="$1"; shift; printf '%s%s%s' "$c" "$*" "$RESET"; }
menu(){ printf '  %s\n      %s\n\n' "$1" "$2"; }
die(){  echo "${C_RED}✗ $*${RESET}" >&2; exit 1; }            # universal flags: :: blue, ! brown, ✗ red
_SWG_NL=""; _pnl(){ printf '\n' 2>/dev/null >/dev/tty || echo; _SWG_NL=1; }; _nlguard(){ _SWG_NL=""; }
warn(){ _nlguard; echo "${C_BROWN}!${RESET} $*" >&2; }
info(){ _nlguard; echo "${C_BL}::${RESET} $*"; }
panel_req(){ python3 - "$@" <<'PANELREQ'
import hashlib, http.client, math, os, re, signal, ssl, sys, urllib.parse
a = (sys.argv[1:] + [""] * 5)[:5]
meth, url, verify = a[0] or "GET", a[1], a[2] == "yes"
fp = a[3].strip().replace(":", "").lower()
if fp and not re.fullmatch(r"[0-9a-f]{64}", fp):      # a pin that is not a sha256 is never read as "no pin": fail closed
    print("the pin on record (%s…) is not a sha256 fingerprint — nothing was sent" % fp[:16])
    sys.exit(4)
try:
    tmo = max(1.0, float(a[4]))
except ValueError:
    tmo = 8.0
tok, body = os.environ.get("SWG_TOK", ""), os.environ.get("SWG_BODY", "")
u = urllib.parse.urlparse(url if "://" in url else "https://" + url)
sent, conn = False, None


def late(*_):
    raise TimeoutError("timed out")


signal.signal(signal.SIGALRM, late)
signal.alarm(int(math.ceil(tmo)))
try:
    host, port = u.hostname or "", u.port or (443 if u.scheme == "https" else 80)
    path = (u.path or "/") + ("?" + u.query if u.query else "")
    if u.scheme == "http":
        conn = http.client.HTTPConnection(host, port, timeout=tmo)
    elif u.scheme == "https":
        ctx = ssl.create_default_context() if (verify and not fp) else ssl._create_unverified_context()
        conn = http.client.HTTPSConnection(host, port, timeout=tmo, context=ctx)
    else:
        print("unsupported URL scheme %r" % u.scheme)
        sys.exit(1)
    try:
        conn.connect()                                   # the handshake, and a CA check, before a byte of the request
    except ssl.SSLCertVerificationError as e:
        print("the panel's certificate did not verify (%s) — nothing was sent" % (e.verify_message or e.reason or e))
        sys.exit(4)
    if fp and u.scheme == "https":
        got = hashlib.sha256(conn.sock.getpeercert(True) or b"").hexdigest()
        if got != fp:
            print("the panel presents a certificate other than the pinned one (sha256 %s…, pinned %s…) — nothing was sent"
                  % (got[:16], fp[:16]))
            sys.exit(4)
    hdr = {"Authorization": "Bearer " + tok, "User-Agent": "swg-noded"}
    if body:
        hdr["Content-Type"] = "application/json"
    sent = True
    conn.request(meth, path, body=body.encode() if body else None, headers=hdr)
    r = conn.getresponse()
    try:
        data = r.read()
    except http.client.IncompleteRead as e:
        data = e.partial
    if 200 <= r.status < 300:
        sys.stdout.write(data.decode("utf-8", "replace"))
        sys.exit(0)
    print("HTTP %d" % r.status)
    sys.exit(3)
except Exception as e:
    why = str(getattr(e, "reason", None) or getattr(e, "strerror", None) or e or type(e).__name__)
    print(why[:1].lower() + why[1:])
    sys.exit(2 if sent else 1)
finally:
    signal.alarm(0)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
PANELREQ
}
ask_choice(){ local p="$1" d="$2" var="$3" opts="$4" how="${5:-}" v o rc sc pr i
  sc="${d:0:1}"
  # a preset answer is said under its menu, not taken in silence (the installers' "given — not asked" line)
  if [ -n "${!var:-}" ]; then for o in $opts; do [ "${!var}" = "$o" ] && { echo "  $p: $(b "$o")  (given — not asked)"; _pnl; return; }; done; fi
  pr="  $p${d:+ [$(col "$C_BLUE" "$sc")]}: "
  while :; do
    printf '%s' "$pr" 2>/dev/null >/dev/tty || printf '%s' "$pr"
    if read -r v 2>/dev/null <"${SWG_TTY:-/dev/tty}"; then rc=0; else rc=1; v=""; fi
    [ "$rc" -ne 0 ] && die "no interactive input for '$p' — run this from a terminal (ssh -t), or ${how:-pass it as a flag (one of: $opts)}"
    v="${v:-$d}"
    case "$v" in ''|*[!0-9]*) :;; *) i=1; for o in $opts; do [ "$i" = "$v" ] && { v="$o"; break; }; i=$((i+1)); done;; esac   # [N] → the Nth option
    for o in $opts; do [ "$v" = "$o" ] || { [ -n "$v" ] && [ "$v" = "${o:0:1}" ]; } && { printf -v "$var" '%s' "$o"; _pnl; return; }; done
    if [ -n "$v" ]; then
      pr="  Can't understand \"$v\". $p${d:+ or press Enter to use the default [$(col "$C_BLUE" "$sc")]}: "
    else
      pr="  $p${d:+ [$(col "$C_BLUE" "$sc")]}: "
    fi
  done; }
ask_yn(){ local p="$1" d="$2" var="$3" v pr   # ask_yn <prompt> <y|n default> <var>  → sets var to yes/no
  pr="  $p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): "
  printf '%s' "$pr" 2>/dev/null >/dev/tty || printf '%s' "$pr"
  read -r v 2>/dev/null <"${SWG_TTY:-/dev/tty}" || die "no interactive input for '$p' — run this from a terminal (e.g. ssh -t), so it is not answered for you"
  v="${v:-$d}"
  case "$v" in [Yy]*) printf -v "$var" yes;; *) printf -v "$var" no;; esac; _pnl; }

ACTION=""; METHOD="${METHOD:-}"; ROLE="${ROLE:-}"; ROLE_EXPLICIT=no; HAVE_KEY=no
ON_CONFLICT="${SWG_ON_CONFLICT:-}"   # convert|keep|abort — the cross-method question's answer, for an unattended run
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    update|uninstall)            ACTION="$1"; shift;;
    recovery)                    ROLE=node; ROLE_EXPLICIT=yes; export SWG_RECOVER_MENU=1; shift;;   # open the leftover-identity menu directly (even on a box that still has a live node)
    docker)                      METHOD=docker; shift;;
    bare-metal|baremetal)        METHOD=baremetal; shift;;
    master|host|node)            ROLE="$1"; ROLE_EXPLICIT=yes; shift;;
    -key|--key|-token|--token)   export NODE_TOKEN="${2:-}"; HAVE_KEY=yes; shift 2 || shift;;
    -host|--host|-url|--url)     export PANEL_URL="${2:-}";  shift 2 || shift;;
    -name|--name)                export NODE_NAME="${2:-}";  shift 2 || shift;;
    -endpoint|--endpoint)        export ENDPOINT_IP="${2:-}"; shift 2 || shift;;
    -method|--method)            METHOD="${2:-}"; shift 2 || shift;;
    -role|--role)                ROLE="${2:-}"; ROLE_EXPLICIT=yes; shift 2 || shift;;
    convert|keep|abort)          ON_CONFLICT="$1"; shift;;
    -on-conflict|--on-conflict)  ON_CONFLICT="${2:-}"; shift 2 || shift;;
    --)                          shift;;
    *)                           PASS+=("$1"); shift;;
  esac
done
[ "$METHOD" = bare-metal ] && METHOD=baremetal

[ "$(id -u)" = 0 ] || die "run with sudo (it installs users, units and certs)"

# ⚠️ THE TERMINAL CANNOT BE READ (see _swg_tty_fg above): say so before anything asks, with the command that can — the
# same arguments in the one form that works under sudo-rs and classic sudo alike (sudo's stdin is the terminal, not a pipe).
if [ "$SWG_TTY" = /dev/null ] && { : </dev/tty; } 2>/dev/null; then
  _bs_url="<this bootstrap.sh URL>"
  [ "$REPO" = https://github.com/tesla-prep/vpn-panel ] && _bs_url="https://raw.githubusercontent.com/tesla-prep/vpn-panel/${REF:-main}/bootstrap.sh"
  # A ref other than main rides INSIDE the script string: sudo resets the environment, so SWG_REF in front of it would be
  # dropped, and the URL does not reach the script either — the dev bootstrap would install main (see _ref_from_url).
  _bs_pre=""; [ -n "${REF:-}" ] && [ "${REF:-}" != main ] && _bs_pre="SWG_REF=$(printf '%q' "$REF"); "
  _bs_cmd="sudo bash -c \"$_bs_pre\$(curl -fsSL $_bs_url)\" --"
  for _a in ${SWG_ARGS[@]+"${SWG_ARGS[@]}"}; do _bs_cmd+=" $(printf '%q' "$_a")"; done
  warn "this terminal cannot be read: the script runs in its background, which \`curl … | sudo bash\` does under sudo-rs (Ubuntu 26.04's sudo). Questions take their defaults, and one that has none stops the run. To answer them, run instead:"
  echo "    $_bs_cmd" >&2
  export SWG_TTY_WARNED=1
fi

# refuse on a declaratively managed host, BEFORE the fetch
if [ -e /etc/NIXOS ] || grep -qsE '^ID="?nixos"?[[:space:]]*$' /etc/os-release; then
  die "NixOS detected. Run this installer on another Linux host with systemd or Docker."
fi

# an update runs OUTSIDE swg-noded's sandbox
_swg_sandboxed(){ local s p
  s="$(readlink /proc/self/ns/mnt 2>/dev/null)" && p="$(readlink /proc/1/ns/mnt 2>/dev/null)" && [ -n "$p" ] && [ "$s" != "$p" ] || return 1
  [ -w /usr ] || return 0
  [ "$(stat -Lc %d:%i /tmp 2>/dev/null)" != "$(stat -Lc %d:%i /proc/1/root/tmp 2>/dev/null)" ]; }
if [ "$ACTION" = update ] && [ -z "${SWG_UPDATE_HOP:-}" ] && _swg_sandboxed; then
  _src=""; case "$0" in /*) if [ -f "$0" ]; then _src=file; fi;; esac   # `bash <file>` (1.8.8's launcher), or `bash -c <text>`
  if [ -z "$_src" ] && [ -n "${BASH_EXECUTION_STRING:-}" ]; then _src=text; fi
  if [ -n "$_src" ] && [ -d /run/systemd/system ] && command -v systemd-run >/dev/null 2>&1 \
     && _hop="$(mktemp -d /run/swg-update-hop.XXXXXX)"; then
    umask 077
    if [ "$_src" = file ]; then cp "$0" "$_hop/bootstrap.sh"; else printf '%s\n' "$BASH_EXECUTION_STRING" > "$_hop/bootstrap.sh"; fi
    # the service starts with PID 1's environment: this run's (the panel's turn mirror, a proxy, SWG_REF) fills in what it
    # lacks — from a file only root reads, not --setenv: a unit's environment is readable by every local user over D-Bus
    { for _k in $(compgen -e); do
        case "$_k" in INVOCATION_ID|JOURNAL_STREAM|NOTIFY_SOCKET|SYSTEMD_EXEC_PID|PWD|OLDPWD|SHLVL|_) continue;; esac
        if [ -n "${!_k+x}" ]; then printf '[ -n "${%s+x}" ] || export %s=%q\n' "$_k" "$_k" "${!_k}"; fi
      done
      printf 'export SWG_UPDATE_HOP=1\nbash %q' "$_hop/bootstrap.sh"; printf ' %q' ${SWG_ARGS[@]+"${SWG_ARGS[@]}"}
      printf '\nrc=$?; rm -rf %q; exit "$rc"\n' "$_hop"; } > "$_hop/run"
    info "this update runs inside swg-noded's sandbox (/usr read-only, a private /tmp) — running it again as a service, outside it"
    _rc=0
    systemd-run --unit swg-self-update --collect --wait --pipe --quiet \
      --description "swg self-update (run again outside swg-noded's sandbox)" bash "$_hop/run" || _rc=$?
    rm -rf "$_hop"
    exit "$_rc"
  fi
  warn "this update runs inside a service's sandbox (/usr read-only or a private /tmp) and cannot be run again outside it here — going on in place"
fi

# ── fetch the repo ──
need(){ command -v "$1" >/dev/null 2>&1; }
_keep_tmp=0
_cleanup_tmp(){
  if [ "$_keep_tmp" = 1 ] && [ -d "${TMP:-}/swg-panel/dryrun" ]; then
    printf '\n  dry-run preview kept at %s\n  remove it with: rm -rf %s\n' "$TMP/swg-panel/dryrun" "$TMP"
  elif [ -n "${TMP:-}" ]; then
    rm -rf "$TMP"
  fi
  return 0
}
run_script(){   # run_script <script> [args…] — dispatch as a child, so the EXIT trap can clean up
  local _s="$1"; shift
  local _a
  for _a in "$@"; do if [ "$_a" = --dry-run ]; then _keep_tmp=1; fi; done
  local _rc=0
  bash "$SCRIPT_DIR/$_s" "$@" || _rc=$?    # `|| _rc=$?` because set -e would otherwise exit before we do
  exit $_rc
}
TMP="$(mktemp -d)"; trap '_cleanup_tmp' EXIT
info "fetching $REPO @ $REF"
# При сбое проверяем Git через HTTP/1.1, затем пробуем архив. Git запускается без запроса пароля.
_fetched=""
_archive_name="${REPO##*/}"
_archive_name="${_archive_name%.git}"
if printf '%s' "$REF" | grep -cE '^[0-9a-f]{7,40}$' >/dev/null; then
  if need curl && need tar && curl -fsSL "${REPO%.git}/archive/$REF.tar.gz" | tar -xz -C "$TMP"; then
    mv "$TMP"/"$_archive_name"-* "$TMP/swg-panel" && _fetched=tar
  fi
  _track="${SWG_TRACK:-}"
  if [ -z "$_track" ] && [ -f /usr/local/bin/swg-update ]; then
    _track="$(sed -nE 's#.*raw\.githubusercontent\.com/[^/]+/[^/]+/([^/]+)/bootstrap\.sh.*#\1#p' /usr/local/bin/swg-update | sed -n 1p)"
    printf '%s' "$_track" | grep -cE '^[0-9a-f]{7,40}$' >/dev/null && _track=""
  fi
  if [ -z "$_track" ] && [ -f /etc/swg-agent/config.json ] && need python3; then
    _track="$(python3 -c 'import json,sys;print(str(((json.load(open(sys.argv[1])).get("node") or {}).get("update_ref")) or "").strip())' \
                /etc/swg-agent/config.json 2>/dev/null || true)"
    printf '%s' "$_track" | grep -cE '^[0-9a-f]{7,40}$' >/dev/null && _track=""
  fi
  # a ref goes into a URL and a shell command — the same character set swg-noded accepts for update_ref, or nothing
  printf '%s' "$_track" | grep -cE '^[A-Za-z0-9._/-]{1,100}$' >/dev/null || _track=""
  export SWG_REF="${_track:-main}"
  export SWG_COMMIT="$REF"   # …and the commit itself: on Docker the containers do not follow it, and that is said (SOAK-3)
  info "installing commit $REF — this box's Update button keeps following $(b "$SWG_REF")"
elif need git; then
  if GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$REF" "$REPO" "$TMP/swg-panel"; then
    _fetched=git
  else
    rm -rf "$TMP/swg-panel"   # a failed clone can leave a partial dir, and the mv below would land INSIDE it
    warn "git clone failed — retrying over HTTP/1.1 (Ubuntu 22.04 git/nghttp2 vs GitHub HTTP/2)"
    if GIT_TERMINAL_PROMPT=0 git -c http.version=HTTP/1.1 clone --depth 1 --branch "$REF" "$REPO" "$TMP/swg-panel"; then
      _fetched=git
    else
      rm -rf "$TMP/swg-panel"
      warn "git clone failed over HTTP/1.1 too — falling back to the source tarball"
    fi
  fi
fi
if [ -z "$_fetched" ] && need curl && need tar; then
  if { curl -fsSL "${REPO%.git}/archive/refs/heads/$REF.tar.gz" | tar -xz -C "$TMP"; } \
     || { curl -fsSL "${REPO%.git}/archive/refs/tags/$REF.tar.gz" | tar -xz -C "$TMP"; }; then
    mv "$TMP"/"$_archive_name"-* "$TMP/swg-panel" && _fetched=tar
  fi
fi
[ -n "$_fetched" ] || die "could not fetch $REPO @ $REF — needs git, or curl+tar, and a reachable GitHub"
cd "$TMP/swg-panel"
SCRIPT_DIR=./scripts
# Older commits and tags shipped the scripts at the checkout root.
[ -d "$SCRIPT_DIR" ] || SCRIPT_DIR=.

# ── update / uninstall: no method/role ──
if [ -n "$ACTION" ]; then
  SCRIPT="update.sh"; [ "$ACTION" = uninstall ] && SCRIPT="uninstall.sh"
  info "running $SCRIPT"; run_script "$SCRIPT" ${PASS[@]+"${PASS[@]}"}
fi

# only a node carries an enrollment key — infer the role from -key
[ "$HAVE_KEY" = yes ] && [ -z "$ROLE" ] && ROLE=node

# ───────────────── existing-install detection (drives the routing below) ─────────────────
SD=/etc/systemd/system; DOCKER_DIR="${SWG_DOCKER_DIR:-/opt/swg-panel-docker}"
dkr(){ command -v docker >/dev/null 2>&1; }
dkr_has(){ dkr && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx "$1" >/dev/null; }
BARE_PANEL=no; BARE_NODE=no; DOCK_PANEL=no; DOCK_NODE=no
if [ -d /opt/swg-panel ] || [ -f "$SD/swg-panel-server.service" ]; then BARE_PANEL=yes; fi
if [ -d /opt/swg-noded ] || [ -d /opt/swg-agent ] || [ -f "$SD/swg-noded.service" ]; then BARE_NODE=yes; fi
if dkr_has swg-panel; then DOCK_PANEL=yes; fi
if dkr_has swg-node;  then DOCK_NODE=yes; fi
has_comp(){ case "$1-$2" in   # has_comp <baremetal|docker> <panel|node>  → 0 if that component is installed
  baremetal-panel) [ "$BARE_PANEL" = yes ];; baremetal-node) [ "$BARE_NODE" = yes ];;
  docker-panel)    [ "$DOCK_PANEL" = yes ];; docker-node)    [ "$DOCK_NODE" = yes ];; *) return 1;; esac; }
mlabel(){ [ "$1" = baremetal ] && echo bare-metal || echo "$1"; }

# Bare `install` (no method, no role): re-install exactly what's already here, skipping the prompts.
if [ -z "$METHOD" ] && [ -z "$ROLE" ]; then
  _bare=no; _dock=no
  { [ "$BARE_PANEL" = yes ] || [ "$BARE_NODE" = yes ]; } && _bare=yes
  { [ "$DOCK_PANEL" = yes ] || [ "$DOCK_NODE" = yes ]; } && _dock=yes
  if [ "$_bare" = yes ] && [ "$_dock" = yes ]; then
    info "both a bare-metal and a docker install are present — choose which to re-install:"   # mixed → fall through to the prompts
    [ "$BARE_PANEL" = yes ] && [ "$DOCK_PANEL" = yes ] \
      && warn "that is TWO panels, each with its own servers and settings — the installer will offer to stop the one you don't pick"
  elif [ "$_bare" = yes ]; then METHOD=baremetal
    if   [ "$BARE_PANEL" = yes ] && [ "$BARE_NODE" = yes ]; then ROLE=master
    elif [ "$BARE_PANEL" = yes ]; then ROLE=host; else ROLE=node; fi
  elif [ "$_dock" = yes ]; then METHOD=docker
    if   [ "$DOCK_PANEL" = yes ] && [ "$DOCK_NODE" = yes ]; then ROLE=master
    elif [ "$DOCK_PANEL" = yes ]; then ROLE=host; else ROLE=node; fi
  fi
  { [ -n "$METHOD" ] && [ -n "$ROLE" ]; } && info "existing $(mlabel "$METHOD") install detected — re-installing $(b "$ROLE") (your settings are the defaults)."
fi

# ── method + role (sequential step numbering — only steps actually shown here count) ──
STEP=1
step(){ [ -n "${_SWG_NL:-}" ] || echo; _SWG_NL=""; echo "$(b "Step $STEP. $1")"; echo; STEP=$((STEP+1)); }

# resume an interrupted conversion
if [ -f /var/lib/swg-recovery ]; then
  . /var/lib/swg-recovery 2>/dev/null || true
  # a complete uninstall can leave the marker behind; if NEITHER side of the convert is on the box any more,
  # the marker is orphaned (nothing to resume) — drop it silently so a fresh install doesn't offer Resume.
  if [ ! -e /etc/swg-agent ] && [ ! -e "$DOCKER_DIR" ] && [ ! -e "$SD/swg-noded.service" ] \
     && ! { command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; }; then
    rm -f /var/lib/swg-recovery 2>/dev/null || true
  elif [ -n "${SWG_RV_FROM:-}" ] && [ -n "${SWG_RV_TO:-}" ] && [ -n "${SWG_RV_ROLE:-}" ]; then
    echo
    warn "An unfinished $(mlabel "$SWG_RV_FROM") → $(mlabel "$SWG_RV_TO") conversion was found."
    info "  Resume → finish it on $(mlabel "$SWG_RV_TO"), keeping the same node, token and peers (safe even if the switch-over had already begun)."
    info "  Skip   → leave the node on $(mlabel "$SWG_RV_FROM"); the unfinished $(mlabel "$SWG_RV_TO") copy is inert and gets auto-removed."
    _ans=yes; ask_yn "Resume the conversion now" y _ans
    if [ "$_ans" = yes ]; then
      info "resuming the $(mlabel "$SWG_RV_FROM") → $(mlabel "$SWG_RV_TO") conversion…"; echo
      run_script convert.sh "$SWG_RV_FROM" "$SWG_RV_TO" "$SWG_RV_ROLE" ${PASS[@]+"${PASS[@]}"}
    fi
    info "keeping the node on $(mlabel "$SWG_RV_FROM") — the unfinished $(mlabel "$SWG_RV_TO") copy is inert and gets auto-removed."
    rm -f /var/lib/swg-recovery 2>/dev/null || true
  fi
fi

if [ -z "$METHOD" ]; then
  if [ "$ROLE_EXPLICIT" = yes ]; then METHOD=baremetal     # a bare role word (host/master/node) ⇒ bare-metal
  else
    step "Installation method"
    menu "$(b "$(col "$C_BLUE" '[1] [b]are-metal (default)')")" "Runs directly on this host (kernel datapath, best throughput). Recommended for a dedicated box."
    menu "$(col "$C_BLUE" '[2] [d]ocker')"                      "Runs in containers (userspace datapath, isolated). No kernel module needed."
    ask_choice "Select the installation method (number, letter or name)" "bare-metal" METHOD "bare-metal docker baremetal"
    [ "$METHOD" = bare-metal ] && METHOD=baremetal
  fi
fi
if [ -z "$ROLE" ]; then
  step "Server role"
  menu "$(b "$(col "$C_BLUE" '[1] [m]aster (default)')")" "Panel + a local WireGuard/AmneziaWG node on this box (all-in-one)."
  menu "$(col "$C_BLUE" '[2] [h]ost')"                    "Panel only; entry-server nodes are deployed separately (run their command from the panel)."
  menu "$(col "$C_BLUE" '[3] [n]ode')"                    "An entry server that joins an existing panel."
  ask_choice "Select the server role (number, letter or name)" "master" ROLE "master host node"
fi
# cross-method conflict (requested method ≠ what's already installed)
ROLE_COMPS=""; case "$ROLE" in host) ROLE_COMPS=panel;; node) ROLE_COMPS=node;; master) ROLE_COMPS="panel node";; esac
OTHER=baremetal; [ "$METHOD" = baremetal ] && OTHER=docker
CONFLICT=""
for _c in $ROLE_COMPS; do
  if ! has_comp "$METHOD" "$_c" && has_comp "$OTHER" "$_c"; then CONFLICT="${CONFLICT:+$CONFLICT }$_c"; fi
done
# the box's ACTUAL installed role on the OTHER method — so the convert prompt names what's really there (master
# when both a panel + a node are present); the master split-question is then asked ONLY after you choose convert.
if   has_comp "$OTHER" panel && has_comp "$OTHER" node; then OTHER_ROLE=master
elif has_comp "$OTHER" panel; then OTHER_ROLE=host
else OTHER_ROLE=node; fi
if [ -n "$CONFLICT" ]; then
  while :; do
    [ -n "${_conflict_used:-}" ] && [ -n "$ON_CONFLICT" ] && die "the conversion did not go ahead (see above) — nothing was changed. Fix the conflicts, or pass keep / abort instead of $ON_CONFLICT."
    echo
    echo "$(b "! A $(mlabel "$OTHER") $OTHER_ROLE is already installed on this box.")"
    echo "  Convert it to a $(mlabel "$METHOD") $OTHER_ROLE, or re-install it as it is?"
    echo
    menu "$(b "$(col "$C_BLUE" '[1] [c]onvert')")"      "Migrate it to $(mlabel "$METHOD") — all settings / users / peers are preserved. A port/interface pre-flight runs first."
    menu "$(col "$C_BLUE" '[2] [k]eep and re-install')" "Leave it on $(mlabel "$OTHER") and just re-install it (you didn't mean to switch methods)."
    menu "$(col "$C_BLUE" '[3] [a]bort')"               "Exit without changing anything."
    CHOICE="$ON_CONFLICT"; _conflict_used=1
    ask_choice "Convert, keep, or abort (number, letter or name)" "convert" CHOICE "convert keep abort" \
      "pass the answer as a word or -on-conflict (convert | keep | abort; env SWG_ON_CONFLICT)"
    case "$CHOICE" in
      abort) info "aborted — nothing changed."; exit 0;;
      keep)  METHOD="$OTHER"; info "keeping the existing $(mlabel "$OTHER") install — re-installing it as-is."; break;;
      convert)
        # MASTER split — ONLY after you chose convert: the box is a master but you named one part, so offer the
        # whole master (default) or just that part, before the pre-flight.
        if [ "$OTHER_ROLE" = master ] && [ "$ROLE" != master ]; then
          echo
          echo "$(b "  This box is a master — both a panel and a node.")"
          echo "  Convert the whole master, or just the $(b "$ROLE")?"
          echo
          menu "$(b "$(col "$C_BLUE" '[1] [m]aster (default)')")"      "Convert BOTH the panel and the node to $(mlabel "$METHOD") — keep this box a single-method master (recommended)."
          menu "$(col "$C_BLUE" "[2] [${ROLE:0:1}]${ROLE:1}")"         "Convert only the $ROLE to $(mlabel "$METHOD"); the rest stays on $(mlabel "$OTHER") — a mixed-method box you'd manage in two places."
          _msel=""; ask_choice "Convert the whole master, or just the $ROLE (number, letter or name)" master _msel "master $ROLE" \
            "name the role master to convert the whole box (converting only the $ROLE needs a terminal)"
          [ "$_msel" = master ] && ROLE=master
        fi
        # pre-flight (port/interface check) lives in convert.sh --check: exit 0 = clear, non-0 = printed conflicts
        if bash "$SCRIPT_DIR/convert.sh" --check "$OTHER" "$METHOD" "$ROLE"; then
          echo
          _ans=no
          if [ "$ON_CONFLICT" = convert ]; then _ans=yes     # the flag IS the answer to this confirm — it named convert
          else ask_yn "No conflicts found, do you want to proceed with the conversion" y _ans; fi
          [ "$_ans" = yes ] && run_script convert.sh "$OTHER" "$METHOD" "$ROLE" ${PASS[@]+"${PASS[@]}"}
        fi
        ;;   # conflicts (or 'no' at the confirm) → loop the menu again
    esac
  done
fi

_dryrun_flag=no; for _a in ${PASS[@]+"${PASS[@]}"}; do [ "$_a" = --dry-run ] && _dryrun_flag=yes; done
if [ "${CHOICE:-}" != convert ]; then
  if [ "$METHOD" = baremetal ] && [ -d "$DOCKER_DIR" ] && command -v docker >/dev/null 2>&1 \
       && ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cxE 'swg-(node|panel)' >/dev/null; then
    if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
      info "keeping $(b "$DOCKER_DIR") — no container runs from it, but it is not a convert's leftover: an uninstall kept its data (peers, node token) for a re-install. Delete it by hand once you no longer need it."
    elif [ "$_dryrun_flag" = yes ]; then
      info "dry run — would remove a stale docker leftover at $(b "$DOCKER_DIR") (no container present; likely a cancelled bare→docker convert)"
    else
      info "removing a stale docker leftover at $(b "$DOCKER_DIR") — no container present (likely a cancelled bare→docker convert); your live install is untouched"
      rm -rf "$DOCKER_DIR" 2>/dev/null || true
    fi
  fi
  # docker (re-)install: drop ONLY the bare confs that match this docker node's confs (i.e. copies a docker→bare
  # convert left behind) and only when no swg-noded is installed — never an unrelated WireGuard config.
  if [ "$METHOD" = docker ] && [ "$_dryrun_flag" != yes ] && [ -d "$DOCKER_DIR/data/node-confs" ] && command -v systemctl >/dev/null 2>&1 \
       && ! systemctl list-unit-files swg-noded.service >/dev/null 2>&1; then
    _cleared=
    for _c in "$DOCKER_DIR/data/node-confs/"*.conf; do [ -f "$_c" ] || continue; _n="$(basename "$_c" .conf)"
      for _d in "/etc/amnezia/amneziawg/$_n.conf" "/etc/wireguard/$_n.conf"; do [ -f "$_d" ] && { rm -f "$_d"; _cleared=1; }; done
    done
    [ -n "$_cleared" ] && info "removed stale bare-metal conf leftovers — no swg-noded service present (likely a cancelled docker→bare convert); your live install is untouched"
  fi
fi

export STEP_BASE="$STEP"          # the installer numbers its steps from here

_have_live_token=no
if [ "$ROLE" = node ] && [ -z "${NODE_TOKEN:-}" ]; then
  if [ "$METHOD" = docker ]; then
    if [ -f "$DOCKER_DIR/.env" ]; then _lt="$(sed -n 's/^NODE_TOKEN=//p' "$DOCKER_DIR/.env" | sed -n 1p | tr -d '"')"
      [ -n "$_lt" ] && [ "$_lt" != "set-in-nodes-screen" ] && _have_live_token=yes; fi
  else
    if [ -f /etc/swg-agent/config.json ] && command -v python3 >/dev/null 2>&1; then
      _lt="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("token",""))' 2>/dev/null || true)"
      [ -n "$_lt" ] && _have_live_token=yes; fi
  fi
  [ "$_have_live_token" = yes ] && [ "${SWG_RECOVER_MENU:-}" != 1 ] && info "re-installing the existing $(mlabel "$METHOD") node (its token is reused — to recover/rotate instead, use the panel's Recover button or pass -key)."
fi
# Render a leftover identity as a readable block: method, panel URL, token, where its configs live, the
# interfaces + turn-proxies it had, when it was created, and (best-effort, via the panel) its name + last-online.
_fmt_epoch(){ [ -n "${1:-}" ] && date -d "@$1" '+%d.%m.%Y %H:%M:%S' 2>/dev/null || echo "unknown"; }
_salv_created(){ local s="$1" ts
  case "$s" in *.converted-*|*.uninstalled-*) ts="$(printf '%s' "$s" | sed -n 's/.*\.\(converted\|uninstalled\)-\([0-9]\{8\}\)-\([0-9]\{6\}\).*/\2\3/p')"
    [ -n "$ts" ] && { printf '%s.%s.%s %s:%s:%s\n' "${ts:6:2}" "${ts:4:2}" "${ts:0:4}" "${ts:8:2}" "${ts:10:2}" "${ts:12:2}"; return; };; esac
  [ -f "$s" ] && _fmt_epoch "$(stat -c %Y "$s" 2>/dev/null)" || echo "unknown"; }
_salv_trust(){ local s="$1" v="" f="" d
  case "$s" in
    *config.json)
      v="$(python3 -c 'import json,sys;print("yes" if (json.load(open(sys.argv[1])).get("panel") or {}).get("verify",True) else "no")' "$s" 2>/dev/null || true)"
      f="$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("panel") or {}).get("fingerprint") or "")' "$s" 2>/dev/null || true)";;
    "the swg-node container")
      d="$(docker inspect swg-node --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
      v="$(printf '%s\n' "$d" | sed -n 's/^TLS_VERIFY=//p' | sed -n 1p)"; f="$(printf '%s\n' "$d" | sed -n 's/^TLS_FINGERPRINT=//p' | sed -n 1p)"
      d=/opt/swg-panel-docker;;
    *)
      v="$(sed -n 's/^TLS_VERIFY=//p' "$s" 2>/dev/null | sed -n 1p | tr -d '"' || true)"
      f="$(sed -n 's/^TLS_FINGERPRINT=//p' "$s" 2>/dev/null | sed -n 1p | sed 's/[[:space:]]\{1,\}#.*$//' | tr -d '"' || true)"
      d="$(dirname "$s" 2>/dev/null)";;
  esac
  case "$s" in *config.json) ;; *)
    _lv="$(head -n1 "$d/data/node/panel-verify" 2>/dev/null | tr -d '[:space:]' || true)"; [ -n "$_lv" ] && v="$_lv"
    _lf="$(head -n1 "$d/data/node/panel-fp" 2>/dev/null | tr -d '[:space:]' || true)"; [ -n "$_lf" ] && f="$_lf"
    [ "$_lv" = yes ] && [ -z "$_lf" ] && f="";; esac
  [ "$v" = yes ] || v=no
  printf '%s %s\n' "$v" "$(printf '%s' "$f" | tr -cd '0-9A-Fa-f:')"; }
# _salv_learned <docker dir> — what that Docker node LEARNED about its panel overrides the $_t / $_u just read from its
# .env (or its container's environment): data/node/panel-token and panel-url, as docker/node-entrypoint.sh reads them.
_salv_learned(){ local _x
  _x="$(head -n1 "$1/data/node/panel-token" 2>/dev/null | tr -d '[:space:]' || true)"; [ -n "$_x" ] && _t="$_x"
  _x="$(head -n1 "$1/data/node/panel-url" 2>/dev/null | tr -d '[:space:]' || true)";   [ -n "$_x" ] && _u="$_x"
  return 0; }
_salv_block(){ local idx="$1" tok="$2" url="$3" src="$4" method dir ifaces turns name last wj ls _sv _sf
  case "$src" in
    *config.json) method="Bare-metal"; dir="/etc/swg-agent";;
    "the swg-node container") method="Docker"; dir="/opt/swg-panel-docker";;
    *) method="Docker"; dir="$(dirname "$src" 2>/dev/null)";; esac
  if [ "$method" = Docker ]; then
    ifaces="$(ls "$dir/data/node-confs"/*.conf 2>/dev/null | while read -r c; do basename "$c" .conf; done | tr '\n' ' ' || true)"   # empty node-confs → ls exits non-zero; don't let pipefail+set-e abort recovery listing
    turns="$(python3 -c 'import json,sys;print(len((json.load(open(sys.argv[1])).get("turn_proxies") or [])))' "$dir/data/node/turn-proxy.json" 2>/dev/null || echo '?')"
  else
    ifaces="$(python3 -c 'import json;print(" ".join((json.load(open("/etc/swg-agent/config.json")).get("interfaces") or {}).keys()))' 2>/dev/null || true)"; turns="?"
  fi
  name=""; last=""
  # …asked WITH THE TRUST THAT IDENTITY HAD (its pin, or its CA) — a salvaged token is still a live credential, and a
  # curl -k sent it to whatever now answers at the address it last knew. No answer = the same "unknown" as before.
  if [ -n "$url" ] && command -v python3 >/dev/null 2>&1; then
    read -r _sv _sf <<< "$(_salv_trust "$src")"
    wj="$(SWG_TOK="$tok" panel_req GET "${url%/}/api/node/whoami" "${_sv:-no}" "${_sf:-}" 6 2>/dev/null || true)"
    name="$(printf '%s' "$wj" | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p')"
    ls="$(printf '%s' "$wj" | sed -n 's/.*"last_seen": *\([0-9][0-9]*\).*/\1/p')"; [ -n "$ls" ] && last="$(_fmt_epoch "$ls")"
  fi
  echo "  [$idx]  $(b "$method node${name:+ $name}")"
  echo "           Panel URL:     ${url:-unknown}"
  # the token is a live credential, and this menu is printed on unattended runs too (their logs keep it): shown only as
  # much as tells two identities apart (1.8.8 qualification, round 8)
  echo "           Token:         $([ "${#tok}" -gt 12 ] && printf '%s…%s' "${tok:0:6}" "${tok: -4}" || printf '%s' '(hidden)')"
  echo "           Configs path:  $dir/"
  echo "           Interfaces:    ${ifaces:-none}"
  echo "           Turn-proxies:  ${turns:-0}"
  echo "           Created:       $(_salv_created "$src")"
  echo "           Last online:   ${last:-unknown (no answer from panel)}"
  echo
}
if [ "$ROLE" = node ] && [ -z "${NODE_TOKEN:-}" ] && { [ "$_have_live_token" = no ] || [ "${SWG_RECOVER_MENU:-}" = 1 ]; }; then
  _salvf="$(mktemp 2>/dev/null || echo "/tmp/swg-salv.$$")"; : > "$_salvf"
  if command -v docker >/dev/null 2>&1; then
    _env="$(docker inspect swg-node --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
    _t="$(printf '%s\n' "$_env" | sed -n 's/^NODE_TOKEN=//p' | sed -n 1p)"; _u="$(printf '%s\n' "$_env" | sed -n 's/^PANEL_URL=//p' | sed -n 1p)"
    _salv_learned /opt/swg-panel-docker
    [ -n "$_t" ] && printf '%s\t%s\t%s\n' "$_t" "$_u" "the swg-node container" >> "$_salvf"
  fi
  for _f in /opt/swg-panel-docker/.env $(ls -dt /opt/swg-panel-docker.converted-*/.env /opt/swg-panel-docker.uninstalled-*/.env 2>/dev/null || true); do
    [ -f "$_f" ] || continue
    _t="$(sed -n 's/^NODE_TOKEN=//p' "$_f" | sed -n 1p | tr -d '"')"; _u="$(sed -n 's/^PANEL_URL=//p' "$_f" | sed -n 1p | tr -d '"')"
    [ -n "$_t" ] && [ "$_t" != "set-in-nodes-screen" ] || continue
    _salv_learned "$(dirname "$_f")"
    printf '%s\t%s\t%s\n' "$_t" "$_u" "$_f" >> "$_salvf"
  done
  if [ -f /etc/swg-agent/config.json ] && command -v python3 >/dev/null 2>&1; then
    python3 - >> "$_salvf" 2>/dev/null <<'PY' || true
import json
try:
    d=(json.load(open("/etc/swg-agent/config.json")).get("panel") or {})
    if d.get("token"): print(d["token"]+"\t"+(d.get("url") or "")+"\t/etc/swg-agent/config.json")
except Exception: pass
PY
  fi
  # dedup by token (a node keeps its token across converts, so repeated backups collapse to ONE identity)
  _uniq="$(awk -F'\t' '$1 && !seen[$1]++' "$_salvf" 2>/dev/null || true)"; rm -f "$_salvf"
  _ntok="$(printf '%s\n' "$_uniq" | grep -c . 2>/dev/null || true)"; _ntok="${_ntok:-0}"
  salv_tok=""; salv_url=""; salv_src=""
  if [ "$_ntok" = 1 ]; then
    salv_tok="$(printf '%s' "$_uniq" | cut -f1)"; salv_url="$(printf '%s' "$_uniq" | cut -f2)"; salv_src="$(printf '%s' "$_uniq" | cut -f3-)"
    echo
    warn "Found a leftover identity for a node that used to live on this box — its live config is gone, but the token survives in a backup (an install or conversion that didn't finish)."
    echo
    _salv_block 1 "$salv_tok" "$salv_url" "$(printf '%s' "$_uniq" | cut -f3-)"
    info "  Re-enroll → this box rejoins the panel as the SAME node: same token, and its existing peers re-sync onto it."
    info "  Skip      → set this box up as a NEW node instead; you'll supply a token yourself (panel → Nodes, or pass -key)."
    _sa=yes; ask_yn "Re-enroll as this node" y _sa
    [ "$_sa" = yes ] || salv_tok=""
  elif [ "$_ntok" != 0 ]; then
    echo
    warn "Found $_ntok leftover node identities on this box (from past converts / re-installs) — their live configs are gone but the tokens survive in backups. Pick which to re-enroll as (or skip for a new node):"
    echo
    _i=0
    while IFS="$(printf '\t')" read -r _t _u _s; do [ -n "$_t" ] || continue; _i=$((_i+1)); _salv_block "$_i" "$_t" "$_u" "$_s"; done <<EOF2
$_uniq
EOF2
    printf "  Number to re-enroll with (or $(b Enter) to skip and set up a new node — you supply a token, panel → Nodes or -key): "; _pick=""; read -r _pick 2>/dev/null <"${SWG_TTY:-/dev/tty}" || { _pick=""; echo "(no terminal — skipped)"; }
    if printf '%s' "$_pick" | grep -cE '^[0-9]+$' >/dev/null; then
      _line="$(printf '%s\n' "$_uniq" | sed -n "${_pick}p" 2>/dev/null || true)"
      salv_tok="$(printf '%s' "$_line" | cut -f1)"; salv_url="$(printf '%s' "$_line" | cut -f2)"; salv_src="$(printf '%s' "$_line" | cut -f3-)"
    fi
  fi
  if [ -n "$salv_tok" ]; then
    NODE_TOKEN="$salv_tok"; export NODE_TOKEN; [ -n "$salv_url" ] && { PANEL_URL="$salv_url"; export PANEL_URL; }
    case "${salv_src:-}" in *config.json) METHOD=baremetal;; *) METHOD=docker;; esac   # route to the installer matching the RECOVERED identity (docker vs bare), so recovery works regardless of the command used
    _rdir="$(dirname "${salv_src:-/dev/null}" 2>/dev/null)"
    if [ "$METHOD" = docker ] && [ -d "$_rdir/data/node-confs" ]; then
      _lc=/opt/swg-panel-docker/data/node-confs
      _npr="$(grep -ch '^\[Peer\]' "$_rdir/data/node-confs/"*.conf 2>/dev/null | awk '{s+=$1} END{print s+0}' || true)"   # peerless/empty confs → grep exits non-zero; awk still prints 0, just neutralise pipefail+set-e
      if ls "$_lc"/*.conf >/dev/null 2>&1; then
        _npl="$(grep -ch '^\[Peer\]' "$_lc/"*.conf 2>/dev/null | awk '{s+=$1} END{print s+0}' || true)"   # peerless confs → grep exits non-zero; awk still prints 0, just neutralise pipefail+set-e
        echo
        info "This box already has $(b "$_npl peer(s)") from a previous install. The recovery snapshot you picked has $(b "$_npr peer(s)")."
        _ovw=no; ask_yn "  Replace this box's $_npl peer(s) with the $_npr from the snapshot?" n _ovw
        echo
        if [ "$_ovw" = yes ]; then
          rm -rf "$_lc"; mkdir -p "$_lc"; cp -a "$_rdir/data/node-confs/." "$_lc/" 2>/dev/null && info "using the $_npr peer(s) from the snapshot."
        else
          info "keeping this box's $_npl peer(s)."
        fi
      else
        # nothing live (data dir was deleted on uninstall — case 3): restore the keys so peers keep their configs
        mkdir -p "$_lc"; cp -a "$_rdir/data/node-confs/." "$_lc/" 2>/dev/null \
          && info "restored the node's interface keys from the recovery snapshot — peers keep their existing configs."
      fi
    fi
    if [ "$METHOD" = docker ] && [ -f "$_rdir/data/node/turn-proxy.json" ] && [ ! -f /opt/swg-panel-docker/data/node/turn-proxy.json ]; then
      mkdir -p /opt/swg-panel-docker/data/node                                       # bring back the turn-proxies too
      cp -a "$_rdir/data/node/turn-proxy.json" /opt/swg-panel-docker/data/node/turn-proxy.json 2>/dev/null \
        && info "restored the node's turn-proxies from the recovery snapshot."
    fi
    info "re-enrolling this box as the recovered node (token reused — its peers re-sync onto it)."
  fi
fi

case "$METHOD-$ROLE" in
  baremetal-master|baremetal-host) export ROLE; SCRIPT="install-host.sh" ;;
  baremetal-node)                  unset ROLE; SCRIPT="install-node.sh" ;;
  docker-master)  export ROLE=master; SCRIPT="install-docker.sh"; PASS=(master ${PASS[@]+"${PASS[@]}"}) ;;
  docker-host)    export ROLE=host;   SCRIPT="install-docker.sh"; PASS=(host   ${PASS[@]+"${PASS[@]}"}) ;;
  docker-node)    unset ROLE;         SCRIPT="install-docker.sh"; PASS=(node   ${PASS[@]+"${PASS[@]}"}) ;;
  *) die "unknown method/role: '$METHOD' / '$ROLE'" ;;
esac
info "running $SCRIPT"
run_script "$SCRIPT" ${PASS[@]+"${PASS[@]}"}
}   # the end of the brace group opened at the top: reaching this line is how bash knows the download is whole
