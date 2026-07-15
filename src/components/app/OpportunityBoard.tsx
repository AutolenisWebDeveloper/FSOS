'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Money } from '@/components/ui/typography'
import { Select } from '@/components/ui/select'
import { BoardColumn } from '@/components/archetypes'
import { OPPORTUNITY_STAGE } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export interface OppCard {
  id: string
  household_name: string | null
  engagement: string
  stage: string
  is_security: boolean
  premium: number | null
}

const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect',
  fact_find: 'Fact find',
  quoted_proposed: 'Quoted / proposed',
  application: 'Application',
  underwriting_suitability: 'Underwriting / suitability',
  placed_issued: 'Placed / issued',
  lost: 'Lost',
}

export function OpportunityBoard({ cards }: { cards: OppCard[] }) {
  const router = useRouter()
  const [live, setLive] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  const byStage = React.useMemo(() => {
    const map: Record<string, OppCard[]> = {}
    for (const s of OPPORTUNITY_STAGE) map[s] = []
    for (const c of cards) (map[c.stage] ??= []).push(c)
    return map
  }, [cards])

  async function move(card: OppCard, to: string) {
    if (to === card.stage) return
    setBusy(card.id)
    const res = await postJson<{ commission_id: string | null }>(`/api/opportunities/${card.id}/stage`, { stage: to })
    setBusy(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setLive(`${card.household_name ?? 'Opportunity'} moved to ${STAGE_LABEL[to]}`)
    if (to === 'placed_issued' && res.data.commission_id) toast.success('Placed — a commission record was created from split defaults.')
    else toast.success(`Moved to ${STAGE_LABEL[to]}`)
    router.refresh()
  }

  return (
    <div>
      <div aria-live="polite" className="sr-only">{live}</div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {OPPORTUNITY_STAGE.map((stage) => (
          <BoardColumn key={stage} title={STAGE_LABEL[stage]} count={byStage[stage].length}>
            {byStage[stage].length === 0 ? (
              <p className="px-1 py-4 text-xs text-muted-foreground">No opportunities.</p>
            ) : (
              byStage[stage].map((c) => (
                <div key={c.id} className={`rounded-md border bg-card p-2 text-sm shadow-sm ${c.is_security ? securitiesRowClass : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/app/opportunities/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.household_name ?? 'Opportunity'}
                    </Link>
                    {c.is_security ? <SecuritiesChip /> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.engagement}{c.premium != null ? <> · <Money value={c.premium} /></> : null}</p>
                  <label className="sr-only" htmlFor={`move-${c.id}`}>Move opportunity to stage</label>
                  <Select
                    id={`move-${c.id}`}
                    className="mt-2 h-8 text-xs"
                    value={c.stage}
                    disabled={busy === c.id}
                    onChange={(e) => move(c, e.target.value)}
                  >
                    {OPPORTUNITY_STAGE.map((s) => (
                      <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                    ))}
                  </Select>
                </div>
              ))
            )}
          </BoardColumn>
        ))}
      </div>
    </div>
  )
}
