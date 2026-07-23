import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { renderIdentityDisclosure } from '@/lib/comms/identity'
import { IdentityEditor } from './identity-editor'

export const dynamic = 'force-dynamic'

// Slice 2 — Identity disclosure configuration (§8). The approved wording the platform
// auto-inserts on first contact. Shows approval status, the "config default — verify"
// gold badge while unverified, a live preview, and the editor. Nothing is auto-inserted
// until the config is approved.
interface IdentityConfig {
  fsa_role_label: string
  full_template: string
  abbreviated_template: string
  inactivity_days: number
  approval_status: string
  is_assumption: boolean
  version: number
  approved_by: string | null
}

const PREVIEW_VARS = {
  sender: { first_name: 'Markist', full_name: 'Markist Athelus' },
  agency_owner: { first_name: 'Dana', full_name: 'Dana Reed' },
  communication: { reason: 'a brief life-insurance review' },
}

export default async function IdentityConfigPage() {
  const cfg = await load<IdentityConfig | null>(
    (db) => db.from('comm_identity_config').select('*').eq('id', 'global').maybeSingle(),
    null,
  )

  const nav = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><Link href="/app/comms">Timeline</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/assignments">Assignment Review</Link></Button>
    </div>
  )

  return (
    <ListShell
      title="Identity Disclosure"
      description="The approved first-contact introduction the platform inserts automatically. Campaign authors never add it by hand. Nothing is auto-inserted until this is approved."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Identity Disclosure' }]}
      actions={nav}
    >
      {!cfg.ok ? (
        <ErrorState description={cfg.kind === 'not_configured' ? 'Database not configured.' : cfg.message} />
      ) : !cfg.data ? (
        <EmptyState title="No disclosure config yet" description="Run the migrations to seed the default disclosure wording, then edit and approve it here." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Status</span>
              <Badge variant={cfg.data.approval_status === 'approved' ? 'won' : 'pending'}>{cfg.data.approval_status}</Badge>
              {cfg.data.is_assumption && <Badge variant="assumption">config default — verify</Badge>}
              <span className="text-xs text-muted-foreground">v{cfg.data.version}</span>
            </div>
            {cfg.data.approval_status !== 'approved' && (
              <p className="text-sm text-muted-foreground">
                While unapproved, first-contact sends that request identity governance are recorded as needing a full introduction, but the disclosure is <strong>not</strong> auto-inserted — approve verified wording to enable it.
              </p>
            )}
            <IdentityEditor config={cfg.data} />
          </Card>

          <Card className="space-y-4 p-5">
            <p className="text-sm font-medium">Preview</p>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Full introduction (first contact)</p>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {renderIdentityDisclosure(
                  { fsaRoleLabel: cfg.data.fsa_role_label, fullTemplate: cfg.data.full_template, abbreviatedTemplate: cfg.data.abbreviated_template },
                  PREVIEW_VARS,
                  'full',
                )}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Abbreviated (established thread)</p>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {renderIdentityDisclosure(
                  { fsaRoleLabel: cfg.data.fsa_role_label, fullTemplate: cfg.data.full_template, abbreviatedTemplate: cfg.data.abbreviated_template },
                  PREVIEW_VARS,
                  'abbreviated',
                )}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              The introduction always names the actual sender <strong>and</strong> the represented Farmers agent, and frames the sender as reaching out on the agent’s behalf — never as the customer’s own agent (§8).
            </p>
          </Card>
        </div>
      )}
    </ListShell>
  )
}
