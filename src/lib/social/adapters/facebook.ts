// Facebook Page adapter (ADR-026, Slice 4). The second ACTIVE publisher — a
// differently-shaped API than YouTube, which proves the adapter abstraction: a
// Facebook Page post is a simple Graph API feed publish (message + optional link),
// not a resumable video upload.
//
// Real but CREDENTIAL-GATED: with no connected Page (no decrypted accessToken) the
// base class short-circuits to `not_configured` and never touches the network —
// exactly the state in any environment without a Meta app + Page token (CI, tests,
// previews). Personal profiles are not supported (no API); browser automation is
// never used.

import { BaseSocialPublisher } from './base'
import type { ChannelContext, PlatformSupport, PublishInput, PublishResult, SocialPlatform } from './types'

const GRAPH_VERSION = 'v21.0'

export class FacebookPagePublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform = 'facebook_page'
  protected readonly support: PlatformSupport = {
    canPost: true,
    canReadEngagement: true,
    canReadAnalytics: true,
    active: true,
  }

  async publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    // Not configured / no credential → deterministic inert result (no network).
    if (!this.isConfigured(channel) || !channel.accessToken) {
      return { ok: false, error: { code: 'not_configured', message: this.notConfiguredReason(channel), retryable: false } }
    }
    // A Page post targets a specific Page id (the channel's external account id).
    const pageId = channel.externalAccountId
    if (!pageId) {
      return {
        ok: false,
        error: { code: 'unsupported', message: 'Facebook Page id (account) is required to publish.', retryable: false },
      }
    }
    // A feed post needs a message or a link. Empty content is terminal, not retryable.
    const message = (input.body ?? '').trim()
    if (!message && !input.link) {
      return {
        ok: false,
        error: { code: 'invalid_content', message: 'A Facebook post needs a message or a link.', retryable: false },
      }
    }

    try {
      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/feed`
      const body = new URLSearchParams()
      if (message) body.set('message', message)
      if (input.link) body.set('link', input.link)
      body.set('access_token', channel.accessToken)

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      const json = (await resp.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } }
      if (!resp.ok || json.error) {
        return { ok: false, error: this.normalizeGraph(resp.status, json.error) }
      }
      if (!json.id) {
        return { ok: false, error: { code: 'platform_error', message: 'Post accepted but no id returned.', retryable: true } }
      }
      return { ok: true, platformPostId: json.id, raw: json }
    } catch (err) {
      return { ok: false, error: { code: 'network', message: err instanceof Error ? err.message : 'Network error', retryable: true } }
    }
  }

  private normalizeGraph(status: number, error?: { message?: string; code?: number }) {
    const message = error?.message || `Facebook error (${status}).`
    if (status === 401 || status === 403 || error?.code === 190) {
      return { code: 'auth' as const, message, retryable: false, raw: error }
    }
    if (status === 429 || error?.code === 4 || error?.code === 32 || error?.code === 613) {
      return { code: 'rate_limited' as const, message, retryable: true, raw: error }
    }
    if (status >= 500) return { code: 'platform_error' as const, message, retryable: true, raw: error }
    return { code: 'platform_error' as const, message, retryable: false, raw: error }
  }
}
