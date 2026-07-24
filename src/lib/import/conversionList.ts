// src/lib/import/conversionList.ts
// Parser for a "Life Conversion Opportunities" list — FNWL TERM policies inside
// their conversion window (a Salesforce export, cleaned). Each row is one policy
// eligible to convert to permanent coverage: the conversion-expiry date, policy
// number, owner, insured, product, and convertible amount.
//
// The strongest match key is the POLICY NUMBER, which ties each row back to a
// household_policies row already on the aggregate-root spine (from the District
// Book). Importing sets the conversion_deadline the Term Conversion agent needs.
//
// GUARDRAILS: term products only — nothing here is a variable/security product
// (is_security stays false) and no conversion is recommended (green-zone
// "identify"). The insured birthday carries month/day only (no year in the
// file); we store it verbatim and never fabricate a year.

import { xlsxToMatrix } from '@/lib/import/xlsxRaw'
import { parseCsv } from '@/lib/csv'
import { extensionOf } from '@/lib/spreadsheet'

export interface ConversionRecord {
  policy_number: string
  owner_name: string
  insured_name: string | null
  insured_dob: string | null // month/day only, verbatim (no year in source)
  product_type: string | null
  convertible_amount: number | null
  conversion_deadline: string | null // ISO date
  inception_date: string | null
  expiration_date: string | null
  name_key: string
  conversion_key: string // = policy_number (idempotent provenance)
}

export interface ConversionParseResult {
  records: ConversionRecord[]
  skipped: number
  total_convertible: number
}

// Header aliases (squashed to letters) → canonical field.
const ALIASES: Record<string, string> = {
  conversionexpirydate: 'deadline', conversiondeadline: 'deadline', expirydate: 'deadline',
  policynumber: 'policy', policyno: 'policy', policy: 'policy',
  policyowner: 'owner', owner: 'owner', accountname: 'owner',
  primarynamedinsured: 'insured', insured: 'insured', namedinsured: 'insured',
  insuredbirthday: 'dob', insureddob: 'dob', dob: 'dob', birthday: 'dob',
  inceptiondate: 'inception', issuedate: 'inception', inception: 'inception',
  producttype: 'product', product: 'product',
  convertibleamount: 'amount', faceamount: 'amount', amount: 'amount',
  policyexpirationdate: 'expiration', expirationdate: 'expiration', expiration: 'expiration',
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function toIsoDate(s: string): string | null {
  const t = (s || '').trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function toNum(s: string): number | null {
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/\s+/g, ' ').trim()

// "LAST, FIRST MIDDLE" → "First Middle Last"; already-natural names pass through.
function normalizeName(raw: string): string {
  const s = (raw || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.includes(',')) {
    const [last, rest] = s.split(',', 2)
    return titleCase(`${rest.trim()} ${last.trim()}`.trim())
  }
  return titleCase(s)
}

const nameKey = (s: string) => (s || '').toLowerCase().replace(/[^a-z]/g, '')

// Insured birthday in the source is MM/DD (no year). Keep it verbatim if it looks
// like a partial date; never coerce a fake year onto it.
function normalizeDob(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) return m[3] ? `${m[1]}/${m[2]}/${m[3]}` : `${m[1]}/${m[2]}`
  return s
}

/** Turn any supported file into a raw string matrix, preserving column order. */
async function fileToMatrix(buffer: Buffer, filename: string): Promise<string[][]> {
  const ext = extensionOf(filename)
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = buffer.toString('utf8')
    if (ext === 'csv') return parseCsv(text)
    return text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.length).map((l) => l.split('\t'))
  }
  if (ext === 'pdf') {
    const { extractPdfPages, pdfPagesToTable } = await import('@/lib/import/pdf')
    const t = pdfPagesToTable(await extractPdfPages(buffer))
    return [t.headers, ...t.rows.map((r) => t.headers.map((h) => r[h] ?? ''))]
  }
  if (ext === 'json') {
    const data = JSON.parse(buffer.toString('utf8'))
    const arr: Record<string, unknown>[] = Array.isArray(data) ? data : (data.records ?? data.data ?? [])
    const headers = Array.from(new Set(arr.flatMap((o) => Object.keys(o))))
    return [headers, ...arr.map((o) => headers.map((h) => (o[h] == null ? '' : String(o[h]))))]
  }
  // xlsx (default): the namespace-tolerant raw reader (handles standard exports
  // and prefixed-namespace Salesforce exports alike).
  return xlsxToMatrix(buffer)
}

/**
 * Parse a Life Conversion list. Finds the header row (the export prefixes a
 * title/notes block), maps columns, and drops rows without a policy number (the
 * preamble and the "Total Convertible Amount" footer). Deterministic.
 */
export async function parseConversionFile(buffer: Buffer, filename: string): Promise<ConversionParseResult> {
  const matrix = await fileToMatrix(buffer, filename)

  // Locate the header row: the first row that maps at least a policy + one date.
  let headerRow = -1
  let colMap: Record<string, number> = {}
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const map: Record<string, number> = {}
    matrix[r].forEach((h, i) => {
      const canon = ALIASES[squash(h)]
      if (canon && !(canon in map)) map[canon] = i
    })
    if ('policy' in map && ('deadline' in map || 'owner' in map)) { headerRow = r; colMap = map; break }
  }
  if (headerRow === -1) throw new Error('Could not find the conversion header row (need a "Policy Number" column).')

  const at = (row: string[], field: string): string => (colMap[field] != null ? (row[colMap[field]] || '').trim() : '')

  const records: ConversionRecord[] = []
  let skipped = 0
  let total = 0
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row || row.every((c) => !c || !String(c).trim())) continue
    const policy = at(row, 'policy').replace(/\s+/g, '')
    if (!policy || !/\d/.test(policy)) { skipped++; continue } // preamble / total footer
    const owner = normalizeName(at(row, 'owner'))
    const insured = normalizeName(at(row, 'insured'))
    const amount = toNum(at(row, 'amount'))
    if (amount) total += amount
    records.push({
      policy_number: policy,
      owner_name: owner,
      insured_name: insured || null,
      insured_dob: normalizeDob(at(row, 'dob')),
      product_type: at(row, 'product') || null,
      convertible_amount: amount,
      conversion_deadline: toIsoDate(at(row, 'deadline')),
      inception_date: toIsoDate(at(row, 'inception')),
      expiration_date: toIsoDate(at(row, 'expiration')),
      name_key: nameKey(owner),
      conversion_key: policy,
    })
  }
  return { records, skipped, total_convertible: total }
}

export interface ConversionSummary {
  total: number
  with_owner: number
  with_insured: number
  with_deadline: number
  total_convertible: number
  expiring_12mo: number
  by_product: Record<string, number>
}

export function summarizeConversions(records: ConversionRecord[], now: string): ConversionSummary {
  const by_product: Record<string, number> = {}
  let with_owner = 0
  let with_insured = 0
  let with_deadline = 0
  let total_convertible = 0
  let expiring_12mo = 0
  const horizon = new Date(now)
  horizon.setFullYear(horizon.getFullYear() + 1)
  for (const r of records) {
    if (r.owner_name) with_owner++
    if (r.insured_name) with_insured++
    if (r.conversion_deadline) with_deadline++
    if (r.convertible_amount) total_convertible += r.convertible_amount
    if (r.conversion_deadline && new Date(r.conversion_deadline) <= horizon) expiring_12mo++
    const p = r.product_type || 'Unknown'
    by_product[p] = (by_product[p] || 0) + 1
  }
  return { total: records.length, with_owner, with_insured, with_deadline, total_convertible, expiring_12mo, by_product }
}
