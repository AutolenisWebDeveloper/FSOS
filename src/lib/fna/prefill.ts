// src/lib/fna/prefill.ts
// PURE prefill mapping (build instruction §5): derive suggested FNA inputs from
// existing FSOS data (household context) so intake starts populated, each value
// clearly marked with its source. No I/O — the caller loads the context
// (loadFnaContext) and passes it in; unit-tested offline. Extends the loader's
// output rather than adding a parallel data path.
//
// GUARDRAIL: only aggregate/permitted figures are mapped — never securities
// account/holdings detail (§4.1). Every suggestion is a starting value the FSA
// confirms, labeled 'imported' (from FSOS records), never presented as verified.

export interface PrefillMember {
  age: number | null
}
export interface PrefillPolicy {
  is_security: boolean
  face_amount: number | null
}
export interface PrefillContextLike {
  members: PrefillMember[]
  policies: PrefillPolicy[]
}

export interface PrefillSuggestion {
  section: string
  key: string
  value_numeric: number
  source_label: 'imported'
  source_record: string
}

/**
 * Map a household context to suggested inputs. Currently derives:
 *  - existing_life_coverage = Σ face_amount of NON-securities policies (firewall);
 *  - current_age = the oldest member's age (the planning primary).
 * Returns only fields we can source from FSOS data; everything else is left for
 * the FSA to enter. Deterministic and pure.
 */
export function mapContextToInputs(ctx: PrefillContextLike): PrefillSuggestion[] {
  const out: PrefillSuggestion[] = []

  const coverage = ctx.policies
    .filter((p) => !p.is_security && typeof p.face_amount === 'number' && p.face_amount > 0)
    .reduce((sum, p) => sum + (p.face_amount as number), 0)
  if (coverage > 0) {
    out.push({ section: 'coverage', key: 'existing_life_coverage', value_numeric: coverage, source_label: 'imported', source_record: 'household_policies' })
  }

  const ages = ctx.members.map((m) => m.age).filter((a): a is number => typeof a === 'number' && a > 0)
  if (ages.length > 0) {
    out.push({ section: 'household', key: 'current_age', value_numeric: Math.max(...ages), source_label: 'imported', source_record: 'household_members' })
  }

  return out
}
