import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Make.com Scenario 1 target — receives one row from the APEX CSV export
// and upserts it into customers (and policies when a policy_type is present).

interface UpsertBody {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  policy_type?: string
  face_amount?: number | string
  annual_premium?: number | string
  conversion_deadline?: string
  issue_date?: string
  agency_id?: string
  apex_id?: string
  source?: string
}

function normalizeEmail(email?: string): string | null {
  if (!email) return null
  const e = email.trim().toLowerCase()
  return e.length > 0 ? e : null
}

function normalizePhone(phone?: string): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length > 0 ? digits : null
}

function toNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Map an APEX policy_type onto the boolean policy flags on customers
function policyFlags(policyType?: string) {
  const t = (policyType || '').toLowerCase()
  return {
    has_auto: t === 'auto',
    has_home: t === 'home',
    has_life: t === 'life' || t === 'term' || t === 'term_life',
    has_umbrella: t === 'umbrella',
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized
  try {
    // Use readJson so this route honors the shared 100 KB payload cap and
    // returns a clean 400/413 on bad/oversized input, like every other route.
    const parsed = await readJson<UpsertBody>(req)
    if ('error' in parsed) return parsed.error
    const body = parsed.data

    const first_name = (body.first_name || '').trim()
    const last_name = (body.last_name || '').trim()
    const email = normalizeEmail(body.email)
    const phone = normalizePhone(body.phone)

    // Required fields — return 400, never throw 500 on a single bad row
    if (!first_name || !last_name) {
      return NextResponse.json(
        { success: false, error: 'first_name and last_name are required' },
        { status: 400 }
      )
    }
    if (!email && !phone) {
      return NextResponse.json(
        { success: false, error: 'At least one of email or phone is required' },
        { status: 400 }
      )
    }

    const db = getDb()

    // 1. Look up existing customer by normalized email, then phone.
    // Uses separate .eq() queries (never string-interpolated .or(), which is
    // vulnerable to PostgREST filter injection via crafted email values).
    let existing: { customer_id: string } | null = null
    if (email) {
      const { data } = await db
        .from('customers')
        .select('customer_id')
        .eq('email', email)
        .limit(1)
        .maybeSingle()
      existing = data as { customer_id: string } | null
    }
    if (!existing && phone) {
      const { data } = await db
        .from('customers')
        .select('customer_id')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle()
      existing = data as { customer_id: string } | null
    }

    const flags = policyFlags(body.policy_type)
    let customer_id: string
    let action: 'created' | 'updated'

    if (existing?.customer_id) {
      customer_id = existing.customer_id
      action = 'updated'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      }
      if (email) updates.email = email
      if (phone) updates.phone = phone
      if (body.apex_id) updates.apex_id = body.apex_id
      if (body.agency_id) updates.agency_id = body.agency_id
      // Only flip flags on (never off) — a customer can hold multiple policy lines
      if (flags.has_auto) updates.has_auto = true
      if (flags.has_home) updates.has_home = true
      if (flags.has_life) updates.has_life = true
      if (flags.has_umbrella) updates.has_umbrella = true

      const { error: updErr } = await db
        .from('customers')
        .update(updates)
        .eq('customer_id', customer_id)
      if (updErr) {
        console.error('[customers/upsert] update error:', updErr)
        return NextResponse.json({ success: false, error: updErr.message }, { status: 400 })
      }
    } else {
      action = 'created'
      const { data: created, error: insErr } = await db
        .from('customers')
        .insert({
          first_name,
          last_name,
          email,
          phone,
          agency_id: body.agency_id || null,
          apex_id: body.apex_id || null,
          source: body.source || 'apex',
          ...flags,
        })
        .select('customer_id')
        .single()

      if (insErr || !created) {
        console.error('[customers/upsert] insert error:', insErr)
        return NextResponse.json(
          { success: false, error: insErr?.message || 'Failed to create customer' },
          { status: 400 }
        )
      }
      customer_id = created.customer_id
    }

    // 5. Upsert a policy row if a policy_type was provided. Idempotent: a
    // re-run of the same APEX row updates the existing policy instead of
    // duplicating it. Dedupe key: (customer_id, policy_type, conversion_deadline).
    if (body.policy_type) {
      const policyPayload = {
        customer_id,
        policy_type: body.policy_type,
        face_amount: toNumber(body.face_amount),
        annual_premium: toNumber(body.annual_premium),
        conversion_deadline: body.conversion_deadline || null,
        issue_date: body.issue_date || null,
        status: 'active',
      }

      let existingPolicy: { policy_id: string } | null = null
      {
        let pq = db
          .from('policies')
          .select('policy_id')
          .eq('customer_id', customer_id)
          .eq('policy_type', body.policy_type)
          .limit(1)
        pq = body.conversion_deadline
          ? pq.eq('conversion_deadline', body.conversion_deadline)
          : pq.is('conversion_deadline', null)
        const { data } = await pq.maybeSingle()
        existingPolicy = data as { policy_id: string } | null
      }

      const { error: polErr } = existingPolicy
        ? await db.from('policies').update(policyPayload).eq('policy_id', existingPolicy.policy_id)
        : await db.from('policies').insert(policyPayload)

      if (polErr) {
        // Log but don't fail the whole row — customer upsert already succeeded
        console.error('[customers/upsert] policy upsert error:', polErr)
      }
    }

    // 7. Recompute policy_count from the policies table
    const { count } = await db
      .from('policies')
      .select('policy_id', { count: 'exact', head: true })
      .eq('customer_id', customer_id)

    await db
      .from('customers')
      .update({ policy_count: count ?? 0 })
      .eq('customer_id', customer_id)

    return NextResponse.json({ success: true, customer_id, action })
  } catch (err) {
    // Genuine server faults return 500 so Make.com retries rather than dropping
    // the row. Intentional bad-row rejections above return 400.
    console.error('[customers/upsert] unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Health check for Make.com
export async function GET() {
  return NextResponse.json({ ok: true, tables: ['customers', 'policies'] })
}
