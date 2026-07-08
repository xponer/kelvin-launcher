/* ============================================================
   Cryo - app shell: titlebar, sidebar, background, router
   ============================================================ */
const { useState: aS, useEffect: aE, useRef: aR } = React;
var { useApp, useT } = window.CryoStore;

/* ---- drifting frost particles ---- */
function ParticleField({ active }) {
  const ref = aR(null);
  aE(() => {
    if (!active) return;
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf, W, H, parts = [];
    function resize() {
      W = canvas.width = canvas.offsetWidth * devicePixelRatio;
      H = canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();
    const N = Math.min(36, Math.floor((canvas.offsetWidth * canvas.offsetHeight) / 42000));
    for (let i = 0; i < N; i++) parts.push({
      x: Math.random() * W, y: Math.random() * H,
      r: (0.6 + Math.random() * 1.6) * devicePixelRatio,
      vy: (0.1 + Math.random() * 0.3) * devicePixelRatio,
      vx: (Math.random() - 0.5) * 0.2 * devicePixelRatio,
      a: 0.15 + Math.random() * 0.35,
    });
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--acc-1").trim() || "#67E8F9";
    // Throttle to ~30fps and draw plain circles (no per-particle shadowBlur — far cheaper).
    let last = 0;
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (ts - last < 33) return;
      last = ts;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = acc;
      for (const p of parts) {
        p.y += p.vy; p.x += p.vx;
        if (p.y > H + 4) { p.y = -4; p.x = Math.random() * W; }
        if (p.x < -4) p.x = W; if (p.x > W + 4) p.x = 0;
        ctx.globalAlpha = p.a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [active]);
  if (!active) return null;
  return React.createElement("canvas", { ref, style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" } });
}

/* Ambient snowfall — a quiet nod to "Cryo". Sits behind the content (shows through
   the frosted-glass panels) and is hidden when the animations toggle is off. */
function SnowField() {
  const flakes = React.useMemo(() => Array.from({ length: 16 }).map(() => ({
    left: Math.random() * 100,
    size: 2 + Math.random() * 3.5,
    dur: 10 + Math.random() * 12,
    delay: -Math.random() * 22,
    dx: Math.round(Math.random() * 50 - 25),
  })), []);
  return React.createElement("div", { className: "cryo-snow", "aria-hidden": true },
    flakes.map((f, i) => React.createElement("span", {
      key: i,
      style: { left: f.left + "%", width: f.size, height: f.size, animationDuration: f.dur + "s", animationDelay: f.delay + "s", "--dx": f.dx + "px" },
    })));
}

function Background({ bg }) {
  return React.createElement("div", { style: { position: "absolute", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none" } },
    bg !== "solid" && React.createElement("div", {
      style: {
        position: "absolute", inset: 0,
        background: "radial-gradient(120% 90% at 78% -10%, var(--bg-grad-a), transparent 55%), radial-gradient(100% 80% at 10% 110%, var(--bg-grad-a), transparent 50%), var(--bg-1)",
      },
    }),
    bg === "solid" && React.createElement("div", { style: { position: "absolute", inset: 0, background: "var(--bg-1)" } }),
    React.createElement(ParticleField, { active: bg === "particles" }),
  );
}

/* ---- window controls: call C# bridge if inside WebView2 ---- */
function winMsg(method) {
  try {
    if (window.chrome && window.chrome.webview)
      window.chrome.webview.postMessage({ id: "wc-" + Date.now(), method, args: {} });
  } catch {}
}

function WinControls() {
  const btn = (icon, hover, action) => React.createElement("button", {
    className: "no-drag", onClick: action,
    onMouseEnter: e => e.currentTarget.style.background = hover,
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: { width: 40, height: 30, display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--text-dim)", borderRadius: 7, transition: "background .15s" },
  }, React.createElement(Icon, { name: icon, size: icon === "minus" ? 15 : 13 }));
  return React.createElement("div", { style: { display: "flex", gap: 2 } },
    btn("minus", "var(--panel-hi)", () => winMsg("windowMinimize")),
    btn("square", "var(--panel-hi)", () => winMsg("windowMaximize")),
    React.createElement("button", {
      className: "no-drag",
      onClick: () => winMsg("windowClose"),
      onMouseEnter: e => { e.currentTarget.style.background = "var(--error)"; e.currentTarget.style.color = "#fff"; },
      onMouseLeave: e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; },
      style: { width: 40, height: 30, display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--text-dim)", borderRadius: 7, transition: "all .15s" },
    }, React.createElement(Icon, { name: "x", size: 14 })),
  );
}

function AccountChip() {
  const { api, hasBridge, navigate } = useApp();
  const [acc, setAcc] = aS(null);
  aE(() => {
    if (!hasBridge) return;
    api.accountStatus().then(setAcc).catch(() => {});
    function onCh(e) { setAcc(e.detail || {}); }
    window.addEventListener("cryo:accountChanged", onCh);
    return () => window.removeEventListener("cryo:accountChanged", onCh);
  }, [hasBridge]);
  if (!hasBridge) return null;

  const li = acc && acc.loggedIn;
  const uuid = acc && acc.uuid ? String(acc.uuid).replace(/-/g, "") : "";
  return React.createElement(Tip, { label: li ? ("Signed in as " + (acc.username || "")) : "Sign in with Microsoft", side: "bottom" },
    React.createElement("button", {
      className: "no-drag", onClick: () => navigate("settings"),
      style: {
        display: "flex", alignItems: "center", gap: 8, height: 30, padding: li ? "0 11px 0 4px" : "0 11px",
        borderRadius: 999, border: "1px solid var(--border)",
        background: li ? "var(--panel-2)" : "var(--acc-soft)", color: li ? "var(--text)" : "var(--acc-text)",
        fontSize: 12.5, fontWeight: 600, cursor: "pointer",
      },
    },
      li
        ? React.createElement(SkinHead, { uuid, size: 22, radius: 6 })
        : React.createElement(Icon, { name: "globe", size: 14 }),
      React.createElement("span", { style: { maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        li ? (acc.username || "Account") : "Sign in"),
    ));
}

/* ── VSpeed Live Stats chip — shows in titlebar while a session has recent data ── */
function VSpeedChip() {
  const { api, hasBridge } = useApp();
  const [stats, setStats] = aS(null);    // { totalMs, totalEntries, mode, instanceId }
  const timerRef = aR(null);

  async function fetchForInstance(id) {
    if (!id || !api.getStats) return;
    const s = await api.getStats(id).catch(() => null);
    if (s && s.available) setStats({ ...s, instanceId: id });
  }

  aE(() => {
    if (!hasBridge) return;
    // Listen to state changes: when an instance becomes ready/hibernated, fetch its stats
    function onState(e) {
      const d = e.detail || {};
      if (d.state === "ready" || d.state === "hibernated") {
        fetchForInstance(d.id);
        // Also start polling while it's active
        clearInterval(timerRef.current);
        timerRef.current = setInterval(() => fetchForInstance(d.id), 8000);
      } else if (d.state === "stopped" || d.state === "crashed") {
        clearInterval(timerRef.current);
      }
    }
    window.addEventListener("cryo:instanceStateChanged", onState);
    return () => { window.removeEventListener("cryo:instanceStateChanged", onState); clearInterval(timerRef.current); };
  }, [hasBridge]);

  if (!hasBridge || !stats) return null;

  const hitRate = stats.mode === "hit" ? "hit" : stats.mode === "cold" ? "cold" : "";
  const entries = stats.totalEntries > 0 ? (stats.totalEntries > 999 ? (stats.totalEntries / 1000).toFixed(1) + "k" : String(stats.totalEntries)) : null;
  const ms = stats.totalMs > 0 ? (stats.totalMs < 1000 ? stats.totalMs + "ms" : (stats.totalMs / 1000).toFixed(1) + "s") : null;

  return React.createElement(Tip, { label: "VSpeed: last recorded data load" + (stats.instanceId ? " for " + stats.instanceId : ""), side: "bottom" },
    React.createElement("div", {
      className: "no-drag",
      style: { display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--acc-soft-2)", background: "var(--acc-soft)", cursor: "default" },
    },
      React.createElement(Icon, { name: "zap", size: 12, style: { color: "var(--acc-text)" } }),
      React.createElement("span", { className: "tnum", style: { fontSize: 11.5, fontWeight: 700, color: "var(--acc-text)", lineHeight: 1 } },
        [entries && (entries + " entries"), ms, hitRate].filter(Boolean).join(" · ") || "VSpeed"),
    ));
}

function Titlebar({ title, onSpotlight }) {
  const { settings, update, t } = useApp();
  return React.createElement("div", {
    className: "drag glass-2",
    onMouseDown: e => {
      // Start OS window drag unless the press is on an interactive control.
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest(".no-drag")) return;
      winMsg("windowDragStart");
    },
    onDoubleClick: e => { if (!(e.target.closest && e.target.closest(".no-drag"))) winMsg("windowMaximize"); },
    style: {
      height: 44, display: "flex", alignItems: "center", gap: 12, padding: "0 10px 0 18px",
      borderBottom: "1px solid var(--border)", flexShrink: 0, zIndex: 20, position: "relative",
    },
  },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9 } },
      React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--text-dim)" } }, "Cryo"),
      React.createElement(Icon, { name: "chevronRight", size: 13, style: { color: "var(--text-faint)" } }),
      React.createElement("span", { style: { fontSize: 13, fontWeight: 650, color: "var(--text)" } }, title),
    ),
    React.createElement("div", { style: { flex: 1 } }),
    React.createElement("div", { className: "no-drag", style: { display: "flex", alignItems: "center", gap: 6 } },
      /* spotlight search button */
      React.createElement(Tip, { label: "Search  (Ctrl+K)", side: "bottom" },
        React.createElement("button", {
          onClick: onSpotlight, className: "no-drag",
          style: { display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 10px", borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text-faint)", fontSize: 12.5, cursor: "pointer" },
        },
          React.createElement(Icon, { name: "search", size: 14 }),
          React.createElement("span", null, "Search"),
          React.createElement("kbd", { className: "mono", style: { marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: "var(--panel-hi)", border: "1px solid var(--border-strong)", fontSize: 10, color: "var(--text-faint)" } }, "Ctrl K"),
        )),
      React.createElement(VSpeedChip, null),
      React.createElement("div", { style: { width: 1, height: 20, background: "var(--border)", margin: "0 2px" } }),
      React.createElement(AccountChip, null),
      React.createElement("div", { style: { width: 1, height: 20, background: "var(--border)", margin: "0 2px" } }),
      React.createElement(Tip, { label: settings.lang === "en" ? "Русский" : "English", side: "bottom" },
        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "globe", onClick: () => update({ lang: settings.lang === "en" ? "ru" : "en" }) }, settings.lang.toUpperCase())),
      React.createElement(Tip, { label: t("cfg.theme"), side: "bottom" },
        React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => update({ mode: settings.mode === "dark" ? "light" : "dark" }) },
          React.createElement(Icon, { name: settings.mode === "dark" ? "sun" : "moon", size: 16 }))),
      React.createElement("div", { style: { width: 1, height: 20, background: "var(--border)", margin: "0 4px" } }),
      React.createElement(WinControls, null),
    ),
  );
}

/* ---- sidebar ---- */
function Sidebar() {
  const { route, navigate, t, settings } = useApp();
  const items = [
    ["library", "grid", "nav.library"], ["dashboard", "dashboard", "nav.dashboard"],
    ["browse", "store", "nav.browse"],
    ["assistant", "sparkles", "nav.assistant"],
    ["logs", "scroll", "nav.logs"], ["settings", "settings", "nav.settings"],
  ];
  const activeName = route.name === "instance" ? "library" : route.name;
  return React.createElement("div", {
    className: "glass-2",
    style: { width: 232, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: 14, zIndex: 10, position: "relative" },
  },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 11, padding: "8px 8px 18px" } },
      React.createElement("div", { style: { width: 34, height: 34, borderRadius: 10, background: "var(--acc-grad)", display: "grid", placeItems: "center", color: "var(--acc-ink)", boxShadow: "0 6px 18px -8px var(--acc-glow)" } },
        React.createElement(Icon, { name: "snowflake", size: 19 })),
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 16, fontWeight: 740, letterSpacing: "-0.01em", lineHeight: 1 } }, "Cryo"),
        React.createElement("div", { style: { fontSize: 10, color: "var(--text-faint)", marginTop: 3, fontWeight: 500 } }, "VSpeed engine")),
    ),
    React.createElement("nav", { style: { display: "flex", flexDirection: "column", gap: 3 } },
      items.map(([name, icon, key]) => {
        const active = activeName === name;
        return React.createElement("button", {
          key: name, onClick: () => navigate(name), className: "no-drag",
          style: {
            display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: "var(--r-md)", border: "none", textAlign: "left",
            background: active ? "var(--acc-soft)" : "transparent", color: active ? "var(--acc-text)" : "var(--text-dim)",
            fontSize: 13.5, fontWeight: active ? 650 : 550, position: "relative", transition: "background .18s, color .18s",
          },
          onMouseEnter: e => { if (!active) e.currentTarget.style.background = "var(--panel-2)"; },
          onMouseLeave: e => { if (!active) e.currentTarget.style.background = "transparent"; },
        },
          active && React.createElement("span", { style: { position: "absolute", left: 0, top: 9, bottom: 9, width: 3, borderRadius: 3, background: "var(--acc-grad)" } }),
          React.createElement(Icon, { name: icon, size: 18 }), t(key));
      }),
    ),
    React.createElement("div", { style: { flex: 1 } }),
    React.createElement(StatusWidget, null),
  );
}

function StatusWidget() {
  const { t, api, hasBridge } = useApp();
  const [ver, setVer] = aS("1.0.0");
  aE(() => { if (hasBridge && api.getAppVersion) api.getAppVersion().then(v => v && v.version && setVer(v.version)).catch(() => {}); }, [hasBridge]);
  return React.createElement("div", {
    style: { borderRadius: "var(--r-lg)", padding: 12, background: "var(--panel-2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 9 },
  },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
      React.createElement("span", { style: { width: 7, height: 7, borderRadius: 99, background: "var(--success)", boxShadow: "0 0 8px var(--success)" } }),
      React.createElement("span", { style: { fontSize: 11.5, fontWeight: 600, color: "var(--text)" } }, t("status.javaOk")),
      React.createElement("span", { className: "mono", style: { fontSize: 10.5, color: "var(--text-faint)", marginLeft: "auto" } }, "21")),
    React.createElement("div", { className: "hr" }),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
      React.createElement(Icon, { name: "zap", size: 13, style: { color: "var(--acc-2)" } }),
      React.createElement("span", { style: { fontSize: 11, color: "var(--text-dim)" } }, t("status.engine")),
      React.createElement("span", { className: "mono", style: { fontSize: 10.5, color: "var(--text-faint)", marginLeft: "auto" } }, "v" + ver)),
  );
}

/* ---- router ---- */
function Router() {
  const { route } = useApp();
  const { name, params } = route;
  if (name === "instance") return React.createElement(window.CryoInstanceDetail.InstanceDetail, { id: params.id, initialTab: params.tab, autoLaunch: params.autoLaunch, key: params.id + (params.autoLaunch ? "-al" : "") });
  if (name === "dashboard") return React.createElement(window.CryoDashboard.DashboardScreen, null);
  if (name === "browse") return React.createElement(window.CryoModrinth.ModrinthScreen, null);
  if (name === "assistant") return React.createElement(window.CryoAssistant.AssistantScreen, null);
  if (name === "logs") return React.createElement(window.CryoLogs.LogsScreen, null);
  if (name === "settings") return React.createElement(window.CryoSettings.SettingsScreen, null);
  return React.createElement(window.CryoLibrary.LibraryScreen, null);
}

function titleFor(route, t) {
  if (route.name === "instance") return t("status.instance");
  return t("nav." + route.name);
}

function Shell() {
  const { settings, route, navigate, t, api, hasBridge } = useApp();
  const [spotlight, setSpotlight] = aS(false);
  const [instances, setInstances] = aS([]);

  // Load real instances for the command palette
  aE(() => {
    api.getInstances().then(setInstances).catch(() => setInstances([]));
  }, [api]);

  // NOTE: the crash auto-diagnose (auto-opening the Assistant with the crash
  // attached on every "crashed" state) was removed on user request — crashes now
  // only show the toast from instance.js; the Logs screen's "Ask AI" button is
  // the manual way to send a crash to the assistant.

  // Auto-update: silently check GitHub once on startup; toast if an update is ready.
  aE(() => {
    if (!hasBridge || !api.checkForUpdate) return;
    let cancelled = false;
    const id = setTimeout(() => {
      api.checkForUpdate().then(r => {
        if (cancelled || !r || !r.ok || !r.installed || !r.available) return;
        window.toast && window.toast({
          tone: "accent", icon: "download", title: "Update available — v" + r.version,
          body: "Open Settings → About to install it.",
        });
      }).catch(() => {});
    }, 4000);   // let the UI settle first
    return () => { cancelled = true; clearTimeout(id); };
  }, [hasBridge]);

  // Remember the instance that last started launching, so the Logs screen can default
  // to it (works even when launched from the tray or a different screen).
  aE(() => {
    function onState(e) {
      const ev = e.detail || {};
      if (ev.state === "loading" || ev.state === "waking") window.__cryoLastLaunched = ev.id;
    }
    window.addEventListener("cryo:instanceStateChanged", onState);
    return () => window.removeEventListener("cryo:instanceStateChanged", onState);
  }, []);

  // keyboard shortcuts
  aE(() => {
    function handle(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "1") { e.preventDefault(); navigate("library"); }
      else if (e.key === "2") { e.preventDefault(); navigate("dashboard"); }
      else if (e.key === "4") { e.preventDefault(); navigate("assistant"); }
      else if (e.key === "3") { e.preventDefault(); navigate("logs"); }
      else if (e.key === ",") { e.preventDefault(); navigate("settings"); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); setSpotlight(s => !s); }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [navigate]);

  return React.createElement("div", { style: { height: "100%", display: "flex", flexDirection: "column", position: "relative", background: "var(--bg-0)" } },
    React.createElement(Background, { bg: settings.bg }),
    React.createElement(SnowField, null),
    React.createElement(Titlebar, { title: titleFor(route, t), onSpotlight: () => setSpotlight(true) }),
    React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0, position: "relative", zIndex: 5 } },
      React.createElement(Sidebar, null),
      React.createElement("main", { id: "cryo-main", style: { flex: 1, overflowY: "auto", position: "relative" } },
        React.createElement(Router, null),
      ),
    ),
    React.createElement(window.ToastContainer, null),
    spotlight && React.createElement(window.Spotlight, {
      instances,
      onNavigate: (name, params) => navigate(name, params || {}),
      onClose: () => setSpotlight(false),
    }),
  );
}

function App() {
  return React.createElement(window.CryoStore.AppProvider, null, React.createElement(Shell, null));
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App, null));
