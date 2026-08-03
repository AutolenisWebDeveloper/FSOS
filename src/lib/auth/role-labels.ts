// src/lib/auth/role-labels.ts
// Human-readable labels for the fixed RBAC role set. rbac.ts owns the role KEYS
// (the source of truth); this is only the display mapping, shared by every surface
// that lets an operator pick roles (CreateUserForm, UserRowActions) so labels never
// drift between them. Pure + client-safe (no server-only imports).

import type { Role } from './rbac'

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  fsa: 'FSA',
  licensed_staff: 'Licensed Staff',
  admin: 'Admin / Back-office',
  ops: 'Operations',
  case_manager: 'Case Manager',
  compliance: 'Compliance',
  supervisor: 'Supervisor',
  agency_owner: 'Agency Owner',
  client: 'Client',
}

/** Label for a role key, falling back to the raw key if it's ever unknown. */
export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role
}
