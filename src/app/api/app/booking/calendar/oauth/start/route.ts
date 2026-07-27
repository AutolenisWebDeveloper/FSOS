// Native booking — Google Calendar OAuth initiate (Slice 7). FSA-guarded. Builds the
// Google authorize URL (scope: calendar.readonly ONLY) with a signed, expiring CSRF state
// bound to an httpOnly nonce cookie, and redirects the FSA to Google. When the OAuth client
// is not configured for this environment it redirects back with a labeled reason (§4.3 — no
// invented integration; degrade, never crash).

import { NextRequest, NextResponse } from 'next/server'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import {
  calendarProviderConfig,
  buildAuthorizeUrl,
  signState,
  newNonce,
  calendarOAuthStateKey,
  appBaseUrl,
  calendarRedirectUri,
  CALENDAR_OAUTH_NONCE_COOKIE,
} from '@/lib/booking/google/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATE_TTL_MS = 10 * 60_000

function bookingRedirect(origin: string, params: Record<string, string>): NextResponse {
  const u = new URL('/app/booking', origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return NextResponse.redirect(u)
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const origin = appBaseUrl() || req.nextUrl.origin
  const cfg = calendarProviderConfig()
  if (!cfg.configured) return bookingRedirect(origin, { calendar: 'not_configured' })

  const nonce = newNonce()
  const state = signState({ kind: 'booking_calendar', nonce, exp: Date.now() + STATE_TTL_MS }, calendarOAuthStateKey())
  const redirectUri = calendarRedirectUri(origin)
  const authorizeUrl = buildAuthorizeUrl({ config: cfg, redirectUri, state })

  await writeAudit({
    actor: actorOf(auth.session),
    action: 'config.changed',
    entity: 'booking_calendar_connection',
    entityId: null,
    diff: { event: 'calendar.oauth.initiated' },
  })

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set(CALENDAR_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_MS / 1000,
  })
  return res
}
