// src/lib/money.ts
// Shared money primitives for non-FNA money math (commissions, GDC, revenue,
// dashboard totals). Re-exports the FNA engine's decimal.js core so the whole app
// has ONE money implementation (§6 — no parallel money helper). decimal.js only:
// native floating-point is never used to accumulate or scale currency, where
// repeated `+`/`*` drift real cents.
//
// Out of scope by design: single-operation, already-rounded *config* math in the
// dependency-free pure cores (e.g. lib/data/gdc-tiers.ts), which must stay
// import-free to compile standalone for their proof tests and whose one-shot
// multiply/round carries no accumulation drift.
export { D, sum, money, pctOf, ratio, atLeastZero, Decimal } from '@/lib/fna/engine/money'
