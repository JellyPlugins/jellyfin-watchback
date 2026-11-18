$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$docsRoot = Join-Path $repoRoot 'docs'
$cssTarget = Join-Path $docsRoot 'css'
$jsTarget = Join-Path $docsRoot 'js'
$i18nTarget = Join-Path $docsRoot 'i18n'

$generatedTargets = @($cssTarget, $jsTarget, $i18nTarget)
foreach ($target in $generatedTargets) {
    if (Test-Path $target) {
        Remove-Item $target -Recurse -Force
    }

    New-Item -ItemType Directory -Path $target -Force | Out-Null
}

Copy-Item (Join-Path $repoRoot 'Jellyfin.Plugin.Watchback\PluginPages\css\*.css') $cssTarget -Force
Copy-Item (Join-Path $repoRoot 'Jellyfin.Plugin.Watchback\PluginPages\js\*.js') $jsTarget -Force
Copy-Item (Join-Path $repoRoot 'Jellyfin.Plugin.Watchback\i18n\*.json') $i18nTarget -Force

# Copy demo-only mock data (not part of plugin source, lives in docs/mock/)
Copy-Item (Join-Path $docsRoot 'mock\mock-data.js') $jsTarget -Force

# Copy the user-page scripts the plugin serves in production
# (/Watchback/Client/script). The demo's discovery view loads the real
# files so the preview always matches the shipped behavior.
Copy-Item (Join-Path $repoRoot 'Jellyfin.Plugin.Watchback\js\native-tabs.js') $jsTarget -Force
Copy-Item (Join-Path $repoRoot 'Jellyfin.Plugin.Watchback\js\yearly-rewind.js') $jsTarget -Force

# Content versions prevent cached scripts from an earlier demo layout being mixed
# with a new index.html (for example, after removing the settings navigation).
$indexPath = Join-Path $docsRoot 'index.html'
$demoHtml = Get-Content -Path $indexPath -Raw
$demoHtml = [regex]::Replace($demoHtml, '(src|href)="((?:js|css)/[^"?]+)(?:\?[^"]*)?"', {
    param($asset)
    $assetPath = Join-Path $docsRoot $asset.Groups[2].Value
    $version = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0, 12)
    return '{0}="{1}?v={2}"' -f $asset.Groups[1].Value, $asset.Groups[2].Value, $version
})
Set-Content -Path $indexPath -Value $demoHtml -NoNewline -Encoding utf8

$noJekyllPath = Join-Path $docsRoot '.nojekyll'
Set-Content -Path $noJekyllPath -Value '' -NoNewline

# Remove docs/.gitignore so the deploy action does NOT skip generated css/js/i18n folders
$docsGitignore = Join-Path $docsRoot '.gitignore'
if (Test-Path $docsGitignore) {
    Remove-Item $docsGitignore -Force
    Write-Host "Removed $docsGitignore (would hide generated assets from deploy)"
}

Write-Host 'Demo site prepared:'
Get-ChildItem -Path $docsRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object { Write-Host $_.FullName.Substring($repoRoot.Path.Length + 1) }