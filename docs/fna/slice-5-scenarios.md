# Slice 5 — Retirement planning + Scenarios

> Governed by ADR-015 + ADR-016. Builds on the plan flow (Slice 3). One draft PR.

## What shipped
The retirement readiness view and the **scenario engine** — named what-ifs branched
from a frozen version, re-run deterministically and compared side by side.

### Scenario engine (pure)
- **`src/lib/fna/scenarios.ts`** — `ScenarioOverride` (inputs / inputDeltas /
  assumptions), a `SCENARIO_PRESETS` catalog (retire at 62/65/70, save more, cut
  expenses, high/low inflation, market stress, long life, delayed SS),
  `applyOverride` (set / delta-floor / assumption replace), and `computeScenario`
  (apply → re-run the orchestrator). Never mutates the base version.
- Tests: `tests/fna-scenarios.test.mjs` (7) — preset lookup, override application,
  retiring-later-reduces-shortfall, saving-more-reduces-shortfall, market-stress-
  lowers-savings, base-not-mutated, determinism.

### Store + API
- `store.ts` — `getVersionSnapshot` (values + assumption set from a frozen version),
  `createScenario`, `listScenarios`.
- **`POST /api/fna/plans/[id]/scenarios`** — branch from the plan's current version,
  merge preset + custom overrides, re-run the engine, store the result. 422 if the
  plan has no calculated version to branch from.

### UI
- `/app/fna/retirement` — readiness per plan (on-track / gap, shortfall or surplus,
  projected vs. needed, funded ratio).
- `/app/fna/plans/[id]/scenarios` — one-click scenario builder + a retirement
  comparison table (base vs. each scenario). Linked from the workspace rail.
- `/app/fna/scenarios` — scenario center (calculated plans + scenario counts).

## Deferred
Education deep-dive (6) · per-scenario full result drill-down + more presets
(early death / disability / LTC / surviving-spouse survivor-analysis variants land
with the survivor UI) · reporting (7).

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ (+scenarios 7) · RLS proof ✓ (18/18) ·
build ✓ (retirement + scenario routes compiled).
