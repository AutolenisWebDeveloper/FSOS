# FNA Overhaul — Current-State Summary & Gap List

> Discovery output for the FNA overhaul (build instruction §10). Read the eight
> existing FNA files, map what they do, and record the gap to a structured,
> deterministic, versioned, auditable planning system. This is a point-in-time
> map, not a contract; the authority order in `CLAUDE.md` §1 still governs.

## 1. What exists today (the eight files)

| File | Lines | Responsibility | Keep / change |
|---|---|---|---|
| `src/lib/fna.ts` | 155 | `generateFNAReport(submission_id)` — **legacy** path over `form_submissions` / `customers`. AI narrative → JSON → stores on `form_submissions.fna_report`, back-links `commission_cases`. | Legacy tables. Leave working; do not extend. Superseded by the spine path. |
| `src/lib/fna/household-fna.ts` | 239 | `loadFnaContext(householdId)` + `generateHouseholdFna()` — spine path over `households` / `household_members` (DOB via `member_dob` RPC) / `household_policies` / `coverages`. AI narrative, firewall-aware, screened. | **Extend `loadFnaContext()`** (do not clone) as the prefill loader for structured intake. |
| `src/lib/fna/screen.ts` | 84 | Pure guardrail screen — recommendation-language + verbatim-disclaimer red line. Reuses `compliance/guardrail.ts`. | **Reuse unchanged.** Every narrative surface keeps passing through it. |
| `src/components/fna/FnaGenerator.tsx` | 281 | The one FNA UI — select household → generate → review → save. | Becomes **one action inside** the plan workspace (slice 3), not the landing page. |
| `src/app/(fsa)/app/fna/page.tsx` | 61 | `/app/fna` — renders `FnaGenerator`. `requireRole('fsa')`. | Becomes the command-center **Overview** (slice 3/8). Route stays. |
| `src/app/api/fna/generate/route.ts` | 69 | POST generate; audits `fna.generated` / escalates `fna.blocked` to `compliance_events`. | Keep; add structured-run endpoints alongside (slice 2+). |
| `src/app/api/fna/save/route.ts` | 93 | POST save → `documents` (`classification 'fna_report'`) + `activities` + audit. Re-screens server-side. | **Preserve this path** (build instruction §4); additionally persist the structured record. |
| `src/app/api/forms/fna/route.ts` | 53 | Public/internal form intake → `generateFNAReport` (legacy). | Leave working. Legacy submission surface. |

### Supporting conventions observed
- **Pure-core pattern** (`src/lib/data/gdc-tiers.ts`): dependency-free, no I/O, exported pure functions, unit-tested offline by compiling standalone with `tsc`. This is the template for the calculation engine.
- **Test harness** (`tests/*.test.mjs`): `execSync('npx tsc … --outDir <tmp>')` → `createRequire` → `assert`. No live Supabase. `npm test` chains every proof; CI (`.github/workflows/ci.yml`) runs `npm ci → type-check → lint → npm test → build → test:rls`.
- **Guardrails already in code:** securities firewall (`is_security` excluded from the model), green-zone red line (`screenFnaReport`), verbatim FINRA disclaimer (`FNA_DISCLAIMER`).
- **Migrations** — this figure was a point-in-time note (then "run through 048"). As built, the FNA data model shipped as **`060_fna_data_model.sql`**, recommendations as **`062_fna_recommendations.sql`**, and the FNA performance indexes as **`064_fna_performance_indexes.sql`** (repo head is 064; the 049 base was superseded by parallel comms/social migrations). New FNA migrations continue after the current head.
- Money math today is ad-hoc JS (`round2` in `gdc-tiers.ts` uses native floats) — acceptable for tier display, **not** for planning figures.

## 2. The gap (what the overhaul must add)

| Capability | Today | Target |
|---|---|---|
| Structured data model | none — only `reviews` / `review_types` | FNA record + immutable versions + inputs + assumption-sets + results + scenarios + goals + audit (slice 2) |
| Captured inputs | none stored | income/expenses/assets/liabilities/coverage/goals, each with value + source + verification + freshness + confidence (slice 2) |
| Deterministic calculation | numbers come from model output | **server-side, versioned, `decimal.js` engine** — no AI-authored figure (slice 1, **this PR**) |
| Assumptions | not stored | first-class versioned records; a run pins the exact assumption-set version (slice 1 defaults, slice 2 persistence) |
| Versioning / reproducibility | none | immutable versions; same inputs → same outputs; every figure traces to formula + version + inputs + assumptions |
| Scenarios | none | named what-ifs branched from a frozen version (slice 5) |
| Plan types | one narrative | plan-type **registry** (config, not 13 implementations); Express + Comprehensive first (slices 3–4) |
| Reporting | JSON blob in `documents` | reproducible client/internal reports from an APPROVED version (slice 7) |

## 3. Boundaries carried into every slice
- **Securities firewall** (`CLAUDE.md` §4.1): aggregate/permitted balances OK; never securities account numbers, order detail, holdings, or suitability determinations. Reuse the `is_security` gate.
- **Analyze, don't recommend** (build instruction §1): the engine produces analysis (gaps, projections, needs). No machine-generated product/suitability/best-interest/replacement recommendation. The licensed FSA authors and approves those.
- **No invented Farmers data** (`CLAUDE.md` §4.3): every assumption ships labeled `is_assumption`, never as fact.
- **Extend, don't fork** (`CLAUDE.md` §6): one engine, one data model, one assumption system across all plan types.

## 4. Slice-1 scope (this PR)
Deterministic calculation engine + versioned assumption defaults. **Headless** — no UI, no migrations. Pure `decimal.js` modules under `src/lib/fna/engine/`, exercised by unit + golden + property (`fast-check`) tests wired into `npm test`. Governed by **ADR-015**.
</content>
</invoke>
