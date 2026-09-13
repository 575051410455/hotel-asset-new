# Ops Monitoring Dashboard

A multi-property monitoring dashboard for hotel IT operations — device inventory,
interactive floor-plan maps for workstations / Wi-Fi / CCTV, per-property
role-based access control, profiles, and printable asset stickers.

## Stack

| | |
| --- | --- |
| **Backend** | Bun · Hono · PostgreSQL · Drizzle ORM · Zod · JWT (jose) · bcryptjs |
| **Frontend** | React 19 · Vite · TanStack Router/Query/Table/Form · Tailwind v4 · shadcn · lucide |

## Layout

```
backend/    Bun + Hono API (port 3000) — auth, hotels, floors, devices, access, uploads
frontend/   React + Vite SPA (port 5174) — proxies /api and /uploads to the backend
docs/        Project docs (see docs/add-a-floor.md)
```

## Getting started

### Backend

```bash
cd backend
bun install
cp .env.example .env            # then fill in DATABASE_URL + JWT_SECRET
bun run db:create               # create the database
bun run db:migrate              # apply the checked-in migrations (backend/drizzle)
bun run db:seed                 # seed demo hotels, roles, users, floors, devices
bun src/index.ts                # serve on :3000  (or: bun run dev)
```

> `.env` is gitignored — it holds the database credentials and JWT secret. Use a
> database dedicated to this app (e.g. `opsmonitor`).

### Frontend

```bash
cd frontend
npm install
npm run dev                     # serve on :5174
```

### Demo logins (from the seed)

| email | password | role |
| --- | --- | --- |
| chai@richmond.local | admin123 | Administrator (all properties) |
| smart@richmond.local | manager123 | IT Manager |
| gift@richmond.local | user123 | Viewer |

## Testing

```bash
cd backend && bun test          # RBAC + schema unit tests + floor route integration tests
cd frontend && npm run build     # type-check (tsc -b) + production build
```

The floor-route integration tests run against `DATABASE_URL` and skip themselves
if the database is unreachable. See [docs/add-a-floor.md](docs/add-a-floor.md) for
how floors work and how to add one.
