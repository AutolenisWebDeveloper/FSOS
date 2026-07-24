---
name: fsos-financial-planning
description: Build and extend FSOS's structured financial-planning system — the deterministic calculation engine, the FNA data model, the plan-type registry, and the calculation orchestrator behind the AI FNA Command Center. Use this whenever a task touches the FNA (Financial Needs Analysis), financial calculations (cash flow, net worth, emergency fund, life-insurance need, disability, retirement, education, survivor income, debt paydown, FV/PV), planning assumptions, plan versions/scenarios/goals, the /app/fna workspace, or the /api/fna/plans endpoints. Reach for it even when the user just says "add a retirement projection", "why is this FNA number wrong", "add a plan type", or "make the results traceable" — so the separate-calculation-from-narrative principle, decimal.js money rules, and the value-labeling/traceability contract are all respected. NOT for the AI narrative red-line screen (that is lib/fna/screen.ts + the compliance guardrail) beyond noting it still gates narrative output.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: financial-planning
  guardrails: "4.1 securities firewall, 4.3 no-invented-data, §1 analyze-not-recommend"
  adrs: "ADR-015 calculation engine, ADR-016 data model"
---

# FSOS Financial Planning

The structured, deterministic, versioned, auditable planning system that replaced
the AI-narrative FNA. **Separate deterministic calculation from AI narrative** is
the non-negotiable architecture principle.

## The layers (do not blur them)

1. **Engine** — `src/lib/fna/engine/**`. PURE `decimal.js` formulas, no I/O, no
   clock, no RNG. Every formula returns the traceable `CalcResult` envelope
   (`formula_id`, `formula_version`, inputs, input_sources, assumptions_used,
   intermediates, output, rounding, currency, warnings, missing_inputs,
   confidence, computed_at). Compiles standalone for offline tests. **ADR-015.**
2. **Plan-type registry** — `src/lib/fna/plan-types.ts`. PURE config. A plan type
   declares its input `fields` (shared by intake UI + orchestrator + completeness)
   and its `analyses` (engine formula ids). **Adding a plan type is a new entry
   here — never a new engine or data model.**
3. **Orchestrator** — `src/lib/fna/calculate.ts`. PURE. Maps a plan's normalized
   inputs → the engine formulas configured for its type → result envelopes +
   completeness. Absent inputs are simply not passed (engine degrades to a
   warning); never throws.
4. **Data model** — migration `060_fna_data_model.sql`, `src/lib/fna/store.ts`,
   `src/lib/fna/plan-lifecycle.ts`. `fna_plans` / immutable `fna_versions` /
   `fna_inputs` (with provenance) / `fna_assumption_sets` / `fna_results` /
   `fna_scenarios` / `fna_goals` / `fna_data_quality_exceptions`. **ADR-016.**
5. **API + UI** — thin routes under `/api/fna/plans/*`; RSC pages under `/app/fna`.

## Hard rules (enforced, not advisory)

- **decimal.js for ALL money and rate math.** Never native floats. Use the
  helpers in `engine/money.ts` (`D`, `sum`, `money`, `rate`, `ratio`, `pctOf`,
  `atLeastZero`). Money rounds `ROUND_HALF_UP@2dp`.
- **The AI never produces an authoritative number.** Model output is never the
  source of a figure shown to a client. The AI may draft *explanatory language*
  and help *extract/normalize* inputs. The narrative screen
  (`lib/fna/screen.ts`) still gates any narrative for the recommendation red-line
  and the verbatim FINRA disclaimer.
- **Analyze, don't recommend.** The system produces gaps/projections/needs. It
  never emits a product/suitability/best-interest/replacement recommendation —
  the licensed FSA authors and approves those.
- **Determinism.** No `Date.now()`/`Math.random()`/ambient clock inside the engine
  or orchestrator — the caller passes `computedAt`. Same inputs + same
  assumption-set version ⇒ identical outputs. A formula math change bumps its
  `formula_version` and updates the golden fixtures.
- **Assumptions are labeled, versioned config** (`is_assumption: true`) — never
  Farmers/FFS facts (CLAUDE.md §4.3). A version pins the exact assumption-set it
  used so any result recomputes identically.
- **Securities firewall** (§4.1): aggregate/permitted balances only — never
  account numbers, holdings, or suitability determinations.
- **Graceful degradation** (§0.B): missing optional data → WARNING + lowered
  confidence, displayed, never a blocker. An incomplete FNA is still usable.
- **Immutability**: `fna_versions` snapshot columns never mutate; an APPROVED
  version never deletes (DB trigger). Regenerating creates a new version.
- **Value labels** (§1): every displayed value is one of Verified · Client-supplied
  · Imported · Calculated · Estimated · Assumption-based · Incomplete · Unavailable
  · Needs confirmation. Engine outputs are `calculated`. Render via
  `src/components/fna/value-label.tsx`.

## How to add things

- **A formula:** add a pure module under `engine/formulas/`, return the full
  envelope via `buildResult`, register it in `engine/registry.ts`, add unit +
  golden + (where invariant-bearing) fast-check property tests to
  `tests/fna-engine.test.mjs`.
- **A plan type:** add a `PLAN_TYPES` entry (fields + analyses + reportTemplate).
  If it needs an analysis that doesn't exist yet, add the formula first.
- **A calculation surface:** wire it in `calculate.ts` by mapping normalized input
  keys to the formula's input shape; guard optional analyses on their required
  keys so absent inputs skip cleanly.
- **Prefill from FSOS data:** `prefill.ts` is a PURE mapper from a household context
  (`loadFnaContext`) to suggested inputs, each labeled `imported` (a starting value
  the FSA confirms) and firewall-safe (securities policies excluded). The
  `/api/fna/plans/[id]/prefill` route loads the context, maps, and saves; the intake
  form merges suggestions into EMPTY fields only (never clobbers a user entry). Add
  new derivations to `mapContextToInputs`, keep it pure, and cover them in
  `tests/fna-prefill.test.mjs`.

## Tests (the pure-core offline pattern)

`tests/fna-engine.test.mjs` (30), `tests/fna-plan-lifecycle.test.mjs` (10),
`tests/fna-calculate.test.mjs` (9) compile the pure modules standalone with `tsc`
into a temp dir under cwd (so `decimal.js` resolves) and assert. `tests/rls-firewall.test.mjs`
proves `fna_*` RLS default-deny + version immutability against ephemeral Postgres.
Golden values are hand-computed and pinned — never let them drift silently.

## Routes (all under /app/fna — the AI FNA Command Center)

Overview `/app/fna` · plans `/app/fna/plans` (+ `/new`, `/[id]`, `/[id]/inputs`,
`/[id]/results`) · modules `/app/fna/cash-flow`, `/net-worth`, `/goals`,
`/assumptions` · narrative generator preserved at `/app/fna/generate`. The
PIPELINE→OVERVIEW nav move + remaining modules land in later slices.
