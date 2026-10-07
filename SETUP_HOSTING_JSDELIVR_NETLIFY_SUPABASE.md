# Unbl0cked Zone hosting/CDN/community setup

## 1. GitHub
Your repo is already pushed here:
https://github.com/Catchallcat5382/Unbl0ck3d-Zone-Remix-

Keep using `push.bat` after edits. The first push was huge. Future pushes should be much faster.

## 2. jsDelivr
You do not create a jsDelivr account. It serves public GitHub files automatically.

Use these URL shapes:

- Main CDN host:
  https://cdn.jsdelivr.net/gh/Catchallcat5382/Unbl0ck3d-Zone-Remix-@master/assets/index.html

- Same style as the original site, using the quantil mirror:
  https://quantil.jsdelivr.net/gh/Catchallcat5382/Unbl0ck3d-Zone-Remix-@master/assets/index.html

- For always-latest asset URLs:
  https://quantil.jsdelivr.net/gh/Catchallcat5382/Unbl0ck3d-Zone-Remix-@latest/assets/data.json

If a file is stale after pushing, purge it here:
https://www.jsdelivr.com/tools/purge

## 3. Netlify
1. Go to https://app.netlify.com/
2. Log in with GitHub.
3. Add new project > Import from Git.
4. Choose `Catchallcat5382/Unbl0ck3d-Zone-Remix-`.
5. Use:
   - Branch: `master`
   - Base directory: empty
   - Build command: empty
   - Publish directory: `assets`
6. Deploy.

Send Codex the final Netlify URL. Then update public links to use your Netlify site where pages should be hosted.

## 4. Supabase live chat/posts/roles
1. Go to https://supabase.com/ and create a free project.
2. Open SQL Editor.
3. Paste and run `assets/community/supabase-schema.sql`.
4. Go to Project Settings > API.
5. Copy:
   - Project URL
   - anon public key
6. Paste them into `assets/community/config.js`.
7. Push to GitHub.
8. Netlify redeploys automatically.
9. Open the site, Community tab, sign up.
10. In Supabase SQL Editor, run the owner update from the bottom of `supabase-schema.sql` with your email.

Never paste the Supabase service role key into frontend files. Only the anon public key goes in `config.js`.

## What to send Codex after setup
Send:
- Netlify site URL
- Supabase Project URL
- Supabase anon public key
- The email you signed up with, if you want Codex to give you the exact SQL to make that user owner

Do not send the service role secret key.