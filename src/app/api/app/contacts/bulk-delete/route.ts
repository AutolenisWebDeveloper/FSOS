import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ContactBulkDeleteSchema } from '@/lib/validation/schemas'
import { purgeContacts } from '@/lib/services/contactDeletion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PERMANENT (hard) bulk deletion of Contact Center contacts — by explicit selection
// (`ids`) or in bulk by campaign / agency / group / type (`filter`). Distinct from the
// archive path: this removes rows outright.
//
// AUTHORIZATION (server-enforced): the /app portal gate admits fsa / licensed_staff /
// super_admin; the verb gate then narrows this DESTRUCTIVE mutation to fsa + super_admin,
// mirroring communication suppression (licensed_staff may view/import but not purge).
//
// `dryRun: true` resolves and returns the exact target count WITHOUT deleting, so the UI
// previews "this will permanently delete N contacts" before the operator confirms. The
// service refuses a non-discriminating filter (no target) rather than mass-deleting.
const MUTATE_ROLES = ['fsa', 'super_admin'] as const

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...MUTATE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ContactBulkDeleteSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const result = await purgeContacts(db, {
      ids: v.data.ids,
      filter: v.data.filter,
      actor,
      dryRun: v.data.dryRun,
    })
    if (!result.ok) {
      const status = result.error === 'no_target' ? 400 : 500
      return NextResponse.json({ error: result.message ?? 'Delete failed', reason: result.error }, { status })
    }
    return NextResponse.json({ ok: true, count: result.count, deleted: result.deleted, dryRun: result.dryRun })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete contacts' }, { status: 500 })
  }
}
