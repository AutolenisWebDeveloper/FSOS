// Social media asset validation (ADR-026, operational depth item 2). PURE + offline-
// testable. Encodes per-platform format/size/dimension rules so the SAME logic gates
// the upload API and drives the "which platforms can use this asset" compatibility
// shown in the library. All numeric limits are CONFIG DEFAULTS (§4.3) — editable, not
// invented platform facts. Relative imports so the offline gate tests compile.

import { SOCIAL_PLATFORMS, type SocialPlatform } from './adapters/types'

export type MediaKind = 'image' | 'video'

export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/quicktime'] as const

// Absolute ceilings enforced at the API regardless of platform (config defaults).
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024 // 300 MB

export interface MediaSpec {
  kind: MediaKind
  mime: string
  byteSize: number
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
}

interface FormatRule {
  mimes: readonly string[]
  maxBytes: number
  minWidth?: number
  minHeight?: number
  maxDurationSeconds?: number
}

interface PlatformMediaRule {
  image?: FormatRule
  video?: FormatRule
}

// Per-platform rules (CONFIG DEFAULTS — verify against current platform docs). A
// platform absent a `video` rule cannot take a video asset, and vice-versa.
export const PLATFORM_MEDIA_RULES: Record<SocialPlatform, PlatformMediaRule> = {
  // YouTube publishes VIDEO; images are only thumbnails.
  youtube: {
    image: { mimes: ['image/png', 'image/jpeg'], maxBytes: 2 * 1024 * 1024, minWidth: 640, minHeight: 360 },
    video: { mimes: ['video/mp4', 'video/quicktime'], maxBytes: MAX_VIDEO_BYTES, maxDurationSeconds: 43200 },
  },
  facebook_page: {
    image: { mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 8 * 1024 * 1024, minWidth: 200, minHeight: 200 },
    video: { mimes: ['video/mp4', 'video/quicktime'], maxBytes: MAX_VIDEO_BYTES, maxDurationSeconds: 14400 },
  },
  instagram: {
    image: { mimes: ['image/png', 'image/jpeg'], maxBytes: 8 * 1024 * 1024, minWidth: 320, minHeight: 320 },
    video: { mimes: ['video/mp4'], maxBytes: 100 * 1024 * 1024, maxDurationSeconds: 3600 },
  },
  linkedin_company: {
    image: { mimes: ['image/png', 'image/jpeg'], maxBytes: 8 * 1024 * 1024, minWidth: 200, minHeight: 200 },
    video: { mimes: ['video/mp4'], maxBytes: MAX_VIDEO_BYTES, maxDurationSeconds: 1800 },
  },
  x: {
    image: { mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024, minWidth: 4, minHeight: 4 },
    video: { mimes: ['video/mp4'], maxBytes: 512 * 1024 * 1024, maxDurationSeconds: 140 },
  },
  tiktok: {
    video: { mimes: ['video/mp4', 'video/quicktime'], maxBytes: MAX_VIDEO_BYTES, maxDurationSeconds: 600 },
  },
}

export interface ValidationResult {
  ok: boolean
  issues: string[]
}

/** Baseline validity (independent of platform): a supported mime for its kind and
 *  within the absolute size ceiling. Gates every upload. */
export function validateAsset(spec: MediaSpec): ValidationResult {
  const issues: string[] = []
  if (spec.kind === 'image') {
    if (!ALLOWED_IMAGE_MIME.includes(spec.mime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      issues.push(`Unsupported image type ${spec.mime || '(unknown)'} — use PNG, JPEG, or WebP.`)
    }
    if (spec.byteSize > MAX_IMAGE_BYTES) issues.push(`Image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB limit.`)
  } else if (spec.kind === 'video') {
    if (!ALLOWED_VIDEO_MIME.includes(spec.mime as (typeof ALLOWED_VIDEO_MIME)[number])) {
      issues.push(`Unsupported video type ${spec.mime || '(unknown)'} — use MP4 or MOV.`)
    }
    if (spec.byteSize > MAX_VIDEO_BYTES) issues.push(`Video exceeds the ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB limit.`)
  } else {
    issues.push('Unknown media kind.')
  }
  if (spec.byteSize <= 0) issues.push('File is empty.')
  return { ok: issues.length === 0, issues }
}

/** Whether an asset satisfies a specific platform's rule for its kind. */
export function validateAssetForPlatform(spec: MediaSpec, platform: SocialPlatform): ValidationResult {
  const issues: string[] = []
  const rule = PLATFORM_MEDIA_RULES[platform]?.[spec.kind]
  if (!rule) {
    return { ok: false, issues: [`${platform} does not accept ${spec.kind} assets.`] }
  }
  if (!rule.mimes.includes(spec.mime)) issues.push(`${spec.mime || '(unknown)'} is not accepted for ${spec.kind} on ${platform}.`)
  if (spec.byteSize > rule.maxBytes) issues.push(`Exceeds ${platform}'s ${Math.round(rule.maxBytes / 1024 / 1024)}MB ${spec.kind} limit.`)
  if (rule.minWidth && spec.width != null && spec.width < rule.minWidth) issues.push(`Width ${spec.width}px is below ${platform}'s ${rule.minWidth}px minimum.`)
  if (rule.minHeight && spec.height != null && spec.height < rule.minHeight) issues.push(`Height ${spec.height}px is below ${platform}'s ${rule.minHeight}px minimum.`)
  if (rule.maxDurationSeconds && spec.durationSeconds != null && spec.durationSeconds > rule.maxDurationSeconds) {
    issues.push(`Duration ${Math.round(spec.durationSeconds)}s exceeds ${platform}'s ${rule.maxDurationSeconds}s limit.`)
  }
  return { ok: issues.length === 0, issues }
}

/** Platforms this asset is valid to publish on — drives the library's compat chips. */
export function platformCompatibility(spec: MediaSpec): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((p) => validateAssetForPlatform(spec, p).ok)
}

export function mediaKindForMime(mime: string): MediaKind | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return 'image'
  if ((ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)) return 'video'
  return null
}
