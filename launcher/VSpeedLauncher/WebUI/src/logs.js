/* ============================================================
   Cryo — Logs: a live, fully colour-coded debug console.
   Per-segment colouring (time / level / thread / source / message),
   auto-hued threads & mod sources, per-level counts, click-to-filter,
   source + thread + level filters, regex search, crash banner, live tail.
   ============================================================ */
const { useState: gS, useEffect: gE, useMemo: gM, useRef: gR, useCallback: gCb } = React;
var { useApp } = window.CryoStore;

const LEVEL_META = {
  TRACE: { color: "var(--text-faint)", bg: "transparent" },
  DEBUG: { color: "var(--text-faint)", bg: "transparent" },
  INFO:  { color: "var(--text-dim)",   bg: "transparent" },
  WARN:  { color: "var(--warn)",       bg: "var(--warn-dim)" },
  ERROR: { color: "var(--error)",      bg: "var(--error-dim)" },
  FATAL: { color: "#fff",              bg: "color-mix(in oklab, var(--error) 60%, transparent)" },
};
const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
const TAIL_CAP = 1200;   // most recent lines kept in the DOM (console stays snappy)

// Stable auto-colour for a thread / source name, so each subsystem or mod is
// instantly recognisable in the stream (consistent hue per name).
const _hueCache = {};
function hueFor(s) {
  if (!s) return "var(--text-faint)";
  if (_hueCache[s] != null) return _hueCache[s];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0);
  const c = "hsl(" + (h % 360) + " 62% 64%)";
  _hueCache[s] = c;
  return c;
}

function highlight(text, query, regex) {
  if (!query) return text;
  let re;
  try { re = regex ? new RegExp("(" + query + ")", "gi") : new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"); }
  catch { return text; }
  const parts = String(text).split(re);
  return parts.map((p, i) => re.test(p) && i % 2 === 1
    ? React.createElement("mark", { key: i, style: { background: "var(--acc-soft-2)", color: "var(--acc-text)", borderRadius: 3, padding: "0 1px" } }, p)
    : p);
}

function LogsScreen() {
  const { api, hasBridge, t, fmt, settings, navigate } = useApp();
  const [instances, setInstances] = gS([]);
  const [instId, setInstId] = gS(null);
  const [state, setState] = gS("loading");
  const [all, setAll] = gS([]);
  const [visibleCount, setVisibleCount] = gS(0);
  const [paused, setPaused] = gS(false);
  const [autoscroll, setAutoscroll] = gS(true);
  const [q, setQ] = gS("");
  const [regex, setRegex] = gS(false);
  const [levels, setLevels] = gS({ TRACE: true, DEBUG: true, INFO: true, WARN: true, ERROR: true, FATAL: true });
  const [thread, setThread] = gS("all");
  const [src, setSrc] = gS("all");
  const [expanded, setExpanded] = gS({});
  const scrollRef = gR(null);
  const errSeqRef = gR(0);

  function askAI(prompt, attachObj) {
    window.__cryoAssistantPreload = { instanceId: instId, attach: attachObj || { logs: true, crash: true }, prompt, autoSend: true };
    navigate("assistant");
  }

  gE(() => {
    api.getInstances().then(list => {
      setInstances(list);
      if (list.length) {
        const last = window.__cryoLastLaunched;
        const prefer = last && list.some(i => i.id === last) ? last : list[0].id;
        setInstId(prev => prev || prefer);
      } else setState("empty");
    }).catch(() => setState("error"));
  }, []);

  // Auto-switch to whatever instance starts launching (so you watch it boot live).
  gE(() => {
    function onState(e) {
      const ev = e.detail || {};
      if (ev.state === "loading" || ev.state === "waking") { window.__cryoLastLaunched = ev.id; setInstId(ev.id); }
    }
    window.addEventListener("cryo:instanceStateChanged", onState);
    return () => window.removeEventListener("cryo:instanceStateChanged", onState);
  }, []);

  async function load() {
    if (!instId) return;
    setState("loading");
    setAll([]); setVisibleCount(0); setExpanded({});
    try {
      const logs = await api.getLogs(instId);
      setAll(logs); setVisibleCount(logs.length); setState("ready");
    } catch (e) { console.error("[Logs] load failed:", e); setState("error"); }
  }
  gE(() => { if (instId) { setThread("all"); setSrc("all"); load(); } }, [instId]);

  // Live tail: re-read the log file every ~1.2s so new lines stream in.
  gE(() => {
    if (!hasBridge || !instId || state !== "ready" || paused) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const logs = await api.getLogs(instId);
        if (!alive) return;
        setAll(prev => {
          if (prev.length === logs.length && (logs.length === 0 || prev[prev.length - 1].msg === logs[logs.length - 1].msg)) return prev;
          return logs;
        });
        setVisibleCount(logs.length);
      } catch {}
    }, 1200);
    return () => { alive = false; clearInterval(iv); };
  }, [hasBridge, instId, state, paused]);

  // Mock-only progressive reveal (preview mode has no bridge to poll).
  gE(() => {
    if (hasBridge || state !== "ready" || paused) return;
    if (visibleCount >= all.length) return;
    const id = setInterval(() => setVisibleCount(c => Math.min(all.length, c + 1)), 850);
    return () => clearInterval(id);
  }, [hasBridge, state, paused, visibleCount, all.length]);

  const live = gM(() => all.slice(0, visibleCount), [all, visibleCount]);
  const threads = gM(() => ["all", ...Array.from(new Set(all.map(l => l.thread).filter(Boolean)))], [all]);
  const sources = gM(() => ["all", ...Array.from(new Set(all.map(l => l.src).filter(Boolean)))].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)), [all]);
  const counts = gM(() => { const c = {}; for (const l of live) c[l.level] = (c[l.level] || 0) + 1; return c; }, [live]);

  const filtered = gM(() => {
    let re = null;
    if (q && regex) { try { re = new RegExp(q, "i"); } catch { re = null; } }
    return live.filter(l => {
      if (!levels[l.level]) return false;
      if (thread !== "all" && l.thread !== thread) return false;
      if (src !== "all" && l.src !== src) return false;
      if (q) {
        const hay = l.raw || l.msg || "";
        if (re) return re.test(hay);
        return hay.toLowerCase().includes(q.toLowerCase());
      }
      return true;
    });
  }, [live, levels, thread, src, q, regex]);

  const shown = gM(() => (filtered.length > TAIL_CAP ? filtered.slice(-TAIL_CAP) : filtered), [filtered]);
  const errorCount = gM(() => filtered.reduce((a, l) => a + (l.level === "ERROR" || l.level === "FATAL" ? 1 : 0), 0), [filtered]);
  const hasCrash = gM(() => all.some(l => {
    const s = l.raw || l.msg || "";
    return s.includes("---- Minecraft Crash Report ----")
        || s.includes("A fatal error has been detected by the Java Runtime")
        || /Exception in thread "main"/.test(s)
        || /Failed to start the (?:minecraft|integrated) server/i.test(s);
  }), [all]);

  gE(() => {
    if (autoscroll && !paused && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [shown, autoscroll, paused]);

  function onScroll(e) {
    const el = e.target;
    setAutoscroll(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  function jumpNextError() {
    const errs = shown.filter(l => l.level === "ERROR" || l.level === "FATAL");
    if (!errs.length || !scrollRef.current) return;
    setAutoscroll(false);
    const idx = errSeqRef.current % errs.length;
    errSeqRef.current = idx + 1;
    const el = scrollRef.current.querySelector('[data-log-id="' + errs[idx].id + '"]');
    if (el) el.scrollIntoView({ block: "center" });
  }

  const lvlToggle = lv => setLevels(s => ({ ...s, [lv]: !s[lv] }));
  const errorsOnly = !levels.INFO && !levels.DEBUG && !levels.TRACE && levels.ERROR;
  const toggleErrorsOnly = () => setLevels(errorsOnly
    ? { TRACE: true, DEBUG: true, INFO: true, WARN: true, ERROR: true, FATAL: true }
    : { TRACE: false, DEBUG: false, INFO: false, WARN: true, ERROR: true, FATAL: true });

  return React.createElement("div", { style: { padding: "20px 30px", maxWidth: 1320, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" } },
      React.createElement("h1", { style: { margin: 0, fontSize: 24, fontWeight: 720, letterSpacing: "-0.02em" } }, t("logs.title")),
      React.createElement(Select, { value: instId, onChange: id => setInstId(id), size: "sm", width: 220, icon: "gem",
        options: instances.map(i => ({ value: i.id, label: i.name })) }),
      hasBridge && state === "ready" && !paused && React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "var(--success)" } },
        React.createElement("span", { style: { width: 7, height: 7, borderRadius: 99, background: "var(--success)", animation: "pulseGlow 1.6s ease-in-out infinite" } }), "LIVE"),
      React.createElement("div", { style: { flex: 1 } }),
      hasBridge && React.createElement(Btn, { variant: "outline", size: "sm", icon: "terminal",
        onClick: () => api.openConsole && api.openConsole(instId).catch(() => {}) }, "Pop out"),
      state === "ready" && React.createElement("span", { className: "tnum", style: { fontSize: 12, color: "var(--text-faint)" } }, t("logs.count", { n: filtered.length })),
    ),

    hasCrash && React.createElement("div", {
      className: "anim-fadeup", style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 14, borderRadius: "var(--r-lg)", background: "var(--error-dim)", border: "1px solid color-mix(in oklab, var(--error) 32%, transparent)" },
    },
      React.createElement("div", { style: { width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "color-mix(in oklab, var(--error) 20%, transparent)", color: "var(--error)" } }, React.createElement(Icon, { name: "alert", size: 18 })),
      React.createElement("div", { style: { flex: 1 } },
        React.createElement("div", { style: { fontSize: 13.5, fontWeight: 680, color: "var(--error)" } }, t("logs.crash")),
        React.createElement("div", { style: { fontSize: 12, color: "var(--text-dim)", marginTop: 1 } }, t("logs.crashBody"))),
      React.createElement(Btn, { variant: "danger", icon: "file", onClick: () => hasBridge && api.openCrashReport && api.openCrashReport(instId).then(r => !r.ok && window.toast({ tone: "warn", icon: "alert", title: "No crash report found", body: r.error || "" })) }, t("logs.openCrash")),
      hasBridge && React.createElement(Btn, { variant: "primary", icon: "sparkles", onClick: () => askAI("My game crashed. Read the crash report and recent log, explain the cause, and propose fixes.") }, "Ask AI"),
    ),

    // toolbar
    React.createElement(Card, { pad: false, style: { borderRadius: "var(--r-lg) var(--r-lg) 0 0", borderBottom: "none" } },
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9, padding: 12 } },
        // search
        React.createElement("div", { style: { display: "flex", alignItems: "stretch", gap: 0 } },
          React.createElement(TextInput, { value: q, onChange: setQ, placeholder: t("logs.searchPh"), icon: "search", size: "sm", style: { flex: 1, minWidth: 0, borderRadius: "var(--r-md) 0 0 var(--r-md)", borderRight: "none" } }),
          React.createElement("button", { onClick: () => setRegex(r => !r), className: "no-drag mono",
            style: { padding: "0 12px", flexShrink: 0, borderRadius: "0 var(--r-md) var(--r-md) 0", border: "1px solid var(--border)", fontSize: 12, fontWeight: 700, background: regex ? "var(--acc-soft)" : "var(--panel-2)", color: regex ? "var(--acc-text)" : "var(--text-dim)" } }, ".*")),
        // level chips (with live counts) + errors-only quick toggle
        React.createElement("div", { style: { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" } },
          LEVELS.map(lv => {
            const n = counts[lv] || 0;
            return React.createElement("button", { key: lv, onClick: () => lvlToggle(lv), className: "no-drag",
              style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px", height: 28, borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
                border: "1px solid " + (levels[lv] ? "transparent" : "var(--border)"),
                background: levels[lv] ? (LEVEL_META[lv].bg === "transparent" ? "var(--panel-hi)" : LEVEL_META[lv].bg) : "transparent",
                color: levels[lv] ? LEVEL_META[lv].color : "var(--text-faint)", opacity: levels[lv] ? 1 : 0.45 },
            }, lv, n > 0 && React.createElement("span", { className: "tnum", style: { fontSize: 10, fontWeight: 700, opacity: 0.85, background: "color-mix(in oklab, currentColor 18%, transparent)", borderRadius: 6, padding: "0 5px" } }, n > 9999 ? "9999+" : n));
          }),
          React.createElement("div", { style: { width: 1, height: 18, background: "var(--border)", margin: "0 4px" } }),
          React.createElement(Btn, { variant: errorsOnly ? "accentSoft" : "ghost", size: "sm", icon: "alert", onClick: toggleErrorsOnly }, errorsOnly ? "Show all" : "Errors only")),
        // filters + actions
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
          React.createElement(Select, { value: thread, onChange: setThread, size: "sm", width: 168, icon: "cpu",
            options: threads.map(th => ({ value: th, label: th === "all" ? t("common.all") + " threads" : th })) }),
          React.createElement(Select, { value: src, onChange: setSrc, size: "sm", width: 184, icon: "package",
            options: sources.map(s => ({ value: s, label: s === "all" ? t("common.all") + " sources" : s })) }),
          (thread !== "all" || src !== "all") && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "x", onClick: () => { setThread("all"); setSrc("all"); } }, "Clear"),
          React.createElement(Btn, { variant: "ghost", size: "sm", icon: "alert", onClick: jumpNextError }, t("logs.nextError") + (errorCount ? " (" + errorCount + ")" : "")),
          hasBridge && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "sparkles", onClick: () => askAI("Diagnose the recent errors and warnings in this log and tell me how to fix them.", { logs: true, crash: true }) }, "Ask AI"),
          React.createElement("div", { style: { flex: 1, minWidth: 8 } }),
          React.createElement(Tip, { label: t("logs.autoscroll") }, React.createElement(Btn, { variant: autoscroll ? "accentSoft" : "ghost", size: "icon", onClick: () => { setAutoscroll(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; } }, React.createElement(Icon, { name: "chevronDown", size: 15 }))),
          React.createElement(Btn, { variant: paused ? "accentSoft" : "ghost", size: "sm", icon: paused ? "play" : "pause", onClick: () => setPaused(p => !p) }, paused ? t("logs.resume") : t("logs.pause")),
          React.createElement(Tip, { label: "Copy" }, React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => { if (navigator.clipboard) { navigator.clipboard.writeText(filtered.map(l => l.raw || l.msg).join("\n")); window.toast({ tone: "neutral", icon: "copy", title: "Copied" }); } } }, React.createElement(Icon, { name: "copy", size: 15 }))),
          React.createElement(Tip, { label: "Export" }, React.createElement(Btn, { variant: "ghost", size: "icon", onClick: async () => { const content = filtered.map(l => l.raw || l.msg).join("\n"); if (hasBridge && api.exportLogs) { const r = await api.exportLogs(instId, content).catch(e => ({ ok: false, error: e.message })); if (r.ok) window.toast({ tone: "success", icon: "download", title: "Logs exported" }); } else if (navigator.clipboard) { navigator.clipboard.writeText(content); } } }, React.createElement(Icon, { name: "download", size: 15 }))),
          React.createElement(Tip, { label: "Clear" }, React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => { setAll([]); setVisibleCount(0); } }, React.createElement(Icon, { name: "trash", size: 15 }))),
        ),
      ),
    ),

    // console viewport
    React.createElement("div", { ref: scrollRef, onScroll: onScroll, className: "glass mono",
      style: { flex: 1, minHeight: 280, overflowY: "auto", borderRadius: "0 0 var(--r-lg) var(--r-lg)", borderTop: "none", fontSize: 12, lineHeight: "17px", padding: "8px 0" } },
      state === "loading" && React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 7 } },
        Array.from({ length: 18 }).map((_, i) => React.createElement(Skeleton, { key: i, h: 13, w: (40 + Math.random() * 55) + "%" }))),
      state === "error" && React.createElement(ErrorState, { title: t("common.error"), body: t("common.errorBody"), onRetry: load, retryLabel: t("common.retry") }),
      state === "ready" && (filtered.length === 0
        ? React.createElement("div", { style: { padding: 50, textAlign: "center", color: "var(--text-faint)", fontSize: 13 } }, all.length === 0 ? "No log yet — launch this instance to watch it boot live." : t("logs.empty"))
        : shown.map(l => React.createElement(LogLine, {
            key: l.id, line: l, q, regex, expanded: !!expanded[l.id],
            onToggle: () => setExpanded(s => ({ ...s, [l.id]: !s[l.id] })),
            onThread: () => setThread(l.thread || "all"), onSrc: () => setSrc(l.src || "all"),
            onAsk: hasBridge ? () => askAI("Explain and fix this log line:\n" + (l.raw || l.msg) + (l.stack ? "\n" + l.stack.join("\n") : "")) : null,
          }))),
    ),
  );
}

function LogLine({ line, q, regex, expanded, onToggle, onThread, onSrc, onAsk }) {
  const meta = LEVEL_META[line.level] || LEVEL_META.INFO;
  const raw = line.raw || line.msg || "";
  const structured = !!line.raw && line.msg !== line.raw;   // false = raw stdout/continuation
  const isVSpeed = raw.includes("[VSpeed-Cache]");
  const sev = line.level === "ERROR" || line.level === "FATAL";
  const edge = isVSpeed ? "var(--acc-2)" : line.level === "FATAL" ? "var(--error)" : line.level === "ERROR" ? "var(--error)" : line.level === "WARN" ? "var(--warn)" : "transparent";
  const msgColor = isVSpeed ? "var(--acc-text)" : sev ? "var(--error)" : line.level === "WARN" ? "var(--warn)" : "var(--text)";
  // time from the original line's first [..] bracket (real game time, not approximated)
  const tm = structured ? (raw.match(/^\[([^\]]+)\]/) || [])[1] : "";
  const time = tm ? (tm.indexOf(" ") >= 0 ? tm.slice(tm.indexOf(" ") + 1) : tm) : "";

  const pill = (txt, color, onClick, title) => React.createElement("button", {
    className: "no-drag", onClick: e => { e.stopPropagation(); onClick && onClick(); }, title: title,
    style: { flexShrink: 0, background: "transparent", border: "none", padding: 0, font: "inherit", cursor: "pointer", color: color, whiteSpace: "nowrap" },
  }, txt);

  return React.createElement("div", { "data-log-id": line.id },
    React.createElement("div", {
      onClick: line.stack ? onToggle : undefined,
      style: { display: "flex", alignItems: "flex-start", gap: 7, padding: "1px 16px",
        background: isVSpeed ? "var(--acc-soft)" : meta.bg, borderLeft: "2px solid " + edge,
        cursor: line.stack ? "pointer" : "default", whiteSpace: "pre-wrap", wordBreak: "break-word" },
    },
      line.stack && React.createElement(Icon, { name: expanded ? "chevronDown" : "chevronRight", size: 12, style: { flexShrink: 0, marginTop: 2, color: "var(--text-faint)" } }),
      structured
        ? React.createElement("span", { style: { flex: 1, minWidth: 0 } },
            time && React.createElement("span", { style: { color: "var(--text-faint)" } }, time + " "),
            React.createElement("span", { style: { color: meta.color, fontWeight: 700 } }, line.level + " "),
            line.thread && pill("[" + line.thread + "] ", hueFor(line.thread), onThread, "Filter to this thread"),
            line.src && pill(line.src + ": ", hueFor(line.src), onSrc, "Filter to this source"),
            React.createElement("span", { style: { color: msgColor } }, highlight(line.msg || "", q, regex)))
        : React.createElement("span", { style: { flex: 1, minWidth: 0, color: msgColor } }, highlight(raw, q, regex)),
      onAsk && sev && React.createElement("button", { className: "no-drag", onClick: e => { e.stopPropagation(); onAsk(); }, title: "Ask AI to explain & fix",
        style: { flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 6, border: "1px solid var(--acc-soft-2)", background: "var(--acc-soft)", color: "var(--acc-text)", fontSize: 10.5, fontWeight: 700, cursor: "pointer" } },
        React.createElement(Icon, { name: "sparkles", size: 12 }), "Ask AI"),
    ),
    expanded && line.stack && React.createElement("div", {
      style: { padding: "6px 16px 8px 38px", background: "var(--error-dim)", borderLeft: "2px solid var(--error)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: "17px", color: "var(--text-dim)" },
    }, line.stack.join("\n")),
  );
}

window.CryoLogs = { LogsScreen };
