# Adding a floor

The Ops Monitoring Dashboard is **multi-property and data-driven**: floors live in
the database, scoped to a property (hotel), and the whole UI — sidebar nav, map
floor tabs, the device dialog's floor picker — is rendered from `GET /api/floors`.
Adding a floor therefore needs **no code change and no redeploy**.

This guide covers the data model, the three ways to add a floor, placing devices
on it, the permissions involved, and how it's tested.

---

## What a floor is

A floor is one row in the `floors` table (`backend/src/db/schema.ts`):

| field         | meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `id`          | slug, **unique within a property** — `^[a-z0-9][a-z0-9-]{0,30}$`         |
| `hotelId`     | the property it belongs to (PK is the composite `(hotelId, id)`)         |
| `name`        | full name, e.g. `Accounting Floor (3F)`                                  |
| `short`       | label shown in the sidebar & floor tabs, e.g. `3F · Accounts`           |
| `kind`        | `workstation` (computers + Wi-Fi APs) or `cctv` (cameras) — **permanent** |
| `route`       | URL fragment, defaults to `/<id>`                                        |
| `image`       | floor-plan image URL (`/uploads/...`), nullable until one is uploaded    |
| `aspect`      | plan image height ÷ width (drives the map canvas), default `0.75`        |
| `departments` | string[] — groups pins in the map list panel; called **zones** on CCTV floors |
| `sortOrder`   | position within the property (auto-assigned on create)                   |
| `deletedAt`   | soft-delete marker; the slug survives so it can be revived               |

Because the primary key is `(hotelId, id)`, the **same slug can exist under several
properties** (e.g. every hotel can have an `office` floor).

Deleting a floor is a **soft delete**: the row is kept (so the slug can be revived),
it disappears from `GET /api/floors`, and any devices pinned to it are **detached**
— they stay in the inventory but lose their `floorId` and `x`/`y` placement.

---

## 1. The create-floor wizard (recommended)

In the app, open the **Workstation map** or **CCTV map** and click **Add floor**
/ **Add CCTV floor** in the top bar (visible to users with `floors:crud`). The 3-step
wizard:

1. **Details** — pick the kind (workstation floor / CCTV floor), enter a name (the
   slug is derived automatically but editable), and a short label.
   **The kind is permanent.** Neither the UI nor `PATCH /api/floors` can change
   it — `updateFloorSchema` does not accept the field. To correct a wrong one,
   delete the floor and create it again with the same slug: the revive path
   replaces every field, kind included. While the floor has no devices yet this
   costs nothing.
2. **Floor plan** — drag-and-drop or pick a PNG/JPG (≤ 10 MB). It's uploaded
   immediately; the server computes the image dimensions and aspect ratio. You
   can skip it and add the plan later, but **a floor with no plan cannot take
   pins**: the Add buttons stay visible and disabled until one is uploaded. Pin
   coordinates are percentages measured against the plan's aspect ratio, so
   there is nothing meaningful to measure against until it exists.
3. **Departments / Zones** — add the groups used to organise pins within this
   floor. On a CCTV floor these are called **zones**; a zone is a grouping
   *inside* a floor, never a floor itself.

On save it `POST`s to `/api/floors` and navigates you to the new floor. It now
appears in the sidebar and floor tabs automatically.

> Front-end: `frontend/src/components/floor-dialog.tsx`, wired into
> `routes/_layout/workstation.tsx` and `cctv.tsx`; data hooks
> `useCreateFloor` / `uploadFloorImage` in `frontend/src/lib/devices.ts`.

---

## 2. Via the API (no UI)

Useful for scripting or bulk setup. Both calls require a token from a user with
`floors:crud` on the target property.

```bash
BASE=http://localhost:3001/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"chai@richmond.local","password":"admin123"}' | jq -r .token)

# (optional) upload a floor-plan image first — returns { url, aspect, ... }
UP=$(curl -s -X POST $BASE/uploads -H "authorization: Bearer $TOKEN" \
  -F "file=@./lobby.png;type=image/png")
IMG=$(echo "$UP" | jq -r .url)
ASPECT=$(echo "$UP" | jq -r .aspect)

# create the floor
curl -s -X POST $BASE/floors -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"hotelId\":\"rh2\",\"id\":\"lobby\",\"name\":\"Lobby Floor\",
       \"short\":\"Lobby · GF\",\"kind\":\"workstation\",
       \"image\":\"$IMG\",\"aspect\":$ASPECT,
       \"departments\":[\"Front Desk\",\"Concierge\"]}"
```

Responses you should expect:

- `201` with the created floor (`route` defaults to `/<id>`, `pins: []`)
- `409` if that slug already exists (and is not soft-deleted) in the property
- `400` if the slug breaks the rule above (uppercase, spaces, `_`, > 31 chars…)
- `403` if the caller lacks `floors:crud` on that property

Rename / re-plan / soft-delete:

```bash
curl -X PATCH "$BASE/floors/lobby?hotelId=rh2"  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"short":"Lobby · Ground"}'
curl -X DELETE "$BASE/floors/lobby?hotelId=rh2" -H "authorization: Bearer $TOKEN"
```

A runnable end-to-end example (create via API, then screenshot the UI) lives at
`_smoke/add-floor.mjs`.

---

## 3. Via the seed (fixtures / demo data)

`backend/src/db/seed.ts` imports the floor + device fixtures from the prototype
and is **re-seedable** (it clears the tables first). Add fixtures there when you
want a floor to be part of the seeded demo set rather than created at runtime.

---

## Placing devices on the floor

The floor must already have a **floor plan** — see the warning in §1. Without
one the Add buttons render disabled, with the reason in their tooltip.

On a map, users with `devices:crud` (+ `floors:crud` / `cctv:crud`) get **Add**
buttons in the top bar:

- workstation floor → **Add workstation**, **Add AP**
- CCTV floor → **Add camera**

Click a button, then click the spot on the plan — the click is converted to
`%`-coordinates and the device dialog opens pre-filled with that floor and
position. The pin lands exactly where you clicked. Existing pins can be dragged to
reposition via **Edit pins**.

> Front-end: place mode in `frontend/src/components/floor-map.tsx`; the dialog's
> `placement` prop in `frontend/src/components/device-dialog.tsx`.

---

## Permissions summary

| action                                   | required capability                         |
| ---------------------------------------- | ------------------------------------------- |
| view floors / maps                       | `floors:read` (or `cctv:read` for CCTV)     |
| create / rename / delete a floor        | `floors:crud` (**even for CCTV floors**)     |
| upload a floor-plan image                | `floors:crud`                               |
| add / move / edit a device (pin)         | `devices:crud`                              |

Access is per-property; when a user gets a property from several sources (a direct
assignment and/or groups), the **strongest role wins**.

---

## Testing

Backend tests use Bun's runner:

```bash
cd backend
bun test
```

- **Unit tests** (`test/rbac.test.ts`, `test/session.test.ts`,
  `test/floor-schema.test.ts`) are pure and need no database.
- **Integration tests** (`test/floors.integration.test.ts`,
  `test/auth.integration.test.ts`, `test/access.integration.test.ts`) drive the
  real Hono app against Postgres (uses `DATABASE_URL`). They use namespaced fixtures
  (`zz-test-*` / `ZZ-TEST-*`) under seeded hotels and hard-delete them afterwards,
  so seeded demo data is never touched. The suite **skips itself** if the database
  is unreachable, so the unit tests still run offline.

The rule for what a floor will accept as a pin is a pure module,
`frontend/src/lib/floor-placement.ts`, covered by `floor-placement.test.ts`
(`cd frontend && bun test`).

UI smoke tests (Playwright) live in `_smoke/` — `add-floor.mjs` exercises the full
add-a-floor flow.
