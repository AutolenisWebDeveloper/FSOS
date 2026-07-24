# Slice 3 — Express Financial Checkup (Plan flow, end to end)

> Governed by ADR-015 (engine) + ADR-016 (data model). First slice with UI. Builds
> on the merged engine (Slice 1) and data model (Slice 2). One draft PR.

## What shipped
The fast path, end to end: pick a plan type + household → structured intake
(save-and-resume) → deterministic calculation → traceable, labeled results — plus
the rebuilt command-center Overview and the cash-flow / net-worth / goals modules.

### Backend (pure, offline-tested)
- **`src/lib/fna/plan-types.ts`** — the plan-type **registry** (config, not
  implementations). Each type declares its input `fields` and its `analyses`
  (engine formula ids). Express · Comprehensive · Financial Plan · Annual Review.
- **`src/lib/fna/calculate.ts`** — the **orchestrator**: normalizes inputs, runs the
  configured engine formulas, returns per-formula envelopes + completeness. Absent
  inputs skip cleanly (WARNING + lower confidence), never throw.
- **`src/lib/fna/store.ts`** — added `getPlanInputs`.
- **`src/lib/fna/module-results.ts`** — loads the latest calculated result per plan
  for a formula (two queries, no N+1) for the module views.

### API (thin routes → services)
- `POST /api/fna/plans` — create a plan (validated plan type + household).
- `POST /api/fna/plans/[id]/inputs` — save structured inputs (additive; conflicts
  preserved + detected). Never blocks.
- `POST /api/fna/plans/[id]/calculate` — run the engine over the plan's inputs and
  freeze an immutable version + per-formula result rows. No figure from a model.

### UI (`/app/fna`)
Overview (household reach, planning status, recent plans) · plans list · new plan ·
plan workspace (status, completeness, version history, Calculate) · intake
(sectioned, save-and-resume, live completeness meter) · results (every figure
Calculated + traceable to formula@version + assumptions + warnings) · cash-flow ·
net-worth · goals. The narrative generator is preserved at `/app/fna/generate`
(the landing page is no longer the generator). Existing generate/save still works.

## Tests
`tests/fna-calculate.test.mjs` (9) — registry, normalization, analyses run,
completeness, coverage-gap fed by life gross, incomplete-degrades-not-throws,
comprehensive adds/omits analyses by presence, determinism. Wired into `npm test`.

## Deferred (later slices)
The PIPELINE→OVERVIEW nav move + reviews/business-owner/tax-aware modules (slice 8),
scenarios (5), education deep-dive (6), reporting (7), advisor workspace (9),
dashboard intelligence (10). Prefill from household/members/policies is stubbed at
plan creation and deepens in slice 4 (Comprehensive intake) via `loadFnaContext`.

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ (engine 30 + lifecycle 10 + calculate 9) ·
RLS proof ✓ (18/18) · build ✓ (11 FNA routes compiled).
