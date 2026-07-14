using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json.Nodes;

namespace VSpeedLauncher.Core;

/// <summary>
/// Minimal Discord Rich Presence client over the local Discord IPC named pipe
/// (<c>\\.\pipe\discord-ipc-0</c>) — no third-party packages.
///
/// <para>Requires a Discord <b>Application (client) ID</b> from
/// discord.com/developers (set in Settings). Without it, presence stays off.
/// The Discord desktop app must be running.</para>
/// </summary>
public sealed class DiscordRpc : IDisposable
{
    private NamedPipeClientStream? _pipe;
    private string? _clientId;
    private bool _connected;
    private readonly object _lock = new();
    private long _startEpoch;

    public bool Connected => _connected;

    /// <summary>Public Rich Presence application (client) ID, embedded so presence
    /// works for everyone with no setup. Discord app IDs are NOT secret — they're
    /// visible in the presence itself — so shipping it in source is fine.</summary>
    public const string EmbeddedClientId = "1511714297384927313";

    /// <summary>Connects and performs the IPC handshake for the given client ID.
    /// Safe to call repeatedly; reconnects only if the client ID changed.</summary>
    public bool Connect(string clientId)
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(clientId)) return false;
            if (_connected && _clientId == clientId) return true;

            Cleanup();
            _clientId = clientId;
            try
            {
                // Discord listens on discord-ipc-0 .. discord-ipc-9
                for (int i = 0; i < 10; i++)
                {
                    try
                    {
                        var pipe = new NamedPipeClientStream(".", $"discord-ipc-{i}", PipeDirection.InOut, PipeOptions.Asynchronous);
                        pipe.Connect(500);
                        _pipe = pipe;
                        break;
                    }
                    catch { /* try next */ }
                }
                if (_pipe == null) return false;

                // Opcode 0 = Handshake
                var handshake = new JsonObject { ["v"] = 1, ["client_id"] = clientId };
                Write(0, handshake.ToJsonString());
                ReadFrame();   // READY dispatch
                _connected = true;
                _startEpoch = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                Logger.Info("Discord RPC connected.");
                return true;
            }
            catch (Exception e)
            {
                Logger.Info($"Discord RPC unavailable: {e.Message}");
                Cleanup();
                return false;
            }
        }
    }

    /// <summary>Sets the presence (details + state lines + elapsed timer).</summary>
    public void SetPresence(string details, string state, bool withTimer = true)
    {
        lock (_lock)
        {
            if (!_connected || _pipe == null) return;
            try
            {
                var activity = new JsonObject
                {
                    ["details"] = Trunc(details, 128),
                    ["state"]   = Trunc(state, 128),
                    ["assets"]  = new JsonObject { ["large_image"] = "cryo", ["large_text"] = "Kelvin" },
                };
                if (withTimer)
                    activity["timestamps"] = new JsonObject { ["start"] = _startEpoch };

                var frame = new JsonObject
                {
                    ["cmd"] = "SET_ACTIVITY",
                    ["args"] = new JsonObject
                    {
                        ["pid"]      = Environment.ProcessId,
                        ["activity"] = activity,
                    },
                    ["nonce"] = Guid.NewGuid().ToString(),
                };
                Write(1, frame.ToJsonString());   // Opcode 1 = Frame
                ReadFrame();                       // consume the response
            }
            catch (Exception e)
            {
                Logger.Info($"Discord RPC set failed: {e.Message}");
                _connected = false;
            }
        }
    }

    /// <summary>Clears the presence and closes the connection.</summary>
    public void Clear()
    {
        lock (_lock) { Cleanup(); }
    }

    private void Cleanup()
    {
        try { _pipe?.Dispose(); } catch { }
        _pipe = null;
        _connected = false;
    }

    public void Dispose() => Clear();

    // ── IPC frame I/O: [int32 opcode][int32 length][utf8 json] (little-endian) ──

    private void Write(int opcode, string json)
    {
        if (_pipe == null) return;
        var payload = Encoding.UTF8.GetBytes(json);
        var header  = new byte[8];
        BitConverter.GetBytes(opcode).CopyTo(header, 0);
        BitConverter.GetBytes(payload.Length).CopyTo(header, 4);
        _pipe.Write(header, 0, 8);
        _pipe.Write(payload, 0, payload.Length);
        _pipe.Flush();
    }

    private void ReadFrame()
    {
        if (_pipe == null) return;
        var header = new byte[8];
        int read = _pipe.Read(header, 0, 8);
        if (read < 8) return;
        int len = BitConverter.ToInt32(header, 4);
        if (len <= 0 || len > 1 << 20) return;
        var buf = new byte[len];
        int off = 0;
        while (off < len) { int r = _pipe.Read(buf, off, len - off); if (r <= 0) break; off += r; }
    }

    private static string Trunc(string s, int n) => string.IsNullOrEmpty(s) ? "" : (s.Length <= n ? s : s[..n]);
}
