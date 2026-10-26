// Draws the fictional "Acme Learning" logo and three banner images used by the showcase email and WhatsApp templates.
// Usage: node make_assets.js   (needs playwright: set PLAYWRIGHT=/path/to/node_modules/playwright)
const path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/sid/demo-bench-tools/node_modules/playwright')
const out = path.join(__dirname, 'assets')

const logo = `<body style="margin:0;background:#fff"><div style="width:480px;height:120px;display:flex;align-items:center;gap:18px;padding-left:10px;font-family:Helvetica,Arial,sans-serif">
<svg width="76" height="76" viewBox="0 0 76 76"><rect width="76" height="76" rx="20" fill="#4f46e5"/><path d="M20 54 L38 18 L56 54" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="46" r="5.5" fill="#fbbf24"/></svg>
<div><div style="font-size:38px;font-weight:800;color:#1e1b4b;letter-spacing:-1px;line-height:1">Acme Learning</div><div style="font-size:15px;color:#6b7280;letter-spacing:3px;margin-top:6px">ADMISSIONS</div></div></div></body>`

const banner = (a, b, c) => `<body style="margin:0"><div style="position:relative;width:1200px;height:380px;overflow:hidden;background:linear-gradient(120deg,${a},${b})">
<div style="position:absolute;right:-90px;top:-120px;width:520px;height:520px;border-radius:50%;background:#fff;opacity:.14"></div>
<div style="position:absolute;right:230px;bottom:-190px;width:380px;height:380px;border-radius:50%;background:#fff;opacity:.12"></div>
<div style="position:absolute;left:-60px;bottom:-140px;width:360px;height:360px;border-radius:50%;background:#fff;opacity:.10"></div>
<svg style="position:absolute;right:120px;top:70px" width="300" height="250" viewBox="0 0 300 250"><rect x="20" y="40" width="260" height="170" rx="18" fill="#fff" opacity=".95"/><rect x="44" y="68" width="150" height="14" rx="7" fill="${a}" opacity=".85"/><rect x="44" y="96" width="210" height="10" rx="5" fill="#cbd5e1"/><rect x="44" y="116" width="190" height="10" rx="5" fill="#cbd5e1"/><rect x="44" y="136" width="120" height="10" rx="5" fill="#cbd5e1"/><rect x="44" y="164" width="96" height="30" rx="15" fill="${c}"/><circle cx="252" cy="52" r="26" fill="${c}"/><path d="M240 52 l9 9 l17 -19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg></div></body>`

;(async () => {
  const browser = await chromium.launch()
  const shot = async (html, w, h, file, transparent) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    await page.setContent(html)
    await page.screenshot({ path: path.join(out, file), ...(file.endsWith('.jpg') ? { type: 'jpeg', quality: 86 } : {}) })
    await page.close()
  }
  await shot(logo, 480, 120, 'acme-logo.png')
  await shot(banner('#4338ca', '#6366f1', '#fbbf24'), 1200, 380, 'banner-admissions.jpg')
  await shot(banner('#0f766e', '#14b8a6', '#fde68a'), 1200, 380, 'banner-open-house.jpg')
  await shot(banner('#be185d', '#f472b6', '#fef3c7'), 1200, 380, 'banner-webinar.jpg')
  await browser.close()
})()
