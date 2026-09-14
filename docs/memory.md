# Project Memory — Ops Monitor

Durable context, decisions, and gotchas for this repo. Read this before deploying,
touching auth, or seeding a database. Keep it updated when any of these change.

Last updated: 2026-07-21

---

## 1. What this is

**Ops Monitor** — a multi-property dashboard for monitoring workstations, IP cameras,
and access points across hotels ("properties"). Each property is a separate access
scope.

| Layer | Stack |
|---|---|
| Backend | Bun + Hono + Drizzle ORM + PostgreSQL |
| Frontend | React + Vite + TanStack Router + Tailwind + shadcn/ui |
| Auth | JWT (HS256 via `jose`), bcrypt passwords, **Google OAuth** |
| Deploy | Docker Compose + nginx on Ubuntu 24.04 VPS (compose project name: `ops-monitor`) |

Architecture: 4 containers on a private `opsnet` network — `nginx` (only one published,
:80/:443) → `frontend` (static SPA), `backend` (:3000), `db` (Postgres :5432). The SPA
calls the API at a **relative `/api`** (same origin); there is no build-time API URL.

---

## 2. Auth & access model

- **Session**: JWT carries only `sub` (user id), 24 h expiry. The user's effective roles
  are resolved **per request** from the DB. Token is stored in `localStorage` (bearer).
- **RBAC**: access is **per-property**, granted via direct `assignments` or via `groups`.
  A user with **zero assignments authenticates but sees no properties** → the frontend
  shows a "No properties assigned" screen (`_layout.tsx`). This is by design.
- **Authorization**: every data route uses `authMiddleware`; access-management routes
  additionally call `gate(userId, 'crud')` which checks `maxPerm(ctx, 'userManagement')`. So a
  logged-in user with no permissions gets **403**, not data.
- **Sessions are server-side**: Postgres `sessions`, an HttpOnly `om-session` cookie and an
  `om-csrf` token echoed in `X-CSRF-Token`. `FRONTEND_URL` must be the exact public https
  origin — the only Origin allowed to change data, and what makes the cookies Secure; the
  backend won't start without it.

### Google "Sign in with Google" (added 2026-07-21)

- **Flow**: server-side Authorization Code. `GET /api/auth/google/start` → Google →
  `GET /api/auth/google/callback` → backend verifies the ID token against Google's JWKS
  (via `jose`, no extra deps) → issues our JWT → redirects to `/login#token=…` (token in
  the URL fragment, stripped client-side). CSRF-protected with a `state` cookie.
- **Provisioning**: **auto-create on an allowed domain**. A first-time user whose email is
  on `GOOGLE_ALLOWED_DOMAIN` gets an account with **no property access** until an admin
  assigns a role. Existing users are matched by email and have their Google identity linked.
- **Config** (all optional; blank = feature hidden, login page hides the button):
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAIN`, optional
  `GOOGLE_REDIRECT_URI`. Redirect URI defaults to `<FRONTEND_URL>/api/auth/google/callback`
  and must be registered exactly in the Google Cloud console.
- **Schema**: `users.password_hash` is **nullable** (Google-only accounts have none);
  added `users.google_sub` (unique) and `users.avatar`. Password login and change-password
  guard the null hash.
- **UI**: the "Continue with Google" button uses shadcn `Button` (`asChild` + `variant="outline"`).

---

## 3. Deploying / updating on the VPS

Standard update after code changes:

```bash
git pull
docker compose up -d --build            # backend & frontend build from source → MUST rebuild
docker compose exec backend bun run db:push   # only when the schema changed
```

- `backend` and `frontend` run **your source baked into an image** — a bare `git pull`
  changes files on disk but the running containers keep the old image until `--build`.
- `db` / `nginx` are pinned images; nginx config is a bind mount (`./nginx/conf.d`), so
  config changes apply on `up -d` (or `nginx -s reload`), no rebuild.
- **`.env` is gitignored** → secrets survive `git pull`. If you hand-edited tracked files
  on the server (e.g. TLS/certbot lines in `docker-compose.yml`, `server_name` in nginx),
  `git pull` can conflict — `git stash` or commit them to a server branch first.
- ⚠️ **Never `docker compose down -v`** — it deletes the `pgdata` and `uploads` volumes
  (database + uploaded floor plans).

Full guide: [how-to-deploy.md](how-to-deploy.md).

---

## 4. Seeding databases

| Command | Use | Behavior |
|---|---|---|
| `bun run db:seed:admin` | **Production** first login | Creates ONLY: `admin` role, one property, one admin user, its assignment. **No demo data.** Idempotent (never deletes). Env-driven: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (required); `ADMIN_NAME`, `PROPERTY_ID/CODE/NAME/CITY` (optional). |
| `bun run db:seed` | **Dev only** | Loads the prototype demo dataset. **WIPES every table first.** Depends on the gitignored `_extracted/` bundle. Refuses to run under `NODE_ENV=production`, and fails with a clear message if the bundle is absent. Demo logins: `chai@richmond.local` / `admin123`, etc. |

Prod bootstrap:

```bash
docker compose exec -e ADMIN_EMAIL=you@company.com -e ADMIN_PASSWORD='strong-pass' \
  backend bun run db:seed:admin
```

Then add properties/floors/devices/users from the UI.

---

## 5. Gotchas / conventions

- **Lint is broken repo-wide** on `main` (`npm run lint` fails everywhere). Use
  **`tsc -b` (frontend) / `tsc --noEmit` (backend)** as the real correctness gate.
- **Notifications are client-side only** — the `/profile` alert settings live in
  `localStorage` with simulated test sends; there is no backend delivery.
- **`drizzle-kit push` is interactive** and can hang in non-interactive/piped contexts.
  Run it in a real TTY (a normal terminal, or `docker compose exec` which allocates one).
- The login page (`login.tsx`) intentionally uses **arbitrary Tailwind values**
  (`h-[42px]`, `gap-[10px]`); the `suggestCanonicalClasses` lint hints there are noise.
- Frontend renders avatars as an **initials badge derived from email** (`avatarColor`),
  not `<img src={avatar}>` — the stored Google `avatar` URL is currently unused in the UI.
