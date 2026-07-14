/* ============================================================
   Kelvin — icon set (lucide path data) + UI primitives
   ============================================================ */
const { useState: uS, useEffect: uE, useRef: uR, useCallback: uC, useMemo: uM } = React;

const ICONS = {
  snowflake: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  square: '<rect width="16" height="16" x="4" y="4" rx="2"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  scroll: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  checkCircle: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  ram: '<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/>',
  hdd: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M12 22V7"/>',
  feather: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  layers2: '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  dotsH: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  dot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  bars: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  trendDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.999 6.012 17.5 2 12 2z"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  loader: '<line x1="12" x2="12" y1="2" y2="6"/><line x1="12" x2="12" y1="18" y2="22"/><line x1="4.93" x2="7.76" y1="4.93" y2="7.76"/><line x1="16.24" x2="19.07" y1="16.24" y2="19.07"/><line x1="2" x2="6" y1="12" y2="12"/><line x1="18" x2="22" y1="12" y2="12"/><line x1="4.93" x2="7.76" y1="19.07" y2="16.24"/><line x1="16.24" x2="19.07" y1="7.76" y2="4.93"/>',
  info2: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  check2: '<path d="M20 6 9 17l-5-5"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  stickyNote: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2z"/><path d="M15 21v-5a1 1 0 0 1 1-1h5"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
};

function Icon({ name, size = 18, className = "", style = {}, strokeWidth = 2, spin = false }) {
  const inner = ICONS[name] || ICONS.dot;
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round",
    className: (spin ? "spin " : "") + className, style: { flexShrink: 0, ...style },
    "aria-hidden": true, dangerouslySetInnerHTML: { __html: inner },
  });
}

/* ---------------- Button ---------------- */
function Btn({ children, variant = "subtle", size = "md", icon, iconRight, iconSpin = false, className = "", style = {}, ...rest }) {
  const sizes = {
    sm: { padding: "0 11px", height: 30, fontSize: 12.5, gap: 6 },
    md: { padding: "0 15px", height: 37, fontSize: 13.5, gap: 8 },
    lg: { padding: "0 22px", height: 46, fontSize: 15, gap: 9 },
    icon: { padding: 0, width: 34, height: 34, fontSize: 13 },
  };
  const variants = {
    primary: { background: "var(--acc-2)", color: "var(--acc-ink)", border: "1px solid transparent", fontWeight: 650 },
    accentSoft: { background: "var(--acc-soft)", color: "var(--acc-text)", border: "1px solid var(--acc-soft-2)", fontWeight: 600 },
    subtle: { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", fontWeight: 550 },
    ghost: { background: "transparent", color: "var(--text-dim)", border: "1px solid transparent", fontWeight: 550 },
    outline: { background: "transparent", color: "var(--text)", border: "1px solid var(--border-strong)", fontWeight: 550 },
    danger: { background: "var(--error-dim)", color: "var(--error)", border: "1px solid color-mix(in oklab, var(--error) 30%, transparent)", fontWeight: 600 },
  };
  const s = sizes[size] || sizes.md;
  return React.createElement("button", {
    className: "no-drag " + className,
    style: {
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      gap: s.gap, borderRadius: "var(--r-md)", height: s.height, width: s.width,
      padding: s.padding, fontSize: s.fontSize, lineHeight: 1, letterSpacing: "0.01em",
      transition: "transform .14s var(--ease), background .18s, border-color .18s, filter .18s",
      whiteSpace: "nowrap", ...variants[variant], ...style,
    },
    onMouseDown: e => { if (!rest.disabled) e.currentTarget.style.transform = "scale(.97)"; },
    onMouseUp: e => { e.currentTarget.style.transform = ""; },
    onMouseLeave: e => { e.currentTarget.style.transform = ""; },
    ...rest,
  },
    icon && React.createElement(Icon, { name: icon, size: size === "lg" ? 18 : 15, spin: iconSpin }),
    children != null && React.createElement("span", null, children),
    iconRight && React.createElement(Icon, { name: iconRight, size: 15 }),
  );
}

/* ---------------- Badge ---------------- */
function Badge({ children, tone = "neutral", icon, dot, size = "md", className = "", style = {} }) {
  const tones = {
    neutral: { bg: "var(--panel-2)", fg: "var(--text-dim)", bd: "var(--border)" },
    accent: { bg: "var(--acc-soft)", fg: "var(--acc-text)", bd: "var(--acc-soft-2)" },
    success: { bg: "var(--success-dim)", fg: "var(--success)", bd: "color-mix(in oklab, var(--success) 28%, transparent)" },
    warn: { bg: "var(--warn-dim)", fg: "var(--warn)", bd: "color-mix(in oklab, var(--warn) 28%, transparent)" },
    error: { bg: "var(--error-dim)", fg: "var(--error)", bd: "color-mix(in oklab, var(--error) 30%, transparent)" },
  };
  const tg = tones[tone] || tones.neutral;
  return React.createElement("span", {
    className: "tnum " + className,
    style: {
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "sm" ? "2px 7px" : "3px 9px", borderRadius: "var(--r-pill)",
      fontSize: size === "sm" ? 10.5 : 11.5, fontWeight: 600, letterSpacing: "0.02em",
      background: tg.bg, color: tg.fg, border: "1px solid " + tg.bd, whiteSpace: "nowrap", ...style,
    },
  },
    dot && React.createElement("span", { style: { width: 6, height: 6, borderRadius: 1, background: "currentColor" } }),
    icon && React.createElement(Icon, { name: icon, size: 12 }),
    children,
  );
}

/* ---------------- Card ---------------- */
function Card({ children, className = "", glass = true, pad = true, style = {}, lift = false, ...rest }) {
  return React.createElement("div", {
    className: (glass ? "glass sheen " : "") + (lift ? "lift " : "") + className,
    style: { borderRadius: "var(--r-xl)", padding: pad ? "var(--pad-card)" : 0, ...style },
    ...rest,
  }, children);
}

/* ---------------- Toggle / Switch ---------------- */
function Toggle({ checked, onChange, size = "md", disabled = false }) {
  const w = size === "sm" ? 34 : 42, h = size === "sm" ? 20 : 24, k = h - 6;
  return React.createElement("button", {
    role: "switch", "aria-checked": checked, disabled,
    onClick: () => !disabled && onChange(!checked),
    className: "no-drag",
    style: {
      width: w, height: h, borderRadius: 99, position: "relative", flexShrink: 0,
      border: "1px solid " + (checked ? "transparent" : "var(--border-strong)"),
      background: checked ? "var(--acc-grad)" : "var(--panel-2)",
      transition: "background .25s var(--ease), border-color .25s", padding: 0,
    },
  },
    React.createElement("span", {
      style: {
        position: "absolute", top: 2, left: checked ? w - k - 3 : 2, width: k, height: k,
        borderRadius: 99, background: checked ? "var(--acc-ink)" : "var(--text-dim)",
        transition: "left .25s var(--ease), background .25s",
        boxShadow: "0 2px 6px rgba(0,0,0,.4)",
      },
    }),
  );
}

/* ---------------- Segmented ---------------- */
function Segmented({ options, value, onChange, size = "md", full = false }) {
  return React.createElement("div", {
    style: {
      display: "inline-flex", padding: 3, gap: 2, borderRadius: "var(--r-md)",
      background: "var(--panel-2)", border: "1px solid var(--border)", width: full ? "100%" : "auto",
    },
  },
    options.map(o => {
      const v = typeof o === "object" ? o.value : o;
      const label = typeof o === "object" ? o.label : o;
      const ic = typeof o === "object" ? o.icon : null;
      const active = v === value;
      return React.createElement("button", {
        key: v, onClick: () => onChange(v), className: "no-drag",
        style: {
          flex: full ? 1 : "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
          gap: 6, height: size === "sm" ? 26 : 32, padding: "0 12px", borderRadius: "calc(var(--r-md) - 3px)",
          fontSize: size === "sm" ? 12 : 13, fontWeight: 600, border: "none",
          background: active ? "var(--panel-hi)" : "transparent",
          color: active ? "var(--text)" : "var(--text-dim)",
          boxShadow: active ? "0 1px 4px rgba(0,0,0,.25), inset 0 0 0 1px var(--border)" : "none",
          transition: "all .18s var(--ease)",
        },
      }, ic && React.createElement(Icon, { name: ic, size: 14 }), label);
    }),
  );
}

/* ---------------- Slider ---------------- */
function Slider({ value, min, max, step = 1, onChange, format }) {
  const pct = ((value - min) / (max - min)) * 100;
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, width: "100%" } },
    React.createElement("input", {
      type: "range", min, max, step, value,
      onChange: e => onChange(Number(e.target.value)),
      className: "no-drag cryo-range",
      style: {
        flex: 1, height: 6, borderRadius: 99, cursor: "pointer",
        background: `linear-gradient(90deg, var(--acc-2) 0%, var(--acc-2) ${pct}%, var(--panel-hi) ${pct}%, var(--panel-hi) 100%)`,
      },
    }),
    React.createElement("span", { className: "tnum mono", style: { fontSize: 13, color: "var(--text)", minWidth: 64, textAlign: "right", fontWeight: 600 } },
      format ? format(value) : value),
  );
}

/* ---------------- useSysRamMb: caps RAM sliders to the machine's installed memory ---------------- */
function useSysRamMb(api) {
  const [mb, setMb] = uS(0);
  uE(() => {
    if (api && api.getSystemRam) api.getSystemRam().then(r => setMb((r && r.totalMb) || 0)).catch(() => {});
  }, [api]);
  return mb;
}
function maxRamMb(sys) { return sys && sys >= 2048 ? sys : 32768; }

/* ---------------- Select (custom dropdown) ----------------
   The menu is portalled to <body> at fixed coords so it can never be clipped
   by a card's overflow or trapped under a sibling's backdrop-filter stacking
   context (the bug where the list rendered behind the next card). */
function Select({ value, options, onChange, width, size = "md", icon }) {
  const [open, setOpen] = uS(false);
  const [pos, setPos] = uS(null);   // { top, left, width } viewport coords
  const ref = uR(null);

  function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = ref.current.getBoundingClientRect();
    const gap = 6;
    const estH = Math.min(280, options.length * 36 + 10);
    let top = r.bottom + gap;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - gap - estH);  // flip up
    setPos({ top, left: r.left, width: r.width });
    setOpen(true);
  }

  uE(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    document.getElementById("cryo-main")?.addEventListener("scroll", close, { once: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = options.find(o => (typeof o === "object" ? o.value : o) === value);
  const curLabel = cur ? (typeof cur === "object" ? cur.label : cur) : value;

  return React.createElement("div", { ref, style: { position: "relative", width: width || "auto" } },
    React.createElement("button", {
      onClick: toggle, className: "no-drag",
      style: {
        display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between",
        height: size === "sm" ? 30 : 37, padding: "0 11px", width: "100%",
        borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)",
        color: "var(--text)", fontSize: 13, fontWeight: 550,
      },
    },
      React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        icon && React.createElement(Icon, { name: icon, size: 14, style: { color: "var(--text-dim)" } }), curLabel),
      React.createElement(Icon, { name: "chevronDown", size: 15, style: { color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" } }),
    ),
    open && pos && ReactDOM.createPortal(
      React.createElement("div", {
        className: "glass-pop anim-fadein",
        onMouseDown: e => e.stopPropagation(),
        style: {
          position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 120), zIndex: 9000,
          borderRadius: "var(--r-md)", padding: 5, maxHeight: 280, overflowY: "auto",
        },
      },
        options.map(o => {
          const v = typeof o === "object" ? o.value : o;
          const l = typeof o === "object" ? o.label : o;
          const active = v === value;
          return React.createElement("button", {
            key: v, onClick: () => { onChange(v); setOpen(false); }, className: "no-drag",
            style: {
              display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
              padding: "8px 10px", borderRadius: "var(--r-sm)", border: "none", textAlign: "left",
              background: active ? "var(--acc-soft)" : "transparent", color: active ? "var(--acc-text)" : "var(--text)",
              fontSize: 13, fontWeight: active ? 600 : 500,
            },
            onMouseEnter: e => { if (!active) e.currentTarget.style.background = "var(--panel-2)"; },
            onMouseLeave: e => { if (!active) e.currentTarget.style.background = "transparent"; },
          }, l, active && React.createElement(Icon, { name: "check", size: 14 }));
        }),
      ),
      document.body,
    ),
  );
}

/* ---------------- TextInput ---------------- */
function TextInput({ value, onChange, placeholder, icon, size = "md", className = "", style = {}, onKeyDown, mono = false, ...rest }) {
  return React.createElement("div", {
    className,
    style: {
      display: "flex", alignItems: "center", gap: 9, height: size === "sm" ? 32 : 38,
      padding: "0 12px", borderRadius: "var(--r-md)", background: "var(--panel-2)",
      border: "1px solid var(--border)", ...style,
    },
  },
    icon && React.createElement(Icon, { name: icon, size: 15, style: { color: "var(--text-faint)" } }),
    React.createElement("input", {
      value, onChange: e => onChange(e.target.value), placeholder, onKeyDown,
      className: mono ? "mono" : "",
      style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 13, minWidth: 0 },
      ...rest,
    }),
  );
}

/* ---------------- Minecraft head avatar ----------------
   Skin-head services go down (crafatar in particular is flaky and has
   returned HTTP 521 for extended periods). Relying on a single one means a
   blank avatar whenever it's offline — so try several in order, then hide. */
function SkinHead({ uuid, size = 22, radius = 6, style = {} }) {
  const id = (uuid || "").replace(/-/g, "");
  if (!id)
    return React.createElement("div", {
      style: { width: size, height: size, borderRadius: radius, background: "var(--panel-hi)", flexShrink: 0, ...style },
    });
  // Ordered fallbacks — lead with the reliable ones, keep crafatar last.
  const sources = [
    "https://mc-heads.net/avatar/" + id + "/" + size,
    "https://minotar.net/helm/" + id + "/" + size + ".png",
    "https://crafatar.com/avatars/" + id + "?size=" + size + "&overlay",
  ];
  return React.createElement("img", {
    src: sources[0], width: size, height: size, alt: "",
    style: { borderRadius: radius, background: "var(--panel-hi)", display: "block", flexShrink: 0, ...style },
    onError: e => {
      const t = e.target;
      const next = (parseInt(t.dataset.skinFb || "0", 10)) + 1;
      if (next < sources.length) { t.dataset.skinFb = String(next); t.src = sources[next]; }
      else t.style.visibility = "hidden";
    },
  });
}

/* ---------------- Tabs ---------------- */
function Tabs({ tabs, value, onChange }) {
  return React.createElement("div", { style: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", position: "relative" } },
    tabs.map(tb => {
      const active = tb.value === value;
      return React.createElement("button", {
        key: tb.value, onClick: () => onChange(tb.value), className: "no-drag",
        style: {
          display: "inline-flex", alignItems: "center", gap: 7, padding: "0 4px 12px", margin: "0 10px",
          marginLeft: tb === tabs[0] ? 0 : 10, border: "none", background: "transparent",
          color: active ? "var(--text)" : "var(--text-dim)", fontSize: 14, fontWeight: active ? 650 : 550,
          position: "relative", transition: "color .18s",
        },
      },
        tb.icon && React.createElement(Icon, { name: tb.icon, size: 16 }),
        tb.label,
        tb.badge != null && React.createElement("span", { className: "tnum", style: { fontSize: 11, color: "var(--text-faint)", fontWeight: 600 } }, tb.badge),
        active && React.createElement("span", {
          style: { position: "absolute", left: 0, right: 0, bottom: -1, height: 2, background: "var(--acc-2)" },
        }),
      );
    }),
  );
}

/* ---------------- CountUp ---------------- */
function CountUp({ value, duration = 900, decimals = 0, suffix = "", className = "", style = {} }) {
  const [disp, setDisp] = uS(0);
  const fromRef = uR(0);
  uE(() => {
    const from = fromRef.current, to = value;
    let raf, start = null;
    const animOff = document.documentElement.getAttribute("data-anim") === "off";
    if (animOff) { setDisp(to); fromRef.current = to; return; }
    function step(ts) {
      if (start == null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step); else fromRef.current = to;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return React.createElement("span", { className: "tnum " + className, style },
    decimals ? disp.toFixed(decimals) : Math.round(disp).toLocaleString("en-US"), suffix);
}

/* ---------------- Skeleton ---------------- */
function Skeleton({ w = "100%", h = 16, r, style = {} }) {
  return React.createElement("div", { className: "skeleton", style: { width: w, height: h, borderRadius: r || "var(--r-sm)", ...style } });
}

/* ---------------- Spinner ---------------- */
function Spinner({ size = 18, style = {} }) {
  return React.createElement(Icon, { name: "loader", size, spin: true, style: { color: "var(--acc-2)", ...style } });
}

/* ---------------- Popover menu (fixed-positioned, never clipped) ---------------- */
function Menu({ trigger, items, align = "right" }) {
  const [open, setOpen] = uS(false);
  const [pos, setPos] = uS(null);   // {top, left} viewport coords
  const ref = uR(null);

  function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = ref.current.getBoundingClientRect();
    const W = 196, gap = 6;
    // Estimate height; flip up if it would overflow the viewport bottom.
    const estH = items.filter(i => !i.divider).length * 36 + 12;
    const left = align === "right" ? Math.max(8, r.right - W) : r.left;
    let top = r.bottom + gap;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - gap - estH);
    setPos({ top, left, width: W });
    setOpen(true);
  }

  uE(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const scroller = document.getElementById("cryo-main");
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    scroller?.addEventListener("scroll", close, { once: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      scroller?.removeEventListener("scroll", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return React.createElement("div", { ref, style: { position: "relative", display: "inline-flex" } },
    React.createElement("div", { onClick: toggle }, trigger),
    // Portal to <body> so no glass/backdrop-filter/transform ancestor becomes the
    // containing block for position:fixed (that's what made it land on other cards).
    open && pos && ReactDOM.createPortal(
      React.createElement("div", {
        className: "glass-pop anim-fadein",
        style: {
          position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9000,
          borderRadius: "var(--r-md)", padding: 5,
        },
        onClick: e => e.stopPropagation(),
        onMouseDown: e => e.stopPropagation(),
      },
        items.map((it, i) => it.divider
          ? React.createElement("div", { key: i, className: "hr", style: { margin: "5px 4px" } })
          : React.createElement("button", {
            key: i, className: "no-drag",
            onClick: () => { setOpen(false); it.onClick && it.onClick(); },
            style: {
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px",
              borderRadius: "var(--r-sm)", border: "none", background: "transparent", textAlign: "left",
              color: it.danger ? "var(--error)" : "var(--text)", fontSize: 13, fontWeight: 500,
            },
            onMouseEnter: e => e.currentTarget.style.background = it.danger ? "var(--error-dim)" : "var(--panel-2)",
            onMouseLeave: e => e.currentTarget.style.background = "transparent",
          },
            it.icon && React.createElement(Icon, { name: it.icon, size: 15, style: { color: it.danger ? "var(--error)" : "var(--text-dim)" } }),
            it.label,
          )),
      ),
      document.body
    ),
  );
}

/* ---------------- States ---------------- */
function EmptyState({ icon = "package", title, body, action }) {
  return React.createElement("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "64px 24px", gap: 16 },
  },
    React.createElement("div", {
      style: {
        width: 72, height: 72, borderRadius: 20, display: "grid", placeItems: "center",
        background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", color: "var(--acc-text)",
      },
    }, React.createElement(Icon, { name: icon, size: 30 })),
    React.createElement("div", { style: { maxWidth: 380 } },
      React.createElement("h3", { style: { margin: "0 0 8px", fontSize: 18, fontWeight: 650 } }, title),
      React.createElement("p", { style: { margin: 0, color: "var(--text-dim)", fontSize: 13.5, lineHeight: 1.55 } }, body),
    ),
    action,
  );
}

function ErrorState({ title, body, onRetry, retryLabel = "Retry" }) {
  return React.createElement("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "64px 24px", gap: 16 },
  },
    React.createElement("div", {
      style: { width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", background: "var(--error-dim)", color: "var(--error)" },
    }, React.createElement(Icon, { name: "alert", size: 28 })),
    React.createElement("div", { style: { maxWidth: 360 } },
      React.createElement("h3", { style: { margin: "0 0 6px", fontSize: 16, fontWeight: 650 } }, title),
      React.createElement("p", { style: { margin: 0, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5 } }, body),
    ),
    onRetry && React.createElement(Btn, { variant: "subtle", icon: "refresh", onClick: onRetry }, retryLabel),
  );
}

/* ---------------- Tooltip (lightweight) ---------------- */
function Tip({ label, children, side = "top" }) {
  const [pos, setPos] = uS(null);   // { top, left } viewport coords, or null when hidden
  const ref = uR(null);
  function enter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: side === "top" ? r.top - 8 : r.bottom + 8, left: r.left + r.width / 2 });
  }
  function leave() { setPos(null); }
  return React.createElement("span", {
    ref, style: { display: "inline-flex" },
    onMouseEnter: enter, onMouseLeave: leave,
  }, children,
    // Portalled to <body> so the tooltip is never clipped by a card's overflow
    // or trapped under a sibling's backdrop-filter stacking context.
    pos && ReactDOM.createPortal(
      React.createElement("span", {
        className: "glass-pop anim-fadein",
        style: {
          position: "fixed", top: pos.top, left: pos.left,
          transform: side === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
          zIndex: 9500, padding: "5px 9px", borderRadius: 8,
          fontSize: 11.5, color: "var(--text)", whiteSpace: "nowrap", pointerEvents: "none", fontWeight: 500,
        },
      }, label),
      document.body,
    ),
  );
}

/* ============================================================
   Toast notification system
   Usage: window.toast({ tone, icon, title, body })
   ============================================================ */
const _TOAST_BUS = [];
function _dispatchToast(t) { _TOAST_BUS.forEach(fn => fn(t)); }

function ToastItem({ id, tone = "neutral", icon, title, body, onDismiss }) {
  const [alive, setAlive] = uS(true);
  const tones = {
    success: { bg: "var(--success-dim)", bd: "color-mix(in oklab,var(--success) 28%,transparent)", ic: "var(--success)" },
    warn: { bg: "var(--warn-dim)", bd: "color-mix(in oklab,var(--warn) 28%,transparent)", ic: "var(--warn)" },
    error: { bg: "var(--error-dim)", bd: "color-mix(in oklab,var(--error) 30%,transparent)", ic: "var(--error)" },
    accent: { bg: "var(--acc-soft)", bd: "var(--acc-soft-2)", ic: "var(--acc-text)" },
    neutral: { bg: "var(--panel-solid)", bd: "var(--border-strong)", ic: "var(--text-dim)" },
  };
  const tg = tones[tone] || tones.neutral;
  uE(() => {
    const t1 = setTimeout(() => setAlive(false), 3600);
    const t2 = setTimeout(onDismiss, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return React.createElement("div", {
    className: "glass-pop",
    style: {
      display: "flex", gap: 12, padding: "13px 16px", borderRadius: "var(--r-lg)",
      background: tg.bg, border: "1px solid " + tg.bd, maxWidth: 320, minWidth: 260,
      opacity: alive ? 1 : 0, transform: alive ? "none" : "translateY(8px) scale(.97)",
      transition: "opacity .35s, transform .35s var(--ease)",
      boxShadow: "var(--shadow-pop)", pointerEvents: "auto",
    },
  },
    icon && React.createElement("div", {
      style: { width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0, color: tg.ic,
        background: "color-mix(in oklab," + tg.ic + " 15%, transparent)" },
    }, React.createElement(Icon, { name: icon, size: 16 })),
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 13.5, fontWeight: 650, lineHeight: 1.2, marginBottom: body ? 3 : 0 } }, title),
      body && React.createElement("div", { style: { fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 } }, body),
    ),
    React.createElement("button", {
      onClick: () => { setAlive(false); setTimeout(onDismiss, 350); }, className: "no-drag",
      style: { border: "none", background: "transparent", color: "var(--text-faint)", padding: 2, alignSelf: "flex-start", display: "grid", placeItems: "center" },
    }, React.createElement(Icon, { name: "x", size: 14 })),
  );
}

function ToastContainer() {
  const [items, setItems] = uS([]);
  uE(() => {
    const handler = toast => {
      const id = Date.now() + "" + Math.random();
      setItems(prev => [...prev.slice(-4), { ...toast, id }]);
    };
    _TOAST_BUS.push(handler);
    return () => { const i = _TOAST_BUS.indexOf(handler); if (i >= 0) _TOAST_BUS.splice(i, 1); };
  }, []);
  if (!items.length) return null;
  return React.createElement("div", {
    style: { position: "fixed", bottom: 22, right: 22, zIndex: 900, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none" },
  }, items.map(item => React.createElement(ToastItem, {
    key: item.id, ...item,
    onDismiss: () => setItems(prev => prev.filter(x => x.id !== item.id)),
  })));
}

function toast(opts) { _dispatchToast(opts); }

/* ============================================================
   Command Palette (⌘K / Ctrl+K spotlight search)
   ============================================================ */
function Spotlight({ instances, onNavigate, onClose }) {
  const [q, setQ] = uS("");
  const inputRef = uR(null);
  const [sel, setSel] = uS(0);

  // flatten results: instances first, then nav links
  const NAV = [
    { type: "nav", route: "library", icon: "grid", label: "Library" },
    { type: "nav", route: "dashboard", icon: "dashboard", label: "Dashboard" },
    { type: "nav", route: "logs", icon: "scroll", label: "Logs" },
    { type: "nav", route: "settings", icon: "settings", label: "Settings" },
  ];
  const instResults = uM(() =>
    (q ? instances.filter(i => i.name.toLowerCase().includes(q.toLowerCase())) : instances)
      .map(i => ({ type: "instance", id: i.id, name: i.name, sub: i.loader + " " + i.mc + " · " + i.mods + " mods", accent: i.accent })),
  [instances, q]);
  const navResults = uM(() =>
    (q ? NAV.filter(n => n.label.toLowerCase().includes(q.toLowerCase())) : NAV),
  [q]);
  const results = [...instResults, ...navResults];

  uE(() => { inputRef.current && inputRef.current.focus(); }, []);
  uE(() => { setSel(0); }, [q]);

  uE(() => {
    function handle(e) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { setSel(s => Math.min(results.length - 1, s + 1)); e.preventDefault(); }
      if (e.key === "ArrowUp") { setSel(s => Math.max(0, s - 1)); e.preventDefault(); }
      if (e.key === "Enter" && results[sel]) { pick(results[sel]); }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [results, sel]);

  function pick(r) {
    if (r.type === "instance") onNavigate("instance", { id: r.id });
    else onNavigate(r.route);
    onClose();
  }

  return React.createElement("div", {
    onMouseDown: e => { if (e.target === e.currentTarget) onClose(); },
    style: { position: "fixed", inset: 0, zIndex: 800, display: "grid", placeItems: "start center", paddingTop: 130, background: "rgba(0,0,0,.55)", backdropFilter: "blur(10px)" },
  },
    React.createElement("div", {
      className: "glass-pop anim-fadein",
      style: { width: 480, borderRadius: "var(--r-xl)", overflow: "hidden" },
      onClick: e => e.stopPropagation(),
    },
      // search bar
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)" } },
        React.createElement(Icon, { name: "search", size: 18, style: { color: "var(--text-faint)", flexShrink: 0 } }),
        React.createElement("input", {
          ref: inputRef, value: q, onChange: e => setQ(e.target.value),
          placeholder: "Search instances, navigate…",
          style: { flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 15.5, color: "var(--text)", fontFamily: "inherit" },
        }),
        React.createElement("kbd", { className: "mono", style: { padding: "2px 8px", borderRadius: 6, background: "var(--panel-2)", border: "1px solid var(--border-strong)", fontSize: 11, color: "var(--text-faint)", flexShrink: 0 } }, "ESC"),
      ),
      // results
      React.createElement("div", { style: { maxHeight: 360, overflowY: "auto", padding: 8 } },
        results.length === 0
          ? React.createElement("div", { style: { padding: "28px 0", textAlign: "center", color: "var(--text-faint)", fontSize: 13 } }, "No results for \"" + q + "\"")
          : results.map((r, i) => React.createElement("button", {
            key: (r.id || r.route), onClick: () => pick(r), className: "no-drag",
            style: {
              display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px",
              borderRadius: "var(--r-md)", border: "none", textAlign: "left",
              background: i === sel ? "var(--acc-soft)" : "transparent",
              color: i === sel ? "var(--acc-text)" : "var(--text)",
            },
            onMouseEnter: () => setSel(i),
          },
            React.createElement("div", {
              style: { width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, border: "1px solid var(--border)",
                background: r.type === "instance" ? "var(--panel-2)" : "var(--panel-2)",
                color: r.type === "instance" ? (r.accent || "var(--acc-2)") : "var(--text-faint)" },
            }, React.createElement(Icon, { name: r.type === "instance" ? "gem" : r.icon, size: 17 })),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
              React.createElement("div", { style: { fontWeight: 620, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, r.name || r.label),
              r.sub && React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 1 } }, r.sub),
            ),
            React.createElement(Icon, { name: "chevronRight", size: 14, style: { color: "var(--text-faint)", flexShrink: 0 } }),
          )),
        results.length > 0 && React.createElement("div", { style: { display: "flex", gap: 14, padding: "8px 12px 4px", fontSize: 11, color: "var(--text-faint)" } },
          React.createElement("span", null, "↑↓ navigate"),
          React.createElement("span", null, "↵ open"),
          React.createElement("span", null, "ESC close"),
        ),
      ),
    ),
  );
}

Object.assign(window, {
  Icon, Btn, Badge, Card, Toggle, Segmented, Slider, Select, TextInput, Tabs,
  CountUp, Skeleton, Spinner, Menu, EmptyState, ErrorState, Tip, ICONS,
  toast, ToastContainer, Spotlight,
});
