# ❄️ Cryo Launcher

A fast, modern **Minecraft modpack launcher for Windows** — create instances, install
modpacks from **Modrinth & CurseForge**, manage mods, and launch **without PrismLauncher**.
Includes a built-in AI assistant, a server browser, world backups, and the **VSpeed**
startup-optimization engine.

> Native WPF host + WebView2 rendering a React UI, a [CmlLib.Core](https://github.com/CmlLib/CmlLib.Core)
> launch engine, DPAPI-encrypted Microsoft auth, per-instance Java auto-detection,
> and [Velopack](https://github.com/velopack/velopack) auto-updates.
>
> 🌐 **Website:** https://xponer.github.io/vspeed-cryoLauncher/

## ⬇️ Download (Windows)

**[→ Download the latest installer (Cryo-win-Setup.exe)](https://github.com/xponer/vspeed-cryoLauncher/releases/latest)**

1. Download `Cryo-win-Setup.exe` from the latest release.
2. Run it — installs per-user (no admin needed), adds a Desktop + Start-menu shortcut.
3. Windows SmartScreen may warn on first run (the app isn't code-signed yet) — click **More info → Run anyway**.
4. The launcher **auto-updates** from GitHub: new releases download in the background and apply on restart.

**Prefer to pick your own folder (no installer)?** Download **`Cryo-win-Portable.zip`** from the same
release and extract it anywhere — it runs in place. The Setup.exe always installs per-user to
`%LocalAppData%\Cryo` (a Velopack requirement for seamless auto-updates); for a custom location, use
the portable build.

> Public test build — expect rough edges. Please report anything you hit. 🙏

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
- **One-click modpack update** — re-installs the latest pack version; your old mods are
  backed up and your worlds are left untouched.
- **Server browser** with live ping / MOTD / player count, plus a one-click **Join**
  that launches straight into a server.
- **AI assistant** — diagnoses crashes, mod conflicts, and lag (bring your own free NVIDIA key).
- **Pop-out live console** — a separate always-on-top-capable window tailing the game log in
  real time, colour-coded by level. Open it right next to Play and watch the whole boot.
- **World backups**, a live **boot waterfall**, and launch **profiles**.
- **VSpeed engine** — startup optimization: AppCDS class cache by default, plus an experimental
  **Turbo** mode (Java 25 AOT cache) with a built-in one-click A/B benchmark (details below).
- **Microsoft sign-in** — tokens encrypted at rest with **Windows DPAPI** (current-user
  scope); the launcher never stores them in plaintext and never sees your password.
- **Tuning that won't foot-gun you** — RAM sliders capped to your machine's physical
  memory, JVM presets (Balanced G1GC / Low-pause ZGC / Aikar), and Java auto-detect.
- **Discord Rich Presence**, auto-update, light/dark themes.

---

## VSpeed — faster startup

**AppCDS (default).** On **Java 19+** the engine adds `-XX:+AutoCreateSharedArchive`, so the
first launch records a class-data archive and every subsequent launch maps it directly into
memory — skipping a chunk of JAR parsing, bytecode verification, and class linking. In our
testing on **All the Mods 10** (~480 mods) this cut boot-to-main-menu time by **~13%**.
Results vary by disk speed, RAM, mod count — and by JRE: AppCDS silently no-ops on runtimes
that ship without a base CDS archive (e.g. some Microsoft OpenJDK builds).

**VSpeed Turbo (experimental).** A per-instance toggle (Performance tab) that runs the pack on
a **Java 25** runtime with a Project-Leyden **AOT cache**: one training launch records
everything the JVM loads and compiles, and every launch after starts from that snapshot instead
of redoing it. Cryo downloads the runtime, trains, assembles and invalidates the cache
automatically (changing mods retrains), and measures every boot so you can see the difference.
Honest status: the pipeline works end-to-end, but current JDK 25 builds can crash when running
from the very large caches that 400+ mod packs produce — Cryo detects that, disables Turbo and
deletes the cache automatically, so normal launches are never affected. Try it on small and
medium packs; for huge packs, retest as newer JDK updates land.

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
