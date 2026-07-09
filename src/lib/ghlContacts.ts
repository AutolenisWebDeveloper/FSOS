// src/lib/ghlContacts.ts
// ─────────────────────────────────────────────────────────────────────────
// Field mapping + validation for the GoHighLevel CSV contact-upload workflow.
//
// Turns a loose CSV record (arbitrary header casing / aliases) into a clean,
// validated GHL contact payload. Every ambiguity is resolved here so the route
// handler stays a thin orchestrator: parse → map → validate → dedupe → upsert.
// ─────────────────────────────────────────────────────────────────────────

import { GHL_CUSTOM_FIELDS } from './ghl'

// Canonical field → accepted header aliases (all compared lower-cased, with
// spaces/underscores/hyphens collapsed). First match wins.
const HEADER_ALIASES: Record<string, string[]> = {
  first_name: ['firstname', 'first', 'fname', 'givenname'],
  last_name: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  full_name: ['name', 'fullname', 'contactname', 'contact'],
  email: ['email', 'emailaddress', 'e-mail', 'emailadress'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'cell', 'cellphone', 'telephone', 'tel'],
  tags: ['tags', 'tag', 'labels'],
  source: ['source', 'leadsource', 'origin'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  postal_code: ['postalcode', 'zip', 'zipcode', 'postcode'],
  address: ['address', 'address1', 'streetaddress', 'street'],
  company: ['company', 'companyname', 'business', 'businessname', 'organization', 'employer'],
  product_interest: ['productinterest', 'product', 'interest'],
  life_stage: ['lifestage', 'stage', 'segment'],
  agency_owner: ['agencyowner', 'agencyownername', 'referringowner', 'referringagencyowner', 'owner', 'agent', 'agentname'],
  notes: ['notes', 'note', 'comment', 'comments'],
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-.]+/g, '')
}

export type CanonicalField = keyof typeof HEADER_ALIASES

/** Build header → canonical-field map for a given CSV header row. */
export function detectColumnMap(headers: string[]): Record<string, CanonicalField> {
  const map: Record<string, CanonicalField> = {}
  const aliasToField = new Map<string, CanonicalField>()
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) aliasToField.set(a, field as CanonicalField)
  }
  for (const h of headers) {
    const field = aliasToField.get(normalizeHeader(h))
    if (field && !Object.values(map).includes(field)) map[h] = field
  }
  return map
}

function pick(record: Record<string, string>, colMap: Record<string, CanonicalField>, field: CanonicalField): string {
  for (const [header, mapped] of Object.entries(colMap)) {
    if (mapped === field) {
      const v = (record[header] ?? '').trim()
      if (v) return v
    }
  }
  return ''
}

// ── Normalizers ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!e) return null
  return EMAIL_RE.test(e) ? e : null
}

/**
 * Normalize a phone to E.164 for US/CA numbers. Returns null when it clearly
 * isn't a dialable number (fewer than 10 digits). 10 digits → +1XXXXXXXXXX;
 * 11 digits starting with 1 → +1…; anything already starting with + is kept
 * if it has 8–15 digits.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[;,|]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export interface MappedContact {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  tags: string[]
  source: string
  customFields: Record<string, string>
  /** Stable key used for in-batch dedupe (email preferred, else phone). */
  dedupeKey: string
  /** Human label for logs/results. */
  label: string
}

export interface MapResult {
  contact: MappedContact | null
  errors: string[]
}

/**
 * Map + validate a single CSV record. `defaults` supplies batch-wide tags /
 * source applied on top of per-row values. Returns errors when the row can't
 * become a valid contact (no name, or neither a valid email nor phone).
 */
export function mapAndValidateRow(
  record: Record<string, string>,
  colMap: Record<string, CanonicalField>,
  defaults: { tags?: string[]; source?: string; agencyOwner?: string } = {},
): MapResult {
  const errors: string[] = []

  let first = pick(record, colMap, 'first_name')
  let last = pick(record, colMap, 'last_name')
  const full = pick(record, colMap, 'full_name')
  if (!first && !last && full) {
    const s = splitName(full)
    first = s.first
    last = s.last
  }

  const rawEmail = pick(record, colMap, 'email')
  const rawPhone = pick(record, colMap, 'phone')
  const email = normalizeEmail(rawEmail)
  const phone = normalizePhone(rawPhone)

  if (rawEmail && !email) errors.push(`Invalid email: "${rawEmail}"`)
  if (rawPhone && !phone) errors.push(`Invalid phone: "${rawPhone}"`)

  if (!first && !last) errors.push('Missing contact name')
  if (!email && !phone) errors.push('Row must have a valid email or phone')

  if (errors.length > 0) return { contact: null, errors }

  const rowTags = splitTags(pick(record, colMap, 'tags'))
  const tags = Array.from(new Set([...(defaults.tags || []), ...rowTags]))
  const source = pick(record, colMap, 'source') || defaults.source || 'csv_upload'

  const customFields: Record<string, string> = {}
  const productInterest = pick(record, colMap, 'product_interest')
  const lifeStage = pick(record, colMap, 'life_stage')
  const agencyOwner = pick(record, colMap, 'agency_owner') || defaults.agencyOwner || ''
  const leadSource = pick(record, colMap, 'source') || defaults.source || ''
  if (productInterest) customFields[GHL_CUSTOM_FIELDS.product_interest] = productInterest
  if (lifeStage) customFields[GHL_CUSTOM_FIELDS.life_stage] = lifeStage
  if (agencyOwner) customFields[GHL_CUSTOM_FIELDS.referring_owner] = agencyOwner
  if (leadSource) customFields[GHL_CUSTOM_FIELDS.lead_source] = leadSource

  const dedupeKey = email || (phone as string)
  const label = `${first} ${last}`.trim() || email || phone || 'contact'

  return {
    contact: { firstName: first, lastName: last, email, phone, tags, source, customFields, dedupeKey, label },
    errors: [],
  }
}
