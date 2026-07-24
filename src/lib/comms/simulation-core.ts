// src/lib/comms/simulation-core.ts
// Slice 6 (§14) — Simulation mode (PURE report core). Master build instruction §14.
//
// Simulation is a SAFE dry-run that never calls Twilio/Resend: per contact it runs the
// same pure gate the real send uses and reports would-send vs excluded (with the exact
// reason), the rendered body, and each decision. This module is the pure verdict +
// summary (no DB) so it is unit-testable offline (tests/comms-simulation.test.mjs); the
// DB-backed simulateCampaign (simulation.ts) computes the gate inputs read-only and
// builds these entries.

import type { GateResult } from './gate'

export interface SimulationEntry {
  memberId: string | null
  channel: 'sms' | 'email'
  to: string
  /** Ownership resolved for display (§14): represented agency + agency owner + book. */
  representedAgencyId: string | null
  representedAgencyOwnerId: string | null
  templateVersion: number | null
  /** Fully-rendered body (what WOULD be sent) — never dispatched. */
  renderedBody: string
  /** Scheduled send time (ISO) for this step. */
  scheduledAt: string | null
  wouldSend: boolean
  /** Exact exclusion reason when wouldSend is false (gate step + reason). */
  excludedReason: string | null
  /** Each gate decision, for the preview (§14): consent / quiet_hours / dnc / … → pass|reason. */
  decisions: Record<string, string>
}

/** Map a gate result to a would-send verdict + the exact exclusion reason (§14). */
export function verdictFromGate(gate: GateResult): { wouldSend: boolean; excludedReason: string | null } {
  if (gate.allowed) return { wouldSend: true, excludedReason: null }
  return { wouldSend: false, excludedReason: `${gate.blockedStep ?? 'blocked'}: ${gate.reason ?? 'excluded'}` }
}

export interface SimulationSummary {
  audience: number
  wouldSend: number
  excluded: number
  /** Count of exclusions by gate step (e.g. { consent: 3, dnc: 1 }). */
  excludedByStep: Record<string, number>
}

/** Summarize the per-contact entries into the pre-activation preview counts (§14). */
export function summarizeSimulation(entries: SimulationEntry[]): SimulationSummary {
  const summary: SimulationSummary = { audience: entries.length, wouldSend: 0, excluded: 0, excludedByStep: {} }
  for (const e of entries) {
    if (e.wouldSend) {
      summary.wouldSend++
    } else {
      summary.excluded++
      const step = (e.excludedReason ?? 'blocked').split(':')[0].trim() || 'blocked'
      summary.excludedByStep[step] = (summary.excludedByStep[step] ?? 0) + 1
    }
  }
  return summary
}

/**
 * Whether a campaign may be ACTIVATED given its last simulation (§14: "a simulation/
 * preview pass is required before a campaign can be activated"). Requires a simulation
 * within the freshness window (default 24h) against `now`. Pure so it is testable +
 * reused by the activate API.
 */
export function simulationSatisfiesActivation(
  simulatedAtISO: string | null | undefined,
  nowISO: string,
  freshnessHours = 24,
): { ok: boolean; reason: string } {
  if (!simulatedAtISO) {
    return { ok: false, reason: 'A simulation/preview pass is required before activation (§14). None on record.' }
  }
  const ageMs = Date.parse(nowISO) - Date.parse(simulatedAtISO)
  if (Number.isNaN(ageMs) || ageMs < 0) {
    return { ok: false, reason: 'Simulation timestamp is invalid — re-run the simulation before activation.' }
  }
  if (ageMs > freshnessHours * 60 * 60 * 1000) {
    return { ok: false, reason: `Last simulation is older than ${freshnessHours}h — re-run it before activation.` }
  }
  return { ok: true, reason: 'Recent simulation on record.' }
}
