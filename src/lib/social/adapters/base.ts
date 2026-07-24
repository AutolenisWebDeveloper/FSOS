// Base adapter behavior shared by every platform (ADR-026).
//
// Encapsulates the two invariants every adapter must honor:
//   1. Capability discovery reflects BOTH the platform's static API support AND
//      whether this specific channel currently holds a usable credential.
//   2. An unconfigured or inactive adapter returns a deterministic `not_configured`
//      publish result WITHOUT ever touching a live API.

import type {
  ChannelContext,
  NormalizedError,
  PlatformSupport,
  PublishInput,
  PublishResult,
  PublisherCapabilities,
  SocialPlatform,
  SocialPublisher,
} from './types'

export abstract class BaseSocialPublisher implements SocialPublisher {
  abstract readonly platform: SocialPlatform
  protected abstract readonly support: PlatformSupport

  capabilities(channel: ChannelContext): PublisherCapabilities {
    const configured = this.isConfigured(channel)
    return {
      platform: this.platform,
      configured,
      canPost: configured && this.support.canPost,
      canReadEngagement: configured && this.support.canReadEngagement,
      canReadAnalytics: configured && this.support.canReadAnalytics,
      reason: configured ? undefined : this.notConfiguredReason(channel),
    }
  }

  // Configured == the adapter is active in this build AND the channel holds a
  // usable, unexpired credential.
  protected isConfigured(channel: ChannelContext): boolean {
    return this.support.active && !!channel.hasCredential && !this.isExpired(channel)
  }

  protected isExpired(channel: ChannelContext): boolean {
    if (!channel.tokenExpiresAt) return false
    const t = Date.parse(channel.tokenExpiresAt)
    return Number.isFinite(t) && t <= Date.now()
  }

  protected notConfiguredReason(channel: ChannelContext): string {
    if (!this.support.active) return `${this.platform} adapter is not yet activated for this build`
    if (!channel.hasCredential) return `${this.platform} account is not connected`
    if (this.isExpired(channel)) return `${this.platform} credential has expired — reconnect the account`
    return `${this.platform} is not configured`
  }

  // Default publish: safe, inert, deterministic. Active adapters override this.
  // An inactive/unconfigured adapter NEVER reaches a live API here.
  async publish(_input: PublishInput, channel: ChannelContext): Promise<PublishResult> {
    return {
      ok: false,
      error: {
        code: 'not_configured',
        message: this.notConfiguredReason(channel),
        retryable: false,
      },
    }
  }

  normalizeError(err: unknown): NormalizedError {
    if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
      const code = (err as { code: string }).code
      const known = ['not_configured', 'auth', 'rate_limited', 'invalid_content', 'platform_error', 'network', 'unsupported']
      if (known.includes(code)) {
        return {
          code: code as NormalizedError['code'],
          message: String((err as { message?: unknown }).message ?? code),
          retryable: code === 'rate_limited' || code === 'network',
          raw: err,
        }
      }
    }
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown platform error'
    return { code: 'platform_error', message, retryable: false, raw: err }
  }
}
