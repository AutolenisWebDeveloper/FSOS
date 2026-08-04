// src/lib/import/mapping/templates.ts
// ─────────────────────────────────────────────────────────────────────────
// Source-file detection by header signature (design spec v2.1 §1). Each of the
// five real Farmers district exports carries a distinctive set of headers; when
// all of a template's distinctive headers are present, that template is detected
// and its saved mapping applies with one click.
//
// Detection is over the DISTINCTIVE header set (a subset), not the full header
// list, so a district export with extra/reordered columns still matches. The
// generic `signatureHash` (full squashed header set) keys operator-saved
// templates in `import_templates` (spec §5). Pure; no I/O.
// ─────────────────────────────────────────────────────────────────────────

import { squashHeader } from './fields'

export interface KnownTemplate {
  key: string
  name: string
  /** Human description of the file shape (spec §1 "Shape" column). */
  shape: string
  /** Squashed distinctive headers that must ALL be present to detect this template. */
  signature: string[]
}

// Ordered most-specific first so a superset file matches its precise template
// rather than a looser one.
export const KNOWN_TEMPLATES: KnownTemplate[] = [
  {
    key: 'life_conversion_convertible',
    name: 'Life Conversion — Convertible',
    shape: 'policy + owner + insured (incl. DOB)',
    signature: ['conversionexpirydate', 'policyowner', 'insuredbirthday', 'convertibleamount', 'aorwithseriescode'],
  },
  {
    key: 'life_conversion_policy_detail',
    name: 'Life Conversion — Policy Detail',
    shape: 'policy + owner + joint owner',
    signature: ['insuredname', 'ownername', 'jointownername', 'seriescode'],
  },
  {
    key: 'district_life_conversion',
    name: 'District Life Conversion',
    shape: 'policy + holder + insured',
    signature: ['conversionexpiringdate', 'policyholdername', 'aorcode'],
  },
  {
    key: 'district_win_back_life',
    name: 'District Win Back — Life',
    shape: 'account + contact',
    signature: ['inactiveagencylob', 'accountname', 'mailingstate'],
  },
  {
    key: 'district_cross_sell_life',
    name: 'District Cross Sell — Life',
    shape: 'household + contact',
    signature: ['activelob', 'preferredhouseholdphone', 'agencyaor'],
  },
]

/** Detect which known district template a header row belongs to, or null. */
export function detectTemplate(headers: string[]): KnownTemplate | null {
  const present = new Set(headers.map(squashHeader).filter(Boolean))
  for (const t of KNOWN_TEMPLATES) {
    if (t.signature.every((h) => present.has(h))) return t
  }
  return null
}

/**
 * Deterministic hash of the full (squashed, sorted, de-duplicated) header set —
 * the stable key an operator-saved template is stored under. FNV-1a (32-bit) →
 * 8-char hex. Order-independent so a reordered export hits the same template.
 */
export function signatureHash(headers: string[]): string {
  const canon = Array.from(new Set(headers.map(squashHeader).filter(Boolean))).sort().join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
