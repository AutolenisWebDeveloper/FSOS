// Social → CRM attribution aggregation (ADR-026, operational depth item 3). PURE +
// offline-testable (mirrors the analytics-agg split). Turns raw social_engagement
// rows — the links that engagement ingestion ALREADY creates — into the entity-level
// attribution the view needs: which contacts/opportunities social touched, and which
// posts drove engagement that resolved to a contact. No new attribution model: this
// only reads and groups existing engagement links. Relative imports for the gate test.

import type { SocialPlatform } from './adapters/types'

// Engagement is considered RESOLVED to the CRM once it is matched to a contact or
// triaged into a task/opportunity (engagement.ts sets these statuses).
export const RESOLVED_STATUSES = ['matched', 'triaged'] as const

export interface AttributionRow {
  id: string
  platform: SocialPlatform | string
  post_ref: string | null
  resolved_contact_id: string | null
  resolution_status: string | null
  classification: string | null
  linked_opportunity_id: string | null
  linked_task_id: string | null
  received_at: string | null
}

export interface AttributionSummary {
  totalEngagements: number
  resolved: number
  unresolved: number
  contactsTouched: number
  opportunities: number
  tasks: number
  leads: number
}

export interface PostAttribution {
  platform: string
  post_ref: string | null
  touches: number
  resolvedContacts: number
  opportunities: number
}

export interface PlatformAttribution {
  platform: string
  touches: number
  resolvedContacts: number
}

export interface AttributionResult {
  summary: AttributionSummary
  byPost: PostAttribution[]
  byPlatform: PlatformAttribution[]
  /** Distinct contact ids social touched — the DB layer hydrates these to names. */
  attributedContactIds: string[]
  /** Distinct opportunity ids social originated/touched — hydrated by the DB layer. */
  attributedOpportunityIds: string[]
}

function isResolved(status: string | null): boolean {
  return !!status && (RESOLVED_STATUSES as readonly string[]).includes(status)
}

export function aggregateAttribution(rows: AttributionRow[]): AttributionResult {
  const contactIds = new Set<string>()
  const opportunityIds = new Set<string>()
  const taskIds = new Set<string>()
  let resolved = 0
  let leads = 0

  // post_ref can be null (e.g. a DM not tied to a post); bucket those under '(no post)'.
  const postKey = (r: AttributionRow) => `${r.platform}|${r.post_ref ?? ''}`
  const posts = new Map<string, { platform: string; post_ref: string | null; touches: number; contacts: Set<string>; opps: Set<string> }>()
  const platforms = new Map<string, { touches: number; contacts: Set<string> }>()

  for (const r of rows) {
    if (isResolved(r.resolution_status)) resolved++
    if (r.classification === 'lead') leads++
    if (r.resolved_contact_id) contactIds.add(r.resolved_contact_id)
    if (r.linked_opportunity_id) opportunityIds.add(r.linked_opportunity_id)
    if (r.linked_task_id) taskIds.add(r.linked_task_id)

    const pk = postKey(r)
    let post = posts.get(pk)
    if (!post) {
      post = { platform: String(r.platform), post_ref: r.post_ref, touches: 0, contacts: new Set(), opps: new Set() }
      posts.set(pk, post)
    }
    post.touches++
    if (r.resolved_contact_id) post.contacts.add(r.resolved_contact_id)
    if (r.linked_opportunity_id) post.opps.add(r.linked_opportunity_id)

    let plat = platforms.get(String(r.platform))
    if (!plat) {
      plat = { touches: 0, contacts: new Set() }
      platforms.set(String(r.platform), plat)
    }
    plat.touches++
    if (r.resolved_contact_id) plat.contacts.add(r.resolved_contact_id)
  }

  const byPost = [...posts.values()]
    .map((p) => ({ platform: p.platform, post_ref: p.post_ref, touches: p.touches, resolvedContacts: p.contacts.size, opportunities: p.opps.size }))
    // Posts that DROVE outcomes first (resolved contacts, then opportunities, then volume).
    .sort((a, b) => b.resolvedContacts - a.resolvedContacts || b.opportunities - a.opportunities || b.touches - a.touches)

  const byPlatform = [...platforms.entries()]
    .map(([platform, v]) => ({ platform, touches: v.touches, resolvedContacts: v.contacts.size }))
    .sort((a, b) => b.resolvedContacts - a.resolvedContacts || b.touches - a.touches)

  return {
    summary: {
      totalEngagements: rows.length,
      resolved,
      unresolved: rows.length - resolved,
      contactsTouched: contactIds.size,
      opportunities: opportunityIds.size,
      tasks: taskIds.size,
      leads,
    },
    byPost,
    byPlatform,
    attributedContactIds: [...contactIds],
    attributedOpportunityIds: [...opportunityIds],
  }
}
