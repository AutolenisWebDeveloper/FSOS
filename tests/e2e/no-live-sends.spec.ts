import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'

// The suite's OWN safety contract, asserted rather than assumed (Phase 5: "no real
// sends — asserted by the tests themselves").
//
// WHERE THE ASSERTION LIVES IS THE WHOLE POINT. The earlier version of this file read
// `process.env.COMMS_CAPTURE_TRANSPORT` — the TEST RUNNER's environment. The runner does
// not send anything; the Next server does, in a different process. A server started by
// hand, left over from a previous run, or launched without the capture variable would
// have sailed straight past that check while the suite reported itself safe. So the
// server reports its own live setting at /api/dev/comms-capture and the assertions below
// read THAT.
//
// This guard is falsifiable, and that is proven by execution:
// tests/e2e-guard-falsifiable.test.mjs runs THIS spec against a server that reports
// capture off and asserts the run FAILS. A safety assertion that cannot fail certifies
// nothing.

interface CaptureStatus {
  active: boolean
  target: string | null
  node_env: string | null
  sms_a2p_approved: boolean
}

async function serverCaptureStatus(request: {
  get: (url: string) => Promise<{ status(): number; text(): Promise<string> }>
}): Promise<CaptureStatus> {
  const res = await request.get('/api/dev/comms-capture')
  const body = await res.text()
  expect(
    res.status(),
    `the server under test must answer /api/dev/comms-capture (404 means it is a PRODUCTION build, where captured transport refuses to activate at all). Body: ${body}`,
  ).toBe(200)
  return JSON.parse(body) as CaptureStatus
}

test.describe('no live sends', () => {
  test('the SERVER PROCESS reports captured transport active for this run', async ({ request }) => {
    const status = await serverCaptureStatus(request)

    // THE assertion. False here means the server would call Resend/Twilio for real.
    expect(
      status.active,
      `the server under test does not have captured transport active (node_env=${status.node_env}, target=${status.target}). A send from this server would reach a real provider — the suite must not run.`,
    ).toBe(true)

    // Not merely "some capture file" — THIS RUN's file. Proves the webServer env
    // actually reached the server rather than a stale value from another run.
    const expected = process.env.FSOS_E2E_EXPECTED_CAPTURE
    if (expected) {
      expect(
        status.target,
        'the server is capturing to a different file than this run configured — the run would be reading another run\'s evidence',
      ).toBe(expected)
    }

    // The second, independent backstop, also read from the server rather than the runner.
    expect(
      status.sms_a2p_approved,
      'SMS_A2P_APPROVED is truthy in the SERVER process — the A2P backstop is disarmed there',
    ).toBe(false)
  })

  test('every captured message is a structured record — nothing reached a provider', async ({ request }) => {
    // Read the file the SERVER named, not the one the runner expects.
    const status = await serverCaptureStatus(request)
    expect(status.active, 'capture inactive on the server — see the previous test').toBe(true)
    const target = status.target as string

    if (!existsSync(target)) {
      // No sends happened in this run. That is a pass only because the previous
      // assertion established that a send, had one occurred, would have landed here.
      test.info().annotations.push({
        type: 'note',
        description: `no messages were sent during this run (server capture target ${target} was never written)`,
      })
      return
    }
    const lines = readFileSync(target, 'utf8').split('\n').filter((l) => l.trim() !== '')
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
  // Leave a clean slate so a stale file can never be read as a later run's evidence.
  // (The filename is run-scoped as well — belt and braces.)
  const target = process.env.FSOS_E2E_EXPECTED_CAPTURE
  try {
    if (target && existsSync(target)) rmSync(target)
  } catch {
    /* best-effort */
  }
})
