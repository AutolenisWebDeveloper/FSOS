import Link from 'next/link'
import { BarChart3, Send, Users, Target, ListTodo, MessageSquare } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { getSocialAnalytics } from '@/lib/social/analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function SocialAnalyticsPage() {
  await requireRole('fsa', '/app/social/analytics')
  const res = await getSocialAnalytics()

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Social', href: '/app/social' }, { label: 'Analytics' }]

  if (!res.ok) {
    return (
      <ListShell title="Social analytics" description="Platform metrics and FSOS-attributed outcomes." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={BarChart3} title="Database not configured" description="Set the Supabase environment variables to load analytics." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const { platformReported, attributed, hasPlatformData } = res.data
  const nf = new Intl.NumberFormat()

  return (
    <ListShell
      title="Social analytics"
      description="Platform-reported metrics come from each platform's API. FSOS-attributed outcomes are what the module can prove it caused — the two are kept distinct."
      breadcrumb={breadcrumb}
    >
      <Section title="FSOS-attributed outcomes" description="What social activity produced inside FSOS — posts published and CRM outcomes from engagement.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Posts published" value={attributed.published} icon={Send} tone="brand" />
          <StatTile label="Engagement (total)" value={attributed.engagementTotal} icon={MessageSquare} />
          <StatTile label="Leads identified" value={attributed.leads} icon={Users} tone={attributed.leads > 0 ? 'attention' : 'neutral'} />
          <StatTile label="Opportunities created" value={attributed.opportunities} icon={Target} />
          <StatTile label="Tasks created" value={attributed.tasks} icon={ListTodo} />
        </div>
      </Section>

      <Section
        title="Platform-reported metrics"
        description="Reach, impressions, followers, and click-throughs as reported by each connected platform's API."
        className="mt-6"
      >
        {!hasPlatformData ? (
          <EmptyState
            icon={BarChart3}
            title="No platform metrics yet"
            description="Platform metrics appear here once accounts are connected and analytics are captured. Publishing to a connected account and connecting analytics access populate this section."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-shell-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Platform</th>
                  <th className="p-3 text-right font-medium">Followers</th>
                  <th className="p-3 text-right font-medium">Reach</th>
                  <th className="p-3 text-right font-medium">Impressions</th>
                  <th className="p-3 text-right font-medium">Engagements</th>
                  <th className="p-3 text-right font-medium">Clicks</th>
                  <th className="p-3 font-medium">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-shell-border">
                {platformReported.map((p) => (
                  <tr key={p.platform}>
                    <td className="p-3 font-medium text-foreground">{p.label}</td>
                    <td className="numeric p-3 text-right">{p.followers === null ? '—' : nf.format(p.followers)}</td>
                    <td className="numeric p-3 text-right">{nf.format(p.reach)}</td>
                    <td className="numeric p-3 text-right">{nf.format(p.impressions)}</td>
                    <td className="numeric p-3 text-right">{nf.format(p.engagements)}</td>
                    <td className="numeric p-3 text-right">{nf.format(p.clicks)}</td>
                    <td className="numeric p-3 text-muted-foreground">{p.capturedAt ? new Date(p.capturedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Top-line social counters also appear as widgets on your{' '}
          <Link href="/app" className="text-primary hover:underline">
            Executive Dashboard
          </Link>{' '}
          — no separate dashboard to maintain.
        </p>
      </Section>
    </ListShell>
  )
}
