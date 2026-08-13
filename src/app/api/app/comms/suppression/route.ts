import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { SuppressionApplySchema } from '@/lib/validation/schemas'
import { applySuppression, getAgencySuppressionStatus } from '@/lib/comms/suppression-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Agent-level (book) and client-level (individual/bulk) BUSINESS communication suppression.
//
// AUTHORIZATION (server-enforced, not a hidden button): the /app (FSA) portal gate admits
// fsa / licensed_staff / super_admin; the verb gate then narrows the MUTATION to fsa +
// super_admin (licensed_staff may send but not configure suppression). Any other role — or a
// direct API call from an unauthorized session — is rejected here before the service runs.
const MUTATE_ROLES = ['fsa', 'super_admin'] as const

// GET current agent-level status + live book size (for the block-book confirmation, which
// must show the affected-client count before the operator confirms).
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  // Read is available to everyone in the FSA portal (view is not a mutation).
  const agencyId = req.nextUrl.searchParams.get('agencyId')
  if (!agencyId) return NextResponse.json({ error: 'agencyId is required' }, { status: 400 })
  try {
    const status = await getAgencySuppressionStatus(agencyId)
    return NextResponse.json({ ok: true, ...status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load suppression status' }, { status: 500 })
  }
}

// POST apply a suppression change. Atomic mutation + audit via the comm_suppression_apply RPC.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...MUTATE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SuppressionApplySchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const d = v.data
    const result = await applySuppression({
      actor,
      status: d.status,
      reason: d.reason ?? null,
      scope: d.scope,
      agencyId: d.scope === 'agency' ? d.agencyId : null,
      contactIds: d.scope === 'client' ? d.contactIds : null,
    })
    if (!result.ok) {
      // The RPC raises (and rolls back) on a bad agency / no valid contacts / audit failure.
      // Surface it, never a silent success.
      return NextResponse.json({ error: 'Suppression change failed', reason: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true, ...result.summary })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to apply suppression' }, { status: 500 })
  }
}
