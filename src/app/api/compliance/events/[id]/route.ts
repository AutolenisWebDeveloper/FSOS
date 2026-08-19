import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { deleteComplianceEvent } from '@/lib/services/eventDeletion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// DELETE /api/compliance/events/[id] — permanently remove one compliance event (the rows behind the
// Executive → Alerts feed and the AI Escalations "Recent compliance events" panel). This is a REAL
// hard delete, distinct from resolve/dismiss/archive; the deletion is recorded in the append-only
// audit_log. Owner-gated: fsa / super_admin only (these rows are the firewall/comms-gate audit
// stream, so licensed_staff cannot permanently destroy them).
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  try {
    const res = await deleteComplianceEvent(actorOf(auth.session), id)
    if (!res.ok) {
      if (res.kind === 'not_found') return NextResponse.json({ error: res.message }, { status: 404 })
      return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 })
    }
    return NextResponse.json({ id: res.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 })
  }
}
