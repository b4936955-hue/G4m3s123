# MongoDB API setup for Unblocked Zone

MongoDB cannot be safely used directly from `unblocked zone.html` because the browser would expose your Mongo username/password to everyone. Use this small API instead.

## Setup

1. Create a free MongoDB Atlas cluster.
2. Create a database user and copy the connection string.
3. Deploy this folder (`server/mongo-api`) to a free Node host that works on your network, such as Render, Railway free alternatives when available, Fly.io free allowance, or your own computer for testing.
4. Set environment variables from `.env.example`:
   - `MONGODB_URI`
   - `MONGODB_DB=unblocked_zone`
   - `JWT_SECRET` to a long random string
   - `ALLOWED_ORIGIN` to your site URL, or `*` while testing
5. Install/run locally:

```bash
npm install
npm start
```

6. Frontend integration path:
   - Add your API URL to `assets/community/config.js`, for example `mongoApiUrl: "https://your-api.example.com"`.
   - The static site should call this API for auth, members, messages, posts, moderation, and audit if Supabase is blocked.

This backend stores password hashes only. It never stores or returns plaintext passwords.
