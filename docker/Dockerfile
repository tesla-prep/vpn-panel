# check=skip=SecretsUsedInArgOrEnv
ARG BASE_REGISTRY=public.ecr.aws/docker/library
FROM ${BASE_REGISTRY}/python:3.12-slim

# С версии 3.1.4 acme.sh проверяет тип содержимого ответа CA перед сохранением сертификата.
ARG ACME_VERSION=3.1.4
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssl ca-certificates curl socat tar tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors \
      "https://github.com/acmesh-official/acme.sh/archive/refs/tags/${ACME_VERSION}.tar.gz" -o /tmp/acme.tar.gz \
 && mkdir -p /tmp/acme && tar -xzf /tmp/acme.tar.gz -C /tmp/acme --strip-components=1 \
 && ( cd /tmp/acme && ./acme.sh --install --home /opt/acme.sh --nocron --noprofile ) \
 # bundle the DNS plugins so 'cloudflare' (DNS-01) never has to fetch dns_cf.sh from GitHub at
 # runtime (which fails on networks that can't reach GitHub); verify the cf plugin is present.
 && mkdir -p /opt/acme.sh/dnsapi && cp -rf /tmp/acme/dnsapi/. /opt/acme.sh/dnsapi/ \
 && ln -sf /opt/acme.sh/acme.sh /usr/local/bin/acme.sh \
 && /opt/acme.sh/acme.sh --version \
 && test -f /opt/acme.sh/dnsapi/dns_cf.sh \
 && rm -rf /tmp/acme /tmp/acme.tar.gz

WORKDIR /opt/swg-panel
COPY src/swg-panel-server src/app.css src/app.js src/index.html src/reconcile.js src/turn-artifacts.js VERSION ./
COPY src/swg-sub src/sub.html src/sub.js src/sub.css ./
COPY src/swg-passwd /usr/local/bin/swg-passwd
COPY src/vendor/ ./vendor/
# m/ = the phone UI (docs/MOBILE-PLAN.md): m.css, the app manifest and its icons
COPY src/m/ ./m/
# js/ = the SPA's ES modules (docs/APP-JS-SPLIT-PLAN.md) — copied as a DIRECTORY, like vendor/, so adding a module never touches this loop
COPY src/js/ ./js/
# Проверяем наличие локальных модулей SPA в собранном образе.
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
        if not target.startswith("."):          # preact / htm — resolved by the importmap, not on disk
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
    SWG_PANEL_TLS_CERT=/etc/swg-panel/tls/fullchain.pem \
    SWG_PANEL_TLS_KEY=/etc/swg-panel/tls/key.pem \
    STATS_DIR=/var/www/wgstats \
    PANEL_USER=admin \
    TLS=selfsigned

EXPOSE 8443
ENTRYPOINT ["/entrypoint.sh"]
