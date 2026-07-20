// src/lib/workshops/server.ts
// Server-only helpers for the Workshop/Seminar lead engine (P0). These run with a
// service-role db client (getDb) passed in by the caller; they never instantiate a
// client (CLAUDE.md §1 convention 1). Pure decision logic lives in ./logic.ts.

import { deriveIsSecurity } from './logic'

// Minimal structural type for the Supabase client we use (avoids importing the SDK type).
type Db = ReturnType<typeof import('@/lib/supabase/client')['getDb']>

export const PLACEHOLDER_MARKER = '[PLACEHOLDER'

/**
 * Replace this workshop's presenter set with `presenterIds`, recompute the securities
 * firewall flag from the attached presenters, persist it, and snapshot each presenter's
 * bio + headshot as versioned workshop_materials rows for the approval record.
 * Returns the derived is_security value.
 */
export async function syncPresenters(
  db: Db,
  workshopId: string,
  presenterIds: string[],
): Promise<boolean> {
  // Replace join rows.
  await db.from('workshop_presenters').delete().eq('workshop_id', workshopId)
  if (presenterIds.length > 0) {
    await db.from('workshop_presenters').insert(
      presenterIds.map((presenter_id, i) => ({
        workshop_id: workshopId,
        presenter_id,
        display_order: i,
      })),
    )
  }

  // Load the attached presenters to derive the firewall flag + snapshot materials.
  const { data: presenters } = presenterIds.length
    ? await db
        .from('presenters')
        .select('id, name, bio, headshot_ref, is_third_party, fund_family, presenter_type')
        .in('id', presenterIds)
    : { data: [] as PresenterRow[] }

  const rows = (presenters ?? []) as PresenterRow[]
  const isSecurity = deriveIsSecurity(rows)
  await db.from('workshops').update({ is_security: isSecurity, updated_at: nowIso() }).eq('workshop_id', workshopId)

  // Snapshot presenter bio + headshot as materials (versioned) feeding the approval record.
  for (const p of rows) {
    if (p.bio) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_bio',
        label: p.name,
        contentSnapshot: p.bio,
      })
    }
    if (p.headshot_ref) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_headshot',
        label: p.name,
        storageRef: p.headshot_ref,
      })
    }
  }
  return isSecurity
}

interface PresenterRow {
  id: string
  name: string
  bio: string | null
  headshot_ref: string | null
  is_third_party: boolean | null
  fund_family: string | null
  presenter_type: string | null
}

/** Insert a versioned workshop_materials row (auto-increments version per (workshop, kind, label)). */
export async function recordMaterial(
  db: Db,
  args: {
    workshopId: string
    kind: string
    label?: string | null
    storageRef?: string | null
    contentSnapshot?: string | null
  },
): Promise<void> {
  const { count } = await db
    .from('workshop_materials')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', args.workshopId)
    .eq('kind', args.kind)
  const version = (count ?? 0) + 1
  await db.from('workshop_materials').insert({
    workshop_id: args.workshopId,
    kind: args.kind,
    label: args.label ?? null,
    version,
    storage_ref: args.storageRef ?? null,
    content_snapshot: args.contentSnapshot ?? null,
    // finra_2210_class + filing_decision left NULL — compliance sets them (REQUIRES-APPROVAL).
  })
}

/**
 * Gather the two publish prerequisites for a workshop as booleans for the pure
 * evaluateWorkshopPublish() gate: an approved compliance approval + an approved
 * (non-placeholder) disclosure config.
 */
export async function gatherPublishFacts(
  db: Db,
  workshop: { compliance_approval_ref: string | null; disclosure_config_id: string | null },
): Promise<{ hasApprovedApproval: boolean; hasApprovedDisclosure: boolean }> {
  let hasApprovedApproval = false
  if (workshop.compliance_approval_ref) {
    const { data } = await db
      .from('workshop_approvals')
      .select('id, decision')
      .eq('id', workshop.compliance_approval_ref)
      .maybeSingle()
    hasApprovedApproval = data?.decision === 'approved'
  }
  let hasApprovedDisclosure = false
  if (workshop.disclosure_config_id) {
    const { data } = await db
      .from('workshop_disclosure_configs')
      .select('id, is_assumption, approved_by')
      .eq('id', workshop.disclosure_config_id)
      .maybeSingle()
    hasApprovedDisclosure = !!data && data.is_assumption === false && !!data.approved_by
  }
  return { hasApprovedApproval, hasApprovedDisclosure }
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Mint a short-lived signed URL for a private-bucket asset path (hero image / headshot).
 * Public landing pages call this at render time (force-dynamic) so images stay in the
 * private `documents` bucket and are never exposed as public URLs.
 */
export async function signedAssetUrl(db: Db, path: string | null, ttl = 60 * 60): Promise<string | null> {
  if (!path) return null
  try {
    const { data } = await db.storage.from('documents').createSignedUrl(path, ttl)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
