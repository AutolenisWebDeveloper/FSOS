import { ListShell } from '@/components/archetypes'
import { ComplianceIntelligence } from '@/components/compliance/ComplianceIntelligence'

export const dynamic = 'force-dynamic'

// Compliance Intelligence — the NIGO-resolution / RightBridge / note-authoring
// workspace (owner-authorized; CLAUDE.md §5 authorized exception + docs/adr/ADR-012 + docs/compliance/).
// An internal, retrieval-grounded drafting & analysis aid for the licensed FSA:
// analyze a NIGO against the actual applicable authority, harden case notes to the
// objective standard, check a RightBridge report for contradictions, build a
// paperwork checklist, grow the knowledge library, and mine NIGO history for the
// authority-tier evidence base. Every conclusion is cited to an uploaded passage;
// unsupported requests are flagged, never invented.
export default function ComplianceIntelligencePage() {
  return (
    <ListShell
      title="Compliance Intelligence"
      description="Analyze NIGOs against the actual applicable FINRA / FFS / carrier / state / form authority, harden notes to the objective standard, and resolve NIGOs accurately, professionally, and compliantly — grounded in a knowledge library you own and grow."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Compliance Intelligence' }]}
    >
      <ComplianceIntelligence />
    </ListShell>
  )
}
