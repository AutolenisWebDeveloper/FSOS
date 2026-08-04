import { PhoneOff, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip } from '@/components/ui/securities'

/*
 * Contact 360 Status Row (redesign spec §4.2). A light, informational strip that
 * sits under the Identity Header on every customer-displaying surface. It carries
 * only regulatory/informational signals — NO DOB or consent-capture controls
 * (standing decision: frictionless data). Reused by the record, Member Detail,
 * and the Contact Peek so a person reads identically everywhere (§12).
 */
export function ContactStatusRow({
  doNotContact,
  hasSecurities,
  archived,
  className,
}: {
  /** Informational opt-out / DNC indicator — STOP is still honored at send time. */
  doNotContact?: boolean
  /** Household holds at least one is_security record (firewall marker). */
  hasSecurities?: boolean
  archived?: boolean
  className?: string
}) {
  const contactable = !doNotContact
  return (
    <div className={'flex flex-wrap items-center gap-2 text-sm ' + (className ?? '')}>
      {doNotContact ? (
        <Badge variant="blocked" className="gap-1">
          <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Do not contact
        </Badge>
      ) : (
        <Badge variant="active" className="gap-1">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Contactable
        </Badge>
      )}
      {hasSecurities ? <SecuritiesChip /> : null}
      {archived ? <Badge variant="draft">Archived</Badge> : null}
      {contactable ? null : (
        <span className="text-xs text-muted-foreground">Excluded from automated outreach.</span>
      )}
    </div>
  )
}
