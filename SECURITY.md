# Security Policy

## Supported versions

Only the **latest release** is supported — the launcher auto-updates via Velopack, so
older versions are superseded within days.

| Version | Supported |
| ------- | --------- |
| latest release | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead:
**[Report a vulnerability](https://github.com/xponer/vspeed-cryoLauncher/security/advisories/new)**
(Security tab → "Report a vulnerability"). You'll get a response as soon as possible,
normally within a few days.

## What counts as security-sensitive here

- **Account tokens** — Microsoft/Minecraft tokens are stored DPAPI-encrypted
  (current-user scope) in `%LocalAppData%\VSpeedLauncher\auth\accounts.bin` and must
  never be readable in plaintext, logged, or exposed to the web UI.
- **API keys** (AI / CurseForge / Discord) — never leave the C# side; the UI only sees
  booleans. Any path that echoes a key is a bug.
- **Bridge input** — everything coming from the renderer is treated as untrusted:
  path traversal in file/mod operations, UNC paths, unvalidated URLs.
- **Update chain** — the Velopack feed and release assets.

Anything in those areas: report privately. Crash bugs, mod incompatibilities, and
performance issues are normal issues — file them publicly.
