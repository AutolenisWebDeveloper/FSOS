// src/lib/customerProfile.ts
// Assembles a full 360° view of a customer from every related table in one
// place, so the detail API and the AI next-best-action share identical data.

import { getDb } from '@/lib/supabase/client'
import { ghlSummary, type GhlSummary } from '@/lib/ghl'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export interface CustomerProfile {
  customer: Row
  policies: Row[]
  scores: Row | null
  activity: Row[]
  cases: Row[]
  opra: Row[]
  forms: Row[]
  ghl: GhlSummary
}

/** Load a customer and all related records. Returns null when the id is unknown. */
export async function loadCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  const supabase = getDb()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('customer_id', customerId)
    .single()
  if (error || !customer) return null

  const [policies, scores, activity, cases, opra, forms] = await Promise.all([
    supabase.from('policies').select('*').eq('customer_id', customerId).order('issue_date', { ascending: false }),
    supabase.from('scores').select('*').eq('customer_id', customerId).maybeSingle(),
    supabase
      .from('activity')
      .select('activity_id, type, direction, channel, subject, notes, ai_agent, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('commission_cases')
      .select('case_id, carrier, product_name, product_type, premium, estimated_gdc, case_status, pipeline, issued_date, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
    supabase.from('opra_cases').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabase
      .from('form_submissions')
      .select('submission_id, form_id, status, created_at, completed_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return {
    customer,
    policies: policies.data || [],
    scores: scores.data || null,
    activity: activity.data || [],
    cases: cases.data || [],
    opra: opra.data || [],
    forms: forms.data || [],
    ghl: ghlSummary(customer),
  }
}
