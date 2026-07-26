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

import ExcelJS from 'exceljs'
import { parseCsv } from '@/lib/csv'
import { extensionOf } from '@/lib/spreadsheet'
import { ownerKey, isSecurityProduct } from '@/lib/import/inforceBook'

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
  preferred_email: string | null // owner contact point (District export column)
  preferred_phone: string | null // owner contact point (District export column)
  agent_of_record: string | null // servicing Farmers agency / agent of record
  aor_code: string | null // agent-of-record code (provenance only)
  name_key: string
  conversion_key: string // = policy_number (idempotent provenance)
}

export interface ConversionParseResult {
  records: ConversionRecord[]
  skipped: number
  total_convertible: number
}

// Header aliases (squashed to letters) → canonical field. Covers the cleaned
// Salesforce export variants AND the raw "District Life Conversion" report
// (headers like "Conversion Expiring Date", "Policy Holder Name", "Coverage
// Amount", "Preferred Email/Phone", "Agent of Record").
const ALIASES: Record<string, string> = {
  conversionexpirydate: 'deadline', conversionexpiringdate: 'deadline', conversiondeadline: 'deadline',
  expirydate: 'deadline', expiringdate: 'deadline',
  policynumber: 'policy', policyno: 'policy', policy: 'policy',
  policyowner: 'owner', policyholdername: 'owner', policyholder: 'owner', owner: 'owner', accountname: 'owner',
  primarynamedinsured: 'insured', primaryinsuredname: 'insured', insured: 'insured', namedinsured: 'insured',
  insuredbirthday: 'dob', insureddob: 'dob', dob: 'dob', birthday: 'dob',
  inceptiondate: 'inception', issuedate: 'inception', inception: 'inception',
  producttype: 'product', product: 'product',
  convertibleamount: 'amount', coverageamount: 'amount', faceamount: 'amount', amount: 'amount',
  policyexpirationdate: 'expiration', expirationdate: 'expiration', expiration: 'expiration',
  preferredemail: 'email', emailaddress: 'email', email: 'email',
  preferredphonenumber: 'phone', preferredphone: 'phone', phonenumber: 'phone', mobile: 'phone', phone: 'phone',
  agentofrecord: 'agent', writingagent: 'agent', servicingagent: 'agent',
  aorcode: 'aor',
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// ExcelJS cell display text: strings/numbers pass through; rich text is joined.
function asText(t: unknown): string {
  if (t == null) return ''
  if (typeof t === 'string') return t
  if (typeof t === 'number' || typeof t === 'boolean') return String(t)
  if (typeof t === 'object') {
    const rt = (t as { richText?: Array<{ text?: string }> }).richText
    if (Array.isArray(rt)) return rt.map((r) => r.text || '').join('')
  }
  return String(t)
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const o = v as { text?: unknown; richText?: Array<{ text?: string }>; result?: unknown; hyperlink?: string }
    // Hyperlink/formula/rich-text cell: prefer the human-readable DISPLAY text
    // over the link target. The Policy Number column is a hyperlink whose text
    // is the numeric policy number and whose href is an Okta URL — returning the
    // href here would break the policy match key for the whole import.
    if (Array.isArray(o.richText)) return asText({ richText: o.richText })
    if (o.text != null && !(typeof o.text === 'string' && o.text === '')) return asText(o.text)
    if (typeof o.result !== 'undefined') return asText(o.result)
    if (typeof o.hyperlink === 'string') return o.hyperlink
  }
  return String(v).trim()
}

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
  // xlsx (default): ExcelJS first; fall back to the namespace-tolerant reader for
  // workbooks it can't parse (e.g. prefixed-namespace Salesforce exports).
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0]
    if (!ws || ws.rowCount === 0) throw new Error('empty')
    const matrix: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellStr(cell.value) })
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
      matrix.push(cells)
    })
    if (matrix.length > 1) return matrix
    throw new Error('no rows')
  } catch {
    const { xlsxToMatrix } = await import('@/lib/import/xlsxRaw')
    return xlsxToMatrix(buffer)
  }
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
    // A policy column plus any one supporting column marks the header. The list
    // always pairs the policy number with an owner and/or a conversion date.
    if ('policy' in map && ('deadline' in map || 'owner' in map || 'insured' in map)) { headerRow = r; colMap = map; break }
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
      preferred_email: at(row, 'email') || null,
      preferred_phone: at(row, 'phone') || null,
      agent_of_record: at(row, 'agent') || null,
      aor_code: at(row, 'aor') || null,
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

// ── Create plan (unmatched rows → new book records) ──────────────────────────
// When a conversion policy has no matching book policy, we ORIGINATE it on the
// aggregate-root spine rather than dropping it: one household per owner (keyed by
// the shared book_owner_key so a later In-Force Book import converges, not
// duplicates), the policy itself (source_system='fnwl' so the policy-number
// unique index dedupes on re-run), the owner contact (term-conversion), and the
// named insured as a household member. The conversion export carries no ZIP, so
// the owner key degrades to `name|` — same-named owners with no other signal
// share a household, and a later full-book import (with ZIP) may key the same
// owner differently; policies never duplicate (unique on fnwl policy_number).

// A household to create, plus the owner contact + insured member that hang off it.
export interface ConversionHouseholdPlan {
  book_owner_key: string
  primary_name: string
  owner_email: string | null
  owner_phone: string | null
  agent_of_record: string | null
  aor_code: string | null
  insured_names: string[] // named insureds distinct from the owner
}
// A policy to create, linked to its household by book_owner_key (resolved to an
// id after the households are inserted).
export interface ConversionPolicyPlan {
  book_owner_key: string
  policy_number: string
  product_name: string | null
  face_amount: number | null
  conversion_deadline: string | null
  effective_date: string | null
  expiration_date: string | null
  is_security: boolean
  source_data: Record<string, unknown>
}
export interface ConversionCreatePlan {
  households: ConversionHouseholdPlan[]
  policies: ConversionPolicyPlan[]
}

/** book_owner_key for a conversion owner (no ZIP in the export). */
export function conversionOwnerKey(ownerName: string): string {
  return ownerKey(ownerName, '')
}

function conversionSourceData(r: ConversionRecord): Record<string, unknown> {
  return {
    source: 'conversion_list',
    convertible_amount: r.convertible_amount,
    product_type: r.product_type,
    insured: r.insured_name,
    insured_dob: r.insured_dob,
    inception_date: r.inception_date,
    expiration_date: r.expiration_date,
    conversion_deadline: r.conversion_deadline,
    preferred_email: r.preferred_email,
    preferred_phone: r.preferred_phone,
    agent_of_record: r.agent_of_record,
    aor_code: r.aor_code,
  }
}

/**
 * Build the create plan for the rows with no matching book policy. Pure and
 * deterministic: groups rows into one household per owner key, one policy per
 * row. `existingHouseholdKeys` are book_owner_keys already present (so we never
 * re-create a household), letting a re-run — where the policies now match — add
 * nothing. Rows missing an owner name are skipped (no home on the spine).
 */
export function planConversionCreates(
  unmatched: ConversionRecord[],
  existingHouseholdKeys: Set<string>,
): ConversionCreatePlan {
  const households = new Map<string, ConversionHouseholdPlan>()
  const policies: ConversionPolicyPlan[] = []
  const seenPolicy = new Set<string>()
  for (const r of unmatched) {
    if (!r.owner_name) continue // cannot originate a household without an owner
    const key = conversionOwnerKey(r.owner_name)
    let h = households.get(key)
    if (!h && !existingHouseholdKeys.has(key)) {
      h = {
        book_owner_key: key,
        primary_name: r.owner_name,
        owner_email: r.preferred_email,
        owner_phone: r.preferred_phone,
        agent_of_record: r.agent_of_record,
        aor_code: r.aor_code,
        insured_names: [],
      }
      households.set(key, h)
    } else if (h) {
      // Fill contact points from a later row only when the first was blank.
      if (!h.owner_email && r.preferred_email) h.owner_email = r.preferred_email
      if (!h.owner_phone && r.preferred_phone) h.owner_phone = r.preferred_phone
    }
    if (h && r.insured_name && r.insured_name.toLowerCase() !== r.owner_name.toLowerCase() && !h.insured_names.some((n) => n.toLowerCase() === r.insured_name!.toLowerCase())) {
      h.insured_names.push(r.insured_name)
    }
    if (seenPolicy.has(r.policy_number)) continue
    seenPolicy.add(r.policy_number)
    policies.push({
      book_owner_key: key,
      policy_number: r.policy_number,
      product_name: r.product_type,
      face_amount: r.convertible_amount,
      conversion_deadline: r.conversion_deadline,
      effective_date: r.inception_date,
      expiration_date: r.expiration_date,
      is_security: isSecurityProduct(r.product_type || ''),
      source_data: { conversion: conversionSourceData(r) },
    })
  }
  return { households: Array.from(households.values()), policies }
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
