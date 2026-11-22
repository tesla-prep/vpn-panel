#!/bin/sh
set -eu

log() { printf '\033[0;36m[entrypoint]\033[0m %s\n' "$*"; }
panel_log(){   # <letter E/W/I> <text>
  local f=/var/lib/swg-panel/log/swg-panel.log lvl
  lvl="$(sed -n 's/.*"log_level"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' /var/lib/swg-panel/panel-settings.json 2>/dev/null | sed -n 1p)"
  case "$lvl:$1" in off:*|error:[WI]|warning:I) return 0;; esac
  mkdir -p "${f%/*}" 2>/dev/null || true; printf '%s %s acme: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$f" 2>/dev/null || true
}

# swg-sub certificate (defined up front)
ACME="${ACME_BIN:-/opt/acme.sh/acme.sh}"; ACME_CFG="${ACME_CONFIG:-/etc/swg-panel/acme}"
acme(){ "$ACME" --config-home "$ACME_CFG" "$@"; }
cert_is_selfsigned(){ local i s
  # strip openssl's `issuer=`/`subject=` labels — else the two strings ALWAYS differ and self-signed is never seen.
  i="$(openssl x509 -in "$1" -noout -issuer 2>/dev/null | sed 's/^issuer= *//')"
  s="$(openssl x509 -in "$1" -noout -subject 2>/dev/null | sed 's/^subject= *//')"
  [ -n "$i" ] && [ "$i" = "$s" ]; }
# An IP address in one spelling (IPv6 as Python prints it), or nothing when $1 is not one.
ip_canon(){ python3 -c 'import ipaddress, sys
try: print(ipaddress.ip_address(sys.argv[1].strip("[]")))
except ValueError: pass' "$1" 2>/dev/null || true; }
cert_covers_host(){ local host="$2" dns base pre ip hip
  hip="$(ip_canon "$host")"
  if [ -n "$hip" ]; then
    for ip in $(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -oE 'IP Address:[^,[:space:]]+' | cut -d: -f2-); do
      [ "$(ip_canon "$ip")" = "$hip" ] && return 0
    done
    # …or a DNS SAN spelling the address: the self-signed sub certificate an earlier image wrote (review F1) — refused
    # there, it was minted again on every start, a new key each time. All of it: an IPv6 one has colons of its own
    for dns in $(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -oE 'DNS:[^,[:space:]]+' | cut -d: -f2-); do
      [ "$dns" = "$host" ] || [ "$(ip_canon "$dns")" = "$hip" ] && return 0
    done
    return 1
  fi
  for dns in $(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -oE 'DNS:[^,[:space:]]+' | cut -d: -f2); do
    [ "$dns" = "$host" ] && return 0
    case "$dns" in \*.*) base="${dns#\*.}"; pre="${host%".$base"}"
      [ "$pre" != "$host" ] && [ "$pre" = "${host%%.*}" ] && return 0 ;;
    esac
  done
  return 1; }
# Days until a certificate FILE expires; empty when it cannot be read (no openssl, no file, odd date).
# Empty is never treated as a fault by the caller — "could not tell" must not become "renewal is broken".
cert_days_left(){
  local end epoch now
  [ -s "${1:-}" ] || return 0
  end="$(openssl x509 -in "$1" -noout -enddate 2>/dev/null | cut -d= -f2)"; [ -n "$end" ] || return 0
  epoch="$(date -d "$end" +%s 2>/dev/null)" || return 0
  [ -n "$epoch" ] || return 0
  now="$(date +%s)"; echo $(( (epoch - now) / 86400 ))
}
cert_overdue(){
  local nb na now life left
  [ -s "${1:-}" ] || return 0
  nb="$(date -d "$(openssl x509 -in "$1" -noout -startdate 2>/dev/null | cut -d= -f2)" +%s 2>/dev/null)" || return 0
  na="$(date -d "$(openssl x509 -in "$1" -noout -enddate 2>/dev/null | cut -d= -f2)" +%s 2>/dev/null)" || return 0
  [ -n "$nb" ] && [ -n "$na" ] || return 0
  now="$(date +%s)"; life=$((na - nb)); left=$((na - now))
  if [ "$life" -gt 0 ] && [ "$life" -le 864000 ]; then
    [ $((left * 3)) -lt "$life" ] && echo "certificate has $((left / 3600)) hour(s) left of its $(( (life + 43200) / 86400 ))-day life and has not been renewed"
  elif [ $((left / 86400)) -le 20 ]; then
    echo "certificate has $((left / 86400)) day(s) left and has not been renewed"
  fi
  return 0
}
SUB_TLS_DIR="${SUB_TLS_DIR:-/etc/swg-sub/tls}"; SC="$SUB_TLS_DIR/fullchain.pem"; SK="$SUB_TLS_DIR/key.pem"
sub_selfsigned(){ local san="DNS:$SUB_DOMAIN"
  [ -n "$(ip_canon "$SUB_DOMAIN")" ] && san="IP:$(ip_canon "$SUB_DOMAIN")"   # an address is an IP SAN, as the panel's own
  mkdir -p "$SUB_TLS_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$SK" -out "$SC" \
    -subj "/CN=$SUB_DOMAIN" -addext "subjectAltName=$san" >/dev/null 2>&1
  log "swg-sub: generated self-signed cert (CN=$SUB_DOMAIN)"; }
# The file an acme entry installs its certificate to ("" when there is no such entry).
acme_target(){ sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$ACME_CFG/${1}_ecc/${1}.conf" 2>/dev/null | head -1; }
acme_entry_is_panels(){
  case "${TLS:-}" in letsencrypt|letsencrypt-ip|cloudflare) ;; *) return 1 ;; esac
  [ "$1" = "${PANEL_DOMAIN:-}" ] && return 0
  [ -n "${SWG_PANEL_TLS_CERT:-}" ] && [ "$(acme_target "$1")" = "$SWG_PANEL_TLS_CERT" ]; }
sub_pair_kept(){ local p
  [ -s "$SC" ] && cert_covers_host "$SC" "$SUB_DOMAIN" || return 1
  p="$(openssl x509 -in "$SC" -noout -pubkey 2>/dev/null)"
  [ -n "$p" ] && [ "$p" = "$(openssl pkey -in "$SK" -pubout 2>/dev/null)" ] || return 1
  if [ "${TLS:-selfsigned}" = selfsigned ]; then cert_is_selfsigned "$SC"; else ! cert_is_selfsigned "$SC"; fi; }
sub_prune_stale(){ local conf d dl sl pl
  sl="$(printf '%s' "${SUB_DOMAIN:-}" | tr '[:upper:]' '[:lower:]')"; pl="$(printf '%s' "${PANEL_DOMAIN:-}" | tr '[:upper:]' '[:lower:]')"
  [ -n "$sl" ] || return 0
  for conf in "$ACME_CFG"/*/*.conf; do
    [ -f "$conf" ] || continue
    [ "$(sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$conf" | head -1)" = "$SC" ] || continue
    d="$(sed -n "s/^Le_Domain='\{0,1\}\([^']*\).*/\1/p" "$conf" | head -1)"; dl="$(printf '%s' "$d" | tr '[:upper:]' '[:lower:]')"
    [ -n "$d" ] && [ "$dl" != "$sl" ] && [ "$dl" != "$pl" ] || continue
    log "swg-sub: removing stale acme entry $d (it installs to the subscription page's certificate; the page is $SUB_DOMAIN now)"
    acme --remove -d "$d" --ecc >/dev/null 2>&1 || true
    rm -rf "$(dirname "$conf")"
  done; }
issue_sub_cert(){ set +e
  local pc=
  mkdir -p "$SUB_TLS_DIR"
  [ -n "${SWG_PANEL_TLS_CERT:-}" ] && [ -s "$SWG_PANEL_TLS_CERT" ] && [ -s "${SWG_PANEL_TLS_KEY:-/nonexistent}" ] \
    && cert_covers_host "$SWG_PANEL_TLS_CERT" "$SUB_DOMAIN" && pc=1
  if [ -n "$pc" ] && cert_is_selfsigned "$SWG_PANEL_TLS_CERT" && sub_pair_kept; then
    log "swg-sub: reusing present cert for $SUB_DOMAIN"
  elif [ -n "$pc" ]; then
    cp "$SWG_PANEL_TLS_CERT" "$SC"; cp "$SWG_PANEL_TLS_KEY" "$SK"
    log "swg-sub: panel certificate covers $SUB_DOMAIN — reusing it for the subscription page"
  elif [ -s "$SC" ] && { [ "${TLS:-selfsigned}" = selfsigned ] || ! cert_is_selfsigned "$SC"; } \
       && cert_covers_host "$SC" "$SUB_DOMAIN"; then
    log "swg-sub: reusing present cert for $SUB_DOMAIN"
  elif acme_entry_is_panels "$SUB_DOMAIN"; then
    # the panel's own entry: read its certificate, never install onto it (the panel's file not usable yet, or not covering)
    _ed="$ACME_CFG/${SUB_DOMAIN}_ecc"
    if [ -s "$_ed/fullchain.cer" ] && [ -s "$_ed/${SUB_DOMAIN}.key" ] && head -1 "$_ed/${SUB_DOMAIN}.cer" 2>/dev/null | grep -q 'BEGIN CERTIFICATE'; then
      cp "$_ed/${SUB_DOMAIN}.key" "$SK"; cp "$_ed/fullchain.cer" "$SC"
      log "swg-sub: $SUB_DOMAIN is the panel's own certificate entry — copied its certificate for the subscription page"
    else sub_selfsigned; fi
  else case "${TLS:-selfsigned}" in
    letsencrypt|letsencrypt-ip)
      [ -n "${ACME_EMAIL:-}" ] && acme --register-account -m "$ACME_EMAIL" --server letsencrypt >/dev/null 2>&1 || true
      if _sout="$(acme --issue -d "$SUB_DOMAIN" --standalone --server letsencrypt --keylength ec-256 2>&1)" \
           || [ -s "$ACME_CFG/${SUB_DOMAIN}_ecc/${SUB_DOMAIN}.cer" ]; then
        if acme --install-cert -d "$SUB_DOMAIN" --ecc --key-file "$SK" --fullchain-file "$SC" --reloadcmd 'true' >/dev/null 2>&1; then
          log "swg-sub: Let's Encrypt cert for $SUB_DOMAIN installed (HTTP-01)"
        else log "WARNING: swg-sub cert issued but could not be installed — falling back to self-signed"; sub_selfsigned; fi
      else
        printf '%s\n' "$_sout" | sed 's/^/[acme-sub] /'
        log "WARNING: swg-sub Let's Encrypt for $SUB_DOMAIN FAILED (see [acme-sub] above) — needs :80 reachable for THAT hostname. Falling back to self-signed."
        sub_selfsigned
      fi ;;
    cloudflare)
      if [ -n "${CF_TOKEN:-}" ] \
         && { CF_Token="$CF_TOKEN" acme --issue -d "$SUB_DOMAIN" --dns dns_cf --server letsencrypt --keylength ec-256 >/dev/null 2>&1 \
              || [ -s "$ACME_CFG/${SUB_DOMAIN}_ecc/${SUB_DOMAIN}.cer" ]; } \
         && acme --install-cert -d "$SUB_DOMAIN" --ecc --key-file "$SK" --fullchain-file "$SC" --reloadcmd 'true' >/dev/null 2>&1; then
        log "swg-sub: Cloudflare DNS-01 cert for $SUB_DOMAIN installed"
      else log "WARNING: swg-sub Cloudflare cert for $SUB_DOMAIN failed — falling back to self-signed (set the sub hostname to CF Flexible, or check the token)"; sub_selfsigned; fi ;;
    cf15)
      _scferr="$(mktemp 2>/dev/null || echo /tmp/cf15sub.err)"
      key="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)"
      csr="$(printf '%s\n' "$key" | openssl req -new -key /dev/stdin -subj "/CN=$SUB_DOMAIN" 2>/dev/null)"
      cert="$(CF_ORIGIN_TOKEN="${CF_ORIGIN_TOKEN:-}" PANEL_DOMAIN="$SUB_DOMAIN" CSR="$csr" python3 - <<'PY'
import os,json,urllib.request,urllib.error,sys
body=json.dumps({"hostnames":[os.environ["PANEL_DOMAIN"]],"requested_validity":5475,"request_type":"origin-ecc","csr":os.environ["CSR"]}).encode()
req=urllib.request.Request("https://api.cloudflare.com/client/v4/certificates",data=body,method="POST",
    headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["CF_ORIGIN_TOKEN"]})
try:
    with urllib.request.urlopen(req,timeout=30) as r: d=json.load(r)
except urllib.error.HTTPError as e: d=json.load(e)
except Exception as e: sys.stderr.write(str(e)); sys.exit(1)
if d.get("success"):
    sys.stdout.write(d["result"]["certificate"])
else:
    # Say WHAT Cloudflare objected to. Exiting mute left "cf15 request failed" and three things to guess
    # between (wrong token, wrong scope, zone not on this account); the bare-metal path has always printed
    # this, so the container was strictly worse at the same job.
    for _e in (d.get("errors") or [{"message": "unknown error"}]):
        sys.stderr.write("%s (code %s)\n" % (_e.get("message", "?"), _e.get("code", "?")))
    sys.exit(1)
PY
)" 2>"$_scferr" && [ -n "$cert" ] && { mkdir -p "$SUB_TLS_DIR"; printf '%s\n' "$cert" > "$SC"; printf '%s\n' "$key" > "$SK"; log "swg-sub: Cloudflare Origin cert for $SUB_DOMAIN installed (15y)"; } \
        || { log "WARNING: swg-sub cf15 cert for $SUB_DOMAIN failed — Cloudflare's response:"
             while IFS= read -r _l; do [ -n "$_l" ] && log "  [cf] $_l"; done < "$_scferr"
             sub_selfsigned; }
      rm -f "$_scferr" 2>/dev/null || true ;;
    *) sub_selfsigned ;;
  esac; fi
  [ -n "${SUB_HOST_SURE:-}" ] && [ -s "$SC" ] && ! cert_is_selfsigned "$SC" && cert_covers_host "$SC" "$SUB_DOMAIN" && sub_prune_stale
  [ -f "$SK" ] && chmod 600 "$SK" 2>/dev/null || true
  return 0; }
# Runtime subcommand (panel-managed): re-issue swg-sub's cert for a specific domain, then exit — no panel bootstrap.
if [ "${1:-}" = "sub-cert" ]; then
  SUB_DOMAIN="${2:-${SUB_DOMAIN:-}}"; [ -n "${2:-}" ] && SUB_HOST_SURE=1   # the panel names the page's host
  [ -n "${SUB_DOMAIN:-}" ] || { log "sub-cert: no domain given"; exit 2; }
  issue_sub_cert; exit 0
fi

PANEL_USER="${PANEL_USER:-admin}"
PANEL_DOMAIN="${PANEL_DOMAIN:-localhost}"
STATS_DIR="${STATS_DIR:-/var/www/wgstats}"

if [ -n "${SWG_PANEL_AUTH:-}" ] && [ ! -s "$SWG_PANEL_AUTH" ]; then
  case "${PANEL_PASSWORD:-}" in "(preserved)"|converted-login-preserved|unused-on-node-only)
    log "ERROR: the login file ($SWG_PANEL_AUTH) is missing and .env holds no password (PANEL_PASSWORD is a placeholder) — refusing to start without a login. Re-run the installer (it keeps your data and sets a new login), or put a password in PANEL_PASSWORD in .env and recreate the container."
    exit 1;;
  esac
  if [ -n "${PANEL_PASSWORD:-}" ]; then
    mkdir -p "$(dirname "$SWG_PANEL_AUTH")"
    python3 - "$PANEL_USER" "$PANEL_PASSWORD" > "$SWG_PANEL_AUTH" <<'PY'
import sys, os, hashlib, base64
u, pw = sys.argv[1], sys.argv[2]
salt = os.urandom(16); it = 200000
h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, it)
print("%s:pbkdf2_sha256$%d$%s$%s" % (u, it, base64.b64encode(salt).decode(), base64.b64encode(h).decode()))
PY
    chmod 600 "$SWG_PANEL_AUTH"
    log "login configured for user '$PANEL_USER'"
  else
    log "WARNING: no PANEL_PASSWORD and no auth file mounted — running WITHOUT a login"
    unset SWG_PANEL_AUTH
  fi
fi

acme_has_cert(){
  local d
  for d in "$ACME_CFG/${PANEL_DOMAIN}_ecc" "$ACME_CFG/${PANEL_DOMAIN}"; do
    [ -s "$d/fullchain.cer" ] || continue
    head -1 "$d/${PANEL_DOMAIN}.cer" 2>/dev/null | grep -q 'BEGIN CERTIFICATE' && return 0
  done
  return 1; }
acme_clear_unusable(){
  local d="$ACME_CFG/${PANEL_DOMAIN}_ecc"
  [ -d "$d" ] || return 0
  if [ -s "$d/fullchain.cer" ] && head -1 "$d/${PANEL_DOMAIN}.cer" 2>/dev/null | grep -q 'BEGIN CERTIFICATE'; then return 0; fi
  log "clearing a failed acme entry for $PANEL_DOMAIN (a domain key with no certificate) — it would mask every re-issue with \"Domain key exists\""
  rm -rf "$d"; }
# call after a failed acme run with its output — flag the common, confusing causes
acme_hint(){ case "$1" in
  *"too many certificates"*|*"rateLimited"*|*"rate limit"*)
    log "  ↳ This is a Let's Encrypt RATE LIMIT (max 5 certs per exact domain per 7 days), NOT a config error. Use TLS=cf15 (Cloudflare Origin cert — not rate-limited) now, or wait for the retry-after time above.";;
  *"Invalid response from"*|*"404"*|*"Timeout during connect"*)
    log "  ↳ HTTP-01 couldn't reach this box on :80 (firewall, or it's behind Cloudflare's proxy). Use TLS=cloudflare (DNS-01) or cf15, or grey-cloud the record.";;
esac; }
selfsigned(){ mkdir -p "$(dirname "$SWG_PANEL_TLS_CERT")"
  case "$PANEL_DOMAIN" in *[a-zA-Z]*) san="DNS:$PANEL_DOMAIN";; *) san="IP:$PANEL_DOMAIN";; esac
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$SWG_PANEL_TLS_KEY" -out "$SWG_PANEL_TLS_CERT" \
    -subj "/CN=$PANEL_DOMAIN" -addext "subjectAltName=$san" >/dev/null 2>&1
  log "generated self-signed certificate (CN=$PANEL_DOMAIN, 10y)"; }
acme_prune_stale(){
  local conf d rp
  for conf in "$ACME_CFG"/*/*.conf; do
    [ -f "$conf" ] || continue
    d="$(sed -n "s/^Le_Domain='\{0,1\}\([^']*\).*/\1/p" "$conf" | head -1)"
    [ -n "$d" ] && [ "$d" != "$PANEL_DOMAIN" ] || continue
    rp="$(sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$conf" | head -1)"
    [ "$rp" = "$SWG_PANEL_TLS_CERT" ] || continue
    log "removing stale acme entry $d (also installs to $SWG_PANEL_TLS_CERT — would clobber $PANEL_DOMAIN's cert)"
    acme --remove -d "$d" --ecc >/dev/null 2>&1 || true
    rm -rf "$(dirname "$conf")"
  done
}
# --reloadcmd is stored by acme.sh and re-run on every future renewal: SIGHUP makes the
# panel (PID 1) reload the new cert into its live TLS context with no downtime.
acme_install(){ acme_prune_stale
  acme --install-cert -d "$PANEL_DOMAIN" --ecc \
  --key-file "$SWG_PANEL_TLS_KEY" --fullchain-file "$SWG_PANEL_TLS_CERT" \
  --reloadcmd 'kill -HUP 1' >/dev/null 2>&1 \
  || log "WARNING: acme --install-cert failed — the panel may fall back to no/old cert"; }
acme_reassert(){ local e="$ACME_CFG/${PANEL_DOMAIN}_ecc"
  case "${TLS:-}" in letsencrypt|letsencrypt-ip|cloudflare) ;; *) return 0 ;; esac
  acme_has_cert || return 0
  # only when the panel serves the key of the _ecc entry acme_install installs: a certificate the operator mounted over
  # it stays theirs (review F6), and an RSA entry from an older store, with no _ecc key, is not re-pointed (review F2)
  cmp -s "$SWG_PANEL_TLS_KEY" "$e/${PANEL_DOMAIN}.key" || return 0
  [ "$(acme_target "$PANEL_DOMAIN")" = "$SWG_PANEL_TLS_CERT" ] && return 0
  log "the acme entry for $PANEL_DOMAIN installs to $(acme_target "$PANEL_DOMAIN" || true), not the panel's certificate — re-pointing it at the panel"
  acme_install; }

cert_covers_domain(){ openssl x509 -in "$1" -noout -text 2>/dev/null | grep -qF "$PANEL_DOMAIN"; }
reuse_present_cert(){
  [ -n "${SWG_PANEL_TLS_CERT:-}" ] && [ -f "$SWG_PANEL_TLS_CERT" ] || return 1
  case "${TLS:-selfsigned}" in
    cloudflare|letsencrypt|letsencrypt-ip|cf15) ! cert_is_selfsigned "$SWG_PANEL_TLS_CERT" && cert_covers_domain "$SWG_PANEL_TLS_CERT" ;;
    *) return 0 ;;
  esac; }

if [ "${TLS:-selfsigned}" = "none" ]; then
  log "TLS=none — serving plain HTTP (login travels in the clear; use only behind a tunnel)"
  unset SWG_PANEL_TLS_CERT SWG_PANEL_TLS_KEY
elif reuse_present_cert; then
  log "using the certificate already present at $SWG_PANEL_TLS_CERT (mounted / previously issued)"
  acme_reassert
elif [ -n "${SWG_PANEL_TLS_CERT:-}" ]; then
  mkdir -p "$(dirname "$SWG_PANEL_TLS_CERT")" "$ACME_CFG"
  case "${TLS:-selfsigned}" in
    none) log "TLS=none — serving plain HTTP (login travels in the clear; use only behind a tunnel)"
          unset SWG_PANEL_TLS_CERT SWG_PANEL_TLS_KEY ;;
    selfsigned|"") selfsigned ;;
    letsencrypt)
      [ -n "${ACME_EMAIL:-}" ] && acme --register-account -m "$ACME_EMAIL" --server letsencrypt >/dev/null 2>&1 || true
      log "issuing $PANEL_DOMAIN via Let's Encrypt (HTTP-01 standalone on :80)…"
      acme_clear_unusable        # a previous failure's leftover would refuse this order too
      # capture acme's full output so a failure shows WHY in 'docker logs' (don't hide it in /dev/null)
      if _out="$(acme --issue -d "$PANEL_DOMAIN" --standalone --server letsencrypt --keylength ec-256 2>&1)" || acme_has_cert; then
        acme_install; log "Let's Encrypt cert installed"
      else
        printf '%s\n' "$_out" | sed 's/^/[acme] /'
        log "WARNING: letsencrypt issuance FAILED (see [acme] lines above). HTTP-01 needs port 80 reachable from the internet and breaks behind Cloudflare's proxy — use TLS=cloudflare (DNS-01) or cf15. Falling back to self-signed."
        acme_hint "$_out"; acme_clear_unusable; selfsigned
      fi ;;
    letsencrypt-ip)
      [ -n "${ACME_EMAIL:-}" ] && acme --register-account -m "$ACME_EMAIL" --server letsencrypt >/dev/null 2>&1 || true
      log "issuing a short-lived (~6 day) Let's Encrypt IP certificate for $PANEL_DOMAIN (HTTP-01 standalone on :80)…"
      acme_clear_unusable        # a previous failure's leftover would refuse this order too
      # IP certs must use the shortlived profile; --days 3 → the 12h renew loop re-issues ~2 days in (≈4-day buffer)
      if _out="$(acme --issue -d "$PANEL_DOMAIN" --standalone --server letsencrypt --keylength ec-256 --certificate-profile shortlived --days 3 2>&1)" || acme_has_cert; then
        acme_install; log "Let's Encrypt IP cert installed (short-lived; auto-renews every 12h)"
      else
        printf '%s\n' "$_out" | sed 's/^/[acme] /'
        log "WARNING: letsencrypt-ip issuance FAILED (see [acme] lines above). Needs port 80 reachable, a PUBLIC IP, and a direct hit (not behind Cloudflare's proxy). Falling back to self-signed."
        acme_hint "$_out"; acme_clear_unusable; selfsigned
      fi ;;
    cloudflare)
      [ -n "${CF_TOKEN:-}" ] || { log "WARNING: TLS=cloudflare but CF_TOKEN unset — falling back to self-signed"; selfsigned; }
      if [ -n "${CF_TOKEN:-}" ]; then
        [ -n "${ACME_EMAIL:-}" ] && acme --register-account -m "$ACME_EMAIL" --server letsencrypt >/dev/null 2>&1 || true
        log "issuing $PANEL_DOMAIN via Let's Encrypt (DNS-01 through Cloudflare)…"
        acme_clear_unusable      # a previous failure's leftover would refuse this order too
        if _out="$(CF_Token="$CF_TOKEN" acme --issue -d "$PANEL_DOMAIN" --dns dns_cf --server letsencrypt --keylength ec-256 2>&1)" || acme_has_cert; then
          acme_install; log "Cloudflare DNS-01 cert installed"
        else
          printf '%s\n' "$_out" | sed 's/^/[acme] /'
          log "WARNING: cloudflare (DNS-01) issuance FAILED (see [acme] lines above) — check the token has Zone:DNS:Edit + Zone:Read and that $PANEL_DOMAIN is on that account. Falling back to self-signed."
          acme_hint "$_out"; acme_clear_unusable; selfsigned
        fi
      fi ;;
    cf15)
      [ -n "${CF_ORIGIN_TOKEN:-}" ] || { log "WARNING: TLS=cf15 but CF_ORIGIN_TOKEN unset — falling back to self-signed"; selfsigned; }
      if [ -n "${CF_ORIGIN_TOKEN:-}" ]; then
        log "requesting a 15-year Cloudflare Origin certificate for $PANEL_DOMAIN…"
        _cferr="$(mktemp 2>/dev/null || echo /tmp/cf15.err)"
        key="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)"
        csr="$(printf '%s\n' "$key" | openssl req -new -key /dev/stdin -subj "/CN=$PANEL_DOMAIN" 2>/dev/null)"
        cert="$(CF_ORIGIN_TOKEN="$CF_ORIGIN_TOKEN" PANEL_DOMAIN="$PANEL_DOMAIN" CSR="$csr" python3 - <<'PY'
import os,json,urllib.request,urllib.error,sys
body=json.dumps({"hostnames":[os.environ["PANEL_DOMAIN"]],"requested_validity":5475,"request_type":"origin-ecc","csr":os.environ["CSR"]}).encode()
req=urllib.request.Request("https://api.cloudflare.com/client/v4/certificates",data=body,method="POST",
    headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["CF_ORIGIN_TOKEN"]})
try:
    with urllib.request.urlopen(req,timeout=30) as r: d=json.load(r)
except urllib.error.HTTPError as e: d=json.load(e)
except Exception as e: sys.stderr.write(str(e)); sys.exit(1)
if d.get("success"):
    sys.stdout.write(d["result"]["certificate"])
else:
    # Say WHAT Cloudflare objected to. Exiting mute left "cf15 request failed" and three things to guess
    # between (wrong token, wrong scope, zone not on this account); the bare-metal path has always printed
    # this, so the container was strictly worse at the same job.
    for _e in (d.get("errors") or [{"message": "unknown error"}]):
        sys.stderr.write("%s (code %s)\n" % (_e.get("message", "?"), _e.get("code", "?")))
    sys.exit(1)
PY
)" 2>"$_cferr" && [ -n "$cert" ] && { printf '%s\n' "$cert" > "$SWG_PANEL_TLS_CERT"; printf '%s\n' "$key" > "$SWG_PANEL_TLS_KEY"; log "Cloudflare Origin cert installed (15y) — valid only behind Cloudflare's proxy"; } \
          || { log "WARNING: cf15 request failed — Cloudflare's response:"
               while IFS= read -r _l; do [ -n "$_l" ] && log "  [cf] $_l"; done < "$_cferr"
               log "  the token needs Zone → SSL and Certificates → Edit, and $PANEL_DOMAIN must be on that account"
               log "  falling back to self-signed"; selfsigned; }
        rm -f "$_cferr" 2>/dev/null || true
      fi ;;
    *) log "unknown TLS='$TLS' — using self-signed"; selfsigned ;;
  esac
  [ -n "${SWG_PANEL_TLS_KEY:-}" ] && [ -f "${SWG_PANEL_TLS_KEY:-/nonexistent}" ] && chmod 600 "$SWG_PANEL_TLS_KEY" 2>/dev/null || true
fi

if [ "${DRY_RUN:-}" = 1 ]; then
  case "${TLS:-selfsigned}" in
    none) log "dry-run OK: reverse-proxy (plain HTTP) — no certificate needed"; exit 0 ;;
    selfsigned|"")
      { [ -n "${SWG_PANEL_TLS_CERT:-}" ] && [ -f "$SWG_PANEL_TLS_CERT" ] && cert_covers_domain "$SWG_PANEL_TLS_CERT"; } \
        && { log "dry-run OK: self-signed certificate for $PANEL_DOMAIN"; exit 0; }
      log "dry-run FAILED: couldn't produce a self-signed certificate for $PANEL_DOMAIN"; exit 3 ;;
    *)
      { [ -n "${SWG_PANEL_TLS_CERT:-}" ] && [ -f "$SWG_PANEL_TLS_CERT" ] && ! cert_is_selfsigned "$SWG_PANEL_TLS_CERT" && cert_covers_domain "$SWG_PANEL_TLS_CERT"; } \
        && { log "dry-run OK: a valid $TLS certificate for $PANEL_DOMAIN is ready"; exit 0; }
      log "dry-run FAILED: no valid certificate for $PANEL_DOMAIN (would serve self-signed / wrong-domain)"; exit 3 ;;
  esac
fi

sub_domain_cfg(){ python3 - "${PANEL_SETTINGS:-/var/lib/swg-panel/panel-settings.json}" 2>/dev/null <<'PY'
import json,os,sys
from urllib.parse import urlparse
if not os.path.exists(sys.argv[1]):
    print(""); sys.exit(0)
try:
    u = (((json.load(open(sys.argv[1])).get("access") or {}).get("sub") or {}).get("url") or "")
    print(urlparse(u).hostname or "")
except Exception:
    print("")
    sys.exit(1)
PY
}
_sub_dom_cfg="$(sub_domain_cfg)" && SUB_HOST_SURE=1         # read, or none yet: SUB_DOMAIN below IS the page's host
[ -n "$_sub_dom_cfg" ] && SUB_DOMAIN="$_sub_dom_cfg"
if [ "${TLS:-selfsigned}" != none ] && [ -n "${SUB_DOMAIN:-}" ]; then ( issue_sub_cert ) & fi

# 3) fleet.json: use the mounted one; else write a starter. Nodes are managed in
#    the UI (Nodes screen) and live in nodes.json — not listed here.
if [ -n "${SWG_PANEL_FLEET:-}" ] && [ ! -f "$SWG_PANEL_FLEET" ]; then
  mkdir -p "$(dirname "$SWG_PANEL_FLEET")"
  cat > "$SWG_PANEL_FLEET" <<JSON
{
  "roster_path":   "/var/lib/swg-panel/users.json",
  "nodes_path":    "/var/lib/swg-panel/nodes.json",
  "stats_dir":     "$STATS_DIR",
  "store_configs": true,
  "config_dir":    "/var/lib/swg-panel/configs",
  "node_interval": 5
}
JSON
  log "wrote a starter fleet.json (add nodes in the UI → Nodes)"
fi
mkdir -p "$STATS_DIR" /var/lib/swg-panel
[ -f /var/lib/swg-panel/nodes.json ] || { echo '{}' > /var/lib/swg-panel/nodes.json; log "seeded empty nodes.json"; }

sub_follow_panel(){ local d f dl
  [ -s "$SC" ] && [ -s "${SWG_PANEL_TLS_CERT:-/nonexistent}" ] && [ -s "${SWG_PANEL_TLS_KEY:-/nonexistent}" ] || return 0
  cmp -s "$SWG_PANEL_TLS_CERT" "$SC" && return 0
  cert_is_selfsigned "$SWG_PANEL_TLS_CERT" && return 0     # a failed issuance's placeholder never replaces the sub's cert
  d="$(sub_domain_cfg)"; d="${d:-${SUB_DOMAIN:-}}"; dl="$(printf '%s' "$d" | tr '[:upper:]' '[:lower:]')"
  for f in "$ACME_CFG"/*/*.conf; do                         # the sub has a renewer of its own: its entry installs here
    [ -f "$f" ] && [ "$(sed -n "s/^Le_RealFullChainPath='\{0,1\}\([^']*\).*/\1/p" "$f" | sed -n 1p)" = "$SC" ] \
      && { [ -z "$d" ] || [ "$(sed -n "s/^Le_Domain='\{0,1\}\([^']*\).*/\1/p" "$f" | sed -n 1p | tr '[:upper:]' '[:lower:]')" = "$dl" ]; } \
      && return 0
  done      # (review F3: the two overwrote each other on alternate renewals) — for the sub's host now, not one it had
  cmp -s "$SWG_PANEL_TLS_KEY" "$SK" || { [ -n "$d" ] && cert_covers_host "$SWG_PANEL_TLS_CERT" "$d"; } || return 0
  cp "$SWG_PANEL_TLS_KEY" "$SK.new" && chmod 600 "$SK.new" && cp "$SWG_PANEL_TLS_CERT" "$SC.new" \
    && mv -f "$SK.new" "$SK" && mv -f "$SC.new" "$SC" \
    && log "swg-sub: the panel's certificate changed — the subscription page's copy follows it" \
    || log "WARNING: could not copy the panel's renewed certificate for the subscription page"
}
renew_why(){ local why
  if printf '%s' "$1" | grep -qiE "error.*(renew|issu).*${PANEL_DOMAIN}"; then
    why="$(printf '%s' "$1" | grep -iE "error.*${PANEL_DOMAIN}" | tail -1)"
  else
    why="$(cert_overdue "$SWG_PANEL_TLS_CERT")"
  fi
  [ -n "$why" ] || return 0
  if [ -s "$ACME_CFG/.port80-held" ] && [ "${TLS:-}" != cloudflare ]; then
    why="$why — the installer found host port 80 held by $(head -c 64 "$ACME_CFG/.port80-held" | tr -d '\n') and did not publish it, so Let's Encrypt may not reach this panel: if that is still so, free port 80 and re-run the installer$([ "${TLS:-}" = letsencrypt ] && echo ", or switch to Cloudflare DNS-01" || true)"
  fi
  printf '%s\n' "$why"; }
case "${TLS:-selfsigned}" in
  letsencrypt|letsencrypt-ip|cloudflare)
    ( while :; do
        out="$(acme --cron 2>&1)" || true
        sub_follow_panel || true
        _why="$(renew_why "$out")"
        if [ -z "$_why" ]; then
          printf 'ok %s\n' "$(date +%s)" > "$ACME_CFG/.renew-status" 2>/dev/null || true
          panel_log I "renewal check for $PANEL_DOMAIN ok ($(cert_days_left "$SWG_PANEL_TLS_CERT") day(s) left)"
          sleep 43200
        else
          # keep the FIRST failure time across iterations — "failing since" is the fact worth having
          _since="$(sed -n 's/^failing \([0-9]*\).*/\1/p' "$ACME_CFG/.renew-status" 2>/dev/null | head -1)"
          printf 'failing %s %s\n' "${_since:-$(date +%s)}" "$_why" > "$ACME_CFG/.renew-status" 2>/dev/null || true
          log "WARNING: TLS auto-renewal failed for $PANEL_DOMAIN — retrying in 1h. last: $_why"
          panel_log W "renewal failed for $PANEL_DOMAIN — retrying in 1h: $_why"; sleep 3600
        fi
      done ) &
    log "TLS auto-renewal enabled (acme.sh --cron every 12h; 1h retry on failure; reload via SIGHUP)" ;;
esac

log "starting swg-panel-server on ${SWG_PANEL_HOST:-0.0.0.0}:${SWG_PANEL_PORT:-8443}"
exec "${SWG_PANEL_BIN:-/opt/swg-panel/swg-panel-server}"
