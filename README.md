# luvenn

A script publishing platform in the spirit of Luarmor: register, publish a script, and get back a single loader link. Every script is run through multiple layers of obfuscation on our own servers before it's ever served — no third-party APIs involved. Plain accounts only, no admin roles.

Built with **Node.js + Express**, **EJS** templates, and **Neon (Postgres)** for the database.

---

## Features

- **Accounts** — register/login, bcrypt-hashed passwords (12 rounds), sessions stored in Postgres (not memory, so they survive restarts/redeploys). No roles, no admin panel — every account works the same way.
- **Real obfuscation, built in-house** (`lib/obfuscate.js`) — on every publish/edit:
  1. A hand-rolled Lua tokenizer strips comments and minifies whitespace, correctly aware of short strings, long strings (`[[ ]]` / `[=[ ]=]`), and both comment styles.
  2. Every string literal is re-encoded as a `string.char(...)` byte reconstruction — no literal text ships in the output.
  3. The entire result is XOR-encrypted with a random per-script key and base64-encoded.
  4. A small bootstrap loader — with fresh, randomized variable names on every publish/edit — decodes and runs it via `loadstring()`.
  Verified against a real Lua interpreter during development — see the "Verifying changes to the obfuscator" section below if you modify `lib/obfuscate.js`.
- **Real key system** (`lib/keyCheck.js`, `routes/keys.js`) — not a link field, an actual runtime check:
  - Enabling "requires a key" on a script embeds a genuine validation snippet *into the source before obfuscation*, so the check itself ships obfuscated too, not as a visible separate step.
  - End users set `_G.Key = "..."` before running the loadstring; the loader calls `GET /api/keys/validate` on your own server at runtime and only proceeds if the key is active and unexpired.
  - Owners generate keys with custom expiry (never / 1 day / 7 days / 30 days) from `/dashboard/keys`, and can revoke any key at any time.
  - Each key-protected script also gets a public, no-login self-serve page at `/key/<id>` where anyone with the link can generate their own 24-hour key.
- **Loader links** — every script gets a URL shaped like Luarmor's: `/files/v3/loaders/<32-char-id>.lua`. The endpoint only serves non-browser User-Agents (browsers get a 403); every hit — served or blocked — is logged to `fetch_events` for the dashboard chart.
- **Source is never shown publicly** — not on the script's page, not in any listing. Only the script's own owner sees it, in their own edit form.
- **Dashboard** (`/dashboard`) — stat tiles (total executions, total views, scripts protected, blocked fetches), a real 30-day execution chart rendered server-side as inline SVG (no charting library), a "Top scripts by executions" panel, and a script table with Loader / Keys / Edit / Delete actions and an auto-incrementing version number.
- **Security**
  - Parameterized SQL everywhere (no string-built queries → no SQL injection).
  - CSRF tokens on every state-changing form.
  - `helmet` security headers + a strict Content-Security-Policy.
  - Rate limiting on login, registration, publishing, and the loader endpoint.
  - HttpOnly, SameSite, Secure (in production) session cookies.
  - Constant-shape login responses so you can't enumerate valid usernames.
- **Design** — navy background with a gold accent, fully custom SVG icon set (no icon library), a sidebar dashboard shell, responsive layout.

---

## 1. Set up Neon (the database)

1. Go to [neon.tech](https://neon.tech) and create a free project.
2. In the Neon dashboard, open **Connection Details** and copy the **pooled connection string**.
3. Copy `.env.example` to `.env` and paste that connection string into `DATABASE_URL`.

## 2. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Your Neon pooled connection string |
| `SESSION_SECRET` | A long random string — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SITE_URL` | `https://luvenn.xyz` in production — used to build loader links |
| `DISCORD_INVITE_URL` | Your Discord invite link, shown in the nav/footer |
| `NODE_ENV` | `production` when deployed (enables secure cookies) |

## 3. Install & migrate

```bash
npm install
npm run migrate    # creates all tables in Neon from db/schema.sql
```

## 4. Run it

```bash
npm start
```

Visit `http://localhost:3000`.

## 5. Deploy

This is a stateful Express app (sessions + a Postgres-backed store), so it's happiest on a host that runs a persistent Node process: **Render, Railway, Fly.io, or a VPS**. Set the same environment variables there, point your domain at it, and run `npm run migrate` once against the same `DATABASE_URL` before first use.

### Deploying to Vercel specifically

Vercel is serverless, not a persistent server, so a plain Express app needs two adjustments — both already done in this repo:

- `server.js` exports the app (`module.exports = app`) instead of only calling `app.listen()`, and a `vercel.json` routes all requests to it as a Node serverless function.
- `trust proxy` is always enabled in production, which is required behind Vercel's edge proxy for session cookies to round-trip correctly.

If you deployed an earlier copy of this project to Vercel and saw **login return `403 Forbidden`** (or other requests behaving oddly), that was this exact gap — the app was running, but `app.listen()` alone doesn't serve requests on Vercel, and without `trust proxy` sessions/CSRF tokens don't survive between a page load and a form submit. Both are fixed as of this version; redeploy this copy and it should resolve.

Two things specific to serverless you should still confirm in your Vercel project settings:
- **All of `.env.example`'s variables are set** in Vercel's Environment Variables settings, including `DATABASE_URL` and `SESSION_SECRET` — a missing `DATABASE_URL` crashes every request.
- Use Neon's **pooled** connection string (already what `.env.example` asks for) — serverless functions open a fresh connection per cold start, and only the pooled endpoint handles that gracefully.
- Check **Project Settings → Deployment Protection** isn't set to require Vercel authentication on the deployment you're testing — that blocks all requests (including legitimate ones) at Vercel's edge, before they ever reach the app, and can look like an unrelated 403/401 from outside.

## Verifying changes to the obfuscator

If you modify `lib/obfuscate.js` or `lib/keyCheck.js`, verify against a real Lua interpreter before trusting it:

```bash
apt-get install -y lua5.1   # or use whatever Lua interpreter you have
node -e "
const { obfuscate } = require('./lib/obfuscate');
require('fs').writeFileSync('/tmp/check.lua', obfuscate('print(\"hello\")'));
"
lua5.1 /tmp/check.lua   # should print: hello
```

---

## How the loader protection works

When someone requests `/files/v3/loaders/<id>.lua`:
- If the `User-Agent` looks like a browser (Chrome, Firefox, Safari, Edge, etc.) → `403 Forbidden`, and the attempt is logged as a "blocked" fetch event (shown in your dashboard's Blocked fetches stat).
- Otherwise (a Roblox executor calling `game:HttpGet`) → the *protected* (obfuscated) version of the script is returned as `text/plain`, and the hit is logged as a "fetch" event, which is what powers the execution chart.

User-Agent checks alone can be spoofed, so this is one layer among several: loader IDs are unguessable 32-character random hex strings (not sequential), every hit is rate-limited, and — most importantly — the file served is never the original source, only the obfuscated output.

## Project structure

```
luvenn/
├── server.js              # app entry point, middleware wiring
├── lib/
│   └── obfuscate.js         # the obfuscation engine (tokenizer + string encoder + XOR/base64 loader)
├── db/
│   ├── schema.sql          # full Postgres schema
│   ├── index.js            # connection pool + query helper
│   └── migrate.js          # applies schema.sql
├── middleware/
│   ├── auth.js             # session user loader, requireAuth
│   ├── csrf.js              # CSRF token issuing + verification
│   └── security.js         # rate limiters
├── routes/
│   ├── auth.js              # register / login / logout
│   ├── scripts.js           # landing page, script/loader page, /files/v3/loaders/*.lua, docs, faq
│   └── dashboard.js         # dashboard (stats + chart + table), publish/edit (runs obfuscate()), profile
├── views/                   # EJS templates
│   └── partials/
│       ├── head.ejs / nav.ejs / footer.ejs      # public site shell
│       └── account_head.ejs / account_foot.ejs  # /dashboard sidebar shell
├── public/
│   ├── css/style.css        # public site theme (navy + gold)
│   ├── css/dash.css         # dashboard sidebar shell
│   ├── js/main.js
│   └── icons/sprite.svg     # custom icon set
└── utils.js
```

## Known limitations

- The obfuscator round-trips all standard Lua escapes correctly (`\n`, `\t`, `\xNN`, `\ddd`, etc.) and both string styles, verified against a real Lua interpreter — but Luau's backtick string-interpolation syntax isn't specially recognized, so literals inside `` `...` `` pass through unobfuscated (the script still runs correctly, that particular literal just isn't string-encoded).
- The execution chart and stats are real, computed from a `fetch_events` table that grows with usage — for a high-traffic deployment you'd want to add periodic pruning of old rows, which isn't included here.
- There's no payment/licensing system — publishing is free and unlimited; the stat tiles show real counts, not usage caps.
