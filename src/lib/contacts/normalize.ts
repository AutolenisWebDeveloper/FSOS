// src/lib/contacts/normalize.ts
// Shared field normalization for the Contact Center — the dedupe keys and the
// display name are derived the same way for manual entry and bulk import.

export function emailLc(email?: string | null): string | null {
  const e = (email || '').trim().toLowerCase()
  return e || null
}

export function phoneDigits(phone?: string | null): string | null {
  const d = (phone || '').replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

export function deriveFullName(
  parts: { first?: string | null; last?: string | null; full?: string | null; email?: string | null; phone?: string | null },
): string {
  const full = (parts.full || '').trim()
  if (full) return full
  const combined = [parts.first, parts.last].map((s) => (s || '').trim()).filter(Boolean).join(' ')
  return combined || (parts.email || '').trim() || (parts.phone || '').trim() || 'Unnamed contact'
}
