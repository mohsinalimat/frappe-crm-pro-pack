/* UI regression for the Team and access screens (Playwright + Chromium).
 *
 *   BASE=http://127.0.0.1:8011 ADMIN_USER=Administrator ADMIN_PASS=admin node crm_addons/team_access/tests_ui/access_ui_test.js
 *
 * It picks a Sales User that nobody configured, gives them a preset and one change, checks it persisted, takes it back, and creates /
 * duplicates / deletes a preset. Everything it makes it removes. Set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright if needed.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const BASE = (process.env.BASE || 'http://127.0.0.1:8011').replace(/\/$/, '')
const APP = BASE + '/assets/crm_addons/access/index.html'
const results = []
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))) }
const problems = []
;(async () => {
	const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
	const login = await ctx.request.post(BASE + '/api/method/login', { form: { usr: process.env.ADMIN_USER || 'Administrator', pwd: process.env.ADMIN_PASS || 'admin' } })
	if (!login.ok()) throw new Error('login failed')
	const page = await ctx.newPage()
	page.on('pageerror', (e) => problems.push('pageerror ' + e.message))
	page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|debuglog/.test(m.text())) problems.push('console ' + m.text()) })
	const settle = (ms = 400) => page.waitForTimeout(ms)
	const pick = async (label, text) => { await page.locator(`.dd-btn[aria-label="${label}"]`).click(); await settle(200); await page.locator('[role="option"]', { hasText: text }).first().click(); await settle(250) }
	const step = async (name, fn) => { try { await fn() } catch (e) { check(name, false, String(e.message).split('\n')[0]) } }

	await page.goto(APP + '?v=' + Date.now() + '#/people'); await page.waitForSelector('.ax-tbl tbody tr', { timeout: 15000 })
	check('people: the list shows CRM people', (await page.locator('.ax-tbl tbody tr').count()) > 0)
	check('people: administrators are marked Full access', (await page.locator('.badge', { hasText: 'Full access' }).count()) > 0)
	await step('search', async () => { await page.fill('input[aria-label="Search people"]', 'zzzznobody'); await settle(); check('people: search with no match shows an empty state', (await page.locator('.empty').count()) === 1); await page.fill('input[aria-label="Search people"]', ''); await settle() })

	// a Sales User nobody configured
	const row = page.locator('.ax-tbl tbody tr', { has: page.locator('.badge', { hasText: 'Sales User' }) }).filter({ hasText: 'Role default' }).filter({ hasNot: page.locator('.badge', { hasText: 'Sales Manager' }) }).first()
	const email = (await row.locator('.small.muted').first().innerText()).trim()
	await step('assign', async () => {
		await row.click(); await page.waitForSelector('.drawer'); await settle(500)
		check('editor: shows the roles and the facts', (await page.locator('.ax-facts').count()) === 1)
		check('editor: every feature is listed', (await page.locator('.ax-row').count()) >= 15)
		check('editor: Save is disabled while nothing changed', await page.locator('button:has-text("Save changes")').isDisabled())
		await pick('Preset', 'Team Lead')
		check('editor: choosing a preset marks its values "From preset"', (await page.locator('.ax-row .badge', { hasText: 'From preset' }).count()) > 5)
		await pick('Follow-ups', 'Everyone')
		check('editor: a changed value is marked Changed', (await page.locator('.ax-row.changed').count()) === 1)
		check('editor: Save is enabled and says unsaved', (await page.locator('button:has-text("Save changes")').isEnabled()) && (await page.locator('text=Unsaved changes').count()) >= 1)
		await page.locator('button:has-text("Save changes")').click(); await page.waitForSelector('.drawer', { state: 'detached', timeout: 10000 })
		await settle(400)
		const r = page.locator('.ax-tbl tbody tr', { hasText: email })
		check('people: the row shows the preset and one change', (await r.locator('.badge', { hasText: 'Team Lead' }).count()) === 1 && (await r.locator('.badge', { hasText: '1 change' }).count()) === 1)
	})
	await step('persisted', async () => {
		await page.reload(); await page.waitForSelector('.ax-tbl tbody tr'); await page.locator('.ax-tbl tbody tr', { hasText: email }).click(); await page.waitForSelector('.drawer'); await settle(600)
		const fu = page.locator('.ax-row', { hasText: 'Follow-ups' }).first()
		check('reload: the change persisted', (await fu.locator('.badge', { hasText: 'Changed' }).count()) === 1 && (await fu.innerText()).includes('Everyone'))
		await fu.locator('button[aria-label="Undo this change"]').click(); await settle(250)
		check('editor: undo returns the value to the preset', (await fu.locator('.badge', { hasText: 'From preset' }).count()) === 1)
		await pick('Preset', 'No preset')
		check('editor: no preset falls back to the role default', (await page.locator('.ax-row .badge', { hasText: 'Role default' }).count()) > 5)
		await page.locator('button:has-text("Save changes")').click(); await page.waitForSelector('.drawer', { state: 'detached', timeout: 10000 }); await settle(400)
		check('people: back to Role default', (await page.locator('.ax-tbl tbody tr', { hasText: email }).locator('text=Role default').count()) === 1)
	})
	await step('discard', async () => {
		await page.locator('.ax-tbl tbody tr', { hasText: email }).click(); await page.waitForSelector('.drawer'); await settle(400)
		await pick('Preset', 'Sales Executive')
		await page.locator('.drawer button:has-text("Cancel")').click(); await settle(300)
		check('editor: leaving with changes asks first', (await page.locator('.confirm, [role="alertdialog"], .modal:has-text("Discard")').count()) >= 1)
		await page.locator('button:has-text("Discard")').last().click(); await settle(400)
		check('editor: Discard closes it and saves nothing', (await page.locator('.drawer').count()) === 0 && (await page.locator('.ax-tbl tbody tr', { hasText: email }).locator('text=Role default').count()) === 1)
	})
	await step('presets', async () => {
		await page.goto(APP + '?v=' + Date.now() + '#/presets'); await page.waitForSelector('.ax-preset', { timeout: 15000 })
		check('presets: the ready-made ones are there', (await page.locator('.ax-preset .badge', { hasText: 'Ready-made' }).count()) >= 4)
		await page.locator('.ax-preset', { hasText: 'Sales Executive' }).locator('button[aria-label="Duplicate"]').click(); await page.waitForSelector('.drawer'); await settle(400)
		check('presets: duplicate opens a new preset filled from the original', (await page.inputValue('input[aria-label="Preset name"]')) === 'Sales Executive copy')
		await page.fill('input[aria-label="Preset name"]', 'UI Test Preset'); await pick('Follow-ups', 'My team')
		await page.locator('button:has-text("Create preset")').click(); await page.waitForSelector('.drawer', { state: 'detached', timeout: 10000 }); await settle(400)
		check('presets: the new preset is listed with 0 people', (await page.locator('.ax-preset', { hasText: 'UI Test Preset' }).locator('text=0 people').count()) === 1)
		await page.locator('.ax-preset', { hasText: 'UI Test Preset' }).locator('button[aria-label="Delete"]').click(); await settle(300)
		await page.locator('button:has-text("Delete")').last().click(); await settle(600)
		check('presets: delete removes it', (await page.locator('.ax-preset', { hasText: 'UI Test Preset' }).count()) === 0)
	})
	await step('mobile', async () => {
		await page.setViewportSize({ width: 390, height: 800 }); await page.goto(APP + '?v=' + Date.now() + '#/people'); await page.waitForSelector('.ax-tbl tbody tr'); await settle(400)
		check('mobile: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2))
	})
	check('console: no errors', problems.length === 0, problems.slice(0, 3).join(' | '))
	await browser.close()
	const failed = results.filter((x) => !x).length
	console.log(`\n${results.length - failed} passed, ${failed} failed`)
	process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
