# Slice 10 — Planning intelligence on the existing dashboards

> Governed by build instruction §10. **No new dashboard.** Final slice.

## What shipped
Derived planning signals surfaced onto the **existing** Executive Dashboard and AI
Command Center.

- **`src/lib/fna/intelligence.ts`** — PURE `computePlanningSignals`: plans total /
  approved / needs-attention, low-completeness count, **planning confidence** (avg
  input completeness), open data-quality exceptions, **open advisor actions** (draft
  recommendations), reviews due, and upcoming milestones. Offline-tested
  (`tests/fna-intelligence.test.mjs`, 2).
- **`FnaPlanningIntelligence`** — a self-contained server component that loads its
  own signals and **renders nothing when the DB is unconfigured or there are no
  plans**, so it is safe to drop into any dashboard. Every tile links back into the
  command center (anti-dead-end).
- **Injected into** the Executive Dashboard (`/app`) and the AI Command Center
  (`/app/ai/workforce`) — one import + one render each; no existing widget touched.

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ (+intelligence 2) · RLS proof ✓ (19/19) ·
build ✓.

## Initiative complete
Slices 1–10 are merged. The FNA is now a structured, deterministic, versioned,
auditable planning system: a pure `decimal.js` engine, an immutable data model,
plan-type registry, intake + calculation, scenarios, retirement/education,
reproducible reporting (PDF/Excel), the consolidated command center, the advisor
workspace + recommendation governance, and planning intelligence on the existing
dashboards. See `docs/fna/current-state.md` and slices 1–10 docs.
