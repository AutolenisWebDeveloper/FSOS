import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { getServerSession } from '@/lib/auth/session'
import { TemplateCreateForm, TemplateBulkTable } from '@/components/app/TemplateControls'
import { TemplateFilters } from '@/components/app/TemplateFilters'
import {
  ALL,
  buildCatalog,
  campaignKeys,
  facetCounts,
  filterCatalog,
  normalizeCampaign,
  normalizeFormat,
  type TemplateListRow,
  type TemplateUsageRow,
} from '@/lib/comms/template-catalog'

export const dynamic = 'force-dynamic'

/**
 * A repeated query param (`?q=a&q=b`, trivially produced by hand-editing a URL or by a
 * stale bookmark) arrives as an array, not a string. Typing it as `string` would make
 * `.trim()` throw and render a 500 instead of a list, so the param type is honest and
 * `firstParam` collapses it to the first value.
 */
type SearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

// OS-12 Templates (A2). Only approved templates are sendable. The list supports view
// filters — type (email / SMS / AI conversation) and campaign, plus name search — held in
// the URL query so a view is deep-linkable, and bulk administration (select multiple →
// approve / unapprove (approvers only) / delete (archive)) via the §8 command-bar pattern.
// Authority is enforced server-side; the filters are presentation only.
export default async function TemplatesPage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams

  const [templates, usage, session] = await Promise.all([
    load<TemplateListRow[]>(
      (db) => db.from('comm_templates').select('id, name, channel, category, approval_status, version').is('archived_at', null).order('updated_at', { ascending: false }),
      [],
    ),
    // Campaign membership + touch kind come from the ADR-033 cross-campaign catalog view.
    // Its `comm_templates` rows are the library itself (no campaign), so they are skipped.
    load<TemplateUsageRow[]>(
      (db) => db.from('comm_sendable_assets').select('template_id, campaign_key, kind').not('campaign_key', 'is', null),
      [],
    ),
    getServerSession(),
  ])

  const canApprove = !!session && session.roles.some((r) => ['compliance', 'supervisor', 'super_admin'].includes(r))

  return (
    <ListShell
      title="Templates"
      description="Pre-approved messages. Unapproved templates cannot be used by any campaign or agent."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Templates' }]}
    >
      {!templates.ok ? (
        <ErrorState description={templates.kind === 'not_configured' ? 'Database not configured.' : templates.message} />
      ) : (
        <TemplateLibrary
          catalog={buildCatalog(templates.data, usage.ok ? usage.data : [])}
          searchParams={sp}
          canApprove={canApprove}
          // The catalog view is a secondary signal: if it fails, campaign grouping falls back
          // to the category map rather than blanking the page.
          usageDegraded={!usage.ok}
        />
      )}
    </ListShell>
  )
}

function TemplateLibrary({
  catalog,
  searchParams,
  canApprove,
  usageDegraded,
}: {
  catalog: ReturnType<typeof buildCatalog>
  searchParams: SearchParams
  canApprove: boolean
  usageDegraded: boolean
}) {
  const format = normalizeFormat(firstParam(searchParams.format))
  const campaign = normalizeCampaign(firstParam(searchParams.campaign), campaignKeys(catalog))
  const q = firstParam(searchParams.q).trim()
  const active = { format, campaign, q }

  const facets = facetCounts(catalog, active)
  const rows = filterCatalog(catalog, active)
  const isFiltered = format !== ALL || campaign !== ALL || q !== ''

  return (
    <div className="space-y-6">
      {catalog.length === 0 ? (
        <EmptyState title="No templates yet" description="Create a draft below, then submit it for compliance approval." />
      ) : (
        <div className="space-y-3">
          <TemplateFilters formats={facets.formats} campaigns={facets.campaigns} current={active} />
          {usageDegraded ? (
            <p className="text-xs text-status-pending">
              Campaign grouping is partial — the cross-campaign asset catalog is unavailable, so templates are grouped by
              category only.
            </p>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState
              title="No templates match this view"
              description="No template matches the selected type, campaign, and search. Widen the filters to see the rest of the library."
              action={
                <Button asChild variant="outline">
                  <Link href="/app/comms/templates">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Showing {rows.length} of {facets.total} template{facets.total === 1 ? '' : 's'}
                {isFiltered ? ' in this view' : ''}.
              </p>
              <TemplateBulkTable templates={rows} canApprove={canApprove} />
            </>
          )}
        </div>
      )}
      <div className="rounded-lg border p-4">
        <p className="mb-3 text-sm font-medium">New template</p>
        <TemplateCreateForm />
      </div>
    </div>
  )
}
