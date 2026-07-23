// src/lib/agencyDirectory.ts
// ─────────────────────────────────────────────────────────────────────────
// Field mapping + validation for the Agency Directory bulk importer
// (/api/agencies/import). Turns a loose CSV/XLSX row from a Farmers agent
// directory (agent code, name, office address, business + mobile phone, email,
// and prospecting flags) into a clean, validated agency-partnership + owner
// payload for the aggregate-root spine.
//
// Kept as pure functions (mirrors src/lib/ghlContacts.ts) so the route handler
// stays a thin orchestrator: parse → map → validate → dedupe → insert, and so
// the mapping is unit-testable without a live Supabase. The normalized row is
// re-validated with Zod (AgencyImportRowSchema) before any write — Zod at the
// edge per CLAUDE.md §3.1.7.
// ─────────────────────────────────────────────────────────────────────────

import { z } from 'zod'

// Canonical field → accepted header aliases (compared lower-cased with
// spaces / underscores / hyphens / dots collapsed). First match wins.
const HEADER_ALIASES = {
  agent_code: ['agent', 'agentcode', 'agentnumber', 'agentno', 'agent#', 'code', 'fnwlagentno', 'servingagentno'],
  first_name: ['first', 'firstname', 'fname', 'givenname'],
  last_name: ['last', 'lastname', 'lname', 'surname', 'familyname'],
  full_name: ['name', 'fullname', 'agentname', 'ownername'],
  agency_name: ['agency', 'agencyname'],
  email: ['email', 'emailaddress', 'e-mail', 'emailadress'],
  business_phone: ['businessphone', 'officephone', 'workphone', 'business', 'office', 'phone', 'telephone', 'tel'],
  mobile_phone: ['mobile', 'mobilephone', 'cell', 'cellphone', 'cellnumber'],
  address: ['address', 'address1', 'streetaddress', 'street', 'officeaddress'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode'],
  existing_leads_user: ['existingleadsuser', 'existingleads', 'leadsuser', 'leads'],
  interested: ['interested', 'interest'],
} as const

export type AgencyField = keyof typeof HEADER_ALIASES

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-.#]+/g, '')
}

/** Build header → canonical-field map for a directory header row. First alias wins. */
export function detectAgencyColumns(headers: string[]): Record<string, AgencyField> {
  const map: Record<string, AgencyField> = {}
  const aliasToField = new Map<string, AgencyField>()
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) if (!aliasToField.has(a)) aliasToField.set(a, field as AgencyField)
  }
  for (const h of headers) {
    const field = aliasToField.get(normalizeHeader(h))
    if (field && !Object.values(map).includes(field)) map[h] = field
  }
  return map
}

function pick(record: Record<string, string>, colMap: Record<string, AgencyField>, field: AgencyField): string {
  for (const [header, mapped] of Object.entries(colMap)) {
    if (mapped === field) {
      const v = (record[header] ?? '').trim()
      if (v) return v
    }
  }
  return ''
}

// ── Normalizers ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!e) return null
  return EMAIL_RE.test(e) ? e : null
}

/**
 * Normalize a US phone to E.164 for consistent storage / later dispatch. Falls
 * back to the trimmed original when it isn't a clean 10/11-digit number (office
 * lines occasionally carry extensions) so the value is preserved, not dropped.
 * Returns null only when there is effectively no dialable number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (hasPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 7) return trimmed // keep the original (e.g. has an extension)
  return null
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

const TRUTHY = new Set(['y', 'yes', 'true', '1', 'x', '✓', 'checked', 'interested'])

/** Parse a loose spreadsheet flag cell into a boolean. */
export function parseFlag(raw: string): boolean {
  return TRUTHY.has(raw.trim().toLowerCase())
}

/** Uppercase, whitespace-stripped agent code — the dedupe natural key. */
export function normalizeAgentCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/\s+/g, '')
  return c || null
}

// ── Zod schema for the normalized row (edge validation before write) ─────────
export const AgencyImportRowSchema = z.object({
  agency_name: z.string().trim().min(1).max(200),
  owner_name: z.string().trim().min(1).max(200),
  agent_code: z.string().trim().max(32).nullable(),
  email: z.string().trim().email().max(200).nullable(),
  business_phone: z.string().trim().max(40).nullable(),
  mobile_phone: z.string().trim().max(40).nullable(),
  office_address: z.string().trim().max(300).nullable(),
  office_city: z.string().trim().max(120).nullable(),
  office_state: z.string().trim().max(40).nullable(),
  office_zip: z.string().trim().max(20).nullable(),
  existing_leads_user: z.boolean(),
  interested: z.boolean(),
})
export type AgencyImportRow = z.infer<typeof AgencyImportRowSchema>

export interface MappedAgency extends AgencyImportRow {
  /** Stable key for in-batch + against-DB dedupe (agent code → email → phone). */
  dedupeKey: string
  /** Human label for logs / results. */
  label: string
}

export interface AgencyMapResult {
  agency: MappedAgency | null
  errors: string[]
}

/**
 * Map + validate a single directory row. `defaults.state` fills office_state
 * when a row carries no state column (labeled default in the UI, not invented
 * data — §4.3). Returns errors when the row can't become a valid partnership
 * (no name, or no dedupe-able identifier at all).
 */
export function mapAndValidateAgency(
  record: Record<string, string>,
  colMap: Record<string, AgencyField>,
  defaults: { state?: string } = {},
): AgencyMapResult {
  const errors: string[] = []

  let first = pick(record, colMap, 'first_name')
  let last = pick(record, colMap, 'last_name')
  const full = pick(record, colMap, 'full_name')
  if (!first && !last && full) {
    const s = splitName(full)
    first = s.first
    last = s.last
  }
  const ownerName = [first, last].filter(Boolean).join(' ').trim() || full.trim()

  const agentCode = normalizeAgentCode(pick(record, colMap, 'agent_code'))

  const rawEmail = pick(record, colMap, 'email')
  const email = normalizeEmail(rawEmail)
  if (rawEmail && !email) errors.push(`Invalid email: "${rawEmail}"`)

  const businessPhone = normalizePhone(pick(record, colMap, 'business_phone'))
  const mobilePhone = normalizePhone(pick(record, colMap, 'mobile_phone'))

  const address = pick(record, colMap, 'address') || null
  const city = pick(record, colMap, 'city') || null
  const state = pick(record, colMap, 'state') || defaults.state?.trim() || null
  const zip = pick(record, colMap, 'zip') || null

  // No agency-name column in a Farmers agent directory: the agency is named for
  // its owner. Truthful derivation, no invented suffix.
  const agencyName = pick(record, colMap, 'agency_name') || ownerName

  if (!ownerName) errors.push('Missing agent name')
  if (!agentCode && !email && !businessPhone && !mobilePhone) {
    errors.push('Row needs at least an agent code, email, or phone to identify it')
  }
  if (errors.length > 0) return { agency: null, errors }

  const normalized = {
    agency_name: agencyName,
    owner_name: ownerName,
    agent_code: agentCode,
    email,
    business_phone: businessPhone,
    mobile_phone: mobilePhone,
    office_address: address,
    office_city: city,
    office_state: state ? state.toUpperCase().slice(0, 40) : null,
    office_zip: zip,
    existing_leads_user: parseFlag(pick(record, colMap, 'existing_leads_user')),
    interested: parseFlag(pick(record, colMap, 'interested')),
  }

  const parsed = AgencyImportRowSchema.safeParse(normalized)
  if (!parsed.success) {
    return { agency: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  }

  const dedupeKey = agentCode || email || businessPhone || (mobilePhone as string)
  const label = ownerName || agencyName || email || dedupeKey

  return { agency: { ...parsed.data, dedupeKey, label }, errors: [] }
}

/** Fields the importer recognizes — surfaced in the UI's column help. */
export const AGENCY_CANONICAL_FIELDS = Object.keys(HEADER_ALIASES) as AgencyField[]

/**
 * Resolve the header→field map and report whether the file has the minimum
 * columns: a name (first/last or full) and at least one identifier column.
 */
export function resolveAgencyColumns(headers: string[]): {
  map: Record<string, AgencyField>
  hasName: boolean
  hasIdentifier: boolean
} {
  const map = detectAgencyColumns(headers)
  const fields = new Set(Object.values(map))
  const hasName = fields.has('first_name') || fields.has('last_name') || fields.has('full_name')
  const hasIdentifier =
    fields.has('agent_code') || fields.has('email') || fields.has('business_phone') || fields.has('mobile_phone')
  return { map, hasName, hasIdentifier }
}
