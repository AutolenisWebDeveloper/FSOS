// src/lib/comms/template-admin.ts
// PURE authorization + state-transition logic for BULK template administration
// (approve / unapprove / delete). Kept dependency-free so the permission matrix is
// unit-testable offline (tests/template-bulk.test.mjs) without a live Supabase or
// Next runtime — mirroring the pattern used by lib/auth/rbac.ts and lib/comms/gate.ts.
//
// Approval authority is separated from authoring: an FSA/licensed_staff author may
// create, edit, submit, and remove (archive) their own templates, but ONLY
// compliance / supervisor / super_admin may approve or unapprove — the same
// separation the single-template route enforces (docs §4.2, rbac-matrix). This file
// is the single source of truth for that separation across the single + bulk routes.

export const TEMPLATE_BULK_ACTIONS = ['approve', 'unapprove', 'delete'] as const
export type TemplateBulkAction = (typeof TEMPLATE_BULK_ACTIONS)[number]

/** Roles that may approve / unapprove a template (approval authority). */
export const TEMPLATE_APPROVER_ROLES = ['compliance', 'supervisor', 'super_admin'] as const

/** Roles that may manage (delete/archive) a template. */
export const TEMPLATE_MANAGER_ROLES = [
  'fsa',
  'licensed_staff',
  'super_admin',
  'compliance',
  'supervisor',
] as const

export interface BulkPermission {
  allowed: boolean
  /** Machine-readable reason when denied (surfaced to the client + audit). */
  reason?: 'insufficient_permission'
}

/**
 * Decide whether the given roles may perform a bulk template action.
 * - approve/unapprove → approver roles only (authoring cannot approve its own work).
 * - delete → template manager roles (authors + approvers).
 */
export function canBulkTemplateAction(action: TemplateBulkAction, roles: readonly string[]): BulkPermission {
  const need: readonly string[] = action === 'delete' ? TEMPLATE_MANAGER_ROLES : TEMPLATE_APPROVER_ROLES
  if (roles.some((r) => need.includes(r))) return { allowed: true }
  return { allowed: false, reason: 'insufficient_permission' }
}

export interface BulkPlan {
  /** Fields to write to every matched row. */
  patch: Record<string, unknown>
  /** approval_status the row must currently hold to be eligible (null = any). */
  requireStatus: string | null
  /** true → the row must currently be non-approved to be eligible (approve is a no-op on approved). */
  excludeApproved: boolean
  /** The audit action written per affected row. */
  audit: 'approval.decided' | 'entity.deleted'
}

/**
 * Build the deterministic DB plan for a bulk action. The route applies `patch` to
 * the selected, NON-archived rows that satisfy the eligibility filter, so an
 * already-approved row is skipped by approve, a non-approved row is skipped by
 * unapprove, and an already-archived row is skipped by delete (idempotent).
 */
export function bulkTemplatePlan(action: TemplateBulkAction, nowIso: string, actor: string): BulkPlan {
  switch (action) {
    case 'approve':
      return {
        patch: { approval_status: 'approved', approved_at: nowIso, approved_by: actor },
        requireStatus: null,
        excludeApproved: true,
        audit: 'approval.decided',
      }
    case 'unapprove':
      // Reset to draft (mirrors a reject) so it cannot send until re-approved.
      return {
        patch: { approval_status: 'draft', approved_at: null, approved_by: null },
        requireStatus: 'approved',
        excludeApproved: false,
        audit: 'approval.decided',
      }
    case 'delete':
      // Soft-delete: archive. The send gate already treats archived_at as unsendable
      // (lib/comms/send.ts) and FK refs are ON DELETE SET NULL, so history is preserved.
      return {
        patch: { archived_at: nowIso, updated_by: actor, updated_at: nowIso },
        requireStatus: null,
        excludeApproved: false,
        audit: 'entity.deleted',
      }
  }
}
