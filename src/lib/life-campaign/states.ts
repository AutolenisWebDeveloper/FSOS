// src/lib/life-campaign/states.ts
// The Life Conversion Campaign's two state machines, PURE (no DB/clock). Kept as explicit
// transition tables rather than scattered conditionals (spec §13) so every allowed move is
// auditable in one place and the DB CHECK constraints in migration 081 mirror them exactly.
//
// Campaign lifecycle (§4b): the operational controls sit ABOVE per-enrollment state — a
// campaign can be Active while individual enrollments are paused for their own reasons, but
// NOTHING dispatches unless the campaign itself is Active (canDispatch). Emergency Stop and
// Archive are deliberately distinct: Emergency Stopped can be re-enabled (a considered
// action), Archived is terminal (read-only history).

export const CAMPAIGN_STATES = [
  'draft',
  'approval_pending',
  'active',
  'paused',
  'disabled',
  'emergency_stopped',
  'archived',
] as const
export type CampaignState = (typeof CAMPAIGN_STATES)[number]

export type ControlAction = 'submit' | 'enable' | 'pause' | 'resume' | 'disable' | 'emergency_stop' | 'archive'

// Allowed transitions. Absent target = forbidden. Archived has no outgoing edges (terminal).
const CAMPAIGN_TRANSITIONS: Record<CampaignState, CampaignState[]> = {
  draft: ['approval_pending', 'archived'],
  approval_pending: ['active', 'draft', 'archived'],
  // From Active you can pause, disable, emergency-stop, or archive.
  active: ['paused', 'disabled', 'emergency_stopped', 'archived'],
  // A routine resume returns to Active; a disable is also reachable.
  paused: ['active', 'disabled', 'emergency_stopped', 'archived'],
  disabled: ['active', 'emergency_stopped', 'archived'],
  // Re-enabling from an emergency stop is deliberate but permitted.
  emergency_stopped: ['active', 'disabled', 'archived'],
  archived: [],
}

/** Only an Active campaign may dispatch any touch (§4b). */
export function canDispatch(state: string): boolean {
  return state === 'active'
}

export function canTransition(from: string, to: string): boolean {
  if (!CAMPAIGN_STATES.includes(from as CampaignState)) return false
  if (!CAMPAIGN_STATES.includes(to as CampaignState)) return false
  return CAMPAIGN_TRANSITIONS[from as CampaignState].includes(to as CampaignState)
}

/** The target state a control action drives the campaign toward. */
export function controlTargetState(action: ControlAction): CampaignState {
  switch (action) {
    case 'submit': return 'approval_pending'
    case 'enable': return 'active'
    case 'resume': return 'active'
    case 'pause': return 'paused'
    case 'disable': return 'disabled'
    case 'emergency_stop': return 'emergency_stopped'
    case 'archive': return 'archived'
  }
}

// Enrollment lifecycle (§13). paused_for_conversation (a customer reply, §6/§12) is kept
// DISTINCT from paused_by_admin (a global Disable/Emergency Stop, §4b) because the four
// resume options depend on telling them apart.
export const ENROLLMENT_STATES = [
  'active',
  'paused_for_conversation',
  'paused_by_admin',
  'completed',
  'exited',
  'suppressed',
] as const
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number]

/** A scheduled touch fires only from an active enrollment (pausing removes it structurally). */
export function enrollmentCanReceiveTouch(state: string): boolean {
  return state === 'active'
}
