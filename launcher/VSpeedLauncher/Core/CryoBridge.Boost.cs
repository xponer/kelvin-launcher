using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace VSpeedLauncher.Core;

/// <summary>
/// Game Session Boost — Windows-level tweaks nobody configures by hand,
/// applied to every engine launch while the toggle is on:
///  • HIGH process priority (no admin needed below Realtime),
///  • P-core-only affinity on hybrid Intel CPUs (Windows loves scheduling MC
///    worker threads onto E-cores → measurable stutter),
///  • per-app "high performance GPU" preference in the registry (fixes the
///    classic laptop case where the game silently runs on the iGPU),
///  • High-Performance power plan while the game runs (previous plan restored
///    on exit),
///  • optional -XX:+UseLargePages (separate toggle; needs the one-time
///    SeLockMemoryPrivilege grant + re-login; JVM falls back gracefully).
/// All effects are per-session and reversible.
/// </summary>
public sealed partial class CryoBridge
{
    // ── Hybrid-CPU detection (EfficiencyClass via GetLogicalProcessorInformationEx) ──

    [StructLayout(LayoutKind.Sequential)]
    private struct GROUP_AFFINITY { public UIntPtr Mask; public ushort Group; public ushort R0, R1, R2; }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetLogicalProcessorInformationEx(int relation, IntPtr buffer, ref uint length);

    /// <summary>(pCoreMask, pCores, eCores) for group 0; mask 0 = not hybrid /
    /// detection unavailable → leave affinity alone.</summary>
    private static (ulong mask, int pCores, int eCores) DetectPCores()
    {
        const int RelationProcessorCore = 0;
        try
        {
            uint len = 0;
            GetLogicalProcessorInformationEx(RelationProcessorCore, IntPtr.Zero, ref len);
            if (len == 0) return (0, 0, 0);
            var buf = Marshal.AllocHGlobal((int)len);
            try
            {
                if (!GetLogicalProcessorInformationEx(RelationProcessorCore, buf, ref len)) return (0, 0, 0);
                ulong pMask = 0; int p = 0, e = 0; byte maxEff = 0;
                // First pass: find the highest EfficiencyClass (P-cores have the max).
                var offsets = new List<(byte eff, ulong mask)>();
                int pos = 0;
                while (pos < len)
                {
                    int relType = Marshal.ReadInt32(buf, pos);
                    int size    = Marshal.ReadInt32(buf, pos + 4);
                    if (relType == RelationProcessorCore)
                    {
                        // PROCESSOR_RELATIONSHIP: Flags(byte), EfficiencyClass(byte),
                        // Reserved[20], GroupCount(ushort), GroupMask[]
                        byte eff = Marshal.ReadByte(buf, pos + 8 + 1);
                        ushort groupCount = (ushort)Marshal.ReadInt16(buf, pos + 8 + 2 + 20);
                        // First group's mask (group 0 covers <=64 logical CPUs — fine here)
                        long maskOff = pos + 8 + 2 + 20 + 2 + 2;   // + padding to pointer alignment
                        // GROUP_AFFINITY is 8-aligned after the header; compute defensively:
                        maskOff = pos + 8 + 24;                    // Flags+Eff+Reserved20+GroupCount(2) = 24
                        ulong mask = (ulong)Marshal.ReadInt64(buf, (int)maskOff);
                        if (eff > maxEff) maxEff = eff;
                        offsets.Add((eff, mask));
                        _ = groupCount;
                    }
                    pos += size;
                }
                foreach (var (eff, mask) in offsets)
                {
                    if (eff == maxEff) { pMask |= mask; p++; } else e++;
                }
                // Not hybrid (all cores same class) → report but return mask 0 (no pinning needed).
                return e == 0 ? (0, p, 0) : (pMask, p, e);
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        catch (Exception ex) { Logger.Warn($"Boost: P-core detection failed: {ex.Message}"); return (0, 0, 0); }
    }

    // ── Power plan (switch while playing, restore after) ──────────────────────
    private static string? _prevPowerPlan;          // GUID captured before boost
    private static int _boostedGames;               // ref-count across concurrent launches

    // Persisted copy of the pre-boost plan so an orphaned session (launcher
    // killed/restarted while the game ran) still gets restored — on the next
    // launcher start (see RestoreOrphanedPowerPlan).
    private static string PowerPlanMarker => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "VSpeedLauncher", "powerplan.prev");

    /// <summary>Called once at launcher startup: if we left the machine on a
    /// boosted power plan (marker present) and no game is running, put the
    /// user's plan back. Cheap; makes the boost safe across crashes/restarts.</summary>
    public static void RestoreOrphanedPowerPlan()
    {
        try
        {
            if (!File.Exists(PowerPlanMarker)) return;
            var prev = File.ReadAllText(PowerPlanMarker).Trim();
            if (prev.Length >= 32) { SetPowerPlan(prev); Logger.Info("Boost: restored power plan orphaned by a previous session"); }
            File.Delete(PowerPlanMarker);
        }
        catch (Exception e) { Logger.Warn($"Boost: orphan power-plan restore: {e.Message}"); }
    }

    private static string? CurrentPowerPlan()
    {
        try
        {
            var psi = new ProcessStartInfo("powercfg", "/getactivescheme")
            { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
            using var p = Process.Start(psi)!;
            var outp = p.StandardOutput.ReadToEnd(); p.WaitForExit(5000);
            var m = System.Text.RegularExpressions.Regex.Match(outp, "[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}");
            return m.Success ? m.Value : null;
        }
        catch { return null; }
    }

    private static void SetPowerPlan(string guid)
    {
        try
        {
            Process.Start(new ProcessStartInfo("powercfg", "/setactive " + guid)
            { UseShellExecute = false, CreateNoWindow = true })?.WaitForExit(5000);
        }
        catch (Exception e) { Logger.Warn($"Boost: power plan switch failed: {e.Message}"); }
    }

    private const string HighPerfPlan = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

    // ── Per-app GPU preference (HKCU — no admin) ──────────────────────────────
    private static void SetGpuPreference(string exePath)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\DirectX\UserGpuPreferences");
            var existing = key.GetValue(exePath) as string ?? "";
            if (!existing.Contains("GpuPreference=2"))
            {
                key.SetValue(exePath, "GpuPreference=2;");
                Logger.Info($"Boost: high-performance GPU preference set for {exePath}");
            }
        }
        catch (Exception e) { Logger.Warn($"Boost: GPU preference failed: {e.Message}"); }
    }

    /// <summary>Applies the per-process parts right after launch, and arranges
    /// the power-plan restore when the game exits. Never throws.</summary>
    private void ApplySessionBoost(Process proc, string? javaExePath)
    {
        try
        {
            if (!_config.Data.SessionBoostEnabled) return;

            // AboveNormal, not High: High can starve audio/OS threads on some
            // systems; AboveNormal is the safe win. Re-applied a few times because
            // the JVM/ModLauncher re-exec can reset it during early boot.
            void SetPrio()
            {
                try { if (!proc.HasExited) proc.PriorityClass = ProcessPriorityClass.AboveNormal; }
                catch (Exception e) { Logger.Warn($"Boost: priority: {e.Message}"); }
            }
            SetPrio();
            _ = Task.Run(async () =>
            {
                foreach (var d in new[] { 5000, 15000, 40000 })
                {
                    try { await Task.Delay(d); } catch { break; }
                    if (proc.HasExited) break;
                    SetPrio();
                }
            });

            var (mask, pc, ec) = DetectPCores();
            if (mask != 0)
            {
                try
                {
                    proc.ProcessorAffinity = (IntPtr)(long)mask;
                    Logger.Info($"Boost: pinned to {pc} P-core(s) (hybrid CPU, {ec} E-core(s) excluded)");
                }
                catch (Exception ex) { Logger.Warn($"Boost: affinity: {ex.Message}"); }
            }

            if (Interlocked.Increment(ref _boostedGames) == 1)
            {
                _prevPowerPlan = CurrentPowerPlan();
                if (_prevPowerPlan != null && !_prevPowerPlan.Equals(HighPerfPlan, StringComparison.OrdinalIgnoreCase))
                {
                    // Persist BEFORE switching, so a launcher crash mid-game still
                    // restores on next start.
                    try { Directory.CreateDirectory(Path.GetDirectoryName(PowerPlanMarker)!); File.WriteAllText(PowerPlanMarker, _prevPowerPlan); } catch { }
                    SetPowerPlan(HighPerfPlan);
                    Logger.Info("Boost: switched to High Performance power plan (restores when the game exits)");
                }
                else _prevPowerPlan = null;   // already high-perf → nothing to restore
            }

            _ = Task.Run(async () =>
            {
                try { await proc.WaitForExitAsync(); } catch { /* it exits either way */ }
                if (Interlocked.Decrement(ref _boostedGames) == 0 && _prevPowerPlan != null)
                {
                    SetPowerPlan(_prevPowerPlan);
                    Logger.Info("Boost: previous power plan restored");
                    _prevPowerPlan = null;
                    try { File.Delete(PowerPlanMarker); } catch { }
                }
            });

            Logger.Info("Boost: HIGH priority applied" + (javaExePath != null ? $" ({Path.GetFileName(javaExePath)})" : ""));
        }
        catch (Exception ex) { Logger.Warn($"Boost: {ex.Message}"); }
    }

    private object GetBoost()
    {
        var (mask, p, e) = DetectPCores();
        bool lpGranted = false;
        try { lpGranted = File.Exists(Path.Combine(FpsDir, "..", "largepages.granted")); } catch { }
        return new
        {
            ok = true,
            enabled     = _config.Data.SessionBoostEnabled,
            largePages  = _config.Data.LargePagesEnabled,
            lpGranted,
            hybridCpu   = mask != 0,
            pCores      = p,
            eCores      = e,
        };
    }

    private object SetBoost(bool enabled, bool largePages)
    {
        _config.Data.SessionBoostEnabled = enabled;
        _config.Data.LargePagesEnabled   = largePages;
        _config.Save();
        Logger.Info($"Boost: enabled={enabled}, largePages={largePages}");
        return new { ok = true };
    }

    /// <summary>One elevated run that grants SeLockMemoryPrivilege ("Lock pages
    /// in memory") to the current user via secedit — required for
    /// -XX:+UseLargePages. Takes effect after the next sign-in.</summary>
    private async Task<object?> GrantLargePagesAsync()
    {
        var user = Environment.UserName;
        var script =
            "$t=[IO.Path]::GetTempFileName(); secedit /export /cfg $t /areas USER_RIGHTS | Out-Null; " +
            "$c=Get-Content $t; $done=$false; " +
            "$c = $c | ForEach-Object { if ($_ -match '^SeLockMemoryPrivilege') { $done=$true; if ($_ -notmatch [regex]::Escape('" + user + "')) { $_ + ',' + '" + user + "' } else { $_ } } else { $_ } }; " +
            "if (-not $done) { $c += 'SeLockMemoryPrivilege = " + user + "' }; " +
            "Set-Content $t $c; secedit /configure /db secedit.sdb /cfg $t /areas USER_RIGHTS | Out-Null; Remove-Item $t";
        var psi = new ProcessStartInfo
        {
            FileName        = "powershell.exe",
            Arguments       = "-NoProfile -Command \"" + script.Replace("\"", "\\\"") + "\"",
            Verb            = "runas",
            UseShellExecute = true,
            WindowStyle     = ProcessWindowStyle.Hidden,
        };
        try
        {
            var p = Process.Start(psi);
            if (p == null) return new { ok = false, error = "Could not start PowerShell." };
            await p.WaitForExitAsync();
            if (p.ExitCode != 0) return new { ok = false, error = $"Privilege grant failed (exit {p.ExitCode})." };
            try
            {
                Directory.CreateDirectory(Path.GetFullPath(Path.Combine(FpsDir, "..")));
                File.WriteAllText(Path.Combine(FpsDir, "..", "largepages.granted"), DateTime.UtcNow.ToString("o"));
            }
            catch { /* marker is best-effort */ }
            Logger.Info("Boost: SeLockMemoryPrivilege granted (takes effect after re-login)");
            return new { ok = true, needsRelogin = true };
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return new { ok = false, error = "The admin prompt was declined." };
        }
    }
}
