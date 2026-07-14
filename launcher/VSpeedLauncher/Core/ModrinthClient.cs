using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace VSpeedLauncher.Core;

/// <summary>
/// Thin client for the Modrinth v2 API (https://docs.modrinth.com).
/// Used to search mods, list versions, and download mod files into an instance.
/// Modrinth requires a descriptive User-Agent on every request.
/// </summary>
public sealed class ModrinthClient
{
    private const string Base = "https://api.modrinth.com/v2";

    private static readonly HttpClient _http = CreateClient();

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Kelvin-Launcher/1.0 (Minecraft modpack launcher)");
        return c;
    }

    /// <summary>Maps Cryo's loader display name to a Modrinth loader id.</summary>
    public static string LoaderId(string loader) => (loader ?? "").ToLowerInvariant() switch
    {
        "neoforge" => "neoforge",
        "forge"    => "forge",
        "fabric"   => "fabric",
        "quilt"    => "quilt",
        _          => "",
    };

    /// <summary>
    /// Searches Modrinth for mods compatible with the given MC version + loader.
    /// Returns the raw <c>hits</c> array projected to UI-friendly objects.
    /// </summary>
    public async Task<JsonNode?> SearchAsync(string query, string mcVersion, string loader, int offset, int limit, string projectType = "mod", string sort = "relevance", string category = "")
    {
        var facets = new JsonArray { new JsonArray { $"project_type:{projectType}" } };
        if (!string.IsNullOrEmpty(mcVersion))
            facets.Add(new JsonArray { $"versions:{mcVersion}" });
        // Modpacks define their own loader — only filter by loader when searching mods.
        var lid = projectType == "mod" ? LoaderId(loader) : "";
        if (!string.IsNullOrEmpty(lid))
            facets.Add(new JsonArray { $"categories:{lid}" });
        if (!string.IsNullOrWhiteSpace(category))
            facets.Add(new JsonArray { $"categories:{category}" });

        // Whitelist the sort index to the values Modrinth accepts.
        var index = sort switch { "downloads" => "downloads", "updated" => "updated", "newest" => "newest", "follows" => "follows", _ => "relevance" };
        var url = $"{Base}/search?query={Uri.EscapeDataString(query ?? "")}"
                + $"&facets={Uri.EscapeDataString(facets.ToJsonString())}"
                + $"&limit={limit}&offset={offset}&index={index}";

        using var resp = await _http.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        return JsonNode.Parse(await resp.Content.ReadAsStringAsync());
    }

    /// <summary>Fetches a single version by its id (GET /version/{id}).</summary>
    public async Task<JsonNode?> GetVersionAsync(string versionId)
    {
        using var resp = await _http.GetAsync($"{Base}/version/{Uri.EscapeDataString(versionId)}");
        resp.EnsureSuccessStatusCode();
        return JsonNode.Parse(await resp.Content.ReadAsStringAsync());
    }

    /// <summary>Lists published versions of a project filtered by MC version + loader.</summary>
    public async Task<JsonNode?> GetVersionsAsync(string projectId, string mcVersion, string loader)
    {
        var lid = LoaderId(loader);
        var url = $"{Base}/project/{Uri.EscapeDataString(projectId)}/version";
        var qp = new List<string>();
        if (!string.IsNullOrEmpty(mcVersion))
            qp.Add("game_versions=" + Uri.EscapeDataString($"[\"{mcVersion}\"]"));
        if (!string.IsNullOrEmpty(lid))
            qp.Add("loaders=" + Uri.EscapeDataString($"[\"{lid}\"]"));
        if (qp.Count > 0) url += "?" + string.Join("&", qp);

        using var resp = await _http.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        return JsonNode.Parse(await resp.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Bulk "is there a newer version?" check. Given SHA-512 hashes of installed jars,
    /// returns a map of <c>hash → latest matching version</c> (Modrinth
    /// <c>POST /version_files/update</c>). Only hashes Modrinth recognizes are returned.
    /// </summary>
    public async Task<JsonNode?> CheckUpdatesAsync(IEnumerable<string> sha512Hashes, string mcVersion, string loader)
    {
        var hashArr = new JsonArray();
        foreach (var h in sha512Hashes) hashArr.Add(h);

        var body = new JsonObject
        {
            ["hashes"]    = hashArr,
            ["algorithm"] = "sha512",
        };
        var lid = LoaderId(loader);
        if (!string.IsNullOrEmpty(lid))       body["loaders"]       = new JsonArray { lid };
        if (!string.IsNullOrEmpty(mcVersion)) body["game_versions"] = new JsonArray { mcVersion };

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{Base}/version_files/update");
        req.Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json");
        using var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        return JsonNode.Parse(await resp.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// Downloads a mod file to <paramref name="modsDir"/>, verifying SHA-512 if provided.
    /// Returns the written file path.
    /// </summary>
    public async Task<string> DownloadFileAsync(string url, string filename, string? expectedSha512,
                                                string modsDir, CancellationToken ct = default)
    {
        Directory.CreateDirectory(modsDir);
        // Sanitize filename — only the leaf, no directory traversal.
        filename = Path.GetFileName(filename);
        var dest = Path.Combine(modsDir, filename);

        var bytes = await _http.GetByteArrayAsync(url, ct);

        if (!string.IsNullOrEmpty(expectedSha512))
        {
            var actual = Convert.ToHexString(SHA512.HashData(bytes)).ToLowerInvariant();
            if (!string.Equals(actual, expectedSha512, StringComparison.OrdinalIgnoreCase))
                throw new Exception($"SHA-512 mismatch for {filename} (file may be corrupt or tampered).");
        }

        await File.WriteAllBytesAsync(dest, bytes, ct);
        return dest;
    }
}
