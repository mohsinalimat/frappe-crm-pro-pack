// The shot list. Each entry opens a page, gets it into a good state and returns the page; run() saves it to RAW/<name>.png.
// Then `node finish.js` crops / optimises the raw files into ../images.
const path = require('path')
const cap = require('./capture.js')
const { newContext, open, sleep, RAW, errors, chromium } = cap

const CAMP = '/assets/crm_addons/campaigns/index.html'
const MEET = '/assets/crm_addons/meetings/index.html'
const DASH = '/assets/crm_addons/meetings/dashboard.html'
const FU = '/assets/crm_addons/meetings/followups.html'
const ASG = '/assets/crm_addons/campaigns/assignment.html'
const SETUP = '/assets/crm_addons/setup/index.html'

const settle = async (p, ms = 1500) => { await p.waitForLoadState('networkidle').catch(() => {}); await sleep(ms) }
const clickText = async (p, text, opts = {}) => { await p.getByText(text, { exact: true, ...opts }).first().click(); await settle(p, 1200) }
// the meetings page of the working tree also carries a feature that is still in development: hide it from the shots
// CRM's own onboarding panel and promo cards are not part of the product shots
const calm = async (p) => { await p.getByText('Skip all', { exact: true }).first().click({ timeout: 2500 }).catch(() => {}); await sleep(400); await p.evaluate(() => { const w = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Welcome to Frappe CRM/.test(e.textContent)); let a = w; while (a && a !== document.body) { if (getComputedStyle(a).position === 'fixed' || getComputedStyle(a).position === 'absolute') { a.style.display = 'none'; break } a = a.parentElement } document.querySelectorAll('div,section').forEach((e) => { const t = (e.firstElementChild && e.firstElementChild.textContent || '').trim(); if (/^(Permissions update|Getting started)/.test(t) && e.getBoundingClientRect().width < 260) e.style.display = 'none' }) }).catch(() => {}) }
const hideDemos = (p) => p.evaluate(() => { const hide = () => document.querySelectorAll('button').forEach((b) => { if (/^\s*Demos\s*$/.test(b.textContent)) b.style.display = 'none' }); hide(); new MutationObserver(hide).observe(document.body, { childList: true, subtree: true }) }).catch(() => {})
// the app's built-in sample lead carries its author's name: show a made-up one in every shot (text only, frames included)
const scrub = async (p) => { for (const f of p.frames()) await f.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (/Siddharth/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Siddharth Singh/g, 'Ananya Iyer').replace(/Siddharth/g, 'Ananya') } }).catch(() => {}) }
// the three completed / running campaigns by name
const campId = async (p, name) => p.evaluate(async (n) => { const r = await window.CM.call('crm_addons.campaigns.api.list_campaigns', { page_length: 50 }); const rows = r.rows || r.campaigns || r; return (rows.find((c) => c.campaign_name === n) || {}).name }, name)
const goCamp = async (ctx, name, tab) => {
  const p = await open(ctx, CAMP + '#/campaigns'); await settle(p, 800)
  const id = await campId(p, name)
  await p.evaluate((id) => { location.hash = '#/c/' + id }, id); await settle(p, 2500)
  if (tab) { await clickText(p, tab) }
  return p
}
const wizardStep = async (ctx, n) => {
  const p = await open(ctx, CAMP + '#/campaigns'); await settle(p, 800)
  const id = await campId(p, 'Summer Camp Early Bird')
  await p.evaluate((id) => { location.hash = '#/edit/' + id }, id); await settle(p, 2500)
  for (let i = 1; i < n; i++) { await p.getByRole('button', { name: /^Continue/ }).first().click(); await settle(p, 2200) }
  return p
}
const range30 = async (p) => { await p.locator('button:has-text("Last 7 days"), [class*=range] button').first().click().catch(() => {}); await sleep(500); await p.getByText('Last 30 days', { exact: true }).first().click().catch(() => {}); await settle(p, 2500) }

const SHOTS = {
  'campaigns-list': { scale: 2, fn: async (ctx) => { const p = await open(ctx, CAMP + '#/campaigns'); await settle(p, 2000); return p } },
  'wizard-audience': { fn: (ctx) => wizardStep(ctx, 2) },
  'wizard-content': { fn: (ctx) => wizardStep(ctx, 3) },
  'wizard-preview': { fn: async (ctx) => {
    const p = await wizardStep(ctx, 4)
    await p.getByText('A real lead', { exact: true }).first().click(); await settle(p, 800)
    await p.getByPlaceholder(/Search leads/).fill('Kiran'); await settle(p, 1500)
    await p.locator('text=Kiran Rao').first().click(); await settle(p, 2500)
    return p } },
  'wizard-schedule': { fn: (ctx) => wizardStep(ctx, 5) },
  'whatsapp-templates': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/templates/whatsapp'); await settle(p, 2500); return p } },
  'automations': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/automations'); await settle(p, 2500); return p } },
  'campaign-report': { fn: (ctx) => goCamp(ctx, 'Spring Admissions 2026') },
  'campaign-recipients': { fn: (ctx) => goCamp(ctx, 'Welcome Journey', 'Recipients') },
  'campaign-journey': { fn: (ctx) => goCamp(ctx, 'Welcome Journey', 'Journey and content') },
  'reports': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/reports'); await settle(p, 2500); return p } },
  'calendar': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/campaigns'); await settle(p, 1500); await p.getByRole('button', { name: /calendar/i }).first().click().catch(() => p.locator('button[title*=alendar], button[aria-label*=alendar]').first().click()); await settle(p, 2000); return p } },
  'list-cleanup': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/hygiene'); await settle(p, 2000); return p } },
  'audiences': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/audiences'); await settle(p, 2500); return p } },
  'email-templates': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/templates'); await settle(p, 2500); return p } },
  'followups': { fn: async (ctx) => { const p = await open(ctx, FU); await settle(p, 2500); return p } },
  'sales-dashboard': { fn: async (ctx) => { const p = await open(ctx, DASH); await settle(p, 2000); await range30(p); return p } },
  'sales-dashboard-dark': { fn: async (ctx) => { const p = await open(ctx, DASH); await settle(p, 2000); await range30(p); return p } },
  'campaigns-dashboard': { fn: async (ctx) => { const p = await open(ctx, DASH + '#nurturing'); await settle(p, 2000); await range30(p); return p } },
  'meetings': { fn: async (ctx) => { const p = await open(ctx, MEET); await settle(p, 2500); await hideDemos(p); return p } },
  'assignment': { fn: async (ctx) => { const p = await open(ctx, ASG); await settle(p, 2500); return p } },
  'assignment-history': { fn: async (ctx) => { const p = await open(ctx, ASG); await settle(p, 1500); await clickText(p, 'History'); await settle(p, 1500); return p } },
  'email-builder': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/templates/email/edit/Welcome%20to%20Acme%20Learning'); await settle(p, 3000); await p.locator('text=Book a free counselling call').first().click({ force: true }); await settle(p, 1200); return p } },
  'email-html-editor': { fn: async (ctx) => { const p = await open(ctx, CAMP + '#/templates/email/edit/Fee%20Instalment%20Reminder'); await settle(p, 3500); return p } },
  'meeting-editor': { fn: async (ctx) => { const p = await open(ctx, MEET); await settle(p, 2000); await hideDemos(p); await p.getByText('Programme walkthrough', { exact: false }).first().click(); await settle(p, 2500); return p } },
  'campaign-report-dark': { fn: (ctx) => goCamp(ctx, 'Spring Admissions 2026') },
  'dashboard-shortcuts': { fn: async (ctx) => { const p = await open(ctx, '/crm/dashboard'); await settle(p, 5000); await calm(p); await hideDemos(p); await p.evaluate(() => document.querySelectorAll('[data-cra-side="demos"], [data-cra-shortcut="demos"]').forEach((e) => { e.style.display = 'none' })); return p } },
  'lead-page-tabs': { fn: async (ctx) => { const p = await open(ctx, '/crm/leads'); await settle(p, 3000); const name = await p.evaluate(async () => { const r = await (await fetch('/api/resource/CRM Lead?limit_page_length=1&fields=["name"]&filters=[["status","=","Contacted"]]')).json(); return r.data && r.data[0] && r.data[0].name }); await p.goto(cap.BASE + '/crm/leads/' + name, { waitUntil: 'networkidle' }); await p.setViewportSize({ width: 1760, height: 900 }); await settle(p, 4000); await calm(p); await p.locator('[data-cra-tab="followups"]').first().click({ timeout: 4000 }).catch(() => {}); await settle(p, 1500); return p } },
  'followup-form': { fn: async (ctx) => { const p = await open(ctx, FU); await settle(p, 2000); await p.getByRole('button', { name: /^Log/ }).first().click(); await settle(p, 1500); const fr = p.frameLocator('iframe'); await fr.locator('button:has-text("Interested - follow up")').first().click(); await sleep(500); await fr.locator('select').nth(1).selectOption({ label: 'Contacted' }).catch(() => {}); await fr.locator('textarea').first().fill('Wants the prospectus and the fee structure. Sending both today.'); await sleep(600); return p } },
  'setup-page': { fn: async (ctx) => { const p = await open(ctx, SETUP); await settle(p, 2500); await p.getByText('Google Meet and Calendar', { exact: true }).first().click().catch(() => {}); await sleep(800); return p } },
}

module.exports.SHOTS = SHOTS
module.exports.run = async function run(cmd, names) {
  const browser = await chromium.launch()
  const todo = names.length ? names : Object.keys(SHOTS)
  for (const name of todo) {
    const spec = SHOTS[name]
    if (!spec) { console.log('unknown shot', name); continue }
    const ctx = await newContext(browser, { dark: /-dark$/.test(name), scale: spec.scale || 1 })
    try {
      const page = await spec.fn(ctx)
      await scrub(page); await sleep(300)
      await page.screenshot({ path: path.join(RAW, name + '.png') })
      console.log('shot', name)
    } catch (e) { console.log('FAILED', name, e.message.split('\n')[0]) }
    await ctx.close()
  }
  await browser.close()
  if (errors.length) console.log('page errors:\n' + errors.join('\n'))
}
