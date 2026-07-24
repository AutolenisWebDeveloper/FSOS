// Securities / claims pre-check gate (ADR-026, item 6). A draft may NOT move to
// IN_REVIEW until it passes this gate — the guardrails are enforced in code at the
// transition, not merely surfaced in the UI. Reuses the canonical firewall (§4.1)
// and AI red-line (§4.2) checks — it does not clone them. Pure + relative imports so
// the offline gate tests compile with plain tsc; the service layer calls it inside
// submitForReview and the route returns the issues.

import { findForbiddenSecuritiesFields } from '../compliance/firewall'
import { containsRecommendationLanguage } from '../compliance/guardrail'
import { PLATFORM_BODY_LIMITS, PLATFORM_LABELS } from './labels'
import { disclaimerFor } from './brand'
import type { SocialPlatform } from './adapters/types'

export type PrecheckCode =
  | 'empty_body'
  | 'securities_firewall'
  | 'is_security'
  | 'recommendation_language'
  | 'over_platform_limit'

export interface PrecheckIssue {
  code: PrecheckCode
  message: string
  platform?: SocialPlatform
}

export interface PrecheckResult {
  ok: boolean
  blocks: PrecheckIssue[]
  warnings: PrecheckIssue[]
}

export interface PrecheckInput {
  title?: string | null
  body: string
  link?: string | null
  platforms: (SocialPlatform | string)[]
  media?: unknown
  is_security?: boolean
}

// True when the platform's character budget cannot fit the body PLUS the mandatory
// disclaimer that will be appended before publishing (so we don't approve content
// that can only fit once the disclaimer is dropped).
function overPlatformLimit(body: string, platform: SocialPlatform): { over: boolean; limit: number; needed: number } {
  const limit = PLATFORM_BODY_LIMITS[platform]
  if (!limit) return { over: false, limit: 0, needed: body.length }
  const hasDisc = /educational/i.test(body)
  const needed = hasDisc ? body.length : body.length + disclaimerFor(platform).length + 2
  return { over: needed > limit, limit, needed }
}

/**
 * Gate a draft before IN_REVIEW. Blocks (hard-stop, escalate to human) on:
 *  - empty body,
 *  - a securities-firewall field (account #, order, holdings…) in the payload,
 *  - the is_security flag (route to human/FFS, never the automated pipeline),
 *  - individualized recommendation / claims language (AI red-line),
 *  - a body that overflows any selected platform's limit once the disclaimer fits.
 */
export function precheckContentForReview(input: PrecheckInput): PrecheckResult {
  const blocks: PrecheckIssue[] = []
  const warnings: PrecheckIssue[] = []
  const body = (input.body ?? '').trim()

  if (!body) {
    blocks.push({ code: 'empty_body', message: 'Add content before submitting for review.' })
  }

  const forbidden = findForbiddenSecuritiesFields({
    title: input.title ?? null,
    body: input.body ?? '',
    link: input.link ?? null,
    media: input.media ?? null,
  })
  if (forbidden.length) {
    blocks.push({
      code: 'securities_firewall',
      message: `Securities firewall: remove ${forbidden.join(', ')}. FSOS is not the securities system of record.`,
    })
  }

  if (input.is_security) {
    blocks.push({
      code: 'is_security',
      message: 'Flagged as securities-related — route to the human FSA / FFS channel, not the automated pipeline.',
    })
  }

  if (body && containsRecommendationLanguage(body)) {
    blocks.push({
      code: 'recommendation_language',
      message:
        'Reads as an individualized product recommendation or securities call to action. Rewrite as general education before review.',
    })
  }

  if (body) {
    const seen = new Set<string>()
    for (const raw of input.platforms) {
      const p = raw as SocialPlatform
      if (seen.has(p) || !(p in PLATFORM_BODY_LIMITS)) continue
      seen.add(p)
      const { over, limit, needed } = overPlatformLimit(body, p)
      if (over) {
        blocks.push({
          code: 'over_platform_limit',
          platform: p,
          message: `Over the ${PLATFORM_LABELS[p] ?? p} limit once the disclaimer is included (${needed}/${limit}). Trim before review.`,
        })
      }
    }
  }

  return { ok: blocks.length === 0, blocks, warnings }
}

/** A single flat, human-readable reason string for API responses / audit diffs. */
export function summarizePrecheck(result: PrecheckResult): string {
  return result.blocks.map((b) => b.message).join(' ')
}
