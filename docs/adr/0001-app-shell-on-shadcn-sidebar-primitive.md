# Build the app shell on the shadcn Sidebar primitive, keep the prototype's visual identity

**Status:** accepted

The Ops Monitor frontend is otherwise a pixel-faithful, hand-built port of a Claude Design
prototype (IBM Plex fonts, a custom `ink`/`surface`/`line` palette, dense nav). For the authed
app shell only, we adopt shadcn's **Sidebar primitive** (`components/ui/sidebar.tsx`) to get a
collapsible icon rail, a responsive mobile Sheet, cookie-persisted state, and a Cmd/Ctrl+B
toggle — but we re-skin it onto our existing design and keep all domain content. We did **not**
run the `sidebar-07` / `dashboard-01` blocks; we build `AppSidebar` directly on the primitive
(already present and themed via our `--sidebar-*` token mapping).

## Considered options

- **Re-skin the primitive, keep identity (chosen).** Modern sidebar UX without a visual
  regression or loss of domain logic.
- **Full replacement with the blocks as shipped.** Rejected: shadcn defaults (Geist font,
  neutral tokens, a generic interactive chart and drag-and-drop placeholder table) break the
  prototype-fidelity constraint and discard the device-inventory / RBAC dashboard.
- **Off-canvas collapse instead of an icon rail.** Rejected in favor of the `collapsible="icon"`
  rail for the "modern app" feel the user wanted.

## Consequences

- The hand-rolled responsive drawer in `routes/_layout.tsx` (the `navOpen` state, the
  absolutely-positioned `translate-x` panel, the backdrop) is removed — `SidebarProvider` owns
  responsive behavior now.
- The per-section **accordion chevrons** (Floor / Equipment / Administration) are dropped in
  favor of always-visible labeled groups, because the icon rail hides group labels and renders
  items as tooltip'd icons. This is a deliberate, small deviation from the prototype, isolated
  to the shell.
- This is the *only* shadcn block-style composition in an otherwise hand-built app; future
  contributors should not read it as license to pull in other blocks wholesale.
