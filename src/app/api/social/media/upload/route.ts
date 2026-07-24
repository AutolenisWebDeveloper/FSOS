// Social media upload (ADR-026, item 2). Staff-only. Validates the file (kind, mime,
// size) with the SAME rules the library uses, stores it in the PRIVATE `documents`
// bucket under social-media/, and records the asset row. Returns the safe asset view
// (a fresh signed preview URL) — never a public URL, never the raw storage path.

import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { MediaUploadMetaSchema } from '@/lib/social/schema'
import { validateAsset, mediaKindForMime, MAX_VIDEO_BYTES } from '@/lib/social/media'
import { storagePathFor, uploadMediaBuffer, createMediaAsset } from '@/lib/social/media-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 })
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: 'File is too large.' }, { status: 413 })
    }

    const meta = MediaUploadMetaSchema.safeParse({
      alt_text: form.get('alt_text') || undefined,
      width: form.get('width') || undefined,
      height: form.get('height') || undefined,
      duration_seconds: form.get('duration_seconds') || undefined,
    })
    if (!meta.success) {
      return NextResponse.json({ error: 'Invalid metadata', details: meta.error.flatten() }, { status: 400 })
    }

    const mime = file.type || ''
    const kind = mediaKindForMime(mime)
    if (!kind) {
      return NextResponse.json({ error: `Unsupported file type ${mime || '(unknown)'} — use PNG, JPEG, WebP, MP4, or MOV.` }, { status: 415 })
    }

    const v = validateAsset({
      kind,
      mime,
      byteSize: file.size,
      width: meta.data.width ?? null,
      height: meta.data.height ?? null,
      durationSeconds: meta.data.duration_seconds ?? null,
    })
    if (!v.ok) {
      return NextResponse.json({ error: v.issues.join(' '), issues: v.issues }, { status: 422 })
    }

    const path = storagePathFor(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    const up = await uploadMediaBuffer(path, buffer, mime)
    if (!up.ok) {
      return NextResponse.json({ error: 'Failed to store the file. Please try again.' }, { status: 502 })
    }

    const actor = actorOf(auth.session)
    const created = await createMediaAsset(
      {
        kind,
        storage_ref: path,
        file_name: file.name.slice(0, 200),
        mime_type: mime,
        byte_size: file.size,
        width: meta.data.width ?? null,
        height: meta.data.height ?? null,
        duration_seconds: meta.data.duration_seconds ?? null,
        alt_text: meta.data.alt_text ?? null,
      },
      actor,
    )
    if (!created.ok) return NextResponse.json({ error: created.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'social_media_asset',
      entityId: created.data.id,
      diff: { event: 'social.media.uploaded', kind, mime },
    })
    return NextResponse.json({ asset: created.data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to upload' }, { status: 500 })
  }
}
