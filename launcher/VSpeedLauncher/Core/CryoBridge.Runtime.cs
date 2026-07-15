using System.IO;
using System.IO.Compression;
using System.Net.Http;

namespace VSpeedLauncher.Core;

/// <summary>
/// Runtime Lab — per-instance garbage-collector choice, plus an optional
/// GraalVM runtime. The GC is the in-game lever most players never touch:
/// G1 (throughput, the smart default) vs Generational ZGC (Java 21+, trades a
/// little throughput for far fewer stutter spikes — often FELT more than raw
/// FPS on big packs). The choice is written into the instance's JvmArgs (the
/// same field Prime/our Optimize use), so it flows through the normal launch
/// path and shows up in the FPS benchmark's before/after.
/// </summary>
public sealed partial class CryoBridge
{
    // Aikar-style G1 (throughput) — the community default, valid Java 8→25.
    private static readonly string[] GcFlagsG1 =
    {
        "-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled",
        "-XX:MaxGCPauseMillis=200", "-XX:+PerfDisableSharedMem", "-XX:G1NewSizePercent=30",
        "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M", "-XX:G1ReservePercent=20",
        "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4",
        "-XX:InitiatingHeapOccupancyPercent=15", "-XX:SurvivorRatio=32",
        "-XX:MaxTenuringThreshold=1", "-XX:+UseStringDeduplication",
    };

    // Generational ZGC (Java 21+): low-pause, minimal knobs on purpose.
    private static readonly string[] GcFlagsZgc =
    {
        "-XX:+UseZGC", "-XX:+ZGenerational", "-XX:+UseStringDeduplication",
    };

    private static readonly HashSet<string> AllGcTokens = new(
        GcFlagsG1.Concat(GcFlagsZgc).Concat(new[] { "-XX:+UseParallelGC", "-XX:+UseSerialGC", "-XX:+UseShenandoahGC" }),
        StringComparer.OrdinalIgnoreCase);

    private string DetectGc(string id)
    {
        var kv = ReadInstanceCfgGeneral(id);
        var args = ParseUserJvmArgs(kv);
        if (args.Count == 0) return "g1";   // no custom args → SmartGcFlags (G1) at launch
        if (args.Any(a => a.Equals("-XX:+UseZGC", StringComparison.OrdinalIgnoreCase))) return "zgc";
        if (args.Any(a => a.Equals("-XX:+UseG1GC", StringComparison.OrdinalIgnoreCase))) return "g1";
        return "custom";
    }

    private object GetRuntimeLab(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
        int javaMajor = JavaMajorForMc(meta.Mc);
        return new
        {
            ok = true,
            gc = DetectGc(id),
            zgcSupported = javaMajor >= 21,     // generational ZGC needs Java 21+
            javaMajor,
            graalInstalled = File.Exists(GraalJavaw()),
            graalActive = string.Equals(ReadInstanceJavaPath(id), GraalJavaw(), StringComparison.OrdinalIgnoreCase),
        };
    }

    /// <summary>Rewrites the instance's JvmArgs to the chosen GC preset,
    /// preserving any non-GC flags the user had. "g1" | "zgc".</summary>
    private object SetGc(string id, string gc)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
        if (gc == "zgc" && JavaMajorForMc(meta.Mc) < 21)
            return new { ok = false, error = "Generational ZGC needs a Java-21-era pack (MC 1.20.5+)." };

        var kv   = ReadInstanceCfgGeneral(id);
        var args = ParseUserJvmArgs(kv);
        if (args.Count == 0) args = new List<string>(SmartGcFlags);   // start from the smart default
        // Drop every GC-related token, then add the chosen set.
        args.RemoveAll(a => AllGcTokens.Contains(a));
        var add = gc == "zgc" ? GcFlagsZgc : GcFlagsG1;
        // Keep -XX:+UnlockExperimentalVMOptions ahead of experimental flags.
        var rebuilt = new List<string>();
        if (add.Any(f => f.Contains("G1NewSizePercent") || f.Contains("ZGenerational")))
            rebuilt.Add("-XX:+UnlockExperimentalVMOptions");
        rebuilt.AddRange(add.Where(f => f != "-XX:+UnlockExperimentalVMOptions"));
        rebuilt.AddRange(args.Where(a => !AllGcTokens.Contains(a) && a != "-XX:+UnlockExperimentalVMOptions"));

        SaveInstanceCfg(id, new System.Text.Json.Nodes.JsonObject { ["jvmArgs"] = string.Join(" ", rebuilt) });
        Logger.Info($"RuntimeLab({id}): GC set to {gc}");
        return new { ok = true, gc };
    }

    // ── GraalVM (optional alternative runtime) ────────────────────────────────
    private const string GraalVersion = "25.0.2";
    private const string GraalUrl =
        "https://github.com/graalvm/graalvm-ce-builds/releases/download/jdk-25.0.2/graalvm-community-jdk-25.0.2_windows-x64_bin.zip";
    private static string GraalDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "graalvm");
    private static string GraalJavaw()
    {
        try
        {
            if (!Directory.Exists(GraalDir)) return Path.Combine(GraalDir, "bin", "javaw.exe");
            var hit = Directory.EnumerateFiles(GraalDir, "javaw.exe", SearchOption.AllDirectories).FirstOrDefault();
            return hit ?? Path.Combine(GraalDir, "bin", "javaw.exe");
        }
        catch { return Path.Combine(GraalDir, "bin", "javaw.exe"); }
    }

    /// <summary>Downloads + unzips GraalVM CE (~320 MB) and points the instance's
    /// JavaPath at it. Push events: graalProgress / graalDone.</summary>
    private object InstallGraal(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        _ = Task.Run(async () =>
        {
            try
            {
                if (!File.Exists(GraalJavaw()))
                {
                    Directory.CreateDirectory(GraalDir);
                    var zip = Path.Combine(GraalDir, "graal.zip");
                    Push("graalProgress", new { id, message = "Downloading GraalVM (~320 MB, one time)…" });
                    using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) })
                    using (var resp = await http.GetAsync(GraalUrl, HttpCompletionOption.ResponseHeadersRead))
                    {
                        resp.EnsureSuccessStatusCode();
                        var total = resp.Content.Headers.ContentLength ?? 0;
                        await using var src = await resp.Content.ReadAsStreamAsync();
                        await using var dst = File.Create(zip);
                        var buf = new byte[1 << 20]; long done = 0; int n;
                        while ((n = await src.ReadAsync(buf)) > 0)
                        {
                            await dst.WriteAsync(buf.AsMemory(0, n)); done += n;
                            if (total > 0) Push("graalProgress", new { id, message = "Downloading GraalVM…", bytesDone = done, bytesTotal = total });
                        }
                    }
                    Push("graalProgress", new { id, message = "Extracting GraalVM…" });
                    ZipFile.ExtractToDirectory(zip, GraalDir, overwriteFiles: true);
                    try { File.Delete(zip); } catch { }
                }
                var javaw = GraalJavaw();
                if (!File.Exists(javaw)) throw new Exception("GraalVM extracted but javaw.exe wasn't found.");
                SaveInstanceCfg(id, new System.Text.Json.Nodes.JsonObject { ["javaPath"] = javaw });
                Logger.Info($"RuntimeLab({id}): GraalVM {GraalVersion} installed and selected");
                Push("graalDone", new { id, ok = true, path = javaw });
            }
            catch (Exception e)
            {
                Logger.Warn($"InstallGraal({id}): {e.Message}");
                Push("graalDone", new { id, ok = false, error = e.Message });
            }
        });
        return new { ok = true };
    }

    /// <summary>Clears a GraalVM JavaPath override so the instance goes back to
    /// the bundled/auto-selected JRE.</summary>
    private object UseBundledJava(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        SaveInstanceCfg(id, new System.Text.Json.Nodes.JsonObject { ["javaPath"] = "" });
        Logger.Info($"RuntimeLab({id}): reverted to bundled Java");
        return new { ok = true };
    }
}
