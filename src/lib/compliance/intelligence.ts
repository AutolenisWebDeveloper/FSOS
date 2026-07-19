// src/lib/compliance/intelligence.ts
// Core library for the Compliance Intelligence module (owner-authorized; see
// CLAUDE.md §3 authorized-exception + docs/compliance/). Retrieval-grounded
// primitives shared by the /api/compliance/{analyze,note,checklist,rightbridge}
// routes: authority-tier hierarchy, FTS retrieval over compliance_chunks, the
// no-invention citation VERIFY GATE, and a JSON-constrained gateway helper.
//
// GUARDRAILS this module encodes (blueprint §5):
//   • No invention — every asserted rule/citation must trace to a retrieved chunk.
//   • Insufficiency is a valid answer — when the library lacks the governing doc,
//     say so ("upload the governing document") rather than guess.
//   • Authority tier is always stated — FINRA law vs firm policy vs carrier vs
//     unsupported — that reclassification is the FSA's core leverage.

import { getDb } from '@/lib/supabase/client'
import { runGateway } from '@/lib/ai/gateway'

// ─── Authority hierarchy (blueprint §2.1) ─────────────────────────────────────

export const AUTHORITY_TYPES = [
  'FINRA_RULE',
  'SEC_RULE',
  'STATE_REQUIREMENT',
  'CARRIER_REQUIREMENT',
  'FORM_INSTRUCTION',
  'FFS_PROCEDURE',
  'SUITABILITY_STANDARD',
  'INTERNAL_PREFERENCE',
] as const
export type AuthorityType = (typeof AUTHORITY_TYPES)[number]

export const VALIDITY_VALUES = [
  'valid',
  'partially_valid',
  'duplicative',
  'inconsistent',
  'unsupported',
  'needs_clarification',
] as const
export type NigoValidity = (typeof VALIDITY_VALUES)[number]

// Rank index (0 = highest binding force). Used to pick the HIGHEST tier that
// actually supports an issue among its retrieved matches.
const AUTHORITY_RANK: Record<AuthorityType, number> = AUTHORITY_TYPES.reduce(
  (acc, t, i) => ({ ...acc, [t]: i }),
  {} as Record<AuthorityType, number>,
)

/** Human label + binding force for a tier (drives the UI chips + response copy). */
export const AUTHORITY_META: Record<AuthorityType, { label: string; force: string }> = {
  FINRA_RULE: { label: 'FINRA Rule', force: 'Law (regulatory)' },
  SEC_RULE: { label: 'SEC Rule', force: 'Law (regulatory)' },
  STATE_REQUIREMENT: { label: 'State Requirement', force: 'Law (state)' },
  CARRIER_REQUIREMENT: { label: 'Carrier Requirement', force: 'Contractual (carrier-specific)' },
  FORM_INSTRUCTION: { label: 'Form Instruction', force: 'Procedural' },
  FFS_PROCEDURE: { label: 'FFS Procedure', force: 'Firm policy (not FINRA)' },
  SUITABILITY_STANDARD: { label: 'Suitability Standard', force: 'Derived (Reg BI care obligation)' },
  INTERNAL_PREFERENCE: { label: 'Internal Preference', force: 'Reviewer opinion — not a rule' },
}

export function isAuthorityType(v: unknown): v is AuthorityType {
  return typeof v === 'string' && (AUTHORITY_TYPES as readonly string[]).includes(v)
}

export function isValidity(v: unknown): v is NigoValidity {
  return typeof v === 'string' && (VALIDITY_VALUES as readonly string[]).includes(v)
}

/** The HIGHEST-binding tier present among a set of retrieved chunks, or null. */
export function highestAuthority(chunks: { authority_type: AuthorityType }[]): AuthorityType | null {
  let best: AuthorityType | null = null
  for (const c of chunks) {
    if (best === null || AUTHORITY_RANK[c.authority_type] < AUTHORITY_RANK[best]) best = c.authority_type
  }
  return best
}

// ─── Retrieval (FTS over compliance_chunks — the working path) ────────────────

export interface RetrievedChunk {
  id: string
  chunk_key: string | null
  document_id: string
  authority_type: AuthorityType
  section_ref: string | null
  title: string | null
  chunk_text: string
  product_scope: string[]
  state_scope: string[]
  governs_patterns: string[]
  verbatim: boolean
  rank: number
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'was', 'were', 'has', 'have', 'had', 'not',
  'are', 'you', 'your', 'our', 'their', 'they', 'them', 'been', 'will', 'would', 'should', 'must',
  'per', 'into', 'onto', 'about', 'which', 'when', 'what', 'must', 'need', 'needs', 'please',
  'nigo', 'note', 'notes', 'client', 'case', 'file', 'form', 'forms', 'required', 'require',
])

/**
 * Build a high-recall websearch tsquery from arbitrary NIGO/issue text. Long
 * sentences ANDed by plainto_tsquery match nothing, so we extract salient terms
 * and OR them — surfacing candidate chunks ACROSS authority tiers (blueprint
 * STEP 2), which the analyzer then classifies.
 */
export function buildRetrievalQuery(text: string, extra: string[] = []): string {
  const terms = new Set<string>()
  for (const raw of `${text} ${extra.join(' ')}`.toLowerCase().split(/[^a-z0-9]+/)) {
    const w = raw.trim()
    if (w.length >= 4 && !STOPWORDS.has(w)) terms.add(w)
    if (terms.size >= 14) break
  }
  return Array.from(terms).join(' OR ')
}

/**
 * Retrieve the top-N governing chunks for `query` across ALL authority tiers.
 * Product/state scoping keeps 'ALL'-scoped chunks plus the specific scope. FTS is
 * the working retrieval path (no embeddings dependency); returns [] on any error
 * so callers degrade to "insufficient authority" rather than throwing.
 */
export async function retrieveChunks(
  query: string,
  opts: { product?: string | null; state?: string | null; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 8, 24)
  const tsq = buildRetrievalQuery(query, [opts.product ?? '', opts.state ?? ''])

  try {
    let builder = db
      .from('compliance_chunks')
      .select(
        'id, chunk_key, document_id, authority_type, section_ref, title, chunk_text, product_scope, state_scope, governs_patterns, verbatim',
      )
    if (tsq) builder = builder.textSearch('search_tsv', tsq, { type: 'websearch', config: 'english' })
    if (opts.product) builder = builder.overlaps('product_scope', [opts.product.toUpperCase(), 'ALL'])

    const { data, error } = await builder.limit(limit)
    if (error) return []
    const rows = (data ?? []) as Omit<RetrievedChunk, 'rank'>[]
    return rows.map((r, i) => ({ ...r, rank: 1 - i / Math.max(rows.length, 1) }))
  } catch {
    return []
  }
}

/** Compact, numbered context block for the model — with the tier on every chunk. */
export function renderChunks(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '(no governing passages retrieved from the knowledge library)'
  return chunks
    .map((c, i) => {
      const cite = c.section_ref || c.chunk_key || 'no-ref'
      const vflag = c.verbatim ? '' : ' [paraphrased-for-index — verify verbatim before external use]'
      return `[[${i + 1}]] authority=${c.authority_type} cite="${cite}"${vflag}\n${c.title ? c.title + '\n' : ''}${c.chunk_text}`
    })
    .join('\n\n')
}

// ─── The VERIFY GATE (no-invention enforcement, blueprint STEP 8) ─────────────

const INSUFFICIENT =
  'insufficient authority in the knowledge library to confirm this — upload the governing document'

/** The set of citation tokens that actually exist among the retrieved chunks. */
export function groundedCitationSet(chunks: RetrievedChunk[]): Set<string> {
  const set = new Set<string>()
  for (const c of chunks) {
    if (c.section_ref) set.add(normalizeCite(c.section_ref))
    if (c.chunk_key) set.add(normalizeCite(c.chunk_key))
  }
  return set
}

function normalizeCite(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/["'.]/g, '')
}

/**
 * Keep only citations that trace to a retrieved chunk. Returns the grounded
 * subset + whether anything was stripped (so the UI can show the verify-gate note).
 */
export function verifyCitations(
  citations: string[],
  chunks: RetrievedChunk[],
): { grounded: string[]; stripped: string[] } {
  const allowed = groundedCitationSet(chunks)
  const grounded: string[] = []
  const stripped: string[] = []
  for (const raw of citations) {
    const c = (raw || '').trim()
    if (!c) continue
    if (allowed.has(normalizeCite(c))) grounded.push(c)
    else stripped.push(c)
  }
  return { grounded: Array.from(new Set(grounded)), stripped: Array.from(new Set(stripped)) }
}

export { INSUFFICIENT }

// ─── Grounded JSON gateway helper ─────────────────────────────────────────────

/** Shared grounding rules injected into every analysis system prompt. */
export const GROUNDING_SYSTEM = [
  'You are a securities-compliance analysis aid for a licensed Farmers Financial Services (FFS) representative.',
  'You DRAFT and ANALYZE only. You never make an individualized product, investment, replacement, allocation, or transaction recommendation, and you never issue a "call to action" to buy/sell a security.',
  'Ground every requirement, rule number, and citation ONLY in the KNOWLEDGE LIBRARY passages provided in the user message. Do NOT use rules, section numbers, or requirements from your own memory.',
  'If a requirement is not present in the provided passages, treat it as UNSUPPORTED and say so plainly — never invent a rule, citation, interpretation, or fact.',
  'Always state which authority tier a requirement actually sits in (e.g. FINRA_RULE = law, FFS_PROCEDURE = firm policy, CARRIER_REQUIREMENT = carrier-specific, INTERNAL_PREFERENCE/none = reviewer opinion).',
  'Be honest: when a NIGO is valid, call it valid. Do not rationalize a valid supervisory request.',
  'Output ONLY the requested JSON object. No prose, no markdown fences.',
].join(' ')

function extractJson<T>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const arrStart = body.indexOf('[')
  const first = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart)
  if (first === -1) return null
  const open = body[first]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = first; i < body.length; i++) {
    const ch = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(first, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * Run a JSON-constrained completion through the model-agnostic gateway and parse
 * the result. One retry with a stricter reminder on parse failure. Returns null
 * if the model never produces valid JSON (callers surface a clean error).
 */
export async function runJson<T>(system: string, user: string, maxTokens = 3000): Promise<T | null> {
  const first = await runGateway({
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens,
  })
  const parsed = extractJson<T>(first.text)
  if (parsed !== null) return parsed

  const retry = await runGateway({
    system,
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: first.text },
      { role: 'user', content: 'That was not valid JSON. Reply with ONLY the JSON object, nothing else.' },
    ],
    maxTokens,
  })
  return extractJson<T>(retry.text)
}

export { extractJson }
