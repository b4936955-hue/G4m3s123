# Pushes ONLY assets/audio (all subfolders) to GitHub in small batches.
# Put this file + push-audio.bat in your G4m3s123 folder and double-click the .bat.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

$Remote   = 'origin'
$Branch   = 'master'
$AudioDir = 'assets/audio'
$BatchMB  = 150      # max size of each push
$MaxFileMB = 95      # GitHub rejects files over 100 MB
$Retries  = 4

git config http.postBuffer 524288000 | Out-Null
git config core.quotepath false | Out-Null

# Undo the earlier giant failed commit (keeps every file on disk, just un-commits it)
git fetch $Remote 2>$null | Out-Null
git rev-parse --verify "$Remote/$Branch" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { git reset -q "$Remote/$Branch" }
else { git update-ref -d "refs/heads/$Branch" 2>$null; git rm -r -q --cached . 2>$null | Out-Null }

if (-not (Test-Path $AudioDir)) { Write-Host "Cannot find $AudioDir" -ForegroundColor Red; exit 1 }

$root  = (Get-Location).Path
$files = Get-ChildItem -Path $AudioDir -Recurse -File | Sort-Object FullName
$ok = @(); $big = @()
foreach ($f in $files) { if ($f.Length -gt $MaxFileMB * 1MB) { $big += $f } else { $ok += $f } }

Write-Host ("Found {0} files ({1} too big to push)" -f $files.Count, $big.Count) -ForegroundColor Cyan
foreach ($b in $big) { Write-Host ("  SKIPPED over {0} MB: {1}" -f $MaxFileMB, $b.FullName.Substring($root.Length+1)) -ForegroundColor Yellow }

# Build batches
$batches = @(); $cur = @(); $size = 0
foreach ($f in $ok) {
  if ($cur.Count -gt 0 -and ($size + $f.Length) -gt $BatchMB * 1MB) { $batches += ,$cur; $cur = @(); $size = 0 }
  $cur += $f; $size += $f.Length
}
if ($cur.Count -gt 0) { $batches += ,$cur }

$n = 0; $failed = 0
foreach ($batch in $batches) {
  $n++
  # skip files already tracked
  $paths = @()
  foreach ($f in $batch) { $paths += $f.FullName.Substring($root.Length+1).Replace('\','/') }
  $listFile = Join-Path $env:TEMP 'audio-batch.txt'
  [IO.File]::WriteAllLines($listFile, $paths, (New-Object Text.UTF8Encoding $false))
  git add --pathspec-from-file="$listFile" 2>&1 | Out-Null
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Write-Host "Batch $n/$($batches.Count): nothing new, skipping"; continue }
  git commit -q -m "audio batch $n"
  $pushed = $false
  for ($i = 1; $i -le $Retries -and -not $pushed; $i++) {
    Write-Host "Batch $n/$($batches.Count): pushing $($batch.Count) files (try $i)..." -ForegroundColor Cyan
    git push -u $Remote $Branch
    if ($LASTEXITCODE -eq 0) { $pushed = $true } else { Start-Sleep -Seconds (5 * $i) }
  }
  if (-not $pushed) {
    Write-Host "Batch $n failed. Stopping so nothing is lost. Run the script again to continue." -ForegroundColor Red
    $failed = 1; break
  }
}
if ($failed -eq 0) { Write-Host "`nDone! All audio pushed." -ForegroundColor Green }
