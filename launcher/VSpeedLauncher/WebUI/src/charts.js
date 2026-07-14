/* ============================================================
   Kelvin — lightweight responsive SVG charts
   (LineArea trend, StackedBars phase breakdown, CompareBars)
   ============================================================ */
const { useState: cS, useEffect: cE, useRef: cR, useMemo: cMm } = React;

function useMeasure() {
  const ref = cR(null);
  const [w, setW] = cS(640);
  cE(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

/* ---------------- Line + area trend ---------------- */
function LineArea({ data, height = 240, formatY = v => v, formatX = v => v, yUnit = "" }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = cS(null);
  const padL = 44, padR = 16, padT = 16, padB = 28;
  // Empty-data guard — Math.max/min over [] gives ±Infinity → NaN SVG coords
  if (!data || data.length === 0) {
    return React.createElement("div", { ref, style: { width: "100%", height, display: "grid", placeItems: "center" } },
      React.createElement("div", { style: { textAlign: "center", color: "var(--text-faint)" } },
        React.createElement(Icon, { name: "activity", size: 26, style: { opacity: 0.4, marginBottom: 8 } }),
        React.createElement("div", { style: { fontSize: 12.5 } }, "No launch history yet"),
        React.createElement("div", { style: { fontSize: 11, marginTop: 2 } }, "Launch a pack to start tracking boot times")));
  }
  const W = Math.max(280, w), H = height;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = data.map(d => d.v);
  const maxV = Math.max(...vals) * 1.12, minV = Math.min(0, Math.min(...vals));
  const xAt = i => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yAt = v => padT + innerH - ((v - minV) / (maxV - minV || 1)) * innerH;
  const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(d.v), d }));
  const line = smoothPath(pts);
  const area = line + ` L ${xAt(data.length - 1)} ${padT + innerH} L ${xAt(0)} ${padT + innerH} Z`;
  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => minV + (i / ticks) * (maxV - minV));
  const gid = "ln" + Math.round(maxV);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0, best = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(p.x - x); if (dd < best) { best = dd; nearest = i; } });
    setHover(nearest);
  }
  const hp = hover != null ? pts[hover] : null;

  return React.createElement("div", { ref, style: { width: "100%", position: "relative" } },
    React.createElement("svg", { width: W, height: H, onMouseMove: onMove, onMouseLeave: () => setHover(null), style: { display: "block", overflow: "visible" } },
      React.createElement("defs", null,
        React.createElement("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
          React.createElement("stop", { offset: "0%", stopColor: "var(--acc-2)", stopOpacity: 0.34 }),
          React.createElement("stop", { offset: "100%", stopColor: "var(--acc-2)", stopOpacity: 0 }),
        ),
      ),
      gridY.map((gv, i) => React.createElement("g", { key: i },
        React.createElement("line", { x1: padL, x2: W - padR, y1: yAt(gv), y2: yAt(gv), stroke: "var(--border-faint)", strokeWidth: 1 }),
        React.createElement("text", { x: padL - 9, y: yAt(gv) + 4, textAnchor: "end", fontSize: 10.5, fill: "var(--text-faint)", className: "tnum" }, formatY(gv)),
      )),
      React.createElement("path", { d: area, fill: `url(#${gid})` }),
      React.createElement("path", { d: line, fill: "none", stroke: "var(--acc-2)", strokeWidth: 2.4, strokeLinecap: "round", style: { filter: "drop-shadow(0 4px 10px var(--acc-glow))" } }),
      data.map((d, i) => (i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) &&
        React.createElement("text", { key: i, x: xAt(i), y: H - 8, textAnchor: "middle", fontSize: 10, fill: "var(--text-faint)" }, formatX(d, i))),
      hp && React.createElement("g", null,
        React.createElement("line", { x1: hp.x, x2: hp.x, y1: padT, y2: padT + innerH, stroke: "var(--acc-2)", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.5 }),
        React.createElement("circle", { cx: hp.x, cy: hp.y, r: 5, fill: "var(--acc-2)", stroke: "var(--bg-1)", strokeWidth: 2.5 }),
      ),
    ),
    hp && React.createElement("div", {
      className: "glass-pop", style: {
        position: "absolute", left: Math.min(W - 130, Math.max(0, hp.x - 60)), top: hp.y - 56,
        padding: "7px 10px", borderRadius: 9, pointerEvents: "none", fontSize: 12,
      },
    },
      React.createElement("div", { className: "tnum", style: { fontWeight: 700, fontSize: 14 } }, formatY(hp.d.v), yUnit),
      React.createElement("div", { style: { color: "var(--text-faint)", fontSize: 11, marginTop: 1 } }, formatX(hp.d, hover)),
    ),
  );
}

/* ---------------- Stacked bars (phase breakdown) ---------------- */
function StackedBars({ data, segments, height = 230, formatV = v => v, unit = "" }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = cS(null);
  const padL = 40, padR = 12, padT = 14, padB = 30;
  if (!data || data.length === 0) {
    return React.createElement("div", { ref, style: { width: "100%", height, display: "grid", placeItems: "center", color: "var(--text-faint)", fontSize: 12.5 } }, "No data yet");
  }
  const W = Math.max(280, w), H = height;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const totals = data.map(d => segments.reduce((s, seg) => s + (d[seg.key] || 0), 0));
  const maxV = (Math.max(0, ...totals) * 1.1) || 1;
  const yAt = v => padT + innerH - (v / (maxV || 1)) * innerH;
  const bw = Math.min(64, (innerW / data.length) * 0.56);
  const gap = innerW / data.length;
  const ticks = 4;
  return React.createElement("div", { ref, style: { width: "100%", position: "relative" } },
    React.createElement("svg", { width: W, height: H, style: { display: "block", overflow: "visible" } },
      Array.from({ length: ticks + 1 }, (_, i) => {
        const gv = (i / ticks) * maxV;
        return React.createElement("g", { key: i },
          React.createElement("line", { x1: padL, x2: W - padR, y1: yAt(gv), y2: yAt(gv), stroke: "var(--border-faint)" }),
          React.createElement("text", { x: padL - 8, y: yAt(gv) + 4, textAnchor: "end", fontSize: 10.5, fill: "var(--text-faint)", className: "tnum" }, Math.round(gv)),
        );
      }),
      data.map((d, i) => {
        const cx = padL + gap * i + gap / 2;
        let acc = 0;
        return React.createElement("g", { key: i, onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null), style: { cursor: "pointer" } },
          segments.map((seg, si) => {
            const v = d[seg.key] || 0;
            const y0 = yAt(acc), y1 = yAt(acc + v); acc += v;
            return React.createElement("rect", {
              key: si, x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1),
              fill: seg.color, rx: 3, opacity: hover == null || hover === i ? 1 : 0.4,
              style: { transition: "opacity .15s" },
            });
          }),
          React.createElement("text", { x: cx, y: H - 9, textAnchor: "middle", fontSize: 10.5, fill: "var(--text-dim)", fontWeight: 600 }, d.label),
          React.createElement("text", { x: cx, y: yAt(totals[i]) - 7, textAnchor: "middle", fontSize: 11, fill: "var(--text)", className: "tnum", fontWeight: 700 }, formatV(totals[i]) + unit),
        );
      }),
    ),
    hover != null && React.createElement("div", {
      className: "glass-pop", style: {
        position: "absolute", left: Math.min(W - 160, padL + gap * hover + gap / 2 - 70), top: 6,
        padding: "8px 11px", borderRadius: 10, pointerEvents: "none", minWidth: 140,
      },
    },
      React.createElement("div", { style: { fontWeight: 700, fontSize: 12.5, marginBottom: 5 } }, data[hover].label),
      segments.map((seg, si) => React.createElement("div", { key: si, style: { display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, marginTop: 3 } },
        React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: seg.color } }),
        React.createElement("span", { style: { color: "var(--text-dim)", flex: 1 } }, seg.label),
        React.createElement("span", { className: "tnum", style: { fontWeight: 650 } }, formatV(data[hover][seg.key] || 0) + unit),
      )),
    ),
  );
}

/* ---------------- Compare bars (cold vs warm) ---------------- */
function CompareBars({ rows, formatV = v => v + "s", height }) {
  if (!rows || rows.length === 0) {
    return React.createElement("div", { style: { padding: 24, textAlign: "center", color: "var(--text-faint)", fontSize: 12.5 } }, "No data yet");
  }
  const maxV = Math.max(1, ...rows.flatMap(r => [r.cold || 0, r.warm || 0]));
  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
    rows.map((r, i) => React.createElement("div", { key: i },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 9, fontSize: 12.5 } },
        React.createElement("span", { style: { color: "var(--text-dim)", fontWeight: 600 } }, r.label),
        React.createElement("span", { className: "tnum", style: { color: "var(--success)", fontWeight: 700 } },
          "−" + Math.round((1 - r.warm / r.cold) * 100) + "%"),
      ),
      React.createElement(Bar, { label: "Cold", value: r.cold, max: maxV, color: "var(--text-faint)", formatV }),
      React.createElement("div", { style: { height: 8 } }),
      React.createElement(Bar, { label: "VSpeed", value: r.warm, max: maxV, color: "var(--acc-grad)", formatV, glow: true }),
    )),
  );
}
function Bar({ label, value, max, color, formatV, glow }) {
  const pct = (value / max) * 100;
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
    React.createElement("span", { style: { width: 52, fontSize: 11, color: "var(--text-faint)", fontWeight: 600 } }, label),
    React.createElement("div", { style: { flex: 1, height: 22, borderRadius: 7, background: "var(--panel-2)", overflow: "hidden", position: "relative" } },
      React.createElement("div", {
        style: {
          width: pct + "%", height: "100%", background: color, borderRadius: 7,
          transition: "width .8s var(--ease)", boxShadow: glow ? "0 0 16px var(--acc-glow)" : "none",
        },
      }),
    ),
    React.createElement("span", { className: "tnum mono", style: { width: 56, textAlign: "right", fontSize: 12.5, fontWeight: 700 } }, formatV(value)),
  );
}

/* ---------------- Donut (cache composition) ---------------- */
function Donut({ segments, size = 132, thickness = 16, center }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2, C = 2 * Math.PI * r;
  let off = 0;
  return React.createElement("div", { style: { position: "relative", width: size, height: size } },
    React.createElement("svg", { width: size, height: size, style: { transform: "rotate(-90deg)" } },
      React.createElement("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "var(--panel-hi)", strokeWidth: thickness }),
      segments.map((s, i) => {
        const len = (s.value / total) * C;
        const el = React.createElement("circle", {
          key: i, cx: size / 2, cy: size / 2, r, fill: "none", stroke: s.color, strokeWidth: thickness,
          strokeDasharray: `${len} ${C - len}`, strokeDashoffset: -off, strokeLinecap: "round",
          style: { transition: "stroke-dasharray .8s var(--ease)" },
        });
        off += len;
        return el;
      }),
    ),
    center && React.createElement("div", {
      style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" },
    }, center),
  );
}

Object.assign(window, { LineArea, StackedBars, CompareBars, Donut });
