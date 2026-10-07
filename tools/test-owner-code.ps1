$configPath = 'F:\Unbl0cked Zone\assets\community\config.js'
$config = Get-Content -LiteralPath $configPath -Raw
$expected = [regex]::Match($config, "ownerBypassHash:\s*'([^']+)'").Groups[1].Value
$secure = Read-Host 'Enter raw 32-character owner code' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
if ($code.Length -ne 32) { throw "Code length is $($code.Length), expected 32." }
$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($code)
$actual = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
"Expected: $expected"
"Actual:   $actual"
if ($actual -eq $expected) { 'MATCH: this raw code should unlock after deploy/cache refresh.' } else { 'NO MATCH: config.js was generated from a different raw code.' }