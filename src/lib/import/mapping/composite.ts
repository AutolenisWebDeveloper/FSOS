// src/lib/import/mapping/composite.ts
// ─────────────────────────────────────────────────────────────────────────
// Composite & derived columns (design spec v2.1 §3). Some district exports pack
// two values into one header; the mapper detects these and splits on a delimiter,
// mapping each part to its own target field.
//
//   "AOR with Series Code"  →  aor_code + series_code
//
// The split rule is data — a known default here, and remembered per-header once
// the operator confirms one (spec §5). The exact delimiter is a Farmers-data
// assumption (§4.3): AOR codes themselves contain hyphens, so the default splits
// on whitespace / slash / pipe (NOT hyphen) and treats the first token as the AOR
// code and the remainder as the series code. Operators can override + remember.
// Pure; no I/O.
// ─────────────────────────────────────────────────────────────────────────

import { squashHeader } from './fields'

export interface SplitRule {
  /** Target field ids, in the order the split parts map to them. */
  targets: string[]
  /** Regex source for the delimiter (stored as a string so it round-trips through JSON). */
  delimiter: string
  /** True when the delimiter/targets are a config default, not operator-confirmed (§4.3). */
  isAssumption: boolean
}

// Default delimiter: whitespace run, slash, or pipe — never hyphen (AOR codes use
// hyphens internally, e.g. "19-41-319").
export const DEFAULT_COMPOSITE_DELIMITER = '\\s*[/|]\\s*|\\s{2,}|\\s+'

// Known composite headers → default split rule (squashed keys).
const COMPOSITE_DEFAULTS: Record<string, SplitRule> = {
  aorwithseriescode: {
    targets: ['agency.aor_code', 'policy.series_code'],
    delimiter: DEFAULT_COMPOSITE_DELIMITER,
    isAssumption: true,
  },
}

/** Look up the default composite split rule for a header, if any. */
export function compositeRuleFor(header: string): SplitRule | null {
  return COMPOSITE_DEFAULTS[squashHeader(header)] ?? null
}

export function isCompositeHeader(header: string): boolean {
  return squashHeader(header) in COMPOSITE_DEFAULTS
}

/**
 * Split a raw cell value per a rule into { fieldId → value }. The value is split
 * into at most `targets.length` parts; the final target absorbs any overflow
 * (so a series code containing the delimiter is not truncated). Empty parts are
 * omitted. Returns {} for a blank value.
 */
export function splitComposite(value: string, rule: SplitRule): Record<string, string> {
  const v = (value || '').trim()
  if (!v) return {}
  const re = new RegExp(rule.delimiter)
  const raw = v.split(re).map((p) => p.trim()).filter(Boolean)
  const out: Record<string, string> = {}
  const n = rule.targets.length
  raw.forEach((part, i) => {
    if (i < n - 1) {
      out[rule.targets[i]] = part
    } else {
      // Last target absorbs the remainder (rejoined with a single space).
      const tail = raw.slice(n - 1).join(' ')
      out[rule.targets[n - 1]] = tail
    }
  })
  return out
}
