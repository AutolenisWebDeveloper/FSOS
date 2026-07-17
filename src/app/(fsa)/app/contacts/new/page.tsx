import { ListShell } from '@/components/archetypes'
import { ContactForm } from '@/components/app/ContactForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Manually add a contact to the Contact Center (stored in App B).
export default function NewContactPage() {
  return (
    <ListShell
      title="Add contact"
      description="Create a contact stored securely in App B. Duplicate email/phone is detected before saving."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: 'Add' }]}
    >
      <div className="max-w-3xl">
        <ContactForm mode="create" />
      </div>
    </ListShell>
  )
}
