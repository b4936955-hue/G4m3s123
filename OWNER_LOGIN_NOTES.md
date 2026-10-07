# Unbl0cked Zone Login Notes

## Normal account flow
1. On the login screen, use **Sign in** if the account already exists.
2. Use **Create account** to make a new site-only account.
3. Usernames are converted internally into `username@uzlogin.net` because Supabase Auth requires an email-shaped ID.
4. Passwords are handled by Supabase Auth. They are not readable in the site code or admin UI.

## Owner unlock flow
- The public site does not explain the owner shortcut.
- Use the private key sequence on the login screen to open the owner-code modal.
- The owner unlock lasts only in the current browser tab because it uses `sessionStorage`.
- Closing the tab clears the temporary unlock.

## 32-character owner code setup
Do not paste the raw 32-character code into public files. Put its SHA-256 hash in `assets/community/config.js` as `ownerBypassHash`.

PowerShell hash command for Windows PowerShell:

```powershell
$code = 'YOUR_32_CHARACTER_RAW_CODE_HERE'
if ($code.Length -ne 32) { throw "Code must be exactly 32 characters before hashing." }
$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($code)
$hash = $sha.ComputeHash($bytes)
-join ($hash | ForEach-Object { $_.ToString('x2') })
```

Do not set `$code` to the existing 64-character hash. Set `$code` to the 32-character secret you want to type into the owner unlock box.

Paste the 64-character output here:

```js
ownerBypassHash: 'PASTE_HASH_HERE',
```

If the owner modal says `Wrong code`, the hash in config does not match the exact 32 characters typed into the modal.

## Common mistake
If the modal says Wrong code, do not type the 64-character ownerBypassHash value into the website. Type the original 32-character raw code you used to generate that hash. If you lost the raw code, choose a new 32-character code, generate a new hash, paste that hash into config.js, then push again.

## Test a code against local config
Run this in PowerShell from anywhere. It asks for the raw code privately, hashes it, and compares it to `assets/community/config.js`.

```powershell
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
```