import Link from 'next/link'
import { DashboardShell, StatTile } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
import { EmailBriefingButton } from '@/components/app/EmailBriefingButton'

export const dynamic = 'force-dynamic'

// Executive Briefing (A1). AI-surfaced priorities from real signals (no product recs).
export default async function BriefingPage() {
  const [slaEsc, dueConv, discrepancies, escalations] = await Promise.all([
    load<{ id: string }[]>((db) => db.from('v_referrals_awaiting_action').select('id').eq('sla_breached', true).limit(500), []),
    load<{ policy_id: string }[]>((db) => db.from('v_conversions_due').select('policy_id').eq('urgency_tier', '30').eq('is_security', false).limit(500), []),
    load<{ id: string }[]>((db) => db.from('commissions').select('id').eq('reconciliation_status', 'discrepancy').limit(500), []),
    load<{ id: string }[]>((db) => db.from('agent_actions').select('id').eq('kind', 'escalation').eq('outcome', 'escalated').limit(500), []),
  ])

  const priorities = [
    { label: 'SLA-breached referrals', count: slaEsc.ok ? slaEsc.data.length : 0, href: '/app/referrals', note: 'Untouched past SLA — needs first touch.' },
    { label: 'Conversion windows ≤30d', count: dueConv.ok ? dueConv.data.length : 0, href: '/app/conversions/eligible?tier=30', note: 'Urgent — invite to a review (educational only).' },
    { label: 'Commission discrepancies', count: discrepancies.ok ? discrepancies.data.length : 0, href: '/app/commissions/discrepancies', note: 'Expected vs received gaps to resolve.' },
    { label: 'Open AI escalations', count: escalations.ok ? escalations.data.length : 0, href: '/app/ai/escalations', note: 'Human-handoff queue.' },
  ]

  return (
    <DashboardShell
      title="Executive Briefing"
      description="Today's priorities, surfaced from live signals. Never a product recommendation."
      actions={<EmailBriefingButton />}
    >
      {priorities.map((p) => (<StatTile key={p.label} label={p.label} value={p.count} href={p.href} hint={p.note} />))}
      <div className="sm:col-span-2 lg:col-span-4">
        <Card>
          <CardHeader><CardTitle className="text-base">What to do next</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {priorities.filter((p) => p.count > 0).length === 0 ? (
              <p className="text-muted-foreground">Nothing urgent. Review <Link href="/app/executive/kpis" className="text-primary hover:underline">KPIs</Link> and <Link href="/app/cross-sell/agency-penetration" className="text-primary hover:underline">agency penetration</Link>.</p>
            ) : priorities.filter((p) => p.count > 0).map((p) => (
              <p key={p.label}>• <Link href={p.href} className="text-primary hover:underline"><Numeric>{p.count}</Numeric> {p.label.toLowerCase()}</Link> — {p.note}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
