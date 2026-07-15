import type { FfsContact } from '@/lib/data/ffs'

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

// Sidebar FFS KEY CONTACTS quick-access panel (design-system.md §5.3C) — config-driven
// (docs/legacy-port.md §2.4). tel: links, mono numbers. Renders nothing when no active
// contacts are configured. The FSA layout loads `contacts` via loadFfsContacts(true).
export function FfsContactsPanel({ contacts }: { contacts: FfsContact[] }) {
  if (contacts.length === 0) return null

  return (
    <section aria-label="FFS key contacts" className="space-y-1.5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">FFS Key Contacts</h2>
      <div className="rounded-lg border p-3">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">Quick Access</p>
        <ul className="mt-2 space-y-2.5">
          {contacts.map((c) => (
            <li key={c.id} className="text-xs leading-tight">
              <p className="text-muted-foreground">{c.role}</p>
              {c.name ? <p className="font-medium text-foreground">{c.name}</p> : null}
              <a href={telHref(c.phone)} className="font-mono tabular-nums text-primary hover:underline">
                {c.phone}
              </a>
              {c.hours ? <p className="text-[0.6875rem] text-muted-foreground">{c.hours}</p> : null}
              {c.note ? <p className="text-[0.6875rem] text-muted-foreground">{c.note}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
