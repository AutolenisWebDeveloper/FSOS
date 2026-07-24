// src/lib/fna/module-results.ts
// Server helper for the planning-module views (cash-flow, net-worth). Loads the
// latest CALCULATED result for a given formula from each plan's CURRENT version —
// two queries, no N+1: (1) plans with a current version, (2) the matching result
// rows — joined in memory. Read-only; used by RSC module pages.
import { load, type LoadResult } from '@/lib/data/query'

export interface ModuleResult {
  planId: string
  householdName: string
  versionNo: number
  envelope: Record<string, unknown>
  confidence: string
}

export async function loadModuleResults(formulaId: string): Promise<LoadResult<ModuleResult[]>> {
  const plansRes = await load<
    Array<{ id: string; current_version_id: string | null; households: { primary_name: string } | { primary_name: string }[] | null }>
  >(
    (db) =>
      db
        .from('fna_plans')
        .select('id, current_version_id, households(primary_name)')
        .is('deleted_at', null)
        .not('current_version_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(50),
    [],
  )
  if (!plansRes.ok) return plansRes

  const versionIds = plansRes.data.map((p) => p.current_version_id).filter((v): v is string => !!v)
  if (versionIds.length === 0) return { ok: true, data: [] }

  const versionNoRes = await load<Array<{ id: string; version_no: number }>>(
    (db) => db.from('fna_versions').select('id, version_no').in('id', versionIds),
    [],
  )
  const versionNoById = new Map<string, number>()
  for (const v of versionNoRes.ok ? versionNoRes.data : []) versionNoById.set(v.id, v.version_no)

  const resultsRes = await load<Array<{ version_id: string; envelope: Record<string, unknown>; confidence: string }>>(
    (db) => db.from('fna_results').select('version_id, envelope, confidence').eq('formula_id', formulaId).in('version_id', versionIds),
    [],
  )
  if (!resultsRes.ok) return resultsRes

  const byVersion = new Map<string, { envelope: Record<string, unknown>; confidence: string }>()
  for (const r of resultsRes.data) byVersion.set(r.version_id, { envelope: r.envelope, confidence: r.confidence })

  const out: ModuleResult[] = []
  for (const p of plansRes.data) {
    if (!p.current_version_id) continue
    const r = byVersion.get(p.current_version_id)
    if (!r) continue
    const hh = Array.isArray(p.households) ? p.households[0] : p.households
    out.push({
      planId: p.id,
      householdName: hh?.primary_name ?? 'Household',
      versionNo: versionNoById.get(p.current_version_id) ?? 0,
      envelope: r.envelope,
      confidence: r.confidence,
    })
  }
  return { ok: true, data: out }
}
