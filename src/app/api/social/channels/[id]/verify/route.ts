// Social channel — connection health check (ADR-026). Session-guarded. Decrypts the
// stored credential SERVER-SIDE, silently refreshes it when the provider supports
// that (YouTube), pings the provider to confirm the token still authenticates, and
// records the health (status / last_verified_at / last_error) on the channel. The
// response is the SAFE channel view only — never any token material.

import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import {
  isOAuthPlatform,
  parseCredential,
  serializeCredential,
  credentialNeedsRefresh,
  providerConfig,
} from '@/lib/social/oauth'
import { refreshCredential, verifyIdentity } from '@/lib/social/oauth-exchange'
import { readChannelSecretContext, storeChannelSecret, markChannelHealth } from '@/lib/social/channels'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params
  const actor = actorOf(auth.session)

  try {
    const ctx = await readChannelSecretContext(id)
    if (!ctx.ok) {
      const status = ctx.kind === 'not_found' ? 404 : 500
      return NextResponse.json({ error: ctx.message }, { status })
    }
    const { platform, externalAccountId } = ctx.data

    if (!isOAuthPlatform(platform)) {
      return NextResponse.json({ error: 'Health checks are only available for connected OAuth accounts.' }, { status: 400 })
    }

    let envelope = parseCredential(ctx.data.secret)
    if (!envelope) {
      const marked = await markChannelHealth(id, { status: 'error', lastError: 'No credential is stored — reconnect the account.' }, actor)
      return NextResponse.json({ channel: marked.ok ? marked.data : null, healthy: false }, { status: 200 })
    }

    // Silently refresh an expiring credential when the provider allows it.
    const cfg = providerConfig(platform)
    if (cfg.supportsRefresh && credentialNeedsRefresh(envelope)) {
      const refreshed = await refreshCredential(platform, envelope)
      if (refreshed) {
        const stored = await storeChannelSecret(id, serializeCredential(refreshed))
        if (stored.ok) envelope = refreshed
      }
    }

    const health = await verifyIdentity(platform, envelope, externalAccountId)
    const marked = await markChannelHealth(
      id,
      health.ok
        ? { status: 'connected', lastError: null, displayName: health.displayName ?? undefined, tokenExpiresAt: envelope.expiresAt ?? undefined }
        : { status: 'error', lastError: health.error ?? 'Health check failed' },
      actor,
    )
    if (!marked.ok) return NextResponse.json({ error: marked.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_channel',
      entityId: id,
      diff: { event: 'social.channel.health_checked', platform, healthy: health.ok },
    })

    return NextResponse.json({ channel: marked.data, healthy: health.ok }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to verify channel' }, { status: 500 })
  }
}
