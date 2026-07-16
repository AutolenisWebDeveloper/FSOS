import Link from 'next/link'
import { BookOpen, Phone, LifeBuoy } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonoLabel } from '@/components/ui/typography'
import { SupportRequestForm } from '@/components/app/SupportRequestForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Help & Support page (ports the legacy Help section as a REAL, wired feature).
// The support form writes support_requests (triaged in Admin); the guide links to
// live FSOS destinations (no dead ends). Roles: fsa, licensed_staff, super_admin.
const GUIDE: { label: string; href: string; desc: string }[] = [
  { label: 'Executive Dashboard', href: '/app', desc: 'Your book at a glance; arrange the widget grid once and it persists.' },
  { label: 'Agencies', href: '/app/agencies', desc: 'The agency-owner partnerships that are the root of everything.' },
  { label: 'Referrals', href: '/app/referrals', desc: 'Triage the inbox and convert a referral into a household + opportunity.' },
  { label: 'Reviews', href: '/app/reviews', desc: 'Financial reviews — prep, needs map, and outcome origination.' },
  { label: 'FNA Generator', href: '/app/fna', desc: 'Generate a compliant Financial Needs Analysis (gaps only, no product picks).' },
  { label: 'Commissions & GDC', href: '/app/commissions/gdc', desc: 'Rolling GDC, tier, and expected payout (config defaults are labeled).' },
  { label: 'AI Operations', href: '/app/ai', desc: 'Agent runs, escalations, and the kill switch.' },
  { label: 'FFS Key Contacts', href: '/app/contacts', desc: 'Sales desk, wholesaler, compliance, and OSJ numbers.' },
]

export default async function HelpPage() {
  await requireRole('fsa', '/app/help')
  return (
    <div className="space-y-8">
      <PageHeader
        title="Help & Support"
        description="Find your way around FSOS, reach the FFS desks, or send us a support request."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Help' }]}
      />

      <section className="space-y-3">
        <MonoLabel>
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> Getting around
          </span>
        </MonoLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {GUIDE.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="rounded-lg border p-4 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="text-sm font-semibold">{g.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{g.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <MonoLabel>
          <span className="inline-flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> Reach a person
          </span>
        </MonoLabel>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">FFS sales desk, wholesaler, compliance, and OSJ numbers are on the contacts page.</p>
            <Link href="/app/contacts" className="text-sm font-medium text-primary hover:underline">
              View FFS Key Contacts →
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <MonoLabel>
          <span className="inline-flex items-center gap-1.5">
            <LifeBuoy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> Send a support request
          </span>
        </MonoLabel>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact the FSOS team</CardTitle>
          </CardHeader>
          <CardContent>
            <SupportRequestForm />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
