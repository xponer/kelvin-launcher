/* ============================================================
   Kelvin вЂ” Library screen
   ============================================================ */
const { useState: lS, useEffect: lE, useMemo: lM, useCallback: lCb } = React;
var { useApp } = window.CryoStore;

function cacheBadge(state, t) {
  if (state === "ready")      return React.createElement(Badge, { tone: "accent", icon: "zap",     size: "sm" }, t("cache.ready"));
  if (state === "rebuilding") return React.createElement(Badge, { tone: "warn",   icon: "refresh", size: "sm" }, t("cache.rebuilding"));
  return React.createElement(Badge, { tone: "neutral", size: "sm" }, t("cache.off"));
}

function Banner({ instance, h = 96 }) {
  const a = instance.accent || "var(--acc-2)";
  // Flat cover: graphite plate, big low-key loader glyph, a single accent
  // hairline along the top edge — the instance's colour used as a signal,
  // not a light show.
  return React.createElement("div", {
    style: {
      height: h, borderRadius: "var(--r-lg)", position: "relative", overflow: "hidden",
      background: "var(--panel-2)",
      border: "1px solid var(--border)",
      borderTop: "2px solid " + a,
    },
  },
    React.createElement(Icon, { name: instance.loader === "Fabric" ? "layers" : instance.loader === "Forge" ? "cpu" : "gem",
      size: h * 0.92, style: { position: "absolute", right: -10, bottom: -16, color: a, opacity: 0.10 } }),
    React.createElement("div", { style: { position: "absolute", left: 14, bottom: 12, width: 40, height: 40, borderRadius: "var(--r-md)", background: "var(--panel-solid)", border: "1px solid var(--border-strong)", display: "grid", placeItems: "center", color: a } },
      React.createElement(Icon, { name: instance.loader === "Fabric" ? "layers" : instance.loader === "Forge" ? "cpu" : "gem", size: 20 })),
  );
}

/* Confirm-delete overlay */
function DeleteConfirm({ instance, onConfirm, onCancel }) {
  return React.createElement("div", {
    onMouseDown: e => { if (e.target === e.currentTarget) onCancel(); },
    style: { position: "fixed", inset: 0, zIndex: 700, display: "grid", placeItems: "center",
      background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)" },
  },
    React.createElement("div", { className: "glass-pop anim-fadein",
      style: { width: 380, borderRadius: "var(--r-xl)", padding: 28 },
      onClick: e => e.stopPropagation() },
      React.createElement("div", { style: { width: 52, height: 52, borderRadius: 14, background: "var(--error-dim)", display: "grid", placeItems: "center", color: "var(--error)", marginBottom: 18 } },
        React.createElement(Icon, { name: "trash", size: 26 })),
      React.createElement("h3", { style: { margin: "0 0 8px", fontSize: 18, fontWeight: 700 } }, "Remove from launcher?"),
      React.createElement("p", { style: { margin: "0 0 24px", fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 } },
        React.createElement("strong", null, instance.name), " will be removed from Kelvin's launcher list.",
        React.createElement("br", null),
        React.createElement("span", { style: { color: "var(--text-faint)" } },
          "The actual Prism instance and game files are NOT deleted.")),
      React.createElement("div", { style: { display: "flex", gap: 10, justifyContent: "flex-end" } },
        React.createElement(Btn, { variant: "ghost", onClick: onCancel }, "Cancel"),
        React.createElement(Btn, { variant: "danger", icon: "trash", onClick: onConfirm }, "Remove"),
      ),
    ),
  );
}

/* Create-instance dialog — native, no Prism */
function CreateInstanceDialog({ api, hasBridge, onClose, onCreated }) {
  const [name, setName]     = lS("");
  const [mc, setMc]         = lS("1.21.1");
  const [loader, setLoader] = lS("NeoForge");
  const [lver, setLver]     = lS("");
  const [lvers, setLvers]   = lS([]);          // NeoForge versions
  const [ram, setRam]       = lS(6144);
  const [busy, setBusy]     = lS(false);
  const sysRam              = useSysRamMb(api);

  // Fetch NeoForge versions when loader/mc changes
  lE(() => {
    if (!hasBridge || loader !== "NeoForge") { setLvers([]); setLver(""); return; }
    let alive = true;
    api.getNeoForgeVersions(mc).then(r => { if (alive && r && r.versions) { setLvers(r.versions); setLver(""); } }).catch(() => {});
    return () => { alive = false; };
  }, [loader, mc, hasBridge]);

  lE(() => { const m = maxRamMb(sysRam); if (sysRam && ram > m) setRam(m); }, [sysRam]);

  async function create() {
    if (!name.trim()) { window.toast({ tone: "warn", icon: "info", title: "Enter a name" }); return; }
    setBusy(true);
    const r = await api.createInstance({ name: name.trim(), mcVersion: mc.trim(), loader, loaderVersion: lver, ramMax: ram }).catch(e => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (r && r.ok) {
      window.toast({ tone: "success", icon: "check", title: "Instance created", body: name + (loader === "NeoForge" ? " · installing NeoForge…" : "") });
      onCreated && onCreated(r.id);
      onClose();
    } else window.toast({ tone: "danger", icon: "alert", title: "Couldn't create", body: (r && r.error) || "" });
  }

  const field = (label, child) => React.createElement("div", { style: { marginBottom: 14 } },
    React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 } }, label), child);
  const inp = { height: 36, padding: "0 11px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13, width: "100%", outline: "none", fontFamily: "inherit" };

  return React.createElement("div", {
    onMouseDown: e => { if (e.target === e.currentTarget) onClose(); },
    style: { position: "fixed", inset: 0, zIndex: 700, display: "grid", placeItems: "center", background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)" },
  },
    React.createElement("div", { className: "glass-pop anim-fadein", style: { width: 460, borderRadius: "var(--r-xl)", padding: 26 }, onClick: e => e.stopPropagation() },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 11, marginBottom: 18 } },
        React.createElement("div", { style: { width: 42, height: 42, borderRadius: 12, background: "var(--acc-grad)", display: "grid", placeItems: "center", color: "var(--acc-ink)" } }, React.createElement(Icon, { name: "plus", size: 22 })),
        React.createElement("h3", { style: { margin: 0, fontSize: 18, fontWeight: 720 } }, "New Instance")),

      field("Name", React.createElement("input", { value: name, onChange: e => setName(e.target.value), placeholder: "My Modpack", autoFocus: true, style: inp, className: "no-drag" })),
      React.createElement("div", { style: { display: "flex", gap: 12 } },
        React.createElement("div", { style: { flex: 1 } }, field("Minecraft version", React.createElement("input", { value: mc, onChange: e => setMc(e.target.value), placeholder: "1.21.1", style: inp, className: "no-drag" }))),
        React.createElement("div", { style: { flex: 1 } }, field("Loader", React.createElement(Select, { value: loader, onChange: setLoader, width: "100%",
          options: ["NeoForge", "Vanilla", "Fabric", "Forge", "Quilt"] })))),

      loader === "NeoForge" && field("NeoForge version", React.createElement(Select, { value: lver, onChange: setLver, width: "100%",
        options: [{ value: "", label: lvers.length ? "Latest stable" : "Latest (loading…)" }, ...lvers.slice(0, 25).map(v => ({ value: v, label: v }))] })),
      (loader === "Fabric" || loader === "Forge" || loader === "Quilt") && React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginBottom: 14, lineHeight: 1.5 } },
        "The latest " + loader + " loader for this MC version will be installed automatically — launches without Prism."),

      field("Max RAM — " + (ram / 1024).toFixed(1) + " GB", React.createElement(Slider, { value: Math.min(ram, maxRamMb(sysRam)), min: 1024, max: maxRamMb(sysRam), step: 512, onChange: setRam, format: v => (v / 1024).toFixed(1) + "G" })),

      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 } },
        React.createElement(Btn, { variant: "ghost", onClick: onClose, disabled: busy }, "Cancel"),
        React.createElement(Btn, { variant: "primary", icon: busy ? "refresh" : "check", iconSpin: busy, disabled: busy, onClick: create }, busy ? "Creating…" : "Create")),
    ),
  );
}

function InstanceCard({ instance, kpi, onOpen, onPlay, t, fmt, menu, tagColors }) {
  const stateTone = instance.state === "ready" ? "success" : instance.state === "hibernated" ? "accent" : instance.state === "loading" ? "warn" : "neutral";
  return React.createElement("div", {
    className: "glass sheen lift anim-fadeup", onClick: onOpen,
    style: { borderRadius: "var(--r-xl)", padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 12 },
  },
    React.createElement(Banner, { instance }),
    React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 15, fontWeight: 680, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, instance.name),
        React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 } },
          (instance.loader || "?") + (instance.mc ? " " + instance.mc : "")),
      ),
      React.createElement(Menu, {
        align: "right", items: menu,
        trigger: React.createElement("button", { className: "no-drag", style: { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text-dim)", display: "grid", placeItems: "center" } },
          React.createElement(Icon, { name: "dots", size: 16 })),
      }),
    ),
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
      React.createElement(Badge, { tone: "neutral", icon: "package", size: "sm" }, t("lib.modsCount", { n: instance.mods })),
      React.createElement(Badge, { tone: "neutral", icon: "ram",     size: "sm" }, fmt.ram(instance.ramMax)),
      cacheBadge(instance.cacheState, t),
      instance.state && instance.state !== "stopped" &&
        React.createElement(Badge, { tone: stateTone, size: "sm", dot: instance.state === "ready" || instance.state === "hibernated" },
          { stopped: "", loading: "Loading", ready: "Running", hibernated: "Hibernated", waking: "Waking", crashed: "Crashed" }[instance.state] || instance.state),
      (instance.tags || []).map(tg => React.createElement("span", { key: "tg-" + tg,
        style: { ...modTagChip(tg, true, tagColors && tagColors[tg]), padding: "3px 8px", display: "inline-flex", alignItems: "center" } }, tg)),
    ),
    instance.note && React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.4 } },
      React.createElement(Icon, { name: "stickyNote", size: 12, style: { flexShrink: 0 } }),
      React.createElement("span", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, instance.note)),
    React.createElement("div", { className: "hr" }),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 11, color: "var(--text-faint)" } },
          instance.lastPlayed ? t("lib.lastPlayed", { ago: fmt.ago(instance.lastPlayed, "en") }) : t("lib.never")),
        kpi && kpi.avg > 0 && React.createElement("div", { className: "tnum", style: { fontSize: 12.5, fontWeight: 600, marginTop: 1 } },
          "~" + kpi.avg + "s " + t("ov.toMenu")),
      ),
      React.createElement(Btn, { variant: "primary", icon: "play", onClick: e => { e.stopPropagation(); onPlay(); } }, t("common.play")),
    ),
  );
}

/* Dense data row — the library as an instrument table, not a card wall. */
const ROW_COLS = "18px 20px minmax(200px, 1fr) 150px 64px 56px 60px 64px 30px 30px";

function ListHeader() {
  const th = (label, right) => React.createElement("span", { className: "stencil", style: { textAlign: right ? "right" : "left" } }, label);
  return React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "center", gap: 10,
      padding: "7px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)" },
  }, th(""), th(""), th("instance"), th("loader"), th("mods", true), th("ram", true), th("cache", true), th("boot", true), th(""), th(""));
}

function InstanceRow({ instance, kpi, onOpen, onPlay, t, fmt, menu, tagColors }) {
  const a = instance.accent || "var(--acc-2)";
  const st = instance.state;
  const dotColor = st === "ready" ? "var(--success)" : (st === "loading" || st === "waking") ? "var(--warn)" : st === "crashed" ? "var(--error)" : "var(--border-strong)";
  const mono = (v, dim) => React.createElement("span", { className: "mono tnum", style: { fontSize: 11.5, color: dim ? "var(--text-faint)" : "var(--text-dim)", textAlign: "right" } }, v);
  return React.createElement("div", {
    className: "no-drag", onClick: onOpen,
    style: { display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "center", gap: 10,
      padding: "0 12px", height: 42, cursor: "pointer", borderBottom: "1px solid var(--border-faint)", transition: "background .1s" },
    onMouseEnter: e => { e.currentTarget.style.background = "var(--panel-2)"; },
    onMouseLeave: e => { e.currentTarget.style.background = "transparent"; },
  },
    React.createElement("span", { title: st || "stopped", style: { width: 7, height: 7, borderRadius: 1, background: dotColor, justifySelf: "center" } }),
    React.createElement(Icon, { name: instance.loader === "Fabric" ? "layers" : instance.loader === "Forge" ? "cpu" : "gem", size: 15, style: { color: a } }),
    React.createElement("span", { style: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 } },
      React.createElement("span", { style: { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, instance.name),
      (instance.tags || []).slice(0, 3).map(tg => React.createElement("span", { key: "tg-" + tg, className: "mono",
        style: { fontSize: 10, color: tagEffectiveHex(tg, tagColors), whiteSpace: "nowrap" } }, tg))),
    React.createElement("span", { className: "mono", style: { fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
      (instance.loader || "Vanilla") + " " + (instance.mc || "")),
    mono(instance.mods),
    mono(fmt.ram(instance.ramMax)),
    mono(instance.cacheState === "ready" ? "ready" : "—", instance.cacheState !== "ready"),
    mono(kpi && kpi.avg > 0 ? "~" + kpi.avg + "s" : "—", !(kpi && kpi.avg > 0)),
    React.createElement(Tip, { label: t("common.play") },
      React.createElement("button", { className: "no-drag", onClick: e => { e.stopPropagation(); onPlay(); },
        style: { width: 26, height: 26, borderRadius: "var(--r-sm)", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--acc-text)", display: "grid", placeItems: "center" } },
        React.createElement(Icon, { name: "play", size: 13 }))),
    React.createElement(Menu, {
      align: "right", items: menu,
      trigger: React.createElement("button", { className: "no-drag", style: { width: 26, height: 26, borderRadius: "var(--r-sm)", border: "none", background: "transparent", color: "var(--text-faint)", display: "grid", placeItems: "center" } },
        React.createElement(Icon, { name: "dots", size: 15 })),
    }),
  );
}

/* Tags & note editor for a whole instance (pack) */
function InstanceTagsDialog({ instance, tagColors, onColor, onClose, onSave, allTags }) {
  const [tags, setTags] = lS(instance.tags || []);
  const [note, setNote] = lS(instance.note || "");
  const [val, setVal]   = lS("");
  function mergeTags(base, raw) {
    const next = base.slice();
    String(raw).split(/[,\n]+/).map(s => s.trim()).filter(Boolean).forEach(p => {
      if (!next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p);
    });
    return next.slice(0, 12);
  }
  function add(raw) { if (String(raw).trim()) { setTags(mergeTags(tags, raw)); setVal(""); } }
  const remove = tg => setTags(tags.filter(x => x !== tg));
  // Reuse tags already created on other packs — pick from the pool, no retyping.
  const suggestions = (allTags || []).map(a => a.tag)
    .filter(tg => !tags.some(x => x.toLowerCase() === tg.toLowerCase())).slice(0, 14);
  const swatch = tg => React.createElement("label", { className: "no-drag", title: "Pick tag colour",
      style: { width: 14, height: 14, borderRadius: 4, background: tagEffectiveHex(tg, tagColors), border: "1px solid rgba(255,255,255,.3)", cursor: "pointer", flexShrink: 0, position: "relative", overflow: "hidden", display: "inline-block" } },
    React.createElement("input", { type: "color", value: tagEffectiveHex(tg, tagColors), onChange: e => onColor && onColor(tg, e.target.value),
      style: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", padding: 0, width: "100%", height: "100%" } }));
  return React.createElement("div", {
    onMouseDown: e => { if (e.target === e.currentTarget) onClose(); },
    style: { position: "fixed", inset: 0, zIndex: 700, display: "grid", placeItems: "center", background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)" },
  },
    React.createElement("div", { className: "glass-pop anim-fadein", style: { width: 470, borderRadius: "var(--r-xl)", padding: 26 }, onClick: e => e.stopPropagation() },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 11, marginBottom: 16 } },
        React.createElement("div", { style: { width: 42, height: 42, borderRadius: 12, background: "var(--acc-soft)", display: "grid", placeItems: "center", color: "var(--acc-text)", flexShrink: 0 } }, React.createElement(Icon, { name: "tag", size: 21 })),
        React.createElement("div", { style: { minWidth: 0 } },
          React.createElement("h3", { style: { margin: 0, fontSize: 17, fontWeight: 720 } }, "Tags & note"),
          React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, instance.name))),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 } },
        tags.length === 0 && React.createElement("span", { style: { fontSize: 12, color: "var(--text-faint)" } }, "No tags yet — label this pack to group & filter it."),
        tags.map(tg => React.createElement("span", { key: tg, style: { ...modTagChip(tg, true, tagColors && tagColors[tg]), display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px" } },
          swatch(tg),
          tg,
          React.createElement("button", { onClick: () => remove(tg), className: "no-drag", style: { display: "grid", placeItems: "center", border: "none", background: "transparent", color: "inherit", padding: 0, opacity: 0.85, cursor: "pointer" } },
            React.createElement(Icon, { name: "x", size: 12 }))))),
      React.createElement(TextInput, { value: val, onChange: setVal, placeholder: "Add tag, press Enter (e.g. favorite, smp, testing)", icon: "tag", size: "sm",
        onKeyDown: e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(val); } },
        onBlur: () => add(val) }),
      suggestions.length > 0 && React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 } },
        React.createElement("span", { style: { fontSize: 11, color: "var(--text-faint)" } }, "Quick add:"),
        suggestions.map(tg => React.createElement("button", { key: tg, className: "no-drag", onClick: () => add(tg),
          style: { ...modTagChip(tg, false, tagColors && tagColors[tg]), padding: "2px 8px", cursor: "pointer" } }, "+ " + tg))),
      React.createElement("textarea", {
        value: note, onChange: e => setNote(e.target.value),
        placeholder: "Note — what this pack is for, server address, reminders…", rows: 3,
        style: { width: "100%", resize: "vertical", marginTop: 12, background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "9px 11px", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" },
      }),
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 } },
        React.createElement(Btn, { variant: "ghost", onClick: onClose }, "Cancel"),
        React.createElement(Btn, { variant: "primary", icon: "check", onClick: () => { onSave(val.trim() ? mergeTags(tags, val) : tags, note); onClose(); } }, "Save")),
    ),
  );
}

function LibraryScreen() {
  const { api, hasBridge, t, fmt, navigate } = useApp();
  const [state, setState] = lS("loading");
  const [instances, setInstances] = lS([]);
  const [kpis, setKpis] = lS({});
  const [q, setQ] = lS("");
  const [sort, setSort] = lS("recent");
  // List is the default — a library is a table of machines, not a poster wall.
  const [view, setViewRaw] = lS(() => { try { return localStorage.getItem("kelvin.libview") || "list"; } catch { return "list"; } });
  const setView = v => { setViewRaw(v); try { localStorage.setItem("kelvin.libview", v); } catch { } };
  const [deleteTarget, setDeleteTarget] = lS(null);  // instance to confirm delete
  const [showCreate, setShowCreate] = lS(false);
  const [roots, setRoots] = lS([]);   // instance locations (for the "Move →" menu)
  const [tagColors, setTagColors] = lS({});       // instance tag name → hex (library-wide)
  const [tagSel, setTagSel] = lS([]);             // active tag filters (AND)
  const [tagsTarget, setTagsTarget] = lS(null);   // instance whose tag/note dialog is open

  async function load() {
    setState("loading");
    try {
      const list = await api.getInstances();
      if (!list.length) { setState("empty"); return; }
      const kp = {};
    // Use allSettled so one bad getKpis call does not kill the whole library
    const settled = await Promise.allSettled(list.map(i => api.getKpis(i.id).then(v => ({ id: i.id, v }))));
    settled.forEach(r => { if (r.status === "fulfilled") kp[r.value.id] = r.value.v; });
      setInstances(list); setKpis(kp); setState("ready");
    } catch (e) {
      console.error("[Library] load failed:", e);
      window.toast && window.toast({ tone: "error", icon: "alert", title: "Failed to load instances", body: String(e && e.message || e) });
      setState("error");
    }
  }
  lE(() => { load(); }, []);

  // Live state updates from bridge
  lE(() => {
    if (!hasBridge) return;
    if (api.getInstanceRoots) api.getInstanceRoots().then(r => setRoots((r && r.roots) || [])).catch(() => {});
    if (api.getInstanceTagColors) api.getInstanceTagColors().then(c => setTagColors(c || {})).catch(() => {});
    function onStateChanged(e) {
      const ev = e.detail;
      setInstances(prev => prev.map(i =>
        i.id === ev.id ? { ...i, state: ev.state, residentMB: ev.residentMB, loadSeconds: ev.loadSeconds } : i
      ));
    }
    // Reload the list when a modpack is imported / instance duplicated.
    function onImport(e) {
      const d = e.detail || {};
      if (d.ok) load();
    }
    function onDuplicate(e) {
      const d = e.detail || {};
      if (d.ok) { load(); window.toast({ tone: "success", icon: "check", title: "Duplicated", body: d.name || "" }); }
      else if (d.error) window.toast({ tone: "danger", icon: "alert", title: "Duplicate failed", body: d.error });
    }
    function onMove(e) {
      const d = e.detail || {};
      if (d.ok) { load(); window.toast({ tone: "success", icon: "check", title: "Instance moved" }); }
      else if (d.error) window.toast({ tone: "danger", icon: "alert", title: "Move failed", body: d.error });
    }
    window.addEventListener("cryo:instanceStateChanged", onStateChanged);
    window.addEventListener("cryo:importDone", onImport);
    window.addEventListener("cryo:duplicateDone", onDuplicate);
    window.addEventListener("cryo:moveDone", onMove);
    return () => {
      window.removeEventListener("cryo:instanceStateChanged", onStateChanged);
      window.removeEventListener("cryo:importDone", onImport);
      window.removeEventListener("cryo:duplicateDone", onDuplicate);
      window.removeEventListener("cryo:moveDone", onMove);
    };
  }, [hasBridge]);

  const filtered = lM(() => {
    let r = instances.filter(i => {
      const ql = q.toLowerCase();
      if (ql && !i.name.toLowerCase().includes(ql) && !(i.tags || []).some(tg => tg.toLowerCase().includes(ql))) return false;
      if (tagSel.length && !tagSel.every(tg => (i.tags || []).includes(tg))) return false;
      return true;
    });
    const k = kpis;
    r.sort((a, b) => {
      if (sort === "name")  return a.name.localeCompare(b.name);
      if (sort === "mods")  return b.mods - a.mods;
      if (sort === "start") return (k[a.id]?.avg || 0) - (k[b.id]?.avg || 0);
      return (b.lastPlayed || 0) - (a.lastPlayed || 0);
    });
    return r;
  }, [instances, q, sort, kpis, tagSel]);

  // Library-wide tag union (most-used first) + edit/colour handlers.
  const allTags = lM(() => {
    const counts = {};
    instances.forEach(i => (i.tags || []).forEach(tg => { counts[tg] = (counts[tg] || 0) + 1; }));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).map(k => ({ tag: k, count: counts[k] }));
  }, [instances]);
  const toggleTag = tg => setTagSel(s => s.includes(tg) ? s.filter(x => x !== tg) : [...s, tg]);
  async function saveInstanceMeta(inst, tags, note) {
    setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, tags, note } : i));
    if (hasBridge) {
      if (api.setInstanceTags) await api.setInstanceTags(inst.id, tags).catch(() => {});
      if (api.setInstanceNote) await api.setInstanceNote(inst.id, note).catch(() => {});
    }
  }
  async function saveInstanceTagColor(tag, color) {
    setTagColors(c => ({ ...c, [tag]: color }));
    if (hasBridge && api.setInstanceTagColor) await api.setInstanceTagColor(tag, color).catch(() => {});
  }

  async function doDelete(inst) {
    setDeleteTarget(null);
    if (hasBridge && api.removeFromLauncher) {
      await api.removeFromLauncher(inst.id).catch(() => {});
    }
    setInstances(prev => prev.filter(i => i.id !== inst.id));
    window.toast({ tone: "neutral", icon: "trash", title: "Removed", body: inst.name });
    if (!instances.filter(i => i.id !== inst.id).length) setState("empty");
  }

  const menuFor = lCb(inst => {
    const items = [
      { icon: "play",       label: t("common.play"),       onClick: () => navigate("instance", { id: inst.id, autoLaunch: true }) },
      { icon: "tag",        label: "Tags & note",          onClick: () => setTagsTarget(inst) },
      { icon: "edit",       label: t("common.edit"),       onClick: () => navigate("instance", { id: inst.id, tab: "settings" }) },
      { icon: "folderOpen", label: t("common.openFolder"), onClick: () => hasBridge && api.openFolder && api.openFolder(inst.id) },
      { icon: "copy",       label: t("common.duplicate"),  onClick: () => { if (api.duplicateInstance) { window.toast({ tone: "neutral", icon: "copy", title: "Duplicating…", body: inst.name }); api.duplicateInstance(inst.id).catch(() => {}); } } },
    ];
    if (roots.length > 1)
      roots.forEach(r => items.push({
        icon: "folder", label: "Move → " + ((r.path || "").split(/[\\/]/).filter(Boolean).pop() || r.path),
        onClick: () => { window.toast({ tone: "neutral", icon: "folder", title: "Moving…", body: inst.name }); api.moveInstance && api.moveInstance(inst.id, r.path).catch(() => {}); },
      }));
    items.push({ divider: true });
    items.push({ icon: "trash", label: t("common.delete"), danger: true, onClick: () => setDeleteTarget(inst) });
    return items;
  }, [hasBridge, t, roots]);

  return React.createElement("div", { style: { padding: "26px 30px", maxWidth: 1320, margin: "0 auto" } },
    // Delete confirmation overlay
    deleteTarget && React.createElement(DeleteConfirm, {
      instance: deleteTarget,
      onConfirm: () => doDelete(deleteTarget),
      onCancel: () => setDeleteTarget(null),
    }),

    // Create-instance dialog
    showCreate && React.createElement(CreateInstanceDialog, {
      api, hasBridge, onClose: () => setShowCreate(false),
      onCreated: (id) => { load(); if (id) navigate("instance", { id }); },
    }),

    // Instance tags & note editor
    tagsTarget && React.createElement(InstanceTagsDialog, {
      instance: tagsTarget, tagColors, allTags,
      onColor: saveInstanceTagColor,
      onClose: () => setTagsTarget(null),
      onSave: (tags, note) => saveInstanceMeta(tagsTarget, tags, note),
    }),

    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" } },
      React.createElement("div", null,
        React.createElement("div", { className: "stencil", style: { color: "var(--acc-text)" } }, "// library"),
        React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 } },
          React.createElement("span", { style: { fontSize: 17, fontWeight: 650 } }, t("lib.title")),
          React.createElement("span", { className: "mono tnum", style: { fontSize: 12, color: "var(--text-faint)" } },
            state === "ready" ? instances.length + " instances" : ""))),
      React.createElement("div", { style: { flex: 1 } }),
      React.createElement(TextInput, { value: q, onChange: setQ, placeholder: t("common.search"), icon: "search", size: "sm", style: { width: 200 } }),
      React.createElement(Select, { value: sort, onChange: setSort, size: "sm", width: 168, icon: "sort",
        options: [
          { value: "recent", label: t("lib.sort.recent") }, { value: "name", label: t("lib.sort.name") },
          { value: "mods",   label: t("lib.sort.mods") },   { value: "start", label: t("lib.sort.start") },
        ] }),
      React.createElement(Segmented, { size: "sm", value: view, onChange: setView,
        options: [{ value: "grid", icon: "grid", label: "" }, { value: "list", icon: "list", label: "" }] }),
      React.createElement(Tip, { label: "Create a new instance (no Prism needed)" },
        React.createElement(Btn, { variant: "primary", icon: "plus", onClick: () => setShowCreate(true) }, t("lib.new"))),
      hasBridge && React.createElement(Tip, { label: "Import a modpack ZIP / .mrpack" },
        React.createElement(Btn, { variant: "subtle", icon: "upload",
          onClick: () => { if (api.importModpack) api.importModpack(); } },
          "Import")),
      hasBridge && React.createElement(Tip, { label: "Refresh instance list" },
        React.createElement(Btn, { variant: "ghost", size: "icon", onClick: load },
          React.createElement(Icon, { name: "refresh", size: 16 }))),
    ),

    state === "ready" && allTags.length > 0 && React.createElement("div", { style: { display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 18 } },
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

    state === "loading" && React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--gap-grid)" } },
      Array.from({ length: 3 }).map((_, i) => React.createElement(Card, { key: i, style: { borderRadius: "var(--r-xl)" } },
        React.createElement(Skeleton, { h: 96, r: "var(--r-lg)" }),
        React.createElement(Skeleton, { h: 18, w: "60%", style: { marginTop: 14 } }),
        React.createElement(Skeleton, { h: 13, w: "40%", style: { marginTop: 8 } }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 14 } },
          React.createElement(Skeleton, { h: 22, w: 70, r: 99 }),
          React.createElement(Skeleton, { h: 22, w: 60, r: 99 })),
      ))),

    state === "error" && React.createElement(ErrorState, {
      title: t("common.error"), body: t("common.errorBody"), onRetry: load, retryLabel: t("common.retry") }),

    state === "empty" && React.createElement(Card, { style: { borderRadius: "var(--r-2xl)" } },
      React.createElement(EmptyState, {
        icon: "snowflake", title: t("lib.empty.title"), body: t("lib.empty.body"),
        action: React.createElement("div", { style: { display: "flex", gap: 10 } },
          React.createElement(Btn, { variant: "primary", icon: "plus", onClick: () => setShowCreate(true) }, t("lib.empty.cta")),
          React.createElement(Btn, { variant: "subtle", icon: "download", onClick: () => navigate("browse") }, "Browse modpacks"),
        ),
      })),

    state === "ready" && (view === "grid"
      ? React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "var(--gap-grid)" } },
          filtered.map(inst => React.createElement(InstanceCard, {
            key: inst.id, instance: inst, kpi: kpis[inst.id], t, fmt, menu: menuFor(inst), tagColors,
            onOpen:  () => navigate("instance", { id: inst.id }),
            onPlay:  () => navigate("instance", { id: inst.id, autoLaunch: true }),
          })))
      : React.createElement("div", { className: "glass", style: { borderRadius: "var(--r-lg)", overflow: "hidden" } },
          React.createElement(ListHeader, null),
          filtered.map(inst => React.createElement(InstanceRow, {
            key: inst.id, instance: inst, kpi: kpis[inst.id], t, fmt, menu: menuFor(inst), tagColors,
            onOpen:  () => navigate("instance", { id: inst.id }),
            onPlay:  () => navigate("instance", { id: inst.id, autoLaunch: true }),
          })))
    ),
  );
}

window.CryoLibrary = { LibraryScreen };
Object.assign(window, { cacheBadge, Banner });
