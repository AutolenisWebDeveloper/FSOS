import Link from 'next/link'
import { SettingsShell, SettingsSection, StatusBadge } from '@/components/archetypes'

export const dynamic = 'force-dynamic'

// Super · Security (A10). Read-only posture summary. Each control shows an
// enforced status; the AI kill switches row links to its live management page.
interface Control {
  title: string
  description: string
  href?: string
}

const CONTROLS: Control[] = [
  {
    title: 'MFA required for FSA / Admin / Compliance / Super',
    description: 'All privileged portals require a second factor (aal2) before access.',
  },
  {
    title: 'Super portal requires step-up MFA',
    description: 'A fresh re-challenge is required for every Super Admin session.',
  },
  {
    title: 'Append-only audit log',
    description: 'INSERT-only, tamper-evident; the app DB role cannot UPDATE or DELETE the log.',
  },
  {
    title: 'Row-Level Security on all client/agency tables',
    description: 'RLS keyed to the authenticated user’s role and scope on every PII-bearing table.',
  },
  {
    title: 'AI kill switches',
    description: 'Gateway and per-agent enable/disable, checked at every agent run start.',
    href: '/super/ai/policies',
  },
]

export default function SuperSecurityPage() {
  return (
    <SettingsShell title="Security" description="Platform security posture (read-only summary).">
      <SettingsSection title="Enforced controls">
        <ul className="divide-y">
          {CONTROLS.map((c) => (
            <li key={c.title} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {c.href ? (
                    <Link href={c.href} className="text-primary hover:underline">
                      {c.title}
                    </Link>
                  ) : (
                    c.title
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </div>
              <StatusBadge status="won" label="enforced" />
            </li>
          ))}
        </ul>
      </SettingsSection>
    </SettingsShell>
  )
}
