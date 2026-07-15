import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { DashboardPreferencesSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Per-user PERSONAL home-dashboard layout (migration 020). Configure once → restored
// on every login → unchanged until the user changes it. Scoped to the authenticated
// user id on every query (getDb is the service role; RLS is defense-in-depth).
// Internal read/preference surface only — no client-facing send path, no guardrail
// touched; the layout stores no figures, only which widgets show and where/how big.

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const actor = actorOf(auth.session)
    const { data, error } = await getDb()
      .from('dashboard_preferences')
      .select('layout, updated_at')
      .eq('user_id', actor)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ layout: Array.isArray(data?.layout) ? data!.layout : null, updated_at: data?.updated_at ?? null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = DashboardPreferencesSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid layout', details: v.error.flatten() }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const { error } = await getDb()
      .from('dashboard_preferences')
      .upsert(
        { user_id: actor, layout: v.data.layout, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save layout' }, { status: 500 })
  }
}
