# Authentication and Authorization Security Review

Last reviewed: 2026-09-13  
Revision: `75bab17150649bca6cd0410674157a7757b13b5e`

## Summary

This review covers authentication and authorization across the React frontend,
Bun/Hono backend, database-backed RBAC, Google OAuth flow, and deployment
configuration. It found four source-validated issues:

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| SEC-001 | High | Suspended accounts retain access through existing bearer tokens | Open |
| SEC-002 | High | Administrator password resets assign a shared predictable password | Open |
| SEC-003 | High | Missing `JWT_SECRET` activates a known signing-key fallback | Open |
| SEC-004 | Medium | Omitting floor `kind` bypasses CCTV read authorization | Open |

The review was an offline static source analysis. It did not inspect a live
deployment, its environment variables, TLS termination, database contents, or
external Google OAuth configuration. No exploit payloads were run.

## Security model

The browser stores a 24-hour JWT in `localStorage` and sends it as an
`Authorization: Bearer` header. The JWT contains the user ID. Protected backend
routes verify the token and then load the user's current direct assignments and
group grants from PostgreSQL.

Permissions are scoped per property and separated into `devices`, `floors`,
`cctv`, and `access`, each with `none`, `read`, or `crud`. Access-control
administration is intentionally global: the highest `access` permission held on
any assigned property controls user, role, and group management.

Google sign-in uses the server-side authorization-code flow. The callback checks
a random state cookie, verifies the Google token's signature, issuer, audience,
and verified-email claim, then issues the same local JWT used by password login.

## SEC-001: suspended accounts retain active sessions

**Severity:** High  
**CWE:** CWE-863 — Incorrect Authorization

The common authentication middleware verifies only the JWT signature and expiry,
sets its `sub` claim as the current user ID, and immediately invokes the protected
route. It does not load the user or require `status === "active"`.

Password and Google login reject suspended users, but this check runs only when a
new token is issued. A token obtained before suspension remains valid for up to 24
hours. Because RBAC continues loading the user's existing assignments and groups,
the suspended user retains all previous read and mutation permissions. A suspended
access administrator can also use the old token to reactivate its own account.

Evidence:

- [`backend/src/middleware/auth.ts`](../backend/src/middleware/auth.ts#L17) accepts
  the JWT subject without checking current account state.
- [`backend/src/routes/auth.ts`](../backend/src/routes/auth.ts#L41) issues stateless
  tokens with a 24-hour expiry.
- [`backend/src/routes/access.ts`](../backend/src/routes/access.ts#L191) updates the
  account status without revoking existing tokens.
- [`backend/src/lib/rbac.ts`](../backend/src/lib/rbac.ts#L92) derives permissions
  from assignments and groups without checking the user's status.

Required fix:

1. Resolve the token subject to an existing active user inside the shared
   authentication middleware before invoking protected routes.
2. Add a server-controlled session version or revocation timestamp to invalidate
   existing tokens immediately after suspension, password reset, password change,
   and other account-security events.
3. Add an integration test that issues a token, suspends its user, and verifies
   that every protected API rejects that token.

## SEC-002: password reset assigns a shared predictable password

**Severity:** High  
**CWE:** CWE-1392 — Use of Default Credentials

The frontend's normal reset action sends an empty JSON object. The backend treats
the replacement password as optional and substitutes a fixed source-visible value,
then stores it as the user's ordinary password. There is no expiry, single-use
state, or mandatory password change.

After an administrator resets an account, anyone who knows the account email and
the reset convention can authenticate as that user until the password is changed.
The reset endpoint itself is authorization-protected; the vulnerability is the
predictable credential it creates.

Evidence:

- [`frontend/src/lib/access.ts`](../frontend/src/lib/access.ts#L77) always submits
  an empty reset body.
- [`backend/src/routes/access.ts`](../backend/src/routes/access.ts#L217) substitutes
  and stores the fixed fallback password.
- [`backend/src/shared/types.ts`](../backend/src/shared/types.ts#L137) makes the
  replacement password optional.

Required fix:

1. Remove the fixed password fallback.
2. Issue a cryptographically random, short-lived, single-use reset token or
   temporary credential.
3. Prevent the temporary credential from accessing protected resources until the
   user chooses a new password.
4. Do not return a reusable plaintext password from the reset API.
5. Test expiry, single use, mandatory replacement, and uniqueness across resets.

## SEC-003: missing JWT configuration enables token forgery

**Severity:** High  
**CWE:** CWE-321 — Use of Hard-coded Cryptographic Key

The JWT signer and verifier both silently use the same fixed source-visible key
when `JWT_SECRET` is missing or empty. The direct Bun startup path validates only
`PORT` and binds the API to all interfaces, so it can start successfully in this
unsafe state.

On an affected direct or custom deployment, an unauthenticated attacker can sign
an HS256 token with an existing numeric user ID as its subject. The middleware
will accept that token, after which database-backed RBAC grants the selected
user's permissions.

Docker Compose requires `JWT_SECRET`, so the standard Compose path is protected
against an absent value. The issue remains reachable through the documented
direct `dev` and `start` commands or other deployment methods.

Evidence:

- [`backend/src/middleware/auth.ts`](../backend/src/middleware/auth.ts#L4) defines
  the verifier's fixed fallback.
- [`backend/src/routes/auth.ts`](../backend/src/routes/auth.ts#L20) defines the
  signer's identical fallback.
- [`backend/src/index.ts`](../backend/src/index.ts#L4) omits `JWT_SECRET` from
  startup validation.
- [`backend/package.json`](../backend/package.json#L5) exposes direct backend
  startup commands.
- [`docker-compose.yml`](../docker-compose.yml#L31) requires the variable for the
  Compose deployment.

Required fix:

1. Centralize security-critical environment parsing in one startup configuration
   module shared by the signer and verifier.
2. Require a high-entropy `JWT_SECRET` and terminate before binding the server if
   it is absent, empty, too short, or a documented placeholder.
3. Remove every signing-key fallback from application source.
4. Add startup tests for absent, empty, placeholder, and valid secrets.

## SEC-004: omitted floor kind bypasses CCTV authorization

**Severity:** Medium  
**CWE:** CWE-863 — Incorrect Authorization

The floor-list query makes `kind` optional. When the caller sends
`kind=cctv`, the route correctly requires `cctv:read`. When the caller omits the
field, the route checks only `floors:read` and also omits the SQL kind predicate.
The response can therefore include CCTV floor layouts and their attached camera
pins.

An authenticated user with a custom role granting `floors:read` and `cctv:none`
can exploit this within an assigned property. The response may contain camera
placement, direction, IP address, NVR, codec, and retention metadata. The built-in
roles all grant CCTV read, so the issue requires a supported custom permission
combination.

Evidence:

- [`backend/src/routes/floors.ts`](../backend/src/routes/floors.ts#L13) declares
  `kind` as optional.
- [`backend/src/routes/floors.ts`](../backend/src/routes/floors.ts#L24) selects the
  authorization resource from that optional value and filters only when present.
- [`backend/src/shared/types.ts`](../backend/src/shared/types.ts#L112) models floor
  and CCTV permissions independently.
- [`backend/src/db/schema.ts`](../backend/src/db/schema.ts#L149) shows the camera
  metadata returned with floor pins.

Required fix:

1. Require `kind` and authorize the requested kind, or derive every permitted
   kind from the caller's effective permissions when `kind` is omitted.
2. Apply the allowed-kind restriction to the database query and attached pins.
3. Test a custom role with `floors:read` and `cctv:none` against explicit CCTV and
   omitted-kind requests.

## Controls reviewed without a confirmed finding

- Device reads and mutations validate the target property's permission. Device
  updates cannot change `hotelId`.
- Floor mutations use both property ID and floor ID, and the database uses a
  composite property/floor relationship.
- Google OAuth validates state, signature, issuer, audience, and verified email.
  Newly provisioned accounts initially receive no property assignments.
- Access-management endpoints consistently apply the documented global `access`
  permission gate.
- Production demo seeding is blocked unless explicitly overridden. Production
  has a separate administrator-bootstrap command.
- Uploaded floor-plan URLs are intentionally public in the current source and
  nginx configuration. This needs a product decision if floor plans are expected
  to be confidential.

## Deployment questions

- Confirm that production terminates TLS before requests reach the checked-in
  HTTP nginx server. Bearer tokens and passwords must never travel over plaintext
  HTTP outside a trusted local development environment.
- Confirm whether uploaded floor plans should remain readable without
  authentication. If they are private operational data, serve them through an
  authenticated, property-scoped endpoint instead of public static middleware.

## Fix priority

Fix SEC-001 and SEC-002 first because they affect normal account-administration
workflows. Fix SEC-003 before allowing any direct or custom backend deployment.
Fix SEC-004 before assigning custom roles that separate floor and CCTV access.

After remediation, rerun the authentication review and verify each issue with
integration tests against the real Hono routes and a disposable PostgreSQL
database.
