/* UI regression for the public demo booking widget (Playwright + Chromium).
 *
 *   BASE=http://localhost:8000 SLUG=my-demo node crm_addons/demos/tests_ui/book_ui.js
 *
 * Needs a running site that has the demo type SLUG (enabled, with free slots in the next days) and `playwright`
 * installed (set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright if it is not resolvable from here).
 * Optional env: OUT=<dir for screenshots>, ALLOWED_HOST_PORT / BLOCKED_HOST_PORT (ports of throw-away static hosts the script starts,
 * defaults 4181 / 4182; the demo type's allowed_origins must contain http://localhost:4181 and NOT http://localhost:4182 for the
 * framing checks to pass; set CHECK_FRAMING=0 to skip them), BOOK_FIELDS=1 to also fill every optional field.
 * Every booking it makes uses unique contact details (tag "uitest"), so run it against a test site.
 */
const http = require('http'), fs = require('fs'), path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const BASE = (process.env.BASE || 'http://localhost:8000').replace(/\/$/, '')
const SLUG = process.env.SLUG || 'demo'
const OUT = process.env.OUT || path.join(__dirname, 'out')
const FRAMING = process.env.CHECK_FRAMING !== '0'
const ALLOWED_PORT = +(process.env.ALLOWED_HOST_PORT || 4181), BLOCKED_PORT = +(process.env.BLOCKED_HOST_PORT || 4182)
const WIDGET_DIR = path.join(__dirname, '..', '..', 'public', 'book')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra ? '  ' + extra : '')) }
const uid = Date.now().toString(36)
let seq = 0
const person = () => { seq++; const n = String(Date.now() + seq * 7919).slice(-8); return { name: 'UI Test ' + uid + seq, email: `uitest+${uid}${seq}@example.com`, phone: '98' + n.slice(0, 8) } }

const problems = []
function watch(page, tag, allowFraming) {
	if (process.env.DEBUG_API) page.on('response', async r => { if (/public\./.test(r.url()) && r.request().method() === 'POST') console.log('  API', r.status(), (await r.text().catch(() => '')).slice(0, 300)) })
	page.on('pageerror', e => problems.push(`${tag}: pageerror ${e.message}`))
	page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !(allowFraming && /Framing/.test(m.text()))) problems.push(`${tag}: console ${m.text()}`) })
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true })

async function openBook(ctx, qs = '', slug = SLUG) {
	const page = await ctx.newPage(); watch(page, slug)
	await page.goto(`${BASE}/book/${slug}${qs}`)
	return page
}
async function pickFirstSlot(page) {
	await page.waitForSelector('.bk-day.ok', { timeout: 15000 })
	const sel = await page.$('.bk-day.sel')
	if (!sel) await page.click('.bk-day.ok')
	await page.waitForSelector('.bk-slot:not(.sk)')
	const label = await page.locator('.bk-slot').first().innerText()
	await page.locator('.bk-slot').first().click()
	await page.waitForSelector('.bk-form')
	return label.trim()
}
async function fillForm(page, p) {
	const n = await page.locator('.bk-field').count()
	for (let i = 0; i < n; i++) {
		const f = page.locator('.bk-field').nth(i)
		const kind = await f.evaluate(el => el.querySelector('input[type=tel]') ? 'tel' : el.querySelector('input[type=email]') ? 'email' : el.querySelector('select') ? 'select' : el.querySelector('textarea') ? 'ta' : el.querySelector('input[type=checkbox]') ? 'chk' : el.querySelector('input[type=text]') ? 'text' : '')
		const label = (await f.innerText()).toLowerCase()
		if (kind === 'tel') await f.locator('input[type=tel]').fill(p.phone)
		else if (kind === 'email') await f.locator('input[type=email]').fill(p.email)
		else if (kind === 'text') { if (/name/.test(label) && !/school|company|organi|institut/.test(label)) await f.locator('input').fill(p.name); else if (process.env.BOOK_FIELDS || /\*/.test(label)) await f.locator('input').fill('UI Test School') }
		else if (kind === 'select') { if (process.env.BOOK_FIELDS || /\*/.test(label)) await f.locator('select').selectOption({ index: 1 }) }
		else if (kind === 'ta') { if (process.env.BOOK_FIELDS || /\*/.test(label)) await f.locator('textarea').fill('uitest note') }
		else if (kind === 'chk') { if (/\*/.test(label)) { const c = f.locator('input'); if (!(await c.isChecked())) await c.click({ force: true }); await page.waitForTimeout(80) } }
	}
}

;(async () => {
	const browser = await chromium.launch()
	const mk = (o = {}) => browser.newContext(Object.assign({ viewport: { width: 1100, height: 800 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN', colorScheme: 'light', acceptDownloads: true }, o))

	/* 1. desktop: layout, themes, no overflow */
	for (const scheme of ['light', 'dark']) {
		const ctx = await mk({ colorScheme: scheme }); const page = await openBook(ctx)
		await page.waitForSelector('.bk-day.ok', { timeout: 15000 })
		await page.waitForTimeout(400)
		check(`desktop ${scheme}: card + calendar + slots visible`, await page.isVisible('.bk-panel') && await page.isVisible('.bk-cal') && await page.isVisible('.bk-slots'))
		check(`desktop ${scheme}: no horizontal scroll`, await noHScroll(page))
		const theme = await page.evaluate(() => document.documentElement.dataset.theme)
		check(`desktop ${scheme}: theme resolved (${theme})`, theme === scheme || theme === 'light' || theme === 'dark')
		check(`desktop ${scheme}: noindex meta`, /noindex/.test(await page.getAttribute('meta[name=robots]', 'content')))
		await shot(page, `01-slots-${scheme}`)
		await ctx.close()
	}
	{ // 12h / 24h and time zone
		const ctx = await mk(); const page = await openBook(ctx)
		await pickFirstSlotSafe(page)
		const t12 = await page.locator('.bk-slot').first().innerText()
		await page.click('.bk-seg button:has-text("24h")')
		const t24 = await page.locator('.bk-slot').first().innerText()
		check('24h toggle changes the labels', t12 !== t24 && !/am|pm/i.test(t24), t12 + ' / ' + t24)
		await page.click('.bk-tz-btn'); await page.fill('.bk-tz-pop input', 'new york'); await page.keyboard.press('Enter')
		await page.waitForSelector('.bk-day.ok', { timeout: 15000 })
		check('time zone picker switches zone', /New York/.test(await page.innerText('.bk-tz-btn')))
		await shot(page, '02-timezone-changed')
		await ctx.close()
	}

	/* 2. full journey: validation, book, confirmation, calendar, reschedule, cancel */
	let manageUrl = ''
	{
		const ctx = await mk(); const page = await openBook(ctx)
		const slotText = await pickFirstSlot(page)
		await shot(page, '03-form-empty')
		await page.click('.bk-btn.primary')
		check('empty submit shows required errors', (await page.$$('.bk-err')).length >= 2)
		await shot(page, '04-form-errors')
		const p = person()
		await fillForm(page, p)
		await page.locator('input[type=email]').first().fill('not-an-email'); await page.locator('input[type=email]').first().blur()
		check('invalid email message', /valid email/i.test(await page.innerText('.bk-form')))
		await page.locator('input[type=email]').first().fill(p.email)
		await page.locator('input[type=tel]').fill('12345'); await page.locator('input[type=tel]').blur()
		check('India phone rule (10 digits, 6-9)', /10-digit/i.test(await page.innerText('.bk-form')))
		await page.locator('input[type=tel]').fill(p.phone)
		const guestBtn = page.locator('.bk-guests .bk-ghost-btn').first()
		if (await guestBtn.count()) {
			await guestBtn.click(); await page.locator('.bk-guest input').first().fill('bad-guest'); await page.click('.bk-btn.primary')
			check('guest email validated', /valid email/i.test(await page.innerText('.bk-guests')))
			await page.locator('.bk-guest input').first().fill(`uitest+g${uid}@example.com`)
		}
		await shot(page, '05-form-filled')
		await page.click('.bk-btn.primary')
		await page.waitForSelector('.bk-done', { timeout: 30000 })
		check('confirmation shown', await page.isVisible('#bk-done-title'))
		check('confirmation shows the time', /\d/.test(await page.innerText('.bk-summary')))
		await shot(page, '06-confirmation')
		await page.click('.bk-menu button'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bk-menu-pop button')])
		const ics = fs.readFileSync(await dl.path(), 'utf8')
		check('.ics download is a valid event', /BEGIN:VEVENT/.test(ics) && /DTSTART:\d{8}T\d{6}Z/.test(ics) && /END:VCALENDAR/.test(ics))
		await page.click('.bk-menu button')
		check('Google Calendar link', /calendar\.google\.com\/calendar\/render/.test(await page.getAttribute('.bk-menu-pop a', 'href')))
		const links = await page.$$eval('.bk-done-manage a', as => as.map(a => a.href))
		manageUrl = (links[0] || '').split('?')[0]
		check('reschedule / cancel links open the right action', /action=reschedule/.test(links[0] || '') && /action=cancel/.test(links[1] || ''), links.join(' '))
		check('manage link present', /\/book\/manage\//.test(manageUrl || ''))
		// same contact books again -> friendly error (backend rule), not a crash
		await ctx.close()
	}
	if (manageUrl) {
		const ctx = await mk(); const page = await ctx.newPage(); watch(page, 'manage')
		await page.goto(manageUrl)
		await page.waitForSelector('.bk-status', { timeout: 15000 })
		check('manage page shows the booking', /Confirmed|Rescheduled/.test(await page.innerText('.bk-status')))
		check('manage page noindex', /noindex/.test(await page.getAttribute('meta[name=robots]', 'content')))
		await shot(page, '07-manage')
		await page.click('.bk-btn.primary') // Reschedule
		await page.waitForSelector('.bk-day.ok', { timeout: 15000 })
		await shot(page, '08-manage-reschedule')
		if (!(await page.$('.bk-day.sel'))) await page.click('.bk-day.ok')
		await page.waitForSelector('.bk-slot:not(.sk)')
		await page.locator('.bk-slot').nth(1).click()
		await page.waitForSelector('text=Confirm the new time')
		await page.click('.bk-btn.primary:has-text("Confirm new time")')
		await page.waitForSelector('.bk-status:has-text("Rescheduled")', { timeout: 20000 })
		check('reschedule works', true)
		await shot(page, '09-manage-rescheduled')
		await page.click('.bk-btn:has-text("Cancel booking")')
		await page.fill('#bk-reason', 'uitest cancel')
		await shot(page, '10-manage-cancel')
		await page.click('.bk-btn.danger:has-text("Yes, cancel")')
		await page.waitForSelector('.bk-status:has-text("Cancelled")', { timeout: 20000 })
		check('cancel works', true)
		await shot(page, '11-manage-cancelled')
		await page.reload(); await page.waitForSelector('.bk-status')
		check('cancelled state persists after reload', /Cancelled/.test(await page.innerText('.bk-status')))
		await ctx.close()
	}
	{ // not found
		const ctx = await mk(); const page = await ctx.newPage(); watch(page, 'nf')
		await page.goto(`${BASE}/book/manage/does-not-exist-${uid}`); await page.waitForSelector('.bk-state', { timeout: 15000 })
		check('unknown manage token -> friendly state', /could not find/i.test(await page.innerText('.bk-state')))
		await shot(page, '12-manage-notfound')
		const p2 = await ctx.newPage(); watch(p2, 'nf2'); await p2.goto(`${BASE}/book/no-such-demo-${uid}`); await p2.waitForSelector('.bk-state', { timeout: 15000 })
		check('unknown slug -> friendly state', /not available/i.test(await p2.innerText('.bk-state')))
		await shot(p2, '13-demo-notfound')
		await ctx.close()
	}

	/* 3. race: two visitors, same slot */
	{
		const ctx = await mk(); const a = await openBook(ctx), b = await openBook(ctx)
		await pickFirstSlot(a); await pickFirstSlot(b)
		await fillForm(a, person()); await fillForm(b, person())
		await a.click('.bk-btn.primary'); await a.waitForSelector('.bk-done', { timeout: 30000 })
		await b.click('.bk-btn.primary')
		await b.waitForSelector('.bk-banner.warn', { timeout: 20000 })
		check('slot_taken returns to the slot step with a message', await b.isVisible('.bk-slots') && /just taken|no longer/i.test(await b.innerText('.bk-banner.warn')))
		await shot(b, '14-slot-taken')
		await ctx.close()
	}

	/* 4. keyboard-only */
	{
		const ctx = await mk(); const page = await openBook(ctx)
		await page.waitForSelector('.bk-day.ok', { timeout: 15000 })
		await page.focus('.bk-day[tabindex="0"]')
		await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('PageDown'); await page.keyboard.press('PageUp')
		const m0 = await page.innerText('.bk-cal-title')
		await page.keyboard.press('PageDown')
		check('PageDown moves a month', (await page.innerText('.bk-cal-title')) !== m0)
		await page.keyboard.press('PageUp')
		await page.focus('.bk-day.ok'); await page.keyboard.press('Enter')
		await page.waitForSelector('.bk-slot')
		await page.focus('.bk-slot'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
		await page.waitForSelector('.bk-form')
		check('keyboard: reached the form', true)
		await ctx.close()
	}

	/* 5. mobile + tablet */
	for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 900, 900]]) {
		for (const scheme of ['light', 'dark']) {
			const ctx = await mk({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: name === 'mobile', isMobile: name === 'mobile' }); const page = await openBook(ctx)
			await page.waitForSelector('.bk-day.ok', { timeout: 15000 }); await page.waitForTimeout(300)
			check(`${name} ${scheme}: no horizontal scroll (slots)`, await noHScroll(page))
			await shot(page, `20-${name}-${scheme}-slots`)
			await pickFirstSlot(page)
			check(`${name} ${scheme}: no horizontal scroll (form)`, await noHScroll(page))
			await shot(page, `21-${name}-${scheme}-form`)
			if (name === 'mobile') {
				const box = await page.locator('.bk-btn.primary').boundingBox()
				check('mobile: Confirm stays inside the viewport (sticky)', box && box.y + box.height <= h + 1, JSON.stringify(box))
			}
			await ctx.close()
		}
	}

	/* 6. embed from another origin */
	if (FRAMING) {
		const serve = port => new Promise(res => { const s = http.createServer((req, rs) => { rs.writeHead(200, { 'content-type': 'text/html' }); rs.end(fs.readFileSync(path.join(WIDGET_DIR, 'demo-host.html'))) }).listen(port, () => res(s)) })
		const s1 = await serve(ALLOWED_PORT), s2 = await serve(BLOCKED_PORT)
		for (const [label, port, allowed] of [['allowed origin', ALLOWED_PORT, true], ['blocked origin', BLOCKED_PORT, false]]) {
			const ctx = await mk(); const page = await ctx.newPage(); watch(page, 'host-' + port, !allowed)
			await page.goto(`http://localhost:${port}/?crm=${encodeURIComponent(BASE)}&slug=${SLUG}&utm_source=newsletter&utm_campaign=spring`)
			await page.waitForFunction(() => window.CRMDemo, null, { timeout: 15000 })
			const touch = await page.evaluate(() => window.CRMDemo.touch())
			check(`${label}: first touch stored`, touch.first && touch.first.utm_source === 'newsletter')
			await page.click('button[data-crm-demo]')
			await page.waitForSelector('.crmdemo-frame', { timeout: 10000 })
			const frame = page.frames().find(f => f !== page.mainFrame() && /\/book\//.test(f.url()) || /chrome-error/.test(f.url()))
			await page.waitForTimeout(2500)
			const fr = page.frames().filter(f => f !== page.mainFrame())
			const rendered = (await Promise.all(fr.map(f => f.$('.bk-card').catch(() => null)))).some(Boolean)
			check(`${label}: iframe ${allowed ? 'renders the booking page' : 'is refused'}`, allowed ? rendered : !rendered, fr.map(f => f.url()).join(' | '))
			if (allowed) {
				check('embed: first-touch carried to the iframe', fr.some(f => /ft=/.test(f.url()) && /utm_source=newsletter/.test(f.url())))
				const h = await page.evaluate(() => document.querySelector('.crmdemo-box').getBoundingClientRect().height)
				check('embed: pop-up resized to content', h > 400, String(h))
				await shot(page, '30-embed-popup')
				await page.keyboard.press('Escape'); await page.waitForTimeout(400)
				check('embed: Esc closes and restores focus', !(await page.$('.crmdemo-ov')) && await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-crm-demo')))
				const inl = page.frames().filter(f => f !== page.mainFrame())
				check('embed: inline container rendered', inl.length >= 1)
				await shot(page, '31-embed-host')
			} else await shot(page, '32-embed-blocked')
			await ctx.close()
		}
		s1.close(); s2.close()
	}

	await browser.close()
	const bad = results.filter(r => !r[1]).length
	console.log(`\n${results.length - bad}/${results.length} checks passed; screenshots in ${OUT}`)
	if (problems.length) { console.log('JS/console problems:\n' + problems.join('\n')); }
	check('no JS errors / console errors', !problems.length)
	process.exit(results.some(r => !r[1]) ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })

async function pickFirstSlotSafe(page) { await page.waitForSelector('.bk-day.ok', { timeout: 15000 }); if (!(await page.$('.bk-day.sel'))) await page.click('.bk-day.ok'); await page.waitForSelector('.bk-slot:not(.sk)') }
