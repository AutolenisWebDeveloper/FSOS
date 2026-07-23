// src/lib/fna/engine/types.ts
// The traceable result envelope every FNA calculation returns (ADR-015 §5), plus
// the value-labeling vocabulary (build instruction §1) and helpers to build a
// result. Pure types + a pure builder — no I/O, no clock (computed_at is passed
// in by the caller so the engine stays deterministic).

import { CURRENCY, type Currency } from './money'

/**
 * How a value shown to a user is sourced (build instruction §1). Engine OUTPUTS
 * are always 'calculated'; INPUTS carry one of these so the UI can label them.
 */
export type ValueLabel =
  | 'verified'
  | 'client_supplied'
  | 'imported'
  | 'calculated'
  | 'estimated'
  | 'assumption_based'
  | 'incomplete'
  | 'unavailable'
  | 'needs_confirmation'

/** A single input value with its provenance label and optional source pointer. */
export interface Labeled<T = number> {
  value: T
  label: ValueLabel
  /** Free-text or record pointer describing where the value came from. */
  source?: string
}

/** Confidence in a calculation given the completeness/quality of its inputs. */
export type Confidence = 'high' | 'medium' | 'low'

/** Severity of a calculation warning (build instruction §0.B). Never blocks. */
export type WarningSeverity = 'warning' | 'info'

export interface CalcWarning {
  code: string
  message: string
  severity: WarningSeverity
}

/**
 * A reference to one assumption value actually used by a calculation, captured so
 * the result can be recomputed against the same versioned assumption-set.
 */
export interface AssumptionRef {
  key: string
  value: number
  unit: string
  /** Version of the assumption-set this value came from. */
  assumption_set_version: string
  is_assumption: true
}

/**
 * The envelope EVERY formula returns. Every displayed number is reconstructable
 * from this: formula + version + inputs + input sources + assumptions +
 * intermediates + rounding rule.
 */
export interface CalcResult<TOutput> {
  formula_id: string
  formula_version: string
  /** The numeric inputs the formula consumed (post-normalization). */
  inputs: Record<string, number>
  /** Provenance label per input key (build instruction §1). */
  input_sources: Record<string, ValueLabel>
  /** Assumption values actually used (empty when the formula uses none). */
  assumptions_used: AssumptionRef[]
  /** Named intermediate values as stable decimal strings, for full traceability. */
  intermediates: Record<string, string>
  /** The calculated output. Money fields are rounded to cents. */
  output: TOutput
  /** The rounding rule applied to money outputs (from money.ts). */
  rounding: string
  currency: Currency
  /** Non-blocking warnings (missing optional data, fallbacks, edge conditions). */
  warnings: CalcWarning[]
  /** Input keys that were expected but not supplied — degrades, never blocks. */
  missing_inputs: string[]
  confidence: Confidence
  /** Caller-supplied ISO timestamp — the engine holds no clock (determinism). */
  computed_at: string
}

/** Inputs shared by every formula call: provenance, assumptions, and the clock. */
export interface CalcContext {
  /** ISO 8601 timestamp supplied by the caller (engine is clock-free). */
  computedAt: string
  /** Provenance label per input key; unspecified keys default to 'client_supplied'. */
  sources?: Record<string, ValueLabel>
}

export interface BuildResultArgs<TOutput> {
  formulaId: string
  formulaVersion: string
  inputs: Record<string, number>
  output: TOutput
  ctx: CalcContext
  rounding: string
  assumptionsUsed?: AssumptionRef[]
  intermediates?: Record<string, string>
  warnings?: CalcWarning[]
  missingInputs?: string[]
  /** Explicit confidence; when omitted it is derived from missing_inputs. */
  confidence?: Confidence
}

/**
 * Assemble a CalcResult, filling input_sources from ctx (default 'client_supplied')
 * and deriving confidence from the count of missing inputs when not given:
 * none → high, one → medium, two or more → low. Deterministic and pure.
 */
export function buildResult<TOutput>(args: BuildResultArgs<TOutput>): CalcResult<TOutput> {
  const missing = args.missingInputs ?? []
  const input_sources: Record<string, ValueLabel> = {}
  for (const key of Object.keys(args.inputs)) {
    input_sources[key] = args.ctx.sources?.[key] ?? 'client_supplied'
  }
  const confidence: Confidence =
    args.confidence ?? (missing.length === 0 ? 'high' : missing.length === 1 ? 'medium' : 'low')

  return {
    formula_id: args.formulaId,
    formula_version: args.formulaVersion,
    inputs: args.inputs,
    input_sources,
    assumptions_used: args.assumptionsUsed ?? [],
    intermediates: args.intermediates ?? {},
    output: args.output,
    rounding: args.rounding,
    currency: CURRENCY,
    warnings: args.warnings ?? [],
    missing_inputs: missing,
    confidence,
    computed_at: args.ctx.computedAt,
  }
}
