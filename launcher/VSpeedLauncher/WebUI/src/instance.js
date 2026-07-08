/* ============================================================
   Cryo вЂ” Instance Detail container (header + launch + tabs)
   Supports both mock simulation (browser) and real bridge (WebView2).
   ============================================================ */
const { useState: dS, useEffect: dE, useRef: dR, useCallback: dC } = React;
var { useApp } = window.CryoStore;

function InstanceDetail({ id, initialTab, autoLaunch }) {
  const { api, hasBridge, t, fmt, navigate } = useApp();
  const { OverviewTab } = window.CryoOverview;
  const { PerformanceTab, ModsTab, SettingsTab, WorldsTab, ModpackIOCard, ServersTab, ProfileApplyCard, ModpackUpdateCard, HealthCard, ScreenshotsTab, HostServerTab } = window.CryoInstanceTabs;
  const { InstanceModBrowser } = window.CryoModrinth;

  const [state, setState] = dS("loading");
  const [data, setData] = dS(null);
  const [tab, setTab] = dS(initialTab || "overview");

  // Launch display state (works for both sim and real)
  const [status, setStatus] = dS("idle"); // idle | launching | running
  const [modelT, setModelT] = dS(0);
  const simRef = dR(null);

  const [loadErr, setLoadErr] = dS("");

  async function load() {
    setState("loading");
    setLoadErr("");
    try {
      // allSettled so one failing call (e.g. logs/cache) doesn't kill the screen
      const [iR, kR, cR, mR] = await Promise.allSettled([
        api.getInstance(id), api.getKpis(id), api.getCache(id), api.getMods(id),
      ]);
      if (iR.status !== "fulfilled") throw iR.reason || new Error("getInstance failed");
      const instance = iR.value;
      const kpis  = kR.status === "fulfilled" ? kR.value : { last: 0, avg: 0, best: 0, worst: 0, launches: 0, playtimeMin: 0 };
      const cache = cR.status === "fulfilled" ? cR.value : { enabled: true, state: "off", sizeBytes: 0, recipes: 0, advancements: 0 };
      const mods  = mR.status === "fulfilled" ? mR.value : [];

      // Sync initial launch status from the real instance state (bridge mode)
      if (hasBridge && instance.state) {
        const s = instance.state;
        if (s === "loading" || s === "waking")      { setStatus("launching"); setModelT(instance.loadSeconds || 0); }
        else if (s === "ready" || s === "hibernated"){ setStatus("running");   setModelT(instance.loadSeconds || 0); }
        else                                          { setStatus("idle");      setModelT(0); }
      }

      setData({ instance, kpis, cache, mods });
      setState("ready");
    } catch (e) {
      console.error("[InstanceDetail] load failed:", e);
      setLoadErr(String((e && e.message) || e));
      setState("error");
    }
  }

  dE(() => {
    load();
    return () => { simRef.current && simRef.current.stop(); };
  }, [id]);

  // в”Ђв”Ђ Bridge: listen for real state-change push events в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  dE(() => {
    if (!hasBridge) return;
    function onStateChanged(e) {
      const ev = e.detail;
      if (ev.id !== id) return;

      // Always update the raw instance data
      setData(prev => prev ? {
        ...prev,
        instance: {
          ...prev.instance,
          state: ev.state, jvmPid: ev.jvmPid,
          loadSeconds: ev.loadSeconds, residentMB: ev.residentMB,
          lastError: ev.lastError,
        },
      } : prev);

      if (ev.state === "ready" && ev.loadSeconds > 0) {
        // в”Ђв”Ђ Game reached main menu в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
        // Snap the crystal to the REAL boot time and freeze the simulation.
        simRef.current && simRef.current.stop();
        simRef.current = null;
        setModelT(ev.loadSeconds);
        setStatus("running");
        window.toast({
          tone: "success", icon: "checkCircle",
          title: (data && data.instance.name) || id,
          body: "Reached main menu in " + ev.loadSeconds + "s",
        });
        // History was just recorded by the bridge — refresh KPIs so Overview updates.
        setTimeout(() => api.getKpis(id).then(k => setData(prev => prev ? { ...prev, kpis: k } : prev)).catch(() => {}), 600);
      } else if (ev.state === "hibernated") {
        simRef.current && simRef.current.stop();
        simRef.current = null;
        setStatus("running");
        window.toast({ tone: "accent", icon: "pause",
          title: "Hibernated — " + ((data && data.instance.name) || id),
          body: ev.residentMB > 0 ? "Resident memory: " + ev.residentMB + " MB" : "",
        });
      } else if (ev.state === "crashed") {
        simRef.current && simRef.current.stop();
        simRef.current = null;
        setStatus("idle"); setModelT(0);
        window.toast({ tone: "error", icon: "alert",
          title: "Crash — " + ((data && data.instance.name) || id),
          body: ev.lastError || "Instance crashed unexpectedly",
        });
      } else if (ev.state === "stopped") {
        simRef.current && simRef.current.stop();
        simRef.current = null;
        setStatus("idle"); setModelT(0);
      } else if ((ev.state === "loading" || ev.state === "waking") && status === "idle") {
        // External launch (e.g. via tray) вЂ” start showing progress
        setStatus("launching"); setModelT(0);
      }
    }
    window.addEventListener("cryo:instanceStateChanged", onStateChanged);
    return () => window.removeEventListener("cryo:instanceStateChanged", onStateChanged);
  }, [hasBridge, id, data, status]);

  // в”Ђв”Ђ Launch в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  const startLaunch = dC(async () => {
    if (!data || status !== "idle") return;
    setTab("overview");
    setModelT(0);

    if (hasBridge) {
      // Real launch вЂ” show the crystal animation at 1Г— speed (real time)
      // while the game loads. When the READY pipe signal arrives,
      // the onStateChanged handler above snaps the crystal to the real time.
      setStatus("launching");
      const estimatedWall = (data.kpis && data.kpis.avg > 0)
        ? data.kpis.avg
        : (data.instance.wallClock || 90);
      const sim = window.CryoStore.createLaunchSim({ wallClock: estimatedWall }, 1); // 1Г— = real time
      simRef.current = sim;
      sim.subscribe(({ t: mt }) => setModelT(mt)); // drive the crystal
      sim.start();

      try {
        await api.launchInstance(data.instance.id);
      } catch (err) {
        sim.stop(); simRef.current = null;
        setStatus("idle"); setModelT(0);
        window.toast({ tone: "error", icon: "alert", title: "Launch failed", body: err.message });
      }
    } else {
      // Simulation (browser testing)
      setStatus("launching");
      const sim = window.CryoStore.createLaunchSim(data.instance, 9);
      simRef.current = sim;
      sim.subscribe(({ t: mt, done }) => {
        setModelT(mt);
        if (done) {
          setStatus("running");
          window.toast({
            tone: "success", icon: "checkCircle",
            title: data.instance.name + " is running",
            body: "Reached main menu in " + mt.toFixed(0) + "s",
          });
        }
      });
      sim.start();
    }
  }, [data, status, hasBridge]);

  const stop = dC(async () => {
    simRef.current && simRef.current.stop();
    if (hasBridge && data) {
      await api.stopInstance(data.instance.id).catch(() => {});
    }
    setStatus("idle"); setModelT(0);
  }, [hasBridge, data]);

  // Light refresh after installing a mod from the "Add mods" tab — updates the mod
  // count badge + the Mods tab without the full loading skeleton flashing.
  const refreshMods = dC(async () => {
    if (!hasBridge) return;
    const [mR, iR] = await Promise.allSettled([api.getMods(id), api.getInstance(id)]);
    setData(prev => prev ? {
      ...prev,
      mods: mR.status === "fulfilled" ? mR.value : prev.mods,
      instance: iR.status === "fulfilled" ? { ...prev.instance, mods: iR.value.mods } : prev.instance,
    } : prev);
  }, [hasBridge, id]);

  dE(() => {
    if (autoLaunch && state === "ready" && status === "idle") {
      const tid = setTimeout(startLaunch, 350);
      return () => clearTimeout(tid);
    }
  }, [autoLaunch, state]);

  // в”Ђв”Ђ Render в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  if (state === "loading") return React.createElement(DetailSkeleton, null);
  if (state === "error") return React.createElement("div", { style: { padding: 40 } },
    React.createElement(ErrorState, { title: t("common.error"), body: loadErr || t("common.errorBody"), onRetry: load, retryLabel: t("common.retry") }));

  const { instance, kpis, cache, mods } = data;
  const wall     = instance.wallClock || 84;
  const progress = status === "idle" ? 0 : Math.min(1, modelT / wall);

  const tabs = [
    { value: "overview",     label: t("tab.overview"),     icon: "activity" },
    { value: "performance",  label: t("tab.performance"),  icon: "zap" },
    { value: "mods",         label: t("tab.mods"),         icon: "package", badge: instance.mods },
    { value: "addmods",      label: "Add mods",            icon: "download" },
    { value: "worlds",       label: "Worlds",              icon: "globe" },
    { value: "servers",      label: "Servers",             icon: "globe" },
    { value: "host",         label: "Host server",         icon: "server" },
    { value: "screenshots",  label: "Screenshots",         icon: "image" },
    { value: "settings",     label: t("tab.settings"),     icon: "sliders" },
  ];

  const playBtn = status === "idle"
    ? React.createElement(Btn, { variant: "primary", size: "lg", icon: "play", onClick: startLaunch }, t("common.play"))
    : status === "launching"
      ? React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement(Btn, { variant: "accentSoft", size: "lg", icon: "loader", iconSpin: true, disabled: true },
            React.createElement("span", { className: "tnum" },
              t("common.launching") + (modelT > 0 ? " " + modelT.toFixed(0) + "s" : ""))),
          React.createElement(Btn, { variant: "outline", size: "lg", icon: "square", onClick: stop }))
      : React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement(Badge, { tone: "success", dot: true, style: { height: 46, padding: "0 18px", fontSize: 13.5 } }, t("common.running")),
          React.createElement(Btn, { variant: "outline", size: "lg", icon: "power", onClick: stop }, t("common.stop")));

  return React.createElement("div", { style: { padding: "20px 30px 40px", maxWidth: 1320, margin: "0 auto" } },
    React.createElement("div", { style: { marginBottom: 20 } },
      React.createElement("button", { className: "no-drag", onClick: () => navigate("library"),
        style: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 13, fontWeight: 600, marginBottom: 14, padding: 0 } },
        React.createElement(Icon, { name: "chevronLeft", size: 16 }), t("nav.library")),
      React.createElement("div", {
        className: "glass sheen",
        style: {
          borderRadius: "var(--r-2xl)", padding: 20, position: "relative", overflow: "hidden",
          background: `radial-gradient(110% 160% at 88% -20%, ${instance.accent}33, transparent 55%), var(--panel)`,
        },
      },
        React.createElement(Icon, { name: "snowflake", size: 200,
          style: { position: "absolute", right: -40, top: -60, color: instance.accent, opacity: 0.12 } }),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", position: "relative" } },
          React.createElement("div", { style: { width: 60, height: 60, borderRadius: 16, background: "var(--panel-solid)", border: "1px solid var(--border-strong)", display: "grid", placeItems: "center", color: instance.accent, flexShrink: 0 } },
            React.createElement(Icon, { name: instance.loader === "Fabric" ? "layers" : instance.loader === "Forge" ? "cpu" : "gem", size: 30 })),
          React.createElement("div", { style: { flex: 1, minWidth: 220 } },
            React.createElement("h1", { style: { margin: 0, fontSize: 24, fontWeight: 730, letterSpacing: "-0.02em" } }, instance.name),
            React.createElement("div", { style: { display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" } },
              React.createElement(Badge, { tone: "neutral", icon: "layers" }, (instance.loader || "?") + (instance.loaderVer ? " " + instance.loaderVer : "")),
              instance.mc && React.createElement(Badge, { tone: "neutral", icon: "cpu" }, "MC " + instance.mc),
              React.createElement(Badge, { tone: "neutral", icon: "package" }, t("lib.modsCount", { n: instance.mods })),
              React.createElement(Badge, { tone: "neutral", icon: "ram" }, fmt.ram(instance.ramMin) + " – " + fmt.ram(instance.ramMax)),
              cacheBadge(instance.cacheState, t),
              hasBridge && instance.residentMB > 0 && React.createElement(Badge, { tone: "neutral", icon: "database" }, instance.residentMB + " MB"),
            ),
          ),
          hasBridge && React.createElement(Tip, { label: "Open the live game console in its own window" },
            React.createElement(Btn, { variant: "outline", size: "lg", icon: "terminal",
              onClick: () => api.openConsole && api.openConsole(instance.id).catch(() => {}) })),
          playBtn,
        ),
      ),
    ),
    React.createElement("div", { style: { marginBottom: 22 } },
      React.createElement(Tabs, { tabs, value: tab, onChange: setTab })),
    React.createElement("div", { key: tab, className: "anim-fadein" },
      tab === "overview"    && React.createElement(OverviewTab, { instance, kpis, launch: { status, modelT, progress }, t, fmt }),
      tab === "performance" && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
        React.createElement(HealthCard, { instance, api, hasBridge }),
        React.createElement(PerformanceTab, { instance, cache, t, fmt, api, hasBridge })),
      tab === "mods"        && React.createElement(ModsTab, { instance, mods, t, fmt, api, hasBridge, onModsChanged: refreshMods }),
      tab === "addmods"     && React.createElement(InstanceModBrowser, { instance, api, hasBridge, onChanged: refreshMods }),
      tab === "worlds"      && React.createElement(WorldsTab, { instance, api, hasBridge, fmt }),
      tab === "servers"     && React.createElement(ServersTab, { instance, api, hasBridge }),
      tab === "host"        && React.createElement(HostServerTab, { instance, api, hasBridge }),
      tab === "screenshots" && React.createElement(ScreenshotsTab, { instance, api, hasBridge }),
      tab === "settings"    && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
        React.createElement(ProfileApplyCard, { instance, api, hasBridge }),
        React.createElement(ModpackUpdateCard, { instance, api, hasBridge }),
        React.createElement(ModpackIOCard, { instance, api, hasBridge }),
        React.createElement(SettingsTab, { instance, t, fmt, api, hasBridge }),
      ),
    ),
  );
}

function DetailSkeleton() {
  return React.createElement("div", { style: { padding: "20px 30px", maxWidth: 1320, margin: "0 auto" } },
    React.createElement(Skeleton, { h: 14, w: 90, style: { marginBottom: 16 } }),
    React.createElement(Skeleton, { h: 104, r: "var(--r-2xl)" }),
    React.createElement("div", { style: { display: "flex", gap: 24, margin: "24px 0" } },
      Array.from({ length: 4 }).map((_, i) => React.createElement(Skeleton, { key: i, h: 18, w: 90 }))),
    React.createElement(Skeleton, { h: 280, r: "var(--r-2xl)" }),
  );
}

window.CryoInstanceDetail = { InstanceDetail };
