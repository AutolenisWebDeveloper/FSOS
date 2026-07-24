// Instagram adapter (ADR-026, Slice 7). Configured-but-INACTIVE: `active: false`,
// so it reports `not_configured` until API access is obtained (Business/Creator
// account linked to a Facebook Page + Graph API + app review). The real publish
// path (a two-step container → publish) is implemented and credential-gated, ready
// to activate; while inactive it never touches the network. No browser automation,
// no personal-account posting (there is no API for it).

import { BaseSocialPublisher } from './base'
import type { ChannelContext, PlatformSupport, PublishInput, PublishResult, SocialPlatform } from './types'

const GRAPH = 'https://graph.facebook.com/v21.0'

export class InstagramPublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform = 'instagram'
  protected readonly support: PlatformSupport = {
    canPost: true,
    canReadEngagement: true,
    canReadAnalytics: true,
    active: false, // activate only when Business account + app review are in place
  }

  async publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    if (!this.isConfigured(channel) || !channel.accessToken) {
      return { ok: false, error: { code: 'not_configured', message: this.notConfiguredReason(channel), retryable: false } }
    }
    const igUserId = channel.externalAccountId
    if (!igUserId) {
      return { ok: false, error: { code: 'unsupported', message: 'Instagram Business account id is required to publish.', retryable: false } }
    }
    const image = (input.mediaUrls ?? []).find(Boolean)
    if (!image) {
      return { ok: false, error: { code: 'invalid_content', message: 'Instagram requires an image to publish.', retryable: false } }
    }
    try {
      // 1. Create a media container.
      const c = new URLSearchParams({ image_url: image, caption: input.body ?? '', access_token: channel.accessToken })
      const created = await fetch(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: c })
      const cj = (await created.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
      if (!created.ok || !cj.id) return { ok: false, error: this.normalizeGraph(created.status, cj.error) }
      // 2. Publish the container.
      const p = new URLSearchParams({ creation_id: cj.id, access_token: channel.accessToken })
      const pub = await fetch(`${GRAPH}/${encodeURIComponent(igUserId)}/media_publish`, { method: 'POST', body: p })
      const pj = (await pub.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
      if (!pub.ok || !pj.id) return { ok: false, error: this.normalizeGraph(pub.status, pj.error) }
      return { ok: true, platformPostId: pj.id, raw: pj }
    } catch (err) {
      return { ok: false, error: { code: 'network', message: err instanceof Error ? err.message : 'Network error', retryable: true } }
    }
  }

  private normalizeGraph(status: number, error?: { message?: string }) {
    const message = error?.message || `Instagram error (${status}).`
    if (status === 401 || status === 403) return { code: 'auth' as const, message, retryable: false, raw: error }
    if (status === 429) return { code: 'rate_limited' as const, message, retryable: true, raw: error }
    if (status >= 500) return { code: 'platform_error' as const, message, retryable: true, raw: error }
    return { code: 'platform_error' as const, message, retryable: false, raw: error }
  }
}
