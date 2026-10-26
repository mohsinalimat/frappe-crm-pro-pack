/* CRM Pro Pack - demo booking embed. One tiny script for the owner's other websites, no dependencies.
 *
 *   <script src="https://CRM-HOST/assets/crm_addons/book/embed.js" async></script>
 *   <button data-crm-demo="coding-junior-demo">Book a demo</button>      (any button or link opens the pop-up)
 *   <div data-crm-demo-inline="coding-junior-demo"></div>                 (the booking page inline in the page)
 *   CRMDemo.open('coding-junior-demo', { prefill: { name, email, phone }, utm: { utm_source: 'x' } })
 *
 * Also records the visitor's first touch (utm_*, gclid, fbclid, referrer, landing page) for 30 days and hands it to the booking page,
 * so the lead in the CRM carries the campaign that really brought the visitor.
 * Never throws on the host page. Styles are one <style id="crmdemo-style"> with the unique prefix "crmdemo-".
 */
(function () {
	'use strict'
	try {
		if (window.CRMDemo && window.CRMDemo.__loaded) return // loaded twice: the first copy keeps working
		var script = document.currentScript
		if (!script || !script.src) {
			var all = document.getElementsByTagName('script')
			for (var i = all.length - 1; i >= 0; i--) { if (/\/assets\/crm_addons\/book\/embed\.js/.test(all[i].src || '')) { script = all[i]; break } }
		}
		if (!script || !script.src) return
		var ORIGIN = new URL(script.src, location.href).origin
		var DAYS = 30, KEY = 'crmdemo_touch'
		var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']

		function safe(fn, d) { try { return fn() } catch (e) { return d } }

		/* ---------------------------------------------------------------- first / last touch */
		function readUrl() {
			var o = {}, q = new URLSearchParams(location.search)
			KEYS.forEach(function (k) { var v = q.get(k); if (v) o[k] = String(v).slice(0, 250) })
			return o
		}
		function cookieGet() { var m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null }
		function cookieSet(v) { document.cookie = KEY + '=' + encodeURIComponent(v) + '; max-age=' + DAYS * 86400 + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '') }
		function load() {
			var raw = safe(function () { return localStorage.getItem(KEY) }, null) || safe(cookieGet, null)
			var d = raw ? safe(function () { return JSON.parse(raw) }, null) : null
			if (d && d.first && d.first.ts && Date.now() - d.first.ts < DAYS * 864e5) return d
			return null
		}
		function save(d) {
			var raw = JSON.stringify(d)
			safe(function () { localStorage.setItem(KEY, raw) })
			if (raw.length < 3500) safe(function () { cookieSet(raw) })
		}
		function track() {
			var cur = readUrl(), d = load(), now = Date.now()
			var snap = Object.assign({}, cur, { landing_url: location.href.split('#')[0].slice(0, 500), referrer: (document.referrer || '').slice(0, 500), ts: now })
			if (!d) d = { first: snap, last: snap }
			else if (Object.keys(cur).length) d.last = snap // last touch moves only when the visit carries campaign data
			save(d)
			return d
		}
		var touch = safe(track, { first: {}, last: {} })
		function b64url(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }

		/* ---------------------------------------------------------------- iframe url */
		function frameUrl(slug, o) {
			o = o || {}
			var q = new URLSearchParams()
			q.set('embed', '1')
			q.set('po', location.origin)
			var cur = Object.assign({}, readUrl(), o.utm || {})
			if (!Object.keys(cur).length && touch.last) KEYS.forEach(function (k) { if (touch.last[k]) cur[k] = touch.last[k] })
			Object.keys(cur).forEach(function (k) { q.set(k, cur[k]) })
			var f = touch.first || {}, ft = {}
			KEYS.forEach(function (k) { if (f[k]) ft[k] = f[k] })
			if (f.landing_url) ft.landing_url = f.landing_url
			if (f.referrer) ft.referrer = f.referrer
			if (f.ts) ft.ts = f.ts
			q.set('ft', b64url(ft))
			q.set('landing', location.href.split('#')[0].slice(0, 500))
			q.set('ref', (document.referrer || '').slice(0, 500))
			if (o.theme) q.set('theme', o.theme)
			if (o.lang) q.set('lang', o.lang)
			if (o.sheet) q.set('sheet', '1')
			var p = o.prefill || {}
			;['name', 'email', 'phone'].forEach(function (k) { if (p[k]) q.set(k, p[k]) })
			return ORIGIN + '/book/' + encodeURIComponent(slug) + '?' + q.toString()
		}

		/* ---------------------------------------------------------------- styles */
		function ensureStyle() {
			if (document.getElementById('crmdemo-style')) return
			var s = document.createElement('style')
			s.id = 'crmdemo-style'
			s.textContent = [
				'.crmdemo-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(8,8,12,.6);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;transition:opacity .18s ease;padding:16px;box-sizing:border-box}',
				'.crmdemo-ov.crmdemo-on{opacity:1}',
				'.crmdemo-box{position:relative;width:1080px;max-width:100%;display:flex;flex-direction:column;transform:translateY(10px) scale(.985);transition:transform .2s ease;max-height:100%}',
				'.crmdemo-on .crmdemo-box{transform:none}',
				'.crmdemo-fw{position:relative;flex:1 1 auto;min-height:0;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}',
				'.crmdemo-frame{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}',
				'.crmdemo-x{flex:none;align-self:flex-end;width:36px;height:36px;margin:0 0 8px;border-radius:50%;border:0;cursor:pointer;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center;padding:0}',
				'.crmdemo-x:hover{background:rgba(255,255,255,.3)}',
				'.crmdemo-x:focus-visible{outline:2px solid #8aa4ff;outline-offset:2px}',
				'.crmdemo-x svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}',
				'.crmdemo-load{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;transition:opacity .2s}',
				'.crmdemo-load i{width:30px;height:30px;border-radius:50%;border:3px solid rgba(127,127,127,.35);border-top-color:rgba(127,127,127,.9);animation:crmdemo-spin .8s linear infinite}',
				'@keyframes crmdemo-spin{to{transform:rotate(360deg)}}',
				'.crmdemo-sent{position:fixed;width:1px;height:1px;overflow:hidden;opacity:0}',
				'.crmdemo-inline{width:100%;position:relative}',
				'@media (max-width:640px){.crmdemo-ov{padding:0;align-items:flex-end}.crmdemo-box{width:100%;height:100%}.crmdemo-fw{border-radius:0;box-shadow:none;height:100%}.crmdemo-x{position:absolute;z-index:3;top:10px;right:10px;margin:0;background:#fff;color:#111;box-shadow:0 1px 6px rgba(0,0,0,.25)}}',
				'@media (prefers-reduced-motion:reduce){.crmdemo-ov,.crmdemo-box{transition:none}.crmdemo-load i{animation-duration:2s}}',
			].join('')
			;(document.head || document.documentElement).appendChild(s)
		}

		/* ---------------------------------------------------------------- messages from the booking page */
		var frames = [] // {win, onHeight, onEvent}
		window.addEventListener('message', function (e) {
			try {
				if (e.origin !== ORIGIN) return
				var d = e.data
				if (!d || d.source !== 'crm-demo' || typeof d.type !== 'string') return
				for (var i = 0; i < frames.length; i++) { if (frames[i].win() === e.source) { frames[i].on(d); return } }
			} catch (err) { /* never throw on the host page */ }
		})
		function announce(d, slug) {
			safe(function () { window.dispatchEvent(new CustomEvent(d.type, { detail: { slug: slug, status: d.status, starts_on_iso: d.starts_on_iso } })) })
			if (d.type === 'crm-demo:booked') safe(function () { (window.dataLayer = window.dataLayer || []).push({ event: 'crm_demo_booked', crm_demo_slug: slug }) })
		}
		function safeRedirect(u) { if (typeof u === 'string' && /^https?:\/\//i.test(u)) location.href = u }

		/* ---------------------------------------------------------------- the pop-up */
		var modal = null
		function icon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' }
		function scrollLock(on) {
			var h = document.documentElement, b = document.body
			if (on) {
				scrollLock.prev = [h.style.overflow, b.style.overflow, b.style.paddingRight]
				var sb = window.innerWidth - h.clientWidth
				h.style.overflow = 'hidden'; b.style.overflow = 'hidden'
				if (sb > 0) b.style.paddingRight = (parseFloat(getComputedStyle(b).paddingRight) || 0) + sb + 'px'
			} else if (scrollLock.prev) {
				h.style.overflow = scrollLock.prev[0]; b.style.overflow = scrollLock.prev[1]; b.style.paddingRight = scrollLock.prev[2]
				scrollLock.prev = null
			}
		}
		function close() {
			if (!modal) return
			var m = modal; modal = null
			document.removeEventListener('keydown', m.onKey, true)
			document.removeEventListener('focusin', m.onFocus, true)
			window.removeEventListener('resize', m.onResize)
			var i = frames.indexOf(m.entry); if (i >= 0) frames.splice(i, 1)
			m.ov.classList.remove('crmdemo-on')
			setTimeout(function () { safe(function () { m.ov.parentNode && m.ov.parentNode.removeChild(m.ov) }) }, 190)
			scrollLock(false)
			safe(function () { m.opener && m.opener.focus && m.opener.focus() })
		}
		function open(slug, o) {
			try {
				if (!slug) return
				if (modal) close()
				o = o || {}
				ensureStyle()
				var opener = document.activeElement
				var ov = document.createElement('div'); ov.className = 'crmdemo-ov'
				var box = document.createElement('div'); box.className = 'crmdemo-box'
				box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', o.label || 'Book a demo')
				var s1 = document.createElement('div'); s1.className = 'crmdemo-sent'; s1.tabIndex = 0
				var s2 = document.createElement('div'); s2.className = 'crmdemo-sent'; s2.tabIndex = 0
				var x = document.createElement('button'); x.type = 'button'; x.className = 'crmdemo-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = icon()
				var load = document.createElement('div'); load.className = 'crmdemo-load'; load.innerHTML = '<i></i>'
				var fr = document.createElement('iframe'); fr.className = 'crmdemo-frame'; fr.title = o.label || 'Book a demo'; fr.src = frameUrl(slug, Object.assign({ sheet: window.innerWidth <= 640 }, o))
				fr.setAttribute('allow', 'clipboard-write'); fr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
				var fw = document.createElement('div'); fw.className = 'crmdemo-fw'; fw.appendChild(load); fw.appendChild(fr)
				box.appendChild(x); box.appendChild(fw)
				ov.appendChild(s1); ov.appendChild(box); ov.appendChild(s2)
				var narrow = function () { return window.innerWidth <= 640 }
				var height = 560
				function fit() {
					if (narrow()) { box.style.height = '100%'; return }
					var max = window.innerHeight - 32
					box.style.height = Math.max(380, Math.min(height + 44, max)) + 'px'
				}
				var entry = {
					win: function () { return fr.contentWindow },
					on: function (d) {
						if (d.type === 'crm-demo:height' && d.height > 0) { height = d.height; fit() }
						else if (d.type === 'crm-demo:ready') { load.style.opacity = 0 }
						else if (d.type === 'crm-demo:escape') close()
						else if (d.type === 'crm-demo:redirect') safeRedirect(d.url)
						else if (d.type === 'crm-demo:booked' || d.type === 'crm-demo:cancelled' || d.type === 'crm-demo:rescheduled') { announce(d, slug); if (d.type === 'crm-demo:booked' && typeof o.onBooked === 'function') safe(function () { o.onBooked(d) }) }
					},
				}
				frames.push(entry)
				var onKey = function (e) {
					if (e.key === 'Escape') { e.stopPropagation(); close() }
					else if (e.key === 'Tab') { // the iframe is one stop: Tab goes close button <-> frame
						var a = document.activeElement
						if (a === x && !e.shiftKey) { e.preventDefault(); fr.focus() }
						else if (a === x && e.shiftKey) { e.preventDefault(); fr.focus() }
					}
				}
				var onFocus = function (e) { if (modal && !ov.contains(e.target)) { e.stopPropagation(); x.focus() } }
				s1.addEventListener('focus', function () { fr.focus() })
				s2.addEventListener('focus', function () { x.focus() })
				x.addEventListener('click', close)
				ov.addEventListener('mousedown', function (e) { if (e.target === ov) close() })
				fr.addEventListener('load', function () { load.style.opacity = 0; safe(function () { fr.contentWindow.postMessage({ type: 'crm-demo:ping' }, ORIGIN) }) })
				var onResize = fit
				document.addEventListener('keydown', onKey, true)
				document.addEventListener('focusin', onFocus, true)
				window.addEventListener('resize', onResize)
				document.body.appendChild(ov)
				scrollLock(true)
				fit()
				modal = { ov: ov, entry: entry, onKey: onKey, onFocus: onFocus, onResize: onResize, opener: opener }
				requestAnimationFrame(function () { ov.classList.add('crmdemo-on'); fr.focus() })
			} catch (err) { safe(function () { window.open(ORIGIN + '/book/' + encodeURIComponent(slug), '_blank', 'noopener') }) }
		}

		/* ---------------------------------------------------------------- inline */
		function inline(el, slug, o) {
			try {
				if (!el || !slug || el.getAttribute('data-crmdemo-ready')) return
				el.setAttribute('data-crmdemo-ready', '1')
				ensureStyle()
				o = o || {}
				el.classList.add('crmdemo-inline')
				var fr = document.createElement('iframe'); fr.className = 'crmdemo-frame'; fr.title = o.label || 'Book a demo'; fr.src = frameUrl(slug, o)
				fr.style.minHeight = '520px'; fr.setAttribute('loading', 'lazy'); fr.setAttribute('allow', 'clipboard-write')
				el.appendChild(fr)
				frames.push({
					win: function () { return fr.contentWindow },
					on: function (d) {
						if (d.type === 'crm-demo:height' && d.height > 0) fr.style.height = d.height + 'px'
						else if (d.type === 'crm-demo:redirect') safeRedirect(d.url)
						else if (/booked|cancelled|rescheduled/.test(d.type)) announce(d, slug)
					},
				})
			} catch (err) { /* ignore */ }
		}
		function scan() {
			safe(function () {
				var list = document.querySelectorAll('[data-crm-demo-inline]')
				for (var i = 0; i < list.length; i++) {
					var el = list[i], slug = el.getAttribute('data-crm-demo-inline') || el.getAttribute('data-crm-demo')
					inline(el, slug, optsOf(el))
				}
			})
		}
		function optsOf(el) {
			var p = {}
			;['name', 'email', 'phone'].forEach(function (k) { var v = el.getAttribute('data-crm-demo-' + k); if (v) p[k] = v })
			return { prefill: p, theme: el.getAttribute('data-crm-demo-theme') || '', label: el.getAttribute('data-crm-demo-label') || '' }
		}

		/* ---------------------------------------------------------------- triggers (works for elements added later too) */
		document.addEventListener('click', function (e) {
			try {
				if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
				var t = e.target && e.target.closest ? e.target.closest('[data-crm-demo]') : null
				if (!t || t.hasAttribute('data-crm-demo-inline')) return
				var slug = t.getAttribute('data-crm-demo')
				if (!slug) return
				e.preventDefault()
				open(slug, optsOf(t))
			} catch (err) { /* ignore */ }
		})
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan()
		if (window.MutationObserver) safe(function () { new MutationObserver(function () { scan() }).observe(document.documentElement, { childList: true, subtree: true }) })

		window.CRMDemo = {
			__loaded: true, version: 1, origin: ORIGIN,
			open: open, close: close, inline: inline, scan: scan,
			touch: function () { return JSON.parse(JSON.stringify(touch)) },
		}
	} catch (err) { /* never break the host page */ }
})()
