// src/lib/import/mapping/commit.ts
// ─────────────────────────────────────────────────────────────────────────
// Translate a CONFIRMED mapping-model plan (source header → decision) into the
// inputs the existing Contact Center commit pipeline understands, plus the
// "extras" that pipeline doesn't natively carry (address block, plain DOB, custom
// values, LOB tags, composite splits, joint owner). This is the bridge that lets
// the unified mapper reuse the one shared resolution/materialize/audit backend
// (ADR-028, §6) instead of a parallel importer.
//
// Pure; no I/O, no clock, no randomness.
// ─────────────────────────────────────────────────────────────────────────

import type { CanonicalField } from '@/lib/import/csv-mapping'
import type { HeaderDecision } from './plan'
import { squashHeader, type FieldEntity, type FieldType } from './fields'
import { splitComposite } from './composite'

// Mapping-model target field id → the canonical field the legacy row mapper uses
// for validation (name / email / phone / referring owner). Address + DOB + custom
// are handled by extractRowExtras, not the legacy mapper.
const TARGET_TO_CANONICAL: Record<string, CanonicalField> = {
  'member.full_name': 'full_name',
  'household.household_name': 'full_name',
  'member.email': 'email',
  'household.preferred_email': 'email',
  'member.phone': 'phone',
  'household.preferred_phone': 'phone',
  'agency.agent_of_record': 'agency_owner',
}

export interface CustomFieldDef {
  entity: FieldEntity
  key: string
  label: string
  fieldType: FieldType
}

export interface CommitPlan {
  /** header → canonical field for mapAndValidateRow (name/email/phone/agency_owner). */
  colMap: Record<string, CanonicalField>
  address: { street?: string; city?: string; state?: string; zip?: string }
  dobHeader: string | null
  lobHeaders: string[]
  /** header → storage key in contacts.custom (single value). */
  customHeaders: Array<{ header: string; key: string }>
  /** composite header → parts, each stored in contacts.custom under its target id. */
  splitHeaders: Array<{ header: string; targets: string[]; delimiter: string }>
  joint: { name?: string; address?: string; city?: string; state?: string; zip?: string; phone?: string }
  requiredCustomFields: CustomFieldDef[]
}

function labelize(id: string): string {
  return id.split('.').pop()!.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Build the commit plan from a confirmed header_map. */
export function buildCommitPlan(headers: string[], headerMap: Record<string, HeaderDecision>): CommitPlan {
  const plan: CommitPlan = {
    colMap: {},
    address: {},
    dobHeader: null,
    lobHeaders: [],
    customHeaders: [],
    splitHeaders: [],
    joint: {},
    requiredCustomFields: [],
  }

  for (const header of headers) {
    const decision = headerMap[squashHeader(header)]
    if (!decision) continue
    switch (decision.kind) {
      case 'field': {
        const id = decision.fieldId
        const canonical = TARGET_TO_CANONICAL[id]
        if (canonical) {
          plan.colMap[header] = canonical
          break
        }
        // Address block → contact columns.
        if (id === 'household.street' || id === 'member.address') plan.address.street ??= header
        else if (id === 'household.city') plan.address.city ??= header
        else if (id === 'household.state') plan.address.state ??= header
        else if (id === 'household.zip') plan.address.zip ??= header
        else if (id === 'member.dob') plan.dobHeader ??= header
        else if (id === 'household.active_lob' || id === 'household.inactive_lob') plan.lobHeaders.push(header)
        else if (id === 'member.joint_full_name') plan.joint.name ??= header
        else if (id === 'member.joint_address') plan.joint.address ??= header
        else if (id === 'member.joint_city') plan.joint.city ??= header
        else if (id === 'member.joint_state') plan.joint.state ??= header
        else if (id === 'member.joint_zip') plan.joint.zip ??= header
        else if (id === 'member.joint_phone') plan.joint.phone ??= header
        // Everything else (policy.*, agency.aor_code/agent_number, …) → custom, keyed by field id.
        else plan.customHeaders.push({ header, key: id })
        break
      }
      case 'split': {
        plan.splitHeaders.push({ header, targets: decision.rule.targets, delimiter: decision.rule.delimiter })
        break
      }
      case 'custom': {
        const key = `${decision.entity}.${decision.customKey}`
        plan.customHeaders.push({ header, key })
        plan.requiredCustomFields.push({
          entity: decision.entity,
          key: decision.customKey,
          label: decision.label || labelize(decision.customKey),
          fieldType: decision.fieldType,
        })
        break
      }
      case 'as_is': {
        const key = `member.${squashHeader(header)}`
        plan.customHeaders.push({ header, key })
        plan.requiredCustomFields.push({ entity: 'member', key: squashHeader(header), label: header, fieldType: 'text' })
        break
      }
      // 'ignore' / 'unrecognized' → nothing
    }
  }
  return plan
}

const ISO = /^\d{4}-\d{2}-\d{2}/
const MDY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/

/** Parse a DOB cell into an ISO date (YYYY-MM-DD), or null when unparseable. No gating. */
export function parseDobToIso(raw: string | undefined): string | null {
  const v = (raw || '').trim()
  if (!v) return null
  if (ISO.test(v)) return v.slice(0, 10)
  const m = MDY.exec(v)
  if (m) {
    const mm = m[1].padStart(2, '0')
    const dd = m[2].padStart(2, '0')
    return `${m[3]}-${mm}-${dd}`
  }
  return null
}

function splitTags(raw: string): string[] {
  return (raw || '').split(/[;,|]/).map((t) => t.trim()).filter(Boolean)
}

// Never let an operator-supplied mapping write a prototype-polluting custom key.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export function isSafeCustomKey(k: string): boolean {
  return !!k && !UNSAFE_KEYS.has(k)
}

export interface RowExtras {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  dob: string | null
  custom: Record<string, string>
  extraTags: string[]
  joint: { full_name: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; custom: Record<string, string> } | null
}

/** Extract the non-legacy contact fields for one row per the commit plan. */
export function extractRowExtras(row: Record<string, string>, plan: CommitPlan): RowExtras {
  const val = (h?: string | null) => (h ? (row[h] ?? '').trim() : '')
  const custom: Record<string, string> = {}
  for (const c of plan.customHeaders) {
    const v = val(c.header)
    if (v && isSafeCustomKey(c.key)) custom[c.key] = v
  }
  for (const s of plan.splitHeaders) {
    const parts = splitComposite(val(s.header), { targets: s.targets, delimiter: s.delimiter, isAssumption: true })
    for (const [k, v] of Object.entries(parts)) if (v && isSafeCustomKey(k)) custom[k] = v
  }
  const extraTags: string[] = []
  for (const h of plan.lobHeaders) extraTags.push(...splitTags(val(h)))

  let joint: RowExtras['joint'] = null
  const jointName = val(plan.joint.name)
  if (jointName) {
    joint = {
      full_name: jointName,
      address: val(plan.joint.address) || null,
      city: val(plan.joint.city) || null,
      state: val(plan.joint.state) || null,
      zip: val(plan.joint.zip) || null,
      phone: val(plan.joint.phone) || null,
      custom: { role: 'joint_owner' },
    }
  }

  return {
    address: val(plan.address.street) || null,
    city: val(plan.address.city) || null,
    state: val(plan.address.state) || null,
    zip: val(plan.address.zip) || null,
    dob: parseDobToIso(val(plan.dobHeader)),
    custom,
    extraTags: Array.from(new Set(extraTags)),
    joint,
  }
}
