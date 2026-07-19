/**
 * Sanitize a `?next=` redirect target so it can only point back into this app.
 * Rejects absolute URLs and protocol-relative (`//host`) values to prevent an
 * open-redirect through the login/MFA flow. Falls back to the FSA home.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}
