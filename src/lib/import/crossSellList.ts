// src/lib/import/crossSellList.ts
// Parser for the "Cross Sell - Auto/Home/Umb No Life" list (a Farmers P&C book
// exported from Salesforce). Accepts the header-keyed table produced by
// parseContactsFile (CSV / XLSX / JSON) and normalizes each row into a
// CrossSellRecord: the person, their P&C lines of business, mailing address, and
// contact points with compliance flags (DNC / email-unsubscribed).
//
// GUARDRAILS: these are property/casualty lines only — there is nothing
// securities-related here (is_security stays false everywhere), and the record
// carries no product/policy recommendation. It marks a household as a *life*
// cross-sell target (they have Auto/Home/Umbrella but no life) — a green-zone
// "identify" signal, not advice.

import type { ParsedContactTable } from '@/lib/contacts/parseFile'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export interface CrossSellRecord {
  full_name: string
  first_name: string
  last_name: string
  lines_of_business: string[]
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  zip5: string
  phone: string | null
  email: string | null
  phone_dnc: boolean
  email_unsub: boolean
  // Derived match/dedupe keys.
  name_key: string
  phone_digits: string | null
  email_lc: string | null
  crosssell_key: string
}

export interface CrossSellParseResult {
  records: CrossSellRecord[]
  skipped: number
}

// Canonical P&C lines we recognize in the "Active LOB" column (longest first so
// "Specialty-Dwelling" wins over a bare "Specialty").
const CANON_LOB = [
  'Specialty-Dwelling',
  'Specialty-Recreational',
  'Umbrella',
  'Flood',
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

// Header aliases → canonical field. Matched case-insensitively on a squashed key
// (letters only) so "Account Name", "account_name", "AccountName", "Full Name"
// all resolve. Supports both a raw Salesforce export and our cleaned CSV.
const HEADER_ALIASES: Record<string, string> = {
  accountname: 'full_name', fullname: 'full_name', name: 'full_name', contactname: 'full_name',
  firstname: 'first_name', lastname: 'last_name',
  activelob: 'lob', lob: 'lob', linesofbusiness: 'lob', products: 'lob',
  street: 'street', address: 'street', mailingstreet: 'street', address1: 'street',
  city: 'city', mailingcity: 'city',
  state: 'state', mailingstate: 'state',
  zip: 'zip', zipcode: 'zip', postalcode: 'zip', mailingzip: 'zip', zip5: 'zip5',
  preferredhouseholdphone: 'phone', phone: 'phone', phonenumber: 'phone', mobile: 'phone', cell: 'phone',
  preferredhouseholdemail: 'email', email: 'email', emailaddress: 'email',
  phonednc: 'phone_dnc', dnc: 'phone_dnc', donotcall: 'phone_dnc',
  emailunsub: 'email_unsub', unsubscribed: 'email_unsub', emailunsubscribed: 'email_unsub',
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function buildColumnMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    const canon = HEADER_ALIASES[squash(h)]
    if (canon && !(canon in map)) map[canon] = h
  }
  return map
}

function truthy(v: string | undefined): boolean {
  const s = (v || '').trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 't'
}

function parseLob(raw: string): string[] {
  if (!raw) return []
  // Normalize the line-wrap artifact "Specialty- Dwelling" → "Specialty-Dwelling".
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
  // Longest state names first so "New Mexico" matches before "New".
  for (const name of Object.keys(STATE_ABBR).sort((a, b) => b.length - a.length)) {
    if (s.toLowerCase().includes(name)) return STATE_ABBR[name]
  }
  return s.slice(0, 2).toUpperCase()
}

function normZip(raw: string): { zip: string | null; zip5: string } {
  const m = (raw || '').replace(/\s/g, '').match(/(\d{5})(?:-?(\d{4}))?/)
  if (!m) return { zip: null, zip5: '' }
  const zip5 = m[1]
  const zip = m[2] ? `${zip5}-${m[2]}` : zip5
  return { zip, zip5 }
}

const PHONE_RE = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/
function extractPhone(raw: string): { phone: string | null; dncFromFlags: boolean } {
  const m = (raw || '').match(PHONE_RE)
  const phone = m ? m[0].replace(/\s+/g, ' ').trim() : null
  const dncFromFlags = /\bDNC\b|\bRevoked\b/i.test(raw || '')
  return { phone, dncFromFlags }
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
function extractEmail(raw: string): { email: string | null; unsubFromFlags: boolean } {
  const m = (raw || '').match(EMAIL_RE)
  return { email: m ? m[0] : null, unsubFromFlags: /unsubscribed/i.test(raw || '') }
}

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '')

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] || full, last: parts.slice(1).join(' ') }
}

/**
 * Normalize a parsed cross-sell table into CrossSellRecords. Rows without a
 * usable name are skipped (counted in `skipped`). Deterministic — same input
 * always yields the same records and keys.
 */
export function parseCrossSellTable(table: ParsedContactTable): CrossSellParseResult {
  const col = buildColumnMap(table.headers)
  const get = (row: Record<string, string>, field: string): string =>
    col[field] ? (row[col[field]] || '').trim() : ''

  const records: CrossSellRecord[] = []
  let skipped = 0

  for (const row of table.rows) {
    let full = get(row, 'full_name')
    if (!full) {
      const combined = [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ').trim()
      full = combined
    }
    full = full.replace(/\s+Household\s*$/i, '').replace(/\s+/g, ' ').trim()
    if (!full) {
      skipped++
      continue
    }

    const lines_of_business = parseLob(get(row, 'lob'))
    const street = get(row, 'street') || null
    const city = get(row, 'city') || null
    const state = normState(get(row, 'state'))
    const zipSrc = get(row, 'zip') || get(row, 'zip5')
    const { zip, zip5 } = normZip(zipSrc)

    const phoneRaw = get(row, 'phone')
    const { phone, dncFromFlags } = extractPhone(phoneRaw)
    const emailRaw = get(row, 'email')
    const { email, unsubFromFlags } = extractEmail(emailRaw)

    const phone_dnc = col['phone_dnc'] ? truthy(get(row, 'phone_dnc')) : dncFromFlags
    const email_unsub = col['email_unsub'] ? truthy(get(row, 'email_unsub')) : unsubFromFlags

    const { first, last } = splitName(full)
    const nk = nameKey(full)

    records.push({
      full_name: full,
      first_name: first,
      last_name: last,
      lines_of_business,
      street,
      city,
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
      crosssell_key: `${nk}|${zip5}`,
    })
  }

  return { records, skipped }
}

export interface CrossSellSummary {
  total: number
  with_phone: number
  with_email: number
  with_address: number
  dnc: number
  email_unsub: number
  by_lob: Record<string, number>
  by_state: Record<string, number>
}

export function summarizeCrossSell(records: CrossSellRecord[]): CrossSellSummary {
  const by_lob: Record<string, number> = {}
  const by_state: Record<string, number> = {}
  let with_phone = 0
  let with_email = 0
  let with_address = 0
  let dnc = 0
  let email_unsub = 0
  for (const r of records) {
    if (r.phone) with_phone++
    if (r.email) with_email++
    if (r.street && r.city && r.zip5) with_address++
    if (r.phone_dnc) dnc++
    if (r.email_unsub) email_unsub++
    for (const l of r.lines_of_business) by_lob[l] = (by_lob[l] || 0) + 1
    if (r.state) by_state[r.state] = (by_state[r.state] || 0) + 1
  }
  return { total: records.length, with_phone, with_email, with_address, dnc, email_unsub, by_lob, by_state }
}
