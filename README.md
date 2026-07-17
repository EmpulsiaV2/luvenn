# luvenn

A script publishing platform: users create accounts and publish their own Roblox scripts, raw script text is only served to non-browser (executor) clients, and you moderate everything from a separate admin panel.

Built with **Node.js + Express**, **EJS** templates, and **Neon (Postgres)** for the database.

---

## Features

- **Accounts** — register/login, bcrypt-hashed passwords (12 rounds), sessions stored in Postgres (not memory, so they survive restarts/redeploys).
- **Publish scripts** — any logged-in user can publish, edit, unpublish, or delete their own scripts from `/dashboard`.
- **Protection layer** — raw script text is only served at `/raw/<id>.lua` to requests whose `User-Agent` doesn't look like a browser. Regular browsers get a `403`. Every fetch is rate-limited and counted.
- **Admin panel** — a *separate* login at `/admin/login`. Only accounts with `is_admin = TRUE` in the database can get in — there is no in-app way to grant admin, on purpose. From `/admin` you can see stats, feature/unpublish/remove/delete any script, and ban/unban users.
- **Security**
  - Parameterized SQL everywhere (no string-built queries → no SQL injection).
  - CSRF tokens on every state-changing form.
  - `helmet` security headers + a strict Content-Security-Policy.
  - Rate limiting on login, registration, admin login, publishing, and raw script fetches.
  - HttpOnly, SameSite, Secure (in production) session cookies.
  - Constant-shape login responses so you can't enumerate valid usernames.
  - Admin panel requires a second, explicit admin-login step even if you're already logged in as a normal user on that browser.
- **Design** — black/white theme with a blue accent, fully custom SVG icon set (no icon library), responsive layout.

---

## 1. Set up Neon (the database)

1. Go to [neon.tech](https://neon.tech) and create a free project.
2. In the Neon dashboard, open **Connection Details** and copy the **pooled connection string** (it looks like `postgresql://user:pass@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`).
3. Copy `.env.example` to `.env` and paste that connection string into `DATABASE_URL`.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Your Neon pooled connection string |
| `SESSION_SECRET` | A long random string — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SITE_URL` | `https://luvenn.xyz` in production |
| `NODE_ENV` | `production` when deployed (enables secure cookies) |

## 3. Install & migrate

```bash
npm install
npm run migrate    # creates all tables in Neon from db/schema.sql
```

## 4. Make yourself admin

There is deliberately no signup checkbox or API for this. After you register your own account normally on the site, open the **Neon SQL editor** and run:

```sql
UPDATE users SET is_admin = TRUE WHERE username_lower = 'yourusername';
```

Now `/admin/login` will accept that account's normal username/password.

## 5. Run it

```bash
npm start
```

Visit `http://localhost:3000`.

## 6. Deploy

This is a standard long-running Express app (it uses `express-session` + Postgres, not serverless functions), so deploy it anywhere that runs a persistent Node process: **Render, Railway, Fly.io, a VPS, or Vercel's Node.js server runtime.** Set the same environment variables there, point your `luvenn.xyz` domain at it, and run `npm run migrate` once against the same `DATABASE_URL` before first use.

---

## How the executor-only protection works

When someone requests `/raw/<id>.lua`:
- If the `User-Agent` header matches common browser signatures (Chrome, Firefox, Safari, Edge, etc.) → `403 Forbidden`, plain text, no script body.
- Otherwise (a Roblox executor calling `game:HttpGet`, which sends a short or absent UA) → the raw Lua is returned as `text/plain`.

This is one layer, not the only one — User-Agent can technically be spoofed, so it's paired with per-route rate limiting and public IDs that aren't guessable (random 10-character tokens), rather than sequential integers.

## Project structure

```
luvenn/
├── server.js              # app entry point, middleware wiring
├── db/
│   ├── schema.sql          # full Postgres schema
│   ├── index.js            # connection pool + query helper
│   └── migrate.js          # applies schema.sql
├── middleware/
│   ├── auth.js             # session user loader, requireAuth, requireAdmin
│   ├── csrf.js              # CSRF token issuing + verification
│   └── security.js         # rate limiters
├── routes/
│   ├── auth.js              # register / login / logout
│   ├── scripts.js           # homepage, script detail, raw serving
│   ├── dashboard.js         # a user's own script CRUD
│   └── admin.js              # separate admin login + moderation panel
├── views/                   # EJS templates
│   └── partials/
├── public/
│   ├── css/style.css        # black/white/blue theme
│   ├── js/main.js
│   └── icons/sprite.svg     # custom icon set
└── utils.js
```

## What you'll still want to decide

- **Content moderation policy** — the admin tools (unpublish/remove/ban) are in place, but the actual rules for what's allowed on your platform are up to you.
- **Rate limit numbers** in `middleware/security.js` are reasonable starting points — tune them to your traffic.
- **Invite-only registration** is supported (`REQUIRE_INVITE_CODE=true` + `INVITE_CODE` in `.env`) if you want to gate signups.
