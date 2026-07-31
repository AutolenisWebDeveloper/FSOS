// src/lib/pipeline-winback/engine.ts
// Shared campaign-engine primitives for the Pipeline Win-Back Campaign (ADR-031 §3).
//
// The campaign/enrollment STATE MACHINE, the ADVISOR-TOUCH policy, and the CONVERSATION
// timeout/owner logic are module-agnostic and IDENTICAL between the Life Conversion Campaign
// and Pipeline Win-Back. Per CLAUDE.md §6 (never duplicate a subsystem) they are reused
// verbatim from the first consumer (src/lib/life-campaign/*) rather than re-copied. This
// barrel is the single, documented seam so pipeline-winback code never reaches into the
// life-campaign namespace directly — re-homing these primitives to a neutral `campaign-engine`
// namespace is a future refactor tracked in ADR-031 (deferred only because the life-campaign
// pure files are covered by brittle isolated-compile tests).
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
