// Per-platform adapters + the single source of truth for platform API support
// (ADR-026).
//
// Slice 1 ships the interface and the registry with every adapter
// configured-but-INACTIVE (`active: false`) — there is no publishing yet
// (build instruction §2.14 slice 1). Each platform declares its STATIC API support
// (what the official API allows when activated) — the platform-API reality:
//   • YouTube — full API (activated in slice 3).
//   • Facebook Page — Graph API + app review (activated in slice 4).
//   • Instagram — Business/Creator + linked Page + Graph API (slice 7).
//   • LinkedIn Company Page — Marketing Developer Platform, approval-gated (slice 7).
//   • X — paid API, opt-in/gated (slice 7).
//   • TikTok — limited Content Posting API, approval-gated; no engagement API.
// LinkedIn PERSONAL profiles and personal-account posting are absent by design —
// no API path exists and browser automation is prohibited.

import { BaseSocialPublisher } from './base'
import { YouTubePublisher } from './youtube'
import type { PlatformSupport, SocialPlatform } from './types'

export const PLATFORM_SUPPORT: Record<SocialPlatform, PlatformSupport> = {
  youtube: { canPost: true, canReadEngagement: true, canReadAnalytics: true, active: true }, // slice 3 — ACTIVE
  facebook_page: { canPost: true, canReadEngagement: true, canReadAnalytics: true, active: false }, // slice 4
  instagram: { canPost: true, canReadEngagement: true, canReadAnalytics: true, active: false }, // slice 7
  linkedin_company: { canPost: true, canReadEngagement: true, canReadAnalytics: true, active: false }, // slice 7
  x: { canPost: true, canReadEngagement: true, canReadAnalytics: true, active: false }, // slice 7
  tiktok: { canPost: true, canReadEngagement: false, canReadAnalytics: true, active: false }, // future
}

class PlatformPublisher extends BaseSocialPublisher {
  readonly platform: SocialPlatform
  protected readonly support: PlatformSupport
  constructor(platform: SocialPlatform) {
    super()
    this.platform = platform
    this.support = PLATFORM_SUPPORT[platform]
  }
}

export const SOCIAL_ADAPTERS: Record<SocialPlatform, BaseSocialPublisher> = {
  youtube: new YouTubePublisher(),
  facebook_page: new PlatformPublisher('facebook_page'),
  instagram: new PlatformPublisher('instagram'),
  linkedin_company: new PlatformPublisher('linkedin_company'),
  x: new PlatformPublisher('x'),
  tiktok: new PlatformPublisher('tiktok'),
}
