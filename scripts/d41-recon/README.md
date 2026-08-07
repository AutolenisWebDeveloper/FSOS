# District 41 master reconciliation — Phase 0 analysis tooling

Read-only analysis scripts backing `docs/recon/D41-master-reconciliation-phase0.md`.
They **never** connect to the database and **never** write anything. They parse the
master workbook locally and emit counts and salted-free hashes only — no PII is
printed, and the workbook itself is never committed.

```bash
pip install openpyxl
export D41_MASTER_XLSX="/path/to/District 41 MASTER - Consolidated Operating File.xlsx"
python3 scripts/d41-recon/analyze.py
```

## Why Python, and what should replace it

`parse_master.py` is a **faithful port** of the key-derivation functions that already
exist in the app, cited line-by-line in its docstring. It exists so Phase 0 could
verify the live database against the master without writing to either.

It is deliberately *not* the thing that should perform the Phase 1 staging load. Per
`CLAUDE.md` §6 (architecture preservation), the loader must reuse the real importers —
`src/lib/import/{inforceBook,conversionList,crossSellList,winBackList}.ts` and the
shared resolution engine in `src/lib/import/resolution.ts` — rather than a second
parallel implementation of the same parsing rules. Two ports of the same key function
is exactly the "one-character difference creates a duplicate contact for every row"
failure the brief warns about.

Treat this directory as reconciliation evidence, not as production import code.
