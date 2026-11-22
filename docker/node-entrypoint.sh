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
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

url = os.environ["PANEL_URL"].rstrip("/")
parsed = urlsplit(url)
if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
    raise SystemExit("PANEL_URL must be the panel's public HTTPS URL.")
interfaces = {}
for directory, tool in (("/etc/amnezia/amneziawg", "awg"), ("/etc/wireguard", "wg")):
    for path in sorted(Path(directory).glob("*.conf")):
        if not path.is_file():
            continue
        config = path.read_text(encoding="utf-8", errors="replace")
        if not config.startswith(f"#swg:cmd {tool}\n"):
            continue
        if not re.fullmatch(r"[A-Za-z0-9_=+.-]{1,15}", path.stem) or path.stem in interfaces:
            raise SystemExit(f"Invalid or duplicate interface name: {path.stem}")
        if subprocess.run(["ip", "link", "show", "dev", path.stem], capture_output=True).returncode == 0:
            private = re.search(r"^PrivateKey[ \t]*=[ \t]*(\S+)", config.partition("[Peer]")[0], re.M)
            live = subprocess.run([tool, "show", path.stem, "public-key"], capture_output=True, text=True)
            saved = subprocess.run([tool, "pubkey"], input=private[1] + "\n" if private else "",
                                   capture_output=True, text=True)
            if live.returncode or saved.returncode or not saved.stdout.strip() or live.stdout.strip() != saved.stdout.strip():
                print(f"[swg-node] Skipping {path.stem}: its name is already in use.", file=sys.stderr)
                continue
        interfaces[path.stem] = {"cmd": [tool], "conf": str(path), "endpoint_host": os.environ["NODE_ENDPOINT"]}
Path(os.environ["SWG_AGENT_CONFIG"]).write_text(json.dumps({
    "interfaces": interfaces,
    "endpoint_host": os.environ["NODE_ENDPOINT"],
    "dns": ["1.1.1.1"],
    "panel": {"url": url, "token": os.environ["NODE_TOKEN"], "verify": True},
    "node": {"interval": 5, "agent": "/opt/swg-agent/swg-agent", "sudo": False},
}), encoding="utf-8")
PY

/opt/swg-noded/swg-noded --restore-static-egress

MANAGED=$(python3 -c 'import json, os; print(" ".join(json.load(open(os.environ["SWG_AGENT_CONFIG"]))["interfaces"]))')
iface_conf() {
    python3 -c 'import json, os, sys; print(json.load(open(os.environ["SWG_AGENT_CONFIG"]))["interfaces"][sys.argv[1]]["conf"])' "$1"
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
  $_q down "$dest" 2>/dev/null || ip link del "$IFACE" 2>/dev/null || true
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
