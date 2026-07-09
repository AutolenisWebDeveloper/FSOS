import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, callerLabel } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// /api/customers/documents  (internal)
//   GET  ?customer_id=  → list a client's documents with fresh signed URLs
//   POST multipart { customer_id, file } → store in the private `documents`
//         bucket under customer-docs/<id>/, record metadata, return a signed URL
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB
const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'xlsx', 'xls', 'doc', 'docx', 'txt'])
const SIGNED_URL_TTL = 60 * 60 * 24 // 24h

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const customerId = new URL(req.url).searchParams.get('customer_id')
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  const supabase = getDb()
  const { data, error } = await supabase
    .from('customer_documents')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const docs = await Promise.all(
    (data || []).map(async (d) => {
      const { data: signed } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, SIGNED_URL_TTL)
      return { ...d, url: signed?.signedUrl || null }
    }),
  )
  return NextResponse.json({ documents: docs })
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a file.' }, { status: 400 })
  }

  const customerId = String(formData.get('customer_id') || '').trim()
  const file = formData.get('file')
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds the 15MB limit.' }, { status: 413 })
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `File type .${ext} is not allowed.` }, { status: 415 })

  const supabase = getDb()
  const { data: customer } = await supabase.from('customers').select('customer_id').eq('customer_id', customerId).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_')
  const storagePath = `customer-docs/${customerId}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadErr) {
    console.error('[customer-docs] upload error:', uploadErr)
    return NextResponse.json({ error: 'Failed to store the file. Please try again.' }, { status: 502 })
  }

  const { data: doc, error: insErr } = await supabase
    .from('customer_documents')
    .insert({
      customer_id: customerId,
      filename: file.name,
      storage_path: storagePath,
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: callerLabel(req),
    })
    .select('*')
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const { data: signed } = await supabase.storage.from('documents').createSignedUrl(storagePath, SIGNED_URL_TTL)
  return NextResponse.json({ document: { ...doc, url: signed?.signedUrl || null } }, { status: 201 })
}
