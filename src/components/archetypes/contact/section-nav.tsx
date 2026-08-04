import Link from 'next/link'

/*
 * Contact 360 canonical sections (redesign spec §4.2 / §5). The 6-section shell
 * that replaces the flat legacy tab list. IDs are stable route segments:
 * `overview` lives at the record root; every other section at
 * `/app/households/[id]/[section]`. Consumed by the record, and the single
 * source of truth for what a Contact 360 section is (design-system reuse §12).
 */
export const CONTACT_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'financial-planning', label: 'Financial Planning' },
  { id: 'crm', label: 'CRM' },
  { id: 'documents', label: 'Documents' },
  { id: 'preferences', label: 'Preferences' },
] as const

export type ContactSection = (typeof CONTACT_SECTIONS)[number]['id']

export const CONTACT_SECTION_IDS = CONTACT_SECTIONS.map((s) => s.id) as readonly ContactSection[]

export function isContactSection(value: string): value is ContactSection {
  return (CONTACT_SECTION_IDS as readonly string[]).includes(value)
}

/**
 * The 6-section tab strip. Server component — the active section is passed in so
 * the App Router layout can stay static. Horizontally scrollable on narrow
 * viewports so no section is ever clipped off (spec §13).
 */
export function ContactSectionNav({ id, active }: { id: string; active: ContactSection }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b" aria-label="Contact sections">
      {CONTACT_SECTIONS.map((section) => {
        const href = section.id === 'overview' ? `/app/households/${id}` : `/app/households/${id}/${section.id}`
        const isActive = section.id === active
        return (
          <Link
            key={section.id}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={
              'whitespace-nowrap rounded-t-md px-3 py-2 text-sm transition-colors ' +
              (isActive
                ? 'border-b-2 border-primary font-medium text-primary'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
