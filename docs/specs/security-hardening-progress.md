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
