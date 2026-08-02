import { ListShell } from '@/components/archetypes'
import { ConsentBackfillPanel, type ConsentGroupOption } from '@/components/app/ConsentBackfillPanel'
import { CONSENT_GROUPS, CONSENT_GROUP_KEYS, groupImportTags } from '@/lib/comms/consent-groups'

export const dynamic = 'force-dynamic'

// Consent (Governance). Retroactively grant the prior-express consent the §12 gate requires
// for contacts ALREADY imported into a group — the counterpart to the import-time consent
// grant, for the existing book. Each group previews its resolved population (writes nothing)
// before the licensed operator attests and grants; suppression always wins and the grant is
// idempotent + audited (consent-group-backfill-run.ts).
export default function ConsentBackfillPage() {
  const groups: ConsentGroupOption[] = CONSENT_GROUP_KEYS.map((key) => {
    const g = CONSENT_GROUPS[key]
    return {
      key: g.key,
      label: g.label,
      hint: g.hint,
      disclosure: g.disclosure,
      importTags: groupImportTags(g),
      channels: g.channels,
    }
  })

  return (
    <ListShell
      title="Consent — Imported Groups"
      description="Grant prior-express consent to contacts already imported into a group. Preview the resolved population first; suppression (opt-outs, DNC) always wins and re-running never duplicates."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Consent' }]}
    >
      <ConsentBackfillPanel groups={groups} />
    </ListShell>
  )
}
