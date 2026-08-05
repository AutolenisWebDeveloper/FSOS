import * as React from 'react'
import { Section } from '@/components/archetypes'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TouchKindBadge, ApprovalBadge } from './CampaignKit'
import type { CampaignEngine } from '@/lib/comms/campaign-presentation'

/*
 * The touch timeline, once.
 *
 * Three copies with three different column sets and three different approval treatments:
 * Life and Cross-Sell folded approval into the template cell as a bare
 * `approved | outline` badge; Win-Back gave it its own column and rendered `missing` for
 * every advisor-outreach touch, which correctly has no template — so 5 of its 24 rows
 * cried wolf. Approval is its own column here on all three, and an advisor touch reads as
 * "not applicable" rather than as a defect.
 */

export interface ScheduleTouch {
  touch_no: number
  day_offset: number
  kind: string
  asset_label: string | null
  template: { name: string; approval_status: string } | null
  /** Cross-Sell Life only. */
  playbook_key?: string | null
}

export function CampaignScheduleTable({
  engine,
  touches,
  description,
  /** Day offset at which the cadence accelerates — those rows get a quiet tint. */
  acceleratesFromDay,
  /** Strip this prefix from template names; the campaign name is already the page title. */
  stripTemplatePrefix,
  showPlaybook = false,
}: {
  engine: CampaignEngine
  touches: ScheduleTouch[]
  description: string
  acceleratesFromDay?: number
  stripTemplatePrefix?: string
  showPlaybook?: boolean
}) {
  return (
    <Section title={`Schedule — ${engine.touches} touches over ${engine.days} days`} description={description}>
      <Table>
        <TableCaption srOnly>
          {`${engine.title} touch timeline — ${engine.touches} touches over ${engine.days} days, with channel, asset, template, and approval state for each.`}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-12">
              #
            </TableHead>
            <TableHead scope="col" className="w-20">
              Day
            </TableHead>
            <TableHead scope="col">Channel</TableHead>
            <TableHead scope="col">Asset</TableHead>
            <TableHead scope="col">Template</TableHead>
            {showPlaybook ? <TableHead scope="col">Playbook</TableHead> : null}
            <TableHead scope="col">Approval</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {touches.map((t) => {
            const advisorTask = t.kind === 'advisor_outreach'
            const name = stripTemplatePrefix ? t.template?.name.replace(stripTemplatePrefix, '') : t.template?.name
            return (
              <TableRow
                key={t.touch_no}
                className={acceleratesFromDay != null && t.day_offset >= acceleratesFromDay ? 'bg-muted/30' : undefined}
              >
                <TableCell className="numeric text-muted-foreground">{t.touch_no}</TableCell>
                <TableCell className="numeric">Day {t.day_offset}</TableCell>
                <TableCell>
                  <TouchKindBadge kind={t.kind} />
                </TableCell>
                <TableCell className="text-muted-foreground">{t.asset_label ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {advisorTask ? <span className="italic">Advisor task — no template</span> : (name ?? '—')}
                </TableCell>
                {showPlaybook ? <TableCell className="text-muted-foreground">{t.playbook_key ?? '—'}</TableCell> : null}
                <TableCell>
                  <ApprovalBadge status={t.template?.approval_status} advisorTask={advisorTask} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Section>
  )
}
