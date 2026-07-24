import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ContentEditSchema } from '@/lib/social/schema'
import { getContent, listVersions, updateDraft } from '@/lib/social/content'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...ALLOWED])
  if (denied) return denied
  const { id } = await props.params
  try {
    const [content, versions] = await Promise.all([getContent(id), listVersions(id)])
    if (!content.ok) return NextResponse.json({ error: content.message }, { status: content.kind === 'not_found' ? 404 : 500 })
    return NextResponse.json({ content: content.data, versions: versions.ok ? versions.data : [] }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load content' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...ALLOWED])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ContentEditSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await updateDraft(id, v.data, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid_transition' ? 409 : 400
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({ actor, action: 'entity.updated', entity: 'social_content', entityId: id, diff: { event: 'social.content.edited', fields: Object.keys(v.data) } })
    return NextResponse.json({ content: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update content' }, { status: 500 })
  }
}
