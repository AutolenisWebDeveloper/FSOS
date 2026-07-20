import * as React from 'react'
import Link from 'next/link'
import { CalendarCheck, ArrowRight, ShieldCheck, LockKeyhole, BadgeCheck, MapPin, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PortalMockup } from './PortalMockup'
import { bookingUrl, CONTACT } from '@/lib/site'

const TRUST = [
  { icon: BadgeCheck, label: 'Licensed financial professional' },
  { icon: ShieldCheck, label: 'Insurance & financial solutions' },
  { icon: LockKeyhole, label: 'Secure client portal' },
]

export function Hero() {
  const book = bookingUrl()
  const external = book.startsWith('http')
  return (
    <section
      className="relative overflow-hidden shell-gradient text-shell-foreground"
      aria-labelledby="hero-heading"
    >
      {/* Ambient brand glow + fine grid — atmosphere, not decoration for its own sake. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-10%] h-[520px] w-[520px] rounded-full bg-primary/25 blur-[120px]" />
        <div className="absolute right-[-8%] top-[30%] h-[420px] w-[420px] rounded-full bg-accent/15 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(0 0% 100%/0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%/0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(120% 80% at 50% 0%, black, transparent 75%)',
          }}
        />
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        {/* Copy column */}
        <div>
          <p className="mono-label inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-shell-highlight">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {CONTACT.serviceArea}
          </p>

          <h1
            id="hero-heading"
            className="mt-5 font-bold tracking-[-0.03em] text-balance"
            style={{ fontSize: 'clamp(2.75rem, 6vw, 4.75rem)', lineHeight: 1.02 }}
          >
            <span className="block text-white">Protect Today.</span>
            <span className="block text-[hsl(210_90%_66%)]">Build Tomorrow.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[1.075rem] leading-relaxed text-shell-foreground/85">
            Helping individuals, families, business owners, and Farmers agency clients create personalized insurance and
            financial strategies — through professional guidance, modern technology, and a long-term planning
            relationship.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg" variant="destructive" className="h-12 px-7 text-[15px]">
              <a href={book} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}>
                <CalendarCheck className="h-5 w-5" aria-hidden />
                Schedule a Consultation
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 border-white/25 bg-white/10 px-7 text-[15px] text-white hover:border-white/40 hover:bg-white/20 hover:text-white"
            >
              <a href="#solutions">
                Explore Solutions
                <ArrowRight className="h-5 w-5" aria-hidden />
              </a>
            </Button>
          </div>

          {/* Secondary quiet actions */}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 font-medium text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded"
            >
              <LockKeyhole className="h-4 w-4" aria-hidden />
              Access client portal
            </Link>
            <a
              href={`tel:${CONTACT.phoneE164}`}
              className="inline-flex items-center gap-1.5 font-medium text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
            >
              <Phone className="h-4 w-4" aria-hidden />
              {CONTACT.phoneDisplay}
            </a>
          </div>

          {/* Trust chips */}
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/10 pt-6">
            {TRUST.map((t) => (
              <li key={t.label} className="inline-flex items-center gap-2 text-sm text-shell-foreground/80">
                <t.icon className="h-4 w-4 text-[hsl(210_90%_66%)]" aria-hidden />
                {t.label}
              </li>
            ))}
          </ul>
        </div>

        {/* Visual column */}
        <div className="relative lg:pl-6">
          <PortalMockup />
        </div>
      </div>
    </section>
  )
}
