import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agencies/upload — public (agency partners upload client documents
// at /upload/[slug]). Files go to a PRIVATE bucket; only signed URLs are handed
// back, never public URLs.
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'xlsx', 'xls', 'doc', 'docx'])
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days

export async function POST(req: NextRequest) {
  try {
    const supabase = getDb()
    const formData = await req.formData()

    const agency_slug = formData.get('agency_slug') as string
    const customer_name = formData.get('customer_name') as string
    const customer_email = formData.get('customer_email') as string
    const document_type = formData.get('document_type') as string
    const notes = formData.get('notes') as string
    const file = formData.get('file') as File | null

    if (!agency_slug || !document_type) {
      return NextResponse.json({ error: 'agency_slug and document_type required' }, { status: 400 })
    }

    if (file && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File exceeds the 10MB limit' }, { status: 413 })
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: `File type .${ext} is not allowed` }, { status: 415 })
      }
    }

    const { data: agency, error: agencyErr } = await supabase
      .from('agencies')
      .select('agency_id, name, owner')
      .eq('slug', agency_slug)
      .single()

    if (agencyErr || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    let customer_id: string | null = null
    if (customer_email) {
      const { data: existing } = await supabase
        .from('customers')
        .select('customer_id')
        .eq('email', customer_email.toLowerCase())
        .maybeSingle()

      if (existing) {
        customer_id = existing.customer_id
      } else {
        const parts = (customer_name || '').trim().split(' ')
        const { data: newC } = await supabase
          .from('customers')
          .insert({
            agency_id: agency.agency_id,
            first_name: parts[0] || 'Unknown',
            last_name: parts.slice(1).join(' ') || '',
            email: customer_email.toLowerCase(),
            source: 'agency_upload',
          })
          .select('customer_id')
          .single()
        if (newC) customer_id = newC.customer_id
      }
    }

    let file_url: string | null = null
    let file_name: string | null = null
    let file_size: number | null = null

    if (file && file.size > 0) {
      const fileBuffer = Buffer.from(await file.arrayBuffer())
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_')
      const storagePath = `agency-uploads/${agency_slug}/${Date.now()}-${safeName}`

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })

      // Upload failure is FATAL — the caller must not see a false success.
      if (uploadErr) {
        console.error('Storage upload error:', uploadErr)
        return NextResponse.json(
          { error: 'Failed to store the uploaded file. Please try again.' },
          { status: 502 },
        )
      }

      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(storagePath, SIGNED_URL_TTL)
      file_url = signed?.signedUrl || null
      file_name = file.name
      file_size = file.size
    }

    // Always record the upload event, even when there is no linked customer.
    await supabase.from('agency_uploads').insert({
      agency_id: agency.agency_id,
      filename: file_name,
      upload_type: document_type,
      record_count: file ? 1 : 0,
      status: 'complete',
      processed_at: new Date().toISOString(),
    })

    if (customer_id) {
      await supabase.from('activity').insert({
        customer_id,
        agency_id: agency.agency_id,
        type: 'note',
        subject: `Document uploaded by ${agency.name}`,
        notes: `Type: ${document_type}${file_name ? ` · File: ${file_name}` : ''}${notes ? ` · Notes: ${notes}` : ''}`,
      })
    }

    return NextResponse.json({
      success: true,
      agency_name: agency.name,
      customer_id,
      file_url,
      file_name,
      file_size,
      document_type,
    })
  } catch (err) {
    console.error('Agency upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
