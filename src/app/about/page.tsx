import type { Metadata } from 'next'
import Link from 'next/link'
import { Sunrise, ShieldCheck, RefreshCw, LineChart, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PublicFooter from '@/components/PublicFooter'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Markist Athelus — Farmers Financial Services' }

// Public landing / booking page. Booking button points at NEXT_PUBLIC_CALENDLY_URL
// when configured, otherwise to the public workshops index.
const SERVICES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Sunrise, title: 'Retirement planning', body: 'Strategies to help you plan for income and protection in retirement.' },
  { icon: ShieldCheck, title: 'Life insurance', body: 'Term and permanent coverage matched to your family and goals.' },
  { icon: RefreshCw, title: 'Term conversions', body: 'Review conversion options before your window closes.' },
  { icon: LineChart, title: 'Financial reviews', body: 'A clear, no-pressure look at where you stand and your options.' },
]

export default function AboutPage() {
  const bookUrl = process.env.NEXT_PUBLIC_CALENDLY_URL || '/events'
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Hero — the same Farmers-navy shell surface as the authenticated app */}
      <header className="shell-gradient px-6 py-14 text-shell-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <p className="mono-label text-shell-muted">Farmers Financial Services</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-balance">Markist Athelus</h1>
          <p className="mt-3 max-w-xl text-lg leading-relaxed text-shell-foreground/90">
            A licensed Financial Services agent in McKinney, TX, helping families and business owners make confident,
            well-informed decisions about protection and retirement.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href={bookUrl}>Book a consultation</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-shell-border/70 bg-white/10 text-shell-foreground hover:bg-white/20 hover:text-shell-foreground"
            >
              <Link href="/events">See upcoming workshops</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Services */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h2 className="text-xl font-semibold text-foreground">How I can help</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <div key={s.title} className="rounded-xl border border-border bg-card p-5 shadow-elev-xs">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <s.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card p-6 text-center shadow-elev-xs">
          <h2 className="text-lg font-semibold text-foreground">Ready to talk?</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Schedule a free, no-obligation conversation about your goals.
          </p>
          <Button asChild size="lg" className="mt-4">
            <a href={bookUrl}>
              Book a consultation
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
          Educational information only — not investment, tax, or legal advice. Securities and insurance products are
          offered through Farmers Financial Services and its affiliated carriers.
        </p>
      </main>

      <PublicFooter />
    </div>
  )
}
