// Adapter registry (ADR-025). Single lookup keyed by platform; the rest of the
// module never instantiates an adapter directly.

import { SOCIAL_ADAPTERS, PLATFORM_SUPPORT } from './platforms'
import type { ChannelContext, PublisherCapabilities, SocialPlatform, SocialPublisher } from './types'

export * from './types'
export { BaseSocialPublisher } from './base'
export { PLATFORM_SUPPORT } from './platforms'

// Static API support for a platform (what it can do once activated), for UI rosters.
export function platformSupport(platform: SocialPlatform) {
  return PLATFORM_SUPPORT[platform]
}

export function getAdapter(platform: SocialPlatform): SocialPublisher {
  return SOCIAL_ADAPTERS[platform]
}

// Capability report for a channel; falls back to a fully-unconfigured report for
// an unknown platform rather than throwing (defensive against bad data).
export function capabilitiesFor(channel: ChannelContext): PublisherCapabilities {
  const adapter = SOCIAL_ADAPTERS[channel.platform]
  if (!adapter) {
    return {
      platform: channel.platform,
      configured: false,
      canPost: false,
      canReadEngagement: false,
      canReadAnalytics: false,
      reason: `Unknown platform: ${channel.platform}`,
    }
  }
  return adapter.capabilities(channel)
}
