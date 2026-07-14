/* ============================================================
   Kelvin - Dashboard: REAL aggregate data from the bridge
   (instances + cache sizes + launch history + benchmark results)
   ============================================================ */
const { useState: hS, useEffect: hE, useMemo: hM } = React;
var { useApp } = window.CryoStore;

function DashCard({ icon, label, children, style = {} }) {
  return React.createElement(Card, { style: { borderRadius: "var(--r-xl)", ...style } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 16, color: "var(--text-dim)" } },
      React.createElement(Icon, { name: icon, size: 16, style: { color: "var(--acc-2)" } }),
      React.createElement("h3", { style: { margin: 0, fontSize: 14, fontWeight: 680, color: "var(--text)" } }, label),
    ),
    children);
}

function StatCard({ icon, label, value, suffix, decimals = 0, tone, delay = 0 }) {
  return React.createElement("div", { className: "glass sheen anim-fadeup", style: { borderRadius: "var(--r-lg)", padding: 16, animationDelay: delay + "ms" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--text-dim)" } },
      React.createElement(Icon, { name: icon, size: 15 }), React.createElement("span", { style: { fontSize: 11, fontWeight: 600, letterSpacing: "0.02em" } }, label)),
    React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 4 } },
      React.createElement(CountUp, { value: value || 0, decimals, style: { fontSize: 24, fontWeight: 730, letterSpacing: "-0.01em", color: tone === "accent" ? "var(--acc-text)" : tone === "success" ? "var(--success)" : "var(--text)" } }),
      suffix && React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-faint)", fontWeight: 600 } }, suffix)),
  );
}

function readBench(id) {
  try { return JSON.parse(localStorage.getItem("cryo.bench." + id) || "{}"); } catch { return {}; }
}

function DashboardScreen() {
  const { api, t, fmt } = useApp();
  const [state, setState] = hS("loading");
  const [insts, setInsts] = hS([]);
  const [caches, setCaches] = hS({});   // id -> cache
  const [stats, setStats] = hS({});     // id -> stats
  const [history, setHistory] = hS([]);
  const [instId, setInstId] = hS(null);
  const [period, setPeriod] = hS("all");

  async function load() {
    setState("loading");
    try {
      const list = await api.getInstances();
      setInsts(list);
      if (list.length && !instId) setInstId(list[0].id);
      const [hist, cacheArr, statArr] = await Promise.all([
        api.getHistory().catch(() => []),
        Promise.all(list.map(i => api.getCache(i.id).then(c => [i.id, c]).catch(() => [i.id, null]))),
        Promise.all(list.map(i => (api.getStats ? api.getStats(i.id) : Promise.resolve(null)).then(s => [i.id, s]).catch(() => [i.id, null]))),
      ]);
      setHistory(hist);
      setCaches(Object.fromEntries(cacheArr));
      setStats(Object.fromEntries(statArr));
      setState(list.length ? "ready" : "empty");
    } catch (e) {
      console.error("[Dashboard] load failed:", e);
      setState("error");
    }
  }
  hE(() => { load(); }, []);

  // ---- aggregates (all real) ----
  const agg = hM(() => {
    let cacheBytes = 0, cachedCount = 0, entries = 0, savedMs = 0, benchPairs = 0;
    insts.forEach(i => {
      const c = caches[i.id];
      if (c && c.sizeBytes > 0) { cacheBytes += c.sizeBytes; cachedCount++; }
      const s = stats[i.id];
      if (s && s.available) entries += s.totalEntries || 0;
      const b = readBench(i.id);
      if (b.vanilla && b.optimized && b.vanilla.totalMs > 0 && b.optimized.totalMs > 0) {
        savedMs += (b.vanilla.totalMs - b.optimized.totalMs); benchPairs++;
      }
    });
    const walls = history.map(h => h.wall).filter(Boolean);
    return {
      instances: insts.length,
      cachedCount,
      cacheBytes,
      entries,
      launches: history.length,
      avgBoot: walls.length ? Math.round(walls.reduce((a, b) => a + b, 0) / walls.length) : 0,
      bestBoot: walls.length ? Math.min(...walls) : 0,
      savedSec: +(savedMs / 1000).toFixed(1),
      benchPairs,
    };
  }, [insts, caches, stats, history]);

  const trendData = hM(() => {
    let h = history.filter(x => x.instId === instId).sort((a, b) => a.t - b.t);
    if (period === "7") h = h.slice(-7);
    else if (period === "14") h = h.slice(-14);
    return h.map(x => ({ v: x.wall, t: x.t }));
  }, [history, instId, period]);

  const breakdown = hM(() => insts.map(i => {
    const h = history.filter(x => x.instId === i.id).sort((a, b) => a.t - b.t);
    const last = h[h.length - 1];
    return {
      label: i.name.split(":")[0].split(" ").slice(0, 2).join(" "),
      boot: last ? last.boot : 0, cons: last ? last.cons : 0, setup: last ? last.setup : 0,
    };
  }).filter(b => b.boot + b.cons + b.setup > 0), [insts, history]);

  const compareRows = hM(() => insts.map(i => {
    const b = readBench(i.id);
    if (b.vanilla && b.optimized && b.vanilla.totalMs > 0 && b.optimized.totalMs > 0)
      return { label: i.name, cold: +(b.vanilla.totalMs / 1000).toFixed(2), warm: +(b.optimized.totalMs / 1000).toFixed(2) };
    return null;
  }).filter(Boolean), [insts, history, caches]);

  const segs = [
    { key: "boot", label: t("ov.phase.bootstrap"), color: "var(--acc-1)" },
    { key: "cons", label: t("ov.phase.construction"), color: "var(--acc-3)" },
    { key: "setup", label: t("ov.phase.setup"), color: "var(--acc-2)" },
  ];

  if (state === "loading") return React.createElement("div", { style: { padding: "26px 30px", maxWidth: 1320, margin: "0 auto" } },
    React.createElement(Skeleton, { h: 26, w: 180, style: { marginBottom: 22 } }),
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 18 } }, Array.from({ length: 4 }).map((_, i) => React.createElement(Skeleton, { key: i, h: 88, r: "var(--r-lg)" }))),
    React.createElement(Skeleton, { h: 280, r: "var(--r-xl)" }));
  if (state === "error") return React.createElement("div", { style: { padding: 40 } }, React.createElement(ErrorState, { title: t("common.error"), body: t("common.errorBody"), onRetry: load, retryLabel: t("common.retry") }));

  return React.createElement("div", { style: { padding: "26px 30px 40px", maxWidth: 1320, margin: "0 auto" } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, marginBottom: 22, flexWrap: "wrap" } },
      React.createElement("h1", { style: { margin: 0, fontSize: 24, fontWeight: 720, letterSpacing: "-0.02em" } }, t("dash.title")),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(Btn, { variant: "ghost", size: "icon", onClick: load }, React.createElement(Icon, { name: "refresh", size: 16 })),
      React.createElement(Select, { value: period, onChange: setPeriod, size: "sm", width: 150, icon: "clock",
        options: [{ value: "all", label: t("common.all") }, { value: "14", label: "Last 14" }, { value: "7", label: "Last 7" }] }),
    ),

    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: "var(--gap-grid)", marginBottom: "var(--gap-grid)" } },
      React.createElement(StatCard, { icon: "gem", label: "Instances", value: agg.instances, delay: 0 }),
      React.createElement(StatCard, { icon: "zap", label: "Caches built", value: agg.cachedCount, suffix: "/ " + agg.instances, tone: "accent", delay: 40 }),
      React.createElement(StatCard, { icon: "database", label: "Cache on disk", value: agg.cacheBytes / (1024 * 1024), suffix: "MB", decimals: 1, delay: 80 }),
      React.createElement(StatCard, { icon: "sparkles", label: "Entries cached", value: agg.entries, delay: 120 }),
      React.createElement(StatCard, { icon: "power", label: "Launches tracked", value: agg.launches, delay: 160 }),
      React.createElement(StatCard, { icon: "clock", label: "Avg boot", value: agg.avgBoot, suffix: "s", delay: 200 }),
      React.createElement(StatCard, { icon: "trendDown", label: "Best boot", value: agg.bestBoot, suffix: "s", tone: "success", delay: 240 }),
      React.createElement(StatCard, { icon: "gauge", label: "Data load saved", value: agg.savedSec, suffix: "s", tone: "success", decimals: 1, delay: 280 }),
    ),

    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: "var(--gap-grid)", marginBottom: "var(--gap-grid)" }, className: "cryo-dash-grid" },
      React.createElement(DashCard, { icon: "activity", label: t("dash.trend") },
        React.createElement("div", { style: { marginBottom: 14, display: "flex", justifyContent: "flex-end" } },
          React.createElement(Select, { value: instId, onChange: setInstId, size: "sm", width: 220,
            options: insts.map(i => ({ value: i.id, label: i.name })) })),
        React.createElement(LineArea, { data: trendData, height: 230, yUnit: "s", formatY: v => v.toFixed(0), formatX: (d) => fmt.ago(d.t, "en") }),
      ),
      React.createElement(DashCard, { icon: "bars", label: t("dash.breakdown") },
        React.createElement(StackedBars, { data: breakdown, segments: segs, height: 244, unit: "s" }),
        breakdown.length > 0 && React.createElement("div", { style: { display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" } },
          segs.map(s => React.createElement("span", { key: s.key, style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" } },
            React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: s.color } }), s.label))),
      ),
    ),

    React.createElement(DashCard, { icon: "shield", label: "Data load — Vanilla vs VSpeed (from Benchmark)" },
      compareRows.length > 0
        ? React.createElement(CompareBars, { rows: compareRows, formatV: v => v.toFixed(2) + "s" })
        : React.createElement("div", { style: { padding: "14px 4px", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 } },
            "No benchmark data yet. Open an instance → Performance → Benchmark, run both Vanilla and Optimized (enter a world once each), and the comparison appears here."),
    ),
  );
}

window.CryoDashboard = { DashboardScreen };
