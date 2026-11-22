import { $, esc, tkey, isPrivIp, fmtBytes, rateIn, niceScaleCeilIn, seen, panelNowS, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { go } from "./router.js";
import { lang, setLang, LANGS, nextLang, T, Tsplit, srvText, srvVars } from "./i18n.js";
import { IFACE_COLOR_DEFAULTS, THEME_COLOR_DEFAULT, THEME_COLOR_LIGHT_DEFAULT, THEME_MODES,
         clampBrand, hexLum, pickThemed, resolvedTheme, themeMode } from "./theme.js";
import { targetType, peerUncategorised, awgGen, awgGenPending, nodeStale, tip3 } from "./model.js";
import { turnColor, turnFork, turnForkList, forkLabel, CSQTT_DEFAULT_LINE } from "./turn-catalog.js";
import { h, render, Fragment } from "preact";
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export const ICON = {
  arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/></svg>',
  waves: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8q3.5-4 7 0t7 0"/><path d="M3 13q3.5-4 7 0t7 0"/><path d="M3 18q3.5-4 7 0t7 0"/></svg>',
  off: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  err: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>',
  play: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4l13 8-13 8z"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  server: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  network: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.2v3.3M12 10.5 6.2 17M12 10.5 17.8 17"/></svg>',
  key: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="8" cy="15" r="4"/><path d="M10.9 12.1 21 2m-4 1 2.4 2.4M14 5l2.4 2.4"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3l7.5 3.2v5C19.5 16 16.4 19 12 21 7.6 19 4.5 16 4.5 11.2v-5z"/></svg>',
  "shield-fill": '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3l7.5 3.2v5C19.5 16 16.4 19 12 21 7.6 19 4.5 16 4.5 11.2v-5z"/></svg>',
  compass: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2 5.6-5.6 2 2-5.6z"/></svg>',
  eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  activity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3.4"/><path d="M22 19v-1a4 4 0 0 0-3-3.85M16 3.2a4 4 0 0 1 0 7.6"/></svg>',
  user: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M19 20v-1a5 5 0 0 0-5-5h-4a5 5 0 0 0-5 5v1"/><circle cx="12" cy="7" r="4"/></svg>',
  device: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 18h2"/></svg>',
  android: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7.2 9.3h9.6v7.2a1 1 0 0 1-1 1H15v2.1a1.1 1.1 0 0 1-2.2 0V17.5h-1.6v2.1a1.1 1.1 0 0 1-2.2 0V17.5h-.8a1 1 0 0 1-1-1zM5 9.6a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4A1.1 1.1 0 0 1 5 9.6zm14 0a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4A1.1 1.1 0 0 1 19 9.6zM8.3 8.4a3.9 3.9 0 0 1 1.7-2.7l-.82-1.35a.28.28 0 0 1 .48-.28l.83 1.4a4.6 4.6 0 0 1 3 0l.83-1.4a.28.28 0 0 1 .48.28L14.0 5.7a3.9 3.9 0 0 1 1.7 2.7zm1.8-1.6a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24zm3.8 0a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24z"/></svg>',
  apple: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.8 12.7c-.02-2.2 1.8-3.26 1.88-3.32-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.68 0-1.75-.78-2.88-.76-1.5.02-2.85.86-3.61 2.19-1.54 2.68-.4 6.65 1.1 8.83.73 1.07 1.6 2.27 2.74 2.23 1.1-.045 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.18-.02 1.93-1.09 2.65-2.16.83-1.24 1.18-2.44 1.2-2.5-.026-.01-2.3-.885-2.32-3.51zM13.6 6.35c.6-.73.995-1.74.888-2.75-.86.035-1.9.57-2.52 1.3-.55.64-1.03 1.68-.9 2.66.955.075 1.93-.49 2.53-1.21z"/></svg>',
  windows: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.6l7.4-1.02v7.06H3zm8.3-1.14L21 3.1v8.54h-9.7zM3 12.44h7.4v7.06L3 18.44zm8.3 0H21v8.5l-9.7-1.36z"/></svg>',
  finder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M11.8 3.8c-1.1 2.1-.9 3.4.8 4.9-1.9 1.2-2 2.7-.3 4.3-1.7 1.1-1.9 3.3.2 6.2"/><path d="M8.3 9v1.7M15.6 9v1.7"/><path d="M7.7 14.4c2.6 2.1 6.3 2.1 8.9 0"/></svg>',
  cpu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M9 1.5v3M15 1.5v3M9 19.5v3M15 19.5v3M1.5 9h3M1.5 15h3M19.5 9h3M19.5 15h3"/></svg>',
  disk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.2 13 7.5 5h9l2.3 8M7 16.5h.01"/></svg>',
  database: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.2 2"/></svg>',
  "cal-day": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><rect x="10.2" y="12.4" width="3.6" height="3.6" rx="0.7" fill="currentColor" stroke="none"/></svg>',
  "cal-week": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M6.3 14h11.4" stroke-width="2.7"/></svg>',
  cal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 16.6h.01M12 16.6h.01M16.5 16.6h.01" stroke-width="2.3"/></svg>',
  donut: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/></svg>',
  flow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.9 15.7 7.1M8.3 13.1 15.7 16.9"/></svg>',
  bars: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V12M12 20V4M19 20V15"/></svg>',
  exclaim: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.3v5.4"/><path d="M12 16.3v.01" stroke-width="2.4"/></svg>',
  excl: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 3.5v11"/><path d="M12 20v.01" stroke-width="3.4"/></svg>',
  hour2: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 9.7 8.1"/><path d="M12 12 17 12"/></svg>',
  sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/></svg>',
  weekcal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9.5h18M8 3v3.4M16 3v3.4"/><rect x="6.2" y="12.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/><rect x="10.4" y="12.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/><rect x="14.6" y="12.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none"/></svg>',
  monthcal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9.5h18M8 3v3.4M16 3v3.4"/><g fill="currentColor" stroke="none"><rect x="6.3" y="11.6" width="2.7" height="2.7" rx="0.5"/><rect x="10.65" y="11.6" width="2.7" height="2.7" rx="0.5"/><rect x="15" y="11.6" width="2.7" height="2.7" rx="0.5"/><rect x="6.3" y="15.4" width="2.7" height="2.7" rx="0.5"/><rect x="10.65" y="15.4" width="2.7" height="2.7" rx="0.5"/><rect x="15" y="15.4" width="2.7" height="2.7" rx="0.5"/></g></svg>',
  daycal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9.5h18M8 3v3.4M16 3v3.4"/><rect x="9.9" y="12.2" width="4.2" height="4.2" rx="0.8" fill="currentColor" stroke="none"/></svg>',
  relay: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 18.6a9.4 9.4 0 0 0 0-13.2"/></svg>',
  cascade: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v4h5v4h5v4h6"/></svg>',
  smart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8z"/></svg>',
  globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>',
  bolt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  gauge: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 13.5 16 9"/><path d="M4 18a9 9 0 1 1 16 0"/></svg>',
  sliders: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 13H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-1.1 2.7v.1a2 2 0 1 1 0 4z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1.2 1.1M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18l1.2-1.1"/></svg>',
  qr: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><path d="M14 14h3v3M21 14v3M17 21h4M14 21h.01M21 21v.01M17 17h.01"/></svg>',
  doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  code: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 4.5l-3 15"/></svg>',
  os_android: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.2 9.3h9.6v7.2a1 1 0 0 1-1 1H15v2.1a1.1 1.1 0 0 1-2.2 0V17.5h-1.6v2.1a1.1 1.1 0 0 1-2.2 0V17.5h-.8a1 1 0 0 1-1-1zM5 9.6a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4A1.1 1.1 0 0 1 5 9.6zm14 0a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4A1.1 1.1 0 0 1 19 9.6zM8.3 8.4a3.9 3.9 0 0 1 1.7-2.7l-.82-1.35a.28.28 0 0 1 .48-.28l.83 1.4a4.6 4.6 0 0 1 3 0l.83-1.4a.28.28 0 0 1 .48.28L14 5.7a3.9 3.9 0 0 1 1.7 2.7zm1.8-1.6a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24zm3.8 0a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24z"/></svg>',
  os_ios: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.8 12.7c-.02-2.2 1.8-3.26 1.88-3.32-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.68 0-1.75-.78-2.88-.76-1.5.02-2.85.86-3.61 2.19-1.54 2.68-.4 6.65 1.1 8.83.73 1.07 1.6 2.27 2.74 2.23 1.1-.045 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.18-.02 1.93-1.09 2.65-2.16.83-1.24 1.18-2.44 1.2-2.5-.026-.01-2.3-.885-2.32-3.51zM13.6 6.35c.6-.73.995-1.74.888-2.75-.86.035-1.9.57-2.52 1.3-.55.64-1.03 1.68-.9 2.66.955.075 1.93-.49 2.53-1.21z"/></svg>',
  os_windows: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.6l7.4-1.02v7.06H3zm8.3-1.14L21 3.1v8.54h-9.7zM3 12.44h7.4v7.06L3 18.44zm8.3 0H21v8.5l-9.7-1.36z"/></svg>',
  os_macos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M11.8 3.8c-1.1 2.1-.9 3.4.8 4.9-1.9 1.2-2 2.7-.3 4.3-1.7 1.1-1.9 3.3.2 6.2"/><path d="M8.3 9v1.7M15.6 9v1.7"/><path d="M7.7 14.4c2.6 2.1 6.3 2.1 8.9 0"/></svg>',
  os_linux: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z"/></svg>',
};
export const Ic = ({ i }) => html`<span class="ic" dangerouslySetInnerHTML=${{ __html: ICON[i] || "" }}></span>`;

export function Panel({ icon, title, count, actions, tone, children, pad, lead }) {
  return html`<section class="panel">
    <div class="panel-head">
      ${icon ? html`<span class=${"panel-ic" + (tone ? " t-" + tone : "")}><${Ic} i=${icon}/></span>` : null}
      <h3>${title}</h3>${count != null ? html`<span class="panel-count">${count}</span>` : null}
      ${lead || null}<span class="grow"></span>${actions || null}
    </div>
    <div class=${"panel-body" + (pad === false ? " flush" : "")}>${children}</div>
  </section>`;
}

export function toast(msg, kind = "info", ms = 5500) {
  const host = $("#toasts"); if (!host) return;
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = (ICON[kind] || ICON.info) + "<span>" + esc(msg) + "</span>";
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 250); }, ms);
}
export function ConfirmPhrase({ phrase, bold }) {
  return html`<button type="button" class="ctype-copy" title=${T("Copy")}
    onClick=${e => { e.preventDefault(); e.stopPropagation(); copy(phrase, T("Phrase copied")); }}>
    <span class=${bold ? "mono b" : "mono"}>${phrase}</span><${Ic} i="copy"/></button>`;
}
export function typeToConfirm(phrase) {
  const [a, b] = Tsplit("Type {phrase} to confirm", "phrase");
  return html`<${Fragment}>${a}<${ConfirmPhrase} phrase=${phrase}/>${b}<//>`;
}
export function copy(text, what) { navigator.clipboard.writeText(text); toast((what || T("Copied")) + ".", "ok", 1500); }

let _mutSeq = 0;
export function adoptOrphanPatch(o) {
  return s => {
    const target = { node: o.node, iface: o.iface, ip: (o.allowed_ips || "").split("/")[0] };
    const peers = (s.roster && s.roster.peers) || {};
    const mine = Object.entries(peers).find(([, p]) => p && p.pubkey === o.pubkey);
    if (mine) {
      const p = mine[1];
      if (!(p.targets || []).some(t => t && t.node === target.node && t.iface === target.iface))
        p.targets = (p.targets || []).concat([target]);
      return;
    }
    peers["adopting:" + o.node + "|" + o.iface + "|" + o.pubkey] = {
      user_id: null, title: "", pubkey: o.pubkey, psk: o.preshared_key || "",
      targets: [target], created_at: panelNowS(),
    };
  };
}
export function mutate({ key, patch, call, onOk, timeout = 8000 }) {
  const id = "m" + (++_mutSeq);
  if (key) delete Store.rowErrors[key];
  if (patch) { Store.pending[id] = { apply: patch, done: false }; }
  if (patch || key) Store.apply();
  const timer = setTimeout(() => { if (Store.pending[id]) { delete Store.pending[id]; Store.poll().catch(() => {}); } }, timeout);
  return (async () => {
    let r;
    try { r = await call(); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    clearTimeout(timer);
    if (!r || !r.ok) {
      delete Store.pending[id];
      if (key) Store.rowErrors[key] = { msg: (r && (srvText(r) || r.code)) || T("request failed"), at: Date.now() };
      Store.apply();
      toast((r && (srvText(r) || r.code)) || T("Action failed."), "err", 4500);
      return r || { ok: false };
    }
    if (key) delete Store.rowErrors[key];
    if (onOk) { try { onOk(r); } catch (_) {} }
    if (Store.pending[id]) Store.pending[id].done = true;
    await Store.poll().catch(() => {});
    return r;
  })();
}
export async function sheetSend(call, setErr, setBusy) {
  if (setBusy) setBusy(true);
  if (setErr) setErr("");
  let r;
  try { r = await call(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
  if (setBusy) setBusy(false);
  if (!r || !r.ok) { if (setErr) setErr(srvText(r) || (r && r.code) || T("save failed")); return r || { ok: false }; }
  return r;
}
export function rowError(key) { return Store.rowErrors[key] || null; }
export function dismissError(key) { if (Store.rowErrors[key]) { delete Store.rowErrors[key]; Store.apply(); } }

let _setStack = () => {};
let _stack = [];
let _modalSeq = 0;
let _onStack = null;
function _applyStack(next) { _stack = next; _modalSeq++; _setStack(next); if (_onStack) _onStack(next.length); }
export function openModal(node) { _applyStack(_stack.length ? [..._stack.slice(0, -1), node] : [node]); }
export function pushModal(node) { _applyStack([..._stack, node]); }
function _blurActive() { requestAnimationFrame(() => { const a = document.activeElement; if (a && a.blur && a.tagName !== "BODY") a.blur(); }); }
export function closeModal() { _applyStack(_stack.slice(0, -1)); _blurActive(); }
export function closeAllModals() { _applyStack([]); _blurActive(); }
export function closeModals(n) { _applyStack(_stack.slice(0, Math.max(0, _stack.length - Math.max(1, n | 0)))); _blurActive(); }
let _sheetStack = [];

let _rowClickT = null;
const _rowInteractive = e => !!(e.target.closest && e.target.closest("button, a, input, select, textarea, label, .assigncell, .rowacts, .selwrap, .tg-gw"));
export function rowSingle(e, fn) { if (_rowInteractive(e)) return; clearTimeout(_rowClickT); _rowClickT = setTimeout(() => { _rowClickT = null; fn(); }, 200); }
export function rowDouble(e, fn) { if (_rowInteractive(e)) return; clearTimeout(_rowClickT); _rowClickT = null; fn(); }
export const rowNoSelect = e => { if (e.detail > 1) e.preventDefault(); };

export function Portal({ children }) {
  const host = useRef(null);
  if (!host.current) host.current = document.createElement("div");
  useEffect(() => { const el = host.current; document.body.appendChild(el); return () => { render(null, el); el.remove(); }; }, []);
  useLayoutEffect(() => { render(children, host.current); });
  return null;
}

function useNoNativeTitle(ref, active) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const parked = [];
    const park = el => {
      if (el && el.hasAttribute && el.hasAttribute("title")) { parked.push([el, el.getAttribute("title")]); el.removeAttribute("title"); }
    };
    for (let el = ref.current; el && el !== document.body; el = el.parentElement) park(el);
    ref.current.querySelectorAll("[title]").forEach(park);
    return () => parked.forEach(([el, v]) => { try { el.setAttribute("title", v); } catch (_) {   } });
  }, [active]);
}

export function Popover({ trigger, cls, popCls, alignRight, children, hoverOnly, autoOpen, clickOnly }) {
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(!!autoOpen), [pos, setPos] = useState(null);
  const ref = useRef(null), popRef = useRef(null), closeT = useRef(null);
  const show = open || pinned;
  const cancelClose = () => clearTimeout(closeT.current);
  const scheduleClose = () => { cancelClose(); closeT.current = setTimeout(() => setOpen(false), 140); };
  const place = () => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect();
    const pop = popRef.current, M = 8, vw = window.innerWidth, vh = window.innerHeight;
    let ph = 340, pw = 300;
    if (pop) {
      const cap = pop.style.maxHeight; pop.style.maxHeight = ""; ph = pop.offsetHeight; pw = pop.offsetWidth; pop.style.maxHeight = cap;
    }
    const below = vh - r.bottom - 6 - M, above = r.top - 6 - M;
    const flip = ph > below && above > below;
    const room = Math.max(60, Math.floor(flip ? above : below));
    const maxH = ph > room ? room : 0;
    let left = alignRight ? Math.min(Math.max(r.right + 3, M + pw), vw - M) : Math.max(M, Math.min(r.left, vw - pw - M));
    left = Math.round(left);
    const top = Math.round(flip ? r.top - 6 : r.bottom + 6);
    setPos(p => (p && p.left === left && p.top === top && p.flip === flip && p.maxH === maxH) ? p : { left, top, flip, maxH }); };
  const roRef = useRef(null);
  useLayoutEffect(() => {
    if (show && pos && popRef.current) place();
    const el = show ? popRef.current : null;
    if (roRef.current && roRef.current.el !== el) { roRef.current.ro.disconnect(); roRef.current = null; }
    if (el && !roRef.current && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => place()); ro.observe(el); roRef.current = { ro, el };
    }
  });
  useEffect(() => () => { if (roRef.current) roRef.current.ro.disconnect(); }, []);
  useEffect(() => {
    if (!show) return; place();
    const onMove = () => place();
    const onDoc = e => { const t = e.target;
      if ((ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t))) return;
      setPinned(false); setOpen(false);
      const eat = e2 => { e2.stopPropagation(); e2.preventDefault(); };
      document.addEventListener("click", eat, true);
      setTimeout(() => document.removeEventListener("click", eat, true), 350);
    };
    const depthAtPin = modalDepth();
    const onEsc = e => {
      if (e.key !== "Escape") return;
      if (modalDepth() !== depthAtPin) return;
      if (document.querySelector(".ddpop")) return;
      e.stopPropagation(); e.preventDefault(); setPinned(false); setOpen(false);
    };
    window.addEventListener("scroll", onMove, true); window.addEventListener("resize", onMove);
    if (pinned) { document.addEventListener("pointerdown", onDoc, true); window.addEventListener("keydown", onEsc, true); }
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); document.removeEventListener("pointerdown", onDoc, true); window.removeEventListener("keydown", onEsc, true); };
  }, [show, pinned]);
  useEffect(() => () => clearTimeout(closeT.current), []);
  useNoNativeTitle(ref, show);
  return html`<span class=${(cls || "") + (show ? " on" : "")} ref=${ref}
    onClick=${hoverOnly && !isMobile() ? null : (e => {
      if (hoverOnly) { if (!e.target.closest("a, button, [role=button]") && !(ref.current && ref.current.querySelector("button, [role=button]"))) setPinned(p => !p); return; }
      e.stopPropagation(); e.preventDefault(); setPinned(p => !p); })}
    onMouseEnter=${clickOnly || (hoverOnly && isMobile()) ? null : () => { cancelClose(); setOpen(true); }} onMouseLeave=${clickOnly ? null : scheduleClose}>${trigger}
    ${show && pos ? html`<${Portal}><div ref=${popRef} class=${"deppop onlpop " + (popCls || "") + (pos.flip ? " flip" : "")} style=${"left:" + pos.left + "px;top:" + pos.top + "px;transform:" + (alignRight ? "translateX(-100%)" : "") + (pos.flip ? " translateY(-100%)" : "") + (pos.maxH ? ";max-height:" + pos.maxH + "px;overflow:auto" : "")}
      onClick=${e => e.stopPropagation()} onMouseEnter=${cancelClose} onMouseLeave=${scheduleClose}>${typeof children === "function"
        ? children(() => { setPinned(false); setOpen(false); }) : children}</div><//>` : null}
  </span>`;
}

export function attachBackCloses() {
  let url = location.href, eat = false, depth = 0;
  _onStack = n => { if (n > depth) for (; depth < n; depth++) history.pushState({ swgSheet: depth + 1 }, ""); else depth = n; };
  window.addEventListener("popstate", () => {
    const qr = document.querySelector(".qr-overlay"), pop = document.querySelector(".deppop"), cat = document.querySelector(".catpick-pop .pop-x");
    if (cat) { if (location.href !== url) { eat = true; history.pushState(history.state, "", url); } cat.click(); return; }
    if (!qr && !pop && !_stack.length && !document.querySelector(".osapp-menu")) {
      if (location.href === url) history.back();
      return;
    }
    const tookSheet = location.href === url;
    if (!tookSheet) { eat = true; history.pushState(history.state, "", url); }
    const giveBack = () => { if (tookSheet && _stack.length) history.pushState({ swgSheet: depth }, ""); };
    if (document.querySelector(".osapp-menu")) { document.dispatchEvent(new CustomEvent("m-outside-tap")); giveBack(); return; }
    if (qr) { qr.click(); giveBack(); return; }
    if (pop) { if (pop.classList.contains("m-titletap")) pop.remove(); else window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); giveBack(); return; }
    depth = Math.max(0, _stack.length - 1);
    const top = _sheetStack[_sheetStack.length - 1];
    if (top && top.close) top.close(); else closeModal();
    queueMicrotask(() => { if (_stack.length > depth) _onStack(_stack.length); });
  });
  window.addEventListener("hashchange", e => {
    if (eat) { eat = false; e.stopImmediatePropagation(); return; }
    url = location.href;
  }, true);
}

export function attachViewportVars() {
  const v = window.visualViewport, root = document.documentElement;
  const set = () => { const h = v ? v.height : innerHeight;
    root.style.setProperty("--m-vvt", (v ? v.offsetTop : 0) + "px"); root.style.setProperty("--m-vvh", h + "px");
    root.style.setProperty("--m-kbpad", innerHeight - h > 150 ? "36px" : "0px"); };
  set(); if (v) { v.addEventListener("resize", set); v.addEventListener("scroll", set); }
}

export function attachTitleTaps() {
  let bub = null;
  const drop = () => { if (bub) { bub.remove(); bub = null; } };
  document.addEventListener("click", e => {
    const t = e.target;
    if (bub && bub.contains(t)) return;
    drop();
    if (!t || !t.closest || t.closest(".deppop")) return;
    let el = null;
    for (let n = t; n && n !== document.body; n = n.parentElement) {
      if (n.matches("a, button, input, select, textarea, label, summary, [role=button], [contenteditable]")) return;
      if (getComputedStyle(n).cursor === "pointer") return;
      if (!el && n.getAttribute("title")) el = n;
    }
    if (!el) return;
    if (el.matches(".tg, .iftype, .tag, .capb, .ce-tag")) return;
    bub = document.createElement("div");
    bub.className = "deppop m-titletap";
    bub.setAttribute("role", "status");
    bub.textContent = el.getAttribute("title");
    document.body.appendChild(bub);
  });
  window.addEventListener("hashchange", drop);
}

const SWIPE_ROW = ".urow > .urow-head:has(.u-acts), table.peergrid > tbody > tr.clk:has(.rowacts), .attn-row:has(.attn-acts), .acthist .act-row:has(> .iconbtn.danger)";
export function attachSwipePeek() {
  const peek = () => setTimeout(() => {
    let n = 0;
    try { n = +(localStorage.getItem("swg-peek") || 0); } catch (_) { return; }
    const row = n < 3 && [...document.querySelectorAll(SWIPE_ROW)].find(r => { const b = r.getBoundingClientRect(); return b.height && b.top > 60 && b.bottom < innerHeight - 80; });
    if (!row || document.querySelector(".overlay.show")) return;
    try { localStorage.setItem("swg-peek", String(n + 1)); } catch (_) {}
    row.style.scrollSnapType = "none";
    row.scrollTo({ left: 76, behavior: "smooth" });
    setTimeout(() => { row.scrollTo({ left: 0, behavior: "smooth" }); setTimeout(() => { row.style.scrollSnapType = ""; }, 500); }, 750);
  }, 1200);
  window.addEventListener("hashchange", peek);
  peek();
  document.addEventListener("click", e => {
    const row = e.target && e.target.closest && e.target.closest(SWIPE_ROW);
    if (!row || row.scrollLeft > 4 || e.target.closest("button, a, input, .iconbtn")) return;
    if (row.getBoundingClientRect().right - e.clientX > 26) return;
    e.preventDefault(); e.stopPropagation();
    row.scrollTo({ left: row.scrollWidth, behavior: "smooth" });
  }, true);
}

export function attachBubbleSwipe() {
  let d = null;
  document.addEventListener("touchstart", e => {
    const pop = e.target && e.target.closest && e.target.closest(".deppop, .qr-overlay-inner");
    if (!pop || e.touches.length !== 1) { d = null; return; }
    if (e.target.closest("input, textarea, select")) { d = null; return; }
    let sc = e.target;
    for (; sc; sc = sc === pop ? null : sc.parentElement) if (sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY)) break;
    if (sc && sc.scrollTop > 0) { d = null; return; }
    d = { pop, x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dy: 0 };
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", e => {
    if (!d) return;
    const ddx = Math.abs(e.touches[0].clientX - d.x), ddy = e.touches[0].clientY - d.y;
    if (!d.dy && ddx > 10 && ddx > Math.abs(ddy)) { d.pop.style.removeProperty("transform"); d = null; return; }
    d.dy = Math.max(0, ddy);
    if (d.dy > 0 && e.cancelable) e.preventDefault();
    d.pop.style.setProperty("transition", "none", "important");
    if (d.dy) d.pop.style.setProperty("transform", "translateY(" + d.dy + "px)", "important"); else d.pop.style.removeProperty("transform");
  }, { passive: false, capture: true });
  const bubbleEnd = () => {
    if (!d) return;
    const { pop, dy, t } = d; d = null;
    const back = () => { pop.style.setProperty("transition", "transform .2s var(--ease)", "important"); pop.style.removeProperty("transform"); };
    if (dy < 70 && !(dy > 24 && dy / Math.max(1, Date.now() - t) > 0.5)) return back();
    if (pop.classList.contains("m-titletap")) return pop.remove();
    if (pop.classList.contains("qr-overlay-inner")) return pop.parentElement.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    pop.dispatchEvent(new MouseEvent("mouseleave"));
    setTimeout(() => { if (pop.isConnected) back(); }, 260);
  };
  document.addEventListener("touchend", bubbleEnd, { capture: true });
  document.addEventListener("touchcancel", bubbleEnd, { capture: true });
}

export function attachToastSwipe() {
  let d = null;
  document.addEventListener("touchstart", e => {
    const t = e.target && e.target.closest && e.target.closest(".toasts > .toast");
    d = t && e.touches.length === 1 ? { t, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dy: 0 } : null;
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", e => {
    if (!d) return;
    d.dx = e.touches[0].clientX - d.x; d.dy = e.touches[0].clientY - d.y;
    d.t.style.transition = "none"; d.t.style.transform = "translate(" + d.dx + "px," + d.dy + "px)";
    d.t.style.opacity = String(Math.max(0.2, 1 - Math.hypot(d.dx, d.dy) / 220));
  }, { passive: true, capture: true });
  document.addEventListener("touchend", () => {
    if (!d) return;
    const { t, dx, dy } = d; d = null;
    t.style.transition = "transform .2s var(--ease), opacity .2s var(--ease)";
    const n = Math.hypot(dx, dy);
    if (n < 50) { t.style.transform = ""; t.style.opacity = ""; return; }
    t.style.transform = "translate(" + (dx / n * 480) + "px," + (dy / n * 480) + "px)"; t.style.opacity = "0";
    setTimeout(() => t.remove(), 220);
  }, { capture: true });
}

const TEXT_FIELD = "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=number], input[type=password], input[type=tel]";
export function attachTypingHold() {
  document.addEventListener("focusin", e => {
    const t = e.target, sh = t && t.closest && t.matches && t.matches(TEXT_FIELD) && !t.readOnly && t.closest(".overlay .sheet");
    if (sh) sh.classList.add("m-typed");
  }, true);
}

export function attachOutsideTapGuard() {
  let eat = 0;
  document.addEventListener("pointerdown", e => {
    eat = 0;
    const layer = document.querySelector(".ddpop, .uc-pop, .deppop, .osdd-menu, .osapp-menu");
    const t = e.target, ae = document.activeElement;
    if (!layer || (t && layer.contains(t)) || (ae && ae !== document.body && ae.contains && ae.contains(t))) return;
    eat = Date.now();
    if (ae && ae.blur && ae.matches && ae.matches("input, textarea, select")) ae.blur();
    document.querySelectorAll(".deppop.m-titletap").forEach(b => b.remove());
  }, true);
  document.addEventListener("click", e => {
    if (!e.isTrusted) return;
    if (!eat || Date.now() - eat > 800) return;
    eat = 0; e.stopPropagation(); e.preventDefault();
    document.dispatchEvent(new CustomEvent("m-outside-tap"));
  }, true);
}

const once = build => { let v; return () => (v !== undefined ? v : (v = build())); };

export const STATUS_LABEL = { disabled: "blocked", blocked: "restricted" };
const STATUS_WORDS = once(() => ({
  online: T("status|Online"), ready: T("status|Ready"), pending: T("status|Pending"), creating: T("status|Creating"),
  rotating: T("status|Rotating"), restoring: T("status|Restoring"), partial: T("status|Partial"),
  dangling: T("status|Dangling"), broken: T("status|Broken"), faulty: T("status|Faulty"),
  blocked: T("status|Blocked"), restricted: T("status|Restricted"), expired: T("status|Expired"),
  expiring: T("status|Expiring"), blocking: T("status|Blocking"), unknown: T("status|Unknown"),
  unassigned: T("status|Unassigned"), orphan: T("status|Orphan"), removing: T("status|Removing"), empty: T("status|Empty"),
}));
export const statusLabel = s => { const k = STATUS_LABEL[s] || s || ""; return STATUS_WORDS()[k] || (k.charAt(0).toUpperCase() + k.slice(1)); };

let _pendingSection = null, _pendingTurnIps = false, _setSection = () => {};
export function goSettings(section) { _pendingSection = section; closeAllModals(); go("#/panel/settings"); }
export function goSettingsTurnIps() { _pendingSection = "turn"; _pendingTurnIps = true; closeAllModals(); go("#/panel/settings"); }
export const setPendingSection = s => { _pendingSection = s; };
export const takePendingSection = () => { const s = _pendingSection; _pendingSection = null; return s; };
export const takePendingTurnIps = () => { const v = _pendingTurnIps; _pendingTurnIps = false; return v; };
export const registerSectionSetter = fn => { _setSection = fn || (() => {}); };
export const gotoSettingsSection = s => _setSection(s);

export function Tag({ kind, label, color, muted, gen3, notip }) {
  return html`<span class=${"tg tg-" + (kind || "gen") + (gen3 ? " awg3" : "") + (muted ? " muted" : "")} style=${color && !muted ? "--tgc:" + color : ""} ...${notip ? {} : tip3(gen3)}>${label}</span>`;
}
export const tgt3 = t => !!t && awgGen(t.node, t.iface) === "3.1";
export function awgSwitchTag(node, iface, short) {
  const to = awgGenPending(node, iface);
  if (!to) return null;
  return html`<span class="tg tg-pending" title=${nodeStale(node)
      ? T("{v1} is not reporting — the switch applies when it is back. Until then its clients keep working on the old config, and new QR codes already show the new one.", { v1: Store.nodeName(node) })
      : T("Waiting for the node to apply it — until then its clients keep working on the old config, and new QR codes already show the new one.")}><${Ic} i="clock"/>${short ? T("tag|switching") : to === "3.1" ? T("tag|switching to 3.1") : T("tag|switching to 2.0")}</span>`;
}

export function secTitle(title, count, grow, anchor) {
  return html`<div class="section-title" data-sec=${anchor || null}><h2>${title}</h2>${count != null ? html`<span class="count">${count}</span>` : null}${grow === false ? null : html`<span class="grow"></span>`}</div>`;
}

export function SearchBox({ placeholder, value, onInput }) {
  return html`<div class="search"><${Ic} i="search"/><input placeholder=${placeholder} value=${value} onInput=${onInput}/></div>`;
}

export function footRow({ left, cancelLabel, onCancel, action, onAction, danger, actionCls, disabled, title }) {
  return html`<${Fragment}>${left || null}<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${onCancel}>${cancelLabel || T("Cancel")}</button>${action != null ? html`<button class=${actionCls || ("btn " + (danger ? "btn-danger" : "btn-primary"))} disabled=${disabled} ...${title != null ? { title } : {}} onClick=${onAction}>${action}</button>` : null}<//>`;
}
export function subjectBlocked(subject) {
  if (!subject || !subject.id) return false;
  const rec = subject.kind === "user" ? Store.user(subject.id) : Store.peer(subject.id);
  return !!(rec && rec.disabled);
}
function attachSheetSwipe(root, canSwipe, wantsGuard, close) {
  let st = null;
  const scrollerAbove = el => {
    for (; el && el !== root; el = el.parentElement) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) { const o = getComputedStyle(el).overflowY; if (o === "auto" || o === "scroll") return true; }
    }
    return false;
  };
  const reset = spring => {
    root.classList.remove("m-dragging");
    if (spring) { root.classList.add("m-springback"); setTimeout(() => root.classList.remove("m-springback"), 240); }
    root.style.transform = "";
  };
  const onStart = e => {
    st = null;
    if (e.touches.length !== 1 || !canSwipe()) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable], .ddpop")) return;
    if (scrollerAbove(t)) return;
    st = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dy: 0, on: false };
  };
  const onMove = e => {
    if (!st) return;
    const dx = e.touches[0].clientX - st.x, dy = e.touches[0].clientY - st.y;
    if (!st.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { st = null; return; }
      if (dy < -6) { st = null; return; }
      if (dy < 10) return;
      st.on = true; root.classList.add("m-dragging");
    }
    e.preventDefault();
    st.dy = Math.max(0, dy);
    root.style.transform = "translateY(" + st.dy + "px)";
  };
  const onEnd = () => {
    if (!st) return;
    const s = st; st = null;
    if (!s.on) return;
    const fast = s.dy > 40 && s.dy / Math.max(1, Date.now() - s.t) > 0.6;
    if (!(s.dy > Math.min(140, root.offsetHeight * 0.3) || fast)) return reset(true);
    if (wantsGuard()) { reset(true); close(); return; }
    root.classList.remove("m-dragging"); root.classList.add("m-springback");
    root.style.transform = "translateY(100%)";
    setTimeout(() => { close(); if (root.isConnected) reset(false); root.classList.remove("m-springback"); }, 180);
  };
  root.addEventListener("touchstart", onStart, { passive: true });
  root.addEventListener("touchmove", onMove, { passive: false });
  root.addEventListener("touchend", onEnd);
  const onCancel = () => { if (st && st.on) reset(true); st = null; };
  root.addEventListener("touchcancel", onCancel);
  return () => { root.removeEventListener("touchstart", onStart); root.removeEventListener("touchmove", onMove); root.removeEventListener("touchend", onEnd);
    root.removeEventListener("touchcancel", onCancel); };
}
export function Sheet({ title, children, foot, onClose, width, headExtra, dirtyRef, closeRef, cleanRef, onBack, noGuard, noSwipe, subject, err }) {
  useStore();
  onClose = onClose || closeModal;
  const blocked = subjectBlocked(subject);
  const ref = useRef(null);
  const dirty = useRef(false);
  const discardRef = useRef(false);
  const [discard, setDiscardState] = useState(false);
  const setDiscarding = v => { discardRef.current = v; setDiscardState(v); };
  const fields = () => Array.from(ref.current ? ref.current.querySelectorAll("input,textarea,select") : []);
  const wantsGuard = () => !noGuard && (dirty.current || (dirtyRef && dirtyRef.current)) && !discardRef.current;
  const tryClose = () => { if (wantsGuard()) { setDiscarding(true); return; } onClose(); };
  if (closeRef) closeRef.current = tryClose;
  if (cleanRef) cleanRef.current = () => { dirty.current = false; };
  const tryCloseRef = useRef(tryClose); tryCloseRef.current = tryClose;
  const noGuardRef = useRef(noGuard); noGuardRef.current = noGuard;
  const noSwipeRef = useRef(noSwipe); noSwipeRef.current = noSwipe;
  const wantsGuardRef = useRef(wantsGuard); wantsGuardRef.current = wantsGuard;

  useEffect(() => {
    const root = ref.current; if (!root) return;
    const onEdit = e => { if (!(e.target && e.target.closest && e.target.closest("[data-nodirty]"))) dirty.current = true; };
    root.addEventListener("input", onEdit, true);
    root.addEventListener("change", onEdit, true);
    let first = root.querySelector("[autofocus]") || root.querySelector("input:not([data-noautofocus]),textarea:not([data-noautofocus]),select,button.btn-primary");
    if (first && noGuardRef.current && first.tagName === "BUTTON") first = null;
    if (first && !isMobile()) setTimeout(() => { try { first.focus(); } catch (_) {} }, 0);
    const tok = { close: () => tryCloseRef.current() }; _sheetStack.push(tok);
    const onKey = e => {
      if (_qrZoomOpen()) return;
      if (_sheetStack[_sheetStack.length - 1] !== tok) return;
      if ((e.key === "Enter" || e.key === "Escape") && e.target && e.target.dataset && e.target.dataset.enter === "self") return;
      if ((e.key === "Enter" || e.key === "Escape") && document.querySelector(".ddpop")) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); tryCloseRef.current(); return; }
      if (e.key === "Enter" && e.target.closest && (root.contains(e.target) || e.target.closest(".uc-pop, .deppop, .osdd-menu, .osapp-menu, .catpick-pop"))
          && e.target.closest("button, a[href], [role=button], [role=switch], [role=radio], [role=checkbox], [role=tab]")) return;
      if (e.key === "Enter" && e.repeat && e.target.tagName !== "TEXTAREA") { e.preventDefault(); return; }
      if (e.key === "Enter" && !noGuardRef.current && e.target.tagName !== "TEXTAREA" && !e.shiftKey) {
        const primary = root.querySelector(".sheet-foot .btn-primary:not([disabled])") || root.querySelector(".btn-primary:not([disabled])");
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      if (e.key === "Tab") {
        const f = fields().concat(Array.from(root.querySelectorAll("button"))).filter(el => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const unswipe = isMobile() ? attachSheetSwipe(root, () => !noSwipeRef.current, () => wantsGuardRef.current(), () => tryCloseRef.current()) : null;
    return () => {
      if (unswipe) unswipe();
      document.removeEventListener("keydown", onKey, true);
      _sheetStack = _sheetStack.filter(t => t !== tok);
      root.removeEventListener("input", onEdit, true);
      root.removeEventListener("change", onEdit, true);
    };
  }, []);

  return html`<div class="overlay show" onClick=${e => { if (e.target.classList.contains("overlay")) tryClose(); }}>
    <div class=${"sheet" + (blocked ? " blocked" : "")} role="dialog" aria-modal="true" ref=${ref} style=${width ? "width:" + width + "px;max-width:calc(100vw - 32px)" : ""}>
      <div class="sheet-head"><h3>${title}</h3>${blocked ? html`<span class="blocked-tag"><${Ic} i="off"/> ${T("status|Blocked")}</span>` : null}${headExtra || null}${onBack
        ? html`<button class="sheet-back" onClick=${tryClose}><${Ic} i="back"/> ${T("Back")}</button>`
        : html`<button class="x" onClick=${tryClose}>×</button>`}</div>
      <div class="sheet-body">${children}${err ? html`<div class="formmsg err" role="alert">${err}</div>` : null}</div>
      ${(foot || discard) ? html`<div class="sheet-foot">${discard
        ? html`<${Fragment}><span class="discard-msg"><${Ic} i="warn"/> ${T("Discard unsaved changes?")}</span><span class="grow"></span>
            <button class="btn btn-ghost btn-dismiss" onClick=${() => setDiscarding(false)}>${T("Keep editing")}</button>
            <button class="btn btn-danger" onClick=${onClose}>${T("Discard")}</button></>`
        : foot}</div>` : null}
    </div></div>`;
}

export function logRendered(s) { return String(s == null ? "" : s).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "").replace(/[ \t]+$/gm, ""); }
export function logRaw(s) { return String(s == null ? "" : s).replace(/\x1b/g, "␛").replace(/\r/g, ""); }
export function LogBody({ text, raw }) {
  const t = (raw ? logRaw(text) : logRendered(text)).replace(/\n+$/, "");
  return html`<div class=${"logview" + (raw ? " raw" : "")}>${t.split("\n").map(l => html`<div class="logline">${l === "" ? " " : l}</div>`)}</div>`;
}
export function openChildOrRoot(node) { (_stack.length ? pushModal : openModal)(node); }
export function openConfirm(opts) { openChildOrRoot(html`<${ConfirmSheet} ...${opts}/>`); }

function typePrompt(word) {
  const [before, after] = Tsplit("Confirm by typing {name}", "name");
  return html`<${Fragment}>${before}<${ConfirmPhrase} phrase=${word} bold=${true}/>${after}<//>`;
}
export function ConfirmSheet({ title, body, note, log, confirmLabel, busyLabel, cancelLabel, danger, warn, onConfirm, back, requireType }) {
  back = back || closeModal;
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(false);
  const [typed, setTyped] = useState("");
  const isLog = log != null && String(log) !== "";
  const canToggle = isLog && logRaw(log) !== logRendered(log);
  const typeOk = !requireType || typed.trim() === requireType;
  const go = async () => { if (busy || !typeOk) return; if (!onConfirm) return back(); setBusy(true); const seq = _modalSeq;
    try { await onConfirm(); } finally { if (_modalSeq === seq) closeModal(); } };
  const tone = danger || warn;
  return html`<${Sheet} title=${title} onClose=${back}
    foot=${html`<${Fragment}>
      ${canToggle ? html`<button class="btn btn-ghost logtoggle" onClick=${() => setRaw(r => !r)}>${raw ? T("Display rendered") : T("Display raw")}</button>` : null}
      <span class="grow"></span>
      <button class=${"btn " + (onConfirm ? "btn-ghost btn-dismiss" : "btn-primary")} onClick=${back}>${onConfirm ? (cancelLabel || T("Cancel")) : (confirmLabel || T("Close"))}</button>
      ${onConfirm ? html`<button class=${"btn " + (danger ? "btn-danger" : "btn-primary")} disabled=${busy || !typeOk} onClick=${go}>${busy ? html`<span class="spin sm"></span>${busyLabel || T("Working…")}` : (confirmLabel || T("Confirm"))}</button>` : null}</>`}>
    ${isLog
      ? html`<${LogBody} text=${log} raw=${raw}/>`
      : html`<${Fragment}>
          <div class=${"notice" + (tone ? " warn" : "")}><${Ic} i=${tone ? "warn" : "info"}/><span>${body}</span></div>
          ${note || null}
          ${requireType ? html`<label class="confirm-type"><span>${typePrompt(requireType)}</span>
            <input class="ctype-input" type="text" autofocus spellcheck="false" autocomplete="off" placeholder=${requireType} value=${typed}
              onInput=${e => setTyped(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") go(); }}/></label>` : null}
        <//>`}
  <//>`;
}

let _qrZoomOpen = () => false;
export const setQrZoomProbe = fn => { _qrZoomOpen = fn; };

export const setModalRenderer = fn => { _setStack = fn; };
export const modalDepth = () => _stack.length;
export const clearModalStack = () => _applyStack([]);
export const blurActive = () => _blurActive();

export function orderById(items, savedOrder, idOf) {
  const ord = savedOrder || [];
  if (!ord.length) return items;
  const pos = new Map(ord.map((id, i) => [id, i]));
  return items.map((it, i) => [it, i]).sort((a, b) => {
    const pa = pos.has(idOf(a[0])) ? pos.get(idOf(a[0])) : Infinity;
    const pb = pos.has(idOf(b[0])) ? pos.get(idOf(b[0])) : Infinity;
    return pa - pb || a[1] - b[1];
  }).map(x => x[0]);
}
export const GRIP_SVG = `<svg width="11" height="16" viewBox="0 0 11 16" fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="8" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>`;
export function flipPlay(container, first) {
  requestAnimationFrame(() => {
    const moved = [];
    for (const el of container.querySelectorAll("[data-rid]")) {
      const f = first.get(el.dataset.rid); if (!f) continue;
      const l = el.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (dx || dy) { el.style.transition = "none"; el.style.transform = "translate(" + dx + "px," + dy + "px)"; moved.push(el); }
    }
    if (!moved.length) return;
    requestAnimationFrame(() => { for (const el of moved) { el.style.transition = "transform .24s cubic-bezier(.2,.7,.2,1)"; el.style.transform = ""; } });
    setTimeout(() => { for (const el of moved) { el.style.transition = ""; el.style.transform = ""; } }, 320);
  });
}
export function useReorder(ids, onReorder, axis = "x", sel = {}) {
  const CONT_SEL = sel.container || ".ifgrid, .nodegrid";
  const CARD_SEL = sel.card || ".ifcard, .ncard";
  const [drag, setDrag] = useState(null);
  const dragId = drag && drag.id;
  const prev = useRef(null);
  const off = useRef([0, 0]);
  const cont = useRef(null);
  const liveK = useRef(-1);
  const idRef = useRef(null);
  const esc = useRef(false);
  const onKey = useRef(null);
  const rest = dragId ? ids.filter(x => x !== dragId) : ids;
  const k = drag ? drag.k : -1;
  const gapL = (k > 0 && k <= rest.length) ? rest[k - 1] : null;
  const gapR = (k >= 0 && k < rest.length) ? rest[k] : null;
  const trail = axis === "y" ? " drop-b" : " drop-r";
  const lead = axis === "y" ? " drop-t" : " drop-l";
  const indexAt = (container, x, y) => {
    let i = 0;
    for (const el of container.querySelectorAll("[data-rid]")) {
      if (el.dataset.rid === dragId) continue;
      const r = el.getBoundingClientRect();
      if (axis === "y") { if (y > r.top + r.height / 2) i++; }
      else if (r.bottom < y) i++;
      else if (y >= r.top && (r.left + r.width / 2) < x) i++;
    }
    return i;
  };
  const movePrev = (x, y) => { if (prev.current) prev.current.style.transform = "translate(" + (x - off.current[0]) + "px," + (y - off.current[1]) + "px)"; };
  const stopPreview = () => { if (prev.current) { prev.current.remove(); prev.current = null; } };
  const finish = () => {
    if (onKey.current) { window.removeEventListener("keydown", onKey.current, true); onKey.current = null; }
    const c = cont.current, kk = liveK.current, did = idRef.current, cancelled = esc.current;
    stopPreview(); cont.current = null; idRef.current = null; liveK.current = -1; esc.current = false;
    setDrag(null);
    if (cancelled || kk < 0 || !c || !did) return;
    const first = new Map();
    for (const el of c.querySelectorAll("[data-rid]")) first.set(el.dataset.rid, el.getBoundingClientRect());
    const arr = ids.filter(x => x !== did); arr.splice(kk, 0, did);
    if (arr.join(" ") !== ids.join(" ")) { onReorder(arr); flipPlay(c, first); }
  };
  return {
    dragId,
    grip(id) {
      return {
        draggable: true,
        onDragStart: e => {
          cont.current = e.currentTarget.closest(CONT_SEL);
          idRef.current = id; liveK.current = -1; esc.current = false;
          onKey.current = ev => { if (ev.key === "Escape") esc.current = true; };
          window.addEventListener("keydown", onKey.current, true);
          const card = e.currentTarget.closest(CARD_SEL);
          try {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
            const empty = new Image(); empty.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            e.dataTransfer.setDragImage(empty, 0, 0);
            if (card) {
              const r = card.getBoundingClientRect();
              off.current = [e.clientX - r.left, e.clientY - r.top];
              const g = card.cloneNode(true);
              g.classList.add("drag-ghost");
              g.style.cssText = "position:fixed;left:0;top:0;margin:0;width:" + r.width + "px;height:" + r.height + "px;pointer-events:none;z-index:9999;transform:translate(" + r.left + "px," + r.top + "px)";
              document.body.appendChild(g);
              prev.current = g;
            }
          } catch (_) {}
          setDrag({ id, k: -1 });
        },
        onDrag: e => { if (e.clientX || e.clientY) movePrev(e.clientX, e.clientY); },
        onDragEnd: () => finish(),
      };
    },
    container() {
      return {
        onDragOver: e => { if (!dragId) return; e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
          movePrev(e.clientX, e.clientY);
          const nk = indexAt(e.currentTarget, e.clientX, e.clientY);
          liveK.current = nk;
          if (!drag || drag.k !== nk) setDrag({ id: dragId, k: nk }); },
        onDrop: e => { e.preventDefault(); },
      };
    },
    item(id) {
      return { rid: id, cls: (dragId === id ? " dragging" : "") + (id === gapL ? trail : "") + (id === gapR ? lead : "") };
    },
  };
}

const IFOP_BUSY_W = once(() => ({ start: T("ifop|starting"), stop: T("ifop|stopping"), restart: T("ifop|restarting"), apply: T("ifop|applying"), ignore: T("ifop|ignoring"), unignore: T("ifop|restoring") }));
const IFOP_DONE_W = once(() => ({ start: T("ifop|started"), stop: T("ifop|stopped"), restart: T("ifop|restarted"), apply: T("ifop|applied"), ignore: T("ifop|ignored"), unignore: T("ifop|restored") }));
const IFOP_FAIL_W = once(() => ({ start: T("ifop|failed to start"), stop: T("ifop|failed to stop"), restart: T("ifop|failed to restart"), apply: T("ifop|failed to apply"), ignore: T("ifop|couldn\u2019t ignore"), unignore: T("ifop|couldn\u2019t restore") }));
export const ifopBusy = verb => IFOP_BUSY_W()[verb] || verb;
export const ifopDone = verb => IFOP_DONE_W()[verb] || verb;
export const ifopFail = verb => IFOP_FAIL_W()[verb] || T("ifop|failed");
export const IFOP_PANEL = new Set(["ignore", "unignore"]);
export function opTag(key) {
  const op = Store.ifaceOp[key]; if (!op) return null;
  if (op.phase === "busy") return html`<span class="tg tg-busy"><${Ic} i="clock"/>${ifopBusy(op.verb)}</span>`;
  if (op.phase === "ok") return html`<span class="tg tg-ready"><${Ic} i="check"/>${ifopDone(op.verb)}</span>`;
  if (op.phase === "fail") return html`<${StatusTag} cls="tg-busy del" icon="warn" label=${ifopFail(op.verb)} msg=${op.err || T("the change failed on the node")} title=${T("Save failed on the node")}/>`;
  return null;
}
export const STATUS_RANK = { disabled: -1, expired: -1, blocking: -1, dangling: 0, broken: 0, blocked: 1, faulty: 1, partial: 1, pending: 2, creating: 2, rotating: 2, restoring: 2, expiring: 4, unknown: 3, unassigned: 4, online: 5, ready: 6 };
export const STATUS_ICON = { online: "check", ready: "clock", partial: "warn", pending: "clock", creating: "clock", rotating: "refresh",
  blocked: "warn", faulty: "warn", dangling: "err", broken: "warn", unknown: "info", unassigned: "user", orphan: "link", removing: "trash", empty: "info",
  disabled: "off", blocking: "off", restoring: "refresh", expired: "warn", expiring: "warn" };

const PROC_LABEL = once(() => ({
  reinstalling: T("re-installing"), "converting-bare": T("converting to bare-metal"), "converting-docker": T("converting to docker"), updating: T("updating"), uninstalling: T("uninstalling"),
  reinstalled: T("re-installed"), "reinstalled-updated": T("re-installed and updated"), "converted-bare": T("converted to bare-metal"), "converted-docker": T("converted to docker"), updated: T("updated"), uptodate: T("up to date"),
  "reinstall-aborted": T("re-install aborted"), "convert-aborted": T("convert aborted"), "update-aborted": T("update aborted"), "uninstall-aborted": T("uninstall aborted"),
  "reinstall-failed": T("re-install failed"), "convert-failed": T("convert failed"), "update-failed": T("update failed"), "uninstall-failed": T("uninstall failed"), "adopt-failed": T("take-over failed"), "adopted-container": T("took over a container's interface"), "adopt-container-failed": T("container take-over failed"), failed: T("proc|failed") }));
const PROC_LABEL_FRESH = once(() => ({ reinstalling: T("installing"), reinstalled: T("installed"), "reinstalled-updated": T("installed and updated"),
  "reinstall-aborted": T("install aborted"), "reinstall-failed": T("install failed") }));
export const procLabel = (state, fresh) => (fresh && PROC_LABEL_FRESH()[state]) || PROC_LABEL()[state] || state;
export const procFailed  = s => !!s && /failed$/.test(s);
export const procAborted = s => !!s && /aborted$/.test(s);
export const procSuccess = s => s === "reinstalled" || s === "reinstalled-updated" || s === "converted-bare" || s === "converted-docker" || s === "updated" || s === "uptodate" || s === "adopted-container";
export const isUpdateState = s => s === "updating" || s === "updated" || s === "update-failed" || s === "update-aborted" || s === "uptodate";
export const inProc      = s => !!s && !procFailed(s) && !procAborted(s) && !procSuccess(s);
export const procInClass = s => s === "uninstalling" ? "procuninstall" : (s || "").startsWith("converting") ? "procconvert" : "procbusy";
export const procErr = rec => (rec && rec.proc_err_key)
  ? T(rec.proc_err_key, srvVars(rec.proc_err_vars))
  : ((rec && rec.proc_err) || null);

export function procTag(state, onX, err, fresh) {
  const lbl = procLabel(state, fresh);
  if (procSuccess(state)) return err
    ? html`<span class="nstat procok tg-click" title=${T("What happened")}
        onClick=${e => { e.stopPropagation(); e.preventDefault(); openConfirm({ title: lbl, log: err, confirmLabel: T("Close") }); }}><${Ic} i="check"/> ${lbl}</span>`
    : html`<span class="nstat procok"><${Ic} i="check"/> ${lbl}</span>`;
  const xbtn = onX ? html`<button class="xbtn" title=${T("Dismiss — show the node's actual status")} onClick=${e => { e.stopPropagation(); e.preventDefault(); onX(e); }}><${Ic} i="x"/></button>` : null;
  if (procAborted(state)) return html`<span class="nstat procaborted"><${Ic} i="info"/> ${lbl}${xbtn}</span>`;
  if (procFailed(state)) {
    const open = err ? (e => { e.stopPropagation(); e.preventDefault(); openConfirm({ title: lbl, log: err, confirmLabel: T("Close") }); }) : null;
    return html`<span class=${"nstat procfail" + (open ? " tg-click" : "")} onClick=${open}><${Ic} i="warn"/> ${lbl}${xbtn}</span>`;
  }
  return html`<span class=${"nstat " + procInClass(state)}><${Ic} i="clock"/> ${lbl}</span>`;
}
export function dismissNodeProc(id) {
  const n = (Store.nodes || []).find(x => x.id === id);
  if (n) { n.proc_status = null; n.proc_err = null; bus.emit(); }
  api.procClearNode(id).then(r => { if (r && r.ok === false) { toast(srvText(r) || T("Couldn't dismiss."), "err"); Store.poll(); } });
}
export function dismissHostProc() {
  Store.hostProc = null; Store.hostProcErr = null; bus.emit();
  api.procClearHost().then(r => { if (r && r.ok === false) { toast(srvText(r) || T("Couldn't dismiss."), "err"); Store.poll(); } });
}
export function Badge({ s, title }) {
  const ic = STATUS_ICON[s];
  if (s === "online") return html`<span class="badge b-online" title=${title || ""}><span class="sdot"></span>${statusLabel(s)}</span>`;
  return html`<span class=${"badge b-" + s + (ic ? " ic" : "")} title=${title || ""}>${ic ? html`<${Ic} i=${ic}/>` : null}${statusLabel(s)}</span>`;
}
export function lifecycleIcon(it, st) {
  if (!it) return null;
  st = st || it.status;
  if (it.disabled && st !== "disabled") return html`<span class="lc-ic lc-blocked" title=${T("status|Blocked")}><${Ic} i="off"/></span>`;
  if (it.expired && st !== "expired") return html`<span class="lc-ic lc-expired" title=${T("Access expired")}><${Ic} i="warn"/></span>`;
  if (it.expiring && st !== "expiring") return html`<span class="lc-ic lc-expiring" title=${T("About to expire")}><${Ic} i="warn"/></span>`;
  return null;
}

export function turnProxyTitle(node, service) {
  const tp = ((Store.stats[node] || {}).turn_proxies || []).find(x => x && x.service === service);
  return (tp && tp.title) || "";
}
export function gridIfaceTag(t) {
  return html`<${Tag} kind=${targetType(t)} label=${t.iface} muted=${!t.online} gen3=${tgt3(t)}/>`;
}
const STATUS_REASONS = once(() => ({
  blocked: blockedReason(null),
  broken: T("the interface is up but this peer's IP is outside its subnet — the record needs correcting, not the interface"),
  disabled: T("access is blocked — removed from every server until unblocked"),
  expired: T("the access date has passed — removed from every server until the date is extended"),
  expiring: T("the access date is coming up — will be removed from every server when it passes"),
}));
export const statusReason = s => STATUS_REASONS()[s] || "";
export function protoLabel(type) { return type === "awg" ? "AmneziaWG" : type === "wg" ? "WireGuard" : T("WireGuard or AmneziaWG"); }
export function blockedReason(type) { return T("reaching the server but the handshake never completes — likely DPI / MTU / wrong {proto} params", { proto: protoLabel(type) }); }
export function churnReason() { return T("the tunnel keeps collapsing and being rebuilt — the session won't hold, which is what a filtered or DPI'd connection looks like"); }
export function uncatPop(trigger) {
  return html`<${Popover} hoverOnly flipFit cls="turnwrap" popCls="uncatpop" trigger=${trigger}>
    <div class="onpop-h" style="color:var(--partial)">${T("hdr|Encrypted DNS")}</div>
    <div class="onrow hrow"><span class="on-name">${T("This client resolves names over encrypted DNS, which the node can't see, so its hostname rules don't match and those sites leave by this node — rules by IP still route. Switch the client to plain DNS, move this node to an SNI mode, or turn on the interface's DoH / DoT / DoQ block.")}</span></div>
  <//>`;
}

export function gridStatusBadge(t, p, re) {
  const st = t.status || p.status;
  const reason = (t.down ? T("Interface {iface} is down — {why}", { iface: t.iface, why: t.down })
    : st === "blocked" ? (t.fault === "churn" ? churnReason() : blockedReason(t.type))
    : (p.reason || statusReason(st))) || "";
  if (peerUncategorised(t) && !re && st !== "blocked" && st !== "faulty") {
    return uncatPop(html`<span class="badge b-uncat ic"><${Ic} i="warn"/>${statusLabel(st)}</span>`);
  }
  const kv = t.online && !t.viaTurn && !re ? keylessVia(t) : null;
  if (t.online && (t.viaTurn || (kv && kv.fork))) {
    const tf = kv ? kv.fork : turnFork(t.viaTurn), tn = kv ? kv.label : forkLabel(tf), tc = turnColor(tf);
    const ptitle = kv ? "" : turnProxyTitle(t.node, t.viaTurn);
    return html`<span class="turnwrap" title="">
      <span class="badge b-turn" style=${"--tfc:" + tc}><span class="sdot"></span>${statusLabel(st)}</span>
      <span class="turnbub">${T("Connected via")} <span class="tg tg-turn" style=${"--tfc:" + tc}>${tn}</span>${ptitle ? html` <b class="turnbub-t">${ptitle}</b>` : null}</span></span>`;
  }
  if (re) {
    return html`<span class="turnwrap" title="">
      <${Badge} s=${st}/>
      <span class="turnbub statusbub err"><span class="statusbub-h" style="color:var(--dangling)"><${Ic} i="err"/>${T("Error")}</span>${re.msg}</span></span>`;
  }
  if ((st === "blocked" || st === "faulty") && reason) {
    const bc = "var(--fault)";
    return html`<span class="turnwrap" title="">
      <${Badge} s=${st}/>
      <span class="turnbub statusbub"><span class="statusbub-h" style=${"color:" + bc}><${Ic} i="warn"/>${statusLabel(st)}</span>${reason}</span></span>`;
  }
  return html`<${Badge} s=${st} title=${reason}/>`;
}
export function badgeWithReason(st, reason) {
  reason = reason || statusReason(st);
  if ((st === "blocked" || st === "faulty") && reason) {
    return html`<span class="turnwrap" title=""><${Badge} s=${st}/>
      <span class="turnbub statusbub"><span class="statusbub-h" style="color:var(--fault)"><${Ic} i="warn"/>${statusLabel(st)}</span>${reason}</span></span>`;
  }
  return html`<${Badge} s=${st} title=${reason}/>`;
}
function keylessVia(t) {
  const k = t.type;
  if (k !== "csqtt" && k !== "wdtt") return null;
  const r = ((Store.stats[t.node] || {})[k] || []).find(x => x && x.iface === t.iface);
  const fork = r ? (r.fork || (k === "csqtt" ? "csqtt" : "amurcanov")) : null, line = r && k === "csqtt" ? (r.line || CSQTT_DEFAULT_LINE) : "";
  return { fork, label: fork ? forkLabel(fork) + (line ? " " + line : "") : null };
}
export const dlul = (rx, tx) => ((Store.panelSettings || {}).throughput_perspective === "peers") ? [tx || 0, rx || 0] : [rx || 0, tx || 0];
export const rateUnits = () => ((Store.panelSettings || {}).throughput_units === "bits" ? "bits" : "bytes");
export const rate = bps => rateIn(bps, rateUnits());
export const niceScaleCeil = bps => niceScaleCeilIn(bps, rateUnits());
export function rateCell(rx, tx) {
  const live = (rx || 0) + (tx || 0) > 0; const [d, u] = dlul(rx, tx);
  return html`<span class=${"ratecell" + (live ? " live" : "")}>↓ ${rate(d)} <span class="up">↑ ${rate(u)}</span></span>`;
}
export function xferCell(db, ub) {
  const has = (db || 0) + (ub || 0) > 0;
  return html`<span class=${"addr xfer" + (has ? " live" : "")}>↓ ${fmtBytes(db)} <span class="up">↑ ${fmtBytes(ub)}</span></span>`;
}

export function DepBadge({ others }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null), popRef = useRef(null);
  const closeT = useRef(null);
  const show = open || pinned;
  const cancelClose = () => clearTimeout(closeT.current);
  const scheduleClose = () => { cancelClose(); closeT.current = setTimeout(() => setOpen(false), 140); };
  const place = () => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); setPos({ left: Math.round(r.left), top: Math.round(r.bottom + 6) }); };
  const rows = others.map(d => html`<div class="deprow" key=${tkey(d.node, d.iface)}>
        <span class="dep-name" style=${"color:" + (Store.nodeColor(d.node) || "var(--ink)")}>${Store.nodeName(d.node)}</span>
        <${Tag} kind=${targetType(d)} label=${d.iface} muted=${!d.online} gen3=${tgt3(d)}/>
        <span class="dep-ip addr">${d.ip || "—"}</span></div>`);
  if (isMobile()) return html`<span class="depmore" role="button" onClick=${e => { e.stopPropagation(); e.preventDefault();
      (_stack.length ? pushModal : openModal)(html`<${Sheet} title=${T("Other interfaces of this peer")} noGuard=${true}
        foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}><div class="m-deplist">${rows}</div><//>`); }}>+${others.length}</span>`;
  useEffect(() => {
    if (!show) return; place();
    const onMove = () => place();
    const onDoc = e => { const t = e.target;
      if ((ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t))) return;
      setPinned(false); setOpen(false);
      const eat = e2 => { e2.stopPropagation(); e2.preventDefault(); };
      document.addEventListener("click", eat, true);
      setTimeout(() => document.removeEventListener("click", eat, true), 350);
    };
    window.addEventListener("scroll", onMove, true); window.addEventListener("resize", onMove);
    if (pinned) document.addEventListener("pointerdown", onDoc, true);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); document.removeEventListener("pointerdown", onDoc, true); };
  }, [show, pinned]);
  useEffect(() => () => clearTimeout(closeT.current), []);
  useNoNativeTitle(ref, show);
  return html`<span class=${"depmore" + (show ? " on" : "")} ref=${ref}
    onClick=${e => { e.stopPropagation(); setPinned(p => !p); }}
    onMouseEnter=${() => { cancelClose(); setOpen(true); }} onMouseLeave=${scheduleClose}>+${others.length}
    ${show && pos ? html`<${Portal}><div class="deppop" ref=${popRef} style=${"left:" + pos.left + "px;top:" + pos.top + "px"}
      onClick=${e => e.stopPropagation()} onMouseEnter=${cancelClose} onMouseLeave=${scheduleClose}>
      ${rows}
    </div><//>` : null}
  </span>`;
}

export function CmdErr({ err, cls, title }) {
  if (!err) return null;
  return html`<span class=${"cmderr" + (cls ? " " + cls : "")} onClick=${e => { e.stopPropagation(); openConfirm({ title: title || T("Command failed on the node"), log: err, confirmLabel: T("Close") }); }}><${Ic} i="info"/></span>`;
}
export function StatusTag({ cls, icon, label, msg, title }) {
  const ic = icon ? html`<${Ic} i=${icon}/>` : null;
  if (!msg) return html`<span class=${cls} title=${title || ""}>${ic}${label}</span>`;
  return html`<span class=${cls + " tg-click"}
    onClick=${e => { e.preventDefault(); e.stopPropagation(); openConfirm({ title: title || T("Details"), log: msg, confirmLabel: T("Close") }); }}>${ic}${label}</span>`;
}

export const Switch = ({ on, onChange, title, disabled }) => html`<label class=${"swt" + (disabled ? " swt-off" : "")} title=${title || ""}>
  <input type="checkbox" checked=${!!on} disabled=${!!disabled} onChange=${e => onChange(e.target.checked)}/><span class="track"></span><span class="knob"></span></label>`;
export function usePopup({ keep = null, drop = "auto", onClose, disabled = false, rows = ".ddopt:not(:disabled)", minBelow = 240, clampW = 0, search = null } = {}) {
  const [open, setOpen] = useState(false), [pos, setPos] = useState(null);
  const ref = useRef(null), popRef = useRef(null);
  const kbd = useRef(null);
  const typed = useRef({ s: "", t: 0 });
  const wasOpen = useRef(false);
  useEffect(() => { if (wasOpen.current && !open && onClose) onClose(); wasOpen.current = open; }, [open]);
  const inside = t => !!t && ((ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t)) || !!(keep && keep(t)));
  const place = () => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const flip = drop === "up" ? true : (below < minBelow && above > below);
    setPos({ left: Math.round(clampW ? Math.max(8, Math.min(r.left, window.innerWidth - clampW - 8)) : r.left),
             top: Math.round(flip ? r.top - 4 : r.bottom + 4), width: Math.round(r.width), flip,
             maxh: Math.max(180, Math.round(flip ? above : below) - 16) }); };
  const shut = () => { setOpen(false); setPos(null); };
  const close = back => { shut(); kbd.current = null;
    if (back && ref.current) { const b = ref.current.querySelector("button"); if (b) b.focus(); } };
  const rowEls = () => (popRef.current ? [...popRef.current.querySelectorAll(rows)] : []);
  const focusAt = el => { if (!el) return; el.focus(); el.scrollIntoView({ block: "nearest" }); };
  const moveTo = i => { const els = rowEls(); if (els.length) focusAt(els[Math.max(0, Math.min(els.length - 1, i))]); };
  const moveBy = d => { const els = rowEls(); const i = els.indexOf(document.activeElement);
    moveTo(i < 0 ? (d > 0 ? 0 : els.length - 1) : i + d); };
  const typeAhead = ch => {
    const now = Date.now();
    typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : "") + ch.toLowerCase(), t: now };
    const els = rowEls(), q = typed.current.s;
    const from = Math.max(0, els.indexOf(document.activeElement));
    const order = q.length === 1 ? [...els.slice(from + 1), ...els.slice(0, from + 1)] : els;
    focusAt(order.find(el => (el.textContent || "").trim().toLowerCase().startsWith(q)));
  };
  useEffect(() => { if (!open) return; place();
    const onMove = e => { const t = e && e.target;
      if (t && t !== document && t.contains && ref.current && !t.contains(ref.current)) return; place(); };
    const onDoc = e => { if (!inside(e.target)) shut(); };
    const onFocus = e => { if (!inside(e.target)) shut(); };
    const onKey = e => { if (e.key !== "Escape" || e.isComposing) return; const t = e.target;
      const ours = !t || t === document.body || t === document.documentElement
        || (ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t));
      if (ours) { e.preventDefault(); close(true); } else if (keep && keep(t)) close(false); };
    window.addEventListener("scroll", onMove, true); window.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onDoc, true); document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", onDoc, true); document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus, true); };
  }, [open, drop]);
  useEffect(() => { if (!open || !pos || !search || !popRef.current || isMobile()) return;
    const s = popRef.current.querySelector(search); if (s) { kbd.current = null; s.focus(); } }, [open, !!pos]);
  useEffect(() => {
    if (!open || !pos || !kbd.current) return;
    const els = rowEls(); const at = kbd.current; kbd.current = null;
    if (els.length) focusAt(els.find(el => el.classList.contains("sel")) || els[at === "last" ? els.length - 1 : 0]);
  }, [open, !!pos]);
  const onPopKey = e => {
    const k = e.key, t = e.target, inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    if (e.isComposing) return;
    if (k === "Tab") { shut(); return; }
    if (k === "ArrowDown") { e.preventDefault(); moveBy(1); return; }
    if (k === "ArrowUp") { e.preventDefault(); moveBy(-1); return; }
    if (inField) return;
    if (k === "Home") { e.preventDefault(); moveTo(0); return; }
    if (k === "End") { e.preventDefault(); moveTo(1e9); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(k)) {
      const s = search && popRef.current && popRef.current.querySelector(search);
      if (s) { s.focus(); return; }
      e.preventDefault(); typeAhead(k); }
  };
  const onBtnKey = e => {
    if (disabled || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const at = e.key === "ArrowUp" ? "last" : "first";
    if (open) { const els = rowEls(); if (els.length) focusAt(els.find(el => el.classList.contains("sel")) || els[at === "last" ? els.length - 1 : 0]); return; }
    kbd.current = at; setOpen(true);
  };
  const toggle = e => { if (disabled) return; const willOpen = !open; kbd.current = willOpen && e && e.detail === 0 ? "first" : null;
    if (willOpen) setOpen(true); else shut(); };
  return { open, setOpen, pos, ref, popRef, close, toggle, onBtnKey, onPopKey };
}

export function Dropdown({ value, onChange, options, className, placeholder, disabled, short, ariaLabel, title, onClose, closeRef, keep = null, drop = "auto" }) {
  const P = usePopup({ keep, drop, onClose, disabled });
  const flat = (options || []).flatMap(o => o.items ? o.items : [o]);
  const cur = flat.find(o => String(o.value) === String(value));
  const curLabel = cur ? (short ? short(cur.label) : cur.label) : (placeholder || "");
  if (closeRef) closeRef.current = () => P.close(false);
  const opt = o => {
    const sel = String(o.value) === String(value);
    const btn = html`<button type="button" role="option" aria-selected=${sel ? "true" : "false"}
      disabled=${o.disabled} title=${o.title || ""} aria-disabled=${o.refuse ? "true" : undefined}
      class=${"ddopt" + (sel ? " sel" : "") + (o.disabled ? " off" : "") + (o.className ? " " + o.className : "")}
      onClick=${() => { if (o.disabled) return;
        if (o.refuse) return toast(o.refuse, "info");
        onChange(o.value); P.close(true); }}>${o.label}</button>`;
    return o.extra ? html`<div class=${"ddrow" + (sel ? " sel" : "")}>${btn}<span class="ddx">${o.extra}</span></div>` : btn;
  };
  return html`<div class=${"dropdown " + (className || "")} ref=${P.ref}>
    <button type="button" class=${"ddbtn" + (P.open ? " on" : "")} disabled=${disabled}
      aria-haspopup="listbox" aria-expanded=${P.open ? "true" : "false"} aria-label=${ariaLabel || ""}
      title=${title || ""} onKeyDown=${P.onBtnKey} onClick=${P.toggle}>
      <span class="ddlbl">${curLabel}</span><span class="catpick-caret">▾</span></button>
    ${P.open && P.pos ? html`<${Portal}><div ref=${P.popRef} role="listbox" tabindex="-1"
        onKeyDown=${P.onPopKey}
        class=${"ddpop" + (P.pos.flip ? " flip" : "")} style=${"left:" + P.pos.left + "px;top:" + P.pos.top + "px;min-width:" + P.pos.width + "px;--ddmaxh:" + P.pos.maxh + "px"}>
      ${(options || []).map(o => o.items
        ? html`<div role="group" aria-label=${o.group}><div class="ddgrp">${o.group}</div>${o.items.map(opt)}</div>`
        : opt(o))}
    </div><//>` : null}
  </div>`;
}
export const autoGrow = el => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
export function Disclosure({ title, summary, sumCls, open, onToggle, children }) {
  return html`<${Fragment}>
    <button type="button" class=${"disc" + (open ? " open" : "")} onClick=${onToggle}>
      <span class="disc-car">▸</span><span class="disc-t">${title}</span>
      ${summary != null ? html`<span class=${"disc-sum" + (sumCls ? " " + sumCls : "")}>${summary}</span>` : null}
    </button>
    ${open ? html`<div class="disc-body">${children}</div>` : null}
  <//>`;
}

export const LIST_PAGE = 15;
export const pageSlice = (list, page) => list.slice((page - 1) * LIST_PAGE, page * LIST_PAGE);
export function ListPager({ page, setPage, total }) {
  if (total <= LIST_PAGE) return null;
  const pages = Math.ceil(total / LIST_PAGE);
  return html`<div class="pager netpager">
    <span class="pager-info">${T("{from}–{to} of {total}", { from: (page - 1) * LIST_PAGE + 1, to: Math.min(page * LIST_PAGE, total), total })}</span>
    <button type="button" class="btn btn-ghost" disabled=${page <= 1} onClick=${() => setPage(page - 1)}>${T("‹ Prev")}</button>
    <span class="pager-pg">${page} / ${pages}</span>
    <button type="button" class="btn btn-ghost" disabled=${page >= pages} onClick=${() => setPage(page + 1)}>${T("Next ›")}</button>
  </div>`;
}

export const capShown = (n, cap) => (n <= cap + 1 ? n : cap);
export function useCapped(items, cap = 6) {
  const [all, setAll] = useState(false);
  const list = items || [], n = list.length;
  const shown = all ? n : capShown(n, cap);
  const btn = (label, v) => html`<button type="button" class="bub-more" onClick=${e => { e.stopPropagation(); setAll(v); }}>${label}</button>`;
  return [list.slice(0, shown), n > shown ? btn(T("+{v1} more", { v1: n - shown }), true) : (all && n > cap + 1 ? btn(T("show fewer"), false) : null)];
}
export function CapList({ items, cap = 6, row }) {
  const [shown, more] = useCapped(items, cap);
  return html`<${Fragment}>${shown.map(row)}${more}<//>`;
}

export function IpPicker({ ips, sel, setSel, custom, setCustom, placeholder }) {
  return html`<${Fragment}>
    <${Dropdown} value=${sel} onChange=${v => setSel(v)} options=${[
      ...(ips || []).filter(ip => !isPrivIp(ip)).map(ip => ({ value: ip, label: ip })),
      { value: "__custom__", label: T("Custom IP / Host…") }]}/>
    ${sel === "__custom__" ? html`<input style="margin-top:6px" value=${custom} onInput=${e => setCustom(e.target.value)} placeholder=${placeholder || "203.0.113.7"} autocomplete="off"/>` : null}
  <//>`;
}

export function trackIfaceOps() {
  const now = Date.now();
  for (const key of Object.keys(Store.ifaceOp)) {
    const op = Store.ifaceOp[key];
    if (op.phase !== "busy") { if (op.until && now > op.until) delete Store.ifaceOp[key]; continue; }
    if (IFOP_PANEL.has(op.verb)) continue;
    const cut = key.indexOf("|"); const node = key.slice(0, cut), iface = key.slice(cut + 1);
    const nrec = (Store.nodes || []).find(n => n.id === node) || {};
    const _snap = Store.stats[node] || {};
    const _wSnap = (_snap.wdtt || []).find(w => w && w.iface === iface) || (_snap.csqtt || []).find(c => c && c.iface === iface);
    const istate = _wSnap
      ? { down: _wSnap.active !== "active" && !_wSnap.stopped, stopped: !!_wSnap.stopped }
      : (((Store.stats[node] || {}).interfaces || {})[iface] || {});
    const down = !!istate.down, stopped = !!istate.stopped, notup = down || stopped;
    const cerr = (nrec.cmd_errors || {})[iface];
    const starting = (nrec.starting || []).includes(iface);
    const stopping = (nrec.stopping || []).includes(iface);
    const restarting = (nrec.restarting || []).includes(iface);
    let done = null;
    if (op.verb === "apply") {
      if (cerr && now - op.started > 4000) done = { phase: "fail", err: cerr };
      else if (now - op.started > 6000) done = { phase: "ok" };
    } else if (_wSnap && (op.verb === "start" || op.verb === "stop")) {
      const there = op.verb === "start" ? !notup : notup;
      if (there) done = { phase: "ok" };
      else if (cerr && now - op.started > 4000) done = { phase: "fail", err: cerr };
      else if (now - op.started > 60000) done = { phase: "fail", err: cerr || T("timed out") };
    } else if (op.verb === "start") {
      if (!notup) done = { phase: "ok" };
      else if (cerr && now - op.started > 4000) done = { phase: "fail", err: cerr };
      else if (!starting && now - op.started > 8000) done = { phase: "fail", err: cerr || T("the interface didn't come up") };
      else if (now - op.started > 20000) done = { phase: "fail", err: cerr || T("timed out") };
    } else if (op.verb === "stop") {
      if (notup) done = { phase: "ok" };
      else if (cerr && now - op.started > 4000) done = { phase: "fail", err: cerr };
      else if (!stopping && now - op.started > 8000) done = { phase: "fail", err: cerr || T("the interface didn't stop") };
      else if (now - op.started > 20000) done = { phase: "fail", err: cerr || T("timed out") };
    } else {
      if (down && cerr) done = { phase: "fail", err: cerr };
      else if (!restarting && now - op.started > 6000) done = down ? { phase: "fail", err: cerr || T("didn't come back up") } : { phase: "ok" };
      else if (now - op.started > 18000) done = down ? { phase: "fail", err: cerr || T("didn't come back up") } : { phase: "ok" };
    }
    if (done) {
      const ms = done.phase === "ok" ? 5000 : 10000;
      Store.ifaceOp[key] = { verb: op.verb, phase: done.phase, until: now + ms, err: done.err || "" };
      setTimeout(() => Store.apply(), 0);
      setTimeout(() => Store.apply(), ms + 100);
    }
  }
}

export async function startOrRestartWdtt(node, iface, verb) {
  const key = node + "|" + iface;
  Store.ifaceOp[key] = { verb, phase: "busy", started: Date.now() }; Store.apply();
  const body = { node, iface };
  if (verb === "stop") body.stopped = true;
  else if (verb === "start") body.stopped = false;
  else body.restart = Date.now();
  const r = await api.wdttSet(body);
  if (!r.ok) {
    Store.ifaceOp[key] = { verb, phase: "fail", until: Date.now() + 10000, err: srvText(r) || T("request failed") };
    Store.apply(); setTimeout(() => Store.apply(), 10100); return;
  }
  await Store.poll();
}

export async function startOrRestartCsqtt(node, iface, verb) {
  const key = node + "|" + iface;
  Store.ifaceOp[key] = { verb, phase: "busy", started: Date.now() }; Store.apply();
  const body = { node, iface };
  if (verb === "stop") body.stopped = true;
  else if (verb === "start") body.stopped = false;
  else body.restart = Date.now();
  const r = await api.csqttSet(body);
  if (!r.ok) {
    Store.ifaceOp[key] = { verb, phase: "fail", until: Date.now() + 10000, err: srvText(r) || T("request failed") };
    Store.apply(); setTimeout(() => Store.apply(), 10100); return;
  }
  await Store.poll();
}

export function RowError({ k }) {
  const e = rowError(k);
  if (!e) return null;
  return html`<span class="rowerr" title=${e.msg}><${Ic} i="err"/> ${e.msg}<button class="rowerr-x" onClick=${() => dismissError(k)}>×</button></span>`;
}

const _resolveCache = new Map();
export function useHostOnNode(host, ips) {
  const [state, setState] = useState("");
  useEffect(() => {
    const h = String(host || "").trim().toLowerCase().replace(/\.$/, "");
    const have = (ips || []).filter(Boolean);
    if (!h) { setState(""); return; }
    if (!have.length) { setState(""); return; }
    if (/^[\d.]+$/.test(h) || h.includes(":")) {
      setState(have.includes(h) || ["0.0.0.0", "::", "*"].includes(h) ? "ok" : "bad");
      return;
    }
    if (_resolveCache.has(h)) {
      const got = _resolveCache.get(h);
      setState(got.some(ip => have.includes(ip)) ? "ok" : "bad");
      return;
    }
    setState("checking");
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.resolveHost(h);
        const got = ((r && r.data && r.data.ips) || []);
        _resolveCache.set(h, got);
        if (!dead) setState(got.some(ip => have.includes(ip)) ? "ok" : "bad");
      } catch (_) { if (!dead) setState(""); }
    }, 450);
    return () => { dead = true; clearTimeout(t); };
  }, [String(host || ""), (ips || []).join(",")]);
  return state;
}

const _exitCache = new Map();
const _EXIT_TTL_MS = 15000;
export function useExitDeviceOnNode(node, dev, iface) {
  const [v, setV] = useState({ state: "", why: "", up: null, bootPersist: null });
  useEffect(() => {
    const d = String(dev || "").trim();
    if (!node || !d) { setV({ state: "", why: "", up: null, bootPersist: null }); return; }
    const key = node + "|" + d + "|" + (iface || "");
    const shape = r => {
      const k = r.known, why = r.why_not || "";
      if (why) return { state: "bad", why, up: r.up, bootPersist: r.boot_persist };
      if (k === true) return { state: "ok", why: "", up: r.up, bootPersist: r.boot_persist };
      if (k === false) return { state: "bad", why: "", up: null, bootPersist: null };
      return { state: "", why: "", up: null, bootPersist: null };
    };
    const hit = _exitCache.get(key);
    if (hit && (Date.now() - hit.at) < _EXIT_TTL_MS) { setV(shape(hit.d)); return; }
    setV({ state: "checking", why: "", up: null, bootPersist: null });
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.exitCheck(node, d, iface);
        const data = (r && r.data) || null;
        if (!data) { if (!dead) setV({ state: "", why: "", up: null, bootPersist: null }); return; }
        if (data.why_not || data.known !== null) _exitCache.set(key, { at: Date.now(), d: data });
        if (!dead) setV(shape(data));
      } catch (_) { if (!dead) setV({ state: "", why: "", up: null, bootPersist: null }); }
    }, 450);
    return () => { dead = true; clearTimeout(t); };
  }, [node, String(dev || ""), iface || ""]);
  return v;
}

export const exitRefusalSentences = (value) => ({

    self: T("An interface can't exit through itself."),
    mesh: T("That's a mesh link — send traffic there with “Forward to node”, which sets up the return path too."),
    managed: T("That's an interface this node serves clients on, not a way out of it."),
    ingress: T("That's a server device clients arrive on, not a way out."),
    loopback: T("Loopback isn't a way out of this node."),
    name: T("Not a usable device name — up to 15 characters: letters, digits, dot, dash or underscore."),
    imported: T("This node already runs that device for one of its own exits — pick that exit instead."),
    nic: T("This node hasn't said which of its network cards have a gateway yet. Update the node, and a card that has one can be used as an exit."),
    nic_nogw: T("This node reports no gateway for {v1}, so there's no way off the box through it. Give it a default route on the node, or set the gateway on the exit under Settings → Network.", { v1: value }),
    nic_wan: T("That's already where this node's traffic leaves, so choosing it would change nothing — and it would report no traffic of its own. Leave the outbound interface on Auto instead."),
});

export const exitRefusalText = (code, device) =>
  (code ? (exitRefusalSentences(device || "")[String(code)] || "") : "");

export function ExitDevicePick({ node, value, onChange, iface, disabled, placeholder, onVerdict }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cands = nrec.exit_candidates || [];
  const offer = cands.filter(c => c && c.offerable).map(c => c.name);
  const valIsCustom = !!value && !offer.includes(value);
  const [custom, setCustom] = useState(valIsCustom);
  const showCustom = custom || valIsCustom;
  const sel = showCustom ? "__custom__" : (value || "");
  const st = useExitDeviceOnNode(node, showCustom ? value : "", iface);
  const WHY = () => exitRefusalSentences(value);
  const msg = st.state !== "bad" ? ""
    : (WHY()[st.why] || T("This node doesn't report a device by that name."));
  useEffect(() => { if (onVerdict) onVerdict(msg); return () => { if (onVerdict) onVerdict(""); }; }, [msg]);
  return html`<${Fragment}>
    <${Dropdown} value=${sel} onChange=${v => { if (v === "__custom__") setCustom(true); else { setCustom(false); onChange(v); } }}
      disabled=${disabled} options=${[
        ...(offer.length ? (value ? [] : [{ value: "", label: T("val|Choose a device…") }])
                         : [{ value: "", label: T("val|No device reported") }]),
        ...offer.map(n => ({ value: n, label: n })),
        { value: "__custom__", label: T("Use custom…") }]}/>
    ${showCustom ? html`<input class="ipk-custom" placeholder=${placeholder || T("Device name — e.g. wgcf")}
        value=${value || ""} onInput=${e => onChange(e.target.value)} disabled=${disabled}
        spellcheck="false" autocomplete="off"/>` : null}
    ${msg ? html`<div class="hint err">${msg}</div>` : null}
    ${!offer.length && !showCustom
      ? html`<div class="hint">${T("This node isn't dialling out anywhere yet, so there's nothing to offer. Register with WARP or paste a profile instead — or type a device name if you run one.")}</div>` : null}
    ${st.state === "ok" && st.up === false
      ? html`<div class="hint">${T("This device exists but is down right now — traffic will fall through until it comes back.")}</div>` : null}
    ${st.state === "ok" && st.bootPersist === false
      ? html`<div class="hint">${T("This device isn't set to come back after a reboot.")}</div>` : null}
  <//>`;
}

export function NodeIpPick({ ips, value, onChange, auto, customPlaceholder, disabled }) {
  const pub = (ips || []).filter(ip => !isPrivIp(ip) && !["0.0.0.0", "::", "*"].includes(ip));
  const valIsCustom = !!value && !pub.includes(value);
  const [custom, setCustom] = useState(valIsCustom);
  const sel = (custom || valIsCustom) ? "__custom__" : (value || "");
  const onSel = v => { if (v === "__custom__") setCustom(true); else { setCustom(false); onChange(v); } };
  return html`<${Fragment}>
    <${Dropdown} value=${sel} onChange=${onSel} disabled=${disabled} options=${[
      { value: "", label: auto },
      ...pub.map(ip => ({ value: ip, label: ip })),
      { value: "__custom__", label: T("Use custom…") }]}/>
    ${sel === "__custom__" ? html`<input class="ipk-custom" placeholder=${customPlaceholder || T("Custom IP — e.g. 203.0.113.5")} value=${value || ""} onInput=${e => onChange(e.target.value)} disabled=${disabled} spellcheck="false" autocomplete="off"/>` : null}
  </${Fragment}>`;
}

export function exitEgressState(discovered, addrs, value, custom) {
  const val = String(value || "").trim();
  const known = (addrs || []).includes(val);
  return { val, known,
    sel: known ? val : ((custom || val) ? "__custom__" : ""),
    options: [{ value: "", label: discovered ? T("Auto ({v1})", { v1: discovered }) : T("val|Auto") },
              ...(addrs || []).map(a => ({ value: a, label: a })),
              { value: "__custom__", label: T("Use custom…") }] };
}

export function ExitEgressPick({ discovered, value, onChange, onCommit, disabled, addrs }) {
  const [custom, setCustom] = useState(!!String(value || "").trim());
  const { val, sel, options } = exitEgressState(discovered, addrs, value, custom);
  const done = v => { if (onCommit) onCommit(v); };
  const inRef = useRef(null), grab = useRef(false);
  useEffect(() => { if (grab.current && inRef.current) { grab.current = false; inRef.current.focus(); } }, [custom]);
  const onSel = v => { if (v === "__custom__") { grab.current = true; setCustom(true); }
                       else { setCustom(false); onChange(v); done(v); } };
  const dd = html`<${Dropdown} value=${sel} onChange=${onSel} disabled=${disabled} options=${options}/>`;
  if (sel !== "__custom__") return dd;
  return html`<span class="ipk-combo">${dd}
    <input class="ipk-over mono" value=${val} ref=${inRef}
      placeholder=${T("e.g. 203.0.113.5")} onInput=${e => onChange(e.target.value)}
      onBlur=${e => done(e.target.value)}
      onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); done(e.target.value); } }}
      disabled=${disabled} spellcheck="false" autocomplete="off"/>
  </span>`;
}

export const ifaceReady = {};
export const ifaceWasBusy = {};
export const ifaceFlash = {};
export const adoptSeen = new Set();

export function ThemedSwatch({ val, onChange, sample, title }) {
  const v = (val && typeof val === "object") ? val : { dark: val || "", light: val || "" };
  const cell = mode => html`<span class="tsw">
    <input type="color" class="tf-color" value=${v[mode]}
      title=${(title ? title + " · " : "") + (mode === "dark" ? T("Dark theme") : T("Light theme"))}
      onInput=${e => onChange({ ...v, [mode]: e.target.value })}/>
    <span class=${"tsw-bub tsw-" + mode}>${sample(v[mode], mode)}
      <span class="tsw-cap">${mode === "dark" ? T("theme|dark") : T("theme|light")}</span></span>
  </span>`;
  return html`<span class="tswrow">${cell("dark")}${cell("light")}</span>`;
}

export function useAnchoredList(open, setOpen, deps) {
  const wrapRef = useRef(null), listRef = useRef(null);
  const [pos, setPos] = useState(null);
  const place = () => { const el = wrapRef.current; if (!el) return; const r = el.getBoundingClientRect();
    setPos({ left: Math.round(r.left), top: Math.round(r.bottom + 4), width: Math.round(r.width) }); };
  useEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const onMove = () => place();
    const onDoc = e => { const t = e.target;
      if (!((wrapRef.current && wrapRef.current.contains(t)) || (listRef.current && listRef.current.contains(t)))) setOpen(false); };
    window.addEventListener("scroll", onMove, true); window.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onDoc, true);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); document.removeEventListener("pointerdown", onDoc, true); };
  }, [open, ...(deps || [])]);
  return { wrapRef, listRef, pos, popStyle: pos ? ("left:" + pos.left + "px;top:" + pos.top + "px;min-width:" + pos.width + "px") : "" };
}

export function applyForkColors() {
  let el = document.getElementById("tf-colors");
  if (!el) { el = document.createElement("style"); el.id = "tf-colors"; (document.head || document.documentElement).appendChild(el); }
  const raw = turnColor("qwdtt") || "#FACC15";
  el.textContent = turnForkList().map(f => ".tf-" + f.id + "{--tfc:" + turnColor(f.id) + "}").join("")
    + ".tg-raw{color:" + raw + ";background:color-mix(in srgb," + raw + " 15%,transparent)}"
    + ".rawport{color:" + raw + "}";
}
export const meshGenLabel = g => ({ wg: "WG", "2.0": "AWG 2.0", "3.1": "AWG 3.1" })[g || "2.0"] || g;
export const meshGenColor = g => ifaceColor(g === "wg" ? "wg" : g === "3.1" ? "awg3" : "awg");
export function ifaceColor(type) {
  const t = (type || "").toLowerCase();
  const k = t === "awg" ? "awg" : t === "awg3" ? "awg3" : t === "wdtt" ? "wdtt" : t === "csqtt" ? "csqtt" : "wg";
  return pickThemed(null, IFACE_COLOR_DEFAULTS[k].dark, IFACE_COLOR_DEFAULTS[k].light);
}
export function themeColor() {
  const ps = Store.panelSettings || {};
  return resolvedTheme() === "light" ? (ps.theme_color_light || THEME_COLOR_LIGHT_DEFAULT)
                                     : (ps.theme_color || THEME_COLOR_DEFAULT);
}
let _themeSig = null;
export function applyThemeColors() {
  const theme = themeColor(), wg = ifaceColor("wg"), awg = ifaceColor("awg"), awg3 = ifaceColor("awg3"), wdtt = ifaceColor("wdtt"), csqtt = ifaceColor("csqtt");
  const sig = [resolvedTheme(), theme, wg, awg, awg3, wdtt, csqtt].join("|");
  if (sig === _themeSig) return;
  _themeSig = sig;
  const de = document.documentElement, cm = (c, p, m) => "color-mix(in srgb, " + c + " " + p + "%, " + m + ")";
  const brand = clampBrand(theme, resolvedTheme() === "light");
  de.style.setProperty("--brand", brand);
  de.style.setProperty("--brand-2", cm(brand, 70, "#fff"));
  de.style.setProperty("--tp-rx", brand);
  de.style.setProperty("--awg3", awg3);
  de.style.setProperty("--brand-ink", hexLum(brand) > 0.55 ? "#04232A" : "#EAFBFF");
  let el = document.getElementById("theme-colors");
  if (!el) { el = document.createElement("style"); el.id = "theme-colors"; (document.head || document.documentElement).appendChild(el); }
  el.textContent =
    ".iftype.wg,.tg-wg{background:" + cm(wg, 14, "transparent") + ";color:" + wg + "}" +
    ".iftype.awg,.tg-awg{background:" + cm(awg, 15, "transparent") + ";color:" + awg + "}" +
    ".iftype.wdtt,.tg-wdtt{background:" + cm(wdtt, 15, "transparent") + ";color:" + wdtt + "}" +
    ".iftype.csqtt,.tg-csqtt{background:" + cm(csqtt, 15, "transparent") + ";color:" + csqtt + "}" +
    ".chip.c-wg.on{color:" + wg + ";border-color:" + wg + ";background:" + cm(wg, 15, "transparent") + "}" +
    ".chip.c-awg.on{color:" + awg + ";border-color:" + awg + ";background:" + cm(awg, 15, "transparent") + "}" +
    ".chip.c-wdtt.on{color:" + wdtt + ";border-color:" + wdtt + ";background:" + cm(wdtt, 15, "transparent") + "}" +
    ".chip.c-csqtt.on{color:" + csqtt + ";border-color:" + csqtt + ";background:" + cm(csqtt, 15, "transparent") + "}";
  applyFavicon(theme);
}
export function applyFavicon(accent) {
  const centre = resolvedTheme() === "light" ? "#FFFFFF" : "#0A0E15";
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
    + "<rect width='32' height='32' rx='8' fill='" + accent + "'/>"
    + "<circle cx='16' cy='14.5' r='5.5' fill='" + centre + "'/></svg>";
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement("link"); link.rel = "icon"; (document.head || document.documentElement).appendChild(link); }
  link.setAttribute("href", "data:image/svg+xml," + encodeURIComponent(svg));
}
export function applyThemeMode() {
  document.documentElement.dataset.theme = resolvedTheme();
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = resolvedTheme() === "light" ? "#FFFFFF" : "#10151E";
  _themeSig = null;
  applyThemeColors();
  applyForkColors();
}
export function setThemeMode(mode) { try { localStorage.setItem("swg-theme", mode); } catch (_) {} applyThemeMode(); const b = document.getElementById("theme-btn"); if (b) paintThemeBtn(b); }
export function cycleThemeMode() { const i = THEME_MODES.indexOf(themeMode()); setThemeMode(THEME_MODES[(i + 1) % THEME_MODES.length]); }
export const THEME_ICON = {
  light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  auto: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>`,
};
export function paintLangBtn(b) {
  if (!b) return;
  const next = nextLang();
  const row = LANGS.find(([c]) => c === next) || [];
  b.textContent = row[2] || next.toUpperCase();
  b.title = T("Switch to {name}", { name: row[1] || next });
  b.setAttribute("aria-label", b.title);
}
export function cycleLang() {
  const codes = LANGS.map(([c]) => c);
  setLang(codes[(codes.indexOf(lang()) + 1) % codes.length]);
}

export function paintThemeBtn(b) {
  const m = themeMode();
  b.innerHTML = THEME_ICON[m];
  b.title = m === "auto" ? T("Theme: Auto (follows your system) — click for Light")
    : m === "light" ? T("Theme: Light — click for Dark") : T("Theme: Dark — click for Auto");
}

export function StoreOffBanner() {
  if (Store.storeConfigs) return null;
  const declarative = !!(Store.env && Store.env.declarative);
  const docker = !!(Store.env && Store.env.docker);
  const fp = (Store.env && Store.env.fleet_path) || "/etc/swg-panel/fleet.json";
  const sed = `sed -i -E 's/("store_configs":[[:space:]]*)false/\\1true/' ${fp}`;
  const cmd = declarative
    ? `services.swg-panel.storeConfigs = true;`
    : docker
    ? `docker exec swg-panel ${sed} && docker restart swg-panel`
    : `sudo ${sed} && sudo systemctl restart swg-panel-server`;
  const intro = declarative
    ? T("This panel is managed declaratively, so its config-storage setting comes from its configuration. Set this and rebuild (existing peers then need a one-time Rotate-keys to capture a config):")
    : T("Client configs (with their private keys) aren't kept on the panel, so QR codes and downloads only work right after a peer is created — existing peers can't be re-shared. Run this on the {host} to enable it (existing peers then need a one-time Rotate-keys to capture a config):",
        { host: docker ? T("Docker host") : T("panel host") });
  return html`<div class="banner warn"><${Ic} i="warn"/><div class="banner-body">
    <b>${T("Config storage is off.")}</b> ${intro}
    <div class="cmdrow"><div class=${"tokenbox" + (declarative ? " block" : "")}>${cmd}</div><button class="copyaction" onClick=${() => copy(cmd, T("Command copied"))}><${Ic} i="copy"/> ${T("Copy")}</button></div>
  </div></div>`;
}
