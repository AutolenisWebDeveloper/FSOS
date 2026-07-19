#!/usr/bin/env node
// FSOS — seed a minimal, self-contained demo dataset.
//
// Purpose: give every P0 list page BOTH a populated and an empty state to test.
// It seeds the head of the aggregate-root spine only — one agency partnership, one
// household + member, a small product catalog (with carriers), and one referral —
// so /app/agencies, /app/clients, /super/products and /app/referrals render real
// rows, while the downstream lists (opportunities, cases, commissions) stay empty
// and exercise their empty states.
//
// GUARDRAIL 3 (No Invented Farmers Data): every Farmers-specific value that the
// schema lets us flag carries is_assumption = true (products' conversion window is
// the assumption-flagged field). These are config defaults — "verify", not facts.
//
// Idempotent: rows use fixed demo UUIDs and are upserted, so re-running is safe.
//
// Usage:  npm run seed:demo
//
// Env (never logged): NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL  and
//                     SUPABASE_SERVICE_KEY     | SUPABASE_SERVICE_ROLE_KEY
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

// Fixed, obviously-fake demo UUIDs so upserts are idempotent and easy to spot.
const ID = {
  agency: 'd0000000-0000-4000-a000-000000000001',
  carrierFnwl: 'd0000000-0000-4000-a000-000000000010',
  carrierFfs: 'd0000000-0000-4000-a000-000000000011',
  household: 'd0000000-0000-4000-a000-000000000020',
  member: 'd0000000-0000-4000-a000-000000000021',
  productTerm: 'd0000000-0000-4000-a000-000000000030',
  productAnnuity: 'd0000000-0000-4000-a000-000000000031',
  productInvestment: 'd0000000-0000-4000-a000-000000000032',
  referral: 'd0000000-0000-4000-a000-000000000040',
}

async function main() {
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your environment / .env.local.',
    )
  }

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  async function upsert(table, rows) {
    const { error } = await db.from(table).upsert(rows, { onConflict: 'id' })
    if (error) fail(`Seeding ${table} failed: ${error.message}`)
    console.log(`  ✓ ${table.padEnd(20)} (${rows.length})`)
  }

  console.log('\nSeeding FSOS demo data …\n')

  // 1) Aggregate root — Agency-Owner Partnership.
  await upsert('agency_partnerships', [
    {
      id: ID.agency,
      agency_name: 'Johnson Family Insurance (Demo)',
      owner_name: 'Steven Johnson',
      status: 'producing',
      relationship_strength: 4,
      comp_disclosure: true,
      checkin_interval_days: 30,
      pc_book_policies: 820,
      life_policies_in_force: 41,
      ytd_referrals: 12,
      ytd_placed_premium: 48250.0,
      ytd_fsa_commission: 15900.0,
    },
  ])

  // 2) Carriers — Farmers-specific (FNWL life, FFS securities).
  await upsert('carriers', [
    { id: ID.carrierFnwl, name: 'Farmers New World Life (Demo)', is_farmers: true, is_ffs: false },
    { id: ID.carrierFfs, name: 'Farmers Financial Solutions (Demo)', is_farmers: false, is_ffs: true },
  ])

  // 3) Product catalog. conversion_window_days is a Farmers config default →
  //    conversion_window_is_assumption=true (guardrail 3). The investment product
  //    is is_security=true to exercise the securities firewall downstream.
  await upsert('products', [
    {
      id: ID.productTerm,
      carrier_id: ID.carrierFnwl,
      family: 'life',
      subtype: 'Term Life (20yr)',
      is_security: false,
      required_license: 'Life',
      conversion_window_days: 1825, // CONFIG DEFAULT — verify with FNWL contract
      conversion_window_is_assumption: true,
      active: true,
    },
    {
      id: ID.productAnnuity,
      carrier_id: ID.carrierFnwl,
      family: 'annuity',
      subtype: 'Fixed Annuity',
      is_security: false,
      required_license: 'Life',
      conversion_window_is_assumption: true,
      active: true,
    },
    {
      id: ID.productInvestment,
      carrier_id: ID.carrierFfs,
      family: 'investment',
      subtype: 'Mutual Fund (FFS-supervised)',
      is_security: true, // firewall: routed to FFS-approved handling, never auto-sent
      required_license: 'Series 6 / 63',
      conversion_window_is_assumption: true,
      active: true,
    },
  ])

  // 4) Household + member (no DOB — dob_enc stays null; the encrypted-DOB path is
  //    exercised by the member_create RPC in the app, not the seed).
  await upsert('households', [
    {
      id: ID.household,
      referring_agency_id: ID.agency,
      primary_name: 'The Miller Household (Demo)',
      address: '100 Virginia St',
      city: 'McKinney',
      state: 'TX',
      zip: '75069',
      do_not_contact: false,
    },
  ])

  await upsert('household_members', [
    {
      id: ID.member,
      household_id: ID.household,
      full_name: 'Sarah Miller',
      relationship: 'primary',
      email: 'sarah.miller.demo@example.com',
      phone: '+14695550123',
    },
  ])

  // 5) Referral (populates /app/referrals + v_referrals_awaiting_action). Left in
  //    'received'/untouched so the aging + SLA badges have something to render.
  await upsert('referrals', [
    {
      id: ID.referral,
      referring_agency_id: ID.agency,
      household_id: ID.household,
      referred_name: 'Sarah Miller',
      engagement: 'warm_handoff',
      status: 'received',
    },
  ])

  console.log('\n✓ Demo data seeded.')
  console.log('  Populated lists : agencies · clients/households · products · referrals')
  console.log('  Empty (by design): opportunities · cases · commissions — test their empty states')
  console.log("  Re-runnable     : fixed demo UUIDs are upserted, so it's safe to run again.\n")
}

main().catch((err) => {
  console.error('\n✗ Unexpected error:', err?.message ?? err, '\n')
  process.exit(1)
})
