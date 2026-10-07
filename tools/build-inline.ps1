$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'assets\index.html'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$config = [System.IO.File]::ReadAllText((Join-Path $root 'assets\community\config.js'), $utf8)
$community = [System.IO.File]::ReadAllText((Join-Path $root 'assets\community\community.js'), $utf8)
$auth = [System.IO.File]::ReadAllText((Join-Path $root 'assets\community\auth-gate.js'), $utf8)
$html = [System.IO.File]::ReadAllText($htmlPath, $utf8)
$bundle = @"
  <script>window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || []; window.UZ_ACCOUNT_DEBUG.push('inline-account-bundle-start');</script>
  <script data-inline="community/config.js">
$config
  </script>
  <script data-inline="community/community.js">
$community
  </script>
  <script data-inline="community/auth-gate.js">
$auth
  </script>
"@
$startMarker = "  <script>window.UZ_ACCOUNT_DEBUG = window.UZ_ACCOUNT_DEBUG || []; window.UZ_ACCOUNT_DEBUG.push('inline-account-bundle-start');</script>"
$start = $html.IndexOf($startMarker, [System.StringComparison]::Ordinal)
$authStart = $html.IndexOf('  <script data-inline="community/auth-gate.js">', $start, [System.StringComparison]::Ordinal)
$end = if ($authStart -ge 0) { $html.IndexOf('</script>', $authStart, [System.StringComparison]::Ordinal) } else { -1 }
if ($start -lt 0 -or $authStart -lt 0 -or $end -lt 0) { throw 'Inline bundle markers not found in assets/index.html' }
$end += '</script>'.Length
$newHtml = $html.Substring(0, $start) + $bundle.TrimEnd("`r", "`n") + $html.Substring($end)
$normalizedLines = $newHtml -split "`r?`n" | ForEach-Object { $_.TrimEnd() }
while ($normalizedLines.Count -gt 0 -and $normalizedLines[-1] -eq '') {
  if ($normalizedLines.Count -eq 1) { $normalizedLines = @(); break }
  $normalizedLines = @($normalizedLines[0..($normalizedLines.Count - 2)])
}
[System.IO.File]::WriteAllLines($htmlPath, $normalizedLines, $utf8)
Write-Host "Inline bundle rebuilt: $htmlPath"
