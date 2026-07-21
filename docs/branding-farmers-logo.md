# Farmers Insurance brand assets

Governed by **CLAUDE.md §17** and **DESIGN.md**. This note records the as-shipped
asset mapping; §17 / DESIGN.md are authoritative if they diverge.

## Assets (`public/brand/`, per §17.1)

| File | What it is | Used for |
|---|---|---|
| `farmers-logo.svg` | Official full color lockup (emblem + FARMERS INSURANCE wordmark) | Footer carrier badge (has room for the wordmark) |
| `farmers-logo.png` / `farmers-logo.jpeg` | Raster fallbacks of the lockup | Non-SVG contexts |
| `farmers-emblem.svg` / `.png` | Official emblem (fan + shield) | Public marketing header/footer mark, favicon — tight slots where the stacked wordmark is illegible |

All rendered **unaltered**: contained (`object-contain`), official proportions
preserved, never stretched/cropped/recolored; on a white chip/card where the surface
is dark so the full-color mark stays legible.

## Where each mark renders

- **Public marketing header + footer** → `BrandLogo` (`icons.tsx`): official emblem on a white chip; footer also shows the full official lockup (`.foot__carrier`).
- **Favicon / app icon** → `src/app/icon.svg`: emblem centered on a white rounded square.
- **`/app` sidebar + topbar, auth screens, portal chrome** → `BrandMark`: the **FSA's OWN monogram** ("M"), NOT the Farmers trademark — a deliberate distinction per **§17.1** ("do not conflate the two"). The Farmers trademark is used only on the public brand surfaces above.

## Palette

Per §17.2, the as-built `globals.css` app tokens (`--primary 214 88% 40%`,
`--destructive 350 78% 43%`) are the sanctioned AA-tuned rendering of the official
Farmers palette — left unchanged. The public marketing (`.msite`) surface uses the
exact §17.2 hexes (Farmers Blue `#1C428B`, Red `#E11631`) as its own token layer.

## Provenance (owner action before public launch)

> The asset pack was supplied by the account owner (an authorized Farmers agent),
> originating from a Brandfetch export of farmers.com. Its fills exactly match the
> §17.2 official palette. Before public launch, confirm against the official Farmers
> **agent** brand kit and swap if it differs.

Gap: `public/brand/farmers-logo-alt.svg` (an alternate/reversed lockup named in §17.1)
is **not** in the supplied pack — document the gap; do not substitute an unofficial
version (§4.3 / §17.1).
