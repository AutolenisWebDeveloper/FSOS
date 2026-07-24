// Social brand voice + mandatory disclaimer (ADR-026, item 6). Grounds the Content
// Drafter's tone in the Farmers-brand voice (farmers-brand-website skill + CLAUDE.md
// §17.3: trust, professionalism, financial expertise, stability, simplicity) and the
// AI red-line (§4.2: educate and invite, never recommend). The disclaimer text is the
// canonical FINRA_DISCLAIMER — this module never invents new compliance copy, it only
// selects a platform-appropriate rendering. Relative imports so the offline gate
// tests compile with plain tsc.

import { FINRA_DISCLAIMER } from '../compliance'
import type { SocialPlatform } from './adapters/types'

// Brand-voice principles injected into the drafter system prompt. Derived from the
// farmers-brand-website skill + CLAUDE.md §17.3 / §4.2 — not invented per call.
export const SOCIAL_BRAND_VOICE: string[] = [
  'Voice: a licensed Farmers Financial Services professional — trustworthy, clear, calm, and credible. Financial expertise without jargon; stability and simplicity over hype.',
  'Educate and invite; never sell or steer. No pressure, no urgency tactics, no superlatives or guarantees.',
  'Speak to the reader plainly (“you”), keep it concise, and end with a soft, non-securities invitation (learn more / start a conversation / review your coverage) — never a product or securities call to action.',
]

// X is character-constrained (280); a short disclaimer keeps posts within budget while
// preserving the educational-only + licensed-review meaning. Everything else carries
// the full canonical FINRA disclaimer.
const X_SHORT_DISCLAIMER = 'Educational only — not advice. Licensed FSA review required.'

export function disclaimerFor(platform: SocialPlatform): string {
  return platform === 'x' ? X_SHORT_DISCLAIMER : FINRA_DISCLAIMER
}

// Detects an already-present educational disclaimer so we never double-stamp it.
export function hasDisclaimer(body: string): boolean {
  const b = (body || '').toLowerCase()
  if (!b.includes('educational')) return false
  return (
    b.includes('not advice') ||
    b.includes('not a product recommendation') ||
    b.includes('reg bi') ||
    b.includes('not a recommendation')
  )
}

// Appends the platform-appropriate disclaimer unless the body already carries one.
export function ensureDisclaimer(body: string, platform: SocialPlatform): string {
  const trimmed = (body || '').trim()
  if (hasDisclaimer(trimmed)) return trimmed
  return `${trimmed}\n\n${disclaimerFor(platform)}`
}
