import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { parseLimit } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseSpreadsheet, extensionOf, SUPPORTED_EXTENSIONS } from '@/lib/spreadsheet'
import { resolveColumns, mapAndValidateRow, type CanonicalField } from '@/lib/ghlContacts'
import { aiDetectColumns, columnAiEnabled } from '@/lib/columnAI'
import {
  ghlEnabled,
  ghlLocationId,
  upsertContactWithRetry,
  createOpportunity,
  withGhlRetry,
  PIPELINES,
  GHL_CUSTOM_FIELDS,
  type GhlPipeline,
} from '@/lib/ghl'
import { classifyContacts, routeForType, type ContactType } from '@/lib/ai/contactRouter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// App B "Contact Upload → GoHighLevel" (App A parity, rebuilt in the FSA portal).
// Upload a CSV/XLSX, recognize columns (exact header → AI → content inference),
// then upsert each contact into the GHL location, optionally onto a pipeline
// stage. App-B-native: RBAC-gated + audited. Reuses the same libraries and the
// batch-log tables (ghl_upload_batches/ghl_upload_rows) as the legacy importer.
// This is an outbound CRM sync (no client message sent), so it is not consent-
// gated here; consent is enforced at send time by the comms dispatcher.
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_ROWS = 1000
const CONCURRENCY = 5

type RowStatus = 'success' | 'duplicate' | 'invalid' | 'failed'

interface RowResult {
  row_number: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  status: RowStatus
  ghl_contact_id: string | null
  ghl_opportunity_id: string | null
  is_new: boolean | null
  attempts: number
  error_message: string | null
  contact_type: ContactType | null
  routed_agent: string | null
  confidence: number | null
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  if (!ghlEnabled()) {
    return NextResponse.json({ error: 'GoHighLevel is not configured (set GHL_API_KEY).', reason: 'not_configured' }, { status: 503 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a CSV file.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A non-empty CSV or Excel (.xlsx) file is required.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 5MB limit.' }, { status: 413 })
  }
  const ext = extensionOf(file.name)
  if (ext && !SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    const hint = ext === 'xls' ? ' Re-save legacy .xls as .xlsx or .csv.' : ''
    return NextResponse.json({ error: `Only .csv and .xlsx files are accepted (got .${ext}).${hint}` }, { status: 415 })
  }

  const tags = String(formData.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean)
  const source = String(formData.get('source') || '').trim() || 'csv_upload'
  const agencyOwner = String(formData.get('agency_owner') || '').trim()
  const useAi = String(formData.get('ai') || 'true').trim().toLowerCase() !== 'false'
  // AI classification + routing: identify each contact's type, auto-tag it, and
  // route it to the right agent (and, when no manual pipeline is chosen, the
  // right GHL pipeline). On by default; degrades gracefully if the gateway is off.
  const useRouting = String(formData.get('ai_route') || 'true').trim().toLowerCase() !== 'false'
  const pipelineKey = String(formData.get('pipeline') || '').trim() as GhlPipeline['key'] | ''
  const stageRaw = String(formData.get('stage') || '').trim()
  const stagePosition = stageRaw ? Number.parseInt(stageRaw, 10) : null

  let pipeline: GhlPipeline | null = null
  if (pipelineKey) {
    pipeline = PIPELINES.find((p) => p.key === pipelineKey) || null
    if (!pipeline) return NextResponse.json({ error: `Unknown pipeline: ${pipelineKey}` }, { status: 400 })
    if (!stagePosition || !pipeline.stages.some((s) => s.position === stagePosition)) {
      return NextResponse.json({ error: `Invalid stage ${stageRaw} for pipeline ${pipelineKey}.` }, { status: 400 })
    }
  }

  let headers: string[]
  let rows: Array<Record<string, string>>
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseSpreadsheet(buffer, file.name)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 415 })
  }

  if (headers.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: 'The file has no data rows to import.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` }, { status: 413 })
  }

  const aiResult = useAi ? await aiDetectColumns(headers, rows) : null
  const resolved = resolveColumns(headers, rows, aiResult?.map)
  const colMap: Record<string, CanonicalField> = resolved.map

  const mappedFields = new Set(Object.values(colMap))
  const hasName = mappedFields.has('first_name') || mappedFields.has('last_name') || mappedFields.has('full_name')
  const hasContact = mappedFields.has('email') || mappedFields.has('phone')
  if (!hasName || !hasContact) {
    return NextResponse.json(
      {
        error:
          'Could not recognize the required columns. The file needs a name (full name, or first + last) and at least one of email or phone.',
        detected_columns: colMap,
        detection_method: resolved.method,
        headers,
      },
      { status: 422 },
    )
  }

  const supabase = getDb()
  const actor = actorOf(auth.session)
  const locationId = ghlLocationId()

  const { data: batch, error: batchErr } = await supabase
    .from('ghl_upload_batches')
    .insert({
      filename: file.name,
      source,
      tags,
      pipeline_key: pipeline?.key || null,
      stage_position: pipeline ? stagePosition : null,
      location_id: locationId,
      total_rows: rows.length,
      status: 'processing',
      created_by: actor,
    })
    .select('batch_id')
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: 'Could not start the import (database error).' }, { status: 500 })
  }
  const batchId = batch.batch_id as string

  const seen = new Set<string>()
  const results: RowResult[] = new Array(rows.length)
  const toImport: Array<{ index: number; contact: ReturnType<typeof mapAndValidateRow>['contact'] }> = []

  rows.forEach((record, i) => {
    const rowNumber = i + 1
    const { contact, errors } = mapAndValidateRow(record, colMap, { tags, source, agencyOwner })
    if (!contact) {
      results[i] = { row_number: rowNumber, first_name: null, last_name: null, email: null, phone: null, status: 'invalid', ghl_contact_id: null, ghl_opportunity_id: null, is_new: null, attempts: 0, error_message: errors.join('; '), contact_type: null, routed_agent: null, confidence: null }
      return
    }
    if (seen.has(contact.dedupeKey)) {
      results[i] = { row_number: rowNumber, first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone, status: 'duplicate', ghl_contact_id: null, ghl_opportunity_id: null, is_new: null, attempts: 0, error_message: `Duplicate of an earlier row (${contact.dedupeKey})`, contact_type: null, routed_agent: null, confidence: null }
      return
    }
    seen.add(contact.dedupeKey)
    toImport.push({ index: i, contact })
  })

  // AI classification + routing: identify each contact's type, auto-tag it, pick
  // the target agent, and (when no manual pipeline was chosen) the GHL pipeline.
  // Green-zone identify only — never a product recommendation. Records one
  // agent_run + a per-contact routing agent_action so the durable agents pick up
  // their queues. Degrades to type 'unknown' when the gateway is off.
  const contactsToClassify = toImport.map((t) => t.contact!)
  const classify = useRouting
    ? await classifyContacts(contactsToClassify)
    : { classifications: [], aiUsed: false, aiCapped: 0, model: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }

  // Per-toImport plan (aligned to toImport order).
  const plan = toImport.map((t, k) => {
    const cls = useRouting ? classify.classifications[k] : null
    const route = cls ? routeForType(cls.type) : null
    if (route && t.contact) {
      // Auto-tag + stamp the resolved type on the contact's GHL custom fields.
      t.contact.tags = Array.from(new Set([...t.contact.tags, ...route.tags]))
      t.contact.customFields[GHL_CUSTOM_FIELDS.contact_type] = cls!.type
    }
    // Manual pipeline (if chosen) wins; otherwise use the routed pipeline.
    const targetPipeline: GhlPipeline | null = pipeline
      ? pipeline
      : route?.pipeline
        ? PIPELINES.find((p) => p.key === route.pipeline) || null
        : null
    const targetStage = pipeline ? stagePosition : targetPipeline ? 1 : null
    return { cls, route, targetPipeline, targetStage }
  })

  // Open the classification run (attributes tokens/cost; children hang off it).
  const routeCounts: Record<string, number> = {}
  let routeRunId: string | null = null
  if (useRouting && toImport.length > 0) {
    const avgConf = classify.classifications.length ? classify.classifications.reduce((s, c) => s + (c?.confidence ?? 0), 0) / classify.classifications.length : null
    const { data: run } = await supabase
      .from('agent_runs')
      .insert({ agent_key: 'contact_router', actor, input: { batch_id: batchId, contacts: toImport.length, ai_used: classify.aiUsed }, status: 'completed', model: classify.model || null, input_tokens: classify.inputTokens, output_tokens: classify.outputTokens, cost_usd: classify.costUsd, confidence: avgConf, finished_at: new Date().toISOString() })
      .select('id')
      .maybeSingle()
    routeRunId = run?.id ?? null
  }

  const routingActions: Array<Record<string, unknown>> = []

  let cursor = 0
  async function worker() {
    while (cursor < toImport.length) {
      const k = cursor++
      const { index, contact } = toImport[k]
      const c = contact!
      const rowNumber = index + 1
      const p = plan[k]
      const up = await upsertContactWithRetry({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, tags: c.tags, source: c.source, customFields: c.customFields })
      if (!up.ok || !up.data?.contact?.id) {
        results[index] = { row_number: rowNumber, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, status: 'failed', ghl_contact_id: null, ghl_opportunity_id: null, is_new: null, attempts: up.attempts, error_message: up.error || 'GHL upsert returned no contact id', contact_type: p.cls?.type ?? null, routed_agent: p.route?.agent ?? null, confidence: p.cls?.confidence ?? null }
        continue
      }
      const contactId = up.data.contact.id
      let opportunityId: string | null = null
      let oppError: string | null = null
      if (p.targetPipeline && p.targetStage) {
        const opp = await withGhlRetry(() => createOpportunity({ contactId, pipelineKey: p.targetPipeline!.key, stagePosition: p.targetStage!, name: c.label }))
        if (opp.ok) opportunityId = opp.data?.opportunity?.id || null
        else oppError = `contact ok, opportunity failed: ${opp.error}`
      }
      // Route to the target agent: a queued agent_action the durable agent picks up.
      if (useRouting && p.route) {
        routeCounts[p.cls!.type] = (routeCounts[p.cls!.type] || 0) + 1
        routingActions.push({ run_id: routeRunId, kind: 'route', actor: 'agent:contact_router', outcome: 'queued', target_type: 'ghl_contact', reason: p.route.agent, note: `${p.cls!.type} (${(p.cls!.confidence * 100).toFixed(0)}%, ${p.cls!.method}) → ${p.route.agent}; ghl=${contactId}; ${c.label}` })
      }
      results[index] = { row_number: rowNumber, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, status: 'success', ghl_contact_id: contactId, ghl_opportunity_id: opportunityId, is_new: up.data.new ?? null, attempts: up.attempts, error_message: oppError, contact_type: p.cls?.type ?? null, routed_agent: p.route?.agent ?? null, confidence: p.cls?.confidence ?? null }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toImport.length) }, worker))

  if (routingActions.length > 0) {
    await supabase.from('agent_actions').insert(routingActions)
  }

  const counts = { success: 0, duplicate: 0, invalid: 0, failed: 0 }
  for (const r of results) counts[r.status]++

  await supabase.from('ghl_upload_rows').insert(
    results.map((r) => ({ batch_id: batchId, row_number: r.row_number, first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone, status: r.status, ghl_contact_id: r.ghl_contact_id, ghl_opportunity_id: r.ghl_opportunity_id, is_new: r.is_new, attempts: r.attempts, error_message: r.error_message })),
  )

  await supabase.from('ghl_upload_batches').update({ success_count: counts.success, duplicate_count: counts.duplicate, invalid_count: counts.invalid, failed_count: counts.failed, status: 'complete', completed_at: new Date().toISOString() }).eq('batch_id', batchId)

  await writeAudit({ actor, action: 'import.committed', entity: 'ghl_upload_batch', entityId: batchId, diff: { filename: file.name, total: rows.length, counts, pipeline: pipeline?.key ?? null, routing: useRouting ? routeCounts : null } })

  return NextResponse.json({
    success: true,
    batch_id: batchId,
    filename: file.name,
    location_id: locationId,
    pipeline: pipeline?.key || null,
    stage: pipeline ? stagePosition : null,
    total: rows.length,
    counts,
    detected_columns: colMap,
    detection_method: resolved.method,
    ai_used: !!aiResult,
    ai_available: columnAiEnabled(),
    routing: {
      enabled: useRouting,
      ai_used: classify.aiUsed,
      counts: routeCounts,
      capped: classify.aiCapped,
    },
    // All rows, with per-row classification, so the UI can show the routing plan.
    rows: results,
  })
}

// GET — recent upload history (batch list).
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 15, 50)
  try {
    const { data, error } = await getDb()
      .from('ghl_upload_batches')
      .select('batch_id, filename, source, total_rows, success_count, duplicate_count, invalid_count, failed_count, status, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ batches: data || [] })
  } catch {
    return NextResponse.json({ error: 'Failed to load upload history' }, { status: 500 })
  }
}
