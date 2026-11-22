# check=skip=SecretsUsedInArgOrEnv
ARG BASE_REGISTRY=public.ecr.aws/docker/library
FROM ${BASE_REGISTRY}/python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/swg-panel
COPY src/swg-panel-server src/app.css src/app.js src/index.html src/reconcile.js src/turn-artifacts.js VERSION ./
COPY src/swg-sub src/sub.html src/sub.js src/sub.css ./
COPY src/swg-passwd /usr/local/bin/swg-passwd
COPY src/vendor/ ./vendor/
COPY src/m/ ./m/
COPY src/js/ ./js/
RUN python3 - ./js ./app.js <<'PYJS'
import os, re, sys
jsdir, entry = sys.argv[1], sys.argv[2]
files = [entry] + [os.path.join(jsdir, f) for f in sorted(os.listdir(jsdir)) if f.endswith(".js")]
subdirs = [os.path.join(r, f) for r, _d, fs in os.walk(jsdir) for f in fs if f.endswith(".js")]
files = sorted(set(files) | set(subdirs))
spec = re.compile(r"""(?:import|export)[^;'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']""")
missing, edges = [], 0
for f in files:
    src = open(f, encoding="utf-8").read()
    for m in spec.finditer(src):
        target = m.group(1) or m.group(2)
        if not target.startswith("."):
            continue
        edges += 1
        p = os.path.normpath(os.path.join(os.path.dirname(f), target))
        if not os.path.exists(p):
            missing.append("%s -> %s" % (os.path.basename(f), target))
print("SPA: %d modules, %d local imports, all resolved" % (len(files), edges) if not missing
      else "SPA: %d local imports checked" % edges)
if missing:
    sys.exit("INCOMPLETE SPA in the image — unresolved: " + "; ".join(missing[:8]))
PYJS
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh ./swg-panel-server ./swg-sub /usr/local/bin/swg-passwd

ENV SWG_PANEL_WEB=/opt/swg-panel \
    SWG_PANEL_FLEET=/etc/swg-panel/fleet.json \
    SWG_PANEL_HOST=0.0.0.0 \
    SWG_PANEL_PORT=8443 \
    SWG_PANEL_AUTH=/etc/swg-panel/auth \
    STATS_DIR=/var/www/wgstats

EXPOSE 8443
ENTRYPOINT ["/entrypoint.sh"]
