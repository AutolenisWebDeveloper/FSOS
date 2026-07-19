import { NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/health — setup diagnostics. Reports only booleans (never secret
// values), so it is safe to hit while configuring a deployment. Tells you
// whether env vars are present, Supabase is reachable, and the schema exists.
export async function GET() {
  const env = {
    supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabase_anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabase_service_key: !!process.env.SUPABASE_SERVICE_KEY,
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    resend_key: !!process.env.RESEND_API_KEY,
    twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    ghl_key: !!process.env.GHL_API_KEY,
    apollo_key: !!process.env.APOLLO_API_KEY,
    calendly_secret: !!process.env.CALENDLY_WEBHOOK_SECRET,
    admin_gate_enabled: !!process.env.FSOS_ADMIN_PASSWORD,
    internal_api_secret: !!process.env.FSOS_API_SECRET,
  }

  let supabase_reachable = false
  let schema_present = false
  const hints: string[] = []

  if (!env.supabase_url || !env.supabase_service_key) {
    hints.push('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in your deployment environment.')
  } else {
    try {
      // Cheap probe against a seeded table. A missing-relation error means the
      // migration has not been applied; a thrown/network error means the project
      // is unreachable or the URL/key is wrong.
      const { error } = await getDb().from('agencies').select('agency_id').limit(1)
      if (!error) {
        supabase_reachable = true
        schema_present = true
      } else if (error.code === '42P01' || /does not exist/i.test(error.message)) {
        supabase_reachable = true
        schema_present = false
        hints.push('Supabase is reachable but the schema is missing — run supabase/migrations/001_initial_schema.sql in the SQL Editor.')
      } else {
        supabase_reachable = true
        hints.push(`Supabase query error: ${error.message}`)
      }
    } catch {
      supabase_reachable = false
      hints.push('Could not reach Supabase — check that the project is active and NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY are correct.')
    }
  }

  if (!env.anthropic_key) hints.push('ANTHROPIC_API_KEY is unset — the FNA generator and AI assistant will be unavailable.')

  const ok = env.supabase_url && env.supabase_service_key && supabase_reachable && schema_present

  return NextResponse.json({ ok, env, supabase_reachable, schema_present, hints }, { status: ok ? 200 : 503 })
}
