# ADR-037 — Unify the Life Conversion module's four names

**Status:** Proposed
**Date:** 2026-08-06
**Owner:** FSOS Engineering

> **This is a proposal, not an executed change.** It was written because the campaign parity
> work was explicitly scoped to exclude it: the rename touches routes and API paths, which is a
> decision for the owner rather than a refactor to slip into a design pass. Nothing in this ADR
> has been implemented. It exists so the decision can be made deliberately, with the cost known.

## Context

The Life Conversion engine carries **four different names for one thing**:

| Layer | Name | Files |
|---|---|---|
| Route | `life-conversion` | `src/app/(fsa)/app/comms/life-conversion/**` |
| Library | `life-campaign` | `src/lib/life-campaign/**` — 10 importing files |
| API | `/api/life-campaign` | 4 route handlers, 5 referencing files |
| Table prefix | `life_campaigns`, `life_campaign_enrollments`, `life_campaign_executions`, `life_advisor_touches` | 22 files |
| Engine key | `life_conversion` | 30 files (registry, consent groups, asset catalog, console deep-link) |

The two sibling engines do not have this problem. Cross-Sell Life is `cross-sell-life` /
`cross_sell_life` / `xsell_life_*` throughout (two forms, one of them a table-prefix
abbreviation). Pipeline Win-Back is `pipeline-winback` / `pipeline_winback` throughout.

Note the third form hiding in the tables: the advisor-touch table is `life_advisor_touches`,
not `life_campaign_advisor_touches`, so even within the database the prefix is inconsistent.
Cross-Sell has the same wrinkle (`xsell_life_advisor_touches`).

The cost is real but bounded: every reader must hold a mental mapping from route → lib → API →
table, and every new contributor rediscovers it. It has not caused a defect. It is a legibility
tax, not a correctness one — which is precisely why it keeps not getting fixed.

## Decision (proposed)

Standardise on **`life-conversion` / `life_conversion`**, matching the user-facing route and the
engine key already used by the shared registry, the consent groups, and the asset catalog.

Explicitly **out of scope**: renaming database tables. See "Alternatives" — the migration cost
is not justified by the benefit, and a table name is not read by anyone navigating the product.

Target end state:

| Layer | Today | Proposed |
|---|---|---|
| Route | `life-conversion` | unchanged |
| Engine key | `life_conversion` | unchanged |
| Library | `src/lib/life-campaign` | `src/lib/life-conversion` |
| API | `/api/life-campaign` | `/api/life-conversion` (301 from the old path) |
| Tables | `life_campaigns`, … | **unchanged** |

## Rationale

Renaming *toward* the route and engine key rather than toward the table prefix is the cheaper
and more honest direction:

- The route and engine key are already the names a **user** and a **shared component** see.
  `CAMPAIGN_ENGINES.life_conversion` is the canonical identity as of the campaign unification.
- The library and API names are internal, so moving them costs no user-visible change.
- Table names are the one layer where a rename requires a migration, RLS re-verification, and a
  deploy-ordering dance. They are also the layer nobody navigating the app ever reads.

## Alternatives Considered

**1. Rename everything to `life_campaign`, including the route.** Rejected: it changes a
user-facing URL for an internal consistency benefit, invalidates any bookmark, and moves *away*
from the engine key that the shared registry, consent groups (`ConsentGroupKey`), and asset
catalog (`CAMPAIGN_LABELS`) already standardised on. Cost is higher and the result is worse.

**2. Include the table rename.** Rejected for now. It requires a forward-only migration across
four tables plus their indexes, RLS policies, and the `v_*` views that reference them, with
every policy re-proven — for zero user-visible benefit. If it is ever done it should be its own
ADR, sequenced independently, and it should fix `life_advisor_touches` → `life_conversion_advisor_touches`
in the same pass.

**3. Leave it.** Defensible. It has caused no defect in the life of the module. The argument
against is that the cost compounds: every future contributor pays the mapping tax, and the
campaign unification has just made the *other* two engines internally consistent, so Life is now
the only odd one out — the inconsistency is more conspicuous than it was.

## Consequences

**Positive**
- One name per layer boundary, matching both siblings.
- The `CAMPAIGN_ENGINES` registry's `apiRoot` and the library path stop disagreeing with `key`.
- New contributors stop needing the mapping.

**Negative / trade-offs**
- ~15 files change imports (10 library consumers + 5 API references).
- The API path change is externally visible. Any integration or saved request calling
  `/api/life-campaign/*` breaks without the redirect.
- The database keeps a name that now matches nothing else, so **one** mapping survives:
  `life_conversion` (everywhere) → `life_campaigns` (tables). This ADR trades four
  inconsistencies for one, deliberately, rather than pretending to eliminate all of them.
- Git history for `src/lib/life-campaign/**` gains a rename boundary.

## Proposed sequence

Each step is independently shippable and leaves the tree green.

1. **Add the new API route, keep the old one.** `/api/life-conversion/*` handlers that delegate
   to the same services. `/api/life-campaign/*` stays live and unchanged. Nothing breaks.
2. **Point every internal caller at the new path**, including `CAMPAIGN_ENGINES.life_conversion.apiRoot`.
   The presentation test already asserts `apiRoot` resolves to a real route handler, so this is
   compile- and test-guarded.
3. **Redirect the old path.** `/api/life-campaign/*` → `/api/life-conversion/*` (308, preserving
   method and body). Leave it in place for at least one release cycle; remove it only after
   confirming no external caller remains.
4. **Move the library.** `git mv src/lib/life-campaign src/lib/life-conversion` plus an import
   codemod. Pure internal rename, no runtime effect.
5. **Update the docs** — `docs/routes.md`, `docs/sitemap.md`, `docs/build-order.md`, and this ADR
   to Accepted.

**Verification at each step:** `npm run type-check`, `npm run lint`, `npm test`, `npm run build`.
Step 3 additionally needs a manual check that a `POST /api/life-campaign/{id}/control` still
reaches the control handler through the redirect, since a 308 that drops the body would silently
break the operational controls.

## Open question for the owner

Is anything outside this repository calling `/api/life-campaign/*`? A Make/GHL scenario, a saved
Postman collection, a monitoring check, or a cron defined outside `vercel.json` would each break
at step 3's cutoff. If the answer is unknown, step 3's redirect should be treated as permanent
rather than transitional.

## Related Documents
- `CLAUDE.md` §6 (architecture preservation), §19 (ADRs)
- `docs/frontend-audit/campaign-parity-audit.md` §2.7 — where the four names were catalogued
- `docs/adr/ADR-029-life-conversion-campaign.md`
- `src/lib/comms/campaign-presentation.ts` — `CAMPAIGN_ENGINES`, the registry this aligns to
