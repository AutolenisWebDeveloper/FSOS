// Native booking — Zoom client graceful-degradation proof (src/lib/zoom/client.ts).
// Compiles the client in isolation (node built-ins + fetch only, no @/ imports) and proves
// that with NO ZOOM_* credentials the whole integration is a clean no-op: zoomEnabled() is
// false and createZoomMeeting()/addZoomRegistrant() return { ok:false, error:'zoom_disabled' }
// WITHOUT touching the network — so a video booking still succeeds when Zoom is unconfigured
// (spec §5: "never a hard failure"). Run: node tests/zoom-meeting-create.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Ensure the integration is seen as unconfigured regardless of the ambient environment.
for (const k of ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_USER_ID']) delete process.env[k]

const out = mkdtempSync(join(tmpdir(), 'fsos-zoom-'))
execSync(
  `npx tsc src/lib/zoom/client.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { zoomEnabled, createZoomMeeting, addZoomRegistrant } = require(join(out, 'client.js'))

// Fail loudly if the disabled path ever reaches the network.
globalThis.fetch = () => {
  throw new Error('fetch must not be called when Zoom is disabled')
}

let passed = 0
const t = (name, fn) => fn().then(() => { passed++; console.log('  ✓', name) })

const run = async () => {
  await t('zoomEnabled() is false with no credentials', async () => {
    assert.equal(zoomEnabled(), false)
  })
  await t('createZoomMeeting is a clean no-op (zoom_disabled, no fetch)', async () => {
    const res = await createZoomMeeting({ topic: 'Intro', startTime: '2026-08-03T14:00:00Z', durationMinutes: 30 })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'zoom_disabled')
    assert.equal(res.joinUrl, undefined)
    assert.equal(res.startUrl, undefined)
  })
  await t('addZoomRegistrant is a clean no-op (zoom_disabled)', async () => {
    const res = await addZoomRegistrant({ meetingId: '123', email: 'a@b.com', firstName: 'A' })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'zoom_disabled')
  })
  console.log(`\nAll ${passed} assertions passed.`)
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
