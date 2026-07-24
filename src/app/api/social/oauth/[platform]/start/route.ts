// Social OAuth — initiate (ADR-026). Session-guarded. Builds the provider authorize
// URL with a signed, expiring CSRF `state`, binds it to an httpOnly nonce cookie,
// and redirects the FSA to the provider. When the platform's OAuth is not configured
// for this environment it redirects back with a labeled reason (build instruction
// §4.3 — no invented integration; degrade, never crash).

import { NextRequest, NextResponse } from 'next/server'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import {
  isOAuthPlatform,
  providerConfig,
  buildAuthorizeUrl,
  signState,
  newNonce,
  socialOAuthStateKey,
  appBaseUrl,
  oauthRedirectUri,
  SOCIAL_OAUTH_NONCE_COOKIE,
} from '@/lib/social/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATE_TTL_MS = 10 * 60_000

function accountsRedirect(origin: string, params: Record<string, string>): NextResponse {
  const u = new URL('/app/social/accounts', origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return NextResponse.redirect(u)
}

export async function GET(req: NextRequest, props: { params: Promise<{ platform: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const { platform } = await props.params
  const origin = appBaseUrl() || req.nextUrl.origin

  if (!isOAuthPlatform(platform)) {
    return accountsRedirect(origin, { connect: 'unsupported', platform })
  }

  const cfg = providerConfig(platform)
  if (!cfg.configured) {
    return accountsRedirect(origin, { connect: 'not_configured', platform })
  }

  const nonce = newNonce()
  const state = signState({ platform, nonce, exp: Date.now() + STATE_TTL_MS }, socialOAuthStateKey())
  const redirectUri = oauthRedirectUri(platform, origin)
  const authorizeUrl = buildAuthorizeUrl({ config: cfg, redirectUri, state })

  await writeAudit({
    actor: actorOf(auth.session),
    action: 'entity.updated',
    entity: 'social_channel',
    entityId: platform,
    diff: { event: 'social.oauth.initiated', platform },
  })

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set(SOCIAL_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_MS / 1000,
  })
  return res
}
