import Link from 'next/link'
import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
export const dynamic = 'force-dynamic'
// P-5 Schedule (A6). Book an appointment via the native scheduler (ADR-027);
// confirmations/reminders flow through the comms gate (consent + quiet hours honored).
export default function ClientSchedulePage() {
  return (
    <FormShell
      title="Schedule a meeting"
      description="Book time with your Farmers FSA."
      breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Schedule' }]}
    >
      <Card>
        <CardContent className="space-y-4 py-6 text-sm">
          <p>Pick a time that works for you. You&rsquo;ll choose from real openings in your own timezone and get an instant confirmation.</p>
          <p className="text-muted-foreground">Confirmations and reminders honor your consent and quiet hours. This never returns a product recommendation.</p>
          <Button asChild>
            <Link href="/schedule">Book a meeting</Link>
          </Button>
        </CardContent>
      </Card>
    </FormShell>
  )
}
