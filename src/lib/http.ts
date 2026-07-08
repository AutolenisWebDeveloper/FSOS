// src/lib/http.ts
// Shared helpers for API route handlers: safe numeric parsing, request-body
// size guards, HTML escaping, and internal-endpoint authorization.

import { NextRequest, NextResponse } from 'next/server'
import { ConfigError } from '@/lib/supabase/client'

/**
 * If `err` is a configuration error (missing env vars), return a clear 503 the
 * UI can display verbatim; otherwise return null so the caller falls through to
 * its normal error handling.
 */
export function configErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ConfigError) {
    return NextResponse.json({ error: err.message, code: 'not_configured' }, { status: 503 })
  }
  return null
}

/**
 * Parse a `limit` query param safely. Never returns NaN, always capped.
 */
export function parseLimit(raw: string | null, fallback = 50, max = 200): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, max)
  return Math.min(n, max)
}

/** Escape a string for safe interpolation into HTML (email templates, etc.). */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const MAX_JSON_BYTES = 100 * 1024 // 100 KB — generous for form payloads

/**
 * Read and parse a JSON body with a hard size cap to blunt payload-flood abuse
 * on public endpoints. Returns the parsed object or a NextResponse error.
 */
export async function readJson<T = Record<string, unknown>>(
  req: NextRequest,
  maxBytes = MAX_JSON_BYTES,
): Promise<{ data: T } | { error: NextResponse }> {
  const raw = await req.text()
  if (raw.length > maxBytes) {
    return { error: NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
  }
  try {
    return { data: JSON.parse(raw || '{}') as T }
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
}

/**
 * Authorize an internal (command-center / server-to-server) API request.
 *
 * A request is authorized if EITHER:
 *  - it carries `Authorization: Bearer <FSOS_API_SECRET>`, or
 *  - it carries HTTP Basic credentials matching FSOS_ADMIN_USER/PASSWORD
 *    (the same credentials the middleware gate uses for the browser UI, which
 *    the browser then replays automatically on same-origin fetches).
 *
 * When neither `FSOS_API_SECRET` nor `FSOS_ADMIN_PASSWORD` is configured the
 * gate is disabled (returns null) so local/dev and un-configured deployments
 * keep working — configuring either one turns protection on.
 */
export function requireInternalAuth(req: NextRequest): NextResponse | null {
  const apiSecret = process.env.FSOS_API_SECRET
  const adminUser = process.env.FSOS_ADMIN_USER
  const adminPass = process.env.FSOS_ADMIN_PASSWORD

  if (!apiSecret && !adminPass) return null // protection not configured

  const header = req.headers.get('authorization') || ''

  if (apiSecret && header === `Bearer ${apiSecret}`) return null

  if (adminPass && header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      const user = decoded.slice(0, idx)
      const pass = decoded.slice(idx + 1)
      if (pass === adminPass && (!adminUser || user === adminUser)) return null
    } catch {
      /* fall through to 401 */
    }
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Authorization header a server-to-server caller should send for internal routes. */
export function internalAuthHeader(): Record<string, string> {
  const apiSecret = process.env.FSOS_API_SECRET
  if (apiSecret) return { Authorization: `Bearer ${apiSecret}` }
  const user = process.env.FSOS_ADMIN_USER || 'admin'
  const pass = process.env.FSOS_ADMIN_PASSWORD
  if (pass) {
    return { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') }
  }
  return {}
}
