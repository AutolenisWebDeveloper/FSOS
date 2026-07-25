// Social → CRM attribution (ADR-026, item 3). DB layer over the aggregator. Reads the
// links engagement ingestion ALREADY creates (social_engagement) and RESOLVES them to
// EXISTING contacts/opportunities — never a parallel person record, never a new
// attribution model. Everything here is an FSOS-ATTRIBUTED outcome (something the
// module can prove it caused); platform-REPORTED reach/impressions live in analytics.ts
// and stay distinct.

import { getDb, ConfigError } from '@/lib/supabase/client'
import { aggregateAttribution, type AttributionRow, type AttributionResult } from './attribution-agg'

export type LoadResult<T> = { ok: true; data: T } | { ok: false; kind: 'not_configured' | 'error'; message: string }

const ENGAGEMENT_COLUMNS =
  'id, platform, post_ref, resolved_contact_id, resolution_status, classification, linked_opportunity_id, linked_task_id, received_at, engagement_type, body, author_handle'

interface RawRow extends AttributionRow {
  engagement_type: string | null
  body: string | null
  author_handle: string | null
}

export interface AttributedContact {
  id: string
  full_name: string | null
  email: string | null
  contact_type: string | null
  touches: number
  lastPlatform: string | null
  lastAt: string | null
  hasOpportunity: boolean
}

export interface AttributedOpportunity {
  id: string
  stage: string | null
  is_security: boolean
  expected_commission: number | null
  household_id: string | null
}

export interface SocialAttributionView {
  summary: AttributionResult['summary']
  byPost: AttributionResult['byPost']
  byPlatform: AttributionResult['byPlatform']
  contacts: AttributedContact[]
  opportunities: AttributedOpportunity[]
}

export async function getSocialAttribution(): Promise<LoadResult<SocialAttributionView>> {
  try {
    const db = getDb()
    const { data, error } = await db
      .from('social_engagement')
      .select(ENGAGEMENT_COLUMNS)
      .order('received_at', { ascending: false })
      .limit(2000)
    if (error) return { ok: false, kind: 'error', message: error.message }
    const rows = (data ?? []) as unknown as RawRow[]
    const agg = aggregateAttribution(rows)

    // Hydrate EXISTING entities only (resolve, never duplicate).
    const [contactsRes, oppsRes] = await Promise.all([
      agg.attributedContactIds.length
        ? db.from('contacts').select('id, full_name, email, contact_type').in('id', agg.attributedContactIds)
        : Promise.resolve({ data: [], error: null }),
      agg.attributedOpportunityIds.length
        ? db.from('opportunities').select('id, stage, is_security, expected_commission, household_id').in('id', agg.attributedOpportunityIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (contactsRes.error) return { ok: false, kind: 'error', message: contactsRes.error.message }
    if (oppsRes.error) return { ok: false, kind: 'error', message: oppsRes.error.message }

    const contactMeta = new Map<string, { touches: number; lastPlatform: string | null; lastAt: string | null; hasOpp: boolean }>()
    for (const r of rows) {
      if (!r.resolved_contact_id) continue
      const m = contactMeta.get(r.resolved_contact_id) ?? { touches: 0, lastPlatform: null, lastAt: null, hasOpp: false }
      m.touches++
      if (!m.lastAt || (r.received_at && r.received_at > m.lastAt)) {
        m.lastAt = r.received_at
        m.lastPlatform = String(r.platform)
      }
      if (r.linked_opportunity_id) m.hasOpp = true
      contactMeta.set(r.resolved_contact_id, m)
    }

    const contactRows = (contactsRes.data ?? []) as { id: string; full_name: string | null; email: string | null; contact_type: string | null }[]
    const contacts: AttributedContact[] = contactRows
      .map((c) => {
        const m = contactMeta.get(c.id)
        return {
          id: c.id,
          full_name: c.full_name,
          email: c.email,
          contact_type: c.contact_type,
          touches: m?.touches ?? 0,
          lastPlatform: m?.lastPlatform ?? null,
          lastAt: m?.lastAt ?? null,
          hasOpportunity: m?.hasOpp ?? false,
        }
      })
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))

    const opportunities = ((oppsRes.data ?? []) as AttributedOpportunity[]).map((o) => ({
      id: o.id,
      stage: o.stage,
      is_security: !!o.is_security,
      expected_commission: o.expected_commission,
      household_id: o.household_id,
    }))

    return {
      ok: true,
      data: { summary: agg.summary, byPost: agg.byPost.slice(0, 10), byPlatform: agg.byPlatform, contacts, opportunities },
    }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Failed to load attribution' }
  }
}

export interface SocialTouch {
  id: string
  platform: string
  engagement_type: string | null
  body: string | null
  author_handle: string | null
  classification: string | null
  post_ref: string | null
  received_at: string | null
}

// Social touches on ONE contact's timeline — reads existing engagement, resolves to the
// given existing contact (no parallel record). Reusable on a contact 360 view.
export async function getContactSocialTouches(contactId: string): Promise<LoadResult<SocialTouch[]>> {
  try {
    const { data, error } = await getDb()
      .from('social_engagement')
      .select('id, platform, engagement_type, body, author_handle, classification, post_ref, received_at')
      .eq('resolved_contact_id', contactId)
      .order('received_at', { ascending: false })
      .limit(200)
    if (error) return { ok: false, kind: 'error', message: error.message }
    return { ok: true, data: (data ?? []) as SocialTouch[] }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Failed to load touches' }
  }
}
