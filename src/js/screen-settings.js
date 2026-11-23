import { T, Trich, Tsplit, plural, srvText, locale, fmtNum } from "./i18n.js";
import { normVkLink, _VK_CALL_RE } from "./peer-ui.js";
import { awgDict3, nodeStale, P2P_PORTOK_DEFAULT, PORTOK_WIDE, portokRead, portokSame } from "./model.js";
import {
  BASE, ago, dur, ipChoices, seen, url, fmtBytes, panelNow, panelNowS, isMobile,
} from "./util.js";
import {
  LEAVE_MSG, clearUnsavedGuard, setUnsavedGuard,
} from "./router.js";
import {
  THEME_COLOR_DEFAULT, THEME_COLOR_LIGHT_DEFAULT, clampBrand, pickThemed,
} from "./theme.js";
import {
  Store, api, bus, useStore,
} from "./store.js";
import {
  forkSupportsAwg, turnColor, turnFork, turnForkList, turnForksVisible, forkLabel,
} from "./turn-catalog.js";
import {
  ConfirmSheet, Disclosure, Dropdown, ExitDevicePick, ExitEgressPick, Ic, NodeIpPick, Popover, Sheet, Switch, ThemedSwatch, autoGrow, closeModal, closeModals, copy, footRow,
  goSettings, meshGenLabel, openConfirm, openModal, pushModal, registerSectionSetter, takePendingSection, toast,
  useHostOnNode,
  exitRefusalText,
  ListPager, LIST_PAGE, pageSlice,
} from "./ui.js";
import {
  CONF_SEALED_OLD, CONF_UNREACHABLE, EXIT_LOCKED, EXIT_KEEP_LOCKED, exitKeepState, awgConfLines, buildConf, exitKeepRouter, exitRouterKey, genKeys, genPSK, QR,
  SUB_LANG_LIST, VaultPromptSheet, downloadConf, ivkSetEscrow,
  ensureVaultUnlocked, ivkResealForNodeBlob, normPublicUrl, qrDataURL, runConfigMigration, subBaseUrl, subForget, subKeyB64, subRewrap, subSKCached, subUnlock,
  subVaultCreate, urlPortOf, withUrlPort,
} from "./crypto.js";
import {
  AsnHint, BlockCoverageSummary, BlockListPicker, CAT_PROVIDER_DEFAULTS, FleetAssign, HostHealth, ListInfo,
  MODE_META, ModeTabs, NewBlockCatSheet, ProvTag, blockCatDisabled, blockSrcOk, blockTierOk, capBadges, catCap,
  blistText, catLabelOf, catListUrl, catRawId, catUsableInMode, loadBlockCatalog, newRid,
  TargetField, candAddr, cardAddrs, cardGateway, isCardName, candOf, exitHealth, exitIsDialin, exitOptionGroups, exitProv, fleetRuleCats, provLabelOf, provName, providerColor, providerUsage, reportDropped,
  resetRouting, sizeSummary,
  exitHealthMark, RoutingRules, rulesTitle, rulesSummary, egressSaveBlock,
  p2pVal, p2pRec, p2pTarget, p2pLabel, p2pTargetOpts, p2pTargetHints,
} from "./routing.js";
import { awgFieldCheck } from "./mimic.js";
import { LogViewer } from "./journal.js";
import { classifyAll } from "./classify.js";
import { customCaps, customTargets, rulesToRows, rowsToRules, adoptRows, PORTS_MAX_TOKENS } from "./rulerows.js";
import {
  TURN_FORKS_DEFAULT, TurnCollectedIps, openRosterCheck, openServerClients, openServerDefaults,
  turnDialFallback, turnForkPlatforms, turnUpdateTarget, turnUpdating,
} from "./turn.js";
import {
  openIfaceEditor, AwgGenField, Awg3Grid, AWG3_EDIT_COLS, MeshGenField,
  AWG_KEYS, DEFAULT_AWG_GEN, genAwg, awgBlankHints, AwgGrid, MeshAwgParams, mesh3Hints,
} from "./iface.js";
export { AWG_KEYS, genAwg, awgBlankHints, AwgGrid };
import { statsUsage, trafficInvalidate } from "./traffic.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);


function meshModeLabel(v, max) {
  return v === "full" ? T("Full mesh") : v === "demand" ? T("On demand")
    : (max ? T("Auto — a full mesh up to {v1} nodes, on demand above", { v1: max }) : T("Auto"));
}

export function AccountScreen() {
  const [user, setUser] = useState("");
  const [cur, setCur] = useState(""); const [np, setNp] = useState(""); const [np2, setNp2] = useState("");
  const [msg, setMsg] = useState(null); const [enabled, setEnabled] = useState(true);
  useEffect(() => { api.account().then(r => { if (r.ok) { if (r.data.username) setUser(r.data.username); if (!r.data.auth_enabled) { setEnabled(false); setMsg({ ok: false, t: T("This panel has no login configured — changes are disabled.") }); } } }); }, []);
  const save = async () => {
    if (!user.trim()) return setMsg({ ok: false, t: T("Username can't be empty.") });
    if (user.includes(":")) return setMsg({ ok: false, t: T("Username can't contain a colon.") });
    if (!cur) return setMsg({ ok: false, t: T("Enter your current password to confirm.") });
    if (np && np !== np2) return setMsg({ ok: false, t: T("New passwords don't match.") });
    if (np && np.length < 8) return setMsg({ ok: false, t: T("New password must be at least 8 characters.") });
    setMsg({ ok: true, t: T("Saving…") });
    let reWrapped = false;
    if (np) {
      if (!subSKCached()) { try { await subUnlock(cur); } catch (_) {} }
      if (subSKCached()) { try { reWrapped = await subRewrap(np); } catch (_) { reWrapped = false; } }
    }
    const r = await api.accountSave({ username: user.trim(), current_password: cur, new_password: np });
    if (!r.ok) {
      if (reWrapped) { try { await subRewrap(cur); } catch (_) {} }
      return setMsg({ ok: false, t: srvText(r) || T("Failed to update.") });
    }
    setMsg({ ok: true, t: T("Updated. Reloading — sign in with your new credentials…") });
    setTimeout(() => location.reload(), 1400);
  };
  return html`<div class="screen">
    <div class="crumb"><b>${T("Account")}</b></div>
    <div class="card" style="max-width:520px">
      <h3 style="margin:0 0 4px">${T("Admin login")}</h3>
      <p class="hint" style="margin:0 0 18px">${Trich("Change the panel username and password. Takes effect immediately — you'll be asked to sign in again. Changing the password also reconnects your *Encryption Vault* to it — the encryption key itself is unchanged, so stored configs and subscription links keep working (no re-issue).")}</p>
      ${msg ? html`<div class=${"formmsg " + (msg.ok ? "ok" : "err")}>${msg.t}</div>` : null}
      <div class="field"><label>${T("Username")}</label><input value=${user} onInput=${e => setUser(e.target.value)} autocomplete="username"/></div>
      <div class="field"><label>${T("Current password")}</label><input type="password" value=${cur} onInput=${e => setCur(e.target.value)} autocomplete="current-password" placeholder=${T("required to confirm changes")}/></div>
      <div class="field"><label>${T("New password")}</label><input type="password" value=${np} onInput=${e => setNp(e.target.value)} autocomplete="new-password" placeholder=${T("leave blank to keep current")}/></div>
      <div class="field"><label>${T("Confirm new password")}</label><input type="password" value=${np2} onInput=${e => setNp2(e.target.value)} autocomplete="new-password"/></div>
      <div style="margin-top:8px"><button class="btn btn-primary" disabled=${!enabled} onClick=${save}>${T("Save changes")}</button></div>
    </div>
  </div>`;
}

export const WH_EVENTS = ["peer.added", "peer.removed", "node.online", "node.offline"];
const whEventLabel = ev => ({
  "peer.added": T("Peer added"), "peer.removed": T("Peer removed"),
  "node.online": T("Node came online"), "node.offline": T("Node went offline"),
}[ev] || ev);
export function WebhookSheet({ hook, onSaved, onClose }) {
  const [url, setUrl] = useState((hook && hook.url) || "");
  const [events, setEvents] = useState(new Set((hook && hook.events) || WH_EVENTS));
  const [enabled, setEnabled] = useState(hook ? hook.enabled !== false : true);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const valid = /^https?:\/\/.+/i.test(url.trim());
  const toggle = ev => setEvents(s => { const n = new Set(s); n.has(ev) ? n.delete(ev) : n.add(ev); return n; });
  const save = async () => {
    if (!valid) return toast(T("Enter a valid http(s) URL."), "err");
    setBusy(true);
    const r = await api.apiWebhookSave({ id: hook && hook.id, url: url.trim(), events: [...events], enabled });
    setBusy(false);
    if (!r.ok) return toast(srvText(r) || T("Failed to save webhook"), "err");
    if (r.data && r.data.secret && !hook) { setSecret(r.data.secret); onSaved && onSaved(); return; }
    onSaved && onSaved(); onClose && onClose();
  };
  return html`<${Sheet} title=${hook ? T("Edit webhook") : T("Add webhook")} onClose=${onClose} noSwipe=${!!secret}
    foot=${secret ? html`<${Fragment}><span class="grow"></span><button class="btn btn-primary" onClick=${onClose}>${T("Done")}</button></>`
      : html`<${Fragment}><span class="grow"></span>
        <button class="btn btn-ghost btn-dismiss" onClick=${onClose}>${T("Cancel")}</button>
        <button class="btn btn-primary" disabled=${busy || !valid} onClick=${save}>${hook ? T("Save") : T("Add webhook")}</button></>`}>
    ${secret ? html`<div class="notice ok"><${Ic} i="check"/><span>${Trich("Webhook saved. This is its *signing secret* — shown once. Every delivery carries an `X-SWG-Signature: sha256=HMAC(secret, body)` header so you can verify it's from this panel.")}</span></div>
      <div class="tokreveal"><code class="tokval">${secret}</code><button class="btn btn-mini" onClick=${() => copy(secret, T("Secret"))}><${Ic} i="copy"/> ${T("Copy")}</button></div>`
    : html`<div class="field"><label>${T("Payload URL")}</label>
        <input value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://example.com/hooks/swg" spellcheck="false"/>
        <div class="hint">${T("The panel POSTs a JSON body here on each selected event. A signing secret is generated on save.")}</div></div>
      <div class="seclabel">${T("Events")}</div>
      <div class="wh-events">${WH_EVENTS.map(ev => html`<label class="wh-ev" key=${ev}>
        <input type="checkbox" checked=${events.has(ev)} onChange=${() => toggle(ev)}/><span class="mono">${ev}</span><span class="wh-ev-lbl">${whEventLabel(ev)}</span></label>`)}</div>
      <label class="wh-en"><${Switch} on=${enabled} onChange=${setEnabled}/><span>${T("Deliveries enabled")}</span></label>`}
  <//>`;
}

export function IntegrationsSettings() {
  const cfg = () => ((Store.panelSettings || {}).api) || { enabled: false, tokens: [], webhooks: [] };
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState(null);
  const [busy, setBusy] = useState(false);
  const c = cfg();
  const baseUrl = `${location.origin}${BASE}`;
  const optimistic = next => { Store.panelSettings = { ...(Store.panelSettings || {}), api: next }; bus.emit(); };
  const setEnabled = async v => { optimistic({ ...cfg(), enabled: v }); const r = await api.panelSettings({ api_enabled: v }); if (r && r.ok === false) toast(srvText(r) || T("Failed"), "err"); };
  const mint = async () => {
    setBusy(true);
    const r = await api.apiTokenCreate(label.trim());
    setBusy(false);
    if (!r.ok) return toast(srvText(r) || T("Failed to create token"), "err");
    setMinted({ label: r.data.label, token: r.data.token });
    setLabel("");
    optimistic({ ...cfg(), enabled: true, tokens: [...(cfg().tokens || []), { id: r.data.id, label: r.data.label, created: r.data.created, last_used: null }] });
  };
  const revoke = t => openConfirm({ title: T("Revoke API token"), confirmLabel: T("Revoke"), danger: true,
    body: Trich("Revoke *{label}*? Any integration still using it stops working immediately.", { label: t.label }),
    onConfirm: async () => { await api.apiTokenRevoke(t.id); optimistic({ ...cfg(), tokens: (cfg().tokens || []).filter(x => x.id !== t.id) }); } });
  const editHook = h => openModal(html`<${WebhookSheet} hook=${h} onClose=${closeModal}/>`);
  const delHook = h => openConfirm({ title: T("Delete webhook"), confirmLabel: T("Delete"), danger: true,
    body: Trich("Stop sending events to *{v1}*?", { v1: h.url }),
    onConfirm: async () => { await api.apiWebhookDelete(h.id); optimistic({ ...cfg(), webhooks: (cfg().webhooks || []).filter(x => x.id !== h.id) }); } });
  const testHook = async h => { const r = await api.apiWebhookTest(h.id); toast(r.ok ? T("Delivered — HTTP {v1}", { v1: (r.data || {}).status || "200" }) : T("Delivery failed: {v1}", { v1: srvText(r) || T("val|unreachable") }), r.ok ? "ok" : "err", 4200); };
  return html`<div class="card">
    <div class="seclabel turnhead" style="margin-top:0">${T("External API")}<span class="grow"></span>
      <${Switch} on=${c.enabled === true} title=${c.enabled ? T("API on — tokens are accepted") : T("API off — all tokens are rejected")} onChange=${setEnabled}/></div>
    <p class="hint" style="margin:0 0 12px">${Trich("A *read-only* REST + Prometheus surface for external monitoring and automation — Grafana, Uptime Kuma, Prometheus, Terraform/Ansible. No token can ever change the fleet. Authenticate with a bearer token below; `/healthz` and `/api/v1/health` stay open as liveness probes.")}</p>
    ${c.enabled !== true ? html`<div class="notice warn"><${Ic} i="warn"/><span>${Trich("The API is *off* — endpoints return 401. Minting a token turns it on, or flip the switch above.")}</span></div>` : null}

    <div class="seclabel">${T("Access tokens")}</div>
    <div class="tok-add"><input value=${label} onInput=${e => setLabel(e.target.value)} placeholder=${T("Label (e.g. grafana, prometheus)")} spellcheck="false" onKeyDown=${e => { if (e.key === "Enter") mint(); }}/>
      <button class="btn btn-primary" disabled=${busy} onClick=${mint}><span class="plus"><${Ic} i="plus"/></span> ${T("Create token")}</button></div>
    ${minted ? html`<div class="notice ok"><${Ic} i="check"/><span>${Trich("New token *{label}* — copy it now, it won't be shown again.", { label: minted.label })}</span></div>
      <div class="tokreveal"><code class="tokval">${minted.token}</code><button class="btn btn-mini" onClick=${() => copy(minted.token, T("Token"))}><${Ic} i="copy"/> ${T("Copy")}</button><button class="btn btn-mini btn-ghost" onClick=${() => setMinted(null)}>${T("Dismiss")}</button></div>` : null}
    ${(c.tokens || []).length ? html`<div class="toklist">${c.tokens.map(t => html`<div class="tokrow" key=${t.id}>
      <div class="tokrow-main"><span class="tokrow-label">${t.label}</span>
        <span class="tokrow-meta">${T("created {v1}", { v1: ago(t.created) })}${t.last_used ? T(" · last used {v1}", { v1: ago(t.last_used) }) : T(" · never used")}</span></div>
      <button class="btn btn-mini btn-danger" onClick=${() => revoke(t)}><${Ic} i="trash"/> ${T("Revoke")}</button></div>`)}</div>`
      : html`<p class="hint" style="margin:2px 0 0">${T("No tokens yet — create one to let an external system read the fleet.")}</p>`}

    <div class="seclabel">${T("Webhooks")}</div>
    <p class="hint" style="margin:0 0 10px">${T("The panel POSTs a signed JSON body to your endpoint when a peer is added/removed or a node goes online/offline. Use them for alerting or automation.")}</p>
    ${(c.webhooks || []).length ? html`<div class="toklist">${c.webhooks.map(h => html`<div class=${"tokrow" + (h.enabled === false ? " off" : "")} key=${h.id}>
      <div class="tokrow-main"><span class="tokrow-label mono">${h.url}</span>
        <span class="tokrow-meta">${(h.events || []).join(", ") || T("all events")}${h.enabled === false ? " · " + T("val|disabled") : ""}</span></div>
      <button class="btn btn-mini" title=${T("Send a test ping")} onClick=${() => testHook(h)}><${Ic} i="refresh"/> ${T("Test")}</button>
      <button class="btn btn-mini" onClick=${() => editHook(h)}><${Ic} i="pencil"/></button>
      <button class="btn btn-mini btn-danger" onClick=${() => delHook(h)}><${Ic} i="trash"/></button></div>`)}</div>` : null}
    <div style="margin-top:10px"><button class="btn btn-ghost" onClick=${() => editHook(null)}><${Ic} i="plus"/> ${T("Add webhook")}</button></div>

    <div class="seclabel">${T("Endpoints")}</div>
    <div class="apiendpoints">
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/api/v1/health</span><span class="apiep-d">${T("liveness + counts (no auth)")}</span></div>
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/metrics</span><span class="apiep-d">${T("Prometheus exposition")}</span></div>
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/api/v1/servers</span><span class="apiep-d">${T("nodes with status + counts")}</span></div>
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/api/v1/servers/{id}/peers</span><span class="apiep-d">${T("peers + last-handshake timing")}</span></div>
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/api/v1/peers</span><span class="apiep-d">${T("all peers, per-node presence")}</span></div>
      <div class="apiep"><span class="apiep-m">GET</span><span class="mono">/api/v1/summary</span><span class="apiep-d">${T("fleet totals")}</span></div>
    </div>
    <div class="apisnip"><div class="apisnip-h">${T("Test it")}<button class="btn btn-mini" onClick=${() => copy(`curl -H 'Authorization: Bearer <token>' ${baseUrl}/api/v1/servers`, T("Command"))}><${Ic} i="copy"/> ${T("Copy")}</button></div>
      <code class="apisnip-c">${`curl -H 'Authorization: Bearer <token>' ${baseUrl}/api/v1/servers`}</code></div>
    <div class="apisnip"><div class="apisnip-h">${T("Prometheus scrape config")}<button class="btn btn-mini" onClick=${() => copy(`scrape_configs:\n  - job_name: swg-panel\n    metrics_path: /metrics\n    scheme: ${location.protocol.replace(":", "")}\n    authorization:\n      credentials: <token>\n    static_configs:\n      - targets: ['${location.host}${BASE}']`, T("Scrape config"))}><${Ic} i="copy"/>${T("Copy")}</button></div>
      <code class="apisnip-c">${`scrape_configs:\n  - job_name: swg-panel\n    metrics_path: /metrics\n    authorization:\n      credentials: <token>\n    static_configs:\n      - targets: ['${location.host}${BASE}']`}</code></div>
  </div>`;
}

export const CF_HTTPS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];
export const CF_IP_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32"];
export function InterfaceKeyEscrow({ value, onChange, vaultExists }) {
  if (vaultExists === null || value === null) return html`<div class="hint">${T("Checking…")}</div>`;
  if (!vaultExists) return html`<p class="hint" style="margin:0">${Trich("Set up your *Encryption Vault* first in {v1} — each server's interface key is sealed under it.", { v1: html`<button class="linkbtn" onClick=${() => goSettings("configs")}>${T("Client configs → Encryption")}</button>` })}</p>`;
  return html`<div class="ivk-escrow">
    <label class="ivk-esc-row"><${Switch} on=${!!value} onChange=${onChange}/>
      <span>${Trich("*Escrow interface server keys* — each entry server seals its interface private key to your browser-held *Encryption Vault* key (the panel only ever stores ciphertext). Lets you *restore an interface cleanly after a full wipe / lost box*, with no client re-import. Off ⇒ a wiped node's interfaces can only be recreated with new keys, and every client on them re-imports.")}</span></label>
    ${value && !subSKCached() ? html`<div class="hint" style="margin-top:6px">${T("Keep the Encryption Vault unlocked when you need to restore — releasing an escrowed key requires it.")}</div>` : null}
  </div>`;
}

export function SubVaultCard() {
  const [state, setState] = useState({ loading: true });
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false);
  const [sk, setSk] = useState(null);
  const [resetMode, setResetMode] = useState(false); const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(null);
  const load = () => api.subVault().then(r => setState({ loading: false, exists: !!(r && r.ok && r.data && r.data.exists) })).catch(() => setState({ loading: false, exists: false }));
  useEffect(() => { load(); }, []);
  const create = async () => {
    if (!pw) return; setBusy(true);
    try { setSk(await subVaultCreate(pw)); setPw(""); }
    catch (e) { toast((e && e.message) || T("Setup failed"), "err"); }
    setBusy(false);
  };
  const doReset = async () => {
    setBusy(true); const r = await api.subReset(); setBusy(false);
    if (r && r.ok) { subForget(); setResetMode(false); setConfirm(""); setSk(null); load(); toast(T("Config encryption reset."), "ok"); }
    else toast(srvText(r) || T("Reset failed"), "err");
  };
  if (state.loading) return html`<div class="hint">${T("Checking…")}</div>`;
  if (sk) return html`<div class="notice ok"><div style="min-width:0">
    ${Trich("*Save your encryption key now — it is shown only once.* It protects every stored client config (and your subscriptions) and is independent of your login password; store it somewhere safe (a password manager). Lose it and your login both, and you'd re-key the affected peers.")}
    <div class="tokenbox" style="margin:8px 0;word-break:break-all">${sk}</div>
    <div class="chiprow">
      <button class="btn btn-mini" onClick=${() => copy(sk, T("Encryption key copied"))}><${Ic} i="copy"/>${T("Copy")}</button>
      <button class="btn btn-mini" onClick=${() => downloadConf(sk, "swg-config-key")}><${Ic} i="download"/>${T("Download")}</button>
      <span class="grow"></span>
      <button class="btn btn-primary btn-mini" onClick=${() => { setSk(null); load(); }}>${T("I've saved it")}</button>
    </div></div></div>`;
  if (!state.exists) return html`<${Fragment}>
    <p class="hint" style="margin:0 0 8px">${T("Set up once. Confirm your panel password — an encryption key is generated in your browser and shown once; the server only ever stores it wrapped, so it can't read your clients' private keys.")}</p>
    <div class="fieldrow">
      <div class="field"><label>${T("Confirm password")}</label><input type="password" value=${pw} onInput=${e => setPw(e.target.value)} autocomplete="current-password"/></div>
      <div class="field" style="flex:none;align-self:end"><button class="btn btn-primary" disabled=${busy || !pw} onClick=${create}>${busy ? T("Setting up…") : T("Set up encryption")}</button></div>
    </div><//>`;
  return html`<${Fragment}>
    <div class="notice ok" style="margin-bottom:8px"><${Ic} i="check"/><span>${Trich("Your *Encryption Vault* is configured — stored configs are wrapped automatically, and their QRs (and any subscription links) keep working across your password changes.")}</span></div>
    <p class="hint" style="margin:0 0 8px">${Trich("The vault opens with your *panel password*, which follows every change you make in the panel. Your *encryption key* opens it too — that's what gets you back in if the panel password is ever reset on the server with *swg-passwd*, so keep a copy somewhere safe.")}</p>
    ${shown ? html`<div class="notice ok"><div style="min-width:0">
        ${Trich("*Your encryption key.* Anyone holding this can read every stored config — treat it like a password and store it in a password manager.")}
        <div class="tokenbox" style="margin:8px 0;word-break:break-all">${shown}</div>
        <div class="chiprow">
          <button class="btn btn-mini" onClick=${() => copy(shown, T("Encryption key copied"))}><${Ic} i="copy"/>${T("Copy")}</button>
          <button class="btn btn-mini" onClick=${() => downloadConf(shown, "swg-config-key")}><${Ic} i="download"/>${T("Download")}</button>
          <span class="grow"></span>
          <button class="btn btn-ghost btn-mini" onClick=${() => setShown(null)}>${T("Hide")}</button>
        </div></div></div>` : null}
    ${resetMode
      ? html`<div class="notice warn"><div style="min-width:0">${Trich("*Reset drops all stored encrypted configs and invalidates every subscription URL.* You'll set up a new encryption key afterwards, then re-issue affected peers. Type *RESET* to confirm.")}
          <div class="chiprow" style="margin-top:8px"><input type="text" placeholder=RESET value=${confirm} onInput=${e => setConfirm(e.target.value)} style="max-width:120px"/>
            <button class="btn btn-danger btn-mini" disabled=${busy || confirm !== "RESET"} onClick=${doReset}>${T("Reset encryption")}</button>
            <button class="btn btn-ghost btn-mini" onClick=${() => { setResetMode(false); setConfirm(""); }}>${T("Cancel")}</button></div></div></div>`
      : html`<div class="chiprow">${shown ? null : html`<button class="btn btn-ghost btn-mini" disabled=${!subSKCached()}
            title=${subSKCached() ? T("Show the key again — it never leaves your browser") : T("Unlock the vault first to reveal its key")}
            onClick=${() => setShown(subKeyB64())}><${Ic} i="key"/>${T("Show encryption key")}</button>`}<span class="grow"></span>
          <button class="btn btn-ghost btn-mini danger" onClick=${() => setResetMode(true)}>${T("Reset encryption…")}</button></div>`}
  <//>`;
}
let _tzCat = null;
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) { return ""; } };
const tzPlace = z => { const p = z.replace(/_/g, " ").split("/"); return p[p.length - 1] + (p.length === 3 ? " (" + p[1] + ")" : ""); };
function tzOptions(cat, now, cur) {
  const zones = (cat && cat.zones) || [], mine = (cat && cat.browser) || "";
  const opts = [{ value: "", label: now.server ? T("This server's zone ({v1})", { v1: now.server }) : T("This server's zone") }];
  if (mine) opts.push({ value: mine, label: T("{v1} (this browser's zone)", { v1: tzPlace(mine) }) });
  const groups = new Map();
  for (const z of zones) {
    if (!z.includes("/")) { opts.push({ value: z, label: z }); continue; }
    const a = z.split("/")[0];
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push({ value: z, label: tzPlace(z) });
  }
  for (const [group, items] of groups) opts.push({ group, items });
  if (cur && cur !== mine && !zones.includes(cur)) opts.push({ value: cur, label: tzPlace(cur) });
  return opts;
}
const HIST_RES = [300, 900, 3600, 86400];
const histResLabel = n => ({ 300: T("5 minutes"), 900: T("15 minutes"), 3600: T("1 hour"), 86400: T("1 day") }[n] || T("1 hour"));
function HistoryUsage() {
  useStore();
  const u = statsUsage();
  const d = u.data;
  if (!d) return html`<div class="field"><div class="hint">${u.err ? T("Could not read how much disk the traffic history uses.") : T("Measuring the traffic history…")}</div></div>`;
  if (!d.on) return html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Traffic totals are off, so nothing is being counted: {v1}", { v1: d.why_off || "?" })}</span></div>`;
  return html`<div class="field"><div class="hint">
    <div>${T("Traffic history uses {v1} in {v2} ({v3} free on that disk).", { v1: fmtBytes(d.bytes_ledger), v2: d.dir, v3: fmtBytes(d.free_bytes) })}</div>
    <div>${d.basis === "estimate"
      ? T("At {v1} resolution and {v2} active peers it will grow by about {v3} a day ({v4} a year) — an estimate until a full day is recorded.", { v1: histResLabel(d.resolution_next), v2: d.active_slots, v3: fmtBytes(d.per_day_bytes), v4: fmtBytes(d.per_year_bytes) })
      : T("At {v1} resolution and {v2} active peers it grows by about {v3} a day ({v4} a year).", { v1: histResLabel(d.resolution_next), v2: d.active_slots, v3: fmtBytes(d.per_day_bytes), v4: fmtBytes(d.per_year_bytes) })}</div>
    ${!d.infinite ? html`<div>${T("The detail is kept for the last 33 days; totals for any period are always kept.")}</div>` : null}
  </div></div>`;
}
function confirmHistOff(ok) {
  const u = statsUsage().data;
  const d = u && u.on ? u : null;
  openConfirm({ title: T("Turn off infinite history?"), danger: true, confirmLabel: T("Turn off"),
    body: !d ? T("The panel will keep the traffic detail — each day's figures at the history resolution — for the last 33 days only. When you save, older detail is deleted and cannot be recovered. Totals for any period are kept — a day further back still shows, as one figure for the whole day.")
      : d.sweep_days
      ? T("The panel will keep the traffic detail — each day's figures at the history resolution — for the last 33 days only. When you save, the detail of {v1} older days — {v2} — is deleted and cannot be recovered. Totals for any period are kept — a day further back still shows, as one figure for the whole day.", { v1: d.sweep_days, v2: fmtBytes(d.sweep_bytes) })
      : T("The panel will keep the traffic detail — each day's figures at the history resolution — for the last 33 days only. None is older than that yet, so nothing is deleted when you save; from then on, each day's detail is deleted once it is 33 days old. Totals for any period are kept."),
    onConfirm: ok });
}
const sameVer = (a, b) => String(a || "").replace(/^[vV]/, "") === String(b || "").replace(/^[vV]/, "");
export function PanelSettingsScreen() {
  const ps = Store.panelSettings || {};
  const idf = ps.interface_defaults || {}; const mir = ps.mirrors || {}; const adv = ps.advanced || {};
  const declarative = !!((Store.env || {}).declarative);
  const [dns, setDns] = useState((idf.dns || []).join(", "));
  const [mtu, setMtu] = useState(String(idf.mtu || 1280));
  const [ka, setKa] = useState(String(idf.keepalive || 25));
  const [awgDef, setAwgDef] = useState(() => ({ ...(idf.awg_params || {}) }));
  const [reachDef, setReachDef] = useState(idf.reach || "user");
  const [awgGenDef, setAwgGenDef] = useState(idf.awg_gen || DEFAULT_AWG_GEN);
  const awgTrim = o => AWG_KEYS.reduce((a, k) => { const v = String((o || {})[k] ?? "").trim(); if (v) a[k] = v; return a; }, {});
  const [awg3Def, setAwg3Def] = useState(() => ({ ...(idf.awg3_params || {}) }));
  const awg3Trim = o => AWG3_EDIT_COLS.flat().reduce((a, k) => { const v = String((o || {})[k] ?? "").trim(); if (v) a[k] = v; return a; }, {});
  const [awgOpen, setAwgOpen] = useState(false);
  const [geoMir, setGeoMir] = useState(mir.geo || "");
  const [turnMir, setTurnMir] = useState(mir.turn || "");
  const _provReg = Store.catalogProviders || [];
  const [provEnabled, setProvEnabled] = useState(() => Object.fromEntries(_provReg.map(p => [p.id, p.enabled !== false])));
  const _gu = ps.geo_update || {};
  const [guEvery, setGuEvery] = useState(String(_gu.every_days == null ? 1 : _gu.every_days));
  const [guAt, setGuAt] = useState(_gu.at || "04:00");
  const [geoUpdating, setGeoUpdating] = useState(false);
  const updateAllLists = async () => {
    setGeoUpdating(true);
    const r = await api.geoUpdate();
    if (!r || !r.ok) { setGeoUpdating(false); return toast(srvText(r) || T("Couldn't start update"), "err"); }
    const t0 = Date.now();
    const tick = async () => { await Store.poll();
      const busy = (Store.catalogProviders || []).some(p => p.status === "updating");
      if (busy && Date.now() - t0 < 25000) return setTimeout(tick, 1500);
      setGeoUpdating(false); };
    setTimeout(tick, 1500);
  };
  const retryProvider = async (pid) => {
    const r = await api.geoProviderRetry(pid);
    if (!r || !r.ok) return toast(srvText(r) || T("Couldn't retry"), "err");
    const t0 = Date.now();
    const tick = async () => { await Store.poll();
      const busy = (Store.catalogProviders || []).some(p => p.id === pid && p.status === "downloading");
      if (busy && Date.now() - t0 < 25000) return setTimeout(tick, 1500); };
    setTimeout(tick, 1500);
  };
  const cancelProvider = async (pid) => {
    const r = await api.geoProviderCancel(pid);
    if (!r || !r.ok) return toast(srvText(r) || T("Couldn't cancel"), "err");
    setProvEnabled(m => ({ ...m, [pid]: false }));
    await Store.poll();
  };
  const setProvOn = (p, v) => {
    const u = v ? null : providerUsage(p.id);
    if (!u || !u.rules) return setProvEnabled(m => ({ ...m, [p.id]: v }));
    openConfirm({
      title: T("Turn off {v1}?", { v1: provName(p) }), warn: true, confirmLabel: T("Turn it off"),
      body: Trich("*{v1}* is used by {v2} on {v3}. Turning it off hides its lists and stops those rules routing on every node — the rules themselves stay, and start working again when you turn it back on. Nothing reaches the fleet until you save.", {
        v1: provName(p), v2: plural(u.rules, "prep|rule"), v3: plural(u.ifaces, "prep|interface") }),
      onConfirm: () => setProvEnabled(m => ({ ...m, [p.id]: false })),
    });
  };
  const [provFlash, setProvFlash] = useState({});
  const _provSeen = useRef({});
  useEffect(() => {
    const now = Date.now(), seen = _provSeen.current; let next = null;
    for (const p of (Store.catalogProviders || [])) {
      const prev = seen[p.id];
      if (p.status !== prev) {
        if (prev !== undefined && (p.status === "updated" || p.status === "uptodate")) { next = next || { ...provFlash }; next[p.id] = now + 5000; }
        seen[p.id] = p.status;
      }
    }
    if (next) setProvFlash(next);
  }, [Store.catalogProviders]);
  useEffect(() => {
    const exps = Object.values(provFlash).filter(t => t > Date.now());
    if (!exps.length) return;
    const t = setTimeout(() => setProvFlash(f => ({ ...f })), Math.min(...exps) - Date.now() + 50);
    return () => clearTimeout(t);
  }, [provFlash]);
  const _scMode = Store.storeMode || "encrypted";
  const [sc, setSc] = useState(_scMode);
  const [tput, setTput] = useState(ps.throughput_perspective === "peers" ? "peers" : "nodes");
  const [tunit, setTunit] = useState(ps.throughput_units === "bits" ? "bits" : "bytes");
  const [tz, setTz] = useState(ps.time_zone || "");
  const [infHist, setInfHist] = useState(ps.infinite_history !== false);
  const [histRes, setHistRes] = useState(String(ps.history_resolution || 3600));
  const [tzCat, setTzCat] = useState(_tzCat);
  const [staleS, setStaleS] = useState(String(Math.round((adv.node_stale_ms || 30000) / 1000)));
  const [graceS, setGraceS] = useState(String(Math.round((adv.peer_grace_ms || 60000) / 1000)));
  const [ttlD, setTtlD] = useState(String(adv.geo_ttl_days || 3));
  const [topTalk, setTopTalk] = useState(String(ps.top_talkers || 10));
  const [topDest, setTopDest] = useState(String(ps.top_destinations || 10));
  const [warnDays, setWarnDays] = useState(String(ps.expiry_warn_days == null ? 3 : ps.expiry_warn_days));
  const [logEdit, setLogEdit] = useState(null);
  const logBase = ps.log_level || "info";
  const logSaved = () => (ps.log_debug_left ? "debug" : logBase);
  const logShown = logEdit ? logEdit.lvl : logSaved();
  const logForSaved = ps.log_debug_left === -1 ? "-1" : ps.log_debug_left > 3600 ? "86400" : "3600";
  const logForShown = (logEdit && logEdit.for) || logForSaved;
  const logDirty = () => !!logEdit && (logEdit.lvl !== logSaved() || (logEdit.lvl === "debug" && logEdit.for != null));
  const pickLog = v => setLogEdit(v === logSaved() ? null : { lvl: v, for: v === "debug" ? "3600" : null });
  const [logMbP, setLogMbP] = useState(String(ps.log_mb_panel || 100));
  const logMbPDirty = () => logMbP !== String(ps.log_mb_panel || 100);
  const [showLans, setShowLans] = useState(ps.show_node_lans !== false);
  const [scanAllow, setScanAllow] = useState((ps.scan_allow || []).join("\n"));
  const normScanAllow = s => [...new Set(String(s || "").split(/[\s,]+/).filter(Boolean).map(t => (t.includes("/") || t.includes(":")) ? t : t + "/32"))];
  const [blockAllow, setBlockAllow] = useState((ps.block_allow || []).join("\n"));
  const [pok, setPok] = useState((ps.p2p_portok || P2P_PORTOK_DEFAULT).join(", "));
  const nbRead = s => classifyAll(s).map(c => ({ ...c, ok: c.kind === "site" || (c.kind === "ip" && +String(c.value).split("/")[1] >= 8) }));
  const normBlockAllow = s => [...new Set(nbRead(s).map(c => c.ok ? c.value : c.raw.toLowerCase()))];
  const [meshGen, setMeshGen] = useState(ps.mesh_awg_gen || DEFAULT_AWG_GEN);
  const [meshMode, setMeshMode] = useState(ps.mesh_mode || "auto");
  const [lists, setLists] = useState((ps.custom_lists || []).map(l => ({ ...l, _rid: newRid(), targets: customTargets(l) })));
  const [turnEnabledS, setTurnEnabledS] = useState(ps.turn_enabled !== false);
  const [turnForks, setTurnForks] = useState(new Set(ps.enabled_turn_forks || TURN_FORKS_DEFAULT));
  const asThemed = (v, dd, dl) => (v && typeof v === "object") ? { dark: v.dark || dd, light: v.light || dl } : { dark: v || dd, light: v || dl };
  const sameThemed = (a, dd, dl) => (a.dark || "").toLowerCase() === dd.toLowerCase() && (a.light || "").toLowerCase() === dl.toLowerCase();
  const _bprovs = (Store.blockCatalog || {}).providers || [];
  const _provColDefault = p => {
    const c = CAT_PROVIDER_DEFAULTS[p];
    if (c) return { dark: c.color, light: c.colorL };
    const bp = _bprovs.find(x => x.id === p);
    if (bp && bp.color) return { dark: bp.color, light: bp.color_l || bp.color };
    if (p === "custom") return { dark: "#8A94A6", light: "#5E6875" };
    return { dark: "#8FA8C0", light: "#5E7085" };
  };
  const _provColKeys = [..._provReg.map(p => p.id), ..._bprovs.map(p => p.id), "custom"];
  const [provColors, setProvColors] = useState(() => Object.fromEntries([..._provReg.map(p => p.id), "custom"].map(k => [k, asThemed((ps.provider_colors || {})[k], _provColDefault(k).dark, _provColDefault(k).light)])));
  useEffect(() => {
    if (!_bprovs.length) return;
    setProvColors(c => { let ch = false; const n = { ...c }; for (const p of _bprovs) if (n[p.id] === undefined) { n[p.id] = asThemed((ps.provider_colors || {})[p.id], p.color, p.color_l || p.color); ch = true; } return ch ? n : c; });
  }, [Store.blockCatalog]);
  const provColorOverrides = () => { const o = {}; for (const k of _provColKeys) { const d = _provColDefault(k); const t = asThemed(provColors[k], d.dark, d.light); if (!sameThemed(t, d.dark, d.light)) o[k] = t; } return o; };
  const [customEnabled, setCustomEnabled] = useState(ps.custom_lists_enabled !== false);
  const [forkColors, setForkColors] = useState(() => Object.fromEntries(turnForkList().map(f => [f.id, asThemed((ps.turn_fork_colors || {})[f.id], f.color, f.colorL)])));
  const _tu = ps.turn_update || {};
  const [tuEvery, setTuEvery] = useState(String(_tu.every_days == null ? 0 : _tu.every_days));
  const [tuAt, setTuAt] = useState(_tu.at || "04:00");
  const [themeColorS, setThemeColorS] = useState(clampBrand(ps.theme_color || THEME_COLOR_DEFAULT, false));
  const [themeColorLightS, setThemeColorLightS] = useState(clampBrand(ps.theme_color_light || THEME_COLOR_LIGHT_DEFAULT, true));
  const themeVal = { dark: themeColorS, light: themeColorLightS };
  const _sc = ps.status_conditions || {};
  const [statusConds, setStatusConds] = useState({ blocked: _sc.blocked !== false, faulty: _sc.faulty !== false });
  const [ivkEscrow, setIvkEscrow] = useState(null);
  const [ivkEscrowInit, setIvkEscrowInit] = useState(null);
  const [ivkVaultExists, setIvkVaultExists] = useState(null);
  useEffect(() => { api.subVault().then(r => { const okd = !!(r && r.ok && r.data); const on = okd && !!r.data.ivk_enabled; setIvkEscrow(on); setIvkEscrowInit(on); setIvkVaultExists(okd ? !!r.data.exists : false); }).catch(() => setIvkVaultExists(false)); }, []);
  const forkOvFrom = src => { const o = {}; for (const f of turnForkList()) { const t = asThemed((src || {})[f.id], f.color, f.colorL); if (!sameThemed(t, f.color, f.colorL)) o[f.id] = t; } return o; };
  const forkColorOverrides = () => forkOvFrom(forkColors);
  const statusCondsOut = () => ({ blocked: statusConds.blocked, faulty: statusConds.faulty });
  const themeColorOut = () => themeColorS.toLowerCase() === THEME_COLOR_DEFAULT.toLowerCase() ? "" : themeColorS;
  const themeColorLightOut = () => themeColorLightS.toLowerCase() === THEME_COLOR_LIGHT_DEFAULT.toLowerCase() ? "" : themeColorLightS;
  const csqttOtherLine = w => !!(w && w.kind === "csqtt" && w.line && w.line !== "2.1");
  const settingsForks = () => turnForkList().filter(f => !f.hidden || forkNodeStates(f.id, true).length);
  const forkVersions = (fid, all) => { const v = new Set();
    for (const snap of Object.values(Store.stats || {})) {
      for (const tp of (snap.turn_proxies || [])) if (tp.service && turnFork(tp.service) === fid && tp.version) v.add(tp.version);
      for (const w of [...(snap.wdtt || []), ...(snap.csqtt || [])]) if (w && w.fork === fid && (all || !csqttOtherLine(w))) v.add(w.version || "installed");
    }
    return [...v]; };
  const forkNodeStates = (fid, all) => {
    const m = {};
    for (const [nid, snap] of Object.entries(Store.stats || {})) {
      for (const tp of (snap.turn_proxies || [])) {
        if (!tp.service || turnFork(tp.service) !== fid) continue;
        const cur = m[nid] || { version: "", installing: false, updatePending: false };
        if (tp.version) cur.version = tp.version;
        if (tp.installing) cur.installing = true;
        const uk = nid + "|" + tp.service;
        if (turnUpdating[uk] && Date.now() < turnUpdating[uk]) cur.updatePending = true;
        m[nid] = cur;
      }
      for (const w of [...(snap.wdtt || []), ...(snap.csqtt || [])]) {
        if (!w || w.fork !== fid || (!all && csqttOtherLine(w))) continue;
        const line = all && csqttOtherLine(w) ? w.line : "", k = line ? nid + "@" + line : nid;
        const cur = m[k] || { version: "", installing: false, updatePending: false, ...(line ? { node: nid, line } : {}) };
        cur.version = w.version || cur.version || "installed";
        if (w.active && w.active !== "active") cur.installing = true;
        m[k] = cur;
      }
    }
    return Object.entries(m).map(([node, v]) => ({ node, ...v })).sort((a, b) => Store.byNode(a.node, b.node) || String(a.line || "").localeCompare(String(b.line || "")));
  };
  const [turnCheck, setTurnCheck] = useState({});
  const checkTurnUpdates = async () => {
    const rows = settingsForks();
    setTurnCheck(Object.fromEntries(rows.map(f => [f.id, { status: "checking" }])));
    const r = await api.turnCheckUpdates({ forks: rows.map(f => ({ id: f.id, owner: f.owner })) });
    const latest = (r && r.ok && r.data.latest) || {};
    const next = {};
    for (const f of rows) {
      const lt = latest[f.id] || "", dep = forkVersions(f.id);
      next[f.id] = (lt && dep.length && dep.some(v => !sameVer(v, lt))) ? { status: "update", latest: lt } : { status: "uptodate" };
    }
    setTurnCheck(next);
    setTimeout(() => setTurnCheck(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.status === "update" || v.status === "updating" ? v : {}]))), 5000);
  };
  const turnFollow = Object.values(turnCheck).some(v => v && v.status === "updating" && v.until);
  useEffect(() => {
    if (!turnFollow) return;
    return bus.sub(() => setTurnCheck(c => {
      const n = { ...c };
      for (const [fid, v] of Object.entries(c)) {
        if (!v || v.status !== "updating" || !v.until) continue;
        const st = forkNodeStates(fid).filter(s => canTurnAct(s.node));
        if (st.length && st.every(s => sameVer(s.version, v.latest) && !s.installing)) n[fid] = { status: "updated" };
        else if (Date.now() > v.until) n[fid] = {};
      }
      return n;
    }));
  }, [turnFollow]);
  const turnDone = Object.keys(turnCheck).filter(k => (turnCheck[k] || {}).status === "updated").join();
  useEffect(() => {
    if (!turnDone) return;
    const t = setTimeout(() => setTurnCheck(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v && v.status === "updated" ? {} : v]))), 5000);
    return () => clearTimeout(t);
  }, [turnDone]);
  const canTurnAct = nid => { const n = (Store.nodes || []).find(x => x.id === nid); return !!(n && n.turn_manage && n.turn_arch_ok !== false); };
  const skipNote = skipped => { if (skipped) toast(T("{v1} skipped — turn-proxy management is off there, or their architecture has no published build.", { v1: plural(skipped, "node") }), "err"); };
  const updateFork = async (fid, latest) => {
    const fork = turnForkList().find(x => x.id === fid) || {};
    if (fork.kind === "csqtt") {
      const all = [];
      for (const [nid, snap] of Object.entries(Store.stats || {})) for (const c of (snap.csqtt || [])) if (c && c.iface && !csqttOtherLine(c)) all.push({ node: nid, iface: c.iface });
      const ct = all.filter(t => canTurnAct(t.node));
      const cskip = new Set(all.filter(t => !canTurnAct(t.node)).map(t => t.node)).size;
      if (!ct.length) { skipNote(cskip); return; }
      setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest } }));
      turnUpdateTarget[fid] = { ver: latest, until: Date.now() + 120000 };
      const seen = new Set();
      for (const t of ct) { if (seen.has(t.node)) continue; seen.add(t.node); await api.csqttVersion({ node: t.node, iface: t.iface, ver: "" }); }
      setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest, until: Date.now() + 120000 } }));
      await Store.poll();
      toast(T("Update requested on {v1} — each node applies it on its next sync.", { v1: plural(seen.size, "node") }), "ok");
      skipNote(cskip);
      return;
    }
    if (fork.kind === "wdtt") {
      const all = [];
      for (const [nid, snap] of Object.entries(Store.stats || {})) for (const w of (snap.wdtt || [])) if (w && w.fork === fid && w.iface) all.push({ node: nid, iface: w.iface });
      const wt = all.filter(t => canTurnAct(t.node));
      const wskip = new Set(all.filter(t => !canTurnAct(t.node)).map(t => t.node)).size;
      if (!wt.length) { skipNote(wskip); return; }
      setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest } }));
      turnUpdateTarget[fid] = { ver: latest, until: Date.now() + 120000 };
      for (const t of wt) await api.wdttVersion({ node: t.node, iface: t.iface, ver: "" });
      setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest, until: Date.now() + 120000 } }));
      await Store.poll();
      toast(T("Update requested on {v1} — each node applies it on its next sync.", { v1: plural(wt.length, "WDTT server") }), "ok");
      skipNote(wskip);
      return;
    }
    const owner = fork.owner || "";
    const all = [];
    for (const [nid, snap] of Object.entries(Store.stats || {})) for (const tp of (snap.turn_proxies || [])) if (tp.service && turnFork(tp.service) === fid) all.push({ node: nid, service: tp.service });
    const targets = all.filter(t => canTurnAct(t.node));
    const skipped = new Set(all.filter(t => !canTurnAct(t.node)).map(t => t.node)).size;
    if (!targets.length) { skipNote(skipped); return; }
    setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest } }));
    turnUpdateTarget[fid] = { ver: latest, until: Date.now() + 120000 };
    for (const t of targets) { turnUpdating[t.node + "|" + t.service] = Date.now() + 120000; await api.turnReinstall({ node: t.node, service: t.service, owner }); }
    setTurnCheck(c => ({ ...c, [fid]: { status: "updating", latest, until: Date.now() + 120000 } }));
    await Store.poll();
    toast(T("Update requested on {v1} — each node applies it on its next sync.", { v1: plural(targets.length, "proxy") }), "ok");
    skipNote(skipped);
  };
  const [secUser, setSecUser] = useState(""); const [secOrigUser, setSecOrigUser] = useState("");
  const [secCur, setSecCur] = useState(""); const [secNp, setSecNp] = useState(""); const [secNp2, setSecNp2] = useState("");
  const [secAuth, setSecAuth] = useState(true);
  useEffect(() => { api.account().then(r => { if (r && r.ok) { setSecAuth(r.data.auth_enabled !== false); if (r.data.username) { setSecUser(r.data.username); setSecOrigUser(r.data.username); } } }); }, []);
  const secChanged = () => secAuth && (secUser.trim() !== secOrigUser || !!secNp);
  const [exitWhy, setExitWhy] = useState({});
  const exitErr = () => {
    for (const n of (Store.nodes || [])) {
      const ex = (nodeEdits[n.id] || {}).exits || [];
      const msg = ex.some(x => (x.producer || "adopted") !== "imported" && !String(x.device || "").trim())
        ? T("Choose a device for the new exit, or remove it.")
        : ex.some(x => x.producer === "imported" && x.provider === "profile"
                       && !String(x.profile_text || "").trim() && !(x.profile && x.profile.address))
        ? T("Paste a WireGuard profile for the new exit, or remove it.") : (exitWhy[n.id] || "");
      if (msg) return n.id === selNode ? msg : (n.name + " — " + msg);
    }
    return "";
  };
  const secErr = () => {
    if (!secAuth || !secChanged()) return null;
    if (!secUser.trim()) return T("Username can't be empty.");
    if (secUser.includes(":")) return T("Username can't contain a colon.");
    if (!secCur) return T("Enter your current password to confirm the change.");
    if (secNp && secNp !== secNp2) return T("New passwords don't match.");
    if (secNp && secNp.length < 8) return T("New password must be at least 8 characters.");
    return null;
  };
  const [section, setSection] = useState(takePendingSection() || (isMobile() ? null : "display"));
  useEffect(() => { registerSectionSetter(setSection); return () => registerSectionSetter(null); }, []);
  const [routeTab, setRouteTab] = useState("routing");
  useEffect(() => { if (routeTab === "blocking" || section === "geo") loadBlockCatalog(); }, [routeTab, section]);
  useEffect(() => {
    if (section !== "display" || _tzCat) return;
    let live = true;
    api.get("/api/time-zones?browser=" + encodeURIComponent(browserZone()))
      .then(r => { if (r && r.ok) { _tzCat = r.data; if (live) setTzCat(r.data); } }).catch(() => {});
    return () => { live = false; };
  }, [section]);
  const _bkCountTries = useRef(0);
  useEffect(() => {
    if (section !== "routing" || routeTab !== "blocking") return;
    const bc = Store.blockCatalog; if (!bc) return;
    const on = new Set((bc.providers || []).filter(p => p.enabled !== false).map(p => p.id));
    const pending = Object.values(bc.categories || {}).some(c => (c.sources || []).some(s => s.n == null && on.has(s.provider)));
    if (!pending) _bkCountTries.current = 0;
    const delay = pending ? Math.min(30000, 4000 * 2 ** Math.floor(_bkCountTries.current / 3)) : 15000;
    const t = setTimeout(() => { _bkCountTries.current++; loadBlockCatalog(true); }, delay);
    return () => clearTimeout(t);
  }, [section, routeTab, Store.blockCatalog]);
  const [blockProvEdits, setBlockProvEdits] = useState({});
  const blockCatalogStatus = loading => Store.blockCatalogError ? html`<div class="hint warnish">
    ${T("Could not load the block-list catalog.")}
    <button class="btn btn-mini" onClick=${() => loadBlockCatalog(true)}>${T("Retry")}</button>
  </div>` : html`<div class="hint">${loading}</div>`;
  const [geoTab, setGeoTab] = useState("routing");
  const [blockEdits, setBlockEdits] = useState({});
  const [bkOpen, setBkOpen] = useState({});
  const [blockRemoved, setBlockRemoved] = useState([]);
  const [bkAutoAdd, setBkAutoAdd] = useState(null);
  const rsv = ps.reserved || {};
  const [rsvSubnet, setRsvSubnet] = useState(rsv.mesh_subnet || "10.255.0.0/16");
  const [rsvPort, setRsvPort] = useState(String(rsv.mesh_port_base || 9999));
  const [rsvPrefix, setRsvPrefix] = useState(rsv.iface_prefix || "swg_");
  const [awg, setAwg] = useState(ps.mesh_awg || {});
  const [showAwg, setShowAwg] = useState(false);
  const awgSet = [...AWG_KEYS, ...AWG3_EDIT_COLS.flat()].some(k => String(awg[k] ?? "").trim() !== "");
  const meshTpl = o => Object.fromEntries(Object.entries(o || {}).map(([k, x]) => [k, String(x ?? "").trim()]).filter(([, x]) => x));
  const [showAdv, setShowAdv] = useState(false);
  const [msg, setMsg] = useState(null);
  const subCfg = ps.subscriptions || {};
  const [subsOn, setSubsOn] = useState(!!subCfg.enabled);
  const [autoGen, setAutoGen] = useState(!!subCfg.auto_generate);
  const subLangCfg = (subCfg.languages && typeof subCfg.languages === "object") ? subCfg.languages : {};
  const [subLangs, setSubLangs] = useState((subLangCfg.enabled && subLangCfg.enabled.length) ? [...subLangCfg.enabled] : ["en"]);
  const [subLangDef, setSubLangDef] = useState(subLangCfg.default || "en");
  const toggleSubLang = (id, on) => {
    let next = on ? [...new Set([...subLangs, id])] : subLangs.filter(l => l !== id);
    if (!next.length) next = [id];
    setSubLangs(next);
    if (next.indexOf(subLangDef) < 0) setSubLangDef(next[0]);
  };
  const eq = (a, b) => { const c = v => v == null ? "" : Array.isArray(v) ? JSON.stringify([...v].sort()) : typeof v === "object" ? JSON.stringify(Object.keys(v).sort().reduce((o, k) => (o[k] = v[k], o), {})) : String(v); return c(a) === c(b); };
  const nFields = n => ({ routing_mode: n.routing_mode || "kernel", ip_learning: n.ip_learning !== false, endpoint_host: n.endpoint_host || "",
    log_mb: String(n.log_mb || 100),
    mesh_subnet: n.mesh_subnet || "", mesh_port: n.mesh_port ? String(n.mesh_port) : "", mesh_prefix: n.mesh_prefix || "",
    default_egress_ip: n.default_egress_ip || "", panel_ip: n.panel_ip || "", mesh_egress_ip: n.mesh_egress_ip || "",
    default_exit: n.default_exit || "",
    default_routing: Array.isArray(n.default_routing) ? normRules(n.default_routing) : null,
    default_routing_exit_ips: { ...(n.default_routing_exit_ips || {}) },
    p2p: n.p2p && n.p2p.action ? { action: n.p2p.action, ...(n.p2p.node ? { node: n.p2p.node } : {}),
                                   ...(n.p2p.exit_id ? { exit_id: n.p2p.exit_id } : {}) } : null,
    p2p_portok: Array.isArray(n.p2p_portok) ? n.p2p_portok.join(", ") : null,
    endpoint_hosts: [...(n.endpoint_hosts || [])],
    catalog_cats: [...(n.catalog_cats || [])],
    exits: (n.exits || []).map(x => ({ id: x.id || "", label: x.label || "", producer: x.producer || "adopted",
      device: x.device || "", enabled: x.enabled !== false, killswitch: !!x.killswitch,
      ...(x.producer === "imported" ? {} : { egress_ip: x.egress_ip || "", gw: x.gw || "" }),
      ...(x.producer === "imported" ? { provider: x.provider || "warp", licence: x.licence || "",
                                        dial_src: x.dial_src || "",
                                        profile: x.profile || null, profile_text: "",
                                        ...(x.socks ? { socks: x.socks, socks_text: "", socks_pass: "" } : {}) } : {}) })) });
  const [nodeEdits, setNodeEdits] = useState(() => Object.fromEntries((Store.nodes || []).map(n => [n.id, nFields(n)])));
  const [orig, setOrig] = useState(() => Object.fromEntries((Store.nodes || []).map(n => [n.id, nFields(n)])));
  const [gridKeep, setGridKeep] = useState([]);
  const setNV = (nid, patch) => setNodeEdits(e => ({ ...e, [nid]: { ...nFields((Store.nodes || []).find(n => n.id === nid) || {}), ...(e[nid] || {}), ...patch } }));
  const nv = (nid, f) => (nodeEdits[nid] || nFields((Store.nodes || []).find(n => n.id === nid) || {}))[f];
  const rebaseDefault = (nid, fresh) => {
    const live = new Set((fresh.exits || []).map(x => String(x.id)));
    setNodeEdits(e => { const cur = e[nid] || {}, o = orig[nid] || {};
      let dr = cur.default_routing;
      if (Array.isArray(dr)) dr = eq(dr, o.default_routing) ? fresh.default_routing
        : dr.map(r => r && r.action === "dev" && !live.has(String(r.exit_id || "")) ? (({ exit_id, ...x }) => ({ ...x, action: "direct" }))(r) : r);
      const p2p = eq(cur.p2p, o.p2p) ? fresh.p2p
        : cur.p2p && cur.p2p.action === "dev" && !live.has(String(cur.p2p.exit_id || "")) ? { action: "block" } : cur.p2p;
      return { ...e, [nid]: { ...cur, default_routing: dr, default_exit: eq(cur.default_exit, o.default_exit) ? fresh.default_exit : cur.default_exit, p2p } }; });
    setOrig(o => ({ ...o, [nid]: { ...(o[nid] || {}), default_routing: fresh.default_routing, default_exit: fresh.default_exit, p2p: fresh.p2p } }));
  };
  const [saved, setSaved] = useState(0);
  const save = async () => {
    try {
    if (SECTIONS.some(([s]) => glDirty(s))) {
      const dirtySecs = SECTIONS.filter(([s]) => glDirty(s)), secLabel = Object.fromEntries(SECTIONS);
      const r = await api.panelSettings({
        _ev: { first: (dirtySecs[0] || [""])[0], sections: dirtySecs.map(([s]) => secLabel[s]).join(", ") },
        interface_defaults: { dns: dns.split(",").map(s => s.trim()).filter(Boolean), mtu: +mtu || 1280, keepalive: +ka || 25,
          awg_params: awgTrim(awgDef), reach: reachDef, awg_gen: awgGenDef,
          ...(Object.keys(awg3Trim(awg3Def)).length || Object.keys(awg3Trim(idf.awg3_params)).length ? { awg3_params: awg3Trim(awg3Def) } : {}) },
        mirrors: { geo: geoMir.trim(), turn: turnMir.trim() },
        providers: provEnabled,
        block_providers: blockProvEdits,
        provider_colors: provColorOverrides(),
        custom_lists_enabled: customEnabled,
        geo_update: { every_days: Math.max(0, Math.min(30, parseInt(guEvery) || 0)), at: guAt },
        store_configs: sc === "off" ? "off" : "encrypted",
        subscriptions: { enabled: subsOn, auto_generate: autoGen,
          languages: { enabled: subLangs, default: subLangDef } },
        throughput_perspective: tput,
        throughput_units: tunit,
        time_zone: tz,
        infinite_history: infHist,
        history_resolution: +histRes || 3600,
        top_talkers: Math.max(1, Math.min(50, parseInt(topTalk) || 10)),
        top_destinations: Math.max(1, Math.min(50, parseInt(topDest) || 10)),
        expiry_warn_days: Math.max(0, Math.min(365, parseInt(warnDays) || 3)),
        show_node_lans: showLans,
        scan_allow: normScanAllow(scanAllow),
        block_allow: normBlockAllow(blockAllow),
        ...(pokDirty() ? { p2p_portok: (r => !r.bad.length && portokSame(r.list, P2P_PORTOK_DEFAULT) ? null : pok)(portokRead(pok)) } : {}),
        mesh_mode: meshMode,
        mesh_awg_gen: meshGen,
        reserved: { mesh_subnet: rsvSubnet.trim(), mesh_port_base: +rsvPort || 9999, iface_prefix: rsvPrefix.trim() || "swg_" },
        mesh_awg: awgSet ? awg : {},
        advanced: { node_stale_ms: (+staleS || 30) * 1000, peer_grace_ms: (+graceS || 60) * 1000, geo_ttl_days: +ttlD || 3 },
        custom_lists: lists.map(({ _rid, domains, cidrs, asns, ...l }) => l),
        turn_enabled: turnEnabledS,
        turn_update: { every_days: Math.max(0, Math.min(30, parseInt(tuEvery) || 0)), at: tuAt },
        enabled_turn_forks: [...turnForks],
        turn_fork_colors: forkColorOverrides(),
        status_conditions: statusCondsOut(),
        theme_color: themeColorOut(),
        theme_color_light: themeColorLightOut(),
        ...(logDirty() ? { log_level: logEdit.lvl === "debug" ? logBase : logEdit.lvl,
                           log_debug: logEdit.lvl === "debug" ? +logForShown : 0 } : {}),
        ...(logMbPDirty() ? { log_mb_panel: +logMbP } : {}),
      });
      if (!r.ok) return setMsg({ ok: false, t: srvText(r) || T("Failed to save.") });
      if (logEdit) { await Store.poll(); setLogEdit(null); }
      if (dataDirty() || tzDirty()) trafficInvalidate();
    }
    if (ivkEscrow !== null && ivkEscrow !== ivkEscrowInit) {
      if (ivkEscrow && !subSKCached()) {
        const ok = await new Promise(res => pushModal(html`<${VaultPromptSheet} opts=${{ title: T("Unlock to enable escrow"), reason: T("Enabling interface-key escrow seals each server's interface key under your Encryption Vault key. Unlock it to apply.") }} onDone=${res}/>`));
        if (!ok || !subSKCached()) return setMsg({ ok: false, t: T("Enabling key escrow needs the Encryption Vault unlocked.") });
      }
      try { await ivkSetEscrow(ivkEscrow); setIvkEscrowInit(ivkEscrow); }
      catch (e) { return setMsg({ ok: false, t: (e && e.message) || T("Couldn't update key escrow.") }); }
    }
    const dSub = rsvSubnet.trim(), dPort = String(+rsvPort || 9999), dPfx = rsvPrefix.trim() || "swg_";
    let nerr = null;
    for (const n of (Store.nodes || [])) {
      const e = nodeEdits[n.id] || {}, o = orig[n.id] || {};
      if (!Object.keys(nFields(n)).some(k => !eq(e[k], o[k]))) continue;
      const nr = await api.nodeUpdate({ id: n.id, routing_mode: e.routing_mode, ip_learning: e.ip_learning !== false, endpoint_host: (e.endpoint_host || "").trim(),
        mesh_subnet: (e.mesh_subnet || "").trim() === dSub ? "" : (e.mesh_subnet || "").trim(),
        mesh_port: (e.mesh_port || "").trim() === dPort ? "" : (e.mesh_port || "").trim(),
        mesh_prefix: (e.mesh_prefix || "").trim() === dPfx ? "" : (e.mesh_prefix || "").trim(),
        default_egress_ip: e.default_egress_ip || "", panel_ip: e.panel_ip || "", default_exit: e.default_exit || "",
        default_routing: Array.isArray(e.default_routing) ? e.default_routing : null,
        default_routing_exit_ips: e.default_routing_exit_ips || {},
        p2p: e.p2p || null,
        p2p_portok: e.p2p_portok ?? null,
        mesh_egress_ip: e.mesh_egress_ip || "",
        endpoint_hosts: (e.endpoint_hosts || []).map(h => (h || "").trim()).filter(Boolean),
        catalog_cats: e.catalog_cats || [], exits: e.exits || [], log_mb: +e.log_mb || 100 });
      if (!nr.ok) nerr = srvText(nr) || (T("Couldn't save {v1}", { v1: n.name }));
      else reportDropped(nr);
    }
    if (nerr) return setMsg({ ok: false, t: nerr });
    if (Object.keys(blockEdits).length || blockRemoved.length) {
      const br = await api.blockCatalogSave({ categories: blockEdits, removed: blockRemoved });
      if (!br.ok) return setMsg({ ok: false, t: srvText(br) || T("Couldn't save block lists.") });
      await loadBlockCatalog(true); setBlockEdits({}); setBlockRemoved([]);
    }
    if (Object.keys(blockProvEdits).length) { await loadBlockCatalog(true); setBlockProvEdits({}); }
    if (secChanged()) {
      let reWrapped = false;
      if (secNp) {
        if (!subSKCached()) { try { await subUnlock(secCur); } catch (_) {} }
        if (subSKCached()) { try { reWrapped = await subRewrap(secNp); } catch (_) { reWrapped = false; } }
      }
      const ar = await api.accountSave({ username: secUser.trim(), current_password: secCur, new_password: secNp });
      if (!ar.ok) {
        if (reWrapped) { try { await subRewrap(secCur); } catch (_) {} }
        return setMsg({ ok: false, t: srvText(ar) || T("Couldn't update credentials.") });
      }
      setMsg({ ok: true, t: T("Saved. Reloading — sign in with your new credentials…") });
      return setTimeout(() => location.reload(), 1400);
    }
    setMsg(null); setSaved(Date.now() + 4000);
    await Store.poll();
    setScanAllow((((Store.panelSettings) || {}).scan_allow || []).join("\n"));
    setBlockAllow((((Store.panelSettings) || {}).block_allow || []).join("\n"));
    setPok((((Store.panelSettings) || {}).p2p_portok || P2P_PORTOK_DEFAULT).join(", "));
    const fresh = Object.fromEntries((Store.nodes || []).map(n => [n.id, nFields(n)]));
    setNodeEdits(fresh); setOrig(fresh);
    } catch (e) {
      setMsg({ ok: false, t: T("Couldn't save — {v1}", { v1: (e && e.message) || T("the panel didn't respond. Nothing was lost; try again.") }) });
    }
  };
  const REPROV_WARN = T("Heads up: changing a node's mesh subnet, interface prefix, or AWG params re-provisions its mesh links — it briefly drops off the mesh while every peer pulls the new config and reconnects.");
  const diffList = () => {
    const out = [];
    if (listsJSON(lists) !== listsJSON(ps.custom_lists || [])) out.push(T("Custom lists"));
    if (Object.keys(blockEdits).length || blockRemoved.length) out.push(T("Content filters — categories / lists"));
    if (secChanged()) out.push(T("Authentication — panel credentials"));
    if (glDirty("turn")) out.push(T("Turn proxies — forks / colours / VK link"));
    if (geoDirty()) out.push(T("Geo data providers"));
    if (glDirty("defaults")) out.push(T("Interfaces — colours / defaults"));
    if (glDirty("configs")) out.push(T("Client configs → {v1}", { v1: sc === "off" ? T("val|off") : T("val|encrypted") }));
    if (glDirty("subs")) out.push(T("Subscriptions — enable / languages"));
    if (dispDirty()) out.push(T("Display — theme / status timing"));
    if (logDirty()) out.push(logShown === "off" ? T("Logging — off: swg's stored logs are deleted") : T("Logging — {v1}", { v1: logLevelLabel(logShown) }));
    if (logMbPDirty()) out.push(T("Panel log budget → {v1} MB", { v1: logMbP }));
    if (tzDirty()) out.push(tz ? T("Days are counted in {v1}", { v1: tz }) : T("Days are counted in this server's zone"));
    if (infHist !== (ps.infinite_history !== false)) out.push(infHist ? T("Infinite history — on") : T("Infinite history — off: detail older than 33 days is deleted"));
    if (histRes !== String(ps.history_resolution || 3600)) out.push(T("History resolution → {v1}, from the next day", { v1: histResLabel(+histRes) }));
    if (showLans !== (ps.show_node_lans !== false)) out.push(showLans ? T("Node local networks — shown in the panel") : T("Node local networks — hidden, and closed on every node"));
    if (normScanAllow(scanAllow).join(",") !== (ps.scan_allow || []).join(",")) out.push(T("Port-scan guard — trusted sources updated"));
    if (nbDirty()) out.push(T("Never-block list updated"));
    if (pokDirty()) out.push(T("Ports the torrent filter never cuts — updated"));
    if (meshMode !== (ps.mesh_mode || "auto")) out.push(T("Mesh links — {v1}", { v1: meshModeLabel(meshMode, ps.mesh_auto_max) }));
    if (meshGen !== (ps.mesh_awg_gen || DEFAULT_AWG_GEN)) out.push(T("Mesh link type → {v1}, for new links", { v1: meshGenLabel(meshGen) }));
    if (glDirty("links") && (rsvSubnet !== (rsv.mesh_subnet || "10.255.0.0/16") || rsvPort !== String(rsv.mesh_port_base || 9999) || rsvPrefix !== (rsv.iface_prefix || "swg_") || !eq(meshTpl(awgSet ? awg : {}), meshTpl(ps.mesh_awg)))) out.push(T("System mesh defaults"));
    for (const n of (Store.nodes || [])) {
      const e = nodeEdits[n.id] || {}, o = orig[n.id] || {}, fl = [];
      if (!eq(e.routing_mode, o.routing_mode))
        fl.push(T("mode → {v1}", { v1: (MODE_META[e.routing_mode || "kernel"] || {}).label || e.routing_mode }));
      if (!eq(e.ip_learning !== false, o.ip_learning !== false)) fl.push(T("IP learning → {v1}", { v1: e.ip_learning !== false ? T("val|on") : T("val|off") }));
      if (!eq(e.endpoint_host, o.endpoint_host)) fl.push(T("ingress address → {v1}", { v1: e.endpoint_host || T("val|auto") }));
      if (!eq(e.mesh_subnet, o.mesh_subnet)) fl.push(T("mesh subnet → {v1}", { v1: e.mesh_subnet || T("val|default") }));
      if (!eq(e.mesh_port, o.mesh_port)) fl.push(T("mesh port → {v1}", { v1: e.mesh_port || T("val|default") }));
      if (!eq(e.mesh_prefix, o.mesh_prefix)) fl.push(T("prefix → {v1}", { v1: e.mesh_prefix || T("val|default") }));
      if (!eq(e.default_egress_ip, o.default_egress_ip)) fl.push(T("egress IP → {v1}", { v1: e.default_egress_ip || T("val|auto") }));
      if (!eq(e.default_exit, o.default_exit)) fl.push(T("default exit"));
      if (!eq(e.default_routing, o.default_routing) && (Array.isArray(e.default_routing) || eq(e.default_exit, o.default_exit)))
        fl.push(Array.isArray(e.default_routing) ? T("default routing rules") : T("default exit"));
      if (!eq(e.default_routing_exit_ips, o.default_routing_exit_ips)) fl.push(T("default routing exit addresses"));
      if (!eq(e.p2p, o.p2p)) fl.push(T("torrents → {v1}", { v1: p2pLabel(e.p2p, e.exits || n.exits, n) }));
      if (!eq(e.p2p_portok, o.p2p_portok)) fl.push(e.p2p_portok == null ? T("never-cut ports → the fleet's list") : T("never-cut ports → {v1}", { v1: e.p2p_portok }));
      if (!eq(e.panel_ip, o.panel_ip)) fl.push(T("panel IP → {v1}", { v1: e.panel_ip || T("val|auto") }));
      if (!eq(e.mesh_egress_ip, o.mesh_egress_ip)) fl.push(T("mesh egress IP → {v1}", { v1: e.mesh_egress_ip || T("val|auto") }));
      if (!eq((e.endpoint_hosts || []).filter(Boolean), (o.endpoint_hosts || []).filter(Boolean))) fl.push(T("other names"));
      if (!eq(e.catalog_cats, o.catalog_cats)) fl.push(T("catalog categories"));
      if (!eq(e.exits, o.exits)) fl.push(T("external exits"));
      if (!eq(e.log_mb, o.log_mb)) fl.push(T("log budget → {v1} MB", { v1: e.log_mb }));
      if (fl.length) out.push(n.name + " — " + fl.join(", "));
    }
    return out;
  };
  const needsReprov = () => (Store.nodes || []).some(n => { const e = nodeEdits[n.id] || {}, o = orig[n.id] || {}; return !eq(e.mesh_subnet, o.mesh_subnet) || !eq(e.mesh_prefix, o.mesh_prefix); });
  const confirmSave = () => {
    const _blk = [selNode].filter(Boolean).map(nid => [nid, Array.isArray((nodeEdits[nid] || {}).default_routing) ? nodeListBlock(nid, nodeEdits[nid].default_routing) : null])
      .find(([, why]) => why);
    if (_blk) { toast(T("{v1}: {v2}", { v1: ((Store.nodes || []).find(n => n.id === _blk[0]) || {}).name || _blk[0], v2: _blk[1] }), "err"); return; }
    const _lbBad = [logMbPDirty() && logMbBad(logMbP) ? T("Panel") : null,
      ...(Store.nodes || []).map(n => (nodeEdits[n.id] && !eq(nodeEdits[n.id].log_mb, (orig[n.id] || {}).log_mb) && logMbBad(nodeEdits[n.id].log_mb)) ? n.name : null)].filter(Boolean);
    if (_lbBad.length) { toast(T("{v1}: the log budget must be at least {v2} MB", { v1: _lbBad.join(", "), v2: LOG_MB_MIN }), "err"); return; }
    const ch = diffList();
    if (!ch.length) { toast(T("No changes to save."), "ok"); return; }
    const rp = needsReprov();
    openConfirm({ title: T("Save settings"), confirmLabel: T("Save"), busyLabel: T("Saving…"), warn: rp, onConfirm: save,
      body: html`<div class="savediff"><div class="savediff-h">${T("{v1} to apply:", { v1: plural(ch.length, "change") })}</div><ul>${ch.map(c => html`<li>${c}</li>`)}</ul>${rp ? html`<div class="savediff-w">${REPROV_WARN}</div>` : null}</div>`,
      note: html`<div class="savediff-note">${T("Applying can take up to a minute — the nodes reconfigure and re-pull their lists. This stays open until it finishes.")}</div>` });
  };
  const refreshGeo = async () => { const r = await api.refreshGeo(); toast(r.ok ? T("Geo lists will refresh on each node's next sync.") : (srvText(r) || T("Failed")), r.ok ? "ok" : "err"); };
  const persistLists = async newLists => {
    setLists(newLists);
    const r = await api.panelSettings({ custom_lists: newLists.map(({ _rid, domains, cidrs, asns, patterns, ...l }) => l) });
    if (!r.ok) return setMsg({ ok: false, t: srvText(r) || T("Couldn't save the list.") });
    reportDropped(r);
    await Store.poll();
    const ridById = Object.fromEntries(newLists.filter(l => l.id).map(l => [l.id, l._rid]));
    setLists(((Store.panelSettings || {}).custom_lists || []).map(l => ({ ...l, _rid: ridById[l.id] || newRid(), targets: customTargets(l) })));
    setSaved(Date.now() + 2500);
  };
  const saveList = l => persistLists(lists.some(x => x._rid === l._rid)
    ? lists.map(x => (x._rid === l._rid ? l : x)) : [...lists, l]);
  const confirmDeleteList = l => openConfirm({ title: T("Delete custom list"), confirmLabel: T("Delete"), danger: true,
    body: Trich("Delete *{v1}*? It's removed from *every node* it's enabled on, and its interface rules stop matching on the next sync. This can't be undone.", { v1: l.title || T("Untitled list") }),
    onConfirm: () => persistLists(lists.filter(x => x._rid !== l._rid)) });
    const SECTIONS = [["display", "Display"], ["security", "Authentication"], ["configs", "Client configs"], ["subs", "Subscriptions"], ["mesh", "Network"], ["links", "Mesh"], ["exits", "SOCKS5 exits"], ["defaults", "Interfaces"], ["turn", "Turn proxies"], ["routing", "Routing & Blocking"], ["geo", "Geo data providers"], ["integrations", "Integrations"], ["logs", "Logs"]]
const VK_LINK_PLACEHOLDER = "<PASTE VK CALL LINK>";

const LOG_LEVEL_IDS = ["off", "error", "warning", "info", "debug"];
const logLevelLabel = v => ({ off: T("log|Off"), error: T("log|Errors"), warning: T("log|Warnings"), info: T("log|Info"),
  debug: T("log|Debug") }[v] || v);
const logLevelHint = v => ({
  error: T("Only failures: something that did not apply, start or sync."),
  warning: T("Failures, and anything degraded, retrying or falling back."),
  info: T("Also every change of state: an interface coming up, a peer added, a route installed. The default."),
  debug: T("Everything, including each routing pass and every site your users open."),
}[v] || "");
const logLeftLabel = s => s >= 3600
  ? T("{v1} h {v2} min", { v1: Math.floor(s / 3600), v2: Math.floor((s % 3600) / 60) })
  : T("{v1} min", { v1: Math.max(1, Math.ceil(s / 60)) });

const sectionLabel = k => ({
  display: T("Display"), security: T("Authentication"), access: T("Panel access"), configs: T("Client configs"),
  subs: T("Subscriptions"), mesh: T("Network"), links: T("Mesh"), exits: T("SOCKS5 exits"), defaults: T("Interfaces"),
  turn: T("Turn proxies"), routing: T("Routing & Blocking"), geo: T("Geo data providers"),
  integrations: T("Integrations"), logs: T("Logs"),
}[k] || k);
  const [selectedNode, setSelNode] = useState("");
  const perNodeSection = section === "routing" || section === "mesh" || section === "links" || section === "exits";
  const nodeRec = (Store.nodes || []).find(n => n.id === selectedNode) || (Store.nodes || [])[0];
  const selNode = nodeRec ? nodeRec.id : "";
  const nodeMode = nv(selNode, "routing_mode") || "kernel";
  const setMode = m => setNV(selNode, { routing_mode: m });
  const savedMode = (nodeRec && nodeRec.routing_mode) || "kernel";
  const ipLearn = nv(selNode, "ip_learning") !== false;
  const setIpLearn = v => setNV(selNode, { ip_learning: v });
  const ccOf = nid => nv(nid, "catalog_cats") || [];
  const ruleCats = fleetRuleCats();
  const catInUse = (id, nid) => !!(ruleCats[nid] && ruleCats[nid].has(id));
  const catIfaces = (id, nid) => Object.entries(((fleetNodes.find(n => n.id === nid) || {}).rule_cats) || {})
    .filter(([, cats]) => (cats || []).includes(id)).map(([ifn]) => ifn).sort();
  const usedBy = id => { const ifs = catIfaces(id, selNode);
    return ifs.length
      ? html`<div class="lg-used">${ifs.map(ifn => html`<button type="button" class="lg-ifchip" key=${ifn}
          title=${T("Open {v1} and its routing rules", { v1: ifn })} onClick=${() => openIfaceEditor(selNode, ifn)}>${ifn}</button>`)}</div>`
      : html`<span class="lg-unused" title=${T("Held on this node, but no rule on it names this list.")}>${T("not used here")}</span>`; };
  const catInUseFleet = id => (Store.nodes || []).some(n => catInUse(id, n.id));
  const fleetNodes = Store.nodes || [];
  const catOnNode = (id, nid) => ccOf(nid).includes(id);
  const setCatOnNode = (id, nid, on) => setNV(nid, { catalog_cats: on ? [...new Set([...ccOf(nid), id])] : ccOf(nid).filter(c => c !== id) });
  const removeCatFleet = id => { fleetNodes.forEach(n => { if (ccOf(n.id).includes(id)) setCatOnNode(id, n.id, false); }); setGridKeep(g => g.filter(x => x !== id)); };
  const provFleetCats = [...new Set([...fleetNodes.flatMap(n => ccOf(n.id)),
                                     ...fleetNodes.flatMap(n => [...(ruleCats[n.id] || [])]),
                                     ...gridKeep])].sort((a, b) => catLabelOf(a).toLowerCase().localeCompare(catLabelOf(b).toLowerCase()));
  const confirmRemoveCat = id => openConfirm({ title: T("Unpin list from the fleet"), confirmLabel: T("Unpin"), warn: true,
    body: Trich("Stop keeping *{v1}* {v2} on *every node*? No rule uses it, so each node drops it on the next sync. You can pin it again from the catalog any time.",
      { v1: catLabelOf(id), v2: html`<span class="faint">(${provLabelOf(id)})</span>` }),
    onConfirm: () => removeCatFleet(id) });
  const catSaved = id => fleetNodes.some(n => ((orig[n.id] || {}).catalog_cats || []).includes(id));
  const removeCatRow = id => catSaved(id) ? confirmRemoveCat(id) : removeCatFleet(id);
  const SECF = { logs: ["log_mb"], routing: ["routing_mode", "ip_learning", "catalog_cats"], mesh: ["endpoint_host", "endpoint_hosts", "default_egress_ip", "panel_ip", "default_exit", "default_routing", "default_routing_exit_ips", "p2p", "p2p_portok"], links: ["mesh_egress_ip", "mesh_subnet", "mesh_port", "mesh_prefix"], exits: ["exits"] };
  const nodeDirty = (nid, sec) => (SECF[sec] || []).some(f => !eq((nodeEdits[nid] || {})[f], (orig[nid] || {})[f]));
  const listsJSON = ls => JSON.stringify((ls || []).map(l => ({ id: l.id || "", title: l.title || "", enabled: l.enabled !== false, targets: customTargets(l).trim() })));
  const dispDirty = () => tput !== (ps.throughput_perspective === "peers" ? "peers" : "nodes") || tunit !== (ps.throughput_units === "bits" ? "bits" : "bytes") || staleS !== String(Math.round((adv.node_stale_ms || 30000) / 1000)) || graceS !== String(Math.round((adv.peer_grace_ms || 60000) / 1000)) || topTalk !== String(ps.top_talkers || 10) || topDest !== String(ps.top_destinations || 10) || themeColorS.toLowerCase() !== clampBrand(ps.theme_color || THEME_COLOR_DEFAULT, false).toLowerCase() || themeColorLightS.toLowerCase() !== clampBrand(ps.theme_color_light || THEME_COLOR_LIGHT_DEFAULT, true).toLowerCase();
  const tzDirty = () => tz !== (ps.time_zone || "");
  const dataDirty = () => infHist !== (ps.infinite_history !== false) || histRes !== String(ps.history_resolution || 3600);
  const geoDirty = () => (JSON.stringify(provEnabled) !== JSON.stringify(Object.fromEntries((Store.catalogProviders || []).map(p => [p.id, p.enabled !== false]))) || Object.keys(blockProvEdits).length > 0 || JSON.stringify(provColorOverrides()) !== JSON.stringify(ps.provider_colors || {}) || customEnabled !== (ps.custom_lists_enabled !== false) || String(Math.max(0, parseInt(guEvery) || 0)) !== String(_gu.every_days == null ? 1 : _gu.every_days) || guAt !== (_gu.at || "04:00"));
  const nbDirty = () => normBlockAllow(blockAllow).join(",") !== (ps.block_allow || []).join(",");
  const pokDirty = () => (r => r.bad.length > 0 || !portokSame(r.list, ps.p2p_portok || P2P_PORTOK_DEFAULT))(portokRead(pok));
  const glDirty = sec =>
    sec === "routing" ? (listsJSON(lists) !== listsJSON(ps.custom_lists || []) || Object.keys(blockEdits).length > 0 || blockRemoved.length > 0) :
    sec === "turn" ? (turnEnabledS !== (ps.turn_enabled !== false) || [...turnForks].sort().join() !== (ps.enabled_turn_forks || TURN_FORKS_DEFAULT).slice().sort().join() || JSON.stringify(forkColorOverrides()) !== JSON.stringify(forkOvFrom(ps.turn_fork_colors)) || String(Math.max(0, parseInt(tuEvery) || 0)) !== String((ps.turn_update || {}).every_days == null ? 0 : (ps.turn_update || {}).every_days) || tuAt !== ((ps.turn_update || {}).at || "04:00")) :
    sec === "security" ? secChanged() :
    sec === "geo" ? geoDirty() || nbDirty() || pokDirty() :
    sec === "defaults" ? (dns !== (idf.dns || []).join(", ") || mtu !== String(idf.mtu || 1280) || ka !== String(idf.keepalive || 25) || JSON.stringify(statusCondsOut()) !== JSON.stringify({ blocked: (ps.status_conditions || {}).blocked !== false, faulty: (ps.status_conditions || {}).faulty !== false }) || JSON.stringify(awgTrim(awgDef)) !== JSON.stringify(awgTrim(idf.awg_params || {})) || JSON.stringify(awg3Trim(awg3Def)) !== JSON.stringify(awg3Trim(idf.awg3_params)) || reachDef !== (idf.reach || "user") || awgGenDef !== (idf.awg_gen || DEFAULT_AWG_GEN) || (ivkEscrow !== null && ivkEscrow !== ivkEscrowInit)) :
    sec === "configs" ? (sc !== _scMode) :
    sec === "subs" ? (subsOn !== !!subCfg.enabled || autoGen !== !!subCfg.auto_generate || warnDays !== String(ps.expiry_warn_days == null ? 3 : ps.expiry_warn_days) || JSON.stringify([...subLangs].sort()) !== JSON.stringify([...(subLangCfg.enabled || ["en"])].sort()) || subLangDef !== (subLangCfg.default || "en")) :
    sec === "display" ? (dispDirty() || tzDirty() || dataDirty()) :
    sec === "logs" ? (logDirty() || logMbPDirty()) :
    sec === "mesh" ? (showLans !== (ps.show_node_lans !== false) || normScanAllow(scanAllow).join(",") !== (ps.scan_allow || []).join(",")) :
    sec === "links" ? (rsvSubnet !== (rsv.mesh_subnet || "10.255.0.0/16") || rsvPort !== String(rsv.mesh_port_base || 9999) || rsvPrefix !== (rsv.iface_prefix || "swg_") || !eq(meshTpl(awgSet ? awg : {}), meshTpl(ps.mesh_awg)) || meshMode !== (ps.mesh_mode || "auto") || meshGen !== (ps.mesh_awg_gen || DEFAULT_AWG_GEN)) : false;
  const secDirty = sec => glDirty(sec) || (SECF[sec] ? (Store.nodes || []).some(n => nodeDirty(n.id, sec)) : false);
  const badgeDirty = nid => nid === "" ? glDirty(section) : nodeDirty(nid, section);
  const anyDirty = SECTIONS.some(([s]) => secDirty(s));
  const dirtyRef = useRef(anyDirty); dirtyRef.current = anyDirty;
  useEffect(() => {
    setUnsavedGuard(() => dirtyRef.current);
    const bu = e => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", bu);
    return () => { clearUnsavedGuard(); window.removeEventListener("beforeunload", bu); };
  }, []);
  const leaveSettings = () => { if (!anyDirty || confirm(LEAVE_MSG())) { clearUnsavedGuard(); history.back(); } };
  return html`<div class="screen setscreen">
    <div class="sethead">${Trich("*Panel settings*")}</div>
    ${msg ? html`<div class=${"formmsg " + (msg.ok ? "ok" : "err")}>${msg.t}</div>` : null}
    <div class=${"setbody" + (isMobile() && !section ? " m-list" : "")}>
      <nav class="setrail">${SECTIONS.map(([id]) => html`<button class=${"setrail-i" + (section === id ? " on" : "")} onClick=${() => { setSection(id); if (isMobile()) window.scrollTo(0, 0); }}>${sectionLabel(id)}${secDirty(id) ? html`<span class="dirtydot"></span>` : null}</button>`)}</nav>
      <div class="setpane">
        ${isMobile() && section ? html`<button class="m-setback" onClick=${() => { setSection(null); window.scrollTo(0, 0); }}><${Ic} i="back"/> ${T("Panel settings")}<span class="m-setcur">${sectionLabel(section)}</span></button>` : null}
        ${perNodeSection && section !== "links" && (Store.nodes || []).length ? html`<div class="setnodes">${(Store.nodes || []).map(n => html`<button class=${"snbadge" + (selNode === n.id ? " on" : "") + (badgeDirty(n.id) ? " dirty" : "")} style=${"--c:" + Store.nodeColor(n.id)} onClick=${() => setSelNode(n.id)}><span class="ndot"></span>${n.name}</button>`)}</div>` : null}
        ${section === "routing" ? html`<div class="card rcard">
          ${nodeRec ? (() => { const mm = MODE_META[nodeMode] || MODE_META.kernel;
            const resetBtn = html`<${Popover} hoverOnly cls="rmode-resetwrap" popCls="rmode-reset-pop"
                  trigger=${html`<button class="rmode-reset-ic" onClick=${() => resetRouting(selNode, nodeRec ? nodeRec.name : T("this node"))}><${Ic} i="refresh"/></button>`}>
                  <div class="rmode-reset-pop-body">${T("Reset this node's smart routing — clear just the learned IPs, or wipe + rebuild + re-pull every list. Use it to recover a stuck node.")}</div>
                <//>`;
            const mmRun = MODE_META[savedMode] || MODE_META.kernel;
            const caption = html`<div class="rmr-title">${Trich("{v1} currently runs on {v2}", {
      v1: html`<b class="rmr-node">${nodeRec ? nodeRec.name : T("Node")}</b>`,
      v2: html`<b class="rmr-mode">${mmRun.label}</b>`,
    })}</div>`;
            const infoPop = html`<${Popover} hoverOnly cls="rmode-info" popCls="rmode-info-pop" trigger=${html`<span class="rmode-infobtn"><${Ic} i="info"/></span>`}>
                  <div class="rmode-info-body">${Trich("Every mode matches by destination *IP* first (GeoIP / ASN / your IP lists) — that layer is *always on* and carries all traffic, including calls, UDP and QUIC. The choice adds an optional *host (domain)* matching layer on top: none, via the node's *DNS*, or read from the *TLS handshake*. Traffic always stays in-kernel in any mode including *{v1}* (no userspace proxy). Changing it reconfigures {v2} and changes which lists its interfaces can use.", { v1: T("Hybrid SNI"), v2: nodeRec ? nodeRec.name : T("the node") })}<div style="margin-top:9px">${Trich("*Reset routing* recovers a stuck node — clear just the learned IPs, or wipe + rebuild + re-pull everything.")}</div></div>
                <//>`;
            const runbar = savedMode === "kernel"
              ? html`<div class="rmode-runbar">
                  ${caption}
                  <span class="grow"></span>
                  <div class="rmr-actions">${infoPop}${resetBtn}</div>
                </div>`
              : html`<div class="rmode-runbar">
                  <div class="rmr-left">
                    <${HostHealth} node=${selNode} mode=${savedMode} learn=${ipLearn} onLearn=${setIpLearn}/>
                  </div>
                  <span class="grow"></span>
                  <div class="rmr-right">
                    <div class="rmr-rtop">${caption}${infoPop}${resetBtn}</div>
                  </div>
                </div>`;
            return html`
          ${runbar}
          <div class=${"rmode-banner m-" + nodeMode}>
            <div class="rd-head">
              <div class="rd-headmain">
                <div class="rd-titlerow">
                  <span class="rd-ic"><${Ic} i=${mm.icon}/></span>
                  <b class="rd-name">${mm.label}</b>
                  <span class="rmc-tag">${mm.short}</span>
                </div>
                <div class="rd-adds">${mm.adds}</div>
              </div>
            </div>
            <div class="rd-headside">
                <${ModeTabs} value=${nodeMode} onChange=${setMode}/>
            </div>
            <div class="rd-lines">
              ${(mm.bene || []).map(b => html`<div class="rmc-bene"><b>+</b><span>${b}</span></div>`)}
              ${(Array.isArray(mm.block) ? mm.block : mm.block ? [mm.block] : []).filter(x => x.s === "+").map(x => html`<div class="rmc-bene"><b>+</b><span>${x.t}</span></div>`)}
              <div class="rmc-cost"><b>−</b><span>${mm.cost}</span></div>
              ${(Array.isArray(mm.block) ? mm.block : mm.block ? [mm.block] : []).filter(x => x.s === "−").map(x => html`<div class="rmc-cost"><b>−</b><span>${x.t}</span></div>`)}
            </div>
            ${mm.routes ? html`<div class="rd-spec">
              <span class="rds-k">${T("Routes")}</span><span class="rds-v">${mm.routes}</span>
              <span class="rds-k">${T("Overlaps")}</span><span class="rds-v">${mm.overlaps}</span>
            </div>` : null}
            <div class="rmode-desc">${mm.exp}</div>
          </div>`; })() : html`<p class="hint">${T("Add a node to configure its routing mode.")}</p>`}

          <div class="rltabs">
            <div class="rltab-cap">${nodeRec ? Trich("{v1} for {v2}", {
              v1: routeTab === "blocking" ? T("Content filters") : T("Routing lists"),
              v2: html`<b style=${"color:" + (Store.nodeColor(selNode) || "var(--ink)")}>${nodeRec.name}</b>`,
            }) : (routeTab === "blocking" ? T("Content filters") : T("Routing lists"))}</div>
            <div class="rltab-group" role="tablist">
              <button role="tab" aria-selected=${routeTab === "routing"} class=${"rltab" + (routeTab === "routing" ? " on" : "")} onClick=${() => setRouteTab("routing")}><${Ic} i="cascade"/>${T("Routing")}</button>
              <button role="tab" aria-selected=${routeTab === "blocking"} class=${"rltab" + (routeTab === "blocking" ? " on" : "")} onClick=${() => setRouteTab("blocking")}><${Ic} i="shield"/>${T("Blocking")}</button>
            </div>
          </div>
          <div class="hint rltab-note"><${Ic} i="info"/><span>${routeTab === "blocking" ? T("Filtering runs on the entry node — where a client's tunnel lands. Exit and relay hops in a multi-hop path never see the client, so there's nothing there for them to filter.") : T("Routing runs on the entry node — where a client's tunnel lands. Exit and relay hops in a multi-hop path just forward what's already been steered.")}</span></div>
          ${routeTab === "blocking" ? html`<div class="hint rltab-warn"><${Ic} i="warn"/><span>${Trich("Large lists are memory-hungry — every enabled list is loaded into RAM on *each* entry node that uses it, roughly *130 MB per 1M domains*. Keep your smallest node's memory in mind before turning on big lists.")}</span></div>` : null}

          ${routeTab === "routing" ? html`
          ${nodeRec ? html`<div class="lgrid-head">
            <div class="lg-htitle"><span class="seclabel" style="margin:0">${T("Provider lists")}</span><span class="lg-count">${provFleetCats.length}</span><span class="faint lg-sub">${T("held on this node, and the interfaces that ask for them")}</span></div>
            <span class="grow"></span>
          </div>
          ${provFleetCats.length ? html`<div class="lgrid">
            ${provFleetCats.map(id => { const cap = catCap(id); const usable = catUsableInMode(id, nodeMode); const sz = (Store.catSizes || {})[id] || {};
              return html`<div class=${"lgrow" + (usable ? "" : " lg-lock")} key=${id}>
                <div class="lg-cat"><div class="lg-catmain"><span class="lg-title">${catLabelOf(id)}</span>${provLabelOf(id) ? html`<${ProvTag} id=${id}/>` : null}${catInUse(id, selNode)
                  ? html`<span class="lg-inuse" title=${T("A routing rule on this node names this list, so the node already holds it — pinning only decides whether it stays when that rule goes.")}>${T("in use")}</span>` : null}</div>${catRawId(id) ? html`<span class="lg-id">${catRawId(id)}</span>` : null}</div>
                <div class="lg-size">${sizeSummary(sz.host || 0, sz.ip || 0, sz.pat || 0) || html`<span class="faint">—</span>`}</div>
                <div class="lg-fleet">${usedBy(id)}</div>
                <div class="lg-caps">${capBadges(cap)}</div>
                <div class="lg-act">${catListUrl(id, cap) ? html`<a class="ccchip-info" href=${catListUrl(id, cap)} target="_blank" rel="noopener" title=${T("View this list on GitHub")}><${Ic} i="info"/></a>`
                  : null}${!catInUseFleet(id) && catOnNode(id, selNode) ? html`<button class="ccchip-x"
                  title=${T("A leftover pin — no rule names this list. Clear it from every node.")}
                  onClick=${() => removeCatRow(id)}><${Ic} i="x"/></button>` : null}</div>
              </div>`; })}
          </div>` : html`<div class="hint" style="margin:2px 0 0">${Trich("Nothing held here yet. Lists arrive on their own when an interface's routing rule names one — add them in *Interfaces*, on the interface that needs them.")}</div>`}` : null}

          ${(Store.panelSettings || {}).custom_lists_enabled !== false ? html`
          <div class="lgrid-head" style="margin-top:26px">
            <div class="lg-htitle"><span class="seclabel" style="margin:0">${T("Custom lists")}</span><span class="lg-count">${lists.length}</span><span class="faint lg-sub">${T("one set of addresses, reused by rules on any node — edited in one place")}</span></div>
            <span class="grow"></span>
            <button class="btn btn-add" onClick=${() => openModal(html`<${CustomListSheet} key="new" onSave=${saveList} onClose=${closeModal}/>`)}><${Ic} i="plus"/>${T("New list")}</button>
          </div>
          ${!lists.length ? html`<p class="hint" style="margin:6px 0 0">${T("No lists yet. Worth making when the same addresses are wanted by more than one rule — otherwise type them straight into the rule.")}</p>` : null}
          ${lists.length ? html`<div class="lgrid">
            ${[...lists].sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase())).map(l => { const cap = customCaps(l);
              return html`<div class="lgrow clk" key=${l._rid} title=${T("Edit this list")}
                  onClick=${e => { if (e.target.closest("button,a")) return;
                                   openModal(html`<${CustomListSheet} key=${l._rid} list=${l} onSave=${saveList} onClose=${closeModal}/>`); }}>
                <div class="lg-cat"><div class="lg-catmain"><button type="button" class="lg-title" title=${T("Edit this list")}
                  onClick=${() => openModal(html`<${CustomListSheet} key=${l._rid} list=${l} onSave=${saveList} onClose=${closeModal}/>`)}>${l.title || T("Untitled list")}</button><span class="catpick-src" style=${"--pc:" + providerColor("custom")}>${T("src|Custom")}</span></div>${l.id ? html`<span class="lg-id">${l.id}</span>` : null}</div>
                <div class="lg-size"><${ListInfo} list=${l}/></div>
                <div class="lg-fleet">${usedBy(l.id)}</div>
                <div class="lg-caps">${capBadges(cap)}</div>
                <div class="lg-act"><button class="ccchip-x" title=${T("Delete this list")} onClick=${() => confirmDeleteList(l)}><${Ic} i="x"/></button></div>
              </div>`; })}
          </div>` : null}` : null}

          <div class="lg-legend">
            ${legRow(Trich("{v1} matched by address range (GeoIP / ASN) — works in every mode.", { v1: html`<span class="capb ip">IP</span>` }))}
            ${legRow(Trich("{v1} matched by domain name — needs Hybrid SNI mode.", { v1: html`<span class="capb host">${T("Host")}</span>` }))}
            ${provFleetCats.some(id => !catUsableInMode(id, nodeMode)) ? html`<div class="lg-leg-row faint">${T("Greyed rows are Host-only — this node is IP-only, so they can't match here. The pull stays remembered; switch to Hybrid SNI to activate them.")}</div>` : null}
          </div>` : null}

          ${routeTab === "blocking" ? (() => {
            const bc = Store.blockCatalog;
            if (!bc) return blockCatalogStatus(T("Loading block lists…"));
            const provList = bc.provider_lists || {};
            const provLabel = p => ((bc.providers || []).find(x => x.id === p) || {}).label || p;
            const provTier = p => ((bc.providers || []).find(x => x.id === p) || {}).tier || "host";
            const provColor = p => { const bp = (bc.providers || []).find(x => x.id === p) || {}; return pickThemed(provColors[p] || asThemed((ps.provider_colors || {})[p], bp.color, bp.color_l || bp.color), _provColDefault(p).dark, _provColDefault(p).light); };
            const srcLabel = s => { const L = (provList[s.provider] || []).find(x => x.id === (s.list || "")); return (L && blistText(L.label)) || s.list || provLabel(s.provider); };
            const bcat = id => { const b = (bc.categories || {})[id] || {}; return { id, ...b, ...(blockEdits[id] || {}) }; };
            const allIds = [...new Set([...Object.keys(bc.categories || {}), ...Object.keys(blockEdits)])];
            const cats = allIds.map(bcat).filter(c => c.kind !== "mechanism" && !blockRemoved.includes(c.id));
            const caps = c => { const s = c.sources || []; return { host: s.some(x => provTier(x.provider) === "host"), ip: s.some(x => provTier(x.provider) === "ip") }; };
            const fmtN = n => n == null ? null : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
            const createCat = ({ id, label }) => { setBlockEdits(e => ({ ...e, [id]: { label, sources: [], enabled_nodes: [] } })); setBkOpen(o => ({ ...o, [id]: true })); setBkAutoAdd(id);
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const items = document.querySelectorAll(".bkitem"); const el = items[items.length - 1]; if (!el) return;
                let p = el.parentElement;
                while (p) { const st = getComputedStyle(p).overflowY; if ((st === "auto" || st === "scroll") && p.scrollHeight > p.clientHeight + 4) { p.scrollTo({ top: p.scrollHeight, behavior: "smooth" }); break; } p = p.parentElement; }
                window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
              })); };
            const doRemoveCat = c => { setBkOpen(o => ({ ...o, [c.id]: false })); if ((bc.categories || {})[c.id]) setBlockRemoved(r => r.includes(c.id) ? r : [...r, c.id]); setBlockEdits(e => { const n = { ...e }; delete n[c.id]; return n; }); };
            const removeCat = c => { if ((bc.categories || {})[c.id])
                openConfirm({ title: T("Delete category · ") + c.label, confirmLabel: T("Delete category"), danger: true,
                  body: T("Nodes stop applying this category after you save and they sync."),
                  onConfirm: () => doRemoveCat(c) });
              else doRemoveCat(c); };
            const availOn = c => (c.enabled_nodes || []).includes(selNode);
            const modeLabel = (MODE_META[nodeMode] || {}).label || T("this mode");
            const srcAvail = s => !nodeRec || blockSrcOk(nodeMode, bc.providers, s);
            const catDis = c => !!nodeRec && blockCatDisabled(nodeMode, bc.providers, c);
            const srcHost = s => provTier(s.provider) !== "ip";
            const setAvail = (c, on) => { const en = new Set(c.enabled_nodes || []); on ? en.add(selNode) : en.delete(selNode);
              setBlockEdits(e => ({ ...e, [c.id]: { ...(e[c.id] || {}), enabled_nodes: [...en] } })); };
            const setDefault = (c, on) => setBlockEdits(e => ({ ...e, [c.id]: { ...(e[c.id] || {}), default_on: on } }));
            const setSources = (c, sources) => setBlockEdits(e => ({ ...e, [c.id]: { ...(e[c.id] || {}), sources } }));
            const addSource = (c, p, l) => { if ((c.sources || []).some(s => s.provider === p && s.list === l)) return; setSources(c, [...(c.sources || []), { provider: p, list: l }]); };
            const removeSource = (c, i) => setSources(c, (c.sources || []).filter((_, j) => j !== i));
            const srcDesc = s => { const L = (provList[s.provider] || []).find(x => x.id === (s.list || "")); return (L && blistText(L.desc)) || ""; };
            const srcUrl = s => { const L = (provList[s.provider] || []).find(x => x.id === (s.list || "")); return (L && L.src) || ""; };
            const setAvailNode = (c, nid, on) => { const en = new Set(c.enabled_nodes || []); on ? en.add(nid) : en.delete(nid);
              setBlockEdits(e => ({ ...e, [c.id]: { ...(e[c.id] || {}), enabled_nodes: [...en] } })); };
            const bkRow = c => { const src = c.sources || []; const nL = src.length; const open = !!bkOpen[c.id]; const dis = catDis(c);
              const catNm = c.label;
              return html`<div class=${"bkitem" + (open ? " open" : "") + (dis ? " bk-dis" : "")} key=${c.id}>
                <div class=${"bkrow" + (open ? " open" : "")} onClick=${() => setBkOpen(o => ({ ...o, [c.id]: !open }))}>
                  <div class="lg-pull" onClick=${e => e.stopPropagation()}>${nodeRec ? html`<${Switch} on=${availOn(c) && !dis} disabled=${dis} title=${dis ? T("No IP list here — can't enforce in {v1}. Add an IP list, or use Hybrid SNI.", { v1: modeLabel }) : T("Filter on {v1}", { v1: nodeRec.name })} onChange=${v => { if (!dis) setAvail(c, v); }}/>` : null}</div>
                  <div class="bk-cat">
                    <div class="bk-catline"><span class="lg-title" title=${catNm}>${catNm}</span><span class="bk-chev">▾</span></div>
                    <div class="bk-lists">${nL ? src.map(srcLabel).join(", ") : html`<span class="faint">${T("no lists yet — add one →")}</span>`}</div>
                  </div>
                  <div class="bk-size"><${BlockCoverageSummary} coverage=${c.coverage} sources=${blockEdits[c.id]?.sources}
                    hosts=${!nodeRec || blockTierOk(nodeMode, "host")}/></div>
                  <div class="bk-fleet" onClick=${e => e.stopPropagation()}><${FleetAssign} nodes=${fleetNodes} isOn=${nid => (c.enabled_nodes || []).includes(nid)} onToggle=${(nid, on) => setAvailNode(c, nid, on)}/></div>
                  <div class="bk-cap">${(() => { const cp = caps(c); return cp.host || cp.ip
                    ? html`<${Fragment}>${cp.host ? html`<span class="capb host" title=${T("Matched by domain — needs Hybrid SNI mode")}>${T("Host")}</span>` : null}${cp.ip ? html`<span class="capb ip" title=${T("Matched by IP — works in every mode")}>IP</span>` : null}<//>`
                    : html`<span class="bk-nocap" title=${T("No lists yet")}>—</span>`; })()}</div>
                  <button class=${"bk-defchip" + (c.default_on ? " on" : "")} onClick=${e => { e.stopPropagation(); setDefault(c, !c.default_on); }} title=${T("Turn this category on automatically for every new interface (still toggled per interface)")}>${c.default_on ? T("Default ON") : T("Default OFF")}</button>
                  <${BlockListPicker} providers=${bc.providers} provLists=${provList} current=${src} nodeMode=${nodeRec ? nodeMode : "sni"} onAdd=${(p, l) => addSource(c, p, l)} autoOpen=${bkAutoAdd === c.id}/>
                </div>
                ${open ? html`<div class="bk-expand">
                  ${src.length ? src.map((s, i) => html`<div class=${"bk-lrow" + (srcAvail(s) ? "" : " bk-ldis")} key=${i}>
                      <div class="bk-linfo">
                        <div class="bk-ltop"><span class="bk-llabel">${srcLabel(s)}</span><span class="bk-lprov" style=${provColor(s.provider) ? "--pc:" + provColor(s.provider) : ""}>${provLabel(s.provider)}</span></div>
                        ${srcDesc(s) ? html`<span class="bk-ldesc">${srcDesc(s)}</span>` : null}
                      </div>
                      <span class="grow"></span>
                      ${!srcAvail(s) ? html`<span class="bk-nabadge">${T("Not available with {v1}", { v1: modeLabel })}</span>` : null}
                      ${s.n != null ? html`<span class=${"bk-count" + (s.err ? " bk-stale" : "")} title=${(srcHost(s) ? T("domains in this list") : T("IP ranges in this list")) + (s.err ? " · " + T("the last update failed ({v1}) — the previous copy is still in use", { v1: s.err }) : "")}>${fmtN(s.n)}</span>`
                        : s.err && !s.busy ? html`<span class="bk-count bk-fail" title=${T("The panel couldn't download this list ({v1}). It retries on its own, less often each time.", { v1: s.err })}>${T("not downloaded")}</span>`
                        : (bc.providers || []).some(p => p.id === s.provider && p.enabled !== false) ? html`<span class="bk-count bk-wait" title=${T("The panel is downloading this list — the count appears when it's done")}>…</span>` : null}
                      <span class=${"capb " + (srcHost(s) ? "host" : "ip")} title=${srcHost(s) ? T("Domain list — needs Hybrid SNI mode") : T("IP list — works in every mode")}>${srcHost(s) ? T("Host") : T("cap|IP")}</span>
                      ${srcUrl(s) ? html`<a class="catrow-info" href=${srcUrl(s)} target="_blank" rel="noopener" title=${T("See what's in this list")} onClick=${e => e.stopPropagation()}><${Ic} i="info"/></a>` : null}
                      <button class="bk-lremove" title=${T("Remove this list from the category")} onClick=${e => { e.stopPropagation(); removeSource(c, i); }}><${Ic} i="x"/></button>
                    </div>`)
                    : html`<div class="bk-empty">${Trich("No lists yet — use *+ Add list* above to add one.")}</div>`}
                  <div class="bk-catfoot"><span class="grow"></span><button class="bk-delcat" title=${T("Delete category")} onClick=${e => { e.stopPropagation(); removeCat(c); }}><${Ic} i="trash"/>${T("Delete category")}</button></div>
                </div>` : null}
              </div>`; };
            return html`<${Fragment}>
              <div class="lgrid-head" style="margin-top:16px">
                <div class="lg-htitle"><span class="seclabel" style="margin:0">${T("Block categories")}</span><span class="lg-count">${cats.length}</span><span class="faint lg-sub">${T("drop ads, malware, adult, threat IPs — by domain or IP")}</span></div>
                <span class="grow"></span>
                <button class="btn btn-add" onClick=${() => openModal(html`<${NewBlockCatSheet} existingNames=${cats.map(c => c.label)} onCreate=${createCat}/>`)}><${Ic} i="plus"/>${T("New category")}</button>
              </div>
              ${cats.length ? html`<div class="lgrid">${cats.map(bkRow)}</div>` : html`<p class="hint">${T("No block categories yet. Create a category and add the lists it should use.")}</p>`}
              <div class="lg-legend">
                ${legRow(Trich("{v1} matched by IP address — works in every mode.", { v1: html`<span class="capb ip">IP</span>` }))}
                ${legRow(Trich("{v1} matched by domain name — needs Hybrid SNI mode.", { v1: html`<span class="capb host">${T("Host")}</span>` }))}
              </div>
            <//>`;
          })() : null}
        </div>` : null}
        ${section === "turn" ? html`<div class="card">
          <div class="seclabel turnhead" style="margin-top:0">${T("Turn proxies")}<span class="grow"></span>
            <label class="swt" title=${turnEnabledS ? T("Turn proxies are on") : T("Turn proxies are off")}><input type="checkbox" checked=${turnEnabledS} onChange=${e => setTurnEnabledS(e.target.checked)}/><span class="track"></span><span class="knob"></span></label></div>
          ${!turnEnabledS ? html`<p class="hint" style="margin:0 0 12px"><b class="warntext">${T("Turn proxies are off.")}</b> ${T("Creation buttons and the turn-proxy sections are hidden across the panel. Deployed proxies keep running — they're just not shown here.")}</p>`
            : html`<p class="hint" style="margin:0 0 12px">${Trich("Which forks appear in the *{v1}* picker when you add a proxy to a node, and each fork's colour. Unticking one only *hides it from that list* — it never touches proxies you've already deployed. {v2}", { v1: T("Install a fork"), v2: !turnForksVisible().some(f => turnForks.has(f.id)) ? html`<b>${T("No forks are enabled — the install picker will be empty.")}</b>` : null })}</p>`}
          ${html`<${Fragment}>
          <div class=${"cllist" + (turnEnabledS ? "" : " dimmed")}>${settingsForks().map(f => { const fcol = pickThemed(forkColors[f.id], f.color, f.colorL); return html`<div class=${"cl-row" + (f.hidden || turnForks.has(f.id) ? "" : " off")} key=${f.id}>
            ${f.hidden
              ? html`<span class="tg tg-off" title=${T("No longer offered for new proxies — listed while a node still runs it")}>${T("tag|hidden")}</span>`
              : html`<${Switch} on=${turnForks.has(f.id)} title=${T("Offer {v1}", { v1: T("{v1} in the install picker", { v1: f.label }) })} onChange=${v => setTurnForks(s => { const n = new Set(s); v ? n.add(f.id) : n.delete(f.id); return n; })}/>`}
            <${ThemedSwatch} val=${forkColors[f.id]} title=${T("Colour for {v1}", { v1: f.label })} onChange=${nv => setForkColors(c => ({ ...c, [f.id]: nv }))}
              sample=${(c) => html`<span class="tg tg-turn" style=${"--tfc:" + c}>${f.label}</span>`}/>
            <a class=${"tf-name tf-" + f.id} href=${"https://github.com/" + f.owner} target="_blank" rel="noopener" style=${"color:" + fcol} title=${"github.com/" + f.owner}>${f.label}</a>
            <span class="cl-caps" title=${f.kind === "wdtt" ? T("Self-contained WDTT server — owns its own WireGuard interface (not a WG/AWG front)") : f.kind === "csqtt" ? T("Self-contained csqtt server — owns its own raw-TUN interface (not a WG/AWG front)") : forkSupportsAwg(f.id) ? T("Works with WireGuard and AmneziaWG interfaces") : T("{v1} is WireGuard-only — its client can't front an AmneziaWG interface", { v1: f.label })}>
              ${f.kind === "wdtt"
                ? html`<span class="tg tg-wdtt">WDTT</span>`
                : f.kind === "csqtt"
                ? html`<span class="tg tg-csqtt">CSQTT</span>`
                : html`<${Fragment}><span class="tg tg-wg">wg</span>${forkSupportsAwg(f.id) ? html`<span class="tg tg-awg">awg</span>` : null}<//>`}
            </span>
            ${(() => {
              const v = forkVersions(f.id, true); const col = fcol;
              if (!v.length) return html`<span class="tf-ver none">${T("not yet used")}</span>`;
              const nodes = forkNodeStates(f.id, true); const ut = turnUpdateTarget[f.id]; const latest = (ut && Date.now() < ut.until) ? ut.ver : ((turnCheck[f.id] || {}).latest || null);
              const perNode = nodes.map(n => { const held = (Store.turnHolds[n.node] || {})[n.line ? f.id + "@" + n.line : f.id] || ""; return { ...n, held, eff: held || n.version || "" }; });
              const distinct = [...new Set(perNode.map(p => p.eff).filter(Boolean))];
              const allHeld = perNode.length > 0 && perNode.every(p => p.held);
              const bub = html`<span class="tf-verpop">
                ${perNode.map(n => html`<span class="tf-vg-node">
                  <span class="tf-vg-dot" style=${"background:" + (Store.nodeColor(n.node) || "var(--ink)")}></span>
                  <span class="tf-vg-nm">${Store.nodeName(n.node)}</span>
                  <span class=${"tf-vg-ver" + (n.held ? " held" : "")}>${n.held ? html`<${Ic} i="off"/> ${T("Held on {v1}", { v1: n.held })}` : (n.version || "—")}</span>
                  ${n.installing ? html`<span class="tf-vg-st upd">${T("updating…")}</span>` : (n.updatePending && latest && n.version === latest) ? html`<span class="tf-vg-st ok"><${Ic} i="check"/>${T("updated")}</span>` : null}
                </span>`)}
              </span>`;
              if (distinct.length > 1) return html`<span class="tf-verwrap" style=${"--tfc:" + col}><span class="tf-ver">${plural(distinct.length, "version")}</span>${bub}</span>`;
              const ver = distinct[0] || v.join(", ");
              if (allHeld) return html`<span class="tf-verwrap" style=${"--tfc:" + col}><span class="tf-ver held"><${Ic} i="off"/> ${T("Held on {v1}", { v1: ver })}</span>${bub}</span>`;
              return html`<span class="tf-verwrap" style=${"--tfc:" + col}><span class="tf-ver">${ver}</span>${bub}</span>`;
            })()}
            <span class="grow"></span>
            ${(() => { const cs = turnCheck[f.id]; if (!cs || !cs.status) return null;
              if (cs.status === "checking") return html`<span class="tf-chk"><span class="tf-arrow"><${Ic} i="refresh"/></span> ${T("checking…")}</span>`;
              if (cs.status === "updating") return html`<span class="tf-chk"><span class="tf-arrow"><${Ic} i="refresh"/></span> ${T("updating…")}</span>`;
              if (cs.status === "updated") return html`<span class="tf-chk ok"><${Ic} i="check"/> ${T("updated")}</span>`;
              if (cs.status === "update") return html`<button class="tf-chk upd tf-updbtn" title=${T("Update every deployed {v1} proxy to {v2}", { v1: f.label, v2: cs.latest })} onClick=${() => updateFork(f.id, cs.latest)}><${Ic} i="download"/> ${T("update to")} ${cs.latest}</button>`;
              return html`<span class="tf-chk ok"><${Ic} i="check"/> ${T("up to date")}</span>`; })()}
            <span class="tf-plats">${turnForkPlatforms(f).map(p => html`<span key=${p.os} class="tf-platwrap turnwrap" title="">
              <button type="button" aria-disabled=${p.disabled ? "true" : null}
                class=${"tf-plat" + (p.disabled || p.notOffered ? " off" : ((p.native ? " nat" : " cross") + (p.obf ? "" : " plain") + (p.isCli ? " cli" : "")))}
                onClick=${() => { if (!p.disabled) openServerClients(f.id, p.os); }}><${Ic} i=${"os_" + p.os}/></button>
              <span class="turnbub tf-plbub">
                ${p.notOffered
                  ? html`<span class="tf-plbub-l"><span class="tf-plbub-app">${T("Not offered on {v1} — those users get no card for this server", { v1: p.label })}</span></span>`
                  : p.disabled
                  ? html`<span class="tf-plbub-l"><span class="tf-plbub-app">${T("No {v1} app for {v2} yet", { v1: f.label, v2: p.label })}</span></span>`
                  : html`<${Fragment}><span class="tf-plbub-l">
                      <span class="tf-plbub-app">${p.name}<span class="tf-plbub-by"> ${Trich("by {v1}", { v1: html`<span class="tf-plbub-who" style=${"color:" + (p.color || turnColor(p.author))}>${forkLabel(p.author)}</span>` })}</span></span>
                      ${p.coreFork ? html`<span class="tf-plbub-core">${Trich("with {v1} core", { v1: html`<span style=${"color:" + turnColor(p.coreFork)}>${forkLabel(p.coreFork)}</span>` })}</span>` : null}
                    </span>
                    <span class=${"tf-plbub-obf" + (p.obfLabel ? "" : " plain")}>${p.obfLabel || T("tag|plain")}</span><//>`}
              </span></span>`)}</span>
            <button class="iconbtn tf-gear" title=${T("Server-flag defaults for {v1} (pre-fill new proxies)", { v1: f.label })} onClick=${() => openServerDefaults(f.id)}><${Ic} i="gear"/></button>
          </div>`; })}</div>
          <//>`}
          ${turnEnabledS ? html`<${Fragment}>
          <div class="seclabel" style="margin-top:18px">${T("Auto-update schedule")}</div>
          <p class="hint" style="margin:0 0 10px">${Trich("The panel checks each deployed proxy's fork for a newer release and, if there is one, updates the binary and restarts the proxy automatically. A restart briefly drops that proxy's clients, so pick a *quiet hour*. (The panel stages the update; each node applies it on its next sync.)")}</p>
          <div class="schedrow">
            <div class="field" style="margin:0"><label>${T("How often")}</label>
              <${Dropdown} value=${tuEvery} onChange=${v => setTuEvery(v)} options=${[
                { value: "1", label: T("Every day") }, { value: "2", label: T("Every 2 days") }, { value: "3", label: T("Every 3 days") },
                { value: "7", label: T("Every week") }, { value: "0", label: T("Off — no auto-updates") }]}/></div>
            <div class="field" style="margin:0"><label>${T("At (panel time)")}</label>
              <input type="time" class="timein" value=${tuAt} disabled=${tuEvery === "0"} onInput=${e => setTuAt(e.target.value || "04:00")}/>
              <div class="hint">${tuEvery === "0" ? T("Auto-updates are off — use “Check for updates” below to update manually.") : T("The panel checks at this local time, on the chosen cadence.")}</div></div>
          </div>
          <div class="georefresh"><span class="faint" style="font-size:11px">${T("Check every deployed proxy's fork for a newer release now, and update the ones that are behind")}</span><button class="btn btn-mini" disabled=${Object.values(turnCheck).some(v => v && v.status === "checking")} onClick=${checkTurnUpdates}><span class=${Object.values(turnCheck).some(v => v && v.status === "checking") ? "tf-arrow" : ""}><${Ic} i="refresh"/></span>${T("Check for updates")}</button></div>
          <div class="seclabel" style="margin-top:18px">${T("Client rosters")}</div>
          <p class="hint" style="margin:0 0 8px">${T("Whether any client app's config/link schema changed upstream on GitHub since we curated it — fetches each app's source file and flags drift per app to review.")}</p>
          <div class="georefresh"><span class="faint" style="font-size:11px">${T("Fetch each client app's schema source from GitHub and flag the ones whose upstream changed")}</span><button class="btn btn-mini" onClick=${() => openRosterCheck()}><${Ic} i="refresh"/>${T("Check client rosters")}</button></div>
          <//>` : null}
          ${turnEnabledS ? html`<${TurnCollectedIps}/>` : null}
        </div>` : null}
        ${section === "geo" ? html`<div class="card">
          <div class="rltabs" style="margin-top:0">
            <div class="rltab-cap">${geoTab === "blocking" ? T("Content filters providers") : T("Routing lists providers")}</div>
            <div class="rltab-group" role="tablist">
              <button role="tab" aria-selected=${geoTab === "routing"} class=${"rltab" + (geoTab === "routing" ? " on" : "")} onClick=${() => setGeoTab("routing")}><${Ic} i="cascade"/>${T("Routing")}</button>
              <button role="tab" aria-selected=${geoTab === "blocking"} class=${"rltab" + (geoTab === "blocking" ? " on" : "")} onClick=${() => setGeoTab("blocking")}><${Ic} i="shield"/>${T("Blocking")}</button>
            </div>
          </div>
          ${geoTab === "routing" ? html`
          <p class="hint" style="margin:0 0 12px">${T("Enable a provider to find its lists in the rule editor. When you turn a provider off, its lists are hidden and its rules stop matching.")}</p>
          <div class="provlist">${_provReg.map(p => { const on = provEnabled[p.id] !== false; return html`<div class=${"provrow bprow" + (on ? "" : " off")} key=${p.id}>
            <${Switch} on=${on} disabled=${p.status === "downloading"}
              title=${p.status === "downloading" ? T("Fetching this provider's catalog — cancel to stop waiting")
                : on ? T("Enabled — its lists are selectable") : T("Off — its lists are hidden and deactivated on nodes")}
              onChange=${v => setProvOn(p, v)}/>
            <${ThemedSwatch} val=${provColors[p.id]} title=${T("{v1} tag colour", { v1: provName(p) })} onChange=${nv => setProvColors(c => ({ ...c, [p.id]: nv }))}
              sample=${(c) => html`<span class="sw-sample" style=${"--pc:" + c}>${provName(p)}</span>`}/>
            <div class="bprov-meta">
              <div class="bprov-top">
                <span class="prov-name" style=${"color:" + pickThemed(provColors[p.id], _provColDefault(p.id).dark, _provColDefault(p.id).light)}>${provName(p)}</span>
                <span class="prov-tiers">${capBadges({ host: (p.tiers || []).includes("host"), ip: (p.tiers || []).includes("ip") })}</span>
                ${(() => { const u = providerUsage(p.id); return u.rules ? html`<span class="prov-use"
                  title=${T("Rules on your interfaces that route one of this provider's lists")}>${T("used by {v1} on {v2}", { v1: plural(u.rules, "prep|rule"), v2: plural(u.ifaces, "prep|interface") })}</span>` : null; })()}
                ${p.enabled === false ? null : html`<span class=${"prov-upd" + (p.last_updated ? "" : " never")} title=${p.last_updated ? T("When this provider's data was last pulled to the panel") : T("No list from this provider has been routed yet — nothing pulled")}>${p.last_updated ? T("updated {v1}", { v1: ago(p.last_updated) }) : T("never updated")}</span>`}
              </div>
              ${p.desc ? html`<span class="bprov-note">${T(p.desc)}</span>` : null}
            </div>
            <span class="grow"></span>
            ${p.enabled === false ? null
              : (() => { const s = p.status, flashing = provFlash[p.id] > Date.now();
              if (s === "downloading") return html`<${Fragment}><span class="prov-st upd" title=${T("Reading this provider's file list from GitHub. Its lists become searchable when it lands; nothing is routed yet.")}><span class="tf-arrow"><${Ic} i="refresh"/></span> ${T("Downloading…")}</span><button class="btn btn-mini" style="margin-left:8px" title=${T("GitHub allows 60 requests an hour without an account, and a fetch inside that window can sit for a couple of minutes. Cancelling stops the wait and turns the provider off — the request itself finishes on its own and its result is thrown away.")} onClick=${() => cancelProvider(p.id)}>${T("Cancel")}</button></>`;
              if (s === "updating") return html`<span class="prov-st upd"><span class="tf-arrow"><${Ic} i="refresh"/></span> ${T("updating…")}</span>`;
              if (s === "updated") return flashing ? html`<span class="prov-st ok"><${Ic} i="check"/> ${T("updated")}</span>` : null;
              if (s === "uptodate") return flashing ? html`<span class="prov-st ok"><${Ic} i="check"/> ${T("up to date")}</span>` : null;
              if (s === "failed" || p.error) return html`<${Fragment}><span class="prov-st err" title=${srvText(p) || ""}><${Ic} i="warn"/> ${p.last_updated ? T("update failed") : T("download failed")}</span><button class="btn btn-mini" style="margin-left:8px" onClick=${() => retryProvider(p.id)}>${T("Retry")}</button></>`;
              return null; })()}
            <a class="prov-repo" href=${p.url} target="_blank" rel="noopener" title=${T("Open {v1}", { v1: T("{v1} on GitHub", { v1: provName(p) }) })}>${(p.url || "").replace(/^https?:\/\/github\.com\//, "")}</a>
          </div>`; })}${!_provReg.length ? html`<div class="hint">${T("Loading providers…")}</div>` : null}
            <div class=${"provrow bprow" + (customEnabled ? "" : " off")}>
              <${Switch} on=${customEnabled} title=${customEnabled ? T("On — you can create custom lists") : T("Off — the Custom lists section is hidden")} onChange=${v => setCustomEnabled(v)}/>
              <${ThemedSwatch} val=${provColors.custom} title=${T("Custom-list tag colour")} onChange=${nv => setProvColors(c => ({ ...c, custom: nv }))}
                sample=${(c) => html`<span class="sw-sample" style=${"--pc:" + c}>${T("src|Custom")}</span>`}/>
              <div class="bprov-meta">
                <div class="bprov-top"><span class="prov-name" style="color:var(--ink)">${T("Custom lists")}</span></div>
                <span class="bprov-note">${T("Your own IP / domain lists — turn off to hide the Custom lists section in routing.")}</span>
              </div>
            </div>
          </div>` : null}
          ${geoTab === "blocking" ? html`
          <p class="hint" style="margin:0 0 12px">${Trich("The block-list feeds that fill the *Blocking* tab's content categories (ads, malware, adult, and so on). Core feeds are on by default; turn on any extra feed to add its lists to the Blocking picker. Turning one off hides its lists and *deactivates* anything already filtering from it until you re-enable it. Each feed keeps its own tag colour.")}</p>
          ${(() => { const bcp = (Store.blockCatalog || {}).providers || [];
            const bpOn = p => blockProvEdits[p.id] !== undefined ? blockProvEdits[p.id] : (p.enabled !== false);
            return bcp.length ? html`<div class="provlist">${bcp.map(p => { const on = bpOn(p); const pcv = provColors[p.id] || asThemed((ps.provider_colors || {})[p.id], p.color, p.color_l || p.color); return html`<div class=${"provrow bprow" + (on ? "" : " off")} key=${p.id}>
              <${Switch} on=${on} title=${on ? T("On — its lists are selectable in Blocking") : T("Off — its lists are hidden and deactivated on nodes")} onChange=${v => setBlockProvEdits(m => ({ ...m, [p.id]: v }))}/>
              <${ThemedSwatch} val=${pcv} title=${T("{v1} tag colour", { v1: p.label })} onChange=${nv => setProvColors(c => ({ ...c, [p.id]: nv }))}
                sample=${(c) => html`<span class="sw-sample" style=${"--pc:" + c}>${p.label}</span>`}/>
              <div class="bprov-meta">
                <div class="bprov-top"><span class="prov-name" style=${"color:" + pickThemed(pcv, _provColDefault(p.id).dark, _provColDefault(p.id).light)}>${p.label}</span><span class="prov-tiers">${capBadges({ host: p.tier === "host", ip: p.tier === "ip" })}</span></div>
                ${p.note ? html`<span class="bprov-note">${T(p.note)}</span>` : null}
              </div>
              <span class="grow"></span>
              ${p.url ? html`<a class="prov-repo" href=${p.url} target="_blank" rel="noopener" title=${T("Open {v1}", { v1: p.label })}>${(p.url || "").replace(/^https?:\/\/(github\.com|raw\.githubusercontent\.com)\//, "").replace(/^www\./, "")}</a>` : null}
            </div>`; })}</div>` : blockCatalogStatus(T("Loading providers…")); })()}
          <div class="seclabel" style="margin-top:20px">${T("Never block")}</div>
          <p class="hint" style="margin:0 0 8px">${T("Never blocked by any block list, on every interface and node — and still routed by your routing rules. Your own Block rules and the abuse protections are not affected. Addresses come out of every address list; site names out of the site lists, in Hybrid SNI mode. A name and an address are separate: a site name does not unblock an address an address list holds, and an address stays blocked by a site list while a blocked site resolves to it — list both when you need both. One site name, IP or range a line.")}</p>
          <textarea class="ta" rows="4" spellcheck="false" autocomplete="off" placeholder=${"example.com\n203.0.113.7\n198.51.100.0/24"} value=${blockAllow} onInput=${e => setBlockAllow(e.target.value)}></textarea>
          ${(bad => bad.length ? html`<div class="hint warnish"><${Ic} i="warn"/> ${T("Not taken — site names and IPv4 addresses or ranges (/8 or narrower) only: {v1}", { v1: bad.slice(0, 5).map(c => c.raw).join(", ") })}</div>` : null)(nbRead(blockAllow).filter(c => !c.ok))}
          <p class="hint" style="margin:6px 0 0">${T("To stop the port-scan guard flagging one of your own machines, use Trusted sources (Settings → Network).")}</p>
          <div class="seclabel" style="margin-top:20px">${T("Ports the torrent filter never cuts")}</div>
          <p class="hint" style="margin:0 0 8px">${T("A device the torrent filter has flagged keeps its connections to these ports — its VPN, calls, games. Torrents are still blocked by what they send, on every port. A node can keep its own list (Settings → Network → the node → Filters & abuse). Ports and ranges, comma-separated.")}</p>
          <div class="field" style="margin:0"><input class="mono" value=${pok} spellcheck="false" autocomplete="off" onInput=${e => setPok(e.target.value)}/>
            <${PortokHints} text=${pok}/>
            ${pok === P2P_PORTOK_DEFAULT.join(", ") ? null
              : html`<div style="margin-top:6px"><button class="btn btn-mini" onClick=${() => setPok(P2P_PORTOK_DEFAULT.join(", "))}>${T("Reset to defaults")}</button></div>`}</div>` : null}

          <div class="seclabel" style="margin-top:20px">${T("Update schedule")}</div>
          <p class="hint" style="margin:0 0 10px">${Trich("When each node re-fetches its lists. Refreshing briefly reloads the node's match sets, which clients can feel — so schedule it for a *quiet hour*. (A failed fetch retries on the next sync; existing lists keep working meanwhile.)")}</p>
          <div class="schedrow">
            <div class="field" style="margin:0"><label>${T("How often")}</label>
              <${Dropdown} value=${guEvery} onChange=${v => setGuEvery(v)} options=${[
                { value: "1", label: T("Every day") }, { value: "2", label: T("Every 2 days") }, { value: "3", label: T("Every 3 days") },
                { value: "7", label: T("Every week") }, { value: "0", label: T("Continuous (rolling ") + T("{v1}-day TTL)", { v1: ttlD }) }]}/></div>
            <div class="field" style="margin:0"><label>${T("At (node-local time)")}</label>
              <input type="time" class="timein" value=${guAt} disabled=${guEvery === "0"} onInput=${e => setGuAt(e.target.value || "04:00")}/>
              <div class="hint">${guEvery === "0" ? T("Continuous mode ignores the time — nodes refresh whenever a list is older than the TTL.") : T("Nodes update at this local time, on the chosen cadence.")}</div></div>
          </div>
          <div class="georefresh"><span class="faint" style="font-size:11px">${T("Re-fetch every routed list from its provider now (updates the panel; nodes pull the changes on their schedule)")}</span><button class="btn btn-mini" disabled=${geoUpdating} onClick=${updateAllLists}><span class=${geoUpdating ? "tf-arrow" : ""}><${Ic} i="refresh"/></span> ${geoUpdating ? T("Updating…") : T("Update all lists now")}</button></div>
        </div>` : null}
        ${section === "integrations" ? html`<${IntegrationsSettings}/>` : null}
        ${section === "logs" ? html`<div class="card">
          <div class="seclabel" style="margin-top:0">${T("Logging")}</div>
          <p class="hint" style="margin:0 0 12px">${T("How much the panel and every node write to their logs. One level for the whole fleet.")}</p>
          <div class="segrow logseg" role="radiogroup" aria-label=${T("Log level")}>
            ${LOG_LEVEL_IDS.map(v => html`<button type="button" role="radio" aria-checked=${logShown === v}
              class=${"seg" + (logShown === v ? " on" : "")} onClick=${() => pickLog(v)}>${logLevelLabel(v)}</button>`)}
          </div>
          ${logShown === "off"
            ? html`<div class="hint warnish"><${Ic} i="warn"/> ${logOffHint({
                bare: !(ps.log_panel || {}).docker || (Store.nodes || []).some(n => n.kind !== "docker"),
                docker: !!(ps.log_panel || {}).docker || (Store.nodes || []).some(n => n.kind === "docker" && n.platform !== "nixos"),
                nixos: (Store.nodes || []).some(n => n.kind === "docker" && n.platform === "nixos") })}</div>`
            : html`<div class="hint">${logLevelHint(logShown)}</div>`}
          ${logShown === "debug" ? html`<div class="field logdebug"><label>${T("Turn off debugging after")}</label>
            <div class="logdebug-row">
              <${Dropdown} className="logdebug-dd" value=${logForShown} onChange=${v => setLogEdit(logSaved() === "debug" && v === logForSaved ? null : { lvl: "debug", for: v })} ariaLabel=${T("Turn off debugging after")}
                options=${[{ value: "3600", label: T("1 hour") }, { value: "86400", label: T("24 hours") }, { value: "-1", label: T("debug|never") }]}/>
              ${!logEdit && ps.log_debug_left > 0 ? html`<span class="logdebug-left">${T("{v1} left", { v1: logLeftLabel(ps.log_debug_left) })}</span>` : null}
            </div>
            <div class="hint">${logForShown === "-1"
              ? T("Debug stays on until you pick another level.")
              : T("Then logging goes back to {v1}.", { v1: logLevelLabel(logBase) })}</div></div>` : null}
          <div class="hint" style="margin-top:12px">${T("Turn proxies, WireGuard interfaces and other third-party services pick up a change the next time they restart.")}</div>
          <${LogBudgetTable} onMb=${(id, v) => id === "" ? setLogMbP(v) : setNV(id, { log_mb: v })}
            rows=${[{ id: "", name: T("Panel"), mb: logMbP, saved: +(ps.log_mb_panel || 100), st: ps.log_panel || null,
                      docker: !!(ps.log_panel || {}).docker, locked: (ps.log_panel || {}).err === "nixos" },
                    ...[...(Store.nodes || [])].sort((a, b) => Store.byNode(a.id, b.id)).map(n => ({ id: n.id, name: n.name, mb: (nodeEdits[n.id] || nFields(n)).log_mb,
                      saved: +(n.log_mb || 100), st: n.log || null, docker: n.kind === "docker", stale: nodeStale(n.id) }))]}/>
        </div>` : null}
        ${section === "logs" ? html`<${LogViewer}/>` : null}
        ${section === "defaults" ? html`<div class="card">
          <div class="seclabel">${T("Peer health detection")}</div>
          <p class="hint" style="margin:0 0 10px">${Trich("Two ways a peer can be under a filter, each independently switchable. Both raise the same {v1} badge — one is blocked at the door, the other gets in and can't stay. A peer that simply has nothing to send is never flagged.", { v1: html`<span class="b-blocked" style="padding:1px 6px;border-radius:6px">${T("tag|restricted")}</span>` })}</p>
          <div class="condrow"><${Switch} on=${statusConds.blocked} onChange=${v => setStatusConds(c => ({ ...c, blocked: v }))}/>
            <span class="cond-b"><span class="badge b-blocked ic"><${Ic} i="warn"/>${T("tag|restricted")}</span></span>
            <span class="cond-t">${T("The client's packets reach the server but no handshake has ever completed — blocked at the door (likely DPI / MTU / wrong WireGuard or AmneziaWG params).")}</span></div>
          <div class="condrow"><${Switch} on=${statusConds.faulty} onChange=${v => setStatusConds(c => ({ ...c, faulty: v }))}/>
            <span class="cond-b"><span class="badge b-blocked ic"><${Ic} i="warn"/>${T("tag|restricted")}</span></span>
            <span class="cond-t">${T("The tunnel keeps collapsing and being rebuilt: handshakes far more often than the 120s a healthy session renews at, from an endpoint that isn't moving. A peer that simply has nothing to send is not flagged.")}</span></div>
          <div class="seclabel">${T("Defaults")}</div>
          <p class="hint" style="margin:0 0 12px">${T("Applied when creating a new interface — you can still override per interface.")}</p>
          <div class="field"><label>DNS</label><input value=${dns} onInput=${e => setDns(e.target.value)} placeholder=${T("https://8.8.8.8/dns-query, 1.1.1.1")}/><div class="hint">${T("Comma-separated")}</div></div>
          <div class="row2"><div class="field"><label>MTU</label><input value=${mtu} onInput=${e => setMtu(e.target.value)} placeholder="1280"/></div>
            <div class="field"><label>${T("Persistent keepalive (s)")}</label><input value=${ka} onInput=${e => setKa(e.target.value)} placeholder="25"/></div></div>
          ${(() => {
            const label = T("Who can open connections to devices on new interfaces");
            const everyone = reachEveryoneRows().length;
            return html`<div class="field reachfield"><label>${label}</label>
              <div class="dpsw netsw-share" role="radiogroup" aria-label=${label}>${[["everyone", T("Everyone on this node")], ["user", T("Same user and their groups")], ["none", T("Nobody")]].map(([mv, l]) => html`<button type="button" role="radio"
                aria-checked=${reachDef === mv} class=${reachDef === mv ? "on" : ""} onClick=${() => setReachDef(mv)}>${l}</button>`)}</div>
              <div class="hint">${T("Applies to interfaces created from now on.")} ${everyone
                ? html`<button type="button" class="linkbtn" onClick=${() => openModal(html`<${ReachEveryoneSheet}/>`)}>${T("Existing interfaces set to “Everyone on this node”: {n}", { n: everyone })}</button>`
                : T("No existing interface is set to “Everyone on this node”.")}</div></div>`;
          })()}
          <${AwgGenField} value=${awgGenDef} onChange=${setAwgGenDef} label=${T("AmneziaWG version for new interfaces")}
            hint=${T("Where the create form's switch starts. A node that cannot run 3.1 starts on 2.0, and existing interfaces keep their version.")}/>
            <${Disclosure} title=${T("AmneziaWG obfuscation")}
              summary=${AWG_KEYS.some(k => String(awgDef[k] ?? "").trim() !== "") || Object.keys(awg3Trim(awg3Def)).length ? T("settings|customised") : T("settings|built-in")}
              open=${awgOpen} onToggle=${() => setAwgOpen(o => !o)}>
              <p class="hint" style="margin:0 0 10px">${T("Defaults for new AmneziaWG interfaces. Leave a cell blank to use the selected version's generated value.")}</p>
              <${AwgGrid} value=${awgDef} onChange=${setAwgDef} placeholders=${awgBlankHints(awgGenDef)}
                omit=${T("Type - in a cell for no such line on the interfaces made from these; a blank cell stays automatic.")}/>
              <${Awg3Grid} value=${awg3Def} onKey=${(k, v) => setAwg3Def(o => ({ ...o, [k]: v }))} hpk=${T("val|per interface")} rt=${T("val|on")}
                hpkTip=${T("Each interface gets a key of its own — one key shared by every interface would protect nothing.")}
                rtTip=${T("On for every AmneziaWG 3.1 interface the panel sets up.")}
                placeholders=${ps.awg31_builtin || {}}
                hint=${T("Used when an interface is created on 3.1 or switched to it. Blank cells use the built-in values shown here.")}/>
            <//>
          <div class="seclabel">${T("Key escrow & recovery")}</div>
          <p class="hint" style="margin:0 0 10px">${T("Backup each server's interface key so a wiped / rebuilt node restores its interfaces with their original identities.")}</p>
          <${InterfaceKeyEscrow} value=${ivkEscrow} onChange=${setIvkEscrow} vaultExists=${ivkVaultExists}/>
        </div>` : null}
        ${section === "security" ? html`<div class="card">
          <div class="seclabel" style="margin-top:0">${T("Authentication")}</div>
          <p class="hint" style="margin:0 0 14px">${Trich("Change the panel username and password — applied on *{v1}*. Changing either takes effect immediately and you'll be asked to sign in again. Changing the password also re-keys your *Encryption Vault* in place, so stored configs and subscription links keep working (no re-issue).", { v1: T("Save") })}</p>
          ${!secAuth ? html`<div class="formmsg err">${T("This panel has no login configured — changes are disabled.")}</div>` : (secErr() ? html`<div class="formmsg err">${secErr()}</div>` : null)}
          <div class="field"><label>${T("Username")}</label><input value=${secUser} disabled=${!secAuth} onInput=${e => setSecUser(e.target.value)} autocomplete="username"/></div>
          <div class="field"><label>${T("Current password")}</label><input type="password" value=${secCur} disabled=${!secAuth} onInput=${e => setSecCur(e.target.value)} autocomplete="current-password" placeholder=${T("required to confirm a change")}/></div>
          <div class="row2"><div class="field"><label>${T("New password")}</label><input type="password" value=${secNp} disabled=${!secAuth} onInput=${e => setSecNp(e.target.value)} autocomplete="new-password" placeholder=${T("leave blank to keep current")}/></div>
            <div class="field"><label>${T("Confirm new password")}</label><input type="password" value=${secNp2} disabled=${!secAuth} onInput=${e => setSecNp2(e.target.value)} autocomplete="new-password"/></div></div>
        </div>` : null}
        ${section === "configs" ? html`<div class="card">
          <div class="seclabel" style="margin-top:0">${T("Client configs")}</div>
          <div class="field"><label>${T("Store client configs")}</label>
            <${Dropdown} value=${sc} onChange=${v => setSc(v)} options=${[
              { value: "encrypted", label: T("Keep encrypted configs — QRs re-viewable anytime") },
              { value: "off", label: T("Keep nothing — QR shown once") }]}/>
            <div class=${"hint" + (sc === "off" ? " err" : "")}>${sc === "off" ? T("Live tunnels and creation-time QRs are unaffected, but you won't be able to re-view a peer's QR/config later — you'd rotate its key and re-distribute.") : T("Client configs are stored encrypted at rest (the server can't read the private keys) so a peer's QR stays re-viewable — you unlock it with your encryption key below. Requires the encryption key.")}</div></div>
          ${sc === "off" && subsOn ? html`<div class="hint warn" style="margin-top:10px"><${Ic} i="warn"/> ${Trich("Subscriptions are on and need encrypted config storage. Turn {v1} off first, or keep encrypted storage on — saving this as-is will be rejected.", { v1: html`<button class="linkbtn" onClick=${() => setSection("subs")}>${T("Subscriptions")}</button>` })}</div>` : null}
          <div class="seclabel">${T("Encryption")}</div>
          <p class="hint" style="margin:0 0 8px">${T("An encryption key held only by you (independent of your login password) protects stored client configs so the server can't read the private keys, and unlocks a peer's QR any time you're signed in. The same key powers subscriptions when you turn them on.")}</p>
          <${SubVaultCard}/>
        </div>` : null}
        ${section === "subs" ? html`<div class="card">
          <div class="seclabel" style="margin-top:0">${T("Subscriptions")}</div>
          <p class="hint" style="margin:0 0 12px">${Trich("A shareable, themed, mobile page per user showing their QRs. The page's private keys ride in the URL *fragment* and are never sent to the panel — nothing readable is stored on the server. Treat each user's URL as a credential (whoever holds it holds that user's configs). A separate *swg-sub* service serves the page; configure it here and install it on the panel host.")}</p>
          <div class="field"><label>${T("Enable subscriptions")}</label>
            <${Dropdown} value=${subsOn ? "on" : "off"} disabled=${sc === "off"} onChange=${v => setSubsOn(v === "on")} options=${[
              { value: "off", label: T("Off — the subscription page is blocked entirely") },
              { value: "on", label: T("On — per-user subscription URLs are served") }]}/>
            ${sc === "off"
              ? html`<div class="hint warn">${Trich("Subscriptions serve the encrypted config blobs — turn on *Keep encrypted configs* in {v1} first.", { v1: html`<button class="linkbtn" onClick=${() => setSection("configs")}>${T("Client configs")}</button>` })}</div>`
              : html`<div class="hint">${T("Off returns 404 for every subscription URL, regardless of the rest.")}</div>`}</div>
          <div class="field"><label class="ivk-esc-row toggle-row"><${Switch} on=${autoGen} disabled=${!subsOn} onChange=${setAutoGen}/>
            <span>${T("Auto-generate subscription links for new users")}</span></label>
            <div class="hint">${T("When you create a user, mint their subscription link automatically, in the background (user creation stays instant). Needs the encryption key unlocked at that moment; otherwise the link is created the next time you open that user with the key unlocked.")}</div></div>
          <div class="seclabel">${T("Access expiry")}</div>
          <p class="hint" style="margin:0 0 12px">${Trich("A subscription or peer with an expiry date shows an orange *about to expire* warning this many days ahead.")}</p>
          <div class="field" style="max-width:340px"><label>${T("Warn before expiry (days)")}</label><input type="text" inputmode="numeric" value=${warnDays} onDblClick=${e => e.target.select()} onInput=${e => { let v = e.target.value.replace(/[^0-9]/g, ""); if (+v > 365) v = "365"; setWarnDays(v); }} placeholder=${T("Default: 3 (0 = warn only once expired)")}/></div>
          <div class="field"><label>${T("Public URL")}</label><code>${subBaseUrl()}</code></div>
          <div class="seclabel">${T("Languages")}</div>
          <div class="field"><label>${T("Offered on the subscription page")}</label>
            <div class="sublangs">${SUB_LANG_LIST.map(([id, name]) => html`<div class=${"sublang" + (subLangs.includes(id) ? " on" : "")} key=${id}>
              <label class="sublang-en"><input type="checkbox" checked=${subLangs.includes(id)} onChange=${e => toggleSubLang(id, e.target.checked)}/><span>${name}</span></label>
              <button class=${"sublang-def" + (subLangDef === id ? " on" : "")} disabled=${!subLangs.includes(id)} onClick=${() => setSubLangDef(id)} title=${T("Load this language by default")}>${subLangDef === id ? T("state|Default") : T("Set default")}</button>
            </div>`)}</div>
            <div class="hint">${Trich("Which languages the page offers. With just one enabled, it hides the selector and loads that language; the *default* is what loads first when several are offered.")}</div></div>
          <div class="seclabel">${T("Encryption")}</div>
          <p class="hint" style="margin:0">${Trich("Subscriptions reuse the same encryption key that protects your stored client configs — set it up under {v1}. No separate key.", { v1: html`<button class="linkbtn" onClick=${() => setSection("configs")}>${T("Client configs → Encryption")}</button>` })}</p>
        </div>` : null}
        ${section === "display" ? html`<div class="card">
          <div class="seclabel turnhead" style="margin-top:0">${T("Interface theme")}<span class="grow"></span>
            ${(themeColorS.toLowerCase() !== THEME_COLOR_DEFAULT.toLowerCase() || themeColorLightS.toLowerCase() !== THEME_COLOR_LIGHT_DEFAULT.toLowerCase()) ? html`<button class="btn btn-mini" onClick=${() => { setThemeColorS(THEME_COLOR_DEFAULT); setThemeColorLightS(THEME_COLOR_LIGHT_DEFAULT); }}><${Ic} i="refresh"/>${T("Reset")}</button>` : null}</div>
          <p class="hint" style="margin:0 0 12px">${Trich("The panel's accent colour — button borders, checkboxes, focus rings, the throughput \"down\" series and the live / hour / day / week / month chart tabs all follow it. A separate colour for each mode; switch *Light / Dark / Auto* from the sun / moon button in the header.")}</p>
          <div class="palrow">
            <${ThemedSwatch} val=${themeVal} title=${T("Interface theme")} onChange=${nv => { setThemeColorS(clampBrand(nv.dark, false)); setThemeColorLightS(clampBrand(nv.light, true)); }}
              sample=${(c) => html`<span class="tsw-theme"><span class="tsw-btn" style=${"color:" + c}>${T("sample|Button")}</span><span class="tsw-chip" style=${"color:" + c}></span></span>`}/>
          </div>
          <div class="seclabel">${T("Display")}</div>
          <div class="field"><label>${T("Throughput perspective")}</label>
            <${Dropdown} value=${tput} onChange=${v => setTput(v)} options=${[
              { value: "nodes", label: T("Nodes — what the node downloads / uploads") },
              { value: "peers", label: T("Peers — what the client downloads / uploads") }]}/>
            <div class="hint">${T("Which way ↓/↑ are labelled across the panel. Same numbers, swapped arrows.")}</div></div>
          <div class="field"><label>${T("Throughput units")}</label>
            <${Dropdown} value=${tunit} onChange=${v => setTunit(v)} options=${[
              { value: "bytes", label: T("Bytes — MB/s, what the node counts") },
              { value: "bits", label: T("Bits — Mbit/s, like a speed test") }]}/>
            <div class="hint">${T("How every speed in the panel is written. The same measurement either way — bits are 8× the number, and are what speed tests, ISP plans and router pages quote. Totals are always in bytes.")}</div></div>
          <div class="seclabel">${T("Data")}</div>
          <div class="field"><label class="toggle-row"><${Switch} on=${infHist} onChange=${v => v ? setInfHist(true) : confirmHistOff(() => setInfHist(false))}/>
            <span>${T("Infinite history")}</span></label>
            <div class="hint">${T("Keep every peer's detailed traffic — at the history resolution below — for ever. Turn this off to keep that detail for the last 33 days only; totals for any period are always kept.")}</div></div>
          <div class="field"><label>${T("History resolution")}</label>
            <${Dropdown} value=${histRes} onChange=${v => setHistRes(v)} options=${HIST_RES.map(n => ({ value: String(n), label: histResLabel(n) }))}/>
            <div class="hint">${T("How much detail the per-peer traffic graphs can show. Finer costs more disk. A change applies from the next day — today keeps the detail it started with.")}</div></div>
          <${HistoryUsage}/>
          <div class="field"><label>${T("Days are counted in")}</label>
            <${Dropdown} value=${tz} onChange=${v => setTz(v)} options=${tzOptions(tzCat, ps.time_zone_now || {}, tz)}/>
            <div class="hint">${T("Where each day starts and ends — for traffic totals, the charts and the turn-proxy update hour. Changing it shifts the charts' earlier points by the difference until they scroll out (up to 33 days).")}</div>
            ${(ps.time_zone_now || {}).missing ? html`<div class="hint warn"><${Ic} i="warn"/> ${T("This server no longer has {v1}, so days are counted in its own zone. Pick another zone and save.", { v1: ps.time_zone_now.missing })}</div>` : null}</div>
          <div class="seclabel">${T("Status timing")}</div>
          <p class="hint" style="margin:0 0 12px">${T("How long the panel waits before treating things as stale — in seconds.")}</p>
          <div class="row2"><div class="field"><label>${T("Node stale after (s)")}</label><input value=${staleS} onInput=${e => setStaleS(e.target.value)} placeholder="30"/><div class="hint">${T("No sync for this long → the node shows stale.")}</div></div>
            <div class="field"><label>${T("Peer grace window (s)")}</label><input value=${graceS} onInput=${e => setGraceS(e.target.value)} placeholder="60"/><div class="hint">${T("A peer stays \"online\" this long after its last handshake.")}</div></div></div>
          <div class="seclabel">${T("Overview lists")}</div>
          <p class="hint" style="margin:0 0 12px">${T("How many rows the Overview's ranked lists show (1–50).")}</p>
          <div class="row2"><div class="field"><label>${T("Top talkers")}</label><input type="text" inputmode="numeric" value=${topTalk} onDblClick=${e => e.target.select()} onInput=${e => { let v = e.target.value.replace(/[^0-9]/g, ""); if (+v > 50) v = "50"; setTopTalk(v); }} placeholder="10"/><div class="hint">${T("Number of peers in the Top talkers list (max 50).")}</div></div>
            <div class="field"><label>${T("Top destinations")}</label><input type="text" inputmode="numeric" value=${topDest} onDblClick=${e => e.target.select()} onInput=${e => { let v = e.target.value.replace(/[^0-9]/g, ""); if (+v > 50) v = "50"; setTopDest(v); }} placeholder="10"/><div class="hint">${T("Number of categories in the Top destinations list (max 50).")}</div></div></div>
        </div>` : null}
        ${section === "exits" ? html`<div class="card">
          ${nodeRec ? html`<${Fragment}>
            <div class="seclabel" style="margin-top:0">${T("{v1} — SOCKS5 exits", { v1: nodeRec.name })}</div>
            <${NodeExitsForm} key=${selNode} node=${nodeRec} vals=${nodeEdits[selNode]} set=${p => setNV(selNode, p)}
              goSection=${setSection} escrowOn=${ivkEscrowInit}
              saveExits=${async xs => {
                const rr = await api.nodeUpdate({ id: selNode, exits: xs });
                if (!rr || !rr.ok) {
                  toast(exitRefusalText(rr && rr.refusal, rr && rr.device) || srvText(rr) || T("Couldn't save"), "err");
                  return false;
                }
                await Store.poll();
                const fresh = nFields((Store.nodes || []).find(n => n.id === selNode) || {});
                setNV(selNode, { exits: fresh.exits });
                setOrig(o => ({ ...o, [selNode]: { ...(o[selNode] || {}), exits: fresh.exits.map(x => ({ ...x })) } }));
                rebaseDefault(selNode, fresh);
                return true;
              }}
              onBlock=${m => setExitWhy(w => (w[selNode] === m ? w : { ...w, [selNode]: m }))}/>
          <//>`
            : html`<p class="hint" style="margin:0">${T("No nodes yet — enroll a node to give it a way out that isn't its own address.")}</p>`}
        </div>` : null}
        ${section === "links" ? html`<${Fragment}><div class="card">
          <div class="seclabel" style="margin-top:0">${T("Mesh links")}</div>
          <p class="hint" style="margin:0 0 8px">${T("A full mesh links every pair of nodes: every leg is measured and a new forward target works at once, but each node carries one link per other node. On demand links only the pairs a forward or a smart rule routes over, and removes a link nothing has used for an hour.")}</p>
          <div class="field" style="max-width:460px;margin-bottom:6px"><${Dropdown} value=${meshMode} onChange=${v => setMeshMode(v)} options=${
            ["auto", "full", "demand"].map(v => ({ value: v, label: meshModeLabel(v, ps.mesh_auto_max) }))}/></div>
          ${meshMode === "auto" && (ps.mesh_mode || "auto") === "auto" && ps.mesh_effective ? html`<p class="hint" style="margin:0 0 14px">${ps.mesh_effective === "demand"
            ? T("This fleet is linked on demand now.")
            : T("Every pair in this fleet is linked now.")}</p>` : html`<div style="height:8px"></div>`}
          <${MeshGenField} label=${T("Default mesh link type")} value=${meshGen} onChange=${setMeshGen}
            hint=${T("What new links are made as. One link can have a type and AWG params of its own — on its card under Node connections, on a node's page. Re-provision a node to move its existing links to this default.")}/>
          <${MeshAwgParams} title=${T("Default mesh AWG params")} eff=${meshGen} value=${awg} onChange=${setAwg}
            placeholders=${awgBlankHints(meshGen)} ph3=${mesh3Hints(false)} about=${T("Obfuscation for new AmneziaWG mesh links, unless a link sets its own on its card. Blank = auto (a fresh set per link).")}/>
        </div>
        ${(Store.nodes || []).length ? html`<div class="setnodes" style="margin:16px 0 10px">${(Store.nodes || []).map(n => html`<button class=${"snbadge" + (selNode === n.id ? " on" : "") + (badgeDirty(n.id) ? " dirty" : "")} style=${"--c:" + Store.nodeColor(n.id)} onClick=${() => setSelNode(n.id)}><span class="ndot"></span>${n.name}</button>`)}</div>` : null}
        <div class="card">${nodeRec ? html`<${Fragment}>
            <div class="seclabel" style="margin-top:0">${T("{v1} — mesh", { v1: nodeRec.name })}</div>
            <${NodeMeshForm} node=${nodeRec} vals=${nodeEdits[selNode]} set=${p => setNV(selNode, p)}/><//>`
          : html`<p class="hint" style="margin:0">${T("No nodes yet — enroll a node to link it to the others.")}</p>`}</div><//>` : null}
        ${section === "mesh" ? html`<div class="card">
          ${nodeRec ? html`<${Fragment}>
            <div class="seclabel" style="margin-top:0">${T("{v1} — ingress", { v1: nodeRec.name })}</div>
            <${NodeIngressForm} node=${nodeRec} vals=${nodeEdits[selNode]} set=${p => setNV(selNode, p)}/>
            <div class="seclabel">${T("{v1} — outbound addresses", { v1: nodeRec.name })}</div>
            <${NodeEgressForm} node=${nodeRec} vals=${nodeEdits[selNode]} set=${p => setNV(selNode, p)}/>
          <//>`
            : html`<p class="hint" style="margin:0">${T("No nodes yet — enroll a node to configure how it is reached and how it exits.")}</p>`}
          <div class="seclabel lanfleet-head"><span>${T("Local networks")}</span>
            <span class="lanfleet-sw" title=${showLans ? T("Hide these and close them on every node") : T("Show these again — each node's own switch then decides who reaches it")}>
              <span>${T("Display in panel")}</span><${Switch} on=${showLans} onChange=${v => setShowLans(v)}
                title=${showLans ? T("Hide these and close them on every node") : T("Show these again — each node's own switch then decides who reaches it")}/></span></div>
          <p class="hint" style="margin:0 0 12px">${T("The private network each node sits on. Its clients reach it unless it is closed on that node — nobody sets this up, it is what routing does.")}</p>
          <div class="lanfleet">
            ${(Store.nodes || []).filter(n => (n.lans || []).length).map(n => html`<div class="lanfleet-row" key=${n.id}>
              <span class="nm">${n.name}</span>
              <span class="lanfleet-addrs">${(n.lans || []).map(l => html`<span class="lanaddr" key=${l.ip + "|" + (l.iface || "")}><span class="mono">${l.ip}</span>${l.iface ? html`<span class="faint">${l.iface}</span>` : null}</span>`)}</span>
              <span class="grow"></span>
              ${(st => html`<span class=${"lanfleet-st" + st.cls}>${st.t}</span>`)(
                n.lan_share !== false ? { cls: "", t: T("state|open") }
                  : !n.net_capable ? { cls: " warn", t: T("state|can't close") }
                    : (n.lan_block && n.lan_block.ok) ? { cls: " off", t: T("state|closed") }
                      : { cls: " warn", t: T("state|closing") })}
            </div>`)}
            ${!(Store.nodes || []).some(n => (n.lans || []).length) ? html`<p class="hint" style="margin:0">${T("No node reports sitting on a private network.")}</p>` : null}
          </div>
          <div class="seclabel lanfleet-head"><span>${T("Trusted sources")}</span></div>
          <p class="hint" style="margin:0 0 8px">${T("Addresses the port-scan guard never flags. A management box that reaches many servers looks like a scanner to it — name it here to leave it alone. One IP or range a line; a bare IP means that one host. Everything else is still checked.")}</p>
          <textarea class="ta" rows="3" spellcheck="false" autocomplete="off" placeholder="10.0.0.0/24&#10;198.51.100.7" value=${scanAllow} onInput=${e => setScanAllow(e.target.value)}></textarea>
        </div>` : null}
        <div class="setfoot">
          ${(Date.now() < saved ? html`<span class="savedflash"><${Ic} i="check"/> ${T("All settings saved")}</span>` : null)}
          <span class="grow"></span>
          <button class="btn btn-ghost btn-dismiss" onClick=${leaveSettings}>${T("Back")}</button>
          ${isMobile() && section ? html`<button class="btn btn-ghost m-setmenu" onClick=${() => { setSection(null); window.scrollTo(0, 0); }}>${T("Open menu")}</button>` : null}
          ${html`<button class="btn btn-primary" disabled=${!!secErr() || !!exitErr() || !anyDirty} title=${secErr() || exitErr() || (!anyDirty ? T("No changes to save") : "")} onClick=${confirmSave}>${T("Save")}</button>`}</div>
      </div>
    </div>
  </div>`;
}

export function reachEveryoneRows() {
  const out = [];
  for (const nd of (Store.nodes || [])) {
    for (const [ifn, mm] of Object.entries(Store.describe[nd.id] || {})) if (mm && !mm.system && mm.reach === "everyone") out.push({ node: nd.id, iface: ifn });
    for (const [ifn, c] of Object.entries(nd.wdtt_cfg || {})) if (c && c.reach === "everyone") out.push({ node: nd.id, iface: ifn });
    for (const [ifn, c] of Object.entries(nd.csqtt_cfg || {})) if (c && c.reach === "everyone") out.push({ node: nd.id, iface: ifn });
  }
  return out.sort((a, b) => Store.byNode(a.node, b.node) || a.iface.localeCompare(b.iface));
}
function ReachEveryoneSheet() {
  useStore();
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const all = reachEveryoneRows(), ql = q.trim().toLowerCase();
  const rows = ql ? all.filter(r => (Store.nodeName(r.node) + " " + r.iface).toLowerCase().includes(ql)) : all;
  const pg = Math.min(page, Math.max(1, Math.ceil(rows.length / LIST_PAGE)));
  return html`<${Sheet} title=${T("Interfaces set to “Everyone on this node”")} width=${560} noGuard=${true}
    foot=${html`<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}>
    <div class="hint">${T("Any device on the node can open connections to devices on these interfaces. Open one to change its level.")}</div>
    ${all.length > LIST_PAGE ? html`<input class="reachev-filter" value=${q} data-enter="self" placeholder=${T("Filter by node or interface…")}
      aria-label=${T("Filter by node or interface…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
    ${rows.length ? html`<div class="reachev-list">${pageSlice(rows, pg).map(r => html`<button type="button" class="reachev-row" key=${r.node + "/" + r.iface}
        title=${T("Edit interface · {v1}", { v1: r.iface })} onClick=${() => openIfaceEditor(r.node, r.iface)}>
        <span class="ifname">${r.iface}</span><span class="faint">${Store.nodeName(r.node)}</span><span class="grow"></span><${Ic} i="pencil"/></button>`)}</div>`
      : html`<div class="hint">${all.length ? T("No interface matches “{q}”.", { q }) : T("No existing interface is set to “Everyone on this node”.")}</div>`}
    <${ListPager} page=${pg} setPage=${setPage} total=${rows.length}/>
  <//>`;
}

export const LOG_MB_MIN = 16;
export const logMbBad = v => !/^\d+$/.test(String(v || "")) || +v < LOG_MB_MIN;
export function logBudgetState(r) {
  const st = r.st;
  if (r.locked) return { tone: "faint", text: T("System journal"), title: T("On NixOS the panel has no root helper here, so its lines stay in the system journal and its limits.") };
  if (!st) return r.stale ? { tone: "faint", text: T("Offline"), title: T("Not reporting — it applies the budget when it is back.") }
    : r.id === "" ? { tone: "warn", text: T("Waiting"), title: T("The panel's root helper reports within a few seconds of starting.") }
    : { tone: "warn", text: T("Update the node"), title: T("This node's build is too old to keep a log budget. Update it to apply one.") };
  if (st.err) return st.unsupported ? { tone: "bad", text: T("Not supported"), title: T("This server's journald has no namespaces, so swg's logs cannot have a budget of their own here.") }
    : { tone: "bad", text: T("Not applied"), title: T("The budget could not be applied ({v1}). It is tried again every minute.", { v1: st.err }) };
  if (r.stale) return { tone: "faint", text: T("Offline"), title: T("Not reporting — the figures are from its last report.") };
  if (+st.mb !== r.saved) return { tone: "warn", text: T("Pending"), title: r.id === "" ? T("The root helper applies it within 10 seconds.") : T("Applies on the node's next sync.") };
  return { tone: "ok", text: T("Applied"), title: "" };
}
export const logOffHint = ({ bare, docker, nixos }) => [
  T("swg's own logs are deleted, and nothing more is kept in them. A server's system journal keeps what it already holds — the kernel's P2P guard lines, with users' addresses, among them."),
  bare ? T("On bare metal, a turn proxy, relay or WDTT / csqtt server not restarted since the update still writes there.") : "",
  docker ? T("In Docker, each container's own log keeps its lines until the container is recreated; a turn container started before Off goes on logging until its next start.") : "",
  nixos ? T("On NixOS, a node's container logs to the host's system journal, which keeps those lines; a turn container started before Off goes on logging until its next start.") : "",
  T("Failure details go blank: when something breaks, the panel can't say why."),
].filter(Boolean).join(" ");
export function logHolds(st) {
  if (!st || !st.oldest || !st.mb) return null;
  if (!(st.used_mb >= st.mb * 0.85)) {
    let d = ""; try { d = new Date(st.oldest * 1000).toLocaleDateString(locale(), { month: "short", day: "numeric" }); } catch (_) {}
    return { full: false, text: T("since {v1}", { v1: d }) };
  }
  const h = Math.max(0, (panelNowS() - st.oldest) / 3600);
  return { full: true, text: h < 48 ? T("{v1} h", { v1: Math.round(h) }) : T("{v1} days", { v1: Math.round(h / 24) }) };
}
function LogBudgetTable({ rows, onMb }) {
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const ql = q.trim().toLowerCase();
  const shown = ql ? rows.filter(r => r.name.toLowerCase().includes(ql)) : rows;
  const pg = Math.min(page, Math.max(1, Math.ceil(shown.length / LIST_PAGE)));
  const anyDocker = rows.some(r => r.docker);
  return html`<div class="logbudget">
    <div class="seclabel">${T("Disk budget")}</div>
    <p class="hint" style="margin:0">${T("How much disk swg's logs may take on each server. When the budget is full, the oldest lines go first.")}</p>
    ${rows.length > LIST_PAGE ? html`<input class="reachev-filter" value=${q} data-enter="self" placeholder=${T("Filter by server…")}
      aria-label=${T("Filter by server…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
    <div class="lb-table" role="table" aria-label=${T("Disk budget")}>
      <div class="lb-row lb-head" role="row"><span role="columnheader">${T("Server")}</span><span role="columnheader">${T("Budget")}</span>
        <span role="columnheader">${T("Used")}</span><span role="columnheader">${T("Holds")}</span><span role="columnheader">${T("State")}</span></div>
      ${pageSlice(shown, pg).map(r => {
        const s = logBudgetState(r), st = r.st || {}, bad = logMbBad(r.mb), holds = logHolds(r.st);
        const pct = st.mb && st.used_mb != null && !st.err && !r.locked ? Math.min(100, Math.round(100 * st.used_mb / st.mb)) : null;
        return html`<div class="lb-row" role="row" key=${r.id || "_panel"}>
          <span class="lb-name" role="cell">${r.name}${r.docker ? html`<span class="lb-kind">docker</span>` : null}</span>
          <span class="lb-mb" role="cell"><input type="text" inputmode="numeric" class=${bad ? "bad" : ""} value=${r.mb} disabled=${r.locked}
            aria-label=${T("Budget for {v1}, MB", { v1: r.name })} title=${T("At least {v1} MB", { v1: LOG_MB_MIN })} aria-invalid=${bad ? "true" : "false"} onDblClick=${e => e.target.select()}
            onInput=${e => onMb(r.id, e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}/><span class="faint">${T("MB")}</span></span>
          <span class="lb-used" role="cell">${pct == null ? html`<span class="faint">—</span>` : html`
            <span class="lb-usedn">${T("{v1} MB", { v1: fmtNum(st.used_mb) })}</span>
            <span class="lb-meter" aria-hidden="true"><i style=${"width:" + pct + "%"}></i></span>`}</span>
          <span class=${"lb-holds" + (holds ? (holds.full ? "" : " since") : " none")} role="cell"
            title=${holds && !holds.full ? T("Nothing has been removed yet: every line since then is kept") : ""}>${holds
            ? html`<span class="lb-holdsl">${T("Holds")} </span>${holds.text}` : html`<span class="faint">—</span>`}</span>
          <span class=${"lb-state t-" + s.tone} role="cell" title=${s.title}>${s.text}</span>
        </div>`; })}
      ${!shown.length ? html`<div class="hint">${T("No server matches “{q}”.", { q })}</div>` : null}
    </div>
    <${ListPager} page=${pg} setPage=${setPage} total=${shown.length}/>
    <div class="hint" style="margin-top:12px">${T("Relays, turn proxies and WDTT / csqtt servers join the budget the next time they restart.")}</div>
    <div class="hint" style="margin-top:6px">${T("Kernel messages (the P2P guard, network devices) and WireGuard interfaces' own start and stop lines stay in the system journal, outside the budget.")}</div>
    ${anyDocker ? html`<div class="hint" style="margin-top:6px">${T("In docker the budget holds swg's own log files and the containers a node launches; each container's own docker log (10 MB × 3) is not counted.")}</div>` : null}
  </div>`;
}

export function CustomListSheet({ list, onSave, onClose }) {
  const [title, setTitle] = useState(list?.title || "");
  const [badges, setBadges] = useState(() =>
    classifyAll(customTargets(list)).filter(c => c.kind !== "invalid")
      .map(c => ({ t: "target", raw: c.raw, kind: c.kind, value: c.value })));
  const [lint, setLint] = useState(null);
  const err = lint || (!badges.length ? T("add at least one address, domain or pattern") : null);
  const save = () => { if (err) return; onSave({ ...(list || { _rid: newRid() }),
    title: title.trim() || "Untitled list",
    targets: badges.map(b => b.raw).join(", ") }); onClose(); };
  const foot = html`<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${onClose}>${T("Cancel")}</button><button class="btn btn-primary" disabled=${!!err} title=${err || ""} onClick=${save}>${list ? T("Save") : T("Add")}</button>`;
  return html`<${Sheet} title=${list ? T("Edit list") : T("New list")} width=${640} onClose=${onClose} foot=${foot}>
    <div class="field"><label>${T("Title")}</label><input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${T("e.g. Streaming")}/></div>
    <div class="field"><label>${T("Addresses, domains and patterns")}</label>
      <${TargetField} row=${{ badges }} onChange=${setBadges} onLint=${setLint} listEditor=${true}/>
      <${AsnHint} targets=${badges.map(b => b.raw).join(", ")}/>
      ${err ? html`<div class="rrlint" style="margin-top:5px">${err}</div>`
            : html`<div class="hint">${Trich("Domains match their subdomains too; IPs / CIDRs directly; an *AS number* (e.g. AS62041) resolves to that provider's IP ranges. Patterns work here exactly as they do in a rule.")}</div>`}</div>
  <//>`;
}

function NodeHostRow({ node, value, onChange, onRemove }) {
  const state = useHostOnNode(value, node.ips || []);
  return html`<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px">
    <div style="flex:1;min-width:0">
      <input value=${value} placeholder=${T("vpn.example.com")} onInput=${e => onChange(e.target.value)}/>
      ${state === "bad" ? html`<div class="hint err">${T("This doesn't resolve to an address on this node.")}</div>` : null}
    </div>
    <button class="btn btn-mini ico" title=${T("Remove")} onClick=${onRemove}><${Ic} i="trash"/></button>
  </div>`;
}

export function NodeHostList({ node, value, onChange }) {
  const hosts = value || [];
  const set = (i, v) => onChange(hosts.map((h, k) => (k === i ? v : h)));
  return html`<div class="field">
    <label>${T("Hostnames for this node")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— offered wherever a host is asked for")}</span></label>
    ${hosts.map((h, i) => html`<${NodeHostRow} key=${i} node=${node} value=${h}
        onChange=${v => set(i, v)} onRemove=${() => onChange(hosts.filter((_, k) => k !== i))}/>`)}
    <button class="btn btn-ghost btn-mini" style="margin-top:8px" onClick=${() => onChange([...hosts, ""])}>
      <${Ic} i="plus"/> ${T("Add a name")}</button>
    <div class="hint">${T("Every picker that asks for a host offers these — interfaces, turn proxies, WDTT and csqtt. They do not change what clients dial; the ingress address above does that.")}</div>
  </div>`;
}

const newExitId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)))
  .map(b => b.toString(16).padStart(2, "0")).join("");

function ExitEscrow({ node, ex, stored, live, goSection, escrowOn }) {
  const [busy, setBusy] = useState(false);
  if ((ex.producer || "adopted") !== "imported" || exitProv(ex) !== "warp") return null;
  const blob = (stored || {}).key_blob || null;
  const nodeHasKey = !!(live || {}).public_key;
  const prev = (stored || {}).key_blob_prev || null;
  const restoreErr = String((live || {}).restore_error || "").trim();
  if (restoreErr) return html`<span class="hint warn">${T("The escrowed key could not be put back — the node has kept the one it has.")}
    ${" "}${T("It reports: {v1}", { v1: T(restoreErr) })}
    ${" "}${T("Try again from a browser that can open the vault; if this node was rebuilt since the key was sealed, the escrow has to be re-sealed to it.")}</span>`;
  const restore = async (b, ask) => {
    if (!(await ensureVaultUnlocked(ask))) return;
    setBusy(true);
    try {
      const sealed = await ivkResealForNodeBlob(node.id, b, T("No escrowed key is stored for this exit."));
      const r = await api.exitRestore(node.id, ex.id, sealed, b && b.pub);
      toast(r && r.ok ? T("Restoring — the node applies it on its next sync.") : (srvText(r) || T("Failed")), r && r.ok ? "ok" : "err");
    } catch (e) { toast((e && e.message) || T("Failed"), "err"); }
    setBusy(false);
  };
  const ASK_BACK = () => ({
    title: T("Unlock to put the old key back"),
    reason: T("This exit's original account is escrowed under your encryption key — the panel only ever held the ciphertext, and only you can open it. Unlock it to put that account back, along with any WARP+ licence on it. Cloudflare picks the exit address, so the old one usually comes back with it."),
    consequence: T("nothing changes. The exit keeps the account it just registered, and the address websites see stays the new one."),
  });
  const ASK_FRESH = () => ({
    title: T("Unlock to restore this exit's key"),
    reason: T("This node has no key for this exit, and the one it had is escrowed under your encryption key — the panel only ever held the ciphertext. Unlock it to give the node its original account back instead of a new one."),
    consequence: T("nothing is restored. The node registers a new account on its next pass instead, and websites start seeing a different address."),
  });
  if (prev && prev.ct && nodeHasKey) {
    return html`<span>${T("This exit registered a new account, so the address websites see has changed. The panel still holds the key it had before.")}
      ${" "}<button class="btn btn-mini" disabled=${busy}
        onClick=${() => restore(prev, ASK_BACK())}>${busy ? T("Restoring…") : T("Put the old one back")}</button>
      ${" "}<button class="btn btn-mini btn-ghost" disabled=${busy} onClick=${async () => {
        setBusy(true);
        try {
          const r = await api.exitEscrowForget(node.id, ex.id);
          toast(r && r.ok ? T("Keeping the new account.") : (srvText(r) || T("Failed")), r && r.ok ? "ok" : "err");
        } catch (e) { toast((e && e.message) || T("Failed"), "err"); }
        setBusy(false);
      }}>${T("Keep the new one")}</button></span>`;
  }
  const _restorable = (blob && blob.ct) ? blob : prev;
  if (!_restorable || nodeHasKey) return null;
  return html`<span>${T("This node has no key for this exit. Restore the escrowed one to keep the same address, or leave it to register a new account.")}
    ${" "}<button class="btn btn-mini" disabled=${busy}
      onClick=${() => restore(_restorable, ASK_FRESH())}>${busy ? T("Restoring…") : T("Restore from vault")}</button></span>`;
}

function ExitUsedBy({ node, id }) {
  if (!id) return html`<span class="faint">—</span>`;
  const users = [];
  for (const [ifn, m] of Object.entries(Store.describe[node.id] || {})) {
    if (!m || m.system) continue;
    if (m.egress_mode === "exit" && String(m.exit_id || "") === String(id)) users.push([ifn, T("all traffic")]);
    else if (m.egress_mode === "smart") {
      const n = (m.routing || []).filter(r => r && r.action === "dev" && String(r.exit_id || "") === String(id)).length;
      if (n) users.push([ifn, plural(n, "rule")]);
    }
  }
  if (String(node.default_exit || "") === String(id)) users.push([T("This node's default"), T("anything not pinned elsewhere")]);
  if (!users.length) return html`<span class="faint">${T("val|Not used")}</span>`;
  const trig = html`<span class="exu-n">${plural(users.length, "user")}</span>`;
  return html`<${Popover} hoverOnly cls="exu-wrap" popCls="exu-pop" trigger=${trig}>
    ${users.map(([a, b], i) => html`<div class="deprow exu-r" key=${i}>
      <b>${a}</b><span class="grow"></span><span class="faint">${b}</span></div>`)}
    <div class="exu-f">${T("Turning it off sends these out directly — they keep the selection.")}</div>
  <//>`;
}

function ExitFields({ value, onChange, discovered, devEditable, submitLabel, onSubmit, onCancel, hint, addrs, isNic, gw, noAct }) {
  const key = e => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
                     if (e.key === "Escape") onCancel(); };
  const fld = (cls, label, ctl) => html`<span class=${"exname-f " + cls}>
    <span class="exname-lbl">${label}</span>${ctl}</span>`;
  return html`<div class="exname">
    ${fld("exname-t", T("Title — optional"), html`<input value=${value.title || ""} autofocus maxlength="40"
      spellcheck="false" autocomplete="off"
      onInput=${e => onChange({ title: e.target.value })} onKeyDown=${key}/>`)}
    ${fld("exname-d", T("Device name"), html`<input class="mono" value=${value.device || ""}
      spellcheck="false" autocomplete="off" readonly=${!devEditable} disabled=${!devEditable}
      placeholder=${T("e.g. tun0")}
      onInput=${e => onChange({ device: e.target.value })} onKeyDown=${key}/>`)}
    ${fld("exname-eg", T("Leaves as"), html`<${ExitEgressPick} discovered=${discovered} addrs=${addrs}
      value=${value.egress_ip || ""} onChange=${val => onChange({ egress_ip: val })}/>`)}
    ${isNic ? fld("exname-gw", T("Gateway"), html`<input class="mono" value=${value.gw || ""}
      spellcheck="false" autocomplete="off"
      placeholder=${gw ? T("Detected: {v1}", { v1: gw }) : "10.0.0.1"}
      onInput=${e => onChange({ gw: e.target.value })} onKeyDown=${key}/>`) : null}
    ${noAct ? null : html`<span class="exname-act">
      <button class="btn btn-mini" onClick=${onSubmit}>${submitLabel}</button>
      <button class="btn btn-mini ghost" onClick=${onCancel}>${T("val|Cancel")}</button>
    </span>`}
    ${hint ? html`<div class="hint exname-hint">${hint}</div>` : null}
  </div>`;
}

function ExitManageSheet({ node, seed, onSaved, onClose }) {
  const kindOf = (x, isCand) => (x.producer || "adopted") === "imported" ? "imported" : (isCand ? "found" : "custom");
  const isImp = r => r._kind === "imported";
  const isCand = n => !!candOf(node, n);
  const [rows, setRows] = useState(() => {
    const recs = (seed || []).map(x => ({ ...x, _src: x, _kind: kindOf(x, isCand(x.device)) }));
    const taken = new Set(recs.map(x => String(x.device || "")).filter(Boolean));
    const found = (node.exit_candidates || []).filter(c => c && c.offerable && !taken.has(String(c.name)))
      .map(c => ({ id: "", label: "", device: c.name, enabled: true, killswitch: false,
                   producer: "adopted", _kind: "found", _new: true }));
    return [...recs, ...found];
  });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState({});
  const dirtyRef = useRef(false);
  const cleanRef = useRef(null);
  const anyDirty = rows.some(r => r._dt || r._dd || r._df || r._de);
  const put = (i, patch) => { dirtyRef.current = true; setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); };
  const wire = r => ({
    ...(r._src || r), id: r.id || newExitId(), label: (r.label || "").trim(),
    producer: (r.producer || "adopted"), device: (r.device || "").trim(),
    enabled: r.enabled !== false, killswitch: !!r.killswitch,
    ...((r.producer || "adopted") === "imported"
      ? { profile_text: "" }
      : { egress_ip: String(r.egress_ip || "").trim() }),
  });
  const commit = async (payload, tag, live) => {
    setBusy(tag); setMsg("");
    const src = live || payload;
    const keep = payload.filter((r, i) => { const l = src[i] || r; return !l._new || l._dt || l._dd || l._df || l._de; });
    const r = await api.nodeUpdate({ id: node.id, exits: keep.map(wire) });
    setBusy("");
    if (!r || !r.ok) { setMsg(srvText(r) || T("Couldn't save")); return false; }
    await Store.poll();
    if (onSaved) onSaved();
    return true;
  };
  const clean = next => { dirtyRef.current = false;
    if (cleanRef.current) cleanRef.current();
    setRows(next.map(r => ({ ...r, _dt: false, _dd: false, _df: false, _de: false,
                             ...((r._dt || r._dd || r._df || r._de) ? { _new: false, _src: wire(r) } : {}) }))); };
  const saveAll = async () => { const next = rows.map(r => ((r._dt || r._dd || r._df || r._de) ? { ...r, id: r.id || newExitId() } : r));
    setRows(next); if (await commit(next, "all", next)) clean(next); };
  const del = (i, r) => openConfirm({
    title: T("Remove this interface?"), confirmLabel: T("Remove"), danger: true,
    body: T("{v1} is a name you added, and this node has never reported a device called that — removing it takes it out of every exit list. Nothing on the box is touched.", { v1: r.label || r.device }),
    onConfirm: async () => { const next = rows.filter((_, k) => k !== i); setRows(next);
      await commit(next.map(r => ({ ...(r._src || r), id: r.id })), "d" + i, next); },
  });
  const addRow = v => {
    const r = v || nv;
    const d = String(r.device || "").trim();
    if (!d) return;
    dirtyRef.current = true;
    setRows(rs => [...rs, { id: newExitId(), label: String(r.title || "").trim(), device: d,
                            enabled: true, killswitch: false, producer: "adopted",
                            egress_ip: String(r.egress_ip || "").trim(),
                            gw: String(r.gw || "").trim(),
                            _kind: isCand(d) ? "found" : "custom", _dd: true, _added: true }]);
    setAdding(false); setNv({});
  };
  const TYPE = { found: ["found", T("val|Discovered")], custom: ["custom", T("val|Custom")],
                 unsaved: ["unsaved", T("val|Unsaved")] };
  return html`<${Sheet} title=${T("Ways out of {v1}", { v1: node.name })} width=${980}
    dirtyRef=${dirtyRef} cleanRef=${cleanRef} onClose=${onClose}
    foot=${footRow({ left: msg ? html`<span class="err">${msg}</span>` : null,
                     onCancel: onClose || closeModal, cancelLabel: T("Close"),
                     action: anyDirty ? (busy === "all" ? T("Saving…") : T("Save changes")) : null,
                     onAction: saveAll, disabled: !!busy })}>
    <p class="hint" style="margin:0 0 16px">${Trich("Every way *{v1}* can leave that isn't its own address. WARP accounts, pasted profiles and dial-in exits are created under Settings → WARP & exits; the devices below the line are this node's own, or names you add here.", { v1: node.name })}</p>
    ${isMobile() ? html`<button class="btn btn-primary m-addtop" onClick=${() => pushModal(html`<${AddExitDeviceSheet} onAdd=${addRow}
        fields=${(v, set, submit) => html`<${ExitFields} value=${v} onChange=${p => set(x => ({ ...x, ...p }))}
          discovered=${candAddr(node, v.device)} addrs=${cardAddrs(node, v.device)}
          isNic=${isCardName(node, v.device)} gw=${cardGateway(node, v.device)} devEditable=${true} noAct=${true}
          onSubmit=${submit} onCancel=${closeModal}
          hint=${T("A device this node hasn't reported. Add it if you know it is there — nothing is checked until the node next syncs.")}/>`}/>`)}>
      <${Ic} i="plus"/> ${T("Add an interface by name")}</button>` : null}
    <div class="exgrid g8x">
      <div class="exg-r"><div class="exg-h">${T("Title")}</div>
      <div class="exg-h">${T("Device")}</div>
      <div class="exg-h">${T("val|Type")}</div>
      <div class="exg-h">${T("Leaves as")}</div>
      <div class="exg-h">${T("Used by")}</div>
      <div class="exg-h c">${T("Kill-switch")}</div>
      <div class="exg-h c">${T("Active")}</div>
      <div class="exg-h"></div></div>
      ${rows.map((r, i) => {
        const src = (node.exits || []).find(x => String(x.id) === String(r.id)) || null;
        const [cls, lbl, kind] = (r._added && !r._src) ? TYPE.unsaved
          : isImp(r)
            ? exitBadge(r, (src || {}).live)
            : (TYPE[r._kind] || TYPE.custom);
        const why = (r._src || {}).why_not || "";
        const c = candOf(node, r.device);
        const off = r.enabled === false;
        return html`<div class="exg-r" key=${r.id || ("f" + r.device)}>
          <div class=${"exg-c" + (off ? " dim" : "")}>
            <input value=${r.label || ""} placeholder=${T("val|Untitled")} maxlength="40"
              onInput=${e => put(i, { label: e.target.value, _dt: true })}/></div>
          <div class=${"exg-c" + (off ? " dim" : "")}>
            ${(() => {
              if (!src) return null;
              const h = exitHealth(src, node);
              return html`<span class="exg-h8"><span class=${"exg-dot " + h.dot} title=${h.why}></span>
                ${exitHealthMark(h)}</span>`;
            })()}
            ${r._kind === "custom"
              ? html`<input class="mono" value=${r.device || ""} spellcheck="false"
                  onInput=${e => put(i, { device: e.target.value, _dd: true })}/>`
              : html`<span class="mono exg-dev">${r.device}</span>`}
            ${why ? html`<span class="exg-bad" title=${why}>${T("val|unusable")}</span>` : null}
          </div>
          <div class="exg-c"><span class=${"exg-t " + cls}
            title=${[kind || "", (c || {}).address || "", (c || {}).up === false ? T("not up") : ""].filter(Boolean).join(" · ")}>${lbl}</span></div>
          <div class="exg-c" data-lbl=${T("Leaves as")}>${isImp(r)
            ? (() => {
                const ins = exitInsideAddr(r, ((node.exits || []).find(x => String(x.id) === String(r.id)) || {}).live);
                return ins ? html`<span class="mono faint" title=${T("The tunnel's own address — traffic leaves as this.")}>${ins}</span>`
                           : html`<span class="faint">—</span>`;
              })()
            : (() => {
                const known = candAddr(node, r.device);
                const risky = !known && !String(r.egress_ip || "").trim();
                const why = T("This node has never reported an IP address for this device. If it doesn't have one, traffic sent through it is thrown away on the way out, and nothing here will look wrong. Type the address in if you know it.");
                return html`<span class=${"exg-inw" + (risky ? " risky" : "")} title=${risky ? why : ""}>
                  <${ExitEgressPick} discovered=${known} value=${r.egress_ip || ""}
                    addrs=${cardAddrs(node, r.device)}
                    onChange=${val => put(i, { egress_ip: val, _de: true })}/>
                  ${risky ? html`<span class="exg-warn" title=${why}><${Ic} i="warn"/></span>` : null}
                </span>`;
              })()}</div>
          <div class="exg-c" data-lbl=${T("Used by")}><${ExitUsedBy} node=${node} id=${r.id}/></div>
          <div class="exg-c c" data-lbl=${T("Kill-switch")}><${Switch} on=${!!r.killswitch} title=${KS_TITLE()}
            onChange=${v => put(i, { killswitch: v, _df: true })}/></div>
          <div class="exg-c c" data-lbl=${T("Active")}><${Switch} on=${!off} title=${ACTIVE_TITLE()}
            onChange=${v => put(i, { enabled: v, _df: true })}/></div>
          <div class="exg-c exg-act">
            ${r._kind === "custom"
              ? html`<button class="exg-rm" title=${T("Remove")} onClick=${() => del(i, r)}><${Ic} i="trash"/></button>`
              : null}
          </div>
        </div>`;
      })}
    </div>
    ${!rows.length ? html`<p class="hint">${T("This node reports no devices that could be an exit, and nothing has been added by hand.")}</p>` : null}
    ${isMobile() ? null : adding
      ? html`<${ExitFields} value=${nv} onChange=${p => setNv(x => ({ ...x, ...p }))}
          discovered=${candAddr(node, nv.device)} addrs=${cardAddrs(node, nv.device)}
          isNic=${isCardName(node, nv.device)} gw=${cardGateway(node, nv.device)} devEditable=${true}
          submitLabel=${T("val|Add")} onSubmit=${() => addRow()} onCancel=${() => { setAdding(false); setNv({}); }}
          hint=${T("A device this node hasn't reported. Add it if you know it is there — nothing is checked until the node next syncs.")}/>`
      : html`<button class="btn btn-ghost btn-mini" style="margin-top:14px" onClick=${() => setAdding(true)}>
          <${Ic} i="plus"/> ${T("Add an interface by name")}</button>`}
  <//>`;
}

function profileText(ex) {
  const p = ex.profile || {};
  if (!p.address) return "";
  const din = !!p.listen_port && !p.endpoint;
  return ["[Interface]",
          "PrivateKey = " + (Store.exitKeyKeep || "(unchanged)"),
          "Address = " + String(p.address).split("/")[0] + "/32",
          "MTU = " + (p.mtu || 1280),
          ...(din ? ["ListenPort = " + p.listen_port] : []),
          ...awgConfLines(p.awg),
          "", "[Peer]",
          "PublicKey = " + (p.peer_key || ""),
          ...(p.psk ? ["PresharedKey = " + (Store.exitPskKeep || "(unchanged)")] : []),
          "AllowedIPs = 0.0.0.0/0",
          ...(din ? [] : ["Endpoint = " + (p.endpoint || "")]),
          ...(p.keepalive && !din ? ["PersistentKeepalive = " + p.keepalive] : [])].join("\n") + "\n";
}

const exitInsideAddr = (ex, live) => String(((live || (ex || {}).live || {}).address)
  || (((ex || {}).profile || {}).address) || "").split("/")[0].trim();

const exitDefaultTitle = ex => exitProv(ex) === "profile" ? ((ex || {}).dialin || exitIsDialin(ex)
    ? (exitIsDialin(ex) ? T("Dial-in exit :{v1}", { v1: ex.profile.listen_port }) : T("Dial-in exit")) : T("Custom exit"))
  : exitProv(ex) === "warp" ? T("WARP exit") : exitProv(ex) === "socks5" ? T("SOCKS5 exit") : exitProv(ex);

const badgeLabel = lbl => String(lbl).endsWith("+")
  ? html`${String(lbl).slice(0, -1)}<span class="exg-plus">+</span>`
  : lbl;
const exitBadgeOf = (ex, live) => exitProv(ex) === "profile"
  ? ((live || {}).awg && awgDict3(((ex || {}).profile || {}).awg)
      ? ["exawg exawg3", T("val|Custom"), T("AmneziaWG 3.1")]
      : [(live || {}).awg ? "exawg" : "exwg", T("val|Custom")])
  : exitProv(ex) === "socks5" ? ["exsocks", T("val|SOCKS5")]
  : exitProv(ex) !== "warp" ? ["exwg", exitProv(ex)]
  : (String((ex || {}).licence || "").trim() || /plus/.test(((live || {}).account_type) || ""))
    ? ["warp plus", badgeLabel(T("val|WARP+"))]
    : ["warp", T("val|WARP")];
const exitBadge = (ex, live) => {
  const b = exitBadgeOf(ex, live);
  return exitIsDialin(ex) || (ex || {}).dialin ? [b[0], T("val|Dial-in"), ...b.slice(2)] : b;
};

const DIALIN_NOTE = {};

const nodeDialHost = node => turnDialFallback((node || {}).id);

export function routerConf(host, prof, routerPriv, nodePub, psk) {
  const h = /:/.test(host) && !/^\[/.test(host) ? "[" + host + "]" : host;
  const o = String(prof.address || "").split("."), ra = o.length === 4 ? [o[0], o[1], o[2], Number(o[3]) ^ 1].join(".") + "/31" : prof.address + "/32";
  return buildConf({ privkey: routerPriv, address: ra, mtu: prof.mtu || 1280,
                     awg_params: prof.awg, server_pubkey: nodePub, psk, allowed: prof.address + "/32",
                     endpoint: h + ":" + prof.listen_port, keepalive: 25 });
}
const qrSafe = t => String(t || "").replace(/[<>&"']/g, "");

const ROUTER_VIEW = { kind: "keenetic" };
const ROUTER_KINDS = [["keenetic", "Keenetic"], ["openwrt", "OpenWrt"], ["other", ""]];
const cmdBlock = text => html`<div class="netsnip"><pre class="mono nixblock">${text}</pre>
  <button type="button" class="btn btn-ghost btn-mini" onClick=${() => copy(text, T("Copied"))}><${Ic} i="copy"/> ${T("Copy")}</button></div>`;
export function routerSteps(kind, ex, conf) {
  const addr = (ex.profile || {}).address || "", tag = "swg-" + ex.id, awg = Object.keys((ex.profile || {}).awg || {}).length > 0;
  const KN_NAT = "interface WireguardN security-level private\nip nat WireguardN\nsystem configuration save",
        KN_POLICY = "ip hotspot policy WireguardN PolicyN\nsystem configuration save",
        LX_MASQ = `UPLINK=eth0\nsysctl -w net.ipv4.ip_forward=1\niptables-restore --noflush <<EOF\n*filter\n:${tag}-fwd - [0:0]\n`
          + `-A ${tag}-fwd -d 10.0.0.0/8,100.64.0.0/10,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16 -j DROP\n`
          + `-A ${tag}-fwd -o $UPLINK -j ACCEPT\n-A ${tag}-fwd -j DROP\nCOMMIT\nEOF\n`
          + `iptables -C FORWARD -i ${tag} -j ${tag}-fwd 2>/dev/null || iptables -I FORWARD -i ${tag} -j ${tag}-fwd\n`
          + `iptables -C FORWARD -o ${tag} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I FORWARD -o ${tag} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT\n`
          + `iptables -C INPUT -i ${tag} -m conntrack ! --ctstate RELATED,ESTABLISHED -j DROP 2>/dev/null || iptables -I INPUT -i ${tag} -m conntrack ! --ctstate RELATED,ESTABLISHED -j DROP\n`
          + `iptables -t nat -C POSTROUTING -s ${addr} -o $UPLINK -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s ${addr} -o $UPLINK -j MASQUERADE`;
  if (kind === "keenetic") return [
    html`${T("Import the config: Internet → Other connections → WireGuard → Import from file. Leave “Use for accessing the Internet” off — the router keeps its own internet; this tunnel only carries the node's traffic out.")}`,
    html`${Trich("Find its name: `show interface` on the command page (my.keenetic.net/a) lists it as WireguardN, described {v1}. Then, with your N:", { v1: tag })}
      ${cmdBlock(KN_NAT)}`,
    html`${T("If this router's own internet goes through a VPN — swg or another — keep this tunnel on your provider, with a connection policy that uses only the provider's connection:")}
      ${cmdBlock(KN_POLICY)}`,
  ];
  if (kind === "openwrt") return [
    html`${awg
      ? T("Network → Interfaces → Add new interface, protocol AmneziaWG (the amneziawg packages), then load this config into it. Leave “Route Allowed IPs” off.")
      : T("Network → Interfaces → Add new interface, protocol WireGuard VPN, then “Load configuration…” with this config. Leave “Route Allowed IPs” off.")}`,
    html`${T("Firewall: put the interface in a zone that may forward to wan — wan masquerades by default, so the node's traffic leaves as the router.")}`,
    html`${Trich("If wan is not this router's default route (its own internet goes through a VPN), send traffic from `{v1}` out by wan with policy-based routing (pbr).", { v1: addr })}`,
  ];
  return [
    html`${Trich("Bring the config up: save it as `/etc/{v1}/{v2}.conf` and run `{v3} up {v2}`.", awg
      ? { v1: "amnezia/amneziawg", v2: tag, v3: "awg-quick" } : { v1: "wireguard", v2: tag, v3: "wg-quick" })}`,
    html`${T("Let the node's traffic out to the internet only, masqueraded — not into your local networks, nor to this machine itself. Set UPLINK to your internet interface:")}
      ${cmdBlock(LX_MASQ)}`,
    html`${T("If this machine's own internet goes through a VPN, send the node's address out by your internet interface with a policy rule.")}`,
  ];
}

function RouterConfSheet({ node, ex, conf, kept: kept0, onRegen, changed }) {
  useStore();
  const ks = kept0 === EXIT_KEEP_LOCKED ? exitKeepState(node.id, ex.id) : undefined;
  const kept = kept0 !== EXIT_KEEP_LOCKED ? kept0 : ks === null ? true : ks === "queued" ? EXIT_KEEP_LOCKED : ks;
  const name = ex.label || exitDefaultTitle(ex);
  const port = (ex.profile || {}).listen_port;
  const [kind, setKind] = useState(ROUTER_VIEW.kind);
  const longest = Math.max(20, ...String(conf).split("\n").map(l => l.length));
  const keep = useRef(kept !== true);
  if (kept === true) keep.current = false;
  const took = () => { keep.current = false; };
  return html`<${Sheet} title=${T("Router config — {v1}", { v1: name })} width=${720} noSwipe=${kept !== true} dirtyRef=${keep}
    foot=${footRow({ onCancel: closeModal, cancelLabel: T("Done"),
                     left: onRegen ? html`<button class="btn btn-ghost" onClick=${onRegen}><${Ic} i="refresh"/> ${T("Regenerate router config")}</button>` : null })}>
    ${changed ? html`<div class="notice warn" style="margin:0 0 12px"><${Ic} i="warn"/><span>${T("The router config changed — {v1}. Import this one on the router again.", { v1: changed })}</span></div>` : null}
    ${kept === true
      ? html`<p class="hint" style="margin:0 0 12px">${T("Kept encrypted with your client configs — the QR button on the exit's row shows it again.")}</p>`
      : html`<div class="notice warn" style="margin:0 0 12px"><${Ic} i="warn"/><span>${
          kept === false ? T("Not kept — keeping encrypted client configs is off (Settings → Client configs). Download or copy it now; once closed, only Regenerate makes a new one.")
          : kept === EXIT_KEEP_LOCKED ? T("Not kept yet — the encryption key is locked. Unlock it in this tab before you reload and it is kept; otherwise download or copy it now.")
          : T("Shown once — the router's private key is not kept anywhere. Lost it? Regenerate the router config.") + (typeof kept === "string" ? " " + T("Not kept with your client configs: {v1}.", { v1: kept }) : "")}</span></div>`}
    ${!nodeDialHost(node) ? html`<div class="notice warn" style="margin:0 0 12px"><${Ic} i="warn"/><span>${kept === true
      ? T("This node has no ingress address yet, so the Endpoint line is incomplete. Set one under Settings → Network, then open it again from the exit's row.")
      : T("This node has no ingress address yet, so the Endpoint line is incomplete. Set one under Settings → Network, then regenerate.")}</span></div>` : null}
    ${node.kind === "docker" && node.net_mode === "bridge" ? html`<div class="notice warn" style="margin:0 0 12px"><${Ic} i="warn"/><span>${Trich("This docker node uses `bridge` networking — publish the exit's UDP port in the node's `docker-compose.yml` ({ports}) and `up -d`, or the router can't reach it.", { ports: 'ports: "' + port + ":" + port + '/udp"' })}</span></div>` : null}
    <div class="rconf">
      <div class="rconf-fit"><pre class="mono rconf-text" style=${"--rconf-cols:" + longest}>${conf}</pre></div>
      <div class="rconf-side">
        <${QR} conf=${conf} label=${qrSafe(name)} px=${220}/>
        <div class="rconf-acts">
          <button class="btn btn-ghost btn-mini" onClick=${() => { took(); downloadConf(conf, "swg-" + ex.id); }}><${Ic} i="download"/> ${T("Download .conf")}</button>
          <button class="btn btn-ghost btn-mini" onClick=${() => { took(); copy(conf, T("Router config copied")); }}><${Ic} i="copy"/> ${T("Copy")}</button>
        </div>
      </div>
    </div>
    <div class="seclabel" style="margin-top:16px">${T("On the router")}</div>
    <div class="segrow rkind" role="radiogroup" aria-label=${T("On the router")}>${ROUTER_KINDS.map(([k, l]) => html`<button type="button" role="radio" aria-checked=${kind === k} class=${"seg" + (kind === k ? " on" : "")}
      onClick=${() => { ROUTER_VIEW.kind = k; setKind(k); }}>${l || T("Other router")}</button>`)}</div>
    <ol class="rsteps">
      ${routerSteps(kind, ex, conf).map(st => html`<li>${st}</li>`)}
      <li>${T("If this node itself is behind NAT, forward UDP {v1} to it.", { v1: port })}</li>
      <li>${T("The exit's row turns green about a minute after traffic starts to flow — the node waits that long before it routes back through a tunnel that failed.")}</li>
    </ol>
  <//>`;
}

const DIALIN_RANGE = "42821–42899";
const REGEN_BUSY = { on: false };
const DIALIN_PORT_HINT = () => T("Blank: a free port of {v1} — on a node whose firewall is declared (NixOS), inside what it declares. Not 51820, the port every scanner tries first.", { v1: DIALIN_RANGE });
function dialinTpl(proto) {
  const tpl = ((Store.panelSettings || {}).interface_defaults || {}).awg_params || {};
  return Object.fromEntries(AWG_KEYS.map(k => { const t = String(tpl[k] ?? "").trim();
    return [k, !awgFieldCheck(k, t).ok || (proto === "awg3" && /^S[1-4]$/.test(k) && !(/^[0-9]+$/.test(t) && +t >= 12)) ? "" : t]; }));
}
function dialinHints(proto) {
  const tpl = dialinTpl(proto), b = awgBlankHints(proto === "awg3" ? "3.1" : "2.0");
  return Object.fromEntries(AWG_KEYS.map(k => [k, tpl[k] === "-" ? T("val|none") : tpl[k] || b[k]]));
}
const DIN_WIRE = 60;
function dialinS4Room(mtu) {
  return /^[0-9]+$/.test(String(mtu ?? "").trim()) ? Math.max(0, 1500 - DIN_WIRE - Number(mtu)) : null;
}
function dialinS4(s4, mtu, floor) {
  const room = dialinS4Room(mtu);
  if (room === null || !/^[0-9]+$/.test(String(s4)) || +s4 <= room) return String(s4);
  const lo = Math.max(floor, Math.min(15, room)), hi = Math.max(lo, room);
  return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
}
const dialinProto = awg => awgDict3(awg) ? "awg3" : AWG_KEYS.some(k => String((awg || {})[k] ?? "").trim() !== "") ? "awg2" : "wg";
function dialinDraw(proto, awg, fresh, mtu) {
  const gen = proto === "awg3" ? "3.1" : "2.0", room = dialinS4Room(mtu || 1280);
  const g = genAwg(gen, room === null ? undefined : Math.max(12, room));
  const h3 = mesh3Hints(false), out = { ...(awg || {}) }, tpl = dialinTpl(proto);
  const typedS4 = String(out.S4 ?? "").trim() !== "" && !fresh;
  for (const k of AWG_KEYS) {
    if (String(out[k] ?? "").trim() === "") out[k] = tpl[k] || String(g[k] ?? "");
    else if (fresh && /^[SH][1-4]$/.test(k) && String(out[k]).trim() !== "-") out[k] = String(g[k]);
  }
  if (!typedS4 && String(out.S4).trim() !== "-") out.S4 = dialinS4(out.S4, mtu || 1280, proto === "awg3" ? 12 : 0);
  if (proto === "awg3") for (const k of AWG3_EDIT_COLS.flat())
    if (String(out[k] ?? "").trim() === "" && String(h3[k] ?? "").trim()) out[k] = h3[k] === T("val|none") ? "-" : String(h3[k]);
  return out;
}
function DialinParams({ proto, awg, onAwg, edit, mtu }) {
  const [open, setOpen] = useState(false);
  const a = awg || {}, isSet = [...AWG_KEYS, ...(proto === "awg3" ? AWG3_EDIT_COLS.flat() : [])].some(k => String(a[k] ?? "").trim() !== "");
  if (proto === "wg") return null;
  return html`<div class="dinparams"><button type="button" class="advtoggle" aria-expanded=${open ? "true" : "false"} onClick=${() => setOpen(!open)}>
      <span class="advcaret">${open ? "▾" : "▸"}</span> ${T("Parameters")}${isSet ? "" : html` <span class="faint" style="font-weight:400">${T("(auto)")}</span>`}</button>
    ${open ? html`<div class="field dinparams-body">
      <${AwgGrid} value=${a} onChange=${onAwg} placeholders=${dialinHints(proto)}
        omit=${T("Type - in a cell for no such line on the router either; a blank cell is drawn — the value shown in it, or a random one.")}/>
      ${proto === "awg3" ? html`<div style="margin-top:14px"><${Awg3Grid} value=${a} onKey=${(k, x) => onAwg({ ...a, [k]: x })} placeholders=${mesh3Hints(false)}
        hpk=${a.HeaderProtectionKey ? T("val|set") : T("val|generated")} rt=${T("val|on")}
        hpkTip=${T("Drawn for this exit; the router's config carries the same key.")} rtTip=${T("On for every AmneziaWG 3.1 exit.")}/></div>` : null}
      <div class="dinparams-acts"><button type="button" class="btn btn-mini" onClick=${() => onAwg(dialinDraw(proto, a, edit, mtu))}
          title=${edit ? T("S1–S4 and H1–H4 are drawn anew, and every blank cell — the router has to import its config again.") : null}>
          <${Ic} i="refresh"/>${T("Generate a set")}</button>${isSet && !edit ? html`<button type="button" class="btn btn-mini"
          onClick=${() => onAwg({})}>${T("Clear (auto)")}</button>` : null}</div>
    </div>` : null}</div>`;
}
function confIfSpan(s) {
  const m = /^[ \t]*\[Interface\][^\n]*(?:\n|$)/mi.exec(s), from = m ? m.index + m[0].length : 0, nx = /^[ \t]*\[/m.exec(s.slice(from));
  return [from, nx ? from + nx.index : s.length];
}
const confIfRe = k => new RegExp("^[ \\t]*" + k + "[ \\t]*=[ \\t]*(.*)(?:\\n|$)", "gmi");
const confIfLine = (txt, k) => {
  const s = String(txt), [a, b] = confIfSpan(s), all = [...s.slice(a, b).matchAll(confIfRe(k))];
  return all.length ? all[all.length - 1][1].replace(/\r$/, "") : null;
};
function confIfSet(txt, k, v) {
  const s = String(txt), [a, b] = confIfSpan(s), sec = s.slice(a, b), val = String(v ?? "").replace(/^[ \t]+/, "");
  const keep = !["", "-"].includes(val.trim()), line = k + " = " + val + "\n", hits = [...sec.matchAll(confIfRe(k))];
  let out = "", at = 0;
  hits.forEach((h, i) => { out += sec.slice(at, h.index) + (keep && i === hits.length - 1 ? line : ""); at = h.index + h[0].length; });
  out += sec.slice(at);
  if (keep && !hits.length) { const body = out.replace(/\n*$/, ""); out = (body ? body + "\n" : "") + line + out.slice(body.length).replace(/^\n/, ""); }
  return s.slice(0, a) + out + s.slice(b);
}

function DialinGenSheet({ node, onCreate, onPaste }) {
  const [label, setLabel] = useState("");
  const no31 = node.awg31_no ? srvText(node.awg31_no) : "";
  const [proto, setProto] = useState(no31 ? "wg" : "awg3");
  const [port, setPort] = useState(""), [mtu, setMtu] = useState(""), [awg, setAwg] = useState({});
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const go = async () => {
    setBusy(true); setMsg("");
    let r;
    const keys = proto === "wg" ? [] : [...AWG_KEYS, ...(proto === "awg3" ? AWG3_EDIT_COLS.flat() : [])];
    const typed = { listen_port: port.trim(), mtu: mtu.trim(),
                    awg: Object.fromEntries(keys.filter(k => String(awg[k] ?? "").trim() !== "").map(k => [k, String(awg[k]).trim()])) };
    try { r = await onCreate(label.trim(), proto, typed); } catch (e) { r = String((e && e.message) || e); }
    setBusy(false);
    if (r !== true) setMsg(typeof r === "string" ? r : T("Couldn't save"));
  };
  const opts = [["wg", T("val|WireGuard"), ""], ["awg2", T("AmneziaWG 2.0"), ""], ["awg3", T("AmneziaWG 3.1"), no31]];
  return html`<${Sheet} title=${T("Dial-in exit")} width=${600}
    foot=${footRow({ left: msg ? html`<span class="err">${msg}</span>` : null, onCancel: closeModal,
                     action: busy ? T("Creating…") : T("Create"), onAction: go, disabled: busy })}>
    <p class="hint" style="margin:0 0 12px">${T("For an upstream that can't be reached — a router behind NAT: it connects to this node.")}
      ${" "}${T("The panel makes both sides; you import the router's config on the router.")}</p>
    <div class="row2 dinrow"><div class="field"><label>${T("Title")}</label>
      <input value=${label} placeholder=${T("Dial-in exit")} maxlength="40" onInput=${e => setLabel(e.target.value)}/></div>
      <div class="field dinport"><label>${T("Port")}</label>
        <input inputmode="numeric" value=${port} placeholder=${T("val|Auto")} title=${DIALIN_PORT_HINT()} onInput=${e => setPort(e.target.value)}/></div>
      <div class="field dinmtu"><label>${T("MTU")}</label>
        <input inputmode="numeric" value=${mtu} placeholder="1280" onInput=${e => setMtu(e.target.value)}/></div></div>
    <div class="hint dinport-hint">${DIALIN_PORT_HINT()}</div>
    <div class="field awggen"><label>${T("Protocol")}</label>
      <div class="dpsw awgsw" role="radiogroup" aria-label=${T("Protocol")}>${opts.map(([k, l, no]) => html`<button type="button" role="radio" key=${k}
        aria-checked=${proto === k} class=${(proto === k ? "on" : "") + (k === "awg3" ? " sw-awg3" : "")} disabled=${proto !== k && !!no}
        title=${proto !== k && no ? no : null} onClick=${() => setProto(k)}>${l}</button>`)}</div>
      <div class="hint">${no31 ? T("AmneziaWG 3.1: {v1}", { v1: no31 }) + (/[.!?…]$/.test(no31) ? " " : ". ") : ""}${T("The router must be able to import it — check what its firmware supports.")}</div></div>
    <${DialinParams} proto=${proto} awg=${awg} onAwg=${setAwg} mtu=${mtu.trim()}/>
    <p class="hint" style="margin:14px 0 0">${T("Already have the router's config?")}${" "}
      <button type="button" class="linkbtn" onClick=${() => onPaste(label.trim())}>${T("Paste the server config instead")}</button></p>
  <//>`;
}

export const socksText = ex => { const s = (ex || {}).socks || {};
  if (!s.host) return "";
  return s.user && /[:@%]/.test(s.user) ? "socks5://" + encodeURIComponent(s.user) + "@" + s.host + ":" + s.port
    : (s.user ? s.user + "@" : "") + s.host + ":" + s.port; };
export const nodePublicIp = node => ((node || {}).ips || []).find(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip)
  && !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)) || "";

export const socksWhy = (code, node) => ({
  unreachable: T("The proxy can't be reached from this node."),
  refused: T("The proxy refused the connection — is the port right?"),
  timeout: T("The proxy didn't answer in time."),
  not_socks5: T("That address doesn't speak SOCKS5."),
  auth_required: T("The proxy wants a login, and none is set."),
  auth_failed: T("The proxy refused the login — check the user and password."),
  not_allowed: T("The proxy refused this node's address. Some providers make you allow-list the server's IP: {v1}.",
                 { v1: nodePublicIp(node) || T("this node's public address") }),
  connect_failed: T("The proxy logged us in but couldn't reach the internet."),
  expired: T("The node didn't answer the test in time — is it online?"),
})[code] || "";

export const socksSays = (r, node) => {
  if (!r) return [];
  if (r.why) return [["bad", socksWhy(r.why, node) || r.why]];
  const out = [["ok", r.egress_ip
    ? (r.loc ? T("Logged in. Sites see {v1} ({v2}).", { v1: r.egress_ip, v2: r.loc }) : T("Logged in. Sites see {v1}.", { v1: r.egress_ip }))
    : T("Logged in.")]];
  if (r.udp === true) out.push(["ok", T("UDP is carried — calls and games work through this exit.")]);
  else if (r.udp === false) out.push(["warn", T("UDP is not carried — calls and games won't work through this exit. Other traffic is fine: QUIC falls back to TCP at once.")]);
  return out;
};

const NOT_A_LOGIN = { autocomplete: "off", "data-1p-ignore": "", "data-lpignore": "true", "data-bwignore": "",
                      "data-protonpass-ignore": "", "data-form-type": "other" };
const S5X_VIEW = { notes: false };

function SocksExitFields({ node, ex, isNew, sTxt, setSTxt, sPass, setSPass, dirtyRef }) {
  const st = (ex && ex.socks) || {};
  const live = (((node.exits || []).find(x => String(x.id) === String(ex.id)) || {}).live) || {};
  const [test, setTest] = useState(null);
  const [tmsg, setTmsg] = useState("");
  const [, bump] = useState(0);
  const pending = !!test && test.state === "pending";
  useEffect(() => {
    if (!pending) return;
    let ok = true, n = 0;
    const h = setInterval(async () => {
      if (++n > 70) { clearInterval(h); setTest(null); setTmsg(T("The node didn't answer the test in time — is it online?")); return; }
      try {
        const r = await api.exitTest({ node: node.id, id: test.id });
        if (ok && r && r.ok) setTest(r.data);
        else if (ok && r && r.code === "not_found") {
          clearInterval(h); setTest(null); setTmsg(T("The panel no longer has that test — run it again."));
        }
      } catch (e) {   }
    }, 1500);
    return () => { ok = false; clearInterval(h); };
  }, [pending, test && test.id]);
  const run = async () => {
    setTmsg(""); setTest(null);
    try {
      const r = await api.exitTest({ node: node.id, exit_id: isNew ? "" : ex.id, socks_text: sTxt.trim(),
                                     socks_pass: sPass || (st.has_pass ? Store.exitPassKeep : "") });
      if (r && r.ok) return setTest(r.data);
      setTmsg(r && r.code === "busy" ? T("A test is already running on this node — try again in a moment.")
            : r && r.code === "offline" ? T("This node isn't reporting, so it can't run the test.")
            : srvText(r) || T("Couldn't start the test."));
    } catch (e) { setTmsg(T("Couldn't start the test.")); }
  };
  const canTest = !pending && (sTxt.trim() || !isNew);
  const key = e => { if (e.key === "Enter") { e.preventDefault(); if (canTest) run(); } };
  const says = test && !pending ? socksSays(test.result, node) : [];
  const last = !test && !isNew ? socksSays(live.check, node) : [];
  const line = ([tone, t]) => { const d = tone === "ok" ? "on" : tone === "warn" ? "note" : "blocked";
    return html`<div class=${"netgw t-" + d}><span class=${"condot " + d}></span><span>${t}</span></div>`; };
  return html`<div class="s5x">
    <div class="field"><label>${T("Proxy address")}</label>
      <input class="mono" value=${sTxt} spellcheck="false" data-enter="self" ...${NOT_A_LOGIN}
        placeholder=${T("host:port:user:password")}
        onInput=${e => { dirtyRef.current = true; setSTxt(e.target.value); }} onKeyDown=${key}/>
      <div class="hint">${T("As your provider shows it: host:port:user:password, user:password@host:port or socks5://user:password@host:port. SOCKS5 only.")}</div></div>
    <div class="field"><label>${T("Password")}</label>
      <div class="s5x-row">
        <input type="password" value=${sPass} ...${NOT_A_LOGIN} autocomplete="new-password" data-enter="self" onKeyDown=${key}
          placeholder=${st.has_pass ? T("unchanged") : T("none, or in the address above")}
          onInput=${e => { dirtyRef.current = true; setSPass(e.target.value); }}/>
        <button type="button" class="btn btn-ghost s5x-go" disabled=${!canTest} onClick=${run}>
          <${Ic} i="refresh"/> ${pending ? T("testing…") : T("Test from the node")}</button>
      </div></div>
    <div class="netprobe s5x-test">
      ${pending ? html`<div class="netgw"><span class="condot"></span><span>${T("Waiting for {node} to ask the proxy and report back — a few seconds.", { node: node.name })}</span></div>` : null}
      ${tmsg ? line(["bad", tmsg]) : null}
      ${says.map(line)}
      ${!says.length && last.length ? html`<div class="netprobe-h">${T("Last check by the node:")}</div>` : null}
      ${!says.length ? last.map(line) : null}
    </div>
    <${Disclosure} title=${T("How names and UDP work through this exit")} open=${S5X_VIEW.notes}
      onToggle=${() => { S5X_VIEW.notes = !S5X_VIEW.notes; bump(x => x + 1); }}>
      <p class="hint">${T("Names are looked up by the proxy, not here: clients on this exit get stand-in addresses (198.19.x.x) that the proxy turns back into the name — so sites see a location that matches the exit. An app that keeps a stand-in address longer than a second can fail to connect once, after the exit restarts.")}</p>
      <p class="hint">${T("A DNS server set for an interface that leaves by this exit is not used — the proxy resolves.")}</p>
      <p class="hint">${T("A residential proxy may change its exit IP between checks — that is the provider, not a fault.")}</p>
      ${node.kind === "docker" ? html`<p class="hint">${T("This is a Docker node: the SOCKS5 tunnel has no CPU cap of its own — the container's limit is its cap.")}</p>` : null}
    <//>
  </div>`;
}

function ExitEditSheet({ node, ex, isNew, escrowOn, goSection, onSave, onClose }) {
  const [v, setV] = useState(() => ({ ...ex, profile_text: "" }));
  const [txt, setTxt] = useState(() => profileText(ex));
  const [txt0] = useState(() => profileText(ex));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dirtyRef = useRef(false);
  const isProf = exitProv(v) === "profile", isWarp = exitProv(v) === "warp", isSocks = exitProv(v) === "socks5";
  const [sTxt, setSTxt] = useState(() => socksText(ex));
  const [sTxt0] = useState(() => socksText(ex));
  const [sPass, setSPass] = useState("");
  const isDialin = !!v.dialin || exitIsDialin(ex);
  const set = patch => { dirtyRef.current = true; setV(x => ({ ...x, ...patch })); };
  const [dinBlank, setDinBlank] = useState({});
  const dinProto = isDialin ? dialinProto((ex.profile || {}).awg) : "wg";
  const dinKeys = dinProto === "wg" ? [] : [...AWG_KEYS, ...(dinProto === "awg3" ? AWG3_EDIT_COLS.flat() : [])];
  const dinAwg = Object.fromEntries(dinKeys.map(k => [k, dinBlank[k] ? "" : (confIfLine(txt, k) ?? "-")]));
  const dinPort0 = String((ex.profile || {}).listen_port || "");
  const dinLine = (k, val) => {
    dirtyRef.current = true;
    if (dinKeys.includes(k)) setDinBlank(b => ({ ...b, [k]: String(val ?? "").trim() === "" }));
    setTxt(t => confIfSet(t, k, val));
  };
  const dinAwgSet = d => { for (const k of dinKeys) if (String(d[k] ?? "") !== String(dinAwg[k] ?? "")) dinLine(k, d[k]); };
  const stored = (node.exits || []).find(x => String(x.id) === String(ex.id)) || {};
  const dirty = isNew || txt !== txt0 || Object.values(dinBlank).some(Boolean)
    || (isSocks && (sTxt !== sTxt0 || !!sPass))
    || ["label", "dial_src", "licence"].some(k => String(v[k] ?? "") !== String(ex[k] ?? ""));
  const save = async () => {
    setBusy(true); setMsg("");
    if (isProf && isNew && !txt.trim()) { setBusy(false); return setMsg(T("Paste the profile before saving.")); }
    if (isSocks && isNew && !sTxt.trim()) { setBusy(false); return setMsg(T("Paste the proxy's address before saving.")); }
    let out = txt;
    if (isDialin && !isNew) {
      if (confIfLine(out, "MTU") === null) out = confIfSet(out, "MTU", "1280");
      const drawn = dialinDraw(dinProto, dinAwg, false, confIfLine(out, "MTU"));
      for (const k of dinKeys) if (dinBlank[k]) out = confIfSet(out, k, drawn[k]);
      if (confIfLine(out, "ListenPort") === null && dinPort0) out = confIfSet(out, "ListenPort", dinPort0);
    }
    const body = { ...v, ...(isProf && out !== profileText(ex) ? { profile_text: out } : { profile_text: "" }),
                   ...(isDialin || isSocks ? { dial_src: "" } : {}),
                   ...(isSocks ? { socks_text: sTxt !== sTxt0 ? sTxt.trim() : "",
                                   socks_pass: sPass || (((ex || {}).socks || {}).has_pass ? Store.exitPassKeep : "") } : {}) };
    const ok = await onSave(body);
    setBusy(false);
    if (ok !== true) return setMsg(typeof ok === "string" ? ok : T("Couldn't save"));
    (onClose || closeModal)();
  };
  return html`<${Sheet} title=${v.label || exitDefaultTitle(v)} width=${680} dirtyRef=${dirtyRef} onClose=${onClose}
    headExtra=${html`<span class="exed-hx">
      ${(() => { const [bc, bl, bk] = exitBadge(v, ((node.exits || []).find(x => String(x.id) === String(ex.id)) || {}).live);
         return html`<span class=${"exg-t " + bc} title=${bk || ""}>${bl}</span>`; })()}
      <span class="mono exed-dev">${v.device || ""}</span>
      <span class="grow"></span>
      <span class="exed-used"><${ExitUsedBy} node=${node} id=${ex.id}/></span>
    </span>`}
    foot=${footRow({ left: msg ? html`<span class="err">${msg}</span>` : null,
                     onCancel: onClose || closeModal,
                     action: busy ? T("Saving…") : T("Save changes"), onAction: save,
                     disabled: busy || !dirty,
                     title: !busy && !dirty ? T("No changes to save") : "" })}>
    ${isDialin ? html`<p class="hint" style="margin:0 0 12px">${T("For an upstream that can't be reached — a router behind NAT: it connects to this node.")}</p>` : null}
    <div class=${isDialin ? (isNew ? "" : "row2 dinrow") : "row2"}>
      <div class="field"><label>${T("Title")}</label>
        <input value=${v.label || ""} placeholder=${exitDefaultTitle(v)} maxlength="40" ...${NOT_A_LOGIN}
          onInput=${e => set({ label: e.target.value })}/></div>
      ${isDialin && !isNew ? html`<div class="field dinport"><label>${T("Port")}</label>
        <input inputmode="numeric" value=${confIfLine(txt, "ListenPort") ?? ""} placeholder=${dinPort0}
          onInput=${e => dinLine("ListenPort", e.target.value)}/></div>
        <div class="field dinmtu"><label>${T("MTU")}</label>
          <input inputmode="numeric" value=${confIfLine(txt, "MTU") ?? ""} placeholder="1280"
            onInput=${e => dinLine("MTU", e.target.value)}/></div>` : null}
      ${isDialin || isSocks ? null : html`<div class="field"><label>${T("Connect from")}</label>
        <${NodeIpPick} ips=${node.ips || []} value=${v.dial_src || ""} onChange=${ip => set({ dial_src: ip })} auto=${T("val|Auto")}/></div>`}
    </div>
    ${isDialin && !isNew ? html`<${DialinParams} edit proto=${dinProto} onAwg=${dinAwgSet} mtu=${confIfLine(txt, "MTU") || ""}
      awg=${dinProto === "awg3" ? { ...dinAwg, HeaderProtectionKey: confIfLine(txt, "HeaderProtectionKey") || "" } : dinAwg}/>` : null}
    ${isProf
      ? html`<div class="field"><label>${isDialin ? T("This node's end") : T("Configuration")}</label>
          <textarea class="exprof" rows="11" spellcheck="false" value=${txt}
            placeholder=${isDialin ? T("Paste this node's side: [Interface] with ListenPort, one [Peer] — the router — with no Endpoint")
                                   : T("Paste the [Interface] / [Peer] profile here")}
            onInput=${e => { dirtyRef.current = true; setDinBlank({}); setTxt(e.target.value); }}/>
          <div class="hint">${isDialin
            ? T("This node's end of the tunnel: it listens on the ListenPort and the router dials it. The peer's AllowedIPs is ignored — everything is sent to the router. The PrivateKey line stands for this node's own key, which the panel keeps and never shows: leave it and the key is kept, replace it and the new one is used. The router has its own key — its config opens from the QR button on the exit's row.")
            : T("Edit it here or paste a replacement. IPv4 only — the v6 half is dropped, and routing lines are ignored because this node decides its own. The PrivateKey line is a placeholder: leave it and the stored key is kept, replace it and the new one is used.")}</div>
          ${isDialin && node.kind === "docker" && node.net_mode === "bridge"
            ? html`<div class="notice warn" style="margin-top:10px"><${Ic} i="warn"/><span>${Trich("This docker node uses `bridge` networking — publish the exit's UDP port in the node's `docker-compose.yml` ({ports}) and `up -d`, or the router can't reach it.", { ports: ((q => 'ports: "' + q + ":" + q + '/udp"')((/^\s*ListenPort\s*=\s*(\d+)/mi.exec(txt) || [])[1] || (ex.profile || {}).listen_port || "PORT")) })}</span></div>`
            : null}</div>`
      : isSocks ? html`<${SocksExitFields} node=${node} ex=${ex} isNew=${isNew} sTxt=${sTxt} setSTxt=${setSTxt}
          sPass=${sPass} setSPass=${setSPass} dirtyRef=${dirtyRef}/>`
      : !isWarp ? html`<p class="hint">${T("This panel does not know this kind of exit. It is kept as it is; you can switch it off or remove it.")}</p>`
      : html`<div class="field"><label>${T("WARP+ licence key")}</label>
          <input value=${v.licence || ""} spellcheck="false" autocomplete="off"
            placeholder=${T("WARP+ licence key — optional")}
            onInput=${e => set({ licence: e.target.value })}/>
          <div class="hint">${T("A free account is registered without one. Paste a key from the WARP mobile app to upgrade this exit to WARP+.")}</div></div>`}
    <div class="hint exstat" style="margin-top:6px">
      <${ExitEscrow} node=${node} ex=${v} stored=${stored} live=${stored.live} goSection=${goSection} escrowOn=${escrowOn}/>
    </div>
  <//>`;
}

const KS_TITLE = () => T("On: if this exit stops working, traffic using it is refused. Off: it falls back to this node's own address.");
const ACTIVE_TITLE = () => T("Off pauses this exit — its account and keys are kept, and anything pointing at it stays pointed at it and uses the node's default meanwhile.");

export function NodeExitsForm({ node, vals, set, onBlock, goSection, escrowOn, saveExits }) {
  const all = (vals || {}).exits || node.exits || [];
  const isW = x => (x.producer || "adopted") === "imported";
  const exits = all.filter(isW);
  const stored = id => (node.exits || []).find(o => String(o.id) === String(id)) || {};
  const write = xs => (saveExits ? saveExits([...xs, ...all.filter(x => !isW(x))]) : Promise.resolve(false));
  useEffect(() => { if (onBlock) onBlock(""); }, []);
  const fresh = id => (((Store.nodes || []).find(n => n.id === node.id) || {}).exits || []).find(x => String(x.id) === String(id)) || null;
  const askKeep = isNew => ensureVaultUnlocked({ title: T("Unlock to keep the router config"),
    reason: T("The router's config is kept encrypted with your client configs — only you can read it, with your encryption key. Unlock it so the exit's row can show the config again."),
    consequence: isNew ? T("the exit is created and works, but its router config is shown once only — unless you unlock the key in this tab before you reload.")
                       : T("both sides still get new keys, but the router's new config is shown once only — unless you unlock the key in this tab before you reload.") });
  const generate = async (rec, proto, typed) => {
    if (proto) await askKeep(true);
    const nk = await genKeys(), rk = await genKeys(), psk = genPSK();
    const body = { ...rec, profile_text: "", dial_src: "", dialin_gen: { proto, private_key: nk.priv, peer_key: rk.pub, psk, ...(typed || {}) } };
    const isNew = !exits.some(x => String(x.id) === String(rec.id));
    const r = await write(isNew ? [...exits, body] : exits.map(x => (String(x.id) === String(rec.id) ? { ...x, ...body } : x)));
    let st = r === true ? fresh(rec.id) : null;
    for (let i = 0; r === true && i < 3 && !(st && st.profile && st.profile.peer_key === rk.pub); i++) {
      await new Promise(ok => setTimeout(ok, 700)); await Store.poll(); st = fresh(rec.id);
    }
    if (r !== true) return T("Couldn't save");
    const kept = await exitKeepRouter(node.id, rec.id, rk.pub, rk.priv, nk.pub, nk.priv);
    if (!st || !st.profile || st.profile.peer_key !== rk.pub)
      return kept === true ? { info: T("Saved, but the panel did not return the exit — reload, and the QR button on its row shows the router config.") }
                           : { info: T("Saved, but the panel did not return the exit — reload and regenerate.") };
    delete DIALIN_NOTE[rec.id];
    closeModal();
    openModal(html`<${RouterConfSheet} node=${node} ex=${st} kept=${kept} onRegen=${() => regen(st)}
      conf=${routerConf(nodeDialHost(node), st.profile, rk.priv, nk.pub, psk)}/>`);
    return true;
  };
  const regenNow = async (ex, fromSheet) => {
    let r;
    try { r = await generate({ ...ex }, null); } catch (e) { r = String((e && e.message) || e); }
    if (r === true) return;
    if (r && r.info) { if (fromSheet) closeModals(2); return toast(r.info); }
    toast(typeof r === "string" ? r : T("Couldn't save"), "err");
  };
  const REGEN_BODY = () => T("Both sides get new keys. The router stops connecting until it imports the new config.");
  const regen = async ex => {
    if (REGEN_BUSY.on) return;
    REGEN_BUSY.on = true;
    try { await askKeep(false); } finally { REGEN_BUSY.on = false; }
    openConfirm({ title: T("Regenerate the router config?"), confirmLabel: T("Regenerate"), body: REGEN_BODY(), onConfirm: () => regenNow(ex, true) });
  };
  const showRouter = async ex => {
    const ask = () => ensureVaultUnlocked({ always: true, title: T("Unlock to show the router config"),
      reason: T("The router's config is kept encrypted with your client configs — only you can read it, with your encryption key."),
      consequence: T("the router config is not shown.") });
    if (Store.storeMode === "encrypted" && !(await ask())) return;
    let st = fresh(ex.id);
    let r = exitIsDialin(st) ? await exitRouterKey(node.id, ex.id) : null;
    if (r === EXIT_LOCKED) {
      if (!(await ask())) return;
      r = await exitRouterKey(node.id, ex.id);
    }
    if (r && r.k && r.pub !== st.profile.peer_key) { await Store.poll(); st = fresh(ex.id); }
    if (r === CONF_UNREACHABLE || r === EXIT_LOCKED || (r && r.k && !(exitIsDialin(st) && r.pub === st.profile.peer_key))) return toast(T("Couldn't reach the panel just now, so the router config could not be read. It has not been lost — try again in a moment."), "err");
    if (!r || r === CONF_SEALED_OLD) return openConfirm({ title: T("No router config is kept for this exit"),
      body: (Store.storeMode !== "encrypted"
        ? T("Keeping encrypted client configs is off, so the router's private key was shown once and not kept.")
        : r === CONF_SEALED_OLD
        ? T("It was kept under a previous encryption key, which this vault cannot open.")
        : T("It was made before the router's key was kept, pasted from elsewhere, or its keys changed since.")) + " " + REGEN_BODY(),
      confirmLabel: T("Regenerate"), onConfirm: () => regenNow(ex) });
    const changed = DIALIN_NOTE[ex.id];
    delete DIALIN_NOTE[ex.id];
    openModal(html`<${RouterConfSheet} node=${node} ex=${st} kept=${true} onRegen=${() => regen(st)} changed=${changed}
      conf=${routerConf(nodeDialHost(node), st.profile, r.k, r.n, st.profile.psk)}/>`);
  };
  const openEdit = (ex, isNew) => openModal(html`<${ExitEditSheet} node=${node} ex=${ex} isNew=${isNew}
    escrowOn=${escrowOn} goSection=${goSection}
    onSave=${async body => {
      const next = isNew ? [...exits, { ...ex, ...body }]
                         : exits.map(x => (String(x.id) === String(ex.id) ? { ...x, ...body } : x));
      const before = (ex.profile && ex.profile.listen_port && !ex.profile.endpoint) ? ex.profile : null;
      const r = await write(next);
      const after = r === true && before ? (fresh(ex.id) || {}).profile : null;
      if (after && after.listen_port && !after.endpoint) {
        const ch = [];
        if (before.listen_port !== after.listen_port) ch.push(T("port {v1} → {v2}", { v1: before.listen_port, v2: after.listen_port }));
        if (before.address !== after.address) ch.push(T("address {v1} → {v2}", { v1: before.address, v2: after.address }));
        if (JSON.stringify(before.awg || {}) !== JSON.stringify(after.awg || {})) ch.push(T("the AmneziaWG parameters"));
        if ((before.psk || "") !== (after.psk || "")) ch.push(T("the preshared key"));
        if (body.profile_text && !String(body.profile_text).includes(Store.exitKeyKeep || "(unchanged)")) ch.push(T("this node's key"));
        if (ch.length) DIALIN_NOTE[ex.id] = ch.join(", ");
      }
      return r === true ? true : T("Couldn't save");
    }}/>`);
  const openDialin = rec => openModal(html`<${DialinGenSheet} node=${node}
    onCreate=${async (label, proto, typed) => { const r = await generate({ ...rec, label }, proto, typed);
      if (r && r.info) { closeModal(); toast(r.info); return true; }
      return r; }}
    onPaste=${label => { closeModal(); openEdit({ ...rec, label }, true); }}/>`);
  const add = p2 => {
    const rec = { id: newExitId(), label: "", enabled: true, killswitch: false, device: "", ...p2 };
    if (p2.dialin) return openDialin(rec);
    if (p2.provider === "profile" || p2.provider === "socks5") return openEdit(rec, true);
    write([...exits, rec]);
  };
  const exitKinds = [
    [T("Add a SOCKS5 proxy"), { producer: "imported", provider: "socks5", socks_text: "", socks_pass: "" }, T("A SOCKS5 proxy's address and login")],
  ];
  const del = ex => openConfirm({
    title: T("Remove this exit?"), confirmLabel: T("Remove"), danger: true,
    body: exitProv(ex) === "profile"
      ? T("{v1} is removed from this node and its tunnel comes down. The profile and its key are deleted from the panel — you would have to paste it again.", { v1: ex.label || ex.device })
      : exitProv(ex) === "warp"
      ? T("{v1} is removed from this node and its tunnel comes down. The Cloudflare account is deleted with it: re-adding one registers a NEW account with a different exit IP.", { v1: ex.label || ex.device })
      : exitProv(ex) === "socks5"
      ? T("{v1} is removed from this node and its tunnel to the proxy comes down. The proxy's address and password are deleted from the panel.", { v1: ex.label || ex.device })
      : T("{v1} is removed from this node and its tunnel comes down.", { v1: ex.label || ex.device }),
    onConfirm: () => write(exits.filter(x => String(x.id) !== String(ex.id))),
  });
  const dot = ex => {
    const h = exitHealth(stored(ex.id), node);
    return html`<span class="exg-h8"><span class=${"exg-dot " + h.dot} title=${h.why}></span>
      ${exitHealthMark(h)}</span>`; };
  return html`<div>
    ${isMobile() ? html`<button class="btn btn-primary m-addtop" onClick=${() => openModal(html`<${ExitKindSheet} kinds=${exitKinds} onPick=${add}/>`)}><${Ic} i="plus"/> ${T("Add an exit")}</button>` : null}
    <p class="hint" style="margin:0 0 14px">${T("Configure SOCKS5 proxies here and assign an exit from the user card.")}</p>
    ${exits.length ? html`<div class="exgrid g8">
      <div class="exg-r"><div class="exg-h">${T("Title")}</div>
      <div class="exg-h">${T("Device")}</div>
      <div class="exg-h">${T("val|Type")}</div>
      <div class="exg-h">${T("Exit IP")}</div>
      <div class="exg-h c">${T("Latency")}</div>
      <div class="exg-h c">${T("Kill-switch")}</div>
      <div class="exg-h c">${T("Active")}</div>
      <div class="exg-h"></div></div>
      ${exits.map(ex => {
        const l = stored(ex.id).live || {};
        const off = ex.enabled === false;
        const stop = e => e.stopPropagation();
        return html`<div class="exg-r" key=${ex.id}>
          <div class=${"exg-c clk" + (off ? " dim" : "")} onClick=${() => openEdit(ex)}>
            ${ex.label || exitDefaultTitle(ex)}</div>
          <div class=${"exg-c clk" + (off ? " dim" : "")} onClick=${() => openEdit(ex)}>
            ${dot(ex)}<span class="mono exg-dev">${ex.device || "—"}</span></div>
          <div class="exg-c clk" onClick=${() => openEdit(ex)}>
            ${(() => { const [bc, bl, bk] = exitBadge(ex, l); return html`<span class=${"exg-t " + bc} title=${bk || ""}>${bl}</span>`; })()}</div>
          <div class="exg-c clk mono" onClick=${() => openEdit(ex)}
            title=${exitProv(ex) === "socks5" ? (l.udp_ok === true ? T("UDP is carried — calls and games work through this exit.")
              : l.udp_ok === false ? T("UDP is not carried — calls and games won't work through this exit. Other traffic is fine: QUIC falls back to TCP at once.")
              : T("UDP: not checked yet")) : ""}>
            ${(l.trace || {}).ip || html`<span class="faint">—</span>`}${exitProv(ex) === "socks5" && (l.trace || {}).loc
              ? html` <span class="faint">${l.trace.loc}</span>` : null}</div>
          <div class="exg-c c clk mono" onClick=${() => openEdit(ex)}>
            ${(() => { const tcp = exitProv(ex) === "profile" && !Number.isFinite(l.ping_ms) && Number.isFinite((l.trace || {}).tcp_ms);
              const why = tcp
              ? (exitIsDialin(ex)
                ? T("Measured through the tunnel: one round trip from this node through the router to Cloudflare's nearest server. The router dials this node, so there is no server of its own to ping.")
                : T("The exit's server answers no ping, so this is measured through the tunnel: one round trip from this node through the exit to Cloudflare's nearest server — a little more than the exit alone."))
              : exitIsDialin(ex)
              ? T("Latency is not measured for a dial-in exit — the router dials this node, so there is no server to ping.")
              : l.up && l.ping_ms === null
              ? (Number.isFinite((l.trace || {}).rtt_ms)
                ? T("No ping reply from the exit's server — it may not answer ping — so its latency can't be measured. A request through the tunnel to a public site takes {v1} ms, which also includes however far that site is.", { v1: (l.trace || {}).rtt_ms })
                : T("No ping reply from the exit's server — it may not answer ping — so its latency can't be measured."))
              : Number.isFinite((l.trace || {}).rtt_ms)
              ? T("Round trip from this node to the exit's own server. A request through the tunnel to a public site takes {v1} ms, which also includes however far that site is.", { v1: (l.trace || {}).rtt_ms })
              : T("Round trip from this node to the exit's own server.");
              const v = Number.isFinite(l.ping_ms)
              ? T("{v1} ms", { v1: l.ping_ms })
              : tcp
              ? T("~{v1} ms", { v1: Math.round(l.trace.tcp_ms * 10) / 10 })
              : html`<span class="faint">—</span>`;
              return html`<${Popover} hoverOnly cls="exlat-pop" popCls="netroute-bub exlat-bub" trigger=${html`<span class="exlat">${v}</span>`}>${why}<//>`; })()}</div>
          <div class="exg-c c" data-lbl=${T("Kill-switch")} onClick=${stop}><${Switch} on=${!!ex.killswitch} title=${KS_TITLE()}
            onChange=${x => write(exits.map(y => (y.id === ex.id ? { ...y, killswitch: x } : y)))}/></div>
          <div class="exg-c c" data-lbl=${T("Active")} onClick=${stop}><${Switch} on=${!off} title=${ACTIVE_TITLE()}
            onChange=${x => write(exits.map(y => (y.id === ex.id ? { ...y, enabled: x } : y)))}/></div>
          <div class="exg-c exg-act" onClick=${stop}>
            ${exitIsDialin(stored(ex.id)) ? html`<button class=${"exg-qr" + (DIALIN_NOTE[ex.id] ? " chg" : "")} onClick=${() => showRouter(ex)}
              title=${DIALIN_NOTE[ex.id] ? T("The router config changed — {v1}. Import it on the router again.", { v1: DIALIN_NOTE[ex.id] }) : T("Router config")}><${Ic} i="qr"/></button>` : null}
            <button class="exg-ed" title=${T("val|Edit")} onClick=${() => openEdit(ex)}><${Ic} i="pencil"/></button>
            <button class="exg-rm" title=${T("Remove")} onClick=${() => del(ex)}><${Ic} i="trash"/></button></div>
        </div>`;
      })}
    </div>`
      : null}
    ${exits.length ? null
      : html`<p class="hint" style="margin:0 0 12px">${T("No SOCKS5 exits on this node yet.")}</p>`}
    ${isMobile() ? null : html`<div class="exadd" style="margin-top:14px">
      ${exitKinds.map(([label, rec]) => html`<button class="btn btn-ghost btn-mini" onClick=${() => add(rec)}>
        <${Ic} i="plus"/> ${label}</button>`)}
    </div>`}
  </div>`;
}
function AddExitDeviceSheet({ onAdd, fields }) {
  const [v, setV] = useState({});
  const ok = !!String(v.device || "").trim();
  const sent = useRef(false);
  const submit = () => { if (!ok || sent.current) return; sent.current = true; onAdd(v); closeModal(); };
  return html`<${Sheet} title=${T("Add an interface by name")} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${!ok} onClick=${submit}>${T("val|Add")}</button>`}>
    ${fields(v, setV, submit)}
  <//>`;
}
function ExitKindSheet({ kinds, onPick }) {
  return html`<${Sheet} title=${T("Add an exit")} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button>`}>
    <div class="m-pick">${kinds.map(([label, rec, about]) => html`<button type="button" class="m-pick-row" onClick=${() => { closeModal(); onPick(rec); }}>
      <span class="m-pick-ic"><${Ic} i="plus"/></span><span class="m-pick-main"><b>${label}</b><span>${about}</span></span></button>`)}</div>
  <//>`;
}

export function NodeIngressForm({ node, vals, set }) {
  const v = vals || {};
  return html`<div>
    <p class="hint" style="margin:0 0 12px">${Trich("How peers, clients and turn-proxy links reach *{v1}*.", { v1: node.name })}</p>
    <div class="field"><label>${T("Ingress address")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— what peers and clients dial to reach this node")}</span></label>
      <${NodeIpPick} ips=${ipChoices(node)} value=${v.endpoint_host || ""} onChange=${ip => set({ endpoint_host: ip })} auto=${T("Auto (public IP)")} customPlaceholder=${T("Hostname or IP — e.g. node.example.com")}/>
      <div class="hint">${T("This is the host in every client config and turn-proxy link for this node. Prefer a hostname: moving the box then costs one DNS change, and nothing a client already holds has to be re-issued.")}</div></div>
    ${
 null}
    <${NodeHostList} node=${node} value=${v.endpoint_hosts || []} onChange=${hs => set({ endpoint_hosts: hs })}/>
  </div>`;
}

export function NodeMeshForm({ node, vals, set }) {
  const rsv = (Store.panelSettings || {}).reserved || {};
  const dSub = rsv.mesh_subnet || "10.255.0.0/16", dPort = String(rsv.mesh_port_base || 9999), dPfx = rsv.iface_prefix || "swg_";
  const v = vals || {};
  return html`<div>
    <p class="hint" style="margin:0 0 12px">${Trich("Overrides for *{v1}* — blank inherits the default. Changing the subnet or prefix re-provisions this node's links on Save (it briefly drops off the mesh while peers reconnect with the new config). A link's type and AWG params are set on its card under Node connections.", { v1: node.name })}</p>
    <div class="field"><label>${T("Mesh egress IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— source to dial other nodes")}</span></label>
      <${NodeIpPick} ips=${node.ips || []} value=${v.mesh_egress_ip || ""} onChange=${ip => set({ mesh_egress_ip: ip })} auto=${T("Auto (default route)")}/>
      <div class="hint">${T("Which of this node's addresses it dials the other nodes' mesh links from. A single connection can still override it on its own card.")}</div></div>
    ${(node.mesh_gen_reasons || []).length ? html`<div class="field">${(node.mesh_gen_reasons || []).map(r => html`<div class="hint warnish" key=${r.iface}>
      ${T("Link to {v1} ({v2}) is {v3}: {v4}", { v1: r.peer, v2: r.iface, v3: meshGenLabel(r.type), v4: srvText(r.msg) })}</div>`)}</div>` : null}
    <div class="row2"><div class="field"><label>${T("Mesh subnet")}</label><input value=${v.mesh_subnet || ""} onInput=${e => set({ mesh_subnet: e.target.value })} placeholder=${dSub}/></div>
      <div class="field"><label>${T("Mesh port")}</label><input value=${v.mesh_port || ""} onInput=${e => set({ mesh_port: e.target.value })} placeholder=${dPort}/></div></div>
    <div class="field"><label>${T("Interface name prefix")}</label><input value=${v.mesh_prefix || ""} onInput=${e => set({ mesh_prefix: e.target.value })} placeholder=${dPfx}/></div>
    ${(Store.nodes || []).length > 1 ? html`<div class="field" style="margin-top:18px">
      <label>${T("Rebuild links")}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-ghost" onClick=${() => openConfirm({
            title: T("Re-provision this node's mesh links?"), confirmLabel: T("Re-provision"), warn: true,
            body: T("{v1} will briefly drop off the mesh (and any cascade/smart traffic routed through it pauses) until every peer pulls the new config and reconnects — usually a few seconds. Other nodes' links to each other are unaffected.", { v1: node.name }),
            onConfirm: async () => { const r = await api.nodeRemesh({ id: node.id });
              toast(r && r.ok ? T("Rebuilding this node's mesh links…") : (srvText(r) || T("Couldn't re-provision the mesh links.")), r && r.ok ? "ok" : "err");
              if (r && r.ok) await Store.poll(); } })}><${Ic} i="refresh"/> ${T("Re-provision now")}</button>
      </div>
      <div class="hint">${T("Rebuilds this node's links under new interface names, with the settings above. Use it when a link won't come up — a name, address or port clashing with something else on that server. It cannot help two nodes that share one machine: their link is a single interface name that would have to exist twice there.")}</div>
    </div>` : null}
  </div>`;
}

const normRules = rs => { const { rows, catchAll } = rulesToRows(rs || []); return rowsToRules(rows, catchAll); };

export function legRow(parts) {
  const a = [parts].flat(Infinity).filter(x => x != null && x !== ""), lead = typeof a[0] === "string" ? null : a[0];
  return html`<div class="lg-leg-row">${lead ? html`${lead}<span>${a.slice(1)}</span>` : html`<span>${a}</span>`}</div>`;
}

function NodeDefaultRules({ node, nodeExits, base, rules, exitIps, mode, onChange }) {
  const live = new Set((nodeExits || []).map(x => String(x.id)));
  const adopt = (held, rs) => adoptRows(held, rs, live);
  const [st0, setSt] = useState(() => { const c = NODE_LIST_ROWS[node];
    return adopt(c && { ...c, rows: (c.rows || []).map(r => r && r._draft ? (({ _draft, ...x }) => x)(r) : r) }, rules); });
  const st = adopt(st0, rules);
  if (st !== st0) setSt(st);
  NODE_LIST_ROWS[node] = { base, rows: st.rows, catchAll: st.catchAll, mode };
  return html`<${RoutingRules} scope="node" node=${node} rows=${st.rows} catchAll=${st.catchAll} exitIps=${exitIps || {}}
    onChange=${(rows, catchAll, xs) => { setSt({ rows, catchAll }); NODE_LIST_ROWS[node] = { base, rows, catchAll, mode };
      onChange(rowsToRules(rows, catchAll), xs); }}/>`;
}
const NODE_LIST_ROWS = {};
const nodeListBlock = (nid, rules) => { const c = NODE_LIST_ROWS[nid];
  return c && JSON.stringify(rowsToRules(c.rows, c.catchAll)) === JSON.stringify(rules || []) ? egressSaveBlock({ mode: "smart", rows: c.rows, catchAll: c.catchAll }, c.mode || "kernel") : null; };

function DefaultReach({ node }) {
  const rc = node.default_reach;
  if (!rc) return null;
  const auto = rc.auto || [], arr = rc.arr || [];
  const ifTrig = html`<b>${plural(auto.length, "Auto interface")}</b>`;
  const arTrig = html`<b>${plural(arr.length, "interface")}</b>`;
  const hov = (trig, items) => items.length ? html`<${Popover} hoverOnly popCls="netroute-bub" trigger=${trig}>
      ${items.slice(0, 10).map(x => html`<div class="netbub-row">${x}</div>`)}
      ${items.length > 10 ? html`<div class="netbub-row sub">${T("…and {v1} more", { v1: items.length - 10 })}</div>` : null}<//>` : trig;
  const parts = T("Routes {ifaces} here and the traffic {sources} send out through this node.").split(/(\{ifaces\}|\{sources\})/);
  const fill = { "{ifaces}": hov(ifTrig, auto), "{sources}": hov(arTrig, arr.map(([n, S]) => Store.nodeName(n) + " · " + S)) };
  return html`<div class="hint">${parts.map(x => fill[x] || x)}
    ${(rc.dup || []).length ? html` ${T("{v1} arrive from two nodes at once and are left to this node's own route.", { v1: rc.dup.join(", ") })}` : null}</div>`;
}

const P2P_OPTS = () => [
  { value: "block", label: T("Block everywhere") },
  { value: "direct", label: T("Allow, only out this server's own address") },
  { value: "iface", label: T("Each interface decides") }];
export const p2pNotRunHere = (node, rec) => !!node && !!rec && !node.p2p_node && !!node.outdated && node.p2p_eff !== "iface" && rec.action === node.p2p_eff;
export const P2P_HINT = () => ({
  block: T("Torrent traffic is dropped on every way out of this server: its interfaces and traffic other nodes send out through it. A torrent program on the server itself is stopped only when its handshakes are unencrypted — an encrypted one gets through. Web browsing and video calls are not affected."),
  direct: T("Torrent traffic may leave only by this server's own address — never through an exit or another node. Everything else keeps its route."),
  iface: T("Each interface's own Torrents / P2P choice applies — block, allow, or route. Traffic other nodes send out through this server, and programs running on it, are not checked."),
  routed: v1 => T("Torrent traffic may leave only through {v1}. If that way is down, torrent traffic is blocked — never sent out another way. Traffic other nodes send out through this server is blocked. A torrent program on the server itself is stopped only when its handshakes are unencrypted — an encrypted one gets through.", { v1 }) });

function NodeEgressForm({ node, vals: v, set }) {
  const ips = node.ips || [];
  const isList = Array.isArray(v.default_routing);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [p2pOpen, setP2pOpen] = useState(false);
  return html`<div>
    <div class="field"><label>${T("Default egress IP")}</label>
      <${NodeIpPick} ips=${ips} value=${v.default_egress_ip || ""}
        onChange=${ip => set({ default_egress_ip: ip })} auto=${T("Auto (MASQUERADE)")}/></div>
    <label class="toggle-row"><${Switch} on=${isList} onChange=${on => {
      set({ default_routing: on ? [] : null, default_routing_exit_ips: {} });
      setRulesOpen(on);
    }}/><span>${T("Routing (smart cascade)")}</span></label>
    ${isList ? html`<div class="field">
      <${Disclosure} title=${rulesTitle(node.id)} open=${rulesOpen} onToggle=${() => {
          const c = NODE_LIST_ROWS[node.id];
          if (rulesOpen && c) NODE_LIST_ROWS[node.id] = { ...c, rows: (c.rows || []).map(r => r && r._draft ? (({ _draft, ...x }) => x)(r) : r) };
          setRulesOpen(o => !o); }}
        sumCls="route" summary=${(() => { const { rows, catchAll } = rulesToRows(v.default_routing || []);
          return rulesSummary(node.id, rows, catchAll); })()}>
      <${NodeDefaultRules} key=${node.id + ":" + JSON.stringify(node.default_routing || [])} node=${node.id} mode=${v.routing_mode || node.routing_mode}
        nodeExits=${v.exits || node.exits || []}
        base=${JSON.stringify(node.default_routing || [])}
        rules=${v.default_routing} exitIps=${v.default_routing_exit_ips || {}}
        onChange=${(rules, xs) => set({ default_routing: rules, default_routing_exit_ips: xs || {} })}/>
      <${DefaultReach} node=${node}/><//></div>` : null}
    ${(() => {
      const exits = v.exits || node.exits || [];
      const curRec = (v.p2p && v.p2p.action) ? v.p2p : { action: node.p2p_eff || "block" };
      const cur = p2pVal(curRec), routed = curRec.action === "dev" || curRec.action === "exit";
      const pn = node.p2p_node;
      const opts = [...P2P_OPTS(), ...p2pTargetOpts(node, exits)];
      return html`<div class="field">
        <${Disclosure} title=${T("Filters & abuse")} sumCls="on" open=${p2pOpen} onToggle=${() => setP2pOpen(o => !o)}
          summary=${p2pNotRunHere(node, curRec) ? T("Torrents / P2P: {v1} — not in force on this node until it is updated", { v1: p2pLabel(curRec, exits, node) })
                   : T("Torrents / P2P: {v1}", { v1: p2pLabel(curRec, exits, node) })}>
          <div class="field"><label>${T("Torrents / P2P")}</label>
            <${Dropdown} value=${cur} onChange=${a => set({ p2p: p2pRec(a) })} options=${opts}/>
            <div class="hint">${routed ? P2P_HINT().routed(p2pTarget(curRec, exits, node)) : P2P_HINT()[cur]}</div>
            ${!(v.p2p && v.p2p.action) ? html`<div class="hint">${T("Chosen automatically: this is the default. An interface's own Torrents / P2P choice counts only when you pick “Each interface decides”.")}</div>` : null}
            ${p2pTargetHints(curRec, node, exits)}
            ${pn && pn.state === "degraded" && cur !== "iface" ? html`<div class="hint warnish">${T("This server can't read packet contents (its kernel or nft is too old), so torrents are recognised by their connection pattern only.")}</div>` : null}
          </div>
          ${(() => { const fleet = ((Store.panelSettings || {}).p2p_portok || P2P_PORTOK_DEFAULT).join(", "), own = v.p2p_portok != null;
            return html`<div class="field"><label>${T("Ports the torrent filter never cuts")}</label>
              <${Dropdown} value=${own ? "own" : "fleet"} onChange=${a => set({ p2p_portok: a === "own" ? (v.p2p_portok ?? fleet) : null })}
                options=${[{ value: "fleet", label: T("The fleet's list") }, { value: "own", label: T("This node's own list") }]}/>
              ${own ? html`<input class="mono" style="margin-top:6px" value=${v.p2p_portok} spellcheck="false" autocomplete="off" onInput=${e => set({ p2p_portok: e.target.value })}/>
                      <${PortokHints} text=${v.p2p_portok}/>`
                : html`<div class="hint">${fleet} — ${T("set in Settings → Geo data providers → Blocking.")}</div>`}</div>`; })()}
        <//></div>`; })()}
    <div class="field"><label>${T("Panel egress connection IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— source to reach the panel")}</span></label>
      <${NodeIpPick} ips=${ips} value=${v.panel_ip || ""} onChange=${ip => set({ panel_ip: ip })} auto=${T("Auto (default route)")}/></div>
  </div>`;
}

function PortokHints({ text }) {
  const r = portokRead(text);
  return html`${r.bad.length ? html`<div class="hint warnish"><${Ic} i="warn"/> ${T("Not a port or a port range (1-65535): {v1}", { v1: r.bad.slice(0, 5).join(", ") })}</div>` : null}
    ${r.tooMany ? html`<div class="hint warnish"><${Ic} i="warn"/> ${T("Too many entries — at most {v1}.", { v1: PORTS_MAX_TOKENS })}</div>` : null}
    ${!r.bad.length && !r.tooMany && !r.list.length ? html`<div class="hint warnish"><${Ic} i="warn"/> ${T("Keep at least one port, or reset the list to its defaults.")}</div>` : null}
    ${r.ports > PORTOK_WIDE ? html`<div class="hint warnish"><${Ic} i="warn"/> ${T("Ports on the list: {v1} — encrypted torrents get through on them.", { v1: fmtNum(r.ports) })}</div>` : null}`;
}
