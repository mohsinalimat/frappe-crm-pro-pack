// Optimise the raw captures into ../images and build the social preview.   node finish.js
//   .raw/*.png  ->  ../images/*.png   (max 1600 px wide, metadata stripped, PNG level 9)
//   social-preview.png (1280x640) is drawn from three of the shots by a small HTML page.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/sid/demo-bench-tools/node_modules/playwright')
const RAW = path.join(__dirname, '.raw'), OUT = path.join(__dirname, '..', 'images')
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.png'))) {
  execFileSync('magick', [path.join(RAW, f), '-resize', '1600x>', '-strip', '-define', 'png:compression-level=9', path.join(OUT, f)])
}
const img = (n) => 'file://' + path.join(RAW, n + '.png')
const html = `<!doctype html><meta charset=utf-8><style>
*{box-sizing:border-box}body{margin:0;width:1280px;height:640px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;background:radial-gradient(1100px 500px at 85% -10%,#4f46e5 0%,transparent 60%),linear-gradient(135deg,#0f1226 0%,#1b1f4b 100%);color:#fff;position:relative}
.t{position:absolute;left:64px;top:84px;width:520px}.k{display:inline-flex;gap:8px;align-items:center;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#a5b4fc;font-weight:600}
h1{font-size:60px;line-height:1.02;margin:18px 0 18px;letter-spacing:-.03em}p{font-size:23px;line-height:1.4;color:#c7d2fe;margin:0}
.pills{position:absolute;left:64px;bottom:64px;display:flex;gap:10px;flex-wrap:wrap;width:540px}.pills span{border:1px solid #4b55a8;border-radius:999px;padding:8px 16px;font-size:16px;color:#e0e7ff;background:rgba(255,255,255,.06)}
.c{position:absolute;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18);background:#fff}.c img{display:block;width:100%}
.a{left:640px;top:60px;width:700px;transform:rotate(-2deg)}.b{left:700px;top:250px;width:620px;transform:rotate(1.5deg)}</style>
<div class=t><div class=k>Frappe CRM add-on, version 2</div><h1>Frappe CRM Suite Pro</h1><p>A full sales workspace for Frappe CRM: leads, WhatsApp Business, campaigns, follow-ups, meetings and analytics.</p></div>
<div class=pills><span>WhatsApp Business</span><span>Campaign Manager</span><span>Sales Dashboard</span><span>Lead page</span><span>Bookings</span><span>Meta lead ads</span></div>
<div class="c a"><img src="${img('suite-dashboard')}"></div><div class="c b"><img src="${img('suite-whatsapp')}"></div>`
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 640 } })
  const page = path.join(RAW, 'social.html'); fs.writeFileSync(page, html); await p.goto('file://' + page, { waitUntil: 'load' }); await p.waitForTimeout(800)
  await p.screenshot({ path: path.join(OUT, 'social-preview.png') }); await b.close()
  console.log('done')
})()
