// src/components/fna/value-label.tsx
// Shared FNA presentation helpers: the value-provenance label (build instruction
// §1) rendered as a badge, plus money/percent formatting and a confidence chip.
// Reused across the plan workspace, results, and module views so every displayed
// number is labeled consistently. No hardcoded hex — Badge variants resolve tokens.
import { Badge } from '@/components/ui/badge'
import type { ValueLabel } from '@/lib/fna/engine/types'

// Provenance vocabulary is defined once in the engine (VALUE_LABELS); re-exported
// here for existing importers of this module.
export type { ValueLabel }

const LABEL_TEXT: Record<ValueLabel, string> = {
  verified: 'Verified',
  client_supplied: 'Client-supplied',
  imported: 'Imported',
  calculated: 'Calculated',
  estimated: 'Estimated',
  assumption_based: 'Assumption-based',
  incomplete: 'Incomplete',
  unavailable: 'Unavailable',
  needs_confirmation: 'Needs confirmation',
}

// Map each provenance label to an existing badge variant (no new pattern).
const LABEL_VARIANT: Record<ValueLabel, 'active' | 'outline' | 'assumption' | 'draft' | 'destructive'> = {
  verified: 'active',
  client_supplied: 'outline',
  imported: 'outline',
  calculated: 'active',
  estimated: 'draft',
  assumption_based: 'assumption',
  incomplete: 'draft',
  unavailable: 'destructive',
  needs_confirmation: 'draft',
}

export function ValueLabelBadge({ label }: { label: ValueLabel }) {
  return <Badge variant={LABEL_VARIANT[label] ?? 'outline'}>{LABEL_TEXT[label] ?? label}</Badge>
}

export function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const variant = confidence === 'high' ? 'active' : confidence === 'medium' ? 'draft' : 'destructive'
  return <Badge variant={variant}>{confidence} confidence</Badge>
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function fmtPercent(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}
