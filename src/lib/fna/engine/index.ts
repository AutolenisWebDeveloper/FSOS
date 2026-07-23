// src/lib/fna/engine/index.ts
// Barrel for the FNA deterministic calculation engine (ADR-015). The service
// layer (slice 2+) imports from here; the engine is pure and holds no I/O, so a
// server component or route loads assumptions, supplies a computedAt clock, and
// calls a formula. The AI never produces an authoritative number — model output
// is never a figure source (build instruction §0, §1).

export * from './money'
export * from './types'
export * from './assumptions'
export * from './registry'

export * from './formulas/future-value'
export * from './formulas/present-value'
export * from './formulas/cash-flow'
export * from './formulas/net-worth'
export * from './formulas/emergency-fund'
export * from './formulas/life-insurance'
export * from './formulas/coverage-gap'
export * from './formulas/disability'
export * from './formulas/retirement'
export * from './formulas/education'
export * from './formulas/survivor-income'
export * from './formulas/debt-paydown'
