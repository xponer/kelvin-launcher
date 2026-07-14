/* ============================================================
   Kelvin — global Settings: appearance, java, cache, hotkeys,
   notifications, about. Heavy on customization.
   ============================================================ */
const { useState: sgS, useMemo: sgM, useEffect: sgE } = React;
var { useApp } = window.CryoStore;

const PRESET_SWATCHES = {
  glacier: ["#67E8F9", "#38BDF8", "#6366F1"],
  aurora: ["#6EE7B7", "#34D399", "#22D3EE"],
  midnight: ["#818CF8", "#6366F1", "#A855F7"],
  frost: ["#BAE6FD", "#93C5FD", "#C4B5FD"],
};

function Row({ label, desc, children, stack = false }) {
  return React.createElement("div", {
    style: { display: "flex", flexDirection: stack ? "column" : "row", alignItems: stack ? "stretch" : "center", gap: stack ? 10 : 16, padding: "14px 0", borderBottom: "1px solid var(--border-faint)" },
  },
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 13.5, fontWeight: 600 } }, label),
      desc && React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", marginTop: 2, lineHeight: 1.45 } }, desc)),
    React.createElement("div", { style: { flexShrink: 0 } }, children),
  );
}

function SectionCard({ id, icon, title, children }) {
  return React.createElement(Card, { id, style: { borderRadius: "var(--r-xl)", scrollMarginTop: 20 } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } },
      React.createElement("div", { style: { width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--acc-soft)", color: "var(--acc-text)", border: "1px solid var(--acc-soft-2)" } },
        React.createElement(Icon, { name: icon, size: 17 })),
      React.createElement("h2", { style: { margin: 0, fontSize: 16, fontWeight: 700 } }, title)),
    React.createElement("div", { style: { marginTop: 8 } }, children),
  );
}

function AppearanceSection({ settings, update, t }) {
  const [hex, setHex] = sgS(settings.customAccent);
  const applyHex = v => { setHex(v); if (window.CryoStore.isValidHex(v)) update({ preset: "custom", customAccent: v.startsWith("#") ? v : "#" + v }); };
  return React.createElement(SectionCard, { id: "appearance", icon: "palette", title: t("cfg.appearance") },
    React.createElement(Row, { label: t("cfg.theme") },
      React.createElement(Segmented, { value: settings.mode, onChange: v => update({ mode: v }),
        options: [{ value: "dark", label: t("cfg.theme.dark"), icon: "moon" }, { value: "light", label: t("cfg.theme.light"), icon: "sun" }, { value: "system", label: t("cfg.theme.system"), icon: "monitor" }] })),
    React.createElement(Row, { label: t("cfg.presets"), desc: "Glacier · Aurora · Midnight · Frost", stack: true },
      React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
        Object.keys(PRESET_SWATCHES).map(p => {
          const active = settings.preset === p;
          return React.createElement("button", {
            key: p, onClick: () => update({ preset: p }), className: "no-drag",
            style: {
              display: "flex", flexDirection: "column", gap: 8, padding: 11, borderRadius: "var(--r-md)", minWidth: 116,
              background: active ? "var(--panel-hi)" : "var(--panel-2)", border: "1px solid " + (active ? "var(--acc)" : "var(--border)"),
              boxShadow: active ? "0 0 0 1px var(--acc), 0 8px 24px -12px var(--acc-glow)" : "none", transition: "all .2s",
            },
          },
            React.createElement("div", { style: { display: "flex", gap: 4 } },
              PRESET_SWATCHES[p].map((c, i) => React.createElement("span", { key: i, style: { width: 22, height: 22, borderRadius: 7, background: c } }))),
            React.createElement("span", { style: { fontSize: 12, fontWeight: 650, textTransform: "capitalize", textAlign: "left", color: active ? "var(--text)" : "var(--text-dim)" } }, p),
          );
        }),
      )),
    React.createElement(Row, { label: t("cfg.accentCustom") },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
        React.createElement("label", { style: { width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border-strong)", overflow: "hidden", cursor: "pointer", position: "relative", background: window.CryoStore.isValidHex(hex) ? (hex.startsWith("#") ? hex : "#" + hex) : "var(--acc)" } },
          React.createElement("input", { type: "color", value: window.CryoStore.isValidHex(hex) ? (hex.startsWith("#") ? hex : "#" + hex) : "#38BDF8", onChange: e => applyHex(e.target.value), style: { opacity: 0, width: "100%", height: "100%", cursor: "pointer" } })),
        React.createElement(TextInput, { value: hex, onChange: applyHex, mono: true, size: "sm", icon: "hash", style: { width: 150 } }),
      )),
    React.createElement(Row, { label: t("cfg.density") },
      React.createElement(Segmented, { value: settings.density, onChange: v => update({ density: v }),
        options: [{ value: "compact", label: t("cfg.density.compact") }, { value: "comfortable", label: t("cfg.density.comfortable") }] })),
    React.createElement(Row, { label: t("cfg.radius") },
      React.createElement(Segmented, { value: settings.radius, onChange: v => update({ radius: v }),
        options: [{ value: "sharp", label: "Sharp" }, { value: "rounded", label: "Rounded" }, { value: "pill", label: "Pill" }] })),
    React.createElement(Row, { label: t("cfg.bg"), desc: settings.bg === "particles" ? "Drifting frost particles render behind the UI." : null },
      React.createElement(Segmented, { value: settings.bg, onChange: v => update({ bg: v }),
        options: [{ value: "solid", label: t("cfg.bg.solid") }, { value: "gradient", label: t("cfg.bg.gradient") }, { value: "particles", label: t("cfg.bg.particles") }] })),
    React.createElement(Row, { label: t("cfg.anim") },
      React.createElement(Toggle, { checked: settings.anim, onChange: v => update({ anim: v }) })),
    React.createElement(Row, { label: t("cfg.lang") },
      React.createElement(Segmented, { value: settings.lang, onChange: v => update({ lang: v }),
        options: [{ value: "en", label: "EN" }, { value: "ru", label: "RU" }] })),
  );
}

function JavaSection({ settings, update, t, api, hasBridge }) {
  const [ram, setRam] = sgS(8192);
  const [java, setJava] = sgS("Java 21 (Temurin)");
  const [preset, setPreset] = sgS("Balanced (G1GC)");
  // Bridge-backed launcher config
  const [cfg, setCfg] = sgS(null);
  const [saving, setSaving] = sgS(false);
  const sysRam = useSysRamMb(api);

  sgE(() => {
    if (!hasBridge) return;
    api.getConfig().then(c => {
      setCfg(c);
      if (c.defaultRamMax)    setRam(c.defaultRamMax);
      if (c.defaultJvmPreset) setPreset(c.defaultJvmPreset);
    }).catch(() => {});
  }, [hasBridge]);

  async function saveCfg(patch) {
    if (!hasBridge) return;
    setCfg(c => ({ ...(c || {}), ...patch }));
    setSaving(true);
    try { await api.saveConfig(patch); }
    finally { setSaving(false); }
  }

  return React.createElement(SectionCard, { id: "java", icon: "cpu", title: t("cfg.java") },
    React.createElement("p", { style: { margin: "0 0 4px", fontSize: 12, color: "var(--text-faint)" } }, t("cfg.defaults")),
    React.createElement(Row, { label: t("set.java") },
      React.createElement(Select, { value: java, onChange: setJava, size: "sm", width: 220, options: ["Java 17 (Temurin)", "Java 21 (Temurin)", "Java 21 (Graal)", "Auto-detect"] })),
    React.createElement(Row, { label: t("set.ramMax") },
      React.createElement("div", { style: { width: 280 } }, React.createElement(Slider, { value: Math.min(ram, maxRamMb(sysRam)), min: 2048, max: maxRamMb(sysRam), step: 512, onChange: v => { setRam(v); saveCfg({ defaultRamMax: v }); }, format: v => (v / 1024).toFixed(1) + " GB" }))),
    React.createElement(Row, { label: t("set.preset") },
      React.createElement(Select, { value: preset, onChange: v => { setPreset(v); saveCfg({ defaultJvmPreset: v }); }, size: "sm", width: 220, options: Object.keys(api.presets) })),
    React.createElement(Row, { label: t("status.engine"), desc: t("perf.toggleOn") },
      React.createElement(Toggle, { checked: settings.vspeedGlobal, onChange: v => update({ vspeedGlobal: v }) })),
    /* ── Bridge-backed options ── */
    hasBridge && cfg && React.createElement(React.Fragment, null,
      React.createElement("div", { className: "hr", style: { margin: "8px 0" } }),
      React.createElement("p", { style: { margin: "0 0 4px", fontSize: 12, color: "var(--text-faint)" } }, t("cfg.launcherOptions")),
      React.createElement(Row, { label: t("cfg.autoHideOnLaunch"), desc: t("cfg.autoHideOnLaunchDesc") },
        React.createElement(Toggle, { checked: cfg.autoHideOnLaunch, onChange: v => saveCfg({ autoHideOnLaunch: v }) })),
      React.createElement(Row, { label: "Auto-backup worlds before launch", desc: "Snapshot each instance's worlds before every launch (keeps the last 5). Adds a short delay." },
        React.createElement(Toggle, { checked: !!cfg.autoBackupBeforeLaunch, onChange: v => saveCfg({ autoBackupBeforeLaunch: v }) })),
      React.createElement(Row, { label: t("cfg.showOnLaunch") },
        React.createElement(Toggle, { checked: cfg.showOnLaunch, onChange: v => saveCfg({ showOnLaunch: v }) })),
    ),
  );
}

function CacheSection({ t, fmt, api, hasBridge }) {
  const [autoClean, setAutoClean] = sgS(true);
  const [caches, setCaches] = sgS([]);   // populated by the effect below (real or mock)
  const [loading, setLoading] = sgS(false);

  // Load instance list (real via bridge, mock otherwise)
  sgE(() => {
    if (!hasBridge) {
      const D = window.CryoData;
      if (D && D.INSTANCES) setCaches(D.INSTANCES.map(i => ({ id: i.id, name: i.name, size: D.CACHE?.[i.id]?.sizeBytes || 0, state: D.CACHE?.[i.id]?.state || "off" })));
      return;
    }
    api.getInstances().then(insts => {
      const rows = insts.map(i => ({
        id: i.id, name: i.name,
        size: 0, state: i.cacheState || "off",
      }));
      setCaches(rows);
      // Load cache sizes for each instance
      Promise.all(insts.map(i => api.getCache(i.id).then(c => ({ id: i.id, size: c.sizeBytes, state: c.state })).catch(() => ({ id: i.id, size: 0, state: "off" }))))
        .then(details => setCaches(prev => prev.map(p => { const d = details.find(x => x.id === p.id); return d ? { ...p, size: d.size, state: d.state } : p; })));
    }).catch(() => {});
  }, [hasBridge]);

  async function rebuild(id) {
    if (!hasBridge) return;
    setCaches(cs => cs.map(c => c.id === id ? { ...c, state: "rebuilding" } : c));
    window.toast({ tone: "neutral", icon: "refresh", title: "Rebuilding cache…", body: id });
    await api.rebuildCache(id).catch(() => {});
    const info = await api.getCache(id).catch(() => ({ sizeBytes: 0, state: "off" }));
    setCaches(cs => cs.map(c => c.id === id ? { ...c, size: info.sizeBytes, state: info.state } : c));
    window.toast({ tone: "success", icon: "database", title: "Cache ready", body: fmt.bytes(info.sizeBytes) });
  }

  async function clearAll() {
    if (!hasBridge) { setCaches(cs => cs.map(c => ({ ...c, size: 0 }))); return; }
    setLoading(true);
    await Promise.all(caches.map(c => api.rebuildCache(c.id).catch(() => {})));
    setCaches(cs => cs.map(c => ({ ...c, size: 0, state: "off" })));
    setLoading(false);
    window.toast({ tone: "success", icon: "trash", title: "All caches cleared" });
  }

  const total = caches.reduce((s, c) => s + (c.size || 0), 0);

  return React.createElement(SectionCard, { id: "cache", icon: "database", title: t("cfg.cache") },
    React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", marginBottom: 14 } },
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", fontWeight: 600 } }, t("cfg.totalCache")),
        React.createElement("div", { className: "tnum", style: { fontSize: 22, fontWeight: 730, marginTop: 2 } }, fmt.bytes(total))),
      React.createElement(Btn, { variant: "danger", icon: "trash", onClick: clearAll }, t("cfg.clearAll"))),
    caches.length === 0
      ? React.createElement("div", { style: { padding: "20px 0", textAlign: "center", color: "var(--text-faint)", fontSize: 13 } }, "No instances found")
      : caches.map((c, i) => React.createElement("div", { key: c.id, style: { display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < caches.length - 1 ? "1px solid var(--border-faint)" : "none" } },
          React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--panel-2)", color: "var(--acc-text)", border: "1px solid var(--border)" } },
            React.createElement(Icon, { name: "snowflake", size: 15 })),
          React.createElement("div", { style: { flex: 1, minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.name),
            React.createElement("div", { className: "tnum", style: { fontSize: 11.5, color: "var(--text-faint)" } }, c.size > 0 ? fmt.bytes(c.size) : "empty")),
          c.state === "rebuilding" ? React.createElement(Badge, { tone: "warn", icon: "refresh", size: "sm" }, t("cache.rebuilding"))
            : c.state === "ready" ? React.createElement(Badge, { tone: "success", dot: true, size: "sm" }, t("cache.ready"))
            : null,
          React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: () => rebuild(c.id) }, t("perf.rebuild")),
          React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => hasBridge && rebuild(c.id) },
            React.createElement(Icon, { name: "trash", size: 15 })),
        )),
    React.createElement(Row, { label: t("cfg.autoClean") },
      React.createElement(Toggle, { checked: autoClean, onChange: v => { setAutoClean(v); if (hasBridge) api.saveConfig({ autoCleanCache: v }).catch(() => {}); } })),
  );
}

const HOTKEYS = [
  ["Open Library", "Ctrl 1"], ["Open Dashboard", "Ctrl 2"], ["Open Logs", "Ctrl 3"],
  ["Open Settings", "Ctrl ,"], ["Command palette / search", "Ctrl K"],
];
function HotkeysSection({ t }) {
  return React.createElement(SectionCard, { id: "hotkeys", icon: "keyboard", title: t("cfg.hotkeys") },
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 32px" } },
      HOTKEYS.map(([label, keys], i) => React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid var(--border-faint)" } },
        React.createElement("span", { style: { fontSize: 13, color: "var(--text-dim)" } }, label),
        React.createElement("div", { style: { display: "flex", gap: 4 } }, keys.split(" ").map((k, j) => React.createElement("kbd", { key: j, className: "mono", style: { padding: "2px 7px", borderRadius: 6, background: "var(--panel-2)", border: "1px solid var(--border-strong)", fontSize: 11.5, fontWeight: 600, color: "var(--text)" } }, k))),
      ))),
  );
}

function NotifSection({ t, api, hasBridge }) {
  // cfg keys persisted via config.json
  const [n, setN] = sgS({ notifyLaunchDone: true, notifyCacheBuilt: true, notifyCrash: true });
  sgE(() => { if (hasBridge) api.getConfig().then(c => setN({ notifyLaunchDone: c.notifyLaunchDone, notifyCacheBuilt: c.notifyCacheBuilt, notifyCrash: c.notifyCrash })).catch(() => {}); }, [hasBridge]);
  function set(k, v) { setN(s => ({ ...s, [k]: v })); if (hasBridge) api.saveConfig({ [k]: v }).catch(() => {}); }
  const items = [
    ["notifyLaunchDone", "Launch complete", "Tray balloon when an instance reaches the main menu"],
    ["notifyCacheBuilt", "Cache rebuilt", "Notify when a VSpeed cache finishes building"],
    ["notifyCrash", "Crash detected", "Alert and surface the crash report"],
  ];
  return React.createElement(SectionCard, { id: "notif", icon: "bell", title: t("cfg.notif") },
    items.map(([k, label, desc]) => React.createElement(Row, { key: k, label, desc },
      React.createElement(Toggle, { checked: !!n[k], onChange: v => set(k, v) }))),
  );
}

function DiscordSection({ t, api, hasBridge }) {
  const [cfg, setCfg] = sgS(null);

  sgE(() => { if (hasBridge) api.getConfig().then(setCfg).catch(() => {}); }, [hasBridge]);

  function toggle(v) { setCfg(c => ({ ...(c || {}), discordEnabled: v })); if (hasBridge) api.saveConfig({ discordEnabled: v }).catch(() => {}); }

  return React.createElement(SectionCard, { id: "discord", icon: "activity", title: t("cfg.discord") },
    React.createElement("p", { style: { margin: "0 0 10px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Show \"Playing <modpack>\" in your Discord status while a game runs. Requires the Discord desktop app to be running — no setup needed."),
    !hasBridge && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, "Available in the desktop launcher."),
    hasBridge && React.createElement(Row, { label: "Enable Rich Presence", desc: "Shows your current pack / instance in your Discord status" },
      React.createElement(Toggle, { checked: cfg ? !!cfg.discordEnabled : false, onChange: toggle })),
  );
}

function AccountSection({ t, api, hasBridge }) {
  const [acc, setAcc] = sgS(null);
  const [busy, setBusy] = sgS(false);
  sgE(() => {
    if (!hasBridge) return;
    api.accountStatus().then(setAcc).catch(() => {});
    function onCh(e) { setAcc(e.detail || {}); setBusy(false); }
    function onErr(e) { setBusy(false); window.toast({ tone: "danger", icon: "alert", title: "Login failed", body: (e.detail && e.detail.error) || "" }); }
    window.addEventListener("cryo:accountChanged", onCh);
    window.addEventListener("cryo:accountError", onErr);
    return () => { window.removeEventListener("cryo:accountChanged", onCh); window.removeEventListener("cryo:accountError", onErr); };
  }, [hasBridge]);
  async function login() {
    setBusy(true);
    window.toast({ tone: "neutral", icon: "globe", title: "Microsoft sign-in", body: "A Microsoft login page will open — sign in there. Kelvin never sees your password." });
    const r = await api.accountLogin().catch(() => ({ ok: false }));
    if (r && r.ok === false) setBusy(false);
  }
  async function logout() { setBusy(true); await api.accountLogout().catch(() => {}); }

  const li = acc && acc.loggedIn;
  const uuid = acc && acc.uuid ? String(acc.uuid).replace(/-/g, "") : "";
  return React.createElement(SectionCard, { id: "account", icon: "globe", title: t("cfg.account") },
    !hasBridge
      ? React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, "Available in the desktop launcher.")
      : li
        ? React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14 } },
            React.createElement(SkinHead, { uuid, size: 48, radius: 10, style: { background: "var(--panel-2)" } }),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
              React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, acc.username || "Signed in"),
              React.createElement("div", { className: "mono", style: { fontSize: 11, color: "var(--text-faint)", wordBreak: "break-all" } }, acc.uuid || "")),
            React.createElement(Btn, { variant: "outline", size: "sm", icon: "x", disabled: busy, onClick: logout }, "Sign out"))
        : React.createElement("div", null,
            React.createElement("p", { style: { margin: "0 0 12px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
              "Sign in with your Microsoft account to launch online. Tokens are stored encrypted with Windows DPAPI — only your Windows login can read them, never plaintext on disk."),
            React.createElement(Btn, { variant: "primary", icon: busy ? "refresh" : "globe", iconSpin: busy, disabled: busy, onClick: login }, busy ? "Waiting for sign-in…" : "Sign in with Microsoft")));
}

function DiagnosticsSection({ t, api, hasBridge }) {
  const [res, setRes] = sgS(null);
  const [running, setRunning] = sgS(false);
  const [engine, setEngine] = sgS(null);

  sgE(() => {
    function onP(e) { const d = e.detail || {}; setEngine(s => ({ running: true, msg: d.name ? d.name : (d.bytesTotal ? ("Downloading… " + Math.round((d.bytesDone / Math.max(1, d.bytesTotal)) * 100) + "%") : ((s && s.msg) || "Working…")) })); }
    function onD(e) { const d = e.detail || {}; setEngine({ done: true, msg: "Launched Minecraft " + (d.version || "") + " (pid " + (d.pid || "?") + ") via the built-in engine ✓" }); }
    function onE(e) { const d = e.detail || {}; setEngine({ err: true, msg: "Engine error: " + (d.error || "") }); }
    window.addEventListener("cryo:coreProgress", onP);
    window.addEventListener("cryo:coreDone", onD);
    window.addEventListener("cryo:coreError", onE);
    return () => { window.removeEventListener("cryo:coreProgress", onP); window.removeEventListener("cryo:coreDone", onD); window.removeEventListener("cryo:coreError", onE); };
  }, []);
  async function testEngine() {
    setEngine({ running: true, msg: "Starting…" });
    const r = await api.coreTest("1.21.1", 4096).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok === false) setEngine({ err: true, msg: (r && r.error) || "Couldn't start" });
  }

  async function runCheck() {
    if (!hasBridge) return;
    setRunning(true);
    const r = await api.selfCheck().catch(e => ({ error: String(e) }));
    setRunning(false);
    if (r && r.checks) setRes(r);
    else window.toast({ tone: "danger", icon: "alert", title: "Self-check failed", body: (r && r.error) || "" });
  }
  async function runFix(fix) {
    if (!fix) return;
    try {
      switch (fix.type) {
        case "setRam":          await api.saveInstanceCfg(fix.args.id, { ramMax: fix.args.ramMax }); break;
        case "openModsFolder":  await api.openFolder(fix.args.id); break;
        case "rebuildCache":    await api.rebuildCache(fix.args.id); break;
        case "openLauncherLog": await api.openLauncherLog(); break;
        case "openSettings":    { const el = document.getElementById("assistant"); if (el) el.scrollIntoView({ behavior: "smooth" }); break; }
        default: break;
      }
      window.toast({ tone: "success", icon: "check", title: "Done", body: fix.label || "" });
      if (["setRam", "rebuildCache"].includes(fix.type)) runCheck();
    } catch (e) { window.toast({ tone: "danger", icon: "alert", title: "Fix failed", body: String((e && e.message) || e) }); }
  }

  const dot = status => React.createElement("span", { style: { width: 9, height: 9, borderRadius: 999, flexShrink: 0, background: status === "ok" ? "var(--success)" : status === "warn" ? "var(--warn, #e6b450)" : "var(--danger, #ff6b6b)" } });

  return React.createElement(SectionCard, { id: "diagnostics", icon: "gauge", title: t("cfg.diagnostics") },
    React.createElement("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Kelvin checks its own health — config, paths, WebView2, RAM sanity, VSpeed mod, disk and recent launcher errors — and offers 1-click fixes."),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, marginBottom: res ? 14 : 0 } },
      React.createElement(Btn, { variant: "primary", icon: running ? "refresh" : "gauge", iconSpin: running, disabled: running || !hasBridge, onClick: runCheck }, running ? "Checking…" : "Run Self-Check"),
      res && React.createElement("div", { style: { display: "flex", gap: 12, fontSize: 12.5, fontWeight: 650 } },
        React.createElement("span", { style: { color: "var(--success)" } }, res.summary.ok + " ok"),
        res.summary.warn > 0 && React.createElement("span", { style: { color: "var(--warn, #e6b450)" } }, res.summary.warn + " warn"),
        res.summary.fail > 0 && React.createElement("span", { style: { color: "var(--danger, #ff6b6b)" } }, res.summary.fail + " fail"))),
    res && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      res.checks.map((c, i) => React.createElement("div", { key: c.id + i, style: { display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
        dot(c.status),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: "var(--text)" } }, c.title),
          React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", wordBreak: "break-word" } }, c.detail)),
        c.fix && React.createElement(Btn, { variant: "outline", size: "sm", onClick: () => runFix(c.fix) }, c.fix.label || "Fix")))),
    React.createElement("div", { className: "hr", style: { margin: "14px 0 12px" } }),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
      React.createElement("div", { style: { flex: 1, minWidth: 200 } },
        React.createElement("div", { style: { fontSize: 13, fontWeight: 650 } }, "Standalone engine (beta)"),
        React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)" } }, "Install + launch Minecraft 1.21.1 (offline) with the new built-in engine — proves Kelvin can run without Prism.")),
      React.createElement(Btn, { variant: "outline", size: "sm", icon: (engine && engine.running) ? "refresh" : "play", iconSpin: !!(engine && engine.running), disabled: !hasBridge || !!(engine && engine.running), onClick: testEngine }, "Test engine")),
    engine && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: engine.err ? "var(--danger, #ff6b6b)" : engine.done ? "var(--success)" : "var(--text-dim)", wordBreak: "break-word" } }, engine.msg),
  );
}

function AssistantSection({ t, api, hasBridge }) {
  const [cfg, setCfg] = sgS(null);
  const [key, setKey] = sgS("");
  const [base, setBase] = sgS("https://integrate.api.nvidia.com");
  const [model, setModel] = sgS("microsoft/phi-4-mini-instruct");
  const [testing, setTesting] = sgS(false);
  const [savingKey, setSavingKey] = sgS(false);
  const [cfKey, setCfKey] = sgS("");
  const [savingCf, setSavingCf] = sgS(false);

  sgE(() => {
    if (!hasBridge) return;
    api.getConfig().then(c => { setCfg(c); if (c.aiBaseUrl) setBase(c.aiBaseUrl); if (c.aiModel) setModel(c.aiModel); }).catch(() => {});
  }, [hasBridge]);

  async function saveCfKey() {
    if (!hasBridge || !cfKey.trim()) return;
    setSavingCf(true);
    try { await api.saveConfig({ curseForgeApiKey: cfKey.trim() }); setCfKey(""); setCfg(c => ({ ...(c || {}), curseHasKey: true })); window.toast({ tone: "success", icon: "check", title: "CurseForge key saved" }); }
    finally { setSavingCf(false); }
  }
  async function clearCfKey() {
    if (!hasBridge) return;
    await api.saveConfig({ curseForgeApiKey: "" }).catch(() => {});
    setCfg(c => ({ ...(c || {}), curseHasKey: false }));
    window.toast({ tone: "neutral", icon: "trash", title: "CurseForge key removed" });
  }

  async function saveKey() {
    if (!hasBridge || !key.trim()) return;
    setSavingKey(true);
    try { await api.saveConfig({ aiApiKey: key.trim() }); setKey(""); setCfg(c => ({ ...(c || {}), aiHasKey: true })); window.toast({ tone: "success", icon: "check", title: "API key saved" }); }
    finally { setSavingKey(false); }
  }
  async function clearKey() {
    if (!hasBridge) return;
    await api.saveConfig({ aiApiKey: "" }).catch(() => {});
    setCfg(c => ({ ...(c || {}), aiHasKey: false }));
    window.toast({ tone: "neutral", icon: "trash", title: "API key removed" });
  }
  function saveField(patch) { if (hasBridge) api.saveConfig(patch).catch(() => {}); }
  async function test() {
    if (!hasBridge) return;
    setTesting(true);
    await api.saveConfig({ aiBaseUrl: base.trim(), aiModel: model.trim() }).catch(() => {});
    const r = await api.aiChat({ messages: [{ role: "user", content: "Reply with the single word: OK" }] }).catch(e => ({ ok: false, error: String(e) }));
    setTesting(false);
    if (r && r.ok) window.toast({ tone: "success", icon: "check", title: "Connected", body: "Model replied: " + String(r.content || "").trim().slice(0, 40) });
    else window.toast({ tone: "danger", icon: "alert", title: "Connection failed", body: (r && r.error) || "" });
  }

  const inp = { height: 37, padding: "0 11px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, width: "100%", outline: "none", fontFamily: "inherit" };

  return React.createElement(SectionCard, { id: "assistant", icon: "sparkles", title: t("cfg.assistant") },
    React.createElement("p", { style: { margin: "0 0 10px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Connect the NVIDIA phi-4-mini model. Get a free key at build.nvidia.com and paste it below. The key is stored locally on this PC and is never shown again."),
    !hasBridge && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, "Available in the desktop launcher."),
    hasBridge && React.createElement(React.Fragment, null,
      React.createElement(Row, { label: "API key", desc: cfg && cfg.aiHasKey ? "A key is saved" : "Required for the hosted cloud API" },
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", width: 380 } },
          React.createElement("input", { type: "password", value: key, onChange: e => setKey(e.target.value), placeholder: cfg && cfg.aiHasKey ? "•••• saved — type to replace" : "nvapi-…", style: inp, className: "no-drag" }),
          React.createElement(Btn, { variant: "primary", size: "sm", disabled: !key.trim() || savingKey, iconSpin: savingKey, icon: savingKey ? "refresh" : null, onClick: saveKey }, "Save"),
          cfg && cfg.aiHasKey && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", onClick: clearKey }))),
      React.createElement(Row, { label: "Get a key" },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: "globe", onClick: () => (api.openUrl ? api.openUrl("https://build.nvidia.com/microsoft/phi-4-mini-instruct") : null) }, "Open build.nvidia.com")),
      React.createElement("div", { className: "hr", style: { margin: "8px 0" } }),
      React.createElement(Row, { label: "Base URL", desc: "Hosted cloud, or http://localhost:8000 for a local Docker NIM" },
        React.createElement("input", { value: base, onChange: e => setBase(e.target.value), onBlur: () => saveField({ aiBaseUrl: base.trim() }), style: { ...inp, width: 380 }, className: "no-drag" })),
      React.createElement(Row, { label: "Model", desc: "Use a model whose page shows 'Free Endpoint: Available'. phi-4-mini is partner/self-host only." },
        React.createElement("input", { value: model, onChange: e => setModel(e.target.value), onBlur: () => saveField({ aiModel: model.trim() }), style: { ...inp, width: 380 }, className: "no-drag" })),
      React.createElement(Row, { label: "Free picks", desc: "One click sets + saves the model" },
        React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          [["Llama-3.1-8B", "meta/llama-3.1-8b-instruct"], ["Phi-3.5-mini", "microsoft/phi-3.5-mini-instruct"], ["Llama-3.3-70B", "meta/llama-3.3-70b-instruct"], ["Nemotron-4B", "nvidia/nemotron-mini-4b-instruct"]]
            .map(([lbl, mid]) => React.createElement(Btn, { key: mid, variant: model === mid ? "primary" : "outline", size: "sm", onClick: () => { setModel(mid); saveField({ aiModel: mid }); } }, lbl)))),
      React.createElement(Row, { label: "Test connection", desc: "Sends a 1-word prompt to verify the key + endpoint" },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: testing ? "refresh" : "zap", iconSpin: testing, disabled: testing, onClick: test }, "Test")),

      React.createElement("div", { className: "hr", style: { margin: "14px 0 6px" } }),
      React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 2 } }, "CurseForge"),
      React.createElement("p", { style: { margin: "0 0 8px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
        "Optional — enables the CurseForge source in the Mod Browser. Get a free API key at console.curseforge.com. Stored locally, never shown again."),
      React.createElement(Row, { label: "CurseForge API key", desc: cfg && cfg.curseHasKey ? "A key is saved" : "Modrinth works without any key" },
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", width: 380 } },
          React.createElement("input", { type: "password", value: cfKey, onChange: e => setCfKey(e.target.value), placeholder: cfg && cfg.curseHasKey ? "•••• saved — type to replace" : "$2a$10$…", style: inp, className: "no-drag" }),
          React.createElement(Btn, { variant: "primary", size: "sm", disabled: !cfKey.trim() || savingCf, iconSpin: savingCf, icon: savingCf ? "refresh" : null, onClick: saveCfKey }, "Save"),
          cfg && cfg.curseHasKey && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", onClick: clearCfKey }))),
      React.createElement(Row, { label: "Get a key" },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: "globe", onClick: () => (api.openUrl ? api.openUrl("https://console.curseforge.com/") : null) }, "Open console.curseforge.com")),
    ),
  );
}

function AboutSection({ t, api, hasBridge }) {
  const open = url => api.openUrl ? api.openUrl(url) : window.open(url, "_blank");
  const REPO = "https://github.com/xponer/kelvin-launcher";
  const [ver, setVer] = sgS({ version: "1.0.0", installed: false });
  const [checking, setChecking] = sgS(false);
  const [upd, setUpd] = sgS(null);       // { available, version } | null
  const [updating, setUpdating] = sgS(false);
  const [pct, setPct] = sgS(0);

  sgE(() => {
    if (!hasBridge) return;
    api.getAppVersion().then(v => v && setVer(v)).catch(() => {});
    function onProg(e) { const d = e.detail || {}; setPct(d.percent || 0); if (d.phase === "ready") setPct(100); }
    function onErr(e) { setUpdating(false); window.toast({ tone: "danger", icon: "alert", title: "Update failed", body: (e.detail && e.detail.error) || "" }); }
    window.addEventListener("cryo:updateProgress", onProg);
    window.addEventListener("cryo:updateError", onErr);
    return () => { window.removeEventListener("cryo:updateProgress", onProg); window.removeEventListener("cryo:updateError", onErr); };
  }, [hasBridge]);

  async function check() {
    if (!hasBridge) return;
    setChecking(true); setUpd(null);
    const r = await api.checkForUpdate().catch(e => ({ ok: false, error: String(e) }));
    setChecking(false);
    if (!r || r.ok === false) { window.toast({ tone: "danger", icon: "alert", title: "Check failed", body: (r && r.error) || "" }); return; }
    if (!r.installed) { window.toast({ tone: "neutral", icon: "info", title: "Dev build", body: "Updates apply only to the installed app (Setup.exe)." }); return; }
    if (r.available) { setUpd(r); }
    else window.toast({ tone: "success", icon: "check", title: "Up to date", body: "You're on the latest version (" + r.current + ")." });
  }
  async function doUpdate() {
    setUpdating(true); setPct(0);
    await api.applyUpdate().catch(() => {});
    // The app will restart itself on success; updateError handler clears state on failure.
  }

  return React.createElement(SectionCard, { id: "about", icon: "info", title: t("cfg.about") },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, marginBottom: 16 } },
      React.createElement("div", { style: { width: 52, height: 52, borderRadius: 14, background: "var(--acc-grad)", display: "grid", placeItems: "center", color: "var(--acc-ink)", boxShadow: "0 8px 24px -10px var(--acc-glow)" } },
        React.createElement(Icon, { name: "snowflake", size: 28 })),
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 18, fontWeight: 740, letterSpacing: "-0.01em" } }, "Kelvin"),
        React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, t("app.tagline"))),
    ),
    React.createElement(Row, { label: t("cfg.version"), desc: ver.installed ? "Installed build" : "Dev build (run from source)" },
      React.createElement("span", { className: "mono tnum", style: { fontSize: 13, color: "var(--text-dim)" } }, "v" + ver.version)),

    // Update available banner
    upd && upd.available && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", margin: "12px 0" } },
      React.createElement(Icon, { name: "download", size: 18, style: { color: "var(--acc-text)" } }),
      React.createElement("div", { style: { flex: 1 } },
        React.createElement("div", { style: { fontSize: 13.5, fontWeight: 680, color: "var(--acc-text)" } }, "Update available — v" + upd.version),
        updating
          ? React.createElement("div", { style: { marginTop: 6, height: 6, borderRadius: 99, background: "var(--panel-2)", overflow: "hidden" } },
              React.createElement("div", { style: { height: "100%", width: pct + "%", background: "var(--acc-grad)", transition: "width .3s" } }))
          : React.createElement("div", { style: { fontSize: 12, color: "var(--text-dim)", marginTop: 1 } }, "Downloads in the background, then restarts.")),
      React.createElement(Btn, { variant: "primary", size: "sm", icon: updating ? "refresh" : "download", iconSpin: updating, disabled: updating, onClick: doUpdate }, updating ? (pct >= 100 ? "Restarting…" : pct + "%") : "Update & Restart")),

    React.createElement(Row, { label: "Updates", desc: "Checks GitHub Releases for a newer version" },
      React.createElement(Btn, { variant: "outline", size: "sm", icon: checking ? "refresh" : "refresh", iconSpin: checking, disabled: checking || updating, onClick: check }, checking ? "Checking…" : "Check for updates")),
    React.createElement(Row, { label: t("cfg.license") }, React.createElement("span", { style: { fontSize: 13, color: "var(--text-dim)" } }, "MIT")),
    React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 14 } },
      React.createElement(Btn, { variant: "primary", icon: "alert", onClick: () => open(REPO + "/issues/new/choose") }, "Report a bug"),
      React.createElement(Btn, { variant: "ghost", icon: "external", onClick: () => open(REPO) }, "GitHub"),
    ),
  );
}

const PROFILE_ICONS = ["zap", "gauge", "feather", "activity", "cpu", "package", "layers2"];

function ProfilesSection({ t, api, hasBridge }) {
  const [profiles, setProfiles] = sgS([]);
  const [editing, setEditing]   = sgS(null);  // profile object being edited, or {} for new, or null
  const sysRam = useSysRamMb(api);

  async function load() {
    if (!hasBridge) return;
    const r = await api.getProfiles().catch(() => ({ profiles: [] }));
    setProfiles((r && r.profiles) || []);
  }
  sgE(() => { load(); }, [hasBridge]);

  function startNew() { setEditing({ name: "", icon: "zap", ramMax: 6144, jvmArgs: "", vspeedEnabled: true }); }
  function startEdit(p) { setEditing({ ...p }); }

  async function save() {
    const e = editing;
    if (!e.name.trim()) { window.toast({ tone: "warn", icon: "info", title: "Name required" }); return; }
    const r = await api.saveProfile({
      profileId: e.id || "", name: e.name.trim(), icon: e.icon, ramMax: e.ramMax,
      jvmArgs: e.jvmArgs || "", vspeedEnabled: !!e.vspeedEnabled,
    }).catch(() => null);
    if (r && r.ok) { setEditing(null); load(); window.toast({ tone: "success", icon: "check", title: "Profile saved" }); }
    else window.toast({ tone: "danger", icon: "alert", title: "Save failed", body: (r && r.error) || "" });
  }
  async function del(p) {
    if (!window.confirm("Delete profile \"" + p.name + "\"?")) return;
    const r = await api.deleteProfile(p.id).catch(() => null);
    if (r && r.ok) { load(); window.toast({ tone: "neutral", icon: "trash", title: "Deleted" }); }
    else window.toast({ tone: "danger", icon: "alert", title: "Can't delete", body: (r && r.error) || "" });
  }

  const editor = editing && React.createElement("div", { style: { padding: 16, borderRadius: "var(--r-lg)", background: "var(--panel-2)", border: "1px solid var(--acc-soft-2)", marginBottom: 14 } },
    React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" } },
      React.createElement(TextInput, { value: editing.name, onChange: v => setEditing(e => ({ ...e, name: v })), placeholder: "Profile name", size: "sm", style: { flex: 1, minWidth: 160 } }),
      React.createElement("div", { style: { display: "flex", gap: 4 } },
        PROFILE_ICONS.map(ic => React.createElement("button", {
          key: ic, className: "no-drag", onClick: () => setEditing(e => ({ ...e, icon: ic })),
          style: { width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", cursor: "pointer",
            border: "1px solid " + (editing.icon === ic ? "var(--acc-soft-2)" : "var(--border)"),
            background: editing.icon === ic ? "var(--acc-soft)" : "transparent", color: editing.icon === ic ? "var(--acc-text)" : "var(--text-dim)" },
        }, React.createElement(Icon, { name: ic, size: 15 })))),
    ),
    React.createElement(Row, { label: "Max RAM", desc: (editing.ramMax / 1024).toFixed(1) + " GB" },
      React.createElement(Slider, { value: Math.min(editing.ramMax, maxRamMb(sysRam)), min: 1024, max: maxRamMb(sysRam), step: 512, onChange: v => setEditing(e => ({ ...e, ramMax: v })), format: v => (v / 1024).toFixed(1) + "G" })),
    React.createElement(Row, { label: "VSpeed cache", desc: "Enable the optimization engine with this profile" },
      React.createElement(Toggle, { checked: editing.vspeedEnabled, onChange: v => setEditing(e => ({ ...e, vspeedEnabled: v })) })),
    React.createElement(Row, { label: "JVM arguments", stack: true },
      React.createElement("textarea", {
        className: "no-drag mono", value: editing.jvmArgs, onChange: e => setEditing(p => ({ ...p, jvmArgs: e.target.value })),
        rows: 3, placeholder: "-XX:+UseG1GC …",
        style: { width: "100%", resize: "vertical", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 10, color: "var(--text)", fontSize: 11.5, lineHeight: 1.5, outline: "none" } })),
    React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 } },
      React.createElement(Btn, { variant: "ghost", onClick: () => setEditing(null) }, "Cancel"),
      React.createElement(Btn, { variant: "primary", icon: "check", onClick: save }, "Save profile")),
  );

  return React.createElement(SectionCard, { id: "profiles", icon: "sliders", title: t("cfg.profiles") },
    React.createElement("p", { style: { margin: "0 0 14px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
      "Reusable launch presets — RAM, JVM arguments, and the VSpeed toggle. Apply them to any instance from its Settings tab."),
    editor,
    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      profiles.map(p => React.createElement("div", { key: p.id, style: { display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
        React.createElement("div", { style: { width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--acc-soft)", color: "var(--acc-text)", flexShrink: 0 } }, React.createElement(Icon, { name: p.icon || "zap", size: 16 })),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            React.createElement("span", { style: { fontSize: 13.5, fontWeight: 680 } }, p.name),
            p.builtIn && React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: "var(--text-faint)", background: "var(--panel-hi)", borderRadius: 999, padding: "1px 7px" } }, "built-in")),
          React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 } },
            (p.ramMax / 1024).toFixed(1) + "G · " + (p.vspeedEnabled ? "VSpeed on" : "VSpeed off") + (p.jvmArgs ? " · " + p.jvmArgs.split(" ").length + " JVM flags" : ""))),
        React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => startEdit(p) }, React.createElement(Icon, { name: "edit", size: 14 })),
        !p.builtIn && React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => del(p) }, React.createElement(Icon, { name: "trash", size: 14 })),
      ))),
    React.createElement("div", { style: { marginTop: 12 } },
      React.createElement(Btn, { variant: "subtle", icon: "plus", onClick: startNew, disabled: !!editing }, "New profile")),
  );
}

function InstanceLocationsSection({ t, api, hasBridge }) {
  const [roots, setRoots] = sgS([]);
  const [busy, setBusy] = sgS(false);

  function load() { if (hasBridge) api.getInstanceRoots().then(r => setRoots((r && r.roots) || [])).catch(() => {}); }
  sgE(() => { load(); }, [hasBridge]);

  async function add() {
    if (!hasBridge || busy) return;
    setBusy(true);
    try {
      const f = await api.pickFolder();
      if (f && f.ok && f.path) {
        const r = await api.addInstanceRoot(f.path);
        if (r && r.ok) { load(); window.toast({ tone: "success", icon: "check", title: "Location added", body: (r.added || 0) + " instance(s) found" }); }
        else window.toast({ tone: "danger", icon: "alert", title: "Couldn't add", body: (r && r.error) || "" });
      }
    } finally { setBusy(false); }
  }
  async function remove(path) {
    if (!hasBridge) return;
    if (!window.confirm("Remove this location from Kelvin?\n\nThe folder and its files are NOT deleted — its instances just stop showing here.")) return;
    const r = await api.removeInstanceRoot(path).catch(() => null);
    if (r && r.ok) { load(); window.toast({ tone: "neutral", icon: "trash", title: "Location removed" }); }
  }
  async function makePrimary(path) {
    const r = await api.setPrimaryRoot(path).catch(() => null);
    if (r && r.ok) { load(); window.toast({ tone: "success", icon: "check", title: "Primary location set", body: "New installs default here" }); }
  }

  return React.createElement(SectionCard, { id: "instances", icon: "folder", title: t("cfg.instances") },
    React.createElement("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Folders Kelvin scans for instances. Each is a Prism-style folder that contains an \"instances\" subfolder. Add another to keep packs on a different drive — when you install a modpack and have more than one, Kelvin asks where to put it."),
    !hasBridge && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, "Available in the desktop launcher."),
    hasBridge && React.createElement(React.Fragment, null,
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 } },
        roots.length === 0 && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)" } }, "No locations configured."),
        roots.map(r => React.createElement("div", { key: r.path, style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
          React.createElement(Icon, { name: r.exists ? "folder" : "alert", size: 15, style: { color: r.exists ? "var(--text-dim)" : "#f1c40f", flexShrink: 0 } }),
          React.createElement("div", { style: { minWidth: 0, flex: 1 } },
            React.createElement("div", { style: { fontSize: 12.5, color: "var(--text)", fontFamily: "var(--font-mono)", wordBreak: "break-all" } }, r.path),
            React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", marginTop: 1 } },
              (r.primary ? "Primary · " : "") + (r.count || 0) + " instance(s)" + (r.exists ? "" : " · folder missing"))),
          React.createElement("div", { style: { display: "flex", gap: 4, flexShrink: 0 } },
            React.createElement(Btn, { variant: "ghost", size: "sm", icon: "folderOpen", onClick: () => api.openPath(r.path) }, "Open"),
            !r.primary && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "check", onClick: () => makePrimary(r.path) }, "Primary"),
            !r.primary && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", onClick: () => remove(r.path) }, "Remove")))),
      ),
      React.createElement(Btn, { variant: "outline", size: "sm", icon: busy ? "refresh" : "plus", iconSpin: busy, disabled: busy, onClick: add }, "Add location…"),
    ),
  );
}

const SETTINGS_NAV = [
  ["account", "globe", "cfg.account"],
  ["appearance", "palette", "cfg.appearance"], ["java", "cpu", "cfg.java"], ["instances", "folder", "cfg.instances"], ["cache", "database", "cfg.cache"],
  ["profiles", "sliders", "cfg.profiles"],
  ["diagnostics", "gauge", "cfg.diagnostics"], ["assistant", "sparkles", "cfg.assistant"],
  ["hotkeys", "keyboard", "cfg.hotkeys"], ["notif", "bell", "cfg.notif"], ["discord", "activity", "cfg.discord"], ["about", "info", "cfg.about"],
];

function SettingsScreen() {
  const { settings, update, t, fmt, api, hasBridge } = useApp();
  const [active, setActive] = sgS("appearance");

  // Scroll-spy: highlight the section currently in view
  sgE(() => {
    const scroller = document.getElementById("cryo-main");
    if (!scroller) return;
    const ids = SETTINGS_NAV.map(x => x[0]);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const base = scroller.getBoundingClientRect().top;
        let cur = ids[0];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top - base <= 110) cur = id;
        }
        setActive(cur);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { scroller.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  function jump(id) {
    setActive(id);
    const el = document.getElementById(id);
    const scroller = document.getElementById("cryo-main");
    if (el && scroller) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 14;
      scroller.scrollTo({ top, behavior: "smooth" });
    }
  }
  return React.createElement("div", { style: { padding: "26px 30px 60px", maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "200px 1fr", gap: 28 }, className: "cryo-settings-grid" },
    React.createElement("div", { style: { position: "sticky", top: 20, alignSelf: "start" }, className: "cryo-settings-nav" },
      React.createElement("h1", { style: { margin: "0 0 18px", fontSize: 22, fontWeight: 720, letterSpacing: "-0.02em" } }, t("cfg.title")),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
        SETTINGS_NAV.map(([id, icon, key]) => React.createElement("button", {
          key: id, onClick: () => jump(id), className: "no-drag",
          style: {
            display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: "var(--r-md)", border: "none", textAlign: "left",
            background: active === id ? "var(--acc-soft)" : "transparent", color: active === id ? "var(--acc-text)" : "var(--text-dim)",
            fontSize: 13, fontWeight: active === id ? 650 : 550,
          },
        }, React.createElement(Icon, { name: icon, size: 15 }), t(key)))),
    ),
    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18, minWidth: 0 } },
      React.createElement(AccountSection, { t, api, hasBridge }),
      React.createElement(AppearanceSection, { settings, update, t }),
      React.createElement(JavaSection, { settings, update, t, api, hasBridge }),
      React.createElement(InstanceLocationsSection, { t, api, hasBridge }),
      React.createElement(CacheSection, { t, fmt, api, hasBridge }),
      React.createElement(ProfilesSection, { t, api, hasBridge }),
      React.createElement(DiagnosticsSection, { t, api, hasBridge }),
      React.createElement(AssistantSection, { t, api, hasBridge }),
      React.createElement(HotkeysSection, { t }),
      React.createElement(NotifSection, { t, api, hasBridge }),
      React.createElement(DiscordSection, { t, api, hasBridge }),
      React.createElement(AboutSection, { t, api, hasBridge }),
    ),
  );
}

window.CryoSettings = { SettingsScreen };
