# FSOS Middleware & Auth Specification

> Buildable spec for `src/middleware.ts`, per-portal `layout.tsx` guards, and `lib/auth/rbac.ts`.
> Two enforcement layers, both required: (1) **middleware** = coarse portal/route gate + auth redirect; (2) **RLS + rbac checks** = fine-grained row/action authorization. Never rely on middleware alone.

## 1. Roles
```
super_admin       full platform control (MFA mandatory)
fsa               the Financial Services Agent (primary operator)
licensed_staff    delegated staff acting under the FSA (life/securities scope per flag)
admin             back-office administrator
ops               operations / case processor
case_manager      case processing subset of ops
compliance        compliance reviewer (read-heavy)
supervisor        supervisory reviewer (compliance + approvals)
agency_owner      Farmers agency owner (scoped to OWN agency)
client            end client (scoped to OWN household)
```
A user may hold multiple roles → portal switcher shows all permitted portals.

## 2. Portal → allowed roles (coarse gate in middleware)
| URL prefix | Allowed roles | MFA |
|---|---|---|
| `/app` | fsa, licensed_staff | required |
| `/admin` | admin, ops, case_manager, super_admin | required |
| `/compliance` | compliance, supervisor, super_admin | required |
| `/partner` | agency_owner | optional (config) |
| `/client` | client | optional (config) |
| `/super` | super_admin | **mandatory + step-up** |
| public routes | anyone (incl. anonymous) | n/a |

## 3. Public-route allowlist (NEVER redirected to login)
```
/  /about  /education  /education/*  /refer  /refer/success
/schedule  /schedule/success  /events  /events/*  /consent  /consent/preferences
/privacy  /terms  /disclosures  /support
/login  /login/mfa  /forgot-password  /reset-password/*  /invite/*  /verify/*
/403  /404  /500  /maintenance  /offline
# plus existing FSOS public routes:
/[slug]  /upload/[slug]  /forms/[formId]
```
Everything else requires an authenticated session.

## 4. middleware.ts logic (pseudocode)
```
export async function middleware(req):
  path = req.nextUrl.pathname
  if isPublic(path): return next()                       # allowlist §3
  session = getSession(req)
  if !session: return redirect('/login?next='+path)
  portal = portalOf(path)                                # by URL prefix
  if !session.roles ∩ allowedRoles(portal): return rewrite('/403')
  if requiresMFA(portal) && !session.mfaSatisfied: return redirect('/login/mfa?next='+path)
  if portal == 'super' && !stepUpFresh(session): return redirect('/login/mfa?step_up=1&next='+path)
  return next()
matcher: all routes except _next, static, api/health, and the public allowlist
```
Notes: middleware does the **coarse** gate only. It does NOT read rows. Row/entity authorization happens in the layout/server component and in RLS.

## 5. Scope enforcement (fine-grained, in rbac.ts + RLS)
- **agency_owner** may read/write only rows where `agency_id ∈ their agencies`. Enforced by RLS policy `agency_id = current_agency()` AND by `rbac.assertAgencyScope()` in partner server actions.
- **client** may read/write only rows where `household_id = their household` and only NON-securities, non-advice fields. Enforced by RLS + a column allowlist in the client API layer.
- **fsa / licensed_staff** scoped to their book (their agencies/households/opportunities). `licensed_staff.securities_scope=false` blocks creating/advancing `is_security` opportunities.
- **compliance / supervisor** read-broad, write-narrow (approvals, exceptions, incidents). No client-facing send capability.
- **super_admin** unrestricted, every action heavily audited; impersonation writes an audit event and a visible "impersonating" banner.

## 6. Per-portal layout guards
Each `(<portal>)/layout.tsx` server component:
1. calls `requireSession()` → redirect if none (defense-in-depth behind middleware);
2. calls `requireRole(portalRoles)` → `/403` if not permitted;
3. loads the portal nav filtered by the user's permissions (nav item hidden if not permitted; a permitted-but-forbidden deep link still 403s, never blanks);
4. renders the portal shell (top bar, nav, breadcrumb).
Compliance layout also renders the standing banner: "FSOS supervisory views are supplemental. They do not replace FFS-required supervisory systems or books-and-records."

## 7. Session, MFA, lockout
- Supabase Auth sessions; refresh rotation on; short idle timeout for `/super` and `/compliance`.
- MFA (TOTP) enforced per §2. `super` requires a fresh step-up (re-challenge if step-up older than N minutes).
- Password policy, rate limiting on `/login` `/forgot-password` `/reset-password`, bot protection on all public forms, device/session revocation in `/app/settings/security` and `/super/users`.

## 8. Authorization test matrix (must pass in CI — see build-order.md QA)
For every protected route, test: (happy) permitted role loads; (unauth) anonymous → `/login`; (wrong-role) → `/403`; (no-MFA) → `/login/mfa`; (out-of-scope row) agency_owner/client cannot read another agency's/household's row (RLS denies); (super-only) non-super hitting `/super/*` → `/403`; (firewall) client cannot load any `is_security` field.
