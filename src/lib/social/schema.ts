// Zod schemas for the social module (ADR-026). Zod is the single source of truth
// for every social API input; TS types are derived via z.infer, never hand-authored.
// Relative imports (not `@/`) so the offline gate tests compile with plain tsc.

import { z } from 'zod'
import { SOCIAL_PLATFORMS } from './adapters/types'

const platform = z.enum(SOCIAL_PLATFORMS as unknown as [string, ...string[]])

// ── Channel connection ───────────────────────────────────────────────────────
export const ChannelConnectSchema = z.object({
  platform,
  external_account_id: z.string().trim().min(1).max(200).optional(),
  display_name: z.string().trim().min(1).max(200).optional(),
  scopes: z.array(z.string().trim().min(1).max(200)).max(64).default([]),
})
export type ChannelConnect = z.infer<typeof ChannelConnectSchema>

export const ChannelUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['not_configured', 'connected', 'expired', 'revoked', 'error']).optional(),
  scopes: z.array(z.string().trim().min(1).max(200)).max(64).optional(),
  can_post: z.boolean().optional(),
  can_read_engagement: z.boolean().optional(),
  can_read_analytics: z.boolean().optional(),
})
export type ChannelUpdate = z.infer<typeof ChannelUpdateSchema>

// ── Content (used from slice 2; declared here so the schema barrel is complete) ─
export const ContentDraftSchema = z.object({
  title: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1, 'Content body is required').max(10_000),
  content_type: z.enum(['text', 'image', 'video', 'link']).default('text'),
  platforms: z.array(platform).min(1, 'Choose at least one target platform').max(6),
  media: z.array(z.object({ url: z.string().url(), kind: z.string().max(40).optional() })).max(20).default([]),
  link: z.string().url().max(2000).optional(),
  campaign_tag: z.string().trim().max(120).optional(),
  topic_tag: z.string().trim().max(120).optional(),
  household_id: z.string().uuid().optional(),
})
export type ContentDraft = z.infer<typeof ContentDraftSchema>

// Partial edit of a draft (all fields optional).
export const ContentEditSchema = ContentDraftSchema.partial()
export type ContentEdit = z.infer<typeof ContentEditSchema>

// A reviewer decision on an in-review version.
export const ReviewDecisionSchema = z.object({
  version_id: z.string().uuid(),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  notes: z.string().trim().max(2000).optional(),
})
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>

// AI drafting request (Content Drafter). Grounds in a topic/campaign/knowledge doc.
export const DraftRequestSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  platforms: z.array(platform).min(1).max(6),
  knowledge_document_id: z.string().uuid().optional(),
  campaign_tag: z.string().trim().max(120).optional(),
  tone: z.enum(['professional', 'educational', 'friendly']).default('educational'),
})
export type DraftRequest = z.infer<typeof DraftRequestSchema>

// The structured shape the AI must return — validated with Zod before any use.
// A validation failure fails safe (no draft created) and is surfaced to the FSA.
export const AIDraftOutputSchema = z.object({
  variants: z
    .array(
      z.object({
        platform,
        body: z.string().trim().min(1).max(5000),
        hashtags: z.array(z.string().trim().max(80)).max(30).default([]),
      }),
    )
    .min(1)
    .max(6),
  needs_review_flags: z.array(z.string().trim().max(200)).max(20).default([]),
  confidence: z.number().min(0).max(1),
})
export type AIDraftOutput = z.infer<typeof AIDraftOutputSchema>
