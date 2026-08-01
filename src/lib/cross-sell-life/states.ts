// src/lib/cross-sell-life/states.ts
// The Cross-Sell Life Campaign's two state machines, PURE (no DB/clock). Kept as explicit
// transition tables rather than scattered conditionals (spec §15) so every allowed move is
// auditable in one place and the DB CHECK constraints in migration 085 mirror them exactly.
//
// Campaign lifecycle (§ Operational Controls): the operational controls sit ABOVE per-enrollment
// state — a campaign can be Active while individual enrollments are paused for their own reasons,
// but NOTHING dispatches unless the campaign itself is Active (canDispatch). Emergency Stop is
// deliberately distinct from Disable (a considered halt of ALL outbound + enrollment, re-enable is
// deliberate); Archived is terminal (read-only history).
//
// Enrollment lifecycle (§15): the FULL operational state set — queue states before activation,
// live/paused/handoff states during the run, and standardized terminal states. 'running' is the
// single live, touch-receiving state (enrollmentCanReceiveTouch). This is owner-approved (the full
// §15 machine, not a compressed set).

// ── Campaign lifecycle ──────────────────────────────────────────────────────
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

export type ControlAction =
  | 'submit'
  | 'enable'
  | 'pause'
  | 'resume'
  | 'disable'
  | 'emergency_stop'
  | 'archive'

// Allowed transitions. Absent target = forbidden. Archived has no outgoing edges (terminal).
const CAMPAIGN_TRANSITIONS: Record<CampaignState, CampaignState[]> = {
  draft: ['approval_pending', 'active', 'archived'],
  approval_pending: ['active', 'draft', 'archived'],
  active: ['paused', 'disabled', 'emergency_stopped', 'archived'],
  paused: ['active', 'disabled', 'emergency_stopped', 'archived'],
  disabled: ['active', 'emergency_stopped', 'archived'],
  emergency_stopped: ['active', 'disabled', 'archived'],
  archived: [],
}

/** Only an Active campaign may dispatch any touch (§ Operational Controls: "Only campaigns in the
 *  Active state may send outbound communications"). */
export function canDispatch(state: string): boolean {
  return state === 'active'
}

export function canTransition(from: string, to: string): boolean {
  if (!CAMPAIGN_STATES.includes(from as CampaignState)) return false
  if (!CAMPAIGN_STATES.includes(to as CampaignState)) return false
  return CAMPAIGN_TRANSITIONS[from as CampaignState].includes(to as CampaignState)
}

export type ControlClaim =
  | { ok: true; from: string; to: string }
  | { ok: false; error: 'invalid_transition' | 'stale_state'; from: string; to: string }

/**
 * PURE decision for an OPTIMISTIC-CONCURRENCY campaign control transition. A control writes the
 * new status with a compare-and-set (`update … WHERE id=? AND status=from`); `claimedRows` is how
 * many rows that update actually changed. 0 means a CONCURRENT control already moved the campaign
 * out of `from` since we read it (TOCTOU) — the no-op update must NOT be treated as success, or
 * two authorized POSTs both "succeed", double-pause enrollments, and write a misleading audit
 * pair. This maps the (transition-validity, claim) pair to the single authoritative outcome so the
 * DB wiring and the test agree.
 */
export function interpretControlClaim(from: string, to: string, claimedRows: number): ControlClaim {
  if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition', from, to }
  if (claimedRows < 1) return { ok: false, error: 'stale_state', from, to }
  return { ok: true, from, to }
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

// ── Enrollment lifecycle (§15) ──────────────────────────────────────────────
export const ENROLLMENT_STATES = [
  // Queue / pre-run
  'eligible',
  'queued',
  'scheduled',
  'enrolled',
  // Live run
  'running',
  // Pauses (a customer reply vs a global admin disable/emergency-stop — kept DISTINCT because the
  // configurable resume behavior depends on telling them apart)
  'paused_for_conversation',
  'paused_by_admin',
  'conversation_active',
  // Advisor handoff
  'waiting_for_advisor',
  'advisor_owned',
  // Downstream / exit
  'appointment_scheduled',
  'quote_requested',
  'application_started',
  'policy_issued',
  'purchased_elsewhere',
  'future_follow_up',
  'completed',
  'suppressed',
  'compliance_hold',
  'cancelled',
  'failed',
] as const
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number]

// The live states from which the scheduler advances a due touch. Only 'running' receives a
// proactive touch; a pause/handoff/terminal state structurally removes the enrollment from the
// tick's selection (§6: no proactive touch during an open conversation / advisor ownership /
// scheduled appointment).
export function enrollmentCanReceiveTouch(state: string): boolean {
  return state === 'running'
}

// Terminal states — no further automated transition; the campaign has yielded (§15 exit reasons).
export const TERMINAL_ENROLLMENT_STATES = new Set<EnrollmentState>([
  'appointment_scheduled',
  'quote_requested',
  'application_started',
  'policy_issued',
  'purchased_elsewhere',
  'completed',
  'suppressed',
  'cancelled',
])

export function isTerminal(state: string): boolean {
  return TERMINAL_ENROLLMENT_STATES.has(state as EnrollmentState)
}

// Standardized exit-reason vocabulary (§15). Stored on exit_reason so analytics + the audit trail
// carry a single, comparable outcome per enrollment.
export const EXIT_REASONS = [
  'appointment_booked',
  'quote_requested',
  'application_started',
  'policy_issued',
  'purchased_elsewhere',
  'not_interested',
  'sms_stop',
  'email_unsubscribe',
  'global_suppression',
  'wrong_number',
  'deceased',
  'manual_removal',
  'compliance_hold',
  'future_follow_up',
  'campaign_completed',
  'provider_failure',
  'administrative_closure',
] as const
export type ExitReason = (typeof EXIT_REASONS)[number]

// Allowed enrollment transitions. Kept intentionally permissive on the operational edges the
// engine drives, and closed on terminal states (no outgoing edges). Validated by validateEnrollmentTransition.
const ENROLLMENT_TRANSITIONS: Record<EnrollmentState, EnrollmentState[]> = {
  eligible: ['queued', 'cancelled', 'suppressed'],
  queued: ['scheduled', 'enrolled', 'cancelled', 'suppressed'],
  scheduled: ['enrolled', 'running', 'cancelled', 'suppressed'],
  enrolled: ['running', 'paused_by_admin', 'cancelled', 'suppressed'],
  running: [
    'paused_for_conversation', 'paused_by_admin', 'conversation_active', 'waiting_for_advisor',
    'advisor_owned', 'appointment_scheduled', 'quote_requested', 'application_started',
    'policy_issued', 'purchased_elsewhere', 'future_follow_up', 'completed', 'suppressed',
    'compliance_hold', 'cancelled', 'failed',
  ],
  paused_for_conversation: ['running', 'conversation_active', 'waiting_for_advisor', 'advisor_owned', 'appointment_scheduled', 'suppressed', 'cancelled', 'future_follow_up', 'completed'],
  paused_by_admin: ['running', 'cancelled', 'suppressed', 'completed'],
  conversation_active: ['running', 'waiting_for_advisor', 'advisor_owned', 'appointment_scheduled', 'quote_requested', 'application_started', 'future_follow_up', 'suppressed', 'cancelled', 'completed'],
  waiting_for_advisor: ['advisor_owned', 'running', 'appointment_scheduled', 'compliance_hold', 'cancelled', 'suppressed', 'completed'],
  advisor_owned: ['appointment_scheduled', 'quote_requested', 'application_started', 'policy_issued', 'purchased_elsewhere', 'running', 'future_follow_up', 'compliance_hold', 'cancelled', 'suppressed', 'completed'],
  appointment_scheduled: [], // exit
  quote_requested: [], // exit
  application_started: [], // exit
  policy_issued: [], // exit
  purchased_elsewhere: [], // exit
  future_follow_up: ['queued', 'cancelled', 'suppressed'], // may re-enter after the follow-up date
  completed: [],
  suppressed: [],
  compliance_hold: ['running', 'cancelled', 'suppressed'],
  cancelled: [],
  failed: ['running', 'cancelled', 'suppressed'],
}

export function validateEnrollmentTransition(from: string, to: string): boolean {
  if (!(ENROLLMENT_STATES as readonly string[]).includes(from)) return false
  if (!(ENROLLMENT_STATES as readonly string[]).includes(to)) return false
  if (from === to) return true // idempotent no-op is always allowed
  return ENROLLMENT_TRANSITIONS[from as EnrollmentState].includes(to as EnrollmentState)
}
