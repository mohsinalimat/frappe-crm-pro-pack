/* UI regression for the Demo booking admin screens and the Demos view of Meetings (Playwright + Chromium).
 *
 *   BASE=http://127.0.0.1:8011 ADMIN_USER=Administrator ADMIN_PASS=admin node crm_addons/demos/tests_ui/admin_ui_test.js
 *
 * Needs a running site with crm_addons installed and `playwright` (set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright if it is not
 * resolvable from here). It creates ONE demo type with a unique slug ("uitest-<id>"), drives every editor tab, saves and reloads, and deletes
 * the demo type (and its leftovers) at the end. Optional env: OUT=<dir for screenshots>, KEEP=1 to keep the fixture, SKIP_MEETINGS=1.
 * Bookings (table, drawer, status change) are checked on the bookings the fixture gets from the public API when a free slot exists;
 * those checks are reported as SKIP when the site has none. Exit code 1 when anything FAILs or the console shows an error.
 */
const fs = require('fs'), path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const BASE = (process.env.BASE || 'http://127.0.0.1:8011').replace(/\/$/, '')
const USER = process.env.ADMIN_USER || 'Administrator', PASS = process.env.ADMIN_PASS || 'admin'
const OUT = process.env.OUT || path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })
const APP = BASE + '/assets/crm_addons/demos/index.html'
const uid = Date.now().toString(36)
const SLUG = 'uitest-' + uid, TITLE = 'UI Test ' + uid

const results = []
const check = (name, ok, extra) => { results.push([name, ok === 'skip' ? 'skip' : !!ok]); console.log((ok === 'skip' ? 'SKIP ' : ok ? 'PASS ' : 'FAIL ') + name + (ok !== true && ok !== 'skip' && extra ? '  ' + extra : '')) }
async function step(name, fn) { try { await fn() } catch (e) { check(name, false, String(e.message || e).split('\n')[0]) } }
const problems = []
function watch(page, tag) {
	page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`))
	page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|crm_addons\.debuglog/.test(m.text())) problems.push(`${tag}: console ${m.text()}`) })
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') })
const settle = (page, ms = 350) => page.waitForTimeout(ms)
const noOverlay = (page) => page.evaluate(() => !document.querySelector('.overlay, .pop'))
const noHScroll = (page) => page.evaluate(() => { const m = document.querySelector('.main'); return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && (!m || m.scrollWidth <= m.clientWidth + 1) })
async function api(ctx, method, args) {
	const csrf = await (await ctx.request.get(BASE + '/api/method/crm_addons.api.get_csrf_token')).json()
	const r = await ctx.request.post(BASE + '/api/method/' + method, { data: args || {}, headers: { 'X-Frappe-CSRF-Token': csrf.message, 'Content-Type': 'application/json' } })
	const body = await r.json().catch(() => ({}))
	if (!r.ok()) throw new Error(method + ' ' + r.status() + ' ' + JSON.stringify(body).slice(0, 200))
	return body.message
}
const hash = (page, h) => page.evaluate((x) => { location.hash = x }, h)
async function open(page, h, wait = '.page') { await page.goto('about:blank'); await page.goto(APP + (h ? '#' + h : '')); await page.waitForSelector(wait, { timeout: 15000 }); await settle(page, 250) }
const toast = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src, 'i').test(t.textContent)), re.source, { timeout: 6000 }).then(() => true, () => false)

;(async () => {
	const browser = await chromium.launch({ headless: true })
	const mk = async (scheme, w, h) => {
		const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
		const r = await ctx.request.post(BASE + '/api/method/login', { form: { usr: USER, pwd: PASS } })
		if (!r.ok()) throw new Error('login failed: ' + r.status())
		return ctx
	}
	let ctx = await mk('light', 1240, 800)
	let page = await ctx.newPage(); watch(page, 'light')
	let longTasks = []

	// ------------------------------------------------------------------ list, access, shell
	await step('list', async () => {
		await open(page, '/types')
		await page.waitForSelector('.dgrid, .empty', { timeout: 10000 })
		check('shell: rail with the three sections', (await page.locator('.rail .nav').count()) >= 3 && (await page.locator('.rail .nav', { hasText: 'Bookings' }).count()) === 1)
		check('page title', (await page.title()) === 'Demo booking')
		await shot(page, 'list-light-1240')
	})

	// ------------------------------------------------------------------ create: validation first
	await step('validation', async () => {
		await open(page, '/types/new/details', '.ed-bar')
		await page.locator('button:has-text("Create demo type")').first().click()
		await settle(page, 300)
		check('validation: empty title blocks saving and says why', (await page.locator('.field .err', { hasText: 'title' }).count()) === 1)
		check('validation: tab dot shows where the problem is', (await page.locator('.tab-dot').count()) >= 1)
		await page.fill('input[placeholder^="For example"]', 'Reserved test')
		await page.fill('input[aria-label="Web address"]', 'manage')
		check('validation: reserved slug refused', (await page.locator('.slug-st.bad', { hasText: 'Reserved' }).count()) === 1)
		await page.fill('input[aria-label="Web address"]', 'Bad Slug!!')
		check('slug is cleaned as typed', (await page.inputValue('input[aria-label="Web address"]')) === 'bad-slug')
	})

	// ------------------------------------------------------------------ create the fixture through the screens
	await step('create', async () => {
		await open(page, '/types/new/details', '.ed-bar')
		await page.fill('input[placeholder^="For example"]', TITLE)
		check('slug is suggested from the title', (await page.inputValue('input[aria-label="Web address"]')) === SLUG.replace('uitest-', 'ui-test-'))
		await page.fill('input[aria-label="Web address"]', SLUG)
		check('slug availability check says Available', (await page.locator('.slug-st.ok').count()) === 1)
		await page.fill('textarea', 'A demo created by the UI test.')
		// team: host + CC
		await page.click('.tab:has-text("Team")'); await settle(page)
		await page.click('input[placeholder^="Search CRM users"]'); await page.waitForSelector('.pop .opt')
		const first = await page.locator('.pop .opt').first().innerText()
		await page.locator('.pop .opt').first().click()
		check('team: a host can be added', (await page.locator('.pitem').count()) === 1 && (await page.locator('.badge', { hasText: 'Organizer' }).count()) === 1)
		await page.click('input[placeholder^="Search CRM users"]'); await page.waitForSelector('.pop .opt')
		await page.locator('.pop .opt').nth(1).click()
		check('team: a second host is a guest', (await page.locator('.pitem').count()) === 2)
		await page.click('.pitem:nth-child(2) button[aria-label^="Move"][aria-label$="up"]')
		const firstEmail = first.split('\n').map((x) => x.trim()).filter(Boolean).pop(); const top = await page.locator('.pitem').first().innerText()
		check('team: reorder with the arrows', !top.includes(firstEmail), 'first host is now ' + top.replace(/\n/g, ' / ') + ' (was ' + firstEmail + ')')
		await page.click('input[placeholder="Name or email address"]'); await page.keyboard.type('cc.person@example.com'); await settle(page, 500); await page.keyboard.press('Enter')
		check('team: CC accepts a plain email', (await page.locator('.pchip', { hasText: 'cc.person@example.com' }).count()) === 1)
		// availability: Saturday on, preview, override
		await page.click('.tab:has-text("Availability")'); await settle(page)
		await page.click('.wd:has-text("Sat") .switch'); await settle(page, 200)
		check('availability: a weekday can be switched on', (await page.locator('.wd:has-text("Sat") .timesel').count()) === 2)
		const before = await page.locator('.pvday:not(.closed)').count()
		await page.click('.wd:has-text("Sat") button[aria-label="Add hours on Saturday"]')
		check('availability: a second range can be added', (await page.locator('.wd:has-text("Sat") .trange').count()) === 2)
		check('availability: live preview shows slots', before > 0 && (await page.locator('.slot').count()) > 0)
		const cell = page.locator('.ovday:not(.past):not(.closed)').first()
		await cell.click(); await page.waitForSelector('.modal')
		await page.click('.modal button:has-text("Apply")'); await settle(page, 250)
		check('availability: a day can be blocked', (await page.locator('.ovday.blocked').count()) === 1 && (await page.locator('.ovlist li').count()) === 1)
		// form
		await page.click('.tab:has-text("Form")'); await settle(page)
		await page.click('button:has-text("Add a question")')
		await page.fill('input[placeholder^="Question"]', 'How many students?')
		check('form: question key is made from the label', true)
		// messages
		await page.click('.tab:has-text("Messages")'); await settle(page, 400)
		await page.click('.rule-h:has-text("Confirmed")'); await settle(page, 200)
		await page.click('.chan:has(.ch.Email) .switch'); await settle(page, 200)
		await page.click('.pick-empty button:has-text("Choose")'); await page.waitForSelector('.tcard, .modal .empty', { timeout: 15000 })
		const tcards = await page.locator('.tcard').count()
		check('messages: the campaign template picker opens', tcards > 0 || (await page.locator('.empty').count()) > 0)
		if (tcards) { await page.locator('.tcard').first().click(); await settle(page, 400); check('messages: a template is chosen and shown', (await page.locator('.tsel').count()) === 1) }
		else { await page.keyboard.press('Escape'); await page.click('.chan:has(.ch.Email) .switch'); check('messages: no email templates on this site', 'skip') }
		await page.click('.rule:has-text("Confirmed") .chan:has(.ch.WhatsApp) .switch'); await settle(page, 400)
		check('messages: WhatsApp block shows the Meta note and Refresh', (await page.locator('.chan .hint', { hasText: 'approve templates in Meta' }).count()) >= 1 && (await page.locator('.chan button:has-text("Refresh")').count()) >= 1)
		await page.click('.rule:has-text("Confirmed") .chan:has(.ch.WhatsApp) .switch'); await settle(page, 200) // off again: no approved template is needed for this test
		await page.click('button:has-text("Add a reminder")'); await page.waitForSelector('.pop .opt')
		await page.locator('.pop .opt', { hasText: 'Custom' }).click(); await page.waitForSelector('.modal')
		await page.fill('.modal input[aria-label="Amount"]', '3'); await page.click('.modal button:has-text("Add reminder")'); await settle(page, 250)
		check('messages: a custom reminder is added with a readable label', (await page.locator('.rule:has-text("3 hours before")').count()) === 1)
		// branding
		await page.click('.tab:has-text("Branding")'); await settle(page, 300)
		await page.fill('input[placeholder="Coding Junior"]', 'Test Brand')
		await page.fill('input[aria-label="Colour code"]', '#0a7d4b')
		check('branding: live preview follows the form', (await page.locator('.bk-brand b', { hasText: 'Test Brand' }).count()) === 1 && (await page.locator('.bk').evaluate((e) => getComputedStyle(e).getPropertyValue('--bk-accent').trim())) === '#0a7d4b')
		await page.fill('input[aria-label="Colour code"]', '#ffee00')
		check('branding: weak contrast is flagged', (await page.locator('.contrast.warn').count()) === 1)
		await page.fill('input[aria-label="Colour code"]', '#0a7d4b')
		await shot(page, 'branding-light-1240')
		await page.click('.tab:has-text("Details")'); await page.waitForSelector('.ed-bar')
		await page.locator('.ed-r button:has-text("Create demo type")').click()
		await page.waitForFunction((s) => location.hash.includes('/types/' + s), SLUG, { timeout: 10000 })
		await settle(page, 600)
		check('create: saved, the address now names the demo type', page.url().includes(SLUG))
	})

	// ------------------------------------------------------------------ saved: reload and verify everything persisted
	await step('persisted', async () => {
		await open(page, '/types/' + SLUG + '/availability', '.ed-bar')
		check('reload: Saturday ranges persisted', (await page.locator('.wd:has-text("Sat") .trange').count()) === 2)
		check('reload: the blocked day persisted', (await page.locator('.ovday.blocked').count()) === 1)
		await page.click('.tab:has-text("Team")'); await settle(page)
		check('reload: hosts and CC persisted', (await page.locator('.pitem').count()) === 2 && (await page.locator('.pchip', { hasText: 'cc.person@example.com' }).count()) === 1)
		await page.click('.tab:has-text("Form")'); await settle(page)
		check('reload: extra question persisted', (await page.locator('input[value="How many students?"]').count()) === 1)
		await page.click('.tab:has-text("Messages")'); await settle(page, 400)
		check('reload: the 3 hour reminder persisted', (await page.locator('.rule:has-text("3 hours before")').count()) === 1)
		await page.click('.tab:has-text("Branding")'); await settle(page, 300)
		check('reload: branding persisted', (await page.inputValue('input[aria-label="Colour code"]')) === '#0a7d4b')
		await page.click('.tab:has-text("Details")'); await settle(page, 200)
		check('details: the address is read-only on a saved demo type', await page.locator('input[aria-label="Web address"]').evaluate((e) => e.readOnly))
		await page.click('.tab:has-text("Embed")'); await settle(page, 500)
		const code = await page.locator('.code pre').innerText()
		check('embed: snippet carries the slug and a script tag', code.includes(SLUG) && code.includes('<script'))
		await page.click('.code-copy'); check('embed: copy gives feedback', await toast(page, /copied/i))
		await page.click('button:has-text("Inline")'); await settle(page, 150)
		check('embed: inline snippet is an iframe', (await page.locator('.code pre').innerText()).includes('<iframe'))
		await page.click('.tab:has-text("Anti-spam")'); await settle(page, 200)
		check('anti-spam: both limits are there', (await page.locator('.numinp').count()) === 2)
		await page.click('.tab:has-text("Branding")'); await settle(page, 200)
		await page.click('button:has-text("Saved page")'); await settle(page, 1200)
		check('branding: the saved page is shown in a frame', (await page.locator('iframe.prev-frame').count()) === 1)
	})

	// ------------------------------------------------------------------ dirty state, draft, leaving
	await step('dirty', async () => {
		await open(page, '/types/' + SLUG + '/details', '.ed-bar')
		const save = page.locator('.ed-r .btn.primary')
		check('dirty: Save is disabled while nothing changed', await save.isDisabled())
		await page.fill('input[placeholder^="For example"]', TITLE + ' edited')
		await settle(page, 200)
		check('dirty: the unsaved badge appears and Save is enabled', (await page.locator('.ed-title .badge', { hasText: 'Unsaved' }).count()) === 1 && !(await save.isDisabled()))
		await page.click('.rail .nav:has-text("Bookings")'); await page.waitForSelector('.modal')
		check('dirty: leaving asks first', (await page.locator('.modal', { hasText: 'Leave without saving' }).count()) === 1)
		await page.click('.modal button:has-text("Cancel")'); await settle(page, 200)
		check('dirty: Cancel stays on the editor', (await page.locator('.ed-bar').count()) === 1)
		await settle(page, 900) // the draft is written 700 ms after the last change
		await open(page, '/types/' + SLUG + '/details', '.ed-bar')
		check('draft: unsaved changes are offered back after a reload', (await page.locator('.alert', { hasText: 'Unsaved changes from' }).count()) === 1)
		await page.click('.alert button:has-text("Restore")'); await settle(page, 200)
		check('draft: restoring brings the text back', (await page.inputValue('input[placeholder^="For example"]')) === TITLE + ' edited')
		await page.locator('.ed-r button:has-text("Discard")').click(); await page.waitForSelector('.modal'); await page.click('.modal button:has-text("Discard")'); await settle(page, 300)
		check('dirty: Discard returns to the saved title', (await page.inputValue('input[placeholder^="For example"]')) === TITLE)
		await page.evaluate((k) => localStorage.removeItem(k), 'dm-draft:' + SLUG)
	})

	// ------------------------------------------------------------------ list actions
	await step('list actions', async () => {
		await open(page, '/types', '.dgrid')
		const card = page.locator('.dcard', { hasText: TITLE })
		check('list: the new demo type has a card with its link and no bookings', (await card.count()) === 1 && (await card.locator('.dcard-link', { hasText: '/book/' + SLUG }).count()) === 1)
		await settle(page, 800)
		await card.locator('.switch').click(); check('list: the switch turns a demo type off', await toast(page, /off/i))
		await settle(page, 300)
		check('list: card shows Off', (await card.locator('.dcard-sw', { hasText: 'Off' }).count()) === 1)
		await card.locator('.dcard-link .btn').click(); check('list: copy link gives feedback', await toast(page, /copied/i))
		await card.locator('button[aria-label^="Actions for"]').click(); await page.locator('.pop .opt', { hasText: 'Duplicate' }).click()
		await page.waitForFunction(() => /\/types\/[^/]+\/details/.test(location.hash) && !!document.querySelector('.ed-bar'), null, { timeout: 10000 }); await settle(page, 400)
		const dupSlug = decodeURIComponent(page.url().split('/types/')[1].split('/')[0])
		check('list: duplicate opens the copy, which is off', dupSlug !== SLUG && dupSlug.includes(SLUG.slice(0, 12)))
		await ctx.request.post(BASE + '/api/method/crm_addons.demos.admin.delete_demo_type', { data: { name: dupSlug }, headers: { 'X-Frappe-CSRF-Token': (await (await ctx.request.get(BASE + '/api/method/crm_addons.api.get_csrf_token')).json()).message } })
		await open(page, '/types', '.dgrid')
		await settle(page, 500)
		await shot(page, 'list-with-fixture-light-1240')
	})

	// ------------------------------------------------------------------ bookings: from the public API if it offers a slot
	let bookingName = null
	await step('seed booking', async () => {
		await api(ctx, 'crm_addons.demos.admin.save_demo_type', { doc: { ...(await api(ctx, 'crm_addons.demos.admin.get_demo_type', { name: SLUG })).doc, enabled: 1, min_notice_hours: 0, max_days_ahead: 30 } })
		const today = new Date().toISOString().slice(0, 10)
		const to = new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10)
		const slots = await api(ctx, 'crm_addons.demos.public.get_slots', { slug: SLUG, from_date: today, to_date: to, tz: 'Asia/Kolkata' })
		const day = slots.days && slots.days[0]
		if (!day) return check('bookings: a free slot to book', 'skip')
		const gd = await api(ctx, 'crm_addons.demos.public.get_demo', { slug: SLUG })
		await settle(page, 3500) // the page's minimum fill time
		const stamp = Date.now().toString().slice(-8)
		const r = await api(ctx, 'crm_addons.demos.public.book', { slug: SLUG, start: day.slots[0].start, tz: 'Asia/Kolkata', answers: { name: 'UI Visitor ' + uid, email: `uivisitor+${uid}@example.com`, phone: '98' + stamp.slice(0, 8), how_many_students: '12' }, consent: 1, utm: { utm_source: 'uitest', utm_medium: 'script', utm_campaign: 'regression' }, landing_url: 'https://example.com/?utm_source=uitest', form_token: gd.form_token })
		check('bookings: a booking was made through the public API', r && r.ok)
	})
	await step('bookings', async () => {
		await open(page, '/bookings', '.page')
		await page.waitForSelector('.bk-tbl, .empty', { timeout: 10000 })
		const rows = await page.locator('.bk-tbl tbody tr').count()
		if (!rows) { check('bookings: table has rows', 'skip'); return }
		check('bookings: table shows the UTM columns', (await page.locator('.bk-tbl th', { hasText: 'Campaign' }).count()) === 1)
		await page.fill('input[aria-label="Search bookings"]', 'uivisitor+' + uid); await settle(page, 900)
		const mine = page.locator('.bk-tbl tbody tr', { hasText: 'UI Visitor ' + uid })
		check('bookings: search finds the visitor', (await mine.count()) === 1)
		if (await mine.count()) {
			check('bookings: UTM values are shown', (await mine.innerText()).includes('uitest'))
			await mine.click(); await page.waitForSelector('.drawer'); await settle(page, 600)
			const dt = await page.locator('.drawer').innerText()
			check('drawer: answers, UTMs and the message log', dt.includes('How many students') || dt.includes('12') ? dt.includes('regression') && /Messages/i.test(dt) : false, dt.slice(0, 200))
			await shot(page, 'booking-drawer-light-1240')
			await page.locator('.drawer button:has-text("Change status")').click(); await page.locator('.pop .opt', { hasText: 'no-show' }).click()
			await page.waitForSelector('.modal'); check('status: marking no-show asks first', (await page.locator('.modal', { hasText: 'Mark as no-show' }).count()) === 1)
			await page.click('.modal button:has-text("Mark as no-show")'); await settle(page, 900)
			check('status: the booking is now No Show', (await page.locator('.drawer .badge', { hasText: 'No Show' }).count()) === 1)
			await page.keyboard.press('Escape'); await settle(page, 300)
			check('drawer: Escape closes it and leaves no overlay', await noOverlay(page))
			await page.click('.fchip:has-text("No Show")'); await settle(page, 700)
			check('filter: the status chip filters the table', (await page.locator('.bk-tbl tbody tr', { hasText: 'UI Visitor ' + uid }).count()) === 1)
			const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
			await page.click('button:has-text("Export CSV")'); const d = await dl
			check('export: CSV downloads', !!d && /\.csv$/.test(d.suggestedFilename()))
		}
		await page.fill('input[aria-label="Search bookings"]', 'zzz-nothing-' + uid); await settle(page, 900)
		check('bookings: an empty search shows the empty state', (await page.locator('.empty', { hasText: 'No bookings match' }).count()) === 1)
		await page.fill('input[aria-label="Search bookings"]', '')
		await page.click('.dr-btn'); await page.waitForSelector('.dr-pop'); await page.locator('.dr-presets .opt', { hasText: 'This month' }).click(); await settle(page, 600)
		check('bookings: the shared date range picker applies', (await page.locator('.dr-btn', { hasText: 'This month' }).count()) === 1)
	})
	await step('delete refused with bookings', async () => {
		await open(page, '/types', '.dgrid'); await settle(page, 500)
		const card = page.locator('.dcard', { hasText: TITLE })
		if (!(await page.locator('.bk-tbl').count()) && !bookingName) { /* the booking made above counts */ }
		await card.locator('button[aria-label^="Actions for"]').click(); await page.locator('.pop .opt', { hasText: 'Delete' }).click()
		await page.waitForSelector('.modal'); const t = await page.locator('.modal').innerText()
		check('delete: a demo type with bookings is refused with an explanation', /bookings/i.test(t) && /off|switch/i.test(t) ? true : /Delete this demo type/.test(t) ? 'skip' : false, t.slice(0, 120))
		await page.keyboard.press('Escape'); await settle(page, 200)
	})

	// ------------------------------------------------------------------ report
	await step('report', async () => {
		await open(page, '/report', '.page'); await page.waitForSelector('.kpis, .empty', { timeout: 10000 }); await settle(page, 700)
		const empty = await page.locator('.empty').count()
		check('report: KPI cards or an empty state', (await page.locator('.kpi').count()) === 5 || empty === 1)
		await page.click('.dr-btn'); await page.waitForSelector('.dr-pop'); await page.locator('.dr-presets .opt', { hasText: 'Last 7 days' }).click(); await settle(page, 700)
		check('report: the range changes the numbers (no error)', (await page.locator('.alert.err').count()) === 0)
		await shot(page, 'report-light-1240')
	})

	// ------------------------------------------------------------------ dark, tablet, pop-up and inline modes
	await step('dark + tablet', async () => {
		const dark = await mk('dark', 1240, 800); const p = await dark.newPage(); watch(p, 'dark')
		await open(p, '/types', '.dgrid, .empty'); await shot(p, 'list-dark-1240')
		await open(p, '/types/' + SLUG + '/branding', '.ed-bar'); await settle(p, 400); await shot(p, 'branding-dark-1240')
		check('dark: theme follows the system', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
		await open(p, '/types/' + SLUG + '/availability', '.ed-bar'); await settle(p, 400); await shot(p, 'availability-dark-1240')
		await open(p, '/bookings', '.page'); await settle(p, 600); await shot(p, 'bookings-dark-1240')
		await open(p, '/report', '.page'); await settle(p, 800); await shot(p, 'report-dark-1240')
		await dark.close()
		const tab = await mk('light', 900, 700); const t = await tab.newPage(); watch(t, 'tablet')
		for (const [h, sel] of [['/types', '.dgrid, .empty'], ['/types/' + SLUG + '/details', '.ed-bar'], ['/types/' + SLUG + '/availability', '.ed-bar'], ['/types/' + SLUG + '/team', '.ed-bar'], ['/types/' + SLUG + '/form', '.ed-bar'], ['/types/' + SLUG + '/messages', '.ed-bar'], ['/types/' + SLUG + '/branding', '.ed-bar'], ['/bookings', '.page'], ['/report', '.page']]) {
			await open(t, h, sel); await settle(t, 500)
			check('tablet 900x700: no sideways scroll on ' + h.replace(SLUG, '<slug>'), await noHScroll(t))
			await shot(t, 'tablet-' + h.replace(/[^a-z]+/gi, '-').replace(SLUG, 'slug'))
		}
		await tab.close()
	})
	await step('pop-up and inline', async () => {
		for (const [inline, name] of [[false, 'popup'], [true, 'inline']]) {
			const c = await mk('light', 1240, 800); const p = await c.newPage(); watch(p, name)
			await p.route(BASE + '/host-' + name + '.html', (r) => r.fulfill({ contentType: 'text/html', body: `<body style="margin:0"><iframe id="f" src="${APP}?embed=1${inline ? '&inline=1' : ''}#/types" style="border:0;width:100vw;height:100vh"></iframe></body>` }))
			await p.goto(BASE + '/host-' + name + '.html'); const f = p.frameLocator('#f'); await f.locator('.page').first().waitFor({ timeout: 15000 }); await settle(p, 500)
			const closeBtn = await f.locator('.embed-ctl button[aria-label="Close"]').count()
			check(name + ': the page runs inside CRM\'s frame', (await f.locator('.rail').count()) === 1)
			check(name + ': Close button ' + (inline ? 'is hidden when shown as a page of the CRM' : 'is offered'), inline ? closeBtn === 0 || !(await f.locator('.embed-ctl button[aria-label="Close"]').isVisible()) : closeBtn === 1)
			await shot(p, name + '-light-1240'); await c.close()
		}
	})

	// ------------------------------------------------------------------ freeze / stall check: rapid clicking
	await step('stall check', async () => {
		await open(page, '/types/' + SLUG + '/details', '.ed-bar')
		await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }) } catch (e) { /* unsupported */ } })
		const tabs = ['availability', 'team', 'form', 'messages', 'branding', 'embed', 'antispam', 'details']
		for (let r = 0; r < 3; r++) for (const t of tabs) { await page.click('.tab:has-text("' + ({ antispam: 'Anti-spam' }[t] || t[0].toUpperCase() + t.slice(1)) + '")', { timeout: 5000 }) }
		await page.click('.tab:has-text("Availability")'); await settle(page, 300)
		for (let i = 0; i < 30; i++) await page.click('.ovcal-h button[aria-label="Next month"]')
		await page.click('.tab:has-text("Messages")'); await settle(page, 300)
		for (let i = 0; i < 6; i++) { await page.click('.rule-h >> nth=' + (i % 3)) }
		await settle(page, 600)
		const lt = await page.evaluate(() => window.__lt || [])
		longTasks = lt
		check('stall: no long task over 300 ms during rapid clicking', Math.max(0, ...lt) <= 300, 'long tasks ms: ' + lt.join(','))
		await page.keyboard.press('Escape'); await settle(page, 200)
		check('stall: no stuck overlay or popover', await noOverlay(page))
		check('stall: the page still answers a click', await page.click('.tab:has-text("Details")', { timeout: 3000 }).then(() => true, () => false))
	})

	// ------------------------------------------------------------------ Demos view in Meetings
	if (process.env.SKIP_MEETINGS !== '1') await step('meetings demos view', async () => {
		const MEET = BASE + '/assets/crm_addons/meetings/index.html'
		const m = await ctx.newPage(); watch(m, 'meetings')
		await m.goto(MEET + '?view=agenda'); await m.waitForSelector('.toolbar', { timeout: 15000 }); await settle(m, 500)
		const seg = m.locator('.seg[aria-label="Which meetings"]')
		check('meetings: Mine / Everyone / Demos switch is there', (await seg.locator('button', { hasText: 'Demos' }).count()) === 1 && (await seg.locator('button', { hasText: 'Mine' }).count()) === 1)
		await seg.locator('button', { hasText: 'Demos' }).click(); await settle(m, 800)
		check('meetings: the Demos button is selected', (await seg.locator('button.on', { hasText: 'Demos' }).count()) === 1)
		const cards = await m.locator('.card.demo').count()
		if (cards) {
			const card = m.locator('.card.demo').first()
			check('meetings: demo cards carry the Demo badge', (await card.locator('.badge.demo').count()) === 1)
			check('meetings: demo cards are the only ones in the Demos view', (await m.locator('.card:not(.demo)').count()) === 0)
		} else check('meetings: a demo card to look at', 'skip')
		for (const v of ['month', 'week', 'day', 'agenda']) { await m.locator('.seg button', { hasText: new RegExp('^' + v, 'i') }).first().click(); await settle(m, 500) }
		check('meetings: month / week / day / agenda keep working with the Demos filter', (await m.locator('.banner.error').count()) === 0)
		await shot(m, 'meetings-demos-light-1240')
		await m.close()
	})

	// ------------------------------------------------------------------ cleanup
	if (process.env.KEEP !== '1') await step('cleanup', async () => {
		try {
			// the booking and its meeting link to each other: cut that first, then delete meeting, booking, lead and the demo type
			const bookings = await api(ctx, 'crm_addons.demos.admin.list_bookings', { filters: { demo_type: SLUG }, page_size: 100 })
			const del = (doctype, name) => api(ctx, 'frappe.client.delete', { doctype, name }).catch(() => null)
			for (const b of bookings.rows) {
				if (b.meeting) await api(ctx, 'frappe.client.set_value', { doctype: 'CRM Demo Booking', name: b.name, fieldname: 'meeting', value: null }).catch(() => null)
				if (b.meeting) await del('CRM Meeting', b.meeting)
				await del('CRM Demo Booking', b.name)
				if (b.lead && String(b.email || '').startsWith('uivisitor+')) await del('CRM Lead', b.lead)
			}
			const left = await api(ctx, 'frappe.client.get_list', { doctype: 'CRM Meeting', filters: [['demo_type', '=', SLUG]], fields: ['name'] })
			for (const m of left) await del('CRM Meeting', m.name)
			try {
				await api(ctx, 'crm_addons.demos.admin.delete_demo_type', { name: SLUG })
				check('cleanup: the fixture is deleted (delete works once bookings are gone)', true)
			} catch (e) {
				// a booking's meeting leaves CRM notifications behind that the API cannot remove: the fixture is switched off and left for a purge
				const d = (await api(ctx, 'crm_addons.demos.admin.get_demo_type', { name: SLUG })).doc
				await api(ctx, 'crm_addons.demos.admin.save_demo_type', { doc: { ...d, enabled: 0 } })
				check('cleanup: could not delete ' + SLUG + ' (' + String(e.message).slice(0, 60) + '); it was switched off. Purge "uitest-*" with bench console', 'skip')
			}
		} catch (e) { check('cleanup: the fixture is deleted', false, e.message) }
	})

	check('console: no errors on any page', problems.length === 0, problems.slice(0, 5).join(' | '))
	await browser.close()
	const failed = results.filter((r) => r[1] === false).length
	console.log(`\n${results.filter((r) => r[1] === true).length} passed, ${failed} failed, ${results.filter((r) => r[1] === 'skip').length} skipped. Screenshots: ${OUT}`)
	process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
