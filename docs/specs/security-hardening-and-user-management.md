# Spec — Harden authentication, authorization, and User Management

**Status:** ready-for-agent (pending an issue tracker — see Further Notes)  
**Triage label:** `ready-for-agent`

## Problem Statement

Ops Monitor exposes hotel asset, floor-plan, camera, network, and account data
through a public hostname carried by a Cloudflare Tunnel. The tunnel solves the
home network's lack of a public IP, but it does not make the application itself a
trusted network. The application must therefore remain safe when reached from the
public internet.

The current authentication and authorization implementation does not provide that
assurance. A Suspended account can keep using an existing bearer token for up to
24 hours. Administrator password reset creates a shared, predictable password.
Missing JWT configuration silently activates a source-visible signing key. A
floor-list request that omits its kind can disclose CCTV floors and camera pins to
a user who has no CCTV permission. Session credentials are stored in browser
local storage, logout cannot revoke them, uploaded floor plans are publicly
addressable, and the backend has no independent brute-force protection or
Security audit events.

The current Access Control area also conflicts with the intended domain. The
product capability is now called **User Management**, and that rename must include
the UI, browser route, API, permission model, and persisted role permissions. The
existing page already offers broad CRUD for users, roles, groups, and hotel
assignments, but it creates ordinary users with local temporary passwords,
hard-deletes them, allows dangerous self-management, and treats User Management
permission from any one hotel as global authority over every hotel.

The result is a cluster of related risks rather than four isolated defects:
identity, session lifetime, account lifecycle, permission scope, sensitive-file
delivery, and audit ownership are all distributed across routes and conventions.
We need one coherent security model that makes the intended invariants explicit
and testable.

## Solution

Replace browser-stored bearer JWTs with opaque, revocable server-side sessions in
PostgreSQL. Deliver the session identifier only in a secure HttpOnly cookie, add
CSRF protection, enforce idle and absolute timeouts, and revoke sessions
immediately when an account is suspended, archived, recovered, or explicitly
logged out.

Use Google sign-in as the normal staff identity path. A User account must be
created by an administrator before its verified Google identity can be linked;
unknown Google users are rejected and never auto-provisioned. Ordinary accounts
have no local password. A very small number of Break-glass administrators are
created through the production admin seed, authenticate with a unique local
password plus MFA, and can be recovered only through an SSH/CLI procedure.

Rename Access Control to User Management throughout the product and permission
model. Introduce a deliberate split between Platform Administrators and Hotel
Administrators: Platform Administrators own global identity lifecycle, roles,
cross-hotel groups, and recovery; Hotel Administrators can see and manage only
hotel-scoped membership and assignments within hotels they administer. Preserve
every existing permission during an expand/migrate/contract rollout so the rename
cannot lock out administrators.

Treat floor plans and CCTV metadata as Operational security data. Remove public
file delivery, authorize every read against the requested hotel and resource,
and filter omitted-kind floor queries to exactly the kinds the caller may read.

Apply defense in depth around the public Cloudflare Tunnel: HTTPS remains the
public transport, Cloudflare supplies edge WAF and rate limiting, and the backend
independently rate-limits authentication and privileged mutations. The
application—not Cloudflare Access—continues to own Google sign-in, sessions, and
RBAC, avoiding two competing identity layers. Record authentication, account,
session, and permission changes as structured Security audit events retained for
180 days.

## User Stories

1. As a staff member, I want to sign in with my approved Google account, so that I
   do not maintain another everyday password.
2. As a staff member, I want the application to reject an unregistered Google
   account, so that possession of a Google identity does not create application
   access.
3. As a staff member, I want my first approved Google sign-in to link to the
   account an administrator prepared, so that my hotel permissions are attached
   to the correct identity.
4. As a staff member, I want a generic sign-in failure response, so that an
   attacker cannot enumerate registered email addresses.
5. As a staff member, I want my session credential protected from page JavaScript,
   so that one client-side injection cannot simply read and export it.
6. As a staff member, I want logout to terminate my server-side session, so that a
   copied cookie cannot remain valid after I sign out.
7. As a staff member, I want all of my sessions listed and individually revocable,
   so that I can remove a device I no longer trust.
8. As a staff member, I want normal sessions to expire after 60 minutes without
   activity, so that an unattended workstation does not remain open indefinitely.
9. As an administrator, I want privileged sessions to expire after 30 minutes
   without activity, so that unattended administration access has a smaller
   attack window.
10. As any authenticated user, I want every session to end after at most 12 hours,
    so that continuous activity cannot extend a stolen session forever.
11. As a staff member, I want state-changing requests protected from CSRF, so that
    another website cannot act through my authenticated browser.
12. As a staff member, I want a clear expired-session response and return to the
    sign-in page, so that security expiry does not look like corrupted data.
13. As a Suspended account holder, I want every existing session rejected
    immediately, so that suspension has one unambiguous meaning.
14. As an Archived account holder, I want authentication and active access to
    remain disabled, so that a former staff identity cannot silently return.
15. As a Platform Administrator, I want to revoke all sessions for an account, so
    that I can respond to a suspected compromise without changing unrelated
    accounts.
16. As a Platform Administrator, I want security-sensitive actions to require
    recent reauthentication, so that possession of an old unlocked session is not
    enough to take over User Management.
17. As a Google user, I want password controls hidden from my profile, so that the
    UI does not offer a credential type my account does not have.
18. As a Google user, I want an administrator to be unable to add a local password
    to my account through reset, so that my identity remains Google-only.
19. As a Break-glass administrator, I want an independent local sign-in path, so
    that I can recover the application if Google sign-in is unavailable.
20. As a Break-glass administrator, I want MFA required with my password, so that
    an offline password leak is not sufficient for entry.
21. As a server operator, I want Break-glass administrator creation and recovery
    available only through an authenticated server CLI, so that no public reset
    endpoint exists for the most privileged accounts.
22. As a server operator, I want the production admin seed to create the initial
    Platform Administrator without loading demo users, so that a fresh deployment
    has a controlled bootstrap path.
23. As a server operator, I want recovery to rotate the Break-glass credential and
    revoke every prior session, so that an old credential or session cannot remain
    useful.
24. As a security reviewer, I want missing or placeholder security configuration
    to stop the process before it binds a port, so that deployment mistakes fail
    closed.
25. As a security reviewer, I want one configuration owner for security-critical
    environment values, so that signers, verifiers, cookies, and OAuth cannot
    disagree about defaults.
26. As a security reviewer, I want no source-visible signing-key fallback, so that
    an omitted environment value cannot enable token forgery.
27. As a Platform Administrator, I want the product navigation and page to say
    User Management, so that the language matches the capability being managed.
28. As an API consumer, I want User Management exposed under its new API name, so
    that public contracts no longer preserve the misleading Access Control term.
29. As a security reviewer, I want persisted role permissions migrated from the
    old access key to the User Management key without changing their level, so
    that terminology migration cannot create privilege escalation or lockout.
30. As an operator, I want old and new application versions to overlap safely
    during rollout, so that a partial deployment cannot remove every
    administrator's authority.
31. As a Platform Administrator, I want to create a Google-only User account with
    name and contact details before assigning access, so that identity preparation
    and permission assignment remain separate steps.
32. As a newly created user with no assignment, I want to see an explicit
    no-access state, so that an empty dashboard is not mistaken for missing data.
33. As a Platform Administrator, I want to edit a user's global identity and
    profile fields, so that corrections are reflected everywhere.
34. As a Hotel Administrator, I want to attach an existing User account to a hotel
    I administer, so that a multi-hotel employee does not need duplicate accounts.
35. As a Hotel Administrator, I want to assign only approved roles within my own
    hotels, so that my authority cannot escape its hotel boundary.
36. As a Hotel Administrator, I want the user list restricted to people connected
    to my hotels, so that another hotel's staff directory is not disclosed.
37. As a Hotel Administrator, I want cross-hotel assignments and groups omitted
    from responses, so that hidden data cannot leak through an otherwise scoped
    user record.
38. As a Hotel Administrator, I want to remove a user's access to my hotel without
    archiving the global account, so that employment at another hotel is not
    disrupted.
39. As a Platform Administrator, I want global role and cross-hotel group
    management reserved to my scope, so that Hotel Administrators cannot change
    policy for properties they do not own.
40. As a Platform Administrator, I want to archive a former User account rather
    than hard-delete it, so that Security audit events retain a stable subject.
41. As a Platform Administrator, I want to restore an Archived account explicitly,
    so that accidental archival is recoverable and recorded.
42. As a Platform Administrator, I want an archived email to remain reserved, so
    that a new person cannot inherit the former person's audit identity.
43. As an administrator, I want the application to prevent self-suspension,
    self-archival, and self-demotion through User Management, so that I cannot
    accidentally strand my active session.
44. As an operator, I want the final active Platform Administrator protected from
    suspension, archival, or demotion, so that User Management cannot lock out the
    installation.
45. As a user, I want to edit safe personal profile fields through my Profile, so
    that self-service profile maintenance remains possible without self-granting
    authority.
46. As a Platform Administrator, I want account, role, group, assignment, and
    membership changes to be atomic, so that partial database failures do not
    leave access half-applied.
47. As an administrator, I want concurrent edits detected, so that one editor
    cannot silently overwrite another administrator's newer permission change.
48. As an API consumer, I want mutation requests for missing users, roles, or
    groups to return a consistent not-found result, so that success always means a
    real target was changed.
49. As a user with floor permission but no CCTV permission, I want omitted-kind
    floor requests to return only workstation floors, so that CCTV information is
    never included incidentally.
50. As a user with CCTV permission but no workstation-floor permission, I want the
    same query filtered to the CCTV data I may read, so that the API derives a
    correct allowed-kind set in both directions.
51. As a user with neither permission, I want the floor request refused or empty
    without revealing which floors exist, so that denial does not become a data
    oracle.
52. As a CCTV-authorized user, I want camera pins returned only with an authorized
    CCTV floor, so that pin attachment cannot bypass the floor filter.
53. As a hotel user, I want floor plans loaded through an authenticated,
    hotel-scoped endpoint, so that knowing an old upload URL is not sufficient to
    retrieve one.
54. As a security reviewer, I want public upload paths removed, so that search
    engines, browser history, proxies, and shared links cannot expose Operational
    security data.
55. As an authorized user, I want protected floor images to avoid shared/public
    caching, so that a cache cannot serve one hotel's plan to another user.
56. As an administrator, I want uploaded images validated for supported type,
    dimensions, and size, so that access protection does not weaken existing file
    safety checks.
57. As a security reviewer, I want failed sign-ins rate-limited by both account and
    client address, so that distributed guessing and single-source flooding are
    both constrained.
58. As an operator, I want Cloudflare rate limiting in front of the public login,
    so that high-volume traffic is rejected before consuming home-server
    resources.
59. As an operator, I want the backend to enforce its own limits, so that an edge
    configuration mistake or internal path does not remove brute-force defense.
60. As a legitimate user, I want throttling to return a retry time rather than
    permanently lock my account, so that attackers cannot create an indefinite
    denial of service.
61. As a security reviewer, I want every successful and failed authentication
    attempt recorded without credentials, so that suspicious activity can be
    investigated safely.
62. As a Platform Administrator, I want suspension, restoration, archival, session
    revocation, role, group, and assignment changes recorded with actor and target,
    so that privileged actions are attributable.
63. As an auditor, I want Security audit events retained for 180 days, so that a
    recent incident can be reconstructed.
64. As an auditor, I want logs to contain event, result, actor, target, time, client
    address, and correlation identifier but never passwords, session secrets,
    OAuth tokens, TOTP secrets, or recovery codes.
65. As an operator, I want audit retention enforced by a controlled purge process,
    so that normal application requests cannot edit or erase history.
66. As a security reviewer, I want MFA required for every Google user and
    Break-glass administrator, so that password or Google-cookie compromise has an
    additional barrier.
67. As an operator, I want the Cloudflare Tunnel to remain the only remote ingress,
    so that hardening does not require a public IP or an open inbound port.
68. As an operator, I want Cloudflare Access left out of application identity, so
    that there is one application authentication model and the Break-glass path is
    not blocked by a second login system.
69. As a browser user, I want HTTPS and strict security headers on the public
    origin, so that sessions cannot downgrade to plaintext or be framed by another
    site.
70. As an implementation agent, I want every original security finding mapped to
    an integration test, so that completing the migration cannot silently preserve
    the vulnerable behavior.

## Implementation Decisions

### Security invariants

- Every protected request resolves an opaque session to one existing Active User
  account before authorization. Missing, expired, revoked, Suspended, or Archived
  subjects fail before route logic runs.
- Authorization is evaluated against current database state and the final hotel,
  resource kind, and target identity. Client-supplied filters never choose a less
  restrictive permission check.
- Ordinary staff identities are Google-only. Local passwords exist only for
  explicitly marked Break-glass administrators.
- Operational security data is never served by unauthenticated static middleware.
- User Management authority is either platform-wide by explicit platform role or
  hotel-scoped by an assignment. Permission from one hotel does not silently
  become authority over every hotel.
- All security-sensitive state transitions produce a Security audit event whether
  they succeed or fail.

### Session architecture

- Replace bearer JWTs with cryptographically random opaque session identifiers.
  Store only a one-way digest of each identifier in PostgreSQL; the plaintext
  value exists only in the browser cookie.
- The session record owns its user, creation time, last-seen time, absolute expiry,
  revocation time and reason, authentication method, client metadata, and CSRF
  binding. It never stores a plaintext credential or OAuth token.
- Send the session identifier in a cookie marked HttpOnly, Secure in every
  non-local environment, SameSite=Strict, and scoped to the application root. Do
  not copy it to local storage, session storage, application state, URLs, or logs.
- Normal sessions have a 60-minute idle timeout. A session with effective User
  Management authority has a 30-minute idle timeout. Every session has a 12-hour
  absolute timeout. The server enforces all three rules.
- Update last-seen state at a throttled cadence rather than on every request, while
  retaining precise enough enforcement for the declared timeout.
- Logout revokes the current session before clearing its cookie. Account
  suspension, archival, Break-glass recovery, password change, and explicit
  administrator revocation invalidate every affected session immediately.
- Expose a self-service session list containing recognizable device/time metadata,
  never identifiers, and permit the user to revoke individual sessions or all
  other sessions.
- Unsafe HTTP methods require both an allowed Origin and a session-bound CSRF
  header. SameSite cookies are defense in depth, not the sole CSRF control.
- Authentication and sensitive User Management actions rotate the session
  identifier. A privileged action requires authentication within the preceding
  five minutes; otherwise the user completes Google reauthentication or, for a
  Break-glass administrator, password plus TOTP again.

### Identity and MFA

- Google sign-in remains inside the application. Cloudflare Tunnel, WAF, and rate
  limiting sit outside it; Cloudflare Access is not an identity provider for this
  specification.
- An administrator creates an ordinary User account before first sign-in. The
  account starts Active with no local password and may temporarily have no hotel
  assignment, matching the chosen create-then-assign workflow. Until assigned, it
  receives an explicit no-access experience and no Operational security data.
- A verified Google callback may link only to a pre-existing Active account with
  an exactly matching normalized email. Unknown users, Suspended accounts, and
  Archived accounts receive a generic denial and are never created implicitly.
- Once linked, the immutable Google subject is the primary external identity.
  Changing the account email does not silently rebind that subject; identity
  changes require a reviewed unlink/relink transition and a Security audit event.
- The current password reset API and UI are removed for Google-only accounts.
  Profile responses identify the account's authentication method so the frontend
  can omit inapplicable password controls.
- Google MFA is a deployment prerequisite for every approved staff account and is
  enforced in the organization's Google identity policy. The go-live checklist
  must verify this control rather than assuming that displaying a Google button
  proves MFA.
- Break-glass administrators use a unique high-entropy password plus TOTP. TOTP
  secrets are encrypted at rest under a separately configured key; recovery codes
  are one-way hashed, displayed once, and stored offline by the operator.
- The production admin seed is the only bootstrap path. It creates or safely
  reconciles the Platform Administrator, the required platform authority, and its
  initial hotel relationship without demo data. It never resets an existing
  credential implicitly.
- Break-glass creation, credential rotation, TOTP re-enrollment, and recovery-code
  replacement require an interactive SSH/CLI workflow. Each recovery revokes all
  sessions and records an audit event. There is no web-based Break-glass password
  reset.

### Account lifecycle

- Extend account lifecycle to Active, Suspended, and Archived. Suspended is a
  reversible security hold; Archived represents a former account retained for
  history. Neither non-active state can authenticate or retain a live session.
- Archive replaces hard deletion for User accounts. An archived email remains
  reserved and restoration reuses the same account identity.
- Platform Administrators own global identity fields, suspension, archival, and
  restoration. Hotel Administrators remove or assign only their own hotel
  relationships; they cannot archive a person who may still work elsewhere.
- User Management cannot be used to suspend, archive, demote, or remove the
  current actor's own administrative authority. Safe personal fields remain
  editable through Profile.
- The final Active Platform Administrator cannot be suspended, archived, demoted,
  or stripped of the last platform authority. The invariant is checked inside the
  same transaction that applies the proposed change.
- Account creation and later assignment are separate user actions, as selected.
  Each action is atomic and audited. The UI clearly distinguishes an Active
  unassigned account from a partially failed creation.

### User Management rename and authorization

- Rename the visible product capability, browser route, API namespace, backend
  module vocabulary, frontend client vocabulary, permission resource, validation
  types, seed data, tests, and relevant documentation from Access Control/access
  to User Management/userManagement.
- Use `/user-management` for the browser route and `/api/user-management` for the
  API. Keep a temporary browser redirect from the old route and a temporary API
  compatibility mount during the expand/migrate phase; both are removed during
  contract after the new frontend is deployed.
- Keep generic domain phrases such as hotel access, access assignment, effective
  access, Wi-Fi access point, and RBAC. They do not name the renamed product
  capability and must not be mechanically rewritten.
- Preserve stable role identifiers and foreign-key relationships. The rename is a
  capability-key migration, not a role-identity migration.
- Migrate persisted role-permission JSON with an expand/migrate/contract sequence:
  first read and normalize both old and new keys without counting them twice;
  then copy each role's exact existing level to `userManagement`; then deploy new
  writers and clients; finally stop emitting and remove the old key. Missing keys
  default to no authority, never CRUD.
- The migration must preserve custom roles as well as built-in roles. The
  production admin seed must reconcile the new permission key instead of relying
  on conflict-ignore behavior that leaves an old role unmigrated.
- Introduce explicit Platform Administrator authority separate from hotel role
  assignments. A Platform Administrator may manage all identities, global roles,
  cross-hotel groups, and assignments.
- A Hotel Administrator sees only users connected to hotels they administer and
  only the role/group/assignment data that is valid in those hotels. They may
  attach a pre-existing account, create a Google-only account for later
  assignment, assign approved roles, and remove their own hotel's relationship.
  They may not edit global identity linkage, manage platform authority, create or
  alter global roles, operate on cross-hotel groups, or archive accounts.
- Scope every User Management endpoint on the server. Hiding buttons or rows in
  the frontend is usability only and never authorization.
- Hide User Management navigation when the caller has no relevant platform or
  hotel authority while continuing to return a server-side forbidden response for
  direct navigation.
- Whole-set assignment, membership, and group changes run inside database
  transactions. Add optimistic concurrency/version checks so stale editors receive
  a conflict instead of overwriting newer access.
- Missing mutation targets return a consistent not-found response. Delete/archive
  behavior is explicit and cannot report success for a target that never existed.

### Floor and CCTV authorization

- When floor kind is explicit, authorize exactly that resource. When kind is
  omitted, derive an allowed-kind set from current effective permissions and add
  it to the database query.
- Attach Device pins only after both floor and Device rows have been constrained
  to the authorized hotel and kind. A response must never rely on later frontend
  filtering or metadata redaction.
- Preserve the existing combined-floor views: omission remains supported but is
  permission-filtered. Requiring every client to supply a kind is not part of the
  selected solution.
- Add denial behavior that does not reveal inaccessible floor counts or names.

### Protected floor-plan delivery

- Replace public upload URLs with opaque floor-plan identifiers and authenticated
  application endpoints. A read resolves the owning floor and hotel before
  checking floor or CCTV permission according to its kind.
- Remove unauthenticated static serving and public proxy caching for floor plans.
  Protected responses use private/no-store caching semantics and anti-content-
  sniffing headers.
- Preserve existing file type, decoded-image, dimension, and size validation.
  Upload authority is evaluated for a specific hotel rather than from the maximum
  floor permission held anywhere.
- Migrate existing floor records from public paths to protected identifiers. Old
  public paths return not found after migration and are not kept as aliases.

### Configuration, edge, and application defenses

- Centralize security-critical environment parsing and run it before the server
  binds. Missing, empty, too-short, malformed, or documented placeholder secrets
  terminate startup with a non-secret error.
- Remove all signing-key fallbacks. During the session migration, legacy JWT
  verification is allowed only as a bounded compatibility step with an explicitly
  valid configured secret and a short removal deadline; new JWTs are not issued.
- Require the public origin to be HTTPS outside local development. Cloudflare
  remains the TLS edge and the Tunnel remains the only remote ingress; no public
  IP or inbound port is introduced.
- Configure HSTS at the public edge and set application security headers for frame
  denial, MIME sniffing prevention, a restrictive referrer policy, and a
  production Content Security Policy compatible with the built frontend.
- Keep Cloudflare WAF and public rate limits, but also implement backend limits
  using shared persistent state rather than process-local counters. Limit login by
  normalized account key and client address, and limit OAuth initiation,
  privileged reauthentication, and User Management mutations by appropriate actor
  and address keys.
- Backend throttling returns 429 with Retry-After, uses generic responses, and
  decays automatically. It must not create a permanent account lockout an attacker
  can trigger.
- Use trusted proxy configuration to derive the real client address only from the
  Cloudflare/tunnel boundary. Untrusted forwarded-address headers are ignored.

### Security audit events

- Store append-only events containing event type, outcome, actor account and
  session references when known, target type and identifier, hotel scope when
  relevant, timestamp, trusted client address, user agent, correlation identifier,
  and a small allowlisted metadata object.
- Record login success/failure/throttle, Google-link success/failure, logout,
  session creation/revocation/expiry, reauthentication, MFA failure/recovery,
  account creation/suspension/archival/restoration, role/group/assignment changes,
  and denied privileged actions.
- Never record passwords, session identifiers or their digests, OAuth tokens,
  TOTP secrets, recovery codes, CSRF tokens, or full request bodies.
- Retain events for 180 days. Normal application roles may append and authorized
  Platform Administrators may read; neither may update or delete. A separately
  privileged scheduled retention task performs bounded deletion of expired rows.

### Rollout order

1. Add and test fail-closed configuration, audit storage, account lifecycle,
   platform authority, sessions, MFA storage, rate-limit storage, and the real
   checked-in database migrations.
2. Deploy compatibility readers for both the legacy and User Management permission
   keys, then migrate every persisted role and verify that at least one Active
   Platform Administrator remains.
3. Introduce opaque sessions and cookies while accepting legacy JWTs only for a
   short migration window; stop issuing JWTs immediately and remove browser local
   storage credentials.
4. Deploy Google pre-provisioning, Break-glass CLI/MFA, account lifecycle, scoped
   User Management, and the renamed UI/API.
5. Protect floor-plan reads and migrate existing floor-plan references before
   removing public upload serving.
6. Enable backend and Cloudflare rate limits, security headers, monitoring, and
   audit retention.
7. Remove the legacy API mount, permission key, JWT verifier, public upload path,
   and compatibility code only after telemetry shows no remaining use.

Each phase has a reversible application deploy and additive schema state until
the final contract step. The system must refuse a contract migration if it would
leave zero Active Platform Administrators or any role without a normalized User
Management permission.

## Testing Decisions

**What makes a good test.** Tests assert externally visible security behavior:
which request succeeds, which data is returned, which cookie attributes are set,
which session remains valid after a state transition, and which audit event is
observable. They do not mock the authorization result under test or assert private
helper calls. A refactor of storage or routing should preserve the test while a
regression of an invariant should fail it.

**Primary seam.** Use the assembled Hono application with a disposable PostgreSQL
database as the main seam, following the existing floor integration suite. Unlike
the current optional integration setup, security CI must provision the database
and fail if these suites are skipped. This one seam covers authentication,
sessions, authorization, User Management, protected floor plans, throttling, and
audit behavior.

**Browser seam.** Add a small browser-level suite only for behavior the HTTP seam
cannot prove: no credential in local storage, navigation to User Management, the
old-route redirect during migration, Google-only profile controls, CSRF header
wiring, session-expiry UX, scoped rows/buttons, and the create-then-assign journey.
Keep policy assertions in the API suite rather than duplicating them in browser
tests.

**Migration seam.** Start from a database fixture containing legacy built-in and
custom roles with old permission JSON, existing Google-linked users, local users,
assignments, groups, and public floor-plan paths. Run migrations and assert exact
permission preservation, normalized status, protected file references, stable
role/account identifiers, and at least one Active Platform Administrator. Run the
migration twice to prove safe idempotence where intended.

**Startup seam.** Launch the backend configuration entry point as a subprocess and
assert that absent, empty, short, malformed, and placeholder secrets exit before a
listener opens, while a valid production configuration starts. Error output must
name the invalid setting without printing its value.

**Required session scenarios.** Cover issuance, cookie flags, valid use, CSRF
failure, current-session logout, individual and all-other revocation, idle expiry
for normal and administrative sessions, absolute expiry, rotation after
reauthentication, suspension, archival, restoration without session resurrection,
Break-glass recovery, deleted/missing subjects, and concurrent sessions.

**Required identity scenarios.** Cover a pre-created Google-only account, first
subject linkage, repeat sign-in by immutable subject, unknown Google account,
email mismatch, disallowed identity, Suspended and Archived accounts, generic
failure responses, MFA-required Google deployment validation, Break-glass
password-plus-TOTP, recovery codes, replay prevention, and absence of password
reset for Google-only users.

**Required User Management scenarios.** Cover Platform Administrator visibility
and CRUD, Hotel Administrator scoping, multi-hotel users, cross-hotel redaction,
forbidden global profile/archive/role changes by a Hotel Administrator,
self-management blocks, final-Platform-Administrator protection, recent-auth
requirements, archive/restore, email reservation, optimistic conflicts,
transaction rollback, missing targets, and an audit event for every outcome.

**Required rename scenarios.** Cover dual-read compatibility, exact migration of
none/read/crud for built-in and custom roles, old/new API overlap, browser redirect,
new writes, seed reconciliation, and safe removal of the legacy key. Include a
negative test proving that a missing key never defaults to CRUD.

**Required floor scenarios.** Use custom roles that independently vary floor and
CCTV permission. Test both explicit kinds and omitted kind, each allowed-kind
combination, hotel isolation, pin filtering, metadata absence, protected image
read, unauthorized image read, old public URL failure, upload authorization to a
specific hotel, and cache/security headers.

**Required abuse scenarios.** Cover limits by account and address, distributed
account guessing, changing spoofed forwarding headers, Retry-After, automatic
recovery after the window, no permanent lockout, generic throttled responses, and
audit events that contain no secret material.

**Operational verification.** Automated tests do not pretend to prove the live
Cloudflare dashboard configuration. The go-live checklist verifies the Tunnel is
the only remote ingress, HTTPS/HSTS, Google MFA policy, Cloudflare WAF and rate
rules, real client-address handling, no public floor-plan URL, no legacy API use,
backup/restore of session and audit tables, and an alert on repeated auth failures
or use of a Break-glass administrator.

## Out of Scope

- Replacing the Cloudflare Tunnel or obtaining a public IP.
- Using Cloudflare Access as the application's identity source or adding a second
  pre-application login prompt.
- Public registration, Google-domain auto-provisioning, or self-service invitation
  acceptance.
- Local passwords for ordinary staff accounts or a web password-reset flow.
- Email delivery infrastructure; account creation is administrative and
  Break-glass recovery is CLI-only.
- CRUD for hotels themselves. User Management may display and assign existing
  hotels, but hotel lifecycle belongs to a separate capability.
- Allowing Hotel Administrators to create global roles, cross-hotel groups, or
  Platform Administrators.
- Redis or a separate session service. PostgreSQL is the selected state owner for
  this deployment scale.
- A formal compliance certification, external penetration test, managed SIEM, or
  long-term log archive beyond 180 days.
- Changes to Device liveness, camera Recording state, or NVR integration.
- Claiming that any finding is closed before the implementation and original
  vulnerable paths have been revalidated.

## Further Notes

The source review is anchored to revision `75bab17150649bca6cd0410674157a7757b13b5e`.
All four findings in the security review were still present when this spec was
written. The review also found no backend login throttling, no server-side session
table, public upload delivery, and no authentication/User Management integration
tests.

Q17 selected the current two-step product workflow: create the User account, then
open it later to assign roles/groups/hotels. This spec preserves that choice but
removes the insecure part of the current behavior: an ordinary account is created
without a temporary local password. It may authenticate to a no-access state
before assignment, but it cannot read protected hotel data.

The full rename selected in Q16 has a non-obvious data risk. Role permissions are
stored as JSON, so merely renaming TypeScript properties would make existing
administrators appear to have no User Management permission. The staged
expand/migrate/contract sequence is mandatory, not optional cleanup.

The current checked-in initial database migration does not fully represent the
Google-capable schema used by the application. Implementation must create and
test real migrations rather than relying on a schema-push command to make
production drift disappear.

The spec assumes TOTP for Break-glass MFA because the prior decision allowed TOTP
or passkeys but did not choose one. TOTP is the narrower first implementation and
works in the CLI-only recovery model. Passkeys can be proposed separately after
the account/session migration is stable.

The repository does not contain the required issue-tracker and triage-label
configuration. This spec is therefore stored locally with `ready-for-agent`
status but has not been published as an issue. Run
`/setup-matt-pocock-skills` to configure the tracker; after that, publish this
spec and apply the configured `ready-for-agent` label.
