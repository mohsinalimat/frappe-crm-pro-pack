// Capture the CRM Pro Pack screenshots from the showcase site, and create its three visual email templates.
//
//   node capture.js templates            # creates the 3 email templates with the visual builder's own renderer
//   node capture.js shots [name ...]     # takes the screenshots (all, or only the named ones) into ../images
//   node capture.js social               # builds docs/images/social-preview.png from the shots
//
// Environment: SHOWCASE_URL (default http://127.0.0.1:8012), SHOWCASE_USER / SHOWCASE_PASSWORD (a System Manager of the
// showcase site; the seed creates alex.morgan@example.com), PLAYWRIGHT (path of the playwright node module).
const fs = require('fs')
const path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/sid/demo-bench-tools/node_modules/playwright')

const BASE = process.env.SHOWCASE_URL || 'http://127.0.0.1:8012'
const USER = process.env.SHOWCASE_USER || 'alex.morgan@example.com'
const PASS = process.env.SHOWCASE_PASSWORD || 'Showcase#2026'
const OUT = process.env.SHOWCASE_OUT || path.join(__dirname, '..', 'images')
const RAW = process.env.SHOWCASE_RAW || path.join(__dirname, '.raw')
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(RAW, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function newContext(browser, { dark = false, scale = 1, user = USER, pass = PASS } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light' })
  const r = await ctx.request.post(BASE + '/api/method/login', { form: { usr: user, pwd: pass } })
  if (!r.ok()) throw new Error('login failed ' + r.status())
  // the administrator's one-time offer to make Suite Pro the default app must not appear in every shot
  const csrf = await (await ctx.request.get(BASE + '/api/method/crm_addons.api.get_csrf_token')).json().catch(() => ({}))
  await ctx.request.post(BASE + '/api/method/crm_addons.default_app.dismiss', { headers: { 'X-Frappe-CSRF-Token': csrf.message || '' } }).catch(() => {})
  if (dark) await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark') } catch (e) {} })
  else await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light') } catch (e) {} })
  return ctx
}

const errors = []
async function open(ctx, url) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(url + ' :: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(url + ' :: console: ' + m.text().slice(0, 160)) })
  await page.goto(BASE + url, { waitUntil: 'networkidle' })
  return page
}

// ---------------------------------------------------------------------------------------- email templates
const A = (n) => '/files/' + n
const b = (type, props) => ({ id: Math.random().toString(36).slice(2, 9), type, props })
const img = (src, alt, width = 100, align = 'center', radius = 10) => b('image', { src, alt, link: '', width, align, radius })
const row = (cols, line) => b('row', { count: cols.length, divider: !!line, dividerColor: '#e3e6eb', valign: 'top', cols: [...cols.map((blocks) => ({ blocks })), ...Array(6 - cols.length).fill(0).map(() => ({ blocks: [] }))] })
const h = (text, level = 'h2', align = 'left', color = '#1e1b4b') => b('heading', { text, level, align, color, font: '', fontSize: 0, bold: true, italic: false, underline: false, link: '' })
const t = (html, align = 'left') => b('text', { html, align, color: '#374151', size: 15, font: '' })
const btn = (label, bg = '#4f46e5', align = 'center') => b('button', { label, url: 'https://www.example.com/acme', bg, color: '#ffffff', radius: 10, align, full: false })
const footer = (extra = '') => b('footer', { text: 'Acme Learning, 12 Example Street, Sample City 000000\nYou are receiving this email because you enquired about our programmes.' + extra, align: 'center', color: '#8b93a1' })
const settings = { bg: '#eef0f7', contentBg: '#ffffff', width: 600, font: 'Arial' }

const TEMPLATES = () => [
  {
    template_name: 'Welcome to Acme Learning', category: 'Welcome', subject: 'Welcome to Acme Learning, {{ first_name }}',
    description: 'First email for every new enquiry.',
    blocks: [
      img(A('acme-logo.png'), 'Acme Learning', 52, 'left', 0),
      img(A('banner-admissions.jpg'), 'Welcome', 100, 'center', 12),
      h('Welcome, {{ first_name }}!', 'h1', 'center'),
      t('<p>Thank you for your interest in <b>Acme Learning</b>. Your counsellor, <b>{{ owner_name }}</b>, will call you shortly to understand your goals and suggest the right programme.</p>', 'center'),
      row([[h('Small batches', 'h3'), t('<p>Never more than 25 learners, so everyone is heard.</p>')], [h('Expert mentors', 'h3'), t('<p>Working professionals teach every module.</p>')], [h('Career support', 'h3'), t('<p>Resume reviews and mock interviews included.</p>')]]),
      btn('Book a free counselling call'),
      footer(),
    ],
  },
  {
    template_name: 'Open House Invitation', category: 'Event', subject: 'You are invited: Acme open house this Saturday',
    description: 'Invitation to the campus open house.',
    blocks: [
      img(A('acme-logo.png'), 'Acme Learning', 52, 'left', 0),
      img(A('banner-open-house.jpg'), 'Open house', 100, 'center', 12),
      h('You are invited, {{ first_name }}', 'h1', 'center', '#0f766e'),
      t('<p>Meet our teachers, tour the campus and ask anything about admissions. Families are welcome.</p>', 'center'),
      row([[h('When', 'h3', 'center'), t('<p><b>Saturday, 11 am to 2 pm</b></p>', 'center')], [h('Where', 'h3', 'center'), t('<p><b>Acme Learning Campus</b><br>12 Example Street</p>', 'center')]], true),
      btn('Reserve your seat', '#0f766e'),
      b('social', { align: 'center', links: [{ network: 'Instagram', url: 'https://www.example.com/' }, { network: 'LinkedIn', url: 'https://www.example.com/' }, { network: 'YouTube', url: 'https://www.example.com/' }] }),
      footer(),
    ],
  },
  {
    template_name: 'Spring Admissions Offer', category: 'Promotion', subject: 'Spring admissions are open: reserve your seat',
    description: 'Seasonal admissions promotion.',
    blocks: [
      img(A('acme-logo.png'), 'Acme Learning', 52, 'left', 0),
      b('banner', { title: 'Spring admissions are open', subtitle: 'Reserve your seat before 31 March and get a free skills assessment.', bg: '#4f46e5', color: '#ffffff', button: 'Apply now', url: 'https://www.example.com/acme', align: 'center' }),
      h('Hello {{ first_name }}, there is still time', 'h2', 'left'),
      t('<p>Our spring batch starts next month. Here is what you get when you enrol this week:</p><ul><li>A free one-to-one skills assessment</li><li>Flexible fee instalments</li><li>Lifetime access to recorded sessions</li></ul>'),
      row([[img(A('banner-webinar.jpg'), 'Programme', 100, 'center', 10)], [h('Not sure which programme?', 'h3'), t('<p>Reply to this email and your counsellor will suggest the best fit.</p>'), btn('Talk to a counsellor', '#be185d', 'left')]]),
      footer(),
    ],
  },
]

async function createTemplates() {
  const browser = await chromium.launch()
  const ctx = await newContext(browser)
  const page = await open(ctx, '/assets/crm_addons/campaigns/index.html')
  await page.waitForFunction(() => window.CM && window.CM.renderBuilder && window.CM.call, null, { timeout: 30000 })
  for (const spec of TEMPLATES()) {
    const res = await page.evaluate(async (spec) => {
      const doc = { settings: { bg: '#eef0f7', contentBg: '#ffffff', width: 600, font: 'Arial' }, blocks: spec.blocks }
      const html = window.CM.renderBuilder(doc)
      try {
        const r = await window.CM.call('crm_addons.campaigns.api.save_email_template', { data: { template_name: spec.template_name, enabled: 1, subject: spec.subject, body_html: html, description: spec.description, category: spec.category, editor_mode: 'Visual Builder', builder_json: JSON.stringify(doc) } })
        return 'ok ' + (r && r.name)
      } catch (e) { return 'ERR ' + (e.message || e) }
    }, spec)
    console.log(spec.template_name, res)
  }
  await browser.close()
}

module.exports = { newContext, open, sleep, BASE, OUT, RAW, errors, chromium }
if (require.main === module) {
  const cmd = process.argv[2]
  if (cmd === 'templates') createTemplates().catch((e) => { console.error(e); process.exit(1) })
  else if (cmd === 'shots' || cmd === 'social') require('./shots.js').run(cmd, process.argv.slice(3)).catch((e) => { console.error(e); process.exit(1) })
  else console.log('usage: node capture.js templates | shots [names] | social')
}
