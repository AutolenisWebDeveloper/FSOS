import { NextResponse } from 'next/server'
import { captureActive, captureTarget } from '@/lib/comms/capture-transport'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// TEST-SUPPORT ONLY — the E2E safety guard's evidence source.
//
// The guard must prove that captured transport is active in the PROCESS THAT WOULD
// SEND. Asserting the test runner's own environment proves nothing: the runner and the
// server are different processes, and a server started outside the runner (or with a
// different env) would sail past a runner-side check. So the server reports its own
// setting here and the guard asserts THIS.
//
// It refuses to exist in production, by the same NODE_ENV rule that makes
// captureActive() refuse there — a deployed build has no such endpoint.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    active: captureActive(),
    // The resolved capture file, so the guard can prove the RUN's file reached the
    // server — not merely that some capture file did.
    target: captureTarget(),
    node_env: process.env.NODE_ENV ?? null,
    // The second, independent backstop: with SMS_A2P_APPROVED unset the provider
    // boundary refuses SMS before capture is even consulted.
    sms_a2p_approved: /^(true|1|yes)$/i.test(process.env.SMS_A2P_APPROVED ?? ''),
  })
}
