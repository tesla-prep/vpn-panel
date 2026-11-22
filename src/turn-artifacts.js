(function (root) {
  var VK_LINK_CAPS = { wdtt: 4, csqtt: 6 };

  "use strict";

  var AWG_ORDER = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5",
    "HeaderProtectionKey", "RandomTrailers", "ContentPaddingAddition", "RekeyAfterTime", "RekeyTimeout", "RejectAfterTime", "KeepaliveTimeout", "MaxHandshakeAttempts", "DisableCookies"];

  function b64ToBytes(b64) {
    try { var s = atob(String(b64 || "").trim()); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    catch (_) { return new Uint8Array(0); }
  }
  function hexToBytes(h) { h = String(h || "").replace(/[^0-9a-fA-F]/g, ""); var a = new Uint8Array(h.length >> 1); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function ipToBytes(addr) {
    addr = String(addr || "").trim();
    if (addr.indexOf(":") >= 0) {
      var parts = addr.split("::");
      var head = parts[0], tail = parts[1];
      var h = head ? head.split(":").filter(Boolean) : [], t = tail ? tail.split(":").filter(Boolean) : [];
      var groups = addr.indexOf("::") >= 0 ? h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill("0"), t) : addr.split(":");
      var b = new Uint8Array(16); groups.slice(0, 8).forEach(function (g, i) { var v = parseInt(g || "0", 16) || 0; b[i * 2] = v >> 8; b[i * 2 + 1] = v & 0xff; }); return b;
    }
    var p = addr.split("."), bb = new Uint8Array(4); for (var i = 0; i < 4; i++) bb[i] = (+p[i]) || 0; return bb;
  }

  function pbVarint(n) { var o = [], v = Math.floor(n); while (v > 127) { o.push((v % 128) | 0x80); v = Math.floor(v / 128); } o.push(v & 0x7f); return o; }
  function pbKey(f, w) { return pbVarint((f << 3) | w); }
  function pbLen(f, arr) { return pbKey(f, 2).concat(pbVarint(arr.length), arr); }
  function pbVar(f, n) { return pbKey(f, 0).concat(pbVarint(n)); }
  function pbStr(f, s) { return pbLen(f, [].slice.call(new TextEncoder().encode(String(s)))); }
  function pbBin(f, u8) { return pbLen(f, [].slice.call(u8)); }
  function epBytes(hostport) { var s = String(hostport || ""); var i = s.lastIndexOf(":"); if (i < 0) return null; return pbStr(1, s.slice(0, i)).concat(pbVar(2, +s.slice(i + 1) || 0)); }

  var WINGSV_SCHEMA = {
    Endpoint:  [{ name: "host", num: 1, type: "string" }, { name: "port", num: 2, type: "uint32" }],
    Cidr:      [{ name: "addr", num: 1, type: "bytes" }, { name: "prefix", num: 2, type: "uint32" }],
    Interface: [{ name: "private_key", num: 1, type: "bytes" }, { name: "addrs", num: 2, type: "string", repeated: true },
                { name: "dns", num: 3, type: "string", repeated: true }, { name: "mtu", num: 4, type: "uint32", opt: true }],
    Peer:      [{ name: "public_key", num: 1, type: "bytes" }, { name: "preshared_key", num: 2, type: "bytes" },
                { name: "allowed_ips", num: 3, type: "msg", msg: "Cidr", repeated: true }],
    WireGuard: [{ name: "iface", num: 1, type: "msg", msg: "Interface" }, { name: "peer", num: 2, type: "msg", msg: "Peer" },
                { name: "endpoint", num: 3, type: "msg", msg: "Endpoint" }],
    AmneziaWG: [{ name: "awg_quick_config", num: 1, type: "string" }],
    Turn:      [{ name: "endpoint", num: 1, type: "msg", msg: "Endpoint" }, { name: "link", num: 2, type: "string" },
                { name: "threads", num: 3, type: "uint32", opt: true }, { name: "use_udp", num: 4, type: "bool", opt: true },
                { name: "no_obfuscation", num: 5, type: "bool", opt: true }, { name: "local_endpoint", num: 6, type: "msg", msg: "Endpoint" },
                { name: "session_mode", num: 9, type: "enum" }, { name: "links", num: 10, type: "string", repeated: true },
                { name: "creds_group_size", num: 12, type: "uint32", opt: true },
                { name: "manual_captcha", num: 13, type: "bool", opt: true }, { name: "captcha_auto_solver", num: 14, type: "string" },
                { name: "restart_on_network_change", num: 15, type: "bool", opt: true }, { name: "runtime_mode", num: 16, type: "enum" },
                { name: "user_dns", num: 17, type: "string", repeated: true },
                { name: "tunnel_mode", num: 18, type: "enum" }, { name: "wrap_mode", num: 19, type: "enum" },
                { name: "wrap_key", num: 20, type: "bytes" }, { name: "wrap_ciphers", num: 21, type: "enum", repeated: true },
                { name: "wrap_key_delivery", num: 22, type: "enum" }, { name: "browser_fingerprint", num: 27, type: "string" }],
    Config:    [{ name: "ver", num: 1, type: "uint32" }, { name: "type", num: 2, type: "enum" }, { name: "turn", num: 3, type: "msg", msg: "Turn" },
                { name: "wg", num: 4, type: "msg", msg: "WireGuard" }, { name: "backend", num: 5, type: "enum" }, { name: "awg", num: 7, type: "msg", msg: "AmneziaWG" }]
  };
  function pbIsDefault(t, v) { return t === "bool" ? !v : t === "string" ? String(v) === "" : t === "bytes" ? (!v || !v.length) : (+v || 0) === 0; }
  function pbFieldBytes(d, v) {
    if (d.type === "msg") return pbLen(d.num, pbEncodeMsg(d.msg, v));
    if (d.type === "string") return pbStr(d.num, String(v));
    if (d.type === "bytes") return pbBin(d.num, v);
    return pbVar(d.num, d.type === "bool" ? (v ? 1 : 0) : Math.floor(+v || 0));
  }
  function pbEncodeMsg(msgName, obj) {
    var schema = WINGSV_SCHEMA[msgName], out = [];
    for (var i = 0; i < schema.length; i++) {
      var d = schema[i], v = obj[d.name];
      if (v === undefined || v === null) continue;
      if (d.repeated) { for (var j = 0; j < v.length; j++) out = out.concat(pbFieldBytes(d, v[j])); continue; }
      if (d.type === "msg") { out = out.concat(pbFieldBytes(d, v)); continue; }
      if (!d.opt && pbIsDefault(d.type, v)) continue;
      out = out.concat(pbFieldBytes(d, v));
    }
    return out;
  }

  function csNum(cs, key, dflt) { var v = (cs || {})[key]; return (v === undefined || v === null || v === "" || isNaN(+v)) ? dflt : Math.floor(+v); }
  function csBool(cs, key, dflt) { var v = (cs || {})[key]; return (v === undefined || v === null || v === "") ? dflt : (v === true || v === "true" || v === 1 || v === "1"); }
  function csEnum(cs, key, map, dflt) { var v = (cs || {})[key]; if (v === undefined || v === null || v === "") return dflt; return map[String(v)] != null ? map[String(v)] : dflt; }
  function splitList(s) { return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }

  function sortedCanonical(v) {
    if (Array.isArray(v)) return v.map(sortedCanonical);
    if (v && typeof v === "object") { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sortedCanonical(v[k]); }); return o; }
    return v;
  }
  function jsonSortedCompact(obj) { return JSON.stringify(sortedCanonical(obj)); }

  function parseFullConf(text) {
    var m = function (re) { return (text.match(re) || [])[1]; };
    var dnsLine = m(/DNS\s*=\s*(.+)/);
    var awg = {};
    for (var i = 0; i < AWG_ORDER.length; i++) { var k = AWG_ORDER[i]; var v = m(new RegExp("^" + k + "\\s*=\\s*(\\S+)", "m")); if (v != null) awg[k] = v; }
    return {
      privkey: m(/PrivateKey\s*=\s*(\S+)/) || "",
      address: m(/Address\s*=\s*(.+)/) || "",
      dns: dnsLine ? dnsLine.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [],
      mtu: m(/MTU\s*=\s*(\d+)/) || 1280,
      awg_params: awg,
      server_pubkey: m(/PublicKey\s*=\s*(\S+)/) || "",
      psk: m(/PresharedKey\s*=\s*(\S+)/) || "",
      allowed: m(/AllowedIPs\s*=\s*(.+)/) || "0.0.0.0/0, ::/0",
      endpoint: m(/Endpoint\s*=\s*(\S+)/) || "",
      keepalive: m(/PersistentKeepalive\s*=\s*(\d+)/) || 25
    };
  }

  var forkName = function (f) { return f; };
  var cliAuthorsOf = function () { return null; };

  function label(service) {
    var s = (service || "turn-proxy").replace(/^vk-turn-proxy-?/, "") || "turn";
    s = s.replace(/-\d+$/, "") || "turn";
    return s === "main" ? "cacggghp" : s;
  }

  var WINGSV_SESSION_MODES = { mainline: 2, mux: 3 };
  var WINGSV_RUNTIME_MODES = { vpn: 1, proxy: 2 };
  function wingsvConfigBytes(cf, tp, vk, rawConf, cs) {
    var LOCAL_HOST = "127.0.0.1", LOCAL_PORT = 9000;
    var isAwg = !!(cf.awg_params && Object.keys(cf.awg_params).length);
    var lp = String(tp.listen || ""), ci = lp.lastIndexOf(":");
    var turn = {
      endpoint: { host: ci >= 0 ? lp.slice(0, ci) : lp, port: ci >= 0 ? (+lp.slice(ci + 1) || 0) : 0 },
      local_endpoint: { host: LOCAL_HOST, port: LOCAL_PORT },
      use_udp: csBool(cs, "useUDP", true),
      tunnel_mode: isAwg ? 2 : 1
    };
    var vkList = Array.isArray(vk) ? vk.map(function (s) { return (s || "").trim(); }).filter(Boolean) : ((vk || "").trim() ? [(vk || "").trim()] : []);
    if (vkList.length > 1) turn.links = vkList;
    else if (vkList.length === 1) turn.link = vkList[0];
    if ((cs || {}).threads) turn.threads = csNum(cs, "threads", 24);
    var sm = csEnum(cs, "sessionMode", WINGSV_SESSION_MODES, 0); if (sm) turn.session_mode = sm;
    var bf = (cs || {}).browserFingerprint; if (bf && bf !== "auto") turn.browser_fingerprint = String(bf);
    var cg = csNum(cs, "credsGroupSize", 0); if (cg) turn.creds_group_size = cg;
    turn.manual_captcha = csBool(cs, "manualCaptcha", false);
    var cas = (cs || {}).captchaSolver; if (cas && cas !== "auto") turn.captcha_auto_solver = String(cas);
    turn.restart_on_network_change = csBool(cs, "restartOnNetworkChange", false);
    turn.no_obfuscation = csBool(cs, "noObfuscation", false);
    var rmode = csEnum(cs, "runtimeMode", WINGSV_RUNTIME_MODES, 0); if (rmode) turn.runtime_mode = rmode;
    var udns = splitList((cs || {}).userDns); if (udns.length) turn.user_dns = udns;
    if (tp.wrap_key) { turn.wrap_mode = 2; turn.wrap_key = hexToBytes(tp.wrap_key); }
    var config = { ver: 1, type: 10, backend: 7, turn: turn };
    if (isAwg) {
      config.awg = { awg_quick_config: String(rawConf || "").replace(/^([ \t]*Endpoint[ \t]*=).*$/m, "$1 " + LOCAL_HOST + ":" + LOCAL_PORT) };
    } else {
      var iface = { private_key: b64ToBytes(cf.privkey), addrs: splitList(cf.address), dns: (cf.dns || []).slice() };
      if (cf.mtu) iface.mtu = +cf.mtu || 1280;
      var peer = { public_key: b64ToBytes(cf.server_pubkey) };
      if (cf.psk) peer.preshared_key = b64ToBytes(cf.psk);
      peer.allowed_ips = splitList(cf.allowed).map(function (c) {
        var sp = c.split("/"), a = sp[0], pfx = sp[1];
        return { addr: ipToBytes(a), prefix: pfx != null ? +pfx : (a.indexOf(":") >= 0 ? 128 : 32) };
      });
      config.wg = { iface: iface, peer: peer, endpoint: { host: LOCAL_HOST, port: LOCAL_PORT } };
    }
    return new Uint8Array(pbEncodeMsg("Config", config));
  }
  function wingsvLink(baseConf, tp, vk, clientSettings) {
    if (typeof CompressionStream === "undefined") return Promise.reject(new Error("this browser can't build a wingsv:// link (no CompressionStream) — copy the fields into the WINGS V app manually"));
    var proto = wingsvConfigBytes(parseFullConf(baseConf), tp, vk, baseConf, clientSettings);
    var stream = new CompressionStream("deflate"); var w = stream.writable.getWriter(); w.write(proto); w.close();
    return new Response(stream.readable).arrayBuffer().then(function (buf) {
      var comp = new Uint8Array(buf);
      var payload = new Uint8Array(1 + comp.length); payload[0] = 0x12; payload.set(comp, 1);
      var s = ""; for (var i = 0; i < payload.length; i++) s += String.fromCharCode(payload[i]);
      return "wingsv://" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    });
  }

  function b64urlUtf8(s) {
    return b64Utf8(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64Utf8(s) {
    var bytes = new TextEncoder().encode(String(s)), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function freeturnConf(conf) {
    return String(conf || "").split("\n").map(function (l) {
      return l.trim().replace(/^(PersistentKeepalive\s*=\s*)(\d+)\s*-\s*\d+$/i, "$1$2");
    }).filter(function (l) {
      if (!l || l.charAt(0) === "#" || l.charAt(0) === ";") return false;
      if (/^MTU/i.test(l) && l.indexOf("=") >= 0) return false;
      return true;
    }).join("\n");
  }
  function freeturnLink(tp, rawConf, vkLinks, cs, fork) {
    var wg = freeturnConf(String(rawConf || "").replace(/^([ \t]*Endpoint[ \t]*=).*$/m, "$1 127.0.0.1:9000"));
    var cf = parseFullConf(rawConf);
    var o = { v: 1, provider: "vk", peer: tp.listen || "" };
    var vks = (vkLinks || []).map(function (s) { return (s || "").trim(); }).filter(Boolean);
    if (vks.length) o.vk = vks.join(",");
    var n = csNum(cs, "n", 0); if (n > 0) o.n = n;
    var spc = csNum(cs, "spc", 0); if (spc > 0) o.spc = spc;
    var transport = String((cs || {}).transport || "").trim(); if (transport && transport !== "auto") o.transport = transport;
    var srvParams = String((tp && tp.params) || "");
    var srvMode = (srvParams.match(/-mode\s+(\S+)/) || [])[1];
    if (srvMode && srvMode !== "udp") {
      o.mode = srvMode;
      var kcp = {};
      srvParams.replace(/-kcp-([a-z]+)\s+(\S+)/g, function (_m, k, v) { kcp[k] = /^-?\d+$/.test(v) ? +v : v; return ""; });
      if (Object.keys(kcp).length) o.kcp = kcp;
    }
    var dnsMode = String((cs || {}).dns || "").trim(); if (dnsMode && dnsMode !== "auto") o.dns = dnsMode;
    var dnss = String((cs || {}).dnss || "").trim(); if (dnss) o.dnss = dnss;
    if (csBool(cs, "mcap", false)) o.mcap = true;
    var key = (tp.wrap_key || "").trim();
    if (key) { o.obf = obfProfileOf(cs, tp); o.key = key; }
    var nm = expandServerName(String((cs || {}).serverName || "").trim(), fork, tp.listen || "");
    if (nm) o.name = nm;
    var addr = String(cf.address || "").split("/")[0];
    o.cid = "swg-" + (addr || (tp.listen || "")).replace(/[^0-9A-Za-z]+/g, "-");
    o.wg = wg;
    return "freeturn://" + b64urlUtf8(JSON.stringify(o));
  }

  function vktgzCoreFlags(fork, key, cs, tp) {
    var f = [], la = String((cs || {}).linkArgument || "").trim();
    if (fork === "MYSOREZ") {
      la = la || "-vk";
      if (key) f.push({ id: "flag-pw", label: "Password", argument: "-password " + key, enabled: true, deletable: true });
      f.push({ id: "flag-anon", label: "VK bypass",    argument: "-vk-anon-path " + (String((cs || {}).vkAnonPath || "").trim() || "vkcalls"), enabled: true, deletable: true });
      f.push({ id: "flag-cap",  label: "Captcha mode", argument: "-captcha-mode " + (String((cs || {}).captchaMode || "").trim() || "auto"),   enabled: true, deletable: true });
      f.push({ id: "flag-auth", label: "VK auth",      argument: "-vk-auth "      + (String((cs || {}).vkAuth || "").trim()      || "anonymous"), enabled: true, deletable: true });
      var dev = String((cs || {}).deviceId || "").trim(); if (dev) f.push({ id: "flag-dev", label: "Device ID", argument: "-device-id " + dev, enabled: true, deletable: true });
    } else if (fork === "Moroka8") {
      la = la || "-vk-link";
      if (key) f.push({ id: "flag-wrap", label: "Wrap", argument: "-wrap -wrap-key " + key, enabled: true, deletable: true });
    } else if (fork === "samosvalishe") {
      la = la || "-links";
      if (key) f.push({ id: "flag-obf", label: "Obfuscation", argument: "-obf-profile " + obfProfileOf(cs, tp) + " -obf-key " + key, enabled: true, deletable: true });
    } else {
      la = la || "-vk-link";
      f = [{ id: "flag-udp",     label: "UDP",            argument: "-udp",             enabled: csBool(cs, "udp", true),            deletable: false },
           { id: "flag-vless",   label: "VLESS",          argument: "-vless",           enabled: false,                              deletable: false },
           { id: "flag-captcha", label: "Manual Captcha", argument: "--manual-captcha", enabled: csBool(cs, "manualCaptcha", false), deletable: false },
           { id: "flag-nodtls",  label: "Disable DTLS",   argument: "-no-dtls",         enabled: false,                              deletable: false },
           { id: "flag-debug",   label: "Debug",          argument: "-debug",           enabled: csBool(cs, "debug", false),         deletable: false }];
      if (key) f.push({ id: "flag-wrap", label: "Wrap key", argument: "-wrap-key " + key, enabled: true, deletable: true });
    }
    return { flags: f, linkArgument: la };
  }
  function vktgzProfile(cf, tp, vkList, cs, fork) {
    var listen = tp.listen || "";
    var addr = String(cf.address || "").split("/")[0];
    var core = vktgzCoreFlags(fork, (tp.wrap_key || "").trim(), cs, tp);
    var flags = core.flags;
    String((cs || {}).rawFlags || "").split(/[\r\n]+/).map(function (s) { return s.trim(); }).filter(Boolean)
      .forEach(function (f, i) { flags.push({ id: "flag-raw-" + i, label: "Custom", argument: f, enabled: true, deletable: true }); });
    var la = String(core.linkArgument || "").replace(/^-+/, "");
    var multi = (la === "links" || la === "vk");
    var vkArg = multi ? (vkList || []).join(",") : ((vkList && vkList[0]) || "");
    var config = { serverAddress: listen, vkLink: vkArg, linkArgument: core.linkArgument,
      localPort: "127.0.0.1:9000", isRawMode: false, rawCommand: "", customFlags: flags };
    var threads = csNum(cs, "threads", 0); if (threads > 0) config.threads = threads;
    return { id: "swg-" + (addr || listen).replace(/[^0-9A-Za-z]+/g, "-"), name: "SWG " + (addr || listen), isDefault: false, config: config };
  }
  function vktgzLink(baseConf, tp, vkList, cs, fork) {
    if (typeof CompressionStream === "undefined") return Promise.reject(new Error("this browser can't build a VKTGZ profile (no CompressionStream) — enter the fields into the MYSOREZ app manually"));
    var json = new TextEncoder().encode(JSON.stringify(vktgzProfile(parseFullConf(baseConf), tp, vkList, cs, fork)));
    var stream = new CompressionStream("gzip"); var w = stream.writable.getWriter(); w.write(json); w.close();
    return new Response(stream.readable).arrayBuffer().then(function (buf) {
      var comp = new Uint8Array(buf), s = "";
      for (var i = 0; i < comp.length; i++) s += String.fromCharCode(comp[i]);
      return "VKTGZ:" + btoa(s);
    });
  }

  function amneziaVpnLink(baseConf) {
    if (typeof CompressionStream === "undefined") return Promise.reject(new Error("this browser can't build a vpn:// link (no CompressionStream) — scan the QR or import the .conf into Amnezia VPN instead"));
    var data = new TextEncoder().encode(String(baseConf || ""));
    var stream = new CompressionStream("deflate"); var w = stream.writable.getWriter(); w.write(data); w.close();
    return new Response(stream.readable).arrayBuffer().then(function (buf) {
      var comp = new Uint8Array(buf), n = data.length;
      var out = new Uint8Array(4 + comp.length);
      out[0] = (n >>> 24) & 0xff; out[1] = (n >>> 16) & 0xff; out[2] = (n >>> 8) & 0xff; out[3] = n & 0xff;
      out.set(comp, 4);
      var s = ""; for (var i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
      return "vpn://" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    });
  }

  function nativeEncoder(fork) {
    return ({ "WINGS-N": "wingsv", "anton48": "anton48",
      "samosvalishe": "freeturn", "MYSOREZ": "vktgz", "cacggghp": "vktgz" })[fork] || "sidecar";
  }
  function encoderFork(enc) {
    return ({ wingsv: "WINGS-N", anton48: "anton48", freeturn: "samosvalishe", vktgz: "MYSOREZ" })[enc] || "";
  }
  function stableCid(cf, tp) { return "swg-" + String(String(cf.address || "").split("/")[0] || (tp.listen || "")).replace(/[^0-9A-Za-z]+/g, "-"); }

  var CLIENT_META = {
    wingsv:   { app: "WINGS V",        platform: "Android", author: "WINGS-N" },
    anton48:  { app: "VK TURN Proxy",  platform: "iOS",     author: "anton48" },
    freeturn: { app: "FreeTurn",       platform: "Android", author: "samosvalishe" },
    vktgz:    { app: "VK TURN Proxy",  platform: "Android", author: "MYSOREZ" }
  };
  function obfProfileOf(cs, tp) {
    var m = String((tp && tp.params) || "").match(/-obf-profile\s+([A-Za-z0-9._-]+)/);
    if (m) return m[1];
    var o = String((cs || {}).obfProfile || "").trim();
    return (o && o !== "auto") ? o : "rtpopus";
  }

  function expandServerName(tpl, fork, listen) {
    if (!tpl) return "";
    var l = String(listen || ""), host = l, port = "";
    var m = l.match(/^\[(.*)\]:(\d+)$/);
    if (m) { host = m[1]; port = m[2]; }
    else {
      var i = l.lastIndexOf(":");
      if (i > 0 && l.indexOf(":") === i) { host = l.slice(0, i); port = l.slice(i + 1); }
    }
    return tpl.replace(/\{(fork|host|port)\}/g, function (_m, k) {
      return k === "fork" ? String(forkName(String(fork || "")) || fork || "") : (k === "host" ? host : port);
    }).trim();
  }

  function clientLabel(fork, enc, mode) {
    var m = CLIENT_META[enc];
    return m ? (fork + " via " + m.app + " (" + m.platform + (mode || "") + ") by " + m.author) : (fork + " · CLI client (desktop)");
  }

  var VKTGZ_HINTS = [
    { hint: "Import the {v1} core (client-android-arm64 from the {v1} releases) into the VK TURN Proxy app — it runs as a launcher for that core, then scan the QR (Profiles → Import) or paste the VKTGZ: text — the VK call link + endpoint ride inside once you add a VK link." },
    { hint: "Import the {v1} core (client-android-arm64 from the {v1} releases) into the VK TURN Proxy app — it runs as a launcher for that core, then scan the QR (Profiles → Import) or paste the VKTGZ: text — the VK call link + endpoint ride inside." },
    { hint: "Import the {v1} core (client-android-arm64 from the {v1} releases) into the VK TURN Proxy app, then scan the QR (Profiles → Import) or paste the VKTGZ: text — the VK call link + endpoint ride inside once you add a VK link." },
    { hint: "Import the {v1} core (client-android-arm64 from the {v1} releases) into the VK TURN Proxy app, then scan the QR (Profiles → Import) or paste the VKTGZ: text — the VK call link + endpoint ride inside." },
  ];

  var DIAL_WILD = ["", "0.0.0.0", "::", "[::]", "*"];
  function dialListen(tp, baseConf) {
    var l = String((tp && tp.listen) || ""), i = l.lastIndexOf(":");
    if (i < 0 || DIAL_WILD.indexOf(l.slice(0, i)) < 0) return tp;
    var ep = (String(baseConf || "").match(/^[ \t]*Endpoint[ \t]*=[ \t]*(\S+)/m) || [])[1] || "";
    var j = ep.lastIndexOf(":"), eh = j >= 0 ? ep.slice(0, j) : ep;
    if (DIAL_WILD.indexOf(eh) >= 0) return tp;
    var o = {};
    for (var k in tp) if (Object.prototype.hasOwnProperty.call(tp, k)) o[k] = tp[k];
    o.listen = eh + ":" + l.slice(i + 1);
    return o;
  }

  function artifact(baseConf, tp, vkLink, cs, vkLinks, asClient) {
    tp = dialListen(tp, baseConf);
    var fork = label(tp.service);
    var enc = asClient || nativeEncoder(fork);
    cs = cs || {};
    var listen = tp.listen || "";
    var vkList = (Array.isArray(vkLinks) && vkLinks.length ? vkLinks : (vkLink ? [vkLink] : [])).map(function (s) { return (s || "").trim(); }).filter(Boolean);
    var vkRaw = vkList[0] || "";
    var vkText = vkRaw || "<PASTE VK CALL LINK>";
    var vkMissing = vkList.length === 0;
    var cf = parseFullConf(baseConf);
    if (enc === "wingsv") {
      return { fork: fork, app: "WINGS V", label: clientLabel(fork, "wingsv"), ext: "txt", uri: true, qr: true, vkMissing: vkMissing, enc: enc,
        hint: "Scan the QR with the WINGS V app, or paste the wingsv:// link (Settings → import from link).",
        buildAsync: function () { return wingsvLink(baseConf, tp, vkList, cs); } };
    }
    if (enc === "anton48") {
      var isWrapS = (fork === "samosvalishe") || csBool(cs, "useWrapS", false);
      var vkObf = (fork === "anton48" || fork === "Moroka8" || fork === "samosvalishe");
      var dnsOverride = String((cs || {}).dnsServers || "").trim();
      var s = { privateKey: cf.privkey, peerPublicKey: cf.server_pubkey, presharedKey: cf.psk || "",
        tunnelAddress: cf.address,
        dnsServers: dnsOverride || (cf.dns && cf.dns.length ? cf.dns.join(",") : "1.1.1.1"),
        peerAddress: listen, vkLink: vkList.join("\n"), numConnections: csNum(cs, "numConnections", 30),
        useDTLS: true, useSrtp: (vkObf && !isWrapS && !tp.wrap_key), useUDP: csBool(cs, "useUDP", false),
        useWrap: (vkObf && !isWrapS && !!tp.wrap_key), wrapKeyHex: vkObf ? (tp.wrap_key || "") : "",
        useWrapA: csBool(cs, "useWrapA", false), useWrapS: isWrapS,
        obfProfile: obfProfileOf(cs, tp),
        clientID: isWrapS ? stableCid(cf, tp) : "" };
      var wrapApw = String((cs || {}).wrapAPassword || "").trim(); if (wrapApw) s.wrapAPassword = wrapApw;
      var srvName = expandServerName(String((cs || {}).serverName || "").trim(), fork, listen);
      if (srvName) s.serverName = srvName;
      var turnOv = String((cs || {}).turnServerOverride || "").trim(); if (turnOv) s.turnServerOverride = turnOv;
      if (csBool(cs, "vkAuth", false)) s.vkAuth = true;
      var uri = "vkturnproxy://import?data=" + b64urlUtf8(jsonSortedCompact({ version: 1, type: "connection", settings: s }));
      return { fork: fork, app: "VK TURN Proxy", label: clientLabel(fork, "anton48", isWrapS ? " · WRAP-S" : ""), labelMode: (isWrapS ? " · WRAP-S" : ""), ext: "txt", uri: true, qr: false, vkMissing: vkMissing, enc: enc,
        hint: "Open the link on the iPhone (or the app's Settings → Import from connection link) to import into the VK TURN Proxy app.",
        text: uri };
    }
    if (enc === "vktgz") {
      var coreName = ({ MYSOREZ: "MYSOREZ", Moroka8: "Moroka8", samosvalishe: "free-turn", cacggghp: "cacggghp" })[fork] || fork;
      var launcher = (fork === "Moroka8" || fork === "samosvalishe");
      return { fork: fork, app: "VK TURN Proxy", label: clientLabel(fork, "vktgz"), ext: "txt", qr: true, wrap: true, vkMissing: vkMissing, enc: enc,
        vk: true, vkLinks: vkList,
        hint: VKTGZ_HINTS[(launcher ? 0 : 2) + (vkMissing ? 0 : 1)].hint,
        hintArgs: { v1: coreName },
        buildAsync: function () { return vktgzLink(baseConf, tp, vkList, cs, fork); } };
    }
    if (enc === "freeturn") {
      return { fork: fork, app: "FreeTurn", label: clientLabel(fork, "freeturn"), ext: "txt", uri: true, qr: true, vkMissing: vkMissing, enc: enc,
        vk: true, vkLinks: vkList, vkEmbedded: true,
        hint: "Scan the QR with the FreeTurn app (hackdiaz-dev/turn-proxy-android), or paste the freeturn:// link — it carries the VK call link and the whole config.",
        text: freeturnLink(tp, baseConf, vkList, cs, fork) };
    }
    var sidecar = baseConf.replace(/^([ \t]*Endpoint[ \t]*=).*$/m, "$1 127.0.0.1:9000");
    sidecar = /^[ \t]*MTU[ \t]*=/m.test(sidecar) ? sidecar.replace(/^([ \t]*MTU[ \t]*=).*$/m, "$1 1280")
      : sidecar.replace(/^([ \t]*Address[ \t]*=.*)$/m, "$1\nMTU = 1280");
    var rawExtra = String((cs || {}).rawFlags || "").split(/[\r\n]+/).map(function (s) { return s.trim(); }).filter(Boolean).join(" ");
    var served = cliAuthorsOf(fork);
    var authorForks = (Array.isArray(served) && served.length) ? served : (({ Moroka8: ["Moroka8", "samosvalishe"], samosvalishe: ["samosvalishe", "Moroka8"],
      anton48: ["samosvalishe", "Moroka8"], MYSOREZ: ["MYSOREZ"] })[fork] || ["samosvalishe"]);
    function authorCmd(a) {
      var link = (a === "MYSOREZ") ? " -vk " : (a === "samosvalishe") ? " -links " : " -vk-link ", obf = "";
      if (tp.wrap_key) {
        if (a === "Moroka8") obf = " -wrap -wrap-key " + tp.wrap_key;
        else if (a === "samosvalishe") obf = " -obf-profile " + obfProfileOf(cs, tp) + " -obf-key " + tp.wrap_key;
        else if (a === "MYSOREZ") obf = " -password " + tp.wrap_key + " -vk-anon-path vkcalls -captcha-mode auto -vk-auth anonymous";
      }
      var vkArg = (a === "samosvalishe" || a === "MYSOREZ") && vkList.length ? vkList.join(",") : vkText;
      return "./client -listen 127.0.0.1:9000 -peer " + listen + link + vkArg + obf + (rawExtra ? " " + rawExtra : "");
    }
    var authors = authorForks.map(function (a) { return { fork: a, cmd: authorCmd(a), native: (a === fork) }; });
    return { fork: fork, app: fork, label: clientLabel(fork, "sidecar"), ext: "conf", qr: true, vkMissing: vkMissing, enc: enc,
      hint: "This server needs a separate client binary. Scan the QR or import .conf into WireGuard/AmneziaWG, then run the client alongside it:",
      cmd: authors[0].cmd, cliAuthors: authors,
      text: sidecar };
  }

  function stripVkUrl(u) {
    u = String(u || "").trim();
    if (u.indexOf("/") >= 0) u = u.slice(u.lastIndexOf("/") + 1);
    if (u.indexOf("?") >= 0) u = u.slice(0, u.indexOf("?"));
    return u.trim();
  }
  function wdttArtifact(w, asClient) {
    w = w || {};
    var vkList = (Array.isArray(w.vk_links) ? w.vk_links : (w.vk_links ? [w.vk_links] : [])).map(function (s) { return (s || "").trim(); }).filter(Boolean);
    var vkHashes = vkList.map(stripVkUrl).filter(Boolean);
    if (!vkHashes.length && w.vk_hash) vkHashes = [String(w.vk_hash).trim()];
    var vkMissing = vkHashes.length === 0;
    var host = (w.endpoint_host || "").trim();
    var dtls = String(w.dtls_port || 56000), wg = String(w.wg_port || 56001), tun = String(w.tun_port || 9000);
    var pass = (w.password || "");
    var enc = asClient || "anton48";
    if (enc === "wdttplus") {
      var wp = ["v=1", "host=" + encodeURIComponent(host), "dtls=" + encodeURIComponent(dtls),
                "wg=" + encodeURIComponent(wg), "local=" + encodeURIComponent(tun),
                "password=" + encodeURIComponent(pass)];
      if (vkHashes.length) wp.push("hashes=" + encodeURIComponent(vkHashes.join(",")));
      if (w.name) wp.push("name=" + encodeURIComponent(w.name));
      var uriW = "wdtt://connect?" + wp.join("&");
      return { fork: "WDTT", app: "WDTT-Plus", label: "WDTT via WDTT-Plus (Android · wdtt://connect)", ext: "txt", uri: true, qr: true, vkMissing: vkMissing, enc: enc,
        hint: "Scan the QR or open the wdtt:// link in WDTT-Plus.", text: uriW };
    }
    if (enc === "qwdtt") {
      var q = ["peer=" + encodeURIComponent(host + ":" + dtls)];
      if (w.name) q.push("name=" + encodeURIComponent(w.name));
      if (vkHashes.length) q.push("hashes=" + encodeURIComponent(vkHashes.join(",")));
      if (w.workers) q.push("workers=" + encodeURIComponent(w.workers));
      q.push("port=" + encodeURIComponent(tun));
      var uriq = "qwdtt://config?" + q.join("&") + "&pass=" + pass;
      return { fork: "WDTT", app: "qWDTT", label: "WDTT via qWDTT (Android · qwdtt://)", ext: "txt", uri: true, qr: true, vkMissing: vkMissing, enc: enc,
        hint: "Scan the QR or open the qwdtt:// link in the qWDTT app (Android) or PWDTT (desktop).", text: uriq };
    }
    if (enc === "anton48" || enc === "vkturnproxy") {
      var s = { useWrapA: true, wrapAPassword: pass, peerAddress: host + ":" + dtls, vkLink: vkList.join("\n") };
      var uri2 = "vkturnproxy://import?data=" + b64urlUtf8(jsonSortedCompact({ version: 1, type: "connection", settings: s }));
      return { fork: "WDTT", app: "VK TURN Proxy", label: "WDTT via VK TURN Proxy (iOS · WRAP-A) by anton48", ext: "txt", uri: true, qr: false, vkMissing: vkMissing, enc: enc,
        hint: "Open the link on the iPhone (or VK TURN Proxy → Settings → Import from connection link) to import in WRAP-A mode.", text: uri2 };
    }
    if (enc === "pwdttilg") {
      var pl = { ip: host, dtls: parseInt(dtls, 10) || 56000, pass: pass };
      var rawp = parseInt(w.raw_port, 10) || 0;
      if (rawp && rawp !== (parseInt(dtls, 10) || 56000) + 3) pl.raw = rawp;
      if (w.name) pl.name = String(w.name);
      if (vkHashes.length) pl.hash = vkHashes.slice(0, VK_LINK_CAPS.wdtt).join(",");
      var uriI = "wdtt://" + b64Utf8(JSON.stringify(pl));
      return { fork: "WDTT", app: "PWDTT", label: "WDTT via PWDTT (desktop · wdtt:// base64) by ildarmaga", ext: "txt",
        uri: true, qr: false, vkMissing: vkMissing, enc: enc,
        hint: "Paste the wdtt:// link into PWDTT — «Добавление VK профиля».", text: uriI };
    }
    var vkh = vkHashes.join(",");
    var uri = "wdtt://" + host + ":" + dtls + ":" + wg + ":" + tun + ":" + pass + ":" + vkh;
    return { fork: "WDTT", app: "WDTT", label: "WDTT via WDTT app (Android · WRAP)", ext: "txt", uri: true, qr: true, vkMissing: vkMissing, enc: enc,
      hint: "Scan the QR or open the wdtt:// link in the WDTT app (Android) or PWDTT (desktop).", text: uri };
  }

  var CSQTT_LINK_SEED = "csqtt-chiper-key";
  function csqttUrlEnc(v) {
    var b = new TextEncoder().encode(String(v == null ? "" : v)), out = "";
    for (var i = 0; i < b.length; i++) {
      var x = b[i];
      out += ((x >= 48 && x <= 57) || (x >= 65 && x <= 90) || (x >= 97 && x <= 122) || x === 45 || x === 95 || x === 46 || x === 126)
        ? String.fromCharCode(x) : "%" + (x < 16 ? "0" : "") + x.toString(16).toUpperCase();
    }
    return out;
  }
  function csqttSeal(payload) {
    var sub = typeof crypto !== "undefined" && crypto.subtle;
    if (!sub) return Promise.reject(new Error("this browser can't build a csqtt 2.5 link (no Web Crypto — open the page over HTTPS)"));
    var enc = new TextEncoder(), pt = enc.encode(payload);
    return sub.digest("SHA-256", enc.encode(CSQTT_LINK_SEED)).then(function (kh) {
      return Promise.all([sub.importKey("raw", kh, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
                          sub.importKey("raw", kh, { name: "AES-GCM" }, false, ["encrypt"])]);
    }).then(function (ks) {
      return sub.sign("HMAC", ks[0], pt).then(function (mac) {
        var iv = new Uint8Array(mac).slice(0, 12);
        return sub.encrypt({ name: "AES-GCM", iv: iv }, ks[1], pt).then(function (ct) {
          var all = new Uint8Array(12 + ct.byteLength); all.set(iv); all.set(new Uint8Array(ct), 12);
          var bin = ""; for (var i = 0; i < all.length; i++) bin += String.fromCharCode(all[i]);
          return "csqtt://" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        });
      });
    });
  }
  function csqttArtifact(c, asClient, line) {
    c = c || {};
    var hs = c.hashes;
    if (!hs) {
      hs = [];
      if (c.vk_hash) hs.push(stripVkUrl(c.vk_hash));
      (Array.isArray(c.vk_links) ? c.vk_links : (c.vk_links ? [c.vk_links] : [])).forEach(function (l) { var h = stripVkUrl(l); if (h) hs.push(h); });
    }
    hs = hs.map(function (s) { return String(s || "").trim(); }).filter(Boolean);
    var seen = {}; hs = hs.filter(function (h) { if (seen[h]) return false; seen[h] = 1; return true; });
    if (asClient === "anton48" || asClient === "vkturnproxy") {
      var s = { useCsqtt: true, csqttPassword: String(c.password || ""),
        peerAddress: String(c.host || "") + ":" + (parseInt(c.port, 10) || ""),
        vkLink: hs.map(function (h) { return "https://vk.ru/call/join/" + h; }).join("\n") };
      var uriA = "vkturnproxy://import?data=" + b64urlUtf8(jsonSortedCompact({ version: 1, type: "connection", settings: s }));
      return { fork: "csqtt", app: "VK TURN Proxy", label: "CSQTT via VK TURN Proxy (iOS) by anton48", ext: "txt", uri: true, qr: false,
        vkMissing: hs.length === 0, enc: asClient, hint: "Open the link on the iPhone (or VK TURN Proxy → Settings → Import from connection link) to import in csqtt mode. It needs VK TURN Proxy build 364 or newer — an older build imports it as a WireGuard server without keys.", text: uriA };
    }
    hs = hs.slice(0, VK_LINK_CAPS.csqtt);
    var vkMissing = hs.length === 0;
    if (line && line !== "2.1") {
      var p25 = "connect?v=2&host=" + csqttUrlEnc(c.host) + "&peer=" + (parseInt(c.port, 10) || 46000)
        + (c.password ? "&password=" + csqttUrlEnc(c.password) : "") + (hs.length ? "&hashes=" + hs.map(csqttUrlEnc).join("+") : "");
      return { fork: "csqtt", app: "CSQTT", label: "CSQTT (csqtt://connect)", ext: "txt", uri: true, qr: true,
        vkMissing: vkMissing, hint: "Open the csqtt:// link in your csqtt app, or paste it in.", src: p25,
        buildAsync: function () { return csqttSeal(p25); } };
    }
    var qp = ["v=2", "host=" + encodeURIComponent(String(c.host || "")),
              "peer=" + (parseInt(c.port, 10) || ""), "password=" + encodeURIComponent(String(c.password || ""))];
    if (hs.length) qp.push("hashes=" + hs.map(function (h) { return h.replace(/\+/g, "%2B"); }).join("+"));
    var uri = "csqtt://connect?" + qp.join("&");
    return { fork: "csqtt", app: "CSQTT", label: "CSQTT (csqtt://connect)", ext: "txt", uri: true, qr: false,
      vkMissing: vkMissing, hint: "Open the csqtt:// link in your csqtt app, or paste it in.", text: uri };
  }

  function clientMeta(enc) { var m = CLIENT_META[enc]; return m ? { app: m.app, platform: m.platform, author: m.author } : null; }
  root.SWGTurn = { setForkLabel: function (fn) { if (typeof fn === "function") forkName = fn; },
    setCliAuthors: function (fn) { if (typeof fn === "function") cliAuthorsOf = fn; }, vkLinkCaps: VK_LINK_CAPS, artifact: artifact, clientMeta: clientMeta, fork: label, label: label, nativeEncoder: nativeEncoder, encoderFork: encoderFork, amneziaVpn: amneziaVpnLink, wdttArtifact: wdttArtifact, csqttArtifact: csqttArtifact, stripVkUrl: stripVkUrl };
})(typeof window !== "undefined" ? window : this);
