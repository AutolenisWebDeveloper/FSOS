import Link from 'next/link'
import { Target, CalendarPlus, ClipboardList, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogActivityButton } from '@/components/app/LogActivityButton'

/*
 * Contact 360 Action Bar (redesign spec §4.2). The single, shared primary-action
 * strip for every customer-displaying surface — no page hand-rolls its own action
 * controls (design-system reuse §12). It links only to real, verified destinations
 * so there are no dead-ends (§21).
 *
 * Note on Call / SMS / Email: outbound communication is dispatcher-gated (§12,
 * consent + quiet-hours + DNC + firewall). Until the comms compose surface lands,
 * this bar exposes the log-interaction path (which feeds the Timeline) and the
 * navigational work actions, rather than a fabricated send button.
 */
export function ContactActionBar({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm">
        <Link href={`/app/opportunities/new?household=${id}`}>
          <Target className="h-4 w-4" /> New opportunity
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={`/app/reviews/new?household=${id}`}>
          <ClipboardList className="h-4 w-4" /> New review
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href="/app/booking">
          <CalendarPlus className="h-4 w-4" /> Schedule
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={`/app/households/${id}/members/new`}>
          <UserPlus className="h-4 w-4" /> Add member
        </Link>
      </Button>
      <LogActivityButton entityType="household" entityId={id} />
    </div>
  )
}
