# ADR-015 — FNA Deterministic Calculation Engine

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering

## Context
The Financial Needs Analysis today is AI-generated prose persisted as a document
(`src/lib/fna/household-fna.ts` → `documents`). Every number in it comes from
model output. Two identical households can produce different figures, and no one
can explain how a figure was derived. FSOS is operated by a FINRA-registered
representative; a client-facing financial figure that cannot be reproduced or
traced is a regulatory and trust liability.

Forces:
- **Reproducibility & audit** — a figure shown to a client must be recomputable
  identically and trace to its formula, version, inputs, and assumptions.
- **The securities/advice boundary** (`CLAUDE.md` §4.1, build instruction §1) —
  the system *analyzes*; the licensed human *recommends*. A machine number must
  never be presented as authoritative product/suitability advice.
- **Money correctness** — native JS floating-point is unacceptable for money.
- **No invented Farmers data** (`CLAUDE.md` §4.3) — planning inputs like
  inflation, growth, retirement age, and life expectancy are assumptions, not
  facts, and must be versioned and labeled.
- **One engine, many plan types** (build instruction §0) — Express, Comprehensive,
  Retirement, Education, etc. must share one calculation core, not fork per type.

## Decision
All FNA money math runs in a **centralized, server-side, deterministic, versioned
calculation engine** at `src/lib/fna/engine/`, separate from AI narrative.

1. **Pure & offline-testable.** The engine performs **no I/O** and holds **no DB
   access**. Inputs are passed in; results are returned. It follows the existing
   pure-core pattern (`src/lib/data/gdc-tiers.ts`) and compiles standalone for
   tests (`tests/fna-engine.test.mjs`), same as the compliance/tier cores.
2. **`decimal.js` for every money and rate operation.** Native floating-point is
   never used for a monetary or rate calculation. Helpers live in
   `engine/money.ts`; formulas never touch `Decimal` construction ad hoc.
3. **Deterministic.** No `Date.now()`, no `Math.random()`, no ambient clock
   inside the engine. Any "as-of" timestamp is passed in by the caller. Same
   inputs + same assumption-set version ⇒ byte-identical outputs.
4. **Versioned formulas.** Every calculation has a stable `formula_id` and a
   `formula_version`. Changing a formula's math bumps its version; golden-case
   fixtures pin outputs so a version can never silently drift.
5. **Rich, traceable result envelope.** Every calculation returns:
   `formula_id`, `formula_version`, `inputs`, `input_sources`, `assumptions_used`,
   `intermediates`, `output`, `rounding`, `currency`, `warnings`, `missing_inputs`,
   `confidence`, and a caller-supplied `computed_at`. Every displayed number is
   reconstructable from this envelope.
6. **Assumptions are first-class, versioned, labeled.** A default assumption-set
   (`engine/assumptions.ts`) ships as `is_assumption: true` config with value,
   unit, source, and effective date. A calculation records exactly which
   assumption values it used, so a result can be recomputed against the same set.
7. **The AI never produces an authoritative number.** The model may draft
   *explanatory language* around results and help *extract/normalize* inputs.
   Model arithmetic is never the source of a figure shown to a client.
8. **Graceful degradation, not blocking.** Missing optional inputs produce a
   `warning` + `missing_inputs` entry and reduce `confidence`; they do not throw.
   The only hard errors are: a calculation that cannot be computed from the
   inputs available, a securities-firewall violation, unresolved identity, or an
   attempt to present an unapproved figure (build instruction §0.B severity).

## Rationale
Separating deterministic calculation from AI narrative is the core architectural
principle of the overhaul. It makes every figure reproducible and auditable,
keeps the model on the correct side of the advice boundary, and lets all plan
types share one engine (configuration, not thirteen implementations). Purity
makes the engine trivially unit-testable offline and immune to environment drift.

## Alternatives Considered
- **Keep AI-authored numbers, add a disclaimer.** Rejected: irreproducible,
  untraceable, and puts model arithmetic on the wrong side of Reg BI.
- **Compute inline in services/routes.** Rejected: money math would fragment
  across handlers, defeating one-engine reuse and offline testability (§6).
- **Native JS floats with careful rounding.** Rejected: accumulation error is
  unacceptable for client-facing financial figures; `decimal.js` is required.
- **A stateful engine that reads its own assumptions from the DB.** Rejected:
  couples math to I/O, breaks purity and determinism, and blocks offline golden
  tests. The caller (service layer, slice 2) loads assumptions and passes them in.

## Consequences
**Positive**
- Every figure traces to formula + version + inputs + assumptions; identical
  inputs always yield identical outputs.
- Engine is unit/golden/property-tested with no live Supabase; drift is caught by
  fixtures in CI.
- One engine serves all plan types; adding a plan type is configuration.
- Model stays on the analysis side of the advice boundary.

**Negative / trade-offs**
- New runtime dependency (`decimal.js`) and a dev dependency (`fast-check`).
- Callers must supply assumptions and the `computed_at` clock — a small amount of
  wiring pushed to the service layer (slice 2) in exchange for a pure core.
- Formula changes require a version bump + golden-fixture update, by design.

## Related Documents
- `CLAUDE.md` §3.1 (conventions), §4.1 (securities firewall), §4.3 (no invented data), §6 (architecture preservation), §11.1 (AI governance — structured, validated, no autonomous authoritative output)
- Build instruction §0 (architecture principle), §3 (Slice 1), §0.B (validation severity)
- `docs/fna/current-state.md`, `docs/fna/slice-1-plan.md`
- Pattern precedent: `src/lib/data/gdc-tiers.ts`, `tests/gdc-tier.test.mjs`
- Deferred to Slice 2: FNA data model ADR (persistence of inputs, versions, assumption-sets, results).
</content>
