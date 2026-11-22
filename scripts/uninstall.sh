#!/usr/bin/env bash
# Поэтапное удаление компонентов с отдельными вопросами о данных.
set -uo pipefail   # not -e: an uninstaller should keep going even if a piece is gone
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

DRYRUN=false; ASSUME_YES=false
for a in "$@"; do case "$a" in --dry-run) DRYRUN=true;; -y|--yes) ASSUME_YES=true;; esac; done

c(){ printf '\033[%sm' "$1"; }
info(){ echo "$(c '38;5;39')▸$(c 0) $*"; }   # universal flags: ▸ light-blue, :: blue, ✓ green, ! brown, ✗ red
sub(){  echo "$(c '38;5;33')::$(c 0) $*"; }
ok(){   echo "$(c '0;32')✓$(c 0) $*"; }
warn(){ echo "$(c '38;5;130')!$(c 0) $*" >&2; }
die(){  echo "$(c '0;31')✗ $*$(c 0)" >&2; exit 1; }
b(){ printf '\033[1m%s\033[0m' "$*"; }
run(){ if $DRYRUN; then echo "    [dry] $*"; else "$@"; fi; }
rmrf(){ local p; for p in "$@"; do if [ -e "$p" ] || [ -L "$p" ]; then run rm -rf "$p"; fi; done; }
rm_netctl_gate_if_last(){
  local a bare=1 dock=1; for a in "$@"; do case $a in bare-gone) bare=0;; docker-gone) dock=0;; esac; done
  { [ $bare = 1 ] && [ -e "$SD/swg-netctl.service" ]; } || rmrf /run/swg-netctl.due
  { [ $bare = 1 ] && [ -e "$SD/swg-netctl.service" ]; } || { [ $dock = 1 ] && [ -e "$SD/swg-netctl-docker.service" ]; } \
    || rmrf /usr/local/bin/swg-netctl-due
  return 0
}
# Drop a directory only once nothing is left in it. Used where a `rm -rf` would take a file this run
# deliberately KEPT — a foreign interface's .conf and its keys living in the same directory as ours.
rmdir_if_empty(){ local d="$1"
  [ -d "$d" ] || return 0
  if [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
    $DRYRUN && echo "    [dry] keeping $d (still holds files this run did not remove)" \
            || info "  keeping $(b "$d") — it still holds files this run did not remove"
    return 0
  fi
  run rmdir "$d"
}
# WHAT THIS RUN KEEPS NEVER HOLDS AN ID IT FREES
_SEAL_GLOBS='/etc/swg-panel*.converted-* /etc/swg-panel*.uninstalled-* /var/lib/swg-panel*.converted-* /var/lib/swg-panel*.uninstalled-* /opt/swg-panel*.converted-* /opt/swg-panel*.uninstalled-* /opt/swg-panel*.pre-convert-*'
_seal_archive(){ local p
  for p in "$@"; do
    [ -e "$p" ] && [ ! -L "$p" ] || continue
    run chown -R -h root:root "$p" 2>/dev/null || true
    run chmod -R g-ws,o-w "$p" 2>/dev/null || true
    if [ -d "$p" ]; then run chmod 700 "$p" 2>/dev/null || true; fi
  done
  return 0; }
_seal_archives(){ local p
  for p in $_SEAL_GLOBS "$DOCKER_DIR".converted-* "$DOCKER_DIR".uninstalled-* "$DOCKER_DIR".pre-convert-*; do [ -e "$p" ] && _seal_archive "$p"; done
  return 0; }
# hand_ids_to_root <name…> — each name's uid (a user of that name) and gid (a group of that name): every path under what
# swg owns on this box (never a container's storage, never anything else of the operator's) carrying it goes to root.
hand_ids_to_root(){
  local n id r roots=()
  for r in /etc/swg-panel* /etc/swg-sub* /etc/swg-agent* /var/lib/swg-panel* /var/lib/swg-noded* /var/lib/swg-recovery* \
           /opt/swg* /srv/swg* /var/www/wgstats* /var/log/swg* /etc/wireguard /etc/amnezia "$DOCKER_DIR" "$DOCKER_DIR".*; do
    if [ -e "$r" ] && [ ! -L "$r" ]; then roots+=("$r"); fi
  done
  if [ "${#roots[@]}" -gt 0 ]; then
    for n in "$@"; do
      id="$(id -u "$n" 2>/dev/null || true)"
      if [ -n "$id" ] && [ "$id" != 0 ]; then run find "${roots[@]}" -xdev -uid "$id" -exec chown -h root {} + 2>/dev/null || true; fi
      id="$(getent group "$n" 2>/dev/null | cut -d: -f3 || true)"
      if [ -n "$id" ] && [ "$id" != 0 ]; then run find "${roots[@]}" -xdev -gid "$id" -exec chgrp -h root {} + 2>/dev/null || true; fi
    done
  fi
  _seal_archives
  return 0; }
ufw_forget(){ local f="$1" r p left=""
  command -v ufw >/dev/null 2>&1 || return 0
  if [ -f "$f" ]; then
    while IFS= read -r r; do
      case "$r" in [0-9]*/tcp) ;; *) continue;; esac
      if run sh -c "ufw delete allow '$r' >/dev/null 2>&1"; then info "  removed the ufw rule 'allow $r' the installer added"
      else left="$left$r"$'\n'; fi
    done < "$f"
    if ! $DRYRUN; then
      if [ -n "$left" ]; then printf '%s' "$left" > "$f" 2>/dev/null || true; else rm -f "$f" 2>/dev/null || true; fi
    fi
    return 0
  fi
  p="$(sed -n 's/^PORT=//p' "$(dirname "$f")/install.conf" 2>/dev/null | sed -n 1p)"
  [ -n "$p" ] && grep -q '^SERVE_MODE=internal$' "$(dirname "$f")/install.conf" 2>/dev/null \
    && ufw show added 2>/dev/null | grep -cx "ufw allow $p/tcp" >/dev/null \
    && info "  ufw still allows $p/tcp — an older installer opened it for the panel; if nothing else needs it: ufw delete allow $p/tcp"
  return 0; }
# ask_yn <prompt> <default> <outvar>  — preset outvar (env) or --yes skips the prompt
ask_yn(){ local v p="$1" d="${2:-n}"
  if [ -n "${!3:-}" ]; then case "${!3}" in [Yy]*) printf -v "$3" yes;; *) printf -v "$3" no;; esac
    echo "$p ${!3}  (given — not asked)"; return; fi   # said, like the installers' prompts (1.8.8 qualification, round 5)
  if ! swg_tty_ok; then case "$d" in [Yy]*) printf -v "$3" yes;; *) printf -v "$3" no;; esac
    echo "$p ${!3}  (no terminal — default taken)"; return; fi
  read -rp "$p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " v <"${SWG_TTY:-/dev/tty}" || true
  v="${v:-$d}"; case "$v" in [Yy]*) printf -v "$3" yes;; *) printf -v "$3" no;; esac; echo; }   # one trailing blank after the prompt
ask_comp(){ local v verb="${3:-Uninstall}" noauto="${4:-}"
  if [ "$noauto" = never-auto ]; then
    if ! swg_tty_ok; then info "Kept — this one is never decided unattended. Re-run from a terminal to choose."; return 1; fi
  elif $ASSUME_YES; then return 0; fi
  if ! swg_tty_ok; then return 1; fi   # no usable tty, not --yes => keep
  read -rp "  $verb $(b "$1")${2:+  ($(c '0;90')$2$(c 0))}? (y/N): " v <"${SWG_TTY:-/dev/tty}" || true
  case "$v" in [Yy]*) return 0;; *) return 1;; esac; }

[ "$(id -u)" = 0 ] || $DRYRUN || die "run as root (or use --dry-run)"
$DRYRUN && info "DRY RUN — nothing will be changed."

DOCKER_DIR="${SWG_DOCKER_DIR:-/opt/swg-panel-docker}"
TURN_DIR="${TURN_DIR:-/opt/vk-turn-proxy}"
WDTT_DIR="${WDTT_DIR:-/opt/swg-wdtt}"     # WDTT servers: per-instance config-dir (identity + passwords) + .bin/<fork> shared binaries
CSQTT_DIR="${CSQTT_DIR:-/opt/swg-csqtt}"  # csqtt servers: per-instance config-dir (password store) + .bin/<arch> shared binary
rec_paths(){ printf '%s %s\n' "${SWG_NODED_STATE:-/var/lib/swg-noded}/$1" "/etc/swg-agent/$1"; }
SD="${SYSTEMD_DIR:-/etc/systemd/system}"   # overridable for testing

unit_dir_writable(){ local p="$SD/.swg-uninstall-probe.$$"
  ( : > "$p" ) 2>/dev/null || return 1; rm -f "$p"; return 0; }
unit_dir_immutable(){   # would a unit written here be unable to stick, whoever we are?
  [ -e /etc/NIXOS ] && return 0
  grep -qsE '^ID="?nixos"?[[:space:]]*$' /etc/os-release && return 0
  local o=""
  command -v findmnt >/dev/null 2>&1 && o="$(findmnt -no OPTIONS --target "$SD" 2>/dev/null)"
  if [ -z "$o" ]; then   # no findmnt, or it could not answer: longest matching mount point in /proc/mounts
    local rp; rp="$(readlink -f "$SD" 2>/dev/null || echo "$SD")"
    o="$(awk -v p="$rp/" 'BEGIN{best=0}
           { mp=$2; if (mp != "/") mp=mp"/"
             if (index(p, mp)==1 && length(mp)>=best) { best=length(mp); opt=$4 } }
           END{ print opt }' "${PROC_MOUNTS:-/proc/mounts}" 2>/dev/null)"
  fi
  case ",$o," in *,ro,*) return 0 ;; esac
  return 1
}
if [ -d "$SD" ] && ! unit_dir_writable && { [ "$(id -u)" = 0 ] || unit_dir_immutable; }; then
  if [ -e /etc/NIXOS ] || grep -qsE '^ID="?nixos"?[[:space:]]*$' /etc/os-release; then
    die "NixOS detected — this uninstaller must not run here.
    Every \`systemctl disable --now\` below fails on a read-only unit directory, and this script
    keeps going without -e, so it would delete /opt/swg-* and /var/lib/swg-* while every service
    kept running.

    Turn them off in the configuration that declares them, and rebuild:
        services.swg-panel.enable = false;   # and/or services.swg-node.enable = false;
    Then remove whatever state you no longer want: /var/lib/swg-panel, /var/lib/swg-noded,
    /etc/swg-panel, /etc/amnezia/amneziawg.
    A node removed this way never signs off, so the panel keeps showing it — delete it there too."
  fi
  # Says what was OBSERVED, not what was concluded from it. Reaching here means either we are root and a
  # real write failed, or the mount itself reports `ro` — "read-only" was a guess in the first case.
  die "cannot write to $SD, so nothing here could be disabled — either this host's services are managed
    declaratively (NixOS?), or the directory sits on a read-only mount.
    Remove the swg services from your system configuration and rebuild instead. Running this
    uninstaller here would delete /opt/swg-* and /var/lib/swg-* while every service kept running."
fi
DOCKER_DATA_DEL="${DOCKER_DATA_DEL:-}"; DOCKER_KEEP_CONFS="${DOCKER_KEEP_CONFS:-}"
# This box's own panel address as its install recorded it — read NOW, before rm_panel / rm_docker_* remove the files
# that say so. _url_is_this_box (below) uses it to recognise a node that signs off to the panel on this very box.
_OWN_PANEL_HOST="$(sed -n 's/^PANEL_DOMAIN=//p' /etc/swg-panel/install.conf "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p \
                   | tr -d '"' | sed -e 's#^[A-Za-z]*://##' -e 's#[/:].*##')"
_panel_domain(){ local d=""
  [ -f /etc/nginx/sites-available/swg-panel.conf ] && \
    d="$(sed -n 's/[[:space:]]*server_name[[:space:]]\+\([^;]*\);.*/\1/p' /etc/nginx/sites-available/swg-panel.conf | sed -n 1p | tr -d ' ')"
  { [ -n "$d" ] && [ "$d" != "_" ]; } || \
    d="$(sed -n 's/^PANEL_DOMAIN=//p' /etc/swg-panel/install.conf 2>/dev/null | sed -n 1p | tr -d '"' | sed -e 's#^[A-Za-z]*://##' -e 's#[/:].*##')"
  printf '%s' "$d"; }
DOMAIN="$(_panel_domain)"

# ───────────────────────── removal actions ─────────────────────────
REMOVED_PANEL=false; REMOVED_NODE=false

rm_panel(){
  info "Removing swg-panel (control panel)"
  # ASKED FIRST: what "keep the data" keeps decides the acme renewal and /etc/swg-panel below, not only the roster.
  # Default NO = keep it for a future re-install (matches the docker data-dir prompt); yes = wipe it.
  local PANEL_DATA_DEL="${PANEL_DATA_DEL:-}" _kept=""
  ask_yn "  Delete the panel's data — /var/lib/swg-panel (users, peers, nodes) and /etc/swg-panel (its login, certificate and address)?" n PANEL_DATA_DEL
  [ "$PANEL_DATA_DEL" = yes ] || KEEP_OWN_DROPINS=yes   # a master's node keeps the operator's drop-ins too (_node_dropins_away)
  if [ -e $SD/swg-panel-server.service ]; then run systemctl disable --now swg-panel-server; fi
  # swg-sub (the subscription surface) is a companion of the panel — remove it alongside
  if [ -e $SD/swg-sub.service ]; then run systemctl disable --now swg-sub; fi
  for _nc in swg-netctl.path swg-netctl.timer swg-netctl.service; do
    run systemctl disable --now "$_nc" 2>/dev/null || true; done   # unguarded — disabling something already gone is harmless
  docker_running swg-panel || for _nc in swg-netctl-docker.path swg-netctl-docker.timer swg-netctl-docker.service; do
    run systemctl disable --now "$_nc" 2>/dev/null || true; done
  local _pdd="$SD/swg-panel-server.service.d" _mine=""
  [ "$PANEL_DATA_DEL" = yes ] || _mine="$(ls -A "$_pdd" 2>/dev/null | grep -vxE 'zz-swg-update.conf|swg-ns.conf|swg-journal.conf' | tr '\n' ' ' || true)"
  rmrf $SD/swg-panel-server.service $SD/swg-sub.service $SD/swg-sub.service.d \
       $SD/swg-netctl.service $SD/swg-netctl.service.d $SD/swg-netctl.path $SD/swg-netctl.timer /usr/local/bin/swg-netctl \
       /var/lib/swg-netctl
  if [ -n "$_mine" ]; then rmrf "$_pdd/zz-swg-update.conf" "$_pdd/swg-ns.conf" "$_pdd/swg-journal.conf"; info "  Kept your own drop-in(s) for the panel — $_pdd: ${_mine% } (a re-install picks them up)"
  else rmrf "$_pdd"; fi
  if docker_running swg-panel; then rm_netctl_gate_if_last bare-gone
  else rmrf $SD/swg-netctl-docker.service $SD/swg-netctl-docker.service.d $SD/swg-netctl-docker.path $SD/swg-netctl-docker.timer /usr/local/bin/swg-netctl-docker /usr/local/bin/swg-netctl-docker.new
       rm_netctl_gate_if_last bare-gone docker-gone; fi
  rm_log_ns swg-panel swg-panel-server.service swg-sub.service swg-netctl.service swg-update.service
  rm_updater_if_last bare-gone   # the one-click updater: shared with a docker install, so it goes only with the last of them
  for _l in "$SD"/*.wants/swg-*.service "$SD"/*.wants/swg-*.path "$SD"/*.wants/swg-*.timer; do
    { [ -L "$_l" ] && [ ! -e "$_l" ]; } && rmrf "$_l"
  done
  run systemctl daemon-reload
  rmrf /etc/nginx/sites-enabled/swg-panel.conf /etc/nginx/sites-available/swg-panel.conf \
       /etc/nginx/conf.d/swg-panel.conf /etc/nginx/.htpasswd-swg
  command -v nginx >/dev/null 2>&1 && { run nginx -t && run systemctl reload nginx || warn "reload nginx manually if it's running"; }
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "_" ]; then
    local _acme="" _a _h _conf _dom _rp _dir
    for _a in /root/.acme.sh/acme.sh "${HOME:-/root}/.acme.sh/acme.sh" "$(command -v acme.sh 2>/dev/null || true)"; do
      [ -n "$_a" ] && [ -x "$_a" ] && { _acme="$_a"; break; }
    done
    # every store this box might keep, including the stray /.acme.sh a HOME-less helper used to write
    for _h in /root/.acme.sh "${HOME:-/root}/.acme.sh" /.acme.sh; do
      [ -d "$_h" ] || continue
      for _conf in "$_h"/*/*.conf; do
        [ -f "$_conf" ] || continue
        _dom="$(sed -n "s/^Le_Domain='\{0,1\}\([^']*\).*/\1/p" "$_conf" | sed -n 1p)"
        [ "$_dom" = "$DOMAIN" ] || continue
        _rp="$(sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$_conf" | sed -n 1p)"
        case "$_rp" in /etc/swg-panel/tls/*|/etc/swg-sub/tls/*) ;;
          *) warn "keeping the acme entry for $DOMAIN in $_h — it installs into ${_rp:-somewhere else}, so it is not ours to remove"; continue;; esac
        _dir="$(dirname "$_conf")"
        # a KEPT certificate keeps its renewal: the re-install serves the same certificate and never re-issues it
        [ "$PANEL_DATA_DEL" = yes ] || { info "Kept acme.sh's renewal of $DOMAIN — the certificate stays with the panel's data"; continue; }
        info "Removing acme.sh renewal for $DOMAIN (it installs into $_rp)"
        case "$_dir" in *_ecc) [ -n "$_acme" ] && run "$_acme" --home "$_h" --remove -d "$DOMAIN" --ecc || true;;
                        *)     [ -n "$_acme" ] && run "$_acme" --home "$_h" --remove -d "$DOMAIN" || true;; esac
        rmrf "$_dir"
      done
      # …and the residue of an issuance that never succeeded: a key with no certificate, which carries no
      # conf to identify it by, and which is exactly what would trap the next install.
      _dir="$_h/${DOMAIN}_ecc"
      if [ -d "$_dir" ] && ! { [ -s "$_dir/fullchain.cer" ] && head -1 "$_dir/${DOMAIN}.cer" 2>/dev/null | grep -c 'BEGIN CERTIFICATE' >/dev/null; }; then
        info "Removing a failed acme entry for $DOMAIN in $_h (a domain key with no certificate)"
        rmrf "$_dir"
      fi
    done
  fi
  ufw_forget /etc/swg-panel/ufw-added   # the ports the installer opened close with the panel, kept data or not
  # /usr/local/bin/swg-passwd is the panel's login-reset helper (install-host.sh) — it outlived every uninstall.
  rmrf /opt/swg-panel /opt/swg-sub /var/www/wgstats /var/www/acme /usr/local/bin/swg-passwd
  if [ "$PANEL_DATA_DEL" = yes ]; then rmrf /var/lib/swg-panel /etc/swg-panel /etc/swg-sub   # /etc/swg-sub = swg-sub's OWN tls dir
  else
    rmrf /var/lib/swg-panel/.ssh /var/lib/swg-panel/configs /etc/swg-panel/ufw-added
    [ -f /etc/swg-panel/install.conf ] && run sed -i -E 's/^(CF_TOKEN|CF_ORIGIN_TOKEN)=.*/\1=/' /etc/swg-panel/install.conf
    _kept=""; [ -d /var/lib/swg-panel ] && _kept="/var/lib/swg-panel (users, peers, nodes)"
    [ -d /etc/swg-panel ] && _kept="${_kept:+$_kept and }/etc/swg-panel (its login, certificate and address)"
    [ -n "$_kept" ] && ok "Kept $_kept — a re-install comes back as this same panel, and its nodes keep syncing"
  fi
  for _sd in /var/lib/swg-panel /var/lib/swg-noded /etc/swg-panel /etc/swg-sub; do   # the key too: its group goes below
    [ -d "$_sd" ] && run chown -R root:root "$_sd" 2>/dev/null || true
  done
  hand_ids_to_root swgpanel swgsub   # …and every other kept path still carrying their uids — a convert's recovery archives first of all (F90)
  if id swgpanel >/dev/null 2>&1; then run userdel swgpanel; fi
  if id swgsub >/dev/null 2>&1; then run userdel swgsub; fi   # swg-sub's dedicated read-only user
  REMOVED_PANEL=true; ok "swg-panel removed"
}

_goodbye_post(){
  local url="$1" tok="$2" verify="$3" fp="${4:-}"
  [ -n "$url" ] && [ -n "$tok" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  if $DRYRUN; then echo "    [dry] sign off from the panel ($url)"; return 0; fi
  info "Signing off from the panel…"
  local _why _rc=0
  _why="$(SWG_TOK="$tok" SWG_BODY='{}' panel_req POST "${url%/}/api/node/goodbye" "$verify" "$fp" 10 2>/dev/null)" || _rc=$?
  case "$_rc:$_why" in
    3:"HTTP 404") _rc=0;;
    3:"HTTP 5"??) _rc=2;;
  esac
  case $_rc in
    0) ok "Panel notified — your peers are KEPT for a re-install (re-enroll with the same token to restore them). To purge for good, use Nodes → remove in the panel.";;
    2) warn "The panel closed the connection without a reply — it almost certainly ACTIONED the sign-off (it removes the node before responding). Check the Nodes screen to confirm.";;
    3) warn "The panel turned the sign-off down (${_why:-rejected}); the node will just go offline there (your peers are kept). Remove it from the Nodes screen if you want it gone.";;
    4) warn "Not signed off: ${_why:-the panel is not the one this node trusts — nothing was sent} ($url). The node will just go offline there (your peers are kept); remove it from the Nodes screen if you want it gone.";;
    *) warn "Couldn't reach the panel${_why:+ ($_why)}; the node will just go offline there (your peers are kept). Remove it from the Nodes screen if you want it gone.";;
  esac
}
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
_url_is_this_box(){ local h="${1#*://}"; h="${h%%/*}"
  case "$h" in \[*) h="${h#\[}"; h="${h%%\]*}";; *) h="${h%%:*}";; esac   # drop the port (an IPv6 host is bracketed)
  [ -n "$h" ] || return 1
  case "$h" in swg-panel|localhost|127.*|::1) return 0;; esac
  [ -n "${_OWN_PANEL_HOST:-}" ] && [ "$h" = "$_OWN_PANEL_HOST" ] && return 0
  # a here-string, not a pipe into grep -q: under pipefail an early match SIGPIPEs the producer and reads as "no"
  grep -qxF -- "$h" <<< "$(ip -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; hostname -I 2>/dev/null | tr ' ' '\n')"; }
_panel_left_here(){ [ -f "$SD/swg-panel-server.service" ] || docker_running swg-panel; }
_goodbye_nobody(){ [ -n "$1" ] && _url_is_this_box "$1" && ! _panel_left_here; }
_goodbye_skipped(){ info "No sign-off to send: this node's panel was this box's own, and it is gone now (removed in this run) — nobody is left to tell."; }
# bare-metal node — read the panel URL + token from its config.json
node_goodbye(){
  local cfg=/etc/swg-agent/config.json
  [ -f "$cfg" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local url tok verify fp
  url="$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("panel") or {}).get("url",""))' "$cfg" 2>/dev/null)"
  tok="$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("panel") or {}).get("token",""))' "$cfg" 2>/dev/null)"
  verify="$(python3 -c 'import json,sys;print("yes" if (json.load(open(sys.argv[1])).get("panel") or {}).get("verify",True) else "no")' "$cfg" 2>/dev/null)"
  fp="$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("panel") or {}).get("fingerprint") or "")' "$cfg" 2>/dev/null)"
  _goodbye_nobody "$url" && { _goodbye_skipped; return 0; }
  _goodbye_post "$url" "$tok" "$verify" "$fp"
}
_docker_node_panel(){ local d="$1" k v _lv="" _lf=""
  for k in PANEL_URL NODE_TOKEN TLS_VERIFY TLS_FINGERPRINT; do
    v="$(sed -n "s/^$k=//p" "$d/.env" 2>/dev/null | sed -n 1p | sed 's/[[:space:]]\{1,\}#.*$//' | tr -d '"' || true)"
    case "$k" in PANEL_URL) DNP_URL="$v";; NODE_TOKEN) DNP_TOKEN="$v";; TLS_VERIFY) DNP_VERIFY="$v";; TLS_FINGERPRINT) DNP_FP="$v";; esac
  done
  v="$(head -n1 "$d/data/node/panel-url" 2>/dev/null | tr -d '[:space:]' || true)";    [ -n "$v" ] && DNP_URL="$v"
  v="$(head -n1 "$d/data/node/panel-token" 2>/dev/null | tr -d '[:space:]' || true)";  [ -n "$v" ] && DNP_TOKEN="$v"
  _lv="$(head -n1 "$d/data/node/panel-verify" 2>/dev/null | tr -d '[:space:]' || true)"; [ -n "$_lv" ] && DNP_VERIFY="$_lv"
  _lf="$(head -n1 "$d/data/node/panel-fp" 2>/dev/null | tr -d '[:space:]' || true)";     [ -n "$_lf" ] && DNP_FP="$_lf"
  [ "$_lv" = yes ] && [ -z "$_lf" ] && DNP_FP=""
  [ "$DNP_VERIFY" = yes ] || DNP_VERIFY=no
  return 0; }
# docker node — the token + panel URL live in the deployment .env (config.json is inside the container), and in what it learned
docker_node_goodbye(){
  local env="$DOCKER_DIR/.env"; [ -f "$env" ] || return 0
  local url tok verify fp
  _docker_node_panel "$DOCKER_DIR"; url="$DNP_URL"; tok="$DNP_TOKEN"; verify="$DNP_VERIFY"; fp="$DNP_FP"
  [ "$tok" = set-in-nodes-screen ] && return 0
  # A co-located master's node signs off to its OWN panel — skipped when no panel is left to hear it (see above).
  _goodbye_nobody "$url" && { _goodbye_skipped; return 0; }
  _goodbye_post "$url" "$tok" "$verify" "$fp"
}
# POST proc-status (best-effort) — flashes a red "uninstalling" tag on the panel the moment teardown starts.
_proc_post(){  # <url> <token> <verify> <fingerprint> <state> — with the node's trust (panel_req), like the sign-off
  local url="$1" tok="$2" verify="$3" fp="$4" state="$5"
  { [ -n "$url" ] && [ -n "$tok" ] && command -v python3 >/dev/null 2>&1; } || return 0
  $DRYRUN && return 0   # a dry run tells the panel nothing (see _goodbye_post)
  SWG_TOK="$tok" SWG_BODY="{\"state\":\"$state\"}" panel_req POST "${url%/}/api/node/proc-status" "$verify" "$fp" 6 >/dev/null 2>&1 || true
}
docker_node_uninstalling(){   # red "uninstalling" tag while a docker node tears down (the panel it really talks to)
  local env="$DOCKER_DIR/.env"; [ -f "$env" ] || return 0
  _docker_node_panel "$DOCKER_DIR"
  [ "$DNP_TOKEN" = set-in-nodes-screen ] && return 0   # the panel-only placeholder is not a node's token (docker_node_goodbye)
  _proc_post "$DNP_URL" "$DNP_TOKEN" "$DNP_VERIFY" "$DNP_FP" uninstalling
}

adopted_ctrs(){ # adopted_ctrs <config.json> <adopted-containers.json>
  python3 - "$1" "$2" 2>/dev/null <<'PYADOPT' || true
import json, sys
out = []
try:
    with open(sys.argv[1]) as f:
        for _i, v in (json.load(f).get("interfaces") or {}).items():
            if isinstance(v, dict) and v.get("adopted_from"):
                out.append(v["adopted_from"])
except Exception:
    pass
try:
    with open(sys.argv[2]) as f:
        d = json.load(f)
    if isinstance(d, dict):
        out += [v for v in d.values() if isinstance(v, str) and v]
except Exception:
    pass
seen = set()
for c in out:
    if c and c not in seen:
        seen.add(c)
        print(c)
PYADOPT
}
# Append to the run-wide list (a box can carry a bare-metal AND a docker node), keeping it unique.
capture_adopted(){ local _n
  _n="$(adopted_ctrs "$1" "$2")"
  [ -n "$_n" ] && ADOPTED_CTRS="$(printf '%s\n%s\n' "${ADOPTED_CTRS:-}" "$_n" | awk 'NF && !seen[$0]++')"
  return 0; }

_node_dropins_away(){ local d="$SD/swg-noded.service.d" mine=""
  [ "${KEEP_OWN_DROPINS:-no}" = yes ] && mine="$(ls -A "$d" 2>/dev/null | grep -vxE '10-swg-reach-sweep.conf|swg-ns.conf' | tr '\n' ' ' || true)"
  if [ -n "$mine" ]; then rmrf "$d/10-swg-reach-sweep.conf" "$d/swg-ns.conf"; info "  Kept your own drop-in(s) for the node — $d: ${mine% } (a re-install picks them up)"
  else rmrf "$d"; fi; }
rm_log_ns(){   # <namespace> <unit or unit prefix>...
  local ns="$1" u; shift
  for u in "$@"; do
    rmrf "$SD/$u.d/swg-ns.conf" "/run/systemd/system/$u.d/swg-ns.conf" "/run/systemd/system/$u.d/swg-log.conf"   # + the level's
    [ "$(ls -A "$SD/$u.d" 2>/dev/null)" = swg-restart.conf ] || rmdir_if_empty "$SD/$u.d"; rmdir_if_empty "/run/systemd/system/$u.d"   # only swg-noded's systemd < 254 back-off left: not "kept" — rm_log_journals takes it at the end
  done
  rmrf "/run/systemd/journald@$ns.conf.d"
  { [ -e "$SD/swg-noded.service" ] || [ -e "$SD/swg-panel-server.service" ]; } || rmrf /usr/local/bin/swg-logs
  return 0
}
_swg_left(){ local f
  if $DRYRUN; then [ "${#DID_KEEP[@]}" -gt 0 ]; return; fi   # a dry run removed nothing: judged by its answers
  for f in "$SD"/swg-panel-server.service "$SD"/swg-noded.service "$SD"/swg-sub.service "$SD"/swg-netctl*.service \
           "$SD"/swg-update.service "$SD"/swg-relay@.service "$SD"/vk-turn-proxy-*.service "$SD"/swg-wdtt-*.service "$SD"/swg-csqtt-*.service \
           /run/systemd/transient/swg-s5x-*.service; do
    [ -e "$f" ] && return 0; done
  docker_running swg-panel || docker_running swg-node; }
_data_kept(){ [ "${KEEP_OWN_DROPINS:-no}" = yes ] || [ "${DOCKER_DATA_DEL:-}" = no ] || [ "${DOCKER_KEEP_CONFS:-}" = yes ] && return 0
  $DRYRUN && return 1
  [ -d /var/lib/swg-panel ] || [ -n "$(ls -A /etc/swg-panel 2>/dev/null | grep -vx relay)" ] || [ -d "$DOCKER_DIR/data" ]; }
rm_log_journals(){ local f d ns u mid had=""
  _swg_left && return 0
  for f in "$SD"/*.d/swg-ns.conf "$SD"/*.d/swg-log.conf "$SD"/*.d/swg-journal.conf "$SD"/*.d/swg-restart.conf \
           /run/systemd/system/*.d/swg-ns.conf /run/systemd/system/*.d/swg-log.conf /run/systemd/system/*.d/swg-journal.conf; do
    [ -e "$f" ] || continue; rmrf "$f"; [ -z "$(ls -A "${f%/*}" 2>/dev/null)" ] && run rmdir "${f%/*}"; done
  for d in "$SD"/swg-*.d "$SD"/vk-turn-proxy-*.d; do [ -d "$d" ] && [ -z "$(ls -A "$d" 2>/dev/null)" ] && run rmdir "$d"; done
  rmrf /usr/local/bin/swg-logs /var/lib/swg-log-ns /var/lib/swg-log-ns.lock   # + the journal-namespace probe answer the installers keep (IN-11)
  rmrf /run/systemd/journal.swg-probe   # the probe's sockets: systemd leaves a stopped socket unit's files (RemoveOnStop=no)
  mid="$(cat /etc/machine-id 2>/dev/null || true)"
  for ns in swg-panel swg-node; do
    [ -n "$mid" ] && { [ -e "/var/log/journal/$mid.$ns" ] || [ -e "/run/log/journal/$mid.$ns" ]; } && had="${had:+$had, }$ns"; done
  if _data_kept; then
    [ -n "$had" ] && DID_KEEP+=("swg's own journals ($had) — kept with the data (read: journalctl --namespace=<name>)")
  else
    for ns in swg-panel swg-node; do
      u="$(systemctl list-units --all --plain --no-legend "systemd-journald@$ns.*" "systemd-journald-varlink@$ns.*" 2>/dev/null | awk '{print $1}')"
      [ -n "$u" ] && { run systemctl stop $u 2>/dev/null || true; }   # loaded → stopped, sockets with it
      rmrf "/run/systemd/journald@$ns.conf.d" "/etc/systemd/journald@$ns.conf" "/etc/systemd/journald@$ns.conf.d"
      rmrf "/run/systemd/journal.$ns"   # its sockets, stopped above: systemd leaves their files (RemoveOnStop=no)
      [ -n "$mid" ] && rmrf "/var/log/journal/$mid.$ns" "/run/log/journal/$mid.$ns"
    done
    [ -n "$had" ] && DID_REMOVE+=("swg's own journals ($had) — the box's main journal untouched")
  fi
  run systemctl daemon-reload 2>/dev/null || true
  return 0
}
rm_update_leftovers(){ _swg_left && return 0; rmrf /run/swg-update.lock /run/swg-update.running /tmp/swg-update.lock; return 0; }
rm_node(){
  info "Removing swg-node (bare-metal entry server)"
  node_goodbye   # signal the panel before we tear down the config it needs
  run sh -c 'nft delete table inet swg_relay >/dev/null 2>&1 || true'
  run sh -c 'n=0; while [ $n -lt 4 ] && ip rule del fwmark 0x9c40 lookup 6990 2>/dev/null; do n=$((n+1)); done; true'
  run sh -c 'ip route flush table 6990 >/dev/null 2>&1 || true'
  run sh -c 'for u in $(systemctl list-units --all --plain --no-legend "swg-relay@*.service" 2>/dev/null | awk "{print \$1}"); do systemctl disable --now "$u" >/dev/null 2>&1 || true; done'
  run systemctl stop swg-relay.slice 2>/dev/null || true
  rmrf $SD/"swg-relay@.service" $SD/swg-relay.slice /etc/swg-panel/relay
  rmrf /run/swg-relay-*.sock   # its status sockets: outside the unit's RuntimeDirectory, unlinked only at a relay's next start
  if [ -e $SD/swg-noded.service ]; then run systemctl disable --now swg-noded; fi
  run sh -c 'for u in $(systemctl list-units --all --plain --no-legend "swg-s5x-*.service" 2>/dev/null | awk "{print \$1}"); do systemctl stop "$u" >/dev/null 2>&1; systemctl reset-failed "$u" >/dev/null 2>&1; done; true'
  run systemctl stop swg-exit.slice 2>/dev/null || true
  docker_running swg-node || rm_smartdns_redirect   # its dnsmasq just went with it — see rm_smartdns_redirect
  run systemctl unmask dnsmasq 2>/dev/null || true   # install masked the distro dnsmasq (node ran its own); restore it
  rmrf $SD/swg-noded.service; _node_dropins_away; run systemctl daemon-reload
  rm_log_ns swg-node swg-noded.service swg-relay@.service vk-turn-proxy-.service swg-wdtt-.service swg-csqtt-.service
  run systemctl daemon-reload   # the prefix drop-ins rm_log_ns took off units that may still be loaded
  capture_adopted /etc/swg-agent/config.json /var/lib/swg-noded/adopted-containers.json
  info "  removing the panel's system mesh links"
  remove_ifaces /etc/amnezia/amneziawg awg-quick mesh
  remove_ifaces /etc/wireguard        wg-quick  mesh
  rmrf /opt/swg-agent /opt/swg-noded /srv/swg-queue /var/log/swg-agent /var/lib/swg-noded /var/lib/swg-recovery /etc/sudoers.d/swg-agent /run/swg-agent.lock
  rmrf /etc/swg-agent   # turn-proxy.json here is just a panel-facing record; a kept turn-proxy keeps running
  for _aal in /etc/apparmor.d/local/*; do
    [ -f "$_aal" ] && grep -qsF '# --- swgPanel: userspace WireGuard datapaths (begin) ---' "$_aal" || continue
    info "  reverting the swgPanel AppArmor grant in $_aal (should you keep a WDTT / csqtt server or a userspace awg interface below, the wg CLI can no longer read its socket)"
    run sed -i '/# --- swgPanel: userspace WireGuard datapaths (begin) ---/,/# --- swgPanel: userspace WireGuard datapaths (end) ---/d' "$_aal"
    _aap="/etc/apparmor.d/$(basename "$_aal")"
    # …and a file that held nothing else goes — the grant created it (26.04's wg profile ships none) — when the profile takes it `if exists` (1.8.8 #3d)
    [ -s "$_aal" ] || ! grep -qsE "include[[:space:]]+if[[:space:]]+exists[[:space:]]+<local/${_aal##*/}>" "$_aap" || rmrf "$_aal"
    [ -f "$_aap" ] && command -v apparmor_parser >/dev/null 2>&1 && run apparmor_parser -r "$_aap" 2>/dev/null || true
  done
  hand_ids_to_root swgpush swgagent   # a kept path never keeps a uid this run frees (F90)
  for u in swgpush swgagent; do if id "$u" >/dev/null 2>&1; then run userdel -r "$u"; fi; done
  NEED_NETOBJ_SWEEP=true
  REMOVED_NODE=true; ok "swg-node removed"
}

# swg-panel and swg-node are SEPARATE containers — remove each on its own. The shared
# deployment dir / network / images / data are only torn down once BOTH are gone.
docker_running(){ command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx "$1" >/dev/null; }
_rm_node_data(){  rmrf "$DOCKER_DIR/data/node" "$DOCKER_DIR/data/node-confs"; }      # node-only state + iface confs
_rm_panel_data(){ rmrf "$DOCKER_DIR/data/etc" "$DOCKER_DIR/data/lib" "$DOCKER_DIR/data/stats"; }  # login/roster/certs
ask_full_data_fate(){   # the LAST swg container is going → decide the WHOLE data dir up front (before teardown)
  local desc=""
  [ -d "$DOCKER_DIR/data/lib" ] && desc="login, roster (users+peers), "
  [ -d "$DOCKER_DIR/data/etc" ] && desc="${desc}nodes, certs, "
  [ -d "$DOCKER_DIR/data/node-confs" ] && desc="${desc}interface configs / peers, "
  [ -d "$DOCKER_DIR/data/node/wdtt" ] && desc="${desc}WDTT identities + passwords, "   # same irrecoverable weight as the bare-metal /opt/swg-wdtt question
  [ -d "$DOCKER_DIR/data/node/csqtt" ] && desc="${desc}csqtt password stores, "        # csqtt has no keypair — the store IS what its clients authenticate against
  desc="${desc%, }"; [ -n "$desc" ] || desc="state"
  ask_yn "  Delete the data dir $DOCKER_DIR/data ($desc)?" n DOCKER_DATA_DEL
  DOCKER_KEEP_CONFS="${DOCKER_KEEP_CONFS:-}"      # keep a preset; only defined-ness is needed under set -u
  if [ "$DOCKER_DATA_DEL" = yes ] && [ -d "$DOCKER_DIR/data/node-confs" ]; then
    ask_yn "  Keep at least the peers? Leaves data/node-confs (keys + peers) so a future install can re-onboard them." y DOCKER_KEEP_CONFS
  fi
}
apply_full_data_fate(){   # run AFTER teardown, using the decision captured by ask_full_data_fate
  if [ "$DOCKER_DATA_DEL" != yes ]; then
    [ -f "$DOCKER_DIR/.env" ] && run sed -i -E '/^(PANEL_PASSWORD|CF_TOKEN|CF_ORIGIN_TOKEN|ACME_EMAIL)=/d' "$DOCKER_DIR/.env"
    rmrf "$DOCKER_DIR/docker-compose.yml" "$DOCKER_DIR/Dockerfile" "$DOCKER_DIR/Dockerfile.node" \
         "$DOCKER_DIR/.dockerignore" "$DOCKER_DIR/VERSION" "$DOCKER_DIR/docker" "$DOCKER_DIR/vendor" \
         "$DOCKER_DIR/swg-panel-server" "$DOCKER_DIR/swg-agent" "$DOCKER_DIR/swg-noded" \
         "$DOCKER_DIR/index.html" "$DOCKER_DIR/app.css" "$DOCKER_DIR/app.js" "$DOCKER_DIR/reconcile.js" \
         "$DOCKER_DIR/js" "$DOCKER_DIR/m"   # m/: the phone UI's stylesheet, staged beside js/ since 1.8.11 (S13)
    # Say what that .env still holds. A panel-only install has no node token — its NODE_TOKEN is the placeholder
    # set-in-nodes-screen — and "(node token)" named a key the box never had (1.8.8 qualification, q5).
    local _tok _held="" _env=""
    if [ -f "$DOCKER_DIR/.env" ]; then
      _tok="$(sed -n 's/^NODE_TOKEN=//p' "$DOCKER_DIR/.env" | sed -n 1p)"; _tok="${_tok%\"}"; _tok="${_tok#\"}"
      case "$_tok" in ""|set-in-nodes-screen) ;; *) _held="node token";; esac
      { [ -d "$DOCKER_DIR/data/lib" ] || [ -d "$DOCKER_DIR/data/etc" ]; } && _held="${_held:+$_held, }the panel's address and ports"
      _env=" + .env${_held:+ ($_held)}"
    fi
    ok "Kept $DOCKER_DIR/data$_env for a future reinstall"
    return
  fi
  local _saved=no
  case "${ARCHIVES_DEL:-}" in [Yy]*)
    [ -f "$DOCKER_DIR/.env" ] && info "  no recovery copy saved — ARCHIVES_DEL=y asks for none to be kept (this node cannot be recovered from this box)";;
  *) if [ -f "$DOCKER_DIR/.env" ]; then
    _bak="$DOCKER_DIR.uninstalled-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
    run mkdir -p "$_bak/data"
    run cp -a "$DOCKER_DIR/.env" "$_bak/.env"
    [ -d "$DOCKER_DIR/data/node-confs" ] && run cp -a "$DOCKER_DIR/data/node-confs" "$_bak/data/node-confs"
    [ -d "$DOCKER_DIR/data/node" ] && run cp -a "$DOCKER_DIR/data/node" "$_bak/data/node"   # swg-noded state incl. turn-proxy.json → turn-proxies re-create on recovery
    rmrf "$_bak/data/node/log"   # swg's own log files (the log budget): not identity — size and users' lines only
    run sed -i -E '/^(PANEL_PASSWORD|CF_TOKEN|CF_ORIGIN_TOKEN|ACME_EMAIL)=/d' "$_bak/.env"
    _seal_archive "$_bak"   # the node token + interface keys: root's alone (F90)
    info "  saved a recovery copy (node token + interface keys + turn-proxies) to $(b "$_bak") — re-install and pick it from the recovery list"
    _saved=yes; RUN_ARCHIVES="${RUN_ARCHIVES:-} $_bak"
  fi;;
  esac
  if [ "$DOCKER_KEEP_CONFS" = yes ]; then
    # CASE 2 — keep the peers (interface server keys) LIVE so existing client configs keep working
    run sh -c "find '$DOCKER_DIR' -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} + 2>/dev/null; find '$DOCKER_DIR/data' -mindepth 1 -maxdepth 1 ! -name node-confs ! -name node -exec rm -rf {} + 2>/dev/null"
    ok "Kept $DOCKER_DIR/data/node-confs (peers) + node (turn-proxies) live$([ "$_saved" = yes ] && printf '; token recoverable from the backup')"
  else
    # CASE 3 — wipe everything live; full recovery (token + interface keys) is in the backup
    rmrf "$DOCKER_DIR"
    ok "Removed $DOCKER_DIR$([ "$_saved" = yes ] && printf ' — a recovery copy (token + interface keys) is kept for re-install')"
  fi
}
docker_rm_project_networks(){
  command -v docker >/dev/null 2>&1 || return 0
  local _nw
  for _nw in $(docker network ls -q --filter "label=com.docker.compose.project=$(basename "$DOCKER_DIR")" 2>/dev/null); do
    run sh -c "docker network rm '$_nw' >/dev/null 2>&1 || true"
  done; }
rm_updater_if_last(){
  if { [ "${1:-}" != bare-gone ] && { [ -d /opt/swg-panel ] || [ -f "$SD/swg-panel-server.service" ]; }; } \
     || docker_running swg-panel || docker_running swg-node; then return 0; fi
  for _su in swg-update.timer swg-update.path; do run systemctl disable --now "$_su" 2>/dev/null || true; done
  rmrf "$SD/swg-update.service" "$SD/swg-update.service.d/swg-ns.conf" "$SD/swg-update.service.d/swg-log.conf" \
       "$SD/swg-update.path" "$SD/swg-update.timer" /usr/local/bin/swg-update \
       /usr/local/bin/swg-update.new /usr/local/bin/swg-update-check /var/lib/swg-update.stamp
  run systemctl daemon-reload 2>/dev/null || true
}
docker_cleanup_if_last(){   # shared bits (network/images/data dir) — only once NO swg container remains
  if docker_running swg-panel || docker_running swg-node; then return 0; fi
  rm_updater_if_last   # the host one-click updater — unless a bare-metal panel on this box still uses it
  if command -v docker >/dev/null 2>&1; then
    local DC=""; if docker compose version >/dev/null 2>&1; then DC="docker compose"; elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"; fi
    # activate every profile so `down` stops profile-gated services too (swg-sub); plain `down` skips them and --remove-orphans won't (it's in the compose file, not an orphan)
    [ -n "$DC" ] && [ -f "$DOCKER_DIR/docker-compose.yml" ] && run sh -c "cd '$DOCKER_DIR' && COMPOSE_PROFILES=host,master,node,host-node $DC down --remove-orphans >/dev/null 2>&1 || true"   # drop the network + any straggler
    docker_rm_project_networks   # …and the network itself when `down` could not (see above)
    local RMI="${REMOVE_DOCKER_IMAGES:-}"; echo; ask_yn "  Remove the pulled swg-panel / swg-node images too?" n RMI
    [ "$RMI" = yes ] && run sh -c 'docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null \
        | grep -E "^(ghcr\.io/(sanityprotocol|tesla-prep)/swg-(panel|node)|swg-panel-docker-swg-(panel|node)):" \
        | xargs -r docker rmi >/dev/null 2>&1 || true'
  fi
  apply_full_data_fate
}
rm_docker_panel(){ info "Removing Docker panel container (swg-panel)"
  local DELP="${PANEL_DATA_DEL:-}"
  if docker_running swg-node; then    # node stays → only the panel's OWN data is in play (decide now)
    ask_yn "  Delete the panel data (login, roster (users+peers), nodes, certs)? The node's interface configs are kept." n DELP
  else ask_full_data_fate; fi         # panel is the last container → the whole data dir
  run sh -c 'docker rm -f swg-panel swg-sub >/dev/null 2>&1 || true'   # swg-sub is the panel's companion surface (a profile-gated service `down` won't stop) — remove it alongside
  docker_rm_project_networks   # the panel + sub were the network's only members (a node runs on host networking)
  # …and its host-side address helper (install-docker.sh's wire_docker_netctl). It was left for a separate
  # "(leftover helper)" question, which also listed it as a leftover while this very panel was still running.
  for _nc in swg-netctl-docker.path swg-netctl-docker.timer swg-netctl-docker.service; do
    [ -e "$SD/$_nc" ] && run systemctl disable --now "$_nc" 2>/dev/null || true
  done
  rmrf "$SD/swg-netctl-docker.service" "$SD/swg-netctl-docker.service.d" "$SD/swg-netctl-docker.path" "$SD/swg-netctl-docker.timer" /usr/local/bin/swg-netctl-docker /usr/local/bin/swg-netctl-docker.new
  rm_netctl_gate_if_last docker-gone
  run systemctl daemon-reload 2>/dev/null || true
  if docker_running swg-node; then
    [ "$DELP" = yes ] && { _rm_panel_data; info "  Removed the panel data; node interface configs untouched."; } \
                      || info "  Kept the panel data; node interface configs untouched."
  else docker_cleanup_if_last; fi     # applies the data-dir decision captured above
  ok "swg-panel container removed"; }
reap_iface_rules(){ local n="$1" s="${2:-}" l _s
  command -v iptables >/dev/null 2>&1 && [ -n "$n" ] || return 0
  iptables -S FORWARD 2>/dev/null | grep -E -- "-[io] ${n}( |$)" | while IFS= read -r l; do
    run sh -c "iptables $(printf '%s' "$l" | sed 's/^-A /-D /') 2>/dev/null" || true; done
  # …its OWN tagged MASQUERADE (swg-nat:<iface> — the hooks and node-entrypoint write it since 1.8.8), by its name —
  # `-S` prints the comment quoted or not; the name must END there (swg-nat:wg0 is not swg-nat:wg01)…
  _s="$(printf '%s' "$n" | sed 's/[][\.^$*+?(){}|/]/\\&/g')"
  iptables -t nat -S POSTROUTING 2>/dev/null | grep -E -- "--comment \"?swg-nat:${_s}\"?( |\$)" | while IFS= read -r l; do
    run sh -c "iptables -t nat $(printf '%s' "$l" | sed 's/^-A /-D /') 2>/dev/null" || true; done
  [ -n "$s" ] || return 0
  # …and the untagged one an older build wrote for its subnet
  _s="$(printf '%s' "$s" | sed 's/[.]/\\./g')"
  iptables -t nat -S POSTROUTING 2>/dev/null | grep -xE -- "-A POSTROUTING -s ${_s} -o [^ ]+ -j MASQUERADE" | while IFS= read -r l; do
    run sh -c "iptables -t nat $(printf '%s' "$l" | sed 's/^-A /-D /') 2>/dev/null" || true; done
}
_node_nft_sweep(){
  local img tl dels _n _tag
  img="$(docker inspect -f '{{.Config.Image}}' swg-node 2>/dev/null || true)"
  # …its container gone (1.8.8 deferred #15): the image its .env names, as compose resolves it — only one this box still
  # has (an uninstall pulls nothing). Without it rm_docker_node takes the interfaces and the host's nft the tables.
  [ -n "$img" ] || { _tag="$(sed -n 's/^SWG_IMAGE_TAG=//p' "$DOCKER_DIR/.env" 2>/dev/null | sed -n 1p | sed 's/[[:space:]]\{1,\}#.*$//' | tr -d '"')"
                     for _registry_owner in tesla-prep sanityprotocol; do
                       img="ghcr.io/$_registry_owner/swg-node:${_tag:-latest}"
                       if docker image inspect "$img" >/dev/null 2>&1; then break; fi
                       img=""
                     done; }
  [ -n "$img" ] || return 0
  if $DRYRUN; then echo "    [dry] stop swg-node, then delete its swg* nft tables with its own nft ($img)"; return 0; fi
  docker stop -t 10 swg-node >/dev/null 2>&1 || true
  for _n in ${1:-}; do _rm_host_iface "$_n"; done
  if ! tl="$(docker run --rm --net host --cap-add NET_ADMIN --entrypoint nft "$img" list tables 2>/dev/null)"; then
    warn "could not read the node's nft tables with its own nft ($img) — the sweep below tries the host's"; return 0
  fi
  dels="$(printf '%s\n' "$tl" | sed -n 's/^table \([a-z0-9]*\) \(swg[A-Za-z0-9_]*\)$/delete table \1 \2/p')"
  [ -n "$dels" ] || return 0
  if printf '%s\n' "$dels" | docker run -i --rm --net host --cap-add NET_ADMIN --entrypoint nft "$img" -f - >/dev/null 2>&1; then
    info "  removed the node's nft tables with its own nft:$(printf '%s\n' "$dels" | sed 's/^delete table [a-z0-9]* / /' | tr -d '\n')"
  else
    warn "the node's own nft could not delete its tables ($img) — the sweep below tries the host's"
  fi
  return 0; }
_rm_host_iface(){ local n="$1"   # one HOST-namespace wg/awg netdev a (host-networking) node left: down cleanly if it can, then force-delete
  command -v ip >/dev/null 2>&1 && ip link show "$n" >/dev/null 2>&1 || return 0
  awg-quick down "$n" >/dev/null 2>&1 || wg-quick down "$n" >/dev/null 2>&1 || true   # clean teardown if it can
  ip link delete dev "$n" >/dev/null 2>&1 || true                                      # ALWAYS force-delete (down may exit 0 without removing it)
  info "  removed leftover host interface $(b "$n")"; }
rm_docker_node(){  info "Removing Docker node container (swg-node)"
  docker_node_uninstalling   # flash a red "uninstalling" tag on the panel before we tear down
  local KNODE="${DOCKER_KEEP_CONFS:-}"   # same shadowing bug as DELP above — inherit, do not blank
  if docker_running swg-panel; then   # master/panel stays → only the NODE's own data is in play (decide now)
    ask_yn "  Keep the node's interface configs (peers)? Leaves data/node-confs so a future install can re-onboard them." y KNODE
  else ask_full_data_fate; fi         # node is the last container → the whole data dir
  local _ifn _n _c
  _ifn="$(docker exec swg-node sh -c 'for d in /etc/amnezia/amneziawg /etc/wireguard; do ls "$d"/*.conf 2>/dev/null; done' 2>/dev/null | sed 's#.*/##; s#\.conf$##' | tr '\n' ' ')"
  [ -n "$_ifn" ] || _ifn="$(for _c in "$DOCKER_DIR/data/node-confs/"*.conf; do [ -f "$_c" ] && basename "$_c" .conf; done | tr '\n' ' ')"
  # …and each one's subnet, for the MASQUERADE its bring-up added (the conf is the one place that says it)
  local _nets
  _nets="$(docker exec swg-node sh -c 'for f in /etc/amnezia/amneziawg/*.conf /etc/wireguard/*.conf; do [ -f "$f" ] && printf "%s %s\n" "$(basename "$f" .conf)" "$(sed -n "s/^[[:space:]]*[Aa]ddress[[:space:]]*=[[:space:]]*//p" "$f" | sed -n 1p | cut -d, -f1)"; done' 2>/dev/null || true)"
  [ -n "$_nets" ] || _nets="$(for _c in "$DOCKER_DIR/data/node-confs/"*.conf; do [ -f "$_c" ] && printf '%s %s\n' "$(basename "$_c" .conf)" "$(sed -n 's/^[[:space:]]*[Aa]ddress[[:space:]]*=[[:space:]]*//p' "$_c" | sed -n 1p | cut -d, -f1)"; done)"
  _acfg="$(mktemp 2>/dev/null || echo /tmp/swg-adopted.$$)"
  docker exec swg-node cat /etc/swg-agent/config.json >"$_acfg" 2>/dev/null || : >"$_acfg"
  capture_adopted "$_acfg" "$DOCKER_DIR/data/node/adopted-containers.json"
  rm -f "$_acfg"
  _node_nft_sweep "$_ifn"             # stopped, its interfaces, then its nft tables with its own nft — before `docker rm`
  run sh -c 'docker rm -f swg-node >/dev/null 2>&1 || true'
  run sh -c 'ids=$(docker ps -aq --filter name=swg-turn- 2>/dev/null); [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1 || true'   # this node's turn-proxy containers
  [ -f "$SD/swg-noded.service" ] || rm_smartdns_redirect   # its dnsmasq was in the container (host networking: the DNATs are the host's)
  docker_node_goodbye                 # sign off AFTER the container is stopped — else its next 5s sync re-reports and clears the panel's "Uninstalled" tag (leaving it merely "offline")
  for _n in $_ifn; do [ -n "$_n" ] || continue
    command -v ip >/dev/null 2>&1 && ip link show "$_n" >/dev/null 2>&1 || continue
    if $DRYRUN; then echo "    [dry] down + delete the leftover host interface $_n"; continue; fi
    _rm_host_iface "$_n"; done
  # …and their rules (see reap_iface_rules) — for every interface the node had, whether or not its device was still up
  for _n in $_ifn; do [ -n "$_n" ] || continue
    reap_iface_rules "$_n" "$(printf '%s\n' "$_nets" | awk -v n="$_n" '$1==n && !d {print $2; d=1}' | python3 -c 'import ipaddress,sys; s=sys.stdin.read().strip(); print(ipaddress.ip_network(s, strict=False) if s else "")' 2>/dev/null)"
  done
  if docker_running swg-panel; then
    [ "$KNODE" = yes ] && info "  Kept $DOCKER_DIR/data/node-confs (peers re-onboardable); panel data untouched." \
                       || { _rm_node_data; info "  Removed the node's interface configs; panel data untouched."; }
  else docker_cleanup_if_last; fi     # applies the data-dir decision captured above
  NEED_NETOBJ_SWEEP=true
  ok "swg-node container removed"; }
rm_docker_files(){ info "Removing the Docker deployment files ($DOCKER_DIR)"
  # This component can run without rm_docker_node ever firing, so it owes the same debt: a container we took
  # an interface over from is still stopped with restart=no. Capture before anything is torn down.
  capture_adopted /dev/null "$DOCKER_DIR/data/node/adopted-containers.json"
  run sh -c "cd '$DOCKER_DIR' 2>/dev/null && { docker compose down --remove-orphans >/dev/null 2>&1 || docker-compose down --remove-orphans >/dev/null 2>&1; } || true"
  docker_rm_project_networks
  for _p in swg-node swg-panel swg-turn-; do run sh -c "docker ps -aq -f 'name=$_p' 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true"; done
  docker_node_goodbye   # sign off AFTER the container is gone (no further sync clears the panel's "Uninstalled")
  [ -f "$SD/swg-noded.service" ] || rm_smartdns_redirect   # no node container left to answer a Force-DNS redirect
  ask_full_data_fate; apply_full_data_fate; rmrf /var/lib/swg-recovery; ok "Docker deployment files removed"; }

down_ifaces(){ local dir="$1" tool="$2" f n              # quietly bring each interface down (wg/awg-quick is noisy)
  for f in "$dir"/*.conf; do [ -e "$f" ] || continue; n="$(basename "$f" .conf)"
    $DRYRUN && { echo "    [dry] $tool down $n"; continue; }
    { command -v "$tool" >/dev/null 2>&1 && "$tool" down "$n"; ip link delete "$n"; } >/dev/null 2>&1 || true; done; }
# Down each interface + delete its .conf, printing ONE green ✓ line (name · address · port) — used by the
# peer-removal components (down_ifaces above is the quiet, no-display version used before purging a package).
remove_ifaces(){ local dir="$1" tool="$2" want="${3:-own}" f n addr port
  for f in "$dir"/*.conf; do [ -e "$f" ] || continue; n="$(basename "$f" .conf)"
    _iface_pick "$n" "$want" || continue
    addr="$(awk -F= 'tolower($1)~/address/{gsub(/[ \t]/,"",$2);split($2,a,",");print a[1];exit}' "$f" 2>/dev/null)"
    port="$(awk -F= 'tolower($1)~/listenport/{gsub(/[ \t]/,"",$2);print $2;exit}' "$f" 2>/dev/null)"
    if $DRYRUN; then echo "    [dry] down + disable ${tool}@$n + remove $n"
    else run systemctl stop "${tool}@$n" >/dev/null 2>&1 || true   # its unit FIRST: one started at boot stayed "active (exited)", then failed once its package went (1.8.8 deferred #16)
      { command -v "$tool" >/dev/null 2>&1 && "$tool" down "$n"; ip link delete "$n"; } >/dev/null 2>&1 || true
      run systemctl disable "${tool}@$n" >/dev/null 2>&1 || true
      rm -f "$f"; fi
    printf '    %s✓ %s%s%s%s\n' "$(c '0;32')" "$n" "$(c 0)" "${addr:+ · $addr}" "${port:+ · :$port}"
  done; }

rm_awg_peers(){
  info "Removing AmneziaWG interface configs (peers)"
  remove_ifaces /etc/amnezia/amneziawg awg-quick own
  rmdir_if_empty /etc/amnezia/amneziawg
}
rm_awg_foreign(){
  info "Removing the AmneziaWG interfaces that are NOT swg's"
  remove_ifaces /etc/amnezia/amneziawg awg-quick foreign
  rmdir_if_empty /etc/amnezia/amneziawg
}
_awg_ppa_forget(){ ls /etc/apt/sources.list.d/*amnezia* >/dev/null 2>&1 && run add-apt-repository -y --remove ppa:amnezia/ppa
  rmrf /etc/apt/trusted.gpg.d/amnezia-ubuntu-ppa.gpg /etc/apt/trusted.gpg.d/amnezia-ubuntu-ppa.gpg~ /root/.launchpadlib; return 0; }
rm_awg_pkg(){
  info "Uninstalling the AmneziaWG package (kernel module + tools)"
  down_ifaces /etc/amnezia/amneziawg awg-quick      # if the configs were kept, bring the ifaces down before pulling the module
  if command -v apt-get >/dev/null 2>&1; then
    if run apt-get purge -y amneziawg amneziawg-tools amneziawg-dkms; then
      _awg_ppa_forget; run apt-get autoremove -y
      rmrf /usr/local/bin/amneziawg-go   # the userspace fallback swg pinned beside it — nothing drives it without the tools (1.8.8 deferred #2)
      ok "AmneziaWG package removed"
    else
      NOT_DONE+=("AmneziaWG package (kernel module + tools)")
      warn "apt could not purge the AmneziaWG packages (see the error above) — they are STILL INSTALLED. Re-run once apt is free."
    fi
  else warn "Non-apt system — remove the amneziawg packages with your package manager."; fi
}
awg_src_trees(){ local d; command -v dpkg >/dev/null 2>&1 || return 0
  for d in /usr/src/amneziawg-*; do grep -qs '^PACKAGE_NAME="\?amneziawg"\?[[:space:]]*$' "$d/dkms.conf" && ! dpkg -S "$d" >/dev/null 2>&1 && printf '%s\n' "$d"; done; return 0; }
awg_src_tools(){ [ -e /usr/bin/awg ] && command -v dpkg >/dev/null 2>&1 && ! dpkg -S /usr/bin/awg >/dev/null 2>&1; }
rm_awg_src(){ local d
  info "Uninstalling AmneziaWG built from source (kernel module + tools)"
  down_ifaces /etc/amnezia/amneziawg awg-quick      # as rm_awg_pkg: kept configs' interfaces go down before their module does
  for d in $(awg_src_trees); do run dkms remove "amneziawg/${d##*/amneziawg-}" --all >/dev/null 2>&1 || true; rmrf "$d"; done
  awg_src_tools && rmrf /usr/bin/awg /usr/bin/awg-quick /usr/share/man/man8/awg.8 /usr/share/man/man8/awg-quick.8 /lib/systemd/system/awg-quick@.service \
    /lib/systemd/system/awg-quick.target /usr/lib/systemd/system/awg-quick@.service /usr/lib/systemd/system/awg-quick.target
  rmrf /usr/local/bin/amneziawg-go; run systemctl daemon-reload 2>/dev/null || true
  awg_pkg || _awg_ppa_forget   # the PPA, when no package of it is left
  ok "AmneziaWG (built from source) removed — the module still loaded goes at the next boot"
}
rm_wg_peers(){
  info "Removing WireGuard interface configs (peers)"
  remove_ifaces /etc/wireguard wg-quick own
  rmdir_if_empty /etc/wireguard
}
rm_wg_foreign(){
  info "Removing the WireGuard interfaces that are NOT swg's"
  remove_ifaces /etc/wireguard wg-quick foreign
  rmdir_if_empty /etc/wireguard
}
rm_wg_pkg(){
  info "Uninstalling the WireGuard package"
  down_ifaces /etc/wireguard wg-quick
  if command -v apt-get >/dev/null 2>&1; then
    if run apt-get purge -y wireguard wireguard-tools; then run apt-get autoremove -y; ok "WireGuard package removed"
    else
      NOT_DONE+=("WireGuard package (kernel module + tools)")
      warn "apt could not purge the WireGuard packages (see the error above) — they are STILL INSTALLED. Re-run once apt is free."
    fi
  else warn "Non-apt system — remove the wireguard packages with your package manager."; fi
}
rm_netctl(){   # a leftover swg-netctl (e.g. after a docker convert) with no bare panel around to sweep it up
  info "Removing swg-netctl (leftover helper)"
  local _gone=""                                                  # what this run removes, for the gate's reap (a dry run keeps it)
  if [ ! -d /opt/swg-panel ] && [ ! -f $SD/swg-panel-server.service ]; then
    for _nc in swg-netctl.path swg-netctl.timer swg-netctl.service; do
      [ -e "$SD/$_nc" ] && run systemctl disable --now "$_nc" 2>/dev/null || true   # one at a time: a multi-unit disable aborts wholesale on the first missing unit
    done
    rmrf $SD/swg-netctl.service $SD/swg-netctl.service.d $SD/swg-netctl.path $SD/swg-netctl.timer /usr/local/bin/swg-netctl
    _gone="$_gone bare-gone"
  fi
  if ! docker_running swg-panel; then
    for _nc in swg-netctl-docker.path swg-netctl-docker.timer swg-netctl-docker.service; do
      [ -e "$SD/$_nc" ] && run systemctl disable --now "$_nc" 2>/dev/null || true
    done
    rmrf $SD/swg-netctl-docker.service $SD/swg-netctl-docker.service.d $SD/swg-netctl-docker.path $SD/swg-netctl-docker.timer /usr/local/bin/swg-netctl-docker /usr/local/bin/swg-netctl-docker.new
    _gone="$_gone docker-gone"
  fi
  rm_netctl_gate_if_last $_gone
  run systemctl daemon-reload; ok "swg-netctl removed"
}
rm_leftovers(){
  info "Removing leftover swg files (docker/converted install)"
  for _u in swg-sub.service; do [ -e "$SD/$_u" ] && run systemctl disable --now "$_u" 2>/dev/null || true; done
  rmrf /etc/swg-sub /opt/swg-sub "$SD/swg-sub.service" "$SD/swg-sub.service.d" /usr/local/bin/swg-sub \
       /var/www/wgstats /usr/local/bin/swg-passwd
  # Left alone while a docker panel runs, which changes nothing: Docker publishes its ports past ufw (its own nat and
  # FORWARD rules, never ufw's INPUT chain), so this rule never governed the port that panel serves.
  if ! docker_running swg-panel; then
    for _uf in "$DOCKER_DIR/data/etc/ufw-added" /etc/swg-panel.converted-*/ufw-added; do [ -f "$_uf" ] && ufw_forget "$_uf"; done
  fi
  for _u in swg-relay.slice; do [ -e "$SD/$_u" ] && run systemctl stop "$_u" 2>/dev/null || true; done
  rmrf "$SD/swg-relay@.service" "$SD/swg-relay.slice" /etc/swg-panel/relay
  rmrf /run/swg-relay-*.sock   # the relays' status sockets, as rm_node takes them (outside the unit's RuntimeDirectory)
  run systemctl daemon-reload
  # …and a WDTT / csqtt server's state no unit runs from any more (_fork_orphans), each with rm_wdtt / rm_csqtt's own question
  # and preset; no server of it is left to take down (an interface of that name now is the Docker node's)
  local _sd _g _v
  for _sd in $(_fork_orphans); do _g=CSQTT_DATA_DEL; [ "${_sd%/*}" = "$WDTT_DIR" ] && _g=WDTT_DATA_DEL
    _v="${_g}_${_sd##*/}"; _v="${_v//[^A-Za-z0-9_]/_}"; [ -n "${!_g:-}" ] && printf -v "$_v" '%s' "${!_g}"
    ask_yn "  Delete $_sd — a server's state a convert left here, run by nothing now? Without another copy its clients could never be restored." n "$_v"
    if [ "${!_v}" = yes ]; then rmrf "$_sd"; else ok "Kept $_sd"; fi; done
  for _sd in wdtt:"$WDTT_DIR" csqtt:"$CSQTT_DIR"; do ls $SD/swg-${_sd%%:*}-*.service >/dev/null 2>&1 || ls -d "${_sd#*:}"/*/ >/dev/null 2>&1 \
    || { rmrf "${_sd#*:}/.bin"; $DRYRUN || rmdir "${_sd#*:}" 2>/dev/null || true; }; done
  if docker_running swg-panel || docker_running swg-node; then
    info "  keeping the service users — a docker install is still on this box"
  else
    [ -d "$DOCKER_DIR/data" ] && run chown -R root:root "$DOCKER_DIR/data" 2>/dev/null || true
    hand_ids_to_root swgpanel swgsub swgpush swgagent   # …and the recovery archives a convert moved aside with them (F90)
    for _su in swgpanel swgsub; do id "$_su" >/dev/null 2>&1 && run userdel "$_su" 2>/dev/null || true; done
    for _su in swgpush swgagent; do id "$_su" >/dev/null 2>&1 && run userdel -r "$_su" 2>/dev/null || true; done
    REMOVED_LEFTOVERS=true    # lets the shared group cleanup at the end run for a docker/converted box too
  fi
  NEED_NETOBJ_SWEEP=true
  ok "leftover swg files removed"
}
unpark_kept_panel(){
  local _lbl="" _how="" _why=""
  if $_BARE_PARKED && [ -f "$SD/swg-panel-server.service" ] && ! docker_running swg-panel; then
    _lbl="Bare-metal swg-panel"
    if run systemctl enable --now swg-panel-server 2>/dev/null; then
      [ -f "$SD/swg-sub.service" ] && { run systemctl enable --now swg-sub 2>/dev/null || warn "  couldn't start swg-sub — start it by hand: systemctl enable --now swg-sub"; }
      _how="started again"
    else _how="still stopped"; warn "couldn't start the bare-metal panel — start it by hand: systemctl enable --now swg-panel-server swg-sub"; fi
    _why="the Docker panel answered at the same address"
  elif $_DOCKER_PARKED && docker_running swg-panel && [ ! -f "$SD/swg-panel-server.service" ] && [ ! -d /opt/swg-panel ]; then
    _lbl="Docker panel (swg-panel)"
    if run sh -c 'for c in swg-panel swg-sub; do docker inspect "$c" >/dev/null 2>&1 || continue
                    docker update --restart=unless-stopped "$c" >/dev/null && docker start "$c" >/dev/null || exit 1; done'; then
      _how="started again"
    else _how="still stopped"; warn "couldn't start the Docker panel — start it by hand: cd $DOCKER_DIR && docker compose up -d"; fi
    _why="the bare-metal panel answered at the same address"
  fi
  [ -n "$_lbl" ] || return 0
  [ "$_how" = "started again" ] && ok "$_lbl started again — it was stopped only because $_why, and that panel is gone now."
  local i; for i in "${!DID_KEEP[@]}"; do
    [ "${DID_KEEP[$i]}" = "$_lbl" ] && DID_KEEP[$i]="$_lbl — $_how (it had been stopped while $_why)"; done
  return 0; }
_has_bare_netctl(){ ls $SD/swg-netctl.* >/dev/null 2>&1; }
_has_docker_netctl(){ ls $SD/swg-netctl-docker.* >/dev/null 2>&1; }
_has_leftovers(){ [ -d /etc/swg-sub ] || [ -d /opt/swg-sub ] || [ -e "$SD/swg-sub.service" ] || [ -d "$SD/swg-sub.service.d" ] \
  || [ -d /var/www/wgstats ] || [ -e /usr/local/bin/swg-passwd ] \
  || [ -e "$SD/swg-relay.slice" ] || [ -e "$SD/swg-relay@.service" ] || [ -d /etc/swg-panel/relay ] \
  || id swgpanel >/dev/null 2>&1 || id swgsub >/dev/null 2>&1 || id swgpush >/dev/null 2>&1 || id swgagent >/dev/null 2>&1 \
  || getent group swg >/dev/null 2>&1 || [ -n "$(_fork_orphans)" ]; }
_fork_orphans(){ local d k; for d in "$WDTT_DIR"/*/ "$CSQTT_DIR"/*/; do d="${d%/}"; [ -d "$d" ] || continue
  k=csqtt; [ "${d%/*}" = "$WDTT_DIR" ] && k=wdtt; [ -e "$SD/swg-$k-${d##*/}.service" ] || printf '%s\n' "$d"; done; return 0; }

_ipt_comment_re(){ printf -- '--comment "?%s"?( |$)' "$(printf '%s' "$1" | sed 's/[][\.^$*+?(){}|/]/\\&/g')"; }
_rm_egress_rules(){ local ifn="$1" t c l
  command -v iptables >/dev/null 2>&1 || return 0
  for t in "nat POSTROUTING swg-egress:$ifn" "filter FORWARD swg-egress-acl:$ifn" "mangle FORWARD swg-egress-mss:$ifn"; do
    set -- $t
    while IFS= read -r l; do
      [ -n "$l" ] || continue
      run sh -c "iptables -t $1 $(printf '%s' "$l" | sed "s/^-A /-D /")"
    done <<EOS
$(iptables -t "$1" -S "$2" 2>/dev/null | grep -E -- "$(_ipt_comment_re "$3")")
EOS
  done; }
rm_smartdns_redirect(){ local l n=0
  command -v iptables >/dev/null 2>&1 || return 0
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    run sh -c "iptables -t nat $(printf '%s' "$l" | sed 's/^-A /-D /')" && n=$((n+1))
  done <<EOS
$(iptables -t nat -S PREROUTING 2>/dev/null | grep -E -- "$(_ipt_comment_re swg-smartdns)|$(_ipt_comment_re swg-smartdns-net)|$(_ipt_comment_re swg-s5x-dns)|$(_ipt_comment_re swg-s5x-dns-net)")
EOS
  [ "$n" -gt 0 ] && ! $DRYRUN && info "  removed the DNS redirects to the node's own resolvers — Force DNS's and a SOCKS5 exit's ($n rule(s)) — an interface kept here resolves through its clients' own DNS server again"
  return 0; }

rm_node_netobjects(){
  info "Removing swg datapath objects (iptables/nft/ipset/policy-routing tagged swg-*)"
  local t chain l n mark table
  if command -v iptables >/dev/null 2>&1; then
    for t in nat filter mangle; do
      for chain in $(iptables -t "$t" -S 2>/dev/null | sed -n 's/^-N \([A-Za-z0-9_-]*\).*/\1/p'; echo PREROUTING INPUT FORWARD OUTPUT POSTROUTING); do
        iptables -t "$t" -S "$chain" 2>/dev/null | grep -E -- '--comment "?swg-' | while IFS= read -r l; do   # quoted OR not (see _ipt_comment_re)
          [ -n "$l" ] && run sh -c "iptables -t $t $(printf '%s' "$l" | sed 's/^-A /-D /')"
        done
      done
    done
  fi
    if command -v iptables >/dev/null 2>&1; then
      for t in nat filter mangle; do
        for chain in $(iptables -t "$t" -S 2>/dev/null | sed -n 's/^-N \(SWG[A-Za-z0-9_]*\).*/\1/p'); do
          iptables -t "$t" -S 2>/dev/null | grep -E -- "-j ${chain}$" | while IFS= read -r l; do
            [ -n "$l" ] && run sh -c "iptables -t $t $(printf '%s' "$l" | sed 's/^-A /-D /')"
          done
          run sh -c "iptables -t $t -F $chain"; run sh -c "iptables -t $t -X $chain"
        done
      done
    fi
    local _nftl _nftrc=0 _unread=""
    if command -v nft >/dev/null 2>&1; then
      _nftl="$(nft list tables 2>/dev/null)" || _nftrc=$?
      if [ "$_nftrc" -ne 0 ]; then
        _unread="nft list tables exited $_nftrc$([ "$_nftrc" -gt 128 ] && echo " (killed by signal $((_nftrc - 128)) — a crash)")"
        warn "could not read the nft ruleset: $_unread. Any swg* nft table is still in the kernel — a reboot clears it (it lives only there), or delete it with an nft that can read it (e.g. a Docker node's own image: docker run --rm --net host --cap-add NET_ADMIN --entrypoint nft <image> delete table inet <table>)."
      else
        printf '%s\n' "$_nftl" | sed -n 's/^table \([a-z0-9]*\) \(swg[A-Za-z0-9_]*\).*/\1 \2/p' | while read -r fam tbl; do
          [ -n "$tbl" ] && run nft delete table "$fam" "$tbl"
        done
      fi
    fi
    # ipsets: swgk_* are the kernel-SNI sets, but swgp_src (turn client-IP capture) is ours too.
    if command -v ipset >/dev/null 2>&1; then
      for n in $(ipset list -name 2>/dev/null | grep '^swg'); do run ipset destroy "$n"; done
    fi
  if command -v ip >/dev/null 2>&1; then
    for n in $(ip rule show 2>/dev/null | sed -n 's/^\([0-9]\+\):.*/\1/p' | awk '$1>=7000 && $1<=7099'); do
      run ip rule del pref "$n"; run ip route flush table "$n"
    done
    # Personal SOCKS5 marks use the same tables with their own priority (swg-noded's STATIC_EGRESS_PREF).
    while read -r mark table; do
      if [[ $table =~ ^70[0-9][0-9]$ && $mark =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] && (( mark == table + 100 )); then
        run ip rule del pref 6991 fwmark "$mark" lookup "$table"
      fi
    done < <(ip rule show 2>/dev/null | awk '$1=="6991:" && $4=="fwmark" && $6=="lookup" {print $5, $7}')
    for n in $(ip rule show 2>/dev/null | sed -n 's/^\([0-9]\+\):.*/\1/p' | awk '$1==6870 || $1==6880 || ($1>=6890 && $1<=6989)'); do
      run ip rule del pref "$n"
    done
  fi
  if command -v iptables >/dev/null 2>&1; then
    for n in $(iptables -S 2>/dev/null | grep -oE '[-]{1,2}[io] swg_[A-Za-z0-9_]+' | awk '{print $2}' | sort -u); do
      ip link show "$n" >/dev/null 2>&1 && continue          # link still up → not an orphan, leave it alone
      iptables -S 2>/dev/null | grep -E -- "-[io] ${n}( |$)" | while IFS= read -r l; do
        [ -n "$l" ] && run sh -c "iptables $(printf '%s' "$l" | sed 's/^-A /-D /')"
      done
    done
  fi
  # 99-swg-forward.conf is the BARE installer's name; install-docker.sh writes 99-swg-node.conf instead, so the
  # docker drop-in was never removed. Both are ours and both are unconditionally rewritten by a re-install.
  rmrf /etc/sysctl.d/99-swg-forward.conf /etc/sysctl.d/99-swg-node.conf /etc/sysctl.d/99-swg-turn.conf   # + swg-noded's turn socket caps (DEB-2)
  grep -qsE --exclude='99-swg-*' '^[[:space:]]*net[./]ipv4[./]conf[./]all[./]route_localnet[[:space:]]*=[[:space:]]*1' /etc/sysctl.conf \
    /etc/sysctl.d/*.conf /run/sysctl.d/*.conf /usr/local/lib/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /lib/sysctl.d/*.conf \
    || run sysctl -q -w net.ipv4.conf.all.route_localnet=0 >/dev/null 2>&1 || true
  if [ -n "$_unread" ]; then
    warn "swg datapath objects: the rest removed — NOT the nft tables, whose ruleset could not be read (see above)"
    NOT_DONE+=("swg nft tables — the host's nft could not read the ruleset ($_unread); a reboot clears them")
  else ok "swg datapath objects removed"; fi
}

rm_turn(){ local unit="$1" name fork
  name="$(basename "$unit" .service)"; fork="${name#vk-turn-proxy-}"
  info "Removing turn-proxy ($fork)"
  [ -e "$unit" ] && run systemctl disable --now "$name"
  rmrf "$unit" "$TURN_DIR/$fork"; run systemctl daemon-reload
  ls $SD/vk-turn-proxy-"${fork%-*}"-*.service >/dev/null 2>&1 || rmrf "$TURN_DIR/.bin/${fork%-*}"   # fork's last instance → drop its shared binary
  # last one out removes the shared dir + the panel-facing record
  ls $SD/vk-turn-proxy-*.service >/dev/null 2>&1 || rmrf "$TURN_DIR" $(rec_paths turn-proxy.json)
  ok "turn-proxy ($fork) removed"
}

rm_wdtt(){ local unit="$1" name iface fork
  name="$(basename "$unit" .service)"; iface="${name#swg-wdtt-}"
  fork="$(sed -n 's/^Description=swg-wdtt (\([^)]*\)).*/\1/p' "$unit" 2>/dev/null | sed -n 1p)"; fork="${fork%%/*}"
  info "Removing WDTT server ($iface${fork:+ · $fork})"
  [ -e "$unit" ] && run systemctl disable --now "$name"
  rmrf "$unit"; run systemctl daemon-reload
  local live=no; docker_running swg-node && [ -d "$DOCKER_DIR/data/node/wdtt/$iface" ] && live=yes
  if [ "$live" = yes ]; then info "  the Docker node runs $iface now — only this stale bare unit goes; its interface, socket and rules stay"
  else
    command -v ip >/dev/null 2>&1 && run ip link delete dev "$iface" 2>/dev/null || true   # its userspace tunnel outlives the process
    rmrf "/var/run/wireguard/$iface.sock"   # the wireguard-go UAPI socket outlives it too — and a stale one makes the node report a PHANTOM adoption candidate
    _rm_egress_rules "$iface"
  fi
  local _delvar="WDTT_DATA_DEL_${iface//[^A-Za-z0-9_]/_}"
  [ -n "${WDTT_DATA_DEL:-}" ] && printf -v "$_delvar" '%s' "$WDTT_DATA_DEL"
  ask_yn "  Delete this WDTT interface identity + passwords ($WDTT_DIR/$iface)? Clients on it could never be restored." n "$_delvar"
  if [ "${!_delvar}" = yes ]; then
    rmrf "$WDTT_DIR/$iface"
  else
    ok "Kept $WDTT_DIR/$iface (server identity + passwords) for a future re-install"
  fi
  ls $SD/swg-wdtt-*.service >/dev/null 2>&1 || {          # last one out: shared per-fork binaries + the panel-facing record
    rmrf "$WDTT_DIR/.bin" $(rec_paths wdtt.json)
    $DRYRUN || rmdir "$WDTT_DIR" 2>/dev/null || true   # and the dir once empty: every identity deleted. It read the RAW preset — the documented WDTT_DATA_DEL=y left it, empty (1.8.9 qualification D12-3)
  }
  ok "WDTT server ($iface) removed"
}

rm_csqtt(){ local unit="$1" name iface
  name="$(basename "$unit" .service)"; iface="${name#swg-csqtt-}"
  info "Removing csqtt server ($iface)"
  [ -e "$unit" ] && run systemctl disable --now "$name"
  rmrf "$unit"; run systemctl daemon-reload
  command -v ip >/dev/null 2>&1 && run ip link delete dev "$iface" 2>/dev/null || true   # its raw TUN outlives the process
  # The node owns this instance's egress rules (csqtt runs with --no-nat), same as WDTT — remove by our comment tag.
  _rm_egress_rules "$iface"
  local _delvar="CSQTT_DATA_DEL_${iface//[^A-Za-z0-9_]/_}"
  [ -n "${CSQTT_DATA_DEL:-}" ] && printf -v "$_delvar" '%s' "$CSQTT_DATA_DEL"
  ask_yn "  Delete this csqtt server's password store ($CSQTT_DIR/$iface)? Clients on it could never be restored." n "$_delvar"
  if [ "${!_delvar}" = yes ]; then
    rmrf "$CSQTT_DIR/$iface"
  else
    ok "Kept $CSQTT_DIR/$iface (password store) for a future re-install"
  fi
  ls $SD/swg-csqtt-*.service >/dev/null 2>&1 || {          # last one out: shared binary + the panel-facing record
    rmrf "$CSQTT_DIR/.bin" $(rec_paths csqtt.json)
    $DRYRUN || rmdir "$CSQTT_DIR" 2>/dev/null || true   # …and the dir once empty (as rm_wdtt)
  }
  ok "csqtt server ($iface) removed"
}

# ───────────────────────── detect installed components ─────────────────────────
declare -a CLABEL=() CDETAIL=() CFN=() CARG=() CHINT=() CVERB=() CPROMPT=() CNOAUTO=()   # init empty (not just `declare -a`) — bash 5.2 + set -u treats a never-assigned array as unbound for ${#arr[@]}
swg_owned_ifaces(){
  [ -f /etc/swg-agent/config.json ] && command -v python3 >/dev/null 2>&1 || return 0
  python3 - <<'PY' 2>/dev/null || true
import json
try: c = json.load(open("/etc/swg-agent/config.json"))
except Exception: raise SystemExit
print(" ".join(str(k) for k in (c.get("interfaces") or {})))
PY
}
_SWG_OWNED=" $(swg_owned_ifaces 2>/dev/null | tr '\n' ' ') "
swg_owns(){ case "$_SWG_OWNED" in *" $1 "*) return 0;; *) return 1;; esac; }
_iface_mesh(){ case "$1" in "${SWG_SYS_PREFIX:-swg_}"*) return 0;; *) return 1;; esac; }
_iface_pick(){ local n="$1" want="${2:-own}"
  case "$want" in
    mesh)    _iface_mesh "$n" ;;
    own)     if _iface_mesh "$n"; then return 1; else swg_owns "$n"; fi ;;
    foreign) if _iface_mesh "$n" || swg_owns "$n"; then return 1; else return 0; fi ;;
    *)       return 0 ;;
  esac
}
iface_list(){  # <dir> [own|foreign|all] -> "awg0:51820, awg505:51234" (name + ListenPort from each .conf)
  local dir="$1" want="${2:-own}" out="" f n p
  for f in "$dir"/*.conf; do [ -f "$f" ] || continue
    n="$(basename "$f" .conf)"
    _iface_pick "$n" "$want" || continue
    p="$(sed -n 's/^[[:space:]]*ListenPort[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$f" 2>/dev/null | sed -n 1p)"
    out="${out:+$out, }${n}${p:+:$p}"
  done
  printf '%s' "$out"
}
bm_node_detail(){  # bare-metal node: endpoint + interfaces from config.json
  local cfg=/etc/swg-agent/config.json ep ifs
  if [ -f "$cfg" ] && command -v python3 >/dev/null 2>&1; then
    ep="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("endpoint_host",""))' "$cfg" 2>/dev/null)"
    ifs="$(python3 -c 'import json,sys;print(", ".join(k for k in (json.load(open(sys.argv[1])).get("interfaces") or {}) if not k.startswith("swg_")))' "$cfg" 2>/dev/null)"
  fi
  printf 'swg-noded%s%s' "${ep:+ · endpoint $ep}" "${ifs:+ · ifaces: $ifs}"
}
docker_node_detail(){  # docker node: name/endpoint + interfaces (name:port) from the deployment .env; [$1] leads the line
  local env="$DOCKER_DIR/.env" ep nm ni ifs
  if [ -f "$env" ]; then
    ep="$(sed -n 's/^NODE_ENDPOINT=//p' "$env" | sed -n 1p | tr -d '"')"
    nm="$(sed -n 's/^NODE_NAME=//p' "$env" | sed -n 1p | tr -d '"')"
    ni="$(sed -n 's/^NODE_IFACES=//p' "$env" | sed -n 1p | tr -d '"')"
    if [ -n "$ni" ]; then ifs="$(printf '%s' "$ni" | tr ',' '\n' | cut -d: -f1,2 | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
    else ifs="$(sed -n 's/^NODE_IFACE=//p' "$env" | sed -n 1p | tr -d '"')"; fi
  fi
  local tn wl wn
  tn="$(docker ps -a --filter 'name=swg-turn-' --format '{{.Names}}' 2>/dev/null | sed 's/^swg-turn-//' | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
  wl="$(python3 - "$DOCKER_DIR/data/node/wdtt.json" <<'PYWD' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
out = []
for i in (d.get("wdtt") or []):
    if isinstance(i, dict) and i.get("iface"):
        out.append("%s%s" % (i["iface"], ("/" + i["fork"]) if i.get("fork") else ""))
print(", ".join(out))
PYWD
)"
  wn="$(printf '%s' "$wl" | tr ',' '\n' | grep -c . 2>/dev/null)"
  # csqtt, same disclosure and for the same reason — a supervised subprocess inside swg-node, so no host unit names
  # it and it would leave with the container unannounced. Its record is a flat {iface: inst} map, not WDTT's list.
  local cl cn
  cl="$(python3 - "$DOCKER_DIR/data/node/csqtt.json" <<'PYCQ' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
if not isinstance(d, dict):
    raise SystemExit
out = []
for k, i in d.items():
    if isinstance(i, dict):
        n = len(i.get("passwords") or {})
        out.append("%s%s" % (k, (" (%d pw)" % n) if n else ""))
print(", ".join(out))
PYCQ
)"
  cn="$(printf '%s' "$cl" | tr ',' '\n' | grep -c . 2>/dev/null)"
  printf '%s%s%s%s%s%s%s' "${1:-container swg-node}" "${nm:+ · $nm}" "${ep:+ · endpoint $ep}" "${ifs:+ · ifaces: $ifs}" \
         "${tn:+ · turn-proxies: $tn}" "${wl:+ · WDTT ($wn): $wl}" "${cl:+ · csqtt ($cn): $cl}"
}
turn_exec_env(){  # <unit> -> "<listen>\t<connect>", resolving the EnvironmentFile (turn.env) form
  local unit="$1" exe envf
  exe="$(sed -n 's/^ExecStart=//p' "$unit" 2>/dev/null | sed -n 1p)"
  case "$exe" in
    *'${SWG_'*)   # env-file form — values live in turn.env, not the ExecStart
      envf="$(sed -n 's/^EnvironmentFile=-\{0,1\}//p' "$unit" 2>/dev/null | sed -n 1p)"
      printf '%s\t%s' "$({ sed -n 's/^SWG_DIAL=//p' "$envf"; sed -n 's/^SWG_LISTEN=//p' "$envf"; } 2>/dev/null | awk 'NF && !d {print; d=1}')" "$(sed -n 's/^SWG_CONNECT=//p' "$envf" 2>/dev/null | sed -n 1p)" ;;   # SWG_DIAL first: what clients dial, when it differs from the bind (FN-2(a))
    *)            # legacy baked-ExecStart form
      printf '%s\t%s' "$(printf '%s' "$exe" | sed -n 's/.*-listen[ =]\{1,\}\([^ ]*\).*/\1/p')" "$(printf '%s' "$exe" | sed -n 's/.*-connect[ =]\{1,\}\([^ ]*\).*/\1/p')" ;;
  esac
}
turn_fwd_iface(){  # connect "ip:port" -> the wg/awg interface whose ListenPort matches the port (else empty)
  local cp="${1##*:}" f lp
  for f in /etc/amnezia/amneziawg/*.conf /etc/wireguard/*.conf; do [ -f "$f" ] || continue
    lp="$(sed -n 's/^[[:space:]]*ListenPort[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$f" 2>/dev/null | sed -n 1p)"
    [ -n "$lp" ] && [ "$lp" = "$cp" ] && { basename "$f" .conf; return; }
  done
}
turn_detail(){  # <unit> -> "1.2.3.4:57000 → 127.0.0.1:51820 (wg7)" — the listen → connect (iface) style used elsewhere
  local lis con fw; IFS="$(printf '\t')" read -r lis con < <(turn_exec_env "$1")
  fw="$(turn_fwd_iface "$con")"
  printf '%s%s%s' "${lis:-?}" "${con:+ → $con}" "${fw:+ ($fw)}"
}
add(){ CLABEL+=("$1"); CDETAIL+=("$2"); CFN+=("$3"); CARG+=("${4:-}"); CHINT+=("${5:-}"); CVERB+=("${6:-Uninstall}"); CPROMPT+=("${7:-$1}"); CNOAUTO+=("${8:-}"); }   # $6 = question verb (default Uninstall); $7 = shorter label for the question (defaults to the list label); $8 = "never-auto" ⇒ --yes does NOT answer it
turn_listen(){ local lis con; IFS="$(printf '\t')" read -r lis con < <(turn_exec_env "$1"); printf '%s' "$lis"; }
# WDTT: params live in the instance's wdtt.env (the unit's ExecStart only references them), so read that.
wdtt_env(){ local iface="$1" k="$2"; sed -n "s/^$k=//p" "$WDTT_DIR/$iface/wdtt.env" 2>/dev/null | sed -n 1p; }
wdtt_listen(){ local n; n="$(basename "$1" .service)"; wdtt_env "${n#swg-wdtt-}" SWG_LISTEN; }
wdtt_detail(){  # <unit> -> "amurcanov · DTLS 1.2.3.4:56000 · wg :56001 · 10.66.66.1/24 · identity kept"
  local unit="$1" n iface fork lis wgp addr id
  n="$(basename "$unit" .service)"; iface="${n#swg-wdtt-}"
  fork="$(sed -n 's/^Description=swg-wdtt (\([^)]*\)).*/\1/p' "$unit" 2>/dev/null | sed -n 1p)"; fork="${fork%%/*}"
  lis="$(wdtt_env "$iface" SWG_LISTEN)"; wgp="$(wdtt_env "$iface" SWG_WGPORT)"; addr="$(wdtt_env "$iface" SWG_WGADDR)"
  [ -f "$WDTT_DIR/$iface/wg-keys.dat" ] && id="server identity on disk" || id="no identity file"
  printf '%s%s%s%s · %s' "${fork:-wdtt}" "${lis:+ · DTLS $lis}" "${wgp:+ · $iface:$wgp}" "${addr:+ · $addr}" "$id"
}
# csqtt: same idea, its own env file. There is no identity file to report — the store IS the identity, so say how
# many passwords would go with it, which is the number that decides the keep/delete answer.
csqtt_env(){ local iface="$1" k="$2"; sed -n "s/^$k=//p" "$CSQTT_DIR/$iface/csqtt.env" 2>/dev/null | sed -n 1p; }
csqtt_listen(){ local n; n="$(basename "$1" .service)"; csqtt_env "${n#swg-csqtt-}" SWG_LISTEN; }
csqtt_detail(){  # <unit> -> "csqtt · 1.2.3.4:56006 · 10.12.0.1/24 · 4 passwords on disk"
  local unit="$1" n iface lis addr pw
  n="$(basename "$unit" .service)"; iface="${n#swg-csqtt-}"
  lis="$(csqtt_env "$iface" SWG_LISTEN)"; addr="$(csqtt_env "$iface" SWG_TUNADDR)"
  pw="$(python3 -c 'import json,os,sqlite3,sys
d = sys.argv[1]
try:
    j = os.path.join(d, "passwords.json")
    if os.path.isfile(j):
        print(len(json.load(open(j)).get("passwords") or {}))
    else:
        c = sqlite3.connect(os.path.join(d, "csqtt.db"))
        try: print(len(list(c.execute("SELECT 1 FROM passwords"))))
        finally: c.close()
except Exception: print("")' "$CSQTT_DIR/$iface" 2>/dev/null)"
  if [ -n "$pw" ]; then pw="$pw password(s) on disk"; else pw="no password store"; fi
  printf 'csqtt%s%s · %s' "${lis:+ · $lis}" "${addr:+ · $addr}" "$pw"
}

[ -d /opt/swg-panel ] || [ -f $SD/swg-panel-server.service ] && \
  add "Bare-metal swg-panel" "control panel (/opt/swg-panel)" rm_panel
[ -d /opt/swg-noded ] || [ -d /opt/swg-agent ] || [ -f $SD/swg-noded.service ] && \
  add "Bare-metal node (swg-node)" "$(bm_node_detail)" rm_node

# Docker: the panel and node are separate containers — offer each independently. If the
# deployment dir exists but neither container does, offer a files-only cleanup.
DPANEL=false; DNODE=false; DNODE_GONE=false
if command -v docker >/dev/null 2>&1; then
  docker_running swg-panel && DPANEL=true
  docker_running swg-node  && DNODE=true
fi
if ! $DNODE && [ ! -f "$SD/swg-noded.service" ] && [ ! -d /opt/swg-noded ] \
   && { [ -d "$DOCKER_DIR/data/node" ] || [ -d "$DOCKER_DIR/data/node-confs" ]; }; then
  DNODE_GONE=true; add "Docker node (swg-node)" "$(docker_node_detail "its container is gone — what it left on this host goes")" rm_docker_node
fi
$DPANEL && add "Docker panel (swg-panel)" "container swg-panel" rm_docker_panel
$DNODE  && add "Docker node (swg-node)"   "$(docker_node_detail)"   rm_docker_node
_ctr_parked(){ [ "$(docker inspect -f '{{.State.Running}} {{.HostConfig.RestartPolicy.Name}}' "$1" 2>/dev/null)" = "false no" ]; }
_BARE_PARKED=false; _DOCKER_PARKED=false
if [ -f "$SD/swg-panel-server.service" ] && $DPANEL; then
  if ! systemctl is-enabled --quiet swg-panel-server 2>/dev/null; then ! _ctr_parked swg-panel && _BARE_PARKED=true
  else _ctr_parked swg-panel && _DOCKER_PARKED=true; fi
fi
{ { [ ! -d /opt/swg-panel ] && [ ! -f $SD/swg-panel-server.service ] && _has_bare_netctl; } || { ! $DPANEL && _has_docker_netctl; }; } && \
  add "swg-netctl (leftover helper)" "privileged network/TLS helper units" rm_netctl

if [ ! -d /opt/swg-panel ] && [ ! -f $SD/swg-panel-server.service ] \
   && [ ! -d /opt/swg-noded ] && [ ! -f $SD/swg-noded.service ] && _has_leftovers; then
  add "Leftover swg files" "swg-sub dirs/units + service identities from a docker or converted install" rm_leftovers
fi
if ! $DPANEL && ! $DNODE && ! $DNODE_GONE && { [ -f "$DOCKER_DIR/docker-compose.yml" ] || [ -f "$DOCKER_DIR/.env" ]; }; then
  add "Docker deployment (files)" "$DOCKER_DIR" rm_docker_files
fi

pkg_ii(){ grep -qE "$1" <<< "$(dpkg -l 2>/dev/null)"; }
# interface configs (the PEERS) vs the system PACKAGE — detected + offered SEPARATELY
awg_ifaces(){ ls /etc/amnezia/amneziawg/*.conf >/dev/null 2>&1 || ls $SD/awg*.service >/dev/null 2>&1; }
wg_ifaces(){  ls /etc/wireguard/*.conf >/dev/null 2>&1 || ls $SD/wg-quick@*.service >/dev/null 2>&1; }
awg_pkg(){ command -v dpkg >/dev/null 2>&1 && pkg_ii '^ii +amneziawg(-tools| |$)'; }
wg_pkg(){  command -v dpkg >/dev/null 2>&1 && pkg_ii '^ii +wireguard '; }
_f=""; _fw=""   # the foreign interface lists, set by the registrations below and READ by the package ones
_bare_swg=false; { [ -d /opt/swg-noded ] || [ -d /opt/swg-agent ] || [ -f "$SD/swg-noded.service" ] || [ -d /opt/swg-panel ] || [ -f "$SD/swg-panel-server.service" ]; } && _bare_swg=true
awg_ifaces && { _d="$(iface_list /etc/amnezia/amneziawg own)"; [ -n "$_d" ] && add "AmneziaWG interfaces" "$_d" rm_awg_peers "" "$_d" Remove
                _f="$(iface_list /etc/amnezia/amneziawg foreign)"; [ -n "$_f" ] && add "AmneziaWG interfaces NOT created by swg" "$_f" rm_awg_foreign "" "$_f" Remove "AmneziaWG interfaces NOT created by swg" never-auto; true; }
awg_pkg    && { $_bare_swg || ls /etc/apt/sources.list.d/*amnezia* >/dev/null 2>&1; } && { if [ -n "$_f" ]; then add "AmneziaWG package (kernel module + tools)" "amneziawg · amneziawg-tools · amneziawg-dkms" rm_awg_pkg "" "$_f needs it" Uninstall "AmneziaWG package (kernel module + tools)" never-auto
                             else add "AmneziaWG package (kernel module + tools)" "amneziawg · amneziawg-tools · amneziawg-dkms" rm_awg_pkg; fi; }
{ awg_src_tools || [ -n "$(awg_src_trees)" ]; } && $_bare_swg && { if [ -n "$_f" ]; then add "AmneziaWG built from source (kernel module + tools)" "awg · awg-quick · its DKMS module" rm_awg_src "" "$_f needs it" Uninstall "AmneziaWG built from source (kernel module + tools)" never-auto
                             else add "AmneziaWG built from source (kernel module + tools)" "awg · awg-quick · its DKMS module" rm_awg_src; fi; }
wg_ifaces  && { _d="$(iface_list /etc/wireguard own)"; [ -n "$_d" ] && add "WireGuard interfaces" "$_d" rm_wg_peers "" "$_d" Remove
                _fw="$(iface_list /etc/wireguard foreign)"; [ -n "$_fw" ] && add "WireGuard interfaces NOT created by swg" "$_fw" rm_wg_foreign "" "$_fw" Remove "WireGuard interfaces NOT created by swg" never-auto; true; }
wg_pkg     && $_bare_swg && { if [ -n "$_fw" ]; then add "WireGuard package (kernel module + tools)" "wireguard · wireguard-tools" rm_wg_pkg "" "$_fw needs it" Uninstall "WireGuard package (kernel module + tools)" never-auto
                             else add "WireGuard package (kernel module + tools)" "wireguard · wireguard-tools" rm_wg_pkg; fi; }
true   # don't let the last &&-test leave a non-zero status

for unit in $(ls $SD/vk-turn-proxy-*.service 2>/dev/null || true); do
  add "Turn-proxy (service) $(basename "$unit" .service)" "$(turn_detail "$unit")" rm_turn "$unit" "$(turn_listen "$unit")" "" "Turn-proxy $(basename "$unit" .service)"   # type + green service name, then listen → connect (iface)
done
for unit in $(ls $SD/swg-wdtt-*.service 2>/dev/null || true); do   # WDTT servers — listed per instance, like turn-proxies
  add "WDTT (service + interface) $(basename "$unit" .service)" "$(wdtt_detail "$unit")" rm_wdtt "$unit" "$(wdtt_listen "$unit")" "" "WDTT-proxy $(basename "$unit" .service)"
done
for unit in $(ls $SD/swg-csqtt-*.service 2>/dev/null || true); do   # csqtt servers — same, one entry per instance
  add "csqtt (service + interface) $(basename "$unit" .service)" "$(csqtt_detail "$unit")" rm_csqtt "$unit" "$(csqtt_listen "$unit")" "" "csqtt server $(basename "$unit" .service)"
done

N=${#CLABEL[@]}
[ "$N" -gt 0 ] || die "swg-panel does not appear to be installed here (nothing to do)"

# ───────────────────────── list, then prompt per component ─────────────────────────
echo; info "Found these installed components:"; echo
for i in $(seq 0 $((N-1))); do printf '    %s%s%s  %s\n' "$(c '0;32')" "${CLABEL[$i]}" "$(c 0)" "$(c '0;90')${CDETAIL[$i]}$(c 0)"; done
echo
$ASSUME_YES && info "--yes: every component will be uninstalled (you'll still be asked the destructive sub-questions)." \
            || echo "  You'll be asked about each component one by one — nothing is removed without your yes."
echo

# Per component: ask "Uninstall X?"; if yes, the removal fn asks its own destructive sub-questions
# (keep peers / delete data dir) so the peers' fate is decided in context, not up front.
DID_REMOVE=(); DID_KEEP=(); NOT_DONE=()   # NOT_DONE: asked for, attempted, and the box says otherwise
for i in $(seq 0 $((N-1))); do
  if ask_comp "${CPROMPT[$i]}" "${CHINT[$i]}" "${CVERB[$i]}" "${CNOAUTO[$i]}"; then "${CFN[$i]}" "${CARG[$i]}"
    case " ${NOT_DONE[*]-} " in *" ${CLABEL[$i]} "*) :;; *) DID_REMOVE+=("${CLABEL[$i]}");; esac
  else info "Kept ${CLABEL[$i]}."; DID_KEEP+=("${CLABEL[$i]}")
    case "${CFN[$i]}" in rm_awg_pkg|rm_awg_src|rm_wg_pkg|rm_awg_foreign|rm_wg_foreign|rm_panel|rm_docker_panel|rm_docker_files|rm_netctl|rm_leftovers) ;;
      *) KEPT_DATAPATH=true;; esac
  fi
  echo
done

if [ "${NEED_NETOBJ_SWEEP:-false}" = true ]; then
  if [ "${KEPT_DATAPATH:-false}" = true ]; then
    info "Some components were kept — leaving the routing/filter objects in place so they keep working."
    info "  To clear them later, once nothing swg-related remains: re-run this uninstaller."
  else
    rm_node_netobjects
  fi
fi

if [ -n "${ADOPTED_CTRS:-}" ] && command -v docker >/dev/null 2>&1; then
  _nc="$(printf '%s\n' "$ADOPTED_CTRS" | grep -c .)"
  info "$_nc container(s) had an interface taken over by this node — still stopped, as the take-over left them."
  ask_yn "  Start them again? Without this the box is left with no server at all — ours removed, theirs off." y RESTORE_CTRS
  if [ "${RESTORE_CTRS:-}" = yes ]; then
    printf '%s\n' "$ADOPTED_CTRS" | while IFS= read -r _c; do [ -n "$_c" ] || continue
      docker inspect "$_c" >/dev/null 2>&1 || { info "  $(b "$_c") is gone — nothing to restore"; continue; }
      run sh -c "docker update --restart=always '$_c' >/dev/null 2>&1 || true"
      if $DRYRUN; then echo "    [dry] docker start $_c"; continue; fi
      if docker start "$_c" >/dev/null 2>&1; then ok "restarted $(b "$_c") — its own server is serving again"
      else warn "  could not start $(b "$_c") — start it by hand: docker start $_c"; fi
    done
  else info "  Left stopped — start one by hand with: docker start <name>"; fi
fi

unpark_kept_panel
rm_log_journals   # swg's own journals + every log drop-in, once nothing of swg's is left (see there)
rm_update_leftovers   # …and update.sh's lock
_archives(){ ls -d /opt/swg-panel*.converted-* /opt/swg-panel*.uninstalled-* /etc/swg-panel*.converted-* \
                   /etc/swg-panel*.uninstalled-* /var/lib/swg-panel*.converted-* /var/lib/swg-panel*.uninstalled-* 2>/dev/null; }
_seal_archives   # kept or not, every recovery archive is root's alone from here on (F90)
if [ -n "$(_archives)" ]; then
  _na="$(_archives | wc -l)"
  # …and say which of them THIS run saved (asked interactively, the answer covers it too — so it must say so).
  _nr=0; for _a in ${RUN_ARCHIVES:-}; do [ -e "$_a" ] && _nr=$((_nr+1)); done
  info "$_na recovery archive(s) remain (node token + interface keys)$([ "$_nr" -gt 0 ] && printf ' — %s saved by this run, the rest from earlier converts/uninstalls' "$_nr")."
  ask_yn "  Delete them too? A future install can no longer offer them for recovery." n ARCHIVES_DEL
  if [ "${ARCHIVES_DEL:-}" = yes ]; then _archives | while IFS= read -r _a; do [ -n "$_a" ] && rmrf "$_a"; done
    ok "removed $_na recovery archive(s)$([ "$_nr" -gt 0 ] && printf ' — including the copy saved above: this node can no longer be recovered from this box')"
  else info "  Kept — delete by hand once you no longer need them:"; _archives | sed 's/^/      /'; fi   # …naming them
fi

# group cleanup (shared by panel + agent) — only if we removed a bare-metal piece, or swept the bare-metal
# identities off a docker/converted box (where REMOVED_PANEL/REMOVED_NODE are never set but the group is ours).
if { $REMOVED_PANEL || $REMOVED_NODE || [ "${REMOVED_LEFTOVERS:-false}" = true ]; } && getent group swg >/dev/null 2>&1; then
  # …but only when it CAN go: a kept panel's accounts still have swg as their group (groupdel refuses then), and handing
  # its files to root first would lock that panel out of its own login and certificate.
  _sg="$(getent group swg | cut -d: -f3 || true)"
  if ! $DRYRUN && [ -n "$(getent passwd | awk -F: -v g="$_sg" '$4 == g {print $1}' || true)" ]; then
    info "group 'swg' still in use — left in place."
  else
    hand_ids_to_root swg   # every kept path still in group swg goes to root first — its gid is freed here (F90)
    run groupdel swg 2>/dev/null || info "group 'swg' still in use — left in place."
  fi
fi
$DRYRUN || rmdir /etc/swg-agent 2>/dev/null || true   # (a dry run removes nothing, not even an empty directory)
if [ "${#DID_REMOVE[@]}" -gt 0 ] && command -v dpkg >/dev/null 2>&1; then
  for _d in /etc/amnezia/amneziawg /etc/amnezia /etc/wireguard /var/www; do
    [ -d "$_d" ] && [ -z "$(ls -A "$_d" 2>/dev/null)" ] && ! dpkg -S "$_d" >/dev/null 2>&1 && run rmdir "$_d"
  done
fi
# Docker Engine is not swg's to remove — other containers may use it, and an install may have found it here — but a run that
# removed a Docker install says it stays, and how it goes (1.8.8 deferred #8)
case " ${DID_REMOVE[*]-} " in *" Docker "*) command -v docker >/dev/null 2>&1 && DID_KEEP+=("Docker Engine — still installed, other containers may use it (to remove it: apt-get purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)");; esac

echo; echo "$(b '──────────────── SUMMARY ────────────────')"; echo
if [ "${#DID_REMOVE[@]}" -gt 0 ]; then echo "  $(b Removed):"
  for x in "${DID_REMOVE[@]}"; do echo "    $(c '0;31')✗$(c 0) $x"; done; fi
[ "${#DID_REMOVE[@]}" -gt 0 ] && [ "${#DID_KEEP[@]}" -gt 0 ] && echo
if [ "${#DID_KEEP[@]}" -gt 0 ]; then echo "  $(b Kept):"
  for x in "${DID_KEEP[@]}"; do echo "    $(c '0;32')•$(c 0) $x"; done; fi
# The list that has to exist for the other two to be worth anything: what was asked for, attempted, and
# did not happen. Without it a failed purge sat under "Removed" and the operator had no reason to look.
if [ "${#NOT_DONE[@]}" -gt 0 ]; then echo
  echo "  $(b 'Asked for but NOT removed') — the box still has these:"
  for x in "${NOT_DONE[@]}"; do echo "    $(c '0;33')!$(c 0) $x"; done; fi
echo
$DRYRUN && ok "DRY RUN — nothing was actually removed; re-run without --dry-run to apply." \
        || ok "Uninstall complete."
echo     # one blank line after the summary block (consistency)
