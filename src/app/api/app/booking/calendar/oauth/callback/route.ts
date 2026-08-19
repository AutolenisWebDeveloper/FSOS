// Native booking — Google Calendar OAuth callback (Slice 7). FSA-guarded. Verifies the
// signed CSRF state constant-time AND that it matches the httpOnly nonce cookie (double
// binding), exchanges the code for a READ-ONLY credential SERVER-SIDE, stores it ENCRYPTED
// via pgcrypto (booking_calendar_set_secret), and marks the connection connected. No token
// material is ever logged or returned to the browser. Every terminal outcome redirects back
// to /app/booking with a labeled, non-sensitive reason.

import { NextRequest, NextResponse } from 'next/server'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import {
  verifyState,
  calendarOAuthStateKey,
  serializeCredential,
  appBaseUrl,
  calendarRedirectUri,
  CALENDAR_OAUTH_NONCE_COOKIE,
} from '@/lib/booking/google/oauth'
import { completeCalendarOAuth } from '@/lib/booking/google/exchange'
import { upsertConnection, storeConnectionSecret, markConnectionStatus } from '@/lib/booking/google/connection'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function bookingRedirect(origin: string, params: Record<string, string>): NextResponse {
  const u = new URL('/app/booking', origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = NextResponse.redirect(u)
  res.cookies.set(CALENDAR_OAUTH_NONCE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const origin = appBaseUrl() || req.nextUrl.origin
  const params = req.nextUrl.searchParams
  if (params.get('error')) return bookingRedirect(origin, { calendar: 'denied' })

  const code = params.get('code')
  const stateTok = params.get('state')
  const nonce = req.cookies.get(CALENDAR_OAUTH_NONCE_COOKIE)?.value
  const state = stateTok ? verifyState(stateTok, calendarOAuthStateKey()) : null
  if (!code || !state || !nonce || nonce !== state.nonce) {
    return bookingRedirect(origin, { calendar: 'invalid_state' })
  }

  const redirectUri = calendarRedirectUri(origin)
  const actor = actorOf(auth.session)

  try {
    const conn = await completeCalendarOAuth({ code, redirectUri })

    const up = await upsertConnection(actor, actor, {
      accountEmail: conn.accountEmail,
      scopes: conn.scopes,
      tokenExpiresAt: conn.envelope.expiresAt ?? null,
    })
    if (!up.ok) {
      // eslint-disable-next-line no-console
      console.error('[booking/calendar/oauth/callback] upsertConnection failed:', up.message)
      return bookingRedirect(origin, { calendar: 'error' })
    }

    const stored = await storeConnectionSecret(up.data.id, serializeCredential(conn.envelope))
    if (!stored.ok) {
      // upsertConnection already marked the row 'connected'; a failed secret write would leave it
      // connected-with-no-credential. Roll the status back to 'error' so busy-sync and the settings
      // surface reflect that a reconnect is needed rather than showing a false "connected".
      // eslint-disable-next-line no-console
      console.error('[booking/calendar/oauth/callback] storeConnectionSecret failed:', stored.message)
      await markConnectionStatus(up.data.id, 'error', { lastError: 'secret_store_failed' })
      return bookingRedirect(origin, { calendar: 'error' })
    }

    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'booking_calendar_connection',
      entityId: up.data.id,
      diff: { event: 'calendar.connected' },
    })

    return bookingRedirect(origin, { calendar: 'connected' })
  } catch (e) {
    // Never surface provider internals to the browser (§16.1) — but DO log the real reason
    // server-side so a failed connect is diagnosable (e.g. redirect_uri_mismatch, invalid_grant)
    // instead of an opaque generic redirect. No token material is included.
    // eslint-disable-next-line no-console
    console.error('[booking/calendar/oauth/callback] connect failed:', e instanceof Error ? e.message : e)
    return bookingRedirect(origin, { calendar: 'error' })
  }
}
