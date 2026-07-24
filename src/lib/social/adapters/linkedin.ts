// LinkedIn Company Page adapter (ADR-026, Slice 7). Configured-but-INACTIVE:
// `active: false`, so it reports `not_configured` until Marketing Developer Platform
// access is approved. COMPANY PAGES ONLY — personal-profile posting has no API and
// is never attempted; browser automation is prohibited. The real publish path
// (a /rest/posts share authored by the organization URN) is implemented and
// credential-gated, dormant while inactive.

import { BaseSocialPublisher } from './base'
import type { ChannelContext, PlatformSupport, PublishInput, PublishResult, SocialPlatform } from './types'

export class LinkedInCompanyPublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform = 'linkedin_company'
  protected readonly support: PlatformSupport = {
    canPost: true,
    canReadEngagement: true,
    canReadAnalytics: true,
    active: false, // activate only when Marketing Developer Platform access is granted
  }

  async publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    if (!this.isConfigured(channel) || !channel.accessToken) {
      return { ok: false, error: { code: 'not_configured', message: this.notConfiguredReason(channel), retryable: false } }
    }
    // externalAccountId is the organization id → URN urn:li:organization:{id}.
    const orgId = channel.externalAccountId
    if (!orgId) {
      return { ok: false, error: { code: 'unsupported', message: 'LinkedIn Company Page (organization) id is required. Personal profiles are not supported.', retryable: false } }
    }
    const commentary = (input.body ?? '').trim()
    if (!commentary) {
      return { ok: false, error: { code: 'invalid_content', message: 'A LinkedIn post needs text.', retryable: false } }
    }
    try {
      const resp = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${channel.accessToken}`,
          'content-type': 'application/json',
          'linkedin-version': '202401',
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({
          author: `urn:li:organization:${orgId}`,
          commentary,
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
        }),
      })
      if (!resp.ok) return { ok: false, error: this.normalizeHttp(resp.status) }
      // LinkedIn returns the created post id in the x-restli-id header.
      const postId = resp.headers.get('x-restli-id') || ''
      if (!postId) return { ok: false, error: { code: 'platform_error', message: 'Post accepted but no id returned.', retryable: true } }
      return { ok: true, platformPostId: postId }
    } catch (err) {
      return { ok: false, error: { code: 'network', message: err instanceof Error ? err.message : 'Network error', retryable: true } }
    }
  }

  private normalizeHttp(status: number) {
    if (status === 401 || status === 403) return { code: 'auth' as const, message: `LinkedIn auth failed (${status}).`, retryable: false }
    if (status === 429) return { code: 'rate_limited' as const, message: 'LinkedIn rate limit.', retryable: true }
    if (status >= 500) return { code: 'platform_error' as const, message: `LinkedIn server error (${status}).`, retryable: true }
    return { code: 'platform_error' as const, message: `LinkedIn error (${status}).`, retryable: false }
  }
}
