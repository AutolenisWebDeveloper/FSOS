// src/lib/import/winBackList.ts
// Parser for a "Life Win-Back Opportunities" list — households whose agency once
// had a Life line that is now INACTIVE (lapsed / moved away), and who therefore
// are prime targets to re-engage for life coverage. A Salesforce export, cleaned,
// with a banner title row above the real header (same shape as the other lists).
//
// Each row is one account: the person, the agency lines that are now inactive
// (the win-back signal — "Life" appears here), the lines still active today,
// mailing state / ZIP, and preferred phone / email with compliance flags.
//
// GUARDRAILS: property/casualty + lapsed-life context only — a green-zone
// "identify" signal for life re-engagement. Nothing here is a securities record
// (is_security stays false everywhere) and no product/policy recommendation is
// implied. Lines of business are captured for context, never as advice.

import { xlsxToMatrix } from '@/lib/import/xlsxRaw'
import { parseCsv } from '@/lib/csv'
import { extensionOf } from '@/lib/spreadsheet'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export interface WinBackRecord {
  full_name: string
  first_name: string
  last_name: string
  inactive_lob: string[] // lines the agency previously had, now inactive (incl. Life)
  active_lob: string[] // lines still active today
  lines_of_business: string[] // union of inactive + active (for the contact record)
  had_life: boolean // "Life" is among the inactive lines — the win-back signal
  state: string | null
  zip: string | null
  zip5: string
  phone: string | null
  email: string | null
  phone_dnc: boolean
  email_unsub: boolean
  // Derived match / dedupe keys.
  name_key: string
  phone_digits: string | null
  email_lc: string | null
  winback_key: string
}

export interface WinBackParseResult {
  records: WinBackRecord[]
  skipped: number
}

// Canonical lines we recognize in the LOB columns (longest first so a compound
// line wins over a bare prefix).
const CANON_LOB = [
  'Specialty-Dwelling',
  'Specialty-Recreational',
  'Umbrella',
  'Flood',
  'Life',
  'FFS',
  'Other',
  'Auto',
  'Home',
] as const

const STATE_ABBR: Record<string, string> = {
  texas: 'TX', california: 'CA', washington: 'WA', arizona: 'AZ', kansas: 'KS', 'new mexico': 'NM',
  colorado: 'CO', wyoming: 'WY', michigan: 'MI', oregon: 'OR', illinois: 'IL', oklahoma: 'OK', utah: 'UT',
  nebraska: 'NE', georgia: 'GA', wisconsin: 'WI', nevada: 'NV', ohio: 'OH', florida: 'FL', louisiana: 'LA',
  missouri: 'MO', tennessee: 'TN', indiana: 'IN', minnesota: 'MN', arkansas: 'AR', alabama: 'AL',
  virginia: 'VA', 'new york': 'NY', 'north carolina': 'NC',
}

// Header aliases (squashed to letters+digits) → canonical field. Matched
// case-insensitively so "Account Name", "account_name", "AccountName", "Full
// Name" all resolve. Supports a raw Salesforce export and the cleaned file.
const ALIASES: Record<string, string> = {
  accountname: 'name', fullname: 'name', name: 'name', contactname: 'name',
  inactiveagencylinesofbusiness: 'inactive_lob', inactivelinesofbusiness: 'inactive_lob',
  inactiveagencylob: 'inactive_lob', inactivelob: 'inactive_lob', inactivelines: 'inactive_lob',
  currentactivelinesofbusiness: 'active_lob', activelinesofbusiness: 'active_lob',
  currentlinesofbusiness: 'active_lob', activelob: 'active_lob', currentlob: 'active_lob', activelines: 'active_lob',
  mailingstateprovince: 'state', mailingstate: 'state', state: 'state', stateprovince: 'state',
  zipcode: 'zip', zip: 'zip', postalcode: 'zip', mailingzip: 'zip', zip5: 'zip5',
  preferredphone: 'phone', preferredhouseholdphone: 'phone', phone: 'phone', phonenumber: 'phone', mobile: 'phone', cell: 'phone',
  preferredemail: 'email', preferredhouseholdemail: 'email', email: 'email', emailaddress: 'email',
  phonednc: 'phone_dnc', dnc: 'phone_dnc', donotcall: 'phone_dnc',
  emailunsub: 'email_unsub', unsubscribed: 'email_unsub', emailunsubscribed: 'email_unsub',
}

const squash = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const nameKey = (name: string) => (name || '').toLowerCase().replace(/[^a-z]/g, '')

function parseLob(raw: string): string[] {
  if (!raw) return []
  // Normalize a line-wrap artifact "Specialty- Dwelling" → "Specialty-Dwelling".
  const text = raw.replace(/Specialty-\s+/gi, 'Specialty-')
  const found: string[] = []
  for (const lob of CANON_LOB) {
    if (new RegExp(`\\b${lob.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(text) && !found.includes(lob)) {
      found.push(lob)
    }
  }
  return found
}

function normState(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  for (const name of Object.keys(STATE_ABBR).sort((a, b) => b.length - a.length)) {
    if (s.toLowerCase().includes(name)) return STATE_ABBR[name]
  }
  return s.slice(0, 2).toUpperCase()
}

function normZip(raw: string): { zip: string | null; zip5: string } {
  const m = (raw || '').replace(/\s/g, '').match(/(\d{5})(?:-?(\d{4}))?/)
  if (!m) return { zip: null, zip5: '' }
  const zip5 = m[1]
  return { zip: m[2] ? `${zip5}-${m[2]}` : zip5, zip5 }
}

const PHONE_RE = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/
function extractPhone(raw: string): { phone: string | null; dncFromFlags: boolean } {
  const m = (raw || '').match(PHONE_RE)
  return { phone: m ? m[0].replace(/\s+/g, ' ').trim() : null, dncFromFlags: /\bDNC\b|\bRevoked\b/i.test(raw || '') }
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
function extractEmail(raw: string): { email: string | null; unsubFromFlags: boolean } {
  const m = (raw || '').match(EMAIL_RE)
  return { email: m ? m[0] : null, unsubFromFlags: /unsubscribed/i.test(raw || '') }
}

function truthy(v: string): boolean {
  const s = (v || '').trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 't'
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] || full, last: parts.slice(1).join(' ') }
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
 * Parse a Win-Back Life list. Finds the header row (the export prefixes a banner
 * title), maps columns, and drops rows without a usable name (the banner and any
 * footer). Deterministic — same input always yields the same records and keys.
 */
export async function parseWinBackFile(buffer: Buffer, filename: string): Promise<WinBackParseResult> {
  const matrix = await fileToMatrix(buffer, filename)

  // Locate the header row: the first row that maps a name + at least one other
  // recognized column (LOB / state / zip / phone / email).
  let headerRow = -1
  let colMap: Record<string, number> = {}
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const map: Record<string, number> = {}
    matrix[r].forEach((h, i) => {
      const canon = ALIASES[squash(h)]
      if (canon && !(canon in map)) map[canon] = i
    })
    const others = ['inactive_lob', 'active_lob', 'state', 'zip', 'phone', 'email'].some((k) => k in map)
    if ('name' in map && others) { headerRow = r; colMap = map; break }
  }
  if (headerRow === -1) throw new Error('Could not find the win-back header row (need an "Account Name" column).')

  const at = (row: string[], field: string): string => (colMap[field] != null ? (row[colMap[field]] || '').trim() : '')

  const records: WinBackRecord[] = []
  let skipped = 0
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row || row.every((c) => !c || !String(c).trim())) continue

    let full = at(row, 'name').replace(/\s+Household\s*$/i, '').replace(/\s+/g, ' ').trim()
    // Footer rows (totals / notes) carry no real name.
    if (!full || !/[A-Za-z]/.test(full) || /^total\b/i.test(full)) { skipped++; continue }

    const inactive_lob = parseLob(at(row, 'inactive_lob'))
    const active_lob = parseLob(at(row, 'active_lob'))
    const lines_of_business = Array.from(new Set([...inactive_lob, ...active_lob]))
    const had_life = inactive_lob.includes('Life')

    const state = normState(at(row, 'state'))
    const { zip, zip5 } = normZip(at(row, 'zip') || at(row, 'zip5'))

    const phoneRaw = at(row, 'phone')
    const { phone, dncFromFlags } = extractPhone(phoneRaw)
    const emailRaw = at(row, 'email')
    const { email, unsubFromFlags } = extractEmail(emailRaw)
    const phone_dnc = colMap['phone_dnc'] != null ? truthy(at(row, 'phone_dnc')) : dncFromFlags
    const email_unsub = colMap['email_unsub'] != null ? truthy(at(row, 'email_unsub')) : unsubFromFlags

    const { first, last } = splitName(full)
    const nk = nameKey(full)

    records.push({
      full_name: full,
      first_name: first,
      last_name: last,
      inactive_lob,
      active_lob,
      lines_of_business,
      had_life,
      state,
      zip,
      zip5,
      phone,
      email: email ? email.toLowerCase() : null,
      phone_dnc,
      email_unsub,
      name_key: nk,
      phone_digits: phoneDigits(phone),
      email_lc: emailLc(email),
      winback_key: `${nk}|${zip5}`,
    })
  }

  return { records, skipped }
}

export interface WinBackSummary {
  total: number
  had_life: number
  with_phone: number
  with_email: number
  with_state: number
  dnc: number
  email_unsub: number
  by_inactive_lob: Record<string, number>
  by_state: Record<string, number>
}

export function summarizeWinBack(records: WinBackRecord[]): WinBackSummary {
  const by_inactive_lob: Record<string, number> = {}
  const by_state: Record<string, number> = {}
  let had_life = 0
  let with_phone = 0
  let with_email = 0
  let with_state = 0
  let dnc = 0
  let email_unsub = 0
  for (const r of records) {
    if (r.had_life) had_life++
    if (r.phone) with_phone++
    if (r.email) with_email++
    if (r.state) { with_state++; by_state[r.state] = (by_state[r.state] || 0) + 1 }
    if (r.phone_dnc) dnc++
    if (r.email_unsub) email_unsub++
    for (const l of r.inactive_lob) by_inactive_lob[l] = (by_inactive_lob[l] || 0) + 1
  }
  return { total: records.length, had_life, with_phone, with_email, with_state, dnc, email_unsub, by_inactive_lob, by_state }
}
