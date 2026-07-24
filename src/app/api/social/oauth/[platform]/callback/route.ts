// Social OAuth — callback (ADR-026). Session-guarded. Verifies the signed CSRF
// `state` constant-time AND that it matches the httpOnly nonce cookie (double
// binding), exchanges the code for a credential SERVER-SIDE, stores it ENCRYPTED
// via pgcrypto (social_channel_set_secret), and marks the channel connected. No
// token material is ever logged or returned to the browser. Every terminal outcome
// redirects back to /app/social/accounts with a labeled, non-sensitive reason.

import { NextRequest, NextResponse } from 'next/server'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import {
  isOAuthPlatform,
  verifyState,
  socialOAuthStateKey,
  serializeCredential,
  appBaseUrl,
  oauthRedirectUri,
  SOCIAL_OAUTH_NONCE_COOKIE,
} from '@/lib/social/oauth'
import { completeOAuth } from '@/lib/social/oauth-exchange'
import { upsertConnectedChannel, storeChannelSecret } from '@/lib/social/channels'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function accountsRedirect(origin: string, params: Record<string, string>): NextResponse {
  const u = new URL('/app/social/accounts', origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = NextResponse.redirect(u)
  // Always clear the one-time nonce on any terminal path.
  res.cookies.set(SOCIAL_OAUTH_NONCE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
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

  const params = req.nextUrl.searchParams
  if (params.get('error')) {
    // The user denied consent or the provider rejected the request.
    return accountsRedirect(origin, { connect: 'denied', platform })
  }

  const code = params.get('code')
  const stateTok = params.get('state')
  const nonce = req.cookies.get(SOCIAL_OAUTH_NONCE_COOKIE)?.value
  const state = stateTok ? verifyState(stateTok, socialOAuthStateKey()) : null

  if (!code || !state || state.platform !== platform || !nonce || nonce !== state.nonce) {
    return accountsRedirect(origin, { connect: 'invalid_state', platform })
  }

  const redirectUri = oauthRedirectUri(platform, origin)
  const actor = actorOf(auth.session)

  try {
    const conn = await completeOAuth(platform, { code, redirectUri })

    const up = await upsertConnectedChannel(
      {
        platform,
        externalAccountId: conn.externalAccountId,
        displayName: conn.displayName,
        scopes: conn.scopes,
        tokenExpiresAt: conn.envelope.expiresAt ?? null,
      },
      actor,
    )
    if (!up.ok) return accountsRedirect(origin, { connect: 'error', platform })

    const stored = await storeChannelSecret(up.data.id, serializeCredential(conn.envelope))
    if (!stored.ok) return accountsRedirect(origin, { connect: 'error', platform })

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_channel',
      entityId: up.data.id,
      diff: { event: 'social.oauth.connected', platform },
    })

    return accountsRedirect(origin, { connected: platform })
  } catch {
    // Never surface provider internals to the browser (build instruction §16.1).
    return accountsRedirect(origin, { connect: 'error', platform })
  }
}
