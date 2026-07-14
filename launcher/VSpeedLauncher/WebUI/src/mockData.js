/* ============================================================
   Kelvin — mock domain data + mockApi layer
   Single source of truth. Swap the function bodies in `mockApi`
   for real backend calls during integration; signatures stay.

   Honest launch model (do not embellish):
   A heavy pack's "time to main menu" is dominated by mod
   CONSTRUCTION + registry events — executed code, NOT cacheable.
   VSpeed caches RAW reload-listener data (recipes, advancements)
   keyed by a SHA-256 of the mod-set, accelerating DATA LOAD /
   WORLD ENTRY — never the exit-to-menu boot.
   ============================================================ */

/**
 * @typedef {Object} Phase
 * @property {string} key
 * @property {number} start   seconds offset from launch
 * @property {number} dur     seconds duration (phases may overlap)
 * @property {boolean} cacheable
 */

/**
 * @typedef {Object} Instance
 * @property {string} id
 * @property {string} name
 * @property {string} loader      e.g. "NeoForge"
 * @property {string} mc          minecraft version
 * @property {string} loaderVer
 * @property {number} mods
 * @property {number} ramMin      MB
 * @property {number} ramMax      MB
 * @property {string} java        java version label
 * @property {number} lastPlayed  epoch ms
 * @property {string} accent      hex banner tint
 * @property {('ready'|'rebuilding'|'off')} cacheState
 * @property {Phase[]} phases
 * @property {number} wallClock   measured s to main menu
 */

const now = Date.now();
const MIN = 60 * 1000, HR = 60 * MIN, DAY = 24 * HR;

/* ---- the canonical heavy pack: all real numbers from the brief ---- */
const ATM10_PHASES = [
  { key: "bootstrap",    start: 0,  dur: 10, cacheable: false }, // JVM + loader + mod scan
  { key: "construction", start: 10, dur: 71, cacheable: false }, // mod construction + registries (dominant; executed code)
  { key: "setup",        start: 71, dur: 13, cacheable: false }, // common + client setup (overlaps construction tail)
];
// wall-clock to menu = 84s (setup overlaps construction by 10s → 81 + 3? no: ends at 84)

function scalePhases(boot, cons, setup, overlap) {
  const cStart = boot;
  const sStart = cStart + cons - overlap;
  return [
    { key: "bootstrap",    start: 0,      dur: boot,  cacheable: false },
    { key: "construction", start: cStart, dur: cons,  cacheable: false },
    { key: "setup",        start: sStart, dur: setup, cacheable: false },
  ];
}
function wallOf(phases) {
  return Math.max(...phases.map(p => p.start + p.dur));
}

/** @type {Instance[]} */
const INSTANCES = [
  {
    id: "atm10",
    name: "All the Mods 10",
    loader: "NeoForge", mc: "1.21.1", loaderVer: "21.1.133",
    mods: 479, ramMin: 4096, ramMax: 12288, java: "Java 21 (Temurin)",
    lastPlayed: now - 3 * HR,
    accent: "#3FA9E0",
    cacheState: "ready",
    phases: ATM10_PHASES,
    wallClock: 84,
  },
  {
    id: "vplus",
    name: "Vanilla+ Performance",
    loader: "Fabric", mc: "1.21.1", loaderVer: "0.16.5",
    mods: 38, ramMin: 2048, ramMax: 4096, java: "Java 21 (Temurin)",
    lastPlayed: now - 1 * DAY - 2 * HR,
    accent: "#5BC8A0",
    cacheState: "ready",
    phases: scalePhases(5, 6, 4, 2),
    get wallClock() { return wallOf(this.phases); },
  },
  {
    id: "arceng",
    name: "Create: Arcane Engineering",
    loader: "Forge", mc: "1.20.1", loaderVer: "47.3.0",
    mods: 214, ramMin: 4096, ramMax: 8192, java: "Java 17 (Temurin)",
    lastPlayed: now - 4 * DAY,
    accent: "#9B7BE0",
    cacheState: "rebuilding",
    phases: scalePhases(8, 31, 9, 6),
    get wallClock() { return wallOf(this.phases); },
  },
];

/* ---- VSpeed cache descriptors ---- */
const CACHE = {
  atm10: {
    enabled: true,
    state: "ready",
    modsetHash: "sha256:9f2c41d7…a8e0",
    recipes: 100645,
    advancements: 48739,
    sizeBytes: 4.8 * 1024 * 1024,        // 4.8 MB gzip
    builtAt: now - 3 * HR - 6 * MIN,
    path: ".vspeed-cache/json/<type>/9f2c41d7.bin",
    // data-load (world entry) before/after, in seconds
    worldEntryCold: 9.4,
    worldEntryWarm: 2.1,
  },
  vplus: {
    enabled: true,
    state: "ready",
    modsetHash: "sha256:1b7e90c4…3d11",
    recipes: 1824,
    advancements: 122,
    sizeBytes: 0.12 * 1024 * 1024,
    builtAt: now - 1 * DAY - 2 * HR,
    path: ".vspeed-cache/json/<type>/1b7e90c4.bin",
    worldEntryCold: 1.9,
    worldEntryWarm: 0.7,
  },
  arceng: {
    enabled: true,
    state: "rebuilding",
    modsetHash: "sha256:c30a5f88…77ab",
    recipes: 0,
    advancements: 0,
    sizeBytes: 0,
    builtAt: null,
    path: ".vspeed-cache/json/<type>/c30a5f88.bin",
    worldEntryCold: 4.6,
    worldEntryWarm: 1.3,
  },
};

/* ---- per-instance launch history (for KPIs + dashboard trend) ---- */
function genHistory(instId, baseWall, n, jitter) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * (DAY * 0.6) - Math.random() * HR;
    // slight downward trend (warm OS cache, tuning) + noise
    const trend = 1 + (i / n) * 0.10;
    const noise = 1 + (Math.random() - 0.5) * jitter;
    const wall = baseWall * trend * noise;
    const boot = wall * 0.12 * (1 + (Math.random() - 0.5) * 0.2);
    const setup = wall * 0.155 * (1 + (Math.random() - 0.5) * 0.2);
    const cons = wall - setup;       // construction effectively spans most of wall clock
    out.push({
      instId, t,
      wall: +wall.toFixed(1),
      boot: +boot.toFixed(1),
      cons: +cons.toFixed(1),
      setup: +setup.toFixed(1),
    });
  }
  return out;
}

const HISTORY = [
  ...genHistory("atm10", 84, 24, 0.06),
  ...genHistory("vplus", 13, 18, 0.10),
  ...genHistory("arceng", 42, 14, 0.09),
];

function kpisFor(instId) {
  const h = HISTORY.filter(x => x.instId === instId).sort((a, b) => a.t - b.t);
  if (!h.length) return null;
  const walls = h.map(x => x.wall);
  const last = h[h.length - 1].wall;
  const avg = walls.reduce((a, b) => a + b, 0) / walls.length;
  return {
    last,
    avg: +avg.toFixed(1),
    best: Math.min(...walls),
    worst: Math.max(...walls),
    launches: h.length,
    // playtime minutes — fabricated but plausible per instance
    playtimeMin: { atm10: 5412, vplus: 1880, arceng: 2640 }[instId] || 0,
  };
}

/* ---- mods per instance (sampled; counts reflect instance.mods) ---- */
const OPTIM_MODS = ["ModernFix", "Sodium", "Lithium", "FerriteCore", "Embeddium", "Canary", "ImmediatelyFast", "Noisium", "ScalableLux"];
function genMods(inst) {
  const known = {
    atm10: [
      ["ModernFix", "5.20.2", true, true, 0.34], ["FerriteCore", "7.0.2", true, true, 0.06],
      ["Embeddium", "1.0.11", true, true, 1.2], ["AE2", "19.0.18", true, false, 8.4],
      ["Mekanism", "10.7.8", true, false, 14.1], ["Create", "6.0.4", true, true, 22.6],
      ["Applied Energistics 2", "19.0.18", true, false, 8.4], ["JEI", "19.21.0", true, false, 1.9],
      ["Iron's Spells", "1.3.1", true, false, 6.2], ["Ars Nouveau", "5.4.0", true, false, 9.0],
      ["Farmer's Delight", "1.2.7", true, false, 3.1], ["Supplementaries", "3.1.18", true, false, 7.7],
    ],
    vplus: [
      ["Sodium", "0.6.0", true, true, 1.1], ["Lithium", "0.14.3", true, true, 0.5],
      ["FerriteCore", "7.0.2", true, true, 0.06], ["ImmediatelyFast", "1.6.3", true, true, 0.4],
      ["Iris Shaders", "1.8.1", true, false, 2.3], ["Mod Menu", "11.0.3", true, false, 0.7],
      ["EntityCulling", "1.7.2", true, true, 0.2], ["Dynamic FPS", "3.7.4", true, true, 0.3],
    ],
    arceng: [
      ["Create", "0.5.1f", true, true, 19.4], ["Create: Arcane Engineering", "1.4.2", true, false, 2.1],
      ["Canary", "0.3.3", true, true, 0.9], ["ModernFix", "5.20.2", true, true, 0.34],
      ["Flywheel", "0.6.10", true, false, 1.6], ["JEI", "15.3.0", true, false, 1.8],
    ],
  }[inst.id] || [];
  const list = known.map(([name, ver, enabled, optim, mb], i) => ({
    id: inst.id + "-m" + i, name, version: ver, enabled,
    optimization: optim, sizeMb: mb,
    update: Math.random() < 0.18,
  }));
  // pad to the real mod count with generic library entries (disabled-mix)
  let i = list.length;
  const libs = ["Cloth Config", "Architectury", "Balm", "Patchouli", "GeckoLib", "Curios", "Terrablender", "YUNG's API", "Cucumber", "Resourceful Lib", "Kotlin for Forge", "Forgified Fabric API"];
  while (i < inst.mods) {
    const base = libs[i % libs.length];
    list.push({
      id: inst.id + "-m" + i, name: base + " " + Math.ceil(i / libs.length),
      version: (1 + (i % 5)) + "." + (i % 9) + ".0",
      enabled: Math.random() > 0.06, optimization: false,
      sizeMb: +(0.1 + Math.random() * 3).toFixed(1), update: Math.random() < 0.08,
    });
    i++;
  }
  return list;
}

/* ---- JVM arg presets (the chip-list feature) ---- */
const JVM_PRESETS = {
  "Balanced (G1GC)": [
    "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M", "-XX:G1ReservePercent=20",
  ],
  "Low-pause (ZGC, Java 21)": [
    "-XX:+UseZGC", "-XX:+ZGenerational", "-XX:+AlwaysPreTouch", "-XX:+DisableExplicitGC",
  ],
  "Aikar's flags": [
    "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:-OmitStackTraceInFastThrow",
    "-XX:G1NewSizePercent=30", "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20", "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15", "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem", "-XX:MaxTenuringThreshold=1",
  ],
};

/** Validate a single JVM arg chip. Returns {ok, level, msg}. */
function validateArg(arg) {
  const a = arg.trim();
  if (!a) return { ok: false, level: "error", msg: "Empty argument" };
  if (/[, ]/.test(a)) return { ok: false, level: "error", msg: "Contains comma/space — split into separate chips" };
  if (/^-Xm[sx]\d/.test(a)) return { ok: true, level: "warn", msg: "Heap is managed by the RAM slider — may be overridden" };
  if (!a.startsWith("-")) return { ok: false, level: "error", msg: "JVM flags must start with '-'" };
  if (/^-XX:[+-]/.test(a) || /^-XX:\w+=/.test(a) || /^-D\S+=/.test(a) || /^-X\w/.test(a)) return { ok: true, level: "ok", msg: "Valid" };
  return { ok: true, level: "warn", msg: "Unrecognized flag — passed through verbatim" };
}

/* ============================================================
   Log generation — realistic boot log for the tail view.
   ============================================================ */
const LOG_THREADS = ["main", "Render thread", "modloading-worker-1", "modloading-worker-3", "Worker-Main-2", "VSpeed-IO", "Netty Client IO #0"];
const LOG_SRC = ["ModLoader", "FML", "Registry", "NeoForge", "Minecraft", "VSpeed-Cache", "Embeddium", "AE2", "Mekanism", "DataPack", "Recipe", "Advancement"];

function lvlFor(i, total) {
  const r = Math.random();
  if (r < 0.012) return "ERROR";
  if (r < 0.07) return "WARN";
  if (r < 0.55) return "DEBUG";
  return "INFO";
}

function genLogs(n) {
  const out = [];
  let t = now - 95 * 1000;
  const msgs = {
    boot: [
      "Starting Kelvin launcher bridge on port 41637",
      "Java HotSpot(TM) 64-Bit Server VM (build 21.0.4+7-LTS)",
      "Loading 479 mods from instance 'All the Mods 10'",
      "JVM heap configured: -Xms4096m -Xmx12288m",
      "Scanning mod candidates… 479 jars",
      "Mixin bootstrap complete (ASM 9.7)",
    ],
    cons: [
      "Construction phase: dispatching FMLConstructModEvent",
      "Registered 1284 blocks for namespace 'ae2'",
      "Building recipe graph for 'mekanism'…",
      "Datagen registries frozen",
      "Capability attach for tile entities complete",
    ],
    vspeed: [
      "[VSpeed-Cache] Computing mod-set hash (SHA-256)…",
      "[VSpeed-Cache] Mod-set hash = 9f2c41d7…a8e0 (unchanged)",
      "[VSpeed-Cache] Cache HIT — loading recipes from .vspeed-cache/json/recipe/9f2c41d7.bin",
      "[VSpeed-Cache] Decompressed 4.8 MB gzip → 100645 recipes in 612 ms",
      "[VSpeed-Cache] Restored 48739 advancements from cache (skipped JAR scan)",
      "[VSpeed-Cache] Data-load served from cache — saved ~7.3 s of JAR I/O",
    ],
    warn: [
      "Mod 'oldlib' references deprecated registry method",
      "Found 2 duplicate recipe ids, last one wins",
      "Texture atlas exceeded 4096px, scaling down",
      "Config 'create-client.toml' missing key 'lod', using default",
    ],
    err: [
      "Failed to load optional integration 'jade:ae2' — class not found",
      "Recipe 'mekanism:metallurgic_infusing/steel' has unknown ingredient tag",
    ],
    setup: [
      "Common setup complete (FMLCommonSetupEvent) in 6.2 s",
      "Client setup: registering key mappings",
      "Baking 18342 models…",
      "Stitching block atlas",
      "Reached main menu — total boot 84.0 s",
    ],
  };
  function push(level, src, thread, msg) {
    t += 30 + Math.random() * 480;
    out.push({ id: out.length, t, level, src, thread, msg });
  }
  msgs.boot.forEach(m => push("INFO", "ModLoader", "main", m));
  for (let k = 0; k < n - 40; k++) {
    const bucket = Math.random();
    let level = lvlFor(k, n), src = LOG_SRC[(Math.random() * LOG_SRC.length) | 0], thread = LOG_THREADS[(Math.random() * LOG_THREADS.length) | 0];
    let msg;
    if (bucket < 0.10) { msg = msgs.vspeed[(Math.random() * msgs.vspeed.length) | 0]; src = "VSpeed-Cache"; thread = "VSpeed-IO"; level = "INFO"; }
    else if (level === "WARN") msg = msgs.warn[(Math.random() * msgs.warn.length) | 0];
    else if (level === "ERROR") msg = msgs.err[(Math.random() * msgs.err.length) | 0];
    else if (bucket < 0.55) msg = msgs.cons[(Math.random() * msgs.cons.length) | 0] + " #" + k;
    else msg = msgs.setup[(Math.random() * msgs.setup.length) | 0];
    push(level, src, thread, msg);
  }
  msgs.vspeed.forEach(m => push("INFO", "VSpeed-Cache", "VSpeed-IO", m));
  msgs.setup.forEach(m => push("INFO", "Minecraft", "Render thread", m));
  // a representative stacktrace for the expand feature
  out.push({
    id: out.length, t: t + 200, level: "ERROR", src: "NeoForge", thread: "main",
    msg: "Caught exception during mod 'somemod' construction",
    stack: [
      "java.lang.NullPointerException: Cannot read field \"registry\" because \"this.cache\" is null",
      "    at com.somemod.core.Registrar.bootstrap(Registrar.java:142)",
      "    at net.neoforged.fml.ModContainer.constructMod(ModContainer.java:88)",
      "    at net.neoforged.fml.ModLoader.lambda$dispatchParallelEvent$8(ModLoader.java:214)",
      "    at java.base/java.util.concurrent.CompletableFuture.run(CompletableFuture.java:1804)",
    ],
  });
  return out;
}

/* ============================================================
   mockApi — the integration seam. Async, latency-simulated.
   ============================================================ */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const _logCache = {};

const mockApi = {
  async getInstances() {
    await delay(420);
    return INSTANCES.map(i => ({ ...i, wallClock: typeof i.wallClock === "number" ? i.wallClock : wallOf(i.phases) }));
  },
  async getInstance(id) {
    await delay(220);
    const i = INSTANCES.find(x => x.id === id);
    if (!i) throw new Error("Instance not found: " + id);
    return { ...i, wallClock: typeof i.wallClock === "number" ? i.wallClock : wallOf(i.phases) };
  },
  async getKpis(id) { await delay(180); return kpisFor(id); },
  async getCache(id) { await delay(160); return { ...CACHE[id] }; },
  async getMods(id) {
    await delay(300);
    const inst = INSTANCES.find(x => x.id === id);
    return genMods(inst);
  },
  async getHistory() { await delay(260); return HISTORY.slice().sort((a, b) => a.t - b.t); },
  async getLogs(id, n = 4200) {
    await delay(380);
    if (!_logCache[id]) _logCache[id] = genLogs(n);
    return _logCache[id];
  },
  async rebuildCache(id) {
    await delay(1400);
    CACHE[id].state = "ready";
    CACHE[id].builtAt = Date.now();
    return { ...CACHE[id] };
  },
  presets: JVM_PRESETS,
  validateArg,
  optimMods: OPTIM_MODS,
};

window.CryoData = { INSTANCES, CACHE, HISTORY, kpisFor, wallOf, genMods, JVM_PRESETS, validateArg };
window.mockApi = mockApi;
