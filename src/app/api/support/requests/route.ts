import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { getServerSession, getCurrentUserEmail } from '@/lib/auth/session'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/support/requests — submit an in-app support request (ports the legacy
// Help section into a real, wired feature). Writes the `support_requests` table
// that the Admin queue (/admin/support/requests) triages. Any authenticated user
// may submit; the actor + email come from the session, not the client payload.
const bodySchema = z.object({
  subject: z.string().trim().min(3, 'Add a short subject').max(200),
  body: z.string().trim().min(10, 'Describe the issue (at least 10 characters)').max(5000),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const email = await getCurrentUserEmail()
  const db = getDb()
  const { data, error } = await db
    .from('support_requests')
    .insert({
      name: null,
      email,
      subject: parsed.data.subject,
      body: parsed.data.body,
      status: 'open',
    })
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAudit({
    actor: session.userId,
    action: 'entity.created',
    entity: 'support_request',
    entityId: data?.id ?? null,
    diff: { subject: parsed.data.subject },
  })

  return NextResponse.json({ id: data?.id ?? null }, { status: 201 })
}
