# Spec — Publish Ops Monitor at `map.csprint.co.th` via the existing Cloudflare Tunnel

**Status:** ready-for-agent (pending an issue tracker — see Further Notes)
**Triage label:** `ready-for-agent`

## Problem Statement

Ops Monitor currently runs nowhere that IT Operations staff can actually use it.
The stack is complete — Device inventory, floor maps, per-property access control —
but it only exists on a developer machine.

The deploy host has **no public IP**. It sits behind a router on the local network,
so the documented deployment path (publish ports 80/443, issue a Let's Encrypt
certificate, point an A record at the box) cannot work at all. There is no inbound
reachability to forward.

Two further problems block publishing even if reachability were solved:

1. **The login page advertises credentials.** It renders three demo accounts as
   click-to-fill buttons, including their plaintext passwords, compiled into the
   production bundle. The accounts are not seeded on production, so they cannot
   sign anyone in — but the page still publishes the organisation's internal email
   domain, real staff names, and the full role map to anyone who loads it.

2. **Login responses distinguish "no such account" from "wrong password",**
   so the form can be used to enumerate which email addresses hold accounts.

Meanwhile the host already runs a Cloudflare Tunnel connector for other services,
and `csprint.co.th` is already delegated to Cloudflare. The capability to publish
this app is sitting unused.

## Solution

Publish the stack at `https://map.csprint.co.th` through the **cloudflared
connector already running on the host**, rather than standing up a second one or
opening any inbound port.

Delivery happens in two phases so that application faults and tunnel faults can
never be confused with each other:

- **Phase 1 — LAN only.** The stack runs with nginx published on port 80 and is
  reached at `http://<host LAN address>`. Because the host has no public IP this
  is not an internet exposure; the router is the boundary. Staff on the local
  network prove the full application works: sign-in, Device inventory, floor-plan
  upload, per-property permissions.
- **Phase 2 — published.** The project's nginx joins the Docker network the
  existing connector is already on, and a Public Hostname is mapped in the
  Cloudflare Zero Trust dashboard. `FRONTEND_URL` switches to the https origin and
  Google sign-in is enabled. Port 80 stays bound for LAN debugging.

The operator command is identical in both phases and never grows flags:

```
docker compose up -d --build
```

Before either phase, the login surface is hardened: demo accounts removed, and a
single credentials message returned for every failed sign-in.

## User Stories

1. As an IT Operations engineer, I want the dashboard reachable at a memorable
   hostname, so that I don't have to remember and share a LAN IP address.
2. As an IT Operations engineer, I want the dashboard served over HTTPS, so that
   staff passwords are never transmitted in plaintext.
3. As an IT Operations engineer, I want to publish the app without a public IP, so
   that the deploy host can live on the office network behind a router.
4. As an IT Operations engineer, I want to publish without opening any inbound
   port, so that the host's attack surface does not grow when the app goes live.
5. As an IT Operations engineer, I want no TLS certificate to manage on the host,
   so that nothing expires unattended and takes the dashboard down.
6. As an IT Operations engineer, I want to reuse the connector already running on
   this host, so that I don't maintain a second tunnel or a second credential.
7. As an IT Operations engineer, I want the deploy command to stay
   `docker compose up -d --build` in every phase, so that I never have to recall a
   longer invocation under pressure.
8. As an IT Operations engineer, I want to switch between LAN-only and published
   mode by editing configuration rather than editing the compose file, so that the
   two modes cannot drift apart.
9. As an IT Operations engineer, I want to verify the host is ready before I
   deploy, so that I discover missing memory or blocked egress before a failed
   build, not during one.
10. As an IT Operations engineer, I want the readiness check to be read-only, so
    that I can safely run it against a host already serving other services.
11. As an IT Operations engineer, I want the readiness check to never print secret
    values, so that I can paste its output into a chat or an issue.
12. As an IT Operations engineer, I want the readiness check to report the existing
    connector's project, networks and credential mode, so that I can wire the new
    service to it without guessing.
13. As an IT Operations engineer, I want to prove the application works on the LAN
    before publishing it, so that a later failure is unambiguously a tunnel fault.
14. As an IT Operations engineer, I want LAN access to keep working after
    publishing, so that I can still diagnose the app when the tunnel is down.
15. As an IT Operations engineer, I want nginx to record the true visitor address
    rather than a container address, so that access logs are worth reading.
16. As an IT Operations engineer, I want forged client-address headers rejected, so
    that log entries cannot be poisoned by whoever reaches nginx directly.
17. As a member of staff, I want to sign in with my email and password over the
    published hostname, so that I can reach the dashboard from any office machine.
18. As a member of staff, I want to sign in with Google once the app is published,
    so that I don't manage another password.
19. As an IT Operations engineer, I want Google sign-in disabled during the LAN
    phase, so that OAuth configuration is not a variable while I test the app.
20. As an IT Operations engineer, I want the Google redirect URI derived from one
    configured origin, so that there is a single value to get right.
21. As a visitor to the login page, I want to see no credentials of any kind, so
    that the page discloses nothing about who works here.
22. As a security reviewer, I want the login page to omit the organisation's email
    domain and staff names, so that the page cannot seed a phishing campaign.
23. As an attacker, I want to be unable to tell whether an email address has an
    account, so that I cannot build a target list from the login form.
24. As a security reviewer, I want a failed lookup and a failed password to take
    comparable time, so that response timing does not leak account existence.
25. As a member of staff who signs in with Google, I want to be told that my
    account uses Google, so that I am not stuck retrying a password I never set.
26. As an IT Operations engineer, I want the production database to contain only
    the administrator I created, so that no demo account is ever reachable.
27. As an IT Operations engineer, I want the demo seed to refuse to run against
    production, so that a mistyped command cannot destroy live data.
28. As a Break-glass administrator, I want a documented way to create the first
    account on a fresh deployment, so that I can recover access without demo data.
29. As an IT Operations engineer, I want upload size limits preserved through the
    proxy chain, so that floor-plan images up to 10 MB still upload once published.
30. As an IT Operations engineer, I want uploaded floor plans and the database to
    survive redeploys, so that publishing does not cost me data.
31. As an IT Operations engineer, I want a documented backup routine for the
    database and uploads, so that Operational security data is recoverable.
32. As an IT Operations engineer, I want documented symptoms and causes for the
    common tunnel failures, so that I can fix a 502 without a search engine.
33. As an IT Operations engineer, I want the documentation to state which service
    address the dashboard hostname must point at, so that I don't map it to
    `localhost` and get a 502.
34. As an IT Operations engineer, I want the risk of depending on another project's
    Docker network recorded in the compose file, so that whoever removes that
    project understands what they will break.
35. As an IT Operations engineer, I want a rate limit on the sign-in endpoint once
    published, so that the form is not open to unlimited password guessing.
36. As an IT Operations engineer, I want a go-live checklist, so that nothing in
    this list is silently skipped.

## Implementation Decisions

**Edge topology.** The stack runs no connector of its own. The cloudflared
container already present on the host is the single edge for this machine. The
project's nginx joins **that** connector's Docker network, declared as an external
network in this project's compose — the connector's own project is not modified.
The alternative (attaching the existing connector to this project's network) was
rejected: doing it by hand does not survive container recreation, and doing it
properly means editing a project this repository does not own.

**Consequence, recorded deliberately:** this project now depends on a network
created by another project. If that project is removed, this stack will fail to
start until its compose file is edited. This is documented in the compose file
itself, not only in prose.

**Hostname mapping.** `map.csprint.co.th` is added as a Public Hostname on the
existing tunnel, type HTTP, pointing at this project's nginx container on port 80 —
addressed by container name over the shared network. Never `localhost`, which
inside the connector resolves to the connector itself. Saving the Public Hostname
creates the proxied DNS record; the record must remain proxied, because the tunnel
target hostname is only meaningful inside Cloudflare's network.

**Phase switching.** Phase is expressed entirely in environment configuration and
the dashboard, never by editing the compose file. `FRONTEND_URL` is the single
value that changes: the host's LAN origin in phase 1, the https origin in phase 2.
Because there is no second compose file, no override mechanism and no
`COMPOSE_FILE` indirection are needed, and the operator command never takes `-f`.

**Port binding.** nginx keeps a published port 80 in both phases. With no public
IP this exposes the app to the local network only, and it remains the diagnostic
path when the tunnel is unavailable. This is the opposite of the correct choice on
a host that *does* hold a public IP, and the reasoning is recorded so the decision
is not blindly copied.

**Proxy headers.** TLS terminates at Cloudflare's edge, so the scheme observed by
nginx is always plain HTTP. nginx therefore forwards the *forwarded* scheme
upstream rather than the observed one, falling back to the observed scheme so
direct LAN access in phase 1 still reports correctly. This matters beyond
cosmetics: the backend derives the Google OAuth redirect URI and the `secure` flag
of the OAuth state cookie from the configured origin and scheme.

**Client addresses.** nginx recovers the real visitor address from the
Cloudflare-supplied header, trusting it **only** from the private bridge ranges a
local container can occupy. Trusting it unconditionally would let anyone able to
reach nginx directly forge log entries.

**Certificates.** No certificate exists on the host and no 443 server block is
defined. The commented-out HTTPS block previously carried in the nginx config is
removed rather than left as an aspiration, because it could never receive traffic
in this topology.

**Login surface.** The demo account list and its rendered buttons are deleted from
the login page outright, not hidden behind a development-mode flag — a flag still
ships the strings in source control and invites re-enabling. Placeholder email
addresses elsewhere in the UI use a neutral example domain rather than the
organisation's.

**Authentication responses.** Sign-in returns one identical message for a missing
account and for an incorrect password. When the account lookup misses, the request
still performs a password-hash comparison against a fixed dummy hash whose result
is discarded, so the two failure paths cost comparable time. The dummy hash is
generated from a discarded random value and cannot authenticate anyone.

**Deliberate exception:** an account provisioned through Google sign-in, which has
no local password, still receives a distinct message directing the user to Google.
This is a knowing trade of a narrow enumeration signal for the ability of real
users to sign in at all; it applies only to Google-provisioned accounts.

**Seeding.** Production is created with the schema push plus the single-admin seed.
The demo seed remains guarded: it refuses to run when the environment declares
production, and the demo data bundle it depends on is not present in a deployed
checkout. Both guards are retained; neither is relaxed for convenience.

**Readiness check.** A read-only host report is added under the project's scripts.
It starts and stops nothing, writes nothing, and prints whether a secret is set
rather than its value, so its output is safe to paste into an issue. It reports
host resources, outbound reachability to the tunnel service, the existing
connector's compose project, networks and credential mode, currently published
container ports, and whether port 80 is free.

**Documentation.** A single production guide covers the whole path: why a tunnel is
used here, the architecture, host preparation, the two phases, the dashboard steps,
Google sign-in, verification commands, Cloudflare-side hardening, day-2 operations,
troubleshooting, and a go-live checklist. It is authored as HTML with its stylesheet
and behaviour in separate asset files, and lets the reader enter their hostname once
so that every command on the page is copy-ready.

## Testing Decisions

**What makes a good test here.** Tests assert externally observable HTTP behaviour —
status code and response body for a given request against the assembled
application. They do not assert which internal function was called, how a hash was
computed, or the shape of any module's internals. A test that would still pass
after the authentication library is swapped out, but fail if the *behaviour*
regressed, is the right test.

**Seam.** The existing integration seam is used and no new seam is introduced:
requests are dispatched into the real assembled Hono application via its fetch
handler, exactly as the existing floor-routes integration suite does. That suite is
the prior art for everything below — including its pattern of probing the database
once up front and **skipping** the whole suite when it is unreachable, so pure unit
tests still run offline, and its convention of namespaced fixtures that are hard
deleted afterwards so seeded data is never disturbed.

**Modules under test.** The authentication routes, through that seam:

- A sign-in attempt with an unknown email and a sign-in attempt with a known email
  and wrong password return the **same** status and the **same** message body.
- A sign-in attempt with correct credentials for an active account returns a token
  and the caller's accessible properties.
- A sign-in attempt against an account provisioned through Google returns the
  Google-specific message.
- A sign-in attempt against a Suspended account is refused.
- The providers endpoint reports Google as unavailable when it is unconfigured.

**Fixtures.** Test accounts follow the existing namespacing convention so they are
unmistakably test data, and are hard deleted afterwards.

**Explicitly not unit-tested.** The nginx configuration, the compose topology, the
external network wiring and the tunnel itself. These have no code seam, and a test
double for them would assert only that the test double was configured correctly.
They are verified instead by the readiness script, by an nginx configuration syntax
check run against the real image, and by the documented request-path checks against
the health endpoint — from the LAN in phase 1 and from outside in phase 2.

## Out of Scope

- **Replacing the authentication implementation.** Whether to adopt a
  session-backed authentication library instead of the current stateless tokens is
  an open question with its own trade-offs. It is not settled and is not part of
  this work.
- **Making suspension take effect immediately.** See Further Notes — this is a real
  defect, but fixing it is a behavioural change to the authorization path rather
  than part of publishing the app.
- **Sign-in throttling in the application.** Rate limiting is configured at the
  Cloudflare edge as an operational step; no application-level throttle is built.
- **Cloudflare Access / SSO in front of the app.** Documented as an option, not
  implemented.
- **Migrating the other project** that owns the shared Docker network.
- **Liveness check behaviour.** Nothing here changes how Devices are determined
  Online, Offline or Unknown.
- **Recording status for cameras**, which still requires NVR integration.
- **Automated deployment.** Deploys remain a manual pull-and-up on the host; no
  pipeline is built.
- **A staging environment.** Phase 1 is a phase, not a permanent second environment.
- **Security audit events.** No authentication or permission-change audit trail is
  added, despite the term now existing in the glossary.

## Further Notes

**A glossary term currently describes behaviour the system does not have.** The
domain glossary defines a Suspended account as one that cannot *start or continue*
any authenticated session until an administrator reactivates it. The implementation
only checks account status at sign-in. An already-issued token keeps working for
its full lifetime, so suspending someone does not end their session, and neither
does signing out — there is no server-side session record to revoke. Either the
authorization path gains a status check, or the glossary is corrected to describe
what the system actually guarantees. This should be decided before anyone relies on
suspension as a security control, and it is the strongest argument in the open
authentication-library question listed under Out of Scope.

**One value is unknown at the time of writing.** The name of the Docker network the
existing connector is attached to has not been captured from the host. It cannot be
guessed — a wrong value prevents the stack from starting. The readiness script
reports it, and the compose change for phase 2 is the only remaining work that
depends on it.

**Dependency risk accepted knowingly.** Cloudflare becomes a hard dependency of
reaching this dashboard. Given no public IP exists, the alternative is not "a
simpler deployment" but "no remote access at all", so the trade is not close. LAN
access is deliberately retained as the fallback path.

**Prior deployment documentation still describes the port-forward and certificate
route.** It remains accurate for a host that holds a public IP and is left in
place; the new guide states plainly which topology it replaces so the two are not
followed simultaneously.
