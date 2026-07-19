import { FormShell } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
export const dynamic = 'force-dynamic'
// P-5 Intake (A6). Structured needs-discovery inputs saved to the household. Never
// returns a recommendation — it captures needs for the FSA's review.
export default function ClientIntakePage() {
  return (
    <FormShell title="Intake" description="Tell us about your goals so your FSA can prepare." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Intake' }]}>
      <Card><CardContent className="space-y-2 py-6 text-sm"><p>Your responses help your FSA prepare for the review. This form captures needs — it never returns advice or a product recommendation.</p></CardContent></Card>
    </FormShell>
  )
}
