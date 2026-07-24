import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { listBlueprints, getBlueprint, blueprintToTemplateDraft } from '@/lib/comms/library'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Slice 8 (§17) — Campaign library. GET lists the pre-built blueprints (pure catalog,
// no DB). POST instantiates a blueprint into a DRAFT comm_template — human approval is
// still required before any campaign can use it (the approval gate is never bypassed).
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  // The catalog is code (version-controlled), not per-tenant data — no DB read.
  return NextResponse.json({ blueprints: listBlueprints() })
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ blueprintKey?: string }>(req)
  if ('error' in parsed) return parsed.error
  const bp = getBlueprint(String(parsed.data.blueprintKey ?? ''))
  if (!bp) return NextResponse.json({ error: 'Unknown blueprint.', reason: 'unknown_blueprint' }, { status: 404 })

  const draft = blueprintToTemplateDraft(bp)
  // Belt-and-suspenders: the catalog test already proves bodies are recommendation-free,
  // but re-check here so a future edit can never seed a non-compliant template (§2.2).
  if (containsRecommendationLanguage(draft.body)) {
    return NextResponse.json({ error: 'Blueprint body contains recommendation language.', reason: 'recommendation' }, { status: 422 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    // Seed a DRAFT template (needs approval before a campaign can use it). Name is
    // suffixed so repeated instantiation of the same blueprint doesn't collide visually.
    const { data, error } = await db
      .from('comm_templates')
      .insert({ name: draft.name, channel: draft.channel, category: draft.category, body: draft.body, approval_status: 'draft', version: 1, updated_by: actor })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'comm_template', entityId: data.id, diff: { name: data.name, from_blueprint: bp.key } })
    return NextResponse.json(
      {
        template: data,
        // Surface the blueprint's recommended campaign config so the FSA can carry it
        // into the builder once the template is approved (purpose + audience + claims).
        recommended: { purpose: bp.purpose, audienceKind: bp.audienceKind, makesSpecificClaims: bp.makesSpecificClaims, claimFields: bp.claimFields ?? [] },
      },
      { status: 201 },
    )
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to instantiate blueprint' }, { status: 500 })
  }
}
