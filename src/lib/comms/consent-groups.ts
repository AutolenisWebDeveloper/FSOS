// src/lib/comms/consent-groups.ts
// A2P 10DLC / TCPA — the CONSENT-GROUP registry. PURE (no DB, no clock) so it is unit-
// testable offline (tests/consent-groups.test.mjs).
//
// A "consent group" is a documented BASIS on which a batch of contacts already provided the
// prior express consent the §12 gate requires. Bulk contact import lets a licensed operator
// attach one of these groups to a batch so the system generates the member-keyed `consents`
// rows automatically — instead of opening every contact by hand — WITHOUT ever inventing
// consent that does not exist:
//   • the group's `disclosure` is written verbatim onto every seeded row, so each record
//     honestly states WHY consent exists (TCPA defense / audit, §13.9);
//   • the grant only ever ADDS consent — the shared suppression core (consent-population.ts)
//     still lets a later opt-out (revoke / channel DNC / do_not_contact household) win, so a
//     bulk grant can never re-consent someone who opted out;
//   • the operator must ATTEST to the group at import time (route-enforced); the attestation
//     is itself audited. The disclosure text lives in the repo (reviewable, version-
//     controlled) rather than being typed ad-hoc — a config default under CLAUDE.md §4.3.
//
// These four groups are the FSA's existing consented books. New groups are added here (one
// entry) — never by hand-writing a disclosure at the call site.

import type { PopChannel } from './consent-population'

export type ConsentGroupKey = 'district_book' | 'cross_sell_life' | 'win_back' | 'life_conversion'

export interface ConsentGroup {
  key: ConsentGroupKey
  /** Operator-facing label. */
  label: string
  /** Short line shown under the label in the picker. */
  hint: string
  /** The documented basis of consent — written verbatim onto every seeded consents row. */
  disclosure: string
  /** Provenance label recorded in `consents.source` (and the audit/timeline entry). */
  source: string
  /** Contact tag stamped on imported contacts so the group is visible on the record. */
  tag: string
  /**
   * The `contacts.tags` values that identify a member as ALREADY-IMPORTED into this group.
   * Used by the retroactive backfill (consent-group-backfill-run.ts) to resolve the existing
   * population when consent was never seeded at import time. This is a REVIEWABLE, editable
   * config default (CLAUDE.md §4.3): it always includes this group's own `tag` plus the
   * marker(s) the legacy per-group importers stamped (which predate the consent-group tag).
   * A contact matching any one of these tags is in-population; the operator still reviews the
   * resolved count and ATTESTS before any consent is written, and suppression always wins.
   */
  importTags: string[]
  /** Channels this group is permitted to seed. A per-import selection is intersected with this. */
  channels: PopChannel[]
}

export const CONSENT_GROUPS: Record<ConsentGroupKey, ConsentGroup> = {
  district_book: {
    key: 'district_book',
    label: 'District Book',
    hint: 'Existing book-of-business clients from a partner agency district.',
    disclosure:
      'District Book import — existing agency book-of-business client with communications opt-in on file at the referring agency. Prior express consent asserted by the licensed FSA at import.',
    source: 'import_group:district_book',
    tag: 'district-book',
    // 'fnwl-book' is the marker the in-force / district book importer stamps.
    importTags: ['district-book', 'fnwl-book'],
    channels: ['sms', 'email'],
  },
  cross_sell_life: {
    key: 'cross_sell_life',
    label: 'Cross-Sell Life',
    hint: 'Existing non-life clients who consented to life-product outreach.',
    disclosure:
      'Cross-Sell Life import — existing client of the practice with prior express consent to be contacted about life products. Consent asserted by the licensed FSA at import.',
    source: 'import_group:cross_sell_life',
    tag: 'cross-sell-life',
    // 'cross-sell' is the marker the cross-sell importer stamps.
    importTags: ['cross-sell-life', 'cross-sell'],
    channels: ['sms', 'email'],
  },
  win_back: {
    key: 'win_back',
    label: 'Win-Back',
    hint: 'Lapsed clients re-engaged with consent on file.',
    disclosure:
      'Win-Back import — former client with communications opt-in on file, re-engaged for lapsed coverage. Prior express consent asserted by the licensed FSA at import.',
    source: 'import_group:win_back',
    tag: 'win-back',
    // The win-back importer stamps the same 'win-back' marker as the consent-group tag.
    importTags: ['win-back'],
    channels: ['sms', 'email'],
  },
  life_conversion: {
    key: 'life_conversion',
    label: 'Life Conversion',
    hint: 'Term policyholders eligible for conversion who consented to outreach.',
    disclosure:
      'Life Conversion import — existing term policyholder with prior express consent to be contacted about conversion options. Consent asserted by the licensed FSA at import.',
    source: 'import_group:life_conversion',
    tag: 'life-conversion',
    // 'term-conversion' is the marker the conversion-list importer stamps.
    importTags: ['life-conversion', 'term-conversion'],
    channels: ['sms', 'email'],
  },
}

export const CONSENT_GROUP_KEYS = Object.keys(CONSENT_GROUPS) as ConsentGroupKey[]

/** Type guard for an incoming (untrusted) group key. */
export function isConsentGroupKey(x: unknown): x is ConsentGroupKey {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CONSENT_GROUPS, x)
}

/** Resolve a group by key, or null if the key is unknown. */
export function resolveConsentGroup(key: unknown): ConsentGroup | null {
  return isConsentGroupKey(key) ? CONSENT_GROUPS[key] : null
}

/**
 * The de-duplicated, normalized `contacts.tags` values that mark a member as already-imported
 * into this group — the population the retroactive backfill grants consent to. Always non-empty
 * (every group at least matches its own `tag`). Tags are lower-cased/trimmed to match the way
 * importers stamp them, so the resolver's overlap query is exact.
 */
export function groupImportTags(group: ConsentGroup): string[] {
  const tags = [group.tag, ...group.importTags].map((t) => String(t).trim().toLowerCase()).filter(Boolean)
  return Array.from(new Set(tags))
}

/**
 * The channels to actually seed for a group given the operator's per-import request. The
 * request is intersected with the group's permitted channels (a group can never seed a
 * channel it does not cover), de-duplicated, and returned in a stable sms→email order. An
 * empty/absent request defaults to the group's full channel set.
 */
export function selectableChannels(group: ConsentGroup, requested?: readonly string[] | null): PopChannel[] {
  const allowed = new Set(group.channels)
  const order: PopChannel[] = ['sms', 'email']
  if (!requested || requested.length === 0) return order.filter((c) => allowed.has(c))
  const want = new Set(requested.map((c) => String(c).trim().toLowerCase()))
  return order.filter((c) => allowed.has(c) && want.has(c))
}
