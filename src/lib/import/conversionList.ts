// src/lib/import/conversionList.ts
// Parser for a "Life Conversion Opportunities" list — FNWL TERM policies inside
// their conversion window (a Salesforce/District export, cleaned). Each row is one
// policy eligible to convert to permanent coverage: the conversion-expiry date,
// policy number, owner, insured, product, convertible amount, the Agent of Record
// (series code + agency name), and the recipient's channel consent indicators.
//
// The strongest match key is the POLICY NUMBER, which ties each row back to a
// household_policies row already on the aggregate-root spine (from the District
// Book). Importing sets the conversion_deadline the Term Conversion agent needs,
// hints the Agent-of-Record resolver (source_data → agency_partnership_id), and
// feeds the do-not-contact ledger so the §12 dispatcher never auto-contacts an
// opted-out recipient.
//
// The District export wraps some cells in HYPERLINKS (an Okta SSO launcher on the
// policy number, a Salesforce record link on the insured, a mailto: on the email).
// The DISPLAY text — not the URL — is the value we want; cellStr enforces that so
// every policy number is its real number, not the identical Okta launch URL.
//
// GUARDRAILS: term products only — nothing here is a variable/security product
// (is_security stays false) and no conversion is recommended (green-zone
// "identify"). The insured birthday carries month/day only (the source masks the
// birth year with a placeholder); we reduce it to MM/DD and never fabricate a year.

import ExcelJS from 'exceljs'
import { parseCsv } from '@/lib/csv'
import { extensionOf } from '@/lib/spreadsheet'

export interface ConversionRecord {
  policy_number: string
  owner_name: string
  insured_name: string | null
  insured_dob: string | null // month/day only, verbatim (source masks the year)
  product_type: string | null
  convertible_amount: number | null
  conversion_deadline: string | null // ISO date
  inception_date: string | null
  expiration_date: string | null
  // Agent of Record (drives agency_partnership_id resolution).
  series_code: string | null // Farmers serving-agent / series code, e.g. "19-41-594"
  agency_name: string | null // e.g. "Horacio Villarreal Agency"
  // Channel consent indicators (drive the do-not-contact ledger).
  pni_email: string | null
  pni_phone: string | null
  email_indicator: string | null // e.g. "✅Unsubscribed", "✅Held", "Not Verified"
  phone_indicator: string | null // e.g. "CELL, DNC", "PWC Revoked", "DNC Litigator"
  name_key: string
  conversion_key: string // = policy_number (idempotent provenance)
}

export interface ConversionParseResult {
  records: ConversionRecord[]
  skipped: number
  total_convertible: number
}

// Header aliases (squashed to letters/digits) → canonical field. The District
// export's column labels drift between runs (renames + typos: "Conversion Expiry"
// vs "Conversion Expiring", "Convertible" vs "Coverage" amount, "AOR with Series
// Code" vs "AOR code", "Preferred" vs "Preffered"), so several spellings map to
// each canonical field.
const ALIASES: Record<string, string> = {
  conversionexpirydate: 'deadline', conversionexpiringdate: 'deadline', conversiondeadline: 'deadline',
  expirydate: 'deadline', expiringdate: 'deadline', conversiondate: 'deadline',
  policynumber: 'policy', policyno: 'policy', policy: 'policy',
  policyowner: 'owner', owner: 'owner', accountname: 'owner', ownername: 'owner',
  primarynamedinsured: 'insured', primarynameinsurance: 'insured', primarynameinsured: 'insured',
  primaryinsured: 'insured', nameinsurance: 'insured', insured: 'insured', namedinsured: 'insured',
  insuredbirthday: 'dob', insureddob: 'dob', dob: 'dob', birthday: 'dob',
  inceptiondate: 'inception', issuedate: 'inception', inception: 'inception',
  producttype: 'product', product: 'product',
  convertibleamount: 'amount', coverageamount: 'amount', faceamount: 'amount', amount: 'amount',
  policyexpirationdate: 'expiration', expirationdate: 'expiration', expiration: 'expiration',
  // Agent of Record.
  aorwithseriescode: 'series', aorcode: 'series', aor: 'series', seriescode: 'series',
  servingagentnumber: 'series', servingagentno: 'series', agentnumber: 'series', agentcode: 'series',
  agentofrecord: 'agency', agencyname: 'agency', agency: 'agency', servingagentname: 'agency',
  // Consent indicators.
  pnipreferredemail: 'email', preferredemail: 'email', prefferedemail: 'email',
  preferedemail: 'email', email: 'email', emailaddress: 'email',
  pnipreferredphone: 'phone', preferredphone: 'phone', preferredphonenumber: 'phone',
  prefferedphonenumber: 'phone', prefferedphone: 'phone', preferedphonenumber: 'phone',
  phone: 'phone', phonenumber: 'phone',
  pniemailindicator: 'email_ind', emailindicator: 'email_ind',
  pniphoneindicator: 'phone_ind', phoneindicator: 'phone_ind',
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Render a cell to its DISPLAY string. Hyperlink and rich-text cells carry the
// human value in `.text`/`.richText` — NEVER return the hyperlink URL when a
// display value exists (the District export links the policy number to an Okta
// launch URL that is identical across every row).
function cellStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const o = v as { text?: unknown; result?: unknown; hyperlink?: string; richText?: Array<{ text?: string }> }
    if (Array.isArray(o.richText)) return o.richText.map((t) => t?.text ?? '').join('').trim()
    if (o.text != null) return typeof o.text === 'object' ? cellStr(o.text) : String(o.text).trim()
    if (o.result != null) return typeof o.result === 'object' ? cellStr(o.result) : String(o.result).trim()
    if (typeof o.hyperlink === 'string') return o.hyperlink.trim()
  }
  return String(v).trim()
}

function toIsoDate(s: string): string | null {
  const t = (s || '').trim()
  if (!t) return null
  if (/error/i.test(t)) return null // "#Error!" cells in the export
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

// Insured birthday in the source is month/day only — the birth year is masked with
// a placeholder (the export renders a current-year date). Reduce a full date to
// MM/DD and keep a bare MM/DD verbatim; never coerce a fabricated year onto it.
function normalizeDob(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}` // drop the placeholder year
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) return `${Number(m[1])}/${Number(m[2])}` // month/day only
  return s
}

/** Turn any supported file into raw string matrices (one per worksheet), preserving column order. */
async function fileToMatrices(buffer: Buffer, filename: string): Promise<string[][][]> {
  const ext = extensionOf(filename)
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = buffer.toString('utf8')
    if (ext === 'csv') return [parseCsv(text)]
    return [text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.length).map((l) => l.split('\t'))]
  }
  if (ext === 'pdf') {
    const { extractPdfPages, pdfPagesToTable } = await import('@/lib/import/pdf')
    const t = pdfPagesToTable(await extractPdfPages(buffer))
    return [[t.headers, ...t.rows.map((r) => t.headers.map((h) => r[h] ?? ''))]]
  }
  if (ext === 'json') {
    const data = JSON.parse(buffer.toString('utf8'))
    const arr: Record<string, unknown>[] = Array.isArray(data) ? data : (data.records ?? data.data ?? [])
    const headers = Array.from(new Set(arr.flatMap((o) => Object.keys(o))))
    return [[headers, ...arr.map((o) => headers.map((h) => (o[h] == null ? '' : String(o[h]))))]]
  }
  // xlsx (default): ExcelJS first (ALL non-empty worksheets — the District export
  // splits series codes and agency names across two sheets); fall back to the
  // namespace-tolerant reader for workbooks ExcelJS can't parse.
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    const sheets: string[][][] = []
    for (const ws of wb.worksheets) {
      if (!ws || ws.rowCount === 0) continue
      const matrix: string[][] = []
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellStr(cell.value) })
        for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
        matrix.push(cells)
      })
      if (matrix.length > 1) sheets.push(matrix)
    }
    if (sheets.length) return sheets
    throw new Error('no rows')
  } catch {
    const { xlsxToMatrix } = await import('@/lib/import/xlsxRaw')
    return [await xlsxToMatrix(buffer)]
  }
}

/** Parse one matrix into conversion records + skipped count, or null if no header row is present. */
function parseMatrix(matrix: string[][]): { records: ConversionRecord[]; skipped: number } | null {
  let headerRow = -1
  let colMap: Record<string, number> = {}
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const map: Record<string, number> = {}
    matrix[r].forEach((h, i) => {
      const canon = ALIASES[squash(h)]
      if (!canon) return
      // The export sometimes mislabels the Policy Owner column "Policy Number" too;
      // a second policy-labeled column with no owner mapped is the owner.
      if (canon === 'policy') {
        if (!('policy' in map)) map.policy = i
        else if (!('owner' in map)) map.owner = i
        return
      }
      if (!(canon in map)) map[canon] = i
    })
    if ('policy' in map && ('deadline' in map || 'owner' in map || 'agency' in map)) { headerRow = r; colMap = map; break }
  }
  if (headerRow === -1) return null

  const at = (row: string[], field: string): string => (colMap[field] != null ? (row[colMap[field]] || '').trim() : '')

  const records: ConversionRecord[] = []
  let skipped = 0
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row || row.every((c) => !c || !String(c).trim())) continue
    const policy = at(row, 'policy').replace(/\s+/g, '')
    if (!policy || !/\d/.test(policy)) { skipped++; continue } // preamble / total footer
    const owner = normalizeName(at(row, 'owner'))
    const insured = normalizeName(at(row, 'insured'))
    records.push({
      policy_number: policy,
      owner_name: owner,
      insured_name: insured || null,
      insured_dob: normalizeDob(at(row, 'dob')),
      product_type: at(row, 'product') || null,
      convertible_amount: toNum(at(row, 'amount')),
      conversion_deadline: toIsoDate(at(row, 'deadline')),
      inception_date: toIsoDate(at(row, 'inception')),
      expiration_date: toIsoDate(at(row, 'expiration')),
      series_code: at(row, 'series') || null,
      agency_name: at(row, 'agency') || null,
      pni_email: at(row, 'email').toLowerCase() || null,
      pni_phone: at(row, 'phone') || null,
      email_indicator: at(row, 'email_ind') || null,
      phone_indicator: at(row, 'phone_ind') || null,
      name_key: nameKey(owner),
      conversion_key: policy,
    })
  }
  return { records, skipped }
}

// Fill blank fields on `into` from `from` (first non-null wins). Used to merge the
// same policy across worksheets (Sheet1 carries series code + consent, Sheet2 the
// agency name). String fields backfill; the primary sheet's value is never replaced.
function mergeInto(into: ConversionRecord, from: ConversionRecord): void {
  const keys: (keyof ConversionRecord)[] = [
    'owner_name', 'insured_name', 'insured_dob', 'product_type', 'convertible_amount',
    'conversion_deadline', 'inception_date', 'expiration_date', 'series_code', 'agency_name',
    'pni_email', 'pni_phone', 'email_indicator', 'phone_indicator',
  ]
  for (const k of keys) {
    const cur = into[k]
    if ((cur == null || cur === '') && from[k] != null && from[k] !== '') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(into as any)[k] = from[k]
    }
  }
}

/**
 * Parse a Life Conversion list. Reads every worksheet, finds each header row (the
 * export prefixes a title/notes block), maps columns, drops rows without a policy
 * number (preamble + the "Total Convertible Amount" footer), and merges rows that
 * share a policy number across sheets. Deterministic.
 */
export async function parseConversionFile(buffer: Buffer, filename: string): Promise<ConversionParseResult> {
  const matrices = await fileToMatrices(buffer, filename)
  const parsed = matrices.map(parseMatrix).filter((x): x is { records: ConversionRecord[]; skipped: number } => x !== null)
  if (parsed.length === 0) throw new Error('Could not find the conversion header row (need a "Policy Number" column).')

  const merged = new Map<string, ConversionRecord>()
  let skipped = 0
  for (const { records, skipped: s } of parsed) {
    skipped += s
    for (const rec of records) {
      const existing = merged.get(rec.policy_number)
      if (existing) mergeInto(existing, rec)
      else merged.set(rec.policy_number, rec)
    }
  }
  const records = Array.from(merged.values())
  const total_convertible = records.reduce((sum, r) => sum + (r.convertible_amount || 0), 0)
  return { records, skipped, total_convertible }
}

// ── Agent of Record ────────────────────────────────────────────────────────────
/**
 * Build the source_data hint keys the household_policies AOR resolver reads
 * (fsos_resolve_policy_agency): the series code matches agency_partnerships
 * .fnwl_serving_agent_no, the agency name matches agency_partnerships.agency_name.
 * The DB trigger sets agency_partnership_id from these ONLY when it is unset, so
 * these hints correct/complete the Agent of Record without overwriting a good one.
 */
export function conversionAorHints(r: Pick<ConversionRecord, 'series_code' | 'agency_name'>): Record<string, string> {
  const out: Record<string, string> = {}
  if (r.series_code && r.series_code.trim()) out['Serving Agent Number'] = r.series_code.trim()
  if (r.agency_name && r.agency_name.trim()) out['Agency Name'] = r.agency_name.trim()
  return out
}

// ── Consent / do-not-contact ─────────────────────────────────────────────────────
export type SuppressionChannel = 'call' | 'sms' | 'email' | 'all'
export interface ConversionSuppression {
  contact: string // phone (call/sms) or lowercased email (email)
  channel: SuppressionChannel
  reason: string
  litigator: boolean // a known TCPA litigator → hard household do-not-contact
}

/**
 * Derive do-not-contact ledger entries from a row's channel indicators. Faithful,
 * conservative, and never fabricates positive consent:
 *   • phone "DNC Litigator" → all-channel suppression + litigator flag (legal risk)
 *   • phone "DNC"           → suppress calls (National DNC)
 *   • phone "PWC Revoked"   → suppress SMS (prior written consent revoked)
 *   • email "Unsubscribed"  → suppress email
 *   • email "Held"          → suppress email (bounced / held)
 * "CELL", "VOIP", "PWC" (still granted), "Not Verified", and "✅" are informational
 * and never suppress. Emitted only when the channel's contact value is present.
 */
export function conversionSuppressions(
  r: Pick<ConversionRecord, 'pni_phone' | 'pni_email' | 'phone_indicator' | 'email_indicator'>,
): ConversionSuppression[] {
  const out: ConversionSuppression[] = []
  const phone = (r.pni_phone || '').trim()
  const email = (r.pni_email || '').trim().toLowerCase()
  const pind = (r.phone_indicator || '').toUpperCase()
  const eind = (r.email_indicator || '').toUpperCase()

  if (phone) {
    if (pind.includes('LITIGATOR')) {
      out.push({ contact: phone, channel: 'all', reason: 'district-file: DNC litigator', litigator: true })
    } else {
      if (pind.includes('DNC')) out.push({ contact: phone, channel: 'call', reason: 'district-file: DNC', litigator: false })
      if (pind.includes('PWC REVOKED')) out.push({ contact: phone, channel: 'sms', reason: 'district-file: prior written consent revoked', litigator: false })
    }
  }
  if (email) {
    if (eind.includes('UNSUBSCRIBED')) out.push({ contact: email, channel: 'email', reason: 'district-file: unsubscribed', litigator: false })
    else if (eind.includes('HELD')) out.push({ contact: email, channel: 'email', reason: 'district-file: email held/suppressed', litigator: false })
  }
  return out
}

export interface ConversionSummary {
  total: number
  with_owner: number
  with_insured: number
  with_deadline: number
  with_aor: number
  total_convertible: number
  expiring_12mo: number
  by_product: Record<string, number>
}

export function summarizeConversions(records: ConversionRecord[], now: string): ConversionSummary {
  const by_product: Record<string, number> = {}
  let with_owner = 0
  let with_insured = 0
  let with_deadline = 0
  let with_aor = 0
  let total_convertible = 0
  let expiring_12mo = 0
  const horizon = new Date(now)
  horizon.setFullYear(horizon.getFullYear() + 1)
  for (const r of records) {
    if (r.owner_name) with_owner++
    if (r.insured_name) with_insured++
    if (r.conversion_deadline) with_deadline++
    if (r.series_code || r.agency_name) with_aor++
    if (r.convertible_amount) total_convertible += r.convertible_amount
    if (r.conversion_deadline && new Date(r.conversion_deadline) <= horizon) expiring_12mo++
    const p = r.product_type || 'Unknown'
    by_product[p] = (by_product[p] || 0) + 1
  }
  return { total: records.length, with_owner, with_insured, with_deadline, with_aor, total_convertible, expiring_12mo, by_product }
}
