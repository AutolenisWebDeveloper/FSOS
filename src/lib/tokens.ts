// src/lib/tokens.ts
// Cryptographically strong, URL-safe tokens.
// Form tokens are the sole access control on client-facing intake links,
// so they must be unguessable — never derive them from UUIDv4 (which leaks
// a fixed version nibble) or from timestamps.

import { randomBytes } from 'crypto'

/**
 * Returns a URL-safe token with ~144 bits of entropy.
 * base64url alphabet: [A-Za-z0-9_-], no padding — safe in query strings.
 */
export function generateFormToken(): string {
  return randomBytes(18).toString('base64url')
}

/** Short human-readable reference derived from a token (display only). */
export function referenceFromToken(token: string): string {
  return 'FFS-' + token.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, '0')
}
