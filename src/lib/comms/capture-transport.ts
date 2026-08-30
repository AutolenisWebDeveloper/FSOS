// src/lib/comms/capture-transport.ts
// CAPTURED TRANSPORT — a test-only provider boundary (Batch 8, Phase 5 scope).
//
// When COMMS_CAPTURE_TRANSPORT names a writable file path, the two provider calls in
// lib/messaging.ts (Resend HTTP, Twilio HTTP) are replaced by an append to that file and
// a synthetic success. Nothing leaves the process. This is what lets an end-to-end suite
// exercise the REAL send path — gate, dispatcher, personalization, footers, attachments —
// while remaining structurally incapable of contacting a provider.
//
// SAFETY, by construction (each independently sufficient):
//   1. It activates only when the env var is set, and NODE_ENV must not be 'production'.
//      A production deployment with the var set still refuses to capture.
//   2. It is the LAST step before the provider call, so everything upstream still runs.
//   3. A capture write failure DISABLES the send (returns an error) rather than falling
//      through to the real provider — fail closed, never fail open onto a live send.
//
// Honesty note (carried into the go-live checklist): captured transport proves the code
// path and the exact payload. It does NOT prove delivery, inbox placement, carrier
// behavior, or provider acceptance. Only a real controlled send does that.

import { appendFileSync } from 'node:fs'

export interface CapturedMessage {
  at: string
  channel: 'email' | 'sms'
  to: string
  subject?: string
  body: string
  bodyText?: string
  /** Attachment filenames only — contents are not written to the capture log. */
  attachments?: string[]
  correlationId?: string
}

/** The capture file path when captured transport is ACTIVE, else null. */
export function captureTarget(): string | null {
  const path = process.env.COMMS_CAPTURE_TRANSPORT
  if (!path) return null
  // Never in production, even if the variable is somehow set there.
  if (process.env.NODE_ENV === 'production') return null
  return path
}

/** True when the provider boundary is captured rather than live. */
export function captureActive(): boolean {
  return captureTarget() !== null
}

/**
 * Append one message to the capture log (JSON Lines). Returns false when the write
 * fails — callers MUST treat that as a failed send, never as permission to fall through
 * to the live provider.
 */
export function captureMessage(msg: CapturedMessage): boolean {
  const path = captureTarget()
  if (!path) return false
  try {
    appendFileSync(path, JSON.stringify(msg) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}
