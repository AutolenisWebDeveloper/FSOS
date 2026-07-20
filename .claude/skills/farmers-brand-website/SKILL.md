---
name: farmers-brand-website
description: Build and refine FSOS's public, unauthenticated marketing surface with Farmers/FSA branding on the design-token system. Use this whenever the task touches the public route group, the homepage, legal/marketing pages, the referral/upload/forms public surface, or any public-facing visual work for the FSA site. Reach for it even when the user just says "polish the landing page", "make the homepage feel more premium", "add an About section", or "re-theme the public pages" — so brand tokens, the public auth-guard-free rules, and the client-facing compliance boundary are all respected.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: public-marketing
---

# Farmers-Branded Public Website

Owns the public, unauthenticated surface of FSOS — the marketing homepage, legal pages, and the public intake entry points — built as a premium, Farmers-branded experience on FSOS's own design-token system.

This skill is the FSOS-specific *context and guardrails* layer. For the actual craft of the interface (visual hierarchy, typography, motion, layout, taste), drive with the **frontend-design** and **impeccable** skills — this skill tells you *where* the work goes, *what* brand/token system to use, and *which lines not to cross*.

## Authoritative sources — read, don't duplicate

- **Design system (as-built):** root `DESIGN.md` (token/component reference), `docs/design-system.md` (narrative), `docs/design-audit.md`. Product register: root `PRODUCT.md`.
- **Where public pages live:** `src/app/(public)/*` and the public entry surfaces `/[slug]` (agency referral), `/upload/[slug]`, `/forms/[formId]`, plus `/events`, `/unsubscribe`, `/about`, `/privacy`, `/terms` (CLAUDE.md §10, `docs/sitemap.md`, `docs/routes.md`).
- **Shared UI:** `src/components/ui/*` (shadcn/ui primitives), `src/components/archetypes/*`, `src/components/portal/*`.

## Brand & build rules

1. **Use the token system, not ad-hoc styles.** New UI uses Tailwind + shadcn/ui and the committed design tokens in `DESIGN.md` — identity preservation wins over invention. Do not hardcode hex values that duplicate an existing token. (The legacy inline-styled command center in `src/components/pages/fsos_command_center.jsx` stays inline — do not convert it unless asked, CLAUDE.md §1.6.)
2. **Public routes stay auth-guard-free.** `/[slug]`, `/upload/[slug]`, `/forms/[formId]`, and the rest of the P-0 public surface must remain reachable unauthenticated (CLAUDE.md §1.3, `docs/middleware-auth.md`). Do not add a session gate to a public marketing route.
3. **Client-facing content boundary.** The public/client surface is non-securities, non-advice only (CLAUDE.md §4). No individualized product/investment/replacement recommendation, no securities call-to-action, no invented Farmers product claims (§2.2, §2.3). Marketing copy educates and invites; it does not recommend.
4. **Every input validated.** Public forms (referral, upload, intake) validate with Zod and are covered by `tests/public-intake.test.mjs` — keep that gate green.

## Definition of Done (CLAUDE.md §8)

A public page is not done when it renders. It needs: real wired data (no placeholders), validation on every input, empty/loading/error/success states, responsive desktop/tablet/mobile, accessibility (labels, keyboard, visible focus, reduced-motion, aria), audit events where it writes, and no dead ends (a completion screen always offers a next action).

## When NOT to use this skill

- Authenticated portal UI (FSA/admin/compliance/partner/client app shells) — use **impeccable** with the portal context directly; this skill is the *public* surface.
- Backend/API/data work with no visual surface — use **fsos-crm-workflows** or **fsos-security-audit**.

## Validate before claiming done

- `npm run build` clean; `npm test` (includes `public-intake`) green.
- Check the page in mobile width, keyboard-only, and confirm no public route was accidentally auth-gated.
