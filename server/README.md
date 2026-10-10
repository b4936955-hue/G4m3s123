# Self-hosted site and MongoDB

This setup runs the site's HTML and assets and the Mongo account API. Connect
the Node app to an Atlas cluster you own. Docker and local MongoDB containers
are optional; they are not needed for the Windows Server deployment.

## Run on Windows without Docker (MongoDB Atlas)

1. In Atlas, add the public IP address of the computer that will run the API to
   **Network Access**, and create a database user with read/write access to the
   `unblocked_zone` database. Do not use your Atlas account password as the
   database user's password.
2. Copy the Atlas driver's connection string. In
   `server/mongo-api/.env`, set `MONGODB_URI` to that string (replace the
   `<password>` placeholder with your database user's URL-encoded password),
   `MONGODB_DB=unblocked_zone`, `JWT_SECRET` to a long random secret, and
   `ALLOWED_ORIGIN=http://localhost:8787`. Set `OWNER_USERNAMES` to the
   username you plan to register. The `.env` file is ignored by Git; never
   paste its values into chat or commit it. If that file does not exist, copy
   `server/mongo-api/.env.example` to `server/mongo-api/.env`. Do not overwrite
   an existing `.env` without saving values you still need.
3. From the repository root, start the site and API:

   ```powershell
   npm --prefix server/mongo-api start
   ```

   If the project dependencies have not been installed yet, run
   `npm --prefix server/mongo-api ci` first.
4. Open `http://localhost:8787`. The same Node server serves the HTML, assets,
   and account API. Register with the owner username configured above.

This runs only while your computer and terminal are on.

## Open the HTML file directly and use your own Mongo API

You can keep opening `unblocked zone.html` directly. The HTML file is not the
server, though: your VPS must run this project's Node API and connect it to your
Atlas cluster. The loader uses `https://g4m3s123-1.onrender.com` as the default
API URL for everyone. To use a different API, save its HTTPS address in browser
storage as described below.

For direct `file://` use, set `ALLOWED_ORIGIN=*` in the API's
`server/mongo-api/.env`; browsers send `Origin: null` for local files. This API
uses bearer tokens instead of cookies. CORS is not a security boundary; keep
the database credentials and JWT secret only on your server. To set the API
URL for your browser, open the local HTML, use the browser Console, and run:

```js
localStorage.setItem('uzMongoApiUrl', 'https://api.your-domain.example')
```

Then refresh the file.

## Publish from a Windows Server VPS (no Docker)

1. Point a domain's DNS A record at your VPS public IP. In the VPS firewall and
   Windows Defender Firewall, allow inbound TCP ports 80 and 443. Do not open
   port 8787 or MongoDB's port.
2. In Atlas, add the VPS's fixed public IP under **Network Access**. Create a
   database user with read/write access to `unblocked_zone`. Copy the Atlas
   connection string; URL-encode special characters in the database user's
   password.
3. Copy the project onto the VPS (or clone this repository there). Install the
   Node.js LTS release and verify `node --version` and `npm --version` work in
   PowerShell.
4. Create `server/mongo-api/.env` on the VPS (copy
   `server/mongo-api/.env.example` if needed). Set:

   ```dotenv
   MONGODB_URI=mongodb+srv://DATABASE_USER:URL_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB=unblocked_zone
   JWT_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
   OWNER_USERNAMES=your-chosen-username
   HOST=127.0.0.1
   PORT=8787
   ALLOWED_ORIGIN=https://your-domain.example
   ```

   Replace every example value. Keep this file private and out of Git. Set
   `OWNER_USERNAMES` to the account name you will use for the first signup.
5. From PowerShell in the project root, install and start the app:

   ```powershell
   npm --prefix server/mongo-api ci
   npm --prefix server/mongo-api start
   ```

   Leave this PowerShell window open while testing. From a second window, check
   `Invoke-RestMethod http://127.0.0.1:8787/health`; it should return `ok: true`.
   The app listens only on localhost, so public traffic must go through HTTPS.
6. Download the Windows Caddy executable from
   [Caddy's official download page](https://caddyserver.com/download). Copy
   `server/windows/Caddyfile.example` to `server/windows/Caddyfile`, edit the
   domain to your real DNS name, and run Caddy from that directory:

   ```powershell
   .\caddy.exe run --config .\Caddyfile
   ```

   Keep the Caddy window open while testing. When DNS and ports 80/443 are
   reachable, Caddy obtains and renews the HTTPS certificate. Visit
   `https://your-domain.example`; the HTML, assets, and API use the same
   server. Register the owner account you configured in step 4.
7. To run after reboot, create two Windows Task Scheduler tasks, one for the
   app and one for Caddy. Set each to **Run whether user is logged on or not**
   and trigger **At startup**. For the app, use the Node.js `node.exe` as the
   program, `server/mongo-api/server.js` as the argument, and
   `server/mongo-api` as **Start in**. For Caddy, use `caddy.exe` as the
   program, `run --config C:\FULL\PATH\TO\server\windows\Caddyfile` as the
   argument, and the `server\windows` folder as **Start in**. Enable task
   restart on failure. The task account needs read access to the project and
   `.env`; Caddy also needs write access to its certificate storage.

The database stays in Atlas; this VPS hosts the HTML and API. Do not expose
MongoDB itself to the public internet. Back up important Atlas data and keep
the API `.env` readable only by the Windows account running the app.

## Optional: local MongoDB with Docker

1. Install Docker Desktop (Windows/macOS) or Docker Engine with the Compose
   plugin (Linux).
2. Create `.env` in this directory from `.env.example` if it does not already
   exist. If it exists, do not overwrite it blindly; set the variables shown in
   the example. Replace the MongoDB username/password and JWT secret with unique
   random values. Keep the MongoDB password URL-safe (letters, numbers, `-`,
   `_`) so it works in the internal connection string. Never commit `.env`.
3. From the repository root, run:

   ```powershell
   docker compose --env-file server/.env -f server/docker-compose.yml up -d --build
   ```

4. Open `http://localhost:8787`. The site and API are served by this project;
   `/health` should return `{"ok":true}`.

The Docker Compose setup is an optional alternative for people who do want
Docker and a local MongoDB container.
