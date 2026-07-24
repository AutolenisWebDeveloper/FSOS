// Social publishing adapter contract (ADR-026).
//
// Every platform implements `SocialPublisher`. Platforms are added behind this
// interface as API access is obtained. An adapter WITHOUT valid credentials returns
// a deterministic `not_configured` state — it never calls a live API and never
// crashes. Browser automation is prohibited: an adapter with no supported API
// reports capabilities with `canPost:false` (manual-publish fallback), never a
// scripted browser session.

export type SocialPlatform =
  | 'youtube'
  | 'facebook_page'
  | 'instagram'
  | 'linkedin_company'
  | 'x'
  | 'tiktok'

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'youtube',
  'facebook_page',
  'instagram',
  'linkedin_company',
  'x',
  'tiktok',
] as const

// What a platform's official API supports at all (the platform-API reality from
// ADR-026), independent of whether a given channel is connected. LinkedIn personal
// and personal-account posting are intentionally absent — there is no API path and
// browser automation is prohibited.
export interface PlatformSupport {
  // The API permits programmatic posting for this account type.
  canPost: boolean
  // The API exposes inbound engagement (comments/mentions/messages).
  canReadEngagement: boolean
  // The API exposes analytics/metrics.
  canReadAnalytics: boolean
  // Whether this adapter is expected to be wired in the current build; when false
  // it is configured-but-inactive and always reports not_configured.
  active: boolean
}

// The runtime capability report for a specific channel (SocialPublisher.capabilities()).
export interface PublisherCapabilities {
  platform: SocialPlatform
  // The channel has valid credentials AND the adapter is active.
  configured: boolean
  canPost: boolean
  canReadEngagement: boolean
  canReadAnalytics: boolean
  // Human-readable reason when not configured (surfaced in the UI).
  reason?: string
}

// The minimal channel view an adapter needs. For capability discovery, token
// MATERIAL never travels here — only whether a usable credential is present. For
// the PUBLISH path, the server-side publisher decrypts the OAuth secret and passes
// it as `accessToken`; it is populated only in-process on the server, is never
// logged, and is never serialized into any client-facing shape.
export interface ChannelContext {
  platform: SocialPlatform
  externalAccountId?: string | null
  // True when the server-side secret store holds a usable, unexpired credential.
  hasCredential: boolean
  tokenExpiresAt?: string | null
  // SERVER-ONLY, publish path only. Decrypted per-call by the publisher, never
  // persisted here, never sent to the browser, never logged.
  accessToken?: string
}

export interface PublishInput {
  title?: string
  body: string
  mediaUrls?: string[]
  link?: string
}

export type NormalizedErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'invalid_content'
  | 'platform_error'
  | 'network'
  | 'unsupported'

// Every platform error normalizes to this common shape (ADR-026 error normalization).
export interface NormalizedError {
  code: NormalizedErrorCode
  message: string
  retryable: boolean
  raw?: unknown
}

export type PublishResult =
  | { ok: true; platformPostId: string; raw?: unknown }
  | { ok: false; error: NormalizedError }

export interface SocialPublisher {
  readonly platform: SocialPlatform
  // Capability discovery — never performs a network call.
  capabilities(channel: ChannelContext): PublisherCapabilities
  // Publish an already-APPROVED content version. An unconfigured/inactive adapter
  // resolves to { ok:false, error:{ code:'not_configured', retryable:false } }
  // WITHOUT calling any live API.
  publish(input: PublishInput, channel: ChannelContext): Promise<PublishResult>
  // Map an arbitrary thrown platform error to the normalized shape.
  normalizeError(err: unknown): NormalizedError
}
