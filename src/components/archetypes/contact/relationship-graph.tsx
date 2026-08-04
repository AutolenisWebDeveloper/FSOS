import Link from 'next/link'
import { Building2, Landmark, UserRound, Users2, Handshake, Network } from 'lucide-react'
import { load } from '@/lib/data/query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { groupByRole, type RoleCategory } from '@/lib/contacts/relationships'

/*
 * Relationship Intelligence graph (redesign spec §10). Renders the household as a
 * relationship structure grouped by canonical role — members, non-person entities
 * (business/trust), and the referring agent (AOR) as node types — rather than a
 * flat list. Cross-household relationships (a person who appears in another
 * household in the book) are surfaced inline. Server component; RLS scopes reads.
 */

interface MemberRow {
  id: string
  full_name: string
  relationship: string | null
  email: string | null
}

const ROLE_ICON: Record<RoleCategory, typeof UserRound> = {
  primary: UserRound,
  joint: Users2,
  dependent: UserRound,
  beneficiary: UserRound,
  business: Building2,
  trust: Landmark,
  other: UserRound,
}

export async function ContactRelationshipGraph({
  householdId,
  referringAgencyId,
}: {
  householdId: string
  referringAgencyId: string | null
}) {
  const members = await load<MemberRow[]>(
    (db) => db.from('household_members').select('id, full_name, relationship, email').eq('household_id', householdId).is('deleted_at', null).order('created_at'),
    [],
  )
  if (!members.ok || members.data.length === 0) return null

  // Cross-household surfacing: which of these members' emails appear in ANOTHER
  // household in the book (a person in two households — §10). One extra query.
  const emails = Array.from(new Set(members.data.map((m) => m.email).filter((e): e is string => !!e)))
  const crossByEmail = new Map<string, number>()
  if (emails.length > 0) {
    const others = await load<{ household_id: string; email: string | null }[]>(
      (db) => db.from('household_members').select('household_id, email').in('email', emails).neq('household_id', householdId).is('deleted_at', null),
      [],
    )
    if (others.ok) {
      for (const row of others.data) {
        if (!row.email) continue
        crossByEmail.set(row.email, (crossByEmail.get(row.email) ?? 0) + 1)
      }
    }
  }

  const [agency, groups] = [
    referringAgencyId
      ? await load<{ agency_name: string } | null>((db) => db.from('agency_partnerships').select('agency_name').eq('id', referringAgencyId).maybeSingle(), null)
      : null,
    groupByRole(members.data),
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" aria-hidden /> Relationship intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-4">
          {groups.map((group) => {
            const Icon = ROLE_ICON[group.meta.key]
            return (
              <li key={group.meta.key}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {group.meta.label}
                  {group.meta.entity ? <Badge variant="draft" className="ml-1">Entity</Badge> : null}
                </div>
                <div className="flex flex-wrap gap-2 pl-5">
                  {group.members.map((m) => {
                    const cross = m.email ? crossByEmail.get(m.email) ?? 0 : 0
                    return (
                      <Link
                        key={m.id}
                        href={`/app/households/${householdId}/members/${m.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:border-primary/40 hover:text-primary"
                      >
                        {m.full_name}
                        {cross > 0 ? (
                          <span
                            className="rounded-full bg-primary-soft px-1.5 text-[11px] text-primary"
                            title={`Also appears in ${cross} other household${cross === 1 ? '' : 's'}`}
                          >
                            +{cross}
                          </span>
                        ) : null}
                      </Link>
                    )
                  })}
                </div>
              </li>
            )
          })}

          {referringAgencyId && agency?.ok && agency.data ? (
            <li>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Handshake className="h-3.5 w-3.5" aria-hidden /> Referring agent (AOR)
              </div>
              <div className="pl-5">
                <Link
                  href={`/app/agencies/${referringAgencyId}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm hover:border-primary/40 hover:text-primary"
                >
                  {agency.data.agency_name}
                </Link>
              </div>
            </li>
          ) : null}
        </ul>
        {crossByEmail.size > 0 ? (
          <p className="text-xs text-muted-foreground">
            <span className="text-primary">+n</span> marks a person who also appears in another household in your book.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
