<p align="center">
  <img src="docs/kelvin-512.png" width="96" alt="Kelvin" />
</p>

<h1 align="center">KELVIN</h1>
<p align="center"><b>The cold-start Minecraft launcher.</b><br/>
Big modpacks, measured launches, no faith required.</p>

<p align="center">
  <a href="https://github.com/xponer/kelvin-launcher/releases/latest"><img src="https://img.shields.io/github/v/release/xponer/kelvin-launcher?label=release&color=35b8cb" alt="release"/></a>
  <a href="https://github.com/xponer/kelvin-launcher/releases"><img src="https://img.shields.io/github/downloads/xponer/kelvin-launcher/total?color=35b8cb" alt="downloads"/></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-546a72" alt="MIT"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-546a72" alt="Windows"/>
</p>

---

Kelvin is a Windows launcher for heavily modded Minecraft, built around one idea:
**cold starts are an engineering problem, and engineering problems get measured.**
It runs your packs on a Java 25 runtime with an ahead-of-time cache (Project Leyden),
proves the difference with a built-in benchmark, and un-breaks your pack automatically
when an update goes wrong.

| Boot to main menu — All the Mods 10 (479 mods) | |
|---|---|
| Default launch | 145 s |
| **Kelvin Turbo** (Java 25 AOT cache) | **85 s — −41%** |

Measured by the launcher's own benchmark on real hardware. Run it on your pack;
it reports whatever it finds, including "no difference".

> Formerly known as **Cryo**. Same app, same auto-update chain, new name and face.
> Existing installs update in place.

## Download

**[Latest installer — Kelvin-Setup (Cryo-win-Setup.exe)](https://github.com/xponer/kelvin-launcher/releases/latest)**

1. Run the installer — per-user, no admin, Desktop + Start-menu shortcut.
2. SmartScreen will warn on first run (not code-signed yet — see
   [Trust & security](#trust--security), including how to build it yourself).
3. Auto-updates come from this repo's public GitHub Releases.

Prefer your own folder? `Cryo-win-Portable.zip` from the same release runs in place.

## What it does

**Launch speed, measured**
- **Turbo** — one training launch records everything the JVM loads and compiles;
  every launch after starts from that snapshot. When mods change, *you* choose
  when to retrain — no surprise slow launches.
- **Prepare pack** — install any pack, click once, walk away: performance mods,
  ModernFix tuning, memory sizing, Turbo training and a Default-vs-Turbo
  benchmark, fully unattended. Come back to a number, not a promise.
- **Auto-Benchmark**, a **boot waterfall**, and a per-mod **"slowest mods"**
  profiler built from your real logs.
- Smart JVM defaults (community-standard G1 flags, heap sized from mod count),
  one-click Defender exclusion, file-cache pre-warming, parallel pack installs.

**When packs break**
- **Safe update all** — snapshots your mods, applies every update, boot-verifies
  the pack, and **rolls everything back automatically if it crashes**. Updated
  and verified, or exactly where you started. Never broken.
- **Crash bisector** — binary-searches 500 mods with automated boots until the
  one broken mod is found and disabled. Dependencies handled, everything restored.
- Dependency check, duplicate scan, and an AI assistant that reads the actual
  crash cause instead of guessing.

**Playing with people**
- **Host a dedicated server** for any pack in one click, console included.
- **Make it public in one more click** — a free playit.gg tunnel gives friends a
  join address that works from anywhere. No port forwarding, no router pain.
- **Resume** — boot straight into your last singleplayer world. Zero menus.

**Daily driving**
- Instances for NeoForge / Forge / Fabric / Quilt / Vanilla — PrismLauncher-compatible
  folder layout, no Prism required.
- Modrinth + CurseForge packs and mods, SHA-verified downloads, dependency resolution.
- Tags, notes and colours for a big library; world backups; pop-out live console;
  screenshots; Discord Rich Presence; light/dark.
- The launcher UI **suspends while you play**, handing ~450 MB back to the game.

## Trust & security

New launcher from an unknown dev — skepticism is healthy. Verify instead of trusting:

- **This repo is the launcher.** Every release's full source is tagged. Build it
  yourself in ~2 minutes (below) — no external build servers.
- **Auto-update can't ship you something else** — it's
  [Velopack](https://github.com/velopack/velopack) reading this repo's public
  GitHub Releases. No private update server exists. Verify any asset with
  `Get-FileHash` against the SHA-256 digest GitHub shows on the release page.
- **Microsoft sign-in** uses Microsoft's official flow; tokens are stored
  DPAPI-encrypted, current-user scope, never plaintext, never logged.
- Optional keys (AI, CurseForge) and the tunnel credential stay encrypted on
  your machine and are never echoed to the UI or logs.
- Not code-signed yet (certificates cost money; planned). Until then: the
  portable zip and build-from-source are the zero-trust options.
- Found a hole? **[Private vulnerability reporting](https://github.com/xponer/kelvin-launcher/security/advisories/new)**
  is enabled — see [SECURITY.md](./SECURITY.md).

## Build from source

Prerequisite: .NET 8 SDK (`winget install Microsoft.DotNet.SDK.8`).

```powershell
cd launcher
dotnet build VSpeedLauncher/VSpeedLauncher.csproj -c Release
# run: VSpeedLauncher/bin/Release/net8.0-windows/win-x64/VSpeedLauncher.exe
```

The UI is plain React served from `launcher/VSpeedLauncher/WebUI/` — JS changes
apply on relaunch, no rebuild. Architecture notes and the full changelog live in
[`launcher/CLAUDE.md`](./launcher/CLAUDE.md).

## Bugs

**Settings → About → Report a bug** in the app, or
[open an issue](https://github.com/xponer/kelvin-launcher/issues/new/choose) with your
launcher version and the log (Settings → Self-Check → Open launcher log).

## Data locations

- Game runtime: `%LocalAppData%\VSpeedLauncher\game\`
- Instances (PrismLauncher-compatible): `%APPDATA%\PrismLauncher\instances\<id>\`
- Encrypted tokens: `%LocalAppData%\VSpeedLauncher\auth\accounts.bin` (DPAPI)

(Internal folder names keep the original codenames so updates and user data
survive the rebrand.)

## License

MIT
