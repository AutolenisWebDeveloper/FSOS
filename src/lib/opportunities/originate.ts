// src/lib/opportunities/originate.ts
// Impure service that turns detected coverage gaps into tracked cross-sell
// opportunities. It reads v_cross_sell_gaps + existing cross-sell opportunities,
// delegates the eligibility/dedup/firewall decision to the PURE planner
// (lib/opportunities/crosssell.ts), persists the drafts on the existing
// `opportunities` table (reusing its columns + the additive `source` tag, mig 045),
// and writes an audit row per opportunity. No parallel table, no new pipeline.
//
// Green-zone: originating an internal opportunity record is data assembly, not a
// client-facing action — it sends nothing (outreach still flows through the workforce
// + the 7-step gate). is_security is a literal false (cross-sell is never securities),
// and no commission/premium is invented (§4.3) — the FSA prices the opportunity.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import {
  planCrossSellOpportunities,
  CROSS_SELL_SOURCE,
  type CrossSellGap,
  type ExistingOpp,
} from './crosssell'

// Non-terminal stages — the only ones that block re-origination (dedup). Terminal
// (placed_issued / lost) opportunities do not, so we exclude them at the DB level to
// keep the dedup lookup correct and well under PostgREST's default row cap.
const OPEN_STAGES = ['prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability']

export interface OriginateResult {
  created: number
  skippedDuplicate: number
  skippedIneligible: number
  createdIds: string[]
  note: string
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

/**
 * Originate cross-sell opportunities from the current coverage-gap view.
 * Deduplicated against households that already hold an open cross-sell opportunity.
 * Returns counts; never throws for a data miss (returns an { error } shape instead).
 */
export async function originateCrossSellOpportunities(
  actor: string,
  opts: { limit?: number } = {},
): Promise<OriginateResult | { error: string }> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const db = getDb()

  // 1. Detected gaps (view already excludes DNC households and gap_count = 0 rows).
  const gapsRes = await db
    .from('v_cross_sell_gaps')
    .select('household_id, primary_name, referring_agency_id, next_best_line, gap_count, has_life, score')
    .order('score', { ascending: false })
    .limit(limit)
  if (gapsRes.error) return { error: gapsRes.error.message }
  const gaps = (gapsRes.data ?? []) as CrossSellGap[]
  if (gaps.length === 0) {
    return { created: 0, skippedDuplicate: 0, skippedIneligible: 0, createdIds: [], note: 'No coverage gaps to originate.' }
  }

  // 2. Existing cross-sell opportunities (for household-level dedup). Only this source.
  const existingRes = await db
    .from('opportunities')
    .select('household_id, source, stage')
    .eq('source', CROSS_SELL_SOURCE)
    .is('deleted_at', null)
    .in('stage', OPEN_STAGES)
  if (existingRes.error) return { error: existingRes.error.message }
  const existing = (existingRes.data ?? []) as ExistingOpp[]

  // 3. Pure decision: eligibility + dedup + firewall (is_security=false).
  const { drafts, skipped } = planCrossSellOpportunities(gaps, existing)
  const skippedDuplicate = skipped.filter((s) => s.reason === 'duplicate_open').length
  const skippedIneligible = skipped.filter((s) => s.reason === 'no_open_line').length

  if (drafts.length === 0) {
    return {
      created: 0,
      skippedDuplicate,
      skippedIneligible,
      createdIds: [],
      note: `No new opportunities — ${skippedDuplicate} already open, ${skippedIneligible} ineligible.`,
    }
  }

  // 4. Persist on the existing opportunities table (additive columns only).
  const now = new Date().toISOString()
  const rows = drafts.map((d) => ({
    household_id: d.household_id,
    referring_agency_id: d.referring_agency_id,
    product_id: null as string | null,
    engagement: d.engagement,
    stage: 'prospect' as const,
    is_security: false,
    source: d.source,
    stage_history: [{ stage: 'prospect', at: now, actor, note: d.reason }],
    owner_scope: actor,
  }))

  const insertRes = await db.from('opportunities').insert(rows).select('id, household_id')
  if (insertRes.error) return { error: insertRes.error.message }
  const inserted = (insertRes.data ?? []) as { id: string; household_id: string }[]

  // 5. Audit each origination (best-effort; the write is non-throwing).
  await Promise.all(
    inserted.map((opp) => {
      const draft = drafts.find((d) => d.household_id === opp.household_id)
      return writeAudit({
        actor,
        action: 'entity.created',
        entity: 'opportunity',
        entityId: opp.id,
        diff: { source: CROSS_SELL_SOURCE, line: draft?.line, stage: 'prospect', reason: draft?.reason },
      })
    }),
  )
  await writeAudit({
    actor,
    action: 'ai.action',
    entity: 'cross_sell_origination',
    diff: { created: inserted.length, skippedDuplicate, skippedIneligible },
  })

  return {
    created: inserted.length,
    skippedDuplicate,
    skippedIneligible,
    createdIds: inserted.map((o) => o.id),
    note: `${inserted.length} cross-sell opportunit${inserted.length === 1 ? 'y' : 'ies'} created.`,
  }
}
