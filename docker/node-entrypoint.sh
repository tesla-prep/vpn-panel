#!/bin/sh
# Загрузка интерфейсов и запуск узла. Настройки описаны в docs/operations.md.
set -eu
log(){ printf '\033[0;36m[swg-node]\033[0m %s\n' "$*"; }

: "${PANEL_URL:?PANEL_URL required (host-node: https://swg-panel:8443)}"
if [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "${CREDENTIALS_DIRECTORY}/token" ]; then
  NODE_TOKEN="$(tr -d '\r\n' < "${CREDENTIALS_DIRECTORY}/token")"
fi
: "${NODE_TOKEN:?NODE_TOKEN required (create the node in the Nodes screen)}"
: "${NODE_ENDPOINT:?NODE_ENDPOINT required (public IP/host clients dial)}"
AWG_DIR=/etc/amnezia/amneziawg
mkdir -p "$AWG_DIR" /var/lib/swg-noded /etc/swg-agent
if [ -f /var/lib/swg-noded/panel-url ]; then
  _pu="$(head -n1 /var/lib/swg-noded/panel-url 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$_pu" ] && [ "$_pu" != "$PANEL_URL" ]; then
    log "using self-learned panel URL $_pu (was ${PANEL_URL})"; PANEL_URL="$_pu"
  fi
fi
if [ -f /var/lib/swg-noded/panel-token ]; then
  _pt="$(head -n1 /var/lib/swg-noded/panel-token 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$_pt" ] && [ "$_pt" != "$NODE_TOKEN" ]; then
    log "using self-learned panel token (transferred to another panel)"; NODE_TOKEN="$_pt"
  fi
fi
if [ -f /var/lib/swg-noded/panel-verify ]; then
  _pv="$(head -n1 /var/lib/swg-noded/panel-verify 2>/dev/null | tr -d '[:space:]')"
  [ -n "$_pv" ] && TLS_VERIFY="$_pv"
fi
if [ -f /var/lib/swg-noded/panel-fp ]; then
  _pf="$(head -n1 /var/lib/swg-noded/panel-fp 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$_pf" ]; then
    if [ -n "$TLS_FINGERPRINT" ] && [ "$_pf" != "$TLS_FINGERPRINT" ]; then
    log "panel pin: using the LEARNED fingerprint $(printf %.16s "$_pf")… (from an earlier re-point/transfer), NOT the configured $(printf %.16s "$TLS_FINGERPRINT")…. To force the configured one, remove /var/lib/swg-noded/panel-fp and restart."
    fi
    TLS_FINGERPRINT="$_pf"
  fi
fi
if [ "${_pv:-}" = yes ] && [ -z "${_pf:-}" ] && [ -n "$TLS_FINGERPRINT" ]; then
  log "panel pin: this node verifies its panel through its CA since it was transferred — the configured pin $(printf %.16s "$TLS_FINGERPRINT")… (the previous panel's) is not used"
  TLS_FINGERPRINT=""
fi
# First boot seeds the NODE_IFACES bootstrap; after that, ./data/node-confs is the SINGLE source of
# truth — a bootstrap interface deleted from the panel must NOT be regenerated on the next reboot.
BOOT_MARKER=/var/lib/swg-noded/.bootstrapped   # persisted with ./data/node
FIRST_BOOT=no; [ -f "$BOOT_MARKER" ] || FIRST_BOOT=yes
SEEDED=/var/lib/swg-noded/.seeded-ifaces
if [ ! -f "$SEEDED" ]; then : > "$SEEDED"
  if [ "$FIRST_BOOT" = no ]; then   # legacy node: treat the interfaces it already HAS (confs on disk) as seeded
    for _sc in "$AWG_DIR"/*.conf "${WG_DIR:-/etc/wireguard}"/*.conf; do [ -f "$_sc" ] && basename "$_sc" .conf >> "$SEEDED"; done
  fi
fi
iface_seeded(){ grep -qxF "$1" "$SEEDED" 2>/dev/null; }
mark_seeded(){ iface_seeded "$1" || echo "$1" >> "$SEEDED"; }
MANAGED=""                                  # space-separated interface names
IFJSON=""; IFSEP=""                          # swg-agent interfaces map (built per-interface, with its endpoint)
iface_conf(){ [ -f "$AWG_DIR/$1.conf" ] && { printf '%s\n' "$AWG_DIR/$1.conf"; return; }; printf '%s\n' "${WG_DIR:-/etc/wireguard}/$1.conf"; }
iface_cmd(){ # iface_cmd <conf-path> → wg | awg
  _ic="$(sed -n 's/^#swg:cmd \{1,\}\([a-z]\{1,\}\).*/\1/p' "$1" 2>/dev/null | head -1)"
  case "$_ic" in wg|awg) printf '%s\n' "$_ic"; return ;; esac
  case "$1" in "${WG_DIR:-/etc/wireguard}"/*) printf 'wg\n' ;; *) printf 'awg\n' ;; esac
}
add_iface(){ # add_iface <name> <endpoint> [conf]  — record an interface + its own endpoint for the config
  MANAGED="$MANAGED $1"
  _cf="${3:-$(iface_conf "$1")}"
  _cmd="$(iface_cmd "$_cf")"
  _onb=""; grep -q '^#swg:onboarded' "$_cf" 2>/dev/null && _onb=', "onboarded": true'   # add-only adopted iface (keep its peers)
  IFJSON="$IFJSON$IFSEP    \"$1\": { \"cmd\": [\"$_cmd\"], \"conf\": \"$_cf\", \"endpoint_host\": \"${2:-$NODE_ENDPOINT}\"${_onb} }"
  IFSEP=",
"
}

# awg-quick prefers the host's kernel module. This names the fallback when the kernel cannot create an interface.
export WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go

# gen_conf <name> <port> <address> <plain?yes|no>  — generate a server interface conf
gen_conf() (
  _name="$1"; _port="$2"; _addr="$3"; _plain="$4"; _dest="$AWG_DIR/$_name.conf"
  _priv="$(awg genkey)"
  if [ "$_plain" != yes ]; then
    _gen="$(python3 /opt/swg-noded/swg-noded --initial-awg-generation)"
    _obf="$(python3 /opt/swg-agent/swg-agent --awg-params "$_gen")"
  fi
  umask 077
  {
    echo "[Interface]"
    echo "PrivateKey = $_priv"
    echo "Address = $_addr"
    echo "ListenPort = $_port"
    echo "MTU = ${NODE_MTU:-1280}"   # headroom for turn-proxy obfuscation overhead
    [ "$_plain" = yes ] || printf '%s\n' "$_obf"
  } > "$_dest"
  chmod 600 "$_dest"
  if [ "$_plain" = yes ]; then log "generated plain-WireGuard interface $_name on :$_port ($_addr)"
  else log "generated AmneziaWG $_gen interface $_name on :$_port ($_addr)"; fi
)

# ───────── 1) source the interface set ─────────
if ls /etc/swg-node/*.conf >/dev/null 2>&1 || { [ -n "${CONF_SRC:-}" ] && [ -f "${CONF_SRC:-}" ]; }; then
  for src in /etc/swg-node/*.conf ${CONF_SRC:-}; do
    [ -f "$src" ] || continue
    name="$(basename "$src" .conf)"; dest="$AWG_DIR/$name.conf"
    [ -f "$dest" ] || cp "$src" "$dest"
    chmod 600 "$dest"; add_iface "$name" "$NODE_ENDPOINT"   # mounted confs carry no endpoint → node-level
    log "interface $name from mounted conf ($src)"
  done
elif [ -n "${NODE_IFACES:-}" ]; then
  # spec: name:port:address[:proto[:endpoint]]  (comma-separated). proto "wg" => plain WireGuard;
  # endpoint = the public IP/host clients dial for THIS interface (defaults to NODE_ENDPOINT).
  OIFS="$IFS"; IFS=','
  for entry in $NODE_IFACES; do
    IFS="$OIFS"
    name="$(echo "$entry" | cut -d: -f1)"
    port="$(echo "$entry" | cut -d: -f2)"; port="${port:-51820}"
    addr="$(echo "$entry" | cut -d: -f3)"; addr="${addr:-10.8.0.1/24}"
    proto="$(echo "$entry" | cut -d: -f4)"
    ep="$(echo "$entry" | cut -d: -f5)"; ep="${ep:-$NODE_ENDPOINT}"
    [ -n "$name" ] || { log "skipping malformed NODE_IFACES entry: $entry"; IFS=','; continue; }
    plain=no; [ "$proto" = wg ] && plain=yes
    [ -z "$proto" ] && [ "${NODE_PLAIN_WG:-no}" = yes ] && plain=yes
    if [ -f "$AWG_DIR/$name.conf" ]; then log "interface $name already present ($AWG_DIR/$name.conf)"
    elif ! iface_seeded "$name"; then gen_conf "$name" "$port" "$addr" "$plain"; mark_seeded "$name"   # newly added (first boot or added on re-install)
    else log "interface $name was removed from the panel — not regenerating"; IFS=','; continue; fi
    mark_seeded "$name"; add_iface "$name" "$ep"; IFS=','
  done
  IFS="$OIFS"
elif ls "$AWG_DIR"/*.conf >/dev/null 2>&1; then
  log "using persisted interface conf(s) — not generating a default bootstrap interface"
elif [ -n "${NODE_IFACE:-}" ]; then
  # single bootstrap interface — ONLY when explicitly named (NODE_IFACE). Blank => zero interfaces (panel-managed).
  name="$NODE_IFACE"
  plain=no; [ "${NODE_PLAIN_WG:-no}" = yes ] && plain=yes
  if [ -f "$AWG_DIR/$name.conf" ]; then log "interface $name already present ($AWG_DIR/$name.conf)"; mark_seeded "$name"; add_iface "$name" "$NODE_ENDPOINT"
  elif ! iface_seeded "$name"; then gen_conf "$name" "${NODE_LISTEN_PORT:-51820}" "${NODE_ADDRESS:-10.8.0.1/24}" "$plain"; mark_seeded "$name"; add_iface "$name" "$NODE_ENDPOINT"
  else log "interface $name was removed from the panel — not regenerating"; fi
else
  log "no bootstrap interface configured — this node is managed from the panel (add one: Interfaces → Load new interface)"
fi

for _c in "$AWG_DIR"/*.conf "${WG_DIR:-/etc/wireguard}"/*.conf; do
  [ -f "$_c" ] || continue
  _n="$(basename "$_c" .conf)"
  case " $MANAGED " in *" $_n "*) : ;; *) add_iface "$_n" "$NODE_ENDPOINT" "$_c"; log "interface $_n from persisted conf (panel-created)";; esac
done

[ -n "$MANAGED" ] || log "no interfaces yet — syncing anyway so the node still reports (add one from the panel: Interfaces → Load new interface)"   # do NOT exit: exiting makes the container restart-loop whenever the panel has removed every interface

# ───────── 2) bring each up + NAT its subnet ─────────
WAN="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n1)"; WAN="${WAN:-eth0}"

_wants=""                                   # ports our managed confs are going to listen on
for _c in $MANAGED; do
  _p="$(sed -n 's/^[[:space:]]*ListenPort[[:space:]]*=[[:space:]]*\([0-9]\+\).*/\1/p' "$(iface_conf "$_c")" 2>/dev/null | head -n1)"
  [ -n "$_p" ] && _wants="${_wants:+$_wants }$_p"     # NO leading space: " $_wants " would then hold a DOUBLE
done                                                  # space, which an empty $_lp matches — deleting everything
for _i in $(ip -o link show 2>/dev/null | sed -n 's/^[0-9]\+: \([^:@]*\).*/\1/p'); do
  case " $MANAGED " in *" $_i "*) continue ;; esac
  ip -d link show "$_i" 2>/dev/null | grep -qE 'amneziawg|wireguard' || continue
  _lp="$( { awg show "$_i" dump 2>/dev/null || wg show "$_i" dump 2>/dev/null; } | head -n1 | cut -f3 )"
  if [ -z "$_lp" ]; then
    log "leaving unmanaged interface $_i alone (couldn't read its listen port — likely userspace)"
    continue
  fi
  case " $_wants " in
    *" $_lp "*) log "removing stale interface $_i — it holds port $_lp, which a managed interface needs"
                ip link delete "$_i" 2>/dev/null || true ;;
    *)          log "leaving unmanaged interface $_i alone (adoption candidate)" ;;
  esac
done

STOPPED_IFACES="$(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); print(" ".join(x for x in v if isinstance(x, str)) if isinstance(v, list) else "")' \
  /var/lib/swg-noded/iface-stopped.json 2>/dev/null || true)"
for IFACE in $MANAGED; do
  dest="$(iface_conf "$IFACE")"
  case " $STOPPED_IFACES " in *" $IFACE "*)
    log "leaving $IFACE down — it was stopped from the panel, and stays down until it is started there"; continue;; esac
  _q="$(iface_cmd "$dest")-quick"
  log "bringing up $IFACE via $_q"
  # clear any leftover SAME-NAMED device first (host netns survives a container stop → plain `up` = "File exists").
  $_q down "$dest" 2>/dev/null || ip link del "$IFACE" 2>/dev/null || true
  # one interface failing (e.g. a port still held by something) must NOT crash-loop the whole node — log
  # it and keep going so the rest + swg-noded still come up and the panel can see the node + the gap.
  $_q up "$dest" || { log "WARNING: $_q up $IFACE failed (port in use / NET_ADMIN?) — skipping it"; continue; }
  addr_line="$(awk -F= 'tolower($1) ~ /^[[:space:]]*address[[:space:]]*$/ {print $2; exit}' "$dest" | tr -d ' ' | cut -d, -f1)"
  SUBNET="$(python3 -c "import ipaddress,sys;print(ipaddress.ip_network(sys.argv[1],strict=False))" "$addr_line" 2>/dev/null || echo "")"
  [ -n "$SUBNET" ] || { log "WARNING: could not read subnet for $IFACE — skipping its NAT"; continue; }
  if ! iptables -t nat -C POSTROUTING -s "$SUBNET" -o "$WAN" -m comment --comment "swg-nat:$IFACE" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -A POSTROUTING -s "$SUBNET" -o "$WAN" -m comment --comment "swg-nat:$IFACE" -j MASQUERADE \
      && log "NAT: masquerading $SUBNET out $WAN ($IFACE)" \
      || log "WARNING: could not add MASQUERADE for $SUBNET (need NET_ADMIN) — clients may have no internet"
  fi
  for _n in 1 2 3 4 5 6 7 8; do iptables -t nat -D POSTROUTING -s "$SUBNET" -o "$WAN" -j MASQUERADE 2>/dev/null || break; done
done

# ───────── 3) swg-agent config: declarative HTTPS sync, all interfaces listed (with per-interface endpoints) ─────────
VERIFY=false; [ "${TLS_VERIFY:-yes}" = yes ] && VERIFY=true
FP=""; [ -n "${TLS_FINGERPRINT:-}" ] && FP=",
    \"fingerprint\": \"${TLS_FINGERPRINT}\""
cat > /etc/swg-agent/config.json <<JSON
{
  "interfaces": {
$IFJSON
  },
  "endpoint_host": "${NODE_ENDPOINT}",
  "dns": ["${DNS:-1.1.1.1}"],
  "panel": {
    "url": "${PANEL_URL}",
    "token": "${NODE_TOKEN}",
    "verify": ${VERIFY}${FP}
  },
  "node": { "interval": ${INTERVAL:-5}, "agent": "${SWG_AGENT_BIN:-/opt/swg-agent/swg-agent}", "sudo": false }
}
JSON
chmod 600 /etc/swg-agent/config.json

# mark bootstrap done — from now on ./data/node-confs is the source of truth (deletes stick across reboots)
touch "$BOOT_MARKER" 2>/dev/null || true

NFT_TYPEOF_AWK='
function key(s, t) {
  if (t == "inet_service") return (s == "ports") ? "th dport" : ""
  if (t == "ifname") return (s == "lg") ? "iifname" : ""
  if (s == "doh_seen" || s == "ar" || s ~ /^pscf?_/ || s ~ /^f[0-9]+n[0-9]+_/ || s ~ /^a[0-9]+n[0-9]+_/) return "ip saddr"
  if (s == "guard" || s == "cln" || s == "doh4" || s ~ /^catl?_/ || s ~ /^(dmap|nets)_/) return "ip daddr"
  return ""
}
/^[ \t]*(set|map) [A-Za-z0-9_]+ [{]$/ { nm = $2 }
/^[ \t]*[}]$/ { nm = "" }
nm != "" && /^[ \t]+type (ipv4_addr|ifname|inet_service)( : verdict)?$/ { k = key(nm, $2); if (k != "") { sub(/type [a-z0-9_]+/, "typeof " k); m++; if (nm !~ /^psc_/) n++ } }
{ print }
END { print "#swg-typeof " (n + 0) " " (m + 0) }'
nft_typeof_migrate(){
  command -v nft >/dev/null 2>&1 || return 0
  _tl="$(nft list tables 2>/dev/null)" || return 0
  for _ft in $(printf '%s\n' "$_tl" | sed -n 's/^table \([a-z0-9]*\) \(swg[A-Za-z0-9_]*\)$/\1:\2/p'); do
    _fam="${_ft%%:*}"; _t="${_ft#*:}"
    _body="$(nft list table "$_fam" "$_t" 2>/dev/null)" || continue
    _new="$(printf '%s\n' "$_body" | awk "$NFT_TYPEOF_AWK")" || continue
    _cnt="$(printf '%s\n' "$_new" | sed -n 's/^#swg-typeof //p')"
    _n="${_cnt%% *}"; _m="${_cnt##* }"                     # the sets that decide · every key re-spelled (a meter's too)
    [ "${_n:-0}" -gt 0 ] || continue
    if { printf 'delete table %s %s\n' "$_fam" "$_t"; printf '%s\n' "$_new" | sed '/^#swg-typeof /d'; } | nft -f - 2>/dev/null; then
      log "nft: $_fam $_t re-declared its $_m set key(s) by expression, contents kept — the host's own nft reads it now"
    else
      log "nft: $_fam $_t could not be re-declared — left as it was (a host with nft 1.0.6 cannot read it until it is rebuilt)"
    fi
  done
  return 0
}
nft_typeof_migrate

# ───────── 4) sync loop: sample interfaces -> POST snapshot -> reconcile desired peers ─────────
log "syncing to ${PANEL_URL} (interfaces:${MANAGED}, endpoint ${NODE_ENDPOINT})"
export SWG_AGENT_CONFIG=/etc/swg-agent/config.json SWG_NODED_STATE=/var/lib/swg-noded
exec "${SWG_NODED_BIN:-/opt/swg-noded/swg-noded}"
