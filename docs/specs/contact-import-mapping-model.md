# Contact Import — Field Recognition & Mapping Model (v2.1)

**Status:** Implemented · **ADR:** [ADR-036](../adr/ADR-036-contact-import-mapping-model.md)
**Design contract:** CLAUDE.md §4.3 (no invented Farmers data), §6 (architecture preservation), §10 (data model) · [ADR-028](../adr/ADR-028-contact-consolidation-dedup.md) (staging/dedup substrate)

Map → validate → dedupe → preview → commit. **No consent step. No birthday/DOB gating** — DOB imports as a normal field.

---

## 1. Source files detected (by header signature)

| Template key | Distinctive headers (signature) | Shape |
|---|---|---|
| `life_conversion_policy_detail` | `Insured Name` + `Owner Name` + `Joint Owner Name` + `Series Code` | policy + owner + joint owner |
| `district_life_conversion` | `Conversion Expiring Date` + `Policy Holder Name` + `AOR Code` | policy + holder + insured |
| `life_conversion_convertible` | `Conversion Expiry Date` + `Policy Owner` + `Insured Birthday` + `Convertible Amount` + `AOR with Series Code` | policy + owner + insured (incl. DOB) |
| `district_win_back_life` | `Inactive Agency LOB` + `Account Name` + `Mailing State` | account + contact |
| `district_cross_sell_life` | `Active LOB` + `Preferred Household Phone` + `Agency AOR` | household + contact |

Detection is over the distinctive subset, tolerant of extra/reordered columns (`detectTemplate`, `src/lib/import/mapping/templates.ts`). The full header set is hashed order-independently by `signatureHash` and keys the operator-saved template in `import_templates`.

## 2. Auto-recognition dictionary

Source header → FSOS target field, **exact (squashed) match first, then a conservative fuzzy pass** (`recognizeHeader`, `dictionary.ts`). Targets span four entities — household, member (owner + joint owner), policy, agency attribution — catalogued in `fields.ts`. Recognition is case/spacing/punctuation-insensitive. `Insured Birthday` → `member.dob` (plain `date`, no gating).

## 3. Composite & derived columns

`AOR with Series Code` → `agency.aor_code` + `policy.series_code` (`composite.ts`). The default delimiter splits on whitespace / slash / pipe — **never a hyphen** (AOR codes contain hyphens), and is a **labeled config assumption** (§4.3) the operator can correct once, after which it is remembered.

## 4. Unrecognized-header interface

The mapping UI (`ContactImportMapper.tsx`, route `/app/contacts/import`) shows every source column with sample values + a confidence badge, and per-column lets the operator: **map to an existing field** (grouped dropdown), **create a custom field** (label + entity + type; no schema migration — stored in the entity `custom` jsonb), or **import as-is / ignore**. A "remember this mapping" toggle (default on) saves the template.

## 5. Mapping memory (map once)

- **`import_templates`** — `source_signature` → confirmed `header_map`, `template_key`, `usage_count`, `last_used_at`. Auto-loaded on the next file of the same signature.
- **`import_header_memory`** — every confirmed per-header decision, global across all files.
- **`custom_fields`** — `entity`, `key`, `label`, `field_type`. New fields appear in the dropdown next time.

Persistence: `src/lib/import/mapping/store.ts`. Migration: `supabase/migrations/096_contact_import_mapping_model.sql`.

## 6. Household grouping (owner + joint owner)

A row with both owner and joint owner seeds **two contacts sharing one household** — the joint contact inherits the row's address/ZIP and materializes under the same household origin key (`householdMaterialize.ts`).

## 7. Pipeline (friction removed)

```
Intake → /api/app/imports/analyze (detect template + load memory → mapping plan) →
Operator review (map unrecognized once) →
/api/app/contacts/import { mapping } → normalize → validate → dedupe (resolution.ts) →
materialize household spine → import_batches/import_records audit + rollback token →
remember template + per-header decisions + custom fields.
```

No consent step. No DOB gating. Quarantined rows (no valid email/phone) are reported, never dropped. Commit is idempotent (re-import merges in place via the resolution engine).

## 8. As-built module map

| Concern | Code |
|---|---|
| Target-field catalog | `src/lib/import/mapping/fields.ts` |
| Recognition dictionary (exact + fuzzy) | `src/lib/import/mapping/dictionary.ts` |
| Composite split | `src/lib/import/mapping/composite.ts` |
| Template detection + signature hash | `src/lib/import/mapping/templates.ts` |
| Plan builder | `src/lib/import/mapping/plan.ts` |
| Confirmed-mapping → commit translation | `src/lib/import/mapping/commit.ts` |
| Memory persistence | `src/lib/import/mapping/store.ts` |
| Dry-run analysis API | `src/app/api/app/imports/analyze/route.ts` |
| Commit (extended, non-breaking) | `src/app/api/app/contacts/import/route.ts` |
| Mapping UI (upload → map → commit) | `src/components/app/ContactImportMapper.tsx` |
| Tests | `tests/import-mapping-model.test.mts`, `tests/import-mapping-migration.test.mjs` |

### Known limitations (follow-ups)
- First-class **policy-entity** creation and full owner+joint **two-member** materialization beyond the shared-household seed remain in the dedicated conversion/book importers; recognized policy/agency/joint fields are preserved in `contacts.custom` on the generic path.
- "Remember" is a single batch-level template toggle; individual header decisions are always remembered.
- Consent-group batch assignment is still supported by the commit API but is intentionally not surfaced in this mapper (spec §7: no consent step).
