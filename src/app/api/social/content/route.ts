import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ContentDraftSchema } from '@/lib/social/schema'
import { listContent, createDraft } from '@/lib/social/content'
import { assertNotSecuritiesSystemOfRecord } from '@/lib/compliance/firewall'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...ALLOWED])
  if (denied) return denied
  try {
    const res = await listContent()
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    return NextResponse.json({ content: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load content' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...ALLOWED])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ContentDraftSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid content', details: v.error.flatten() }, { status: 400 })
  }
  // Securities firewall: a content payload must never carry substantive securities data.
  try {
    assertNotSecuritiesSystemOfRecord(v.data)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Securities firewall' }, { status: 422 })
  }

  const actor = actorOf(auth.session)
  try {
    const res = await createDraft(v.data, { actor })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'social_content',
      entityId: res.data.id,
      diff: { event: 'social.content.drafted', platforms: v.data.platforms },
    })
    return NextResponse.json({ content: res.data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create draft' }, { status: 500 })
  }
}
