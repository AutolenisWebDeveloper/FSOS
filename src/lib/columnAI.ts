// src/lib/columnAI.ts
// ─────────────────────────────────────────────────────────────────────────
// AI-assisted column recognition for the contact-upload workflow.
//
// Given the spreadsheet's headers plus a handful of sample rows, Claude reads
// the document the way a person would — inferring which column holds the name,
// email, phone, etc. even when headers are oddly labelled, non-English, or
// missing — and returns a strict header→field JSON mapping. Fully guarded:
// when ANTHROPIC_API_KEY is unset (or the call fails / returns junk) it returns
// null and the caller falls back to header-alias + content inference.
// ─────────────────────────────────────────────────────────────────────────

import { z } from 'zod'
import { runGateway } from './ai/gateway'
import { CANONICAL_FIELDS, type CanonicalField } from './ghlContacts'

// A fast, cheap model is plenty for a bounded classification task.
const COLUMN_MODEL = 'claude-sonnet-5'
const MAX_SAMPLE_ROWS = 8

export function columnAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

const FIELD_GUIDE: Record<CanonicalField, string> = {
  first_name: 'given / first name only',
  last_name: 'family / last / surname only',
  full_name: 'a full name in one column (first and last together)',
  email: 'email address',
  phone: 'phone / mobile / cell number',
  tags: 'labels or tags to attach to the contact',
  source: 'lead source / where the contact came from',
  city: 'city / town',
  state: 'state / province / region',
  postal_code: 'ZIP / postal code',
  address: 'street address',
  company: 'company / business / employer name',
  product_interest: 'product or coverage the contact is interested in',
  life_stage: 'life stage / segment (e.g. pre-retiree, family)',
  agency_owner: 'the referring agency owner / agent responsible for the contact',
  notes: 'free-text notes or comments',
}

const ResponseSchema = z.object({
  columns: z.array(
    z.object({
      header: z.string(),
      field: z.string(), // validated against CANONICAL_FIELDS below; "ignore"/unknown → dropped
    }),
  ),
})

export interface AiColumnResult {
  map: Record<string, CanonicalField>
  raw: Array<{ header: string; field: string }>
}

/**
 * Ask Claude to map each header to a canonical field. Returns null when AI is
 * disabled or the call fails — never throws into the upload path.
 */
export async function aiDetectColumns(
  headers: string[],
  rows: Array<Record<string, string>>,
): Promise<AiColumnResult | null> {
  if (!columnAiEnabled() || headers.length === 0) return null

  const sample = rows.slice(0, MAX_SAMPLE_ROWS).map((r) => headers.map((h) => (r[h] ?? '').slice(0, 60)))
  const fieldList = CANONICAL_FIELDS.map((f) => `  - ${f}: ${FIELD_GUIDE[f]}`).join('\n')

  const prompt = [
    'You are mapping spreadsheet columns to a CRM contact schema.',
    'Given the column headers and a few sample rows, decide which schema field each column holds.',
    'Judge by BOTH the header text and the actual values in the sample rows.',
    '',
    'Allowed fields (choose the single best fit, or "ignore" if none apply):',
    fieldList,
    '',
    `Headers (in order): ${JSON.stringify(headers)}`,
    'Sample rows (arrays aligned to the headers):',
    JSON.stringify(sample),
    '',
    'Rules:',
    '- Map each header to exactly one field, or "ignore".',
    '- Do not assign the same field to two different columns.',
    '- Prefer full_name only when first and last are combined in one column.',
    '',
    'Respond with ONLY a JSON object of the form:',
    '{"columns":[{"header":"<exact header text>","field":"<field-or-ignore>"}]}',
  ].join('\n')

  try {
    const { text: rawText } = await runGateway({
      model: COLUMN_MODEL,
      maxTokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = rawText.trim()

    // Extract the JSON object even if the model wraps it in prose / fences.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    const parsed = ResponseSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    if (!parsed.success) return null

    const validFields = new Set<string>(CANONICAL_FIELDS)
    const headerSet = new Set(headers)
    const map: Record<string, CanonicalField> = {}
    const usedFields = new Set<CanonicalField>()
    for (const { header, field } of parsed.data.columns) {
      if (!headerSet.has(header) || !validFields.has(field)) continue
      const f = field as CanonicalField
      if (map[header] || usedFields.has(f)) continue
      map[header] = f
      usedFields.add(f)
    }
    return { map, raw: parsed.data.columns }
  } catch (err) {
    console.error('[columnAI] mapping failed:', err instanceof Error ? err.message : err)
    return null
  }
}
