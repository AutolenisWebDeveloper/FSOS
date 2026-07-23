# Slice 1 — Calculation Engine + Assumptions (Plan)

> Governed by **ADR-015**. Headless: no UI, no migrations. One draft PR, then stop
> for review (build instruction §2). TDD throughout (`test-driven-development`).

## Objective
A centralized, deterministic, server-side, versioned calculation engine under
`src/lib/fna/engine/`. All money math in `decimal.js`. Every calculation returns a
traceable envelope. Versioned assumption defaults ship labeled `is_assumption`.

## Module layout
```
src/lib/fna/engine/
  money.ts          Decimal helpers, rounding rules, currency. Pure.
  types.ts          ValueLabel, Labeled, AssumptionRef, CalcWarning, Confidence,
                    CalcResult envelope, buildResult() helper.
  assumptions.ts    AssumptionSet type + DEFAULT_ASSUMPTIONS (versioned, labeled).
  formulas/
    future-value.ts       FV of lump sum + ordinary annuity (primitive)
    present-value.ts      PV of lump sum + annuity (primitive)
    cash-flow.ts          income vs expenses, surplus/deficit, savings rate
    net-worth.ts          assets vs liabilities, net worth
    emergency-fund.ts     months covered, target, adequacy, shortfall
    life-insurance.ts     income-replacement + capital-needs (both labeled), gap
    coverage-gap.ts       coverage inventory total vs need
    disability.ts         income-replacement gap for disability
    retirement.ts         projection to/through retirement, shortfall/surplus
    education.ts          per-goal funding need + shortfall (education inflation)
    survivor-income.ts    survivor capital need vs resources, gap
    debt-paydown.ts       months to payoff, total interest
  registry.ts       FORMULAS catalog (id, version, label, category, inputs) +
                    runFormula() dispatcher — feeds the future Formula Explorer.
  index.ts          Barrel export.
```

## Result envelope (every formula)
`formula_id · formula_version · inputs · input_sources · assumptions_used ·
intermediates · output · rounding · currency · warnings · missing_inputs ·
confidence · computed_at`.
`computed_at` is passed in (purity). Money outputs rounded to cents via the
declared rounding rule; intermediates preserved as decimal strings.

## Value labels (build instruction §1)
`verified · client_supplied · imported · calculated · estimated ·
assumption_based · incomplete · unavailable · needs_confirmation`.
Engine outputs are `calculated`; assumption-derived contributions are recorded in
`assumptions_used`; absent inputs land in `missing_inputs` and lower confidence.

## Assumptions (first-class, versioned, labeled)
`DEFAULT_ASSUMPTIONS` v1: inflation, wage growth, investment return (pre/post
retirement), retirement age, life expectancy, education inflation, Social Security
COLA, effective tax rate, safe withdrawal rate, emergency-fund months, disability
replacement %, income-replacement years. Each: `{ key, value, unit, source,
effective_date, is_assumption: true }`. Set carries `version` + `label`. **These
are config defaults to verify — never Farmers-published facts** (`CLAUDE.md` §4.3).

## Tests (`tests/fna-engine.test.mjs`, added to `npm test`)
- **Unit** per formula with hand-verified fixtures (arithmetic shown in comments).
- **Golden cases** — complete households with hand-computed expected outputs that
  must not drift (version pin).
- **Property-based** (`fast-check`) invariants:
  - a larger retirement shortfall never yields a smaller need;
  - doubling income never reduces cash-flow surplus;
  - rounding never compounds (sum of rounded parts within one cent of rounded sum);
  - FV monotonic in rate and in periods for non-negative flows;
  - net worth = assets − liabilities for any non-negative vectors.
Compiles the engine standalone with `tsc` (outDir under cwd so `decimal.js`
resolves), then `require`s it — same harness as `tests/gdc-tier.test.mjs`.

## Determinism rules
No `Date.now()` / `Math.random()` / ambient clock in the engine. Same inputs +
same assumption-set version ⇒ identical outputs. Formula math change ⇒ version
bump + golden-fixture update.

## Out of scope for Slice 1
Persistence (slice 2), UI (slice 3+), scenarios (slice 5), reporting (slice 7).
No change to the existing generate/save narrative path — it keeps working.

## Definition of done
`decimal.js` for all money · every output traces to formula + version + inputs +
assumptions · same inputs → same outputs · assumptions versioned + labeled ·
graceful degradation (warnings, not throws) on missing optional inputs · unit +
golden + property tests green · `type-check`, `lint`, `npm test`, `build` clean ·
ADR-015 accepted · draft PR opened.
</content>
