import { b64, esc, url, tkey } from "./util.js";
import { T, Tsplit, srvText } from "./i18n.js";
import { Store, api, bus } from "./store.js";
import { Ic, Sheet, Panel, toast, copy, closeModal, pushModal } from "./ui.js";
import { turnFork, turnForkList, forkLabel } from "./turn-catalog.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

// crypto + config (in-browser; private key never leaves)
export function cryptoReady() { return !!(window.crypto && window.crypto.subtle); }
export function assertCrypto() {
  if (!cryptoReady()) throw new Error(T("This panel needs a secure connection: your browser only provides the Web Crypto it uses to generate keys over https:// (or http://localhost). Reach the panel over https://, or tunnel it to http://127.0.0.1."));
}
export async function genKeys() {
  assertCrypto();
  const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const pk8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  return { pub: b64(raw), priv: b64(pk8.slice(-32)) };
}
export function genPSK() { const b = new Uint8Array(32); crypto.getRandomValues(b); return b64(b); }

// ── subscription vault crypto — all client-side (AES-GCM + PBKDF2 via WebCrypto). The panel only ever
//    receives wrapped/ciphertext blobs it can't read. See swg-panel-server's subscriptions helper block. ──
export const SUB_CHECK = "swg-sub-v1";   // known plaintext → lets the browser verify it unwrapped the vault correctly
export async function subWrapKey(password, saltBytes) {   // password → AES key, via PBKDF2 (never leaves the browser)
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: saltBytes, iterations: 200000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function subEnc(key, bytes) {   // → base64( iv(12) ‖ ciphertext )
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
export async function subDec(key, b64s) {    // base64(iv‖ct) → bytes; throws on wrong key / tamper (GCM auth)
  const all = _b64ToBytes(b64s); return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12)));
}
// Wrap the SK under a password → the request body for the vault's single keyslot.
export async function subSlotBody(password, skBytes) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wk = await subWrapKey(password, salt);
  return { salt: b64(salt), sk_by_pw: await subEnc(wk, skBytes),
           sk_check: await subEnc(wk, new TextEncoder().encode(SUB_CHECK)) };
}
export async function subVaultCreate(password) {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const skKey = await _importAes(sk, ["encrypt", "decrypt"]);
  const r = await api.subVaultSet({ ...await subSlotBody(password, sk),
    fresh: true,   // a NEW SK → the server drops the now-undecryptable escrow keypair
    // SK self-verifier (encrypted UNDER the SK) so a cached SK can be validated against THIS vault on boot —
    // a stale cache left over from a previous (reset) vault is then detected + discarded, never trusted.
    sk_verify: await subEnc(skKey, new TextEncoder().encode(SUB_CHECK)) });
  if (!r || r.ok === false) throw new Error(srvText(r) || T("couldn't save the vault"));
  _subSK = skKey;                                          // unlock immediately with the NEW SK (replaces any stale cache)
  try { sessionStorage.setItem(_SK_CACHE, b64(sk)); } catch (_) {}
  try { await ivkSetEscrow(true); } catch (_) {}          // interface-key escrow ON by default — a fresh box vaults its interface keys from first setup
  return b64(sk);
}

export function useSubRec(userId) {
  const [rec, setRec] = useState(undefined);
  useEffect(() => { let ok = true;
    if (!subFeatureOn() || !userId) { setRec(null); return; }
    subUsersMap().then(m => { if (ok) setRec(m[userId] || null); }).catch(() => { if (ok) setRec(null); });
    return () => { ok = false; }; }, [userId, Store.configEpoch]);
  return rec;
}
export function SubAutoNote() {
  if (!subFeatureOn()) return null;
  return html`<div class="sub-auto"><${Ic} i="check"/><span><b>${T("Subscribed users need nothing")}</b>${T(" — their subscription page serves the corrected config automatically; only manually-shared QR codes / configs need re-distributing.")}</span></div>`;
}


export const b64url = u => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const _importAes = (bytes, uses) => crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, uses);

const _X25519_PKCS8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
async function _ivkHkdf(ikm, salt, infoStr, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(infoStr) }, k, len * 8));
}
export async function ivkSeal(pubB64, plaintext) {   // seal bytes to an X25519 public key → {eph, ct, mac}
  const eph = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const pub = await crypto.subtle.importKey("raw", _b64ToBytes(pubB64), { name: "X25519" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: pub }, eph.privateKey, 256));
  const ks = await _ivkHkdf(shared, ephPub, "swg-ivk-enc", plaintext.length);
  const mk = await _ivkHkdf(shared, ephPub, "swg-ivk-mac", 32);
  const ct = plaintext.map((b, i) => b ^ ks[i]);
  const mkKey = await crypto.subtle.importKey("raw", mk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const macIn = new Uint8Array(ephPub.length + ct.length); macIn.set(ephPub); macIn.set(ct, ephPub.length);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", mkKey, macIn));
  return { eph: b64(ephPub), ct: b64(ct), mac: b64(mac) };
}
export async function ivkUnseal(privRaw, blob) {     // open a {eph, ct, mac} blob with a raw 32-byte X25519 private key
  const pkcs8 = new Uint8Array(_X25519_PKCS8.length + 32); pkcs8.set(_X25519_PKCS8); pkcs8.set(privRaw, _X25519_PKCS8.length);
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]);
  const ephPub = _b64ToBytes(blob.eph), ct = _b64ToBytes(blob.ct), mac = _b64ToBytes(blob.mac);
  const pub = await crypto.subtle.importKey("raw", ephPub, { name: "X25519" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: pub }, priv, 256));
  const mk = await _ivkHkdf(shared, ephPub, "swg-ivk-mac", 32);
  const mkKey = await crypto.subtle.importKey("raw", mk, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const macIn = new Uint8Array(ephPub.length + ct.length); macIn.set(ephPub); macIn.set(ct, ephPub.length);
  if (!(await crypto.subtle.verify("HMAC", mkKey, mac, macIn))) throw new Error(T("vault blob failed its integrity check"));
  const ks = await _ivkHkdf(shared, ephPub, "swg-ivk-enc", ct.length);
  return ct.map((b, i) => b ^ ks[i]);
}
export async function ivkSetEscrow(enabled) {
  if (!enabled) { const r = await api.post("/api/sub/ivk", { enabled: false }); if (!r || !r.ok) throw new Error(srvText(r) || T("couldn't disable escrow")); return false; }
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Encryption Vault first."));
  const body = { enabled: true };
  const v = await api.subVault();
  if (!(v && v.ok && v.data && v.data.ivk_pub)) {   // first enable → mint the keypair in the browser
    const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const pk8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    body.ivk_pub = b64(pubRaw); body.ivk_priv_by_sk = await subEnc(sk, pk8.slice(-32));
  }
  const r = await api.post("/api/sub/ivk", body); if (!r || !r.ok) throw new Error(srvText(r) || T("couldn't enable escrow"));
  return true;
}
export async function ivkVaultPriv() {               // the vault X25519 private key (raw 32 bytes), unwrapped under the SK
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the vault first."));
  const v = await api.subVault();
  if (!v || !v.ok || !v.data || !v.data.ivk_priv_by_sk) throw new Error(T("No interface-key vault is set up."));
  return await subDec(sk, v.data.ivk_priv_by_sk);
}
// For a vault-sourced missing interface: unseal the escrowed key and RE-seal it to the node's transport key, so
// the panel relays only ciphertext. Returns the sealed_key for /api/iface/recreate, or null if not a vault key.
export async function ivkResealForNode(node, mi) {
  if (!mi || mi.key_source !== "vault") return null;
  if (!subSKCached()) throw new Error(T("Unlock the Encryption Vault first."));
  if (!mi.key_blob) throw new Error(T("No escrowed key is stored for this interface."));
  const tpub = ((Store.stats[node] || {}).transport_pub) || "";
  if (!tpub) throw new Error(T("The node hasn't reported its transport key yet — try again in a few seconds."));
  return await ivkSeal(tpub, await ivkUnseal(await ivkVaultPriv(), mi.key_blob));
}
export async function ivkResealForNodeBlob(node, keyBlob, missing) {
  if (!subSKCached()) throw new Error(T("Unlock the Encryption Vault first."));
  if (!keyBlob || !keyBlob.ct) throw new Error(missing || T("No escrowed key is stored for this."));
  const tpub = ((Store.stats[node] || {}).transport_pub) || "";
  if (!tpub) throw new Error(T("The node hasn't reported its transport key yet — try again in a few seconds."));
  return await ivkSeal(tpub, await ivkUnseal(await ivkVaultPriv(), keyBlob));
}
// A WDTT server's escrowed identity (owner pw + wg-keys.dat). Same dance, its own sentence.
export async function wdttResealForNode(node, keyBlob) {
  return await ivkResealForNodeBlob(node, keyBlob, T("No escrowed identity is stored for this WDTT server."));
}

let _subSK = null;                       // the unwrapped encryption key (CryptoKey), cached for this session
const _SK_CACHE = "swg_ck";              // key-cache: sessionStorage always (tab-scoped); ALSO localStorage when the
const _SK_PERSIST = "swg_ck_keep";       // operator opts into "keep this device unlocked" (survives a browser restart).
export function subSKCached() { return _subSK; }
export function subPersistOn() { try { return localStorage.getItem(_SK_PERSIST) === "1"; } catch (_) { return false; } }
export function subSetPersist(on) {
  try {
    if (on) { localStorage.setItem(_SK_PERSIST, "1"); const b = sessionStorage.getItem(_SK_CACHE); if (b) localStorage.setItem(_SK_CACHE, b); }
    else { localStorage.removeItem(_SK_PERSIST); localStorage.removeItem(_SK_CACHE); }
  } catch (_) {}
}
export function subForget() { _subSK = null; try { sessionStorage.removeItem(_SK_CACHE); localStorage.removeItem(_SK_CACHE); } catch (_) {} }   // drop the key from memory + both stores (logout / password change / lock)
export function lockVault() {
  subForget();
  try { localStorage.removeItem(_SK_PERSIST); } catch (_) {}
  try { for (const k in _healTried) delete _healTried[k]; } catch (_) {}
  Store.configEpoch++; bus.emit();
  try { toast(T("Encryption Vault locked on this device."), "ok"); } catch (_) {}
}
export async function subBootRestore() {
  if (_subSK) return;
  // localStorage first (device-persist survives a browser restart / cookie-only login), then sessionStorage (tab).
  let s = null; try { s = localStorage.getItem(_SK_CACHE) || sessionStorage.getItem(_SK_CACHE); } catch (_) {}
  if (!s) return;
  try { sessionStorage.setItem(_SK_CACHE, s); } catch (_) {}   // mirror into the tab cache so the rest of the code path is unchanged
  try {
    const key = await _importAes(_b64ToBytes(s), ["encrypt", "decrypt"]);
    const v = await api.subVault();
    if (!v || !v.ok || !v.data || !v.data.exists) { subForget(); return; }   // vault gone (reset) → the cache is stale
    if (v.data.sk_verify) {                                                    // validate the cache matches THIS vault's SK
      let ok = false;
      try { ok = new TextDecoder().decode(await subDec(key, v.data.sk_verify)) === SUB_CHECK; } catch (_) {}
      if (!ok) { subForget(); return; }                                       // stale SK (a different/reset vault) → discard, never trust
    }
    _subSK = key;
  } catch (_) { subForget(); }
}
// Unwrap the SK from the vault with the panel password → cache it.
export async function subUnlock(password) {
  const v = await api.subVault();
  if (!v || v.ok === false || !v.data || !v.data.exists) throw new Error(T("Config encryption isn't set up yet."));
  const wk = await subWrapKey(password, _b64ToBytes(v.data.salt));
  let skBytes;
  try {
    if (new TextDecoder().decode(await subDec(wk, v.data.sk_check)) !== SUB_CHECK) throw new Error("bad");
    skBytes = await subDec(wk, v.data.sk_by_pw);        // GCM auth fails here on a wrong password
  } catch (_) { throw new Error(T("That password didn't unlock the Encryption Vault.")); }
  _subSK = await _importAes(skBytes, ["encrypt", "decrypt"]);
  try { sessionStorage.setItem(_SK_CACHE, b64(skBytes)); if (subPersistOn()) localStorage.setItem(_SK_CACHE, b64(skBytes)); } catch (_) {}   // tab cache; also localStorage when device-persist is opted in
  // self-heal: give an older vault (pre-sk_verify) an SK self-verifier so a cached SK can be validated on boot.
  if (!v.data.sk_verify) {
    try { await api.subVaultSet({ salt: v.data.salt, sk_by_pw: v.data.sk_by_pw, sk_check: v.data.sk_check,
      sk_verify: await subEnc(_subSK, new TextEncoder().encode(SUB_CHECK)) }); } catch (_) {}   // the wrap is resent verbatim — the server merges, so the escrow keypair survives
  }
  try { subFlushPending(); } catch (_) {}   // save anything the operator skipped earlier this session (incl. overwriting a stale rotate blob)
  try { subAutoHeal(); } catch (_) {}   // key just became available → silently publish anything left unpublished while locked
  return _subSK;
}
export async function subRewrap(newPassword) {
  let skB64 = null; try { skB64 = sessionStorage.getItem(_SK_CACHE); } catch (_) {}
  if (!skB64 || !newPassword) return false;
  try {
    const v = await api.subVault(); if (!v || !v.ok || !v.data || !v.data.exists) return false;
    const r = await api.subVaultSet(await subSlotBody(newPassword, _b64ToBytes(skB64)));
    return !!(r && r.ok !== false);
  } catch (_) { return false; }
}
export async function subUnlockWithKey(keyB64) {
  const raw = String(keyB64 || "").trim();
  let bytes; try { bytes = _b64ToBytes(raw); } catch (_) { throw new Error(T("That doesn't look like an encryption key.")); }
  if (bytes.length !== 32) throw new Error(T("That doesn't look like an encryption key."));
  const v = await api.subVault();
  if (!v || v.ok === false || !v.data || !v.data.exists) throw new Error(T("Config encryption isn't set up yet."));
  const key = await _importAes(bytes, ["encrypt", "decrypt"]);
  if (v.data.sk_verify) {   // vaults created before sk_verify existed can't be checked — accept, subAutoHeal sorts it out
    let ok = false;
    try { ok = new TextDecoder().decode(await subDec(key, v.data.sk_verify)) === SUB_CHECK; } catch (_) {}
    if (!ok) throw new Error(T("That key doesn't match this panel's Encryption Vault."));
  }
  _subSK = key;
  try { sessionStorage.setItem(_SK_CACHE, b64(bytes)); if (subPersistOn()) localStorage.setItem(_SK_CACHE, b64(bytes)); } catch (_) {}
  try { subFlushPending(); } catch (_) {}
  try { subAutoHeal(); } catch (_) {}
  return _subSK;
}
// Does this string look like an encryption key (base64 of 32 bytes) rather than a password? Used by the prompts
// that accept either, so one field can take both without making the operator pick a mode.
export function looksLikeVaultKey(s) { return /^[A-Za-z0-9+/_-]{43}=?$/.test(String(s || "").trim()); }
// The cached encryption key, base64 — for showing it to the operator. Null when the vault is locked.
export function subKeyB64() { try { return subSKCached() ? sessionStorage.getItem(_SK_CACHE) : null; } catch (_) { return null; } }

export async function subEnableUser(uid) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Encryption Vault first."));
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));   // the URL path segment (opaque, 256-bit)
  const rec = (await subUsersMap(true))[uid];
  let unlockBytes, unlock_by_sk;
  if (rec && rec.unlock_by_sk) { unlockBytes = await subDec(sk, rec.unlock_by_sk); unlock_by_sk = rec.unlock_by_sk; }
  else { unlockBytes = crypto.getRandomValues(new Uint8Array(32)); unlock_by_sk = await subEnc(sk, unlockBytes); }
  const r = await api.subUserEnable({
    user_id: uid, token_sha: await sha256hex(token),
    unlock_by_sk,
    token_by_sk: await subEnc(sk, new TextEncoder().encode(token)),
  });
  if (!r || r.ok === false) throw new Error(srvText(r) || T("couldn't enable the subscription"));
  return { token, unlockKeyB64: b64url(unlockBytes) };
}

export function subAutoGenIfEnabled(userId) {
  if (!userId || !subFeatureOn() || !subSKCached()) return;
  if (!(((Store.panelSettings || {}).subscriptions || {}).auto_generate)) return;
  (async () => { try { await subEnableUser(userId); subUsersForget(); Store.configEpoch++; bus.emit(); } catch (_) {} })();
}

// Rotate a user's URL (kill the old link): fresh token, SAME unlock-key, so existing ciphertext stays valid.
export async function subRotateUser(uid) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Subscription Key first."));
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64url(tokenBytes);
  const r = await api.subUserRotate({
    user_id: uid, token_sha: await sha256hex(token),
    token_by_sk: await subEnc(sk, new TextEncoder().encode(token)),
  });
  if (!r || r.ok === false) throw new Error(srvText(r) || T("couldn't rotate the URL"));
  return { token };
}

// Recover ONLY the unlock-key (CryptoKey, encrypt+decrypt) from a user's escrow — works for a plain
// encrypted-config user (no subscription token) as well as a subscribed one. Used to encrypt/decrypt blobs.
export async function subRecoverUnlock(escRec) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Encryption Vault first."));
  if (!escRec || !escRec.unlock_by_sk) throw new Error(T("no encryption key for this user"));
  return _importAes(await subDec(sk, escRec.unlock_by_sk), ["encrypt", "decrypt"]);
}

// Recover a user's {token, unlockKey(CryptoKey), unlockKeyB64} from their escrow record via the SK.
export async function subRecover(escRec) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Subscription Key first."));
  if (!escRec || !escRec.unlock_by_sk || !escRec.token_by_sk) throw new Error(T("no subscription for this user"));
  const unlockBytes = await subDec(sk, escRec.unlock_by_sk);
  const token = new TextDecoder().decode(await subDec(sk, escRec.token_by_sk));
  // encrypt (publish a peer's secret) AND decrypt (Show-QR reads the peer's blob back) — same key material.
  return { token, unlockKey: await _importAes(unlockBytes, ["encrypt", "decrypt"]), unlockKeyB64: b64url(unlockBytes) };
}

export function normPublicUrl(s) {
  s = (s || "").trim().replace(/\/+$/, "");
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  // drop the scheme-default port so the field shows "host", not "host:443" — the listen port is its own field
  return s.replace(/^(https:\/\/[^/:]+):443\b/i, "$1").replace(/^(http:\/\/[^/:]+):80\b/i, "$1");
}
export const urlPortOf = s => { const m = /^(?:https?:\/\/)?(?:\[[^\]]+\]|[^/:]+):(\d+)/i.exec((s || "").trim()); return m ? m[1] : ""; };
export function withUrlPort(url, port) {
  let s = (url || "").trim();
  const p = parseInt(port, 10);
  s = s.replace(/^(https?:\/\/)?(\[[^\]]+\]|[^/:]+):\d+/i, "$1$2");   // drop any existing port
  if (!p || p === 443 || p === 80) return s;                          // scheme-default → keep the URL portless
  return s.replace(/^((?:https?:\/\/)?(?:\[[^\]]+\]|[^/:]+))/i, "$1:" + p);
}
export function nginxServerBlock(publicUrl, upstreamHost, upstreamPort) {
  let scheme = "https", domain = "", extPort = 0, path = "";
  try {
    const u = new URL(/^https?:\/\//i.test(publicUrl) ? publicUrl : "https://" + (publicUrl || ""));
    scheme = (u.protocol || "https:").replace(":", "");
    domain = u.hostname || "";
    extPort = u.port ? parseInt(u.port, 10) : 0;    // an explicit :port in the public URL = nginx's external listen port
    path = (u.pathname || "").replace(/\/+$/, "");
  } catch (_) {}
  const ssl = scheme === "https";
  const listenPort = extPort || (ssl ? 443 : 80);
  const loc = (path && path !== "/") ? path + "/" : "/";
  const up = (upstreamHost && upstreamHost.trim() && upstreamHost.trim() !== "0.0.0.0") ? upstreamHost.trim() : "127.0.0.1";
  const upPort = parseInt(upstreamPort, 10) || "";
  const dom = domain || "your.domain";
  const L = [];
  L.push("server {");
  L.push("    listen " + listenPort + (ssl ? " ssl" : "") + ";");   // i18n-keys: generated nginx — file text, copied verbatim
  L.push("    listen [::]:" + listenPort + (ssl ? " ssl" : "") + ";");   // i18n-keys: generated nginx — file text, copied verbatim
  L.push("    server_name " + dom + ";");   // i18n-keys: generated nginx — file text, copied verbatim
  if (ssl) {
    L.push("");
    L.push("    ssl_certificate     /etc/ssl/" + dom + "/fullchain.pem;   # your TLS cert covering " + dom);   // i18n-keys: generated nginx — file text, copied verbatim
    L.push("    ssl_certificate_key /etc/ssl/" + dom + "/privkey.pem;");   // i18n-keys: generated nginx — file text, copied verbatim
  }
  L.push("");
  L.push("    location " + loc + " {");   // i18n-keys: generated nginx — file text, copied verbatim
  L.push("        proxy_pass http://" + up + ":" + upPort + ";   # the panel's internal listen address");   // i18n-keys: generated nginx, not UI
  L.push("        proxy_set_header Host              $http_host;");   // $http_host keeps the PORT — $host strips it, and the address-change confirm compares Host against host:port
  L.push("        proxy_set_header X-Forwarded-For   $remote_addr;");
  L.push("        proxy_set_header X-Forwarded-Proto $scheme;");
  L.push("    }");
  L.push("}");
  return L.join("\n");
}
export function nixUpstream(host) {
  const h = String(host || "").trim();
  return (h && h !== "0.0.0.0" && h !== "::") ? h : "127.0.0.1";   // a wildcard bind is dialled on loopback
}
function _nixLoc(base) {
  const b = String(base || "").replace(/\/+$/, "");
  return (b && b !== "/") ? b + "/" : "/";
}
export function nixProxyBlock(kind, hosts) {
  const hs = (hosts || []).filter(h => h && h.domain);
  if (!hs.length) return "";
  const L = [];
  const sug = hs.filter(h => h.suggest);
  if (sug.length) {
    for (const h of sug) L.push('services.swg-panel.sub.domain = "' + h.domain + '";');   // i18n-keys: generated Nix — file text, copied verbatim
    L.push("");
  }
  if (kind === "caddy") {
    L.push("services.caddy = {");   // i18n-keys: generated Nix — file text, copied verbatim
    L.push("  enable = true;");
    for (const h of hs) {
      const loc = _nixLoc(h.base);
      L.push('  virtualHosts."' + h.domain + '".extraConfig = ' + "''");
      L.push("    reverse_proxy " + (loc === "/" ? "" : loc + "* ") + nixUpstream(h.host) + ":" + (parseInt(h.port, 10) || 8443));
      L.push("  " + "'';");
    }
    L.push("};");
  } else {
    L.push("services.nginx = {");   // i18n-keys: generated Nix — file text, copied verbatim
    L.push("  enable = true;");
    L.push("  recommendedProxySettings = true;");
    for (const h of hs) {
      L.push('  virtualHosts."' + h.domain + '" = {');
      L.push("    enableACME = true;");
      L.push("    forceSSL = true;");
      L.push('    locations."' + _nixLoc(h.base) + '".proxyPass = "http://' + nixUpstream(h.host) + ":" + (parseInt(h.port, 10) || 8443) + '";');
      L.push("  };");
    }
    L.push("};");
  }
  L.push("");
  L.push("security.acme.acceptTerms = true;");
  L.push('security.acme.defaults.email = "you@example.org";');
  L.push("networking.firewall.allowedTCPPorts = [ 80 443 ];");
  return L.join("\n");
}
export function nixDirectTlsBlock(domain, port, base) {
  const dom = String(domain || "").trim() || "panel.example.org";
  const prt = parseInt(port, 10) || 8443;
  const b = String(base || "").replace(/\/+$/, "");
  const L = [];
  L.push("services.swg-panel = {");   // i18n-keys: generated Nix — file text, copied verbatim
  L.push('  host = "0.0.0.0";');
  L.push("  port = " + prt + ";");
  L.push('  domain = "' + dom + '";');
  if (b && b !== "/") L.push('  basePath = "' + b + '";');
  L.push('  useACMEHost = "' + dom + '";');
  L.push("};");
  L.push("");
  L.push("security.acme.acceptTerms = true;");
  L.push('security.acme.certs."' + dom + '" = { email = "you@example.org"; };');
  L.push("networking.firewall.allowedTCPPorts = [ " + prt + " ];");
  return L.join("\n");
}

export function subBaseUrl() {
  const ps = Store.panelSettings || {};
  const sub = (ps.access || {}).sub || {};
  const tlsMode = ((ps.access || {}).tls || {}).mode || "";
  const behindProxy = tlsMode === "" || tlsMode === "skip";   // plain HTTP → a reverse proxy fronts swg-sub on the public port
  let raw = String(sub.url || (ps.subscriptions || {}).base_url || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const u = new URL(raw);
    const lp = parseInt(sub.port, 10);
    // append the sub's INTERNAL listen port only when it's reached DIRECTLY — behind a reverse proxy the public
    // URL already maps the public port (and may carry a subpath like /swgsub), so appending :8444 would break it.
    if (!behindProxy && !u.port && lp && !((u.protocol === "https:" && lp === 443) || (u.protocol === "http:" && lp === 80))) u.port = String(lp);
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch (_) { return raw.replace(/\/+$/, ""); }
}
export const SUB_LANG_LIST = [["en", "English"], ["ru", "Русский"]];   // languages the swgSub page ships (must match swg-panel-server SUB_LANGS)
export async function subUrlFor(escRec) {
  const base = subBaseUrl(); if (!base) return null;
  const { token, unlockKeyB64 } = await subRecover(escRec);
  return base + "/" + token + "#" + unlockKeyB64;
}

export async function subEncryptPeer(uid, pid, privkey, psk, unlockKey) {
  const sec = await subEnc(unlockKey, new TextEncoder().encode(JSON.stringify({ k: privkey, p: psk || "" })));
  const r = await api.subBlob({ user_id: uid, peer_id: pid, sec });
  if (!r || r.ok === false) throw new Error(srvText(r) || T("couldn't store the subscription config"));
}

// Is the subscriptions feature switched on for this panel?
export function subFeatureOn() { return !!(((Store.panelSettings || {}).subscriptions || {}).enabled); }
// The per-user subscription records (enabled + the SK-wrapped escrow), briefly cached.
let _subUsersCache = { at: 0, map: null };
export async function subUsersMap(force) {
  if (!force && _subUsersCache.map && Date.now() - _subUsersCache.at < 4000) return _subUsersCache.map;
  try { const r = await api.subUsers(); _subUsersCache = { at: Date.now(), map: (r && r.ok && r.data && r.data.users) || {} }; }
  catch (_) { _subUsersCache = { at: Date.now(), map: {} }; }
  return _subUsersCache.map;
}
export function subUsersForget() { _subUsersCache = { at: 0, map: null }; }
export async function ensureUserUnlockKey(uid) {
  const sk = subSKCached(); if (!sk || !uid) return null;
  const rec = (await subUsersMap(true))[uid];
  if (rec && rec.unlock_by_sk) { try { return await subRecoverUnlock(rec); } catch (_) { return null; } }
  const unlockKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const r = await api.subEscrow({ user_id: uid, unlock_by_sk: await subEnc(sk, unlockKeyBytes) });
  if (!r || r.ok === false || !r.data || !r.data.unlock_by_sk) return null;
  subUsersForget();
  try { return await subRecoverUnlock(r.data); } catch (_) { return null; }
}
export const SUB_ORPHAN = "_orphan";
export async function subMaybePublish(userId, peerId, privkey, psk) {
  try {
    if (Store.storeMode !== "encrypted" || !peerId || !subSKCached()) return;
    const uid = userId || SUB_ORPHAN;                      // unassigned → the orphan bucket
    const unlockKey = await ensureUserUnlockKey(uid);
    if (!unlockKey) {
      throw new Error(T("its encryption bucket was sealed with a previous encryption key"));
    }
    await subEncryptPeer(uid, peerId, privkey, psk, unlockKey);
  } catch (e) {
    if (peerId) {
      const msg = T("its config wasn't published to the subscription — {v1}", { v1: String((e && e.message) || e) });
      Store.rowErrors["peer:" + peerId] = { msg, at: Date.now() };
      Store.apply();
      return msg;   // and to a caller that waits for it (a phone's Rotate, review F83); the row's copy may be swept by now
    }
  }
}
const _pendingPublish = new Map();
export async function subFlushPending() {
  if (Store.storeMode !== "encrypted" || !subSKCached() || !(_pendingPublish.size || _pendingKeep.size)) return;
  let n = 0;
  for (const [peerId, p] of [..._pendingPublish]) {
    try { await subMaybePublish(p.userId, peerId, p.privkey, p.psk); _pendingPublish.delete(peerId); n++; } catch (_) {}
  }
  const tried = _pendingKeep.size;
  for (const a of [..._pendingKeep.values()]) if ((await exitKeepRouter(...a)) === true) n++;   // a dial-in router's key, the same way
  if (n || tried) bus.emit();      // a failed keep too: the open router sheet says why (s9c F60)
}
const _NOCONF_V = "2";
try {
  if (localStorage.getItem("swg-sub-noconf-v") !== _NOCONF_V) {
    localStorage.removeItem("swg-sub-noconf");
    localStorage.setItem("swg-sub-noconf-v", _NOCONF_V);
  }
} catch (_) { /* private mode */ }
const _subNoConf = new Map((() => { try { return Object.entries(JSON.parse(localStorage.getItem("swg-sub-noconf") || "{}")); } catch (_) { return []; } })());
function _saveSubNoConf() { try { localStorage.setItem("swg-sub-noconf", JSON.stringify(Object.fromEntries(_subNoConf))); } catch (_) {} }
export function subNoConfSet(pid, pubkey) { if (_subNoConf.get(pid) !== pubkey) { _subNoConf.set(pid, pubkey); _saveSubNoConf(); } }
export function subNoConfClear(pid) { if (_subNoConf.delete(pid)) _saveSubNoConf(); }
export function subNoConfHas(pid, pubkey) { return !!pubkey && _subNoConf.get(pid) === pubkey; }
let _vaultPromptPending = null;   // the in-flight unlock promise while the modal is open — coalesces concurrent asks
export function ensureVaultUnlocked(opts) {
  // nothing is stored encrypted → no key needed; `always`: something kept while it was on is still read with the key
  if (Store.storeMode !== "encrypted" && !(opts && opts.always)) return Promise.resolve(true);
  if (subSKCached()) return Promise.resolve(true);                     // already unlocked this session
  if (_vaultPromptPending) return _vaultPromptPending;                 // a modal is already up → share it (one prompt for a burst of actions)
  _vaultPromptPending = new Promise(function (resolve) {
    pushModal(html`<${VaultPromptSheet} opts=${opts || {}} onDone=${v => { _vaultPromptPending = null; resolve(v); }}/>`);
  });
  return _vaultPromptPending;
}
// subMaybePublish, but if the vault is locked it PROMPTS the operator (instead of silently skipping) so they can
// unlock + publish or knowingly skip. Use for user-triggered actions (create / rekey / reassign a peer).
export async function subPublishOrPrompt(userId, peerId, privkey, psk) {
  if (Store.storeMode !== "encrypted" || !peerId) return;   // userId may be null → published to the orphan bucket
  if (!subSKCached()) {
    const ok = await ensureVaultUnlocked({
      title: T("Unlock to publish this config"),
      reason: T("This peer's config is stored encrypted — only you can read it, with your encryption key. Unlock the key to publish this peer now, so its QR appears on the user's subscription page and stays re-viewable in the panel later."),
      consequence: T("the peer is created and works right away, but its config isn't published — its QR won't appear on the subscription page. You can still save it by unlocking the key in this browser tab before you reload; after a reload the key is gone from the browser (it was never on the server) and you'd have to rekey the peer to re-issue it."),
    });
    if (!ok) { _pendingPublish.set(peerId, { userId, privkey, psk }); return; }   // skipped → remember, so a later in-session unlock still saves it (incl. overwriting a stale rotate blob)
  }
  const err = await subMaybePublish(userId, peerId, privkey, psk);
  _pendingPublish.delete(peerId);   // published → no longer pending
  return err;
}
export async function subReconcileUser(userId) {
  if (Store.storeMode !== "encrypted" || !userId) return;
  let rec; try { rec = (await subUsersMap(true))[userId]; } catch (_) { return; }
  if (!rec || !rec.enabled) return;                              // not subscribed → no client QR to keep populated
  if ((rec.peers || 0) <= (rec.provisioned || 0)) return;        // already fully published → nothing to do
  if (!subSKCached()) {
    const ok = await ensureVaultUnlocked({
      title: T("Unlock to update this subscription"),
      reason: T("This user is subscribed, and this change left a peer whose config isn't published yet. Unlock your encryption key to publish it now, so the peer's QR appears on their subscription page."),
      consequence: T("the peer works right away, but it shows “Not ready yet” (an empty QR) on the user's subscription page. Unlock the key in this browser tab before you reload and it publishes automatically; after a reload you'd have to rekey the peer to re-issue it."),
    });
    if (!ok || !subSKCached()) return;                           // operator skipped
  }
  try { const k = await ensureUserUnlockKey(userId); if (k) { await subBackfillUser(userId, k); bus.emit(); } } catch (_) {}
}
// Peers whose encrypted blob we've already ensured this session (so viewing a multi-deployment peer's QRs
// doesn't re-encrypt the same blob repeatedly).
const _blobEnsured = new Set();
export async function ensurePeerBlob(peer, conf) {
  if (Store.storeMode !== "encrypted" || !subSKCached() || !peer || !peer.id || !conf) return;   // user_id optional (orphan bucket)
  if (_blobEnsured.has(peer.id)) return;
  _blobEnsured.add(peer.id);
  try {
    const g = await api.subBlobGet(peer.id);
    if (g && g.ok && g.data && g.data.sec) return;             // already published — nothing to do
    const parsed = parseFullConf(conf);
    if (parsed && parsed.privkey) await subMaybePublish(peer.user_id, peer.id, parsed.privkey, parsed.psk);
  } catch (_) { _blobEnsured.delete(peer.id); }                // let a later open retry
}

export async function subBackfillUser(uid, unlockKey) {
  const peers = Store.peersOfUser(uid);
  let published = 0, missing = 0; const missingPeers = [];
  for (const p of peers) {
    if (subNoConfHas(p.id, p.pubkey)) { missing++; missingPeers.push(p.id); continue; }   // known: no recoverable config for this key → don't re-probe (kills the 404 sweep on every heal pass / reload)
    let conf = anySessionConf(p.pubkey);                          // just-created config still in this session
    if (!conf && Store.configsPlaintext > 0) {
      for (const t of (p.targets || [])) {
        try { const r = await api.config(p.pubkey, t.node, t.iface); if (r && r.ok && r.data && r.data.config) { conf = r.data.config; break; } } catch (_) {}
      }
    }
    const parsed = conf ? parseFullConf(conf) : null;
    if (!parsed || !parsed.privkey) {
      // no readable plaintext config — but an encrypted blob may already cover it (idempotent resume), or it may
      // still sit in the ORPHAN bucket from when this peer was unassigned → re-key that into the user's bucket.
      try {
        const g = await api.subBlobGet(p.id);
        if (g && g.ok && g.data && g.data.sec) {
          if (g.data.user_id === uid) { subNoConfClear(p.id); published++; continue; }     // already in this user's bucket
          const srcRec = (await subUsersMap())[g.data.user_id];           // the bucket it's in now (e.g. orphan)
          if (srcRec && srcRec.unlock_by_sk) {
            const srcKey = await subRecoverUnlock(srcRec);
            const secret = JSON.parse(new TextDecoder().decode(await subDec(srcKey, g.data.sec)));
            if (secret && secret.k) { await subEncryptPeer(uid, p.id, secret.k, secret.p, unlockKey); subNoConfClear(p.id); published++; continue; }
          }
        }
      } catch (_) {}
      subNoConfSet(p.id, p.pubkey);                                 // remember: no recoverable config for this key → skip next time
      missing++; missingPeers.push(p.id); continue;                 // no key available → can't encrypt / flag for rekey
    }
    try {
      await subEncryptPeer(uid, p.id, parsed.privkey, parsed.psk, unlockKey);
      await captureOverridesFrom(p, parsed);                       // move the config's non-secret DNS/MTU/AllowedIPs into the roster
      subNoConfClear(p.id); published++;
    } catch (_) { missing++; missingPeers.push(p.id); }
  }
  return { published, missing, total: peers.length, missingPeers };
}

let _autoHealRunning = false;
const _healTried = {};   // uid → the exact blob deficit we last attempted with the key available. Peers whose key
let _ikRunning = false;
const _ikTried = {};
const _evTried = {};
let _evRunning = false;
export async function escrowAutoVerify() {
  if (_evRunning || !subSKCached()) return;        // vault locked → nothing to prove it with
  _evRunning = true;
  try {
    let priv = null;
    for (const n of (Store.nodes || [])) {
      const ifs = (Store.describe || {})[n.id] || {};
      const targets = [
        ...Object.entries(ifs).map(([ifn, m]) => [ifn, "iface", m && m.escrow_unverified]),
        ...Object.entries(n.wdtt_escrow_unverified || {}).map(([ifn, b]) => [ifn, "wdtt", b]),
      ];
      for (const [ifn, family, blob] of targets) {
        if (!blob || !blob.ct) continue;
        const k = n.id + "|" + family + "|" + ifn;
        if (_evTried[k]) continue;                 // one attempt per (node, instance) per session
        _evTried[k] = 1;
        try {
          if (!priv) priv = await ivkVaultPriv();
          const opened = await ivkUnseal(priv, blob);
          if (opened) await api.escrowVerified({ node: n.id, iface: ifn, family });
        } catch (_) {
        }
      }
    }
  } finally { _evRunning = false; }
}

export async function ifaceKeyAutoRestore() {
  if (_ikRunning || !subSKCached()) return;      // vault locked → the card's button is the door
  _ikRunning = true;
  try {
    for (const n of (Store.nodes || [])) {
      for (const ifn of (n.awaiting_key || [])) {
        const k = n.id + "|" + ifn;
        if (_ikTried[k]) continue;               // one attempt per (node, iface) per session
        _ikTried[k] = 1;
        const mi = (n.missing_ifaces || {})[ifn];
        if (!mi || mi.key_source !== "vault" || !mi.key_blob) continue;
        try {
          const sealed = await ivkResealForNode(n.id, mi);
          if (sealed) await api.ifaceRecreate({ node: n.id, iface: ifn, sealed_key: sealed });
        } catch (_) { delete _ikTried[k]; }      // transport key not reported yet, say → let a later poll retry
      }
      for (const w of ((Store.stats[n.id] || {}).wdtt || [])) {
        if (!w || !w.await_restore || !w.iface) continue;
        const k = n.id + "|wdtt|" + w.iface;
        if (_ikTried[k]) continue;
        _ikTried[k] = 1;
        const kb = (n.wdtt_vault || {})[w.iface];
        if (!kb || !kb.ct) continue;             // nothing escrowed → the operator must recreate it fresh
        try {
          const sealed = await wdttResealForNode(n.id, kb);
          if (sealed) await api.wdttRestore({ node: n.id, iface: w.iface, sealed_identity: sealed });
        } catch (_) { delete _ikTried[k]; }
      }
    }
  } finally { _ikRunning = false; }
}

export async function subAutoHeal() {
  if (Store.storeMode !== "encrypted" || !subSKCached() || _autoHealRunning) return;
  _autoHealRunning = true;
  try {
    let st; try { st = await api.subUsers(); } catch (_) { return; }
    const users = (st && st.data && st.data.users) || {};
    let healed = 0;
    for (const uid of Object.keys(users)) {
      const u = users[uid] || {};
      if (!u.enabled) { delete _healTried[uid]; continue; }        // only a live subscription renders "Not ready yet"
      const deficit = (u.peers || 0) - (u.provisioned || 0);
      if (deficit <= 0) { delete _healTried[uid]; continue; }       // every live peer already has a blob → nothing to do
      if (_healTried[uid] === deficit) continue;                    // this exact gap was already attempted → don't re-probe
      _healTried[uid] = deficit;
      try {
        const k = await ensureUserUnlockKey(uid);
        if (k) { const r = await subBackfillUser(uid, k); healed += (r.published || 0); if (r.published) delete _healTried[uid]; }
        else delete _healTried[uid];                                // couldn't get the key → let a later pass retry
      } catch (_) { delete _healTried[uid]; }
    }
    if (healed) bus.emit();   // refresh any open sub / QR views now that blobs exist
  } finally { _autoHealRunning = false; }
}

// Migrating a plaintext config → blob keeps ONLY {k,p}; its non-secret DNS/MTU/AllowedIPs/keepalive would be
// lost, so capture them into the roster (once — never clobber an existing override). Sparse vs the interface default.
export async function captureOverridesFrom(peer, parsed) {
  if (peer.overrides && Object.keys(peer.overrides).length) return;   // already has roster overrides
  const t0 = (peer.targets || [])[0]; if (!t0) return;
  const ov = configOverrides({ dns: (parsed.dns || []).join(", "), mtu: parsed.mtu, allowed: parsed.allowed, keepalive: parsed.keepalive },
                             Store.ifaceMeta(t0.node, t0.iface));
  if (Object.keys(ov).length) { try { await api.peerUpdate({ peer_id: peer.id, overrides: ov }); } catch (_) {} }
}

export async function runConfigMigration() {
  if (!subSKCached()) throw new Error(T("Unlock the Encryption Vault first."));
  let list = [];
  try { const pp = await api.plaintextPeers(); list = (pp && pp.data && pp.data.peers) || []; } catch (_) {}
  let migrated = 0; const flagged = [];
  // group the assigned plaintext-holders by user (one unlock-key each); unassigned can't be encrypted → flag.
  const byUser = {};
  for (const it of list) {
    const p = (Store.recon.peers || []).find(x => x.id === it.peer_id);
    if (!p) continue;
    if (!p.user_id) { flagged.push(p.id); continue; }
    (byUser[p.user_id] = byUser[p.user_id] || []).push(p);
  }
  for (const uid of Object.keys(byUser)) {
    const unlockKey = await ensureUserUnlockKey(uid);
    if (!unlockKey) { byUser[uid].forEach(p => flagged.push(p.id)); continue; }
    for (const p of byUser[uid]) {
      let conf = anySessionConf(p.pubkey);
      if (!conf) for (const t of (p.targets || [])) {
        try { const r = await api.config(p.pubkey, t.node, t.iface); if (r && r.ok && r.data && r.data.config) { conf = r.data.config; break; } } catch (_) {}
      }
      const parsed = conf ? parseFullConf(conf) : null;
      if (!parsed || !parsed.privkey) { flagged.push(p.id); continue; }
      try { await subEncryptPeer(uid, p.id, parsed.privkey, parsed.psk, unlockKey); await captureOverridesFrom(p, parsed); migrated++; }
      catch (_) { flagged.push(p.id); }
    }
  }
  const pr = await api.purgePlaintext({ purge_orphans: true });    // blob-gated purge + orphan cleanup (dead keys)
  await Store.poll();                                              // refresh the plaintext count
  return { migrated, total: list.length, flagged: [...new Set(flagged)],
           purged: (pr && pr.data && pr.data.purged) || 0, orphansPurged: (pr && pr.data && pr.data.orphans_purged) || 0,
           remaining: (pr && pr.data && pr.data.remaining) || 0 };
}

export const AWG_ORDER = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",   // i18n-keys: AmneziaWG parameter names, as the protocol spells them
  "HeaderProtectionKey", "RandomTrailers", "ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout", "MaxHandshakeAttempts", "DisableCookies"];   // i18n-keys: AmneziaWG 3.x (docs/AWG3-PLAN.md §7.1); twins in the panel, node, agent, sub.js, turn-artifacts.js
export function guardAllowed(a) {
  const parts = ((a || "").trim() || "0.0.0.0/0, ::/0").split(",").map(s => s.trim()).filter(Boolean);
  if (parts.includes("0.0.0.0/0") && !parts.some(p => p.includes(":"))) parts.push("::/0");
  return parts.join(", ");
}
const AWG3_FROM = AWG_ORDER.indexOf("HeaderProtectionKey");
export function awgConfLines(awg) {
  awg = awg || {};
  const g31 = awg.HeaderProtectionKey != null && String(awg.HeaderProtectionKey).trim() !== "";
  const L = [];
  AWG_ORDER.forEach((k, i) => {
    if (awg[k] == null || (i >= AWG3_FROM && (!g31 || k === "DisableCookies"))) return;
    if (k === "RandomTrailers") { if (!/^\s*(0|off)\s*$/i.test(String(awg[k]))) L.push(k + " = 1"); return; }   // 0/off = unset, as on the node
    L.push(k + " = " + awg[k]);
  });
  return L;
}
// The client keepalive: on a 3.1 interface the integer the panel resolves is rendered `k-(k+10)` — Amnezia's own 3.1 default
// shape, 25 → 25-35 (D-scope) — derived here rather than stored, so every integer-only reader stays as it is. 0 stays off.
export function clientKeepalive(ka, awg) {
  const k = ka != null && ka !== "" ? ka : 25;
  const g31 = !!(awg && awg.HeaderProtectionKey != null && String(awg.HeaderProtectionKey).trim() !== "");
  return g31 && /^\s*\d+\s*$/.test(String(k)) && +k > 0 ? (+k) + "-" + (+k + 10) : k;
}
/* Builds a WireGuard .conf. Every line here is FILE TEXT the client parses — not one byte of it is UI,
   so nothing in this function is translated.   // i18n-keys */
export function buildConf(o) {
  const L = ["[Interface]", "PrivateKey = " + o.privkey, "Address = " + o.address];   // i18n-keys: generated WireGuard .conf — file text
  if (o.dns && o.dns.length) L.push("DNS = " + o.dns.join(", "));   // i18n-keys: generated WireGuard .conf — file text
  L.push("MTU = " + (o.mtu || 1280));   // i18n-keys: generated WireGuard .conf — file text
  L.push(...awgConfLines(o.awg_params));
  L.push("", "[Peer]", "PublicKey = " + o.server_pubkey);   // i18n-keys: generated WireGuard .conf — file text
  if (o.psk) L.push("PresharedKey = " + o.psk);   // i18n-keys: generated WireGuard .conf — file text
  L.push("AllowedIPs = " + guardAllowed(o.allowed), "Endpoint = " + o.endpoint,   // i18n-keys: generated WireGuard .conf — file text
    "PersistentKeepalive = " + clientKeepalive(o.keepalive, o.awg_params));   // i18n-keys: generated WireGuard .conf — file text
  return L.join("\n") + "\n";
}
// Full parse of a client config back into buildConf()'s shape — so an edit/copy can
// rebuild the config from the existing one (the only place the private key lives).
export function parseFullConf(text) {
  const m = re => (text.match(re) || [])[1];
  const dnsLine = m(/DNS\s*=\s*(.+)/);
  const awg = {};
  for (const k of AWG_ORDER) { const v = m(new RegExp("^" + k + "[ \\t]*=[ \\t]*(.*\\S)", "m")); if (v != null) awg[k] = v; }
  return {
    privkey: m(/PrivateKey\s*=\s*(\S+)/) || "",
    address: m(/Address\s*=\s*(.+)/) || "",
    dns: dnsLine ? dnsLine.split(",").map(s => s.trim()).filter(Boolean) : [],
    mtu: m(/MTU\s*=\s*(\d+)/) || 1280,
    awg_params: awg,
    server_pubkey: m(/PublicKey\s*=\s*(\S+)/) || "",
    psk: m(/PresharedKey\s*=\s*(\S+)/) || "",
    allowed: m(/AllowedIPs\s*=\s*(.+)/) || "0.0.0.0/0, ::/0",
    endpoint: m(/Endpoint\s*=\s*(\S+)/) || "",
    keepalive: m(/PersistentKeepalive\s*=\s*(\d+)/) || 25,
  };
}
// Same config, Endpoint swapped to the turn-proxy's public listen address (import via turn-proxy).

export function configOverrides(opts, meta) {
  const ov = {}; meta = meta || {};
  const dnsArr = String(opts.dns || "").split(",").map(s => s.trim()).filter(Boolean);
  const defDns = (meta.dns || []).map(String);
  if (JSON.stringify(dnsArr) !== JSON.stringify(defDns)) ov.dns = dnsArr;
  const mtu = String(opts.mtu || "").trim();
  if (mtu && mtu !== String(meta.mtu || 1280)) ov.mtu = +mtu;
  const allowed = String(opts.allowed || "").trim();
  if (allowed && guardAllowed(allowed) !== "0.0.0.0/0, ::/0") ov.allowed = allowed;
  const ka = String(opts.keepalive || "").trim();
  const defKa = String(meta.keepalive != null ? meta.keepalive : 25);
  if (ka !== "" && ka !== defKa) ov.keepalive = +ka;   // differs from the INTERFACE's, not from a fixed 25
  return ov;
}

export function downloadConf(text, base, ext) {
  // octet-stream (not text/plain) so the browser keeps the chosen name instead of appending .txt
  ext = String(ext || "conf").replace(/^\./, "");
  const blob = new Blob([text], { type: "application/octet-stream" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = base.replace(/[^\w.-]+/g, "_").replace(/\.(conf|txt)$/i, "") + "." + ext; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function _b64ToBytes(b64) { try { const s = atob(String(b64 || "").trim()); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; } catch (_) { return new Uint8Array(0); } }

// Client-import artifact for a peer behind a turn-proxy — the per-fork wire formats live in the shared
// turn-artifacts.js (window.SWGTurn), loaded by both the admin app and the subscription page.
export function turnArtifact(baseConf, tp, vkLink, vkLinks, asClient, os) {
  const fork = turnFork(tp.service);
  if (SWGTurn.setForkLabel) SWGTurn.setForkLabel(forkLabel);   // {fork} in a server name is the catalog's name (q189 HE-8)
  if (SWGTurn.setCliAuthors) SWGTurn.setCliAuthors(f => ((((Store.turnCatalog || {}).servers) || []).find(x => x.id === f) || {}).cli_authors);   // the served CLI builds
  const native = (typeof SWGTurn.nativeEncoder === "function") ? SWGTurn.nativeEncoder(fork) : null;
  const cs = turnClientSettingsFor(fork, asClient || native, os);
  return SWGTurn.artifact(baseConf, tp, vkLink, cs, vkLinks, asClient);
}
export function turnClientsFor(fork) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const f = turnForkList().find(x => x.id === fork) || {};
  const compat = f.compat || {};
  const hasCompat = Object.keys(compat).length > 0;
  const ids = hasCompat ? Object.keys(compat) : (f.clients || []);
  const native = (typeof SWGTurn.nativeEncoder === "function") ? SWGTurn.nativeEncoder(fork) : null;
  const PL = { android: "Android", ios: "iOS", windows: "Windows", linux: "Linux", macos: "macOS" };
  const isCli = id => id === "sidecar" || (cmap[id] || {}).encoder === "sidecar";
  const rank = id => { const cl = compat[id], cli = isCli(id);   // mirrors sub.js's rank(): apps before sidecars in each band, plain last
    return cl === "native" ? (cli ? 3 : 1)
      : (cl === "friendly" || cl === "friendly_core") ? (cli ? 4 : 2)
      : cl === "plain" ? (cli ? 6 : 5) : 9; };
  const out = ids.map(id => {
    const c = cmap[id] || {}; const plat = Object.keys(c.platforms || {})[0];
    return { id, encoder: c.encoder || id, name: c.name || id, cls: compat[id] || "",
             plat: plat ? (PL[plat] || plat) : "", cross: (c.encoder || id) !== native };
  });
  // legacy catalog has no bands to rank by → keep the old "own app first" ordering
  return hasCompat ? out.sort((a, b) => rank(a.id) - rank(b.id))
                   : out.sort((a, b) => (a.cross ? 1 : 0) - (b.cross ? 1 : 0));
}
function _clientIdForEncoder(encoder) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  for (const cid in cmap) if ((cmap[cid].encoder || cid) === encoder) return cid;
  return encoder;
}
export function turnClientSettingsFor(fork, encoder, os) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const cid = _clientIdForEncoder(encoder);
  const c = cmap[cid] || {};
  const srv = ((Store.turnCatalog || {}).servers || []).find(s => s.id === fork);   // the mysorez app's knobs depend on the fork's core → prefer the per-(fork,client) schema
  const schema = (srv && srv.client_schemas && srv.client_schemas[cid]) || c.settings || [];
  const useOs = os || Object.keys(c.platforms || {})[0] || "";
  const saved = (((((Store.panelSettings && Store.panelSettings.turn_client_settings) || {})[fork]) || {})[cid] || {})[useOs] || {};
  const out = {};
  for (const d of schema) { const v = saved[d.key]; out[d.key] = (v === undefined || v === null) ? d.default : v; }
  return out;
}

// ───────────────────────── QR ─────────────────────────
export function qrDataURL(text, targetPx) {
  const q = qrcode(0, "L");
  q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 4, total = n + quiet * 2;
  const cell = Math.max(3, Math.floor((targetPx || 360) / total));
  const size = total * cell;
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++)
      if (q.isDark(r, col)) ctx.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c.toDataURL("image/png");
}
/* "set one up in <a>Settings → …</a>" — the placeholder is a LINK, so the sentence cannot be one text node.
   Translated whole and split on its own marker, so each language keeps its word order around the link. */
function vaultMissing(onNav) {
  const [before, after] = Tsplit("No Encryption Vault is set up yet — set one up in {where}, then try again.", "where");
  return html`<${Fragment}>${before}<a href="#/panel/settings" onClick=${onNav}>${T("Settings → Client configs → Encryption")}</a>${after}<//>`;
}

export function QR({ conf, label, px }) {
  const src = useMemo(() => { try { return qrDataURL(conf, px || 360); } catch (_) { return null; } }, [conf, px]);
  if (!src) return html`<div class="qr-fail">${T("config too large")}<br>${T("to encode as QR")}</div>`;
  return html`<div class="qr" title=${T("Tap to enlarge for scanning")} onClick=${() => qrZoom(conf, label)}>
    <img class="qrimg" alt=${T("config QR")} src=${src}/></div>`;
}
export let qrZoomEl = null;   // the open QR enlargement, if any — Esc collapses it (instead of closing the modal)
export function qrZoom(conf, label) {
  if (qrZoomEl) { try { qrZoomEl.remove(); } catch (_) {} qrZoomEl = null; }
  let img;
  try { img = `<img class="qrimg" alt="${esc(T("config QR"))}" src="${qrDataURL(conf, 920)}">`; }
  catch (e) { img = `<div class="qr-fail">${esc(T("config too large to encode"))}</div>`; }
  const ov = document.createElement("div");
  ov.className = "qr-overlay";
  ov.innerHTML = `<div class="qr-overlay-inner"><div class="qr-overlay-card">${img}</div>` +
    `<div class="qr-overlay-cap">${label || esc(T("Scan in WireGuard / AmneziaWG"))}</div></div>`;
  const onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  function close() { try { ov.remove(); } catch (_) {} if (qrZoomEl === ov) qrZoomEl = null; document.removeEventListener("keydown", onKey, true); }
  ov.onclick = close;
  document.addEventListener("keydown", onKey, true);
  qrZoomEl = ov;
  document.body.appendChild(ov);
}
export function dataUrlToBlob(url) {
  const comma = url.indexOf(","), meta = url.slice(0, comma), b64 = url.slice(comma + 1);
  const mime = (meta.match(/:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
// Copy the QR *image* (a PNG) to the clipboard — used when the QR is what's on screen, so Copy acts on
// what you see rather than the hidden config text. Mirrors sub.js copyImage.
export function copyQrImage(text, what) {
  let url; try { url = qrDataURL(text, 640); } catch (_) { toast(T("QR too large to copy as an image."), "err", 2200); return; }
  if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) { toast(T("This browser can't copy an image."), "err", 2200); return; }
  try {
    const blob = dataUrlToBlob(url), item = {}; item[blob.type] = blob;
    navigator.clipboard.write([new ClipboardItem(item)]).then(() => toast(T("{what} copied.", { what: what || "QR" }), "ok", 1500), () => toast(T("Copy failed."), "err", 2200));
  } catch (_) { toast(T("Copy failed."), "err", 2200); }
}

export function rerenderConf(text, node, iface) {
  if (!text) return text;
  const meta = Store.ifaceMeta(node, iface);
  if (!meta) return text;
  // surgical in-place updates: swap the Endpoint line and refresh any existing AmneziaWG param
  // lines to the interface's current values — never rebuild the rest, so it can't be malformed.
  let out = text;
  if (meta.endpoint) out = out.replace(/^([ \t]*Endpoint[ \t]*=).*$/m, (m, p1) => p1 + " " + meta.endpoint);
  const awg = meta.awg_params || {};
  const lineRe = k => new RegExp("^([ \\t]*" + k + "[ \\t]*=).*$", "m");
  if (!Object.keys(awg).length) return out;   // no AWG dict to render from (a report without one): leave the block as it is
  // …and a 2.0 line the config has while the interface no longer does (a field set to none, docs/AWG-OMIT-AND-MESH-GEN-PLAN.md
  // A6) takes the same whole-block rebuild below: refreshing only the lines the meta has kept the removed one for ever.
  if (!AWG_ORDER.slice(AWG3_FROM).some(k => awg[k] != null || lineRe(k).test(out))
      && !AWG_ORDER.slice(0, AWG3_FROM).some(k => awg[k] == null && lineRe(k).test(out))) {
    for (const k of AWG_ORDER) {
      if (awg[k] == null) continue;
      const re = lineRe(k);
      if (re.test(out)) out = out.replace(re, (m, p1) => p1 + " " + awg[k]);
    }
    return out;
  }
  const L = out.split("\n");
  let end = L.findIndex(l => /^[ \t]*\[Peer\]/i.test(l));
  if (end < 0) end = L.length;
  const keep = [];
  let at = -1, mtuAt = -1;
  L.forEach((l, i) => {
    const m = i < end && l.match(/^[ \t]*([A-Za-z0-9]+)[ \t]*=/);
    if (m && AWG_ORDER.includes(m[1])) { if (at < 0) at = keep.length; return; }
    if (m && m[1] === "MTU") mtuAt = keep.length + 1;
    keep.push(l);
  });
  if (at < 0) at = mtuAt >= 0 ? mtuAt : keep.findIndex(l => /^[ \t]*\[Peer\]/i.test(l)) - 1;
  keep.splice(Math.max(at, 1), 0, ...awgConfLines(awg));
  return keep.join("\n").replace(/^([ \t]*PersistentKeepalive[ \t]*=[ \t]*)(\d+)(?:[ \t]*-[ \t]*\d+)?[ \t]*$/m,
    (m, p1, k) => p1 + clientKeepalive(k, awg));
}
export function effectiveClientParams(peer, target, meta) {
  const pov = (peer && peer.overrides) || {}, tov = (target && target.overrides) || {};
  const ov = { ...pov, ...tov };                       // the deployment's own setting wins, field by field
  meta = meta || {};
  // no per-peer/per-deployment keepalive -> the interface's, else 25
  const ka = (typeof ov.keepalive === "number") ? ov.keepalive
           : ((typeof meta.keepalive === "number") ? meta.keepalive : 25);
  return {
    // dns=[] is meaningful — an explicit "no DNS line" — so the test is "is there a list", not "is it truthy"
    dns: Array.isArray(ov.dns) ? ov.dns.slice() : ((meta.dns || []).slice()),
    mtu: ov.mtu || meta.mtu || 1280,
    allowed: ov.allowed || "0.0.0.0/0, ::/0",
    keepalive: ka,
  };
}

// "We could not ask" — distinct from "we asked and there is none". Returned by blobConfig and consumed by
// getConfig, which must not record a miss (nor persist a no-config marker) for a peer it never reached.
export const CONF_UNREACHABLE = Symbol("conf-unreachable");
export const CONF_SEALED_OLD = Symbol("conf-sealed-old");
const _confUnreach = new Map();
const _confSealed = new Map();   // pubkey|node|iface → seen-at; blob present but sealed under a replaced key   // "pubkey|node|iface" -> when the last lookup could not reach the panel
export function confWasUnreachable(pubkey, node, iface) { return _confUnreach.has(pubkey + "|" + node + "|" + iface); }
export function confWasSealedOld(pubkey, node, iface) { return _confSealed.has(pubkey + "|" + node + "|" + iface); }

export async function blobConfig(peer, node, iface) {
  if (!peer || !subSKCached()) return null;                // user_id optional — unassigned peers use the orphan bucket
  const t = (peer.targets || []).find(x => x.node === node && x.iface === iface);
  const meta = Store.ifaceMeta(node, iface);
  if (!t || !meta) return null;
  let sec, unlockKey;
  try {
    const r = await api.subBlobGet(peer.id);
    if (!r || r.ok === false) return CONF_UNREACHABLE;
    if (!r.data || !r.data.sec) return null;
    sec = r.data.sec;
    const buid = r.data.user_id || peer.user_id || SUB_ORPHAN;   // decrypt with the key of the bucket the blob is IN
    const rec = (await subUsersMap())[buid];
    if (!rec || !rec.unlock_by_sk) return null;
    try {
      unlockKey = await subRecoverUnlock(rec);   // unlock-key only (works whether or not the user is subscribed)
    } catch (_) {
      return CONF_SEALED_OLD;
    }
  } catch (_) { return CONF_UNREACHABLE; }     // fetch threw → we did not learn anything about this peer
  try {
    let secret;
    // GCM refuses a blob sealed under a key this bucket's unlock-key is not (one moved in from another bucket): the same
    // answer as an unwrap that fails above — not "no stored config", which recommends re-issuing as if nothing were there
    try { secret = JSON.parse(new TextDecoder().decode(await subDec(unlockKey, sec))); } catch (_) { return CONF_SEALED_OLD; }
    if (!secret || !secret.k) return null;
    const eff = effectiveClientParams(peer, t, meta);
    return buildConf({ privkey: secret.k, address: (t.ip || "").split("/")[0] + "/32",
      dns: eff.dns, mtu: eff.mtu, awg_params: meta.awg_params, server_pubkey: meta.public_key,
      psk: secret.p || peer.psk, endpoint: meta.endpoint, allowed: eff.allowed, keepalive: eff.keepalive });
  } catch (_) { return null; }
}

export const exitBucket = nid => "_x_" + nid;
// Keeps skipped while the vault was locked — "node|exit" → exitKeepRouter's arguments. The router's private key lives only
// in this tab, so, as a peer's in _pendingPublish, unlocking later in the same session still keeps it (subFlushPending).
const _pendingKeep = new Map();
// "node|exit" → why the last try to keep a queued one failed (a flush after an unlock), so the open sheet can say it (s9c F60)
const _keepFail = new Map();
// What exitKeepRouter answers while the vault is locked: a sentinel, not a sentence — a sentence compared against T() stops
// matching after a language switch (s9d F10)
export const EXIT_KEEP_LOCKED = Symbol("exit-keep-locked");
export function exitKeepState(nid, exitId) {
  const pk = nid + "|" + exitId;
  return _keepFail.get(pk) || (_pendingKeep.has(pk) ? "queued" : null);
}
// → true (kept), false (the store is off), EXIT_KEEP_LOCKED, or a sentence saying why it was not kept. Never throws.
export async function exitKeepRouter(nid, exitId, routerPub, routerPriv, nodePub, nodePriv) {
  if (Store.storeMode !== "encrypted") return false;
  const pk = nid + "|" + exitId;
  try {
    if (!subSKCached()) { _pendingKeep.set(pk, [nid, exitId, routerPub, routerPriv, nodePub, nodePriv]); _keepFail.delete(pk); return EXIT_KEEP_LOCKED; }
    const uid = exitBucket(nid), unlockKey = await ensureUserUnlockKey(uid);
    // null is either a key this vault cannot open or a refused mint — the map ensureUserUnlockKey just read says which
    if (!unlockKey) {
      const sealed = !!((await subUsersMap())[uid] || {}).unlock_by_sk;
      const why = sealed ? T("its encryption bucket was sealed with a previous encryption key") : T("couldn't store the router config");
      // a queued keep says why it failed, as the request's own failures do — and a sealed bucket opens on no later unlock
      // either, so it is not re-tried on each one (backlog C review F1)
      if (_pendingKeep.has(pk)) { _keepFail.set(pk, why); if (sealed) _pendingKeep.delete(pk); }
      return why;
    }
    const sec = await subEnc(unlockKey, new TextEncoder().encode(JSON.stringify({ k: routerPriv, n: nodePub })));
    // the node key sealed inside, named by the digest the panel stamps from the record — a re-paste in between is refused
    const nkh = (await sha256hex(nodePriv)).slice(0, 16);
    const r = await api.subExitBlob({ node: nid, exit: exitId, pub: routerPub, nkh, sec });
    if (r && r.ok !== false) { _pendingKeep.delete(pk); _keepFail.delete(pk); return true; }   // only now: a failed keep stays queued
    const why = srvText(r) || T("couldn't store the router config");
    // …unless the panel refused it for good — the exit is gone, its keys changed since, the request is malformed: re-posting
    // that on every unlock would fail the same way for ever (s9c F57)
    if (_pendingKeep.has(pk)) _keepFail.set(pk, why);
    if (r && ["stale", "not_found", "bad_request"].includes(r.code)) _pendingKeep.delete(pk);   // its reason stays for the sheet
    return why;
  } catch (e) { const why = String((e && e.message) || e); if (_pendingKeep.has(pk)) _keepFail.set(pk, why); return why; }
}
// A kept key the vault is locked for: the caller asks to unlock (whatever the store's mode now) and reads again.
export const EXIT_LOCKED = Symbol("exit-locked");
// → {k, n, pub}; null when none is kept; EXIT_LOCKED; CONF_UNREACHABLE / CONF_SEALED_OLD as blobConfig says them. One request:
// the bucket's wrapped unlock-key comes with the ciphertext, so a blip in a second read cannot turn into "nothing kept".
export async function exitRouterKey(nid, exitId) {
  let r, unlockKey;
  try {
    r = await api.subExitBlobGet(nid, exitId);
    if (r && r.code === "not_found") return null;                 // no longer a dial-in exit here: nothing to show
    if (!r || r.ok === false || !r.data) return CONF_UNREACHABLE;
    if (!r.data.sec) return null;
    if (!subSKCached()) return EXIT_LOCKED;
    if (!r.data.unlock_by_sk) return CONF_SEALED_OLD;             // a key with no bucket key: nothing here opens it
    try { unlockKey = await subRecoverUnlock(r.data); } catch (_) { return CONF_SEALED_OLD; }
  } catch (_) { return CONF_UNREACHABLE; }
  try {
    const s = JSON.parse(new TextDecoder().decode(await subDec(unlockKey, r.data.sec)));
    return s && s.k && s.n ? { k: s.k, n: s.n, pub: r.data.pub || "" } : null;
  } catch (_) { return CONF_SEALED_OLD; }                         // GCM refused it: sealed under a key this vault does not hold
}

const _configMiss = new Map();   // "pubkey|node|iface" -> { epoch, at }
const _CONFIG_MISS_TTL = 30000;
function _configMissFresh(mk) {
  const m = _configMiss.get(mk);
  return !!(m && m.epoch === Store.configEpoch && (Date.now() - m.at) < _CONFIG_MISS_TTL);
}
export function getConfig(pubkey, node, iface) {
  const s = Store.sessionConfigs[pubkey];
  if (s && s[tkey(node, iface)]) return Promise.resolve(rerenderConf(s[tkey(node, iface)], node, iface));
  const peer = (Store.recon.peers || []).find(p => p.pubkey === pubkey);
  if (peer && subNoConfHas(peer.id, pubkey)) return Promise.resolve(null);
  const mk = pubkey + "|" + node + "|" + iface;
  if (_configMissFresh(mk)) return Promise.resolve(null);   // known-empty this epoch → don't re-hammer the server
  const definitive = Store.storeMode !== "encrypted" || subSKCached();   // a miss now means "no config", not "vault locked"
  const miss = () => { _configMiss.set(mk, { epoch: Store.configEpoch, at: Date.now() }); if (peer && definitive) subNoConfSet(peer.id, pubkey); };
  const hit = () => { _configMiss.delete(mk); if (peer) subNoConfClear(peer.id); };
  // encrypted-at-rest blob first (assigned peer + vault unlocked); else the transitional plaintext store.
  return blobConfig(peer, node, iface).then(c => {
    if (c === CONF_UNREACHABLE) { _confUnreach.set(mk, Date.now()); return null; }   // learned nothing — do NOT miss()
    if (c === CONF_SEALED_OLD) {                // permanent: the key is gone, not the panel —
      _confSealed.set(mk, Date.now());
      // …but a panel still migrating may hold this peer's config in plaintext too, and that one still opens (backlog C review F2)
      if (!(Store.configsPlaintext > 0)) return null;
      // no copy either: asked once this epoch, not on every render (verify F8) — the in-memory miss only, never the persisted
      // "no config" mark: after a reload the peer must still read sealed, not "No stored config — re-issue"
      const sealedMiss = () => { _configMiss.set(mk, { epoch: Store.configEpoch, at: Date.now() }); return null; };
      return api.config(pubkey, node, iface).then(r => {
        const conf = rerenderConf(r.ok ? r.data.config : null, node, iface);
        if (!conf) return sealedMiss();
        _confSealed.delete(mk); hit();
        return conf;
      }).catch(sealedMiss);
    }
    _confUnreach.delete(mk);
    if (c) { hit(); return c; }
    if (Store.configsPlaintext > 0) return api.config(pubkey, node, iface).then(r => {
      const conf = rerenderConf(r.ok ? r.data.config : null, node, iface);
      if (conf) hit(); else miss();
      return conf;
    }).catch(() => { miss(); return null; });
    miss();
    return null;
  });
}
export function anySessionConf(pubkey) {
  const s = Store.sessionConfigs[pubkey]; return s ? (Object.values(s)[0] || null) : null;
}



export function VaultPromptSheet({ opts, onDone }) {
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(subPersistOn());   // "keep this device unlocked" — device-persist opt-in
  const [exists, setExists] = useState(null);   // null = checking; whether an encryption vault is set up at all
  useEffect(() => { let ok = true; api.subVault().then(r => { if (ok) setExists(!!(r && r.ok && r.data && r.data.exists)); }).catch(() => { if (ok) setExists(false); }); return () => { ok = false; }; }, []);
  const done = v => { closeModal(); onDone(v); };
  const unlock = async () => {
    if (!pw || busy) return; setBusy(true);
    try { await subUnlock(pw); subSetPersist(keep); Store.configEpoch++; bus.emit(); setBusy(false); done(true); }
    catch (e) { setBusy(false); toast((e && e.message) || T("That password didn’t unlock the Encryption Vault."), "err"); }
  };
  return html`<${Sheet} title=${opts.title || T("Enter your password to continue")} width=${480} onClose=${() => done(false)}
    foot=${html`<${Fragment}><span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" disabled=${busy} onClick=${() => done(false)}>${T("Skip")}</button>
      <button class="btn btn-primary" disabled=${busy || !pw || exists === false} onClick=${unlock}>${busy ? T("Unlocking…") : T("Unlock vault")}</button></>`}>
    <div class="vaultprompt">
      <p class="vp-reason">${opts.reason || T("This action needs your Encryption Vault, which isn’t unlocked in this session.")}</p>
      ${exists === false
        ? html`<div class="notice err"><${Ic} i="warn"/><span>${vaultMissing(() => done(false))}</span></div>`
        : html`<${Fragment}><div class="field"><label>${T("Panel password")}</label>
            <input class="subpw" type="password" autofocus value=${pw} autocomplete="off" placeholder=${T("Panel password")}
              onKeyDown=${e => { if (e.key === "Enter") unlock(); }} onInput=${e => setPw(e.target.value)}/></div>
            <div class="vp-keep"><label class="vp-keep-row"><input type="checkbox" checked=${keep} onChange=${e => setKeep(e.target.checked)}/> <span>${T("Keep this device unlocked")}</span></label>
              <div class="hint">${T("Stay unlocked across restarts on this device — the key is stored only here, never sent to the server.")}</div></div><//>`}
      <div class="notice warn vp-skip"><${Ic} i="info"/><span><b>${T("If you skip:")}</b> ${opts.consequence || T("the action completes, but anything that needed the key won’t be saved.")}</span></div>
    </div>
  <//>`;
}
