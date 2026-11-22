#!/bin/sh
set -eu
umask 077
[ -s "$SWG_PANEL_AUTH" ] || { echo 'Panel credentials missing. Run swg-passwd before starting the panel.' >&2; exit 1; }
mkdir -p /var/lib/swg-panel /var/www/wgstats
if [ ! -f "$SWG_PANEL_FLEET" ]; then
    cat > "$SWG_PANEL_FLEET" <<'JSON'
{
  "roster_path": "/var/lib/swg-panel/users.json",
  "nodes_path": "/var/lib/swg-panel/nodes.json",
  "stats_dir": "/var/www/wgstats",
  "store_configs": true,
  "config_dir": "/var/lib/swg-panel/configs",
  "node_interval": 5
}
JSON
fi
exec /opt/swg-panel/swg-panel-server
