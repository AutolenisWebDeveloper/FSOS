// src/lib/comms/console.ts
// Communications Command Console — PURE policy core (spec §0/§5/§6/§9/§12). No DB, no
// clock, no I/O → unit-testable offline (tests/comms-console.test.mjs), mirroring the
// other pure comms cores (gate.ts, purpose.ts, ai-authority.ts).
//
// The console adds NO new send path (spec §0). These are only the console-specific
// DECISIONS that sit in front of the existing production rails: which purposes a licensed
// operator may send 1:1, how an operator-initiated AI conversation opener is classified,
// whether an AI conversation may be initiated on a given contact/agent, which catalog
// kinds are genuinely sendable, and whether a test destination is usable by an actor.
// Every one of these only ADDS a precondition; none relaxes the gate.

import type { MessagePurpose } from './purpose'
import type { AiMessageClass } from './ai-authority'
import { GSM7_BASIC, GSM7_EXT } from './gsm7'

// ── Manual 1:1 send purposes (spec §12.1) ────────────────────────────────────
// The purposes a licensed operator may attach to an individual send from the console.
// This is a CONFIG decision about which purposes the console exposes — the underlying
// TCPA/consent behavior stays enforced by the gate for whichever purpose is chosen (a
// MARKETING 1:1 still requires marketing consent; the gate blocks otherwise). WORKSHOP
// and BIRTHDAY are excluded: they are automated-cadence purposes, not operator 1:1 sends.
export const MANUAL_SEND_PURPOSES: MessagePurpose[] = [
  'TRANSACTIONAL',
  'SERVICING',
  'APPOINTMENT',
  'RELATIONSHIP',
  'APPLICATION_STATUS',
  'DOCUMENT_REQUEST',
  'POLICY_DEADLINE',
  'MARKETING',
]

/** True when a licensed operator may attach this purpose to a 1:1 console send. */
export function isManualPurposeAllowed(purpose: string | null | undefined): boolean {
  return !!purpose && (MANUAL_SEND_PURPOSES as string[]).includes(purpose)
}

// ── Operator-initiated AI conversation opener class (spec §12.2) ──────────────
// The opening turn of an operator-initiated AI thread (origin=outbound_manual). Both
// resulting classes are green-zone auto-send (ai-authority.ts): a seeded-from-approved-
// template opener is an approved first touch; a blank opener is an availability question
// (invite/ask, never a recommendation). The gate + authority matrix still evaluate the
// actual body — this only picks the CLASS the send path classifies the opener as.
export function openerClassFor(seed: 'approved_template' | 'blank'): AiMessageClass {
  return seed === 'approved_template' ? 'approved_first_touch' : 'availability_question'
}

// ── AI conversation initiation eligibility (spec §7/§8) ───────────────────────
export interface AiInitEligibilityInput {
  /** The contact/thread carries the securities firewall flag (§4.1). */
  isSecurity: boolean
  /** The chosen agent's per-agent kill switch is ON. */
  agentEnabled: boolean
  /** The chosen agent is the Compliance Guardrail (system-only, non-selectable). */
  isGuardrail: boolean
}
export interface AiInitEligibility {
  allowed: boolean
  reason?: string
}

/**
 * May an operator INITIATE an AI conversation with this agent on this contact? Firewall
 * contacts never get AI initiation (§4.1); the Compliance Guardrail is a system agent and
 * is never a conversational starter; a disabled agent cannot be armed. Any of these fails
 * closed — the opener is not sent and the thread is not armed.
 */
export function canInitiateAiConversation(input: AiInitEligibilityInput): AiInitEligibility {
  if (input.isSecurity) {
    return { allowed: false, reason: 'Securities-flagged contact — AI initiation is disallowed (firewall §4.1); route to FFS-supervised handling.' }
  }
  if (input.isGuardrail) {
    return { allowed: false, reason: 'The Compliance Guardrail is a system agent and cannot start a conversation.' }
  }
  if (!input.agentEnabled) {
    return { allowed: false, reason: 'The selected agent is disabled — enable it before initiating a conversation.' }
  }
  return { allowed: true }
}

// ── Catalog sendability (spec §3.4) ───────────────────────────────────────────
export type AssetKind = 'email' | 'sms' | 'ai_conversation' | 'advisor_outreach' | string

/**
 * Whether a catalog asset `kind` is genuinely sendable through the console. advisor_outreach
 * touches produce a work_task, not an outbound message — they are never "sendable" here.
 */
export function isSendableKind(kind: AssetKind): boolean {
  return kind === 'email' || kind === 'sms' || kind === 'ai_conversation'
}

/** The dispatch channel for a catalog kind (ai_conversation is not itself a channel). */
export function channelForKind(kind: AssetKind): 'sms' | 'email' | null {
  if (kind === 'sms') return 'sms'
  if (kind === 'email') return 'email'
  return null
}

// ── Test-recipient allowlist (spec §6/§9) ─────────────────────────────────────
export interface TestRecipientRow {
  user_id: string
  verified_at: string | null
  channel?: string
  address?: string
}

/**
 * A test send may ONLY target a VERIFIED destination the ACTING operator owns (spec §6).
 * Both conditions are required — an unverified row or another user's row is never usable.
 * This is what guarantees a "test" can never reach a real client.
 */
export function isTestRecipientUsable(row: TestRecipientRow | null | undefined, actorUserId: string): boolean {
  if (!row) return false
  if (!row.verified_at) return false
  return row.user_id === actorUserId
}

/** A 6-digit ownership-verification code for a test destination. `rand` in [0,1) is injectable for tests. */
export function makeVerificationCode(rand: number = Math.random()): string {
  const n = Math.floor(rand * 1_000_000)
  return String(n).padStart(6, '0')
}

/**
 * Normalize a test destination for storage/matching: SMS → '+' + digits (E.164-ish),
 * email → trimmed + lower-cased. Mirrors conversations.normalizeContact so a stored test
 * recipient resolves to the same thread/consent lookups a real send would.
 */
export function normalizeTestAddress(channel: 'sms' | 'email', raw: string): string {
  const v = (raw || '').trim()
  if (channel === 'email') return v.toLowerCase()
  const plus = v.startsWith('+') ? '+' : ''
  return plus + v.replace(/[^\d]/g, '')
}

/** Basic shape validation for a test destination before it can be added. */
export function isValidTestAddress(channel: 'sms' | 'email', raw: string): boolean {
  const v = normalizeTestAddress(channel, raw)
  if (channel === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
  return v.replace(/[^\d]/g, '').length >= 10
}

// ── SMS segment estimation (preview, spec §5 preview pane) ────────────────────
// GSM-7 characters not in the basic set force UCS-2 (Unicode) encoding, which shortens the
// per-segment budget. This is an ESTIMATE for the operator preview; the provider computes
// the authoritative count. Single-segment: 160 (GSM) / 70 (UCS-2). Multi: 153 / 67.
//
// The character set lives in ./gsm7 so this preview and the guardrail tests that reject
// non-GSM-7 characters in authored SMS copy answer "does this force UCS-2?" from ONE
// definition rather than each carrying its own (CLAUDE.md §6).

export interface SmsSegmentInfo {
  encoding: 'GSM-7' | 'UCS-2'
  length: number
  segments: number
}

/** Estimate the SMS encoding + segment count for a body (pure; preview only). */
export function smsSegmentInfo(body: string): SmsSegmentInfo {
  const text = body ?? ''
  let unicode = false
  let units = 0
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) units += 1
    else if (GSM7_EXT.includes(ch)) units += 2 // extended chars take an escape + char
    else {
      unicode = true
      break
    }
  }
  if (unicode) {
    // UCS-2: count UTF-16 code units.
    units = 0
    for (let i = 0; i < text.length; i++) units += 1
    const segments = units <= 70 ? Math.max(1, units === 0 ? 1 : 1) : Math.ceil(units / 67)
    return { encoding: 'UCS-2', length: units, segments: units === 0 ? 1 : segments }
  }
  const segments = units <= 160 ? 1 : Math.ceil(units / 153)
  return { encoding: 'GSM-7', length: units, segments: units === 0 ? 1 : segments }
}
