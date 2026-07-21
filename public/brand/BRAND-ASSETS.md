# Farmers Brand Assets — Manifest

> **Trademark-safe handling (CLAUDE.md §17.1, DESIGN.md §5.1).** The Farmers logo and brand
> assets are **trademarked**. As an authorized Farmers Financial Services Agent, use only the
> **approved assets stored in this directory** — never download from third-party sites, and never
> recreate, redraw, recolor, distort, or substitute them. If an approved asset is missing,
> **document the gap here** (do not fabricate a replacement — §4.3 applies to assets).

This manifest is the inventory of record for `public/brand/`. Keep it in sync when assets are
added, replaced, or removed.

## Present (approved) assets

| File | Format | Role | Used by |
|---|---|---|---|
| `farmers-logo.svg` | SVG (`viewBox 0 0 66.67 35.70`) | **Primary color lockup** — preferred everywhere it fits | `src/components/public/site/SiteFooter.tsx` |
| `farmers-logo.png` | PNG raster | Raster fallback for the primary lockup | — |
| `farmers-logo.jpeg` | JPEG raster | Raster fallback (opaque background contexts) | — |
| `farmers-emblem.svg` | SVG (`viewBox 0 0 112.5 65.6`) | **Emblem / mark** for compact contexts | `src/components/public/site/icons.tsx` |
| `farmers-emblem.png` | PNG raster | Raster fallback for the emblem | — |

Prefer SVG in all contexts; use raster only as a fallback where SVG is not viable (e.g. some
email clients). Preserve official proportions and clear space; never place on a low-contrast
background. See DESIGN.md §5.1 for clear-space, minimum-size, and "when NOT to use the Farmers
logo" rules.

> **Not the Farmers trademark:** the operator-chrome sidebar `IdentityLockup` `BrandMark` is the
> **FSA's own monogram**, not a Farmers asset. Do not swap the Farmers logo into operator chrome
> (DESIGN.md §5.1).

## Referenced-but-missing assets (gaps — to be supplied by the owner)

The following are referenced by the contract/design system but are **not present** in this
directory. They must be provided as **approved** files by the owner — do **not** fabricate,
recreate, or repurpose another asset in their place (§17.1).

| Referenced file | Referenced by | Status |
|---|---|---|
| `farmers-logo-alt.svg` | CLAUDE.md §17.1, DESIGN.md §5.1 | **Missing — awaiting approved "alternate lockup" file.** Until supplied, use `farmers-logo.svg`; the emblem (`farmers-emblem.svg`) covers compact/mark-only needs. |

**To close this gap:** drop the approved `farmers-logo-alt.svg` into `public/brand/` and move its
row up into the "Present" table — **or**, if no alternate lockup is authorized, remove the
`farmers-logo-alt.svg` reference from CLAUDE.md §17.1 and DESIGN.md §5.1 so the docs match the
approved asset set. Either path keeps code, contract, and assets in agreement; fabricating the
file is not an option.
