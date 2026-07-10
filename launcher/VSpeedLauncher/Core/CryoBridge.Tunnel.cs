using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace VSpeedLauncher.Core;

/// <summary>
/// "Make public" for hosted servers — a playit.gg tunnel so friends can join a
/// Cryo-hosted server from anywhere with zero router/port-forwarding setup.
///
/// Uses the open-source playit agent (pinned v0.15.26, single exe) downloaded
/// into <c>%LocalAppData%\VSpeedLauncher\playit\</c>, exactly like the Turbo
/// runtime is provisioned. One-time setup: the CLI generates a claim code, the
/// user approves it on playit.gg in the browser (free account), and the agent
/// secret comes back via <c>claim exchange</c>. The secret is an account
/// credential → stored DPAPI-encrypted (CurrentUser), never logged, never sent
/// to the UI (hard rule #2).
///
/// Per session: <c>tunnels prepare</c> ensures a Minecraft-Java TCP tunnel
/// exists, <c>tunnels list</c> yields its public address, and the agent runs
/// with an explicit mapping "&lt;tunnel-id&gt;=&lt;local-port&gt;" so it always
/// points at the hosted server's actual port. Events: <c>tunnelEvent</c>
/// (installing / claim / claimed / preparing / online / stopped / error).
/// </summary>
public sealed partial class CryoBridge
{
    private const string PlayitVersion = "0.15.26";
    private const string PlayitUrl =
        "https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-windows-x86_64-signed.exe";

    private static string PlayitDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "playit");
    private static string PlayitExe        => Path.Combine(PlayitDir, "playit.exe");
    private static string PlayitSecretFile => Path.Combine(PlayitDir, "secret.bin");
    private static string PlayitLogFile    => Path.Combine(PlayitDir, "agent.log");

    private static readonly Regex _ansi = new(@"\x1B\[[0-9;]*[A-Za-z]|\x1B.", RegexOptions.Compiled);

    private readonly object _tunnelLock = new();
    private Process? _tunnelProc;
    private string   _tunnelForId    = "";
    private string   _tunnelAddress  = "";
    private string   _tunnelStatus   = "off";   // off|installing|claim|preparing|online|error
    private string   _tunnelClaimUrl = "";
    private string   _tunnelError    = "";
    private CancellationTokenSource? _tunnelCts;

    // ── Secret at rest (DPAPI, CurrentUser — same scheme as accounts.bin) ────
    private static string? LoadPlayitSecret()
    {
        try
        {
            if (!File.Exists(PlayitSecretFile)) return null;
            var raw = ProtectedData.Unprotect(File.ReadAllBytes(PlayitSecretFile), null, DataProtectionScope.CurrentUser);
            var s = Encoding.UTF8.GetString(raw).Trim();
            return s.Length > 0 ? s : null;
        }
        catch (Exception e) { Logger.Warn($"Tunnel: secret unreadable ({e.Message}) — re-claim needed"); return null; }
    }

    private static void SavePlayitSecret(string secret)
    {
        Directory.CreateDirectory(PlayitDir);
        File.WriteAllBytes(PlayitSecretFile,
            ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), null, DataProtectionScope.CurrentUser));
    }

    /// <summary>
    /// The playit CLI needs the secret in plaintext. A command-line argument is
    /// visible to every process on the machine, so instead the secret is written
    /// to a short-lived file (passed via --secret_path) and deleted right after
    /// the CLI has read it. The DPAPI blob stays the source of truth.
    /// </summary>
    private static async Task<T> WithSecretFileAsync<T>(string secret, Func<string, Task<T>> useAsync)
    {
        var tmp = Path.Combine(PlayitDir, "secret.tmp");
        await File.WriteAllTextAsync(tmp, secret);
        try { return await useAsync(tmp); }
        finally { try { File.Delete(tmp); } catch { /* best effort */ } }
    }

    // ── playit REST API (api.playit.gg, agent-key auth) ─────────────────────
    // The pinned CLI's `tunnels prepare` predates an API change (typed tunnels
    // now REQUIRE a `description` field → "TunnelTypeRequiresDescription", seen
    // live) — so tunnel create/list go straight to the API. Request shapes are
    // taken from the agent's own api_client source at tag v0.15.26.
    private static readonly HttpClient _playitHttp = new() { Timeout = TimeSpan.FromSeconds(30) };

    private static async Task<System.Text.Json.Nodes.JsonNode?> PlayitApiAsync(
        string secret, string path, string bodyJson, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.playit.gg" + path);
        req.Headers.TryAddWithoutValidation("Authorization", "agent-key " + secret);
        req.Content = new StringContent(bodyJson, Encoding.UTF8, "application/json");
        using var resp = await _playitHttp.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        var node = System.Text.Json.Nodes.JsonNode.Parse(text);
        var status = node?["status"]?.GetValue<string>() ?? "";
        if (status != "success")
            throw new Exception($"playit API {path}: " + (node?["data"]?.ToJsonString() ?? text));
        return node?["data"];
    }

    /// <summary>Runs the playit CLI once, returns ANSI-stripped stdout+stderr.</summary>
    private static async Task<string> PlayitCliAsync(string args, int timeoutMs, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName               = PlayitExe,
            Arguments              = args,
            UseShellExecute        = false,
            CreateNoWindow         = true,
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception("Couldn't start the playit agent.");
        var so = p.StandardOutput.ReadToEndAsync(ct);
        var se = p.StandardError.ReadToEndAsync(ct);
        using var timeout = new CancellationTokenSource(timeoutMs);
        using var linked  = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
        try { await p.WaitForExitAsync(linked.Token); }
        catch (OperationCanceledException) { try { p.Kill(entireProcessTree: true); } catch { } throw; }
        return _ansi.Replace(await so + "\n" + await se, "");
    }

    private object GetTunnel(string id)
    {
        lock (_tunnelLock)
        {
            bool runningForThis = _tunnelProc is { HasExited: false } && _tunnelForId == id;
            return new
            {
                ok = true,
                agentInstalled = File.Exists(PlayitExe),
                claimed        = File.Exists(PlayitSecretFile),
                running        = runningForThis,
                busyWith       = _tunnelProc is { HasExited: false } && _tunnelForId != id ? _tunnelForId : "",
                status         = runningForThis || _tunnelStatus is "installing" or "claim" or "preparing" ? _tunnelStatus : "off",
                address        = runningForThis ? _tunnelAddress : "",
                claimUrl       = _tunnelStatus == "claim" ? _tunnelClaimUrl : "",
                error          = _tunnelError,
            };
        }
    }

    private object StopTunnel()
    {
        lock (_tunnelLock)
        {
            _tunnelCts?.Cancel();
            try { if (_tunnelProc is { HasExited: false }) _tunnelProc.Kill(entireProcessTree: true); }
            catch (Exception e) { Logger.Warn($"Tunnel stop: {e.Message}"); }
            _tunnelProc = null; _tunnelStatus = "off"; _tunnelAddress = ""; _tunnelClaimUrl = ""; _tunnelError = "";
        }
        Push("tunnelEvent", new { phase = "stopped" });
        Logger.Info("Tunnel: stopped");
        return new { ok = true };
    }

    /// <summary>Forget the playit account link (secret) — next start re-claims.</summary>
    private object ResetTunnel()
    {
        StopTunnel();
        try { File.Delete(PlayitSecretFile); } catch { /* absent is fine */ }
        Logger.Info("Tunnel: account link reset");
        return new { ok = true };
    }

    private object StartTunnel(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        lock (_tunnelLock)
        {
            if (_tunnelProc is { HasExited: false } || _tunnelStatus is "installing" or "claim" or "preparing")
                return new { ok = false, error = _tunnelForId == id
                    ? "The tunnel is already starting/running."
                    : $"The tunnel is in use by \"{_tunnelForId}\" — stop it there first (one public address at a time)." };
            _tunnelForId = id; _tunnelStatus = "installing"; _tunnelError = ""; _tunnelAddress = "";
            _tunnelCts = new CancellationTokenSource();
        }
        _ = Task.Run(() => RunTunnelAsync(id, _tunnelCts.Token));
        return new { ok = true };
    }

    private async Task RunTunnelAsync(string id, CancellationToken ct)
    {
        void Ev(object payload) => Push("tunnelEvent", payload);
        void SetStatus(string s) { lock (_tunnelLock) _tunnelStatus = s; }
        try
        {
            // ── 1) Provision the agent exe (once) ───────────────────────────
            if (!File.Exists(PlayitExe))
            {
                Ev(new { phase = "installing", message = $"Downloading the playit agent (v{PlayitVersion}, ~4 MB, one time)…" });
                Directory.CreateDirectory(PlayitDir);
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
                var bytes = await http.GetByteArrayAsync(PlayitUrl, ct);
                if (bytes.Length < 1_000_000) throw new Exception("playit agent download looks truncated — try again.");
                await File.WriteAllBytesAsync(PlayitExe, bytes, ct);
                Logger.Info($"Tunnel: playit agent v{PlayitVersion} installed ({bytes.Length / 1024} KB)");
            }

            // ── 2) One-time account link (claim → user approves → secret) ───
            var secret = LoadPlayitSecret();
            if (secret == null)
            {
                var gen  = await PlayitCliAsync("claim generate", 30_000, ct);
                var code = Regex.Match(gen, "[0-9a-f]{8,}").Value;
                if (code.Length == 0) throw new Exception("Couldn't generate a claim code: " + gen.Trim());

                var url = $"https://playit.gg/claim/{code}";
                lock (_tunnelLock) { _tunnelStatus = "claim"; _tunnelClaimUrl = url; }
                Ev(new { phase = "claim", url,
                         message = "One-time setup: approve this launcher on playit.gg (free account). Waiting for your approval…" });

                // Blocks until the user approves in the browser (or times out).
                var ex = await PlayitCliAsync($"claim exchange {code} --wait 300", 310_000, ct);
                secret = Regex.Match(ex, "[0-9a-f]{16,}").Value;
                if (secret.Length == 0)
                    throw new Exception("The claim wasn't approved in time — click \"Make public\" again and approve the page it opens.");
                SavePlayitSecret(secret);
                Logger.Info("Tunnel: playit agent claimed (secret stored encrypted)");
                Ev(new { phase = "claimed", message = "Launcher linked to your playit.gg account." });
            }

            // ── 3) Ensure a Minecraft-Java tunnel exists (playit REST API) ──
            SetStatus("preparing");
            Ev(new { phase = "preparing", message = "Setting up the public address…" });
            int port = LoadServerMeta(id)["port"]?.GetValue<int>() ?? 25565;

            var rundata = await PlayitApiAsync(secret, "/agents/rundata", "{}", ct);
            var agentId = rundata?["agent_id"]?.GetValue<string>()
                ?? throw new Exception("playit didn't return this agent's id — try again.");

            string tunnelId = "", address = "";
            var deadline = DateTime.UtcNow.AddSeconds(90);
            bool created = false;
            while (DateTime.UtcNow < deadline)
            {
                ct.ThrowIfCancellationRequested();
                var data    = await PlayitApiAsync(secret, "/tunnels/list", "{}", ct);
                var tunnels = data?["tunnels"]?.AsArray();
                System.Text.Json.Nodes.JsonNode? hit = null;
                if (tunnels != null)
                    foreach (var t in tunnels)
                    {
                        var pt = t?["port_type"]?.GetValue<string>() ?? "";
                        if (pt is "tcp" or "both") { hit = t; break; }
                    }

                if (hit == null)
                {
                    if (!created)
                    {
                        // Field shapes from the agent's own api_client (v0.15.26)
                        // + the `description` the current API now requires with a
                        // tunnel_type. Origin "agent" pins it to this agent.
                        var body = new System.Text.Json.Nodes.JsonObject
                        {
                            ["name"]        = "cryo",
                            ["description"] = "Cryo Launcher hosted server",
                            ["tunnel_type"] = "minecraft-java",
                            ["port_type"]   = "tcp",
                            ["port_count"]  = 1,
                            ["origin"] = new System.Text.Json.Nodes.JsonObject
                            {
                                ["type"] = "agent",
                                ["data"] = new System.Text.Json.Nodes.JsonObject
                                {
                                    ["agent_id"]   = agentId,
                                    ["local_ip"]   = "127.0.0.1",
                                    ["local_port"] = port,
                                },
                            },
                            ["enabled"]     = true,
                            ["alloc"]       = null,
                            ["firewall_id"] = null,
                        };
                        await PlayitApiAsync(secret, "/tunnels/create", body.ToJsonString(), ct);
                        created = true;
                        Logger.Info("Tunnel: created a minecraft-java tunnel via the playit API");
                    }
                    await Task.Delay(3000, ct);
                    continue;
                }

                tunnelId = hit["id"]?.GetValue<string>() ?? "";
                var alloc = hit["alloc"];
                if ((alloc?["status"]?.GetValue<string>() ?? "") == "allocated")
                {
                    var ad = alloc!["data"];
                    // assigned_domain is an SRV record — Minecraft resolves the
                    // port itself, so friends paste JUST the domain. Fall back to
                    // ip:port if a plan/config has no domain.
                    address = ad?["assigned_domain"]?.GetValue<string>() ?? "";
                    if (address.Length == 0)
                    {
                        var host = ad?["ip_hostname"]?.GetValue<string>() ?? "";
                        var p0   = ad?["port_start"]?.GetValue<int>() ?? 0;
                        if (host.Length > 0 && p0 > 0) address = $"{host}:{p0}";
                    }
                    if (address.Length > 0) break;
                }
                await Task.Delay(3000, ct);   // allocation pending — poll
            }
            if (tunnelId.Length == 0 || address.Length == 0)
                throw new Exception("playit didn't finish allocating the tunnel — check playit.gg/account/tunnels, then try again.");

            // ── 4) Run the agent with an explicit mapping to the hosted
            // server's real port (deterministic even when the port isn't 25565).
            // The long-lived agent keeps its secret file for its lifetime (it
            // may re-read on reconnect); the file lives in the user-ACL'd
            // LocalAppData dir — same protection playit's own installer uses.
            var runSecretPath = Path.Combine(PlayitDir, "secret.agent");
            await File.WriteAllTextAsync(runSecretPath, secret, ct);
            var proc = Process.Start(new ProcessStartInfo
            {
                FileName        = PlayitExe,
                Arguments       = $"-l \"{PlayitLogFile}\" --secret_path \"{runSecretPath}\" run {tunnelId}={port}",
                UseShellExecute = false,
                CreateNoWindow  = true,
            }) ?? throw new Exception("Couldn't start the playit agent.");
            await Task.Delay(3000, ct);   // startup errors surface fast
            if (proc.HasExited) throw new Exception($"The playit agent exited immediately (code {proc.ExitCode}) — see {PlayitLogFile}.");

            lock (_tunnelLock) { _tunnelProc = proc; _tunnelAddress = address; _tunnelStatus = "online"; _tunnelClaimUrl = ""; }
            Logger.Info($"Tunnel: online — {address} → 127.0.0.1:{port} ('{id}')");
            Ev(new { phase = "online", address, port,
                     message = $"Server is public at {address} — friends join with that address, no port forwarding." });

            // Watch the agent; if it dies unexpectedly, tell the UI.
            await proc.WaitForExitAsync(CancellationToken.None);
            lock (_tunnelLock)
            {
                if (_tunnelProc == proc)
                {
                    _tunnelProc = null; _tunnelStatus = "off"; _tunnelAddress = "";
                    Ev(new { phase = "stopped", message = "The tunnel agent exited." });
                }
            }
        }
        catch (OperationCanceledException) { SetStatus("off"); }
        catch (Exception e)
        {
            lock (_tunnelLock) { _tunnelStatus = "error"; _tunnelError = e.Message; }
            Logger.Warn($"Tunnel({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message });
        }
    }
}
