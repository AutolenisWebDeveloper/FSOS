import Link from 'next/link'
import { Users, Target, CheckSquare, UserCheck, MessageSquare, BarChart3 } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { SecuritiesChip } from '@/components/ui/securities'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'
import { getSocialAttribution } from '@/lib/social/attribution'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function platformLabel(p: string): string {
  return p in PLATFORM_LABELS ? PLATFORM_LABELS[p as SocialPlatform] : p
}

export default async function SocialAttributionPage() {
  await requireRole('fsa', '/app/social/attribution')
  const res = await getSocialAttribution()
  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Attribution' },
  ]

  if (!res.ok) {
    return (
      <ListShell title="Social attribution" description="How social engagement connects to your book." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={UserCheck} title="Database not configured" description="Set the Supabase environment variables to load attribution." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const { summary, byPost, contacts, opportunities } = res.data
  const empty = summary.totalEngagements === 0

  return (
    <ListShell
      title="Social attribution"
      description="FSOS-attributed outcomes — the contacts, opportunities, and tasks that social engagement resolved to in your book. These are outcomes the module can prove it caused, and are distinct from platform-reported reach."
      breadcrumb={breadcrumb}
    >
      <div className="mb-4 flex items-center justify-between rounded-lg border border-shell-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">FSOS-attributed</strong> = outcomes resolved to existing CRM records. Platform-reported reach & impressions live in{' '}
          <Link href="/app/social/analytics" className="text-primary hover:underline">
            analytics
          </Link>
          .
        </span>
        <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Contacts touched" value={summary.contactsTouched} icon={Users} tone="brand" />
        <StatTile label="Opportunities" value={summary.opportunities} icon={Target} />
        <StatTile label="Tasks created" value={summary.tasks} icon={CheckSquare} />
        <StatTile label="Leads" value={summary.leads} icon={UserCheck} />
        <StatTile label="Unresolved" value={summary.unresolved} icon={MessageSquare} tone={summary.unresolved > 0 ? 'attention' : 'neutral'} hint={`${summary.resolved} resolved`} />
      </div>

      {empty ? (
        <EmptyState
          icon={UserCheck}
          title="No social engagement yet"
          description="Once inbound social engagement is ingested and triaged to contacts, its CRM attribution appears here."
          action={
            <Link href="/app/social/engagement" className="text-sm font-medium text-primary hover:underline">
              Go to engagement
            </Link>
          }
        />
      ) : (
        <>
          <Section title="Posts that drove outcomes" description="Ranked by the resolved contacts and opportunities each post's engagement produced.">
            {byPost.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No post-level attribution yet" description="Engagement not yet tied to a specific post appears under platform rollups." />
            ) : (
              <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
                {byPost.map((p, i) => (
                  <li key={`${p.platform}-${p.post_ref ?? 'none'}-${i}`} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {platformLabel(p.platform)}
                        {p.post_ref ? <span className="text-muted-foreground"> · {p.post_ref}</span> : <span className="text-muted-foreground"> · direct messages</span>}
                      </p>
                      <p className="numeric text-xs text-muted-foreground">{p.touches} touch{p.touches === 1 ? '' : 'es'}</p>
                    </div>
                    <div className="flex shrink-0 gap-4 text-right">
                      <div>
                        <p className="numeric text-sm font-semibold text-foreground">{p.resolvedContacts}</p>
                        <p className="text-[11px] text-muted-foreground">contacts</p>
                      </div>
                      <div>
                        <p className="numeric text-sm font-semibold text-foreground">{p.opportunities}</p>
                        <p className="text-[11px] text-muted-foreground">opps</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Contacts social touched" description="Existing contacts whose record was touched by social engagement." className="mt-6">
            {contacts.length === 0 ? (
              <EmptyState icon={Users} title="No contacts resolved yet" description="Triage engagement to a contact to see it attributed here." />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {contacts.map((c) => (
                  <li key={c.id} className="rounded-lg border border-shell-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/app/contacts/${c.id}`} className="truncate font-medium text-primary hover:underline">
                          {c.full_name || c.email || 'Contact'}
                        </Link>
                        {c.email ? <p className="truncate text-xs text-muted-foreground">{c.email}</p> : null}
                      </div>
                      {c.hasOpportunity ? (
                        <span className="shrink-0 rounded-md border border-status-won/30 bg-status-won/10 px-1.5 py-0.5 text-[11px] font-medium text-status-won">Opportunity</span>
                      ) : null}
                    </div>
                    <p className="numeric mt-2 text-xs text-muted-foreground">
                      {c.touches} social touch{c.touches === 1 ? '' : 'es'}
                      {c.lastPlatform ? ` · last on ${platformLabel(c.lastPlatform)}` : ''}
                      {c.lastAt ? ` · ${new Date(c.lastAt).toLocaleDateString()}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {opportunities.length > 0 ? (
            <Section title="Opportunities social touched" description="Existing opportunities that social engagement originated or advanced." className="mt-6">
              <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/app/opportunities/${o.id}`} className="text-sm font-medium text-primary hover:underline">
                        {o.stage || 'Opportunity'}
                      </Link>
                      {o.is_security ? <SecuritiesChip /> : null}
                    </div>
                    {o.expected_commission != null ? (
                      <span className="numeric text-xs text-muted-foreground">${Math.round(o.expected_commission).toLocaleString()}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </ListShell>
  )
}
