// src/lib/comms/template-catalog.ts
// Template-library view model — pure, DB-free (compile-testable, no imports).
//
// The Templates page (/app/comms/templates) administers `comm_templates` rows, but an
// operator does not think in `channel` + `category`: they think "show me the SMS assets
// for the Cross-Sell Life campaign" or "show me every AI conversation starter". This
// module derives those two axes from the data that already exists, so the page can offer
// real view filters without a schema change:
//
//   • FORMAT   — email | sms | ai_conversation. AI conversation starters are stored as
//                channel 'sms' (they open a conversational SMS thread), so channel alone
//                cannot distinguish them. The authoritative signal is the campaign touch
//                row's kind ('ai_conversation'), normalized by the `comm_sendable_assets`
//                view (migration 087 / ADR-033). The `*_ai` category suffix is the
//                fallback for a template seeded for a campaign but not yet wired to a
//                touch row.
//   • CAMPAIGN — which campaign(s) reference the template, from the same view. Templates
//                referenced by no campaign are the standalone Template Library. The
//                category → campaign map is, again, the fallback for unwired rows.
//
// Nothing here reads the database: the page loads `comm_templates` + the usage rows and
// hands them to `buildCatalog`. Keeping it pure is what makes the filter semantics
// provable in tests/comms-template-filters.test.mjs.

/** The three groups an operator picks between. `advisor_outreach` is not a template. */
export type TemplateFormat = 'email' | 'sms' | 'ai_conversation'

export const TEMPLATE_FORMATS: readonly TemplateFormat[] = ['email', 'sms', 'ai_conversation']

export const FORMAT_LABELS: Record<TemplateFormat, string> = {
  email: 'Email',
  sms: 'SMS',
  ai_conversation: 'AI conversation',
}

/** Sentinel campaign key for templates no campaign references (the standalone library). */
export const LIBRARY_KEY = '__library'

/** The sentinel every filter uses for "don't filter on this axis". */
export const ALL = 'all'

/**
 * Human labels for the campaign groupings. Single definition for the whole comms module —
 * `@/lib/comms/assets` re-exports these so the console picker and the template library
 * label a campaign identically (CLAUDE.md §6: one pattern, not two).
 */
export const CAMPAIGN_LABELS: Record<string, string> = {
  life_conversion: 'Life Conversion',
  cross_sell_life: 'Cross-Sell Life',
  pipeline_winback: 'Pipeline Win-Back',
  district_nurture: 'The Second Conversation',
  workshops: 'Workshops',
  [LIBRARY_KEY]: 'Template Library',
}

/** Stable display order for the campaign filter; unknown keys sort alphabetically after. */
const CAMPAIGN_ORDER = ['life_conversion', 'cross_sell_life', 'pipeline_winback', 'district_nurture', 'workshops']

/** The stable label for a catalog row's campaign grouping. */
export function campaignLabel(campaignKey: string | null): string {
  return campaignKey ? (CAMPAIGN_LABELS[campaignKey] ?? campaignKey) : CAMPAIGN_LABELS[LIBRARY_KEY]
}

/**
 * Category → campaign key. The campaign seeds (migrations 082/084/086) stamp each
 * template's category with its campaign, so a template that exists but is not yet
 * referenced by a touch row still files under the right campaign instead of falling
 * through to the library.
 */
const CATEGORY_CAMPAIGN: Record<string, string> = {
  life_conversion: 'life_conversion',
  life_conversion_ai: 'life_conversion',
  cross_sell_life: 'cross_sell_life',
  cross_sell_life_ai: 'cross_sell_life',
  pipeline_winback: 'pipeline_winback',
  pipeline_winback_ai: 'pipeline_winback',
  district_nurture: 'district_nurture',
  district_nurture_ai: 'district_nurture',
}

/** A `comm_templates` row as the list page selects it. */
export interface TemplateListRow {
  id: string
  name: string
  channel: string
  category: string | null
  approval_status: string
  version: number
}

/**
 * One campaign→template reference, from `comm_sendable_assets` (the library rows of that
 * view — source_table 'comm_templates' — are skipped by the caller: they carry no campaign).
 */
export interface TemplateUsageRow {
  template_id: string | null
  campaign_key: string | null
  kind: string | null
}

/** A template with its derived view axes. */
export interface CatalogTemplate extends TemplateListRow {
  format: TemplateFormat
  /** Campaign keys referencing this template, or `[LIBRARY_KEY]` when none does. */
  campaigns: string[]
}

/**
 * Derive the operator-facing format. Touch `kind` wins because it is what the campaign
 * engine actually dispatches; the `*_ai` category suffix is the unwired-template fallback.
 */
export function deriveFormat(channel: string, category: string | null, kinds: readonly string[] = []): TemplateFormat {
  if (kinds.indexOf('ai_conversation') !== -1) return 'ai_conversation'
  if ((category ?? '').endsWith('_ai')) return 'ai_conversation'
  return channel === 'email' ? 'email' : 'sms'
}

/** Sort campaign keys into the stable display order (known first, then alphabetical, library last). */
function sortCampaigns(keys: string[]): string[] {
  return keys.slice().sort((a, b) => {
    if (a === b) return 0
    if (a === LIBRARY_KEY) return 1
    if (b === LIBRARY_KEY) return -1
    const ia = CAMPAIGN_ORDER.indexOf(a)
    const ib = CAMPAIGN_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}

/** Join `comm_templates` rows to their campaign usage and derive format + campaigns. */
export function buildCatalog(templates: readonly TemplateListRow[], usage: readonly TemplateUsageRow[] = []): CatalogTemplate[] {
  const kindsByTemplate = new Map<string, Set<string>>()
  const campaignsByTemplate = new Map<string, Set<string>>()
  for (const u of usage) {
    if (!u.template_id) continue
    if (u.kind) {
      const k = kindsByTemplate.get(u.template_id) ?? new Set<string>()
      k.add(u.kind)
      kindsByTemplate.set(u.template_id, k)
    }
    if (u.campaign_key) {
      const c = campaignsByTemplate.get(u.template_id) ?? new Set<string>()
      c.add(u.campaign_key)
      campaignsByTemplate.set(u.template_id, c)
    }
  }

  return templates.map((t) => {
    const kinds = [...(kindsByTemplate.get(t.id) ?? [])]
    const campaigns = new Set(campaignsByTemplate.get(t.id) ?? [])
    const fromCategory = t.category ? CATEGORY_CAMPAIGN[t.category] : undefined
    if (fromCategory) campaigns.add(fromCategory)
    return {
      ...t,
      format: deriveFormat(t.channel, t.category, kinds),
      campaigns: campaigns.size ? sortCampaigns([...campaigns]) : [LIBRARY_KEY],
    }
  })
}

// ─── View filters ─────────────────────────────────────────────────────────────

export interface TemplateViewFilters {
  /** 'all' | TemplateFormat */
  format?: string | null
  /** 'all' | campaign key | LIBRARY_KEY */
  campaign?: string | null
  /** free-text over name + category */
  q?: string | null
}

/** Coerce an untrusted query param to a known format, or `ALL`. */
export function normalizeFormat(value: string | null | undefined): TemplateFormat | typeof ALL {
  return TEMPLATE_FORMATS.indexOf(value as TemplateFormat) !== -1 ? (value as TemplateFormat) : ALL
}

/**
 * Coerce an untrusted campaign param. Any key present in the catalog is allowed (so a
 * campaign added later needs no change here); anything else falls back to `ALL`.
 */
export function normalizeCampaign(value: string | null | undefined, known: readonly string[]): string {
  if (!value || value === ALL) return ALL
  return known.indexOf(value) !== -1 ? value : ALL
}

function matchesQuery(t: CatalogTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return t.name.toLowerCase().includes(needle) || (t.category ?? '').toLowerCase().includes(needle)
}

/** Apply the active view filters. Unknown/absent values mean "no constraint on that axis". */
export function filterCatalog(rows: readonly CatalogTemplate[], f: TemplateViewFilters = {}): CatalogTemplate[] {
  const format = f.format && f.format !== ALL ? f.format : null
  const campaign = f.campaign && f.campaign !== ALL ? f.campaign : null
  const q = f.q ?? ''
  return rows.filter((t) => {
    if (format && t.format !== format) return false
    if (campaign && t.campaigns.indexOf(campaign) === -1) return false
    if (!matchesQuery(t, q)) return false
    return true
  })
}

export interface FacetCount {
  value: string
  label: string
  count: number
}

export interface CatalogFacets {
  /** Format counts, honoring the campaign + search filters (never the format filter itself). */
  formats: FacetCount[]
  /** Campaign counts, honoring the format + search filters (never the campaign filter itself). */
  campaigns: FacetCount[]
  /** Rows matching every active filter. */
  matching: number
  /** Rows in the catalog, before any filter. */
  total: number
}

/**
 * Facet counts for the filter bar. Each axis is counted with the OTHER axes applied, so a
 * count never advertises a combination that would return nothing — picking "SMS" while
 * "Cross-Sell Life" is active shows how many Cross-Sell SMS templates exist, not how many
 * SMS templates exist overall.
 */
export function facetCounts(rows: readonly CatalogTemplate[], f: TemplateViewFilters = {}): CatalogFacets {
  const forFormats = filterCatalog(rows, { campaign: f.campaign, q: f.q })
  const forCampaigns = filterCatalog(rows, { format: f.format, q: f.q })

  const formats: FacetCount[] = [
    { value: ALL, label: 'All types', count: forFormats.length },
    ...TEMPLATE_FORMATS.map((fmt) => ({
      value: fmt,
      label: FORMAT_LABELS[fmt],
      count: forFormats.filter((t) => t.format === fmt).length,
    })),
  ]

  const keys = new Set<string>()
  for (const t of rows) for (const c of t.campaigns) keys.add(c)
  const campaigns: FacetCount[] = [
    { value: ALL, label: 'All campaigns', count: forCampaigns.length },
    ...sortCampaigns([...keys]).map((key) => ({
      value: key,
      label: campaignLabel(key),
      count: forCampaigns.filter((t) => t.campaigns.indexOf(key) !== -1).length,
    })),
  ]

  return { formats, campaigns, matching: filterCatalog(rows, f).length, total: rows.length }
}

/** Every campaign key present in the catalog — the allow-list for `normalizeCampaign`. */
export function campaignKeys(rows: readonly CatalogTemplate[]): string[] {
  const keys = new Set<string>()
  for (const t of rows) for (const c of t.campaigns) keys.add(c)
  return sortCampaigns([...keys])
}
