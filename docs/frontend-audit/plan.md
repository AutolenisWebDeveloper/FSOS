# FSOS Frontend Audit — Phased Implementation Plan

> **Objective:** bring every public page and authenticated portal to Fortune-500
> fintech frontend quality — consistent, accessible (WCAG 2.2 AA), responsive,
> defect-free, production-ready — **frontend only**, preserving all backend,
> data contracts, routes, auth, compliance, and securities surfaces.
> **Delivery:** vertical slices, one draft PR per slice, CI-gated.
> Companion docs: `inventory-and-defect-register.md`, `a2p-10dlc-website-compliance.md`.

## Design-consistency baseline (all slices conform)

- **Tokens only** — every color/space/radius/shadow/font resolves through
  `globals.css` HSL vars → `tailwind.config.ts`. No hardcoded hex/px color in
  new or touched shared UI. (Legacy inline command-center screens exempt per
  CLAUDE.md §1.6; `.msite` marketing layer handled in Slice 1.)
- **Guardrail colors are reserved** — gold = assumption only; purple = securities/escalated; `--status-lost` = loss/error; `--destructive` = destructive actions only. Never repurpose as categorical fills.
- **One canonical component per purpose** — extend, never fork. KPI tile,
  button, table, badge, modal, drawer each have exactly one implementation.
- **Every surface ships all states** — loading (skeleton) / empty (with next action) / error (retryable) / success; archetype states used, never a bare `0`/blank where the real state is No-data/Unavailable/Not-configured/Permission-denied.
- **A11y floor** — semantic markup, keyboard operable, visible focus, labels/roles, AA contrast, no color-only signaling, accessible tables/dialogs, `prefers-reduced-motion` respected.
- **No horizontal overflow** at 320/375/390/430/768/1024/1280/1440/1920.

## Merge policy — recap (no approval gate)

Auto-merge only if **all** hold: (1) CI green (type-check → lint → test → **build**, now wired); (2) diff **frontend-only** (no `supabase/migrations`, RLS, `lib/comms` gate, `lib/ai`, securities firewall, API contracts, business logic); (3) a11y + responsive evidence attached; (4) no blocking review findings. Otherwise → ready-for-review, stop.

**No compliance-officer merge gate.** Website content — including legal, privacy,
terms, and SMS/A2P consent copy — ships **compliant-by-construction**: written
accurately against the `twilio-a2p-compliance` / `finra-rule-ingestion`
references, with `[[FSA TO PROVIDE]]` placeholders for real business-specific
values the FSA confirms. No page requires a named individual's prior sign-off to
deploy — the FSA owns publish. Any residual regulatory/legal/carrier risk is
**documented with a recommendation** in the PR/report, never treated as an
approval bottleneck. (Separate matter, unchanged: *activating automated SMS
outreach* — actually sending texts — is governed by the backend comms gate and
is out of scope for this frontend initiative.) In an unattended session this
program still opens **draft** PRs so a human can review before merge.

## Slices

### Slice 0 — Shared design baseline + CI  ✅ (this session)
- **CI:** add `next build` to the workflow (was type-check/lint/test only). **DONE.**
- **DESIGN.md** reconciled to as-built tokens (H1). **DONE.**
- **Guardrail/token:** `DeltaPill` → `--status-lost` (H2). **DONE.**
- **A11y:** `TableCaption` added/exported (M1); `PortalShell` skip-to-content + `<main id>` (M2); `WizardShell` non-color-only step state (M3). **DONE.**
- **Docs:** inventory + defect register, phased plan, A2P report. **DONE.**
- Verified: type-check ✅ lint ✅ test ✅ build ✅.

### Slice 0-b — Shared a11y + chart-token pass (needs visual verify)
- Global `:focus-visible` fallback without double-ringing components (M6).
- Chart palette: remove reserved gold/red as categorical fills (H3); `HeatGrid` luminance-based foreground + tokenized white (M7).
- `--highlight` token for light-surface top hairlines (L3).
- *Requires* live/visual verification (focus rings, chart contrast) → own PR.

### Slice 1 — Public marketing site + auth screens
- SEO: `robots:index` + sitemap entry for `/workshops` (H6); OG image + apple-touch icon (H7); `[slug]` server-metadata split (M9).
- Dead-ends: `/403` support link (H8).
- `.msite` token reconciliation or formal DESIGN.md sanction (H5); remove inline hexes (L2); logo `width/height` (L7); internal `<a>`→`next/link` (L6).
- NAP consistency from `CONTACT` (M9).
- Auth screen polish/mobile/states refinement (login/mfa/forgot/reset) — **UI only, no auth logic.**
- **A2P items ship compliant-by-construction (no approval gate)** — `/refer` footer + consent-copy standardization, TRAIGA disclosure, workshop static fallback: write the accurate, carrier-ready copy directly against the `twilio-a2p-compliance` checklist, with `[[FSA TO PROVIDE]]` for business-specific values. Document any residual risk (e.g. third-party-number consent) as a recommendation. See A2P report.
- ⚠️ C1/C2 (invite/verify) need **backend** routes first — out of this initiative; flagged to owner.

### Slice 2 — FSA portal (`/app/*`, 156 pages) + shared component consolidation
- Consolidate the 3 KPI tiles into one canonical `StatTile`/`MetricCard` + one KPI grid (H4/M8) — broad blast radius, review-gated.
- Table sticky header / sticky-first-column / mobile stack pattern (M4/M5).
- `StatusBadge` human labels (L4); `Badge` variant recipe normalization (L5).
- Per-surface state/responsive/a11y remediation across dashboards, book of business, pipeline, comms, AI, compliance ops pages.

### Slice 3 — `(admin)` + `(super)` portals
### Slice 4 — `(compliance)` portal (preserve every compliance/securities indicator)
### Slice 5 — `(partner)` + `(client)` portals

Each of Slices 2–5: audit every route's states/responsive/a11y/tokens against the baseline; fix; validate (type-check/lint/test/build + responsive matrix + a11y); one draft PR with evidence.

## Per-slice Definition of Done (inherits CLAUDE.md §21)

Tokens-only · all states present · WCAG 2.2 AA · no horizontal overflow at all breakpoints · type-check/lint/test/build green · compliance/consent/securities indicators intact · no route removed/broken · no backend/schema/RLS/compliance/securities change · draft PR with a11y + responsive evidence · legal-gated copy stopped for human review.

## Out of scope / FYI (surfaced, not done here)

- Backend invite-accept + verify routes (C1/C2) — backend, not frontend.
- A2P 10DLC brand/campaign registration in GHL/Twilio; `NEXT_PUBLIC_SMS_FROM` = approved campaign number (a console task the FSA performs — not code, not an approval gate).
- Activating automated SMS *outreach* (sending texts) — governed by the backend comms gate; out of frontend scope, unchanged.
- Real business-specific content values (exact figures, IDs, office address, credentials, testimonials) — left as `[[FSA TO PROVIDE]]` placeholders for the FSA to fill; not a gate.
- Visual/browser-based responsive + a11y screenshotting (no browser in this session) — to run per slice.
