# Ops Monitor — Context Glossary

Canonical domain language for the Ops Monitoring Dashboard. **Definitions only** —
how things are built lives in `docs/adr/`, not here.

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
