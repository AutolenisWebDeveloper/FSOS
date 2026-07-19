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
  contact_type: ['contacttype', 'type', 'category', 'kind', 'recordtype', 'persona'],
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
  /** A "type/category" column value, when the file declared one (routing signal). */
  declaredType?: string | null
  /** Product-interest column value, when present (routing signal). */
  productInterest?: string | null
  /** Life-stage/segment column value, when present (routing signal). */
  lifeStage?: string | null
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
  const declaredType = pick(record, colMap, 'contact_type') || null
  if (productInterest) customFields[GHL_CUSTOM_FIELDS.product_interest] = productInterest
  if (lifeStage) customFields[GHL_CUSTOM_FIELDS.life_stage] = lifeStage
  if (agencyOwner) customFields[GHL_CUSTOM_FIELDS.referring_owner] = agencyOwner
  if (leadSource) customFields[GHL_CUSTOM_FIELDS.lead_source] = leadSource

  const dedupeKey = email || (phone as string)
  const label = `${first} ${last}`.trim() || email || phone || 'contact'

  return {
    contact: { firstName: first, lastName: last, email, phone, tags, source, customFields, dedupeKey, label, declaredType, productInterest: productInterest || null, lifeStage: lifeStage || null },
    errors: [],
  }
}

// ── Content-based column inference ────────────────────────────────────────
// When a header can't be resolved by name (e.g. "Col3", a non-English header,
// or a headerless export), infer the field from the *values* in the column.

const US_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC ' +
    'alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho ' +
    'illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota ' +
    'mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah ' +
    'vermont virginia washington wisconsin wyoming'
  )
    .toLowerCase()
    .split(/\s+/),
)

function isUsState(v: string): boolean {
  const t = v.trim().toLowerCase()
  return t.length > 0 && US_STATES.has(t)
}

function isFullName(v: string): boolean {
  const t = v.trim()
  if (!t || /[@\d]/.test(t)) return false
  return /^[A-Za-z][A-Za-z .,'-]*$/.test(t) && t.split(/\s+/).length >= 2
}

function isZip(v: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(v.trim())
}

// Detectors for the pattern-recognizable fields, most specific first.
const CONTENT_DETECTORS: Array<{ field: CanonicalField; test: (v: string) => boolean }> = [
  { field: 'email', test: (v) => !!normalizeEmail(v) },
  { field: 'phone', test: (v) => !!normalizePhone(v) },
  { field: 'postal_code', test: isZip },
  { field: 'state', test: isUsState },
  { field: 'full_name', test: isFullName },
]

const CONTENT_MIN_CONFIDENCE = 0.6 // ≥60% of non-empty cells must match
const CONTENT_SAMPLE = 40

/**
 * Infer a column→field map purely from cell values. Each column is scored
 * against every detector over a sample of its non-empty cells; the highest
 * confident, non-conflicting assignments win (email/phone before name, etc.).
 */
export function inferColumnMap(
  headers: string[],
  rows: Array<Record<string, string>>,
): Record<string, CanonicalField> {
  const sample = rows.slice(0, CONTENT_SAMPLE)
  const candidates: Array<{ header: string; field: CanonicalField; score: number }> = []

  for (const header of headers) {
    const values = sample.map((r) => (r[header] ?? '').trim()).filter(Boolean)
    if (values.length === 0) continue
    for (const { field, test } of CONTENT_DETECTORS) {
      const hits = values.reduce((n, v) => n + (test(v) ? 1 : 0), 0)
      const score = hits / values.length
      if (score >= CONTENT_MIN_CONFIDENCE) candidates.push({ header, field, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const map: Record<string, CanonicalField> = {}
  const usedFields = new Set<CanonicalField>()
  for (const c of candidates) {
    if (map[c.header] || usedFields.has(c.field)) continue
    map[c.header] = c.field
    usedFields.add(c.field)
  }
  return map
}

export type DetectionMethod = 'header' | 'content' | 'ai'

export interface ResolvedColumns {
  map: Record<string, CanonicalField>
  method: Record<string, DetectionMethod>
}

/**
 * Merge the three detection strategies into one authoritative column map,
 * in precedence order: exact header aliases (highest precision) → AI mapping
 * (reads headers + sample data) → content inference (value patterns). The
 * first strategy to claim a header/field wins; `method` records which did.
 */
export function resolveColumns(
  headers: string[],
  rows: Array<Record<string, string>>,
  aiMap?: Record<string, CanonicalField> | null,
): ResolvedColumns {
  const map: Record<string, CanonicalField> = {}
  const method: Record<string, DetectionMethod> = {}
  const usedFields = new Set<CanonicalField>()

  const assign = (header: string, field: CanonicalField | undefined, how: DetectionMethod) => {
    if (!field || map[header] || usedFields.has(field)) return
    map[header] = field
    method[header] = how
    usedFields.add(field)
  }

  const headerMap = detectColumnMap(headers)
  for (const h of headers) assign(h, headerMap[h], 'header')
  if (aiMap) for (const h of headers) assign(h, aiMap[h], 'ai')
  const contentMap = inferColumnMap(headers, rows)
  for (const h of headers) assign(h, contentMap[h], 'content')

  return { map, method }
}

/** The canonical fields the AI mapper is allowed to choose from. */
export const CANONICAL_FIELDS = Object.keys(HEADER_ALIASES) as CanonicalField[]
