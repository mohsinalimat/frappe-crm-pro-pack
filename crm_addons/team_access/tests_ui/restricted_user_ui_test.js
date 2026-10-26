/* UI regression: what a person with limited access really sees (Playwright + Chromium).
 *
 *   BASE=http://127.0.0.1:8011 ADMIN_USER=Administrator ADMIN_PASS=admin node crm_addons/team_access/tests_ui/restricted_user_ui_test.js
 *
 * It creates one Sales User (ax.ui.<id>@example.org), gives them a preset through the Team and access API, logs in as them and checks the Campaign
 * Manager, Bookings, Meetings and Assignment screens; then removes the user. Set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright if needed.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const BASE = (process.env.BASE || 'http://127.0.0.1:8011').replace(/\/$/, '')
const EMAIL = `ax.ui.${Date.now().toString(36)}@example.org`, PWD = 'Ax#UiTest2026x'
const results = []
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (extra || ''))) }
const problems = []
;(async () => {
	const browser = await chromium.launch()
	const admin = await browser.newContext()
	const login = await admin.request.post(BASE + '/api/method/login', { form: { usr: process.env.ADMIN_USER || 'Administrator', pwd: process.env.ADMIN_PASS || 'admin' } })
	if (!login.ok()) throw new Error('admin login failed')
	const csrf = (await (await admin.request.get(BASE + '/api/method/crm_addons.api.get_csrf_token')).json()).message
	const call = async (ctx, method, data) => { const r = await ctx.request.post(BASE + '/api/method/' + method, { data, headers: { 'X-Frappe-CSRF-Token': csrf, 'Content-Type': 'application/json' } }); const b = await r.json().catch(() => ({})); if (!r.ok()) throw new Error(method + ' ' + r.status() + ' ' + JSON.stringify(b).slice(0, 200)); return b.message }
	const cleanup = async () => { try { await call(admin, 'frappe.client.delete', { doctype: 'CRM User Access', name: EMAIL }) } catch (e) { /* none */ } try { await call(admin, 'frappe.client.delete', { doctype: 'User', name: EMAIL }) } catch (e) { try { await call(admin, 'frappe.client.set_value', { doctype: 'User', name: EMAIL, fieldname: 'enabled', value: 0 }) } catch (e2) { /* left as is */ } } }
	await call(admin, 'frappe.client.insert', { doc: { doctype: 'User', email: EMAIL, first_name: 'Ax Ui', send_welcome_email: 0, new_password: PWD, roles: [{ role: 'Sales User' }] } })
	try {
		const as = async (preset, overrides) => { await call(admin, 'crm_addons.team_access.admin.save_user_access', { user: EMAIL, preset, overrides: JSON.stringify(overrides || {}) }) }
		const open = async (path, ready) => {
			const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
			const r = await ctx.request.post(BASE + '/api/method/login', { form: { usr: EMAIL, pwd: PWD } })
			if (!r.ok()) throw new Error('user login failed')
			const page = await ctx.newPage()
			page.on('pageerror', (e) => problems.push('pageerror ' + e.message))
			page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|debuglog|403|417/.test(m.text())) problems.push('console ' + m.text()) })
			await page.goto(BASE + path + '?v=' + Date.now()); await page.waitForSelector(ready || '.app', { timeout: 15000 }); await page.waitForTimeout(1500)
			return { ctx, page }
		}
		const rail = (page) => page.locator('.rail .nav-l').allInnerTexts()

		// 1. the template designer: only the template screens
		await as('Template Designer')
		{
			const { ctx, page } = await open('/assets/crm_addons/campaigns/index.html#/')
			const items = (await rail(page)).map((s) => s.trim())
			check('template designer: only the template screens are in the menu', items.includes('Email templates') && items.includes('WhatsApp templates') && !items.includes('Campaigns') && !items.includes('Automations') && !items.includes('Audiences') && !items.includes('Reports') && !items.includes('List clean-up'), items.join(', '))
			check('template designer: lands on the templates, not an empty Campaigns page', /templates/.test(page.url()))
			check('template designer: can create a template', (await page.locator('button:has-text("Create template")').count()) >= 1)
			await ctx.close()
		}
		// 2. a campaign executive with a view-only template library
		await as('Campaign Executive', { email_templates: 'view' })
		{
			const { ctx, page } = await open('/assets/crm_addons/campaigns/index.html#/templates/email')
			const items = (await rail(page)).map((s) => s.trim())
			check('campaign executive: sees campaigns, automations, audiences and reports', ['Campaigns', 'Automations', 'Audiences', 'Reports'].every((x) => items.includes(x)), items.join(', '))
			check('view-only templates: no Create template button', (await page.locator('button:has-text("Create template")').count()) === 0)
			await ctx.close()
		}
		// 3. a plain sales user: demos is theirs only, widgets hidden
		await as(null, {})
		{
			const { ctx, page } = await open('/assets/crm_addons/demos/index.html#/')
			const items = (await rail(page)).map((s) => s.trim())
			check('sales user: the Bookings screen offers Bookings only', items.includes('Bookings') && !items.includes('Widgets') && !items.includes('Report'), items.join(', '))
			await ctx.close()
		}
		await as('Booking Host', { demo_widgets: 'view' })
		{
			const { ctx, page } = await open('/assets/crm_addons/demos/index.html#/types')
			check('widgets: view only shows the banner', (await page.locator('text=View only').count()) >= 1)
			check('widgets: no Create button', (await page.locator('button:has-text("Create widget")').count()) === 0)
			await ctx.close()
		}
		// 4. assignment: nothing by default, only the history when that is given
		await as(null, {})
		{
			const { ctx, page } = await open('/assets/crm_addons/campaigns/assignment.html#/', '.app')
			check('assignment: a sales user is told they have no access', (await page.locator('text=You do not have access to lead assignment').count()) === 1)
			await ctx.close()
		}
		await as(null, { assignment_history: 'own' })
		{
			const { ctx, page } = await open('/assets/crm_addons/campaigns/assignment.html#/', '.app')
			const items = (await rail(page)).map((s) => s.trim())
			check('assignment: only the History part is offered', items.includes('History') && !items.includes('Rules') && !items.includes('Move leads'), items.join(', '))
			await ctx.close()
		}
		// 5. meetings: the team label and the Bookings tab switch
		await as(null, { meetings: 'team', meetings_demos_tab: 0 })
		{
			const { ctx, page } = await open('/assets/crm_addons/meetings/index.html', '.seg')
			const labels = (await page.locator('.seg[aria-label="Which meetings"] button').allInnerTexts()).map((s) => s.trim())
			check('meetings: "My team" instead of Everyone, and no Bookings tab', labels.includes('My team') && !labels.some((l) => /Bookings/.test(l)), labels.join(', '))
			await ctx.close()
		}
		check('console: no errors', problems.length === 0, problems.slice(0, 3).join(' | '))
	} finally {
		await cleanup()
		await browser.close()
	}
	const failed = results.filter((x) => !x).length
	console.log(`\n${results.length - failed} passed, ${failed} failed`)
	process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
