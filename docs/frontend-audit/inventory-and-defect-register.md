# FSOS Frontend Audit — Inventory & Prioritized Defect Register

> **Date:** 2026-07-22 · **Scope:** public marketing site + 6 authenticated
> portals, frontend only. **Method:** read-only static audit (3 parallel
> agents: shared baseline, public+auth, A2P surface) against `DESIGN.md`,
> `CLAUDE.md`, and the `twilio-a2p-compliance` skill. **Baseline verification
> (deps installed):** `type-check` ✅ · `lint` ✅ (exit 0, pre-existing
> `no-html-link-for-pages` warnings) · `npm test` ✅ (28+ suites) · `next build`
> ✅ (all routes compile).

## 1. Frontend inventory

| Surface | Route group | Pages | Shell / chrome |
|---|---|---|---|
| Public marketing + auth | `(public)` + top-level `about/privacy/terms/sms-terms/accessibility/[slug]/forms/upload/workshops/unsubscribe` | 13 (`(public)`) + ~10 | `SiteShell`/`SiteFooter`/`SiteHeader` (marketing.css); `PublicPage`/`PublicFooter`; `AuthShell` |
| FSA Portal | `(fsa)` → `/app/*` | 156 | `PortalShell` |
| Admin / Back-Office | `(admin)` → `/admin/*` | 11 | `PortalShell` |
| Compliance & Supervisory | `(compliance)` → `/compliance/*` | 10 | `PortalShell` |
| Agency-Owner | `(partner)` → `/partner/*` | 12 | `PortalShell` |
| Client-Facing | `(client)` → `/client/*` | 12 | `PortalShell` |
| Super Admin | `(super)` → `/super/*` | 22 | `PortalShell` |
| **Total** | | **253 pages, 7 layouts** | |

**Shared design layer:** tokens in `globals.css` (`:root` HSL vars) → `tailwind.config.ts`; primitives `src/components/ui/*` (button, badge, card, dialog, input, label, select, skeleton, table, textarea, typography, securities, sonner); archetype shells `src/components/archetypes/*` (A1–A13 + Empty/Forbidden/Error/skeleton states); dashboard primitives `src/components/dashboards/*`; portal chrome `src/components/portal/*`. Marketing surface uses a **separate `marketing.css` class system** (`.msite`) — a deliberate second layer governed by `farmers-brand-website`.

**Overall health:** *structurally strong, above-average for its class.* Token architecture, accessible primitives (aria-invalid inputs, Radix focus-trap dialogs, role=status skeletons, aria-labelled charts), and archetype states are well built. The concerns are **drift and forking**, not rot. **The access model is intact — no public self-registration surface exists** (verified: nav/footer expose Login only).

## 2. Prioritized defect register

Severity = user/business impact. **Status:** `FIXED` (this session, Slice 0), `SLICE n` (scheduled), `HUMAN` (needs a **backend/business-owner** action such as a server route or a console task — out of *frontend* scope). No item is gated behind a compliance-officer approval: content ships compliant-by-construction and residual risk is documented with a recommendation (see A2P report).

### Critical

| # | Route/File | Category | Defect | Status |
|---|---|---|---|---|
| C1 | `(public)/invite/[token]/page.tsx` | Auth / functional | Invite-acceptance `<form>` has no `action`/`onSubmit` and **no backend route exists** — the *only* onboarding path in an admin-provisioned system is a dead stub. No confirm-password, MFA enroll, or expired/used-token states. | **HUMAN** (needs backend invite-accept route; then Slice 1 UI) |
| C2 | `(public)/verify/[token]/page.tsx` | Auth / functional | Static stub — token is `void params.token`, never exchanged; always renders "processing". No success/expired/invalid states. | **HUMAN** (needs backend verify route; then Slice 1 UI) |

> C1/C2 are functional/backend gaps surfaced by the frontend audit. Per §0 (frontend-only) they are **reported, not fixed** — they require server routes (auth logic), which are out of scope for this initiative.

### High

| # | Route/File | Category | Defect | Status |
|---|---|---|---|---|
| H1 | `DESIGN.md §6.1/§6.3` vs `globals.css` | Doc drift | As-built token tables stale (`--shell`, `--background`, `--foreground`, `--muted`, shell-*, `--status-lost` hue documented as `0 72% 51%` but implemented Farmers-red `350 78% 45%`). DESIGN.md is the binding source of truth. | **FIXED** |
| H2 | `dashboards/primitives.tsx` `DeltaPill` | Guardrail / token | Financial negatives rendered with `--destructive` — explicitly banned by DESIGN.md §15.2 (must use `--status-lost`). Shared across all dashboards. | **FIXED** |
| H3 | `dashboards/charts.tsx` `DONUT_TONES`/`HeatGrid` | Guardrail / token | Reserved gold (assumption) + red (loss) used as generic categorical chart fills — leaks guardrail color semantics. | **SLICE 0-b** (chart palette pass, needs visual review) |
| H4 | `StatTile` / `MetricCard` / `DashboardGrid` tile | Component forking | **Three** near-duplicate executive KPI tiles with divergent tone vocabularies (3 vs 6) and grid systems (`sm:2/lg:4` vs `2/md:3/xl:5`). Foundation-layer debt that propagates. | **FIXED (StatTile↔MetricCard)** (Slice 2: `MetricCard` is now the single canonical tile with a `valueSize` prop; `StatTile` delegates to it — output-preserving, DESIGN.md §8 updated. `DashboardGrid`'s builder tile is a separate client widget — assess next.) ⚠️ verify KPI tiles on the Vercel preview (auth-gated, not renderable headlessly). |
| H5 | `marketing.css` `.msite` | Token / divergence | Fully parallel hardcoded-hex brand palette (`--navy:#0E2350`, `--blue:#1C428B`…) diverging from `--shell`/`--primary` — two brand blues ship in one app. | **FIXED** (Slice 1 pt2: formally sanctioned as a separate marketing token layer — DESIGN.md §6.5, with a "no inline hex" rule) |
| H6 | `workshops/page.tsx` | SEO | Lead-gen hub sets no `robots`, inherits root `noindex` → primary funnel page silently de-indexed; also absent from `sitemap.ts`. | **FIXED** (Slice 1: `robots:index` + sitemap now lists canonical `/workshops`) |
| H7 | `page.tsx` (home) + assets | SEO / social | Declares OG/Twitter cards but **no OG image** exists; no `opengraph-image`/apple-touch icon. | **FIXED** (Slice 1: branded `opengraph-image.tsx`; Slice 1 pt2: `apple-icon.tsx` — both via `next/og`) |
| H8 | `(public)/403/page.tsx` | Dead-end | "Contact support" → `/support`, which has no page route (404 from an error page). | **FIXED** (Slice 1: → `mailto:CONTACT.email`) |

### Medium

| # | Route/File | Category | Defect | Status |
|---|---|---|---|---|
| M1 | `ui/table.tsx` | A11y | `TableCaption` documented (§7) but not implemented/exported — tables lack programmatic caption. | **FIXED** |
| M2 | `portal/PortalShell.tsx` | A11y | No skip-to-content link; `<main>` had no `id` target — keyboard users tab the whole sidebar on every authenticated page. | **FIXED** |
| M3 | `archetypes/shells.tsx` `WizardShell` | A11y | Completed vs upcoming steps signaled by **color alone** (no icon/text state). | **FIXED** |
| M4 | `ui/table.tsx` | A11y / responsive | Header comment claims "sticky-capable" but no `sticky top-0` / sticky-first-column implemented; wide financial tables lose context on scroll. | **SLICE 2** |
| M5 | `ui/table.tsx` | Responsive | Mobile strategy is `overflow-x-auto` only — no stack-to-cards / sticky id column below `sm`. | **SLICE 2** |
| M6 | `globals.css:118-120` | A11y | Global `:focus-visible { outline: 2px solid transparent }` makes native focus invisible; any element missing a ring class has zero visible focus. Fix is subtle (components rely on transparent outline to avoid double rings) → needs care. | **SLICE 0-b** (a11y pass w/ visual verify) |
| M7 | `dashboards/charts.tsx` `HeatGrid` | A11y / token | `text-white` literal on variable-opacity tone bar can fall below AA on light tones. | **SLICE 0-b** |
| M8 | `dashboards/primitives.tsx` vs `archetypes/shells.tsx` | Consistency | Two competing KPI grid systems (see H4). | **SLICE 2** |
| M9 | `[slug]/page.tsx` | Data/SEO (NAP) | Hardcodes "McKinney, TX" but canonical location is Frisco (`lib/site.ts`) — inconsistent NAP; also `'use client'` blocks `metadata` export. | **FIXED** (Slice 1: NAP from `CONTACT`; Slice 1 pt2: split into server `page.tsx` (exports `metadata`, noindex) + `ReferralClient.tsx`). ⚠️ Frisco-vs-McKinney is a business fact for the FSA to confirm in `lib/site.ts`. |
| M10 | `/refer`, `/consent`, `AuthShell` pages | A2P footer | Bare `<main>` with no footer → no Privacy/SMS-Terms links on a **consent-capturing** page. | **SLICE 1** (footer chrome + carrier-ready consent copy written directly; no approval gate — see A2P report) |

### Low (representative — full list in agent transcripts)

| # | Route/File | Category | Defect | Status |
|---|---|---|---|---|
| L1 | `globals.css:220` | Token | `body { color: #12243b }` hardcoded ink (near-`--foreground`); also `background`/font literals in the legacy base block. | **DEFERRED** (legacy base — §1.6; migrate carefully) |
| L2 | `SiteFooter.tsx:18`, `page.tsx:356` | Token | Inline `#9DB6DE` / `#B9C9E6` hexes in shared public components. | **FIXED** (Slice 1 pt2: moved to `.msite` classes `brand__sub` / `microcopy--onnavy` in marketing.css) |
| L3 | `globals.css` scrollbar; `BrandMark`/`ProfileMenu` `ring-white/10`; `shells.tsx` `bg-white/60` hairline | Token | Assorted raw white/rgba literals; introduce a `--highlight` token. | **SLICE 2** |
| L4 | `archetypes/states.tsx` `StatusBadge` | Microcopy | Default label renders raw lowercase enum (`won`/`lost`). | **SLICE 2** |
| L5 | `ui/badge.tsx` | Consistency | `assumption`/`security` variants use a different opacity/border recipe than status variants. | **SLICE 2** |
| L6 | Public internal links (`SiteHeader`/`SiteFooter`/forms) + private `WorkshopStatusControl` | Perf/UX | `<a href>` for internal routes instead of `next/link` (full reloads; the pre-existing lint warnings). | **FIXED** (pt2: header/footer; pt3: legal pages, consent forms, workshop detail pages; Slice 2: private-app `WorkshopStatusControl`. **Repo-wide `no-html-link` warnings now 0.**) |
| L7 | logo `<img>` in `SiteFooter`/`icons.tsx` | Images/CLS | Approved-asset SVG logos lack explicit `width`/`height` (CLS risk). | **FIXED** (Slice 1 pt3: intrinsic `width/height` on footer carrier logo + emblem — provides aspect ratio so space is reserved; CSS still controls display size) |

## 3. Correct-as-built (do not re-flag)

- **No public registration surface** (guardrail intact).
- Marketing site is responsive (`clamp()` type, grid collapse 960→420px, real burger w/ `aria-expanded`/`aria-controls`), has a skip link, labeled fields, `focus-visible` rings, `aria-current`, non-color-only star ratings.
- Auth forms (`LoginForm`, `ForgotPasswordForm` with no-enumeration copy, `ResetPasswordForm` with expired/used branch, `MfaForm`) have full loading/error/success states. **Only invite/verify are stubs (C1/C2).**
- Homepage images use `next/image` (`fill`+`sizes`+`priority` hero; sized bio image) with descriptive alt.
- A2P core pages (Privacy no-3rd-party clause, SMS Terms, Terms) present & carrier-compliant; `SiteContactForm` is a gold-standard opt-in CTA. (Details: `a2p-10dlc-website-compliance.md`.)
- Backend comms compliance (7-step gate, STOP/HELP, DNC, quiet hours, is_security firewall, Twilio signature verify) present & wired — unchanged.

## 4. Fixed this session (Slice 0)

H1 (DESIGN.md token reconciliation), H2 (`DeltaPill` guardrail), M1 (`TableCaption`), M2 (`PortalShell` skip-link), M3 (`WizardShell` non-color-only steps), **plus** the CI `next build` gate (§12). All verified: type-check ✅ lint ✅ test ✅ build ✅. No backend/schema/RLS/compliance/securities/A2P-copy surface touched.
