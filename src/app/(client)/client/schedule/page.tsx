import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
export const dynamic = 'force-dynamic'
// P-5 Schedule (A6). Book an appointment; confirmations/reminders through the gate.
export default function ClientSchedulePage() {
  return (
    <FormShell title="Schedule a meeting" description="Book time with your Farmers FSA." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Schedule' }]}>
      <Card><CardContent className="space-y-2 py-6 text-sm"><p>Request an appointment and we'll confirm a time. Confirmations and reminders honor your consent + quiet hours.</p><p className="text-muted-foreground">This never returns a product recommendation.</p></CardContent></Card>
    </FormShell>
  )
}
