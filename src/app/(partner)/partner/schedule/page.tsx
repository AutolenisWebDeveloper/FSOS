import Link from 'next/link'
import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

// P-4 Schedule (A6). Book a meeting with the FSA via the native scheduler (ADR-027).
export default function PartnerSchedulePage() {
  return (
    <FormShell
      title="Schedule with your FSA"
      description="Book a meeting at a time that works for you."
      breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Schedule' }]}
    >
      <Card>
        <CardContent className="space-y-4 py-6 text-sm">
          <p>Choose from real openings in your own timezone and get an instant confirmation.</p>
          <p className="text-muted-foreground">Confirmations and reminders honor your consent and quiet hours.</p>
          <Button asChild>
            <Link href="/schedule">Book a meeting</Link>
          </Button>
        </CardContent>
      </Card>
    </FormShell>
  )
}
