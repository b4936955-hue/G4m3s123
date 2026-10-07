# Netlify Search UI Package

This ZIP is designed to be handed directly to Codex or copied into a Git repo.

## Contents

- `public/` — the site Netlify publishes
- `netlify/functions/health.js` — tiny health/status function
- `netlify.toml` — Netlify configuration
- `package.json` — optional Netlify CLI commands
- `CODEX_TASK.md` — instructions for Codex
- `.gitignore`

## Manual Netlify deployment

If you are not using Codex:

1. Put this folder into a GitHub repository.
2. In Netlify choose **Add new site → Import an existing project**.
3. Select the repository.
4. Netlify should read `netlify.toml` automatically.
5. Publish directory: `public`
6. Functions directory: `netlify/functions`
7. Deploy.

For a static-only drag-and-drop deployment, you can upload the `public` folder,
but the `/health` Netlify Function will not be included that way.

## Local editing

Edit:

- `public/index.html`
- `public/styles.css`
- `public/config.js`
- `public/app.js`

This package does not contain a public proxy or security-bypass backend.

## Connect this to Unbl0cked Zone

After Netlify gives you the production URL, open Unbl0cked Zone once and run this in the browser console:

```js
localStorage.setItem("uselessGamzWebUrl", "https://YOUR-SITE.netlify.app/");
```

Then the wrench-tab **UselessGamz Web** button will open that URL.

Recommended Netlify import settings if this folder is inside the main repo:

- Base directory: `uselessgamz-web`
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Build command: leave blank

This is a normal search/URL launcher frontend. It is not a proxy or network bypass service.

## No Netlify credits fallback

The wrench-tab button in Unbl0cked Zone now opens the static raw.githack URL by default:

`https://raw.githack.com/Catchallcat5382/Unbl0ck3d-Zone-Remix-/master/uselessgamz-web/public/index.html`

That means Netlify is optional. Netlify only adds the `/health` function.