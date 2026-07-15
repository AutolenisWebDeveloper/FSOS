import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

// P-4 Schedule (A6). Book a meeting with the FSA (Google Calendar or manual fallback).
export default function PartnerSchedulePage() {
  return (
    <FormShell title="Schedule with your FSA" description="Book a meeting. If calendar sync is unavailable, your FSA confirms manually." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Schedule' }]}>
      <Card><CardContent className="space-y-3 py-6 text-sm">
        <p>Request a meeting and your FSA will confirm a time. Confirmations and reminders honor your consent + quiet hours.</p>
        <p className="text-muted-foreground">Google Calendar booking connects when configured; otherwise your FSA books manually (A12 fallback).</p>
      </CardContent></Card>
    </FormShell>
  )
}
