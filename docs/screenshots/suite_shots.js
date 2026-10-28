// Screenshots of the full app (/suite): the shots listed here are added to the list in shots.js.
//   node capture.js shots suite-dashboard suite-whatsapp
const cap = require('./capture.js')
const { open, sleep } = cap

const SUITE = '/suite#/'
const settle = async (p, ms = 1500) => { await p.waitForLoadState('networkidle').catch(() => {}); await sleep(ms) }
const go = async (ctx, route, ms = 3500) => { const p = await open(ctx, SUITE + route); await settle(p, ms); return p }
const clickNav = async (p, label) => { await p.locator('.rail .nav', { hasText: label }).first().click(); await settle(p, 1800) }

module.exports = {
  'suite-dashboard': { fn: (ctx) => go(ctx, 'dashboard', 4500) },
  'suite-leads': { fn: (ctx) => go(ctx, 'leads') },
  'suite-kanban': { fn: async (ctx) => { const p = await go(ctx, 'leads'); await p.getByText('Kanban', { exact: true }).first().click(); await settle(p, 2500); return p } },
  'suite-lead-page': { fn: async (ctx) => { const p = await go(ctx, 'leads'); await p.locator('table tbody tr, .lt-row, [role=row]').nth(1).click().catch(() => {}); await settle(p, 3500); return p } },
  'suite-whatsapp': { fn: async (ctx) => { const p = await go(ctx, 'whatsapp'); await p.getByText('Amelia Patel', { exact: true }).first().click(); await settle(p, 2500); return p } },
  'suite-notifications': { fn: async (ctx) => { const p = await go(ctx, 'dashboard', 3500); await clickNav(p, 'Notifications'); await sleep(800); return p } },
  'suite-followups': { fn: (ctx) => go(ctx, 'followups') },
  'suite-meetings': { fn: (ctx) => go(ctx, 'meetings') },
  'suite-bookings': { fn: (ctx) => go(ctx, 'bookings') },
  'suite-team': { fn: (ctx) => go(ctx, 'access') },
  'suite-settings': { fn: (ctx) => go(ctx, 'settings') },
  'default-app-offer': { fn: async (ctx) => { await ctx.route('**/api/method/crm_addons.default_app.offer', (r) => r.fulfill({ json: { message: { show: true } } })); const p = await open(ctx, '/crm/leads'); await settle(p, 9000); return p } },
}
