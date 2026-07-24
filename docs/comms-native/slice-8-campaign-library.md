# Native Communications Platform — Slice 8 (§17): Campaign Library

> Vertical slice per master build instruction §4 (Slice 8 of 9; §17). Authoritative rationale: **ADR-023**.
> §18 (data-confidence wiring for claim-bearing blueprints) is the follow-up. GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Curated catalog (§17)** | `library.ts` — `CAMPAIGN_BLUEPRINTS`: pre-built, green-zone blueprints (annual review, term-conversion window, coverage-gap education, lapsed check-in, appointment reminder, workshop invite, birthday). Each carries channel, recommended **purpose** (Slice 7), category, audience kind, and — for claim-bearing ones — `makesSpecificClaims` + `claimFields` (for §18). |
| **Proven compliant** | `tests/comms-library.test.mjs`: every body is **recommendation-free** (`containsRecommendationLanguage`), every purpose/category/channel valid, keys unique, claim-bearing ⇒ claim fields declared. A non-compliant blueprint fails the build. |
| **Instantiation (approval gate intact)** | `POST /api/comms/library { blueprintKey }` seeds a **DRAFT** `comm_template` (re-checked recommendation-free) and returns the blueprint's recommended purpose/audience/claims. `GET` lists the catalog. Nothing is auto-approved; the human approval gate is untouched (§12). |
| **UI** | `/app/comms/library` — blueprint cards (channel / purpose / claim badges + body preview) with "Add to templates (draft)"; a Library link in the comms nav. |

## Extend-before-build

Reuses the existing `comm_templates` store + its approval flow + the `containsRecommendationLanguage`
guardrail — **no migration, no new content store, no second approval path.** The catalog is code
(version-controlled, test-gated), not invented runtime data (§4.3).

## Scope boundary

- Instantiation seeds a **draft template** (needs approval before a campaign can use it) — deliberately
  two-step so the §12 approval gate is never bypassed. The blueprint's recommended purpose/audience is
  returned so the FSA carries it into the Slice 7 builder after approval.
- **Data-confidence enforcement for claim-bearing blueprints is Slice 8 §18** — today the claim metadata
  (`makesSpecificClaims` / `claimFields`) is declarative; §18 wires it into dispatch so an unverified/
  conflicting claim is excluded + a verification task raised (§13).

## Evidence

- `tests/comms-library.test.mjs` — 8 assertions (catalog integrity, unique keys, valid purpose/category/
  channel, no recommendation language, claim-field declaration, both claim/non-claim paths, selectors).
- `npm test` (+`comms-library`) · `type-check` · `lint` · `test:rls` (unchanged — no migration) · `build`.

## Guardrails touched

Every blueprint body is green-zone + recommendation-free (build-gated by the catalog test). Instantiation
re-checks recommendation language and seeds only DRAFT (approval-gated) content — no auto-approve, no
invented Farmers data (§4.3). Securities firewall + AI red-line unchanged. GHL frozen (§0.A).
