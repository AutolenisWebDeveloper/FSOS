import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { KnowledgePatchSchema, KnowledgeDeleteModeSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { createSignedUrl, removeObjects } from '@/lib/storage/private-documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Knowledge Library — read / update / archive / permanently delete one document.
//
// GET returns the document plus a short-lived signed URL for its uploaded original
// (when it has one); the raw storage path is never sent to the browser.
//
// DELETE supports two modes (?mode=):
//   archive (default) — reversible. The doc leaves the library and AI retrieval;
//                       the row, its file, and its citation history are preserved.
//   permanent         — irreversible. Row + stored file are destroyed and the
//                       retrieval provenance in knowledge_citations cascades away.
//                       The audit_log entry (title, kind, filename) is what survives.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'admin', 'super_admin'] as const

/** Columns safe to return to the browser — deliberately excludes `storage_path`. */
const CLIENT_COLUMNS =
  'id, title, kind, category, summary, content, tags, status, is_assumption, visibility, usage_count, source, ' +
  'file_name, content_type, size_bytes, page_count, char_count, extraction_method, extraction_confidence, ' +
  'low_confidence, content_truncated, extraction_error, archived_at, created_at, updated_at'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const { id } = await props.params
  try {
    const db = getDb()
    const { data, error } = await db
      .from('knowledge_documents')
      .select(`${CLIENT_COLUMNS}, storage_path`)
      .eq('id', id)
      .maybeSingle()
    if (error) return dbErrorResponse('knowledge/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Swap the private path for a short-lived signed URL; never leak the path itself.
    const { storage_path: storagePath, ...rest } = data as Record<string, unknown> & { storage_path: string | null }
    const url = storagePath ? await createSignedUrl(db, storagePath) : null
    return NextResponse.json({ document: { ...rest, url } })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied
  const { id } = await props.params

  // Uploaded documents carry extracted text well past the 100KB default body cap.
  const parsed = await readJson(req, 512 * 1024)
  if ('error' in parsed) return parsed.error
  const v = KnowledgePatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Keep archived_at consistent with status, but only on an actual TRANSITION —
    // re-saving an already-archived document must not reset when it was archived.
    let archivedAt: { archived_at?: string | null } = {}
    if (v.data.status !== undefined) {
      const { data: prior } = await db.from('knowledge_documents').select('status').eq('id', id).maybeSingle()
      const wasArchived = prior?.status === 'archived'
      const willBeArchived = v.data.status === 'archived'
      if (willBeArchived && !wasArchived) archivedAt = { archived_at: new Date().toISOString() }
      else if (!willBeArchived && wasArchived) archivedAt = { archived_at: null }
    }

    const { data, error } = await db
      .from('knowledge_documents')
      .update({ ...v.data, ...archivedAt, updated_by: actor, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, title, kind, status, is_assumption, visibility, archived_at, updated_at')
      .maybeSingle()
    if (error) return dbErrorResponse('knowledge/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'knowledge_document', entityId: id, diff: v.data })
    return NextResponse.json({ document: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied
  const { id } = await props.params

  const mode = KnowledgeDeleteModeSchema.safeParse(req.nextUrl.searchParams.get('mode') ?? undefined)
  if (!mode.success) {
    return NextResponse.json({ error: 'mode must be "archive" or "permanent".' }, { status: 400 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Read the identifying detail BEFORE mutating, so the audit entry survives a
    // permanent delete with enough context to answer "what was removed?".
    const { data: existing, error: readErr } = await db
      .from('knowledge_documents')
      .select('id, title, kind, status, file_name, storage_path, sha256')
      .eq('id', id)
      .maybeSingle()
    if (readErr) return dbErrorResponse('knowledge/[id]', readErr)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (mode.data === 'permanent') {
      const { error } = await db.from('knowledge_documents').delete().eq('id', id)
      if (error) return dbErrorResponse('knowledge/[id]', error)

      // Remove the stored bytes too — but only AFTER the row is gone, so a storage
      // failure can never leave a row pointing at a file that no longer exists.
      let fileRemoved = true
      if (existing.storage_path) {
        const cleanup = await removeObjects(db, [existing.storage_path])
        fileRemoved = cleanup.ok
        if (!cleanup.ok) {
          // eslint-disable-next-line no-console
          console.error('[api] knowledge/[id] orphan_object', { id, error: cleanup.error })
        }
      }

      await writeAudit({
        actor,
        action: 'entity.deleted',
        entity: 'knowledge_document',
        entityId: id,
        diff: {
          permanent: true,
          title: existing.title,
          kind: existing.kind,
          file_name: existing.file_name,
          sha256: existing.sha256,
          file_removed: fileRemoved,
        },
      })
      return NextResponse.json({ ok: true, deleted: true, file_removed: fileRemoved })
    }

    // Default: soft archive (retains the file, the row, and citation provenance).
    const { data, error } = await db
      .from('knowledge_documents')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        updated_by: actor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) return dbErrorResponse('knowledge/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({
      actor,
      action: 'entity.deleted',
      entity: 'knowledge_document',
      entityId: id,
      diff: { archived: true, title: existing.title, kind: existing.kind },
    })
    return NextResponse.json({ ok: true, archived: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
