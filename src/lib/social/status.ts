// Social content lifecycle — pure transition logic (ADR-025).
//
//   DRAFT → IN_REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED → FAILED → ARCHIVED
//
// Only an APPROVED version may be scheduled or published. These pure helpers are
// the service-layer half of the approval gate (the DB trigger is the other half).

export type SocialContentStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'ARCHIVED'

export type SocialVersionStatus = 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'SUPERSEDED'

// Allowed content status transitions. ARCHIVED is reachable from most states
// (content can always be retired); FAILED can retry back to SCHEDULED.
const CONTENT_TRANSITIONS: Record<SocialContentStatus, SocialContentStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'DRAFT', 'ARCHIVED'], // request-changes returns to DRAFT
  APPROVED: ['SCHEDULED', 'PUBLISHING', 'DRAFT', 'ARCHIVED'], // editing an approved item re-drafts (new version)
  SCHEDULED: ['PUBLISHING', 'APPROVED', 'ARCHIVED'], // un-schedule returns to APPROVED
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: ['ARCHIVED'],
  FAILED: ['SCHEDULED', 'ARCHIVED'], // retry
  ARCHIVED: [],
}

export function canTransitionContent(from: SocialContentStatus, to: SocialContentStatus): boolean {
  if (from === to) return true
  return CONTENT_TRANSITIONS[from]?.includes(to) ?? false
}

// The approval gate: a version is publishable/schedulable ONLY when APPROVED
// (or already PUBLISHED, e.g. a re-publish/analytics backfill). Anything else is
// hard-blocked (build instruction §0.B — ERROR: publishing unapproved content).
export function isVersionPublishable(status: SocialVersionStatus): boolean {
  return status === 'APPROVED' || status === 'PUBLISHED'
}

export function assertVersionPublishable(status: SocialVersionStatus): void {
  if (!isVersionPublishable(status)) {
    throw new Error(`Only an APPROVED version may be scheduled or published (version is ${status})`)
  }
}
