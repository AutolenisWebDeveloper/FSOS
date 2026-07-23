# D0 — GHL opt-out migration tooling

Migrates GoHighLevel DND/opt-out/unsubscribe records into the FSOS **enforcement
stores** so the compliance gate suppresses them. This is **stage D0** of the GHL
decommission (ADR-014) — the step every later stage waits on. **A missing opt-out is a
TCPA violation.**

## Safety contract

- **Dry-run by default.** `import-optouts.ts` writes nothing unless `--commit` is passed.
- **No live GHL / production execution from this repo.** `export-optouts.ts` normalizes a
  file the operator downloads from GHL; it does not call the GHL API. The importer writes to
  Supabase only with credentials supplied at runtime and only under `--commit`.
- **Enforcement stores only.** Opt-outs land in **`consents`** (revoked, member-keyed) and/or
  **`dnc_entries`** (contact-keyed) — the two stores `src/lib/comms/send.ts` reads. **Never
  `consent_ledger`**, which the gate never reads (`reconcile.ts` asserts nothing leaked there).
- **Member-resolved, fail-closed.** A record that resolves to a household member gets a
  `consents` revoke (insert-only-when-absent) plus a `dnc_entries` row. A record that cannot be
  resolved to a member **fails closed to `dnc_entries`** (contact-keyed, needs no member). Only a
  record with *no member and no contact value* is **unresolved** — and D0 does not exit until that
  count is **zero**.
- **Idempotent.** Both writes are on-conflict-do-nothing, so re-running never duplicates or
  clobbers a pre-existing (native STOP) row.
- **Timestamps preserved.** The original GHL opt-out timestamp is carried into `created_at` /
  `captured_at` — never `now()`.

## Steps

```bash
# 1. Normalize a raw GHL export into canonical records (no live GHL call).
npx tsx scripts/ghl-migration/export-optouts.ts --input raw-ghl-export.json --out ghl-optouts.json

# 2. Dry-run the import — prints the plan + summary, writes NOTHING.
npx tsx scripts/ghl-migration/import-optouts.ts --input ghl-optouts.json
#    → exits non-zero if any record is UNRESOLVED (must be zero to proceed).

# 3. Reconciliation report (row-count + checksum; leak check on consent_ledger).
npx tsx scripts/ghl-migration/reconcile.ts --input ghl-optouts.json

# 4. Apply for real (only after a verified backup — see ADR-014 §2.A).
npx tsx scripts/ghl-migration/import-optouts.ts --input ghl-optouts.json --commit

# 5. Re-run reconcile.ts to confirm applied counts + a clean consent_ledger.
```

## Rollback

`rollback-optouts.sql` removes only the marker-tagged rows
(`consents.source='ghl_migration'`, `dnc_entries.reason='ghl_migration'`), restoring the exact
pre-import state without touching any native STOP/consent row (append-only audit rows are kept):

```bash
psql "$DATABASE_URL" -f scripts/ghl-migration/rollback-optouts.sql
```

## Tests

- `tests/ghl-optout-migration.test.mjs` — proves a migrated opt-out **blocks a send through
  `evaluateGate`** (member-resolved → consent block; fail-closed → dnc block even with stale
  consent), channel normalization, unresolved detection, no-`consent_ledger`, timestamp
  preservation. Runs in CI (no DB needed).
- `tests/ghl-optout-rollback.test.mjs` — **executed** ephemeral-Postgres proof that
  `rollback-optouts.sql` removes only `ghl_migration` rows and leaves native opt-outs intact.
  Runs under `test:rls` / `CI_REQUIRE_INFRA=1`.

## Canonical record shape

```json
{ "ghl_contact_id": "abc", "email": "x@y.com", "phone": "+14695550111",
  "channel": "sms | email | all | dnd | …", "opted_out_at": "2025-01-02T03:04:00Z" }
```
