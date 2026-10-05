// src/lib/ops/automation-switch.ts
// Off / canary / on switches for automation consumers this audit CONNECTED but did not ENABLE.
//
// Owner rule (docs/ops/automation-audit-brief.md, "Connected is not enabled"): a repair that lets
// a path act where it could not before ships behind a switch that is OFF until the owner turns it
// on. `canary` limits the consumer to VERIFIED operator test destinations (comms_test_recipients,
// mig 087 — the same allow-list the console's test sends use), so a live check never touches a
// client. Everything fails CLOSED: a missing row, an unknown mode or a read error is `off`, and an
// unreadable allow-list is "not a canary".
//
// Relative imports only: the carrier-opt-out consumer (comms/opt-out.ts) is part of the standalone
// chokepoint compile, which has no path aliases.

import { getDb } from '../supabase/client'

export type SwitchMode = 'off' | 'canary' | 'on'

/** Every switch this codebase reads. Adding a consumer means adding its key here and a row (off). */
export const AUTOMATION_SWITCHES = {
  /**
   * Seeded by migration 140. Since follow-up R13 nothing reads it: a carrier opt-out (Twilio 21610)
   * closes live cadences unconditionally, like an inbound STOP — it only ever stops sends.
   */
  callback_engine_state: 'callback_engine_state',
  /** A campaign retry sweep releases a never-dispatched orphaned claim for the tick to re-send (J-06). */
  engine_retry_redispatch: 'engine_retry_redispatch',
  /**
   * Follow-up R19: the super-admin consent POPULATION execute path (it grants SMS and email consent to
   * every member without an opt-out). Only 'on' runs it — 'canary' has no test-destination meaning
   * here — and no row is seeded, so it reads 'off' until counsel signs off on the consent basis.
   */
  consent_population_execute: 'consent_population_execute',
} as const
export type AutomationSwitchKey = keyof typeof AUTOMATION_SWITCHES

/** PURE: anything other than an exact 'canary' / 'on' is 'off'. */
export function parseSwitchMode(raw: unknown): SwitchMode {
  return raw === 'on' || raw === 'canary' ? raw : 'off'
}

/** PURE: does this mode let the consumer act for this target? */
export function switchPermits(mode: SwitchMode, targetIsCanary: boolean): boolean {
  if (mode === 'on') return true
  if (mode === 'canary') return targetIsCanary
  return false
}

/** Current mode of a switch. A missing row or a read error is 'off'. */
export async function readSwitchMode(key: AutomationSwitchKey): Promise<SwitchMode> {
  try {
    const { data, error } = await getDb().from('automation_switches').select('mode').eq('key', key).maybeSingle()
    if (error || !data) return 'off'
    return parseSwitchMode(data.mode)
  } catch {
    return 'off'
  }
}

/** True only for a VERIFIED operator test destination. A read error is "not a canary". */
export async function isCanaryDestination(channel: 'sms' | 'email', address: string): Promise<boolean> {
  if (!address) return false
  try {
    const { data, error } = await getDb()
      .from('comms_test_recipients')
      .select('id')
      .eq('channel', channel)
      .eq('address', channel === 'email' ? address.toLowerCase() : address)
      .not('verified_at', 'is', null)
      .limit(1)
    if (error) return false
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/** Resolve a switch for one target: off → never; canary → verified test destinations only; on → always. */
export async function switchAllows(
  key: AutomationSwitchKey,
  target: { channel: 'sms' | 'email'; address: string },
): Promise<boolean> {
  const mode = await readSwitchMode(key)
  if (mode === 'off') return false
  return switchPermits(mode, mode === 'canary' ? await isCanaryDestination(target.channel, target.address) : false)
}
