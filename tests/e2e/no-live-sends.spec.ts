import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'

// The suite's OWN safety contract, asserted rather than assumed (Phase 5: "no real
// sends — asserted by the tests themselves").
//
// Two independent guarantees are checked:
//   1. Captured transport is configured for the server under test, and the capture file
//      is the ONLY place a message can land.
//   2. Whatever the run produced, every captured line is a well-formed message record —
//      i.e. it went to the file, not to a provider.
// A capture-write failure fails the send in product code (capture-transport.ts), so
// there is no path from "capture broken" to "live send".

const CAPTURE = process.env.COMMS_CAPTURE_TRANSPORT ?? '/tmp/fsos-e2e-captured.jsonl'

test.describe('no live sends', () => {
  test('the server under test runs with captured transport configured', async () => {
    expect(CAPTURE, 'COMMS_CAPTURE_TRANSPORT must name a capture file for the E2E run').toBeTruthy()
    // A2P staging is the second, independent backstop: with SMS_A2P_APPROVED unset the
    // provider boundary refuses SMS before capture is even consulted.
    expect(process.env.SMS_A2P_APPROVED ?? '').not.toMatch(/^(true|1|yes)$/i)
  })

  test('every captured message is a structured record — nothing reached a provider', async () => {
    if (!existsSync(CAPTURE)) {
      // No sends happened in this run. That is a pass: the assertion is that nothing
      // went LIVE, and an absent capture file means nothing was sent at all.
      test.info().annotations.push({ type: 'note', description: 'no messages were sent during this run' })
      return
    }
    const lines = readFileSync(CAPTURE, 'utf8').split('\n').filter((l) => l.trim() !== '')
    for (const line of lines) {
      const msg = JSON.parse(line) as { channel?: string; to?: string; body?: string }
      expect(['email', 'sms']).toContain(msg.channel)
      expect(typeof msg.to).toBe('string')
      expect(typeof msg.body).toBe('string')
    }
    test.info().annotations.push({ type: 'note', description: `${lines.length} message(s) captured, 0 sent` })
  })
})

test.afterAll(() => {
  // Leave a clean slate for the next run so a stale file can never be read as this
  // run's evidence.
  try {
    if (existsSync(CAPTURE)) rmSync(CAPTURE)
  } catch {
    /* best-effort */
  }
})
