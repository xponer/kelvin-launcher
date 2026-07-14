using Velopack;
using Velopack.Sources;

namespace VSpeedLauncher.Core;

/// <summary>
/// Wraps Velopack's <see cref="UpdateManager"/> to check, download, and apply
/// launcher updates published as GitHub Releases.
///
/// <para>Updates only work when the app is actually installed via the Velopack
/// Setup.exe — when run from a raw build output, <see cref="IsInstalled"/> is
/// false and checks are skipped.</para>
/// </summary>
public sealed class UpdateService
{
    // GitHub repo that hosts the releases (Setup.exe + delta packages).
    private const string RepoUrl = "https://github.com/xponer/kelvin-launcher";

    private readonly UpdateManager _mgr;
    private UpdateInfo? _pending;

    public UpdateService()
    {
        _mgr = new UpdateManager(new GithubSource(RepoUrl, null, false));
    }

    /// <summary>True only when launched from a Velopack install (not a dev build).</summary>
    public bool IsInstalled => _mgr.IsInstalled;

    /// <summary>The running version, or the assembly version when not installed.</summary>
    public string CurrentVersion =>
        _mgr.CurrentVersion?.ToString()
        ?? typeof(UpdateService).Assembly.GetName().Version?.ToString(3)
        ?? "1.0.0";

    /// <summary>Returns the new version string if an update is available, else null.</summary>
    public async Task<string?> CheckAsync()
    {
        if (!_mgr.IsInstalled) return null;
        _pending = await _mgr.CheckForUpdatesAsync();
        return _pending?.TargetFullRelease?.Version?.ToString();
    }

    /// <summary>Downloads the pending update (call <see cref="CheckAsync"/> first).</summary>
    public async Task DownloadAsync(Action<int>? onProgress = null)
    {
        if (_pending == null) return;
        await _mgr.DownloadUpdatesAsync(_pending, onProgress);
    }

    /// <summary>Applies the downloaded update and restarts into the new version.</summary>
    public void ApplyAndRestart()
    {
        if (_pending == null) return;
        _mgr.ApplyUpdatesAndRestart(_pending);
    }
}
