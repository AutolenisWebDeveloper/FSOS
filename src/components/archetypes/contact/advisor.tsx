import Link from 'next/link'
import { Sparkles, AlertTriangle, Lightbulb, Info, ArrowRight } from 'lucide-react'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildAdvisor, type AdvisorSeverity } from '@/lib/contacts/advisor'

/*
 * Contact 360 AI Advisor panel (redesign spec §8) — persistent, GREEN ZONE.
 * Renders the deterministic, data-grounded insight engine (src/lib/contacts/
 * advisor.ts): facts, deadlines, and gaps, plus WORKFLOW-only recommended
 * actions. It never recommends a product or makes a suitability determination
 * (guardrail §4.2); is_security signals are excluded (firewall §4.1). Server
 * component — RLS scopes every read to the caller's book.
 */

const SEVERITY_ICON: Record<AdvisorSeverity, typeof Info> = {
  high: AlertTriangle,
  medium: Lightbulb,
  info: Info,
}
const SEVERITY_CLASS: Record<AdvisorSeverity, string> = {
  high: 'text-status-blocked',
  medium: 'text-primary',
  info: 'text-muted-foreground',
}

export async function ContactAdvisor({ id, doNotContact }: { id: string; doNotContact: boolean }) {
  const [members, policies, reviews, openOpps] = await Promise.all([
    load<{ relationship: string | null }[]>((db) => db.from('household_members').select('relationship').eq('household_id', id).is('deleted_at', null), []),
    load<{ is_with_us: boolean; is_security: boolean; status: string; conversion_deadline: string | null }[]>(
      (db) => db.from('household_policies').select('is_with_us, is_security, status, conversion_deadline').eq('household_id', id).is('deleted_at', null),
      [],
    ),
    load<{ created_at: string }[]>((db) => db.from('reviews').select('created_at').eq('household_id', id).is('deleted_at', null), []),
    load<{ id: string }[]>((db) => db.from('opportunities').select('id').eq('household_id', id).is('deleted_at', null).not('stage', 'in', '(placed_issued,lost)'), []),
  ])

  const advisor = buildAdvisor({
    householdId: id,
    doNotContact,
    members: members.ok ? members.data : [],
    policies: policies.ok ? policies.data : [],
    reviews: reviews.ok ? reviews.data : [],
    openOpportunities: openOpps.ok ? openOpps.data.length : 0,
  })

  return (
    <Card className="border-primary/25 bg-primary-soft/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> AI Advisor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {advisor.insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No advisor signals right now — nothing needs attention on this contact.</p>
        ) : (
          <ul className="space-y-2">
            {advisor.insights.map((insight) => {
              const Icon = SEVERITY_ICON[insight.severity]
              return (
                <li key={insight.id} className="flex items-start gap-2 text-sm">
                  <Icon className={'mt-0.5 h-4 w-4 shrink-0 ' + SEVERITY_CLASS[insight.severity]} strokeWidth={1.9} aria-hidden />
                  <span>{insight.text}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {advisor.actions.map((action) => (
            <Button key={action.label} asChild size="sm" variant="outline">
              <Link href={action.href}>
                {action.label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{advisor.disclaimer}</p>
      </CardContent>
    </Card>
  )
}
