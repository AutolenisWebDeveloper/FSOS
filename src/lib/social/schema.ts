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
