import * as React from 'react'
import { Section, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TimeCell } from '@/components/ui/time'
import { EnrollmentStatusBadge } from './CampaignKit'
import type { CampaignEngine } from '@/lib/comms/campaign-presentation'

/*
 * The enrollment roster, once.
 *
 * Existed as three near-identical copies. All three rendered status + touch cursor +
 * baseline date and then diverged only in their trailing engine-specific columns
 * (conversion deadline on Life, win-back reason and staleness on Win-Back, nothing on
 * Cross-Sell). Two of the three also rendered `baseline_date` as a bare string and one
 * badged status as `default | outline`, so the same enrollment looked different depending
 * on which campaign you were viewing it from.
 *
 * The shared columns are fixed here; `extraColumns` carries the engine-specific tail.
 */

export interface CampaignEnrollmentRow {
  id: string
  status: string
  current_touch_no: number
  baseline_date: string
}

export interface EnrollmentColumn<Row extends CampaignEnrollmentRow> {
  header: string
  /** Rendered per row. Return a string for the plain muted treatment. */
  cell: (row: Row) => React.ReactNode
}

export function CampaignEnrollmentTable<Row extends CampaignEnrollmentRow>({
  engine,
  rows,
  error,
  extraColumns = [],
  emptyDescription,
}: {
  engine: CampaignEngine
  /** `null` signals a load failure; an empty array is a genuinely empty roster. */
  rows: Row[] | null
  error?: boolean
  extraColumns?: EnrollmentColumn<Row>[]
  /** Why the roster is empty and what would fill it. */
  emptyDescription: string
}) {
  const count = rows?.length ?? 0

  return (
    <Section
      title={`Enrollments${rows ? ` (${count})` : ''}`}
      description={count > 0 ? 'The 50 most recently updated enrollments on this campaign.' : undefined}
    >
      {error || !rows ? (
        <ErrorState description="Could not load the enrollment roster. The campaign itself is unaffected and keeps running on its schedule." />
      ) : rows.length === 0 ? (
        <EmptyState title="No enrollments yet" description={emptyDescription} />
      ) : (
        <Table>
          <TableCaption srOnly>
            {`${engine.title} enrollments — ${rows.length} most recently updated, with status, timeline position, and baseline date.`}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Touch</TableHead>
              <TableHead scope="col">Baseline</TableHead>
              {extraColumns.map((c) => (
                <TableHead key={c.header} scope="col">
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <EnrollmentStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="numeric text-muted-foreground">
                  {row.current_touch_no} / {engine.touches}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <TimeCell value={row.baseline_date} precision="date" />
                </TableCell>
                {extraColumns.map((c) => (
                  <TableCell key={c.header} className="text-muted-foreground">
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  )
}
