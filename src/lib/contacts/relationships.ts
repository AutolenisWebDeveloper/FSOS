/*
 * Relationship Intelligence (redesign spec §10) — classify a household member's
 * free-text `relationship` into a canonical role so the People section can render
 * the household as a relationship graph rather than a flat list. Non-person
 * entities (business, trust) and the referring agent are first-class node types.
 *
 * Pure and self-contained (no cross-module imports) so it is unit-testable in
 * isolation and shared by the People graph and any future work-item that groups a
 * household by role.
 */

export type RoleCategory =
  | 'primary'
  | 'joint'
  | 'dependent'
  | 'beneficiary'
  | 'business'
  | 'trust'
  | 'other'

export interface RoleMeta {
  key: RoleCategory
  label: string
  /** Whether this node represents a non-person entity (business/trust). */
  entity: boolean
  /** Display order in the graph (lower = higher). */
  order: number
}

export const ROLE_META: Record<RoleCategory, RoleMeta> = {
  primary: { key: 'primary', label: 'Primary owner', entity: false, order: 0 },
  joint: { key: 'joint', label: 'Joint owner', entity: false, order: 1 },
  dependent: { key: 'dependent', label: 'Child / dependent', entity: false, order: 2 },
  beneficiary: { key: 'beneficiary', label: 'Beneficiary', entity: false, order: 3 },
  business: { key: 'business', label: 'Business', entity: true, order: 4 },
  trust: { key: 'trust', label: 'Trust', entity: true, order: 5 },
  other: { key: 'other', label: 'Other', entity: false, order: 6 },
}

// Ordered rules — first match wins. Entity checks precede person roles so a
// "business trustee" reads as an entity, and "joint owner" never collapses to
// "owner"/primary.
const RULES: { re: RegExp; category: RoleCategory }[] = [
  { re: /\b(business|company|corp|corporation|llc|inc|enterprise|entity|partnership)\b/i, category: 'business' },
  { re: /trust/i, category: 'trust' },
  { re: /benefician|beneficiary/i, category: 'beneficiary' },
  { re: /\b(child|children|son|daughter|dependent|dependant|minor|kid)\b/i, category: 'dependent' },
  { re: /\b(joint|co-?owner|spouse|partner|husband|wife)\b/i, category: 'joint' },
  { re: /\b(primary|owner|self|head|policyholder|insured|applicant)\b/i, category: 'primary' },
]

/** Map a free-text relationship (and optional name) to a canonical role. */
export function classifyRelationship(relationship: string | null | undefined, name?: string | null): RoleCategory {
  const hay = `${relationship ?? ''} ${name ?? ''}`.trim()
  if (!hay) return 'other'
  for (const rule of RULES) if (rule.re.test(hay)) return rule.category
  return 'other'
}

export interface MemberNode<T> {
  category: RoleCategory
  member: T
}

export interface RoleGroup<T> {
  meta: RoleMeta
  members: T[]
}

/**
 * Group members into ordered role groups. Empty categories are omitted. Each
 * input member is classified from its relationship + name.
 */
export function groupByRole<T extends { relationship: string | null; full_name?: string | null }>(members: T[]): RoleGroup<T>[] {
  const buckets = new Map<RoleCategory, T[]>()
  for (const m of members) {
    const cat = classifyRelationship(m.relationship, m.full_name)
    const arr = buckets.get(cat) ?? []
    arr.push(m)
    buckets.set(cat, arr)
  }
  return Array.from(buckets.entries())
    .map(([key, list]) => ({ meta: ROLE_META[key], members: list }))
    .sort((a, b) => a.meta.order - b.meta.order)
}
