---
name: fsos-frontend-product
description: Use when building or changing any Voice Agent screen in FSOS. Maps the 31-screen design canvas to real screens and sets the required states, accessibility and design-system rules.
---

# FSOS Voice Agent frontend

FSOS serves one FSA practice; where the canvas says "office", read "the practice". The design canvas is a layout and content reference with mock data and a temporary visual style. Build with FSOS design tokens and existing components. Never copy canvas colors or hard-coded styles; never ship sample figures.

## Screen inventory (navigation group → screens → first stage)
- Voice agent: Live calls (1), Call history (4), Call record (4), Callbacks & voicemail (3), Review queue (4), Complaints (4), Consent & DNC (2), Outbound (5, gated per stage 6–11)
- Manage: Agent settings (1), Knowledge & scripts (1), Change approvals (1), Releases (minimum path 1, full 12)
- Insights: Analytics (12), Quality review (12)
- Admin: Phone numbers & routing (1), Team & licensing (2), AI governance (12)
- Workspace: Contacts (1), Import contacts (1), Contact profile (2), Opportunities (8–11), Calendar (1) — extend the existing `/app/contacts`, `/app/contacts/import`, `/app/opportunities`, `/app/calendar`; Consent & DNC and Team & licensing extend `/app/compliance/consent`, `/app/compliance/dnc`, `/app/compliance/licenses`. New voice screens fit the existing nav in `src/lib/workspaces/registry.ts` (e.g. under `/app/comms/calls`).
- Launch: Readiness (1), Architecture (reference)
- Mobile: FSA sign-in and voice assistant (after 4, read-only), Incoming AI transfer (3), FSA notifications (3) — FSOS has no PWA or push today; delivery channel (owner decision pending, C21)
- Shared: empty/loading/error/fallback states; dark mode (owner decision pending, C20) — FSOS has no dark mode today (`docs/archetypes.md:87`)

## Every screen ships with
Happy, loading (skeleton), empty, error (actionable, logged), degraded (source down), permission-denied, disabled controls that say why, success feedback; responsive layout; mobile where the canvas shows it; dark mode only if the owner decides to build it; WCAG AA (keyboard, focus order, labels, contrast, screen reader); real backend data; sensitive actions confirmed and audited.

## Rules
- Reuse existing FSOS components (`src/components/ui/`, `src/components/archetypes/`), the `WorkspaceShell` layout and the archetypes in `docs/archetypes.md`; tokens come from `src/app/globals.css` / `tailwind.config.ts` (not `src/lib/tokens.ts`, which is unrelated). Search before creating anything.
- Consent and DNC are visible at contact level and append-only in history.
- Outbound screens show the dry-run gate funnel and skip reasons before dialing can be enabled.
- A global "pause AI answering" routes new calls to the practice while current calls finish.
- Verification: Playwright end-to-end test (`tests/e2e/`, projects `desktop` and `mobile-375`) for the main flow and each state; screenshot evidence in the stage report.
