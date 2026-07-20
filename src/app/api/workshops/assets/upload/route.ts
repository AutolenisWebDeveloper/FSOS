import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops/assets/upload — staff-only image upload for workshop hero images
// and presenter headshots. Reuses the existing PRIVATE `documents` bucket + signed-URL
// pattern (src/app/api/agencies/upload/route.ts); stores under workshop-assets/. Returns
// the STORAGE PATH (never a public URL) — public landing pages mint a fresh signed URL at
// render time. Roles: fsa/licensed_staff/admin (+super).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  try {
    const supabase = getDb()
    const formData = await req.formData()
    const kind = (formData.get('kind') as string) || 'asset' // 'hero' | 'headshot'
    const file = formData.get('file') as File | null

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'A file is required' }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image exceeds the 8MB limit' }, { status: 413 })
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: `Image type .${ext} is not allowed (png, jpg, webp)` }, { status: 415 })
    }

    const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_')
    const folder = kind === 'headshot' ? 'presenters' : 'hero'
    const storagePath = `workshop-assets/${folder}/${Date.now()}-${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadErr) {
      return NextResponse.json({ error: 'Failed to store the image. Please try again.' }, { status: 502 })
    }

    // Hand back the storage path; a short-lived signed URL for immediate preview only.
    const { data: signed } = await supabase.storage.from('documents').createSignedUrl(storagePath, 60 * 60)
    return NextResponse.json({ storage_ref: storagePath, preview_url: signed?.signedUrl ?? null })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
