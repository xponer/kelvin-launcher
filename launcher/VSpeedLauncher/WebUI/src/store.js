/* ============================================================
   Cryo вЂ” app store: settings, theme application, navigation,
   formatters. Persists to localStorage.
   ============================================================ */
const { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } = React;

const LS_KEY = "cryo.settings.v1";
const DEFAULT_SETTINGS = {
  mode: "dark",            // dark | light | system
  preset: "glacier",       // glacier | aurora | midnight | frost | custom
  customAccent: "#38BDF8",
  density: "comfortable",  // compact | comfortable
  radius: "rounded",       // sharp | rounded | pill
  anim: true,
  bg: "gradient",          // solid | gradient | particles
  lang: "en",              // en | ru
  vspeedGlobal: true,
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

/* ---------------- formatters ---------------- */
function fmtNum(n) {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
}
function fmtSecs(s) {
  if (s == null) return "—";
  return s.toFixed(s < 10 ? 1 : 0);
}
function fmtRam(mb) {
  return mb >= 1024 ? (mb / 1024) + " GB" : mb + " MB";
}
function fmtPlaytime(min) {
  const h = Math.floor(min / 60);
  return h >= 1 ? h + "h " + (min % 60) + "m" : min + "m";
}
function fmtAgo(epoch, lang) {
  const diff = Date.now() - epoch;
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const ru = lang === "ru";
  if (m < 1) return ru ? "С‚РѕР»СЊРєРѕ С‡С‚Рѕ" : "just now";
  if (m < 60) return ru ? `${m} РјРёРЅ РЅР°Р·Р°Рґ` : `${m}m ago`;
  if (h < 24) return ru ? `${h} С‡ РЅР°Р·Р°Рґ` : `${h}h ago`;
  if (d < 30) return ru ? `${d} РґРЅ РЅР°Р·Р°Рґ` : `${d}d ago`;
  return new Date(epoch).toLocaleDateString(ru ? "ru-RU" : "en-US", { month: "short", day: "numeric" });
}
function fmtDate(epoch, lang) {
  if (!epoch) return "—";
  return new Date(epoch).toLocaleString(lang === "ru" ? "ru-RU" : "en-US",
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtClock(epoch) {
  const d = new Date(epoch);
  return d.toLocaleTimeString("en-GB", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

const fmt = { num: fmtNum, bytes: fmtBytes, secs: fmtSecs, ram: fmtRam, playtime: fmtPlaytime, ago: fmtAgo, date: fmtDate, clock: fmtClock };

/* ---------------- context ---------------- */
const AppContext = createContext(null);

function AppProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);
  const [route, setRoute] = useState({ name: "library", params: {} });
  const [systemDark, setSystemDark] = useState(
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = e => setSystemDark(e.matches);
    mq.addEventListener && mq.addEventListener("change", fn);
    return () => mq.removeEventListener && mq.removeEventListener("change", fn);
  }, []);

  // persist
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(settings)); }, [settings]);

  // apply theme attributes to <html>
  const effectiveMode = settings.mode === "system" ? (systemDark ? "dark" : "light") : settings.mode;
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-mode", effectiveMode);
    r.setAttribute("data-density", settings.density);
    r.setAttribute("data-radius", settings.radius);
    r.setAttribute("data-anim", settings.anim ? "on" : "off");
    if (settings.preset === "custom") {
      r.removeAttribute("data-preset");
      const a = settings.customAccent;
      r.style.setProperty("--acc-1", lighten(a, 18));
      r.style.setProperty("--acc-2", a);
      r.style.setProperty("--acc-3", darken(a, 12));
      r.style.setProperty("--acc", a);
    } else {
      r.setAttribute("data-preset", settings.preset);
      r.style.removeProperty("--acc-1"); r.style.removeProperty("--acc-2");
      r.style.removeProperty("--acc-3"); r.style.removeProperty("--acc");
    }
  }, [effectiveMode, settings.density, settings.radius, settings.anim, settings.preset, settings.customAccent]);

  const update = useCallback((patch) => setSettings(s => ({ ...s, ...patch })), []);
  const navigate = useCallback((name, params = {}) => setRoute({ name, params }), []);
  const t = useMemo(() => window.CryoI18n.makeT(settings.lang), [settings.lang]);

  const api = useMemo(() =>
    typeof window.chrome !== "undefined" && window.chrome && window.chrome.webview
      ? createBridgeApi()
      : window.mockApi,
  []);

  const hasBridge = Boolean(
    typeof window.chrome !== "undefined" && window.chrome && window.chrome.webview
  );

  const value = useMemo(() => ({
    settings, update, route, navigate, t, fmt, effectiveMode,
    api, hasBridge,
  }), [settings, update, route, navigate, t, effectiveMode, api, hasBridge]);

  return React.createElement(AppContext.Provider, { value }, children);
}

function useApp() { return useContext(AppContext); }
function useT() { return useContext(AppContext).t; }

/* tiny hex helpers for custom accent */
function clamp(v) { return Math.max(0, Math.min(255, v)); }
function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) { return "#" + [r, g, b].map(x => clamp(x).toString(16).padStart(2, "0")).join(""); }
function lighten(hex, amt) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r + amt * 2.2, g + amt * 2.2, b + amt * 1.6); }
function darken(hex, amt) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r - amt * 1.2, g - amt * 1.4, b - amt * 0.6); }
function isValidHex(h) { return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h.trim()); }

/* simulate a launch: drives the live progress UI.
   Returns a controller with subscribe(cb) в†’ {t, phaseStates, done}.
   demoFactor compresses wall-clock so the demo isn't 84 real seconds. */
function createLaunchSim(instance, demoFactor = 8) {
  const wall = instance.wallClock;
  let raf, startTs = null, listeners = [], stopped = false;
  function frame(ts) {
    if (stopped) return;
    if (startTs == null) startTs = ts;
    const elapsedReal = (ts - startTs) / 1000;
    const modelT = Math.min(wall, elapsedReal * demoFactor);
    const done = modelT >= wall;
    listeners.forEach(cb => cb({ t: modelT, done }));
    if (!done) raf = requestAnimationFrame(frame);
  }
  return {
    start() { raf = requestAnimationFrame(frame); },
    stop() { stopped = true; cancelAnimationFrame(raf); },
    subscribe(cb) { listeners.push(cb); },
  };
}

/* ============================================================
   Real bridge API вЂ” used when running inside WebView2.
   JS в†’ C#: window.chrome.webview.postMessage(JSON.stringify({id, method, args}))
   C# в†’ JS: window.chrome.webview.addEventListener('message', ...)
   ============================================================ */
// In-page startup splash (markup in Cryo Launcher.html). Fades + removes itself once
// the UI is ready. Same DOM surface as the app, so there's no black gap on reveal.
window.__cryoHideSplash = window.__cryoHideSplash || function () {
  var s = document.getElementById("cryo-splash");
  if (!s || s.__hiding) return;
  s.__hiding = true;
  s.classList.add("cryo-hide");
  setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 520);
};
// Browser/mock (no bridge): hide after the first painted frame. In the WebView the
// bridge hides it when the initial data has loaded (see _sendReady). Safety fallback both ways.
if (!(window.chrome && window.chrome.webview))
  requestAnimationFrame(function () { requestAnimationFrame(function () { window.__cryoHideSplash(); }); });
setTimeout(function () { window.__cryoHideSplash(); }, 6000);

function createBridgeApi() {
  const pending = new Map();
  let n = 0;

  // Startup-splash handshake: ask the host to fade its splash only once the bridge has
  // gone quiet (the initial data has loaded) AND a frame has painted — so the user never
  // sees the empty dark shell. Hard fallback at 5s so the splash can never hang.
  let _readySent = false, _readyTimer = null;
  function _sendReady() {
    if (_readySent) return;
    _readySent = true;
    clearTimeout(_readyTimer);
    try { window.__cryoHideSplash && window.__cryoHideSplash(); } catch (e) {}
  }
  function _maybeReady() {
    if (_readySent) return;
    clearTimeout(_readyTimer);
    _readyTimer = setTimeout(() => {
      if (pending.size === 0) requestAnimationFrame(() => requestAnimationFrame(_sendReady));
      else _maybeReady();
    }, 350);
  }
  setTimeout(_sendReady, 5000);

  window.chrome.webview.addEventListener("message", e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (p._timer) clearTimeout(p._timer);
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
        _maybeReady();
      } else if (msg.type) {
        // Push event from C# в†’ dispatch as custom DOM event
        window.dispatchEvent(new CustomEvent("cryo:" + msg.type, { detail: msg.data ?? msg }));
      }
    } catch (err) { console.warn("[Bridge] parse error:", err); }
  });

  function call(method, args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = "r" + (++n);
      pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (pending.delete(id)) { reject(new Error("Bridge timeout: " + method)); _maybeReady(); }
      }, timeoutMs);
      pending.get(id)._timer = timer;
      window.chrome.webview.postMessage({ id, method, args: args ?? {} }); // object, not string
    });
  }

  return {
    async getInstances()             { return call("getInstances"); },
    async getInstance(id)            { return call("getInstance", { id }); },
    async setInstanceTags(id, tags)       { return call("setInstanceTags", { id, tags: tags || [] }); },
    async setInstanceNote(id, note)       { return call("setInstanceNote", { id, note: note || "" }); },
    async getInstanceTagColors()          { return call("getInstanceTagColors", {}); },
    async setInstanceTagColor(tag, color) { return call("setInstanceTagColor", { tag, color: color || "" }); },
    async getKpis(id)                { return call("getKpis", { id }); },
    async getCache(id)               { return call("getCache", { id }); },
    async getMods(id)                { return call("getMods", { id }); },
    async getHealth(id)              { return call("getHealth", { id }); },
    async getScreenshots(id)         { return call("getScreenshots", { id }); },
    async deleteScreenshot(id, file) { return call("deleteScreenshot", { id, file }); },
    async openScreenshot(id, file)   { return call("openScreenshot", { id, file }); },
    async getHistory()               { return call("getHistory"); },
    async getLogs(id, n = 3000)      { return call("getLogs", { id, n }); },
    async getBootTimeline(id)        { return call("getBootTimeline", { id }, 20000); },
    async rebuildCache(id)             { return call("rebuildCache", { id }); },
    async launchInstance(id, vanilla)  { return call("launchInstance", { id, vanilla: !!vanilla }); },
    async joinServer(id, ip)           { return call("launchInstance", { id, joinServer: ip }); },
    async startBenchmark(id)           { return call("startBenchmark", { id }); },
    async cancelBenchmark()            { return call("cancelBenchmark"); },
    async openConsole(id)              { return call("openConsole", { id }); },
    // ── VSpeed Turbo (JDK 25 AOT cache) ───────────────────────────────────────
    async getTurbo(id)                 { return call("getTurbo", { id }); },
    async setTurbo(id, on)             { return call("setTurbo", { id, on: !!on }); },
    async resetTurbo(id)               { return call("resetTurbo", { id }); },
    // AI assistant — { messages:[{role,content}], instanceId?, attach?:["logs","mods","crash","launcher"] }
    // Long timeout (just over the C# 120 s HTTP timeout) so a real API error surfaces, not a bridge timeout.
    async aiChat(payload)              { return call("aiChat", payload || {}, 130000); },
    // Streaming: returns an ack immediately; chunks arrive as cryo:aiChunk / aiDone / aiError events.
    async aiChatStream(payload)        { return call("aiChatStream", payload || {}, 30000); },
    async selfCheck()                  { return call("selfCheck", {}, 30000); },
    // ── Auto-update (Velopack / GitHub) ───────────────────────────────────────
    async getAppVersion()              { return call("getAppVersion", {}, 8000); },
    async checkForUpdate()             { return call("checkForUpdate", {}, 30000); },
    async applyUpdate()                { return call("applyUpdate", {}); },
    async openLauncherLog()            { return call("openLauncherLog"); },
    async scanMods(id)                 { return call("scanMods", { id }, 60000); },
    async analyzeModGraph(id)          { return call("analyzeModGraph", { id }, 60000); },
    // Standalone engine (CmlLib.Core) self-test — progress arrives as cryo:coreProgress / coreDone / coreError.
    async coreTest(version, ram)       { return call("coreTest", { version: version || "", ram: ram || 0 }); },
    // Microsoft account (login opens the MS sign-in page; result arrives as cryo:accountChanged / accountError)
    async accountStatus()              { return call("accountStatus", {}, 20000); },
    async accountLogin()               { return call("accountLogin"); },
    async accountLogout()              { return call("accountLogout"); },
    async getStats(id)                 { return call("getStats", { id }); },
    async stopInstance(id)             { return call("stopInstance", { id }); },
    async getConfig()                { return call("getConfig"); },
    async saveConfig(data)           { return call("saveConfig", data); },
    // ── Instance config ───────────────────────────────────────────────────────
    async getInstanceCfg(id)            { return call("getInstanceCfg",    { id }); },
    async saveInstanceCfg(id, data)     { return call("saveInstanceCfg",   { id, ...data }); },
    async detectJavas(id)               { return call("detectJavas",       { id }, 15000); },
    async getSystemRam()                { return call("getSystemRam",      {}); },
    // ── Instance locations (folders) ──────────────────────────────────────────
    async getInstanceRoots()            { return call("getInstanceRoots",   {}); },
    async addInstanceRoot(path)         { return call("addInstanceRoot",    { path }); },
    async removeInstanceRoot(path)      { return call("removeInstanceRoot", { path }); },
    async pickFolder()                  { return call("pickFolder",         {}, 600000); },
    async setPrimaryRoot(path)          { return call("setPrimaryRoot",     { path }); },
    async openPath(path)                { return call("openPath",           { path }); },
    async moveInstance(id, targetRoot)  { return call("moveInstance",       { id, targetRoot }); },
    // ── Shell / file actions ──────────────────────────────────────────────────
    async setModEnabled(id, file, en)   { return call("setModEnabled",      { id, file, enabled: !!en }); },
    async setModTags(id, file, tags)    { return call("setModTags",         { id, file, tags: tags || [] }); },
    async setModNote(id, file, note)    { return call("setModNote",         { id, file, note: note || "" }); },
    async getTagColors(id)              { return call("getTagColors",       { id }); },
    async setTagColor(id, tag, color)   { return call("setTagColor",        { id, tag, color: color || "" }); },
    async openUrl(url)                  { return call("openUrl",            { url }); },
    async openPrism()                   { return call("openPrism"); },
    async setProfileNextLaunch(id, on)  { return call("setProfileNextLaunch", { id, on: !!on }); },
    async openFolder(id)                { return call("openFolder",         { id }); },
    async openCrashReport(id)           { return call("openCrashReport",    { id }); },
    async exportLogs(id, content)       { return call("exportLogs",         { id, content }); },
    async removeFromLauncher(id)        { return call("removeFromLauncher", { id }); },
    // ── Cryo Engine (NeoForge install + launch without Prism) ────────────────
    async getEngineStatus(id)               { return call("getEngineStatus",      { id }, 10000); },
    async getNeoForgeVersions(mcVersion)    { return call("getNeoForgeVersions",  { mcVersion }, 30000); },
    async installNeoForge(id, neoForgeVersion) {
      return call("installNeoForge", { id, neoForgeVersion: neoForgeVersion || "" });
    },
    async launchWithEngine(id)              { return call("launchWithEngine",     { id }); },
    async setEngineSource(id, source)       { return call("setEngineSource",      { id, source }); },
    // ── Modpack Export / Import ───────────────────────────────────────────────
    async exportModpack(id)               { return call("exportModpack",   { id }); },
    async importModpack()                 { return call("importModpack",   {}); },
    // ── Modrinth mod browser ──────────────────────────────────────────────────
    async searchModrinth(query, id, offset, kind, sort, category) { return call("searchModrinth", { query: query || "", id: id || "", offset: offset || 0, kind: kind || "mod", sort: sort || "relevance", category: category || "" }, 30000); },
    async getModrinthVersions(projectId, id) { return call("getModrinthVersions", { projectId, id: id || "" }, 30000); },
    async searchCurseForge(query, id, offset, kind, sort) { return call("searchCurseForge", { query: query || "", id: id || "", offset: offset || 0, kind: kind || "mod", sort: sort || "relevance" }, 30000); },
    async getCurseForgeFiles(projectId, id) { return call("getCurseForgeFiles", { projectId, id: id || "" }, 30000); },
    // ── Instance creation / modpack install (no Prism) ────────────────────────
    async createInstance(data)         { return call("createInstance", data || {}, 20000); },
    async duplicateInstance(id)        { return call("duplicateInstance", { id }); },
    async installModrinthModpack(projectId, versionId, name, targetRoot) { return call("installModrinthModpack", { projectId, versionId, name: name || "", targetRoot: targetRoot || "" }); },
    async installCurseForgeModpack(projectId, fileId, name, targetRoot)  { return call("installCurseForgeModpack", { projectId, fileId, name: name || "", targetRoot: targetRoot || "" }); },
    async getModpackInfo(id)              { return call("getModpackInfo",  { id }, 30000); },
    async updateModpack(id)               { return call("updateModpack",   { id }); },
    async downloadMod(id, url, filename, sha512, projectTitle) {
      return call("downloadMod", { id, url, filename, sha512: sha512 || "", projectTitle: projectTitle || "" });
    },
    async downloadModrinthMod(id, projectId, versionId, projectTitle) {
      return call("downloadModrinthMod", { id, projectId, versionId, projectTitle: projectTitle || "" });
    },
    async installPerformancePack(id)      { return call("installPerformancePack", { id }); },
    async getInstalledModIds(id)          { return call("getInstalledModIds", { id }, 60000); },
    async addLocalMods(id)                { return call("addLocalMods", { id }, 120000); },
    async addLocalModData(id, filename, base64) { return call("addLocalModData", { id, filename, base64 }, 120000); },
    async checkModUpdates(id)             { return call("checkModUpdates", { id }, 90000); },
    async updateMod(id, oldFile, url, newFilename, sha512) {
      return call("updateMod", { id, oldFile, url, newFilename, sha512: sha512 || "" });
    },
    // ── Profiles (launch presets) ─────────────────────────────────────────────
    async getProfiles()                   { return call("getProfiles",     {}); },
    async saveProfile(p)                  { return call("saveProfile",     p || {}); },
    async deleteProfile(profileId)        { return call("deleteProfile",   { profileId }); },
    async applyProfile(id, profileId)     { return call("applyProfile",    { id, profileId }); },
    // ── Server list ───────────────────────────────────────────────────────────
    async getServers(id)                  { return call("getServers",      { id }); },
    async pingServer(ip)                  { return call("pingServer",      { ip }, 8000); },
    async addServer(id, name, ip)         { return call("addServer",       { id, name, ip }); },
    async removeServer(id, ip)            { return call("removeServer",    { id, ip }); },
    // ── Server hosting (run a dedicated server for a pack) ──────────────────────
    async getHostedServer(id)             { return call("getHostedServer",   { id }); },
    async createServer(id)                { return call("createServer",      { id }); },
    async startServer(id)                 { return call("startServer",       { id }); },
    async stopServer(id)                  { return call("stopServer",        { id }); },
    async sendServerCommand(id, cmd)      { return call("sendServerCommand", { id, cmd }); },
    async getServerConsole(id, n)         { return call("getServerConsole",  { id, n: n || 800 }); },
    async saveServerSettings(id, ramMb, port) { return call("saveServerSettings", { id, ramMb: ramMb || 0, port: port || 0 }); },
    async getServerProperties(id)         { return call("getServerProperties", { id }); },
    async saveServerProperties(id, props) { return call("saveServerProperties", { id, props: props || {} }); },
    async acceptServerEula(id)            { return call("acceptServerEula",  { id }); },
    async deleteServer(id)                { return call("deleteServer",      { id }); },
    async openServerFolder(id)            { return call("openServerFolder",  { id }); },
    // ── World Backups ─────────────────────────────────────────────────────────
    async getWorlds(id)                   { return call("getWorlds",       { id }); },
    async backupWorld(id, worldName)      { return call("backupWorld",     { id, worldName }); },
    async getBackups(id)                  { return call("getBackups",      { id }); },
    async restoreBackup(id, file)         { return call("restoreBackup",   { id, file }); },
    async deleteBackup(id, file)          { return call("deleteBackup",    { id, file }); },
    async openWorldsFolder(id)            { return call("openWorldsFolder",{ id }); },
    // ── AI Memory ─────────────────────────────────────────────────────────────
    async saveAiMemory(id, problem, solution, actions) {
      return call("saveAiMemory", { id, problem: problem || "", solution: solution || "", actions: actions || null });
    },
    async getAiMemory(id)                   { return call("getAiMemory",          { id: id || "" }); },
    async clearAiMemory(id)                 { return call("clearAiMemory",        { id: id || "" }); },
    // Kept from mockApi for compatibility (not bridge calls)
    presets:     window.CryoData?.JVM_PRESETS   ?? {},
    validateArg: window.CryoData?.validateArg   ?? (() => ({ ok: true, level: "ok", msg: "" })),
    optimMods:   window.CryoData?.optimMods     ?? [],
  };
}

window.CryoStore = { AppProvider, useApp, useT, fmt, isValidHex, createLaunchSim, DEFAULT_SETTINGS, createBridgeApi };
