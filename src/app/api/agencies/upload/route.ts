import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agencies/upload
// Handles document uploads from agency partners at /upload/[slug]
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

    // 1. Look up agency
    const { data: agency, error: agencyErr } = await supabase
      .from('agencies')
      .select('agency_id, name, owner')
      .eq('slug', agency_slug)
      .single()

    if (agencyErr || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    // 2. Find or create customer
    let customer_id: string | null = null
    if (customer_email) {
      const { data: existing } = await supabase
        .from('customers')
        .select('customer_id')
        .eq('email', customer_email)
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
            email: customer_email || null,
            source: 'agency_upload',
          })
          .select('customer_id')
          .single()
        if (newC) customer_id = newC.customer_id
      }
    }

    // 3. Upload file to Supabase Storage (if file present)
    let file_url: string | null = null
    let file_name: string | null = null
    let file_size: number | null = null

    if (file && file.size > 0) {
      const fileBuffer = Buffer.from(await file.arrayBuffer())
      const ext = file.name.split('.').pop() || 'pdf'
      const storagePath = `agency-uploads/${agency_slug}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadErr) {
        console.error('Storage upload error:', uploadErr)
        // Non-fatal — still record the submission
      } else {
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath)
        file_url = urlData?.publicUrl || null
        file_name = file.name
        file_size = file.size
      }
    }

    // 4. Log activity
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
