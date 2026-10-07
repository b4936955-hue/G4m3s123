# Vercel setup for the Mongo account API

Use this if Render is blocked.

## 1. Import the GitHub repo

1. Go to https://vercel.com/new
2. Import `Catchallcat5382/Unbl0ck3d-Zone-Remix-`
3. Set **Root Directory** to:

```text
server/mongo-api
```

4. Leave the build command empty/default.
5. Leave the framework preset as **Other** if Vercel asks.
6. Deploy. The project includes `api/index.js` and `vercel.json`, so `/health`, `/auth/login`, and the other API paths stay at the root URL.

## 2. Add Environment Variables

Add these in Vercel project settings:

```text
MONGODB_URI=your MongoDB Atlas connection string
MONGODB_DB=unblocked_zone
JWT_SECRET=make-this-long-and-random
ALLOWED_ORIGIN=*
OWNER_USERNAMES=billy41
```

Do not put these values in GitHub.

## 3. Deploy and test

After deploy, open:

```text
https://YOUR-VERCEL-PROJECT.vercel.app/health
```

It should show:

```json
{"ok":true}
```

## 4. Point the site at Vercel

In `assets/community/config.js`, change:

```js
mongoApiUrl: window.UZ_MONGO_API_URL || 'https://zone.onrender.com',
```

to your Vercel URL:

```js
mongoApiUrl: window.UZ_MONGO_API_URL || 'https://YOUR-VERCEL-PROJECT.vercel.app',
```

Also update `unblocked zone.html` if you use the single-file loader:

```js
window.UZ_MONGO_API_URL="https://YOUR-VERCEL-PROJECT.vercel.app";
```

Then push the change.

For the single-file loader, you can test a new API without editing code by opening the site on your computer, opening storage/localStorage tools, and setting:

```js
localStorage.setItem('uzMongoApiUrl', 'https://YOUR-VERCEL-PROJECT.vercel.app')
```

Then refresh. The loader reads `uzMongoApiUrl` first.

## Endpoint tests

Try these on the school computer before switching the site:

```text
https://YOUR-VERCEL-PROJECT.vercel.app/health
https://YOUR-NETLIFY-PROJECT.netlify.app/.netlify/functions/health
https://YOUR-DENO-PROJECT.deno.dev/health
https://YOUR-CLOUDFLARE-WORKER.workers.dev/health
```

If `/health` does not load on that computer, that host is blocked there and the account system will not work from that host.
