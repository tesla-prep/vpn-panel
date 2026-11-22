import { b64, esc, url, tkey } from "./util.js";
import { T, Tsplit, srvText } from "./i18n.js";
import { Store, api, bus } from "./store.js";
import { Ic, Sheet, Panel, toast, copy, closeModal, pushModal } from "./ui.js";
import { turnFork, turnForkList, forkLabel } from "./turn-catalog.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

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

export const SUB_CHECK = "swg-sub-v1";
export async function subWrapKey(password, saltBytes) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: saltBytes, iterations: 200000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function subEnc(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
export async function subDec(key, b64s) {
  const all = _b64ToBytes(b64s); return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12)));
}
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
    fresh: true,
    sk_verify: await subEnc(skKey, new TextEncoder().encode(SUB_CHECK)) });
  if (!r || r.ok === false) throw new Error(srvText(r) || T("couldn't save the vault"));
  _subSK = skKey;
  try { sessionStorage.setItem(_SK_CACHE, b64(sk)); } catch (_) {}
  try { await ivkSetEscrow(true); } catch (_) {}
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
export async function ivkSeal(pubB64, plaintext) {
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
export async function ivkUnseal(privRaw, blob) {
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
  if (!(v && v.ok && v.data && v.data.ivk_pub)) {
    const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const pk8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    body.ivk_pub = b64(pubRaw); body.ivk_priv_by_sk = await subEnc(sk, pk8.slice(-32));
  }
  const r = await api.post("/api/sub/ivk", body); if (!r || !r.ok) throw new Error(srvText(r) || T("couldn't enable escrow"));
  return true;
}
export async function ivkVaultPriv() {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the vault first."));
  const v = await api.subVault();
  if (!v || !v.ok || !v.data || !v.data.ivk_priv_by_sk) throw new Error(T("No interface-key vault is set up."));
  return await subDec(sk, v.data.ivk_priv_by_sk);
}
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
export async function wdttResealForNode(node, keyBlob) {
  return await ivkResealForNodeBlob(node, keyBlob, T("No escrowed identity is stored for this WDTT server."));
}

let _subSK = null;
const _SK_CACHE = "swg_ck";
const _SK_PERSIST = "swg_ck_keep";
export function subSKCached() { return _subSK; }
export function subPersistOn() { try { return localStorage.getItem(_SK_PERSIST) === "1"; } catch (_) { return false; } }
export function subSetPersist(on) {
  try {
    if (on) { localStorage.setItem(_SK_PERSIST, "1"); const b = sessionStorage.getItem(_SK_CACHE); if (b) localStorage.setItem(_SK_CACHE, b); }
    else { localStorage.removeItem(_SK_PERSIST); localStorage.removeItem(_SK_CACHE); }
  } catch (_) {}
}
export function subForget() { _subSK = null; try { sessionStorage.removeItem(_SK_CACHE); localStorage.removeItem(_SK_CACHE); } catch (_) {} }
export function lockVault() {
  subForget();
  try { localStorage.removeItem(_SK_PERSIST); } catch (_) {}
  try { for (const k in _healTried) delete _healTried[k]; } catch (_) {}
  Store.configEpoch++; bus.emit();
  try { toast(T("Encryption Vault locked on this device."), "ok"); } catch (_) {}
}
export async function subBootRestore() {
  if (_subSK) return;
  let s = null; try { s = localStorage.getItem(_SK_CACHE) || sessionStorage.getItem(_SK_CACHE); } catch (_) {}
  if (!s) return;
  try { sessionStorage.setItem(_SK_CACHE, s); } catch (_) {}
  try {
    const key = await _importAes(_b64ToBytes(s), ["encrypt", "decrypt"]);
    const v = await api.subVault();
    if (!v || !v.ok || !v.data || !v.data.exists) { subForget(); return; }
    if (v.data.sk_verify) {
      let ok = false;
      try { ok = new TextDecoder().decode(await subDec(key, v.data.sk_verify)) === SUB_CHECK; } catch (_) {}
      if (!ok) { subForget(); return; }
    }
    _subSK = key;
  } catch (_) { subForget(); }
}
export async function subUnlock(password) {
  const v = await api.subVault();
  if (!v || v.ok === false || !v.data || !v.data.exists) throw new Error(T("Config encryption isn't set up yet."));
  const wk = await subWrapKey(password, _b64ToBytes(v.data.salt));
  let skBytes;
  try {
    if (new TextDecoder().decode(await subDec(wk, v.data.sk_check)) !== SUB_CHECK) throw new Error("bad");
    skBytes = await subDec(wk, v.data.sk_by_pw);
  } catch (_) { throw new Error(T("That password didn't unlock the Encryption Vault.")); }
  _subSK = await _importAes(skBytes, ["encrypt", "decrypt"]);
  try { sessionStorage.setItem(_SK_CACHE, b64(skBytes)); if (subPersistOn()) localStorage.setItem(_SK_CACHE, b64(skBytes)); } catch (_) {}
  if (!v.data.sk_verify) {
    try { await api.subVaultSet({ salt: v.data.salt, sk_by_pw: v.data.sk_by_pw, sk_check: v.data.sk_check,
      sk_verify: await subEnc(_subSK, new TextEncoder().encode(SUB_CHECK)) }); } catch (_) {}
  }
  try { subFlushPending(); } catch (_) {}
  try { subAutoHeal(); } catch (_) {}
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
  if (v.data.sk_verify) {
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
export function looksLikeVaultKey(s) { return /^[A-Za-z0-9+/_-]{43}=?$/.test(String(s || "").trim()); }
export function subKeyB64() { try { return subSKCached() ? sessionStorage.getItem(_SK_CACHE) : null; } catch (_) { return null; } }

export async function subEnableUser(uid) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Encryption Vault first."));
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
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

export async function subRecoverUnlock(escRec) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Encryption Vault first."));
  if (!escRec || !escRec.unlock_by_sk) throw new Error(T("no encryption key for this user"));
  return _importAes(await subDec(sk, escRec.unlock_by_sk), ["encrypt", "decrypt"]);
}

export async function subRecover(escRec) {
  const sk = subSKCached(); if (!sk) throw new Error(T("Unlock the Subscription Key first."));
  if (!escRec || !escRec.unlock_by_sk || !escRec.token_by_sk) throw new Error(T("no subscription for this user"));
  const unlockBytes = await subDec(sk, escRec.unlock_by_sk);
  const token = new TextDecoder().decode(await subDec(sk, escRec.token_by_sk));
  return { token, unlockKey: await _importAes(unlockBytes, ["encrypt", "decrypt"]), unlockKeyB64: b64url(unlockBytes) };
}

export function normPublicUrl(s) {
  s = (s || "").trim().replace(/\/+$/, "");
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s.replace(/^(https:\/\/[^/:]+):443\b/i, "$1").replace(/^(http:\/\/[^/:]+):80\b/i, "$1");
}
export const urlPortOf = s => { const m = /^(?:https?:\/\/)?(?:\[[^\]]+\]|[^/:]+):(\d+)/i.exec((s || "").trim()); return m ? m[1] : ""; };
export function withUrlPort(url, port) {
  let s = (url || "").trim();
  const p = parseInt(port, 10);
  s = s.replace(/^(https?:\/\/)?(\[[^\]]+\]|[^/:]+):\d+/i, "$1$2");
  if (!p || p === 443 || p === 80) return s;
  return s.replace(/^((?:https?:\/\/)?(?:\[[^\]]+\]|[^/:]+))/i, "$1:" + p);
}
export function subBaseUrl() {
  const ps = Store.panelSettings || {};
  const sub = (ps.access || {}).sub || {};
  const tlsMode = ((ps.access || {}).tls || {}).mode || "";
  const behindProxy = tlsMode === "" || tlsMode === "skip";
  let raw = String(sub.url || (ps.subscriptions || {}).base_url || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const u = new URL(raw);
    const lp = parseInt(sub.port, 10);
    if (!behindProxy && !u.port && lp && !((u.protocol === "https:" && lp === 443) || (u.protocol === "http:" && lp === 80))) u.port = String(lp);
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch (_) { return raw.replace(/\/+$/, ""); }
}
export const SUB_LANG_LIST = [["en", "English"], ["ru", "Русский"]];
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

export function subFeatureOn() { return !!(((Store.panelSettings || {}).subscriptions || {}).enabled); }
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
    const uid = userId || SUB_ORPHAN;
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
      return msg;
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
  for (const a of [..._pendingKeep.values()]) if ((await exitKeepRouter(...a)) === true) n++;
  if (n || tried) bus.emit();
}
const _NOCONF_V = "2";
try {
  if (localStorage.getItem("swg-sub-noconf-v") !== _NOCONF_V) {
    localStorage.removeItem("swg-sub-noconf");
    localStorage.setItem("swg-sub-noconf-v", _NOCONF_V);
  }
} catch (_) {   }
const _subNoConf = new Map((() => { try { return Object.entries(JSON.parse(localStorage.getItem("swg-sub-noconf") || "{}")); } catch (_) { return []; } })());
function _saveSubNoConf() { try { localStorage.setItem("swg-sub-noconf", JSON.stringify(Object.fromEntries(_subNoConf))); } catch (_) {} }
export function subNoConfSet(pid, pubkey) { if (_subNoConf.get(pid) !== pubkey) { _subNoConf.set(pid, pubkey); _saveSubNoConf(); } }
export function subNoConfClear(pid) { if (_subNoConf.delete(pid)) _saveSubNoConf(); }
export function subNoConfHas(pid, pubkey) { return !!pubkey && _subNoConf.get(pid) === pubkey; }
let _vaultPromptPending = null;
export function ensureVaultUnlocked(opts) {
  if (Store.storeMode !== "encrypted" && !(opts && opts.always)) return Promise.resolve(true);
  if (subSKCached()) return Promise.resolve(true);
  if (_vaultPromptPending) return _vaultPromptPending;
  _vaultPromptPending = new Promise(function (resolve) {
    pushModal(html`<${VaultPromptSheet} opts=${opts || {}} onDone=${v => { _vaultPromptPending = null; resolve(v); }}/>`);
  });
  return _vaultPromptPending;
}
export async function subPublishOrPrompt(userId, peerId, privkey, psk) {
  if (Store.storeMode !== "encrypted" || !peerId) return;
  if (!subSKCached()) {
    const ok = await ensureVaultUnlocked({
      title: T("Unlock to publish this config"),
      reason: T("This peer's config is stored encrypted — only you can read it, with your encryption key. Unlock the key to publish this peer now, so its QR appears on the user's subscription page and stays re-viewable in the panel later."),
      consequence: T("the peer is created and works right away, but its config isn't published — its QR won't appear on the subscription page. You can still save it by unlocking the key in this browser tab before you reload; after a reload the key is gone from the browser (it was never on the server) and you'd have to rekey the peer to re-issue it."),
    });
    if (!ok) { _pendingPublish.set(peerId, { userId, privkey, psk }); return; }
  }
  const err = await subMaybePublish(userId, peerId, privkey, psk);
  _pendingPublish.delete(peerId);
  return err;
}
export async function subReconcileUser(userId) {
  if (Store.storeMode !== "encrypted" || !userId) return;
  let rec; try { rec = (await subUsersMap(true))[userId]; } catch (_) { return; }
  if (!rec || !rec.enabled) return;
  if ((rec.peers || 0) <= (rec.provisioned || 0)) return;
  if (!subSKCached()) {
    const ok = await ensureVaultUnlocked({
      title: T("Unlock to update this subscription"),
      reason: T("This user is subscribed, and this change left a peer whose config isn't published yet. Unlock your encryption key to publish it now, so the peer's QR appears on their subscription page."),
      consequence: T("the peer works right away, but it shows “Not ready yet” (an empty QR) on the user's subscription page. Unlock the key in this browser tab before you reload and it publishes automatically; after a reload you'd have to rekey the peer to re-issue it."),
    });
    if (!ok || !subSKCached()) return;
  }
  try { const k = await ensureUserUnlockKey(userId); if (k) { await subBackfillUser(userId, k); bus.emit(); } } catch (_) {}
}
const _blobEnsured = new Set();
export async function ensurePeerBlob(peer, conf) {
  if (Store.storeMode !== "encrypted" || !subSKCached() || !peer || !peer.id || !conf) return;
  if (_blobEnsured.has(peer.id)) return;
  _blobEnsured.add(peer.id);
  try {
    const g = await api.subBlobGet(peer.id);
    if (g && g.ok && g.data && g.data.sec) return;
    const parsed = parseFullConf(conf);
    if (parsed && parsed.privkey) await subMaybePublish(peer.user_id, peer.id, parsed.privkey, parsed.psk);
  } catch (_) { _blobEnsured.delete(peer.id); }
}

export async function subBackfillUser(uid, unlockKey) {
  const peers = Store.peersOfUser(uid);
  let published = 0, missing = 0; const missingPeers = [];
  for (const p of peers) {
    if (subNoConfHas(p.id, p.pubkey)) { missing++; missingPeers.push(p.id); continue; }
    let conf = anySessionConf(p.pubkey);
    if (!conf && Store.configsPlaintext > 0) {
      for (const t of (p.targets || [])) {
        try { const r = await api.config(p.pubkey, t.node, t.iface); if (r && r.ok && r.data && r.data.config) { conf = r.data.config; break; } } catch (_) {}
      }
    }
    const parsed = conf ? parseFullConf(conf) : null;
    if (!parsed || !parsed.privkey) {
      try {
        const g = await api.subBlobGet(p.id);
        if (g && g.ok && g.data && g.data.sec) {
          if (g.data.user_id === uid) { subNoConfClear(p.id); published++; continue; }
          const srcRec = (await subUsersMap())[g.data.user_id];
          if (srcRec && srcRec.unlock_by_sk) {
            const srcKey = await subRecoverUnlock(srcRec);
            const secret = JSON.parse(new TextDecoder().decode(await subDec(srcKey, g.data.sec)));
            if (secret && secret.k) { await subEncryptPeer(uid, p.id, secret.k, secret.p, unlockKey); subNoConfClear(p.id); published++; continue; }
          }
        }
      } catch (_) {}
      subNoConfSet(p.id, p.pubkey);
      missing++; missingPeers.push(p.id); continue;
    }
    try {
      await subEncryptPeer(uid, p.id, parsed.privkey, parsed.psk, unlockKey);
      await captureOverridesFrom(p, parsed);
      subNoConfClear(p.id); published++;
    } catch (_) { missing++; missingPeers.push(p.id); }
  }
  return { published, missing, total: peers.length, missingPeers };
}

let _autoHealRunning = false;
const _healTried = {};
let _ikRunning = false;
const _ikTried = {};
const _evTried = {};
let _evRunning = false;
export async function escrowAutoVerify() {
  if (_evRunning || !subSKCached()) return;
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
        if (_evTried[k]) continue;
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
  if (_ikRunning || !subSKCached()) return;
  _ikRunning = true;
  try {
    for (const n of (Store.nodes || [])) {
      for (const ifn of (n.awaiting_key || [])) {
        const k = n.id + "|" + ifn;
        if (_ikTried[k]) continue;
        _ikTried[k] = 1;
        const mi = (n.missing_ifaces || {})[ifn];
        if (!mi || mi.key_source !== "vault" || !mi.key_blob) continue;
        try {
          const sealed = await ivkResealForNode(n.id, mi);
          if (sealed) await api.ifaceRecreate({ node: n.id, iface: ifn, sealed_key: sealed });
        } catch (_) { delete _ikTried[k]; }
      }
      for (const w of ((Store.stats[n.id] || {}).wdtt || [])) {
        if (!w || !w.await_restore || !w.iface) continue;
        const k = n.id + "|wdtt|" + w.iface;
        if (_ikTried[k]) continue;
        _ikTried[k] = 1;
        const kb = (n.wdtt_vault || {})[w.iface];
        if (!kb || !kb.ct) continue;
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
      if (!u.enabled) { delete _healTried[uid]; continue; }
      const deficit = (u.peers || 0) - (u.provisioned || 0);
      if (deficit <= 0) { delete _healTried[uid]; continue; }
      if (_healTried[uid] === deficit) continue;
      _healTried[uid] = deficit;
      try {
        const k = await ensureUserUnlockKey(uid);
        if (k) { const r = await subBackfillUser(uid, k); healed += (r.published || 0); if (r.published) delete _healTried[uid]; }
        else delete _healTried[uid];
      } catch (_) { delete _healTried[uid]; }
    }
    if (healed) bus.emit();
  } finally { _autoHealRunning = false; }
}

export async function captureOverridesFrom(peer, parsed) {
  if (peer.overrides && Object.keys(peer.overrides).length) return;
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
  const pr = await api.purgePlaintext({ purge_orphans: true });
  await Store.poll();
  return { migrated, total: list.length, flagged: [...new Set(flagged)],
           purged: (pr && pr.data && pr.data.purged) || 0, orphansPurged: (pr && pr.data && pr.data.orphans_purged) || 0,
           remaining: (pr && pr.data && pr.data.remaining) || 0 };
}

export const AWG_ORDER = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",
  "HeaderProtectionKey", "RandomTrailers", "ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout", "MaxHandshakeAttempts", "DisableCookies"];
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
    if (k === "RandomTrailers") { if (!/^\s*(0|off)\s*$/i.test(String(awg[k]))) L.push(k + " = 1"); return; }
    L.push(k + " = " + awg[k]);
  });
  return L;
}
export function clientKeepalive(ka, awg) {
  const k = ka != null && ka !== "" ? ka : 25;
  const g31 = !!(awg && awg.HeaderProtectionKey != null && String(awg.HeaderProtectionKey).trim() !== "");
  return g31 && /^\s*\d+\s*$/.test(String(k)) && +k > 0 ? (+k) + "-" + (+k + 10) : k;
}
export function buildConf(o) {
  const L = ["[Interface]", "PrivateKey = " + o.privkey, "Address = " + o.address];
  if (o.dns && o.dns.length) L.push("DNS = " + o.dns.join(", "));
  L.push("MTU = " + (o.mtu || 1280));
  L.push(...awgConfLines(o.awg_params));
  L.push("", "[Peer]", "PublicKey = " + o.server_pubkey);
  if (o.psk) L.push("PresharedKey = " + o.psk);
  L.push("AllowedIPs = " + guardAllowed(o.allowed), "Endpoint = " + o.endpoint,
    "PersistentKeepalive = " + clientKeepalive(o.keepalive, o.awg_params));
  return L.join("\n") + "\n";
}
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
  if (ka !== "" && ka !== defKa) ov.keepalive = +ka;
  return ov;
}

export function downloadConf(text, base, ext) {
  ext = String(ext || "conf").replace(/^\./, "");
  const blob = new Blob([text], { type: "application/octet-stream" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = base.replace(/[^\w.-]+/g, "_").replace(/\.(conf|txt)$/i, "") + "." + ext; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function _b64ToBytes(b64) { try { const s = atob(String(b64 || "").trim()); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; } catch (_) { return new Uint8Array(0); } }

export function turnArtifact(baseConf, tp, vkLink, vkLinks, asClient, os) {
  const fork = turnFork(tp.service);
  if (SWGTurn.setForkLabel) SWGTurn.setForkLabel(forkLabel);
  if (SWGTurn.setCliAuthors) SWGTurn.setCliAuthors(f => ((((Store.turnCatalog || {}).servers) || []).find(x => x.id === f) || {}).cli_authors);
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
  const rank = id => { const cl = compat[id], cli = isCli(id);
    return cl === "native" ? (cli ? 3 : 1)
      : (cl === "friendly" || cl === "friendly_core") ? (cli ? 4 : 2)
      : cl === "plain" ? (cli ? 6 : 5) : 9; };
  const out = ids.map(id => {
    const c = cmap[id] || {}; const plat = Object.keys(c.platforms || {})[0];
    return { id, encoder: c.encoder || id, name: c.name || id, cls: compat[id] || "",
             plat: plat ? (PL[plat] || plat) : "", cross: (c.encoder || id) !== native };
  });
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
  const srv = ((Store.turnCatalog || {}).servers || []).find(s => s.id === fork);
  const schema = (srv && srv.client_schemas && srv.client_schemas[cid]) || c.settings || [];
  const useOs = os || Object.keys(c.platforms || {})[0] || "";
  const saved = (((((Store.panelSettings && Store.panelSettings.turn_client_settings) || {})[fork]) || {})[cid] || {})[useOs] || {};
  const out = {};
  for (const d of schema) { const v = saved[d.key]; out[d.key] = (v === undefined || v === null) ? d.default : v; }
  return out;
}

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
export let qrZoomEl = null;
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
  let out = text;
  if (meta.endpoint) out = out.replace(/^([ \t]*Endpoint[ \t]*=).*$/m, (m, p1) => p1 + " " + meta.endpoint);
  const awg = meta.awg_params || {};
  const lineRe = k => new RegExp("^([ \\t]*" + k + "[ \\t]*=).*$", "m");
  if (!Object.keys(awg).length) return out;
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
  const ov = { ...pov, ...tov };
  meta = meta || {};
  const ka = (typeof ov.keepalive === "number") ? ov.keepalive
           : ((typeof meta.keepalive === "number") ? meta.keepalive : 25);
  return {
    dns: Array.isArray(ov.dns) ? ov.dns.slice() : ((meta.dns || []).slice()),
    mtu: ov.mtu || meta.mtu || 1280,
    allowed: ov.allowed || "0.0.0.0/0, ::/0",
    keepalive: ka,
  };
}

export const CONF_UNREACHABLE = Symbol("conf-unreachable");
export const CONF_SEALED_OLD = Symbol("conf-sealed-old");
const _confUnreach = new Map();
const _confSealed = new Map();
export function confWasUnreachable(pubkey, node, iface) { return _confUnreach.has(pubkey + "|" + node + "|" + iface); }
export function confWasSealedOld(pubkey, node, iface) { return _confSealed.has(pubkey + "|" + node + "|" + iface); }

export async function blobConfig(peer, node, iface) {
  if (!peer || !subSKCached()) return null;
  const t = (peer.targets || []).find(x => x.node === node && x.iface === iface);
  const meta = Store.ifaceMeta(node, iface);
  if (!t || !meta) return null;
  let sec, unlockKey;
  try {
    const r = await api.subBlobGet(peer.id);
    if (!r || r.ok === false) return CONF_UNREACHABLE;
    if (!r.data || !r.data.sec) return null;
    sec = r.data.sec;
    const buid = r.data.user_id || peer.user_id || SUB_ORPHAN;
    const rec = (await subUsersMap())[buid];
    if (!rec || !rec.unlock_by_sk) return null;
    try {
      unlockKey = await subRecoverUnlock(rec);
    } catch (_) {
      return CONF_SEALED_OLD;
    }
  } catch (_) { return CONF_UNREACHABLE; }
  try {
    let secret;
    try { secret = JSON.parse(new TextDecoder().decode(await subDec(unlockKey, sec))); } catch (_) { return CONF_SEALED_OLD; }
    if (!secret || !secret.k) return null;
    const eff = effectiveClientParams(peer, t, meta);
    return buildConf({ privkey: secret.k, address: (t.ip || "").split("/")[0] + "/32",
      dns: eff.dns, mtu: eff.mtu, awg_params: meta.awg_params, server_pubkey: meta.public_key,
      psk: secret.p || peer.psk, endpoint: meta.endpoint, allowed: eff.allowed, keepalive: eff.keepalive });
  } catch (_) { return null; }
}

export const exitBucket = nid => "_x_" + nid;
const _pendingKeep = new Map();
const _keepFail = new Map();
export const EXIT_KEEP_LOCKED = Symbol("exit-keep-locked");
export function exitKeepState(nid, exitId) {
  const pk = nid + "|" + exitId;
  return _keepFail.get(pk) || (_pendingKeep.has(pk) ? "queued" : null);
}
export async function exitKeepRouter(nid, exitId, routerPub, routerPriv, nodePub, nodePriv) {
  if (Store.storeMode !== "encrypted") return false;
  const pk = nid + "|" + exitId;
  try {
    if (!subSKCached()) { _pendingKeep.set(pk, [nid, exitId, routerPub, routerPriv, nodePub, nodePriv]); _keepFail.delete(pk); return EXIT_KEEP_LOCKED; }
    const uid = exitBucket(nid), unlockKey = await ensureUserUnlockKey(uid);
    if (!unlockKey) {
      const sealed = !!((await subUsersMap())[uid] || {}).unlock_by_sk;
      const why = sealed ? T("its encryption bucket was sealed with a previous encryption key") : T("couldn't store the router config");
      if (_pendingKeep.has(pk)) { _keepFail.set(pk, why); if (sealed) _pendingKeep.delete(pk); }
      return why;
    }
    const sec = await subEnc(unlockKey, new TextEncoder().encode(JSON.stringify({ k: routerPriv, n: nodePub })));
    const nkh = (await sha256hex(nodePriv)).slice(0, 16);
    const r = await api.subExitBlob({ node: nid, exit: exitId, pub: routerPub, nkh, sec });
    if (r && r.ok !== false) { _pendingKeep.delete(pk); _keepFail.delete(pk); return true; }
    const why = srvText(r) || T("couldn't store the router config");
    if (_pendingKeep.has(pk)) _keepFail.set(pk, why);
    if (r && ["stale", "not_found", "bad_request"].includes(r.code)) _pendingKeep.delete(pk);
    return why;
  } catch (e) { const why = String((e && e.message) || e); if (_pendingKeep.has(pk)) _keepFail.set(pk, why); return why; }
}
export const EXIT_LOCKED = Symbol("exit-locked");
export async function exitRouterKey(nid, exitId) {
  let r, unlockKey;
  try {
    r = await api.subExitBlobGet(nid, exitId);
    if (r && r.code === "not_found") return null;
    if (!r || r.ok === false || !r.data) return CONF_UNREACHABLE;
    if (!r.data.sec) return null;
    if (!subSKCached()) return EXIT_LOCKED;
    if (!r.data.unlock_by_sk) return CONF_SEALED_OLD;
    try { unlockKey = await subRecoverUnlock(r.data); } catch (_) { return CONF_SEALED_OLD; }
  } catch (_) { return CONF_UNREACHABLE; }
  try {
    const s = JSON.parse(new TextDecoder().decode(await subDec(unlockKey, r.data.sec)));
    return s && s.k && s.n ? { k: s.k, n: s.n, pub: r.data.pub || "" } : null;
  } catch (_) { return CONF_SEALED_OLD; }
}

const _configMiss = new Map();
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
  if (_configMissFresh(mk)) return Promise.resolve(null);
  const definitive = Store.storeMode !== "encrypted" || subSKCached();
  const miss = () => { _configMiss.set(mk, { epoch: Store.configEpoch, at: Date.now() }); if (peer && definitive) subNoConfSet(peer.id, pubkey); };
  const hit = () => { _configMiss.delete(mk); if (peer) subNoConfClear(peer.id); };
  return blobConfig(peer, node, iface).then(c => {
    if (c === CONF_UNREACHABLE) { _confUnreach.set(mk, Date.now()); return null; }
    if (c === CONF_SEALED_OLD) {
      _confSealed.set(mk, Date.now());
      if (!(Store.configsPlaintext > 0)) return null;
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
  const [keep, setKeep] = useState(subPersistOn());
  const [exists, setExists] = useState(null);
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
