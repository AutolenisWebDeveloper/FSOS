import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC opt-out (unsubscribe). POST { contact, channel? }
// Records an opted_out entry in consent_ledger and flips the customer's consent
// flags. Privacy-preserving: always returns success so the endpoint can't be
// used to enumerate which contacts exist in the book.
const Schema = z.object({
  contact: z.string().trim().min(3).max(160),
  channel: z.enum(['email', 'sms', 'all']).optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Please enter your email or phone number.' }, { status: 400 })

  const { contact } = v.data
  const channel = v.data.channel || 'all'
  const channels = channel === 'all' ? (['email', 'sms'] as const) : ([channel] as const)
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null

  const supabase = getDb()

  // Look the contact up by email (preferred) or by phone digits.
  const isEmail = contact.includes('@')
  let customer: { customer_id: string } | null = null
  if (isEmail) {
    const { data } = await supabase.from('customers').select('customer_id').eq('email', contact.toLowerCase()).maybeSingle()
    customer = data || null
  } else {
    const digits = contact.replace(/\D/g, '')
    if (digits.length >= 7) {
      const { data } = await supabase.from('customers').select('customer_id').or(`phone.ilike.%${digits}%,cell_phone.ilike.%${digits}%`).limit(1)
      customer = data && data[0] ? data[0] : null
    }
  }

  if (customer) {
    // Append-only consent ledger entries (TCPA / CAN-SPAM audit trail).
    await supabase.from('consent_ledger').insert(
      channels.map((ch) => ({
        customer_id: customer!.customer_id,
        channel: ch,
        status: 'opted_out',
        source: 'form',
        ip_address: ip,
        notes: 'Self-service opt-out via /unsubscribe',
      })),
    )
    const update: Record<string, boolean> = {}
    if (channels.includes('email')) update.consent_email = false
    if (channels.includes('sms')) update.consent_sms = false
    await supabase.from('customers').update(update).eq('customer_id', customer.customer_id)
  }

  return NextResponse.json({ success: true })
}
