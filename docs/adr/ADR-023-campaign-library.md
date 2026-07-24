# ADR-023 — Campaign Library (Pre-Built, Compliance-Ready Blueprints)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-013 (canonical `comm_*`), ADR-022 (builder purpose + delegated-sender), ADR-020 (data confidence); CLAUDE.md §4.2/§4.3/§12; master build instruction §17–§18.

## Context

The campaign + sequence builder (ADR-022) starts from a blank page: the FSA must write a body, pick a category, and choose a purpose from scratch every time. There is no curated starting content, which is both a productivity gap and a compliance risk (each hand-written body is a fresh chance to introduce recommendation language). Master build instruction §17 calls for a **campaign library** of ready-made campaigns; §18 grounds the claim-bearing ones in data confidence.

Two constraints shape the design:
- **The approval gate must not be bypassed (§12).** Only an approved `comm_template` can back a campaign; a library must not create auto-approved sendable content.
- **No invented Farmers data (§4.3).** Blueprint bodies must not assert product facts, deadlines, commission splits, or carrier rules — they are generic invitations; any specific claim is grounded in the recipient's stored data at send time (§13).

## Decision

**A curated catalog of blueprints in version-controlled code; instantiation seeds a DRAFT template that still goes through human approval.** (Slice 8, §17. The §18 data-confidence claim wiring for claim-bearing blueprints follows.)

1. **Pure catalog `library.ts`.** `CAMPAIGN_BLUEPRINTS: CampaignBlueprint[]` — each blueprint carries a stable `key`, `channel`, recommended `purpose` (ADR-022), `category`, `audienceKind`, a green-zone `body` (footer-free, recommendation-free, merge-token-based), and `makesSpecificClaims` + `claimFields` for the §18 wiring. Pure selectors `listBlueprints` / `getBlueprint` / `blueprintToTemplateDraft`. Being code (not per-tenant data), the catalog is version-controlled and unit-tested.

2. **Catalog is proven compliant by test.** `tests/comms-library.test.mjs` asserts every blueprint has a valid purpose/category/channel, a unique key, **no recommendation language in any body** (reusing `containsRecommendationLanguage`), and that a claim-bearing blueprint declares its claim fields. A non-compliant blueprint fails the build.

3. **Instantiation seeds a DRAFT template.** `POST /api/comms/library { blueprintKey }` inserts a `comm_templates` row in `approval_status='draft'` (re-checking recommendation language as belt-and-suspenders) and returns the blueprint's recommended campaign config (purpose / audience / claim fields) so the FSA can carry it into the builder **once the template is approved**. `GET` lists the catalog. The approval gate is never bypassed.

4. **UI.** `/app/comms/library` browses the blueprints (channel / purpose / claim badges + body preview) with "Add to templates (draft)"; a Library link joins the comms nav.

## Rationale

- **Compliance-ready starting points, not send-ready campaigns.** Seeding a *draft* template keeps the human approval gate exactly where it is; the library removes the blank page, not the reviewer.
- **Catalog as code.** A curated library of compliance-vetted content belongs in the repo (reviewable, testable, diffable), not as invented runtime data (§4.3). The catalog test makes "green-zone only" a build gate.
- **Carries the Slice 7 config forward.** Each blueprint recommends a purpose + audience so the campaign built from it inherits the right §9/§10 governance; claim-bearing blueprints pre-declare their claim fields for §18.

## Alternatives Considered

- **Instantiate a ready-to-send campaign** — rejected: it would either auto-approve a template (bypassing §12) or create a campaign with an unapproved template (weakening the builder's approved-template invariant). Draft-template-first keeps both intact.
- **Store the catalog in the database** — rejected: the catalog is curated content maintained by engineering, not per-tenant data; code keeps it version-controlled and test-gated, and avoids a migration + RLS surface for read-only static content.

## Consequences

**Positive**
- The FSA starts from vetted, purpose-tagged content; the catalog test guarantees no library body can carry recommendation language.
- Claim-bearing blueprints are ready for the §18 data-confidence wiring (they already declare their claim fields).

**Negative / trade-offs**
- Instantiation is a two-step flow (seed draft → approve → build campaign) rather than one click to a live campaign — the cost of not bypassing the approval gate.
- Data-confidence enforcement for claim-bearing blueprints is not yet wired (Slice 8 §18); today the claim metadata is declarative.

## Related Documents

- CLAUDE.md §4.2/§4.3/§12; master build instruction §17–§18
- ADR-013, ADR-020, ADR-022
- `src/lib/comms/library.ts`, `src/app/api/comms/library/route.ts`, `src/app/(fsa)/app/comms/library/page.tsx`, `src/components/app/LibraryControls.tsx`
- Tests: `tests/comms-library.test.mjs`
