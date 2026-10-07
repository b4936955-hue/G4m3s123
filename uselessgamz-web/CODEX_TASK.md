# CODEX TASK — Add this frontend and deploy it to Netlify

You are being given a folder named `netlify-search-codex-package`.

## Goal

Integrate the included Netlify-ready static search UI into the user's repository
and deploy it to Netlify.

This package intentionally contains only the hosted frontend and a harmless
Netlify health function. Do not add a public network-restriction bypass, open
proxy, credential interceptor, or code that disables security software.

## Files supplied

- `public/index.html`
- `public/styles.css`
- `public/config.js`
- `public/app.js`
- `netlify/functions/health.js`
- `netlify.toml`
- `package.json`
- `.gitignore`

## What to do

1. Inspect the user's existing repository before overwriting files.
2. Preserve existing user content whenever possible.
3. If this is a new site, copy the supplied structure into the repository root.
4. If an existing frontend already exists:
   - merge the visual/search UI instead of blindly replacing unrelated pages;
   - keep the Netlify function and Netlify config compatible with the repo.
5. Verify `netlify.toml` points to the correct publish folder.
6. Test locally if the environment permits.
7. Commit the changes with a clear commit message.
8. If Netlify access is available:
   - create or link a Netlify site;
   - connect the repository;
   - set the production branch to the repository's main branch;
   - deploy;
   - report the resulting Netlify URL.
9. If Netlify access is NOT available:
   - stop after preparing the repo;
   - give the user the exact minimal UI steps needed to connect/import the repo
     in Netlify.

## Expected behavior after deployment

- `/` displays the search UI.
- Normal search terms go to the selected public search engine.
- Normal URLs open directly.
- `/.netlify/functions/health` returns JSON similar to:
  `{ "ok": true, "service": "netlify-search-ui", ... }`
- `/health` routes to that health function.

## Important

Do not claim deployment succeeded unless Netlify actually returned a successful
deployment/site URL.
