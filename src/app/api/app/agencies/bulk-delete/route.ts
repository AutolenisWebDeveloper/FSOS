import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AgencyBulkDeleteSchema } from '@/lib/validation/schemas'
import { deleteAgencies } from '@/lib/services/agencyDeletion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ARCHIVE or PERMANENTLY DELETE agency partnerships — by explicit selection (`ids`) or by
// status (`filter`). Archive is recoverable (sets archived_at, keeps everything); purge
// hard-deletes the aggregate (cascade removes owners/activation/delegations/commission
// splits; households/contacts/policies/opportunities/referrals detach).
//
// AUTHORIZATION (server-enforced): the /app portal gate admits fsa / licensed_staff /
// super_admin; the verb gate narrows this destructive mutation to fsa + super_admin,
// matching the single-agency delete (rbac-matrix: agency delete = fsa/super).
//
// `dryRun: true` resolves and returns the exact target count WITHOUT changing anything.
const MUTATE_ROLES = ['fsa', 'super_admin'] as const

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...MUTATE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AgencyBulkDeleteSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const result = await deleteAgencies(db, {
      ids: v.data.ids,
      filter: v.data.filter,
      mode: v.data.mode,
      actor,
      dryRun: v.data.dryRun,
    })
    if (!result.ok) {
      const status = result.error === 'no_target' ? 400 : 500
      return NextResponse.json({ error: result.message ?? 'Operation failed', reason: result.error }, { status })
    }
    return NextResponse.json({ ok: true, count: result.count, affected: result.affected, mode: result.mode, dryRun: result.dryRun })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update agencies' }, { status: 500 })
  }
}
