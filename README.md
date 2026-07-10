# ❄️ Cryo Launcher

[![Latest release](https://img.shields.io/github/v/release/xponer/vspeed-cryoLauncher?label=release&color=7c6cf0)](https://github.com/xponer/vspeed-cryoLauncher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/xponer/vspeed-cryoLauncher/total?color=38bdf8)](https://github.com/xponer/vspeed-cryoLauncher/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)

A fast, modern **Minecraft modpack launcher for Windows**, built around one obsession:
**launching huge modpacks faster**. Create instances, install packs from **Modrinth &
CurseForge**, manage mods, host a dedicated server, and launch **without PrismLauncher** —
with the **VSpeed** engine doing the heavy lifting:

| Boot to main menu — All the Mods 10 (479 mods) | |
|---|---|
| Default launch | 104–116 s |
| **VSpeed Turbo** (Java 25 AOT cache) | **75–77 s — about −32%** |

Numbers measured by the launcher's own one-click **Auto-Benchmark** — run it on *your* pack
and see your own. Around the speed core: **safe mod updates that roll themselves back** if
they break your pack, a **crash bisector** that finds the one broken mod out of 500
automatically, **one-click public servers** your friends can join with no port forwarding,
a built-in AI crash assistant, a pop-out live game console, and one-click speed boosters.

> Native WPF host + WebView2 rendering a React UI, a [CmlLib.Core](https://github.com/CmlLib/CmlLib.Core)
> launch engine, DPAPI-encrypted Microsoft auth, per-instance Java auto-detection,
> and [Velopack](https://github.com/velopack/velopack) auto-updates.
>
> 🌐 **Website:** https://xponer.github.io/vspeed-cryoLauncher/

## ⬇️ Download (Windows)

**[→ Download the latest installer (Cryo-win-Setup.exe)](https://github.com/xponer/vspeed-cryoLauncher/releases/latest)**

1. Download `Cryo-win-Setup.exe` from the latest release.
2. Run it — installs per-user (no admin needed), adds a Desktop + Start-menu shortcut.
3. Windows SmartScreen may warn on first run (the app isn't code-signed yet) — click
   **More info → Run anyway**. Skeptical? Good — see [Trust & security](#-trust--security)
   for what you can verify yourself, including building from source.
4. The launcher **auto-updates** from GitHub: new releases download in the background and apply on restart.

**Prefer to pick your own folder (no installer)?** Download **`Cryo-win-Portable.zip`** from the same
release and extract it anywhere — it runs in place. The Setup.exe always installs per-user to
`%LocalAppData%\Cryo` (a Velopack requirement for seamless auto-updates); for a custom location, use
the portable build.

> Public test build — expect rough edges. Please report anything you hit. 🙏

## 🔒 Trust & security

New launcher from an unknown dev — skepticism is healthy. Here's what you can verify
instead of taking anyone's word:

- **The source is public** — this repo *is* the launcher. Every release's full source is
  committed and tagged. Don't trust the exe? **Build it yourself in ~2 minutes** with the
  .NET 8 SDK ([instructions below](#%EF%B8%8F-build-from-source)) — no external build
  servers, nothing hidden.
- **Auto-update can't ship you something else** — the updater is
  [Velopack](https://github.com/velopack/velopack) pointed at **this repo's public GitHub
  Releases**. There is no private update server: every update package sits next to its
  source code and changelog, publicly diffable. You can verify any downloaded asset by
  comparing `Get-FileHash <file>` with the SHA-256 digest GitHub shows next to the asset
  on the release page.
- **Your Microsoft account is safe by construction** — sign-in uses Microsoft's official
  flow (the launcher never sees your password), and tokens are stored **DPAPI-encrypted**
  (current-user scope) — never plaintext, never logged, never sent anywhere but Microsoft.
- **Third-party credentials stay on your machine** — optional keys (AI, CurseForge) and
  the playit.gg tunnel secret are stored encrypted locally and are never echoed to the UI
  or logs.
- **Not code-signed yet** — that's why SmartScreen warns on first run. Certificates cost
  money; it's planned. Until then, the portable zip + build-from-source are the
  zero-trust options.
- Found something anyway? **[Private vulnerability reporting](https://github.com/xponer/vspeed-cryoLauncher/security/advisories/new)**
  is enabled — see [SECURITY.md](./SECURITY.md).

## 🐞 Found a bug?

Use the in-app button **Settings → About → Report a bug**, or open one here:

**[→ Report a bug](https://github.com/xponer/vspeed-cryoLauncher/issues/new/choose)**

Please include your launcher version (Settings → About) and, if relevant, the launcher
log (Settings → Self-Check → Open launcher log).

## ✨ Features

- **Create instances natively** — NeoForge / Forge / Fabric / Quilt / Vanilla, no Prism required.
- **Install modpacks** from Modrinth (`.mrpack`) and CurseForge in one click.
- **Mod browser** with version picker, SHA-512-verified downloads, **automatic dependency
  resolution**, and one-click updates.
- **Safe update all — with auto-rollback** — snapshots your mods, installs every available
  update, **boot-verifies the pack**, and if it crashes, **restores everything
  automatically**. You end up updated-and-verified or exactly where you started — never
  broken. A manual Roll back button keeps the snapshot until the next update.
- **Crash bisector** — pack crashes at startup and you don't know which of 479 mods did
  it? One button binary-searches your mods folder with automated boots (dependencies
  handled) until the culprit is isolated and disabled. All jars restored afterwards.
- **Pack Optimizer** — one-click scan + fix: installs missing performance mods for your
  loader, flips ModernFix dynamic resources, corrects RAM, enables Turbo, offers the
  Defender exclusion — then points you at the benchmark to prove the gain.
- **One-click modpack update** — re-installs the latest pack version; your old mods are
  backed up and your worlds are left untouched.
- **Server browser** with live ping / MOTD / player count, plus a one-click **Join**
  that launches straight into a server.
- **Host a dedicated server** for any pack — one-click setup from the pack's own mods and
  config, a live filtered console with command input, and a full `server.properties` editor
  (NeoForge / Fabric / Vanilla).
- **Make your server public in one click** — friends join from anywhere with a shareable
  address, **no router setup, no port forwarding** (free open-source
  [playit.gg](https://playit.gg) tunnel, auto-provisioned; one-time browser approval).
- **Resume** — a button next to Play that boots **straight into your last singleplayer
  world** (Quick Play, MC 1.20+). Zero menus: click, one boot, you're in your base.
- **Tags, notes & colours** for both mods and whole packs — organize a big library your way,
  with tag filters everywhere.
- **AI assistant** — diagnoses crashes, mod conflicts, and lag (bring your own free NVIDIA key).
- **Pop-out live console** — a separate always-on-top-capable window tailing the game log in
  real time, colour-coded by level. Open it right next to Play and watch the whole boot.
- **World backups**, a live **boot waterfall**, a **"Slowest mods" launch profiler**
  (per-mod boot cost from your real logs), and launch **profiles**.
- **The launcher sleeps while you play** — minimized or in the tray, the UI suspends and
  hands its memory back to the game (measured **467 MB → 21 MB**), waking instantly.
- **VSpeed engine** — startup optimization: AppCDS class cache by default, plus **VSpeed Turbo**
  (Java 25 AOT cache) — measured **−32% boot-to-menu on All the Mods 10** — with a built-in
  one-click A/B benchmark that proves the number on your own pack (details below).
- **Speed boosters** — one-click Windows Defender exclusion for your mods folder, a ModernFix
  dynamic-resources toggle, and automatic OS file-cache pre-warming on every launch.
- **Microsoft sign-in** — tokens encrypted at rest with **Windows DPAPI** (current-user
  scope); the launcher never stores them in plaintext and never sees your password.
- **Tuning that won't foot-gun you** — RAM sliders capped to your machine's physical
  memory, JVM presets (Balanced G1GC / Low-pause ZGC / Aikar), Java auto-detect, and
  **smart defaults**: packs without custom settings get community-standard G1 flags and a
  heap auto-sized from mod count + installed RAM.
- **Discord Rich Presence**, auto-update, light/dark themes.

---

## VSpeed — faster startup

**AppCDS (default).** On **Java 19+** the engine adds `-XX:+AutoCreateSharedArchive`, so the
first launch records a class-data archive and every subsequent launch maps it directly into
memory — skipping a chunk of JAR parsing, bytecode verification, and class linking. In our
testing on **All the Mods 10** (~480 mods) this cut boot-to-main-menu time by **~13%**.
Results vary by disk speed, RAM, mod count — and by JRE: AppCDS silently no-ops on runtimes
that ship without a base CDS archive (e.g. some Microsoft OpenJDK builds).

**VSpeed Turbo.** A per-instance toggle (Performance tab) that runs the pack on a **Java 25**
runtime with a Project-Leyden **AOT cache**: one training launch records everything the JVM
loads and compiles, and every launch after starts from that snapshot instead of redoing it
(plus JDK 25's Compact Object Headers for less GC work during boot). Cryo downloads the
runtime, trains, assembles and validates the cache automatically, and measures every boot.
When mods change, the cache goes stale and **you choose when to retrain** — no surprise
slow launches; stale launches just run the normal path until you click Retrain.

Measured on **All the Mods 10** (479 mods): default launch 104–116 s to the main menu, Turbo
**75–77 s** — about **−32%**. During training you'll see a wall of harmless `[aot] Skipping…`
warnings (signed jars and mod classes can't be archived — everything else is), and after you
quit, the Java process stays alive a few minutes assembling the ~640 MB cache. Safety first:
if a bad cache assembly ever makes the JVM crash, Cryo detects it, disables Turbo, deletes the
cache and tells you — one toggle flip retrains a fresh one; normal launches are never affected.

**Speed boosters** (Performance tab): a one-click **Windows Defender exclusion** for the
instance + game files (Defender re-scans hundreds of jars on every launch — big win on cold
starts and after mod updates), a **ModernFix dynamic-resources** toggle, and automatic **file
cache pre-warming** on every launch.

**Measure it yourself.** Every instance has a one-click **Auto-Benchmark**: Cryo launches the
pack, detects the main menu, records the time, closes the game, and compares the default launch
against Turbo — plus a rolling list of measured boot times from your real launches.

---

## 🛠️ Build from source

The launcher lives in [`launcher/`](./launcher). Prerequisite: **.NET 8 SDK**
(`winget install Microsoft.DotNet.SDK.8`).

```powershell
cd launcher
dotnet build VSpeedLauncher/VSpeedLauncher.csproj -c Release
# run: VSpeedLauncher/bin/Release/net8.0-windows/win-x64/VSpeedLauncher.exe
```

The React UI (`launcher/VSpeedLauncher/WebUI/`) is **served from the source folder in dev
builds**, so editing the `.jsx` files and relaunching is enough — only C# changes need a
rebuild. To produce an installer + auto-update feed, see
[`launcher/README.md`](./launcher/README.md) and `launcher/build-release.ps1`.

> Architecture, conventions, and a changelog of recent fixes live in
> [`launcher/CLAUDE.md`](./launcher/CLAUDE.md).

## 📂 Data locations

- Game runtime: `%LocalAppData%\VSpeedLauncher\game\` (libraries, versions, assets,
  auto-downloaded Mojang JREs under `runtime\`).
- Instances (PrismLauncher-compatible layout): `%APPDATA%\PrismLauncher\instances\<id>\`.
- Encrypted account tokens: `%LocalAppData%\VSpeedLauncher\auth\accounts.bin` (DPAPI).
- App config: `%LocalAppData%\VSpeedLauncher\config.json`.

## License

MIT
