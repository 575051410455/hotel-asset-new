# How to deploy — Docker Compose on an Ubuntu 24.04 VPS

This is the canonical, step-by-step guide to running the **Ops Monitor** stack in
production on a single Ubuntu 24.04 (Noble) VPS using Docker Compose + nginx.

> A styled HTML version of the same material lives at `docs/deployment.html`.
> If the two ever disagree, **this file is the source of truth** — it is verified
> against the actual `docker-compose.yml`, `Dockerfile`s and nginx config.

---

## TL;DR

```bash
# on the VPS, as a sudo user
git clone <your-repo-url> ops-monitor && cd ops-monitor
cp .env.example .env && nano .env          # set POSTGRES_PASSWORD, JWT_SECRET, FRONTEND_URL
docker compose up -d --build               # build + start all 4 services
docker compose exec backend bun run db:push   # create the database tables

# create your first admin user (only that — no demo data). See §7 for details.
docker compose exec -e ADMIN_EMAIL=you@company.com -e ADMIN_PASSWORD='strong-pass' \
  backend bun run db:seed:admin

curl http://localhost/api/health           # -> {"status":"ok",...}
```

> ⚠️ **Never run `bun run db:seed` in production** — it wipes every table and loads demo
> data. It refuses to run under `NODE_ENV=production`. Use `db:seed:admin` (above / §7).

---

## 1. Architecture at a glance

Four containers on a private `opsnet` network. **Only nginx is published to the
host** (port 80, and 443 once TLS is enabled). The database and backend are never
exposed to the internet.

```
                 ┌──────────── VPS (Ubuntu 24.04) ────────────┐
   Internet ───▶ │  nginx  :80/:443  (edge reverse proxy)      │
                 │     │                                       │
                 │     ├─ /api/      ─▶ backend :3000 (Bun)     │
                 │     ├─ /uploads/  ─▶ backend :3000           │
                 │     └─ /          ─▶ frontend :80 (static)   │
                 │                          │                   │
                 │                       backend ─▶ db :5432 (Postgres) │
                 └────────────────────────────────────────────┘
   Volumes: pgdata (DB)  ·  uploads (floor-plan images)
```

| Service    | Image / build        | Role                                             | Published? |
|------------|----------------------|--------------------------------------------------|------------|
| `nginx`    | `nginx:1.27-alpine`  | Edge reverse proxy / TLS termination             | **Yes** — 80 (+443) |
| `frontend` | built from `./frontend` | Static React SPA, served by an internal nginx | No (internal `:80`) |
| `backend`  | built from `./backend`  | API (Bun + Hono + Drizzle)                    | No (internal `:3000`) |
| `db`       | `postgres:17-alpine` | PostgreSQL                                        | No (internal `:5432`) |

The SPA calls the API at a **relative `/api`** (same origin), so there is **no
build-time API URL** to configure. nginx routes by path.

---

## 2. Prerequisites

- A VPS running **Ubuntu 24.04 LTS** with a **sudo-capable user** (don't deploy as root).
- **~1 GB RAM minimum** (Postgres + Bun + two nginx). 2 GB recommended.
- Inbound firewall open for **22 (SSH), 80 (HTTP)** and **443 (HTTPS)**.
- *(Optional, for HTTPS)* a **domain name** with an `A` record pointing at the VPS IP.

---

## 3. Install Docker Engine + Compose plugin

The official Docker apt repository (works on Noble):

```bash
# Remove any distro packages that conflict
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt-get remove -y $pkg 2>/dev/null || true
done

# Add Docker's official GPG key + repo
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Engine + CLI + Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in afterwards for it to take effect)
sudo usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

> **Firewall note:** Docker publishes ports by editing iptables directly, which can
> bypass `ufw`. That's fine for 80/443 (they're meant to be public). Just make sure
> you **never** add host port mappings for `db`/`backend`, and keep SSH locked down.

---

## 4. Get the code onto the server

```bash
git clone <your-repo-url> ops-monitor
cd ops-monitor
```

(Or `rsync -a --exclude node_modules ./ user@vps:/home/user/ops-monitor/`.)

> The Docker build needs only the repo's `frontend/` and `backend/` sources — no
> `node_modules` (each image runs `bun install` internally). The optional demo data
> seed depends on prototype assets under `_extracted/` that are **not** committed —
> see §7.

---

## 5. Configure secrets (`.env`)

The Compose file reads secrets from a root `.env` (gitignored). Copy the template
and fill in **real** values:

```bash
cp .env.example .env
```

Generate strong secrets:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d /+=)"
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d /+=)"
```

Edit `.env`:

| Variable            | Required | Notes                                                                 |
|---------------------|----------|-----------------------------------------------------------------------|
| `POSTGRES_PASSWORD` | **Yes**  | Compose refuses to start without it.                                  |
| `JWT_SECRET`        | **Yes**  | HS256 signing key, 24 h tokens. **Keep stable** — changing it logs everyone out. |
| `FRONTEND_URL`      | Yes      | Public origin for the backend's CORS allow-list. `http://<SERVER_IP>` now, `https://your-domain` after TLS. |
| `POSTGRES_DB`       | No       | Defaults to `opsmonitor`.                                             |
| `POSTGRES_USER`     | No       | Defaults to `opsmonitor`.                                             |

> The frontend needs **no** build-time env (relative `/api`, same origin).

### Optional: "Sign in with Google"

Leave the three `GOOGLE_*` vars blank to keep it off (the login page hides the
button). To enable it:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   create an **OAuth 2.0 Client ID** of type **Web application**.
2. Add an **Authorized redirect URI** — exactly your public origin plus the
   callback path:

   ```
   https://your-domain.com/api/auth/google/callback
   ```

   (For local testing over the dev proxy: `http://localhost:5173/api/auth/google/callback`.)
3. Put the credentials in `.env`:

   | Variable | Notes |
   |---|---|
   | `GOOGLE_CLIENT_ID` | From the console. |
   | `GOOGLE_CLIENT_SECRET` | From the console. |
   | `GOOGLE_ALLOWED_DOMAIN` | Email domain (e.g. `richmond.local`) allowed to **auto-create** an account on first Google login. New users get **no property access** until an admin assigns a role. Existing users are matched by email regardless of domain. Blank = existing accounts only. |

4. Apply: `docker compose up -d`. The redirect URI is derived from `FRONTEND_URL`
   — if they ever differ, set `GOOGLE_REDIRECT_URI` explicitly.

---

## 6. Build and start

```bash
docker compose up -d --build
```

First build pulls base images and runs `bun install` in both images — give it a few
minutes. Then check status (wait for `db` to become **healthy**; backend starts only
after that):

```bash
docker compose ps
docker compose logs -f backend     # Ctrl-C to stop tailing
```

You want to see `ops-monitor backend running on port 3000` and no restart loops.

---

## 7. Initialize the database

The backend **does not** migrate on boot. Create the schema once, against the
running `db` container:

```bash
docker compose exec backend bun run db:push
```

`drizzle-kit push` diffs `src/db/schema.ts` against the live DB and creates the
tables. On an empty database, accept any prompts — there's no data to lose.

### Create your first admin user

> ⚠️ **Never run `db:seed` in production.** It **wipes every table** and loads demo
> data from `_extracted/…` (gitignored, not in the backend image). It now refuses to
> run under `NODE_ENV=production` and fails with a clear message if the bundle is
> missing — but don't rely on that; use the bootstrap below instead.

**Recommended — the `db:seed:admin` script** creates *only* the admin role, one
property, your admin user, and its assignment (no demo data). It is idempotent and
never deletes anything:

```bash
docker compose exec \
  -e ADMIN_EMAIL=you@company.com \
  -e ADMIN_PASSWORD='choose-a-strong-password' \
  backend bun run db:seed:admin
```

Optional overrides: `ADMIN_NAME`, `PROPERTY_ID`, `PROPERTY_CODE`, `PROPERTY_NAME`,
`PROPERTY_CITY` (defaults: `hq` / `HQ` / `Head Office`). Then sign in and add the
rest (properties, floors, devices, users) from the UI.

<details>
<summary>Alternative — bootstrap by hand with SQL</summary>

**1) Hash your chosen password** (bcrypt, via the backend container):

```bash
docker compose exec backend bun -e 'console.log(require("bcryptjs").hashSync("ChangeMe123!", 10))'
```

Copy the printed `$2b$...` hash.

**2) Insert a role, a property, the user, and the access grant:**

```bash
docker compose exec db psql -U opsmonitor -d opsmonitor
```

```sql
-- Built-in admin role (full access to every resource)
INSERT INTO roles (id, name, description, builtin, perms)
VALUES ('admin', 'Administrator', 'Full control.', true,
        '{"devices":"crud","floors":"crud","cctv":"crud","access":"crud"}')
ON CONFLICT (id) DO NOTHING;

-- Your first property
INSERT INTO hotels (id, code, name, city, sort_order)
VALUES ('hq', 'HQ', 'Head Office', 'Bangkok', 0)
ON CONFLICT (id) DO NOTHING;

-- The admin account (paste the bcrypt hash from step 1)
INSERT INTO users (email, password_hash, name, status)
VALUES ('admin@example.com', '<PASTE_BCRYPT_HASH>', 'Administrator', 'active')
ON CONFLICT (email) DO NOTHING;

-- Grant that user the admin role on the property
INSERT INTO assignments (user_id, hotel_id, role_id)
SELECT u.id, 'hq', 'admin' FROM users u WHERE u.email = 'admin@example.com';

\q
```

You can now sign in as `admin@example.com`, then create floors, devices and more
users from the UI (Access control + Manage floors).

</details>

> *Demo dataset (dev only):* a full checkout that still contains `_extracted/` can
> load the prototype's demo data with `bun run db:seed` — but it **wipes the database
> first**, so never point it at production. Demo logins are e.g.
> `chai@richmond.local` / `admin123`.

---

## 8. Verify

```bash
curl http://localhost/api/health        # {"status":"ok","timestamp":"..."}
```

Then open `http://<SERVER_IP>/` in a browser and log in. Upload a floor plan to
confirm the `/uploads` path and the `uploads` volume work end-to-end.

---

## 9. Enable HTTPS (recommended)

The stack ships ready for Let's Encrypt via the **webroot** method. Do this after
DNS points at the VPS.

**1) Set your domain** in two places:
- `nginx/conf.d/default.conf` → `server_name your-domain.com;`
- `.env` → `FRONTEND_URL=https://your-domain.com` (then `docker compose up -d` to apply)

**2) Add an ACME-challenge location** to the existing `:80` server block in
`nginx/conf.d/default.conf` (above `location /`):

```nginx
location /.well-known/acme-challenge/ {
    root /var/www/certbot;
}
```

**3) In `docker-compose.yml`, uncomment** the certbot volumes so nginx can serve the
challenge and store certs:

```yaml
  nginx:
    ports:
      - "80:80"
      - "443:443"                       # uncomment
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - letsencrypt:/etc/letsencrypt    # uncomment
      - certbot-www:/var/www/certbot    # uncomment
volumes:
  pgdata:
  uploads:
  letsencrypt:                          # uncomment
  certbot-www:                          # uncomment
```

Apply (still serving on 80): `docker compose up -d`

**4) Issue the certificate** (named volumes are prefixed with the project name
`ops-monitor`):

```bash
docker run --rm \
  -v ops-monitor_letsencrypt:/etc/letsencrypt \
  -v ops-monitor_certbot-www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d your-domain.com \
  --email you@example.com --agree-tos --no-eff-email
```

**5) Enable the 443 server block** at the bottom of `nginx/conf.d/default.conf`
(uncomment it; set `server_name` and the cert paths to your domain). Optionally make
the `:80` block redirect to HTTPS:

```nginx
location / { return 301 https://$host$request_uri; }
```

Reload: `docker compose up -d` (or `docker compose exec nginx nginx -s reload`).

**6) Auto-renew** — add a cron job (`sudo crontab -e`):

```cron
0 3 * * * docker run --rm -v ops-monitor_letsencrypt:/etc/letsencrypt -v ops-monitor_certbot-www:/var/www/certbot certbot/certbot renew --quiet && docker compose -f /home/USER/ops-monitor/docker-compose.yml exec nginx nginx -s reload
```

---

## 10. Day-2 operations

**Update / redeploy** (after `git pull`):

```bash
git pull
docker compose up -d --build           # rebuilds changed images, recreates containers
docker compose exec backend bun run db:push   # only if the schema changed
```

- `backend`/`frontend` run your source baked into an image, so `--build` is **required**
  for code changes to take effect; a bare `git pull` is not enough.
- `.env` is gitignored, so your secrets survive the pull. If you hand-edited **tracked**
  files on the server (TLS lines in `docker-compose.yml`, `server_name` in the nginx
  config), `git pull` may conflict — `git stash` or commit them to a server branch first.
- Routine updates **do not** re-seed. Only run `db:seed:admin` again to add another admin
  (it is idempotent and never deletes). **Never** run `db:seed` on production.

**Logs / status / restart:**

```bash
docker compose ps
docker compose logs -f --tail=100 backend
docker compose restart backend
docker compose down                    # stop & remove containers (volumes persist)
```

**Back up the database** (the `pgdata` volume):

```bash
docker compose exec -T db pg_dump -U opsmonitor opsmonitor > backup_$(date +%F).sql
# restore:
docker compose exec -T db psql -U opsmonitor -d opsmonitor < backup_2026-06-16.sql
```

**Back up uploaded floor plans** (the `uploads` volume):

```bash
docker run --rm -v ops-monitor_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
```

> `docker compose down -v` deletes the `pgdata` and `uploads` volumes — **don't** run
> it in production unless you intend to wipe everything.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `error: set POSTGRES_PASSWORD in .env` on `up` | Missing required secret | Set `POSTGRES_PASSWORD` / `JWT_SECRET` in `.env`. |
| `502 Bad Gateway` from nginx | Backend not up yet / crashed | `docker compose logs backend`; ensure `db` is healthy and `db:push` ran. |
| Login fails / "Invalid credentials" | DB not initialized or no user | Run `db:push`, then create an admin (§7). |
| `relation "users" does not exist` | Schema never created | `docker compose exec backend bun run db:push`. |
| Browser CORS errors | `FRONTEND_URL` ≠ the URL you're visiting | Set `FRONTEND_URL` to the exact public origin, `docker compose up -d`. |
| Floor-plan upload returns 413 | Body too large | nginx already allows 12 MB (`client_max_body_size`); images are capped at 10 MB. |
| Code changes not reflected | Image not rebuilt | `docker compose up -d --build`. |
| Everyone logged out after a deploy | `JWT_SECRET` changed | Keep `JWT_SECRET` stable across deploys. |

---

## 12. Reference

**Containers / project name:** `ops-monitor` → containers `ops-monitor-{nginx,frontend,backend,db}-1`.

**Named volumes:** `ops-monitor_pgdata`, `ops-monitor_uploads` (+ `ops-monitor_letsencrypt`, `ops-monitor_certbot-www` when TLS is on).

**Internal ports:** backend `3000`, frontend `80`, db `5432` — none published to the host.

**Useful one-liners:**

```bash
docker compose exec db psql -U opsmonitor -d opsmonitor   # SQL shell
docker compose exec backend sh                            # shell in the API container
docker stats                                              # live resource usage
docker compose config                                     # render the effective config
```
