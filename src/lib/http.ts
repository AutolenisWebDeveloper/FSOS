// src/lib/http.ts
// Shared helpers for API route handlers: safe numeric parsing, request-body
// size guards, HTML escaping, and internal-endpoint authorization.

import { NextRequest, NextResponse } from 'next/server'
import { ConfigError } from '@/lib/supabase/client'
import { unconfiguredInternalAuthAllowed } from '@/lib/auth/config-gate'

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
 * Client-safe response for an internal/DB error. The real detail is LOGGED
 * server-side (never returned to the client, §16.1 — no SQL/RLS/schema strings in
 * responses) and the client gets a generic message. Use for raw DB errors and the
 * `kind:'error'` branch of a service result.
 */
export function internalErrorResponse(detail: unknown, opts: { status?: number; label?: string } = {}): NextResponse {
  // eslint-disable-next-line no-console
  console.error(`[api]${opts.label ? ' ' + opts.label + ':' : ''}`, detail instanceof Error ? detail.message : detail)
  return NextResponse.json({ error: 'A server error occurred. Please try again.' }, { status: opts.status ?? 500 })
}

/**
 * Map a failed service result (`StoreResult`-style: `{ kind, message }`) to a
 * client-safe response. `not_found` and `invalid_transition` messages are
 * app-authored (safe to show); `error` is a DB/internal failure → generic + logged.
 */
export function storeErrorResponse(res: { kind: 'not_found' | 'invalid_transition' | 'error'; message: string }, label?: string): NextResponse {
  if (res.kind === 'not_found') return NextResponse.json({ error: res.message }, { status: 404 })
  if (res.kind === 'invalid_transition') return NextResponse.json({ error: res.message }, { status: 409 })
  return internalErrorResponse(res.message, { label })
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
 * gate fails CLOSED in production (a misconfigured deploy denies rather than
 * exposing internal routes / client PII); local/dev still runs without secrets,
 * and an explicit `ALLOW_INSECURE_LOCAL=1` opt-out exists — see config-gate.ts.
 */
export function requireInternalAuth(req: NextRequest): NextResponse | null {
  const apiSecret = process.env.FSOS_API_SECRET
  const adminUser = process.env.FSOS_ADMIN_USER
  const adminPass = process.env.FSOS_ADMIN_PASSWORD

  if (!apiSecret && !adminPass) {
    // No credential configured: allow only outside production (or explicit opt-out).
    return unconfiguredInternalAuthAllowed()
      ? null
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

/** Best-effort identity of the operator behind an internal request, for audit fields. */
export function callerLabel(req: NextRequest): string {
  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const user = decoded.slice(0, decoded.indexOf(':'))
      if (user) return user
    } catch {
      /* ignore */
    }
  }
  if (header.startsWith('Bearer ')) return 'api'
  return 'internal'
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
