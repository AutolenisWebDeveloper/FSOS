// src/lib/comms/consent-group-backfill-run.ts
// RETROACTIVE consent-group backfill — seed the prior-express consent the §12 gate requires
// for contacts ALREADY imported into a group, where consent was never seeded at import time
// (the legacy per-group importers, and any pre-consent-group batch, wrote no `consents` rows).
//
// This is NOT a second grant path. It only RESOLVES the existing population — contacts whose
// `contacts.tags` overlap the group's import-tag set (consent-groups.ts `groupImportTags`),
// mapped to their materialized `household_members` (the campaign-targetable member spine) via
// `source_contact_id` — and then delegates to the SAME suppression-aware, idempotent, audited
// runner the importer uses (grantConsentForGroup). So every guarantee still holds:
//   • a later opt-out ALWAYS wins (existing revoke / channel DNC / do_not_contact household);
//   • re-running never duplicates or overwrites (unique(member_id,channel) + ON CONFLICT);
//   • the group's documented disclosure is written verbatim onto every seeded row (§13.9);
//   • the bulk grant is itself one audited event.
//
// The operator must ATTEST at the route (as at import), and a dry-run preview shows the exact
// resolved count + per-reason skips BEFORE any write — the mapping is never a silent guess.
// Thin service: business logic out of the route (CLAUDE.md §3.1).

import { groupImportTags, type ConsentGroup } from './consent-groups'
import { grantConsentForGroup, type GrantConsentForGroupResult } from './consent-group-grant-run'
import { resolveContactTagPopulation, type ResolvedTagPopulation } from './bulk-consent-run'
import type { PopChannel } from './consent-population'

/** Alias kept for the existing backfill route/UI; the shared resolver is tag-driven. */
export type ResolvedGroupPopulation = ResolvedTagPopulation

/**
 * Resolve the already-imported population for a group: its import-tags → matched contacts →
 * their materialized members. Reads only. Delegates to the shared tag-population resolver
 * (bulk-consent-run.ts) so the backfill and the bulk-tag tool resolve populations identically.
 */
export async function resolveImportedGroupPopulation(group: ConsentGroup): Promise<ResolvedGroupPopulation> {
  return resolveContactTagPopulation(groupImportTags(group))
}

export interface BackfillGroupConsentOptions {
  group: ConsentGroup
  channels: PopChannel[]
  actor: string
  /** Preview only — resolve + plan, write nothing. */
  dryRun?: boolean
}

export interface BackfillGroupConsentResult extends GrantConsentForGroupResult {
  population: ResolvedGroupPopulation
}

/**
 * Backfill consent for a group's already-imported population. Resolves the members by tag, then
 * runs the shared grant (dry-run for preview, real for commit). Returns the grant report plus
 * the resolved-population breakdown so the UI can show "N contacts → M members reachable".
 */
export async function backfillGroupConsent(opts: BackfillGroupConsentOptions): Promise<BackfillGroupConsentResult> {
  const { group, channels, actor, dryRun } = opts
  const population = await resolveImportedGroupPopulation(group)
  const report = await grantConsentForGroup({
    memberIds: population.memberIds,
    group,
    channels,
    actor,
    dryRun,
  })
  return { ...report, population }
}
