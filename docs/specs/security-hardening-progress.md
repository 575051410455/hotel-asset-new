# Security hardening implementation status

This is a progress record, not a deployment or completion certificate. The original
security review remains the baseline evidence. The full User Management and
session specification is not yet implemented.

## First remediation increment

- SEC-001: shared authentication now requires a valid HS256 token with a numeric
  subject and expiry, and an existing Active account. Integration coverage verifies
  that suspension rejects an already-issued token across protected route families.
  This is partial remediation: reactivation can revive an unexpired token;
  permanent revocation, password-change invalidation, and server-side sessions
  remain outstanding.
- SEC-002: the administrator web reset endpoint now returns 410 after authorization
  without changing a credential or returning a password. The reset button and
  client hook are removed. Integration coverage verifies both empty and explicitly
  supplied replacement-password requests leave the stored credential unchanged.
  Break-glass CLI recovery is not implemented yet. Existing default passwords and
  the separate new-user form's temporary-password fallback are still outstanding;
  retiring reset does not make those credentials safe.
- SEC-003: signer and verifier share validated configuration. Missing, empty,
  short, or recognized placeholder secrets fail at module initialization before
  server startup. Subprocess tests exercise rejection and valid configuration.
  Length/placeholder validation cannot prove secret entropy: operators must still
  generate a random secret. Previously exposed credentials need rotation.
- SEC-004: omitted-kind queries derive the permitted floor kinds and constrain
  both floor selection and attached pin selection in SQL. A real-route regression
  test verifies a floor-only custom role cannot read CCTV floors or camera metadata.

## Second increment — rollout phase 1 (storage foundation)

Additive schema only. No route reads or writes the new tables yet, and sign-in,
session and authorization behaviour are unchanged.

- Real checked-in migrations replace `db:push`. `0001_google_identity_columns`
  records the Google sign-in columns that the original `0000` migration lacked
  (the drift noted in the spec). `bun run db:migrate` now runs
  `backend/src/db/migrate.ts`, which applies `backend/drizzle` under an advisory
  lock. A history-less database built with `db:push` is baselined first, but
  only when its shape matches `0000`, or `0000` + `0001`. A half-built database,
  partial Google columns, or later-phase tables without history stop the runner
  with no changes.
- `0002_security_foundation` adds:
  - `sessions`: stores a SHA-256 digest of the opaque session identifier and of
    the CSRF token, plus idle, absolute and recent-authentication timestamps,
    revocation fields and client metadata.
  - `audit_events`: append-only. A trigger refuses UPDATE, TRUNCATE and DELETE
    unless the retention purge opts in for its own transaction. There are no
    foreign keys, so events outlive the rows they mention.
  - `rate_limit_buckets`: shared fixed-window throttling state.
  - `break_glass_mfa` (TOTP ciphertext and last accepted step, for replay
    rejection) and hashed single-use `recovery_codes`.
  - On users: `platform_admin`, `break_glass`, `archived_at` and a `version`
    column, with a CHECK limiting status to active, suspended or archived.
  - A `version` column on roles and groups, for optimistic concurrency.
- The migration seam test (`test/migrations.integration.test.ts`) runs against
  disposable databases. It covers:
  - a fresh migration, and a second run that changes nothing
  - baselining a push-built database while preserving its rows
  - baselining a pre-Google database
  - refusing a half-built database
  - the append-only audit trigger, including the purge opt-in
  - the account status constraint
- The local development database was baselined (2 migrations recorded) and
  received `0002`. The backend suite passed (86 pass, 1 skip, 0 fail), and both
  packages typecheck.
- Deployment docs now use `db:migrate` and warn against returning to `db:push`.
  The production database has not been migrated. The first production
  `db:migrate` will baseline it, and it should be backed up first.

Known limits of this increment:

- The purge opt-in is a transaction setting, not a separate database role. The
  spec's separately privileged retention task is still outstanding.
- The TOTP encryption key is not configured or validated yet.
- The permission-key rename (`access` → `userManagement`) belongs to phase 2
  and is not started.

## Third increment — rollout phase 2 (permission key rename: expand + migrate)

The `access` role permission is renamed `userManagement`, using the
expand/migrate steps from the spec. Authorization is unchanged: the gate still
uses the strongest level held at any hotel, now read under the new key. Scoping
it per hotel belongs to phase 4.

- **Readers:** all role permissions pass through `normalizeRolePerms`
  (`backend/src/lib/permissions.ts`). It reads `userManagement`, then falls back
  to `access`. A missing or unrecognised level becomes `none`, never `crud`. The
  result carries only canonical resources, so a role's rank never counts this
  permission twice.
- **Writers and responses:** stored roles and API responses carry both keys at
  the same level, so a client on the previous release keeps working. Role
  create/update accepts either key and returns `400` when the two disagree. The
  role dialog submits only canonical keys.
- **Migration `0003_user_management_permission`:**
  - Copies each role's exact level into `userManagement`, and adds `access` to
    any role that lacks it.
  - Sets `platform_admin` for every account that holds `crud` on the permission
    at any hotel, directly or through a group attached to a hotel. This matches
    who has global User Management authority today. Suspended holders keep the
    flag but still cannot authenticate.
  - Rolls the migration back if Active holders exist but no Active Platform
    Administrator would remain.
- **Seeds:** both use the new key. `db:seed:admin` now updates the built-in admin
  role instead of skipping it, and marks the bootstrap account as a Platform
  Administrator. It still never changes an existing credential.
- **Verification:**
  - Migration seam test: built-in and custom legacy roles, including a missing
    key and an invalid level, keep their exact levels. Platform authority lands
    on the direct, group and suspended holders, and not on viewers or members
    of a group with no hotels. A rerun changes nothing.
  - API integration tests: legacy-key and new-key role writes, the disagreement
    `400`, and a role with neither key granting no authority.
  - Dev database: all three built-in roles now carry `userManagement`, and chai
    and ohm are the Platform Administrators. The backend suite passed (97 pass,
    1 skip, 0 fail); the frontend tests passed (21/21); both packages typecheck.

Still outstanding for the rename:

- Phase 4: the renamed UI route, `/api/user-management` with a temporary
  compatibility mount, and Hotel Administrator scoping.
- Contract step: stop writing `access`, drop the key and its fallback, and
  refuse to proceed if any role would lack `userManagement`.
- `platform_admin` is recorded but not yet consulted by any route.

## Fourth increment — rollout phase 3 (server-side sessions, core)

Bearer JWTs in local storage are replaced by opaque, revocable sessions in
PostgreSQL. Following the decision for this increment, no legacy JWT is
accepted: every user signs in again once after the deploy.

- **Cookies:**
  - `om-session` holds a random identifier and is HttpOnly. Only its SHA-256
    digest is stored.
  - `om-csrf` holds a second random value the page reads and sends back as
    `X-CSRF-Token` on writes. Its digest is stored on the session, so a token
    from another session is refused.
  - Both are SameSite=Strict, Path=/, and last 12 hours. They are Secure
    whenever `FRONTEND_URL` is https. Sign-in responses are `no-store`.
- **Every protected request** resolves the cookie to a session that is not
  revoked and belongs to an Active account. It also enforces the idle timeout
  (30 minutes for accounts with User Management authority, 60 otherwise) and
  the 12-hour absolute limit. A session found dead is revoked with its reason,
  and the cookies are cleared. An expired session answers 401 with
  `code: session_expired`.
- **Every POST/PUT/PATCH/DELETE under `/api`,** sign-in included, must carry
  the exact `FRONTEND_URL` Origin.
- **Revocation:**
  - Logout revokes the current session.
  - Suspension revokes every session of the account in the same transaction,
    and reactivation does not revive them.
  - A password change revokes every session, the current one included.
  - Issuing a session locks the account row, so it cannot race a suspension.
- **Configuration:** `FRONTEND_URL` is validated at startup in
  `security-config.ts`, the single owner of this setting. It must be https,
  except for localhost in development. `JWT_SECRET` and all JWT signing code
  are gone, and compose now requires `FRONTEND_URL`. Consequence: sign-in over
  the plain-HTTP office LAN (port 80) is refused, so staff sign in through the
  tunnel's https hostname.
- **Frontend:** no credential in local storage (a leftover `om-token` is
  removed on load). Requests carry the CSRF header from the cookie. Route
  guards ask `/api/auth/me`, and logout calls the server.
- **Verification:**
  - Session integration tests: cookie attributes, digest-only storage,
    bearer/forged/missing cookie refusal, CSRF (missing, wrong, and bound to
    another session), foreign and missing Origin, logout revocation, suspension
    by API and directly in the database without resurrection, idle 60 and 30,
    absolute expiry, password-change revocation.
  - Startup tests for `FRONTEND_URL`.
  - A live check through the dev server: sign-in, then logout refused without
    the CSRF token and accepted with it, then the same cookie refused.
  - Results: backend suite 109 pass, 1 skip, 0 fail; frontend 21/21; both
    packages typecheck.
- **Provenance:** two drafts of this increment were written concurrently in
  the same working tree and merged into this one design. The session middleware
  and the auth integration suite were rewritten during the merge.

Still outstanding from the session part of the spec:

- Self-service session list and per-device revocation.
- Session identifier rotation after sensitive actions, and the five-minute
  recent-authentication requirement.
- Security audit events for session creation, expiry and revocation.
- A trusted client address: `clientIp` records nginx's `X-Real-IP` as
  descriptive metadata only.
- Google sign-in still auto-provisions accounts on the allowed domain; that is
  removed with pre-provisioning in phase 4.

## Fifth increment — rollout phase 4, part 1 (identity and account lifecycle)

- **Google sign-in never creates an account.** `googleSignInDecision`
  (`backend/src/lib/google-identity.ts`) decides which account a verified
  Google identity may use:
  - An account already linked to that Google subject signs in if it is Active,
    even after its email changed.
  - Otherwise the Active account with the matching email is linked on first
    sign-in.
  - A different Google account using an already-linked email is refused, and so
    are unknown, suspended and archived accounts.
  - Every refusal shows the same message. The link is written with a guard, so
    two concurrent links of one account cannot both succeed.
  - `GOOGLE_ALLOWED_DOMAIN` is now only a hint that pre-selects a domain on
    Google's sign-in screen.
  - **Deploy note:** staff who relied on domain auto-provisioning can no longer
    sign in until an administrator creates their account.
- **New accounts are Google-only.** User creation takes no password and stores
  none, even when one is submitted.
- **Archive replaces hard deletion.**
  - `DELETE /api/access/users/:id` sets the account to Archived and revokes
    every session.
  - The email stays reserved; creating a new account with it is refused with a
    hint to restore instead.
  - An archived account cannot be edited or given access.
  - `POST /api/access/users/:id/restore` makes it Active again. Its old sessions
    stay revoked.
- **Self-management guards:** an administrator cannot suspend or archive their
  own account, or change their own assignments or group memberships, through
  User Management.
- **Last active Platform Administrator:** suspension and archiving run in a
  transaction under an advisory lock, and are refused (409) when they would
  leave no Active Platform Administrator.
- **Frontend:**
  - The user dialog drops the temporary password field.
  - The drawer offers Archive and Restore, and shows an ARCHIVED status.
  - The access controls are disabled on your own account and on archived
    accounts, with an explanation derived from the same rule the server
    applies.
- **Verification:**
  - Unit tests for the Google sign-in rule.
  - The last-administrator guard against a disposable database, so the demo
    administrators are never touched.
  - API integration tests: Google-only creation, archive and restore (sessions,
    sign-in, email reservation, edit and access refusal, no session revival),
    404s, self guards.
  - A live check through the dev server that changes no data: archiving your
    own account is refused, and restoring an account that isn't archived is
    refused.
  - Results: backend suite 120 pass, 1 skip, 0 fail; frontend 21/21. After two
    follow-up type fixes, both packages typecheck and the affected suites pass
    (23/0).

Still outstanding in phase 4:

- Break-glass administrators: CLI-only creation and recovery, password plus TOTP.
- Hotel Administrator scoping of User Management.
- The `/user-management` route and API rename.
- Granting or removing platform authority. No endpoint sets `platform_admin`
  yet; today only the migration and `db:seed:admin` do.
- Self-demotion through other paths: editing a role you hold, or a group you
  belong to.
- Recent-authentication for sensitive actions, and audit events.

## Sixth increment — rollout phase 4, part 2 (Hotel Administrator scoping)

User Management authority is no longer "the strongest level held at any
hotel". `backend/src/lib/user-management-scope.ts` defines two kinds of
administrator, and every `/api/access` endpoint enforces the difference:

- **Platform Administrator** (`users.platform_admin`): unscoped.
- **Everyone else:** scoped to the hotels where they hold the User Management
  permission — READ to see, CRUD to change.

Anything outside the caller's view answers 404, so a response never confirms
that it exists.

- **What a Hotel Administrator sees:**
  - Only people connected to their hotels, directly or through a group, and for
    each person only those hotels' assignments and effective access.
  - Only groups whose hotels all lie inside their view. A group reaching other
    hotels still counts toward effective access but is not named.
  - Only their own hotels.
  - Every role, flagged `assignable` when they may give it, with usage counted
    only within their view.
  - `GET /api/access/scope` reports the caller's scope, so the page can derive
    its controls from the same rule.
- **Platform Administrators only:** creating an unassigned account, editing
  profiles, suspending, archiving, restoring, and every role change.
- **Adding people:** `POST /api/access/users/attach` gives a person, found by
  exact email, a role at one hotel. When no account uses that email and a name
  is supplied, it creates the Google-only account in the same step, so a Hotel
  Administrator never creates an account they cannot then see. Archived accounts
  and the caller's own account are refused.
- **Changing access:**
  - A Hotel Administrator changes assignments and group memberships only at the
    hotels and groups they manage; everything else stays as it was.
  - They cannot give a role that carries User Management CRUD, so only a
    Platform Administrator can create another administrator. Rows that are
    already in place are never refused.
  - They can create, edit and delete groups lying wholly inside their CRUD
    hotels, but only with roles they may give and with members already connected
    to those hotels.
- **Self-demotion through groups:** no administrator can change the role, the
  hotels or their own membership of a group they belong to, or delete that
  group. Renaming it is allowed. Consequence in the demo data: chai and ohm
  cannot change the grant of IT Operations themselves; another administrator
  must.
- **Seeding:** `db:seed` marks Platform Administrators with the same rule as
  migration 0003, so a freshly seeded demo has administrators.
- **Frontend:**
  - `/api/auth/me` includes `platformAdmin`, and the navigation offers User
    Management only to people who hold that authority somewhere.
  - The page reads `GET /scope`: profile, lifecycle and role controls appear
    only for Platform Administrators.
  - "Add to a property by email" opens the attach dialog.
  - Group actions, and the drawer's per-property roles and group toggles, unlock
    only where the caller may change them; role pickers list only assignable
    roles.
- **Verification:**
  - Unit tests for the scope rules.
  - Integration tests for an rh2 Hotel Administrator with staff at rh2, rh3 and
    both:
    - Visibility and redaction.
    - The scope endpoint and role assignability.
    - Refusal of every Platform-only action.
    - Attach by email, including account creation.
    - Preserving assignments at other hotels.
    - 404 for people outside their hotels.
    - Group scoping.
    - The group self-demotion guard.
  - Results: backend suite 134 pass, 1 skip, 0 fail; frontend 21/21; both
    packages typecheck.
  - The page was not exercised in a browser: the dev servers had been stopped
    for low memory.

Still outstanding in phase 4:

- Break-glass administrators: CLI-only creation and recovery, password plus TOTP.
- Renaming the route and API to `/user-management`, with a temporary
  compatibility mount.
- A control for granting or removing platform authority.
- Self-demotion by editing the perms of a role you hold.
- Optimistic concurrency: the `version` columns exist but are unused.
- Recent-authentication for sensitive actions, and audit events.

## Remaining specification work

Opaque PostgreSQL sessions, permanent revocation, cookie/CSRF migration, Google-only
pre-provisioning, Break-glass bootstrap/recovery and MFA, account archival,
Platform/Hotel Administrator boundaries, full User Management rename/data migration,
protected floor-plan delivery, backend/edge throttling, audit retention, and
production security-header configuration remain to be implemented and verified.

The code changes have not been deployed. Test fixtures are created and removed by
the integration suite; no production deployment or credential rotation is implied.

## Verification

Backend type checking and the frontend production build pass. The final backend
test run passed 80 tests, skipped the one Google-enabled provider test because
Google is not configured, and failed none. The integration suite used the
configured PostgreSQL database with operator approval, not a disposable database.
One intermediate whole-suite run failed during floor-suite setup; a focused floor
run and the final whole-suite run passed. The transient setup failure's cause has
not been established, so this is not evidence of a stable isolated CI environment.
