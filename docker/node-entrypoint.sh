#!/bin/sh
set -eu
umask 077
log() { printf '[swg-node] %s\n' "$*"; }

: "${PANEL_URL:?Set PANEL_URL}"
: "${NODE_TOKEN:?Set NODE_TOKEN}"
: "${NODE_ENDPOINT:?Set NODE_ENDPOINT}"

mkdir -p /etc/swg-agent /var/lib/swg-noded
export SWG_AGENT_CONFIG=/etc/swg-agent/config.json SWG_NODED_STATE=/var/lib/swg-noded

python3 - <<'PY'
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

url = os.environ["PANEL_URL"].rstrip("/")
parsed = urlsplit(url)
if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
    raise SystemExit("PANEL_URL must be the panel's public HTTPS URL.")
interfaces = {}
for directory, tool in (("/etc/amnezia/amneziawg", "awg"), ("/etc/wireguard", "wg")):
    for path in sorted(Path(directory).glob("*.conf")):
        if not re.fullmatch(r"[A-Za-z0-9_=+.-]{1,15}", path.stem) or path.stem in interfaces:
            raise SystemExit(f"Invalid or duplicate interface name: {path.stem}")
        interfaces[path.stem] = {"cmd": [tool], "conf": str(path), "endpoint_host": os.environ["NODE_ENDPOINT"]}
Path(os.environ["SWG_AGENT_CONFIG"]).write_text(json.dumps({
    "interfaces": interfaces,
    "endpoint_host": os.environ["NODE_ENDPOINT"],
    "dns": ["1.1.1.1"],
    "panel": {"url": url, "token": os.environ["NODE_TOKEN"], "verify": True},
    "node": {"interval": 5, "agent": "/opt/swg-agent/swg-agent", "sudo": False},
}), encoding="utf-8")
PY

MANAGED=$(python3 -c 'import json, os; print(" ".join(json.load(open(os.environ["SWG_AGENT_CONFIG"]))["interfaces"]))')
iface_conf() {
    if [ -f "/etc/amnezia/amneziawg/$1.conf" ]; then
        printf '%s\n' "/etc/amnezia/amneziawg/$1.conf"
    else
        printf '%s\n' "/etc/wireguard/$1.conf"
    fi
}
iface_cmd() {
    case "$1" in /etc/wireguard/*) echo wg ;; *) echo awg ;; esac
}

WAN=$(ip -4 route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n1)
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
  $_q up "$dest" || { log "WARNING: $_q up $IFACE failed (check the port and host kernel module) — skipping it"; continue; }
  addr_line="$(awk -F= 'tolower($1) ~ /^[[:space:]]*address[[:space:]]*$/ {print $2; exit}' "$dest" | tr -d ' ' | cut -d, -f1)"
  SUBNET="$(python3 -c "import ipaddress,sys;print(ipaddress.ip_network(sys.argv[1],strict=False))" "$addr_line" 2>/dev/null || echo "")"
  [ -n "$SUBNET" ] || { log "WARNING: could not read subnet for $IFACE — skipping its NAT"; continue; }
  if ! iptables -t nat -C POSTROUTING -s "$SUBNET" -o "$WAN" -m comment --comment "swg-nat:$IFACE" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -A POSTROUTING -s "$SUBNET" -o "$WAN" -m comment --comment "swg-nat:$IFACE" -j MASQUERADE \
      && log "NAT: masquerading $SUBNET out $WAN ($IFACE)" \
      || log "WARNING: could not add MASQUERADE for $SUBNET (need NET_ADMIN) — clients may have no internet"
  fi
done

exec /opt/swg-noded/swg-noded
