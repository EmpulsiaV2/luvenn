# luvenn

A script publishing platform: users create accounts and publish their own Roblox scripts, raw script text is only served to non-browser (executor) clients, and you moderate everything from a separate admin panel.

Built with **Node.js + Express**, **EJS** templates, and **Neon (Postgres)** for the database.

---

## Features

- **Accounts** — register/login, bcrypt-hashed passwords (12 rounds), sessions stored in Postgres (not memory, so they survive restarts/redeploys).
- **Account dashboard** — a sidebar app (`/dashboard`) with Overview (stats + recent scripts + quick actions), My Scripts (filterable: all/published/unpublished/key system), Add Script, and Performance (per-script views/fetches).
- **Publish scripts** — any logged-in user can publish, edit, unpublish, or delete their own scripts.
- **Protection layer** — raw script text is only served at `/raw/<id>.lua` to requests whose `User-Agent` doesn't look like a browser. Regular browsers get a `403`. **Source code is never shown anywhere on the public site** — not on the script page, not in listings. Only the loadstring is shown, and only the script's own owner sees the code, in their own edit form.
- **Admin panel** — a sidebar app at `/admin`. There's no separate admin login: if your account has `is_admin = TRUE` in the database, logging in normally is enough, and an "Admin" link appears in your nav/dashboard. Non-admins get a plain 404 on `/admin*`. From there you can see stats, feature/unpublish/remove/delete any script, and ban/unban users.
- **Security**
  - Parameterized SQL everywhere (no string-built queries → no SQL injection).
  - CSRF tokens on every state-changing form.
  - `helmet` security headers + a strict Content-Security-Policy.
  - Rate limiting on login, registration, publishing, and raw script fetches.
  - HttpOnly, SameSite, Secure (in production) session cookies.
  - Constant-shape login responses so you can't enumerate valid usernames.
- **Design** — black/white theme with a blue accent, fully custom SVG icon set (no icon library), a sidebar app shell for the dashboard/admin areas, responsive layout.

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
│   ├── dashboard.js         # account area: overview, my scripts, analytics, publish/edit
│   └── admin.js              # admin area: overview, all scripts, users
├── views/                   # EJS templates
│   └── partials/
│       ├── head.ejs / nav.ejs / footer.ejs      # public site shell
│       ├── account_head.ejs / account_foot.ejs  # /dashboard sidebar shell
│       └── admin_head.ejs / admin_foot.ejs      # /admin sidebar shell
├── public/
│   ├── css/style.css        # public site theme (black/white/blue)
│   ├── css/dash.css         # shared sidebar app shell (dashboard + admin)
│   ├── js/main.js
│   └── icons/sprite.svg     # custom icon set
└── utils.js
```

## What you'll still want to decide

- **Content moderation policy** — the admin tools (unpublish/remove/ban) are in place, but the actual rules for what's allowed on your platform are up to you.
- **Rate limit numbers** in `middleware/security.js` are reasonable starting points — tune them to your traffic.
- **Invite-only registration** is supported (`REQUIRE_INVITE_CODE=true` + `INVITE_CODE` in `.env`) if you want to gate signups.
