import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse, internalErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { UserCreateSchema } from '@/lib/validation/schemas'
import { provisionUser } from '@/lib/services/users'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Super · provision a portal user. Creates the Supabase Auth user, assigns the
// requested role(s) to BOTH the JWT claim and the user_roles table, and emails a
// single-use link for the user to set their own password. Super-admin only; every
// create is audited. The setup link is credential-equivalent and is NEVER returned in
// the response — only its delivery status is (§13.5/§16.1).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = UserCreateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid user', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const actor = actorOf(auth.session)
    const result = await provisionUser(
      { email: v.data.email, roles: v.data.roles, securitiesScope: v.data.securities_scope },
      { actor },
    )

    if (!result.ok) {
      if (result.code === 'config') {
        return NextResponse.json({ error: result.message, code: 'not_configured' }, { status: 503 })
      }
      if (result.code === 'exists') {
        return NextResponse.json({ error: result.message }, { status: 409 })
      }
      // auth_error / roles_error → log detail server-side, return a generic 500.
      return internalErrorResponse(result.message, { label: 'super/users provision' })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'user',
      entityId: result.userId,
      diff: {
        email: v.data.email,
        roles: result.roles,
        securities_scope: v.data.securities_scope,
        setup_email: result.emailStatus,
      },
    })

    return NextResponse.json(
      { user: { id: result.userId, email: v.data.email, roles: result.roles }, emailStatus: result.emailStatus },
      { status: 201 },
    )
  } catch (e) {
    return configErrorResponse(e) ?? internalErrorResponse(e, { label: 'super/users' })
  }
}
