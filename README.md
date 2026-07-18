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
  This is verified against a real Lua interpreter in `test_obfuscate.js`-style checks during development (run `lua5.1` locally if you want to re-verify after changing `lib/obfuscate.js`).
- **Loader links** — every script gets a URL shaped like Luarmor's: `/files/v3/loaders/<32-char-id>.lua`. The endpoint only serves non-browser User-Agents (browsers get a 403); every hit — served or blocked — is logged to `fetch_events` for the dashboard chart.
- **Source is never shown publicly** — not on the script's page, not in any listing. Only the script's own owner sees it, in their own edit form.
- **Dashboard** (`/dashboard`) — stat tiles (total executions, total views, scripts protected, blocked fetches), a real 30-day execution chart rendered server-side as inline SVG (no charting library), and a script table with Loader / Edit / Delete actions and an auto-incrementing version number.
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

This is a standard long-running Express app (uses `express-session` + Postgres, not serverless functions), so deploy it anywhere that runs a persistent Node process: Render, Railway, Fly.io, a VPS, or Vercel's Node.js server runtime. Set the same environment variables there, point your domain at it, and run `npm run migrate` once against the same `DATABASE_URL` before first use.

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
