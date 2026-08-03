import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse, internalErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { UserUpdateSchema } from '@/lib/validation/schemas'
import { updateUser, deleteUser, type MutateUserResult } from '@/lib/services/users'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Super · edit / delete a provisioned user. Super-admin only; every change audited.
// Lockout-safe: the service refuses to remove/delete the last Super Admin or let an
// operator delete their own account.

/** Map a failed service result to a client-safe response (no provider internals). */
function failureResponse(res: Extract<MutateUserResult, { ok: false }>, label: string): NextResponse {
  switch (res.code) {
    case 'config':
      return NextResponse.json({ error: res.message, code: 'not_configured' }, { status: 503 })
    case 'not_found':
      return NextResponse.json({ error: res.message }, { status: 404 })
    case 'self':
      return NextResponse.json({ error: res.message }, { status: 400 })
    case 'last_super_admin':
      return NextResponse.json({ error: res.message }, { status: 409 })
    default:
      return internalErrorResponse(res.message, { label })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = UserUpdateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const result = await updateUser(params.id, {
      roles: v.data.roles,
      securitiesScope: v.data.securities_scope,
    })
    if (!result.ok) return failureResponse(result, 'super/users update')

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'user',
      entityId: result.userId,
      diff: { roles: result.roles, securities_scope: result.securitiesScope },
    })

    return NextResponse.json({
      user: { id: result.userId, email: result.email, roles: result.roles, securities_scope: result.securitiesScope },
    })
  } catch (e) {
    return configErrorResponse(e) ?? internalErrorResponse(e, { label: 'super/users update' })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  try {
    const actor = actorOf(auth.session)
    const result = await deleteUser(params.id, { actor })
    if (!result.ok) return failureResponse(result, 'super/users delete')

    await writeAudit({
      actor,
      action: 'entity.deleted',
      entity: 'user',
      entityId: result.userId,
      diff: { email: result.email },
    })

    return NextResponse.json({ ok: true, id: result.userId })
  } catch (e) {
    return configErrorResponse(e) ?? internalErrorResponse(e, { label: 'super/users delete' })
  }
}
