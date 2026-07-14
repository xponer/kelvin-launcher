/* ============================================================
   Kelvin вЂ” Instance Detail: shell + Overview tab + LaunchCrystal
   ============================================================ */
const { useState: iS, useEffect: iE, useRef: iR, useMemo: iMe, useCallback: iCb } = React;

/* ---- the frost crystal that fills as the boot progresses ---- */
const CRYSTAL_PTS = "80,6 148,72 132,196 80,248 28,196 12,72";
function LaunchCrystal({ progress, running, idle }) {
  const fillTop = 248 - progress * 242;
  const glow = 0.25 + progress * 0.75;
  return React.createElement("div", { style: { position: "relative", width: 160, height: 254, flexShrink: 0 } },
    React.createElement("svg", { viewBox: "0 0 160 254", width: 160, height: 254, style: { display: "block", overflow: "visible" } },
      React.createElement("defs", null,
        React.createElement("linearGradient", { id: "cryFill", x1: 0, y1: 1, x2: 0, y2: 0 },
          React.createElement("stop", { offset: "0%", stopColor: "var(--acc-3)" }),
          React.createElement("stop", { offset: "55%", stopColor: "var(--acc-2)" }),
          React.createElement("stop", { offset: "100%", stopColor: "var(--acc-1)" }),
        ),
        React.createElement("clipPath", { id: "cryClip" },
          React.createElement("polygon", { points: CRYSTAL_PTS }),
        ),
        React.createElement("filter", { id: "cryGlow", x: "-40%", y: "-40%", width: "180%", height: "180%" },
          React.createElement("feGaussianBlur", { stdDeviation: 6, result: "b" }),
          React.createElement("feMerge", null,
            React.createElement("feMergeNode", { in: "b" }),
            React.createElement("feMergeNode", { in: "SourceGraphic" }),
          ),
        ),
      ),
      // empty vessel
      React.createElement("polygon", { points: CRYSTAL_PTS, fill: "var(--panel-2)", stroke: "var(--border-strong)", strokeWidth: 1.5 }),
      // animated fill
      React.createElement("g", { clipPath: "url(#cryClip)" },
        React.createElement("rect", {
          x: 0, y: fillTop, width: 160, height: 254, fill: "url(#cryFill)",
          style: { transition: "y .25s linear", opacity: 0.92 },
        }),
        // surface line
        React.createElement("rect", { x: 0, y: fillTop, width: 160, height: 2.5, fill: "var(--acc-1)", opacity: progress > 0.01 ? 0.95 : 0, style: { transition: "y .25s linear" } }),
        // frost striations
        (running || progress > 0) && React.createElement("g", { opacity: 0.4 },
          [40, 80, 120, 160, 200].map((y, i) => React.createElement("line", { key: i, x1: 0, x2: 160, y1: y, y2: y - 6, stroke: "var(--acc-1)", strokeWidth: 0.8, opacity: y > fillTop ? 0.5 : 0 })),
        ),
        // shimmer sweep
        running && React.createElement("rect", {
          x: -60, y: 0, width: 50, height: 254, fill: "rgba(255,255,255,0.25)",
          style: { animation: "crystalShine 2.4s linear infinite" },
        }),
      ),
      // facet outline
      React.createElement("polygon", {
        points: CRYSTAL_PTS, fill: "none", stroke: "var(--acc-2)", strokeWidth: 2,
        style: { filter: `drop-shadow(0 0 ${10 * glow}px var(--acc-glow))`, opacity: 0.5 + glow * 0.5 },
      }),
      // interior facets
      React.createElement("g", { stroke: "var(--acc-1)", strokeWidth: 0.7, opacity: 0.28, fill: "none" },
        React.createElement("line", { x1: 80, y1: 6, x2: 80, y2: 248 }),
        React.createElement("line", { x1: 12, y1: 72, x2: 80, y2: 130 }),
        React.createElement("line", { x1: 148, y1: 72, x2: 80, y2: 130 }),
        React.createElement("line", { x1: 28, y1: 196, x2: 80, y2: 130 }),
        React.createElement("line", { x1: 132, y1: 196, x2: 80, y2: 130 }),
      ),
    ),
    React.createElement("div", {
      style: {
        position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center",
        pointerEvents: "none",
      },
    },
      React.createElement("div", null,
        React.createElement("div", { className: "tnum", style: { fontSize: 34, fontWeight: 750, lineHeight: 1, color: "var(--text)", textShadow: "0 2px 12px rgba(0,0,0,.5)" } },
          Math.round(progress * 100), React.createElement("span", { style: { fontSize: 16, opacity: 0.6 } }, "%")),
      ),
    ),
  );
}

/* ---- phase timeline with overlap visualization ---- */
function PhaseTimeline({ phases: rawPhases, modelT, wall, t }) {
  const phases = rawPhases || [];
  const labels = { bootstrap: t("ov.phase.bootstrap"), construction: t("ov.phase.construction"), setup: t("ov.phase.setup") };
  const descs = { bootstrap: t("ov.phase.bootstrap.desc"), construction: t("ov.phase.construction.desc"), setup: t("ov.phase.setup.desc") };
  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
    phases.map(p => {
      const startedAt = p.start, endAt = p.start + p.dur;
      const local = Math.max(0, Math.min(1, (modelT - startedAt) / p.dur));
      const active = modelT >= startedAt && modelT < endAt;
      const done = modelT >= endAt;
      const pending = modelT < startedAt;
      const tone = done ? "var(--success)" : active ? "var(--acc-2)" : "var(--text-faint)";
      return React.createElement("div", { key: p.key, style: { opacity: pending ? 0.5 : 1, transition: "opacity .3s" } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } },
          React.createElement("span", {
            style: {
              width: 18, height: 18, borderRadius: 6, display: "grid", placeItems: "center", flexShrink: 0,
              background: done ? "var(--success-dim)" : active ? "var(--acc-soft)" : "var(--panel-2)",
              color: tone, border: "1px solid " + (active ? "var(--acc-soft-2)" : "var(--border)"),
            },
          }, done ? React.createElement(Icon, { name: "check", size: 11 }) : active ? React.createElement("span", { style: { width: 6, height: 6, borderRadius: 99, background: "currentColor", animation: "pulseGlow 1s infinite" } }) : null),
          React.createElement("span", { style: { fontSize: 13.5, fontWeight: 650, color: done || active ? "var(--text)" : "var(--text-dim)" } }, labels[p.key]),
          React.createElement("span", { className: "tnum mono", style: { marginLeft: "auto", fontSize: 12, color: tone, fontWeight: 650 } },
            active ? (modelT - startedAt).toFixed(1) + "/" + p.dur + "s" : p.dur + "s"),
          !p.cacheable && React.createElement(Badge, { tone: "neutral", size: "sm" }, "not cacheable"),
        ),
        React.createElement("div", { style: { height: 5, borderRadius: 99, background: "var(--panel-hi)", overflow: "hidden", marginLeft: 28 } },
          React.createElement("div", { style: { width: (local * 100) + "%", height: "100%", background: done ? "var(--success)" : "var(--acc-grad)", borderRadius: 99, transition: "width .2s linear" } }),
        ),
        React.createElement("p", { style: { margin: "5px 0 0 28px", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.4 } }, descs[p.key]),
      );
    }),
  );
}

/* ---- KPI tile ---- */
function KpiTile({ icon, label, value, suffix = "", decimals = 0, tone = "neutral", delay = 0 }) {
  return React.createElement("div", {
    className: "glass sheen anim-fadeup",
    style: { borderRadius: "var(--r-lg)", padding: 16, animationDelay: delay + "ms" },
  },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--text-dim)" } },
      React.createElement(Icon, { name: icon, size: 15 }),
      React.createElement("span", { style: { fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em" } }, label),
    ),
    React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 4 } },
      React.createElement(CountUp, { value, decimals, className: "", style: { fontSize: 25, fontWeight: 720, color: tone === "accent" ? "var(--acc-text)" : "var(--text)", letterSpacing: "-0.01em" } }),
      suffix && React.createElement("span", { style: { fontSize: 13, color: "var(--text-faint)", fontWeight: 600 } }, suffix),
    ),
  );
}

/* ---- Overview tab ---- */
function OverviewTab({ instance, kpis, launch, t, fmt }) {
  const { status, modelT, progress } = launch;
  const wall = instance.wallClock;
  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },
    React.createElement(Card, { style: { borderRadius: "var(--r-2xl)" } },
      React.createElement("div", { style: { display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" } },
        React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14 } },
          React.createElement(LaunchCrystal, { progress, running: status === "launching", idle: status === "idle" }),
          React.createElement("div", { style: { textAlign: "center" } },
            React.createElement("div", { className: "tnum", style: { fontSize: 15, fontWeight: 700 } },
              status === "idle" ? "—" : modelT.toFixed(1) + "s",
              React.createElement("span", { style: { color: "var(--text-faint)", fontWeight: 500 } }, " / " + wall + "s")),
            React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)" } }, t("ov.toMenu")),
          ),
        ),
        React.createElement("div", { style: { flex: 1, minWidth: 300 } },
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, marginBottom: 16 } },
            React.createElement(Icon, { name: "activity", size: 17, style: { color: "var(--acc-2)" } }),
            React.createElement("h3", { style: { margin: 0, fontSize: 16, fontWeight: 680 } }, t("ov.liveTitle")),
          ),
          status === "idle"
            ? React.createElement("div", { style: { padding: "8px 0 20px", color: "var(--text-dim)", fontSize: 13.5, lineHeight: 1.5 } }, t("ov.idle"))
            : React.createElement(PhaseTimeline, { phases: instance.phases, modelT, wall, t }),
          React.createElement("div", {
            style: {
              display: "flex", gap: 10, marginTop: 16, padding: "11px 13px", borderRadius: "var(--r-md)",
              background: "var(--panel-2)", border: "1px solid var(--border)",
            },
          },
            React.createElement(Icon, { name: "info", size: 15, style: { color: "var(--text-faint)", marginTop: 1 } }),
            React.createElement("p", { style: { margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 } }, t("ov.phasesNote")),
          ),
        ),
      ),
    ),
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--gap-grid)" } },
      React.createElement(KpiTile, { icon: "clock", label: t("ov.kpi.last"), value: kpis.last, suffix: "s", decimals: 1, tone: "accent", delay: 0 }),
      React.createElement(KpiTile, { icon: "activity", label: t("ov.kpi.avg"), value: kpis.avg, suffix: "s", decimals: 1, delay: 40 }),
      React.createElement(KpiTile, { icon: "trendDown", label: t("ov.kpi.best"), value: kpis.best, suffix: "s", decimals: 1, delay: 80 }),
      React.createElement(KpiTile, { icon: "trendUp", label: t("ov.kpi.worst"), value: kpis.worst, suffix: "s", decimals: 1, delay: 120 }),
      React.createElement(KpiTile, { icon: "power", label: t("ov.kpi.launches"), value: kpis.launches, delay: 160 }),
      React.createElement(KpiTile, { icon: "gauge", label: t("ov.kpi.playtime"), value: Math.round(kpis.playtimeMin / 60), suffix: "h", delay: 200 }),
    ),
  );
}

window.CryoOverview = { OverviewTab, LaunchCrystal, PhaseTimeline, KpiTile };
