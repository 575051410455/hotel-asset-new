# Spec — Guardrails for the add-floor → add-device workflow

**Status:** ready-for-agent (pending an issue tracker — see Further Notes)
**Triage label:** `ready-for-agent`

## Problem Statement

Setting up a new Floor is the first thing anyone does on a fresh property, and
the workflow has three traps in it. None of them produce an error; they all
produce a result the user does not notice is wrong until much later.

**Pins placed before a Floor plan exists silently drift.** Nothing stops a user
from creating a Floor, skipping the plan upload, and immediately placing
cameras. The Add button is enabled as soon as a Floor exists, and the click
target is the map canvas rather than the plan image, so clicking empty white
space happily records a Pin. But Pin coordinates are percentages measured
against the Floor's aspect ratio, which stays at a placeholder value until a
plan is uploaded and the real ratio is computed. Uploading the plan afterwards
moves every existing Pin along the vertical axis. The user placed pins on
nothing, could not have known where anything was, and now has a map that looks
deliberately wrong.

**Picking the wrong kind of Floor strands it.** A Floor is either a workstation
Floor or a CCTV Floor, chosen in the create wizard. That choice decides which
Add buttons the map offers and which permission gates reading it. Nothing in the
UI says the choice is permanent, and nothing in the UI can change it afterwards
— the update endpoint does not accept the field at all. A user who picks wrong
sees a Floor that never shows the buttons they expect and has no visible way out.

**"Zone" means two different things.** The UI calls a CCTV Floor a "zone", and
also calls the groupings *inside* a Floor "zones". A user reading "Zones" in the
create wizard cannot tell whether it means the thing being created or the
groupings within it.

## Solution

Close all three, without adding machinery to support a workflow that should not
be encouraged.

**A Floor must have a Floor plan before Pins can be placed on it.** The Add
controls stay visible but disabled until a plan exists, saying why. Placement
against a real plan is the only placement that carries meaning, so the fix is to
prevent the meaningless case rather than to recompute coordinates afterwards —
there is no correct position to recover for a Pin that was dropped on blank
space.

**The kind of Floor is presented as permanent, and the escape hatch is named.**
The wizard states plainly what each kind will offer and that it cannot be
changed later, and points at the way out: delete the Floor and create it again
with the same slug, which fully replaces it. That already works, and while the
Floor has no Devices yet it costs nothing.

**One name per thing.** A Floor is a Floor everywhere the user can see, with its
kind as an adjective ("CCTV floor"). The word "zone" is reserved for the
groupings inside a CCTV Floor, which is what camera operators already call them.

## User Stories

1. As an IT Operations engineer, I want to be told that a Floor needs its plan before I can place Pins, so that I don't build a map I have to redo.
2. As an IT Operations engineer, I want the Add control to stay visible while disabled, so that I can see the capability exists and learn what unlocks it.
3. As an IT Operations engineer, I want the reason a control is disabled stated on the control itself, so that I don't have to guess or go looking in docs.
4. As an IT Operations engineer, I want Pins I place to stay where I put them, so that the map matches the building.
5. As an IT Operations engineer, I want to place Pins against the actual plan drawing, so that I can see which room I am pointing at.
6. As an IT Operations engineer, I want to upload a Floor plan from the create wizard, so that the Floor is immediately usable.
7. As an IT Operations engineer, I want to upload a Floor plan later from the Floor itself, so that a Floor created in a hurry can be finished afterwards.
8. As an IT Operations engineer, I want the Add controls to become enabled as soon as a plan is uploaded, so that I don't have to reload or renavigate.
9. As an IT Operations engineer, I want to know before I commit that a Floor's kind cannot be changed, so that I choose deliberately.
10. As an IT Operations engineer, I want each kind to say what it will let me add, so that I can tell which one I need without trial and error.
11. As an IT Operations engineer, I want to be told how to correct a wrong kind, so that I don't conclude the Floor is stuck forever.
12. As an IT Operations engineer creating a Floor for cameras, I want to start from the CCTV map, so that the kind is already right.
13. As an IT Operations engineer, I want "zone" to mean exactly one thing, so that the wizard's wording is unambiguous.
14. As an IT Operations engineer, I want a CCTV Floor called a floor, so that it matches what the rest of the product and the API call it.
15. As a camera operator, I want the groupings inside a CCTV Floor called zones, so that the product matches the language I already use.
16. As a new team member, I want the glossary to define Floor, Floor plan, Pin and Zone, so that I can read the code and the UI without inferring the model.
17. As a new team member, I want the glossary to say that a CCTV Floor is a Floor, so that I don't think they are separate concepts.
18. As an IT Operations engineer, I want the add-a-floor guide to match what the product actually does, so that following it doesn't lead me into a trap.
19. As an IT Operations engineer, I want the guide to state that Devices are detached, not deleted, when a Floor is removed, so that I am not afraid to delete a mistake.
20. As an IT Operations engineer, I want the guide to state which capability each step needs, so that I can tell whether a missing button is a permission problem.
21. As a developer, I want the rule about what a Floor can accept expressed once in a testable place, so that the map and any future screen cannot disagree.
22. As a developer, I want that rule covered by tests, so that a later change cannot quietly re-enable placement on a plan-less Floor.
23. As a viewer with read-only access, I want no Add controls at all, so that the interface reflects what I am allowed to do.
24. As an IT Operations engineer, I want an existing Floor that already has Pins to keep working exactly as before, so that this change costs me nothing.

## Implementation Decisions

**The placement rule becomes one pure function.** Whether a Floor can accept a
new Pin, which kinds of Device it can accept, and the reason when it cannot, all
move out of the map component into a single pure function in the frontend's
shared library, alongside the existing pin-config helper. The map renders from
its result. This is the one new seam; everything else in this work is wiring.
The function takes the Floor and the caller's edit capability and returns the
available placement options plus, when there are none, a reason suitable for
display.

**Disabled, not hidden.** The Add controls remain rendered and disabled when the
Floor has no plan, carrying the reason. Hiding them would make the capability
undiscoverable and look identical to a permission problem. When the user has no
edit capability the controls are absent entirely, as today — that distinction is
deliberate: absent means "not yours", disabled means "not yet".

**No coordinate migration.** When a Floor plan is uploaded or replaced, existing
Pin coordinates are left exactly as they are. For a Floor that never had a plan
this is the honest outcome, since no correct position ever existed. For a
replaced plan, a new drawing is generally not a rescaled version of the old one,
so recomputing would imply a precision the data does not have; repositioning is
left to a human, which the map already supports.

**The kind of Floor stays immutable.** The update endpoint continues not to
accept it, and no UI is added to change it. The wizard instead states the
consequence at the point of choice and names the escape hatch. This was verified,
not assumed: creating a Floor with the slug of a soft-deleted one fully replaces
every field, kind included, so delete-then-recreate genuinely changes it.

**Vocabulary is unified in the UI only.** User-visible strings that call a CCTV
Floor a "zone" become "CCTV floor". Strings that call the groupings inside a
Floor "zones" are correct and stay. No database column, API field or type is
renamed: the stored field behind those groupings keeps its current name, because
renaming it would fan out across the schema, the API contract and both clients
for no user-visible gain. The glossary records the mismatch instead.

**The glossary gains the terms this feature is built from** — Floor, Floor plan,
Pin, and Zone — including that a CCTV Floor is a Floor and not a separate thing,
and an explicit instruction not to call a Floor a zone.

## Testing Decisions

**What makes a good test here.** The tests assert the decision, not the drawing:
given a Floor and a capability, what may be added and what reason is shown. They
do not assert class names, element structure, or that a particular component
called a particular hook. A test that still passes after the map is restyled but
fails if a plan-less Floor becomes placeable again is the right test.

**Seam.** One new seam: the pure placement function described above. It is the
highest point at which this rule is observable without rendering, and it is
introduced precisely so that the rule has somewhere to be tested. Prior art is
the existing pin-config helper and its test, which is a pure module in the
frontend's shared library exercised directly by the frontend test runner; the
new tests follow that shape exactly, in the same directory, run the same way.

**Covered by tests:**

- A Floor with a plan offers camera placement when its kind is CCTV, and
  workstation and access-point placement when its kind is workstation.
- A Floor with no plan offers nothing, and returns a reason naming the missing
  Floor plan.
- A caller without edit capability is offered nothing, with a reason
  distinguishable from the missing-plan one, so the UI can render absence versus
  disablement correctly.
- The options offered never mix the two kinds.

**Not covered by automated tests:** the wizard's wording, the disabled-button
rendering, and the documentation. These are reviewed by reading. No backend test
changes, because no backend behaviour changes.

## Out of Scope

- **Making a Floor's kind editable.** Considered and rejected: delete-and-
  recreate already works, the mistake is nearly always caught before any Device
  is placed, and changing kind silently changes which capability gates reading
  the Floor, which needs its own thinking.
- **Recomputing Pin coordinates** when a plan's aspect ratio changes.
- **Renaming the stored field** behind a Floor's groupings.
- **Requiring a Floor plan at creation time.** The wizard's upload step stays
  optional; a Floor with no plan remains valid, it simply cannot take Pins yet.
- **Any backend or schema change.** This work is entirely frontend plus docs.
- **The create-group role defect** — already fixed; see Further Notes.
- **Property creation.** Still impossible by design; unrelated to this work.
- **Anything about Device liveness** — Online, Offline, Unknown and Recording are
  untouched.

## Further Notes

**The create-group role defect is fixed, ahead of this spec.** The dialog
defaulted its role to a hardcoded value that does not exist on a database
bootstrapped for production, so the first group anyone created failed. It was
the same defect shape this spec addresses — a hardcoded assumption about data
that is actually user-controlled — and it is now read from what the server
returned, with submit blocked and explained when no role exists at all. It is
listed under Out of Scope because it is already done, not because it was
declined.

**The soft-delete revive behaviour is load-bearing for this design, and is now
pinned by a test.** The escape hatch for a wrong kind depends on recreating a
Floor with a soft-deleted slug replacing every field. That behaviour was
verified against the code and is now covered at the existing backend
integration seam, asserting all three parts: the kind a Floor is created with,
that an update carrying a new kind changes nothing, and that delete-then-
recreate really does change it. A future change making revival preserve fields
will now fail a test rather than silently removing the only way out.

**This is queued behind an unverified deployment.** Several changes are sitting
on a branch that has never run on the deploy host. Adding to that pile was a
deliberate choice, made with the risk stated.
