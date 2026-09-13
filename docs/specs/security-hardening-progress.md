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
