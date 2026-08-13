// src/lib/district-nurture/engine.ts
// Shared campaign-engine primitives for the District Agent FS Nurture Campaign (ADR-038 §3).
//
// The campaign/enrollment STATE MACHINE, the ADVISOR-TOUCH policy (used here for the
// quarterly LIVE touchpoints), and the CONVERSATION timeout/owner logic are module-agnostic
// and identical across the campaign engines. Per CLAUDE.md §6 (never duplicate a subsystem)
// they are reused verbatim from the first consumer (src/lib/life-campaign/*) through this
// single documented barrel — district-nurture code never reaches into the life-campaign
// namespace directly. (Re-homing these to a neutral campaign-engine namespace is the future
// refactor tracked in ADR-031 §3.)
export {
  CAMPAIGN_STATES,
  ENROLLMENT_STATES,
  canDispatch,
  canTransition,
  controlTargetState,
  enrollmentCanReceiveTouch,
} from '@/lib/life-campaign/states'
export type { CampaignState, ControlAction, EnrollmentState } from '@/lib/life-campaign/states'

export { advisorTouchState, campaignProceedsPastAdvisor } from '@/lib/life-campaign/advisor'
export type { AdvisorTouchInput, AdvisorTouchState, AdvisorTouchStatus } from '@/lib/life-campaign/advisor'

export { evaluateConversationTimeout, resolveOwner } from '@/lib/life-campaign/conversation'
export type { ConversationTimeoutInput, ConversationTimeoutDecision, OwnerInput } from '@/lib/life-campaign/conversation'
