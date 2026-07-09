import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, parseLimit } from '@/lib/http'
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
  type GhlPipeline,
} from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Guardrails for the serverless function. A single invocation processes one
// file; very large books should be split so each import finishes inside the
// function's 60s budget and stays well under the GHL rate limit.
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
}

// Best-effort identity of the operator running the import, for the audit log.
function callerLabel(req: NextRequest): string {
  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const user = decoded.slice(0, decoded.indexOf(':'))
      if (user) return user
    } catch {
      /* ignore */
    }
  }
  if (header.startsWith('Bearer ')) return 'api'
  return 'internal'
}

// ─────────────────────────────────────────────────────────────────────────
// POST — upload + import a CSV of contacts into GoHighLevel.
// multipart/form-data: file (CSV, required), tags, source, pipeline, stage.
// ─────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  if (!ghlEnabled()) {
    return NextResponse.json(
      { success: false, error: 'GoHighLevel is not configured (set GHL_API_KEY).' },
      { status: 503 },
    )
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
    return NextResponse.json(
      { error: `Only .csv and .xlsx files are accepted (got .${ext}).${hint}` },
      { status: 415 },
    )
  }

  // Batch-wide defaults.
  const tags = String(formData.get('tags') || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const source = String(formData.get('source') || '').trim() || 'csv_upload'
  const agencyOwner = String(formData.get('agency_owner') || '').trim()
  // AI column recognition is on by default when configured; `ai=false` disables it.
  const useAi = String(formData.get('ai') || 'true').trim().toLowerCase() !== 'false'
  const pipelineKey = String(formData.get('pipeline') || '').trim() as GhlPipeline['key'] | ''
  const stageRaw = String(formData.get('stage') || '').trim()
  const stagePosition = stageRaw ? Number.parseInt(stageRaw, 10) : null

  let pipeline: GhlPipeline | null = null
  if (pipelineKey) {
    pipeline = PIPELINES.find((p) => p.key === pipelineKey) || null
    if (!pipeline) {
      return NextResponse.json({ error: `Unknown pipeline: ${pipelineKey}` }, { status: 400 })
    }
    if (!stagePosition || !pipeline.stages.some((s) => s.position === stagePosition)) {
      return NextResponse.json(
        { error: `Invalid stage ${stageRaw} for pipeline ${pipelineKey}.` },
        { status: 400 },
      )
    }
  }

  // Parse + inspect the file (CSV or .xlsx).
  let headers: string[]
  let rows: Array<Record<string, string>>
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseSpreadsheet(buffer, file.name)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read the file.' },
      { status: 415 },
    )
  }

  if (headers.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: 'The file has no data rows to import.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` },
      { status: 413 },
    )
  }

  // Intelligent column recognition: exact header aliases → AI (reads headers +
  // sample rows) → content inference from the values themselves.
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
          'Could not recognize the required columns. The file needs a name (full name, or first + last) ' +
          'and at least one of email or phone. Detected columns are listed below — rename the headers or ' +
          'check the data and try again.',
        detected_columns: colMap,
        detection_method: resolved.method,
        headers,
      },
      { status: 422 },
    )
  }

  const supabase = getDb()
  const locationId = ghlLocationId()

  // Open the batch record up front so a crash mid-import still leaves a trace.
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
      created_by: callerLabel(req),
    })
    .select('batch_id')
    .single()

  if (batchErr || !batch) {
    console.error('[ghl-upload] failed to open batch:', batchErr)
    return NextResponse.json({ error: 'Could not start the import (database error).' }, { status: 500 })
  }
  const batchId = batch.batch_id as string

  // First pass: map + validate + in-file dedupe. Only valid, unique rows go to GHL.
  const seen = new Set<string>()
  const results: RowResult[] = new Array(rows.length)
  const toImport: Array<{ index: number; contact: ReturnType<typeof mapAndValidateRow>['contact'] }> = []

  rows.forEach((record, i) => {
    const rowNumber = i + 1
    const { contact, errors } = mapAndValidateRow(record, colMap, { tags, source, agencyOwner })
    if (!contact) {
      results[i] = {
        row_number: rowNumber,
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        status: 'invalid',
        ghl_contact_id: null,
        ghl_opportunity_id: null,
        is_new: null,
        attempts: 0,
        error_message: errors.join('; '),
      }
      return
    }
    if (seen.has(contact.dedupeKey)) {
      results[i] = {
        row_number: rowNumber,
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        status: 'duplicate',
        ghl_contact_id: null,
        ghl_opportunity_id: null,
        is_new: null,
        attempts: 0,
        error_message: `Duplicate of an earlier row (${contact.dedupeKey})`,
      }
      return
    }
    seen.add(contact.dedupeKey)
    toImport.push({ index: i, contact })
  })

  // Second pass: push to GHL with a small concurrency pool + per-call retry.
  let cursor = 0
  async function worker() {
    while (cursor < toImport.length) {
      const { index, contact } = toImport[cursor++]
      const c = contact!
      const rowNumber = index + 1
      const up = await upsertContactWithRetry({
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        tags: c.tags,
        source: c.source,
        customFields: c.customFields,
      })

      if (!up.ok || !up.data?.contact?.id) {
        results[index] = {
          row_number: rowNumber,
          first_name: c.firstName,
          last_name: c.lastName,
          email: c.email,
          phone: c.phone,
          status: 'failed',
          ghl_contact_id: null,
          ghl_opportunity_id: null,
          is_new: null,
          attempts: up.attempts,
          error_message: up.error || 'GHL upsert returned no contact id',
        }
        continue
      }

      const contactId = up.data.contact.id
      let opportunityId: string | null = null
      let oppError: string | null = null
      if (pipeline && stagePosition) {
        const opp = await withGhlRetry(() =>
          createOpportunity({
            contactId,
            pipelineKey: pipeline!.key,
            stagePosition,
            name: c.label,
          }),
        )
        if (opp.ok) {
          opportunityId = opp.data?.opportunity?.id || null
        } else {
          oppError = `contact ok, opportunity failed: ${opp.error}`
        }
      }

      results[index] = {
        row_number: rowNumber,
        first_name: c.firstName,
        last_name: c.lastName,
        email: c.email,
        phone: c.phone,
        status: 'success',
        ghl_contact_id: contactId,
        ghl_opportunity_id: opportunityId,
        is_new: up.data.new ?? null,
        attempts: up.attempts,
        error_message: oppError,
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toImport.length) }, worker))

  // Tally + persist per-row results.
  const counts = { success: 0, duplicate: 0, invalid: 0, failed: 0 }
  for (const r of results) counts[r.status]++

  const { error: rowsErr } = await supabase.from('ghl_upload_rows').insert(
    results.map((r) => ({
      batch_id: batchId,
      row_number: r.row_number,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      status: r.status,
      ghl_contact_id: r.ghl_contact_id,
      ghl_opportunity_id: r.ghl_opportunity_id,
      is_new: r.is_new,
      attempts: r.attempts,
      error_message: r.error_message,
    })),
  )
  if (rowsErr) console.error('[ghl-upload] failed to persist rows:', rowsErr)

  await supabase
    .from('ghl_upload_batches')
    .update({
      success_count: counts.success,
      duplicate_count: counts.duplicate,
      invalid_count: counts.invalid,
      failed_count: counts.failed,
      status: 'complete',
      completed_at: new Date().toISOString(),
    })
    .eq('batch_id', batchId)

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
    // Return only the rows that need operator attention to keep the payload lean.
    rows: results.filter((r) => r.status !== 'success'),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// GET — upload history. `?batch_id=` returns that batch's rows; otherwise a
// list of recent batches. `?status=failed&batch_id=` narrows the row list
// (used by the retry-failed action).
// ─────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const supabase = getDb()
  const url = new URL(req.url)
  const batchId = url.searchParams.get('batch_id')
  const limit = parseLimit(url.searchParams.get('limit'), 25, 100)

  if (batchId) {
    let q = supabase
      .from('ghl_upload_rows')
      .select('*')
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true })
    const status = url.searchParams.get('status')
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ batch_id: batchId, rows: data || [] })
  }

  const { data, error } = await supabase
    .from('ghl_upload_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ batches: data || [] })
}
