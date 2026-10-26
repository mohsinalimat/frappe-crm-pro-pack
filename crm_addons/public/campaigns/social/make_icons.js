// Draws the social icons used by the visual email builder (PNG, because Gmail and Outlook do not show inline SVG).
//   node make_icons.js <folder holding bootstrap-icons "icons/*.svg">      (MIT licence: https://github.com/twbs/icons)
// Three looks per network: colour (the brand colour with a white glyph), dark and light. 72 px, shown at 24-48 px.
const fs = require('fs'), path = require('path')
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/sid/demo-bench-tools/node_modules/playwright')
const src = path.join(process.argv[2] || '.', 'icons')
const LIST = require('./networks.js')
const LOOK = { color: (n) => [n.color, n.fg], dark: () => ['#1f2937', '#ffffff'], light: () => ['#ffffff', '#1f2937'] }
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 72, height: 72 }, deviceScaleFactor: 1 })
  for (const n of LIST) {
    const name = n.key
    const glyph = fs.readFileSync(path.join(src, n.svg + '.svg'), 'utf8').replace(/<svg[^>]*>/, '').replace('</svg>', '')
    for (const [look, fn] of Object.entries(LOOK)) {
      const [bg, fg] = fn(n)
      const ring = look === 'light' ? `<circle cx="36" cy="36" r="35" fill="${bg}" stroke="#d5d9e0" stroke-width="2"/>` : `<circle cx="36" cy="36" r="36" fill="${bg}"/>`
      await p.setContent(`<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">${ring}<g transform="translate(18 18) scale(2.25)" fill="${fg}">${glyph}</g></svg>`)
      await p.screenshot({ path: path.join(__dirname, `${name}-${look}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 72, height: 72 } })
    }
  }
  await b.close(); console.log('done')
})()
