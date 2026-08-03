# Dependency hygiene notes

This file records deliberate decisions about npm dependencies — what was upgraded,
what is intentionally held back, and why the remaining `npm install` deprecation
warnings cannot be resolved today without a breaking change. Keep it in sync with
`package.json` / `package-lock.json` whenever a dependency decision changes.

## Resolved in this change

| Change | Reason |
|---|---|
| `overrides.uuid` → `^11.1.1` | `exceljs@4.4.0` pins `uuid@^8.3.0`, which is **deprecated** and carries **GHSA-w5hq-g745-h8pq** (moderate — missing buffer bounds check in `v3/v5/v6`). exceljs consumes uuid only via `const { v4 } = require('uuid')`, a named CJS import that `uuid@11` still ships in `dist/cjs`, so the forced bump is API-safe. Verified with an exceljs write→read round-trip plus the full build/test suite. |
| `next` / `eslint-config-next` `15.5.18` → `15.5.22` | Latest patch in the `15.5.x` line. Clears the two bundled-PostCSS `sourceMappingURL` advisories (**GHSA-6g55-p6wh-862q**, **GHSA-r28c-9q8g-f849**) that `npm audit` attributed to `next/node_modules/postcss`. Patch-level, no API change. |

## Remaining deprecation warnings — intentionally not fixed

All of the deprecation warnings still printed by `npm install` are **transitive**
and structurally locked inside a **latest-published** direct dependency. There is
no non-breaking version to move to, so forcing newer majors would risk breaking the
XLSX or email pipelines (a failure mode — e.g. a corrupt spreadsheet — that would
not surface in `npm run build`). They are deprecation notices, **not** open
vulnerabilities.

### Locked inside `exceljs@4.4.0` (the latest exceljs release)

`exceljs` has not shipped a release past `4.4.0`, so its dependency tree is frozen:

| Deprecated package | Pulled in by (under exceljs) | Why it can't be forced |
|---|---|---|
| `glob@7.2.3` | `archiver` → `archiver-utils` / `zip-stream`, and `rimraf` | `glob@9+` dropped the callback API these callers use. |
| `inflight@1.0.6` | `glob@7` | Removed only when `glob@7` is removed. |
| `rimraf@2.7.1` | `fstream` | `fstream@1` requires `rimraf@^2`; `rimraf@4+` changed its API. |
| `fstream@1.0.12` | `unzipper` (used by `exceljs.xlsx.load`) | `1.0.12` is the final publish; no maintained successor. |
| `lodash.isequal@4.5.0` | `fast-csv` → `@fast-csv/format` | `4.5.0` is the final publish; the recommended replacement is `node:util.isDeepStrictEqual`, a code change inside `@fast-csv`, which we do not control. |

`exceljs` is used to both **write** (`src/lib/spreadsheet.ts`,
`src/app/api/fna/plans/[id]/report/xlsx/route.ts`) and **read**
(`src/lib/import/*.ts` via `wb.xlsx.load`) workbooks, so both the `archiver`
(write) and `unzipper` (read) branches are load-bearing. Revisit if/when a new
`exceljs` major lands, or if the spreadsheet layer is migrated to a maintained
library.

### Locked inside `@react-email/components@1.0.12` (the latest release)

`@react-email/components@1.0.12` is the current `latest` on npm, yet it and its
~20 bundled sub-packages (`@react-email/body`, `button`, `container`, `head`,
`html`, `section`, `tailwind`, `text`, …) all carry a blanket "Package no longer
supported" deprecation. There is no non-deprecated published version to upgrade to.
Used by `src/emails/*`; replacing it is an email-template migration, out of scope
for a dependency-hygiene pass.

## Known `npm audit` findings deferred to a separate security pass

These are **not** deprecations and are intentionally left for a focused security
review rather than bundled into this change (some require testing against Next.js'
image pipeline or are build/dev-time only):

- **`sharp` < 0.35.0** (high, libvips CVEs) — Next.js' optional image-optimizer dep;
  resolves to `0.34.5` because no `next@15.5.x` yet pins `sharp@0.35`. On Vercel,
  `sharp` is supplied by the platform. A `sharp` override needs validation against
  `next/image` before shipping.
- **`postcss` "XSS via unescaped `</style>`"** (top-level `postcss@^8`) — build-time
  only; fixable within range but verify against the Tailwind/PostCSS build first.
- **`brace-expansion` DoS** — reaches the tree only through `minimatch` under
  `eslint`/plugins and `glob`; lint/build-time, trusted input.
- **`esbuild` dev-server request advisory** — `esbuild@0.21.5` devDependency; affects
  the local dev server only.
