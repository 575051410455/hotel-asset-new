# Ops Monitor — Context Glossary

Canonical domain language for the Ops Monitoring Dashboard. **Definitions only** —
how things are built lives in `docs/adr/`, not here.

## Operational security data
Hotel-scoped information that could expose physical or network security,
including floor plans, camera placement, IP addresses, NVR details, and retention
metadata. It is internal data, visible only to authenticated users with the
relevant hotel and resource permission.
_Avoid_: Public upload, public floor plan.

## Break-glass administrator
A tightly controlled administrator account used only to recover access when the
primary Google sign-in path is unavailable.
_Avoid_: Regular administrator, shared administrator.

## Suspended account
An account that cannot start or continue any authenticated session until a
different authorized administrator reactivates it.
_Avoid_: Disabled login, temporarily inactive session.

## Security audit event
A recorded authentication, account, or permission action that can establish who
attempted to change access, what they targeted, and whether it succeeded.
_Avoid_: General application log, debug log.

## User Management
The administrative capability for managing user accounts, roles, groups, and
hotel access assignments.
_Avoid_: Access Control when naming this product capability.

## Archived account
A former user account that cannot authenticate or hold active access but remains
available for audit history and authorized restoration.
_Avoid_: Deleted user, hard-deleted account.

## Platform Administrator
An administrator responsible for user and access management across every hotel.
_Avoid_: Global user, super user.

## Hotel Administrator
An administrator whose user-management authority is limited to assigned hotels.
_Avoid_: Platform Administrator, global administrator.

## Device
A monitored asset on a property: a **workstation** (PC), a **CCTV camera**, or a
**Wi-Fi access point**. Appears in the inventory and, when placed, as a pin on a
floor map.

## Liveness check
The periodic test the system runs against a Device to decide **Online** vs
**Offline**. (The mechanism — ICMP ping — its cadence, and flap-handling are an
implementation decision recorded in an ADR, not here.)

## Online
A Device that **currently responds to the liveness check** — i.e. it is reachable
on the network right now.

## Offline
A Device that **does not respond to the liveness check** — it has a reachable
address but cannot currently be reached.

## Unknown
A Device whose liveness **cannot be determined** — it has no reachable address yet,
or has never been checked. Distinct from Offline (which means "checked and not
answering").

## Recording  *(camera only)*
Whether an NVR is actively writing a camera's video stream. This is **distinct
from Online**: a camera can be Online but not Recording. Recording **cannot be
determined by the liveness check** — it requires the NVR. Out of scope until NVR
integration exists.

## Reachable address
The network address (IP) the liveness check targets for a Device. Cameras and
access points carry one today; **workstations do not yet** — capturing it is a
prerequisite for pinging PCs.

## Floor
A named area within a property that Devices are placed on — one storey, one
wing, or one camera coverage area. Every Floor is either a **workstation floor**
(computers and access points) or a **CCTV floor** (cameras); that type is chosen
when it is created and is permanent.
_Avoid_: Zone, level, area, site.

## Floor plan
The drawing of a Floor that Pins are positioned against. A Floor without one
cannot take Pins, because there is nothing for a position to be measured
relative to.
_Avoid_: Map image, blueprint, layout.

## Pin
A Device placed at a position on a Floor plan. A Device without a position is
still in the inventory but is not a Pin — deleting a Floor turns its Pins back
into unplaced Devices rather than removing them.
_Avoid_: Marker, dot, placement, node.

## Zone
A grouping of cameras **within** a CCTV floor, used to organise them in the list
panel. A Zone is part of a Floor, never a Floor itself.
_Avoid_: Using "zone" for a CCTV floor.
