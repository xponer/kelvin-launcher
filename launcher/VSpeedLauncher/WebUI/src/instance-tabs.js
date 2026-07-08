/* ============================================================
   Cryo — Instance Detail tabs: Performance / Mods / Settings
   ============================================================ */
const { useState: tS, useEffect: tE, useMemo: tM, useRef: tRf } = React;

/* ============ BENCHMARK (real data-load measurement) ============ */
function BenchmarkCard({ instance, api, hasBridge, t, fmt }) {
  const LSK = "cryo.bench." + instance.id;
  const [bench, setBench] = tS(() => {
    try { return JSON.parse(localStorage.getItem(LSK) || "{}"); } catch { return {}; }
  });
  const [stats, setStats] = tS(null);
  const [busy, setBusy] = tS(false);

  // ── Auto boot-to-menu benchmark (the one-click automatic test) ──
  const AUTOK = "cryo.bench.auto." + instance.id;
  const [auto, setAuto] = tS(() => { try { return JSON.parse(localStorage.getItem(AUTOK) || "null"); } catch { return null; } });
  const [running, setRunning] = tS(false);
  const [prog, setProg] = tS(null); // { step, totalSteps, message, mode }

  function persist(next) { setBench(next); try { localStorage.setItem(LSK, JSON.stringify(next)); } catch {} }

  async function refresh() {
    if (!hasBridge || !api.getStats) return;
    const s = await api.getStats(instance.id).catch(() => ({ available: false }));
    setStats(s);
    if (s && s.available) {
      // mode "hit" => optimized (cached); "cold" => vanilla (scanned)
      const slot = s.mode === "hit" ? "optimized" : "vanilla";
      const next = { ...bench, [slot]: { totalMs: s.totalMs, totalEntries: s.totalEntries, types: s.types, at: s.updatedAt } };
      persist(next);
    }
  }

  // Auto-refresh the measurement when the instance reaches a ready state
  tE(() => {
    if (!hasBridge) return;
    refresh();
    function onState(e) { if (e.detail.id === instance.id && (e.detail.state === "ready" || e.detail.state === "hibernated")) setTimeout(refresh, 1200); }
    window.addEventListener("cryo:instanceStateChanged", onState);
    return () => window.removeEventListener("cryo:instanceStateChanged", onState);
  }, [hasBridge, instance.id]);

  async function launch(vanilla) {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Preview mode", body: "Launch works in the desktop launcher." }); return; }
    setBusy(true);
    await api.launchInstance(instance.id, vanilla).catch(() => {});
    window.toast({
      tone: vanilla ? "neutral" : "accent",
      icon: vanilla ? "package" : "zap",
      title: vanilla ? "Launching VANILLA (no cache)" : "Launching OPTIMIZED",
      body: "Enter a world once so the data load is measured, then come back.",
    });
    setBusy(false);
  }

  // Live progress from the C# benchmark orchestrator
  tE(() => {
    function onProg(e) {
      const d = (e && e.detail) || {};
      if (d.phase === "done") {
        const res = { bootVanilla: d.bootVanilla, bootOptimized: d.bootOptimized,
                      deltaSeconds: d.deltaSeconds, deltaPercent: d.deltaPercent, at: Date.now() };
        setAuto(res); try { localStorage.setItem(AUTOK, JSON.stringify(res)); } catch {}
        setRunning(false); setProg(null);
        window.toast({ tone: "success", icon: "gauge", title: "Benchmark complete",
          body: (d.deltaSeconds > 0 ? "Turbo boot saved " + d.deltaSeconds + "s (" + d.deltaPercent + "%)"
                                    : "No measurable boot speed-up — see result below") });
      } else if (d.phase === "error") {
        setRunning(false); setProg(null);
        window.toast({ tone: "danger", icon: "alert", title: "Benchmark failed", body: d.message || "" });
      } else if (d.phase === "cancelled") {
        setRunning(false); setProg(null);
        window.toast({ tone: "warn", icon: "info", title: "Benchmark cancelled", body: "" });
      } else {
        setRunning(true);
        setProg({ step: d.step || 0, totalSteps: d.totalSteps || 3, message: d.message || "", mode: d.mode });
      }
    }
    window.addEventListener("cryo:benchmarkProgress", onProg);
    return () => window.removeEventListener("cryo:benchmarkProgress", onProg);
  }, [instance.id]);

  async function startAuto() {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Preview mode", body: "Auto-benchmark runs in the desktop launcher." }); return; }
    const ok = window.confirm(
      "Run the automated Default vs Turbo benchmark?\n\n" +
      "Cryo will launch \"" + instance.name + "\" 2–3 times (Default → Turbo training if the cache isn't built yet → Turbo measured) and close it each time at the main menu.\n\n" +
      "Needs: Cryo engine installed + signed in + VSpeed Turbo enabled (card above). Takes ~5–12 minutes; don't use the PC for gaming meanwhile.");
    if (!ok) return;
    setRunning(true); setProg({ step: 0, totalSteps: 3, message: "Starting…" });
    const r = await api.startBenchmark(instance.id).catch(e => ({ ok: false, error: String(e) }));
    if (!r || r.ok === false) {
      setRunning(false); setProg(null);
      window.toast({ tone: "danger", icon: "alert", title: "Couldn't start benchmark", body: (r && r.error) || "" });
    }
  }
  async function cancelAuto() { await api.cancelBenchmark().catch(() => {}); }

  const v = bench.vanilla, o = bench.optimized;
  const haveBoth = v && o && v.totalMs > 0 && o.totalMs > 0;
  const savedMs  = haveBoth ? v.totalMs - o.totalMs : 0;
  const savedPct = haveBoth ? Math.round((1 - o.totalMs / v.totalMs) * 100) : 0;
  const maxMs    = haveBoth ? Math.max(v.totalMs, o.totalMs) : 1;

  const bar = (label, ms, color, glow) => React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
    React.createElement("span", { style: { width: 78, fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 } }, label),
    React.createElement("div", { style: { flex: 1, height: 24, borderRadius: 7, background: "var(--panel-2)", overflow: "hidden" } },
      React.createElement("div", { style: { width: Math.max(4, (ms / maxMs) * 100) + "%", height: "100%", background: color, borderRadius: 7, transition: "width .8s var(--ease)", boxShadow: glow ? "0 0 16px var(--acc-glow)" : "none" } })),
    React.createElement("span", { className: "tnum mono", style: { width: 70, textAlign: "right", fontSize: 12.5, fontWeight: 700 } }, (ms / 1000).toFixed(2) + "s"),
  );

  // ── Auto boot-to-menu benchmark card ──
  const maxBoot = auto ? Math.max(auto.bootVanilla || 0, auto.bootOptimized || 0, 1) : 1;
  const autoBar = (label, secs, color, glow) => React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
    React.createElement("span", { style: { width: 84, fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 } }, label),
    React.createElement("div", { style: { flex: 1, height: 24, borderRadius: 7, background: "var(--panel-2)", overflow: "hidden" } },
      React.createElement("div", { style: { width: Math.max(4, ((secs > 0 ? secs : 0) / maxBoot) * 100) + "%", height: "100%", background: color, borderRadius: 7, transition: "width .8s var(--ease)", boxShadow: glow ? "0 0 16px var(--acc-glow)" : "none" } })),
    React.createElement("span", { className: "tnum mono", style: { width: 56, textAlign: "right", fontSize: 12.5, fontWeight: 700 } }, secs > 0 ? secs.toFixed(0) + "s" : "—"),
  );
  const pct = auto ? Math.round(auto.deltaPercent || 0) : 0;
  const autoCard = React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 6 } },
      React.createElement(Icon, { name: "zap", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Auto-Benchmark — Default vs Turbo"),
      React.createElement("span", { style: { marginLeft: "auto", fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--acc-text)", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", borderRadius: 999, padding: "3px 9px" } }, "automatic")),
    React.createElement("p", { style: { margin: "0 0 16px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "One click proves the speed-up on YOUR pack: Default launch → Turbo training (only if the AOT cache isn't built yet) → Turbo measured. Cryo launches the game, detects the main menu, records the time and closes it. 2–3 launches, ~5–12 min, no world entry needed. Enable VSpeed Turbo above first."),

    running
      ? React.createElement("div", null,
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--acc-text)" } }, prog ? ("Step " + prog.step + "/" + prog.totalSteps) : "…"),
            React.createElement("span", { style: { flex: 1, fontSize: 12, color: "var(--text-dim)" } }, prog ? prog.message : ""),
            React.createElement(Btn, { variant: "outline", size: "sm", onClick: cancelAuto }, "Cancel")),
          React.createElement("div", { style: { height: 8, borderRadius: 6, background: "var(--panel-2)", overflow: "hidden" } },
            React.createElement("div", { style: { height: "100%", width: (prog ? (prog.step / prog.totalSteps) * 100 : 0) + "%", background: "var(--acc-grad)", transition: "width .6s var(--ease)" } })))
      : React.createElement(Btn, { variant: "primary", icon: "gauge", onClick: startAuto }, "Run Auto-Benchmark (Default vs Turbo)"),

    auto && !running && React.createElement("div", { style: { marginTop: 16 } },
      (auto.bootVanilla > 0 && auto.bootOptimized > 0)
        ? React.createElement("div", null,
            React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 } },
              React.createElement("span", { className: "tnum", style: { fontSize: 30, fontWeight: 760, color: auto.deltaSeconds > 0 ? "var(--success)" : "var(--text-dim)" } }, (auto.deltaSeconds > 0 ? "−" : "+") + Math.abs(pct) + "%"),
              React.createElement("span", { style: { fontSize: 13, color: "var(--text-dim)" } }, "boot-to-menu · " + (auto.deltaSeconds > 0 ? ("saved " + auto.deltaSeconds + "s") : "no speed-up"))),
            autoBar("Default", auto.bootVanilla, "var(--text-faint)", false),
            autoBar("Turbo", auto.bootOptimized, "var(--acc-grad)", true),
            React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", marginTop: 8 } },
              "boot-to-menu · VSpeed Turbo (Java 25 AOT cache) vs the default launch. Data-load (recipes) is measured separately below."))
        : React.createElement("div", { style: { padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
            "Last run incomplete — " + (auto.bootVanilla > 0 ? ("Default " + auto.bootVanilla + "s") : "Default —") + " · " + (auto.bootOptimized > 0 ? ("Turbo " + auto.bootOptimized + "s") : "Turbo —") + ". Run it again.")));

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
    autoCard,
    React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 6 } },
      React.createElement(Icon, { name: "gauge", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Benchmark — data load (world entry)"),
      hasBridge && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", style: { marginLeft: "auto" }, onClick: refresh }, "Refresh")),
    React.createElement("p", { style: { margin: "0 0 16px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Launch each mode and enter a world once. The mod measures how long recipes + advancements take to load, and Cryo compares them. (This is what VSpeed accelerates — not the boot-to-menu time.)"),

    // launch buttons
    React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 } },
      React.createElement(Btn, { variant: "primary", icon: "zap", disabled: busy, onClick: () => launch(false) }, "Launch — Optimized"),
      React.createElement(Btn, { variant: "outline", icon: "package", disabled: busy, onClick: () => launch(true) }, "Launch — Vanilla (no cache)"),
    ),

    // comparison
    haveBoth
      ? React.createElement("div", null,
          React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 } },
            React.createElement("span", { className: "tnum", style: { fontSize: 30, fontWeight: 760, color: "var(--success)" } }, "−" + savedPct + "%"),
            React.createElement("span", { style: { fontSize: 13, color: "var(--text-dim)" } }, "data load · saved " + (savedMs / 1000).toFixed(2) + "s")),
          bar("Vanilla", v.totalMs, "var(--text-faint)", false),
          bar("VSpeed", o.totalMs, "var(--acc-grad)", true),
          React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", marginTop: 8 } },
            (o.totalEntries || 0).toLocaleString() + " entries · cached load " + (o.totalMs) + "ms vs cold scan " + (v.totalMs) + "ms"),
        )
      : React.createElement("div", { style: { padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
          v || o
            ? "Recorded " + (o ? "Optimized (" + (o.totalMs/1000).toFixed(2) + "s)" : "") + (v ? (o ? " · " : "") + "Vanilla (" + (v.totalMs/1000).toFixed(2) + "s)" : "") + ". Run the other mode to compare."
            : (stats && stats.available
                ? "Last run: " + stats.mode + " · " + (stats.totalMs/1000).toFixed(2) + "s for " + (stats.totalEntries||0).toLocaleString() + " entries. Run both modes to compare."
                : "No measurement yet. Launch a mode and enter a world once.")),
  ));
}

/* ============ VSPEED TURBO (JDK 25 AOT cache) ============ */
function TurboCard({ instance, api, hasBridge }) {
  const [st, setSt]     = tS(null);   // getTurbo result
  const [dl, setDl]     = tS(null);   // runtime download progress { message, bytesDone, bytesTotal }
  const [busy, setBusy] = tS(false);

  async function load() {
    if (!hasBridge || !api.getTurbo) return;
    const r = await api.getTurbo(instance.id).catch(() => null);
    if (r && r.ok) setSt(r);
  }
  tE(() => { load(); }, [hasBridge, instance.id]);

  // Live events: runtime download, training/crash bookkeeping, per-launch boot times.
  tE(() => {
    function onProg(e) { setDl(e.detail || {}); }
    function onDone() {
      setDl(null); load();
      window.toast({ tone: "success", icon: "zap", title: "Java 25 runtime installed",
        body: "Turbo is ready — the next launch records the AOT cache." });
    }
    function onErr(e) {
      setDl(null); load();
      window.toast({ tone: "danger", icon: "alert", title: "Turbo runtime install failed", body: (e.detail && e.detail.error) || "" });
    }
    function onEvt(e) {
      const d = e.detail || {};
      if (d.id !== instance.id) return;
      load();
      if (d.phase === "trained")
        window.toast({ tone: "success", icon: "zap", title: "Turbo cache built",
          body: (d.cacheSizeMb || 0) + " MB — every launch now starts from it." });
      else if (d.phase === "crashed")
        window.toast({ tone: "danger", icon: "alert", title: "Turbo launch crashed",
          body: d.message || "Turbo was disabled — normal launch works again." });
      else if (d.phase === "assembling")
        window.toast({ tone: "accent", icon: "refresh", title: "Building Turbo cache…",
          body: d.message || "The AOT cache is being assembled in the background — several minutes on a big pack." });
      else if (d.phase === "trainIncomplete")
        window.toast({ tone: "warn", icon: "info", title: "Turbo cache not saved",
          body: "Quit the game normally (not the Stop button) after a training launch so the cache can be written." });
    }
    function onBoot(e) { if (e.detail && e.detail.id === instance.id) load(); }
    window.addEventListener("cryo:turboProgress", onProg);
    window.addEventListener("cryo:turboDone",     onDone);
    window.addEventListener("cryo:turboError",    onErr);
    window.addEventListener("cryo:turboEvent",    onEvt);
    window.addEventListener("cryo:bootMeasured",  onBoot);
    return () => {
      window.removeEventListener("cryo:turboProgress", onProg);
      window.removeEventListener("cryo:turboDone",     onDone);
      window.removeEventListener("cryo:turboError",    onErr);
      window.removeEventListener("cryo:turboEvent",    onEvt);
      window.removeEventListener("cryo:bootMeasured",  onBoot);
    };
  }, [instance.id]);

  async function toggle(on) {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Preview mode", body: "Turbo works in the desktop launcher." }); return; }
    setBusy(true);
    const r = await api.setTurbo(instance.id, on).catch(() => null);
    setBusy(false);
    if (on && r && r.installing)
      window.toast({ tone: "accent", icon: "zap", title: "Downloading Java 25 runtime…",
        body: "~50 MB, one time. Turbo activates when it finishes." });
    await load();
  }

  async function reset() {
    if (!window.confirm("Delete the Turbo AOT cache?\n\nThe next Turbo launch will re-record it (one slower training launch).")) return;
    const r = await api.resetTurbo(instance.id).catch(e => ({ ok: false, error: String(e) }));
    await load();
    if (r && r.ok)
      window.toast({ tone: "neutral", icon: "refresh", title: "Turbo cache reset", body: "The next launch trains again." });
    else
      window.toast({ tone: "warn", icon: "info", title: "Couldn't reset", body: (r && r.error) || "" });
  }

  const MODE_META = {
    "default":  { label: "Default",        color: "var(--text-faint)" },
    "standard": { label: "Default",        color: "var(--text-faint)" },
    "training": { label: "Turbo training", color: "#FBBF77" },
    "turbo":    { label: "Turbo",          color: "var(--acc-2)" },
  };
  function ago(t) {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1)   return "just now";
    if (m < 60)  return m + " min ago";
    if (m < 1440) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " d ago";
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  const boots    = (st && st.boots) || [];
  const turboAvg = avg(boots.filter(b => b.mode === "turbo").map(b => b.secs));
  const defAvg   = avg(boots.filter(b => b.mode === "standard" || b.mode === "default").map(b => b.secs));
  const livePct  = (turboAvg > 0 && defAvg > 0) ? Math.round((1 - turboAvg / defAvg) * 100) : null;
  const maxBoot  = Math.max(1, ...boots.map(b => b.secs));

  const badge = !st ? null
    : !st.supported  ? React.createElement(Badge, { tone: "neutral" }, "MC 1.20.5+ only")
    : !st.enabled    ? React.createElement(Badge, { tone: "neutral" }, "off")
    : dl             ? React.createElement(Badge, { tone: "warn", icon: "refresh" }, "installing runtime")
    : !st.javaReady  ? React.createElement(Badge, { tone: "warn" }, "runtime missing")
    : st.trained     ? React.createElement(Badge, { tone: "success", dot: true }, "ready")
    : React.createElement(Badge, { tone: "warn", dot: true }, "trains on next launch");

  const stat = (label, value) => React.createElement("div", null,
    React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", fontWeight: 600, marginBottom: 4 } }, label),
    React.createElement("div", { className: "tnum", style: { fontSize: 13.5, fontWeight: 600, color: "var(--text)" } }, value));

  const canToggle = st && st.supported && st.engineInstalled && !busy && !dl;

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)", border: "1px solid var(--acc-soft-2)" } },
    // header
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 6, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "zap", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "VSpeed Turbo — Java 25 AOT cache"),
      badge,
      st && React.createElement("div", { style: { marginLeft: "auto" } },
        React.createElement(Toggle, { checked: !!st.enabled, disabled: !canToggle, onChange: toggle }))),
    React.createElement("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Runs the pack on a Java 25 runtime with an ahead-of-time cache: the first Turbo launch records everything the JVM loads and compiles; every launch after starts from that snapshot instead of redoing it. Changing mods re-trains automatically."),

    // gating hints
    st && !st.supported && React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)" } },
      "This pack is on Minecraft " + (instance.mc || "< 1.20.5") + " — Turbo needs a Java-21-era pack (MC 1.20.5+)."),
    st && st.supported && !st.engineInstalled && React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)" } },
      "Turbo launches through the Cryo engine — install it in the \"Cryo engine\" card below first."),

    // runtime download progress
    dl && React.createElement("div", { style: { margin: "6px 0 12px" } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-dim)", marginBottom: 6 } },
        React.createElement("span", null, dl.message || "Downloading…"),
        dl.bytesTotal > 0 && React.createElement("span", { className: "tnum" },
          Math.round((dl.bytesDone || 0) / 1048576) + " / " + Math.round(dl.bytesTotal / 1048576) + " MB")),
      React.createElement("div", { style: { height: 8, borderRadius: 6, background: "var(--panel-2)", overflow: "hidden" } },
        React.createElement("div", { style: { height: "100%", width: (dl.bytesTotal > 0 ? Math.round((dl.bytesDone || 0) / dl.bytesTotal * 100) : 30) + "%", background: "var(--acc-grad)", transition: "width .3s var(--ease)" } }))),

    // last error (e.g. auto-disabled after a Java-25 crash)
    st && st.lastError && React.createElement("div", { style: { margin: "6px 0 12px", padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--error-dim)", border: "1px solid color-mix(in oklab, var(--error) 30%, transparent)", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
      st.lastError),

    // training hint
    st && st.enabled && st.javaReady && !st.trained && !dl && React.createElement("div", { style: { margin: "6px 0 12px", padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
      "Next launch = training launch: it records the cache (can be a touch slower) and saves it when you ",
      React.createElement("b", null, "quit the game normally"),
      " — don't force-Stop it. Every launch after that uses the cache."),

    // status grid
    st && st.enabled && React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, margin: "4px 0 12px" } },
      stat("Runtime", st.javaReady ? ("Temurin " + (st.javaVersion || "25")) : "not installed"),
      stat("AOT cache", st.trained ? (st.cacheSizeMb + " MB") : "not built yet"),
      stat("Trained", st.trainedAt > 0 ? ago(st.trainedAt) : "—")),

    // measured boots from real launches
    boots.length > 0 && React.createElement("div", { style: { marginTop: 4 } },
      React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 } },
        React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", fontWeight: 600 } }, "MEASURED BOOTS (to main menu)"),
        livePct != null && React.createElement("span", { className: "tnum", style: { fontSize: 13, fontWeight: 760, color: livePct > 0 ? "var(--success)" : "var(--text-dim)" } },
          (livePct > 0 ? "−" : "+") + Math.abs(livePct) + "% vs default")),
      boots.map((b, i) => {
        const meta = MODE_META[b.mode] || { label: b.mode, color: "var(--text-faint)" };
        return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 5 } },
          React.createElement("span", { style: { width: 104, fontSize: 11.5, fontWeight: 600, color: meta.color } }, meta.label),
          React.createElement("div", { style: { flex: 1, height: 16, borderRadius: 5, background: "var(--panel-2)", overflow: "hidden" } },
            React.createElement("div", { style: { width: Math.max(3, (b.secs / maxBoot) * 100) + "%", height: "100%", background: meta.color, borderRadius: 5, opacity: 0.85 } })),
          React.createElement("span", { className: "tnum mono", style: { width: 42, textAlign: "right", fontSize: 12, fontWeight: 700 } }, b.secs + "s"),
          React.createElement("span", { style: { width: 74, textAlign: "right", fontSize: 10.5, color: "var(--text-faint)" } }, ago(b.t)));
      })),

    // actions
    st && st.enabled && st.trained && React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 10 } },
      React.createElement(Btn, { variant: "subtle", size: "sm", icon: "refresh", onClick: reset }, "Reset cache")));
}

/* ============ SPEED BOOSTERS (Defender · ModernFix dynamic resources) ============ */
function SpeedBoostersCard({ instance, api, hasBridge }) {
  const [st, setSt] = tS(null);        // getSpeedTweaks result
  const [busyDef, setBusyDef] = tS(false);

  async function load() {
    if (!hasBridge || !api.getSpeedTweaks) return;
    const r = await api.getSpeedTweaks(instance.id).catch(() => null);
    if (r && r.ok) setSt(r);
  }
  tE(() => { load(); }, [hasBridge, instance.id]);

  async function excludeDefender() {
    const ok = window.confirm(
      "Exclude this instance and Cryo's game files from Windows Defender real-time scanning?\n\n" +
      "Defender re-scans hundreds of mod jars on EVERY launch — on big packs that's a large share of boot time. " +
      "Excluding these folders skips that. Only install mods from sources you trust (Modrinth / CurseForge).\n\n" +
      "Windows will show an administrator permission prompt — click Yes there.");
    if (!ok) return;
    setBusyDef(true);
    const r = await api.addDefenderExclusion(instance.id).catch(e => ({ ok: false, error: String(e) }));
    setBusyDef(false);
    if (r && r.ok)
      window.toast({ tone: "success", icon: "shield", title: "Defender exclusion added", body: "Mod scanning is skipped from the next launch." });
    else
      window.toast({ tone: "warn", icon: "info", title: "Not excluded", body: (r && r.error) || "" });
    load();
  }

  async function toggleDynRes(on) {
    const r = await api.setDynamicResources(instance.id, on).catch(() => null);
    if (r && r.ok)
      window.toast({ tone: on ? "accent" : "neutral", icon: "zap",
        title: on ? "Dynamic resources ON" : "Dynamic resources OFF",
        body: on ? "Models now load on demand — takes effect next launch. If item/block visuals glitch, switch it back off."
                 : "Back to loading all models upfront." });
    load();
  }

  const row = (title, desc, control) => React.createElement("div",
    { style: { display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border)" } },
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 13.5, fontWeight: 650 } }, title),
      React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", marginTop: 2, lineHeight: 1.45 } }, desc)),
    control);

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 4 } },
      React.createElement(Icon, { name: "gauge", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Speed boosters")),

    row("Windows Defender exclusion",
        "Skips real-time scanning of this instance's mods + Cryo's game files on every launch — often 20–40% of the mod-scan phase on big packs.",
        st && st.defenderExcluded
          ? React.createElement(Badge, { tone: "success", dot: true }, "excluded")
          : React.createElement(Btn, { variant: "outline", size: "sm", icon: busyDef ? "loader" : "shield", iconSpin: busyDef, disabled: busyDef || !st, onClick: excludeDefender },
              busyDef ? "Waiting for admin prompt…" : "Exclude (admin)")),

    row("ModernFix dynamic resources",
        st && !st.modernfixInstalled
          ? "ModernFix isn't installed — add it via the Add-mods tab (or the VSpeed Performance pack) to unlock this."
          : "Bakes block/item models on demand instead of all upfront — typically 30–50% off client boot on big packs. Rarely, a mod's visuals glitch: just switch it off again.",
        React.createElement(Toggle, { checked: !!(st && st.dynamicResources), disabled: !st || !st.modernfixInstalled, onChange: toggleDynRes })),

    React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", paddingTop: 10 } },
      "Cryo also pre-warms your mods and libraries into the OS file cache on every launch — automatic, nothing to configure."));
}

/* ============ CRYO ENGINE CARD ============ */
function EngineCard({ instance, api, hasBridge }) {
  const [status, setStatus]   = tS(null);  // { installed, versionName, mcVersion, loader, loaderVer, loggedIn, source }
  const [versions, setVers]   = tS([]);
  const [selVer, setSelVer]   = tS("");
  const [prog, setProg]       = tS(null);  // { phase, message, done?, total? }
  const [installing, setInst] = tS(false);
  const [launching, setLaunch]= tS(false);
  const [showVers, setShowV]  = tS(false);
  const [toggling, setTog]    = tS(false);

  // Load status on mount and after install/launch
  async function loadStatus() {
    if (!hasBridge || !api.getEngineStatus) return;
    const s = await api.getEngineStatus(instance.id).catch(() => null);
    if (s) setStatus(s);
  }
  tE(() => { loadStatus(); }, [hasBridge, instance.id]);

  // Event listeners: neoforgeProgress/Done/Error + engineProgress/Error
  tE(() => {
    function onNFProg(e) {
      const d = e.detail || {};
      setProg({ phase: d.phase, message: d.message || d.name || "" , done: d.done, total: d.total });
    }
    function onNFDone(e) {
      const d = e.detail || {};
      setInst(false); setProg(null);
      window.toast({ tone: "success", icon: "zap", title: "NeoForge installed", body: "Version: " + (d.versionName || "") });
      loadStatus();
    }
    function onNFErr(e) {
      const d = e.detail || {};
      setInst(false); setProg(null);
      window.toast({ tone: "danger", icon: "alert", title: "Install failed", body: d.error || "" });
    }
    function onEngProg(e) {
      const d = e.detail || {};
      if (d.phase === "launched") { setLaunch(false); setProg(null); return; }
      setProg({ phase: d.phase, message: d.message || d.name || "" });
    }
    function onEngErr(e) {
      const d = e.detail || {};
      setLaunch(false); setProg(null);
      window.toast({ tone: "danger", icon: "alert", title: "Engine launch failed", body: d.error || "" });
    }
    window.addEventListener("cryo:neoforgeProgress", onNFProg);
    window.addEventListener("cryo:neoforgeDone",     onNFDone);
    window.addEventListener("cryo:neoforgeError",    onNFErr);
    window.addEventListener("cryo:engineProgress",   onEngProg);
    window.addEventListener("cryo:engineError",      onEngErr);
    return () => {
      window.removeEventListener("cryo:neoforgeProgress", onNFProg);
      window.removeEventListener("cryo:neoforgeDone",     onNFDone);
      window.removeEventListener("cryo:neoforgeError",    onNFErr);
      window.removeEventListener("cryo:engineProgress",   onEngProg);
      window.removeEventListener("cryo:engineError",      onEngErr);
    };
  }, []);

  async function loadVersions() {
    if (!hasBridge || !status) return;
    setShowV(true);
    if (versions.length) return;
    const r = await api.getNeoForgeVersions(status.mcVersion || "1.21.1").catch(() => ({ ok: false, versions: [] }));
    if (r && r.versions) setVers(r.versions);
  }

  async function install() {
    if (!hasBridge) return;
    setInst(true); setProg({ phase: "start", message: "Starting…" });
    const r = await api.installNeoForge(instance.id, selVer).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok === false) {
      setInst(false); setProg(null);
      window.toast({ tone: "danger", icon: "alert", title: "Couldn't start install", body: r.error || "" });
    }
  }

  async function launchEngine() {
    if (!hasBridge) return;
    setLaunch(true); setProg({ phase: "start", message: "Launching…" });
    const r = await api.launchWithEngine(instance.id).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok === false) {
      setLaunch(false); setProg(null);
      window.toast({ tone: "danger", icon: "alert", title: "Launch failed", body: r.error || "" });
    }
  }

  if (!status) return null;

  const busy = installing || launching || toggling;
  const isNeoForge = (status.loader || "").toLowerCase().includes("neoforge");
  const isCryo     = status.source === "cryo";

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    // Header
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } },
      React.createElement("div", { style: { width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", color: "var(--acc-text)" } },
        React.createElement(Icon, { name: "cpu", size: 20 })),
      React.createElement("div", { style: { flex: 1 } },
        React.createElement("div", { style: { fontSize: 15, fontWeight: 680 } }, "Cryo Engine"),
        React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", marginTop: 1 } },
          "Launch without Prism · CmlLib.Core " + (status.loader || "Unknown") + " " + (status.loaderVer || ""))),
      status.installed
        ? React.createElement(Badge, { tone: "success", dot: true }, "Installed")
        : React.createElement(Badge, { tone: "neutral" }, "Not installed"),
    ),

    // Loader info row
    React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 } },
      React.createElement("div", { style: { padding: "5px 11px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)" } },
        "MC " + (status.mcVersion || "?")),
      React.createElement("div", { style: { padding: "5px 11px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)" } },
        (status.loader || "Unknown") + " " + (status.loaderVer || "")),
      status.installed && React.createElement("div", { style: { padding: "5px 11px", borderRadius: 8, background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", fontSize: 11.5, fontWeight: 600, color: "var(--acc-text)" } },
        status.versionName || ""),
    ),

    // Auth warning
    !status.loggedIn && React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--warn-dim)", border: "1px solid color-mix(in oklab, var(--warn) 30%, transparent)", fontSize: 12.5, color: "var(--warn)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 } },
      React.createElement(Icon, { name: "info", size: 15 }),
      "Sign in to your Microsoft account first (titlebar chip) to launch via engine."),

    // Not a NeoForge instance warning
    !isNeoForge && status.loader && React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 } },
      "Engine currently supports NeoForge instances. This instance uses " + (status.loader || "Unknown") + "."),

    // Progress bar
    (installing || launching) && prog && React.createElement("div", { style: { marginBottom: 14 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: "var(--text-dim)" } },
        React.createElement("span", null, prog.message || "Working…"),
        prog.done != null && prog.total > 0 && React.createElement("span", { className: "tnum" }, prog.done + " / " + prog.total)),
      React.createElement("div", { style: { height: 6, borderRadius: 99, background: "var(--panel-2)", overflow: "hidden" } },
        React.createElement("div", { style: { height: "100%", background: "var(--acc-grad)", borderRadius: 99, width: (prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0) + "%", transition: "width .4s", animation: !(prog.total > 0) ? "shimmer 1.4s linear infinite" : "none", backgroundSize: "200% 100%" } }))),

    // Action buttons
    React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } },
      // Install / Reinstall
      isNeoForge && React.createElement("div", { style: { display: "flex", gap: 0 } },
        React.createElement(Btn, {
          variant: status.installed ? "outline" : "primary",
          icon: "download", disabled: busy,
          onClick: install,
          style: showVers ? { borderRadius: "var(--r-md) 0 0 var(--r-md)", borderRight: "none" } : {},
        }, status.installed ? "Reinstall Engine" : "Install Engine"),
        React.createElement("button", {
          className: "no-drag",
          disabled: busy,
          onClick: loadVersions,
          style: { padding: "0 10px", borderRadius: "0 var(--r-md) var(--r-md) 0", border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text-dim)", fontSize: 12, cursor: "pointer" },
        }, React.createElement(Icon, { name: "chevronDown", size: 14 })),
      ),
      // Version picker (appears when chevron clicked)
      showVers && versions.length > 0 && React.createElement(Select, {
        value: selVer, onChange: setSelVer, size: "sm", width: 200,
        options: [{ value: "", label: "Latest stable" }, ...versions.slice(0, 20).map(v => ({ value: v, label: v }))],
      }),
      // Launch via engine (one-time manual launch)
      status.installed && status.loggedIn && !isCryo && React.createElement(Btn, {
        variant: "outline", icon: launching ? "refresh" : "play",
        iconSpin: launching, disabled: busy,
        onClick: launchEngine,
      }, "Test Launch"),
    ),

    // "Use as Default Engine" — makes every Launch button use the engine
    status.installed && isNeoForge && React.createElement("div", {
      style: { marginTop: 14, padding: "12px 16px", borderRadius: "var(--r-md)", background: isCryo ? "var(--acc-soft)" : "var(--panel-2)", border: "1px solid " + (isCryo ? "var(--acc-soft-2)" : "var(--border)"), display: "flex", alignItems: "center", gap: 12 },
    },
      React.createElement("div", { style: { flex: 1 } },
        React.createElement("div", { style: { fontSize: 13, fontWeight: 680, color: isCryo ? "var(--acc-text)" : "var(--text)" } }, isCryo ? "Engine is the default launcher" : "Use engine as default launcher"),
        React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 } },
          isCryo ? "The Launch button uses Cryo Engine (no Prism needed)." : "Enable to make Launch use Cryo Engine instead of Prism.")),
      React.createElement(Toggle, {
        checked: isCryo, disabled: busy || toggling,
        onChange: async (val) => {
          setTog(true);
          const r = await api.setEngineSource(instance.id, val ? "cryo" : "prism").catch(() => null);
          if (r && r.ok) { await loadStatus(); window.toast({ tone: val ? "success" : "neutral", icon: val ? "zap" : "package", title: val ? "Cryo Engine enabled" : "Prism mode restored", body: val ? "Launch button now uses engine directly." : "Launch button now uses Prism." }); }
          setTog(false);
        },
      }),
    ),

    // Footer note
    React.createElement("p", { style: { margin: "12px 0 0", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Uses the same mods/config/saves folder as Prism but without PrismLauncher itself. NeoForge libraries are downloaded once to the shared Cryo game root."),
  );
}

/* ============ BOOT WATERFALL (derived from log timestamps) ============ */
function BootWaterfall({ instance, api, hasBridge }) {
  const [data, setData]   = tS(null);   // { totalMs, phases, lineCount }
  const [loading, setLd]  = tS(false);
  const [err, setErr]     = tS("");

  async function load() {
    if (!hasBridge) return;
    setLd(true); setErr("");
    const r = await api.getBootTimeline(instance.id).catch(e => ({ ok: false, error: String(e) }));
    setLd(false);
    if (r && r.ok) setData(r); else setErr((r && r.error) || "Failed");
  }

  const PHASE_COLORS = ["#38BDF8", "#6366F1", "#A855F7", "#22D3EE", "#34D399", "#FBBF77", "#FB7185", "#67E8F9"];
  const total = data ? Math.max(1, data.totalMs) : 1;

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 6, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "activity", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Boot waterfall"),
      data && React.createElement("span", { className: "tnum", style: { fontSize: 12, color: "var(--text-faint)" } }, "total " + (data.totalMs / 1000).toFixed(1) + "s"),
      React.createElement("div", { style: { marginLeft: "auto" } },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: loading ? "refresh" : "activity", iconSpin: loading, disabled: loading, onClick: load }, loading ? "Reading…" : "Analyze last boot"))),
    React.createElement("p", { style: { margin: "0 0 8px", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Reconstructed from latest.log timestamps — where startup time actually went, phase by phase."),
    err && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)", padding: "8px 0" } }, err),
    data && data.phases.length > 0 && React.createElement("div", { style: { marginTop: 10 } },
      // Stacked bar
      React.createElement("div", { style: { display: "flex", height: 26, borderRadius: 7, overflow: "hidden", background: "var(--panel-2)", marginBottom: 14 } },
        data.phases.map((p, i) => p.durationMs > 0 && React.createElement(Tip, { key: i, label: p.name + " · " + (p.durationMs / 1000).toFixed(2) + "s" },
          React.createElement("div", { style: { width: (p.durationMs / total * 100) + "%", height: "100%", background: PHASE_COLORS[i % PHASE_COLORS.length], minWidth: 2 } })))),
      // Phase rows
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        data.phases.map((p, i) => React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 } },
          React.createElement("span", { style: { width: 10, height: 10, borderRadius: 3, background: PHASE_COLORS[i % PHASE_COLORS.length], flexShrink: 0 } }),
          React.createElement("span", { style: { flex: 1, color: "var(--text-dim)" } }, p.name),
          React.createElement("span", { className: "tnum", style: { width: 110, height: 5, borderRadius: 3, background: "var(--panel-2)", overflow: "hidden", position: "relative" } },
            React.createElement("span", { style: { position: "absolute", left: 0, top: 0, bottom: 0, width: (p.durationMs / total * 100) + "%", background: PHASE_COLORS[i % PHASE_COLORS.length] } })),
          React.createElement("span", { className: "tnum", style: { width: 56, textAlign: "right", fontWeight: 700 } }, (p.durationMs / 1000).toFixed(2) + "s"))))),
    data && data.phases.length === 0 && React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)", padding: "8px 0" } },
      "Couldn't identify phase markers in this log. Launch once and try again."));
}

/* ============ PERFORMANCE / VSPEED ============ */
function PerformanceTab({ instance, cache: cache0, t, fmt, api, hasBridge }) {
  const [cache, setCache] = tS(cache0);
  const [enabled, setEnabled] = tS(cache0.enabled);
  const [rebuilding, setRebuilding] = tS(cache0.state === "rebuilding");
  const [profile, setProfile] = tS(false);

  tE(() => { setCache(cache0); setEnabled(cache0.enabled); setRebuilding(cache0.state === "rebuilding"); }, [cache0]);

  async function rebuild() {
    setRebuilding(true);
    window.toast({ tone: "neutral", icon: "refresh", title: "Rebuilding cache…", body: instance.name });
    const res = await api.rebuildCache(instance.id);
    // Reload fresh cache info
    const fresh = await api.getCache(instance.id).catch(() => res);
    setCache(fresh); setRebuilding(false);
    window.toast({ tone: "success", icon: "database", title: "Cache ready",
      body: fmt.bytes(fresh.sizeBytes || 0) });
  }

  const ready = enabled && !rebuilding && cache.sizeBytes > 0;
  const stat = (label, value, mono = false) => React.createElement("div", null,
    React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)", fontWeight: 600, marginBottom: 4 } }, label),
    React.createElement("div", { className: (mono ? "mono " : "") + "tnum",
      style: { fontSize: 13.5, fontWeight: 600, color: "var(--text)", wordBreak: "break-all" } }, value),
  );

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
    // toggle card
    React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
        React.createElement("div", { style: { width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", color: "var(--acc-text)" } },
          React.createElement(Icon, { name: "zap", size: 22 })),
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("div", { style: { fontSize: 15, fontWeight: 680 } }, t("perf.toggle")),
          React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 } },
            enabled ? t("perf.toggleOn") : t("perf.toggleOff")),
        ),
        React.createElement(Toggle, { checked: enabled, onChange: setEnabled }),
      ),
    ),

    // VSpeed Turbo (JDK 25 AOT cache) — enable, train, see real boot times
    React.createElement(TurboCard, { instance, api, hasBridge }),

    // Speed boosters — Defender exclusion + ModernFix dynamic resources
    React.createElement(SpeedBoostersCard, { instance, api, hasBridge }),

    // benchmark (real measured speed-up + launch modes)
    React.createElement(BenchmarkCard, { instance, api, hasBridge, t, fmt }),

    // cryo standalone engine
    React.createElement(EngineCard, { instance, api, hasBridge }),

    // boot waterfall (where startup time went)
    React.createElement(BootWaterfall, { instance, api, hasBridge }),

    // status + composition
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 18 }, className: "cryo-perf-grid" },
      React.createElement(Card, { style: { borderRadius: "var(--r-xl)", opacity: enabled ? 1 : 0.55 } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 } },
          React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, t("perf.title")),
          rebuilding
            ? React.createElement(Badge, { tone: "warn", icon: "refresh" }, t("cache.rebuilding"))
            : ready ? React.createElement(Badge, { tone: "success", dot: true }, t("cache.ready"))
              : React.createElement(Badge, { tone: "neutral" }, t("cache.off"))),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 } },
          stat(t("perf.type"), "JSON / reload-listener"),
          stat(t("perf.size"), rebuilding ? "—" : fmt.bytes(cache.sizeBytes) + " gzip"),
          stat(t("perf.hash"), cache.modsetHash || "—", true),
          stat(t("perf.built"), rebuilding ? t("perf.rebuilding") : fmt.date(cache.builtAt, "en")),
        ),
        React.createElement("div", { className: "hr", style: { marginBottom: 16 } }),
        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
          React.createElement(Btn, { variant: "subtle", icon: "refresh", onClick: rebuild, disabled: rebuilding || !enabled },
            rebuilding ? t("perf.rebuilding") : t("perf.rebuild")),
          React.createElement(Tip, { label: "Enable JFR profiling for the next launch (saves vspeed-boot.jfr)" },
            React.createElement(Btn, {
              variant: profile ? "accentSoft" : "ghost",
              icon: profile ? "check" : "activity",
              onClick: async () => {
                const on = !profile;
                setProfile(on);
                if (api.setProfileNextLaunch) await api.setProfileNextLaunch(instance.id, on).catch(() => {});
                window.toast({
                  tone: on ? "accent" : "neutral",
                  icon: on ? "activity" : "x",
                  title: on ? "JFR profiling enabled" : "JFR profiling disabled",
                  body: on ? "Next launch records vspeed-boot.jfr (instance.cfg updated)" : "Removed from instance.cfg",
                });
              },
            }, t("perf.profile")),
          ),
        ),
        React.createElement("div", { style: { display: "flex", gap: 9, marginTop: 16, alignItems: "flex-start" } },
          React.createElement(Icon, { name: "hash", size: 14, style: { color: "var(--text-faint)", marginTop: 2 } }),
          React.createElement("p", { style: { margin: 0, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 } },
            t("perf.invalidate"), " ",
            React.createElement("span", { className: "mono", style: { color: "var(--text-dim)" } },
              cache.path || ".vspeed-cache/json/<type>/<hash>.bin")),
        ),
      ),
      React.createElement(Card, { style: { borderRadius: "var(--r-xl)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, opacity: enabled && ready ? 1 : 0.55 } },
        React.createElement(Donut, {
          segments: [
            { value: cache.recipes  || 1, color: "var(--acc-2)" },
            { value: cache.advancements || 1, color: "var(--acc-3)" },
          ],
          center: React.createElement("div", null,
            React.createElement("div", { className: "tnum", style: { fontSize: 19, fontWeight: 740 } }, fmt.bytes(cache.sizeBytes)),
            React.createElement("div", { style: { fontSize: 10.5, color: "var(--text-faint)" } }, "gzip cache")),
        }),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, width: "100%" } },
          React.createElement(LegendRow, { color: "var(--acc-2)", label: t("perf.recipesWord"), value: fmt.num(cache.recipes) }),
          React.createElement(LegendRow, { color: "var(--acc-3)", label: t("perf.advWord"),     value: fmt.num(cache.advancements) }),
        ),
      ),
    ),

    // honest block
    React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 16 } },
        React.createElement(Icon, { name: "shield", size: 17, style: { color: "var(--acc-2)" } }),
        React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, t("perf.honest.title")),
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }, className: "cryo-honest-grid" },
        React.createElement(HonestCard, {
          tone: "success", icon: "checkCircle", title: t("perf.honest.yes"),
          body: t("perf.honest.yesBody", { size: fmt.bytes(cache.sizeBytes || 4.8 * 1024 * 1024), cold: cache.worldEntryCold, warm: cache.worldEntryWarm }),
          chip: "−" + Math.round((1 - (cache.worldEntryWarm || 1.8) / (cache.worldEntryCold || 9.4)) * 100) + "%",
        }),
        React.createElement(HonestCard, {
          tone: "neutral", icon: "xCircle", title: t("perf.honest.no"),
          body: t("perf.honest.noBody"), chip: "no change",
        }),
      ),
    ),
  );
}
function LegendRow({ color, label, value }) {
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 } },
    React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: color } }),
    React.createElement("span", { style: { color: "var(--text-dim)", flex: 1 } }, label),
    React.createElement("span", { className: "tnum", style: { fontWeight: 700 } }, value),
  );
}
function HonestCard({ tone, icon, title, body, chip }) {
  const ok = tone === "success";
  return React.createElement("div", {
    style: {
      padding: 16, borderRadius: "var(--r-lg)",
      background: ok ? "var(--success-dim)" : "var(--panel-2)",
      border: "1px solid " + (ok ? "color-mix(in oklab, var(--success) 26%, transparent)" : "var(--border)"),
    },
  },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 9 } },
      React.createElement(Icon, { name: icon, size: 17, style: { color: ok ? "var(--success)" : "var(--text-faint)" } }),
      React.createElement("span", { style: { fontSize: 13.5, fontWeight: 680, flex: 1 } }, title),
      React.createElement(Badge, { tone: ok ? "success" : "neutral", size: "sm" }, chip),
    ),
    React.createElement("p", { style: { margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 } }, body),
  );
}

/* ============ DEPENDENCY GRAPH (radial SVG of the problem subgraph) ============ */
function DepGraph({ nodes, edges }) {
  if (!nodes || nodes.length === 0) return null;
  const W = 560, H = Math.min(360, 160 + nodes.length * 18), cx = W / 2, cy = H / 2;
  const R = Math.min(cx, cy) - 70;
  // Place nodes evenly on a circle
  const pos = {};
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  const lines = edges.filter(e => pos[e.from] && pos[e.to]).map((e, i) => {
    const a = pos[e.from], b = pos[e.to];
    return React.createElement("line", { key: "e" + i, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: "var(--error)", strokeWidth: 1.5, strokeDasharray: "4 3", opacity: 0.7 });
  });

  const dots = nodes.map((n, i) => {
    const p = pos[n.id];
    const missing = !n.installed;
    const short = n.id.length > 16 ? n.id.slice(0, 15) + "…" : n.id;
    return React.createElement("g", { key: "n" + i },
      React.createElement("circle", { cx: p.x, cy: p.y, r: 7,
        fill: missing ? "var(--error)" : "var(--acc-2)",
        stroke: "var(--bg-1)", strokeWidth: 2 }),
      React.createElement("text", { x: p.x, y: p.y - 12, textAnchor: "middle",
        fontSize: 10.5, fontWeight: 600, fill: missing ? "var(--error)" : "var(--text-dim)" }, short),
      missing && React.createElement("text", { x: p.x, y: p.y + 20, textAnchor: "middle",
        fontSize: 9, fill: "var(--error)" }, "missing"));
  });

  return React.createElement("div", { style: { marginTop: 14, borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", overflow: "hidden" } },
    React.createElement("div", { style: { padding: "8px 12px", fontSize: 11, color: "var(--text-faint)", borderBottom: "1px solid var(--border)" } },
      "Problem subgraph — red = missing/disabled required dependency, dashed = unsatisfied link"),
    React.createElement("svg", { viewBox: "0 0 " + W + " " + H, style: { width: "100%", height: H, display: "block" } },
      ...lines, ...dots));
}

/* ============ MODS ============ */
// Stable per-tag colour so a label (e.g. "optimization") always looks the same.
function modTagHue(s) {
  let h = 0; const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function modTagChip(s, big, color) {
  const base = { borderRadius: 7, fontWeight: 600, fontSize: big ? 11.5 : 10.5, lineHeight: 1.4, whiteSpace: "nowrap" };
  if (color) return { ...base,
    background: "color-mix(in oklab, " + color + " 20%, transparent)",
    color: "color-mix(in oklab, " + color + " 58%, white)",
    border: "1px solid color-mix(in oklab, " + color + " 50%, transparent)",
  };
  const h = modTagHue(s);
  return { ...base,
    background: "hsl(" + h + " 70% 50% / 0.16)",
    color: "hsl(" + h + " 85% 78%)",
    border: "1px solid hsl(" + h + " 70% 55% / 0.38)",
  };
}
// HSL→hex so the colour picker can open at a tag's current (auto) colour.
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const to = n => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return "#" + to(0) + to(8) + to(4);
}
function tagEffectiveHex(tag, colors) {
  if (colors && colors[tag]) return colors[tag];
  return hslToHex(modTagHue(tag), 68, 60);
}

// Inline editor shown under a mod row: manage its user tags + a free-text note.
function ModMetaEditor({ m, onTags, onNote, allTags, tagColors, onColor }) {
  const [val, setVal]   = tS("");
  const [note, setNote] = tS(m.note || "");
  tE(() => setNote(m.note || ""), [m.note, m.id]);
  const tags = m.tags || [];
  function add(raw) {
    const parts = String(raw).split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = tags.slice();
    parts.forEach(p => { if (!next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p); });
    onTags(m, next.slice(0, 12)); setVal("");
  }
  const remove = tg => onTags(m, tags.filter(x => x !== tg));
  const suggestions = (allTags || []).map(a => a.tag)
    .filter(tg => !tags.some(x => x.toLowerCase() === tg.toLowerCase())).slice(0, 8);
  // Colour swatch that opens the native picker; choice applies to the tag everywhere.
  const swatch = tg => React.createElement("label", { className: "no-drag", title: "Pick tag colour",
      style: { width: 13, height: 13, borderRadius: 4, background: tagEffectiveHex(tg, tagColors), border: "1px solid rgba(255,255,255,.3)", cursor: "pointer", flexShrink: 0, position: "relative", overflow: "hidden", display: "inline-block" } },
    React.createElement("input", { type: "color", value: tagEffectiveHex(tg, tagColors), onChange: e => onColor && onColor(tg, e.target.value),
      style: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", padding: 0, width: "100%", height: "100%" } }));
  return React.createElement("div", { style: { padding: "2px 16px 14px 60px", display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)" } },
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } },
      tags.length === 0 && React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } }, "No tags yet — add your own labels to group & filter."),
      tags.map(tg => React.createElement("span", { key: tg, style: { ...modTagChip(tg, true, tagColors && tagColors[tg]), display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 7px" } },
        swatch(tg),
        tg,
        React.createElement("button", { onClick: () => remove(tg), className: "no-drag", style: { display: "grid", placeItems: "center", border: "none", background: "transparent", color: "inherit", padding: 0, opacity: 0.85, cursor: "pointer" } },
          React.createElement(Icon, { name: "x", size: 11 }))))),
    React.createElement(TextInput, { value: val, onChange: setVal, placeholder: "Add tag, press Enter (e.g. optimization, visuals, create addon)", icon: "tag", size: "sm",
      onKeyDown: e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(val); } },
      onBlur: () => add(val) }),
    suggestions.length > 0 && React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } },
      React.createElement("span", { style: { fontSize: 11, color: "var(--text-faint)" } }, "Quick add:"),
      suggestions.map(tg => React.createElement("button", { key: tg, className: "no-drag", onClick: () => add(tg), style: { ...modTagChip(tg, false, tagColors && tagColors[tg]), padding: "2px 8px", cursor: "pointer" } }, "+ " + tg))),
    React.createElement("textarea", {
      value: note, onChange: e => setNote(e.target.value),
      onBlur: () => { if (note !== (m.note || "")) onNote(m, note); },
      placeholder: "Note — why you added it, settings, reminders…", rows: 2,
      style: { width: "100%", resize: "vertical", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" },
    }));
}

function ModsTab({ instance, mods: mods0, t, fmt, api, hasBridge, onModsChanged }) {
  const [mods, setMods] = tS(mods0);
  const [q, setQ] = tS("");
  const [filter, setFilter] = tS("all");
  const [dragOver, setDragOver] = tS(false);
  const [editing, setEditing] = tS(null);   // mod.id whose tag/note editor is open
  const [tagSel, setTagSel]   = tS([]);      // active tag filters (AND)
  const [tagColors, setTagColors] = tS({});  // tag name → chosen hex (auto-hue when unset)
  const dragCnt = tRf(0);
  tE(() => setMods(mods0), [mods0]);
  tE(() => {
    if (hasBridge && api.getTagColors) api.getTagColors(instance.id).then(c => setTagColors(c || {})).catch(() => {});
  }, [instance.id]);

  // Persist tag/note edits to the bridge and reflect them locally right away.
  async function saveTags(m, tags) {
    setMods(ms => ms.map(x => x.id === m.id ? { ...x, tags } : x));
    if (hasBridge && api.setModTags) await api.setModTags(instance.id, m.file, tags).catch(() => {});
  }
  async function saveNote(m, note) {
    setMods(ms => ms.map(x => x.id === m.id ? { ...x, note } : x));
    if (hasBridge && api.setModNote) await api.setModNote(instance.id, m.file, note).catch(() => {});
  }
  async function saveTagColor(tag, color) {
    setTagColors(c => ({ ...c, [tag]: color }));
    if (hasBridge && api.setTagColor) await api.setTagColor(instance.id, tag, color).catch(() => {});
  }

  function reloadMods() {
    if (hasBridge) api.getMods(instance.id).then(m => setMods(m || [])).catch(() => {});
  }
  async function pickLocalMods() {
    if (!hasBridge || !api.addLocalMods) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
    const r = await api.addLocalMods(instance.id).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok && r.added > 0) { window.toast({ tone: "success", icon: "check", title: "Added " + r.added + " mod" + (r.added === 1 ? "" : "s") }); (onModsChanged || reloadMods)(); }
    else if (r && !r.ok) window.toast({ tone: "danger", icon: "alert", title: "Couldn't add mods", body: r.error || "" });
  }
  async function handleModDrop(e) {
    e.preventDefault(); dragCnt.current = 0; setDragOver(false);
    if (!hasBridge || !api.addLocalModData) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /\.jar$/i.test(f.name));
    if (!files.length) { window.toast({ tone: "warn", icon: "info", title: "Drop .jar files", body: "Only Minecraft mod .jar files can be added." }); return; }
    let added = 0;
    for (const f of files) {
      if (f.size > 100 * 1024 * 1024) { window.toast({ tone: "warn", icon: "alert", title: "Too large", body: f.name + " exceeds 100 MB — use the Add .jar button." }); continue; }
      try {
        const b64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(",")[1] || ""); rd.onerror = rej; rd.readAsDataURL(f); });
        const rr = await api.addLocalModData(instance.id, f.name, b64);
        if (rr && rr.ok) added++; else window.toast({ tone: "danger", icon: "alert", title: "Couldn't add " + f.name, body: (rr && rr.error) || "" });
      } catch (err) { window.toast({ tone: "danger", icon: "alert", title: "Couldn't read " + f.name }); }
    }
    if (added) { window.toast({ tone: "success", icon: "check", title: "Added " + added + " mod" + (added === 1 ? "" : "s") }); (onModsChanged || reloadMods)(); }
  }

  const optimCount = mods.filter(m => m.optimization).length;
  const updateCount = mods.filter(m => m.update).length;
  const enabledCount = mods.filter(m => m.enabled).length;

  // Union of every user tag across this instance's mods, most-used first.
  const allTags = tM(() => {
    const counts = {};
    mods.forEach(m => (m.tags || []).forEach(tg => { counts[tg] = (counts[tg] || 0) + 1; }));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .map(k => ({ tag: k, count: counts[k] }));
  }, [mods]);
  const toggleTag = tg => setTagSel(s => s.includes(tg) ? s.filter(x => x !== tg) : [...s, tg]);

  const filtered = tM(() => mods.filter(m => {
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())
        && !(m.tags || []).some(tg => tg.toLowerCase().includes(q.toLowerCase()))) return false;
    if (filter === "optim"    && !m.optimization) return false;
    if (filter === "updates"  && !m.update)       return false;
    if (filter === "disabled" && m.enabled)       return false;
    if (tagSel.length && !tagSel.every(tg => (m.tags || []).includes(tg))) return false;
    return true;
  }), [mods, q, filter, tagSel]);

  // Real toggle: rename the jar via the bridge (jar <-> jar.disabled)
  async function toggle(m) {
    if (!hasBridge || !api.setModEnabled) {
      setMods(ms => ms.map(x => x.id === m.id ? { ...x, enabled: !x.enabled } : x));
      return;
    }
    const want = !m.enabled;
    const res = await api.setModEnabled(instance.id, m.file, want).catch(e => ({ ok: false, error: e.message }));
    if (res.ok) {
      setMods(ms => ms.map(x => x.id === m.id ? { ...x, enabled: want, file: res.file, id: instance.id + "::" + res.file } : x));
      onModsChanged && onModsChanged();   // keep the header/tab mod count in sync (enabled jars)
    } else {
      window.toast({ tone: "error", icon: "alert", title: "Couldn't toggle mod", body: res.error || "" });
    }
  }

  // ── Conflict scan (structural duplicate detection + AI analysis) ──
  const { navigate: navTo } = window.CryoStore.useApp();
  const [scan, setScan] = tS(null);
  const [scanning, setScanning] = tS(false);
  async function runScan() {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
    setScanning(true);
    const r = await api.scanMods(instance.id).catch(e => ({ ok: false, error: String(e) }));
    setScanning(false);
    if (r && r.ok) { setScan(r); if (!r.duplicates.length) window.toast({ tone: "success", icon: "check", title: "No duplicate mods", body: r.total + " mods scanned" }); }
    else window.toast({ tone: "danger", icon: "alert", title: "Scan failed", body: (r && r.error) || "" });
  }
  async function disableDupes(group) {
    const extras = group.files.slice(1);
    for (const f of extras) await api.setModEnabled(instance.id, f, false).catch(() => {});
    window.toast({ tone: "success", icon: "check", title: "Disabled " + extras.length + " duplicate(s)", body: group.modId });
    setScan(s => s ? { ...s, duplicates: s.duplicates.filter(d => d.modId !== group.modId) } : s);
  }
  function analyzeAI() {
    window.__cryoAssistantPreload = { instanceId: instance.id, attach: { mods: true }, prompt: "Analyze my mod list for duplicate mods, known incompatible combinations, and missing dependencies. List concrete issues and propose disableMod fixes where justified.", autoSend: true };
    navTo("assistant");
  }

  // ── Mod updates (Modrinth hash lookup) ──
  const [updates, setUpdates]   = tS(null);   // null = not checked; [] = none; [...] = available
  const [checkingUpd, setCheck] = tS(false);
  const [updProg, setUpdProg]   = tS("");
  const [updating, setUpdating] = tS({});      // { [currentFile]: true }

  tE(() => {
    function onProg(e) { setUpdProg((e.detail && e.detail.message) || ""); }
    function onDone(e) {
      const d = e.detail || {};
      setCheck(false); setUpdProg("");
      setUpdates(d.updates || []);
      if (d.ok && (!d.updates || !d.updates.length))
        window.toast({ tone: "success", icon: "check", title: "All mods up to date", body: (d.scanned || 0) + " mods checked on Modrinth" });
    }
    function onErr(e) { setCheck(false); setUpdProg(""); window.toast({ tone: "danger", icon: "alert", title: "Update check failed", body: (e.detail && e.detail.error) || "" }); }
    function onUpdDone(e) {
      const d = e.detail || {};
      setUpdating(u => { const n = { ...u }; delete n[d.oldFile]; return n; });
      setUpdates(list => (list || []).filter(x => x.currentFile !== d.oldFile));
      window.toast({ tone: "success", icon: "check", title: "Updated", body: d.newFile || "" });
    }
    function onUpdErr(e) {
      const d = e.detail || {};
      setUpdating(u => { const n = { ...u }; delete n[d.oldFile]; return n; });
      window.toast({ tone: "danger", icon: "alert", title: "Update failed", body: (d.error || "") });
    }
    window.addEventListener("cryo:modUpdatesProgress", onProg);
    window.addEventListener("cryo:modUpdatesDone", onDone);
    window.addEventListener("cryo:modUpdatesError", onErr);
    window.addEventListener("cryo:modUpdateDone", onUpdDone);
    window.addEventListener("cryo:modUpdateError", onUpdErr);
    return () => {
      window.removeEventListener("cryo:modUpdatesProgress", onProg);
      window.removeEventListener("cryo:modUpdatesDone", onDone);
      window.removeEventListener("cryo:modUpdatesError", onErr);
      window.removeEventListener("cryo:modUpdateDone", onUpdDone);
      window.removeEventListener("cryo:modUpdateError", onUpdErr);
    };
  }, []);

  async function checkUpdates() {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
    setCheck(true); setUpdates(null); setUpdProg("Starting…");
    const r = await api.checkModUpdates(instance.id).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok === false) { setCheck(false); window.toast({ tone: "danger", icon: "alert", title: "Couldn't start", body: r.error || "" }); }
  }

  // ── Dependency graph analysis ──
  const [graph, setGraph]     = tS(null);   // { nodeCount, edgeCount, issueCount, issues, nodes, edges }
  const [analyzing, setAnalyz] = tS(false);
  async function analyzeDeps() {
    if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
    setAnalyz(true); setGraph(null);
    const r = await api.analyzeModGraph(instance.id).catch(e => ({ ok: false, error: String(e) }));
    setAnalyz(false);
    if (r && r.ok) { setGraph(r); if (!r.issueCount) window.toast({ tone: "success", icon: "check", title: "No dependency problems", body: r.nodeCount + " mods · " + r.edgeCount + " links" }); }
    else window.toast({ tone: "danger", icon: "alert", title: "Analysis failed", body: (r && r.error) || "" });
  }
  const depCard = React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "layers2", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Dependency check"),
      graph && React.createElement(Badge, { tone: graph.issueCount ? "danger" : "success", size: "sm" }, graph.issueCount ? (graph.issueCount + " issue" + (graph.issueCount !== 1 ? "s" : "")) : "all satisfied"),
      React.createElement("div", { style: { marginLeft: "auto" } },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: analyzing ? "refresh" : "layers2", iconSpin: analyzing, disabled: analyzing, onClick: analyzeDeps }, analyzing ? "Analyzing…" : "Check dependencies"))),
    React.createElement("p", { style: { margin: "8px 0 0", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 } },
      "Reads every mod's metadata and finds required dependencies that are missing or disabled — before you launch."),
    graph && graph.issues.length > 0 && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7, marginTop: 12 } },
      graph.issues.map((iss, i) => React.createElement("div", { key: i, style: { display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--error-dim)", border: "1px solid color-mix(in oklab, var(--error) 28%, transparent)" } },
        React.createElement(Icon, { name: iss.type === "disabled" ? "pause" : "alert", size: 14, style: { color: "var(--error)", marginTop: 2, flexShrink: 0 } }),
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          React.createElement("div", { style: { fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 } }, iss.message),
          iss.type === "missing" && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "search", style: { marginTop: 4 }, onClick: () => { window.__cryoModSearch = iss.dep; navTo("browse"); } }, "Find on Modrinth"))))),
    graph && graph.issueCount > 0 && React.createElement(DepGraph, { nodes: graph.nodes.filter(n => n.involved), edges: graph.edges.filter(e => !e.ok) }),
    graph && graph.issueCount === 0 && React.createElement("div", { style: { marginTop: 10, fontSize: 12.5, color: "var(--success)" } }, "✓ All required dependencies are present (" + graph.nodeCount + " mods, " + graph.edgeCount + " dependency links)."));
  async function doUpdate(u) {
    setUpdating(s => ({ ...s, [u.currentFile]: true }));
    await api.updateMod(instance.id, u.currentFile, u.url, u.newFilename, u.sha512).catch(() => {});
  }
  async function updateAll() {
    for (const u of (updates || [])) await doUpdate(u);
  }

  const updatesCard = React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "download", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Mod updates"),
      React.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
        (updates && updates.length > 0) && React.createElement(Btn, { variant: "primary", size: "sm", icon: "download", onClick: updateAll, disabled: Object.keys(updating).length > 0 }, "Update all (" + updates.length + ")"),
        React.createElement(Btn, { variant: "outline", size: "sm", icon: checkingUpd ? "refresh" : "refresh", iconSpin: checkingUpd, disabled: checkingUpd, onClick: checkUpdates }, checkingUpd ? "Checking…" : "Check for updates"))),
    checkingUpd && React.createElement("div", { style: { marginTop: 10, fontSize: 12, color: "var(--text-dim)" } }, updProg || "Working…"),
    updates && updates.length > 0 && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 } },
      updates.map(u => React.createElement("div", { key: u.currentFile, style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, u.currentFile),
          React.createElement("div", { style: { fontSize: 11, color: "var(--success)", marginTop: 2 } }, "→ " + (u.newVersion || u.newFilename))),
        React.createElement(Btn, { variant: "outline", size: "sm", icon: updating[u.currentFile] ? "refresh" : "download", iconSpin: !!updating[u.currentFile], disabled: !!updating[u.currentFile], onClick: () => doUpdate(u) }, "Update")))),
    updates && updates.length === 0 && React.createElement("div", { style: { marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" } }, "All mods are on the latest version available for this MC version + loader."));
  const scanCard = React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "package", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Conflict scan"),
      React.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
        React.createElement(Btn, { variant: "outline", size: "sm", icon: scanning ? "refresh" : "gauge", iconSpin: scanning, disabled: scanning, onClick: runScan }, scanning ? "Scanning…" : "Scan duplicates"),
        hasBridge && React.createElement(Btn, { variant: "primary", size: "sm", icon: "sparkles", onClick: analyzeAI }, "Analyze with AI"))),
    scan && (scan.duplicates.length
      ? React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 } },
          React.createElement("div", { style: { fontSize: 12, color: "var(--text-dim)" } }, scan.duplicates.length + " duplicate mod id(s) · " + scan.total + " scanned" + (scan.unknown ? " · " + scan.unknown + " without metadata" : "")),
          scan.duplicates.map(g => React.createElement("div", { key: g.modId, style: { padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } },
              React.createElement("span", { style: { fontSize: 12.5, fontWeight: 700, color: "var(--warn, #e6b450)" } }, g.modId),
              React.createElement("span", { style: { fontSize: 11, color: "var(--text-faint)" } }, g.files.length + " jars"),
              React.createElement(Btn, { variant: "outline", size: "sm", style: { marginLeft: "auto" }, onClick: () => disableDupes(g) }, "Keep 1, disable rest")),
            React.createElement("div", { className: "mono", style: { fontSize: 11, color: "var(--text-faint)", wordBreak: "break-all", lineHeight: 1.6 } }, g.files.join("  ·  ")))))
      : React.createElement("div", { style: { marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" } }, "No duplicate mod ids in " + scan.total + " mods.")));

  return React.createElement("div", {
    style: { display: "flex", flexDirection: "column", gap: 16, position: "relative" },
    onDragEnter: e => { if (hasBridge) { e.preventDefault(); dragCnt.current++; setDragOver(true); } },
    onDragOver:  e => { if (hasBridge) e.preventDefault(); },
    onDragLeave: () => { if (hasBridge && --dragCnt.current <= 0) { dragCnt.current = 0; setDragOver(false); } },
    onDrop: handleModDrop,
  },
    dragOver && React.createElement("div", { style: { position: "absolute", inset: 0, zIndex: 40, borderRadius: "var(--r-2xl)", border: "2px dashed var(--acc-2)", background: "color-mix(in oklab, var(--acc) 14%, var(--panel) 86%)", display: "grid", placeItems: "center", pointerEvents: "none" } },
      React.createElement("div", { style: { textAlign: "center", color: "var(--acc-text)" } },
        React.createElement(Icon, { name: "upload", size: 32 }),
        React.createElement("div", { style: { fontSize: 14.5, fontWeight: 700, marginTop: 8 } }, "Drop .jar mods to add them"))),
    updatesCard,
    depCard,
    scanCard,
    React.createElement(Card, { style: { borderRadius: "var(--r-xl)", padding: 0, overflow: "hidden" } },
    React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", padding: 16, borderBottom: "1px solid var(--border)", flexWrap: "wrap" } },
      React.createElement(TextInput, { value: q, onChange: setQ, placeholder: t("mods.search"), icon: "search", size: "sm", style: { flex: 1, minWidth: 180 } }),
      React.createElement(Segmented, {
        size: "sm", value: filter, onChange: setFilter,
        options: [
          { value: "all",      label: t("common.all") },
          { value: "optim",    label: t("mods.optimOnly") + " " + optimCount, icon: "zap" },
          { value: "updates",  label: t("mods.updates") + " " + updateCount },
          { value: "disabled", label: "Disabled " + (mods.length - enabledCount) },
        ],
      }),
      hasBridge && React.createElement(Btn, { variant: "outline", size: "sm", icon: "upload", onClick: pickLocalMods }, "Add .jar"),
    ),
    allTags.length > 0 && React.createElement("div", { style: { display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid var(--border)" } },
      React.createElement(Icon, { name: "tag", size: 13, style: { color: "var(--text-faint)", flexShrink: 0 } }),
      allTags.map(({ tag, count }) => {
        const on = tagSel.includes(tag);
        return React.createElement("button", { key: tag, className: "no-drag", onClick: () => toggleTag(tag),
          style: { ...modTagChip(tag, true, tagColors[tag]), display: "inline-flex", alignItems: "center", padding: "3px 9px", cursor: "pointer", opacity: on ? 1 : 0.6, outline: on ? "2px solid " + tagEffectiveHex(tag, tagColors) : "none", outlineOffset: 1 } },
          tag, React.createElement("span", { style: { opacity: 0.7, marginLeft: 5 } }, count));
      }),
      tagSel.length > 0 && React.createElement("button", { className: "no-drag", onClick: () => setTagSel([]),
        style: { marginLeft: 4, fontSize: 11, color: "var(--text-faint)", background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 } },
        React.createElement(Icon, { name: "x", size: 12 }), "Clear"),
    ),
    React.createElement("div", { style: { maxHeight: 520, overflowY: "auto" } },
      filtered.length === 0
        ? React.createElement("div", { style: { padding: 40 } },
            React.createElement(EmptyState, { icon: "package", title: "No mods match", body: t("logs.empty") }))
        : filtered.map((m, i) => React.createElement("div", {
            key: m.id,
            style: {
              borderBottom: i < filtered.length - 1 ? "1px solid var(--border-faint)" : "none",
              background: editing === m.id ? "var(--panel-2)" : "transparent", transition: "background .15s",
            },
          },
            React.createElement("div", {
              style: { display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", opacity: m.enabled ? 1 : 0.45, transition: "opacity .2s" },
            },
              React.createElement("div", {
                style: { width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0,
                  background: m.optimization ? "var(--acc-soft)" : "var(--panel-2)",
                  color: m.optimization ? "var(--acc-text)" : "var(--text-faint)", border: "1px solid var(--border)" },
              }, React.createElement(Icon, { name: m.optimization ? "zap" : "package", size: 15 })),
              React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" } },
                  React.createElement("span", { style: { fontSize: 13.5, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 } }, m.name),
                  m.optimization && React.createElement(Tip, { label: t("mods.optimTip") },
                    React.createElement(Badge, { tone: "accent", size: "sm" }, "opt")),
                  m.update && React.createElement(Badge, { tone: "warn", size: "sm", icon: "download" }, t("mods.update")),
                  (m.tags || []).map(tg => React.createElement("span", { key: tg, className: "no-drag", onClick: () => toggleTag(tg),
                    style: { ...modTagChip(tg, false, tagColors[tg]), padding: "1px 7px", cursor: "pointer" } }, tg)),
                ),
                (m.version || m.note) && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 2, minWidth: 0 } },
                  m.version && React.createElement("span", { className: "mono", style: { fontSize: 11, color: "var(--text-faint)", flexShrink: 0 } }, "v" + m.version),
                  m.note && React.createElement("span", { style: { fontSize: 11, color: "var(--text-faint)", display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" } },
                    React.createElement(Icon, { name: "stickyNote", size: 11, style: { flexShrink: 0 } }),
                    React.createElement("span", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.note))),
              ),
              React.createElement("span", { className: "tnum", style: { fontSize: 11.5, color: "var(--text-faint)", minWidth: 56, textAlign: "right", flexShrink: 0 } },
                m.sizeMb.toFixed(1) + " MB"),
              React.createElement(Tip, { label: editing === m.id ? "Close" : "Tags & note" },
                React.createElement("button", { className: "no-drag", onClick: () => setEditing(e => e === m.id ? null : m.id),
                  style: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0,
                    background: editing === m.id ? "var(--acc-soft)" : ((m.tags && m.tags.length) || m.note ? "var(--panel-2)" : "transparent"),
                    color: editing === m.id ? "var(--acc-text)" : ((m.tags && m.tags.length) || m.note ? "var(--acc-2)" : "var(--text-faint)") } },
                  React.createElement(Icon, { name: "tag", size: 14 }))),
              React.createElement(Toggle, { checked: m.enabled, onChange: () => toggle(m), size: "sm" }),
            ),
            editing === m.id && React.createElement(ModMetaEditor, { m, onTags: saveTags, onNote: saveNote, allTags, tagColors, onColor: saveTagColor }),
          )),
    ),
    React.createElement("div", { style: { padding: "11px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-faint)" } },
      React.createElement("span", { className: "tnum" },
        t("mods.title", { n: filtered.length }) + (filtered.length !== mods.length ? " / " + mods.length : "")),
      React.createElement("span", null,
        optimCount + " optimization · " + updateCount + " updates · " + enabledCount + " enabled"),
    ),
  ));
}

/* ============ INSTANCE SETTINGS ============ */
function JvmChipEditor({ args, onChange, api, t }) {
  const [val, setVal] = tS("");
  function add(raw) {
    const parts = raw.split(/[\s\n,]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length) onChange([...args, ...parts]);
    setVal("");
  }
  return React.createElement("div", null,
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10, minHeight: 34 } },
      args.length === 0 && React.createElement("span", { style: { fontSize: 12, color: "var(--text-faint)", alignSelf: "center" } }, "No JVM arguments — add below or pick a preset"),
      args.map((a, i) => {
        const v = api.validateArg ? api.validateArg(a) : { ok: true, level: "ok", msg: "" };
        const tone = v.level === "error" ? "error" : v.level === "warn" ? "warn" : "neutral";
        return React.createElement(Tip, { key: i, label: v.msg || a },
          React.createElement("span", {
            style: {
              display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 10px",
              borderRadius: 8, fontSize: 11.5, fontWeight: 500,
              background: tone === "error" ? "var(--error-dim)" : tone === "warn" ? "var(--warn-dim)" : "var(--panel-2)",
              border: "1px solid " + (tone === "error" ? "color-mix(in oklab,var(--error) 32%,transparent)" : tone === "warn" ? "color-mix(in oklab,var(--warn) 32%,transparent)" : "var(--border)"),
            }, className: "mono",
          },
            (v.level === "error" || v.level === "warn") && React.createElement(Icon, { name: "alert", size: 12, style: { color: tone === "error" ? "var(--error)" : "var(--warn)" } }),
            React.createElement("span", { style: { color: "var(--text)" } }, a),
            React.createElement("button", {
              onClick: () => onChange(args.filter((_, j) => j !== i)), className: "no-drag",
              style: { display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--text-faint)", padding: 0 },
            }, React.createElement(Icon, { name: "x", size: 12 })),
          ));
      }),
    ),
    React.createElement(TextInput, {
      value: val, onChange: setVal, placeholder: t("set.jvmAdd"), icon: "plus", mono: true, size: "sm",
      onKeyDown: e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(val); } },
    }),
    api.presets && Object.keys(api.presets).length > 0 && React.createElement("div", { style: { display: "flex", gap: 9, marginTop: 9, flexWrap: "wrap", alignItems: "center" } },
      React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } }, t("set.preset") + ":"),
      Object.keys(api.presets).map(p =>
        React.createElement(Btn, { key: p, variant: "ghost", size: "sm",
          onClick: () => onChange(api.presets[p].slice()) }, p)),
    ),
  );
}

// Pick an Xmx (MB) from the pack's mod count, capped to the machine's RAM.
// More heap isn't always better (huge heaps mean longer GC pauses), so we also
// cap at 16 GB and always leave headroom for the OS.
function recommendRamMb(mods, sysRamMb) {
  let want = mods >= 350 ? 10240 : mods >= 200 ? 8192 : mods >= 100 ? 6144 : mods >= 30 ? 4096 : 3072;
  const sys = sysRamMb > 0 ? sysRamMb : 8192;
  const headroom = sys >= 16384 ? 4096 : Math.max(2048, Math.floor(sys * 0.25));
  const ceiling = Math.max(2048, sys - headroom);
  want = Math.min(want, ceiling, 16384);
  return Math.max(2048, Math.floor(want / 512) * 512);
}

function SettingsTab({ instance, t, fmt, api, hasBridge }) {
  const [ramMin,   setRamMin]   = tS(instance.ramMin   || 2048);
  const [ramMax,   setRamMax]   = tS(instance.ramMax   || 8192);
  const [args,     setArgs]     = tS([]);
  const [javaPath, setJavaPath] = tS(instance.java || "");
  const [res,      setRes]      = tS("1920×1080");
  const [saving,   setSaving]   = tS(false);
  const [dirty,    setDirty]    = tS(false);
  const [loaded,   setLoaded]   = tS(false);
  const [javas,    setJavas]    = tS(null);    // null = not scanned yet; [] = none found
  const [reqMajor, setReqMajor] = tS(0);       // Java major this instance's MC needs
  const [recPath,  setRecPath]  = tS("");      // recommended java path (or "" → download)
  const [detecting,setDetecting]= tS(false);
  const [sysRamMb, setSysRamMb] = tS(0);       // total physical RAM (caps the Max slider)

  // Load real config from bridge or fall back to mock preset
  tE(() => {
    if (hasBridge && api.getInstanceCfg) {
      api.getInstanceCfg(instance.id).then(cfg => {
        setRamMin(cfg.ramMin || instance.ramMin || 2048);
        setRamMax(cfg.ramMax || instance.ramMax || 8192);
        if (cfg.javaPath) setJavaPath(cfg.javaPath);
        // Parse JVM args string into chip array
        const argArr = (cfg.jvmArgs || "").replace(/^"|"$/g, "").trim().split(/\s+/).filter(Boolean).map(a => a.replace(/^"|"$/g, "")).filter(Boolean);
        setArgs(argArr.length > 0 ? argArr : (api.presets?.["Balanced (G1GC)"] || []));
        setLoaded(true);
      }).catch(() => {
        setArgs(api.presets?.["Balanced (G1GC)"] || []);
        setLoaded(true);
      });
    } else {
      setArgs(api.presets?.["Balanced (G1GC)"] || []);
      setLoaded(true);
    }
  }, [instance.id, hasBridge]);

  // Discover installed Javas (Cryo bundled, Prism, vendor dirs, JAVA_HOME, PATH).
  // fill=true also writes the recommended path into the field (Auto-detect button).
  async function detectJava(fill) {
    if (!hasBridge || !api.detectJavas) return;
    setDetecting(true);
    try {
      const r = await api.detectJavas(instance.id);
      setJavas((r && r.javas) || []);
      setReqMajor((r && r.requiredMajor) || 0);
      setRecPath((r && r.recommendedPath) || "");
      if (fill) {
        const p = (r && r.recommendedPath) || "";
        setJavaPath(p); setDirty(true);
        if (window.toast) window.toast(p
          ? { tone: "success", icon: "check", title: "Java auto-detected", body: "Java " + ((r && r.requiredMajor) || "?") + " · " + p }
          : { tone: "info", icon: "info", title: "Auto Java", body: "Cryo will download Java " + ((r && r.requiredMajor) || "?") + " on launch." });
      }
    } catch (e) {
      if (window.toast) window.toast({ tone: "error", icon: "alert", title: "Java detection failed", body: e.message });
    } finally { setDetecting(false); }
  }
  tE(() => { if (hasBridge) detectJava(false); }, [instance.id, hasBridge]);
  tE(() => { if (hasBridge && api.getSystemRam) api.getSystemRam().then(r => setSysRamMb((r && r.totalMb) || 0)).catch(() => {}); }, [hasBridge]);

  function markDirty(fn, setter) { return v => { setter(v); setDirty(true); }; }

  // One-click tune: RAM from mod count + this PC's RAM, JVM preset from Java major.
  function optimize() {
    const mods = instance.mods || 0;
    const ram  = recommendRamMb(mods, sysRamMb);
    const useZgc = reqMajor >= 21 && ram >= 10240;   // ZGC low-pause for Java 21 + big heaps
    const presetName = useZgc ? "Low-pause (ZGC, Java 21)" : "Aikar's flags";
    const presetArgs = (api.presets && (api.presets[presetName] || api.presets["Balanced (G1GC)"])) || [];
    setRamMax(ram);
    setRamMin(ram);            // fixed heap (Xms == Xmx) — avoids resize stutter
    setArgs(presetArgs.slice());
    setDirty(true);
    if (window.toast) window.toast({
      tone: "success", icon: "zap",
      title: "Optimized for " + (instance.name || "this pack"),
      body: (ram / 1024).toFixed(1) + " GB · " + presetName + " · " + mods + " mods · Java " + (reqMajor || "?"),
    });
  }

  async function save() {
    setSaving(true);
    try {
      if (hasBridge && api.saveInstanceCfg) {
        await api.saveInstanceCfg(instance.id, {
          jvmArgs:  args.join(" "),
          javaPath,
          ramMin,
          ramMax,
        });
        window.toast({ tone: "success", icon: "check", title: "Settings saved", body: instance.name });
      } else {
        window.toast({ tone: "warn", icon: "info", title: "Preview mode", body: "Changes are local only (no bridge)" });
      }
      setDirty(false);
    } catch (err) {
      window.toast({ tone: "error", icon: "alert", title: "Save failed", body: err.message });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    // Reload from bridge to revert
    setDirty(false);
    if (hasBridge && api.getInstanceCfg) {
      api.getInstanceCfg(instance.id).then(cfg => {
        setRamMin(cfg.ramMin); setRamMax(cfg.ramMax);
        if (cfg.javaPath) setJavaPath(cfg.javaPath);
        const argArr = (cfg.jvmArgs || "").replace(/^"|"$/g, "").trim().split(/\s+/).filter(Boolean).map(a => a.replace(/^"|"$/g, "")).filter(Boolean);
        setArgs(argArr);
      }).catch(() => {});
    }
  }

  if (!loaded) return React.createElement("div", { style: { display: "flex", justifyContent: "center", padding: 40 } },
    React.createElement(Spinner, { size: 24 }));

  // Match the configured path against detected Javas ignoring slash style
  // (instance.cfg uses forward slashes; detected paths use backslashes).
  const normJava = s => (s || "").replace(/[\\/]+/g, "/").toLowerCase();
  const javaSel  = (javas || []).find(j => normJava(j.path) === normJava(javaPath));
  // Cap the Max-RAM slider at the machine's physical RAM (not a fixed 64 GB).
  // Keep at least the stored value so an existing higher setting still renders.
  const ramCeil  = sysRamMb > 0 ? Math.max(Math.floor(sysRamMb / 512) * 512, ramMax) : 65536;

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
    // Unsaved changes banner
    dirty && React.createElement("div", {
      style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: "var(--r-md)", background: "var(--warn-dim)", border: "1px solid color-mix(in oklab, var(--warn) 28%, transparent)" },
    },
      React.createElement(Icon, { name: "alert", size: 16, style: { color: "var(--warn)" } }),
      React.createElement("span", { style: { fontSize: 13, color: "var(--warn)", fontWeight: 600 } }, "Unsaved changes"),
      React.createElement("span", { style: { fontSize: 12, color: "var(--text-dim)" } }, "— saved directly to instance.cfg"),
    ),

    React.createElement(Section, { icon: "ram", title: t("set.ram"),
        desc: sysRamMb > 0 ? ("This PC has " + (sysRamMb / 1024).toFixed(1) + " GB RAM installed — the maximum is capped to that.") : undefined },
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
        React.createElement(LabeledRow, { label: t("set.ramMin") },
          React.createElement(Slider, { value: ramMin, min: 512, max: ramMax, step: 512, onChange: markDirty(null, setRamMin),
            format: v => (v / 1024).toFixed(1) + " GB" })),
        React.createElement(LabeledRow, { label: t("set.ramMax") },
          React.createElement(Slider, { value: ramMax, min: ramMin, max: ramCeil, step: 512, onChange: markDirty(null, setRamMax),
            format: v => (v / 1024).toFixed(1) + " GB" })),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 2, flexWrap: "wrap" } },
          React.createElement(Btn, { variant: "accentSoft", size: "sm", icon: "zap", onClick: optimize, disabled: !sysRamMb },
            "Optimize for this pack"),
          React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } },
            "Auto-sets RAM + JVM flags from " + (instance.mods || 0) + " mods · "
              + (sysRamMb ? (sysRamMb / 1024).toFixed(0) + " GB RAM" : "your RAM") + " · Java " + (reqMajor || "?"))),
      ),
    ),

    React.createElement(Section, { icon: "cpu", title: t("set.java") },
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
        React.createElement(LabeledRow, { label: t("set.javaPath") },
          React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
              React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement(TextInput, { value: javaPath, onChange: v => { setJavaPath(v); setDirty(true); },
                  icon: "folder", mono: true, size: "sm", placeholder: "Auto-detect" })),
              React.createElement(Btn, { variant: "subtle", size: "sm", icon: detecting ? "refresh" : "sparkles", iconSpin: detecting,
                disabled: detecting, onClick: () => detectJava(true) }, "Auto-detect")),
            (javas && javas.length > 0) && React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
              React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)", whiteSpace: "nowrap" } },
                "Detected" + (reqMajor ? " · needs Java " + reqMajor : "") + ":"),
              React.createElement(Select, { value: (javaSel ? javaSel.path : ""), size: "sm", width: 380,
                onChange: v => { setJavaPath(v); setDirty(true); },
                options: [{ value: "", label: "Auto" + (recPath ? "" : " (download on launch)") }].concat(
                  javas.map(j => ({ value: j.path, label: (j.recommended ? "★ " : "") + "Java " + j.major + (j.vendor ? " · " + j.vendor : "") + (j.version ? " (" + j.version + ")" : "") }))) })),
            (javas && javas.length === 0) && React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } },
              "No Java found on disk — Cryo will download Java " + (reqMajor || "?") + " automatically on launch."))),
        React.createElement(LabeledRow, { label: t("set.window") },
          React.createElement(Select, { value: res, onChange: setRes, width: 200, size: "sm",
            options: ["1280×720", "1600×900", "1920×1080", "2560×1440", "Fullscreen"] })),
      ),
    ),

    React.createElement(Section, { icon: "sliders", title: t("set.jvm"), desc: t("set.jvmHelp") },
      React.createElement(JvmChipEditor, { args, onChange: v => { setArgs(v); setDirty(true); }, api, t }),
    ),

    React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 8 } },
      React.createElement(Btn, { variant: "ghost", onClick: cancel, disabled: !dirty || saving }, t("common.cancel")),
      React.createElement(Btn, { variant: "primary", icon: saving ? "loader" : "check", iconSpin: saving,
        onClick: save, disabled: !dirty || saving },
        saving ? "Saving…" : t("common.save")),
    ),
  );
}

// Top-level (NOT defined inside SettingsTab) so its identity is stable across
// renders — otherwise React remounts the whole subtree each keystroke and any
// focused input (e.g. the Java path field) loses focus after every letter.
function Section({ icon, title, desc, children }) {
  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: desc ? 4 : 16 } },
      React.createElement(Icon, { name: icon, size: 16, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 14.5, fontWeight: 680 } }, title)),
    desc && React.createElement("p", { style: { margin: "0 0 16px 25px", fontSize: 12, color: "var(--text-faint)" } }, desc),
    children);
}

function LabeledRow({ label, children }) {
  return React.createElement("div", { style: { display: "grid", gridTemplateColumns: "160px 1fr", gap: 16, alignItems: "center" }, className: "cryo-labeled" },
    React.createElement("span", { style: { fontSize: 13, color: "var(--text-dim)", fontWeight: 600 } }, label),
    React.createElement("div", null, children),
  );
}

/* ============ WORLDS TAB — backups + world list ============ */
function WorldsTab({ instance, api, hasBridge, fmt }) {
  const [worlds, setWorlds]   = tS([]);
  const [backups, setBackups] = tS([]);
  const [busy, setBusy]       = tS({});   // { [worldName]: bool }
  const [restoring, setRest]  = tS({});   // { [file]: bool }
  const [tab, setTab]         = tS("worlds");  // "worlds" | "backups"

  async function load() {
    if (!hasBridge) return;
    const [wR, bR] = await Promise.allSettled([api.getWorlds(instance.id), api.getBackups(instance.id)]);
    if (wR.status === "fulfilled") setWorlds((wR.value && wR.value.worlds) || []);
    if (bR.status === "fulfilled") setBackups((bR.value && bR.value.backups) || []);
  }

  tE(() => { load(); }, [hasBridge, instance.id]);

  // Push events
  tE(() => {
    function onDone(e) {
      const d = e.detail || {};
      setBusy(b => { const nb = { ...b }; delete nb[d.worldName]; return nb; });
      setRest(r => { const nr = { ...r }; delete nr[d.file || ""]; return nr; });
      if (d.ok) {
        window.toast({ tone: "success", icon: "check", title: d.restoredAs ? "Restored as " + d.restoredAs : "Backed up: " + d.worldName });
        load();
      }
    }
    function onErr(e) {
      const d = e.detail || {};
      setBusy({}); setRest({});
      window.toast({ tone: "danger", icon: "alert", title: "Backup error", body: d.error || "" });
    }
    window.addEventListener("cryo:backupDone",  onDone);
    window.addEventListener("cryo:backupError", onErr);
    return () => { window.removeEventListener("cryo:backupDone", onDone); window.removeEventListener("cryo:backupError", onErr); };
  }, []);

  async function doBackup(worldName) {
    setBusy(b => ({ ...b, [worldName]: true }));
    await api.backupWorld(instance.id, worldName).catch(e => window.toast({ tone: "danger", icon: "alert", title: "Error", body: String(e) }));
  }
  async function doRestore(file) {
    if (!window.confirm("Restore this backup? It will be extracted as a new world folder (original preserved).")) return;
    setRest(r => ({ ...r, [file]: true }));
    await api.restoreBackup(instance.id, file).catch(e => window.toast({ tone: "danger", icon: "alert", title: "Error", body: String(e) }));
  }
  async function doDelete(file) {
    if (!window.confirm("Delete this backup permanently?")) return;
    const r = await api.deleteBackup(instance.id, file).catch(() => null);
    if (r && r.ok) { window.toast({ tone: "neutral", icon: "trash", title: "Deleted" }); load(); }
  }

  function fmtDate(ts) { return ts ? new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
    // Header row
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      React.createElement(Segmented, { size: "sm", value: tab, onChange: setTab,
        options: [{ value: "worlds", label: "Worlds (" + worlds.length + ")", icon: "globe" },
                  { value: "backups", label: "Backups (" + backups.length + ")", icon: "database" }] }),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: load }, "Refresh"),
      tab === "worlds" && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "folder", onClick: () => hasBridge && api.openWorldsFolder(instance.id) }, "Open Folder"),
    ),

    // Worlds list
    tab === "worlds" && React.createElement(Card, { pad: false, style: { borderRadius: "var(--r-xl)", overflow: "hidden" } },
      worlds.length === 0
        ? React.createElement("div", { style: { padding: 40, textAlign: "center" } },
            React.createElement(EmptyState, { icon: "globe", title: "No worlds found", body: "Launch the game and create a world first." }))
        : worlds.map((w, i) => React.createElement("div", { key: w.name, style: { display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: i < worlds.length - 1 ? "1px solid var(--border-faint)" : "none" } },
            React.createElement("div", { style: { width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", flexShrink: 0 } },
              React.createElement(Icon, { name: "globe", size: 19, style: { color: "var(--acc-text)" } })),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
              React.createElement("div", { style: { fontWeight: 680, fontSize: 14 } }, w.name),
              React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 } },
                fmt.bytes(w.sizeBytes) + " · Last played " + fmtDate(w.modified))),
            React.createElement(Btn, {
              variant: "outline", size: "sm", icon: busy[w.name] ? "refresh" : "download",
              iconSpin: !!busy[w.name], disabled: !!busy[w.name],
              onClick: () => doBackup(w.name),
            }, busy[w.name] ? "Backing up…" : "Backup"),
          )),
    ),

    // Backups list
    tab === "backups" && React.createElement(Card, { pad: false, style: { borderRadius: "var(--r-xl)", overflow: "hidden" } },
      backups.length === 0
        ? React.createElement("div", { style: { padding: 40, textAlign: "center" } },
            React.createElement(EmptyState, { icon: "database", title: "No backups yet", body: "Go to the Worlds tab and click Backup on any world." }))
        : backups.map((b, i) => React.createElement("div", { key: b.file, style: { display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: i < backups.length - 1 ? "1px solid var(--border-faint)" : "none" } },
            React.createElement("div", { style: { width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--border)", flexShrink: 0 } },
              React.createElement(Icon, { name: "database", size: 17, style: { color: "var(--text-dim)" } })),
            React.createElement("div", { style: { flex: 1, minWidth: 0 } },
              React.createElement("div", { style: { fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, b.file),
              React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 } },
                fmt.bytes(b.sizeBytes) + " · " + fmtDate(b.modified))),
            React.createElement("div", { style: { display: "flex", gap: 6 } },
              React.createElement(Btn, {
                variant: "outline", size: "sm", icon: restoring[b.file] ? "refresh" : "upload",
                iconSpin: !!restoring[b.file], disabled: !!restoring[b.file],
                onClick: () => doRestore(b.file),
              }, "Restore"),
              React.createElement(Tip, { label: "Delete backup permanently" },
                React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => doDelete(b.file) },
                  React.createElement(Icon, { name: "trash", size: 14 }))),
            ),
          )),
    ),

    // Info footer
    React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 8 } },
      React.createElement(Icon, { name: "info", size: 13 }),
      "Backups are stored in %LOCALAPPDATA%\\VSpeedLauncher\\backups\\ and never deleted automatically."),
  );
}

/* ============ EXPORT / IMPORT (used in SettingsTab) ============ */
function ModpackIOCard({ instance, api, hasBridge }) {
  const [exporting, setExport] = tS(false);
  const [importing, setImport] = tS(false);

  tE(() => {
    function onExDone(e) {
      setExport(false);
      const d = e.detail || {};
      if (d.cancelled) return;
      d.ok ? window.toast({ tone: "success", icon: "download", title: "Modpack exported", body: d.path || "" })
           : window.toast({ tone: "danger", icon: "alert", title: "Export failed", body: d.error || "" });
    }
    function onImDone(e) {
      setImport(false);
      const d = e.detail || {};
      if (d.cancelled) return;
      d.ok ? window.toast({ tone: "success", icon: "upload", title: "Modpack imported", body: d.name + " (" + d.id + ")" })
           : window.toast({ tone: "danger", icon: "alert", title: "Import failed", body: d.error || "" });
    }
    window.addEventListener("cryo:exportDone", onExDone);
    window.addEventListener("cryo:importDone", onImDone);
    return () => { window.removeEventListener("cryo:exportDone", onExDone); window.removeEventListener("cryo:importDone", onImDone); };
  }, []);

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } },
      React.createElement(Icon, { name: "download", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Modpack Export / Import")),
    React.createElement("p", { style: { margin: "0 0 14px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55 } },
      "Export saves mods, config, options.txt and a manifest into a portable ZIP. Import reads the ZIP and creates a new instance. Saves and sensitive data (tokens, logs) are not included."),
    React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
      React.createElement(Btn, {
        variant: "primary", icon: exporting ? "refresh" : "download",
        iconSpin: exporting, disabled: exporting || importing,
        onClick: async () => {
          if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
          setExport(true);
          await api.exportModpack(instance.id).catch(e => { setExport(false); window.toast({ tone: "danger", icon: "alert", title: "Error", body: String(e) }); });
        },
      }, exporting ? "Exporting…" : "Export Modpack"),
      React.createElement(Btn, {
        variant: "outline", icon: importing ? "refresh" : "upload",
        iconSpin: importing, disabled: exporting || importing,
        onClick: async () => {
          if (!hasBridge) { window.toast({ tone: "warn", icon: "info", title: "Desktop only" }); return; }
          setImport(true);
          await api.importModpack().catch(e => { setImport(false); window.toast({ tone: "danger", icon: "alert", title: "Error", body: String(e) }); });
        },
      }, importing ? "Importing…" : "Import Modpack"),
    ),
  );
}

/* ============ SERVERS TAB — server list + live ping ============ */
function ServersTab({ instance, api, hasBridge }) {
  const [servers, setServers] = tS([]);
  const [status, setStatus]   = tS({});   // { [ip]: { online, motd, players, maxPlayers, version, latencyMs, error, pinging } }
  const [adding, setAdding]   = tS(false);
  const [newName, setNewName] = tS("");
  const [newIp, setNewIp]     = tS("");

  async function load() {
    if (!hasBridge) return;
    const r = await api.getServers(instance.id).catch(() => ({ servers: [] }));
    const list = (r && r.servers) || [];
    setServers(list);
    list.forEach(s => ping(s.ip));
  }
  tE(() => { load(); }, [hasBridge, instance.id]);

  async function ping(ip) {
    setStatus(st => ({ ...st, [ip]: { ...(st[ip] || {}), pinging: true } }));
    const r = await api.pingServer(ip).catch(() => ({ online: false, error: "ping failed" }));
    setStatus(st => ({ ...st, [ip]: { ...r, pinging: false } }));
  }

  async function add() {
    if (!newIp.trim()) return;
    const r = await api.addServer(instance.id, newName.trim(), newIp.trim()).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok) {
      setNewName(""); setNewIp(""); setAdding(false);
      window.toast({ tone: "success", icon: "check", title: "Server added" });
      load();
    } else window.toast({ tone: "danger", icon: "alert", title: "Couldn't add", body: (r && r.error) || "" });
  }

  async function remove(ip) {
    if (!window.confirm("Remove this server from the list?")) return;
    const r = await api.removeServer(instance.id, ip).catch(() => null);
    if (r && r.ok) { window.toast({ tone: "neutral", icon: "trash", title: "Removed" }); load(); }
  }

  async function join(ip) {
    const r = await api.joinServer(instance.id, ip).catch(e => ({ ok: false, error: String(e) }));
    if (r && r.ok) window.toast({ tone: "success", icon: "zap", title: "Launching", body: "Joining " + ip + " on start…" });
    else window.toast({ tone: "danger", icon: "alert", title: "Couldn't launch", body: (r && r.error) || "Sign in and install the instance first." });
  }

  const dot = (s) => {
    if (!s || s.pinging) return { c: "var(--warn)", t: "…" };
    if (s.online) return { c: "var(--success)", t: (s.latencyMs != null ? s.latencyMs + "ms" : "online") };
    return { c: "var(--error)", t: "offline" };
  };

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Servers"),
      React.createElement("span", { style: { fontSize: 12, color: "var(--text-faint)" } }, servers.length + " saved"),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: load }, "Refresh"),
      React.createElement(Btn, { variant: adding ? "accentSoft" : "primary", size: "sm", icon: adding ? "x" : "plus", onClick: () => setAdding(a => !a) }, adding ? "Cancel" : "Add server")),

    // Add form
    adding && React.createElement(Card, { style: { borderRadius: "var(--r-lg)" } },
      React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } },
        React.createElement(TextInput, { value: newName, onChange: setNewName, placeholder: "Name (optional)", size: "sm", style: { flex: 1, minWidth: 140 } }),
        React.createElement(TextInput, { value: newIp, onChange: setNewIp, placeholder: "address (e.g. play.example.com)", icon: "globe", size: "sm", style: { flex: 2, minWidth: 200 } }),
        React.createElement(Btn, { variant: "primary", size: "sm", icon: "check", disabled: !newIp.trim(), onClick: add }, "Add"))),

    // Server list
    servers.length === 0
      ? React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
          React.createElement(EmptyState, { icon: "globe", title: "No servers saved", body: "Add a server above, or join one in-game and it'll appear here." }))
      : React.createElement(Card, { pad: false, style: { borderRadius: "var(--r-xl)", overflow: "hidden" } },
          servers.map((s, i) => {
            const st = status[s.ip]; const d = dot(st);
            return React.createElement("div", { key: s.ip + i, style: { display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: i < servers.length - 1 ? "1px solid var(--border-faint)" : "none" } },
              React.createElement("span", { style: { width: 9, height: 9, borderRadius: 99, background: d.c, flexShrink: 0, boxShadow: st && st.online ? "0 0 8px " + d.c : "none" } }),
              React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                React.createElement("div", { style: { fontSize: 14, fontWeight: 680, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.name || s.ip),
                React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
                  s.ip + (st && st.online && st.motd ? "  ·  " + st.motd.replace(/§./g, "") : ""))),
              st && st.online && React.createElement("span", { className: "tnum", style: { fontSize: 11.5, color: "var(--text-dim)", flexShrink: 0 } },
                st.players + "/" + st.maxPlayers),
              React.createElement("span", { className: "tnum", style: { fontSize: 11, color: d.c, minWidth: 52, textAlign: "right", flexShrink: 0 } }, d.t),
              React.createElement(Tip, { label: "Launch this instance and connect" },
                React.createElement(Btn, { variant: "primary", size: "sm", icon: "zap", onClick: () => join(s.ip) }, "Join")),
              React.createElement(Tip, { label: "Re-ping" },
                React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => ping(s.ip) }, React.createElement(Icon, { name: "refresh", size: 14 }))),
              React.createElement(Tip, { label: "Remove" },
                React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => remove(s.ip) }, React.createElement(Icon, { name: "trash", size: 14 }))),
            );
          })),

    React.createElement("div", { style: { padding: "10px 14px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 8 } },
      React.createElement(Icon, { name: "info", size: 13 }),
      "Live status is pinged directly from your PC. Edits are saved to servers.dat (a backup .bak is kept)."),
  );
}

/* ============ APPLY PROFILE (used in instance SettingsTab) ============ */
function ProfileApplyCard({ instance, api, hasBridge }) {
  const [profiles, setProfiles] = tS([]);
  const [sel, setSel]           = tS("");
  const [applying, setApplying] = tS(false);

  tE(() => {
    if (!hasBridge) return;
    api.getProfiles().then(r => {
      const list = (r && r.profiles) || [];
      setProfiles(list);
      if (list.length) setSel(s => s || list[0].id);
    }).catch(() => {});
  }, [hasBridge]);

  async function apply() {
    if (!sel) return;
    setApplying(true);
    const r = await api.applyProfile(instance.id, sel).catch(e => ({ ok: false, error: String(e) }));
    setApplying(false);
    if (r && r.ok) window.toast({ tone: "success", icon: "check", title: "Profile applied", body: r.applied + " · " + (r.ramMax / 1024).toFixed(1) + "G" + (r.vspeedEnabled ? " · VSpeed on" : " · VSpeed off") });
    else window.toast({ tone: "danger", icon: "alert", title: "Couldn't apply", body: (r && r.error) || "" });
  }

  if (!hasBridge || profiles.length === 0) return null;
  const cur = profiles.find(p => p.id === sel);

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } },
      React.createElement(Icon, { name: "sliders", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Apply a profile")),
    React.createElement("p", { style: { margin: "0 0 12px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 } },
      "Overwrite this instance's RAM + JVM arguments with a saved preset. Manage presets in Settings → Profiles."),
    React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } },
      React.createElement(Select, { value: sel, onChange: setSel, width: 240, size: "sm",
        options: profiles.map(p => ({ value: p.id, label: p.name })) }),
      cur && React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } },
        (cur.ramMax / 1024).toFixed(1) + "G · " + (cur.vspeedEnabled ? "VSpeed on" : "VSpeed off")),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(Btn, { variant: "primary", size: "sm", icon: applying ? "refresh" : "check", iconSpin: applying, disabled: applying, onClick: apply }, "Apply")),
  );
}

/* ============ MODPACK UPDATE (used in instance SettingsTab) ============ */
function ModpackUpdateCard({ instance, api, hasBridge }) {
  const [info, setInfo] = tS(null);     // null=loading; {hasSource:false} = not a Cryo-installed pack
  const [busy, setBusy] = tS(false);
  const startedRef = tRf(false);

  async function refresh() {
    if (!hasBridge || !api.getModpackInfo) { setInfo({ hasSource: false }); return; }
    const r = await api.getModpackInfo(instance.id).catch(() => ({ hasSource: false }));
    setInfo(r || { hasSource: false });
  }
  tE(() => { refresh(); }, [hasBridge, instance.id]);

  tE(() => {
    function onDone(e) {
      if (!startedRef.current) return;          // ignore install events from elsewhere
      startedRef.current = false; setBusy(false);
      const d = e.detail || {};
      if (d.ok) { window.toast({ tone: "success", icon: "check", title: "Modpack updated", body: "Old mods were moved to a mods.bak-… folder; worlds kept." }); refresh(); }
      else window.toast({ tone: "danger", icon: "alert", title: "Update failed", body: d.error || "" });
    }
    window.addEventListener("cryo:modpackDone", onDone);
    return () => window.removeEventListener("cryo:modpackDone", onDone);
  }, [instance.id]);

  async function doUpdate() {
    if (!window.confirm("Update this modpack to the latest version?\n\nYour current mods are moved to a backup folder (mods.bak-…) and your worlds are kept. Pack config files may be overwritten.")) return;
    startedRef.current = true; setBusy(true);
    await api.updateModpack(instance.id).catch(e => {
      startedRef.current = false; setBusy(false);
      window.toast({ tone: "danger", icon: "alert", title: "Update failed", body: String(e) });
    });
  }

  if (!hasBridge || !info || !info.hasSource) return null;
  const upd = info.updateAvailable;
  return React.createElement(Section, { icon: "package", title: "Modpack",
      desc: info.name ? ((info.source === "curseforge" ? "CurseForge" : "Modrinth") + " · " + info.name) : undefined },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
      React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: upd ? "var(--warn)" : "var(--text-dim)" } },
        info.error ? "Couldn't check for updates" : (upd ? ("Update available" + (info.latestName ? ": " + info.latestName : "")) : "Up to date")),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: refresh, disabled: busy }, "Check"),
      upd && React.createElement(Btn, { variant: "primary", size: "sm", icon: busy ? "refresh" : "download", iconSpin: busy, disabled: busy, onClick: doUpdate }, busy ? "Updating…" : "Update")),
  );
}

// ── Health check card (VSpeed diagnostics) ──────────────────────────────────
function HealthCard({ instance, api, hasBridge }) {
  const [h, setH] = tS(null);
  const [loading, setLoading] = tS(false);
  function run() {
    if (!hasBridge || !api.getHealth) return;
    setLoading(true);
    api.getHealth(instance.id).then(r => setH(r || null)).catch(() => {}).finally(() => setLoading(false));
  }
  tE(() => { run(); }, [instance.id]);

  const score = h ? h.score : 0;
  const ring  = score >= 80 ? "#36D399" : score >= 50 ? "#F1C40F" : "#E55A5A";
  const ic = s => s === "ok" ? { n: "check", c: "#36D399" } : s === "fail" ? { n: "alert", c: "#E55A5A" } : { n: "alert", c: "#F1C40F" };

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "activity", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Health check"),
      React.createElement(Btn, { variant: "outline", size: "sm", icon: "refresh", iconSpin: loading, disabled: loading, onClick: run, style: { marginLeft: "auto" } }, loading ? "Checking…" : "Recheck")),
    !hasBridge && React.createElement("div", { style: { marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" } }, "Available in the desktop launcher."),
    h && React.createElement("div", { style: { display: "flex", gap: 18, alignItems: "center", marginTop: 14, flexWrap: "wrap" } },
      React.createElement("div", { style: { width: 78, height: 78, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", background: "conic-gradient(" + ring + " " + (score * 3.6) + "deg, var(--panel-2) 0deg)" } },
        React.createElement("div", { style: { width: 62, height: 62, borderRadius: "50%", background: "var(--panel-solid)", display: "grid", placeItems: "center" } },
          React.createElement("span", { style: { fontSize: 22, fontWeight: 760, color: "var(--text)" } }, score))),
      React.createElement("div", { style: { flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 7 } },
        (h.checks || []).map((c, i) => React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 9 } },
          React.createElement(Icon, { name: ic(c.status).n, size: 14, style: { color: ic(c.status).c, flexShrink: 0 } }),
          React.createElement("span", { style: { fontSize: 12.5, fontWeight: 600, minWidth: 120 } }, c.title),
          React.createElement("span", { style: { fontSize: 12, color: "var(--text-dim)" } }, c.detail))))));
}

// ── Screenshots gallery ──────────────────────────────────────────────────────
function ScreenshotsTab({ instance, api, hasBridge }) {
  const [shots, setShots] = tS(null);
  function load() {
    if (hasBridge && api.getScreenshots) api.getScreenshots(instance.id).then(r => setShots((r && r.shots) || [])).catch(() => setShots([]));
    else setShots([]);
  }
  tE(() => { load(); }, [instance.id]);

  function del(s) {
    if (!window.confirm("Delete this screenshot?\n" + s.file)) return;
    api.deleteScreenshot(instance.id, s.file).then(() => { setShots(list => (list || []).filter(x => x.file !== s.file)); window.toast({ tone: "neutral", icon: "trash", title: "Deleted" }); }).catch(() => {});
  }

  if (shots === null) return React.createElement("div", { style: { padding: 48, display: "grid", placeItems: "center" } }, React.createElement(Spinner, { size: 22 }));
  if (!shots.length) return React.createElement(EmptyState, { icon: "image", title: "No screenshots yet", body: "Screenshots you take in-game (F2) will show up here." });
  return React.createElement("div", null,
    React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12 } }, shots.length + " screenshot" + (shots.length === 1 ? "" : "s") + " · click to open"),
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 } },
      shots.map(s => React.createElement("div", { key: s.file, className: "glass", style: { borderRadius: "var(--r-lg)", overflow: "hidden", border: "1px solid var(--border)" } },
        React.createElement("img", { src: s.thumb, loading: "lazy", onClick: () => api.openScreenshot(instance.id, s.file),
          style: { width: "100%", height: 132, objectFit: "cover", display: "block", cursor: "pointer", background: "var(--panel-2)" } }),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" } },
          React.createElement("div", { style: { flex: 1, minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.file),
            React.createElement("div", { style: { fontSize: 10.5, color: "var(--text-faint)" } }, s.when + " · " + s.sizeKb + " KB")),
          React.createElement("button", { className: "no-drag", title: "Delete", onClick: () => del(s),
            style: { border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" } },
            React.createElement(Icon, { name: "trash", size: 14 })))))));
}

/* ============ HOST SERVER (run a dedicated server for this pack) ============ */
// Parse a raw server-console line into the same shape the Logs screen uses, so
// we can filter/colour by time · level · thread · mod source. Reuses the Logs
// globals (LEVEL_META, LEVELS, hueFor, highlight) for a consistent look.
const SRV_LINE_RE = /^\[([0-9:.]+)\]\s*\[([^/\]]+)\/(\w+)\](?:\s*\[([^\]]+)\])?:?\s?([\s\S]*)$/;
function parseSrvLine(raw, i) {
  const m = SRV_LINE_RE.exec(raw);
  if (m) {
    let lvl = (m[3] || "INFO").toUpperCase();
    if (lvl === "SEVERE") lvl = "ERROR";
    else if (lvl === "WARNING") lvl = "WARN";
    else if (lvl === "FINE" || lvl === "FINER" || lvl === "FINEST") lvl = "DEBUG";
    if (LEVELS.indexOf(lvl) < 0) lvl = "INFO";
    return { id: i, raw, time: m[1] || "", thread: (m[2] || "").trim(), level: lvl, src: (m[4] || "").trim(), msg: m[5] || "" };
  }
  let level = "INFO";
  if (/(\bERROR\b|\bFATAL\b|\bSEVERE\b|Exception|\[setup error\]|\[start error\])/.test(raw)) level = "ERROR";
  else if (/\bWARN/.test(raw)) level = "WARN";
  return { id: i, raw, time: "", thread: "", level, src: "", msg: raw };
}

function ServerConsole({ lines, running, busy, setupMsg, onCommand }) {
  const [q, setQ]         = tS("");
  const [regex, setRegex] = tS(false);
  const [levels, setLevels] = tS({ TRACE: true, DEBUG: true, INFO: true, WARN: true, ERROR: true, FATAL: true });
  const [thread, setThread] = tS("all");
  const [src, setSrc]     = tS("all");
  const [cmd, setCmd]     = tS("");
  const ref = tRf(null);
  const stick = tRf(true);

  const entries = tM(() => (lines || []).map((l, i) => parseSrvLine(l, i)), [lines]);
  const counts  = tM(() => { const c = {}; for (const e of entries) c[e.level] = (c[e.level] || 0) + 1; return c; }, [entries]);
  const threads = tM(() => ["all", ...Array.from(new Set(entries.map(e => e.thread).filter(Boolean)))], [entries]);
  const sources = tM(() => ["all", ...Array.from(new Set(entries.map(e => e.src).filter(Boolean)))].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)), [entries]);
  const filtered = tM(() => {
    let re = null; if (q && regex) { try { re = new RegExp(q, "i"); } catch { re = null; } }
    return entries.filter(e => {
      if (!levels[e.level]) return false;
      if (thread !== "all" && e.thread !== thread) return false;
      if (src !== "all" && e.src !== src) return false;
      if (q) { const hay = e.raw || ""; return re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase()); }
      return true;
    });
  }, [entries, levels, thread, src, q, regex]);

  tE(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [filtered]);
  function onScroll(e) { const el = e.target; stick.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40; }

  const lvlToggle = lv => setLevels(s => ({ ...s, [lv]: !s[lv] }));
  const errorsOnly = !levels.INFO && !levels.DEBUG && !levels.TRACE && levels.ERROR;
  const toggleErrorsOnly = () => setLevels(errorsOnly
    ? { TRACE: true, DEBUG: true, INFO: true, WARN: true, ERROR: true, FATAL: true }
    : { TRACE: false, DEBUG: false, INFO: false, WARN: true, ERROR: true, FATAL: true });
  const filterActive = thread !== "all" || src !== "all";
  function send() { const c = cmd.trim(); if (!c) return; setCmd(""); stick.current = true; onCommand && onCommand(c); }

  const pill = (txt, color, onClick, title) => React.createElement("button", { className: "no-drag", onClick, title,
    style: { flexShrink: 0, background: "transparent", border: "none", padding: 0, font: "inherit", cursor: "pointer", color, whiteSpace: "nowrap" } }, txt);

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 10, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "terminal", size: 16, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 14.5, fontWeight: 680 } }, "Console"),
      running && React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "var(--success)" } },
        React.createElement("span", { style: { width: 6, height: 6, borderRadius: 99, background: "var(--success)", animation: "pulseGlow 1.6s ease-in-out infinite" } }), "LIVE"),
      busy && setupMsg && React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)" } }, setupMsg),
      React.createElement("span", { className: "tnum", style: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-faint)" } }, filtered.length + " lines")),

    // filter toolbar
    React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", gap: 0 } },
        React.createElement(TextInput, { value: q, onChange: setQ, placeholder: "Search console…", icon: "search", size: "sm", style: { flex: 1, minWidth: 0, borderRadius: "var(--r-md) 0 0 var(--r-md)", borderRight: "none" } }),
        React.createElement("button", { onClick: () => setRegex(r => !r), className: "no-drag mono",
          style: { padding: "0 12px", flexShrink: 0, borderRadius: "0 var(--r-md) var(--r-md) 0", border: "1px solid var(--border)", fontSize: 12, fontWeight: 700, background: regex ? "var(--acc-soft)" : "var(--panel-2)", color: regex ? "var(--acc-text)" : "var(--text-dim)" } }, ".*")),
      React.createElement("div", { style: { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" } },
        LEVELS.map(lv => {
          const n = counts[lv] || 0;
          return React.createElement("button", { key: lv, onClick: () => lvlToggle(lv), className: "no-drag",
            style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0 9px", height: 26, borderRadius: "var(--r-sm)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em",
              border: "1px solid " + (levels[lv] ? "transparent" : "var(--border)"),
              background: levels[lv] ? (LEVEL_META[lv].bg === "transparent" ? "var(--panel-hi)" : LEVEL_META[lv].bg) : "transparent",
              color: levels[lv] ? LEVEL_META[lv].color : "var(--text-faint)", opacity: levels[lv] ? 1 : 0.45 } },
            lv, n > 0 && React.createElement("span", { className: "tnum", style: { fontSize: 9.5, fontWeight: 700, opacity: 0.85, background: "color-mix(in oklab, currentColor 18%, transparent)", borderRadius: 6, padding: "0 4px" } }, n > 9999 ? "9999+" : n));
        }),
        React.createElement("div", { style: { width: 1, height: 16, background: "var(--border)", margin: "0 3px" } }),
        React.createElement(Btn, { variant: errorsOnly ? "accentSoft" : "ghost", size: "sm", icon: "alert", onClick: toggleErrorsOnly }, errorsOnly ? "Show all" : "Errors only")),
      React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        React.createElement(Select, { value: thread, onChange: setThread, size: "sm", width: 168, icon: "cpu",
          options: threads.map(th => ({ value: th, label: th === "all" ? "All threads" : th })) }),
        React.createElement(Select, { value: src, onChange: setSrc, size: "sm", width: 184, icon: "package",
          options: sources.map(s => ({ value: s, label: s === "all" ? "All sources" : s })) }),
        filterActive && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "x", onClick: () => { setThread("all"); setSrc("all"); } }, "Clear"),
        React.createElement("div", { style: { flex: 1, minWidth: 8 } }),
        React.createElement(Tip, { label: "Scroll to bottom" }, React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => { stick.current = true; if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; } }, React.createElement(Icon, { name: "chevronDown", size: 15 }))),
        React.createElement(Tip, { label: "Copy" }, React.createElement(Btn, { variant: "ghost", size: "icon", onClick: () => { if (navigator.clipboard) { navigator.clipboard.writeText(filtered.map(e => e.raw).join("\n")); window.toast({ tone: "neutral", icon: "copy", title: "Copied" }); } } }, React.createElement(Icon, { name: "copy", size: 15 }))))),

    // viewport
    React.createElement("div", { ref, onScroll, className: "mono",
      style: { height: 420, overflowY: "auto", background: "var(--bg-0, #0b0e14)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "8px 0", fontSize: 11.5, lineHeight: "17px" } },
      filtered.length === 0
        ? React.createElement("div", { style: { padding: 40, textAlign: "center", color: "var(--text-faint)" } }, entries.length ? "No lines match the filters." : (running || busy ? "Waiting for output…" : "Console is empty — start the server to see output."))
        : filtered.map(e => {
            const meta = LEVEL_META[e.level] || LEVEL_META.INFO;
            const sev = e.level === "ERROR" || e.level === "FATAL";
            const msgColor = sev ? "var(--error)" : e.level === "WARN" ? "var(--warn)" : (/^>\s/.test(e.raw) || /^\[cryo\]/.test(e.raw)) ? "var(--acc-text)" : "var(--text)";
            const edge = e.level === "FATAL" || e.level === "ERROR" ? "var(--error)" : e.level === "WARN" ? "var(--warn)" : "transparent";
            return React.createElement("div", { key: e.id, style: { display: "flex", alignItems: "flex-start", gap: 7, padding: "1px 12px", background: meta.bg, borderLeft: "2px solid " + edge, whiteSpace: "pre-wrap", wordBreak: "break-word" } },
              (e.thread || e.src)
                ? React.createElement("span", { style: { flex: 1, minWidth: 0 } },
                    e.time && React.createElement("span", { style: { color: "var(--text-faint)" } }, e.time + " "),
                    React.createElement("span", { style: { color: meta.color, fontWeight: 700 } }, e.level + " "),
                    e.thread && pill("[" + e.thread + "] ", hueFor(e.thread), () => setThread(e.thread), "Filter to this thread"),
                    e.src && pill(e.src + ": ", hueFor(e.src), () => setSrc(e.src), "Filter to this source"),
                    React.createElement("span", { style: { color: msgColor } }, highlight(e.msg || "", q, regex)))
                : React.createElement("span", { style: { flex: 1, minWidth: 0, color: msgColor } }, highlight(e.raw, q, regex)));
          })),

    // command input
    React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } },
      React.createElement(TextInput, { value: cmd, onChange: setCmd, mono: true, size: "sm", icon: "terminal", style: { flex: 1 },
        placeholder: running ? "Type a command — e.g. say hi, op <user>, weather clear" : "Start the server to send commands",
        onKeyDown: e => { if (e.key === "Enter") { e.preventDefault(); send(); } } }),
      React.createElement(Btn, { variant: "primary", size: "sm", onClick: send, disabled: !running || !cmd.trim() }, "Send")));
}

// Every standard server.properties key with a proper widget, grouped — so you
// configure the whole server from the launcher and never edit the file by hand.
const SERVER_PROP_SCHEMA = [
  { group: "World", fields: [
    { k: "level-name", label: "World folder name", type: "str", def: "world" },
    { k: "level-seed", label: "Seed", type: "str", def: "" },
    { k: "gamemode", label: "Game mode", type: "enum", def: "survival", opts: ["survival", "creative", "adventure", "spectator"] },
    { k: "difficulty", label: "Difficulty", type: "enum", def: "easy", opts: ["peaceful", "easy", "normal", "hard"] },
    { k: "hardcore", label: "Hardcore", type: "bool", def: "false" },
    { k: "level-type", label: "World type", type: "enum", def: "minecraft:normal", opts: ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified", "minecraft:single_biome_surface"] },
    { k: "generate-structures", label: "Generate structures", type: "bool", def: "true" },
    { k: "max-world-size", label: "Max world size (radius)", type: "int", def: "29999984" },
    { k: "allow-nether", label: "Allow the Nether", type: "bool", def: "true" },
    { k: "spawn-protection", label: "Spawn protection radius", type: "int", def: "16" },
  ] },
  { group: "Players", fields: [
    { k: "max-players", label: "Max players", type: "int", def: "20" },
    { k: "pvp", label: "PvP", type: "bool", def: "true" },
    { k: "online-mode", label: "Online mode (verify accounts)", type: "bool", def: "true" },
    { k: "white-list", label: "Whitelist", type: "bool", def: "false" },
    { k: "enforce-whitelist", label: "Enforce whitelist", type: "bool", def: "false" },
    { k: "allow-flight", label: "Allow flight", type: "bool", def: "false" },
    { k: "force-gamemode", label: "Force game mode on join", type: "bool", def: "false" },
    { k: "player-idle-timeout", label: "Idle kick (minutes, 0 = off)", type: "int", def: "0" },
    { k: "op-permission-level", label: "OP permission level (0–4)", type: "int", def: "4" },
    { k: "function-permission-level", label: "Function permission level (1–4)", type: "int", def: "2" },
    { k: "enforce-secure-profile", label: "Require signed chat", type: "bool", def: "true" },
    { k: "hide-online-players", label: "Hide online players list", type: "bool", def: "false" },
  ] },
  { group: "Mobs & view", fields: [
    { k: "spawn-monsters", label: "Spawn monsters", type: "bool", def: "true" },
    { k: "spawn-animals", label: "Spawn animals", type: "bool", def: "true" },
    { k: "spawn-npcs", label: "Spawn villagers (NPCs)", type: "bool", def: "true" },
    { k: "view-distance", label: "View distance (chunks)", type: "int", def: "10" },
    { k: "simulation-distance", label: "Simulation distance (chunks)", type: "int", def: "10" },
    { k: "entity-broadcast-range-percentage", label: "Entity broadcast range %", type: "int", def: "100" },
  ] },
  { group: "Server & network", fields: [
    { k: "motd", label: "MOTD (server-list message)", type: "str", def: "A Minecraft Server" },
    { k: "server-port", label: "Port", type: "int", def: "25565" },
    { k: "server-ip", label: "Bind IP (blank = all)", type: "str", def: "" },
    { k: "enable-command-block", label: "Enable command blocks", type: "bool", def: "false" },
    { k: "max-tick-time", label: "Max tick time (ms, -1 = off)", type: "int", def: "60000" },
    { k: "network-compression-threshold", label: "Network compression threshold", type: "int", def: "256" },
    { k: "enable-status", label: "Answer status pings", type: "bool", def: "true" },
    { k: "prevent-proxy-connections", label: "Prevent proxy connections", type: "bool", def: "false" },
    { k: "use-native-transport", label: "Native transport (Linux epoll)", type: "bool", def: "true" },
    { k: "sync-chunk-writes", label: "Sync chunk writes", type: "bool", def: "true" },
    { k: "enable-query", label: "Enable GameSpy query", type: "bool", def: "false" },
    { k: "query.port", label: "Query port", type: "int", def: "25565" },
    { k: "enable-rcon", label: "Enable RCON (remote console)", type: "bool", def: "false" },
    { k: "rcon.port", label: "RCON port", type: "int", def: "25575" },
    { k: "rcon.password", label: "RCON password", type: "str", def: "" },
    { k: "broadcast-console-to-ops", label: "Broadcast console to ops", type: "bool", def: "true" },
    { k: "broadcast-rcon-to-ops", label: "Broadcast RCON to ops", type: "bool", def: "true" },
  ] },
  { group: "Resource pack", fields: [
    { k: "resource-pack", label: "Resource-pack URL", type: "str", def: "" },
    { k: "resource-pack-prompt", label: "Resource-pack prompt", type: "str", def: "" },
    { k: "resource-pack-sha1", label: "Resource-pack SHA-1", type: "str", def: "" },
    { k: "require-resource-pack", label: "Require resource pack", type: "bool", def: "false" },
  ] },
];

function ServerSettings({ id, api, running }) {
  const [vals, setVals]   = tS(null);
  const [extra, setExtra] = tS([]);
  const [loading, setLoading] = tS(true);
  const [saving, setSaving]   = tS(false);
  const [q, setQ] = tS("");

  async function load() {
    setLoading(true);
    const r = await api.getServerProperties(id).catch(() => null);
    const props = (r && r.props) || {};
    const merged = {}, known = {};
    SERVER_PROP_SCHEMA.forEach(g => g.fields.forEach(f => { known[f.k] = 1; merged[f.k] = props[f.k] != null ? props[f.k] : f.def; }));
    const ex = Object.keys(props).filter(k => !known[k]).sort().map(k => ({ k, v: props[k] }));
    setVals(merged); setExtra(ex); setLoading(false);
  }
  tE(() => { load(); }, [id]);
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    const out = { ...vals };
    extra.forEach(e => { out[e.k] = e.v; });
    const r = await api.saveServerProperties(id, out).catch(e => ({ ok: false, error: String(e) }));
    setSaving(false);
    if (r && r.ok) window.toast({ tone: "success", icon: "check", title: "Settings saved", body: running ? "Restart the server to apply." : "server.properties updated" });
    else window.toast({ tone: "danger", icon: "alert", title: "Couldn't save", body: (r && r.error) || "" });
  }

  if (loading || !vals) return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "grid", placeItems: "center", padding: 40 } }, React.createElement(Spinner, null)));

  const ql = q.trim().toLowerCase();
  const match = f => !ql || f.k.toLowerCase().includes(ql) || f.label.toLowerCase().includes(ql);
  const control = f => {
    const v = vals[f.k];
    if (f.type === "bool") return React.createElement(Toggle, { checked: v === "true", onChange: () => set(f.k, v === "true" ? "false" : "true"), size: "sm" });
    if (f.type === "enum") {
      const opts = f.opts.slice(); if (v && opts.indexOf(v) < 0) opts.push(v);
      return React.createElement(Select, { value: v, onChange: x => set(f.k, x), size: "sm", width: 210, options: opts.map(o => ({ value: o, label: o })) });
    }
    return React.createElement(TextInput, { value: String(v == null ? "" : v), mono: f.type === "int", size: "sm", style: { width: f.type === "int" ? 130 : 240 },
      onChange: x => set(f.k, f.type === "int" ? String(x).replace(/[^0-9-]/g, "") : x) });
  };
  const rowOf = (k, label, mono, ctl) => React.createElement("div", { key: k, style: { display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--border-faint)" } },
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 12.5, color: "var(--text)" } }, label),
      React.createElement("div", { className: "mono", style: { fontSize: 10.5, color: "var(--text-faint)" } }, k)),
    React.createElement("div", { style: { flexShrink: 0 } }, ctl));

  const exShown = extra.filter(e => !ql || e.k.toLowerCase().includes(ql));

  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "sliders", size: 16, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 14.5, fontWeight: 680 } }, "Server settings"),
      React.createElement("span", { className: "mono", style: { fontSize: 11, color: "var(--text-faint)" } }, "server.properties"),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(TextInput, { value: q, onChange: setQ, placeholder: "Filter settings…", icon: "search", size: "sm", style: { width: 190 } }),
      React.createElement(Btn, { variant: "ghost", size: "sm", icon: "refresh", onClick: load }, "Reload"),
      React.createElement(Btn, { variant: "primary", size: "sm", icon: saving ? "loader" : "check", iconSpin: saving, disabled: saving, onClick: save }, saving ? "Saving…" : "Save")),
    running && React.createElement("div", { style: { fontSize: 11.5, color: "var(--warn, #e6b450)", marginBottom: 10 } }, "Server is running — changes apply after a restart."),
    React.createElement("div", { style: { maxHeight: 540, overflowY: "auto", paddingRight: 4 } },
      SERVER_PROP_SCHEMA.map(g => {
        const fs = g.fields.filter(match);
        if (!fs.length) return null;
        return React.createElement("div", { key: g.group, style: { marginBottom: 14 } },
          React.createElement("div", { style: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)", margin: "6px 0 4px" } }, g.group),
          fs.map(f => rowOf(f.k, f.label, false, control(f))));
      }),
      exShown.length > 0 && React.createElement("div", { style: { marginBottom: 8 } },
        React.createElement("div", { style: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)", margin: "6px 0 4px" } }, "Other / advanced"),
        exShown.map(e => rowOf(e.k, e.k, true,
          React.createElement(TextInput, { value: String(e.v == null ? "" : e.v), size: "sm", style: { width: 240 },
            onChange: x => setExtra(list => list.map(it => it.k === e.k ? { ...it, v: x } : it)) }))))));
}

function HostServerTab({ instance, api, hasBridge }) {
  const id = instance.id;
  const [srv, setSrv]   = tS(null);
  const [loading, setLoading] = tS(true);
  const [lines, setLines] = tS([]);
  const [state, setState] = tS("stopped");
  const [ram, setRam]   = tS(4096);
  const [port, setPort] = tS(25565);
  const [eula, setEula] = tS(false);
  const [busy, setBusy] = tS(false);
  const [setupMsg, setSetupMsg] = tS("");
  const [delArm, setDelArm] = tS(false);
  const [view, setView] = tS("console");   // console | settings
  const saveTimer = tRf(null);
  const sysRam = useSysRamMb(api);
  const ramCap = maxRamMb(sysRam);

  async function reload() {
    if (!hasBridge || !api.getHostedServer) { setLoading(false); return; }
    const s = await api.getHostedServer(id).catch(() => null);
    if (s) { setSrv(s); setState(s.state || "stopped"); setRam(s.ramMb || 4096); setPort(s.port || 25565); setEula(!!s.eulaAccepted); }
    setLoading(false);
  }
  tE(() => { setLoading(true); reload(); }, [id]);

  // Poll the console buffer (like the Logs screen) while mounted.
  tE(() => {
    if (!hasBridge || !api.getServerConsole) return;
    let alive = true;
    async function tick() {
      const c = await api.getServerConsole(id, 800).catch(() => null);
      if (!alive || !c) return;
      setLines(c.lines || []);
      setState(c.state || "stopped");
    }
    tick();
    const iv = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(iv); };
  }, [id, hasBridge]);

  // Live push events for state + setup progress.
  tE(() => {
    function onState(e) { const d = e.detail || {}; if (d.id === id) setState(d.state || "stopped"); }
    function onProg(e)  { const d = e.detail || {}; if (d.id === id) setSetupMsg(d.message || ""); }
    function onDone(e)  { const d = e.detail || {}; if (d.id === id) { setBusy(false); setSetupMsg(""); reload(); window.toast({ tone: "success", icon: "check", title: "Server ready" }); } }
    function onErr(e)   { const d = e.detail || {}; if (d.id === id) { setBusy(false); setSetupMsg(""); window.toast({ tone: "danger", icon: "alert", title: "Setup failed", body: d.error || "" }); } }
    window.addEventListener("cryo:serverState", onState);
    window.addEventListener("cryo:serverSetupProgress", onProg);
    window.addEventListener("cryo:serverSetupDone", onDone);
    window.addEventListener("cryo:serverSetupError", onErr);
    return () => {
      window.removeEventListener("cryo:serverState", onState);
      window.removeEventListener("cryo:serverSetupProgress", onProg);
      window.removeEventListener("cryo:serverSetupDone", onDone);
      window.removeEventListener("cryo:serverSetupError", onErr);
    };
  }, [id]);

  const running  = state === "running" || state === "starting" || state === "stopping";
  const setupDone = srv && srv.setupDone;

  function scheduleSave(r) { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => api.saveServerSettings(id, r, 0).catch(() => {}), 500); }
  async function setup()  { setBusy(true); setSetupMsg("Starting setup…"); const r = await api.createServer(id).catch(e => ({ ok: false, error: String(e) })); if (r && !r.ok) { setBusy(false); window.toast({ tone: "danger", icon: "alert", title: "Couldn't start setup", body: r.error || "" }); } }
  async function start()  { const r = await api.startServer(id).catch(e => ({ ok: false, error: String(e) })); if (r && !r.ok) { if (r.needEula) window.toast({ tone: "warn", icon: "info", title: "Accept the Minecraft EULA first" }); else window.toast({ tone: "danger", icon: "alert", title: "Couldn't start", body: r.error || "" }); } }
  async function stop()   { await api.stopServer(id).catch(() => {}); }
  async function accept() { await api.acceptServerEula(id).catch(() => {}); setEula(true); }
  function onDelete()     { if (!delArm) { setDelArm(true); setTimeout(() => setDelArm(false), 3000); return; } setDelArm(false); api.deleteServer(id).then(r => { if (r && r.ok) { setSrv(p => p ? { ...p, exists: false, setupDone: false } : p); setLines([]); setState("stopped"); window.toast({ tone: "neutral", icon: "trash", title: "Server deleted" }); } else window.toast({ tone: "danger", icon: "alert", title: "Couldn't delete", body: (r && r.error) || "" }); }).catch(() => {}); }

  if (!hasBridge) return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement(EmptyState, { icon: "server", title: "Desktop only", body: "Server hosting runs in the desktop app." }));
  if (loading) return React.createElement("div", { style: { display: "grid", placeItems: "center", padding: 60 } }, React.createElement(Spinner, null));

  const stateTone = state === "running" ? "success" : state === "crashed" ? "error" : (state === "starting" || state === "stopping" || state === "installing") ? "warn" : "neutral";
  const stateLabel = { stopped: "Stopped", installing: "Installing…", starting: "Starting…", running: "Running", stopping: "Stopping…", crashed: "Crashed" }[state] || state;

  // ── Not supported (Forge/Quilt for now) ──
  if (srv && srv.supported === false) return React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
      React.createElement(Icon, { name: "server", size: 18, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Host a server")),
    React.createElement("p", { style: { margin: "10px 0 0", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55 } },
      (srv.loader || "This loader") + " server hosting is coming soon. Cryo can currently host NeoForge, Fabric and Vanilla packs."));

  const consoleCard = React.createElement(ServerConsole, {
    lines, running, busy, setupMsg,
    onCommand: c => api.sendServerCommand(id, c).catch(() => {}),
  });

  // ── Not set up yet ──
  if (!setupDone) return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
    React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
        React.createElement(Icon, { name: "server", size: 18, style: { color: "var(--acc-2)" } }),
        React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Host a server"),
        busy && React.createElement(Badge, { tone: "warn", size: "sm" }, "Setting up…")),
      React.createElement("p", { style: { margin: "10px 0 14px", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55 } },
        "Create a dedicated server for ", React.createElement("strong", null, instance.name),
        " — Cryo copies this pack's mods + config and installs the matching ",
        React.createElement("strong", null, (instance.loader || "Vanilla") + " " + (instance.mc || "")),
        " server, with its own console."),
      React.createElement(Btn, { variant: "primary", icon: busy ? "loader" : "server", iconSpin: busy, disabled: busy, onClick: setup },
        busy ? "Setting up…" : "Set up server")),
    (busy || lines.length > 0) && consoleCard);

  // ── Set up — controls + console ──
  const controls = React.createElement(Card, { style: { borderRadius: "var(--r-xl)" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "server", size: 18, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 15, fontWeight: 680 } }, "Server"),
      React.createElement(Badge, { tone: stateTone, size: "sm", dot: state === "running" }, stateLabel),
      React.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
        (state === "running" || state === "starting")
          ? React.createElement(Btn, { variant: "outline", size: "sm", icon: "power", onClick: stop, disabled: state === "stopping" }, state === "stopping" ? "Stopping…" : "Stop")
          : React.createElement(Btn, { variant: "primary", size: "sm", icon: "play", onClick: start, disabled: !eula || state === "stopping" }, "Start"),
        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "folderOpen", onClick: () => api.openServerFolder(id).catch(() => {}) }, "Folder"),
        React.createElement(Btn, { variant: delArm ? "danger" : "ghost", size: "sm", icon: "trash", disabled: running, onClick: onDelete }, delArm ? "Confirm" : ""))),
    React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: "var(--text-faint)" } },
      React.createElement("span", null, (srv.loader || "Vanilla") + " " + (srv.loaderVer || "")),
      React.createElement("span", null, "· MC " + (srv.mc || "")),
      React.createElement("span", null, "· port " + port)),
    !eula && React.createElement("div", { style: { marginTop: 14, padding: "11px 13px", borderRadius: "var(--r-md)", background: "var(--warn-dim, rgba(230,180,80,.12))", border: "1px solid color-mix(in oklab, var(--warn, #e6b450) 30%, transparent)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      React.createElement(Icon, { name: "alert", size: 15, style: { color: "var(--warn, #e6b450)", flexShrink: 0 } }),
      React.createElement("span", { style: { fontSize: 12.5, color: "var(--text)", flex: 1, minWidth: 180 } },
        "You must accept the ",
        React.createElement("a", { href: "#", onClick: e => { e.preventDefault(); api.openUrl && api.openUrl("https://aka.ms/MinecraftEULA"); }, style: { color: "var(--acc-text)" } }, "Minecraft EULA"),
        " before starting."),
      React.createElement(Btn, { variant: "primary", size: "sm", icon: "check", onClick: accept }, "Accept EULA")),
    React.createElement("div", { style: { marginTop: 16, opacity: running ? 0.5 : 1, pointerEvents: running ? "none" : "auto" } },
      React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 } }, "Server RAM — " + (ram / 1024).toFixed(1) + " GB (JVM heap)"),
      React.createElement(Slider, { value: Math.min(ram, ramCap), min: 1024, max: ramCap, step: 512, onChange: v => { setRam(v); scheduleSave(v); }, format: v => (v / 1024).toFixed(1) + "G" })));

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
    controls,
    React.createElement(Segmented, { value: view, onChange: setView, size: "sm",
      options: [{ value: "console", label: "Console", icon: "terminal" }, { value: "settings", label: "Settings", icon: "sliders" }] }),
    view === "settings" ? React.createElement(ServerSettings, { id, api, running }) : consoleCard);
}

window.CryoInstanceTabs = { PerformanceTab, ModsTab, SettingsTab, WorldsTab, ModpackIOCard, ServersTab, ProfileApplyCard, ModpackUpdateCard, HealthCard, ScreenshotsTab, HostServerTab };
