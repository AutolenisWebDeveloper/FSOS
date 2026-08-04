// src/lib/import/mapping/plan.ts
// ─────────────────────────────────────────────────────────────────────────
// The plan builder — the heart of the Contact Import mapping model. Given a
// parsed header-keyed table plus any saved template / per-header memory / custom
// fields, it produces a per-header MappingPlan: what each source header maps to,
// how confident the recognizer is, whether the decision was remembered, and which
// headers remain unrecognized (spec §4/§5).
//
// Precedence per header (first hit wins):
//   1. saved template (import_templates.header_map for this file's signature)
//   2. per-header global memory (every prior manual decision, spec §5)
//   3. composite/derived split default (spec §3)
//   4. auto-recognition dictionary → fuzzy (spec §2)
//   5. otherwise unrecognized → operator maps it once (spec §4)
//
// Pure; no I/O, no clock, no randomness — deterministic for tests + replay.
// ─────────────────────────────────────────────────────────────────────────

import { squashHeader, getTargetField, type FieldEntity, type FieldType } from './fields'
import { recognizeHeader, type MatchConfidence } from './dictionary'
import { compositeRuleFor, type SplitRule } from './composite'
import { detectTemplate, signatureHash, type KnownTemplate } from './templates'

export type HeaderDecision =
  | { kind: 'field'; fieldId: string }
  | { kind: 'split'; rule: SplitRule }
  | { kind: 'custom'; customKey: string; entity: FieldEntity; fieldType: FieldType; label?: string }
  | { kind: 'as_is' } // keep the raw column verbatim (stored as a member custom value at commit)
  | { kind: 'ignore' }
  | { kind: 'unrecognized' }

export type DecisionMethod = 'template' | 'memory' | 'dictionary' | 'fuzzy' | 'none'

export interface PlanEntry {
  source: string
  squashed: string
  sampleValues: string[]
  decision: HeaderDecision
  entity: FieldEntity | null
  confidence: MatchConfidence
  method: DecisionMethod
  /** True when the decision came from a saved template or per-header memory. */
  remembered: boolean
  /** True when an earlier header already claimed this target field. */
  conflict: boolean
}

export interface MappingPlan {
  template: KnownTemplate | null
  signature: string
  entries: PlanEntry[]
  /** Source headers whose decision is still `unrecognized` (need an operator choice). */
  unrecognized: string[]
}

export interface BuildPlanInput {
  headers: string[]
  rows: Array<Record<string, string>>
  /** Saved template header_map keyed by squashed source header (from import_templates). */
  savedHeaderMap?: Record<string, HeaderDecision>
  /** Global per-header memory keyed by squashed source header (from import_header_memory). */
  headerMemory?: Record<string, HeaderDecision>
}

const SAMPLE_LIMIT = 3
const SAMPLE_ROWS = 50

function sampleFor(header: string, rows: Array<Record<string, string>>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(0, SAMPLE_ROWS)) {
    const v = (r[header] ?? '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v.length > 60 ? v.slice(0, 57) + '…' : v)
    if (out.length >= SAMPLE_LIMIT) break
  }
  return out
}

function entityOf(decision: HeaderDecision): FieldEntity | null {
  switch (decision.kind) {
    case 'field':
      return getTargetField(decision.fieldId)?.entity ?? null
    case 'custom':
      return decision.entity
    case 'as_is':
      return 'member'
    default:
      return null // split spans two entities; ignore/unrecognized have none
  }
}

/** Target field ids a decision claims (for conflict detection). */
function claimedFields(decision: HeaderDecision): string[] {
  if (decision.kind === 'field') return [decision.fieldId]
  if (decision.kind === 'split') return decision.rule.targets
  return []
}

/**
 * Build the mapping plan for a parsed file against saved memory. Deterministic and
 * side-effect free.
 */
export function buildMappingPlan(input: BuildPlanInput): MappingPlan {
  const { headers, rows, savedHeaderMap = {}, headerMemory = {} } = input
  const template = detectTemplate(headers)
  const signature = signatureHash(headers)
  const claimed = new Set<string>()
  const entries: PlanEntry[] = []

  for (const source of headers) {
    const squashed = squashHeader(source)
    let decision: HeaderDecision = { kind: 'unrecognized' }
    let confidence: MatchConfidence = 'none'
    let method: DecisionMethod = 'none'
    let remembered = false

    const saved = squashed ? savedHeaderMap[squashed] : undefined
    const remembered1 = squashed ? headerMemory[squashed] : undefined

    if (saved) {
      decision = saved
      confidence = 'high'
      method = 'template'
      remembered = true
    } else if (remembered1) {
      decision = remembered1
      confidence = 'high'
      method = 'memory'
      remembered = true
    } else {
      const composite = compositeRuleFor(source)
      if (composite) {
        decision = { kind: 'split', rule: composite }
        confidence = 'high'
        method = 'dictionary'
      } else {
        const match = recognizeHeader(source)
        if (match) {
          decision = { kind: 'field', fieldId: match.fieldId }
          confidence = match.confidence
          method = match.method
        }
      }
    }

    const fields = claimedFields(decision)
    const conflict = fields.some((f) => claimed.has(f))
    for (const f of fields) claimed.add(f)

    entries.push({
      source,
      squashed,
      sampleValues: sampleFor(source, rows),
      decision,
      entity: entityOf(decision),
      confidence,
      method,
      remembered,
      conflict,
    })
  }

  const unrecognized = entries.filter((e) => e.decision.kind === 'unrecognized').map((e) => e.source)
  return { template, signature, entries, unrecognized }
}
