// X (Twitter) adapter (ADR-026, Slice 7). Configured-but-INACTIVE: `active: false`,
// so it reports `not_configured` until the paid API is enabled (opt-in, gated behind
// config). The real publish path (POST /2/tweets) is implemented and credential-
// gated, dormant while inactive. No browser automation.

import { BaseSocialPublisher } from './base'
import type { ChannelContext, PlatformSupport, PublishInput, PublishResult, SocialPlatform } from './types'

const MAX_TWEET = 280

export class XPublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform = 'x'
  protected readonly support: PlatformSupport = {
    canPost: true,
    canReadEngagement: true,
    canReadAnalytics: true,
    active: false, // activate only when the paid X API is enabled
  }

  async publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    if (!this.isConfigured(channel) || !channel.accessToken) {
      return { ok: false, error: { code: 'not_configured', message: this.notConfiguredReason(channel), retryable: false } }
    }
    const text = [(input.body ?? '').trim(), input.link].filter(Boolean).join(' ').trim()
    if (!text) {
      return { ok: false, error: { code: 'invalid_content', message: 'A post needs text.', retryable: false } }
    }
    if (text.length > MAX_TWEET) {
      return { ok: false, error: { code: 'invalid_content', message: `Text exceeds ${MAX_TWEET} characters.`, retryable: false } }
    }
    try {
      const resp = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { authorization: `Bearer ${channel.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const json = (await resp.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string }
      if (!resp.ok || !json.data?.id) return { ok: false, error: this.normalizeHttp(resp.status, json.detail) }
      return { ok: true, platformPostId: json.data.id, raw: json }
    } catch (err) {
      return { ok: false, error: { code: 'network', message: err instanceof Error ? err.message : 'Network error', retryable: true } }
    }
  }

  private normalizeHttp(status: number, detail?: string) {
    const message = detail || `X error (${status}).`
    if (status === 401 || status === 403) return { code: 'auth' as const, message, retryable: false }
    if (status === 429) return { code: 'rate_limited' as const, message, retryable: true }
    if (status >= 500) return { code: 'platform_error' as const, message, retryable: true }
    return { code: 'platform_error' as const, message, retryable: false }
  }
}
