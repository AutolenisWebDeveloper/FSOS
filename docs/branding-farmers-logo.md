# Brand assets — Farmers Insurance logo drop-in

## Status: the official Farmers Insurance logo is NOT in this repository.

Until an approved asset is supplied, every brand surface renders the FSA's **own**
mark — a shield/monogram lockup with the text "Markist Athelus · Financial Services
Agent · Farmers Insurance". This is deliberate and compliant: the Farmers Insurance
name and trademark are **not publicly redistributable**, and the project guardrail
(`CLAUDE.md` §2.3) forbids inventing, redrawing, recoloring, or downloading an
unofficial version of it. A text lockup naming Farmers is the correct interim
treatment.

## What asset is required

The **official Farmers Insurance logo**, obtained from an authorized source only:

- the Farmers agent/brand resource center, or Farmers corporate marketing/brand team;
- provided to a licensed Farmers agent under the applicable brand-usage guidelines.

Requirements for the file you drop in:

| Property | Requirement |
|---|---|
| Format | **SVG preferred** (crisp at every size); a high-resolution transparent **PNG** also works |
| Background | **Transparent** — it renders on both the light marketing header and the dark footer/sidebar |
| Color | The official colors, unmodified — **do not** recolor, add effects, or convert to mono |
| Content | The official mark exactly as supplied — **do not** stretch, crop, rotate, or redraw it |
| Path | `public/images/farmers-logo.svg` (the repo's `public/images/` folder). Keep the filename exactly. |

If Farmers supplies separate lockups (a full horizontal wordmark vs. a compact
emblem), the horizontal wordmark reads best in the marketing header; the same file
is used in the square `/app`/auth tiles with `object-contain` (padded, never
cropped). If a compact emblem is preferred for the square tiles, coordinate a
second asset and we can point `BrandMark` at it.

## How to activate (once the approved asset is in place)

1. Drop the approved file at `public/images/farmers-logo.svg`.
2. Set the environment variable **`NEXT_PUBLIC_USE_FARMERS_LOGO=1`** (Vercel project
   env for every environment where it should appear).
3. Redeploy.

That single flag + asset switches the logo **consistently everywhere it is wired**:

- Public marketing **header** and **footer** (`BrandLogo` in `src/components/public/site/icons.tsx`)
- **Login**, **Forgot password**, **Reset password**, and every other auth screen
  (`AuthShell` → `BrandMark`)
- The **/app dashboard** sidebar + topbar and other portal chrome
  (`PortalShell`, `CharacterPanels` → `BrandMark`)
- The public FSOS-styled pages (`PublicShell` → `BrandMark`)

No code change is needed to switch it on — only the asset + the flag.

## Not switched by this flag (intentionally)

- **Favicon / app icon** (`src/app/icon.svg`): stays the FSA's own shield mark.
  Placing the Farmers trademark in a favicon is a distinct trademark use that
  needs its own sign-off, and a full logo does not read at 16–32px. Revisit
  separately if Farmers approves a favicon-safe emblem.
- **Backend-generated emails / server templates**: out of frontend scope; update
  those through their own channel.

## Sign-off checklist before enabling

- [ ] Asset obtained from an authorized Farmers source (not scraped/redrawn)
- [ ] Usage cleared under Farmers brand guidelines + FINRA principal review
- [ ] Transparent, correct-color, unaltered file placed at the path above
- [ ] `NEXT_PUBLIC_USE_FARMERS_LOGO=1` set for the intended environments
