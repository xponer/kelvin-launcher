# Contributing to Cryo Launcher

Thanks for your interest! Bug reports, feature ideas, and pull requests are all welcome.

## Reporting bugs

The most valuable thing you can do. Use the in-app button
**Settings → About → Report a bug**, or
[open an issue](https://github.com/xponer/vspeed-cryoLauncher/issues/new/choose) and include:

- Your launcher version (**Settings → About**)
- The launcher log (**Settings → Self-Check → Open launcher log**)
- For game-launch problems: `logs/cryo-engine.log` from the instance's `minecraft/logs`
  folder (it captures early JVM crashes that never reach `latest.log`)

## Building from source

Prerequisite: **.NET 8 SDK** (`winget install Microsoft.DotNet.SDK.8`).

```powershell
cd launcher
dotnet build VSpeedLauncher/VSpeedLauncher.csproj -c Release
# run: VSpeedLauncher/bin/Release/net8.0-windows/win-x64/VSpeedLauncher.exe
```

Dev builds serve the React UI straight from `launcher/VSpeedLauncher/WebUI/` — **JS changes
apply on relaunch, no rebuild needed**. Only C# changes require `dotnet build`. Stop any
running launcher first (it locks the exe).

## Codebase orientation

- `launcher/VSpeedLauncher/Core/` — C# backend: `CryoBridge.cs` (JS↔C# bridge + most logic),
  `LauncherCore.cs` (CmlLib wrapper), `TurboRuntime.cs` (VSpeed Turbo / AOT cache).
- `launcher/VSpeedLauncher/WebUI/src/` — React 18 UI, **no JSX** (plain
  `React.createElement`), no bundler; files are classic scripts sharing one global scope.
- Architecture notes, UI conventions, and a detailed changelog live in
  [`launcher/CLAUDE.md`](launcher/CLAUDE.md) — **read it before making changes**, it
  documents the sharp edges (cross-file `const` collisions, `MArgument` quoting, etc.).

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Build must pass clean: `dotnet build -c Release` with **0 warnings**, and
   `node --check` on any edited `WebUI/src/*.js` file.
3. Launch the app once and confirm the UI loads without `WebError` lines in the
   launcher log.
4. Describe **what** changed and **why** in the PR body; add an entry to the changelog
   in `launcher/CLAUDE.md` for anything user-visible.

## Performance claims

If your change is about launch speed, prove it: run the in-app **Auto-Benchmark**
(instance → Performance) before and after, and put both numbers in the PR. Measured
honestly beats estimated impressively.
