#!/usr/bin/env bash
# Локальное обновление установленных компонентов. См. docs/operations.md.
set -euo pipefail

DRYRUN=false; ASSUME_YES=false; FORCE=false; NO_COMPONENTS=false; NODE_ONLY=false
for a in "$@"; do case "$a" in
  --dry-run) DRYRUN=true;; -y|--yes) ASSUME_YES=true;; -f|--force) FORCE=true;;
  --no-components) NO_COMPONENTS=true;;
  --node-only) NODE_ONLY=true;;     # update ONLY the bare-metal node/agent — never the co-located panel/docker
esac; done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"
SRC="$REPO/src"
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

# one update at a time
UPD_LOCK=/run/swg-update.lock; UPD_RUNNING=/run/swg-update.running
# NB: `have` is defined further down — this runs before it, so test flock directly.
if ! $DRYRUN && command -v flock >/dev/null 2>&1; then
  ( : > "$UPD_LOCK" ) 2>/dev/null || UPD_LOCK=/tmp/swg-update.lock
  exec 9>"$UPD_LOCK"
  if ! flock -n 9; then
    echo "swg update: another update is already running on this host — leaving it to finish."
    exit 0
  fi
  ( umask 022; echo $$ > "$UPD_RUNNING" ) 2>/dev/null || true
  trap 'rm -f "$UPD_RUNNING" 2>/dev/null || true' EXIT
fi

PANEL_DIR="${PANEL_DIR:-/opt/swg-panel}"
SUB_DIR="${SUB_DIR:-/opt/swg-sub}"
AGENT_DIR="${AGENT_DIR:-/opt/swg-agent}"
NODED_DIR="${NODED_DIR:-/opt/swg-noded}"
DOCKER_DIR="${SWG_DOCKER_DIR:-/opt/swg-panel-docker}"
NODED_UNIT="${NODED_UNIT:-/etc/systemd/system/swg-noded.service}"

# colours FIRST — must be detected on the real tty BEFORE lc_init's tee redirect makes stdout a pipe (else
# [ -t 1 ] is false and the whole run prints uncoloured). The helper fns below resolve these vars at call time.
if { [ -t 1 ] || [ -n "${SWG_FORCE_COLOR:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then BOLD=$'\033[1m'; RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[38;5;39m'; C_BL=$'\033[38;5;33m'; C_BROWN=$'\033[38;5;130m'
else BOLD=""; RESET=""; C_CYAN=""; C_GREEN=""; C_YEL=""; C_RED=""; C_BLUE=""; C_BL=""; C_BROWN=""; fi

. "$SCRIPT_DIR/lib/common.sh"   # lc_* lifecycle helpers (shared with the installers)
# Refuse on a declaratively managed host BEFORE anything is written — an in-place update laid down here would
# be invisible to the host's own tooling. Defined in lib/common.sh, above; a `--dry-run` still runs.
refuse_on_declarative_host 'services.swg-node = { enable = true; ... };'
# signal "updating" → updated / aborted / failed for whichever this box is: a node (POST via its agent
# config) and/or a panel host (host_proc file). Best-effort; armed only when there's something to tell.
lc_emit_upd(){ [ -n "${LC_FILE:-}" ] && lc_emit_file "$1" "${2:-}"; [ -n "${LC_TOKEN:-}" ] && [ -n "${LC_URL:-}" ] && lc_emit_post "$1" "${2:-}"; return 0; }
lc_targets(){
  if ! $NODE_ONLY; then
    if [ -f "$PANEL_DIR/swg-panel-server" ] && [ -d /var/lib/swg-panel ] && ! bare_panel_parked; then
      LC_FILE=/var/lib/swg-panel/host_proc
    elif [ -d "$DOCKER_DIR/data/lib" ] && docker_panel_live; then
      LC_FILE="$DOCKER_DIR/data/lib/host_proc"
    fi
  fi
  if [ -f /etc/swg-agent/config.json ]; then
    LC_URL="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("url",""))' 2>/dev/null || true)"
    LC_TOKEN="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("token",""))' 2>/dev/null || true)"
    LC_VERIFY="$(python3 -c 'import json;print("yes" if (json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("verify",True) else "no")' 2>/dev/null || echo no)"
    # …AND ITS PIN. The status went out with curl -k whenever verify was off — on every pinned node, so to whatever answered
    # at the panel's address (1.8.8 qualification, round 6). panel_req checks the panel with it on the same connection.
    LC_FP="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("fingerprint") or "")' 2>/dev/null || true)"
  elif [ -f "$DOCKER_DIR/.env" ] && command -v docker >/dev/null 2>&1 \
       && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; then
    # docker deployment: the node token/URL/trust live in .env and what the node learned since (the agent config is
    # inside the container) — docker_node_panel reads them as the node's entrypoint does
    docker_node_panel "$DOCKER_DIR"
    LC_TOKEN="$DNP_TOKEN"; [ "$LC_TOKEN" = set-in-nodes-screen ] && LC_TOKEN=""
    LC_URL="$DNP_URL"; LC_VERIFY="$DNP_VERIFY"; LC_FP="$DNP_FP"
    case "$LC_URL" in *//swg-panel|*//swg-panel/*|*//swg-panel:*)   # master: swg-panel isn't resolvable from the host → loopback
      LC_URL="$(printf '%s' "$LC_URL" | sed -E "s#^(https?://)[^/]+#\1127.0.0.1:$(sed -n 's/^PANEL_PORT=//p' "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p | tr -d '"')#")"; LC_VERIFY=no; LC_FP="" ;; esac
  fi
  return 0; }
if ! $DRYRUN; then
  lc_targets
  { [ -n "${LC_FILE:-}" ] || [ -n "${LC_TOKEN:-}" ]; } && lc_init update lc_emit_upd
fi

info(){ echo "${C_BLUE}▸${RESET} ${BOLD}$*${RESET}"; }   # ▸ light-blue, bold (universal action flag)
sub(){  echo "${C_BL}::${RESET} $*"; }                    # :: blue sub-item / progress detail
ok(){   echo "${C_GREEN}✓${RESET} $*"; }
warn(){ echo "${C_BROWN}!${RESET} $*" >&2; }
die(){  echo "${C_RED}✗ $*${RESET}" >&2; exit 1; }
have(){ command -v "$1" >/dev/null 2>&1; }
run(){ if $DRYRUN; then echo "    [skip] $*"; else "$@"; fi; }
stamp(){ $DRYRUN || printf '%s\n' "$NEW_VER" > "$1/VERSION" 2>/dev/null || true; }
oldver(){ cat "$1/VERSION" 2>/dev/null || echo '?'; }
docker_ver(){ local c="$1" path="$2" v=""
  have docker && v="$(docker exec "$c" cat "$path" 2>/dev/null | sed -n 1p | tr -d '[:space:]' || true)"
  if [ -z "$v" ] && have docker; then
    v="$(docker cp "$c:$path" - 2>/dev/null | tar -xOf - 2>/dev/null | sed -n 1p | tr -d '[:space:]' || true)"; fi
  [ -n "$v" ] || v="$(oldver "$DOCKER_DIR")"
  printf '%s' "${v:-?}"; }
# header line showing the installed version vs the latest, so it's clear whether an update is needed
ver_line(){ local label="$1" cur="$2"
  if [ -z "$cur" ] || [ "$cur" = "?" ]; then info "$label — latest is version $(col_v "$NEW_VER")"
  elif [ "$cur" = "$NEW_VER" ];          then info "$label — version $(col_v "$cur") ${C_GREEN}(up to date)${RESET}"
  else                                        info "$label — $(col_v "$cur") → $(col_v "$NEW_VER") ${C_BROWN}(update available)${RESET}"; fi; }
confirm(){ # confirm <prompt> -> 0 yes / 1 no.  --yes or no terminal => yes (you ran update on purpose)
  $ASSUME_YES && return 0
  local v
  swg_tty_ok || return 0   # cannot be read (no terminal, or sudo-rs's background): yes, as said — no prompt left hanging
  if printf '  %s %s: ' "$1" "${C_BL}(Y/n)${RESET}" 2>/dev/null >/dev/tty && IFS= read -r v 2>/dev/null <"${SWG_TTY:-/dev/tty}"; then
    case "$v" in [Nn]*) return 1;; *) return 0;; esac
  else return 0; fi
}
# should_update <label> <dir> -> 0 proceed / 1 skip (prints up-to-date or skipped)
should_update(){ local label="$1" dir="$2" old; old="$(oldver "$dir")"
  if [ "$old" = "$NEW_VER" ] && ! $FORCE; then ok "$(col_l "$label"): already up to date ($NEW_VER)"; return 1; fi
  echo   # blank line before the y/n prompt
  if confirm "Upgrade $(col_l "$label") $(col_v "$old → $NEW_VER")?"; then DID_UPDATE=yes; return 0; fi
  warn "$label: skipped (still $old)"; return 1; }
col_l(){ printf '%s%s%s' "$BOLD" "$*" "$RESET"; }
col_v(){ printf '%s%s%s' "$C_BLUE" "$*" "$RESET"; }
# ── OS package check/update (apt — the scripts install wg/amneziawg via apt + the amnezia PPA, docker via
#    get.docker.com's apt repo). Version check is automatic; the upgrade itself asks y/n (empty line first). ──
APT_DONE=no
apt_refresh(){ [ "$APT_DONE" = yes ] && return 0; APT_DONE=yes; have apt-get && run apt-get update -qq 2>/dev/null || true; }
pkg_installed(){ dpkg-query -W -f='${Version}' "$1" 2>/dev/null | sed -n 1p; }   # installed version, or empty
pkg_candidate(){ LC_ALL=C apt-cache policy "$1" 2>/dev/null | sed -n 's/^[[:space:]]*Candidate:[[:space:]]*//p' | sed -n 1p; }   # C: apt translates "Candidate:" ("Кандидат:" under ru_RU)
first_pkg(){ local p; for p in "$@"; do [ -n "$(pkg_installed "$p")" ] && { echo "$p"; return 0; }; done; return 1; }
# pkg_update <label> <pkg…> : auto-check the first installed pkg; prompt y/n only if a newer candidate exists
pkg_update(){ local label="$1"; shift; local pkg cur cand
  pkg="$(first_pkg "$@")" || return 0                     # none installed → nothing to do
  cur="$(pkg_installed "$pkg")"
  have apt-get || { ok "$(col_l "$label") ($pkg): $cur — manage with your package manager"; return 0; }
  [ "$APT_DONE" = yes ] || sub "refreshing the package index to check $(col_l "$label") ($pkg)…"   # apt-get update is slow + silent — say so
  apt_refresh; cand="$(pkg_candidate "$pkg")"
  if [ -z "$cand" ] || [ "$cand" = "$cur" ] || [ "$cand" = "(none)" ]; then ok "$(col_l "$label") ($pkg): already up to date ($cur)"; return 0; fi
  echo
  if confirm "Upgrade $(col_l "$label") ($pkg) $(col_v "$cur → $cand")?"; then
    info "updating $label ($pkg)"
    if run apt-get install -y --only-upgrade "$pkg"; then DID_UPDATE=yes; ok "$label updated ($cand)"; note "$label: ${cur} → ${cand}"
    else DID_FAIL=yes; warn "$label: upgrade failed"; note "$label: upgrade FAILED"; fi
  else warn "$label: skipped (still $cur)"; note "$label: unchanged ($cur)"; fi; }

NEW_VER="$(cat "$REPO/VERSION" 2>/dev/null || echo unknown)"
[ "$(id -u)" = 0 ] || $DRYRUN || die "run as root (or use --dry-run)"
# DID_FAIL flips to yes on ANY component failure → partial-failure status + exit 1; AWG_PKG_ROUTE: ensure_awg_pkg_follow owns
# the amnezia packages here (the datapath summary line says they follow the PPA, not that they were skipped)
found=0; DID_UPDATE=no; DID_FAIL=no; AWG_PKG_ROUTE=no
# per-component outcome, printed as a summary at the end — so a multi-component box (e.g. a docker
# master AND a bare-metal node on the same host) clearly shows EVERY component was considered.
RESULTS=(); note(){ RESULTS+=("$*"); }
pan_seen=no; nod_seen=no; doc_seen=no

_DSTACK=""            # "" not asked yet · yes · no
docker_stack_live(){
  [ -d "$DOCKER_DIR" ] && [ -f "$DOCKER_DIR/docker-compose.yml" ] || return 1
  case "$_DSTACK" in yes) return 0;; no) return 1;; esac
  if ! have docker || ! docker info >/dev/null 2>&1; then _DSTACK=yes; return 0; fi   # cannot tell → unchanged
  local _n
  for _n in $(docker ps -a --format '{{.Names}}|{{.State}}' 2>/dev/null \
               | grep -E '^(swg-panel|swg-node|swg-sub)\|' | grep -v '|created$' | cut -d'|' -f1); do
    docker_parked "$_n" || { _DSTACK=yes; return 0; }
  done
  if [ ! -f "$PANEL_DIR/swg-panel-server" ] && [ ! -f "$NODED_DIR/swg-noded" ] && [ ! -f "$AGENT_DIR/swg-agent" ]; then
    _DSTACK=yes; return 0          # nothing else is installed here — this IS the install, bring it back up
  fi
  _DSTACK=no
  warn "$(b "$DOCKER_DIR") has a docker-compose.yml but no containers, and this box has a bare-metal
       install — treating the directory as a leftover from an earlier convert/uninstall and updating what
       is actually installed instead.
       If that is wrong, start the stack ($(b "cd $DOCKER_DIR && docker compose up -d")) and re-run;
       if it is right, the directory is safe to move aside or delete."
  return 1
}

docker_ports_preflight(){                     # $1 = profile → 0 = clear/undetermined, 1 = held by something else
  local prof="$1" cfg ours rc
  have docker || return 0
  cfg="$(cd "$DOCKER_DIR" 2>/dev/null && $COMPOSE --profile "$prof" config --format json 2>/dev/null)" || cfg=""
  case "$cfg" in *'"services"'*) ;; *)
    note "docker ($prof): port pre-flight skipped — this compose cannot render its config as JSON"
    return 0 ;; esac
  local _cf _pf; _cf="$(mktemp)" || return 0; _pf="$(mktemp)" || { rm -f "$_cf"; return 0; }
  printf '%s' "$cfg" > "$_cf"
  # A port our OWN container publishes right now is not a conflict — the recreate releases it first.
  ours="$(docker ps --format '{{.Ports}}' 2>/dev/null || true)"
  OURS="$ours" python3 - "$_cf" >"$_pf" 2>/dev/null <<'PYPORT'
import json, os, re, subprocess, sys
try:
    cfg = json.load(open(sys.argv[1]))
    mine = set(re.findall(r"(\d+)->", os.environ.get("OURS", "")))   # host ports our own containers publish now
    bad = []
    for name, svc in sorted((cfg.get("services") or {}).items()):
        for p in (svc.get("ports") or []):
            pub = str(p.get("published") or "").split("-")[0]        # a range publishes from its first port
            if not pub.isdigit() or pub in mine:
                continue
            # -p so the message can NAME the holder ("held by nginx"), which is the only actionable half of
            # it. Needs root, which an update is; without it `users:((…))` is simply absent and the fallback
            # wording stands, so this degrades rather than failing.
            r = subprocess.run(["ss", "-lntpH", "sport = :" + pub], capture_output=True)
            holder = (r.stdout or b"").decode("utf-8", "replace").strip()
            if holder:
                who = re.search(r'users:\(\("([^"]+)"', holder)
                bad.append((name, (p.get("host_ip") or "0.0.0.0") + ":" + pub,
                            who.group(1) if who else "another process"))
except Exception:
    sys.exit(4)                                                      # could not determine — NOT the same as clear
for row in bad:
    print("\t".join(row))
sys.exit(3 if bad else 0)
PYPORT
  rc=$?
  rm -f "$_cf"
  case "$rc" in
    0) rm -f "$_pf"; return 0 ;;
    3) ;;
    *) rm -f "$_pf"
       note "docker ($prof): port pre-flight could not run (exit $rc) — proceeding unchecked"
       warn "could not pre-flight the published ports (the checker exited $rc) — continuing, but if the
       recreate fails to bind, that is why."
       return 0 ;;
  esac
  warn "REFUSING the docker recreate — a published port is already held by something else on this host:"
  local _svc _addr _who
  while IFS="$(printf '\t')" read -r _svc _addr _who; do
    [ -n "$_addr" ] || continue
    printf '       %s wants %s, held by %s\n' "$(b "$_svc")" "$(b "$_addr")" "$(b "$_who")" >&2
  done < "$_pf"
  rm -f "$_pf"
  warn "The containers are still running on the old image — nothing was touched. Free that port, or set the
       right one in $(b "$DOCKER_DIR/.env") — note a BLANK value there means 443 to compose, not \"unset\" —
       then re-run the update."
  return 1
}
docker_images_current(){                      # $1 = profile
  local prof="$1" cfg _cf rc
  have docker && have python3 || return 2
  cfg="$(cd "$DOCKER_DIR" 2>/dev/null && $COMPOSE --profile "$prof" config --format json 2>/dev/null)" || return 2
  case "$cfg" in *'"services"'*) ;; *) return 2 ;; esac
  _cf="$(mktemp)" || return 2
  printf '%s' "$cfg" > "$_cf"
  python3 - "$_cf" >/dev/null 2>&1 <<'PYIMG'
import json, subprocess, sys
def out(*argv):
    r = subprocess.run(list(argv), capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""
try:
    svcs = json.load(open(sys.argv[1])).get("services") or {}
    if not svcs:
        sys.exit(2)
    for name, svc in svcs.items():
        ref = svc.get("image")
        if not ref:                                   # a build: service — the full path owns it
            sys.exit(1)
        want = out("docker", "image", "inspect", "-f", "{{.Id}}", ref)
        have = out("docker", "inspect", "-f", "{{.Image}} {{.State.Running}}", svc.get("container_name") or name)
        if not want or have != want + " true":        # a stopped, missing or older container is work to do
            sys.exit(1)
except SystemExit:
    raise
except Exception:
    sys.exit(2)
sys.exit(0)
PYIMG
  rc=$?
  rm -f "$_cf"
  return $rc
}
docker_profile(){
  local names sniff="" mark
  if have docker; then
    names="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
    case "$names" in
      *swg-panel*) case "$names" in *swg-node*) sniff=master;; *) sniff=host;; esac;;
      *swg-node*)  sniff=node;;
    esac
  fi
  mark="$(sed -n 's/^# .*profile: *//p' "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p || true)"
  [ "$mark" = host-node ] && mark=master        # legacy alias, same stack
  if [ -n "$sniff" ]; then
    [ -n "$mark" ] && [ "$mark" != "$sniff" ] && \
      warn "the .env profile marker says '$mark', but this box is running the '$sniff' stack — going with '$sniff'"
    printf '%s' "$sniff"; return 0
  fi
  printf '%s' "${mark:-host}"; return 0; }

# ── detect this box's shape (method × role) → title + which checks to run ──
HAVE_BPAN=no; { ! $NODE_ONLY && [ -f "$PANEL_DIR/swg-panel-server" ]; } && HAVE_BPAN=yes
HAVE_BNODE=no; { [ -f "$NODED_DIR/swg-noded" ] || [ -f "$AGENT_DIR/swg-agent" ]; } && HAVE_BNODE=yes
HAVE_DOCK=no; DOCK_PROF=""
if ! $NODE_ONLY && docker_stack_live; then
  HAVE_DOCK=yes
  DOCK_PROF="$(docker_profile)"
fi
if [ "$HAVE_DOCK" = yes ]; then case "$DOCK_PROF" in master) _role=MASTER;; node) _role=NODE;; *) _role=HOST;; esac; TITLE="SWG DOCKER $_role UPDATE"
elif [ "$HAVE_BPAN" = yes ] && [ "$HAVE_BNODE" = yes ]; then TITLE="SWG BARE-METAL MASTER UPDATE"
elif [ "$HAVE_BPAN" = yes ]; then TITLE="SWG BARE-METAL PANEL UPDATE"
elif [ "$HAVE_BNODE" = yes ]; then TITLE="SWG BARE-METAL NODE UPDATE"
else TITLE="SWG UPDATE"; fi
# roles present (bare OR docker) → the "latest is version" header lines for swg components
_haspanel=no; { [ "$HAVE_BPAN" = yes ] || { [ "$HAVE_DOCK" = yes ] && [ "$DOCK_PROF" != node ]; }; } && _haspanel=yes
_hasnode=no;  { [ "$HAVE_BNODE" = yes ] || { [ "$HAVE_DOCK" = yes ] && [ "$DOCK_PROF" != host ]; }; } && _hasnode=yes
echo; info "$TITLE"
if $DRYRUN; then info "DRY RUN — nothing will change."; else seal_archives; fi   # recovery archives: root's alone (lib/common.sh, F90)
echo
# Panel-host heal: a low-RAM / zero-swap box OOM-kills the panel on a list-resolve spike. Ensure swap exists (host-level
# — a bare-metal panel and a docker panel both use host memory). Only where a panel lives; a node never resolves.
if [ "$_haspanel" = yes ]; then ensure_swap; fi
# current installed version per component (bare-metal reads its VERSION file; docker falls back to the staged
# $DOCKER_DIR/VERSION, '?' when unknown → just shows the latest)
_pcur="?"; if [ "$HAVE_BPAN" = yes ]; then _pcur="$(oldver "$PANEL_DIR")"; elif [ "$HAVE_DOCK" = yes ]; then _pcur="$(docker_ver swg-panel /opt/swg-panel/VERSION)"; fi
_ncur="?"; if [ "$HAVE_BNODE" = yes ]; then _ncur="$(oldver "$NODED_DIR")"; elif [ "$HAVE_DOCK" = yes ]; then _ncur="$(docker_ver swg-node /opt/swg-noded/VERSION)"; fi
[ "$_haspanel" = yes ] && ver_line "swg-panel" "$_pcur"
[ "$_hasnode" = yes ]  && ver_line "swg-node" "$_ncur"
true   # don't let the above &&-tests leave a non-zero status for `set -e`

# Auto-clear an inert leftover that an aborted conversion to the OTHER method left behind (no prompt — it's
# just an outdated copy). The helper's guards never touch a live install or an unrelated WireGuard config.
if ! $DRYRUN; then
  if   [ "$HAVE_DOCK" = yes ]; then                               lc_clear_convert_leftover docker    "$DOCKER_DIR"
  elif [ "$HAVE_BNODE" = yes ] || [ "$HAVE_BPAN" = yes ]; then    lc_clear_convert_leftover baremetal "$DOCKER_DIR"; fi
fi

install_update_unit(){   # idempotent: wire one-click host self-update for an existing bare-metal panel.
  local st="${STATE_DIR:-/var/lib/swg-panel}" usr="${PANEL_USER:-swgpanel}" trig
  trig="${st}/.update-request"
  if $DRYRUN; then echo "    [skip] install /usr/local/bin/swg-update{,-check} + swg-update.{service,timer} + trigger drop-in"; return 0; fi
  _swg_ref="${SWG_REF:-main}"
  swg_update_wrapper_text "$_swg_ref" > /usr/local/bin/swg-update.new   # the one text (lib/common.sh)
  chmod 755 /usr/local/bin/swg-update.new
  mv -f /usr/local/bin/swg-update.new /usr/local/bin/swg-update   # see the rename note above — NEVER `cat >`
  swg_update_check_text > /usr/local/bin/swg-update-check   # the one text (lib/common.sh)
  chmod 755 /usr/local/bin/swg-update-check
  cat > /etc/systemd/system/swg-update.service <<EOF
[Unit]
Description=swg-panel one-click self-update (swg programs only)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/swg-update-check
EOF
  cat > /etc/systemd/system/swg-update.timer <<EOF
[Unit]
Description=poll for a swg one-click update request

[Timer]
OnActiveSec=30s
OnUnitActiveSec=30s

[Install]
WantedBy=timers.target
EOF
  rm -f /etc/systemd/system/swg-update.path   # retire the legacy inotify watch that drove the loop
  [ -e "$trig" ] || : > "$trig"   # create when MISSING — re-writing content would fire a spurious self-update
  chown "$usr:swg" "$trig" 2>/dev/null || true; chmod 660 "$trig" 2>/dev/null || true   # ALWAYS re-assert ownership so the panel can write it even if a convert/older root process left it root-owned
  # point the (already-installed) panel at the trigger via a drop-in — don't edit the main unit
  install -d /etc/systemd/system/swg-panel-server.service.d
  printf '[Service]\nEnvironment=SWG_UPDATE_TRIGGER=%s\n' "$trig" \
    > /etc/systemd/system/swg-panel-server.service.d/zz-swg-update.conf
  touch /var/lib/swg-update.stamp   # stamp AFTER the trigger so THIS update (its trigger is now older) doesn't re-fire
  systemctl daemon-reload
  systemctl disable --now swg-update.path >/dev/null 2>&1 || true
  systemctl enable --quiet --now swg-update.timer >/dev/null 2>&1 || warn "couldn't enable swg-update.timer"
}

ensure_netctl_helper(){   # idempotent: provision the swg-netctl root helper when a bare-metal panel LACKS it.
  [ -f "$SRC/swg-netctl" ] || return 0
  local st="${STATE_DIR:-/var/lib/swg-panel}" etc="${ETC_DIR:-/etc/swg-panel}" usr="${PANEL_USER:-swgpanel}"
  $DRYRUN || netctl_dirs_heal "$st"   # claims/ root's again, the empty untrusted dirs an install left cleared (F96)
  # already complete? (binary + queue dir + both trigger units) → nothing to do; the refresh path keeps it current.
  if [ -f /usr/local/bin/swg-netctl ] && [ -d "$st/netctl/queue" ] \
     && [ -f /etc/systemd/system/swg-netctl.path ] && [ -f /etc/systemd/system/swg-netctl.timer ]; then return 0; fi
  info "provisioning the swg-netctl root helper (missing/incomplete — needed for Access & subscription-address changes)"
  if $DRYRUN; then echo "    [skip] install /usr/local/bin/swg-netctl + ${st}/netctl/{queue,status} + swg-netctl.{service,path,timer}"; return 0; fi
  cp "$SRC/swg-netctl" /usr/local/bin/swg-netctl; chmod 755 /usr/local/bin/swg-netctl
  # queue/ — panel-owned so ONLY the panel can enqueue; status/ — root-written, group-readable by the panel.
  mkdir -p "$st/netctl/queue" "$st/netctl/status"
  chown "$usr:swg" "$st/netctl" "$st/netctl/queue" 2>/dev/null || true; chmod 750 "$st/netctl" "$st/netctl/queue"
  chown root:swg "$st/netctl/status" 2>/dev/null || true; chmod 750 "$st/netctl/status"
  cat > /etc/systemd/system/swg-netctl.service <<EOF
[Unit]
Description=swg-panel privileged network/TLS helper (drains the panel's request queue)
# A single Access apply enqueues several requests in a row; the default 5-starts-per-10s limit trips easily and
# would fail the .path unit permanently. This drainer is MEANT to start frequently, so disable the rate limit.
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/swg-netctl run
Environment=SWG_PANEL_USER=${usr}
Environment=SWG_PANEL_GROUP=swg
Environment=SWG_STATE_DIR=${st}
Environment=SWG_ETC_DIR=${etc}
EOF
  cat > /etc/systemd/system/swg-netctl.path <<EOF
[Unit]
Description=watch for swg-netctl requests from the panel

[Path]
DirectoryNotEmpty=${st}/netctl/queue
Unit=swg-netctl.service

[Install]
WantedBy=paths.target
EOF
  cat > /etc/systemd/system/swg-netctl.timer <<EOF
[Unit]
Description=poll for swg-netctl requests (fallback for the path watch)

[Timer]
OnActiveSec=10s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --quiet --now swg-netctl.path 2>/dev/null || warn "couldn't enable swg-netctl.path"
  systemctl enable --quiet --now swg-netctl.timer 2>/dev/null || warn "couldn't enable swg-netctl.timer"
  DID_UPDATE=yes; note "swg-netctl root helper: provisioned (was missing)"
  ok "swg-netctl root helper provisioned — Access & subscription-address changes will work now"
}

ensure_timer_on_time(){   # <timer unit>
  local t="/etc/systemd/system/$1"
  [ -f "$t" ] && grep -q '^\[Timer\]$' "$t" || return 0
  grep -q '^AccuracySec=' "$t" && return 0
  if $DRYRUN; then echo "    [skip] $1: AccuracySec=1s (its ticks on time)"; return 0; fi
  sed -i '/^\[Timer\]$/a AccuracySec=1s' "$t"
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart "$1" 2>/dev/null || true
  DID_UPDATE=yes; note "$1: ticks on time (AccuracySec=1s)"
}

ensure_netctl_gate(){
  if [ ! -f /etc/systemd/system/swg-netctl.service ]; then   # a dry run: the helper's heal above only said it would write it
    $DRYRUN && [ -f "$SRC/swg-netctl" ] && echo "    [skip] swg-netctl idle gate: /usr/local/bin/swg-netctl-due + swg-netctl.service.d/$SWG_NETCTL_DUE_DROPIN (with the helper)"
    return 0
  fi
  ensure_timer_on_time swg-netctl.timer
  local want; want="$(swg_netctl_due_dropin_text)"
  netctl_gate_current swg-netctl.service "$want" && return 0
  if $DRYRUN; then echo "    [skip] swg-netctl idle gate: /usr/local/bin/swg-netctl-due + swg-netctl.service.d/$SWG_NETCTL_DUE_DROPIN"; return 0; fi
  netctl_gate_heal swg-netctl.service "$want"
  [ "$NETCTL_GATE_CHANGED" = 1 ] && { systemctl daemon-reload 2>/dev/null || true; }
  DID_UPDATE=yes; note "swg-netctl: idle gate written (an idle tick no longer starts the helper)"
}

repark_bare_panel(){
  [ -f /etc/systemd/system/swg-panel-server.service ] && bare_panel_parked || return 0
  local did=""
  if systemctl is-active --quiet swg-panel-server 2>/dev/null; then run systemctl stop swg-panel-server; did=" swg-panel-server"; fi
  if systemctl is-active --quiet swg-sub 2>/dev/null || systemctl is-enabled --quiet swg-sub 2>/dev/null; then
    run systemctl disable --now swg-sub 2>/dev/null || true; did="$did swg-sub"; fi
  [ -n "$did" ] || return 0
  DID_UPDATE=yes; note "bare-metal swg-panel: parked again (stopped:$did)"
  ok "bare-metal panel parked again (stopped:$did) — it is disabled because a docker panel runs on this box, and an older update had started it"
  return 0; }

seed_local_node_ep(){
  local nodes="${2:-${STATE_DIR:-/var/lib/swg-panel}/nodes.json}" cfg="${3:-/etc/swg-agent/config.json}"
  [ -f "$nodes" ] && [ -f "$cfg" ] && have python3 || return 0
  SWG_LOCAL_ADDRS="$(local_addrs)" python3 - "$1" "$nodes" "$cfg" <<'PYSEED' 2>/dev/null || true
import base64, hashlib, hmac, json, os, socket, sys
from urllib.parse import urlparse
mode, np, cp = sys.argv[1:4]
try:
    cfg = json.load(open(cp)); nodes = json.load(open(np))
except Exception:
    sys.exit(0)
pan = cfg.get("panel") or {}
if (urlparse(pan.get("url") or "").hostname or "") not in ("127.0.0.1", "localhost", "::1", "swg-panel"):
    sys.exit(0)                                   # this node syncs to ANOTHER panel — its record is not here
tok = str(pan.get("token") or "")
if not tok or not isinstance(nodes, dict):
    sys.exit(0)
def mine(n):
    if not isinstance(n, dict):
        return False
    ts = n.get("token_sha")
    if ts:
        return hmac.compare_digest(ts, hashlib.sha256(tok.encode()).hexdigest())
    try:
        _a, it, salt, want = (n.get("token_hash") or "").split("$")
        got = base64.b64encode(hashlib.pbkdf2_hmac("sha256", tok.encode(), base64.b64decode(salt), int(it))).decode()
        return hmac.compare_digest(got, want)
    except Exception:
        return False
nid = next((k for k, v in nodes.items() if mine(v)), None)
if nid is None or (nodes[nid].get("endpoint_host") or "").strip():
    sys.exit(0)
cand = str(cfg.get("endpoint_host") or "").strip()
if not cand or cand.startswith("127.") or cand in ("localhost", "::1"):
    sys.exit(0)
for _n, ic in (cfg.get("interfaces") or {}).items():
    if (str((ic or {}).get("endpoint_host") or "").strip() or cand) != cand:
        sys.exit(0)                               # this interface reports its OWN endpoint — the record would override it
local = set(os.environ.get("SWG_LOCAL_ADDRS", "").split())
try:
    res = {ai[4][0] for ai in socket.getaddrinfo(cand, None)}
except Exception:
    sys.exit(0)
if not (res & local):
    sys.exit(0)                                   # not an address of this box (NAT, or a name pointing elsewhere)
if mode == "write":
    st = os.stat(np)
    nodes[nid]["endpoint_host"] = cand
    tmp = np + ".swg-seed.tmp"
    with open(tmp, "w") as f:
        json.dump(nodes, f, indent=2); f.write("\n")
    os.chown(tmp, st.st_uid, st.st_gid); os.chmod(tmp, st.st_mode & 0o7777)
    os.replace(tmp, np)
print(cand)
PYSEED
}
restart_panel_seeding_node_ep(){
  local ep; ep="$(seed_local_node_ep check)"
  if [ -z "$ep" ]; then run systemctl restart swg-panel-server; return; fi
  if $DRYRUN; then echo "    [skip] stop the panel, set its own node's blank endpoint to $ep, start it"; return 0; fi
  systemctl stop swg-panel-server || { run systemctl restart swg-panel-server; return; }
  ep="$(seed_local_node_ep write)"
  [ -n "$ep" ] && { ok "the panel's record of its own node now carries its endpoint $(col_v "$ep") (it was blank)"
                    note "bare-metal swg-panel: its own node's endpoint set to $ep (was blank)"; }
  systemctl start swg-panel-server; }
seed_docker_node_ep(){
  local ep; [ -s "${1:-}" ] || return 0
  ep="$(seed_local_node_ep write "$DOCKER_DIR/data/lib/nodes.json" "$1")"
  [ -n "$ep" ] && { ok "the panel's record of its own node now carries its endpoint $(col_v "$ep") (it was blank)"
                    note "docker: the panel's own node endpoint set to $ep (was blank)"; }
  return 0; }

ensure_sub_server(){   # HEAL (install-if-missing) the swg-sub subscription surface on a bare-metal panel.
  [ -f "$SRC/swg-sub" ] || return 0
  # a PARKED bare panel's swg-sub is parked with it (guard_second_panel) — enabling it would bring it back at boot
  [ -f /etc/systemd/system/swg-panel-server.service ] && bare_panel_parked && return 0
  local st="${STATE_DIR:-/var/lib/swg-panel}" etc="${ETC_DIR:-/etc/swg-panel}" tls="${TLS_DIR:-/etc/swg-panel/tls}"
  local subusr="${SUB_USER:-swgsub}" subport="${SUB_PORT:-8444}" subbind="${SUB_BIND:-0.0.0.0}"
  local unit=/etc/systemd/system/swg-sub.service
  if [ -f "$SUB_DIR/swg-sub" ] && id "$subusr" >/dev/null 2>&1 && [ -f "$unit" ]; then
    if ! $DRYRUN && ! systemctl is-enabled --quiet swg-sub 2>/dev/null && systemctl is-active --quiet swg-sub 2>/dev/null; then
      systemctl enable --quiet swg-sub 2>/dev/null || true
    fi
    return 0
  fi
  info "healing the swg-sub subscription surface (installing missing pieces — needed for Settings → Subscriptions)"
  if $DRYRUN; then echo "    [skip] install whichever is MISSING: user ${subusr} · ${SUB_DIR}/swg-sub · /etc/swg-sub/tls · ${unit} (then enable --now)"; return 0; fi
  # swg-sub's OWN unprivileged user (group swg, read-only) — NOT the panel user. useradd sets home+group, so
  # a freshly-made user needs no follow-up; an existing one we leave exactly as the operator has it.
  id "$subusr" >/dev/null 2>&1 || useradd -r -g swg -d "$SUB_DIR" -s /usr/sbin/nologin "$subusr" 2>/dev/null || true
  if [ ! -f "$SUB_DIR/swg-sub" ]; then    # binary missing → lay down the binary + any missing web assets
    mkdir -p "$SUB_DIR/vendor"
    cp "$SRC/swg-sub" "$SUB_DIR/"; chmod 755 "$SUB_DIR/swg-sub"
    for f in $SUB_WEB; do [ -f "$SUB_DIR/$f" ] || { [ -f "$SRC/$f" ] && cp "$SRC/$f" "$SUB_DIR/"; }; done
    [ -f "$SUB_DIR/vendor/qrcode.js" ] || { [ -f "$SRC/vendor/qrcode.js" ] && cp "$SRC/vendor/qrcode.js" "$SUB_DIR/vendor/"; }
    [ -f "$SUB_DIR/VERSION" ] || stamp "$SUB_DIR"
  fi
  # swg-sub's OWN TLS dir — its cert lives here (never the panel's key). Root writes it, group swg reads.
  [ -d /etc/swg-sub/tls ] || { mkdir -p /etc/swg-sub/tls; chown root:swg /etc/swg-sub/tls 2>/dev/null || true; chmod 750 /etc/swg-sub/tls; }
  if [ ! -f "$unit" ]; then                # unit missing → write it (a separate FILE, so it never disturbs
    local subextra=""                      # the panel's set-listen 10-access drop-in). This is the only
    [ "$subport" -lt 1024 ] 2>/dev/null && subextra="AmbientCapabilities=CAP_NET_BIND_SERVICE
"                                          # thing we CREATE here; host/port below is the pre-reconcile fallback.
  # served as PLAIN HTTP behind the operator's TLS (reverse proxy / Cloudflare) or swg-sub's own cert; it
  # deliberately never reuses the panel's TLS key.
  cat > "$unit" <<EOF
[Unit]
Description=swg-sub subscription surface (public, read-only)
After=network.target

[Service]
Type=simple
User=${subusr}
Group=swg
ExecStart=${SUB_DIR}/swg-sub
Environment=SWG_SUB_FLEET=${etc}/fleet.json
Environment=SWG_SUB_WEB=${SUB_DIR}
Environment=SWG_SUB_HOST=${subbind}
Environment=SWG_SUB_PORT=${subport}
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
InaccessiblePaths=-${etc}/auth -${tls} -${st}/subs/vault.json -${st}/subs/escrow.json -${st}/panel-settings.json -${st}/configs

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
  fi
  systemctl enable --quiet --now swg-sub 2>/dev/null || warn "couldn't enable swg-sub"
  DID_UPDATE=yes; note "swg-sub: healed (was missing pieces)"
  ok "swg-sub subscription surface healed — Settings → Subscriptions will work now"
}

ensure_noded_unit(){   # HEAL (install-if-missing) the swg-noded systemd unit on a bare-metal node.
  [ -f "$SRC/swg-noded" ] || return 0
  [ -f "$NODED_DIR/swg-noded" ] && [ -f /etc/swg-agent/config.json ] || return 0   # a configured bare-metal node
  local unit="$NODED_UNIT"
  if [ -f "$unit" ]; then
    $DRYRUN || systemctl is-enabled --quiet swg-noded 2>/dev/null || systemctl enable --quiet swg-noded 2>/dev/null || true
    return 0
  fi
  info "healing the swg-noded unit (missing — the node isn't managed by systemd and won't sync or survive a reboot)"
  if $DRYRUN; then echo "    [skip] install ${unit} (enable --now — config.json is preserved)"; return 0; fi
  local nname; nname="$(hostname 2>/dev/null || echo node)"   # cosmetic Description only (config.json holds no node name)
  cat > "$unit" <<EOF
[Unit]
Description=swg-noded (HTTPS sync to panel) — ${nname}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODED_DIR}/swg-noded
Environment=SWG_AGENT_CONFIG=/etc/swg-agent/config.json
Environment=SWG_NODED_STATE=/var/lib/swg-noded
Restart=on-failure
RestartSec=3
# ⚠️ NO NoNewPrivileges HERE — mirrors the installers; ensure_noded_no_nnp retires it from units
# written before this. It blocked the AppArmor profile transition wg-quick needs to exec ip/wg.
ProtectSystem=true
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --quiet --now swg-noded 2>/dev/null || warn "couldn't enable swg-noded"
  DID_UPDATE=yes; note "swg-noded unit: healed (was missing)"
  ok "swg-noded unit healed — the node will sync + survive a reboot now"
}

ensure_noded_no_nnp(){   # MIGRATE (retract-one-directive) NoNewPrivileges out of an existing swg-noded unit.
  local unit="$NODED_UNIT"
  [ -f "$unit" ] || return 0
  # ⚠️ A SYMLINK IS NOT OUR UNIT. The installers write a regular file; a link here means something else
  # owns this service, and `sed -i` would quietly replace the link with a file and take it over.
  [ -L "$unit" ] && { warn "$unit is a symlink — something else manages it; remove its NoNewPrivileges= line there."; return 0; }
  grep -q '^NoNewPrivileges=' "$unit" 2>/dev/null || return 0
  if $DRYRUN; then echo "    [skip] drop NoNewPrivileges= from $unit + daemon-reload + restart swg-noded"; return 0; fi
  sed -i '/^NoNewPrivileges=/d' "$unit" || { warn "couldn't edit $unit — remove its NoNewPrivileges= line by hand"; return 0; }
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart swg-noded 2>/dev/null || warn "couldn't restart swg-noded — run: systemctl restart swg-noded"
  ok "swg-noded: NoNewPrivileges retired — it can stop the interface tools executing under a security policy"
}

ensure_awg_datapath(){   # HEAL (install-if-missing) a WORKING AmneziaWG on a bare-metal node/master.
  [ "$HAVE_BNODE" = yes ] || return 0
  local _tools=no _mod=no _hf=0 _rs=0 _bl=no
  have awg && have awg-quick && _tools=yes
  if ! $DRYRUN && awg_compat_patch_installed; then
    DID_UPDATE=yes; awg_dpkg_recover || true
  fi
  if awg_blacklisted; then _bl=yes; else { $DRYRUN || modprobe amneziawg 2>/dev/null; } && _mod=yes; fi
  if awg_go_needs_install && ! $DRYRUN; then   # missing, or one of our earlier pinned builds
    if awg_go_pinned; then DID_UPDATE=yes; ok "AmneziaWG: userspace fallback installed (pinned $AWG_GO_TAG) — a kernel without a module no longer takes awg interfaces down"
    else note "AmneziaWG: the pinned userspace fallback could not be fetched — awg interfaces depend on the kernel module alone"; fi
  fi
  if [ "$_bl" = yes ] && [ "$_tools" = yes ]; then note "AmneziaWG: the kernel module is blacklisted on this box (modprobe.d) — left as it is"; return 0; fi
  if [ "$_tools" = yes ] && [ "$_mod" = yes ] && ! $DRYRUN; then
    # ⚠️ rc is CAPTURED, never read from a bare call: this script runs under `set -e`, and the function returns 10
    # (installed now), 1 (none) and 2 (failed) on perfectly normal paths — a bare call aborted the whole update right here.
    _hf=0; ensure_awg_headers_follow || _hf=$?; case $_hf in 10) DID_UPDATE=yes; ok "AmneziaWG: kernel headers now follow kernel upgrades ($(awg_headers_meta | tr "\n" " " | sed "s/ $//"))$([ -n "$(dkms status amneziawg 2>/dev/null)" ] && echo " — the module is rebuilt when a new kernel arrives")" ;;
      2) note "AmneziaWG: the kernel headers metapackage could not be installed — the next kernel will rely on the userspace fallback (tried again on the next update)" ;;
    esac
    # A module an older installer built with `make install` loads on THIS kernel and exists for no other. Register it
    # with DKMS once — unless the amnezia package can own it (then the package route is the owner, never us).
    if have dkms && [ -z "$(dkms status amneziawg 2>/dev/null)" ] && ! apt-cache show amneziawg-dkms >/dev/null 2>&1; then
      _rs=0; awg_dkms_register_source || _rs=$?
      case $_rs in 0) DID_UPDATE=yes; ok "AmneziaWG: the kernel module is now rebuilt by DKMS whenever a kernel is installed" ;;
        3) note "AmneziaWG: $(awg_tools_old_why) — the module is left as it is; the next kernel will rely on the userspace fallback" ;;
        *) note "AmneziaWG: could not register the kernel module with DKMS — the next kernel will rely on the userspace fallback" ;;
      esac
    fi
    awg_dkms_build_all_kernels
  fi
  [ "$_tools" = yes ] && [ "$_mod" = yes ] && return 0           # already working → done, silent
  $DRYRUN && return 0
  # Built, and refused for its signing key (Secure Boot): the steps, and the userspace datapath — no rebuild changes that.
  # Asked FIRST: an old "did not compile" record beside a module that now builds would answer with the wrong reason.
  if [ "$_tools" = yes ] && awg_mod_key_rejected; then
    awg_key_refused_note
    have amneziawg-go || { ensure_awg_userspace && DID_UPDATE=yes; } || true
    # ⚠️ "userspace" only when there IS one. With no amneziawg-go either, nothing can bring an awg interface up — a FAILED
    # update, as the heal's own last branch says it (and 1.8.8 did here); "userspace datapath" and success hid it.
    if have amneziawg-go; then
      note "AmneziaWG: userspace datapath — Secure Boot refuses the kernel module until its signing key is enrolled (sudo mokutil --import $(awg_mok_key || echo '<the DKMS key>'), then reboot)"
    else
      DID_FAIL=yes; warn "AmneziaWG tools are installed but Secure Boot refuses its kernel module on $(uname -r), and the userspace datapath could not be installed — awg interfaces cannot come up until the key is enrolled (the steps above)"
    fi
    return 0
  fi
  # Nothing new to try: the module did not compile on this kernel, and neither the package nor upstream has moved since.
  # Said in one line — every update used to "heal" it again: minutes of compiling, a broken dpkg, "healed" each time.
  if [ "$_tools" = yes ] && have amneziawg-go && awg_nothing_new; then
    note "AmneziaWG: userspace datapath — the kernel module does not compile on $(uname -r) yet; tried again when a new kernel or a newer AmneziaWG build arrives"
    return 0
  fi

  if [ "$_tools" = no ]; then
    info "healing AmneziaWG (its tools are missing on this node — awg interfaces cannot be created or taken over)"
  else
    info "healing the AmneziaWG kernel module (not loadable on kernel $(uname -r) — awg interfaces can't come up)"
  fi
  # 1. package route: fastest where it works (Ubuntu with Launchpad reachable). Every step already tolerant. Ubuntu and the
  #    systems built on it only — the PPA publishes nothing else, and trying it elsewhere was all noise (lib/common.sh).
  local _ppa=""
  if have apt-get && _ppa="$(awg_ppa_suite)"; then
    apt_refresh
    awg_ppa_add "$_ppa" 2>/dev/null
    run apt-get update -qq 2>/dev/null || true
    run apt-get install -y dkms "linux-headers-$(uname -r)" || run apt-get install -y dkms linux-headers-generic || true
    ensure_awg_headers_follow || true
    awg_dkms_drop_unowned   # D4: one DKMS owner — the package's
    if awg_ppa_module_install; then   # a module that does not compile on this kernel is given up on, not retried
      run dkms autoinstall -k "$(uname -r)" 2>/dev/null || run dkms autoinstall 2>/dev/null || true
      modprobe amneziawg 2>/dev/null || awg_mod_key_rejected || { awg_dkms_reinstall \
                                          && run dkms autoinstall -k "$(uname -r)" 2>/dev/null; } || true   # given up: no rebuild
      run modprobe amneziawg 2>/dev/null || true
    fi
  elif have apt-get; then
    info "AmneziaWG: building it from source — its packages are published for Ubuntu only, and this is $(awg_os_name)"
    apt_refresh
  fi
  # 2. source build — the only route to the KERNEL datapath off Ubuntu, and the answer when the PPA is
  #    unreachable. No-op for the tools half when they are already present.
  have awg && have awg-quick && modprobe amneziawg 2>/dev/null || awg_build_from_source || true
  # 3. still no module (no headers for this kernel, or a guest that cannot load one): userspace, so the node
  #    can serve AmneziaWG at all. awg-quick picks amneziawg-go up by itself.
  have awg && have awg-quick && ! modprobe amneziawg 2>/dev/null && ensure_awg_userspace || true

  if modprobe amneziawg 2>/dev/null; then
    DID_UPDATE=yes; ok "AmneziaWG healed — kernel datapath, awg interfaces can come up now"
    note "AmneziaWG: kernel module ready for $(uname -r)"
  elif have awg && have awg-quick && have amneziawg-go && [ "${AWG_GAVE_UP:-}" = transient ]; then   # nothing healed (above)
    DID_UPDATE=yes; note "AmneziaWG: the kernel module's package is removed for now — its build did not finish on this box; the next update tries again"
  elif have awg && have awg-quick && have amneziawg-go; then
    DID_UPDATE=yes; ok "AmneziaWG healed — running the slower USERSPACE datapath (no loadable kernel module)"
    note "AmneziaWG: userspace (amneziawg-go); $(if awg_key_refused_here; then echo "Secure Boot refuses the kernel module until its signing key is enrolled — see the steps above"; elif awg_fail_get pkg >/dev/null || awg_fail_get src >/dev/null; then echo "the kernel module does not compile on $(uname -r) yet — tried again when a new kernel or a newer AmneziaWG build arrives"; elif awg_tools_drive_3x; then echo 'install matching linux-headers for the faster kernel module'; else awg_tools_old_why; fi)"
  elif have awg && have awg-quick; then
    DID_FAIL=yes; warn "AmneziaWG tools are installed but its kernel module will not load on $(uname -r), and the userspace datapath could not be built — awg interfaces cannot come up"
  else
    DID_FAIL=yes; warn "AmneziaWG could not be installed on this node — awg interfaces cannot be created or taken over. See the log above for the failing step"
  fi
}

awg_kernel_takes(){ # <conf> — would the loaded kernel module accept this interface's configuration? 0 = yes
  # Tried on a THROWAWAY device, before anything real is stopped. The live ListenPort is left out: the interface being
  # asked about still holds it. Anything that goes wrong here is a "no" — the interface then simply stays where it is.
  local p="swgprobe$$" t rc=1
  t="$(mktemp)" || return 1
  if ip link add "$p" type amneziawg 2>/dev/null; then
    awg-quick strip "$1" 2>/dev/null | grep -v '^[[:space:]]*ListenPort' > "$t" && awg setconf "$p" "$t" >/dev/null 2>&1 && rc=0
    ip link del "$p" 2>/dev/null
  fi
  rm -f "$t"
  return $rc
}

awg_kdevs(){   # the amneziawg KERNEL devices in this network namespace, one per line (amneziawg-go runs a tun — never listed)
  ip -o link show type amneziawg 2>/dev/null | awk -F': ' '{sub(/@.*/, "", $2); print $2}'
}
awg_kdevs_elsewhere(){   # OTHER network namespaces holding an amneziawg device — `modprobe -r` would destroy it there too.
  local n me ns pid nsfs t out list ln seen=" "
  for n in $(ip netns list 2>/dev/null | awk '{print $1}'); do
    [ -n "$(ip -n "$n" -o link show type amneziawg 2>/dev/null)" ] && echo "$n"
  done
  have lsns && have nsenter || { echo "?"; return 0; }
  me="$(readlink /proc/self/ns/net 2>/dev/null)" || me=""
  list="$(lsns -t net -n -r -o NS,PID,NSFS 2>/dev/null)" || { echo "?"; return 0; }
  [ -r /proc/1/mountinfo ] || { echo "?"; return 0; }
  while IFS= read -r ln; do
    [ -n "$ln" ] || continue
    ns="${ln%% *}"; ln="${ln#* }"; pid="${ln%% *}"; nsfs=""; case "$ln" in *" "*) nsfs="${ln#* }";; esac
    seen="$seen$ns "; [ "net:[$ns]" != "$me" ] || continue
    if [ -n "$pid" ]; then t="/proc/$pid/ns/net"; elif [ -n "$nsfs" ]; then t="$nsfs"; else echo "?"; return 0; fi
    out="$(nsenter --net="$t" ip -o link show type amneziawg 2>/dev/null)" || { echo "?"; return 0; }
    [ -n "$out" ] && echo "net:[$ns]"
  done <<< "$list"
  while read -r ns nsfs; do                                    # PID 1's own nsfs mounts of a network namespace
    case "$seen" in *" $ns "*) continue;; esac; seen="$seen$ns "; [ "net:[$ns]" != "$me" ] || continue
    out="$(nsenter --net="/proc/1/root$nsfs" ip -o link show type amneziawg 2>/dev/null)" || { echo "?"; return 0; }
    [ -n "$out" ] && echo "net:[$ns]"
  done < <(awk '{ for (i = 6; i < NF; i++) if ($i == "-") break; if ($(i + 1) == "nsfs" && $4 ~ /^net:\[[0-9]+\]$/) { n = $4; gsub(/[^0-9]/, "", n); print n, $5 } }' /proc/1/mountinfo 2>/dev/null)
  return 0
}
awg_src_refresh(){   # refresh the amnezia apt source ALONE — a whole `apt-get update` on every one-click update is not needed here
  local f d; f="$(ls /etc/apt/sources.list.d/*amnezia* 2>/dev/null | sed -n 1p)"; [ -n "$f" ] || return 1
  d="$(mktemp -d)" || return 1; ln -s "$f" "$d/" || { rm -rf "$d"; return 1; }   # keeps .list / .sources, so both formats parse
  run apt-get update -qq -o Dir::Etc::sourcelist=/dev/null -o Dir::Etc::sourceparts="$d" -o APT::Get::List-Cleanup=0 >/dev/null 2>&1
  local rc=$?; rm -rf "$d"; return $rc
}
ensure_awg_pkg_follow(){   # FOLLOW the amnezia packages to the PPA's current build — module AND tools together, the loaded module
  [ "$HAVE_BNODE" = yes ] || return 0
  have apt-get && have dpkg-query && have dpkg || return 0
  local cur cand awgp pk disk loaded
  cur="$(pkg_installed amneziawg-dkms)" || cur=""; [ -n "$cur" ] || return 0
  awgp="$(command -v awg 2>/dev/null)" || return 0
  case "$(dpkg -S "$awgp" 2>/dev/null)" in amneziawg-tools:*) ;; *) return 0 ;; esac   # never `| grep -q` under pipefail
  AWG_PKG_ROUTE=yes
  if $DRYRUN; then ok "AmneziaWG packages: an update checks the amnezia PPA and follows its build (module and tools together)"; return 0; fi
  case "$(dpkg-query -W -f='${db:Status-Abbrev}' amneziawg-dkms 2>/dev/null)" in iF*|iU*) if awg_dpkg_recover; then DID_UPDATE=yes; fi ;; esac
  [ "$APT_DONE" = yes ] || awg_src_refresh || true
  cand="$(pkg_candidate amneziawg-dkms)" || cand=""
  { [ -n "$cand" ] && [ "$cand" != "(none)" ] && dpkg --compare-versions "$cand" gt "$cur"; } || return 0
  awg_pkg_retry_due || return 0   # this very version already did not compile on this kernel — not again
  # Held on purpose (`apt-mark hold`) → the operator's call: said once per update, never an error every update.
  case " $(apt-mark showhold 2>/dev/null | tr '\n' ' ') " in *" amneziawg-dkms "*|*" amneziawg-tools "*|*" amneziawg "*)
    ok "AmneziaWG packages: $cand is available, but they are held (apt-mark hold) — left as they are"; return 0 ;; esac
  if [ ! -e "/lib/modules/$(uname -r)/build" ]; then
    note "AmneziaWG: $cand is available but not installed — this kernel's headers are missing"
    warn "AmneziaWG: $cand is available, but the headers for this kernel ($(uname -r)) are not installed, so its module could not be built — the packages are left as they are (install linux-headers-$(uname -r), or reboot into a kernel that has them)"
    return 0
  fi
  if ! have amneziawg-go; then
    note "AmneziaWG: $cand is available but not installed — the userspace fallback (amneziawg-go) is not installed"
    warn "AmneziaWG: $cand is available, but this box has no userspace fallback (amneziawg-go) — the packages are left as they are: had the new module not compiled here, no AmneziaWG interface would come up after the next reboot (an update that can fetch amneziawg-go, from GitHub or SWG_TURN_MIRROR, installs it and follows)"
    return 0
  fi
  pk="amneziawg-dkms amneziawg-tools"; [ -n "$(pkg_installed amneziawg)" ] && pk="$pk amneziawg"
  # shellcheck disable=SC2086   # $pk is a word list
  if ! run env DEBIAN_FRONTEND=noninteractive apt-get install -y -o DPkg::Lock::Timeout=180 --only-upgrade $pk >/dev/null 2>&1 \
     && ! { awg_compat_patch_installed && awg_dpkg_recover; }; then
    # Its module does not compile here even with the fix: leave dpkg clean and remember this version (the same give-up
    # the install route takes) — not a half-configured package that ends every later apt run, compiled again each update.
    if awg_dkms_compile_failed; then
      awg_dkms_give_up; DID_UPDATE=yes
      note "AmneziaWG: $cand does not compile on $(uname -r) — removed, userspace datapath; tried again with a newer build or kernel"
      return 0
    fi
    if awg_dkms_pending; then   # the box cut its build short: removed all the same (not recorded) — see awg_dkms_give_up
      awg_dkms_give_up transient; DID_UPDATE=yes
      note "AmneziaWG: $cand's module build did not finish on this box — removed for now; tried again on the next update"
      return 0
    fi
    note "AmneziaWG: the package upgrade did not go through — tried again on the next update"
    warn "AmneziaWG: the amnezia packages could not be upgraded ($cur → $cand) — tried again on the next update"
    return 0
  fi
  awg_compat_patch_installed >/dev/null || true
  DID_UPDATE=yes; note "AmneziaWG packages: $cur → $cand"
  disk="$(modinfo -F version amneziawg 2>/dev/null)" || disk=""; loaded="$(cat /sys/module/amneziawg/version 2>/dev/null)" || loaded=""
  if [ -z "$loaded" ] || [ "$disk" = "$loaded" ]; then ok "AmneziaWG packages updated (kernel module $disk)"; return 0; fi
  if [ -z "$(awg_kdevs)" ] && [ -z "$(awg_kdevs_elsewhere)" ] && ! awg_blacklisted; then   # nobody on the module → load the new one now, cutting no one
    if modprobe -r amneziawg 2>/dev/null && modprobe amneziawg 2>/dev/null; then
      ok "AmneziaWG $disk installed and loaded (no interface was using the kernel module)"; return 0
    fi
    modprobe amneziawg 2>/dev/null || true
    if [ ! -e /sys/module/amneziawg ]; then   # unloaded, and the new one would not load: say what the box runs now
      warn "AmneziaWG $disk installed, but its kernel module would not load — AmneziaWG interfaces run on the userspace fallback until it does"
      return 0
    fi
  fi
  ok "AmneziaWG $disk installed — the kernel module in use stays $loaded until the next reboot, or load it now from the panel: Load now under the AmneziaWG version switch of any AmneziaWG interface there (every AmneziaWG client reconnects within about 15 s)"
}
ensure_awg_back_on_kernel(){   # SURGICAL — NOT part of the general heal: move AWG interfaces off the userspace fallback.
  [ "$HAVE_BNODE" = yes ] || return 0
  have awg-quick || return 0
  $DRYRUN && return 0
  awg_blacklisted && return 0   # the operator's own blacklist: theirs to keep the module out (ensure_awg_datapath)
  modprobe amneziawg 2>/dev/null || return 0
  local d n c conf sock xit _w moved="" stuck="" down="" xmoved="" refused="" xdir="${SWG_NODED_STATE:-/var/lib/swg-noded}/exits"
  for d in /sys/class/net/*; do
    n="${d##*/}"
    [ -e "$d/tun_flags" ] || continue
    sock="/var/run/amneziawg/$n.sock"; xit=no; conf=""
    if [ -f "$xdir/$n.conf" ]; then
      [ -S "$sock" ] || pgrep --ns $$ --nslist net -f "amneziawg-go $n\$" >/dev/null 2>&1 || continue
      conf="$xdir/$n.conf"; xit=yes
    else
      for c in /etc/amnezia/amneziawg/$n.conf /etc/amneziawg/$n.conf; do [ -f "$c" ] && { conf="$c"; break; }; done
      [ -n "$conf" ] || continue
    fi
    awg_kernel_takes "$conf" || { refused="$refused $n"; continue; }
    if [ "$xit" = no ] && have systemctl && systemctl is-active --quiet "awg-quick@$n" 2>/dev/null; then
      run systemctl stop "awg-quick@$n" >/dev/null 2>&1 || true
    else
      run awg-quick down "$conf" >/dev/null 2>&1 || true
    fi
    for _w in 1 2 3 4 5 6 7 8 9 10; do
      [ -S "$sock" ] || pgrep --ns $$ --nslist net -f "amneziawg-go $n\$" >/dev/null 2>&1 || break
      sleep 1
    done
    pkill --ns $$ --nslist net -f "amneziawg-go $n\$" >/dev/null 2>&1 || true
    rm -f "$sock"
    for _w in 1 2 3 4 5; do [ -e "/sys/class/net/$n" ] || break; sleep 1; done   # the tun device goes with its process
    [ "$xit" = yes ] && { xmoved="$xmoved $n"; continue; }
    if have systemctl; then run systemctl start "awg-quick@$n" >/dev/null 2>&1 || run awg-quick up "$conf" >/dev/null 2>&1 || true
    else run awg-quick up "$conf" >/dev/null 2>&1 || true; fi
    if [ ! -e "/sys/class/net/$n" ]; then down="$down $n"
    elif [ -e "/sys/class/net/$n/tun_flags" ]; then stuck="$stuck $n"
    else moved="$moved $n"; fi
  done
  [ -n "$xmoved" ] && { DID_UPDATE=yes; note "AmneziaWG exits taken off the userspace fallback — swg-noded brings them back up on the kernel module:$xmoved"; }
  [ -n "$moved" ] && { DID_UPDATE=yes; ok "AmneziaWG back on the kernel datapath:$moved"; }
  # The loaded module refusing a conf is either a module older than the interface needs, or tools older than the module —
  # the second only on a box whose own awg predates AmneziaWG 3, and there a reboot takes these interfaces down for good.
  [ -n "$refused" ] && warn "AmneziaWG stays on the userspace fallback:$refused — the kernel module does not accept its configuration ($(awg_tools_drive_3x && echo 'a module older than the interface needs?' || echo "$(awg_tools_old_why); until then a reboot takes them down"))"
  [ -n "$stuck" ] && warn "AmneziaWG still on the userspace fallback after a restart:$stuck — the kernel module did not take them"
  [ -n "$down" ] && { DID_FAIL=yes; warn "AmneziaWG interface(s) did not come back after moving them to the kernel datapath:$down — start them from the panel"; }
  return 0
}

ensure_awg_quick_unit(){   # HEAL (install-if-missing) the awg-quick@ TEMPLATE unit on a bare-metal node.
  [ "$HAVE_BNODE" = yes ] || return 0
  have systemctl || return 0
  local unit=/etc/systemd/system/awg-quick@.service pkg="" c awgq ifaces n tool
  # Steps 1-2 are about the AmneziaWG template and need its tools; step 3 enables what this node manages and
  # is tool-agnostic — a box with only plain WireGuard has no awg-quick and must still reach it.
  have awg-quick || { _enable_managed_ifaces; return 0; }
  for c in /usr/lib/systemd/system/awg-quick@.service /lib/systemd/system/awg-quick@.service; do
    if [ -f "$c" ]; then pkg="$c"; break; fi
  done

  # 1. the package caught up → drop our stand-in, it can only shadow the real one from here on.
  if [ -n "$pkg" ] && [ -f "$unit" ] && grep -q '^# Written by swgPanel' "$unit" 2>/dev/null; then
    info "the AmneziaWG package now ships awg-quick@.service — removing our stand-in so theirs is used"
    run rm -f "$unit"
    run systemctl daemon-reload || true
    DID_UPDATE=yes
  fi

  if ! systemctl cat awg-quick@.service >/dev/null 2>&1; then
    info "healing boot persistence for AmneziaWG (awg-quick@.service is missing — no awg interface can start at boot)"
    if $DRYRUN; then
      echo "    [skip] install ${unit}"
    else
      awgq="$(command -v awg-quick)"
      cat > "$unit" <<EOF
# Written by swgPanel: awg-quick@.service was missing on this host, so no awg interface could survive a
# reboot. Safe to delete once the AmneziaWG tools' own package provides one.
[Unit]
Description=AmneziaWG via awg-quick(8) for %I
After=network-online.target nss-lookup.target
Wants=network-online.target nss-lookup.target
Documentation=man:awg-quick(8)

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${awgq} up %i
ExecStop=${awgq} down %i
Environment=WG_ENDPOINT_RESOLUTION_RETRIES=infinity

[Install]
WantedBy=multi-user.target
EOF
      chmod 644 "$unit"
      systemctl daemon-reload || true
    fi
    DID_UPDATE=yes
  fi

  _enable_managed_ifaces
}

_enable_managed_ifaces(){
  local ifaces n tool
  have systemctl || return 0
  ifaces="$(python3 -c '
import json
try:
    cfg = json.load(open("/etc/swg-agent/config.json"))
except Exception:
    raise SystemExit(0)
try:
    stopped = set(json.load(open("/var/lib/swg-noded/iface-stopped.json")))
except Exception:
    stopped = set()
for name, ic in (cfg.get("interfaces") or {}).items():
    if name in stopped:
        continue
    t = (ic.get("cmd") or ["awg"])[0]
    if t in ("awg", "wg"):          # the two tools with a *-quick@ template; anything else is not ours to enable
        print("%s %s" % (name, t))
' 2>/dev/null || true)"
  # NOT a pipeline: `... | while read` runs the loop in a SUBSHELL, and DID_UPDATE/DID_FAIL set in there
  # would never reach the summary — the update would report "nothing changed" having just enabled units.
  while read -r n tool; do
    [ -n "$n" ] && [ -n "$tool" ] || continue
    # no template for this tool → `systemctl enable` would fail in exactly the silent way this function exists
    # to prevent. awg's is healed above; wg's ships with the distro's wireguard-tools.
    if ! systemctl cat "${tool}-quick@.service" >/dev/null 2>&1; then
      $DRYRUN || warn "${tool}-quick@.service is missing — ${n} cannot be made to start at boot"
      continue
    fi
    if systemctl is-enabled --quiet "${tool}-quick@${n}" 2>/dev/null; then continue; fi
    if run systemctl enable --quiet "${tool}-quick@${n}"; then
      DID_UPDATE=yes
      $DRYRUN || { ok "${tool}-quick@${n} will start at boot now (it would not have)"
                   note "$([ "$tool" = awg ] && echo AmneziaWG || echo WireGuard): ${n} set to start at boot"; }
    else
      DID_FAIL=yes; warn "couldn't enable ${tool}-quick@${n} — it will not come back after a reboot"
    fi
  done <<< "$ifaces"
}

ensure_cert_perms(){   # HEAL (fix-if-wrong) ownership of the files the panel must READ: its TLS key and its auth file.
  getent group swg >/dev/null 2>&1 || return 0
  local f grp mode fixed=""
  for f in "${TLS_DIR:-/etc/swg-panel/tls}/key.pem" /etc/swg-sub/tls/key.pem /etc/swg-panel/auth; do
    [ -f "$f" ] || continue
    grp="$(stat -c '%G' "$f" 2>/dev/null)"; mode="$(stat -c '%a' "$f" 2>/dev/null)"
    case "$grp:$mode" in swg:*[4567]?) continue;; esac
    $DRYRUN && { echo "    [skip] chown root:swg + chmod 640 $f (mode $mode $grp — the service user can't read it)"; continue; }
    chown root:swg "$f" 2>/dev/null || true; chmod 640 "$f" 2>/dev/null || true
    [ "$(stat -c '%G' "$f" 2>/dev/null)" = swg ] && fixed="$fixed $f"
  done
  [ -n "$fixed" ] && { DID_UPDATE=yes; ok "credential permissions healed —$fixed (the service user couldn't read it: a TLS key would not have survived the next restart, and an unreadable auth file used to leave the panel with no login at all)"
                       note "credential perms: healed$fixed"; }
  return 0; }

ACME_HOME_CANON="${ACME_HOME_CANON:-/root/.acme.sh}"   # the ONE acme store — see ensure_acme_home below
heal_acme_reloadcmd(){
  local conf="${ETC_DIR:-/etc/swg-panel}/install.conf" dom f
  dom="$(sed -n 's/^PANEL_DOMAIN=//p' "$conf" 2>/dev/null | sed -n 1p | tr -d "'\"")"
  [ -n "$dom" ] || return 0
  f="$ACME_HOME_CANON/${dom}_ecc/${dom}.conf"
  [ -f "$f" ] || return 0
  if $DRYRUN; then echo "    [skip] acme reload command for $dom: systemctl restart → SIGHUP (if it still restarts the panel)"; return 0; fi
  local out; out="$(python3 - "$f" "${TLS_DIR:-/etc/swg-panel/tls}/fullchain.pem" <<'PY' 2>/dev/null
import base64, os, re, sys
path, ours = sys.argv[1], os.path.realpath(sys.argv[2])
lines = open(path).read().split("\n")
def val(k):
    for l in lines:
        if l.startswith(k + "="):
            return l.split("=", 1)[1].strip().strip("'\"")
    return ""
if os.path.realpath(val("Le_RealFullChainPath") or "/nonexistent") != ours:
    sys.exit(0)                                   # not installing into the panel's path: not ours to change
raw = val("Le_ReloadCmd")
m = re.match(r"^__ACME_BASE64__START_(.*)__ACME_BASE64__END_$", raw)
cmd = base64.b64decode(m.group(1)).decode() if m else raw
# the exact command earlier installers and convert.sh wrote — `.service` spelled or not — and nothing that merely
# starts with it (a plain substring replace turned `…swg-panel-server.service` into `… || true.service`)
pat = re.compile(r"systemctl restart swg-panel-server(?:\.service)?(?=\s*(?:;|&&|\|\||$))")
if not pat.search(cmd):
    sys.exit(0)
new = pat.sub("systemctl kill -s HUP swg-panel-server.service 2>/dev/null || true", cmd)
enc = "__ACME_BASE64__START_%s__ACME_BASE64__END_" % base64.b64encode(new.encode()).decode()
lines = [("Le_ReloadCmd='%s'" % enc) if l.startswith("Le_ReloadCmd=") else l for l in lines]
tmp = path + ".swgtmp"
open(tmp, "w").write("\n".join(lines))
os.chmod(tmp, os.stat(path).st_mode & 0o777)
os.replace(tmp, path)
print("healed")
PY
)" || true
  [ "$out" = healed ] && { DID_UPDATE=yes; ok "acme renewals now reload the panel's certificate live (SIGHUP) instead of restarting it"
                           note "acme reload command: restart → SIGHUP"; }
  return 0; }
ensure_acme_client(){   # HEAL (install-if-missing) the ACME client on a bare-metal panel whose TLS needs it.
  local conf="${ETC_DIR:-/etc/swg-panel}/install.conf" mode=""
  [ -f "$conf" ] && mode="$(sed -n 's/^TLS_MODE=//p' "$conf" | sed -n 1p)"
  case "$mode" in letsencrypt|letsencrypt-ip|cloudflare) ;; *) return 0;; esac
  local ACME_MIN=3.1.4
  local a; for a in /root/.acme.sh/acme.sh "${HOME:-/root}/.acme.sh/acme.sh" "$(command -v acme.sh 2>/dev/null || true)"; do
    if [ -n "$a" ] && [ -x "$a" ]; then
      local v; v="$("$a" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sed -n 1p)"
      if [ -n "$v" ] && [ "$v" != "$ACME_MIN" ] \
         && [ "$(printf '%s\n%s\n' "$v" "$ACME_MIN" | sort -V | sed -n 1p)" = "$v" ]; then
        info "Upgrading acme.sh $v → $ACME_MIN or newer (older builds cache a failed issuance as a cert)"
        # --home pins WHICH acme.sh gets upgraded. Without it the target is $HOME/.acme.sh, and this
        # heal can run from a context whose HOME is not root's — upgrading a store nothing renews.
        "$a" --home "$ACME_HOME_CANON" --upgrade >/dev/null 2>&1 && ok "acme.sh upgraded" || warn "couldn't upgrade acme.sh — staying on $v"
      fi
      return 0
    fi
  done
  local email; email="$(sed -n 's/^ACME_EMAIL=//p' "$conf" 2>/dev/null | sed -n 1p)"
  info "Installing acme.sh (TLS mode $mode needs it; renewals and address changes were failing without it)"
  sh -c "curl -fsSL https://get.acme.sh | sh -s email=${email:-admin@localhost}" >/dev/null 2>&1 || true
  [ -x /root/.acme.sh/acme.sh ] && { DID_UPDATE=yes; note "acme.sh: installed (TLS mode $mode needs it)"; ok "acme.sh installed"; } \
    || warn "couldn't install acme.sh — renewals and address changes will keep failing until it is"
  return 0; }
ensure_acme_renewal(){
  bare_panel_parked && return 0
  local conf="${ETC_DIR:-/etc/swg-panel}/install.conf" mode="" a="" c
  for c in /root/.acme.sh/acme.sh "${HOME:-/root}/.acme.sh/acme.sh" "$(command -v acme.sh 2>/dev/null || true)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then a="$c"; break; fi
  done
  if [ -z "$a" ]; then
    [ -f "$conf" ] && mode="$(sed -n 's/^TLS_MODE=//p' "$conf" | sed -n 1p)"
    case "$mode" in letsencrypt|letsencrypt-ip|cloudflare) ;; *) return 0;; esac
  fi
  ensure_acme_cron "$a" "$ACME_HOME_CANON"
  if [ -n "$ACME_CRON_DID" ]; then DID_UPDATE=yes; note "certificate renewal: $ACME_CRON_DID"; fi
  return 0; }

ensure_acme_home(){
  local stray="${ACME_HOME_STRAY:-/.acme.sh}"   # overridable so the migration is testable off-box
  # 1. pin the store on the helper, additively — a drop-in, never a rewrite of the shipped unit
  if [ -f /etc/systemd/system/swg-netctl.service ]; then
    local dd=/etc/systemd/system/swg-netctl.service.d
    if ! grep -rqs "LE_WORKING_DIR=" "$dd" /etc/systemd/system/swg-netctl.service 2>/dev/null; then
      mkdir -p "$dd"
      printf '[Service]\nEnvironment=LE_WORKING_DIR=%s\n' "$ACME_HOME_CANON" > "$dd/acme-home.conf"
      systemctl daemon-reload 2>/dev/null || true
      ok "pinned the TLS helper's acme store to $ACME_HOME_CANON (it was following \$HOME)"
    fi
  fi
  # 2. rescue any certificate that only ever existed in the stray store
  [ -d "$stray" ] && [ "$stray" != "$ACME_HOME_CANON" ] || return 0
  local d n moved=0 kept=0
  # ⚠️ ONE glob. `"$stray"/*_ecc "$stray"/*.*` both match a domain dir (they contain dots), so every
  # domain was visited twice and the counters double-reported. Caught by the migration's own control.
  for d in "$stray"/*; do
    [ -d "$d" ] || continue
    n="$(basename "$d")"
    case "$n" in ca|deploy|dnsapi|notify|http.header|account.conf) continue;; esac
    [ -f "$d/$(basename "$n" _ecc).conf" ] || continue      # a real domain dir, not scaffolding
    if [ -e "$ACME_HOME_CANON/$n" ]; then kept=$((kept+1)); continue; fi
    mv "$d" "$ACME_HOME_CANON/$n" 2>/dev/null && moved=$((moved+1))
  done
  [ "$moved" -gt 0 ] && ok "moved $moved certificate(s) into $ACME_HOME_CANON — they had no renewer before"
  [ "$kept" -gt 0 ] && warn "$kept certificate(s) exist in BOTH $stray and $ACME_HOME_CANON — kept the renewable one; $stray left in place for inspection"
  return 0; }

ensure_node_update_ref(){   # HEAL: record the ref this box tracks in the node's agent config.
  local cfg=/etc/swg-agent/config.json want="${SWG_REF:-main}"
  [ -f "$cfg" ] || return 0
  if $DRYRUN; then echo "    [skip] record update_ref=$want in $cfg"; return 0; fi
  local out
  out="$(SWG_WANT_REF="$want" python3 - "$cfg" <<'PYREF'
import json, os, sys
p, want = sys.argv[1], os.environ.get("SWG_WANT_REF", "main")
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)                       # never fail an update over this
n = d.setdefault("node", {})
if str(n.get("update_ref") or "") == want:
    sys.exit(0)
n["update_ref"] = want
tmp = p + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.replace(tmp, p); os.chmod(p, 0o640)
print("changed")
PYREF
)" || return 0
  [ -n "$out" ] && { ok "node self-update now tracks $(col_v "$want")"; DID_UPDATE=yes; NODE_REF_CHANGED=yes
                     note "bare-metal swg-node: self-update now tracks $want"; }
  return 0
}

ensure_update_unit(){   # HEAL (install-if-missing) the one-click self-update wiring on a bare-metal panel.
  [ -f "$PANEL_DIR/swg-panel-server" ] || return 0     # bare-metal panel only
  if [ -x /usr/local/bin/swg-update ] && [ -x /usr/local/bin/swg-update-check ] \
     && [ -f /etc/systemd/system/swg-update.service ] && [ -f /etc/systemd/system/swg-update.timer ]; then
    $DRYRUN || systemctl is-enabled --quiet swg-update.timer 2>/dev/null || systemctl enable --quiet --now swg-update.timer 2>/dev/null || true
    return 0
  fi
  info "healing the one-click self-update wiring (missing — the panel's Update button would do nothing)"
  install_update_unit
  $DRYRUN || { DID_UPDATE=yes; note "one-click self-update wiring: healed (was missing)"; ok "one-click self-update wiring healed"; }
}

ensure_access_seed(){   # HEAL (fill-if-empty) the panel's Access & TLS settings from install.conf / .env.
  local ps="" conf="" env_f=""
  if [ -f "$PANEL_DIR/swg-panel-server" ] && [ -f /etc/swg-panel/install.conf ]; then
    ps=/var/lib/swg-panel/panel-settings.json; conf=/etc/swg-panel/install.conf
  elif [ -f "$DOCKER_DIR/.env" ] && [ -d "$DOCKER_DIR/data/lib" ] && case "$(docker_profile 2>/dev/null | tail -n1)" in host|master|host-node) true;; *) false;; esac; then
    ps="$DOCKER_DIR/data/lib/panel-settings.json"; env_f="$DOCKER_DIR/.env"   # (a node-only stack has no panel to seed)
  else return 0; fi
  have python3 || return 0
  $DRYRUN && { sub "[dry] would fill any EMPTY Access & TLS settings from ${conf:-$env_f}"; return 0; }
  local _dom _base _port _tls _mail _proxied=no _out
  if [ -n "$conf" ]; then
    _dom="$(sed -n 's/^PANEL_DOMAIN=//p' "$conf" | sed -n 1p)"; _base="$(sed -n 's/^PANEL_BASE=//p' "$conf" | sed -n 1p)"
    _port="$(sed -n 's/^PORT=//p' "$conf" | sed -n 1p)";        _tls="$(sed -n 's/^TLS_MODE=//p' "$conf" | sed -n 1p)"
    _mail="$(sed -n 's/^ACME_EMAIL=//p' "$conf" | sed -n 1p)"
    # plain HTTP behind a proxy = the panel's unit gives it no certificate (its live environment, drop-ins included);
    # with no systemd answer, install.conf's serve mode says the same
    local _penv; _penv="$(systemctl show -p Environment --value swg-panel-server 2>/dev/null || true)"
    if [ -n "$_penv" ]; then case " $_penv " in *" SWG_PANEL_TLS_CERT="[!\ ]*) ;; *) _proxied=yes;; esac
    else case "$(sed -n 's/^SERVE_MODE=//p' "$conf" | sed -n 1p)" in nginx|caddy|skip) _proxied=yes;; esac; fi
  else
    _dom="$(sed -n 's/^PANEL_DOMAIN=//p' "$env_f" | sed -n 1p)"; _base="$(sed -n 's/^PANEL_BASE=//p' "$env_f" | sed -n 1p)"
    _port="$(sed -n 's/^PANEL_PORT=//p' "$env_f" | sed -n 1p)";  _tls="$(sed -n 's/^TLS=//p' "$env_f" | sed -n 1p)"
    _mail="$(sed -n 's/^ACME_EMAIL=//p' "$env_f" | sed -n 1p)"
  fi
  _dom="${_dom%\"}"; _dom="${_dom#\"}"; _tls="${_tls%\"}"; _tls="${_tls#\"}"   # .env values may be quoted
  [ "$_tls" = none ] && _proxied=yes
  _out="$(PANEL_DOMAIN="$_dom" PANEL_BASE="$_base" PORT="$_port" TLS_MODE="$_tls" ACME_EMAIL="$_mail" PROXIED="$_proxied" \
  python3 - "$ps" <<'PYACC' || true
import json, os, sys
p = sys.argv[1]
try:
    with open(p) as f: d = json.load(f)
except Exception:
    d = {}
if not isinstance(d, dict): d = {}
dom  = (os.environ.get("PANEL_DOMAIN") or "").strip()
base = (os.environ.get("PANEL_BASE") or "").strip().rstrip("/")
port = (os.environ.get("PORT") or "").strip()
acc  = d.setdefault("access", {}); pan = acc.setdefault("panel", {}); tls = acc.setdefault("tls", {})
changed = []
if not (pan.get("url") or "").strip() and dom:          # ONLY when empty — never override the operator's value
    host = dom if "://" in dom else "https://" + dom
    if port and port not in ("443", "80") and ":" not in host.split("://", 1)[1]:
        host += ":" + port
    pan["url"] = host + (base or ""); changed.append("public URL")
if (not (tls.get("mode") or "").strip() and (os.environ.get("TLS_MODE") or "").strip()
        and os.environ.get("PROXIED") != "yes"):       # behind a reverse proxy "" IS the TLS type (N4)
    tls["mode"] = os.environ["TLS_MODE"].strip(); changed.append("TLS type")
if not (tls.get("email") or "").strip() and (os.environ.get("ACME_EMAIL") or "").strip():
    tls["email"] = os.environ["ACME_EMAIL"].strip(); changed.append("ACME email")
if not changed:
    raise SystemExit(0)
tmp = p + ".tmp"
with open(tmp, "w") as f: json.dump(d, f, indent=2)
os.replace(tmp, p)
print(", ".join(changed))
PYACC
)"
  [ -n "$_out" ] && ok "Access & TLS: filled what was empty in the panel's settings from ${conf:-$env_f} — $_out"
  return 0
}

ensure_panel_unit_warn(){   # DETECT + WARN only — never recreate. The panel unit bakes in the operator's
  [ -f "$PANEL_DIR/swg-panel-server" ] || return 0
  [ -f /etc/systemd/system/swg-panel-server.service ] && return 0
  DID_FAIL=yes
  warn "swg-panel-server.service is MISSING — the panel is not managed by systemd and won't survive a reboot."
  warn "Its unit carries your TLS cert/key, port, and login, which an update must not guess. Re-run the host"
  warn "installer to restore it with your real settings:"
  # …from the ref this box follows (main pinned here re-installed main over a dev box: IN-8); a ref other than main rides
  # INSIDE the string, as bootstrap's own hand-back does — sudo drops SWG_REF in front of it
  local _r="${SWG_REF:-main}" _p=""; [ "$_r" = main ] || _p="SWG_REF=$(printf '%q' "$_r"); "
  warn "    sudo bash -c \"$_p\$(curl -fsSL https://raw.githubusercontent.com/tesla-prep/vpn-panel/$_r/bootstrap.sh)\" -- host"
}

ensure_netctl_docker(){   # the docker address helper on a panel-bearing docker host: units HEALED if missing, the drainer at this release.
  case "${1:-}" in host|master|host-node) ;; *) return 0;; esac    # panel-bearing profiles only
  local drainer="$REPO/docker/swg-netctl-docker"
  [ -f "$drainer" ] || return 0
  local nd=/usr/local/bin/swg-netctl-docker
  $DRYRUN || rm -f "$nd.new" || true   # a stray that cannot go (a read-only bin) must not stop the update
  if [ -x "$nd" ] && [ "$(sha256sum < "$drainer")" != "$(sha256sum < "$nd")" ]; then
    if $DRYRUN; then echo "    [skip] install this release's $nd (it differs)"
    elif install -m755 "$drainer" "$nd.new" && mv -f "$nd.new" "$nd"; then
      DID_UPDATE=yes; note "docker address helper: this release's drainer"
      # an older drainer could leave a stray that re-fired the path watch until systemd stopped it (start-limit-hit); this
      # one clears strays, so the watch is armed again — unless the operator disabled it (the 10 s timer drained meanwhile)
      if systemctl is-enabled --quiet swg-netctl-docker.path 2>/dev/null; then
        systemctl reset-failed swg-netctl-docker.path swg-netctl-docker.service 2>/dev/null || true
        systemctl restart swg-netctl-docker.path 2>/dev/null || true
      fi
    else
      rm -f "$nd.new" || true; DID_FAIL=yes; warn "couldn't install this release's $nd — the old drainer stays"
      note "docker address helper: this release's drainer could NOT be installed — the old one stays (run the update again)"
    fi
  fi
  if [ -x /usr/local/bin/swg-netctl-docker ] && [ -f /etc/systemd/system/swg-netctl-docker.service ] \
     && [ -f /etc/systemd/system/swg-netctl-docker.timer ]; then
    if grep -q '^OnUnitActiveSec=1s' /etc/systemd/system/swg-netctl-docker.timer 2>/dev/null \
       || [ ! -f /etc/systemd/system/swg-netctl-docker.path ]; then
      info "the docker address helper polled every second — switching it to a queue watch"
      if $DRYRUN; then echo "    [skip] write swg-netctl-docker.path + relax the timer to 10s"; else
        mkdir -p "$DOCKER_DIR/data/lib/netctl/queue"
        cat > /etc/systemd/system/swg-netctl-docker.path <<EOF
[Unit]
Description=watch for swg-panel docker netctl requests (address changes)

[Path]
DirectoryNotEmpty=$DOCKER_DIR/data/lib/netctl/queue
Unit=swg-netctl-docker.service

[Install]
WantedBy=paths.target
EOF
        cat > /etc/systemd/system/swg-netctl-docker.timer <<EOF
[Unit]
Description=poll the swg-panel docker netctl queue (fallback for the path watch)

[Timer]
OnActiveSec=10s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable --quiet --now swg-netctl-docker.path 2>/dev/null || true
        systemctl restart swg-netctl-docker.timer 2>/dev/null || true
        DID_UPDATE=yes; note "docker address helper: now watches the queue (was a 1s poll)"
        ok "docker address helper: now watches the queue (was a 1s poll)"
      fi
    fi
    $DRYRUN || systemctl is-enabled --quiet swg-netctl-docker.timer 2>/dev/null || systemctl enable --quiet --now swg-netctl-docker.timer 2>/dev/null || true
    return 0
  fi
  info "healing the docker address helper (missing — one-click address changes would fall back to a manual restart)"
  if $DRYRUN; then echo "    [skip] install /usr/local/bin/swg-netctl-docker + swg-netctl-docker.{service,timer} (enable --now)"; return 0; fi
  mkdir -p "$DOCKER_DIR/data/lib/netctl/queue" "$DOCKER_DIR/data/lib/netctl/status"   # the panel writes requests here (bind mount)
  [ -x /usr/local/bin/swg-netctl-docker ] || install -m755 "$drainer" /usr/local/bin/swg-netctl-docker
  if [ ! -f /etc/systemd/system/swg-netctl-docker.service ]; then
    cat > /etc/systemd/system/swg-netctl-docker.service <<EOF
[Unit]
Description=swg-panel docker address helper (drains the netctl queue into docker compose actions)

[Service]
Type=oneshot
Environment=SWG_DOCKER_DIR=$DOCKER_DIR
ExecStart=/usr/local/bin/swg-netctl-docker
EOF
  fi
  if [ ! -f /etc/systemd/system/swg-netctl-docker.path ]; then
    cat > /etc/systemd/system/swg-netctl-docker.path <<EOF
[Unit]
Description=watch for swg-panel docker netctl requests (address changes)

[Path]
DirectoryNotEmpty=$DOCKER_DIR/data/lib/netctl/queue
Unit=swg-netctl-docker.service

[Install]
WantedBy=paths.target
EOF
  fi
  if [ ! -f /etc/systemd/system/swg-netctl-docker.timer ]; then
    cat > /etc/systemd/system/swg-netctl-docker.timer <<EOF
[Unit]
Description=poll the swg-panel docker netctl queue (fallback for the path watch)

[Timer]
OnActiveSec=10s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  fi
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable --quiet --now swg-netctl-docker.path 2>/dev/null || warn "couldn't enable swg-netctl-docker.path"
  systemctl enable --quiet --now swg-netctl-docker.timer 2>/dev/null || warn "couldn't enable swg-netctl-docker.timer"
  DID_UPDATE=yes; note "docker address helper: healed (was missing)"
  ok "docker address helper healed — one-click address changes will work now"
}

ensure_netctl_docker_gate(){
  case "${1:-}" in host|master|host-node) ;; *) return 0;; esac
  if [ ! -f /etc/systemd/system/swg-netctl-docker.service ]; then   # a dry run: the helper's heal above only said it would write it
    $DRYRUN && echo "    [skip] swg-netctl-docker idle gate: /usr/local/bin/swg-netctl-due + swg-netctl-docker.service.d/$SWG_NETCTL_DUE_DROPIN (with the helper)"
    return 0
  fi
  ensure_timer_on_time swg-netctl-docker.timer
  local want; want="$(swg_netctl_docker_due_dropin_text)"
  netctl_gate_current swg-netctl-docker.service "$want" && return 0
  if $DRYRUN; then echo "    [skip] swg-netctl-docker idle gate: /usr/local/bin/swg-netctl-due + swg-netctl-docker.service.d/$SWG_NETCTL_DUE_DROPIN"; return 0; fi
  netctl_gate_heal swg-netctl-docker.service "$want"
  [ "$NETCTL_GATE_CHANGED" = 1 ] && { systemctl daemon-reload 2>/dev/null || true; }
  DID_UPDATE=yes; note "docker address helper: idle gate written (an idle tick no longer starts the drainer)"
}

rescue_container_confs(){   # $1 = compose profile
  [ "${1:-}" = host ] && return 0
  $DRYRUN && { echo "    [skip] rescue container-local interface confs"; return 0; }
  docker ps -aq -f name=swg-node 2>/dev/null | grep -c . >/dev/null || return 0
  [ -d "$DOCKER_DIR/data/node-confs" ] || return 0
  _rescue="$(mktemp -d)" || return 0
  if docker cp swg-node:/etc/wireguard/. "$_rescue"/ >/dev/null 2>&1; then
    for _wc in "$_rescue"/*.conf; do
      [ -f "$_wc" ] || continue          # skips the symlink the fixed agent leaves (its target is already on the mount)
      if cp -n "$_wc" "$DOCKER_DIR/data/node-confs/" 2>/dev/null; then
        note "rescued interface conf $(basename "$_wc") onto the persisted volume (was container-local)"
      fi
    done
  fi
  rm -rf "$_rescue" 2>/dev/null || true
}

ensure_update_unit_docker(){   # HEAL the docker one-click self-update wiring on a panel-bearing docker host: write it when missing, rewrite a piece an older release wrote.
  case "${1:-}" in host|master|host-node|node) ;; *) return 0;; esac
  local _ref="${SWG_REF:-}" _stale=""
  [ -n "$_ref" ] || _ref="$(sed -En 's#^URL=.*/(swg-panel|vpn-panel)/([^/]*)/bootstrap\.sh\}".*#\2#p' /usr/local/bin/swg-update 2>/dev/null | sed -n 1p || true)"
  _ref="${_ref:-main}"
  if [ -x /usr/local/bin/swg-update ] && [ -x /usr/local/bin/swg-update-check ] \
     && [ -f /etc/systemd/system/swg-update.service ] && [ -f /etc/systemd/system/swg-update.timer ]; then
    [ "$(cat /usr/local/bin/swg-update 2>/dev/null || true)" = "$(swg_update_wrapper_text "$_ref")" ] || _stale="swg-update"
    [ "$(cat /usr/local/bin/swg-update-check 2>/dev/null || true)" = "$(swg_update_check_docker_text)" ] || _stale="${_stale:+$_stale, }swg-update-check"
    [ "$(cat /etc/systemd/system/swg-update.service 2>/dev/null || true)" = "$(swg_update_docker_service_text)" ] || _stale="${_stale:+$_stale, }swg-update.service"
    [ "$(cat /etc/systemd/system/swg-update.timer 2>/dev/null || true)" = "$(swg_update_docker_timer_text)" ] || _stale="${_stale:+$_stale, }swg-update.timer"
    if [ -z "$_stale" ]; then
      $DRYRUN || systemctl is-enabled --quiet swg-update.timer 2>/dev/null || systemctl enable --quiet --now swg-update.timer 2>/dev/null || true
      return 0
    fi
    info "rewriting the docker one-click self-update wiring — an older release's text ($_stale), following $(b "$_ref")"
    if $DRYRUN; then echo "    [skip] rewrite $_stale with this release's text"; return 0; fi
    SWG_REF="$_ref" write_docker_updater   # shared writer (lib/common.sh): same pieces install-docker.sh writes
    DID_UPDATE=yes; note "docker one-click self-update wiring: rewritten ($_stale)"
    ok "docker one-click self-update wiring rewritten — this release's text"
    return 0
  fi
  info "healing the docker one-click self-update wiring (missing — the panel's Update button would do nothing)"
  if $DRYRUN; then echo "    [skip] install /usr/local/bin/swg-update{,-check} + swg-update.{service,timer} (enable --now)"; return 0; fi
  SWG_REF="$_ref" write_docker_updater   # shared writer (lib/common.sh): same pieces install-docker.sh writes
  DID_UPDATE=yes; note "docker one-click self-update wiring: healed (was missing)"
  ok "docker one-click self-update wiring healed — the Update button will work now"
}

ensure_log_ns(){   # <namespace> <unit>... — swg's own journal (lib/common.sh): the drop-ins + swg-logs, written when missing or
  if $DRYRUN; then echo "    [skip] LogNamespace=$1 drop-ins for: ${*:2} + /usr/local/bin/swg-logs"; return 0; fi
  swg_log_ns_heal "$@"
  if [ "${SWG_LOG_NS_CLEARED:-0}" -gt 0 ]; then   # this box cannot run a unit in a journal namespace (lib/common.sh, IN-11)
    systemctl daemon-reload || true
    local _u; for _u in "${@:2}"; do case "$_u" in
      swg-update.service|swg-netctl.service) systemctl reset-failed "$_u" 2>/dev/null || true;;   # oneshots: their next tick runs
      *) if systemctl is-failed --quiet "$_u" 2>/dev/null; then systemctl restart "$_u" 2>/dev/null || true; fi;; esac; done
    DID_UPDATE=yes; note "swg's logs: this box cannot run a unit in a journal namespace — its LogNamespace drop-ins removed"
    warn "this box cannot run a unit in a journal namespace (mount namespaces are refused here) — swg logs into the main journal, as before 1.8.9"
  fi
  if [ "$SWG_LOG_NS_CHANGED" -gt 0 ]; then
    systemctl daemon-reload || true
    DID_UPDATE=yes; note "swg's logs: ${*:2} → the $1 journal (read with swg-logs)"
    ok "swg's logs now go to the $1 journal, held to its budget — \`journalctl -u\` shows only systemd's lines; read them with \`swg-logs\`"
  fi
  if [ -f "$SRC/swg-logs" ] && ! cmp -s "$SRC/swg-logs" /usr/local/bin/swg-logs 2>/dev/null; then
    install -m755 "$SRC/swg-logs" /usr/local/bin/swg-logs || warn "couldn't install /usr/local/bin/swg-logs"
  fi
}
log_ns_build(){ grep -qs 'LOG_NS_CONF' "$1"; }   # <installed program> — does this build write the namespace's size?
ensure_panel_journal(){   # the panel reads its own journal (Settings → Logs, the live viewer): its unit's drop-in, when missing
  if $DRYRUN; then echo "    [skip] SupplementaryGroups=systemd-journal drop-in for swg-panel-server"; return 0; fi
  swg_journal_heal
  if [ "$SWG_JOURNAL_CHANGED" -gt 0 ]; then
    systemctl daemon-reload || true
    DID_UPDATE=yes; note "swg-panel-server reads its own journal (Settings → Logs) from its next start"
  fi
  return 0
}

# ───────────────────────── bare-metal panel (host or master) ─────────────────────────
if ! $NODE_ONLY && [ -f "$PANEL_DIR/swg-panel-server" ]; then
  found=1; pan_seen=yes; pold="$(oldver "$PANEL_DIR")"
  ensure_cert_perms
  if should_update "bare-metal swg-panel" "$PANEL_DIR"; then
    info "updating bare-metal swg-panel ($PANEL_DIR)"
    ensure_log_ns swg-panel swg-panel-server.service swg-sub.service swg-netctl.service swg-update.service
    ensure_panel_journal
    for f in swg-panel-server index.html app.css app.js reconcile.js turn-artifacts.js; do
      [ -f "$SRC/$f" ] && run cp "$SRC/$f" "$PANEL_DIR/"
    done
    # whole vendor/ dir — the buildless SPA needs the vendored Preact + htm ESM, not just qrcode
    [ -d "$SRC/vendor" ] && { run mkdir -p "$PANEL_DIR/vendor"; run cp -a "$SRC/vendor/." "$PANEL_DIR/vendor/"; }
    # js/ = the SPA's ES modules (docs/APP-JS-SPLIT-PLAN.md) — copied as a DIRECTORY, like vendor/, so adding a module never touches this loop
    [ -d "$SRC/js" ] && { run mkdir -p "$PANEL_DIR/js"; run cp -a "$SRC/js/." "$PANEL_DIR/js/"; }
    [ -d "$SRC/m" ] && { run mkdir -p "$PANEL_DIR/m"; run cp -a "$SRC/m/." "$PANEL_DIR/m/"; }   # m/ = the phone UI (docs/MOBILE-PLAN.md)
    if ! $DRYRUN && ! _jsbad="$(verify_js_tree "$SRC/js" "$PANEL_DIR/js")"; then   # a partial copy = a blank panel, silently
      DID_FAIL=yes
      warn "the SPA module tree is INCOMPLETE after the update — the panel will load blank:"
      printf '    %s\n' $_jsbad
      note "SPA modules: INCOMPLETE after copy"
    fi
    run chmod 755 "$PANEL_DIR/swg-panel-server"; stamp "$PANEL_DIR"
    install_update_unit                              # ensure one-click host self-update is wired
    if bare_panel_parked; then   # stopped + disabled on purpose (guard_second_panel) — updated on disk, left stopped
      ok "swg-panel updated — left stopped (it is disabled: another panel runs on this box)"; note "bare-metal swg-panel: ${pold} → ${NEW_VER} (parked, not started)"
    elif restart_panel_seeding_node_ep; then ok "swg-panel updated + restarted"; note "bare-metal swg-panel: ${pold} → ${NEW_VER}"
    else DID_FAIL=yes; warn "couldn't restart swg-panel-server"; note "bare-metal swg-panel: updated but RESTART FAILED"; fi
    if [ -f "$SUB_DIR/swg-sub" ] && [ -f "$SRC/swg-sub" ]; then
      run cp "$SRC/swg-sub" "$SUB_DIR/"; run chmod 755 "$SUB_DIR/swg-sub"
      for f in $SUB_WEB; do [ -f "$SRC/$f" ] && run cp "$SRC/$f" "$SUB_DIR/"; done
      [ -f "$SRC/vendor/qrcode.js" ] && { run mkdir -p "$SUB_DIR/vendor"; run cp "$SRC/vendor/qrcode.js" "$SUB_DIR/vendor/"; }
      stamp "$SUB_DIR"
      if bare_panel_parked; then   # its panel is parked (guard_second_panel), and it is parked with it
        ok "swg-sub updated — left stopped (its panel is parked: another panel runs on this box)"
      elif ! $DRYRUN && ! systemctl is-active --quiet swg-sub 2>/dev/null; then
        # ⚠️ A STOPPED swg-sub STAYS STOPPED. `restart` STARTS a stopped unit: every update started a swg-sub the operator
        # had stopped (1.8.8 qualification, round 10, F93 — the panel's start did the same). Updated on disk, left as it was.
        ok "swg-sub updated — left stopped, as it was (it runs the new build when it starts)"
      else
        run systemctl restart swg-sub 2>/dev/null && ok "swg-sub updated + restarted" || warn "swg-sub present but not restarted"
      fi
    fi
    # swg-passwd (admin login + Encryption-Vault reset helper) ships with the panel — refresh in place when present.
    # It's coupled to the panel's vault, so a stale copy after an update can mismatch; keep it in lockstep with the panel.
    if [ -f /usr/local/bin/swg-passwd ] && [ -f "$SRC/swg-passwd" ]; then
      run cp "$SRC/swg-passwd" /usr/local/bin/swg-passwd; run chmod 755 /usr/local/bin/swg-passwd; ok "swg-passwd refreshed"
    fi
    # swg-netctl (privileged network/TLS helper) — refresh the binary in place when already installed
    # (first-time provisioning of the binary + trigger units is done by install-host.sh).
    if [ -f /usr/local/bin/swg-netctl ] && [ -f "$SRC/swg-netctl" ]; then
      run cp "$SRC/swg-netctl" /usr/local/bin/swg-netctl; run chmod 755 /usr/local/bin/swg-netctl; ok "swg-netctl refreshed"
      run rm -f /run/swg-netctl.due   # the idle gate then runs the new build on the next tick, its log work with it
      NCS=/etc/systemd/system/swg-netctl.service
      if [ -f "$NCS" ] && ! grep -q "StartLimitIntervalSec=0" "$NCS"; then
        run sed -i '/^\[Unit\]/a StartLimitIntervalSec=0' "$NCS"
        run systemctl daemon-reload
        run systemctl reset-failed swg-netctl.path swg-netctl.service 2>/dev/null || true
        run systemctl restart swg-netctl.path 2>/dev/null || true
        ok "swg-netctl.path rate-limit override applied"
      fi
    fi
  else note "bare-metal swg-panel: unchanged (${pold})"; fi
  # HEAL PASS (runs regardless of should_update)
  repark_bare_panel      # a parked panel an older update started beside the docker one → stopped again (+ swg-sub)
  ensure_netctl_helper   # swg-netctl privileged helper (+ queue dirs + trigger units)
  ensure_netctl_gate     # …and its idle gate (written when missing or different — see there)
  if log_ns_build /usr/local/bin/swg-netctl; then   # HEAL: swg's own journal on a current box (a unit added since, a lost file)
    ensure_log_ns swg-panel swg-panel-server.service swg-sub.service swg-netctl.service swg-update.service
  fi
  if grep -qs 'LIVE_PANEL' "$PANEL_DIR/swg-panel-server"; then ensure_panel_journal; fi   # HEAL: a build with the viewer
  ensure_sub_server      # swg-sub subscription surface (user + binary + tls dir + unit)
  ensure_acme_renewal    # HEAL: cron + acme.sh's daily renewal entry, the certificate's ONLY renewer (before the client: no cron, no acme.sh)
  ensure_acme_client     # HEAL: the ACME client itself, when TLS_MODE needs it (a convert leaves the state, not the program)
  ensure_acme_home       # HEAL: pin the helper's acme store + rescue certs stranded in /.acme.sh (no renewer)
  heal_acme_reloadcmd    # HEAL: the panel's acme entry reloads it with SIGHUP, not `systemctl restart`
                         # (ensure_cert_perms runs ABOVE, before the restart it protects — see the note there)
  ensure_update_unit     # one-click self-update wiring (wrappers + service/timer + trigger drop-in)
  ensure_access_seed     # HEAL: fill any EMPTY Access & TLS settings (public URL / TLS type) from install.conf
  ensure_panel_unit_warn # swg-panel-server.service — detect + warn only (carries TLS/port/login)
fi

# ───────────────────────── bare-metal node daemon (node or master) ─────────────────────────
if [ -f "$NODED_DIR/swg-noded" ] || [ -f "$AGENT_DIR/swg-agent" ]; then
  found=1; nod_seen=yes; nold="$(oldver "$NODED_DIR")"
  # FIRST, before the restart below: that restart is where the daemon reads the ref. Written after it (as it was),
  # a version update restarted swg-noded on the old ref and then changed the file under the running daemon.
  NODE_REF_CHANGED=no; _noded_restarted=no
  ensure_node_update_ref # HEAL: record the ref this box tracks, so the node's self-update doesn't fall to main
  if should_update "bare-metal swg-node" "$NODED_DIR"; then
    info "updating bare-metal swg-node ($AGENT_DIR + $NODED_DIR)"
    ensure_log_ns swg-node swg-noded.service   # before the restart below: swg-noded moves into its journal with it
    [ -d "$AGENT_DIR" ] && [ -f "$SRC/swg-agent" ] && { run cp "$SRC/swg-agent" "$AGENT_DIR/"; run chmod 755 "$AGENT_DIR/swg-agent"; }
    if [ -d "$NODED_DIR" ] && [ -f "$SRC/swg-noded" ]; then
      run cp "$SRC/swg-noded" "$NODED_DIR/"; run chmod 755 "$NODED_DIR/swg-noded"
    fi
    [ -d "$NODED_DIR" ] && [ -f "$SRC/swg-sni" ] && { run cp "$SRC/swg-sni" "$NODED_DIR/"; run chmod 755 "$NODED_DIR/swg-sni"; }   # SNI-router classifier
    [ -d "$NODED_DIR" ] && [ -f "$SRC/swg-relay" ] && { run cp "$SRC/swg-relay" "$NODED_DIR/"; run chmod 755 "$NODED_DIR/swg-relay"; }   # TCP-terminating relay
    stamp "$NODED_DIR"
    if run systemctl restart swg-noded; then _noded_restarted=yes; ok "swg-node updated + restarted"; note "bare-metal swg-node: ${nold} → ${NEW_VER}"
    else DID_FAIL=yes; warn "couldn't restart swg-noded — run: systemctl restart swg-noded"; note "bare-metal swg-node: updated but RESTART FAILED"; fi
  else note "bare-metal swg-node: unchanged (${nold})"; fi
  # the ref moved and nothing restarted the daemon → restart it now, or it keeps following the branch it started on
  if [ "$NODE_REF_CHANGED" = yes ] && [ "$_noded_restarted" = no ] && ! $DRYRUN && systemctl is-active --quiet swg-noded 2>/dev/null; then
    if run systemctl restart swg-noded; then ok "swg-noded restarted — it reads the ref it follows only at startup"
    else DID_FAIL=yes; warn "couldn't restart swg-noded — it keeps the old ref until restarted: systemctl restart swg-noded"; fi
  fi
  ensure_noded_unit      # HEAL: recreate the swg-noded unit if it's gone (config.json is preserved)
  if log_ns_build "$NODED_DIR/swg-noded"; then ensure_log_ns swg-node swg-noded.service; fi   # HEAL, as for the panel
  ensure_noded_no_nnp    # MIGRATE: retract NoNewPrivileges — it blocked the AppArmor transition wg-quick/awg-quick need
  ensure_noded_reach_sweep "$NODED_DIR"   # HEAL: the drop-in that sweeps the device-access tables when an OLDER swg-noded starts
  ensure_wg_apparmor     # HEAL: let the confined wg CLI reach the UAPI sockets (wdtt / csqtt / awg-userspace)
  ensure_awg_datapath    # HEAL: install AmneziaWG if missing, rebuild its module, else userspace
  ensure_awg_pkg_follow  # FOLLOW: the amnezia packages to the PPA's build (module + tools); load it only where nothing uses it
  ensure_awg_quick_unit  # HEAL: the awg-quick@ template + the per-interface enable, so awg survives a reboot
  ensure_awg_back_on_kernel   # SURGICAL: interfaces left on the userspace fallback go back to the module once it loads
fi

# ───────────────────────── Docker (host / node / master) ─────────────────────────
docker_uses_upstream_images(){
  grep -Eq '^[[:blank:]]*image:[[:blank:]]*ghcr\.io/sanityprotocol/swg-(panel|node):' "$DOCKER_DIR/docker-compose.yml"
}

pull_docker_update_images(){
  local profile="$1" current="$DOCKER_DIR/docker-compose.yml" staged backup
  if ! docker_uses_upstream_images; then
    ( cd "$DOCKER_DIR" && on_tty $COMPOSE --profile "$profile" pull )
    return
  fi

  # Use a sibling of the installed Compose file so relative paths resolve during
  # the pull. Switch the installed file only when the images are available.
  staged="$(mktemp "$DOCKER_DIR/.swg-compose.XXXXXX")" || return 1
  if cp -p "$current" "$staged" &&
     sed -E '/^[[:blank:]]*image:[[:blank:]]*ghcr\.io\/sanityprotocol\/swg-(panel|node):/s@ghcr.io/sanityprotocol/swg-@ghcr.io/tesla-prep/swg-@;
             /^[[:blank:]]*SWG_TURN_IMAGE:[[:blank:]]*"?\$\{SWG_TURN_IMAGE:-ghcr\.io\/sanityprotocol\/swg-node:/s@ghcr.io/sanityprotocol/swg-node@ghcr.io/tesla-prep/swg-node@' "$current" > "$staged" &&
     ( cd "$DOCKER_DIR" && on_tty $COMPOSE --profile "$profile" -f "$staged" pull ) &&
     backup="$(mktemp "$current.before-tesla-prep.XXXXXX")" &&
     cp -p "$current" "$backup" && mv -f "$staged" "$current"; then
    note "docker-compose.yml: switched to ghcr.io/tesla-prep (backup: $(basename "$backup"))"
  else
    rm -f "$staged"
    return 1
  fi
}

if ! $NODE_ONLY && docker_stack_live; then
  found=1; doc_seen=yes
  if ! $DRYRUN; then   # the host timer units' systemd lines (lib/common.sh) — they start every 10–30 s
    docker_host_log_dropins
    [ "$DOCKER_LOG_DROPINS_CHANGED" -gt 0 ] && { systemctl daemon-reload 2>/dev/null || true; note "docker host timers: systemd's start/stop lines no longer logged"; }
  fi
  # which profile is running? prefer the marker install-docker.sh wrote into .env, else sniff containers
  prof="$(docker_profile)"
  if have docker && docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi
  case "$prof" in node|master|host-node)
    if ! $DRYRUN; then
      grep -qs route_localnet /etc/sysctl.d/99-swg-node.conf 2>/dev/null || printf 'net.ipv4.conf.all.route_localnet = 1\n' >> /etc/sysctl.d/99-swg-node.conf 2>/dev/null || true
      sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null 2>&1 || true
      turn_sock_buf_host   # the turn-family listeners' socket-buffer caps: the container cannot raise them either
      [ "$TURN_SOCK_BUF_CHANGED" = 1 ] && note "UDP socket-buffer caps raised on the host for turn-family listeners (99-swg-turn.conf; servers pick them up on their next restart)"
      [ "$TURN_SOCK_BUF_LOW" = 1 ] && note "UDP socket-buffer caps could not be raised on this host (net.core.{r,w}mem_max) — csqtt handshakes may fail under load"
    fi ;;
  esac
  # migrate existing docker panels: the panel matches a master's co-located node by the HOST hostname, which it
  # only learns via SWG_HOST_HOSTNAME — older .env/compose lack it (an update doesn't restage the compose), so add it.
  case "$prof" in host|master|host-node)
    if ! $DRYRUN && ! grep -q '^SWG_HOST_HOSTNAME=' "$DOCKER_DIR/.env" 2>/dev/null; then printf 'SWG_HOST_HOSTNAME=%s\n' "$(hostname 2>/dev/null)" >> "$DOCKER_DIR/.env"; fi
    if ! $DRYRUN && ! grep -q 'SWG_HOST_HOSTNAME' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
      python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYHN' && note "docker-compose.yml: added SWG_HOST_HOSTNAME (co-located node detection)"
import sys
f=sys.argv[1]; o=[]
for l in open(f).read().split("\n"):
    o.append(l)
    if "SWG_UPDATE_TRIGGER:" in l and "${SWG_UPDATE_TRIGGER" in l: o.append('      SWG_HOST_HOSTNAME: "${SWG_HOST_HOSTNAME:-}"')
open(f,"w").write("\n".join(o))
PYHN
    fi ;;
  esac
  case "$prof" in host|master|host-node)
    if ! $DRYRUN; then
      _hips="$(host_bindable_ips)"
      if [ -n "$_hips" ]; then
        if grep -q '^HOST_IPS=' "$DOCKER_DIR/.env" 2>/dev/null; then
          python3 - "$DOCKER_DIR/.env" "$_hips" <<'PYIP'
import sys
path, val = sys.argv[1], sys.argv[2]
lines = open(path).read().split("\n")
open(path, "w").write("\n".join(("HOST_IPS=" + val) if l.startswith("HOST_IPS=") else l for l in lines))
PYIP
        else printf 'HOST_IPS=%s\n' "$_hips" >> "$DOCKER_DIR/.env"; fi
      fi
    fi
    if ! $DRYRUN && ! grep -q 'SWG_HOST_IPS' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
      python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYHI' && note "docker-compose.yml: added SWG_HOST_IPS (Listen IP picker)"
import sys
f=sys.argv[1]; o=[]
for l in open(f).read().split("\n"):
    o.append(l)
    if "SWG_PANEL_BASE:" in l and "${PANEL_BASE" in l: o.append('      SWG_HOST_IPS: "${HOST_IPS:-}"')
open(f,"w").write("\n".join(o))
PYHI
    fi ;;
  esac
  case "$prof" in node|master|host-node)
    if ! $DRYRUN && ! grep -q 'SWG_NODE_SECCOMP' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
      python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYSC' && note "docker-compose.yml: added the seccomp knob (SWG_NODE_SECCOMP — needed to run csqtt)"
import sys
f=sys.argv[1]; o=[]
for l in open(f).read().split("\n"):
    o.append(l)
    if "cap_add:" in l and "NET_ADMIN" in l:
        o.append('    security_opt:')
        o.append('      - seccomp=${SWG_NODE_SECCOMP:-builtin}')
open(f,"w").write("\n".join(o))
PYSC
    fi ;;
  esac
  case "$prof" in node|master|host-node)
    if ! $DRYRUN && [ -s "$DOCKER_DIR/data/node/csqtt.json" ] \
       && ! grep -q '^SWG_NODE_SECCOMP=' "$DOCKER_DIR/.env" 2>/dev/null \
       && grep -q 'SWG_NODE_SECCOMP' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null \
       && grep -q '"iface"' "$DOCKER_DIR/data/node/csqtt.json" 2>/dev/null; then
      printf '%s\n' 'SWG_NODE_SECCOMP=unconfined   # this node runs csqtt servers, whose io_uring dataplane the default profile denies' \
        >> "$DOCKER_DIR/.env" \
        && note ".env: SWG_NODE_SECCOMP=unconfined (this node runs csqtt — its io_uring dataplane needs it)"
    fi ;;
  esac
  case "$prof" in node|master|host-node)
    if ! $DRYRUN && ! grep -q 'run/systemd/resolve' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null \
       && grep -q '\./data/node:/var/lib/swg-noded' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
      python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYRES' && note "docker-compose.yml: mounted the host's DNS server list read-only (networks behind a peer need it)"
import sys
f=sys.argv[1]; o=[]; done=False
for l in open(f).read().split("\n"):
    o.append(l)
    if not done and l.strip().startswith("- ./data/node:/var/lib/swg-noded"):
        o.append(l[:len(l)-len(l.lstrip())] + "- /run/systemd/resolve:/run/systemd/resolve:ro")
        done=True
open(f,"w").write("\n".join(o))
PYRES
    fi ;;
  esac
  case "$prof" in host|master|host-node)
    if ! $DRYRUN && [ -f "$DOCKER_DIR/docker-compose.yml" ] \
       && ! grep -q 'SWG_PANEL_CONSOLE_PORT' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null \
       && ! grep -q 'SWG_PANEL_CONSOLE_HOST' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
      python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYCON' && note "docker-compose.yml: added the operator console port (SWG_PANEL_CONSOLE_HOST/PORT + its loopback publish)"
import sys
f = sys.argv[1]
lines = open(f).read().split("\n")
out, did_port, did_env = [], False, False
for l in lines:
    out.append(l)
    if not did_port and l.strip() == '- "127.0.0.1:${PANEL_LOCAL_PORT:-8088}:${PANEL_LOCAL_PORT:-8088}"':
        out.append('      # The OPERATOR CONSOLE own port (Settings -> Panel URL -> "Its own address").')
        out.append('      # LOOPBACK by default; set CONSOLE_BIND=0.0.0.0 (or a host IP) in .env to publish, then firewall it.')
        out.append('      - "${CONSOLE_BIND:-127.0.0.1}:${CONSOLE_PORT:-8445}:${CONSOLE_PORT:-8445}"')
        did_port = True
    elif not did_env and "SWG_PANEL_BASE:" in l and "${PANEL_BASE" in l:
        out.append('      SWG_PANEL_CONSOLE_PORT: "${CONSOLE_PORT:-8445}"')
        out.append('      SWG_PANEL_CONSOLE_HOST: "${CONSOLE_BIND:-127.0.0.1}"')
        did_env = True
# all three lines or none — a half-applied migration is worse than the warning it silences
sys.exit(0 if (did_port and did_env and open(f, "w").write("\n".join(out)) is not None) else 1)
PYCON
    fi ;;
  esac
  if ! $DRYRUN && [ -f "$DOCKER_DIR/docker-compose.yml" ]; then
    _cbak="$DOCKER_DIR/docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
    cp -p "$DOCKER_DIR/docker-compose.yml" "$_cbak" 2>/dev/null || _cbak=""
    if python3 - "$DOCKER_DIR/docker-compose.yml" "$DOCKER_DIR/.env" <<'PYTAG'

import re, sys
comp, envf = sys.argv[1], sys.argv[2]
text = orig = open(comp).read()
owner = "sanityprotocol" if re.search(r"(?m)^\s*image:\s*ghcr\.io/sanityprotocol/swg-node:", text) else "tesla-prep"
TURN = ('      SWG_TURN_IMAGE: "${SWG_TURN_IMAGE:-ghcr.io/' + owner + '/swg-node:${SWG_IMAGE_TAG:-latest}}"'
        '  # image swg-noded runs each turn-proxy container from')

# a) the service images themselves
pat = re.compile(r'^(\s*image:\s*ghcr\.io/(?:sanityprotocol|tesla-prep)/swg-(?:panel|node)):([^\s$]+)\s*$', re.M)
pins = {m.group(2) for m in pat.finditer(text)}
text = pat.sub(lambda m: m.group(1) + ":${SWG_IMAGE_TAG:-latest}", text)

# b) the turn image the NODE is handed. An older compose hardcodes `:latest` as the DEFAULT here, which is
#    why a node moved to a new tag kept starting its turn proxies from main: the variable it reads never
#    followed the tag. Rewrite the stale default; a value the operator set explicitly in .env still wins.
# the trailing comment is part of the shipped line, so the pattern has to tolerate one
tpat = re.compile(r'^\s*SWG_TURN_IMAGE:\s*"?\$\{SWG_TURN_IMAGE:-ghcr\.io/sanityprotocol/swg-node:(?!\$)[^}"]*\}"?[^\n]*$', re.M)
text = tpat.sub(TURN, text)

# c) ...or add it, when the compose predates the variable entirely
if "SWG_TURN_IMAGE" not in text:
    out = []
    for l in text.split("\n"):
        out.append(l)
        if "SWG_HOST_NODE_DIR:" in l:
            out.append(TURN)
    text = "\n".join(out)

if text == orig:
    raise SystemExit(1)          # nothing to migrate — stay quiet
open(comp, "w").write(text)
# carry a deliberate pin across, so the interpolation resolves to what was baked in
pins.discard("latest")
if len(pins) == 1:
    pin = pins.pop()
    try:    env = open(envf).read()
    except OSError: env = ""
    if not re.search(r'^SWG_IMAGE_TAG=', env, re.M):
        with open(envf, "a") as f:
            f.write(("" if env.endswith("\n") or not env else "\n") + "SWG_IMAGE_TAG=%s\n" % pin)
PYTAG
    then note "docker-compose.yml: image tags now follow SWG_IMAGE_TAG (was baked literal)${_cbak:+ — backup: $(basename "$_cbak")}"
    else [ -n "$_cbak" ] && rm -f "$_cbak"; true      # nothing migrated → nothing to roll back to
    fi
  fi
  if ! $DRYRUN && ! grep -q 'SWG_LATEST_URL' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
    python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYLU' && note "docker-compose.yml: added SWG_LATEST_URL (lets a docker panel track a pre-release channel)"
import sys
f = sys.argv[1]
text = open(f).read()
if "SWG_LATEST_URL" in text:
    raise SystemExit(1)          # self-guarding: a second run must not append a duplicate key
o = []
for l in text.split("\n"):
    if "SWG_UPDATE_TRIGGER:" in l and "${SWG_UPDATE_TRIGGER" in l:
        o.append('      SWG_LATEST_URL: "${SWG_LATEST_URL:-}"')
    o.append(l)
open(f, "w").write("\n".join(o))
PYLU
  fi
  if ! $DRYRUN && ! grep -q 'x-logging:' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
    python3 - "$DOCKER_DIR/docker-compose.yml" <<'PYLG' && note "docker-compose.yml: capped container logs at 10m x 3 per service"
import sys
f=sys.argv[1]; o=[]
for l in open(f).read().split("\n"):
    if l.rstrip() == "services:":
        o += ['x-logging: &logging', '  driver: json-file', '  options:',
              '    max-size: "10m"', '    max-file: "3"', '']
    o.append(l)
    if l.strip().startswith("container_name: swg-"):
        o.append('    logging: *logging')
open(f,"w").write("\n".join(o))
PYLG
  fi
  if [ -f "$REPO/docker/docker-compose.yml" ]; then
    _drift="$(python3 - "$REPO/docker/docker-compose.yml" "$DOCKER_DIR/docker-compose.yml" "$prof" "$DOCKER_DIR/.env" 2>/dev/null <<'PYDRIFT'
import os, re, sys

# The installer DISABLES two things by commenting them rather than deleting (host networking): the node's
# `ports:` / `sysctls:` blocks and their items. Un-comment ONLY those shapes — stripping '#' from every line
# let a prose comment ("# NOTE: the installer puts the node on ...") mint an env token of its own.
_UNCOMMENT = (re.compile(r'^(\s*)#\s{0,3}(- .*)$'), re.compile(r'^(\s*)#\s?((?:ports|sysctls):).*$'))

def tokens(text):
    """What this compose FILE offers -> ({token: the services carrying it}, {service: its profiles},
    {(env token, service): VAR} for a key whose whole value is "${VAR:-}")."""
    out, profiles, optvar, service, in_services = {}, {}, {}, "", False
    add = lambda t, svc: out.setdefault(t, set()).add(svc)    # a set: swg-panel and swg-node share keys
    for raw in text.splitlines():
        line = raw.rstrip()
        for rx in _UNCOMMENT:
            m = rx.match(line)
            if m:
                line = m.group(1) + m.group(2); break
        if re.match(r'^[a-z-]+:', line):
            in_services = line.startswith("services:"); service = ""
            if line.startswith("x-"):
                add("anchor:" + line.split(":")[0], "")
            continue
        if in_services and re.match(r'^  [a-z0-9-]+:\s*$', line):
            service = line.strip().rstrip(":"); add("service:" + service, service); continue
        m = re.match(r'^\s{6}([A-Z_][A-Z0-9_]*):\s', line)
        if m:
            add("env:" + m.group(1), service)
            v = re.match(r'^\s{6}[A-Z_][A-Z0-9_]*:\s*"?\$\{([A-Za-z_][A-Za-z0-9_]*):-\}"?\s*(?:#.*)?$', line)
            if v:
                optvar[("env:" + m.group(1), service)] = v.group(1)
            continue
        m = re.match(r'^\s*-\s*"?([^"#]+?)"?\s*(?:#.*)?$', line)
        if m:
            v = m.group(1).strip()
            if re.search(r':\d+(/(udp|tcp))?$', v) or re.search(r'\}:\$?\{?[A-Za-z_]', v):
                add("port:" + re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}', r'$\1', v).split(":")[-1], service)
            elif v.startswith("./") or v.startswith("/"):
                add("volume:" + (v.split(":")[1] if ":" in v else v), service)
            else:
                add("opt:" + v.split("=")[0].strip(), service)
            continue
        m = re.match(r'^\s{4}(security_opt|logging|network_mode|cap_add|devices|sysctls|profiles|restart):', line)
        if m and service:
            add("key:%s.%s" % (service, m.group(1)), service)
            if m.group(1) == "profiles":          # one-line flow list only; any other shape reads [] = filters nothing
                f = re.match(r'^\s{4}profiles:\s*\[([^\]]*)\]', line)
                profiles[service] = re.findall(r'[A-Za-z0-9_-]+', f.group(1)) if f else []
    return out, profiles, optvar

try:
    (ship, profiles, optvar), (inst, _, _) = (tokens(open(p).read()) for p in sys.argv[1:3])
except Exception:
    sys.exit(0)                                   # unreadable either side -> say nothing, never block an update
# A key whose whole value is "${VAR:-}" hands the container VAR from .env, or nothing: missing, it changes something only
# where .env gives VAR a value. A Docker node was told to re-run the installer for SWG_NFT_CLI_ONLY, an opt-in nobody sets
# (1.8.9). SWG_UPDATE_TRIGGER has the same shape and the installer does set it, so a copy without it is still named. No
# readable .env -> every such key counts, as before. Compose also takes VAR from the shell running it (this update's own
# environment, which wins over .env), and a value that names another variable ("${OTHER}") cannot be resolved here: both
# count as set — the report errs toward naming.
env = None
try:
    env = {}
    for l in open(sys.argv[4]).read().splitlines():
        k, eq, v = l.strip().partition("=")
        k = k.strip()
        if k.startswith("export "):
            k = k[7:].strip()
        if eq and k and not k.startswith("#"):
            env[k] = v.split(" #")[0].strip().strip('"').strip("'")
except Exception:
    env = None
def matters(t, svc):
    var = optvar.get((t, svc))
    if env is None or var is None or os.environ.get(var):
        return True
    return bool(env.get(var))
# Only what THIS update starts: argv[3] is $prof, the profile its own `compose up` takes, so the report and the
# recreate agree on what the box runs. The file carries every role's services, and a node was told its copy lacked the
# panel's SWG_PANEL_SUB_BIND / _PORT — keys of a container it never runs (1.8.8, a client's node update).
# A service with no `profiles:` runs under every profile; an unknown profile, or a `profiles:` this reader cannot parse,
# filters nothing. A shipped key both services carry (SWG_UPDATE_TRIGGER) counts for each service it runs, and is
# missing for each service whose installed block lacks it: (token, service) pairs on both sides. A flat set of the
# installed tokens read a master's swg-node without the trigger as complete, because swg-panel had it (the key reached
# the two services in separate commits).
prof = sys.argv[3] if len(sys.argv) > 3 else ""
runs = lambda svc: not svc or not prof or prof in (profiles.get(svc) or [prof])
missing = {t: {o for o in owners if o not in inst.get(t, ()) and runs(o) and matters(t, o)} for t, owners in ship.items()}
missing = {t: owners for t, owners in missing.items() if owners}
gone = set(o for t, owners in missing.items() if t.startswith("service:") for o in owners)
rest = sorted(t for t, owners in missing.items() if not t.startswith("service:") and owners - gone)
if not missing:
    sys.exit(0)
print("%d|%s|%s" % (len(gone) + len(rest), ",".join(sorted(gone)), " ".join(rest)))
PYDRIFT
)"
    if [ -n "$_drift" ]; then
      _dn="${_drift%%|*}"; _rest="${_drift#*|}"; _dsvc="${_rest%%|*}"; _dtok="${_rest#*|}"
      echo
      warn "$DOCKER_DIR/docker-compose.yml predates this release — $_dn thing(s) it ships are not in your copy."
      [ -n "$_dsvc" ] && sub "  missing service(s): $(b "$_dsvc")   (with everything inside them)"
      [ -n "$_dtok" ] && sub "  also missing: $_dtok"
      sub "  An update PATCHES this file key by key and cannot add these — they reach fresh installs only."
      sub "  To restage it, re-run the Docker installer: it re-copies docker-compose.yml and re-applies your .env."
      sub "  On $(b bridge) networking, re-publish any extra interface UDP ports afterwards — a restage keeps"
      sub "  only the bootstrap port."
      # The migrations above are all `! $DRYRUN`-guarded, so on a dry run they have not touched the file and
      # this list still contains the ones a real update WOULD add. Say so rather than overstate the backlog.
      $DRYRUN && sub "  (dry-run: the migrations above were skipped, so a real update would already add some of these)"
      note "docker-compose.yml: $_dn shipped item(s) MISSING (older than this release — re-run the installer to restage)"
    fi
  fi
  ensure_netctl_docker "$prof"   # the docker address helper: healed if a panel-bearing host lacks it, its drainer at this release
  ensure_netctl_docker_gate "$prof"   # …and its idle gate (written when missing or different — see there)
  ensure_update_unit_docker "$prof"   # HEAL: install the docker one-click self-update wiring if a panel-bearing host lacks it
  case "$prof" in host|master|host-node)
    ensure_access_seed                  # HEAL: fill any EMPTY Access & TLS settings (public URL / TLS type) from .env
    $DRYRUN || ensure_docker_mask_files "$DOCKER_DIR"   # HEAL: pre-create the files swg-sub /dev/null-masks (a pre-fix install may lack them → recreate would fail)
    if ! $DRYRUN; then _env_pw="$(sed -n 's/^PANEL_PASSWORD=//p' "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p)"
      docker_env_forget_password "$DOCKER_DIR" 0
      [ "$(sed -n 's/^PANEL_PASSWORD=//p' "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p)" = "$_env_pw" ] || ENV_PW_LEFT=yes; fi
  ;; esac
  if grep -qE '^[[:space:]]*build:' "$DOCKER_DIR/docker-compose.yml" 2>/dev/null; then
    # build-from-source deployment → restage the source and rebuild (don't touch the user's compose/.env)
    if should_update "docker ($prof, source build)" "$DOCKER_DIR"; then
      info "restaging source + rebuilding ($DOCKER_DIR)"
      run stage_docker_context "$REPO" "$DOCKER_DIR" || die "could not stage the Docker build context"
      stamp "$DOCKER_DIR"
      rescue_container_confs "$prof"
      if $DRYRUN; then echo "    [skip] (cd $DOCKER_DIR && $COMPOSE --profile $prof up -d --build)"; note "docker ($prof): would rebuild"
      elif ! docker_ports_preflight "$prof"; then DID_FAIL=yes; note "docker ($prof): REFUSED — a published port is held by another process"
      else ( cd "$DOCKER_DIR" && on_tty $COMPOSE --profile "$prof" up -d --build ) && { ok "docker ($prof) rebuilt + restarted"; note "docker ($prof): rebuilt"; } || { DID_FAIL=yes; warn "compose rebuild failed — check $DOCKER_DIR"; note "docker ($prof): rebuild FAILED"; }; fi
    else note "docker ($prof): unchanged"; fi
  else
    # prebuilt-image deployment (default) → just pull the newest image + recreate (no restaging)
    echo
    if confirm "Pull the latest image for $(col_l "docker ($prof)")?"; then
      info "pulling the latest image ($DOCKER_DIR)"
      # a COMMIT (bootstrap's SWG_COMMIT — going back by commit) moves the scripts, not the containers: said (SOAK-3)
      if [ -n "${SWG_COMMIT:-}" ] && [ -z "${SWG_IMAGE_TAG:-}" ] && ! grep -qs '^SWG_IMAGE_TAG=[^[:space:]#]' "$DOCKER_DIR/.env"; then
        warn "updating to commit $(b "$SWG_COMMIT"), but the containers run the published $(b latest) image — for that commit's own, set $(b "SWG_IMAGE_TAG=sha-${SWG_COMMIT:0:7}") in $DOCKER_DIR/.env (kept for every release commit) and re-run"; fi
      if $DRYRUN; then
        if docker_uses_upstream_images; then note "docker-compose.yml: would switch shipped images to ghcr.io/tesla-prep after a successful pull"; fi
        DID_UPDATE=yes; echo "    [skip] (cd $DOCKER_DIR && $COMPOSE --profile $prof pull && $COMPOSE --profile $prof up -d --force-recreate)"; note "docker ($prof): would pull + recreate"
      elif ! docker_ports_preflight "$prof"; then DID_FAIL=yes; note "docker ($prof): REFUSED — a published port is held by another process"
      elif ! pull_docker_update_images "$prof"; then
        DID_FAIL=yes; note "docker ($prof): pull FAILED — nothing was touched"
        warn "could not pull the new image — the containers are still running on the current one, nothing was
       touched. Check the box can reach ghcr.io (and has disk space), then re-run the update."
      elif docker_images_current "$prof"; then
        _pc0="$(docker inspect -f '{{.Created}}' swg-panel 2>/dev/null || true)"
        ( cd "$DOCKER_DIR" && on_tty $COMPOSE --profile "$prof" up -d ) \
          && { _pc1="$(docker inspect -f '{{.Created}}' swg-panel 2>/dev/null || true)"
               if [ "${ENV_PW_LEFT:-no}" = yes ] && [ "$_pc0" != "$_pc1" ]; then ok "docker ($prof) already runs the newest image — only the panel's container re-created, without the password"
               elif [ "${ENV_PW_LEFT:-no}" = yes ]; then ok "docker ($prof) already runs the newest image — nothing recreated (the panel's container did not hold the password)"
               else ok "docker ($prof) already runs the newest image — nothing recreated"; fi; note "docker ($prof): unchanged — the newest image already runs"; } \
          || { DID_FAIL=yes; warn "compose up failed — check $DOCKER_DIR"; note "docker ($prof): up FAILED"; }
      else
        DID_UPDATE=yes
        rescue_container_confs "$prof"
        # a master's node reports with the agent config inside its container — copied out now, for the seed below
        _seedcfg=""; case "$prof" in master|host-node)
          _seedcfg="$(mktemp)" && { docker exec swg-node cat /etc/swg-agent/config.json > "$_seedcfg" 2>/dev/null || : > "$_seedcfg"; };; esac
        for _c in $(case "$prof" in node) echo swg-node;; host) echo swg-panel;; *) echo swg-panel swg-node;; esac); do docker ps -aq -f "name=$_c" 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true; done   # drop any half-recreated/leftover container so `up` can't hit "container name already in use"
        [ -n "$_seedcfg" ] && { seed_docker_node_ep "$_seedcfg"; rm -f "$_seedcfg"; }   # the panel is down now — see seed_docker_node_ep
        ( cd "$DOCKER_DIR" && on_tty $COMPOSE --profile "$prof" up -d --force-recreate ) && { ok "docker ($prof) image pulled + recreated"; note "docker ($prof): image pulled + recreated"; } || { DID_FAIL=yes; warn "compose up failed — check $DOCKER_DIR"; note "docker ($prof): up FAILED"; }; fi
    else warn "docker ($prof): skipped"; note "docker ($prof): skipped"; fi
  fi
fi

# a Docker panel installed before round 9b still holds its password in .env — it leaves once the panel holds it
if [ "$HAVE_DOCK" = yes ] && ! $DRYRUN && case "$DOCK_PROF" in host|master|host-node) true;; *) false;; esac \
   && docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; then
  docker_env_forget_password "$DOCKER_DIR" 60
fi

# WireGuard / AmneziaWG datapath
if $NO_COMPONENTS && [ "$HAVE_BNODE" = yes ]; then
  if [ "$AWG_PKG_ROUTE" = yes ]; then ok "$(col_l "WireGuard / AmneziaWG"): the AmneziaWG module and tools follow the amnezia PPA (above); other packages skipped (--no-components)"
  else ok "$(col_l "WireGuard / AmneziaWG"): skipped — third-party datapath (--no-components: swg programs only)"; fi
elif [ "$HAVE_BNODE" = yes ]; then
  pkg_update "WireGuard / AmneziaWG" amneziawg amneziawg-tools amneziawg-dkms wireguard wireguard-tools
elif [ "$HAVE_DOCK" = yes ] && [ "$DOCK_PROF" != host ]; then
  ok "$(col_l "WireGuard / AmneziaWG"): bundled in the swg-node image — no separate package to update (it tracks the image)"
fi

# ───────────────────────── Docker engine (docker scenario only) ─────────────────────────
if [ "$HAVE_DOCK" = yes ] && $NO_COMPONENTS; then
  ok "$(col_l "Docker engine"): skipped — third-party (--no-components: swg programs only)"
elif [ "$HAVE_DOCK" = yes ]; then
  pkg_update "Docker engine" docker-ce docker.io
fi

# turn-proxy servers (vk-turn-proxy, ones we installed)
TURN_DIR="${TURN_DIR:-/opt/vk-turn-proxy}"
turn_check_one(){   # <key> <dir/ holding server+version.txt+repo.txt> <fork|inst>
  local key="$1" d="$2" mode="$3" owner cur latest arch url u svc any=no restart_ok=yes
  owner="$(cat "${d}repo.txt" 2>/dev/null || echo '?')"; cur="$(cat "${d}version.txt" 2>/dev/null || echo '?')"
  # samosvalishe deleted its repo (2026-10); hackdiaz-dev carries free-turn-proxy on — same releases and assets.
  [ "$owner" = "samosvalishe/free-turn-proxy" ] && { owner="hackdiaz-dev/free-turn-proxy"; $DRYRUN || printf %s "$owner" > "${d}repo.txt" 2>/dev/null || true; }
  if $DRYRUN; then latest="v0.0.0-latest"
  else sub "checking turn-proxy $(col_l "$key") ($owner) for a newer release on GitHub…"   # network call — say so (and cap it) so it never looks hung
    latest="$(curl -fsSL --connect-timeout 10 --max-time 20 "https://api.github.com/repos/$owner/releases/latest" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tag_name",""))' 2>/dev/null || true)"; fi
  [ -n "$latest" ] || { warn "turn-proxy $key ($owner): couldn't reach GitHub for the latest release — skipping"; return; }
  if [ "$cur" = "$latest" ] && ! $FORCE; then ok "$(col_l "turn-proxy $key") ($owner): already up to date ($cur)"; return; fi
  echo
  if confirm "Upgrade $(col_l "turn-proxy $key") ($owner) $(col_v "$cur → $latest")?"; then
    DID_UPDATE=yes
    case "$(uname -m)" in x86_64|amd64) arch=amd64;; aarch64|arm64) arch=arm64;; *) arch="";; esac
    # detect-and-REFUSE: forks publish server-linux-amd64/arm64 only — never grab a wrong-arch binary on unknown arch
    [ -n "$arch" ] || { warn "no turn-proxy build for $(uname -m) — forks publish amd64/arm64 only; skipping"; return; }
    url="https://github.com/$owner/releases/latest/download/server-linux-$arch"
    info "updating turn-proxy $key ($owner)"
    if run curl -fsSL "$url" -o "${d}server.new" && run chmod +x "${d}server.new" && run mv "${d}server.new" "${d}server"; then
      $DRYRUN || printf '%s\n' "$latest" > "${d}version.txt"
      # restart the RUNNING instance(s) to pick up the new binary — try-restart never STARTS a stopped one
      if [ "$mode" = fork ]; then
        for u in /etc/systemd/system/vk-turn-proxy-"$key"-*.service; do [ -e "$u" ] || continue; any=yes
          svc="$(basename "$u" .service)"; run systemctl try-restart "$svc" || restart_ok=no; done
      else any=yes; run systemctl try-restart "vk-turn-proxy-$key" || restart_ok=no; fi
      if   [ "$any" = no ];          then ok "turn-proxy $key updated (no running instance to restart)"
      elif [ "$restart_ok" = yes ];  then ok "turn-proxy $key updated + restarted"
      else DID_FAIL=yes; warn "couldn't restart vk-turn-proxy-$key"; note "turn-proxy $key: updated but RESTART FAILED"; fi
    else DID_FAIL=yes; warn "turn-proxy $key: download failed ($url)"; note "turn-proxy $key: download FAILED"; fi
  else warn "turn-proxy $key: skipped (still $cur)"; fi
}
if $NO_COMPONENTS && [ -d "$TURN_DIR" ]; then
  info "skipping third-party components (turn-proxy servers) — --no-components"
elif [ -d "$TURN_DIR" ]; then
  for d in "$TURN_DIR"/.bin/*/; do   # shared fork binaries (current layout) — restart all the fork's instances
    [ -f "${d}server" ] && [ -f "${d}version.txt" ] || continue
    found=1; turn_check_one "$(basename "$d")" "$d" fork
  done
  for d in "$TURN_DIR"/*/; do        # legacy standalone instances (own REAL binary, not a symlink into .bin)
    [ -f "${d}server" ] && [ ! -L "${d}server" ] && [ -f "${d}version.txt" ] || continue
    found=1; turn_check_one "$(basename "$d")" "$d" inst
  done
fi

[ "$found" = 1 ] || die "no swg-panel install found (looked in $PANEL_DIR, $NODED_DIR, $DOCKER_DIR, $TURN_DIR)"
# call out swg components that weren't present, so a partial-looking run is never a mystery
[ "$pan_seen" = yes ] || note "bare-metal swg-panel: not installed ($PANEL_DIR)"
[ "$nod_seen" = yes ] || note "bare-metal swg-node: not installed ($NODED_DIR)"
[ "$doc_seen" = yes ] || note "docker: not installed ($DOCKER_DIR)"
if [ "$DID_FAIL" = no ] && [ "$DID_UPDATE" = no ]; then lc_emit uptodate; lc_handoff; fi
echo
if   [ "$DID_FAIL" = yes ]; then echo "${C_RED}✗${RESET} Update finished with errors — some components FAILED (see the summary below)."
# ⚠️ A HEAL IS A CHANGE. Every ensure_* that installs a missing piece sets DID_UPDATE (+ a note) — they did not, and a run
# printed "✓ docker address helper healed" and then "✓ Update finished — nothing changed." two lines apart.
elif [ "$DID_UPDATE" = no ]; then ok "Update finished — nothing changed."
else                              ok "Update complete."; fi
if [ "${#RESULTS[@]}" -gt 0 ]; then   # only ACTUAL changes — drop the inventory notes (absent / unchanged / skipped components aren't "changes")
  _chg=(); for r in "${RESULTS[@]}"; do case "$r" in *"not installed"*|*unchanged*|*skipped*) :;; *) _chg+=("$r");; esac; done
  if [ "${#_chg[@]}" -gt 0 ]; then echo; info "Components changed this run:"; for r in "${_chg[@]}"; do echo "    • $r"; done; fi
fi
[ "$DID_FAIL" = no ] && ! $DRYRUN && print_summary UPDATE   # then the unified per-server summary (same shape as install / convert)
if $DRYRUN; then ok "DRY RUN done — nothing changed."; fi
if [ "$DID_FAIL" = yes ]; then exit 1; fi   # non-zero → the lc EXIT trap reports "update-failed" with the log tail
exit 0   # all good — status 0 so the trap reports "updated" (or the uptodate handoff above stands)
