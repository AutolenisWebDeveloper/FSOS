import { test, expect } from '@playwright/test'

// Batch 8 — the public workshop funnel in a REAL browser, for the guarantees that hold
// with or without live data: the pages render, degrade honestly, stay operable by
// keyboard, and lay out at 375px. Data-dependent JOURNEYS live in
// workshop-journeys.spec.ts and skip loudly when no Supabase is configured.
//
// Nothing here sends: the server runs with captured transport (see playwright.config.ts).

test.describe('workshop hub', () => {
  test('renders with the marketing chrome and a skip link as the first tab stop', async ({ page }) => {
    await page.goto('/workshops')
    await expect(page.locator('main#main')).toBeVisible()

    // The skip link is the accessibility contract for every marketing page: first tab
    // stop, visible on focus, and it must actually target the main landmark.
    await page.keyboard.press('Tab')
    const skip = page.locator('a.skip')
    await expect(skip).toBeFocused()
    await expect(skip).toHaveAttribute('href', '#main')
  })

  test('degrades honestly when workshop data cannot be loaded (no raw error, no dead end)', async ({ page }) => {
    await page.goto('/workshops')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const body = await page.locator('body').innerText()
    // Whatever the data state, a visitor must never see a stack trace, an internal
    // error string, or a bare empty page with no next action.
    expect(body).not.toMatch(/ConfigError|at Object\.|TypeError|Cannot read propert/i)
    expect(body.trim().length).toBeGreaterThan(120)
  })

  test('has exactly one h1 and no horizontal overflow at 375px', async ({ page }, testInfo) => {
    await page.goto('/workshops')
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    if (testInfo.project.name === 'mobile-375') {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      // A couple of px of sub-pixel rounding is tolerable; a real overflow is not.
      expect(overflow).toBeLessThanOrEqual(2)
    }
  })
})

test.describe('registrant self-cancel page (WS-009)', () => {
  test('an unrecognized token shows the recovery state, never a crash', async ({ page }) => {
    const res = await page.goto('/workshops/cancel?token=definitely-not-a-real-token')
    expect(res?.status()).toBe(200)
    // Wait for the streamed content — the route group has a loading skeleton, and
    // sampling raw text before it resolves reads the skeleton, not the page.
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    const body = await page.locator('body').innerText()
    // Either "link not recognized" (DB reachable, token unknown) or the graceful
    // "temporarily unavailable" state (DB unreachable) — both are recoveries with a
    // next action, and neither is a 500 or a raw error.
    expect(body).toMatch(/couldn’t find that registration|couldn't find that registration|couldn’t load your registration|couldn't load your registration/i)
    await expect(page.getByRole('link', { name: /contact us/i })).toBeVisible()
    expect(body).not.toMatch(/ConfigError|Internal Server Error|Application error/i)
  })

  test('no token at all is handled the same way (a prefetch cannot cancel anyone)', async ({ page }) => {
    const res = await page.goto('/workshops/cancel')
    expect(res?.status()).toBe(200)
    // The confirm button only exists for a resolved, cancellable registration — a bare
    // GET must never expose (or perform) the cancellation.
    await expect(page.getByRole('button', { name: /yes, cancel my registration/i })).toHaveCount(0)
  })
})

test.describe('keyboard focus is visible on the funnel (WS-055)', () => {
  test('focused controls show a real focus indicator, not just a border tint', async ({ page }) => {
    await page.goto('/workshops')
    // Walk a few tab stops and require that at least one focusable control paints an
    // actual outline — the WS-055 regression was `outline:none` winning on form controls.
    let sawOutline = false
    for (let i = 0; i < 12 && !sawOutline; i++) {
      await page.keyboard.press('Tab')
      sawOutline = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return false
        const s = getComputedStyle(el)
        const width = parseFloat(s.outlineWidth || '0')
        return s.outlineStyle !== 'none' && width >= 2
      })
    }
    expect(sawOutline).toBe(true)
  })
})
