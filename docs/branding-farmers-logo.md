# Farmers Insurance brand assets

## Status: official assets are in the repo, at `public/brand/farmers/`.

Per CLAUDE.md §10.1 the Farmers marks are trademarked and must be used **unaltered**
(never stretched, cropped, rotated, recolored, redrawn, or substituted). These assets
are applied faithfully — contained (`object-contain`), official proportions preserved,
on a white "chip"/card where the surface is dark so the full-color mark stays legible
without recoloring.

## Assets

| File | What it is | Used for |
|---|---|---|
| `farmers-logo.svg` / `.png` | Full lockup: emblem + **FARMERS INSURANCE** wordmark | Footer carrier badge (room for the wordmark) |
| `farmers-emblem.svg` / `.png` | Emblem only (fan + shield) | Header, `/app` sidebar/topbar, auth screens, favicon — the tight chrome slots where the stacked wordmark would be illegible |

Both SVGs are clean vector (no embedded raster). Their fills are exactly the §10.2
palette: Blue `#1C428B`, Red `#E11631`, Light Blue `#A6C3E9`, Maroon `#A20F30`,
Gray `#666666`, White — i.e. the palette tokens are sourced from these assets.

## Where the logo renders

- Public **header** + **footer** → `BrandLogo` (`src/components/public/site/icons.tsx`): emblem on a white chip; footer also shows the full lockup (`.foot__carrier`).
- **Login / Forgot / Reset password** and other auth screens → `AuthShell` → `BrandMark`.
- **/app** dashboard sidebar + topbar, portal chrome → `PortalShell`, `CharacterPanels` → `BrandMark`.
- Public FSOS-styled pages → `PublicShell` → `BrandMark`.
- **Favicon / app icon** → `src/app/icon.svg` (emblem centered on a white rounded square).

## Provenance & confirmation (action for the owner)

> These files were supplied by the account owner (an authorized Farmers agent) and
> originate from a **Brandfetch** export of `farmers.com`. Before public launch,
> **confirm them against the current official Farmers agent brand kit** — the vetted
> agent-portal logo pack — and swap in the official-kit files here if they differ.
> The color tokens are the single point of change (`globals.css` / `marketing.css`),
> so a palette correction is a one-place edit.

If an approved asset is ever missing, **document the gap** — do not substitute an
unofficial or low-resolution version (§10.1).
