import * as React from 'react'
import { Check, ShieldCheck, Info } from 'lucide-react'
import { PortalMockup } from './PortalMockup'
import { Reveal } from './Reveal'

const FEATURES = [
  'Secure, access-controlled client portal',
  'Encrypted document uploads',
  'Appointment scheduling & reminders',
  'Digital forms & e-signatures',
  'Digital document management',
  'Secure two-way communication',
  'Personalized follow-up',
  'Organized service requests',
]

export function TechExperience() {
  return (
    <section id="technology" className="relative overflow-hidden shell-gradient text-shell-foreground scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute right-[-10%] top-[-20%] h-[460px] w-[460px] rounded-full bg-primary/20 blur-[130px]" />
      </div>
      <div
        className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2"
        style={{ paddingBlock: 'clamp(3.5rem, 7vw, 7rem)' }}
      >
        {/* Copy */}
        <div>
          <p className="mono-label text-shell-highlight">Powered by FSOS</p>
          <h2
            className="mt-3 font-bold tracking-[-0.02em] text-white text-balance"
            style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.6rem)', lineHeight: 1.08 }}
          >
            Technology that enhances your financial journey
          </h2>
          <p className="mt-4 max-w-xl text-[1.05rem] leading-relaxed text-shell-foreground/85">
            A secure client portal and AI-assisted service keep everything organized, connected, and easy to access — so
            your time with Markist is spent on decisions, not paperwork.
          </p>

          <ul className="mt-8 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[0.95rem] text-shell-foreground/90">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[hsl(210_90%_72%)]">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* Precise security + AI clarifications */}
          <div className="mt-8 space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(210_90%_72%)]" aria-hidden />
              <p className="text-sm leading-relaxed text-shell-foreground/85">
                Your information is protected with access controls and encryption in transit, and documents are stored in
                a private, controlled repository — never publicly accessible.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(210_90%_72%)]" aria-hidden />
              <p className="text-sm leading-relaxed text-shell-foreground/85">
                AI assists with administrative service — reminders, organization, and follow-up. It does{' '}
                <span className="font-semibold text-white">not</span> approve transactions, provide supervisory approval,
                or make recommendations. Insurance and financial recommendations are always provided or reviewed by a
                licensed professional.
              </p>
            </div>
          </div>
        </div>

        {/* Visual */}
        <Reveal className="relative lg:pl-4">
          <PortalMockup />
        </Reveal>
      </div>
    </section>
  )
}
