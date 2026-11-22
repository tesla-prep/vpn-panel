#!/usr/bin/env bash
# Перенос установки между Docker и systemd. См. docs/operations.md.
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
if [ "$SWG_TTY" = /dev/null ] && [ -z "${SWG_TTY_WARNED:-}" ] && { : </dev/tty; } 2>/dev/null; then   # said once per run
  printf '%s\n' "! This terminal cannot be read: the script runs in its background, which \`curl … | sudo bash\` does under sudo-rs (Ubuntu 26.04's sudo). Questions take their defaults. To answer them, run: sudo bash -c \"\$(curl -fsSL <bootstrap.sh URL>)\" -- <arguments>" >&2
  export SWG_TTY_WARNED=1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"
. "$SCRIPT_DIR/lib/common.sh"   # shared helpers (dl_turn_bin + validators)
# Refuse on a declaratively managed host BEFORE anything is written — a bare↔docker conversion laid down here would
# be invisible to the host's own tooling. Defined in lib/common.sh, above; a `--dry-run` still runs.
refuse_on_declarative_host 'services.swg-node = { enable = true; ... };'
DOCKER_DIR="${SWG_DOCKER_DIR:-/opt/swg-panel-docker}"
if { [ -t 1 ] || [ -n "${SWG_FORCE_COLOR:-}" ]; } && [ -z "${NO_COLOR:-}" ]; then C_BLUE=$'\033[38;5;39m'; C_BL=$'\033[38;5;33m'; C_BROWN=$'\033[38;5;130m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; RESET=$'\033[0m'; BOLD=$'\033[1m'
else C_BLUE=""; C_BL=""; C_BROWN=""; C_RED=""; C_GREEN=""; RESET=""; BOLD=""; fi
[ -n "$BOLD" ] && export SWG_FORCE_COLOR=1
b(){ printf '%s%s%s' "$BOLD" "$*" "$RESET"; }
# universal row flags (shared across every script): ▸ light-blue action, :: blue sub-item, ✓ green, ! brown, ✗ red
info(){ echo "${C_BLUE}▸${RESET} ${BOLD}$*${RESET}"; }   # bold action/step line (matches the installers)
sub(){  echo "${C_BL}::${RESET} $*"; }                    # indented sub-item / progress detail
ok(){   echo "${C_GREEN}✓${RESET} $*"; }
warn(){ echo "${C_BROWN}!${RESET} $*" >&2; }
die(){  echo "${C_RED}✗ $*${RESET}" >&2; exit 1; }
need_compose(){ command -v docker >/dev/null 2>&1 || return 0
  compose_probe >/dev/null || die "$(compose_missing) — nothing has been changed, and your bare-metal install is still serving."; }
# the docker-only one-click updater, retired on the way OUT of docker
retire_docker_updater(){
  local _u
  for _u in swg-update.timer swg-update.path; do
    [ -e "/etc/systemd/system/$_u" ] || continue
    systemctl disable --now "$_u" >/dev/null 2>&1 || true
  done
  rm -f /etc/systemd/system/swg-update.service /etc/systemd/system/swg-update.path \
        /etc/systemd/system/swg-update.timer /usr/local/bin/swg-update \
        /usr/local/bin/swg-update-check /var/lib/swg-update.stamp 2>/dev/null || true
  # …and the Docker host's static level drop-in (docker_host_log_dropins): it would mask the bare netctl's of the same name
  rm -f /etc/systemd/system/swg-update.service.d/swg-log.conf; rmdir /etc/systemd/system/swg-update.service.d 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
}

docker_iface_endpoints(){ local names="$1" nep="$2" specs="$3" live n ep e out=""
  live="$(docker exec swg-node cat /etc/swg-agent/config.json 2>/dev/null | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for n, ic in (d.get("interfaces") or {}).items():
    e = (ic or {}).get("endpoint_host") or ""
    if e: print("%s=%s" % (n, e))' 2>/dev/null || true)"
  for n in $names; do
    ep="$(printf '%s\n' "$live" | sed -n "s/^$n=//p" | sed -n 1p)"
    if [ -z "$ep" ]; then for e in $(printf '%s' "$specs" | tr ',' ' '); do
      [ "${e%%:*}" = "$n" ] && { ep="$(printf '%s' "$e" | cut -d: -f5-)"; break; }; done; fi
    [ -n "$ep" ] || ep="$nep"
    ep="$(printf '%s' "$ep" | tr -cd 'A-Za-z0-9.:_[]-')"   # a host and nothing else — ',' and '=' frame the list
    case "$ep" in ""|127.*|localhost) continue;; esac       # never hand clients a loopback
    out="${out:+$out,}$n=$ep"
  done
  printf '%s' "$out"; }

detect_wan(){ ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sed -n 1p || true; }   # || true: no default route → pipeline nonzero; caller falls back to eth0
conf_privkey(){ sed -n 's/^[[:space:]]*PrivateKey[[:space:]]*=[[:space:]]*//p' "$1" 2>/dev/null | sed -n 1p | tr -d '[:space:]'; }
# same_iface_conf <a> <b> — 0 iff both confs hold the same private key: the same interface, however else they differ
same_iface_conf(){ local k; k="$(conf_privkey "$1")"; [ -n "$k" ] && [ "$k" = "$(conf_privkey "$2")" ]; }
conf_is_adopted(){ grep -qE '^[[:space:]]*#swg:onboarded([[:space:]]|$)' "$1" 2>/dev/null; }
conf_hooks(){ awk 'tolower($0) ~ /^[[:space:]]*(pre|post)(up|down)[[:space:]]*=/' "$1" 2>/dev/null || true; }
# adopted_hooks_from <name> <docker conf> [<host conf>…] — the conf an adopted interface's own hooks come back from: a host
# conf of it (same key), else the newest original a bare → Docker convert kept. Prints its path, or nothing.
adopted_hooks_from(){ local nm="$1" src="$2" c; shift 2
  for c in "$@" $(ls -dt /etc/swg-panel-confs.converted-*/ 2>/dev/null | sed "s#/\$#/$nm.conf#"); do
    [ -f "$c" ] && same_iface_conf "$c" "$src" && [ -n "$(conf_hooks "$c")" ] && { printf '%s\n' "$c"; return 0; }
  done; return 0; }
# keep_docker_original <docker conf> — the adopted conf as the Docker node had it, byte for byte, in this run's backup
# (one directory per run: not called in a $(…), whose subshell would forget it). Sets KEPT_ORIG to the copy.
CONF_BACKUP=""; KEPT_ORIG=""
keep_docker_original(){ local nm; nm="$(basename "$1")"; KEPT_ORIG=""
  [ -n "${CONF_BACKUP:-}" ] || { CONF_BACKUP="/etc/swg-panel-confs.converted-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak).from-docker"; mkdir -p "$CONF_BACKUP" && chmod 700 "$CONF_BACKUP"; }
  cp -p "$1" "$CONF_BACKUP/$nm" 2>/dev/null && chmod 600 "$CONF_BACKUP/$nm" 2>/dev/null && KEPT_ORIG="$CONF_BACKUP/$nm"; return 0; }
# adopted_import_line <name> <dest> <hooks-from or ""> <kept Docker original> — the one line an adopted interface gets
adopted_import_line(){
  if [ -n "$3" ]; then sub "imported $(b "$1") → $2 (adopted: its own hooks put back from $(b "$3"); nothing of ours in it — the Docker original is kept byte for byte in $(b "$4"))"
  else sub "imported $(b "$1") → $2 (adopted: no hooks of its own found, none of ours written — its NAT here is its own setup's, as before the convert; the Docker original is kept byte for byte in $(b "$4"))"; fi; }
reap_container_nat(){   # <adopted interface…> → prints each name whose rule it removed
  [ $# -gt 0 ] || return 0
  python3 - "$@" <<'PYNAT' 2>/dev/null || true
import re, shlex, subprocess, sys
for nm in sys.argv[1:]:
    hooks = ""
    for c in ("/etc/amnezia/amneziawg/%s.conf" % nm, "/etc/wireguard/%s.conf" % nm):
        try:
            hooks = "".join(l for l in open(c, errors="replace") if re.match(r"\s*(pre|post)(up|down)\s*=", l, re.I))
            break
        except OSError:
            continue
    if re.search(r'swg-nat:(%s|%%i)(?=["\s;]|$)' % re.escape(nm), hooks):
        continue                                    # its own hooks carry our tag: the rule is theirs
    tag = re.compile(r'--comment "?%s"?(?=\s|$)' % re.escape("swg-nat:" + nm))
    out = subprocess.run(["iptables", "-t", "nat", "-S", "POSTROUTING"], capture_output=True, text=True).stdout
    gone = 0
    for ln in out.splitlines():
        if ln.startswith("-A POSTROUTING") and tag.search(ln):
            if subprocess.run(["iptables", "-t", "nat", "-D"] + shlex.split(ln)[1:], capture_output=True).returncode == 0:
                gone += 1
    if gone:
        print(nm)
PYNAT
}
# reap_adopted_container_nat <imported interface…> — after the switch: the ones that came back ADOPTED (their bare conf says
# so — a resumed convert included) lose the container's rule, and one line names them
reap_adopted_container_nat(){ local nm c ad="" gone
  for nm in "$@"; do for c in "/etc/amnezia/amneziawg/$nm.conf" "/etc/wireguard/$nm.conf"; do
    [ -f "$c" ] && conf_is_adopted "$c" && { ad="${ad:+$ad }$nm"; break; }; done; done
  [ -n "$ad" ] || return 0
  gone="$(reap_container_nat $ad | tr '\n' ' ')"; gone="${gone% }"
  [ -n "$gone" ] && sub "removed the Docker node's NAT rule for $(b "$gone") — an adopted interface's NAT here is its own hooks', as before the convert"
  return 0; }
import_bare_conf(){ # <src> <dest> [<conf whose hooks an ADOPTED src takes back>]
  local src="$1" dest="$2" orig="${3:-}" addr subnet wan up down
  if conf_is_adopted "$src"; then                         # its own hooks or none — never ours (see above)
    if [ -n "$orig" ]; then
      HOOKS="$(conf_hooks "$orig")" awk '
        tolower($0) ~ /^[[:space:]]*(pre|post)(up|down)[[:space:]]*=/ {next}
        {print}
        /^\[Interface\][[:space:]]*$/ && !d {if (ENVIRON["HOOKS"] != "") print ENVIRON["HOOKS"]; d=1}' "$src" > "$dest"
    else cp "$src" "$dest"; fi
    chmod 600 "$dest"; return 0
  fi
  addr="$(sed -n 's/^[[:space:]]*[Aa]ddress[[:space:]]*=//p' "$src" | sed -n 1p | sed 's/,.*//; s/[[:space:]]//g')"
  subnet="$(python3 -c 'import ipaddress,sys;print(ipaddress.ip_network(sys.argv[1],strict=False))' "$addr" 2>/dev/null || echo "$addr")"
  wan="$(detect_wan)"; [ -n "$wan" ] || wan=eth0
  up="$(nat_hook_up "${subnet}" "${wan}")"   # reap-then-add: one copy whatever was there (lib/common.sh)
  down="$(nat_hook_down "${subnet}" "${wan}")"
  awk -v up="$up" -v down="$down" '
    /^[[:space:]]*[Pp]ost(Up|Down)[[:space:]]*=/ {next}     # drop any existing NAT hooks
    {print}
    /^\[Interface\][[:space:]]*$/ && !d {print "PostUp = " up; print "PostDown = " down; d=1}
  ' "$src" > "$dest"
  chmod 600 "$dest"
}

CHECK=no; [ "${1:-}" = --check ] && { CHECK=yes; shift; }
_norm_method(){ case "$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z')" in
  bare-metal|bare_metal|bare|baremetal|metal|bm|host-os|native) echo baremetal;;
  docker|dockerized|dockerised|container|compose)               echo docker;;
  *) printf '%s' "${1:-}";; esac; }
_norm_role(){ case "$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z')" in
  master|host-node|hostnode) echo master;; host|panel) echo host;; node|entry) echo node;;
  *) printf '%s' "${1:-}";; esac; }
_USAGE="usage: convert.sh [--check] <docker|baremetal> <docker|baremetal> <node|host|master>"
FROM="$(_norm_method "${1:-}")"; TO="$(_norm_method "${2:-}")"; ROLE="$(_norm_role "${3:-}")"
[ -n "$FROM" ] && [ -n "$TO" ] && [ -n "$ROLE" ] || die "$_USAGE"
# Проверяем аргументы до проверки root. Для предварительной проверки поддерживается --check.
# --dry-run отклоняется. -y/--yes принимается для совместимости с bootstrap.sh.
for _x in "${@:4}"; do case "$_x" in
  -y|--yes) ;;
  --dry-run) die "convert.sh has no dry run — a conversion cannot be rehearsed by rendering files, because it takes the old method down before the new one is up. Use $(b "convert.sh --check $FROM $TO $ROLE") for the port/interface pre-flight." ;;
  *) die "‘$_x’ isn't an option here. $_USAGE" ;;
esac; done
[ "$(id -u)" = 0 ] || die "run as root"
for _a in "FROM:$FROM" "TO:$TO"; do case "${_a#*:}" in docker|baremetal) :;;
  *) die "‘${_a#*:}’ isn't a method (${_a%%:*}). Use $(b docker) or $(b baremetal). $_USAGE";; esac; done
case "$ROLE" in node|host|master) :;; *) die "‘$ROLE’ isn't a role. Use $(b node), $(b host) or $(b master). $_USAGE";; esac
[ "$FROM" != "$TO" ] || die "nothing to convert: $FROM → $TO are the same. $_USAGE"

# prominent title — same look as the installers / update.sh (only on the real run, not the --check pre-flight)
if [ "$CHECK" != yes ]; then
  _fl="$([ "$FROM" = docker ] && echo DOCKER || echo BARE-METAL)"; _tl="$([ "$TO" = docker ] && echo DOCKER || echo BARE-METAL)"
  echo; info "SWG $_fl → $_tl CONVERSION ($ROLE)"; echo
  seal_archives   # every recovery archive an earlier build left becomes root's alone (lib/common.sh, F90)
fi

# crash/network-drop recovery
RECOVERY="/var/lib/swg-recovery"
RESUMING=no   # set when we picked up a recovery marker → this is finishing an interrupted convert, not a fresh one
if [ "$CHECK" != yes ] && [ -f "$RECOVERY" ]; then . "$RECOVERY" 2>/dev/null || true; RESUMING=yes; fi   # resume: the saved identity wins (the source may be half torn down)
write_recovery(){   # write_recovery <space-separated interface names>
  mkdir -p /var/lib 2>/dev/null || true
  ( umask 077   # 0600 from its first byte — it holds the node token
    { printf "SWG_RV_FROM='%s'\nSWG_RV_TO='%s'\nSWG_RV_ROLE='%s'\n" "$FROM" "$TO" "$ROLE"
      printf "SWG_RV_TOKEN='%s'\nSWG_RV_URL='%s'\nSWG_RV_EP='%s'\nSWG_RV_VERIFY='%s'\n" "$NTOK" "$PURL" "$NEP" "${NVERIFY:-no}"
      printf "SWG_RV_FP='%s'\n" "$(printf '%s' "${NFP:-}" | tr -cd '0-9A-Fa-f:')"   # the panel-cert pin (hex only — this file is sourced)
      printf "SWG_RV_NAMES='%s'\nSWG_RV_AT='%s'\n" "${1:-}" "$(date +%s 2>/dev/null || echo 0)"
    } > "$RECOVERY" ) 2>/dev/null && chmod 600 "$RECOVERY" 2>/dev/null || true
}
clear_recovery(){ rm -f "$RECOVERY" 2>/dev/null || true; }
docker_node_present(){ command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; }

# PANEL host conversion
docker_panel_present(){ command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; }
bare_panel_present(){ [ -f /etc/systemd/system/swg-panel-server.service ] || [ -x /opt/swg-panel/swg-panel-server ]; }
lc_emit_hostnode(){ lc_emit_file "$1" "${2:-}"; lc_emit_post "$1" "${2:-}"; }

DOTENV_DROPIN=50-swg-from-docker.conf
_dotenv_val(){ local v; v="$(sed -n "s/^$1=//p" "$2" 2>/dev/null | sed -n 1p)"   # as compose reads it: quotes, or a trailing ` # …`
  case "$v" in \"*) v="${v#\"}"; v="${v%%\"*}";; \'*) v="${v#\'}"; v="${v%%\'*}";;
               *) v="$(printf '%s' "$v" | sed 's/[[:space:]]\{1,\}#.*$//; s/[[:space:]]*$//')";; esac
  printf '%s' "$v"; }
carry_env_to_dropin(){ # <.env> <unit> <KEY | UNITKEY=ENVKEY/default/check…> — one line saying what it kept, and where
  local envf="$1" unit="$2" k v body="" names="" d f uk ek dflt chk; shift 2
  d="/etc/systemd/system/$unit.service.d"; f="$d/$DOTENV_DROPIN"
  for k in "$@"; do
    # KEY: the same name on both sides. UNITKEY=ENVKEY/default/check: the service reads UNITKEY, the .env holds ENVKEY,
    # Docker's own default is nothing of the operator's to keep, and a value that fails the check is named, not carried
    uk="$k"; ek="$k"; dflt=""; chk=""
    case "$k" in *=*) uk="${k%%=*}"; ek="${k#*=}"; IFS=/ read -r ek dflt chk <<< "$ek";; esac
    v="$(_dotenv_val "$ek" "$envf")"; [ -n "$v" ] || continue
    [ -n "$dflt" ] && [ "$v" = "$dflt" ] && continue
    if [ -n "$chk" ] && ! printf '%s' "$v" | grep -cxE "$chk" >/dev/null; then
      warn "the Docker .env's $ek ($v) is not a plain value — not carried; set $uk in a drop-in by hand if you need it"; continue; fi
    v="$(printf '%s' "$v" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')"   # systemd: \ and " escaped inside "…", % is a specifier
    body="${body}Environment=\"$uk=$v\""$'\n'; names="${names:+$names, }$ek"
  done
  if [ -z "$body" ]; then   # nothing to keep: a drop-in an EARLIER convert wrote must not outlive the setting
    [ -f "$f" ] && { rm -f "$f"; rmdir "$d" 2>/dev/null || true; systemctl daemon-reload 2>/dev/null || true; }
    return 0
  fi
  mkdir -p "$d"
  { printf '# Kept from the Docker install this box was converted from — your own setting, carried by convert.sh.\n'
    printf '# Edit or remove it like any drop-in, then: systemctl daemon-reload && systemctl restart %s\n[Service]\n' "$unit"
    printf '%s' "$body"; } > "$f"
  chmod 644 "$f" 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
  sub "kept from the Docker .env: $names → $(b "$f")"
}
DROPIN_GIVE=""
carry_dropins_to_env(){
  local carry="$1" park="/etc/swg-panel-dropins.converted-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)" out kept="" skip="" parked="" kind k v u f
  shift; : > "$carry"; DROPIN_GIVE=""
  out="$(python3 - "$@" <<'PY' 2>/dev/null || true
import glob, os, re, shlex, sys
LOGS = {"swg-ns.conf", "swg-journal.conf", "swg-log.conf"}   # swg's own (1.8.9) — not the operator's to be told about (IN-20)
OURS = {"swg-panel-server": {"zz-swg-update.conf"} | LOGS, "swg-noded": {"10-swg-reach-sweep.conf"} | LOGS}
# the Docker .env key each variable arrives through: carried as it is (C), or given to the installer as its own (G)
MAP = {"swg-panel-server": {"SWG_LATEST_URL": ("SWG_LATEST_URL", "C"), "SWG_PANEL_CONSOLE_PORT": ("CONSOLE_PORT", "G"),
                            "SWG_PANEL_CONSOLE_HOST": ("CONSOLE_BIND", "G")},
       "swg-noded": {"SWG_TURN_MIRROR": ("SWG_TURN_MIRROR", "C")}}
SAFE_G = {"CONSOLE_PORT": r"[0-9]{1,5}", "CONSOLE_BIND": r"[0-9A-Fa-f.:]{2,45}"}
for unit in sys.argv[1:]:
    for f in sorted(glob.glob("/etc/systemd/system/%s.service.d/*.conf" % unit)):
        name = os.path.basename(f)
        if name in OURS.get(unit, ()):
            continue
        if name != "50-swg-from-docker.conf":
            print("FILE\t%s\t%s" % (unit, f))            # the operator's file → kept, as it was, in the parking place
        env, other = {}, []
        for ln in open(f, errors="replace").read().splitlines():
            st = ln.strip()
            if not st or st[0] in "#;" or st.startswith("["):
                continue
            k, _, v = st.partition("=")
            if k.strip() != "Environment":
                other.append(k.strip() + "="); continue
            if not v.strip():
                env.clear(); continue                     # an empty Environment= resets the list, as systemd reads it
            try:
                words = shlex.split(v, posix=True)
            except ValueError:
                other.append("Environment= (unreadable)"); continue
            for w in words:
                kk, eq, vv = w.partition("=")
                if eq:
                    env[kk] = vv.replace("%%", "%")
        for kk, vv in env.items():
            m = MAP.get(unit, {}).get(kk)
            if not m:
                print("SKIP\t%s\t%s" % (name, kk)); continue
            key, how = m
            if how == "G" and not re.fullmatch(SAFE_G[key], vv):
                print("SKIP\t%s\t%s: not a plain value" % (name, kk)); continue
            if how == "C" and ("'" in vv or "\n" in vv):
                print("SKIP\t%s\t%s: a quote the .env cannot hold" % (name, kk)); continue
            print("%s\t%s\t%s" % ("CARRY" if how == "C" else "GIVE", key, vv))
        for o in other:
            print("SKIP\t%s\t%s" % (name, o))
PY
)"
  [ -n "$out" ] || return 0
  while IFS="$(printf '\t')" read -r kind k v; do
    case "$kind" in
      FILE)  u="$k"; f="$v"; mkdir -p "$park/$u.service.d" && chmod 700 "$park" && cp -p "$f" "$park/$u.service.d/" \
               && chmod 600 "$park/$u.service.d/$(basename "$f")" && parked=yes ;;
      CARRY) grep -q "^$k=" "$carry" 2>/dev/null || { printf "%s='%s'\n" "$k" "$v" >> "$carry"; kept="${kept:+$kept, }$k"; } ;;
      GIVE)  DROPIN_GIVE="${DROPIN_GIVE:+$DROPIN_GIVE }$k=$v"; kept="${kept:+$kept, }$k" ;;
      SKIP)  skip="${skip:+$skip, }$v ($k)" ;;
    esac
  done <<EOF
$out
EOF
  [ -n "$kept$skip$parked" ] || return 0                 # only our own file, nothing of the operator's to say
  sub "kept from the bare-metal drop-ins: ${kept:-nothing the Docker side reads}$([ -n "$kept" ] && printf ' (→ the Docker .env)')$([ -n "$skip" ] && printf '; not carried: %s' "$skip")$([ -n "$parked" ] && printf ' — the drop-in files are kept as they were in %s' "$(b "$park")")"
}
_dns_ok(){ printf '%s' "$1" | grep -cE '^[0-9A-Za-z.:, _-]{1,200}$' >/dev/null; }

if { [ "$ROLE" = host ] || [ "$ROLE" = master ]; } && [ "$FROM" = baremetal ] && [ "$TO" = docker ]; then
  ETC=/etc/swg-panel; STATE=/var/lib/swg-panel; STATS=/var/www/wgstats; pconf="$ETC/install.conf"; PROFILE="$ROLE"
  bare_panel_present || [ -n "${SWG_RV_URL:-}" ] || die "no bare-metal panel found (swg-panel-server missing)"
  gv(){ sed -n "s/^$1=//p" "$pconf" 2>/dev/null | sed -n 1p || true; }   # || true: a missing install.conf must fall through to recovery state, not abort under pipefail+set -e
  PDOM="$(gv PANEL_DOMAIN)"; PPORT="$(gv PORT)"; PTLS="$(gv TLS_MODE)"; PEMAIL="$(gv ACME_EMAIL)"; PBASE="$(gv PANEL_BASE)"
  PCFTOKEN="$(gv CF_TOKEN)"; PCFORIGIN="$(gv CF_ORIGIN_TOKEN)"   # carry CF creds so cloudflare/cf15 renewal works in the container
  PSERVE="$(gv SERVE_MODE)"; PSUBDOM="$(gv SUB_DOMAIN)"
  _PBIND=0.0.0.0; _SBIND=0.0.0.0; _SXFF=0; _RVPROXY=no
  case "$PSERVE" in nginx|caddy|skip) _RVPROXY=yes; PTLS=none; _PBIND=127.0.0.1; _SBIND=127.0.0.1; _SXFF=1;; esac
  # env passed to install-docker so TLS=none + the loopback binds win over its defaults (a reverse-proxy convert)
  _RVENV=""; [ "$_RVPROXY" = yes ] && _RVENV="TLS=none PANEL_BIND=127.0.0.1 SUB_BIND=127.0.0.1 SUB_TRUST_XFF=1 SUB_DOMAIN=$PSUBDOM"
  PUSER="$(sed -n 's/^\([^:]*\):.*/\1/p' "$ETC/auth" 2>/dev/null | sed -n 1p || true)"   # || true: missing auth file must not abort under pipefail+set -e
  [ -n "${SWG_RV_URL:-}" ] && PDOM="${PDOM:-$SWG_RV_URL}"
  [ -n "$PDOM" ] || die "couldn't read the panel domain ($pconf missing and no recovery state)"
  case "$PTLS" in letsencrypt|letsencrypt-ip|cloudflare|cf15|selfsigned|none) :;; *) PTLS=selfsigned;; esac
  [ -n "$PPORT" ] || PPORT=443
  PLOCALPORT="$(gv LOCAL_PORT)"; [ -n "$PLOCALPORT" ] || PLOCALPORT=8088
  PSUBPORT="$(python3 - <<'PY' 2>/dev/null | tr -dc '0-9'
import json
d = json.load(open("/var/lib/swg-panel/panel-settings.json"))
print(((d.get("access") or {}).get("sub") or {}).get("port") or "")
PY
)"
  [ -n "$PSUBPORT" ] || PSUBPORT="$(gv SUB_PORT)"
  [ -n "$PSUBPORT" ] || PSUBPORT=8444
  docker_panel_present && die "a docker panel (swg-panel container) already exists — remove it first"

  # MASTER: also read the co-located node's identity (preserve its token so the panel keeps the same node) +
  # its interface confs (imported below). The local node reaches the panel on the compose net (swg-panel:8443).
  NTOK=""; NEP=""; mifaces=""; NDNS=""
  if [ "$ROLE" = master ] && command -v python3 >/dev/null 2>&1 && [ -f /etc/swg-agent/config.json ]; then
    NTOK="$(python3 -c 'import json;print((json.load(open("/etc/swg-agent/config.json")).get("panel") or {}).get("token","") or "")' 2>/dev/null || true)"
    NEP="$(python3 -c 'import json;print(json.load(open("/etc/swg-agent/config.json")).get("endpoint_host","") or "")' 2>/dev/null || true)"
    NDNS="$(python3 -c 'import json;d=json.load(open("/etc/swg-agent/config.json")).get("dns");print(str(d[0]).strip() if isinstance(d,list) and d else "")' 2>/dev/null || true)"
    _dns_ok "$NDNS" || NDNS=""   # the local node's client DNS (see _dns_ok)
    mifaces="$(python3 - <<'PY' 2>/dev/null
import json
try: c=json.load(open("/etc/swg-agent/config.json"))
except Exception: c={}
for n,ic in (c.get("interfaces") or {}).items():
    if (ic.get("conf") or ""): print(n+"\t"+ic["conf"])
PY
)"
  fi

  if [ "$CHECK" = yes ]; then
    [ -e "$DOCKER_DIR" ] && info "note: a leftover $(b "$DOCKER_DIR") will be moved aside."
    command -v docker >/dev/null 2>&1 || info "note: Docker isn't installed on this box yet — the conversion installs it first (get.docker.com), before anything else is touched."
    sub "pre-flight OK"
    if [ "$ROLE" = master ]; then info "Master → docker keeps: URL $(b "$PDOM"), login, roster, nodes, the $(b "$PTLS") cert AND the local node (token + interfaces + turn-proxies). Brief downtime at the switch."
    else info "Panel → docker keeps: URL $(b "$PDOM"), login, roster, nodes + the $(b "$PTLS") cert. Brief panel downtime at the switch (nodes self-heal)."; fi
    exit 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    info "installing Docker (get.docker.com) — nothing else has been touched yet"
    sh -c "curl -fsSL https://get.docker.com | sh" \
      || die "Docker could not be installed — nothing has been changed, and your bare-metal install is still serving. Install it by hand (curl -fsSL https://get.docker.com | sh) and re-run."
  fi
  if ! docker info >/dev/null 2>&1; then
    systemctl start docker >/dev/null 2>&1 || true
    for _dwait in 1 2 3 4 5 6 7 8 9 10; do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null 2>&1 || die "the Docker daemon isn't running (docker info failed). Start it with $(b 'systemctl start docker') and re-run — nothing has been changed, and your bare-metal install is still serving."
  fi
  need_compose

  info "Converting the bare-metal $(b "$ROLE") → docker — keeping the panel's URL/login/roster/nodes/cert$([ "$ROLE" = master ] && echo " and the local node")."
  PURL="$PDOM"; write_recovery ""   # persist FROM/TO/ROLE for resume BEFORE any teardown
  LC_FILE=/var/lib/swg-panel/host_proc
  if [ "$ROLE" = master ] && [ -n "$NTOK" ]; then   # MASTER: status on BOTH the panel header (file) AND the local node tile (POST to the loopback panel)
    LC_URL="https://127.0.0.1:$PPORT"; LC_TOKEN="$NTOK"; LC_VERIFY=no; LC_FP=""   # loopback: this box's own panel
    lc_init convert-docker lc_emit_hostnode
  else
    lc_init convert-docker lc_emit_file
  fi
  if [ "$RESUMING" != yes ] && [ -e "$DOCKER_DIR" ]; then
    _bak="$DOCKER_DIR.pre-convert-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
    mv "$DOCKER_DIR" "$_bak" 2>/dev/null && { seal_archive "$_bak"; info "moved a leftover $(b "$DOCKER_DIR") aside → $(b "$_bak")"; } || rm -rf "$DOCKER_DIR" 2>/dev/null || true
  fi

  # 1) COPY-FIRST: stage the panel state while the bare panel is STILL UP + serving every node
  mkdir -p "$DOCKER_DIR"/data/lib "$DOCKER_DIR"/data/etc "$DOCKER_DIR"/data/stats
  [ -d "$STATE" ] && cp -a "$STATE/." "$DOCKER_DIR/data/lib/"   2>/dev/null || true   # roster, nodes.json, configs
  [ -d "$ETC" ]   && cp -a "$ETC/."   "$DOCKER_DIR/data/etc/"   2>/dev/null || true   # fleet.json, auth, tls/
  [ -d "$STATS" ] && cp -a "$STATS/." "$DOCKER_DIR/data/stats/" 2>/dev/null || true   # status snapshots + health-*.rrd graph history
  _rrd_src=$(find "$STATS" -maxdepth 1 -name 'health-*.rrd' 2>/dev/null | wc -l | tr -d ' ' || true); _rrd_dst=$(find "$DOCKER_DIR/data/stats" -maxdepth 1 -name 'health-*.rrd' 2>/dev/null | wc -l | tr -d ' ' || true)   # || true: $STATS may be absent (find exits nonzero); wc still prints 0
  [ "${_rrd_src:-0}" -gt 0 ] && [ "${_rrd_dst:-0}" -lt "${_rrd_src:-0}" ] && warn "health graphs: staged ${_rrd_dst:-0}/${_rrd_src} rrd file(s) — some history may not have transferred"
  # carry the acme.sh renewal state (bare keeps it in /root/.acme.sh; the container reads data/etc/acme) and
  # point its stored reload command at the container (kill -HUP 1) instead of the systemd unit, so renewals reload.
  for _ah in /root/.acme.sh "${HOME:-/root}/.acme.sh"; do [ -d "$_ah" ] && { mkdir -p "$DOCKER_DIR/data/etc/acme"; cp -a "$_ah/." "$DOCKER_DIR/data/etc/acme/" 2>/dev/null || true; break; }; done
  find "$DOCKER_DIR/data/etc/acme" -name '*.conf' -exec sed -i "s#^Le_ReloadCmd=.*#Le_ReloadCmd='kill -HUP 1'#" {} + 2>/dev/null || true
  sed -i "s#^LOG_FILE=.*#LOG_FILE='/etc/swg-panel/acme/acme.sh.log'#" \
    "$DOCKER_DIR/data/etc/acme/account.conf" 2>/dev/null || true
  sub "staged roster + nodes + login + $(b "$PTLS") cert + ${_rrd_dst:-0} health graph(s) (+ acme renewal) → $DOCKER_DIR/data"

  # 2) stage the compose project (prebuilt image pulled from GHCR)
  cp -a "$REPO/docker/docker-compose.yml" "$DOCKER_DIR/"
  stage_docker_context "$REPO" "$DOCKER_DIR" || die "could not stage the Docker build context"

  _nurl="https://swg-panel:8443"; _ntok="${NTOK:-set-in-nodes-screen}"; _nep="${NEP:-$PDOM}"
  cat > "$DOCKER_DIR/.env" <<EOF
# generated by convert.sh (bare-metal → docker) — profile: $PROFILE
PANEL_PASSWORD=converted-login-preserved
PANEL_USER=${PUSER:-admin}
PANEL_DOMAIN=$PDOM
PANEL_BASE=$PBASE
TLS=$PTLS
ACME_EMAIL=$PEMAIL
CF_TOKEN=$PCFTOKEN
CF_ORIGIN_TOKEN=$PCFORIGIN
PANEL_PORT=$PPORT
PANEL_BIND=$_PBIND
SUB_BIND=$_SBIND
SUB_TRUST_XFF=$_SXFF
SUB_DOMAIN=$PSUBDOM
PANEL_URL=$_nurl
NODE_TOKEN=$_ntok
NODE_ENDPOINT=$_nep
TLS_VERIFY=no
EOF
  chmod 600 "$DOCKER_DIR/.env"

  write_recovery "$mifaces"
  _carry="$(mktemp 2>/dev/null || echo /tmp/swg-carry.$$)"
  if [ "$ROLE" = master ]; then carry_dropins_to_env "$_carry" swg-panel-server swg-noded; else carry_dropins_to_env "$_carry" swg-panel-server; fi
  # ── HOST convert: exec install-docker host (panel only) — it owns the lifecycle terminal. ──
  if [ "$ROLE" = host ]; then
    info "Running install-docker.sh (host) — the panel setup; it switches over as the last step…"; echo
    lc_handoff
    exec env ROLE=host ACME_EMAIL="$PEMAIL" $_RVENV SUB_PORT="$PSUBPORT" PANEL_LOCAL_PORT="$PLOCALPORT" SWG_CONVERT_DIR=convert-docker SWG_CONVERT_KILL_PANEL=1 TLS_VERIFY=no \
         SWG_CARRY_ENV="$_carry" $DROPIN_GIVE bash "$SCRIPT_DIR/install-docker.sh" host
  fi
  echo; info "HOST → docker — converting the panel (the local node keeps serving until the node step below)…"; echo
  env ROLE=host ACME_EMAIL="$PEMAIL" $_RVENV SUB_PORT="$PSUBPORT" PANEL_LOCAL_PORT="$PLOCALPORT" SWG_CONVERT_DIR=convert-docker SWG_CONVERT_KILL_PANEL=1 SWG_LC_PARENT=1 TLS_VERIFY=no \
      SWG_CARRY_ENV="$_carry" $DROPIN_GIVE bash "$SCRIPT_DIR/install-docker.sh" host \
    || die "the panel (host) convert failed — your state is safe in $DOCKER_DIR/data; check 'docker compose logs'"
  LC_FILE="$DOCKER_DIR/data/lib/host_proc"   # docker panel now owns host_proc → convert.sh's EXIT terminal lands there
  for _i in $(seq 1 30); do curl -sk -o /dev/null --max-time 2 "https://127.0.0.1:${PPORT}${PBASE}/" 2>/dev/null && break; sleep 1; done
  lc_emit_file converted-docker; LC_EMIT=lc_emit_post
  echo; info "NODE → docker — converting this box's local node (adds swg-node to the panel's compose project)…"; echo
  env SWG_CONVERT_DIR=convert-docker NODE_TOKEN="${NTOK:-}" NODE_ENDPOINT="${NEP:-$PDOM}" \
      PANEL_URL="http://127.0.0.1:${PLOCALPORT:-8088}" TURN_MANAGE=panel SWG_LC_PARENT=1 TLS_VERIFY=no ${NDNS:+DNS="$NDNS"} \
      SWG_CARRY_ENV="$_carry" bash "$SCRIPT_DIR/install-docker.sh" node \
    || warn "the local node convert reported an error — check it on the panel."
  clear_recovery
  echo; ok "$(b master) converted to docker — panel + local node (host convert + node convert). Same login, roster, nodes + cert + local node. Nodes reconnect on their next sync."
  print_summary CONVERSION both   # bare→docker master: both the panel + the local node converted
  exit 0
fi

# ── PANEL host/master: docker → bare-metal ── (mirror of the bare→docker block; reuses install-host.sh + install-node.sh)
if { [ "$ROLE" = host ] || [ "$ROLE" = master ]; } && [ "$FROM" = docker ] && [ "$TO" = baremetal ]; then
  ETC=/etc/swg-panel; STATE=/var/lib/swg-panel; STATS=/var/www/wgstats; envf="$DOCKER_DIR/.env"
  [ -f "$envf" ] || [ -n "${SWG_RV_URL:-}" ] || die "no docker panel settings found at $envf"
  getv(){ sed -n "s/^$1=//p" "$envf" 2>/dev/null | sed -n 1p | sed 's/^"//; s/"$//' || true; }   # || true: a missing .env must fall through to recovery state, not abort under pipefail+set -e
  PDOM="$(getv PANEL_DOMAIN)"; PPORT="$(getv PANEL_PORT)"; PTLS="$(getv TLS)"; PEMAIL="$(getv ACME_EMAIL)"
  PBASE="$(getv PANEL_BASE)"; PUSER="$(getv PANEL_USER)"; PCFT="$(getv CF_TOKEN)"; PCFO="$(getv CF_ORIGIN_TOKEN)"
  # awk $1: some .env lines carry an inline "# comment" (e.g. PANEL_LOCAL_PORT=8088  # …) — take just the value, else
  # it leaks into the unquoted env passed to install-host and env chokes on the '#'.
  PSUBPORT="$(getv SUB_PORT | awk '{print $1}')"; [ -n "$PSUBPORT" ] || PSUBPORT=8444   # the docker sub's published port → the bare swg-sub's bind
  PLOCALPORT="$(getv PANEL_LOCAL_PORT | awk '{print $1}')"; [ -n "$PLOCALPORT" ] || PLOCALPORT=8088   # the co-located node's loopback dial port
  NTOK="$(getv NODE_TOKEN)"; NEP="$(getv NODE_ENDPOINT)"   # master: the local node's preserved identity
  # fallback: a docker master's node token should be in .env, but if it's blank/placeholder read it straight from
  # the running node container so the local-node tile reliably gets "converting" at the START (matches bare→docker).
  case "${NTOK:-}" in ""|set-in-nodes-screen) NTOK="$(docker exec swg-node sh -c 'cat /etc/swg-agent/config.json' 2>/dev/null | python3 -c 'import json,sys;print((json.load(sys.stdin).get("panel") or {}).get("token","") or "")' 2>/dev/null || true)";; esac
  [ -n "${SWG_RV_URL:-}" ] && PDOM="${PDOM:-$SWG_RV_URL}"
  [ -n "$PDOM" ] || die "couldn't read the panel domain (docker .env missing and no recovery state)"
  case "$PTLS" in letsencrypt|letsencrypt-ip|cloudflare|cf15|selfsigned|none) :;; *) PTLS=selfsigned;; esac
  case "$PTLS" in
    selfsigned|none)
      case "$(docker exec swg-panel sh -c 'openssl x509 -in /etc/swg-panel/tls/fullchain.pem -noout -issuer 2>/dev/null' 2>/dev/null || true)" in
        *"Let's Encrypt"*)          PTLS=letsencrypt ;;
        *Cloudflare*|*CloudFlare*)  PTLS=cf15 ;;
      esac ;;
  esac
  [ -n "$PPORT" ] || PPORT=443
  [ "$RESUMING" != yes ] && bare_panel_present && die "a bare-metal panel (swg-panel-server) already exists — remove it first"

  if [ "$CHECK" = yes ]; then
    sub "pre-flight OK"
    if [ "$ROLE" = master ]; then info "Master → bare-metal keeps: URL $(b "$PDOM"), login, roster, nodes, the $(b "$PTLS") cert AND the local node (token + interfaces + turn-proxies). Brief downtime at the switch."
    else info "Panel → bare-metal keeps: URL $(b "$PDOM"), login, roster, nodes + the $(b "$PTLS") cert. Brief panel downtime at the switch (nodes self-heal)."; fi
    exit 0
  fi

  info "Converting the docker $(b "$ROLE") → bare-metal — keeping the panel's URL/login/roster/nodes/cert$([ "$ROLE" = master ] && echo " and the local node")."
  PURL="$PDOM"; write_recovery ""
  # panel HEADER status during the convert: show "converting to bare-metal" on the still-running docker panel
  # (install-host then continues it on the bare panel as converting-bare → converted-bare / convert-aborted/-failed).
  docker exec swg-panel sh -c 'printf "%s" converting-bare > /var/lib/swg-panel/host_proc' >/dev/null 2>&1 || true
  LC_FILE="$STATE/host_proc"
  if [ "$ROLE" = master ] && [ -n "$NTOK" ]; then LC_URL="https://127.0.0.1:$PPORT"; LC_TOKEN="$NTOK"; LC_VERIFY=no; LC_FP=""; lc_init convert-bare lc_emit_hostnode
  else lc_init convert-bare lc_emit_file; fi

  # 1) COPY-FIRST: stage the panel state to the bare locations while the container is STILL UP + serving
  mkdir -p "$STATE" "$ETC" "$STATS"
  _rrd_src=0
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; then
    _rrd_src=$(docker exec swg-panel sh -c 'ls /var/www/wgstats/health-*.rrd 2>/dev/null | wc -l' 2>/dev/null | tr -d ' '); _rrd_src=${_rrd_src:-0}
    docker exec swg-panel tar c -C /var/lib/swg-panel . 2>/dev/null | tar x -C "$STATE" 2>/dev/null || true   # roster (users.json), nodes.json, configs
    docker exec swg-panel tar c -C /etc/swg-panel   . 2>/dev/null | tar x -C "$ETC"   2>/dev/null || true   # fleet.json, auth, tls/, acme/
    docker exec swg-panel tar c -C /var/www/wgstats . 2>/dev/null | tar x -C "$STATS" 2>/dev/null || true   # status snapshots + health-*.rrd graph history
  else
    [ -d "$DOCKER_DIR/data/lib" ]   && cp -a "$DOCKER_DIR/data/lib/."   "$STATE/" 2>/dev/null || true
    [ -d "$DOCKER_DIR/data/etc" ]   && cp -a "$DOCKER_DIR/data/etc/."   "$ETC/"   2>/dev/null || true
    [ -d "$DOCKER_DIR/data/stats" ] && { cp -a "$DOCKER_DIR/data/stats/." "$STATS/" 2>/dev/null || true; _rrd_src=$(find "$DOCKER_DIR/data/stats" -maxdepth 1 -name 'health-*.rrd' 2>/dev/null | wc -l | tr -d ' '); }
  fi
  _rrd_dst=$(find "$STATS" -maxdepth 1 -name 'health-*.rrd' 2>/dev/null | wc -l | tr -d ' ')
  sub "staged roster + nodes + login + cert + ${_rrd_dst:-0} health graph(s) → bare-metal"
  # only a SHORTFALL is a problem: the destination can legitimately hold more (graphs from an earlier install that
  # the copy didn't overwrite), and "transferred 2/1" read like a bug in the counting rather than a note.
  [ "${_rrd_src:-0}" -gt 0 ] && [ "${_rrd_dst:-0}" -lt "${_rrd_src:-0}" ] && warn "health graphs: transferred ${_rrd_dst:-0}/${_rrd_src} rrd file(s) — some node-health history may be missing"
  # GUARD: never proceed (and let install-host seed a blank panel) if the login + node store didn't come across.
  { [ -s "$ETC/auth" ] && [ -f "$STATE/nodes.json" ]; } || die "couldn't stage the panel state (login/nodes missing) — aborting to avoid data loss. The docker panel is untouched; check 'docker exec swg-panel ls -la /var/lib/swg-panel /etc/swg-panel'."
  # Stash the JUST-STAGED settings + blessed url NOW, while they're known-good — install-host's cert reloadcmd can
  # transiently (re)start the panel mid-install and reset them (see §2c, restored right before the switch).
  [ -f "$STATE/panel-settings.json" ]  && cp -a "$STATE/panel-settings.json"  "$STATE/.panel-settings.preconvert"  2>/dev/null || true
  [ -f "$STATE/panel-confirmed.json" ] && cp -a "$STATE/panel-confirmed.json" "$STATE/.panel-confirmed.preconvert" 2>/dev/null || true
  # carry the acme renewal state back to the host (/root/.acme.sh) + repoint its reload cmd at the systemd unit
  if [ -d "$ETC/acme" ]; then
    mkdir -p /root/.acme.sh; cp -a "$ETC/acme/." /root/.acme.sh/ 2>/dev/null || true
    # a SIGHUP, not a restart: the panel reloads its certificate live, and a restart drops open requests and a
    # Renew-now job waiting on this very renewal (see install-host.sh; update.sh heals the old form)
    find /root/.acme.sh -name '*.conf' -exec sed -i "s#^Le_ReloadCmd=.*#Le_ReloadCmd='systemctl kill -s HUP swg-panel-server.service 2>/dev/null || true'#" {} + 2>/dev/null || true
    sed -i "s#^LOG_FILE=.*#LOG_FILE='/root/.acme.sh/acme.sh.log'#" /root/.acme.sh/account.conf 2>/dev/null || true   # same trap, other direction
  fi
  cat > "$ETC/install.conf" <<EOF
ROLE_SEL=$([ "$ROLE" = master ] && echo master || echo host)
PANEL_DOMAIN=$PDOM
PANEL_BASE=$PBASE
PORT=$PPORT
TLS_MODE=$PTLS
SERVE_MODE=internal
ACME_EMAIL=$PEMAIL
CF_TOKEN=$PCFT
CF_ORIGIN_TOKEN=$PCFO
EOF
  sub "staged roster + nodes + login + $(b "$PTLS") cert (+ acme renewal) → $STATE + $ETC"

  rm -f /etc/systemd/system/swg-sub.service.d/*.conf 2>/dev/null || true
  retire_docker_updater
  info "Installing the bare-metal panel — the docker panel keeps serving until the switch…"
  # A MASTER has a co-located node coming in the LATER install-node step, but there's no agent config for install-host
  # to detect yet — flag it so the panel binds the dedicated loopback port (SWG_PANEL_LOCAL_PORT) that the node dials.
  _LNENV=""; [ "$ROLE" = master ] && _LNENV="SWG_HAS_LOCAL_NODE=1 LOCAL_PORT=$PLOCALPORT"
  _MNAME=""; [ "$ROLE" = master ] && _MNAME="$(panel_node_name_tok "$STATE/nodes.json" "$NTOK")"
  env ROLE=host PANEL_DOMAIN="$PDOM" PORT="$PPORT" PANEL_BASE="$PBASE" ACME_EMAIL="$PEMAIL" SUB_PORT="$PSUBPORT" $_LNENV \
      CF_TOKEN="$PCFT" CF_ORIGIN_TOKEN="$PCFO" BASIC_USER="$PUSER" SWG_CONVERT_DIR=convert-bare SWG_LC_PARENT=1 SWG_DEFER_START=1 \
      ${_MNAME:+HOST_NODE_NAME="$_MNAME"} ${NEP:+HOST_ENDPOINT_IP="$NEP"} \
      bash "$SCRIPT_DIR/install-host.sh" \
    || die "install-host.sh failed — your panel state is safe in $STATE + $ETC; re-run the bare-metal host install to finish"
  [ "$ROLE" = master ] && sed -i 's/^ROLE_SEL=.*/ROLE_SEL=master/' "$ETC/install.conf" 2>/dev/null   # the role, not install-host's ROLE=host
  carry_env_to_dropin "$envf" swg-panel-server SWG_LATEST_URL \
      'SWG_PANEL_CONSOLE_PORT=CONSOLE_PORT/8445/[0-9]{1,5}' 'SWG_PANEL_CONSOLE_HOST=CONSOLE_BIND/127.0.0.1/[0-9A-Fa-f.:]{2,45}'   # the release check and the console's own address, before the first start below

  _owner="$(stat -c '%U:%G' "$STATE" 2>/dev/null || echo root:root)"
  chown -R "$_owner" "$STATE" 2>/dev/null || true
  netctl_dirs_heal "$STATE"   # …but swg-netctl's claims/ stays root's (F96)
  chmod 600 "$STATE"/users.json "$STATE"/nodes.json 2>/dev/null || true      # roster + node tokens stay owner-only
  [ -d "$STATE/configs" ] && chmod 700 "$STATE/configs" 2>/dev/null || true  # stored client configs
  [ -f "$STATE/.panel-settings.preconvert" ]  && { mv -f "$STATE/.panel-settings.preconvert"  "$STATE/panel-settings.json";  chown "$_owner" "$STATE/panel-settings.json"  2>/dev/null || true; }
  [ -f "$STATE/.panel-confirmed.preconvert" ] && { mv -f "$STATE/.panel-confirmed.preconvert" "$STATE/panel-confirmed.json"; chown "$_owner" "$STATE/panel-confirmed.json" 2>/dev/null || true; }

  info "Switching over — stopping the docker panel, starting the bare-metal panel…"
  docker rm -f swg-sub >/dev/null 2>&1 || true   # stop the docker subscription surface too (else it keeps holding the sub port; the bare swg-sub takes over below)
  if [ "$ROLE" = master ]; then
    docker rm -f swg-panel >/dev/null 2>&1 || true   # stop ONLY the panel — the docker NODE keeps serving (copy-first)
  else
    ( cd "$DOCKER_DIR" && on_tty docker compose down ) 2>/dev/null || true; docker rm -f swg-panel >/dev/null 2>&1 || true
  fi
  remove_docker_netctl   # the bare panel brings its own swg-netctl; the docker pair would drain the same queue
  for _i in $(seq 1 30); do ss -ltnH "sport = :$PPORT" 2>/dev/null | grep -c . >/dev/null || break; sleep 0.5; done
  # Clear a STALE state-dir lock (only when NO swg-panel-server is alive) so a crashed prior start can't block the switch.
  pgrep -f "swg-panel-server" >/dev/null 2>&1 || rm -f "$STATE/.panel.lock" 2>/dev/null || true
  _pu=no; for _i in 1 2 3 4 5; do if systemctl start swg-panel-server 2>/dev/null; then _pu=yes; break; fi; sleep 2; done   # bind the port now that docker released it (retry for the handoff)
  [ "$_pu" = yes ] || die "couldn't start the bare-metal panel after stopping the docker panel — check 'systemctl status swg-panel-server'; your panel state is safe in $STATE + $ETC"
  for _i in $(seq 1 30); do curl -sk -o /dev/null --max-time 2 "https://127.0.0.1:${PPORT}${PBASE}/" 2>/dev/null && break; sleep 1; done

  # Same repair in reverse: the cert dir moved back out of the container and the ports are the bare ones now.
  nginx_convert_fixup /etc/swg-panel/tls "$(ngx_upstream "$PPORT")" "$(ngx_upstream "$PSUBPORT")"

  systemctl start swg-sub 2>/dev/null || true
  if python3 -c 'import json,sys; sys.exit(0 if (json.load(open(sys.argv[1])).get("subscriptions") or {}).get("enabled") else 1)' "$STATE/panel-settings.json" 2>/dev/null; then
    _subhost="$(python3 -c 'import json,sys
from urllib.parse import urlparse
print(urlparse(((( json.load(open(sys.argv[1])).get("access") or {}).get("sub") or {}).get("url") or "")).hostname or "")' "$STATE/panel-settings.json" 2>/dev/null || true)"
    [ -n "$_subhost" ] || _subhost="$PDOM"
    /usr/local/bin/swg-netctl issue-cert sub "$_subhost" >/dev/null 2>&1 || true
    systemctl restart swg-sub 2>/dev/null || true
    sub "brought up the subscription surface (swg-sub) for $_subhost:$PSUBPORT"
  fi

  mnames=""
  if [ "$ROLE" = master ]; then
    echo; info "Panel is up on bare-metal — now the local node (the docker node keeps serving until its own switch)."
    lc_emit_file converted-bare; LC_EMIT=lc_emit_post
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-node >/dev/null; then
      mkdir -p "$DOCKER_DIR/data/node-confs" "$DOCKER_DIR/data/node"
      docker cp swg-node:/etc/amnezia/amneziawg/. "$DOCKER_DIR/data/node-confs/" 2>/dev/null || true
      docker cp swg-node:/var/lib/swg-noded/.      "$DOCKER_DIR/data/node/"       2>/dev/null || true
      _wgtmp="$(mktemp -d)"
      docker cp swg-node:/etc/wireguard/. "$_wgtmp/" 2>/dev/null || true
      for _wf in "$_wgtmp"/*.conf; do [ -f "$_wf" ] || continue
        [ -e "$DOCKER_DIR/data/node-confs/$(basename "$_wf")" ] || cp -a "$_wf" "$DOCKER_DIR/data/node-confs/"
      done
      rm -rf "$_wgtmp"
    fi
    for f in "$DOCKER_DIR/data/node-confs/"*.conf; do [ -f "$f" ] || continue
      nm="$(basename "$f" .conf)"
      if grep -qiE '^[[:space:]]*(Jc|Jmin|Jmax|S1|S2|H1|H2|H3|H4|I1)[[:space:]]*=' "$f"; then dest="/etc/amnezia/amneziawg/$nm.conf"; else dest="/etc/wireguard/$nm.conf"; fi
      mkdir -p "$(dirname "$dest")"
      # an ADOPTED interface takes its own hooks back (see import_bare_conf) — read before the original may move aside
      _hf=""; _hc=""; _kept=""
      if conf_is_adopted "$f"; then
        _hf="$(adopted_hooks_from "$nm" "$f" "$dest")"; [ -n "$_hf" ] && { _hc="$(mktemp)"; cp "$_hf" "$_hc"; }
        keep_docker_original "$f"; _kept="$KEPT_ORIG"
      fi
      # an interface this node adopted from the host still has its original here (the node-only convert's same-key
      # case, see below) — never overwritten: kept beside the import
      if [ -f "$dest" ]; then _imp="$(mktemp)"; import_bare_conf "$f" "$_imp" "$_hc"
        cmp -s "$_imp" "$dest" || { mv -f "$dest" "$dest.pre-convert"; sub "$(b "$nm"): the conf already on this host is kept as $(b "$dest.pre-convert")"; }
        rm -f "$_imp"; fi
      import_bare_conf "$f" "$dest" "$_hc"; [ -n "$_hc" ] && rm -f "$_hc"
      if conf_is_adopted "$f"; then adopted_import_line "$nm" "$dest" "$_hf" "$_kept"; mnames="${mnames:+$mnames }$nm"; continue; fi
      sub "imported local-node interface $(b "$nm") → $dest (host NAT added)"; mnames="${mnames:+$mnames }$nm"
    done
    migrate_node_state to-baremetal "$DOCKER_DIR"
    # WDTT server state → the bare-metal paths (carries each wg-keys.dat identity + owner passwords so clients keep
    # working, no re-mint; strips the docker run-model's stale runtime files — see migrate_wdtt in lib/common.sh).
    migrate_wdtt to-baremetal "$DOCKER_DIR"
    migrate_csqtt to-baremetal "$DOCKER_DIR"   # same carry for csqtt (password store + node-owned owner password)
    MEPS="$(docker_iface_endpoints "$mnames" "$NEP" "$(getv NODE_IFACES)")"
    [ -n "$MEPS" ] && sub "keeping each interface's client endpoint: $(printf '%s' "$MEPS" | sed 's/,/, /g')"
    carry_env_to_dropin "$envf" swg-noded SWG_TURN_MIRROR   # before install-node.sh first starts swg-noded
    NDNS="$(_dotenv_val DNS "$envf")"; _dns_ok "$NDNS" || NDNS=""
    env NODE_TOKEN="$NTOK" PANEL_URL="http://127.0.0.1:$PLOCALPORT" ENDPOINT_IP="$NEP" ADOPTED_IFACES="$mnames" ADOPTED_ENDPOINTS="$MEPS" \
        SWG_CONVERT=1 TLS_VERIFY=no SWG_DOCKER_DIR="$DOCKER_DIR" ${NDNS:+DNS="$NDNS"} bash "$SCRIPT_DIR/install-node.sh" \
      || warn "the local node setup reported an error — check it on the panel."
    reap_adopted_container_nat $mnames   # the node container's rule for an adopted interface (see reap_container_nat)
    for _nw in $(docker network ls -q --filter "label=com.docker.compose.project=$(basename "$DOCKER_DIR")" 2>/dev/null); do
      docker network rm "$_nw" >/dev/null 2>&1 || true
    done
  else
    lc_emit_file converted-bare
  fi

  # (the docker updater was retired BEFORE install-host — the files it would remove here are the bare panel's now)
  # 3) move the old docker dir aside so a later convert-back isn't blocked by the leftover .env, then done
  if [ -d "$DOCKER_DIR" ]; then
    _bak="$DOCKER_DIR.converted-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
    mv "$DOCKER_DIR" "$_bak" 2>/dev/null && { seal_archive "$_bak"; info "moved the old docker dir aside → $(b "$_bak") (backup — safe to delete)"; } || warn "couldn't move $DOCKER_DIR aside — remove it manually before converting back to docker"
  fi
  clear_recovery
  _psuf=""; case "$PPORT" in 443|80|"") :;; *) _psuf=":$PPORT";; esac
  echo; ok "$(b "$ROLE") converted to bare-metal — $(b "https://$PDOM$_psuf$PBASE/") (same login, roster, nodes + cert$([ "$ROLE" = master ] && echo " + local node")). Nodes reconnect on their next sync."
  print_summary CONVERSION "$([ "$ROLE" = master ] && echo both || echo host)"   # docker→bare: the panel (+ the local node for a master) converted
  exit 0
fi

# ── NODE: docker → bare-metal ──
if [ "$FROM" = docker ] && [ "$TO" = baremetal ]; then
  envf="$DOCKER_DIR/.env"; confd="$DOCKER_DIR/data/node-confs"
  [ -f "$envf" ] || [ -n "${SWG_RV_TOKEN:-}" ] || die "no docker node settings found at $envf"   # resuming? the saved identity covers a half-torn-down .env
  getv(){ sed -n "s/^$1=//p" "$envf" 2>/dev/null | sed -n 1p | sed 's/^"//; s/"$//' || true; }   # || true: a missing .env must fall through to recovery state, not abort under pipefail+set -e
  NTOK="$(getv NODE_TOKEN)"; PURL="$(getv PANEL_URL)"; NEP="$(getv NODE_ENDPOINT)"
  NIFS="$(getv NODE_IFACES)"; NIF="$(getv NODE_IFACE)"; NPLAIN="$(getv NODE_PLAIN_WG)"; NVERIFY="$(getv TLS_VERIFY)"
  NFP="$(getv TLS_FINGERPRINT | sed 's/[[:space:]]\{1,\}#.*$//' | tr -cd '0-9A-Fa-f:' || true)"
  # (`|| true` inside: no learned file is the NORMAL case, and a failed `head` under pipefail + set -e would abort here)
  _lfp="$(head -n1 "$DOCKER_DIR/data/node/panel-fp" 2>/dev/null | tr -cd '0-9A-Fa-f:' || true)"; [ -n "$_lfp" ] && NFP="$_lfp"
  _lvf="$(head -n1 "$DOCKER_DIR/data/node/panel-verify" 2>/dev/null | tr -d '[:space:]' || true)"; [ -n "$_lvf" ] && NVERIFY="$_lvf"
  [ "$_lvf" = yes ] && [ -z "$_lfp" ] && NFP=""
  _lpu="$(head -n1 "$DOCKER_DIR/data/node/panel-url" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$_lpu" ] && [ "$_lpu" != "$PURL" ] && { sub "the node re-pointed itself to $(b "$_lpu") — converting with that, not the .env's ${PURL:-(blank)}"; PURL="$_lpu"; }
  _lpt="$(head -n1 "$DOCKER_DIR/data/node/panel-token" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$_lpt" ] && [ "$_lpt" != "$NTOK" ] && { sub "the node was transferred — converting with the token it learned, not the .env's"; NTOK="$_lpt"; }
  [ -n "${SWG_RV_TOKEN:-}" ] && { NTOK="$SWG_RV_TOKEN"; PURL="$SWG_RV_URL"; NEP="$SWG_RV_EP"; NVERIFY="${SWG_RV_VERIFY:-no}"; NFP="${SWG_RV_FP:-}"; }   # resume: saved identity wins
  [ "$NVERIFY" = yes ] || NVERIFY=no
  case "$PURL" in *://swg-panel:*|*://swg-panel/*|*://swg-panel)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; then
      _pp="$(getv PANEL_PORT)"; PURL="https://127.0.0.1:${_pp:-443}"; NVERIFY=no
      sub "co-located split → bare node will sync to the local docker panel at $PURL"
    fi ;;
  esac
  [ -n "$NTOK" ] && [ -n "$PURL" ] || die "couldn't read the node token / panel URL (docker .env missing and no recovery state)"

  specs=""
  if [ -d "$confd" ]; then
    for f in "$confd"/*.conf; do
      [ -f "$f" ] || continue
      nm="$(basename "$f" .conf)"
      if grep -qiE '^[[:space:]]*(Jc|Jmin|Jmax|S1|S2|H1|H2|H3|H4|I1)[[:space:]]*=' "$f"; then pr=awg; else pr=wg; fi
      specs="${specs:+$specs }$nm:$pr"
    done
  fi
  if [ -z "$specs" ] && [ -n "$NIFS" ]; then        # fall back to .env if no confs are on disk yet
    OIFS=$IFS; IFS=','
    for e in $NIFS; do IFS=$OIFS
      nm="$(printf '%s' "$e" | cut -d: -f1)"; pr="$(printf '%s' "$e" | cut -d: -f4)"
      [ "$pr" = wg ] || pr=awg
      [ -n "$nm" ] && specs="${specs:+$specs }$nm:$pr"; IFS=','
    done; IFS=$OIFS
  elif [ -z "$specs" ] && [ -n "$NIF" ]; then
    pr=awg; [ "$NPLAIN" = yes ] && pr=wg; specs="$NIF:$pr"
  fi
  if [ -z "$specs" ] && [ -n "${SWG_RV_NAMES:-}" ]; then   # resume after the docker dir was already moved → derive from the bare confs
    for nm in $SWG_RV_NAMES; do
      if   [ -e "/etc/wireguard/$nm.conf" ];          then specs="${specs:+$specs }$nm:wg"
      elif [ -e "/etc/amnezia/amneziawg/$nm.conf" ];  then specs="${specs:+$specs }$nm:awg"; fi
    done
  fi
  # keep only specs whose conf is actually on disk — a bare .env NODE_IFACE default (no conf), or confs lost from
  # data/node-confs, would otherwise be "migrated" as a ghost (and trip the pre-flight). You can't migrate a conf-less iface.
  _sp=""; for s in $specs; do nm="${s%:*}"
    { [ -e "$confd/$nm.conf" ] || [ -e "/etc/amnezia/amneziawg/$nm.conf" ] || [ -e "/etc/wireguard/$nm.conf" ]; } && _sp="${_sp:+$_sp }$s"
  done; specs="$_sp"
  [ -n "$specs" ] || sub "no wg/awg interfaces to migrate — converting the node as-is (add interfaces from the panel later)"

  conflicts=""
  if [ "$RESUMING" != yes ]; then
    for s in $specs; do nm="${s%:*}"
      for _bc in "/etc/amnezia/amneziawg/$nm.conf" "/etc/wireguard/$nm.conf"; do
        [ -e "$_bc" ] || continue
        same_iface_conf "$_bc" "$confd/$nm.conf" && continue
        conflicts="${conflicts:+$conflicts }$nm"; break
      done
    done
  fi
  if [ "$CHECK" = yes ]; then
    if [ -n "$conflicts" ]; then
      warn "a bare-metal interface already exists with these name(s): $(b "$conflicts")"
      echo  "  Rename/remove them (or pick 'keep and re-install'), then retry." >&2
      exit 1
    fi
    sub "pre-flight OK"
    exit 0
  fi
  [ -n "$conflicts" ] && die "interface name clash: $conflicts (run with --check first)"

  info "Converting the docker node → bare-metal — keeping its token, endpoint and interfaces."
  write_recovery "$(for s in $specs; do printf '%s ' "${s%:*}"; done)"   # persist identity BEFORE teardown so a dropped session can resume
  # …with the node's pin: the status POSTs carry the token, and panel_req checks the panel with it (never curl -k)
  LC_URL="$PURL"; LC_TOKEN="$NTOK"; LC_VERIFY="${NVERIFY:-no}"; LC_FP="${NFP:-}"; lc_init convert-bare lc_emit_post   # converting… now; converted-bare/aborted/failed on exit
  names=""
  for s in $specs; do nm="${s%:*}"; pr="${s#*:}"
    src="$confd/$nm.conf"
    if [ "$pr" = wg ]; then dest="/etc/wireguard/$nm.conf"; else dest="/etc/amnezia/amneziawg/$nm.conf"; fi
    # an ADOPTED interface takes its own hooks back (see import_bare_conf) — read before its host original moves aside
    _hf=""; _hc=""; _kept=""
    if [ -f "$src" ] && conf_is_adopted "$src"; then
      _hf="$(adopted_hooks_from "$nm" "$src" "/etc/amnezia/amneziawg/$nm.conf" "/etc/wireguard/$nm.conf")"
      [ -n "$_hf" ] && { _hc="$(mktemp)"; cp "$_hf" "$_hc"; }
    fi
    # the host's own original of an interface this node adopted (same key) — keep it beside the import, never overwrite
    for _bc in "/etc/amnezia/amneziawg/$nm.conf" "/etc/wireguard/$nm.conf"; do
      [ -f "$_bc" ] && [ -f "$src" ] && same_iface_conf "$_bc" "$src" || continue
      _imp="$(mktemp)"; import_bare_conf "$src" "$_imp" "$_hc"
      if cmp -s "$_imp" "$_bc"; then rm -f "$_imp"; continue; fi                     # already our import (a resume)
      rm -f "$_imp"; mv -f "$_bc" "$_bc.pre-convert"
      sub "$(b "$nm") is the host interface this node adopted — its original conf is kept as $(b "$_bc.pre-convert")"
    done
    if [ -f "$dest" ]; then sub "kept $(b "$nm") → $dest (already imported)"; names="${names:+$names }$nm"; continue; fi   # resume: don't re-import
    [ -f "$src" ] || { warn "missing $src — skipping interface '$nm'"; continue; }
    mkdir -p "$(dirname "$dest")"; import_bare_conf "$src" "$dest" "$_hc"   # adds host NAT (docker confs have none) — an adopted one, its own hooks
    if conf_is_adopted "$src"; then keep_docker_original "$src"; adopted_import_line "$nm" "$dest" "$_hf" "$KEPT_ORIG"
    else sub "imported $(b "$nm") → $dest (host NAT added)"; fi
    [ -n "$_hc" ] && rm -f "$_hc"
    names="${names:+$names }$nm"
  done
  # die only if we EXPECTED interfaces ($specs non-empty) but none copied — a real "confs vanished" error. An empty
  # node (no specs) legitimately copies nothing and converts as-is; don't refuse it.
  [ -n "$names" ] || [ -z "$specs" ] || die "no interface confs copied (looked in $confd)"

  # carry the node's host-local derived state (keypair backups + the pulled routing lists) — see lib/common.sh
  migrate_node_state to-baremetal "$DOCKER_DIR"

  migrate_wdtt to-baremetal "$DOCKER_DIR"
  migrate_csqtt to-baremetal "$DOCKER_DIR"   # same carry for csqtt (password store + node-owned owner password)

  info "Running install-node.sh — adopt $(b "$names") (add more if you want); then it does the switch as the last step…"
  echo
  # NB: '|| warn' — a non-zero exit (e.g. one interface failed to come up) must NOT abort the convert under set -e.
  NEPS="$(docker_iface_endpoints "$names" "$NEP" "$NIFS")"
  [ -n "$NEPS" ] && sub "keeping each interface's client endpoint: $(printf '%s' "$NEPS" | sed 's/,/, /g')"
  carry_env_to_dropin "$envf" swg-noded SWG_TURN_MIRROR   # before install-node.sh first starts swg-noded
  NDNS="$(_dotenv_val DNS "$envf")"; _dns_ok "$NDNS" || NDNS=""
  env NODE_TOKEN="$NTOK" PANEL_URL="$PURL" ENDPOINT_IP="$NEP" ADOPTED_IFACES="$names" ADOPTED_ENDPOINTS="$NEPS" \
      SWG_CONVERT=1 TLS_VERIFY="$NVERIFY" TLS_FINGERPRINT="$NFP" SWG_DOCKER_DIR="$DOCKER_DIR" ${NDNS:+DNS="$NDNS"} bash "$SCRIPT_DIR/install-node.sh" \
    || warn "install-node.sh reported an error — check the node on the panel."
  reap_adopted_container_nat $names   # the node container's rule for an adopted interface (see reap_container_nat)

  if ! bare_panel_present && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; then
    retire_docker_updater
  fi
  if [ -d "$DOCKER_DIR" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -cx swg-panel >/dev/null; then
    _bak="$DOCKER_DIR.converted-$(date +%Y%m%d-%H%M%S)"
    if mv "$DOCKER_DIR" "$_bak" 2>/dev/null; then seal_archive "$_bak"; info "moved the old docker dir aside → $(b "$_bak") (backup — safe to delete)"
    else warn "couldn't move $DOCKER_DIR aside — remove it manually before converting back to docker"; fi
  fi
  clear_recovery   # convert finished cleanly → drop the recovery marker
  # the conversion is verified complete here; the lc EXIT trap (clean exit below) emits "converted-bare", which
  # the panel shows green for a few seconds, then the bare node reports normally (online) on its next sync.
  print_summary CONVERSION node   # unified per-server summary; detects the box + flags the converted node
  exit 0           # done (this block no longer execs install-node.sh, so end here, not the catch-all die)
fi

# ── NODE: bare-metal → docker ──
if [ "$FROM" = baremetal ] && [ "$TO" = docker ]; then
  cfg=/etc/swg-agent/config.json
  [ -f "$cfg" ] || [ -n "${SWG_RV_TOKEN:-}" ] || die "no bare-metal node found ($cfg missing)"   # resuming? recovery state covers a half-torn-down config
  command -v python3 >/dev/null 2>&1 || die "python3 is required to read $cfg"
  read -r NTOK PURL NVERIFY NEP NFP NDNS <<EOF
$(python3 - "$cfg" <<'PY'
import json,sys
try: c=json.load(open(sys.argv[1]))   # on a RESUME the bare config is already gone → recovery state fills these in
except Exception: c={}
p=c.get("panel") or {}
fp="".join(ch for ch in str(p.get("fingerprint") or "") if ch in "0123456789abcdefABCDEF:")
dns=c.get("dns") if isinstance(c.get("dns"), list) else []
d0=str(dns[0]).strip() if dns else ""
print(p.get("token","-"), p.get("url","-"), "yes" if p.get("verify",True) else "no", c.get("endpoint_host","") or "-", fp or "-",
      d0 or "-")   # last: `read` gives it the rest of the line
PY
)
EOF
  [ "$NEP" = "-" ] && NEP=""
  [ "$NFP" = "-" ] && NFP=""
  [ "$NDNS" = "-" ] && NDNS=""; _dns_ok "$NDNS" || NDNS=""   # the node's client DNS (see _dns_ok) — the installers write one
  [ -n "${SWG_RV_TOKEN:-}" ] && { NTOK="$SWG_RV_TOKEN"; PURL="$SWG_RV_URL"; NEP="$SWG_RV_EP"; NVERIFY="${SWG_RV_VERIFY:-no}"; NFP="${SWG_RV_FP:-}"; }   # resume: saved identity wins
  [ -n "$NTOK" ] && [ "$NTOK" != "-" ] && [ "$PURL" != "-" ] || die "couldn't read the node token / panel URL (config missing and no recovery state)"
  # interface  name<TAB>conf-path  lines
  ifaces="$(python3 - "$cfg" <<'PY'
import json,sys
try: c=json.load(open(sys.argv[1]))
except Exception: c={}
for n,ic in (c.get("interfaces") or {}).items():
    if (ic.get("conf") or ""): print(n+"\t"+ic["conf"])
PY
)"
  if [ -z "$ifaces" ] && [ -d "$DOCKER_DIR/data/node-confs" ]; then   # resume after the bare config was removed → derive from the already-imported docker confs
    for f in "$DOCKER_DIR/data/node-confs/"*.conf; do [ -f "$f" ] && printf '%s\t%s\n' "$(basename "$f" .conf)" "$f"; done > /tmp/.swg_ifaces.$$ 2>/dev/null
    ifaces="$(cat /tmp/.swg_ifaces.$$ 2>/dev/null)"; rm -f /tmp/.swg_ifaces.$$
  fi
  # No interfaces is FINE — an empty or WDTT-only bare node converts as-is (add interfaces later from the panel; any
  # WDTT servers carry over in install-docker's node stage). Convert what's there — never refuse for "nothing yet".
  [ -n "$ifaces" ] || info "no wg/awg interfaces on the bare-metal node — converting it as-is (manage from the panel)"

  # pre-flight: a LIVE docker node would be clobbered. A stale leftover $DOCKER_DIR (no container — e.g.
  # a previous convert that aborted before moving it aside) is NOT a conflict; the convert moves it aside.
  if [ "$CHECK" = yes ]; then
    if docker_node_present; then
      warn "a docker node (swg-node container) already exists here — remove it first, or pick 'keep and re-install'."; exit 1
    fi
    [ -e "$DOCKER_DIR" ] && info "note: a leftover $(b "$DOCKER_DIR") from a previous run will be moved aside."
    sub "pre-flight OK"
    # "converting" is emitted ONLY after "proceed?" is confirmed (real run, lc_init below) — not in this pre-flight.
    # The interface list is shown once, in install-docker's "Transfer?" step below — no duplicate here.
    exit 0
  fi
  if docker_node_present; then die "a docker node (swg-node container) already exists — remove it first (run with --check)"; fi
  need_compose          # before the leftover is moved aside, "converting" is signalled and the recovery marker is written
  # RESUME keeps the half-built $DOCKER_DIR (it holds the confs/turn records already staged before the interrupt).
  # A FRESH convert clears any leftover from a previous FAILED attempt — it's just an outdated copy, no prompt.
  if [ "$RESUMING" != yes ] && [ -e "$DOCKER_DIR" ]; then
    _bak="$DOCKER_DIR.pre-convert-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
    mv "$DOCKER_DIR" "$_bak" 2>/dev/null && { seal_archive "$_bak"; info "moved a leftover $(b "$DOCKER_DIR") aside → $(b "$_bak") (backup — safe to delete)"; } || rm -rf "$DOCKER_DIR" 2>/dev/null || true
  fi

  info "Converting the bare-metal node → docker — keeping its token, endpoint and interfaces."
  # signal "converting" to the panel NOW — before the (non-destructive) import below — so the node tile shows
  # it immediately, not after the per-interface import lines. install-docker.sh (exec'd later) emits the terminal.
  LC_URL="$PURL"; LC_TOKEN="$NTOK"; LC_VERIFY="${NVERIFY:-no}"; LC_FP="${NFP:-}"; lc_init convert-docker lc_emit_post   # with its pin (panel_req)
  names="$(printf '%s\n' "$ifaces" | while IFS="$(printf '\t')" read -r nm _; do [ -n "$nm" ] && printf '%s ' "$nm"; done || true)"; names="$(echo $names)"   # empty is fine (interface-less node) — just collected for recovery

  write_recovery "$names"

  info "Running install-docker.sh (docker node) — adopt $(b "$names") and finish the setup…"
  echo
  _carry="$(mktemp 2>/dev/null || echo /tmp/swg-carry.$$)"; carry_dropins_to_env "$_carry" swg-noded   # its own drop-ins → .env
  lc_handoff   # exec replaces us → install-docker.sh owns the terminal; SWG_CONVERT_DIR makes it emit "converted-docker"
  exec env NODE_TOKEN="$NTOK" PANEL_URL="$PURL" NODE_ENDPOINT="$NEP" TLS_VERIFY="$NVERIFY" TLS_FINGERPRINT="$NFP" SWG_CONVERT_DIR=convert-docker \
       ${NDNS:+DNS="$NDNS"} SWG_CARRY_ENV="$_carry" bash "$SCRIPT_DIR/install-docker.sh" node
fi

die "unsupported conversion: $FROM → $TO ($ROLE) — supported: baremetal→docker and docker→baremetal, for node, host or master."
