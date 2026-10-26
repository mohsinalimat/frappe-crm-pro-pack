/* CRM Pro Pack - public demo booking widget (Vue 3, no build step).
 * Served at /book/<slug> (book a time) and /book/manage/<token> (reschedule or cancel).
 * Talks to the guest API crm_addons.demos.public.* (see docs/DEMO_BOOKING.md).
 * Everything lives inside one IIFE; nothing but window.CRMBook (debug hooks) is exposed.
 */
(function () {
	'use strict'
	var V = window.Vue
	if (!V) { document.body.innerHTML = '<p style="font:15px system-ui;padding:24px">This page needs JavaScript.</p>'; return }
	var ref = V.ref, reactive = V.reactive, computed = V.computed, watch = V.watch, onMounted = V.onMounted, onBeforeUnmount = V.onBeforeUnmount, nextTick = V.nextTick

	/* ------------------------------------------------------------------ helpers */
	var CFG = window.CRM_BOOK || {}
	var QS = new URLSearchParams(location.search)
	var EMBED = QS.get('embed') === '1'
	var LOCALE = (QS.get('lang') || navigator.language || 'en').replace('_', '-')
	var pad = function (n) { return String(n).padStart(2, '0') }
	var safe = function (fn, d) { try { return fn() } catch (e) { return d } }
	var lsGet = function (k) { return safe(function () { return localStorage.getItem(k) }, null) }
	var lsSet = function (k, v) { safe(function () { localStorage.setItem(k, v) }) }

	var dayNum = function (s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 864e5 }
	var fromDayNum = function (n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) }
	var addDays = function (s, n) { return fromDayNum(dayNum(s) + n) }
	var dow = function (s) { return new Date(dayNum(s) * 864e5).getUTCDay() }
	var monthOf = function (s) { return s.slice(0, 7) }
	var addMonths = function (m, n) { var p = m.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) }
	var daysInMonth = function (m) { var p = m.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate() }

	var fmtCache = {}
	function fmt(key, opts) {
		var k = key + JSON.stringify(opts)
		if (!fmtCache[k]) fmtCache[k] = new Intl.DateTimeFormat(LOCALE, opts)
		return fmtCache[k]
	}
	function validTz(tz) { return !!tz && safe(function () { new Intl.DateTimeFormat('en', { timeZone: tz }); return true }, false) }
	function browserTz() { var z = safe(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone }, '') ; return validTz(z) ? z : 'UTC' }
	function todayIn(tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
	/** Date label for a calendar day (YYYY-MM-DD), independent of any time zone. */
	function dayLabel(s, opts) { var p = s.split('-').map(Number); return fmt('d', Object.assign({ timeZone: 'UTC' }, opts)).format(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12))) }
	function monthLabel(m) { var p = m.split('-').map(Number); return fmt('m', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(p[0], p[1] - 1, 15))) }
	function timeLabel(iso, tz, h24) {
		var o = { timeZone: tz, hour: h24 ? '2-digit' : 'numeric', minute: '2-digit' }
		if (h24) o.hourCycle = 'h23'; else o.hour12 = true
		return fmt('t', o).format(new Date(iso))
	}
	function wallParts(ms, tz) {
		var parts = fmt('w', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms))
		var o = {}
		parts.forEach(function (p) { o[p.type] = +p.value })
		return o
	}
	function tzOffsetMs(ms, tz) { var o = wallParts(ms, tz); return Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second) - Math.floor(ms / 1000) * 1000 }
	/** Parse an ISO string; one without an offset is a wall-clock time in ``tz``. */
	function parseIso(s, tz) {
		if (!s) return null
		if (/(Z|[+-]\d\d:?\d\d)$/i.test(s)) return new Date(s)
		var m = String(s).replace(' ', 'T').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/)
		if (!m) return new Date(s)
		var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
		var t = guess - tzOffsetMs(guess, tz || 'UTC')
		t = guess - tzOffsetMs(t, tz || 'UTC')
		return new Date(t)
	}
	function gmtLabel(tz) {
		return safe(function () {
			var p = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(function (x) { return x.type === 'timeZoneName' })
			return p ? p.value : ''
		}, '')
	}
	function tzNice(tz) { tz = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh' }[tz] || tz; return String(tz || '').replace(/_/g, ' ').replace(/\//g, ' / ') }
	function tzList() {
		var l = safe(function () { return Intl.supportedValuesOf('timeZone').slice() }, null)
		if (!l || !l.length) l = ['Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'America/Toronto', 'Asia/Bangkok', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Riyadh', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Pacific/Auckland', 'UTC']
		if (l.indexOf('UTC') < 0) l.push('UTC')
		return l
	}
	function esc(s) { return String(s == null ? '' : s) }

	/* colour maths (WCAG relative luminance) */
	function hexRgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); if (!/^[0-9a-f]{6}$/i.test(h)) return null; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
	function rgbHex(c) { return '#' + c.map(function (v) { return pad2(Math.max(0, Math.min(255, Math.round(v)))) }).join('') }
	function pad2(n) { return n.toString(16).padStart(2, '0') }
	function lum(c) { var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
	function contrast(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
	function onColor(bg) { return contrast(bg, [255, 255, 255]) >= contrast(bg, [17, 17, 17]) ? '#ffffff' : '#111111' }
	/** Move ``c`` towards white/black until it reads (>= ratio) against ``bg``. */
	function ensure(c, bg, ratio) {
		if (contrast(c, bg) >= ratio) return c
		var target = lum(bg) < 0.4 ? [255, 255, 255] : [0, 0, 0]
		for (var t = 0.1; t <= 1.001; t += 0.1) {
			var m = c.map(function (v, i) { return v + (target[i] - v) * t })
			if (contrast(m, bg) >= ratio) return m
		}
		return target
	}

	/* ------------------------------------------------------------------ attribution */
	var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']
	function readFromQuery(q) { var o = {}; UTM_KEYS.forEach(function (k) { var v = q.get(k); if (v) o[k] = v.slice(0, 250) }); return o }
	function b64urlDecode(s) { return safe(function () { var b = s.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return JSON.parse(decodeURIComponent(escape(atob(b)))) }, null) }
	function attribution() {
		var cur = readFromQuery(QS)
		var ft = QS.get('ft') ? b64urlDecode(QS.get('ft')) : null
		var utm = Object.assign({}, cur)
		var landing = QS.get('landing') || (EMBED ? '' : location.origin + location.pathname)
		var referrer = QS.get('ref') != null ? QS.get('ref') : (document.referrer || '')
		if (ft && typeof ft === 'object') utm.first_touch = ft
		else if (Object.keys(cur).length) utm.first_touch = Object.assign({}, cur)
		return { utm: utm, landing_url: String(landing || '').slice(0, 500), referrer: String(referrer || '').slice(0, 500) }
	}

	/* ------------------------------------------------------------------ API */
	function ApiError(message, code, status, data) { this.message = message; this.code = code || ''; this.status = status || 0; this.data = data }
	ApiError.prototype = Object.create(Error.prototype)

	function stripHtml(s) { var d = document.createElement('div'); d.innerHTML = String(s || ''); return (d.textContent || '').trim() }
	function parseError(res, body) {
		var msg = '', code = ''
		var data = body && typeof body === 'object' ? body : {}
		if (typeof data.code === 'string') code = data.code
		var m = data.message
		if (m && typeof m === 'object' && (m.code || m.error)) { code = m.code || ''; msg = m.error || m.message_text || '' }
		if (data._server_messages) {
			safe(function () {
				JSON.parse(data._server_messages).forEach(function (x) {
					var o = JSON.parse(x)
					if (o && o.message && !msg) msg = stripHtml(o.message)
					if (o && o.code && !code) code = o.code
				})
			})
		}
		if (!msg && data.exception) { msg = String(data.exception).replace(/^[\w.]+:\s*/, '') }
		var blob = (msg + ' ' + (data.exc_type || '') + ' ' + (data.exception || '') + ' ' + (data._server_messages || '')).toLowerCase()
		if (!code && /slot_taken|slot is no longer|already taken|just been booked/.test(blob)) code = 'slot_taken'
		if (!code && res.status === 429) code = 'rate_limited'
		if (code === 'unavailable') code = 'not_found'
		if (!code && res.status === 404 || /does not exist|not found|doesnotexist/.test(blob) && res.status === 404) code = 'not_found'
		if (!msg || /traceback|exception|frappe\./i.test(msg)) msg = ''
		return new ApiError(msg, code, res.status, data)
	}
	function call(method, params, post) {
		var url = '/api/method/crm_addons.demos.public.' + method
		var opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } }
		if (post) {
			opts.method = 'POST'
			opts.headers['Content-Type'] = 'application/json'
			var tok = (window.CRM_BOOK && window.CRM_BOOK.csrf) || (window.csrf_token && window.csrf_token !== '{{ csrf_token }}' ? window.csrf_token : '')
			if (tok) opts.headers['X-Frappe-CSRF-Token'] = tok
			opts.body = JSON.stringify(params || {})
		} else {
			var q = new URLSearchParams()
			Object.keys(params || {}).forEach(function (k) { if (params[k] != null) q.set(k, params[k]) })
			url += '?' + q.toString()
		}
		return fetch(url, opts).then(function (res) {
			return res.text().then(function (t) {
				var body = null
				try { body = t ? JSON.parse(t) : null } catch (e) { body = null }
				if (!res.ok) throw parseError(res, body)
				if (body && body.message && typeof body.message === 'object' && body.message.ok === false) throw parseError({ status: 400 }, body)
				return body ? body.message : null
			})
		}, function () {
			throw new ApiError('We could not reach the server. Check your connection and try again.', 'network', 0)
		})
	}
	function friendly(e, fallback) {
		if (!e) return fallback
		if (e.code === 'network') return e.message
		if (e.code === 'rate_limited') return 'Too many attempts. Please wait a minute and try again.'
		if (e.code === 'too_fast') return 'That was quick. Please check your details and press Confirm again.'
		if (e.code === 'form_expired') return 'This page has been open for a long time. Please reload it and try again.'
		if (e.code === 'not_changeable') return e.message || 'This booking can no longer be changed online.'
		return e.message || fallback || 'Something went wrong. Please try again.'
	}

	/* ------------------------------------------------------------------ state shared by the components */
	var store = reactive({
		tz: validTz(QS.get('tz')) ? QS.get('tz') : (lsGet('crm_book_tz') && validTz(lsGet('crm_book_tz')) ? lsGet('crm_book_tz') : browserTz()),
		h24: lsGet('crm_book_h24') != null ? lsGet('crm_book_h24') === '1' : !safe(function () { return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric' }).resolvedOptions().hour12 }, true),
	})
	watch(function () { return store.tz }, function (v) { lsSet('crm_book_tz', v) })
	watch(function () { return store.h24 }, function (v) { lsSet('crm_book_h24', v ? '1' : '0') })

	/* ------------------------------------------------------------------ icons */
	var ICONS = {
		calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		gmeet: '<path fill="#fff" stroke="none" d="M6 9.5h9.5v5H6z"/><path fill="#ea4335" stroke="none" d="M6 6v3.5H2z"/><path fill="#2684fc" stroke="none" d="M2 9.5h4v5H2z"/><path fill="#0066da" stroke="none" d="M2 14.5h4V18H4a2 2 0 0 1-2-2z"/><path fill="#ffba00" stroke="none" d="M6 6h7.5a2 2 0 0 1 2 2v1.5H6z"/><path fill="#00ac47" stroke="none" d="M6 14.5h9.5V16a2 2 0 0 1-2 2H6z"/><path fill="#00832d" stroke="none" d="m15.5 10.8 5.1-3.6a.6.6 0 0 1 .9.5v8.6a.6.6 0 0 1-.9.5l-5.1-3.6z"/>',
		video: '<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9S14.600 18.400 12 21c-2.600-2.600-3.900-5.600-3.900-9S9.400 5.600 12 3z"/>',
		pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
		left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>',
		check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.500-3.500"/>', alert: '<path d="M12 8v5M12 16.500v.01"/><path d="M10.300 3.900 2.400 18a2 2 0 0 0 1.700 3h15.800a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z"/>',
		users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 7M18.500 14.500A6.500 6.500 0 0 1 21.500 20"/>',
		download: '<path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
	}
	var Ico = {
		props: { n: String, size: { type: Number, default: 18 } },
		template: '<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" v-html="body"></svg>',
		computed: { body: function () { return ICONS[this.n] || '' } },
	}

	/* ------------------------------------------------------------------ outside click helper for popovers */
	function useOutside(elRef, close) {
		var onDoc = function (e) { if (elRef.value && !elRef.value.contains(e.target)) close() }
		onMounted(function () { document.addEventListener('mousedown', onDoc); document.addEventListener('touchstart', onDoc, { passive: true }) })
		onBeforeUnmount(function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc) })
	}

	/* ------------------------------------------------------------------ TimezonePicker */
	var TimezonePicker = {
		components: { Ico: Ico },
		setup: function () {
			var open = ref(false), q = ref(''), active = ref(0), root = ref(null), input = ref(null), btn = ref(null)
			var all = tzList()
			var offsetCache = {}
			var off = function (tz) { return offsetCache[tz] || (offsetCache[tz] = gmtLabel(tz)) }
			var items = computed(function () {
				var s = q.value.trim().toLowerCase().replace(/_/g, ' ')
				var list = all
				if (s) list = all.filter(function (z) { return z.toLowerCase().replace(/_/g, ' ').indexOf(s) >= 0 || off(z).toLowerCase().indexOf(s) >= 0 })
				var first = list.indexOf(store.tz) >= 0 ? [store.tz] : []
				return first.concat(list.filter(function (z) { return z !== store.tz })).slice(0, 80)
			})
			watch(q, function () { active.value = 0 })
			function close(focus) { open.value = false; q.value = ''; if (focus && btn.value) btn.value.focus() }
			function toggle() { open.value = !open.value; if (open.value) nextTick(function () { input.value && input.value.focus() }) }
			function pick(z) { store.tz = z; close(true) }
			function key(e) {
				if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(items.value.length - 1, active.value + 1); scroll() }
				else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(0, active.value - 1); scroll() }
				else if (e.key === 'Enter') { e.preventDefault(); if (items.value[active.value]) pick(items.value[active.value]) }
				else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
			}
			function scroll() { nextTick(function () { var el = root.value && root.value.querySelector('[data-active="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }) }
			useOutside(root, function () { if (open.value) close() })
			return { open: open, q: q, active: active, root: root, input: input, btn: btn, items: items, toggle: toggle, pick: pick, key: key, store: store, off: off, tzNice: tzNice }
		},
		template: '\
<div class="bk-tz" ref="root">\
	<button type="button" class="bk-tz-btn" ref="btn" @click="toggle" :aria-expanded="open" aria-haspopup="listbox" aria-label="Time zone">\
		<Ico n="globe" :size="16"/><span class="bk-tz-name">{{ tzNice(store.tz) }} <small>{{ off(store.tz) }}</small></span><Ico n="down" :size="14"/>\
	</button>\
	<div v-if="open" class="bk-pop bk-tz-pop" @keydown="key">\
		<div class="bk-search"><Ico n="search" :size="16"/><input ref="input" v-model="q" type="text" placeholder="Search time zone" aria-label="Search time zone" role="combobox" aria-expanded="true" aria-controls="bk-tz-list" autocomplete="off" spellcheck="false"></div>\
		<ul id="bk-tz-list" class="bk-list" role="listbox" aria-label="Time zones">\
			<li v-for="(z, i) in items" :key="z" role="option" :aria-selected="z === store.tz" :data-active="i === active" :class="{ on: i === active, sel: z === store.tz }" @mousemove="active = i" @click="pick(z)">\
				<span>{{ tzNice(z) }}</span><small>{{ off(z) }}</small>\
			</li>\
			<li v-if="!items.length" class="bk-list-empty">No time zone matches "{{ q }}"</li>\
		</ul>\
	</div>\
</div>',
	}

	/* ------------------------------------------------------------------ BrandPanel */
	var BrandPanel = {
		components: { Ico: Ico, TimezonePicker: TimezonePicker },
		props: { demo: Object, when: Object, showTz: { type: Boolean, default: true }, note: String },
		setup: function (props) {
			var logoOk = ref(true), more = ref(false)
			var longDesc = computed(function () { return (props.demo.description || '').length > 220 })
			var whenText = computed(function () {
				if (!props.when) return null
				var d = props.when.date
				return {
					date: dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
					time: props.when.start ? timeLabel(props.when.start, store.tz, store.h24) + (props.when.end ? ' - ' + timeLabel(props.when.end, store.tz, store.h24) : '') : '',
				}
			})
			var where = computed(function () {
				var p = props.demo.provider || ''
				if (/meet/i.test(p) || !p) return 'Google Meet'
				return props.demo.location_note || 'Video call'
			})
			var showName = computed(function () { var b = props.demo.brand || {}; return !!b.name && b.name !== props.demo.title && b.name !== b.heading })
			return { showName: showName, logoOk: logoOk, more: more, longDesc: longDesc, whenText: whenText, where: where, store: store }
		},
		template: '\
<aside class="bk-panel">\
	<div class="bk-brand" v-if="demo.brand && (demo.brand.logo_url || showName)">\
		<img v-if="demo.brand.logo_url && logoOk" :src="demo.brand.logo_url" :alt="demo.brand.name ? demo.brand.name + \' logo\' : \'\'" class="bk-logo" @error="logoOk = false">\
		<span v-if="showName" class="bk-brand-name">{{ demo.brand.name }}</span>\
	</div>\
	<h1 class="bk-title">{{ demo.brand && demo.brand.heading ? demo.brand.heading : demo.title }}</h1>\
	<p v-if="demo.brand && demo.brand.heading && demo.title !== demo.brand.heading" class="bk-subtitle">{{ demo.title }}</p>\
	<div v-if="demo.description" class="bk-desc-wrap">\
		<p class="bk-desc" :class="{ clamp: longDesc && !more }">{{ demo.description }}</p>\
		<button v-if="longDesc" type="button" class="bk-link-btn" @click="more = !more" :aria-expanded="more">{{ more ? "Show less" : "Show more" }}</button>\
	</div>\
	<ul class="bk-meta">\
		<li v-if="whenText" class="bk-meta-when"><Ico n="calendar"/><span><b>{{ whenText.date }}</b><br>{{ whenText.time }}</span></li>\
		<li v-if="demo.duration_minutes"><Ico n="clock"/><span>{{ demo.duration_minutes }} minutes</span></li>\
		<li><Ico :n="demo.provider === \'Manual Link\' ? \'video\' : \'gmeet\'"/><span>{{ where }}</span></li>\
		<li v-if="showTz" class="bk-meta-tz"><TimezonePicker/></li>\
	</ul>\
	<p v-if="note" class="bk-panel-note">{{ note }}</p>\
</aside>',
	}

	/* ------------------------------------------------------------------ MonthCalendar */
	var MonthCalendar = {
		components: { Ico: Ico },
		props: { days: Object, loading: Boolean, minDate: String, maxDate: String, selected: String, month: String },
		emits: ['select', 'update:month'],
		setup: function (props, ctx) {
			var grid = ref(null)
			var focusDay = ref('')
			var first = (function () { var w = safe(function () { var l = new Intl.Locale(LOCALE); var wi = l.getWeekInfo ? l.getWeekInfo() : l.weekInfo; return wi && wi.firstDay }, null); return w ? w % 7 : 0 })()
			var today = computed(function () { return todayIn(store.tz) })
			var avail = function (d) { return !!(props.days[d] && props.days[d].length) }
			var inRange = function (d) { return (!props.minDate || d >= props.minDate) && (!props.maxDate || d <= props.maxDate) }
			var weekdays = computed(function () {
				var out = []
				for (var i = 0; i < 7; i++) {
					var idx = (first + i) % 7
					var d = new Date(Date.UTC(2024, 0, 7 + idx, 12)) // 7 Jan 2024 is a Sunday
					out.push({ s: fmt('wd', { timeZone: 'UTC', weekday: 'short' }).format(d), l: fmt('wdl', { timeZone: 'UTC', weekday: 'long' }).format(d) })
				}
				return out
			})
			var cells = computed(function () {
				var m = props.month, lead = (dow(m + '-01') - first + 7) % 7, n = daysInMonth(m), out = []
				for (var i = 0; i < 42; i++) {
					var day = i - lead + 1
					if (day < 1 || day > n) { out.push(null); continue }
					var d = m + '-' + pad(day)
					out.push({ d: d, n: day, ok: inRange(d) && avail(d), today: d === today.value, sel: d === props.selected })
				}
				return out
			})
			var rows = computed(function () { var n = 0; for (var r = 0; r < 6; r++) if (cells.value.slice(r * 7, r * 7 + 7).some(Boolean)) n++; return n })
			var canPrev = computed(function () { return !props.minDate || addMonths(props.month, -1) >= monthOf(props.minDate) })
			var canNext = computed(function () { return !props.maxDate || addMonths(props.month, 1) <= monthOf(props.maxDate) })
			var tabDay = computed(function () {
				var f = focusDay.value
				if (f && monthOf(f) === props.month) return f
				if (props.selected && monthOf(props.selected) === props.month) return props.selected
				var c = cells.value.find(function (x) { return x && x.ok })
				if (c) return c.d
				return monthOf(today.value) === props.month ? today.value : props.month + '-01'
			})
			function label(c) {
				var t = dayLabel(c.d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
				return t + (c.ok ? ', times available' : ', unavailable') + (c.today ? ', today' : '')
			}
			function focusCell(d) {
				focusDay.value = d
				nextTick(function () { var el = grid.value && grid.value.querySelector('[data-day="' + d + '"]'); if (el) el.focus() })
			}
			function move(d) {
				if (monthOf(d) !== props.month) {
					if (props.minDate && monthOf(d) < monthOf(props.minDate)) return
					if (props.maxDate && monthOf(d) > monthOf(props.maxDate)) return
					ctx.emit('update:month', monthOf(d))
				}
				focusCell(d)
			}
			function onKey(e, c) {
				var d = c.d, k = e.key, t = null
				if (k === 'ArrowLeft') t = addDays(d, -1)
				else if (k === 'ArrowRight') t = addDays(d, 1)
				else if (k === 'ArrowUp') t = addDays(d, -7)
				else if (k === 'ArrowDown') t = addDays(d, 7)
				else if (k === 'Home') t = addDays(d, -((dow(d) - first + 7) % 7))
				else if (k === 'End') t = addDays(d, 6 - ((dow(d) - first + 7) % 7))
				else if (k === 'PageUp' || k === 'PageDown') {
					var nm = addMonths(props.month, k === 'PageUp' ? -1 : 1)
					var dd = Math.min(+d.slice(8), daysInMonth(nm))
					t = nm + '-' + pad(dd)
				}
				else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (c.ok) ctx.emit('select', c.d); return }
				if (t) { e.preventDefault(); move(t) }
			}
			function nav(n) { ctx.emit('update:month', addMonths(props.month, n)) }
			return { grid: grid, rows: rows, weekdays: weekdays, cells: cells, canPrev: canPrev, canNext: canNext, tabDay: tabDay, label: label, onKey: onKey, nav: nav, monthLabel: monthLabel, focusDay: focusDay }
		},
		template: '\
<section class="bk-cal" aria-label="Choose a date">\
	<header class="bk-cal-head">\
		<h2 class="bk-cal-title" aria-live="polite">{{ monthLabel(month) }}</h2>\
		<div class="bk-cal-nav">\
			<button type="button" class="bk-icon-btn" :disabled="!canPrev" @click="nav(-1)" aria-label="Previous month"><Ico n="left" :size="18"/></button>\
			<button type="button" class="bk-icon-btn" :disabled="!canNext" @click="nav(1)" aria-label="Next month"><Ico n="right" :size="18"/></button>\
		</div>\
	</header>\
	<div class="bk-grid" role="grid" :aria-label="monthLabel(month)" ref="grid" :aria-busy="loading">\
		<div class="bk-row bk-wd" role="row"><div v-for="w in weekdays" :key="w.l" role="columnheader" :aria-label="w.l"><span aria-hidden="true">{{ w.s }}</span></div></div>\
		<div v-for="r in rows" :key="r" class="bk-row" role="row">\
			<template v-for="c in cells.slice((r - 1) * 7, r * 7)">\
				<div role="gridcell" class="bk-cell" :class="{ skel: loading && c }">\
					<button v-if="c && !loading" type="button" class="bk-day" :class="{ ok: c.ok, sel: c.sel, today: c.today }" :data-day="c.d"\
						:aria-disabled="!c.ok" :aria-label="label(c)" :aria-pressed="c.sel" :tabindex="c.d === tabDay ? 0 : -1"\
						@click="c.ok && $emit(\'select\', c.d)" @keydown="onKey($event, c)" @focus="focusDay = c.d">{{ c.n }}</button>\
					<span v-else-if="c" class="bk-day sk" aria-hidden="true"></span>\
				</div>\
			</template>\
		</div>\
	</div>\
</section>',
	}

	/* ------------------------------------------------------------------ SlotList */
	var SlotList = {
		components: { Ico: Ico },
		props: { date: String, slots: Array, nextDate: String, loading: Boolean, horizonDays: Number, none: Boolean },
		emits: ['pick', 'jump'],
		setup: function (props, ctx) {
			var list = ref(null)
			var labels = computed(function () { return (props.slots || []).map(function (s) { return { start: s.start, text: timeLabel(s.start, store.tz, store.h24) } }) })
			function key(e, i) {
				var btns = list.value ? list.value.querySelectorAll('.bk-slot') : []
				var n = null
				if (e.key === 'ArrowDown') n = Math.min(btns.length - 1, i + 1)
				else if (e.key === 'ArrowUp') n = Math.max(0, i - 1)
				else if (e.key === 'Home') n = 0
				else if (e.key === 'End') n = btns.length - 1
				if (n != null && btns[n]) { e.preventDefault(); btns[n].focus() }
			}
			return { list: list, labels: labels, store: store, key: key, dayLabel: dayLabel }
		},
		template: '\
<section class="bk-slots" aria-label="Choose a time">\
	<header class="bk-slots-head">\
		<h2 class="bk-slots-title"><template v-if="date"><b>{{ dayLabel(date, { weekday: \'short\' }) }}</b> {{ dayLabel(date, { day: \'numeric\' }) }}</template><template v-else>Times</template></h2>\
		<div class="bk-seg" role="group" aria-label="Time format">\
			<button type="button" :class="{ on: !store.h24 }" :aria-pressed="!store.h24" @click="store.h24 = false">12h</button>\
			<button type="button" :class="{ on: store.h24 }" :aria-pressed="store.h24" @click="store.h24 = true">24h</button>\
		</div>\
	</header>\
	<div v-if="loading" class="bk-slot-list" aria-hidden="true"><div v-for="i in 6" :key="i" class="bk-slot sk"></div></div>\
	<div v-else-if="none" class="bk-empty"><Ico n="calendar" :size="22"/><p><b>No availability in the next {{ horizonDays }} days</b></p><p>Please check back soon or try another time zone.</p></div>\
	<div v-else-if="!date" class="bk-empty soft"><p>Select a date to see the available times.</p><button v-if="nextDate" type="button" class="bk-link-btn" @click="$emit(\'jump\')">Next available: {{ dayLabel(nextDate, { weekday: \'short\', day: \'numeric\', month: \'short\' }) }}</button></div>\
	<div v-else-if="!labels.length" class="bk-empty"><Ico n="clock" :size="22"/><p><b>No times left on this day</b></p><button v-if="nextDate" type="button" class="bk-link-btn" @click="$emit(\'jump\')">Next available: {{ dayLabel(nextDate, { weekday: \'short\', day: \'numeric\', month: \'short\' }) }}</button></div>\
	<div v-else class="bk-slot-list" ref="list" role="list" aria-live="polite">\
		<button v-for="(s, i) in labels" :key="s.start" type="button" class="bk-slot" role="listitem" @click="$emit(\'pick\', s.start)" @keydown="key($event, i)" :aria-label="s.text + \', \' + dayLabel(date, { weekday: \'long\', day: \'numeric\', month: \'long\' })"><span class="bk-dot" aria-hidden="true"></span>{{ s.text }}</button>\
	</div>\
</section>',
	}

	/* ------------------------------------------------------------------ availability loader */
	function useAvailability(getSlug, getToken) {
		var days = reactive({}), loading = ref(true), error = ref(''), loaded = ref(false)
		var seq = 0
		function load(from, to) {
			var my = ++seq
			loading.value = true; error.value = ''
			var chunks = [], a = from
			while (a <= to) { var b = addDays(a, 60); if (b > to) b = to; chunks.push([a, b]); a = addDays(b, 1) }
			return Promise.all(chunks.map(function (c) { return call('get_slots', { slug: getSlug(), from_date: c[0], to_date: c[1], tz: store.tz, token: getToken ? getToken() : null }) })).then(function (res) {
				if (my !== seq) return
				Object.keys(days).forEach(function (k) { delete days[k] })
				res.forEach(function (r) { ((r && r.days) || []).forEach(function (d) { if (d.slots && d.slots.length) days[d.date] = d.slots }) })
				loaded.value = true
			}).catch(function (e) { if (my === seq) error.value = friendly(e, 'We could not load the available times.') }).then(function () { if (my === seq) loading.value = false })
		}
		return { days: days, loading: loading, error: error, loaded: loaded, load: load }
	}

	/* Scheduler = calendar + slots, shared by the booking page and the reschedule view. */
	var Scheduler = {
		components: { MonthCalendar: MonthCalendar, SlotList: SlotList, Ico: Ico },
		props: { slug: String, demo: Object, banner: String, token: String },
		emits: ['pick'],
		setup: function (props, ctx) {
			var av = useAvailability(function () { return props.slug }, function () { return props.token })
			var month = ref(''), date = ref('')
			var wide = function () { return window.matchMedia && window.matchMedia('(min-width: 861px)').matches }
			// the server's min/max are days in the demo's own zone; the visitor's zone can be a day either side, get_slots decides what is bookable
			var minDate = computed(function () { var t = todayIn(store.tz); return props.demo.min_date && props.demo.min_date > t ? props.demo.min_date : t })
			var maxDate = computed(function () { return props.demo.max_date ? addDays(props.demo.max_date, 1) : addDays(minDate.value, 30) })
			var horizon = computed(function () { return Math.max(1, dayNum(maxDate.value) - dayNum(todayIn(store.tz))) })
			var sorted = computed(function () { return Object.keys(av.days).sort() })
			var firstAvail = computed(function () { return sorted.value[0] || '' })
			var nextDate = computed(function () { var cur = date.value || ''; return sorted.value.find(function (d) { return d > cur }) || '' })
			var none = computed(function () { return av.loaded.value && !sorted.value.length && !av.error.value })
			function fetchAll() {
				var from = minDate.value, to = maxDate.value
				return av.load(from, to).then(function () {
					if (date.value && !av.days[date.value]) date.value = ''
					if (!date.value && firstAvail.value) {
						month.value = monthOf(firstAvail.value)
						if (wide()) date.value = firstAvail.value
					} else if (!month.value) month.value = monthOf(minDate.value)
				})
			}
			month.value = monthOf(minDate.value)
			onMounted(fetchAll)
			watch(function () { return store.tz }, function () { date.value = ''; fetchAll() })
			function selectDate(d) {
				date.value = d
				if (!wide()) nextTick(function () { var el = document.querySelector('.bk-slots'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }) })
			}
			function jump() { if (nextDate.value) { month.value = monthOf(nextDate.value); selectDate(nextDate.value) } }
			return { av: av, month: month, date: date, minDate: minDate, maxDate: maxDate, horizon: horizon, none: none, nextDate: nextDate, selectDate: selectDate, jump: jump, fetchAll: fetchAll,
				slots: computed(function () { return av.days[date.value] || [] }),
				startFor: function (iso) { var d = date.value; return { date: d, start: iso } },
				pick: function (iso) { ctx.emit('pick', { start: iso, date: date.value }) } }
		},
		template: '\
<div class="bk-sched">\
	<div v-if="banner" class="bk-banner warn" role="status"><Ico n="alert" :size="18"/><span>{{ banner }}</span></div>\
	<div v-if="av.error.value" class="bk-banner err" role="alert"><Ico n="alert" :size="18"/><span>{{ av.error.value }}</span><button type="button" class="bk-link-btn" @click="fetchAll">Try again</button></div>\
	<div class="bk-sched-cols">\
		<MonthCalendar v-model:month="month" :days="av.days" :loading="av.loading.value" :min-date="minDate" :max-date="maxDate" :selected="date" @select="selectDate"/>\
		<SlotList :date="date" :slots="slots" :loading="av.loading.value" :none="none" :horizon-days="horizon" :next-date="nextDate" @pick="pick" @jump="jump"/>\
	</div>\
</div>',
	}

	/* ------------------------------------------------------------------ phone / countries */
	var COUNTRIES = ('IN|India|91;US|United States|1;GB|United Kingdom|44;AE|United Arab Emirates|971;CA|Canada|1;AU|Australia|61;SG|Singapore|65;SA|Saudi Arabia|966;QA|Qatar|974;KW|Kuwait|965;OM|Oman|968;BH|Bahrain|973;' +
		'NP|Nepal|977;BD|Bangladesh|880;LK|Sri Lanka|94;PK|Pakistan|92;BT|Bhutan|975;MV|Maldives|960;AF|Afghanistan|93;NZ|New Zealand|64;MY|Malaysia|60;ID|Indonesia|62;PH|Philippines|63;TH|Thailand|66;VN|Vietnam|84;' +
		'HK|Hong Kong|852;CN|China|86;JP|Japan|81;KR|South Korea|82;DE|Germany|49;FR|France|33;ES|Spain|34;IT|Italy|39;NL|Netherlands|31;BE|Belgium|32;CH|Switzerland|41;AT|Austria|43;SE|Sweden|46;NO|Norway|47;DK|Denmark|45;FI|Finland|358;IE|Ireland|353;PT|Portugal|351;PL|Poland|48;GR|Greece|30;TR|Turkey|90;RU|Russia|7;UA|Ukraine|380;IL|Israel|972;EG|Egypt|20;' +
		'ZA|South Africa|27;NG|Nigeria|234;KE|Kenya|254;GH|Ghana|233;UG|Uganda|256;TZ|Tanzania|255;ET|Ethiopia|251;ZM|Zambia|260;ZW|Zimbabwe|263;MX|Mexico|52;BR|Brazil|55;AR|Argentina|54;CL|Chile|56;CO|Colombia|57;PE|Peru|51;MM|Myanmar|95;IQ|Iraq|964;JO|Jordan|962;LB|Lebanon|961')
		.split(';').map(function (s) { var p = s.split('|'); return { iso: p[0], name: p[1], dial: p[2] } })
	var flag = function (iso) { return String.fromCodePoint.apply(null, iso.split('').map(function (c) { return 0x1f1e6 + c.charCodeAt(0) - 65 })) }
	var TZ_COUNTRY = { 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Europe/London': 'GB', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA' }
	function guessCountry(demo) {
		var c = (demo && (demo.default_country || demo.phone_country)) || ''
		if (c && COUNTRIES.some(function (x) { return x.iso === c.toUpperCase() })) return c.toUpperCase()
		if (TZ_COUNTRY[store.tz]) return TZ_COUNTRY[store.tz]
		if (/^Australia\//.test(store.tz)) return 'AU'
		if (/^America\//.test(store.tz)) return 'US'
		var reg = safe(function () { return new Intl.Locale(LOCALE).maximize().region }, '')
		if (reg && COUNTRIES.some(function (x) { return x.iso === reg })) return reg
		return 'IN'
	}
	function cleanNational(cc, v) {
		var d = String(v || '').replace(/\D/g, '')
		if (cc === 'IN') { if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); else if (d.length === 11 && d[0] === '0') d = d.slice(1) }
		else if (d[0] === '0' && d.length > 8) d = d.replace(/^0+/, '')
		return d
	}
	function phoneError(cc, v) {
		var d = cleanNational(cc, v)
		if (cc === 'IN') return /^[6-9]\d{9}$/.test(d) ? '' : 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'
		return d.length >= 8 && d.length <= 15 ? '' : 'Enter a valid phone number (8 to 15 digits).'
	}
	var EMAIL_RE = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[A-Za-z]{2,}$/

	var PhoneInput = {
		components: { Ico: Ico },
		props: { modelValue: Object, id: String, invalid: Boolean, describedby: String, required: Boolean, placeholder: String },
		emits: ['update:modelValue', 'blur'],
		setup: function (props, ctx) {
			var open = ref(false), q = ref(''), active = ref(0), root = ref(null), search = ref(null), btn = ref(null)
			var cur = computed(function () { return COUNTRIES.find(function (c) { return c.iso === props.modelValue.cc }) || COUNTRIES[0] })
			var items = computed(function () {
				var s = q.value.trim().toLowerCase().replace(/^\+/, '')
				return COUNTRIES.filter(function (c) { return !s || c.name.toLowerCase().indexOf(s) >= 0 || c.dial.indexOf(s) === 0 || c.iso.toLowerCase() === s })
			})
			watch(q, function () { active.value = 0 })
			function close(f) { open.value = false; q.value = ''; if (f && btn.value) btn.value.focus() }
			function toggle() { open.value = !open.value; if (open.value) nextTick(function () { search.value && search.value.focus() }) }
			function pick(c) { ctx.emit('update:modelValue', Object.assign({}, props.modelValue, { cc: c.iso })); close(true) }
			function key(e) {
				if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(items.value.length - 1, active.value + 1); sc() }
				else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(0, active.value - 1); sc() }
				else if (e.key === 'Enter') { e.preventDefault(); if (items.value[active.value]) pick(items.value[active.value]) }
				else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
			}
			function sc() { nextTick(function () { var el = root.value && root.value.querySelector('[data-active="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }) }
			function input(e) { ctx.emit('update:modelValue', Object.assign({}, props.modelValue, { national: e.target.value })) }
			useOutside(root, function () { if (open.value) close() })
			return { open: open, q: q, active: active, root: root, search: search, btn: btn, cur: cur, items: items, toggle: toggle, pick: pick, key: key, input: input, flag: flag }
		},
		template: '\
<div class="bk-phone" ref="root" :class="{ bad: invalid }">\
	<button type="button" class="bk-cc" ref="btn" @click="toggle" :aria-expanded="open" aria-haspopup="listbox" :aria-label="\'Country code: \' + cur.name + \' +\' + cur.dial"><span class="bk-flag" aria-hidden="true">{{ flag(cur.iso) }}</span><span class="bk-dial">+{{ cur.dial }}</span><Ico n="down" :size="12"/></button>\
	<input :id="id" type="tel" inputmode="tel" autocomplete="tel-national" :value="modelValue.national" @input="input" @blur="$emit(\'blur\', $event)" :placeholder="placeholder || (cur.iso === \'IN\' ? \'98765 43210\' : \'Phone number\')" :aria-invalid="invalid" :aria-describedby="describedby" :aria-required="required">\
	<div v-if="open" class="bk-pop bk-cc-pop" @keydown="key">\
		<div class="bk-search"><Ico n="search" :size="16"/><input ref="search" v-model="q" type="text" placeholder="Search country" aria-label="Search country" autocomplete="off" spellcheck="false"></div>\
		<ul class="bk-list" role="listbox" aria-label="Countries">\
			<li v-for="(c, i) in items" :key="c.iso" role="option" :aria-selected="c.iso === cur.iso" :data-active="i === active" :class="{ on: i === active, sel: c.iso === cur.iso }" @mousemove="active = i" @click="pick(c)"><span class="bk-flag" aria-hidden="true">{{ flag(c.iso) }}</span><span>{{ c.name }}</span><small>+{{ c.dial }}</small></li>\
			<li v-if="!items.length" class="bk-list-empty">No country matches</li>\
		</ul>\
	</div>\
</div>',
	}

	/* ------------------------------------------------------------------ BookingForm */
	var BookingForm = {
		components: { Ico: Ico, PhoneInput: PhoneInput },
		props: { demo: Object, busy: Boolean, error: String, prefill: Object },
		emits: ['back', 'submit'],
		setup: function (props, ctx) {
			var fields = computed(function () { return (props.demo.fields || []).filter(function (f) { return f.enabled !== 0 && f.enabled !== false }) })
			var vals = reactive({}), errs = reactive({}), touched = reactive({})
			var guests = ref([]), showGuests = ref(false), guestErrs = ref([])
			var consent = ref(!!(props.demo.consent && props.demo.consent.default))
			var hp = ref(''), root = ref(null)
			var country = guessCountry(props.demo)
			fields.value.forEach(function (f) {
				var p = props.prefill || {}
				if (f.kind === 'Phone') vals[f.key] = { cc: country, national: p.phone ? cleanNational(country, p.phone) : '' }
				else if (f.kind === 'Checkbox') vals[f.key] = false
				else vals[f.key] = ''
				if (f.kind === 'Email' && p.email) vals[f.key] = p.email
				if (f.kind === 'Text' && /name/i.test(f.key + ' ' + f.label) && !/school|company|organi|institut/i.test(f.key + ' ' + f.label) && p.name) vals[f.key] = p.name
			})
			function validateField(f) {
				var v = vals[f.key], msg = ''
				var empty = f.kind === 'Phone' ? !String(v.national).trim() : f.kind === 'Checkbox' ? !v : !String(v).trim()
				if (empty) {
					if (f.required) msg = f.kind === 'Checkbox' ? 'Please tick this box to continue.' : f.kind === 'Select' ? 'Please choose an option.' : 'This field is required.'
				} else if (f.kind === 'Email') { if (!EMAIL_RE.test(String(v).trim())) msg = 'Enter a valid email address, like name@example.com.' }
				else if (f.kind === 'Phone') msg = phoneError(v.cc, v.national)
				errs[f.key] = msg
				return msg
			}
			function validateGuests() {
				var out = guests.value.map(function (g) { var s = g.trim(); return !s ? '' : EMAIL_RE.test(s) ? '' : 'Enter a valid email address.' })
				guestErrs.value = out
				return out.every(function (x) { return !x })
			}
			function submit() {
				if (props.busy) return
				var bad = null
				fields.value.forEach(function (f) { touched[f.key] = true; if (validateField(f) && !bad) bad = f.key })
				var gOk = validateGuests()
				if (bad || !gOk) {
					nextTick(function () {
						var el = root.value && (bad ? root.value.querySelector('#bk-f-' + bad) : root.value.querySelector('.bk-guest input[aria-invalid="true"]'))
						if (el && el.focus) el.focus()
					})
					return
				}
				var answers = {}
				fields.value.forEach(function (f) {
					var v = vals[f.key]
					if (f.kind === 'Phone') answers[f.key] = String(v.national).trim() ? '+' + (COUNTRIES.find(function (c) { return c.iso === v.cc }) || COUNTRIES[0]).dial + cleanNational(v.cc, v.national) : ''
					else if (f.kind === 'Checkbox') answers[f.key] = v ? 1 : 0
					else answers[f.key] = typeof v === 'string' ? v.trim() : v
				})
				ctx.emit('submit', { answers: answers, guests: guests.value.map(function (g) { return g.trim() }).filter(Boolean), consent: consent.value ? 1 : 0, hp: hp.value })
			}
			function addGuest() { if (guests.value.length < 5) { guests.value.push(''); showGuests.value = true; nextTick(function () { var l = root.value && root.value.querySelectorAll('.bk-guest input'); if (l && l.length) l[l.length - 1].focus() }) } }
			function dropGuest(i) { guests.value.splice(i, 1); guestErrs.value.splice(i, 1); if (!guests.value.length) showGuests.value = false }
			function blur(f, e) {
				// no nagging while the visitor is still moving about: empty fields wait for Confirm, and a click on the form's buttons is never
				// pushed away by an error message appearing above it. Errors are cleared as soon as the value is fixed (watch below),
				// so leaving a field never makes the page jump upwards under the pointer.
				if (e && e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.bk-actions, .bk-guests')) return
				var v = vals[f.key]
				var empty = f.kind === 'Phone' ? !String(v.national).trim() : f.kind === 'Checkbox' ? true : !String(v).trim()
				if (empty) return
				touched[f.key] = true; validateField(f)
			}
			watch(vals, function () { fields.value.forEach(function (f) { if (errs[f.key]) validateField(f) }) }, { deep: true })
			function inputAttrs(f) {
				var k = (f.key + ' ' + f.label).toLowerCase()
				if (f.kind === 'Email') return { type: 'email', autocomplete: 'email', inputmode: 'email' }
				if (/school|company|organi|institut/.test(k)) return { type: 'text', autocomplete: 'organization' }
				if (/name/.test(k)) return { type: 'text', autocomplete: 'name' }
				return { type: 'text', autocomplete: 'off' }
			}
			onMounted(function () { nextTick(function () { var el = root.value && root.value.querySelector('input:not([tabindex="-1"]), select, textarea'); if (el && !props.busy && window.matchMedia('(min-width: 861px)').matches) el.focus({ preventScroll: true }) }) })
			return { fields: fields, vals: vals, errs: errs, touched: touched, guests: guests, showGuests: showGuests, guestErrs: guestErrs, consent: consent, hp: hp, root: root, submit: submit, addGuest: addGuest, dropGuest: dropGuest, blur: blur, validateField: validateField, inputAttrs: inputAttrs }
		},
		template: '\
<form class="bk-form" ref="root" novalidate @submit.prevent="submit" aria-label="Your details">\
	<div v-for="f in fields" :key="f.key" class="bk-field" :class="{ chk: f.kind === \'Checkbox\' }">\
		<template v-if="f.kind === \'Checkbox\'">\
			<label class="bk-check"><input :id="\'bk-f-\' + f.key" type="checkbox" v-model="vals[f.key]" :aria-invalid="!!errs[f.key]" :aria-describedby="errs[f.key] ? \'bk-e-\' + f.key : null" @change="blur(f, $event)"><span class="bk-box" aria-hidden="true"><Ico n="check" :size="14"/></span><span>{{ f.label }}<i v-if="f.required" class="bk-req" aria-hidden="true"> *</i></span></label>\
		</template>\
		<template v-else>\
			<label class="bk-label" :for="\'bk-f-\' + f.key">{{ f.label }}<i v-if="f.required" class="bk-req" aria-hidden="true"> *</i><span v-if="!f.required" class="bk-opt">optional</span></label>\
			<PhoneInput v-if="f.kind === \'Phone\'" :id="\'bk-f-\' + f.key" v-model="vals[f.key]" :invalid="!!errs[f.key]" :describedby="errs[f.key] ? \'bk-e-\' + f.key : null" :required="f.required" :placeholder="f.placeholder" @blur="blur(f, $event)"/>\
			<textarea v-else-if="f.kind === \'Long Text\'" :id="\'bk-f-\' + f.key" v-model="vals[f.key]" rows="3" maxlength="2000" :placeholder="f.placeholder" :aria-invalid="!!errs[f.key]" :aria-describedby="errs[f.key] ? \'bk-e-\' + f.key : null" :aria-required="f.required" @blur="blur(f, $event)"></textarea>\
			<div v-else-if="f.kind === \'Select\'" class="bk-select"><select :id="\'bk-f-\' + f.key" v-model="vals[f.key]" :aria-invalid="!!errs[f.key]" :aria-describedby="errs[f.key] ? \'bk-e-\' + f.key : null" :aria-required="f.required" @blur="blur(f, $event)" @change="blur(f, $event)"><option value="" disabled>{{ f.placeholder || "Select..." }}</option><option v-for="o in (Array.isArray(f.options) ? f.options : String(f.options || \'\').split(/\\r?\\n/).filter(Boolean))" :key="o" :value="o">{{ o }}</option></select><Ico n="down" :size="16"/></div>\
			<input v-else :id="\'bk-f-\' + f.key" v-bind="inputAttrs(f)" v-model="vals[f.key]" maxlength="250" :placeholder="f.placeholder" :aria-invalid="!!errs[f.key]" :aria-describedby="errs[f.key] ? \'bk-e-\' + f.key : null" :aria-required="f.required" @blur="blur(f, $event)">\
		</template>\
		<p v-if="errs[f.key]" :id="\'bk-e-\' + f.key" class="bk-err" role="alert">{{ errs[f.key] }}</p>\
	</div>\
	<div class="bk-hp" aria-hidden="true"><label>Leave this empty<input type="text" name="hp" v-model="hp" tabindex="-1" autocomplete="off"></label></div>\
	<div v-if="demo.allow_guests" class="bk-guests">\
		<button v-if="!showGuests" type="button" class="bk-ghost-btn" @click="addGuest"><Ico n="users" :size="16"/> Add guests</button>\
		<div v-else>\
			<div class="bk-label">Guests <span class="bk-opt">up to 5</span></div>\
			<div v-for="(g, i) in guests" :key="i" class="bk-guest">\
				<input type="email" v-model="guests[i]" autocomplete="off" placeholder="guest@example.com" :aria-label="\'Guest \' + (i + 1) + \' email\'" :aria-invalid="!!guestErrs[i]" @input="guestErrs[i] = \'\'">\
				<button type="button" class="bk-icon-btn" @click="dropGuest(i)" :aria-label="\'Remove guest \' + (i + 1)"><Ico n="x" :size="16"/></button>\
				<p v-if="guestErrs[i]" class="bk-err" role="alert">{{ guestErrs[i] }}</p>\
			</div>\
			<button v-if="guests.length < 5" type="button" class="bk-ghost-btn" @click="addGuest"><Ico n="plus" :size="16"/> Add another guest</button>\
		</div>\
	</div>\
	<label v-if="demo.consent && demo.consent.text" class="bk-check bk-consent"><input type="checkbox" v-model="consent"><span class="bk-box" aria-hidden="true"><Ico n="check" :size="14"/></span><span>{{ demo.consent.text }}</span></label>\
	<div v-if="error" class="bk-banner err" role="alert"><Ico n="alert" :size="18"/><span>{{ error }}</span></div>\
	<div class="bk-actions">\
		<button type="button" class="bk-btn ghost" @click="$emit(\'back\')" :disabled="busy">Back</button>\
		<button type="submit" class="bk-btn primary" :disabled="busy" :aria-busy="busy"><span v-if="busy" class="bk-spin" aria-hidden="true"></span>{{ busy ? "Booking..." : (demo.brand && demo.brand.button_text) || "Confirm" }}</button>\
	</div>\
</form>',
	}

	/* ------------------------------------------------------------------ calendar links */
	function icsStamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z' }
	function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1') }
	function fold(line) { var out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74) } out.push(line); return out.join('\r\n') }
	function calendarInfo(b, startD, endD) {
		var details = (b.meet_link ? 'Join: ' + b.meet_link + '\n' : '') + (b.manage_url ? 'Change or cancel: ' + absUrl(b.manage_url) : '')
		return { title: b.title || 'Demo', details: details, where: b.meet_link || '', s: startD, e: endD, uid: (b.token || String(startD.getTime())) + '@crm-demo' }
	}
	function absUrl(u) { return safe(function () { return new URL(u, location.origin).href }, u) }
	function googleLink(i) {
		return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(i.title) + '&dates=' + icsStamp(i.s) + '/' + icsStamp(i.e) + '&details=' + encodeURIComponent(i.details) + (i.where ? '&location=' + encodeURIComponent(i.where) : '')
	}
	function icsBlob(i) {
		var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CRM Pro Pack//Demo booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + i.uid, 'DTSTAMP:' + icsStamp(new Date()), 'DTSTART:' + icsStamp(i.s), 'DTEND:' + icsStamp(i.e),
			'SUMMARY:' + icsEsc(i.title), 'DESCRIPTION:' + icsEsc(i.details)]
		if (i.where) lines.push('LOCATION:' + icsEsc(i.where), 'URL:' + i.where)
		lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR')
		return new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' })
	}

	/* ------------------------------------------------------------------ Confirmation */
	var BookingSummary = {
		components: { Ico: Ico },
		props: { booking: Object, demo: Object, strike: Boolean },
		setup: function (props) {
			var start = computed(function () { return parseIso(props.booking.starts_on_iso, props.booking.tz) })
			var end = computed(function () { return parseIso(props.booking.ends_on_iso, props.booking.tz) || (start.value && new Date(start.value.getTime() + ((props.demo && props.demo.duration_minutes) || 30) * 60000)) })
			var text = computed(function () {
				if (!start.value || isNaN(start.value)) return { date: '', time: '' }
				var iso = start.value.toISOString()
				var d = fmt('sd', { timeZone: store.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start.value)
				return { date: d, time: timeLabel(iso, store.tz, store.h24) + ' - ' + timeLabel(end.value.toISOString(), store.tz, store.h24) + ' (' + tzNice(store.tz) + ')' }
			})
			return { text: text }
		},
		template: '\
<dl class="bk-summary" :class="{ strike: strike }">\
	<div><dt>What</dt><dd>{{ booking.title || demo.title }}</dd></div>\
	<div><dt>When</dt><dd><span class="d">{{ text.date }}</span><br>{{ text.time }}</dd></div>\
	<div><dt>Where</dt><dd>{{ booking.meet_link ? \'Google Meet\' : (demo.provider === \'Manual Link\' ? \'Video call\' : \'Link in your confirmation message\') }}</dd></div>\
</dl>',
	}

	var Confirmation = {
		components: { BookingSummary: BookingSummary, Ico: Ico },
		props: { booking: Object, demo: Object, email: String, rescheduled: Boolean },
		setup: function (props) {
			var menu = ref(false), mroot = ref(null)
			var left = ref(0), timer = null
			var redirect = computed(function () { var u = props.demo.brand && props.demo.brand.redirect_url || props.demo.redirect_url; return u && /^https?:\/\//i.test(u) ? u : '' })
			var info = computed(function () {
				var s = parseIso(props.booking.starts_on_iso, props.booking.tz), e = parseIso(props.booking.ends_on_iso, props.booking.tz)
				if (!s || isNaN(s)) return null
				if (!e || isNaN(e)) e = new Date(s.getTime() + ((props.demo && props.demo.duration_minutes) || 30) * 60000)
				return calendarInfo(props.booking, s, e)
			})
			var gl = computed(function () { return info.value ? googleLink(info.value) : '' })
			function download() {
				if (!info.value) return
				var a = document.createElement('a')
				a.href = URL.createObjectURL(icsBlob(info.value)); a.download = 'demo.ics'
				document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href) }, 4000)
				menu.value = false
			}
			function go() { if (!redirect.value) return; if (EMBED && window.parent !== window) post({ type: 'crm-demo:redirect', url: redirect.value }); else location.href = redirect.value }
			function stop() { clearInterval(timer); timer = null; left.value = 0 }
			onMounted(function () {
				if (redirect.value) { left.value = 6; timer = setInterval(function () { left.value--; if (left.value <= 0) { stop(); go() } }, 1000) }
			})
			onBeforeUnmount(function () { clearInterval(timer) })
			useOutside(mroot, function () { menu.value = false })
			return { menu: menu, mroot: mroot, left: left, redirect: redirect, gl: gl, download: download, stop: stop, go: go, manageUrl: computed(function () { return props.booking.manage_url ? absUrl(props.booking.manage_url) : '' }),
				rescheduleUrl: computed(function () { return props.booking.reschedule_url ? absUrl(props.booking.reschedule_url) : absUrl(props.booking.manage_url) + '?action=reschedule' }),
				cancelUrl: computed(function () { return props.booking.cancel_url ? absUrl(props.booking.cancel_url) : absUrl(props.booking.manage_url) + '?action=cancel' }) }
		},
		template: '\
<section class="bk-done" aria-live="polite">\
	<div class="bk-tick" aria-hidden="true"><Ico n="check" :size="26"/></div>\
	<h1 class="bk-done-title" tabindex="-1" id="bk-done-title">{{ rescheduled ? "Your demo has been moved" : ((demo.brand && demo.brand.success_title) || "You are booked") }}</h1>\
	<p class="bk-done-text">{{ rescheduled ? "We have sent you the new details." : ((demo.brand && demo.brand.success_text) || ("We have sent a confirmation" + (email ? " to " + email : "") + ".")) }}</p>\
	<BookingSummary :booking="booking" :demo="demo"/>\
	<div class="bk-done-actions">\
		<a v-if="booking.meet_link" class="bk-btn primary" :href="booking.meet_link" target="_blank" rel="noopener"><Ico n="gmeet" :size="18"/> Open Google Meet</a>\
		<div class="bk-menu" ref="mroot">\
			<button type="button" class="bk-btn ghost" @click="menu = !menu" :aria-expanded="menu" aria-haspopup="menu"><Ico n="calendar" :size="18"/> Add to calendar <Ico n="down" :size="14"/></button>\
			<div v-if="menu" class="bk-pop bk-menu-pop" role="menu">\
				<a role="menuitem" :href="gl" target="_blank" rel="noopener" @click="menu = false">Google Calendar <Ico n="ext" :size="14"/></a>\
				<button role="menuitem" type="button" @click="download">Apple, Outlook (.ics) <Ico n="download" :size="14"/></button>\
			</div>\
		</div>\
	</div>\
	<p v-if="manageUrl" class="bk-done-manage">Need to change plans? <a :href="rescheduleUrl" target="_blank" rel="noopener">Reschedule</a> or <a :href="cancelUrl" target="_blank" rel="noopener">cancel</a>.</p>\
	<p v-if="redirect && left > 0" class="bk-redirect">Taking you back in {{ left }} s. <button type="button" class="bk-link-btn" @click="stop">Stay here</button></p>\
</section>',
	}

	/* ------------------------------------------------------------------ messaging with the embedding page */
	var PARENT_ORIGIN = QS.get('po') || ''
	function post(msg) {
		if (!EMBED || window.parent === window || !PARENT_ORIGIN) return
		safe(function () { msg.source = 'crm-demo'; window.parent.postMessage(msg, PARENT_ORIGIN) })
	}
	function reportHeight() {
		var el = document.getElementById('app')
		if (!el) return
		var h = Math.ceil(el.getBoundingClientRect().height)
		if (h !== reportHeight.last) { reportHeight.last = h; post({ type: 'crm-demo:height', height: h }) }
	}

	/* ------------------------------------------------------------------ states */
	var StateCard = {
		components: { Ico: Ico },
		props: { icon: String, title: String, text: String, action: String },
		emits: ['action'],
		template: '<div class="bk-state" role="alert"><div class="bk-state-ico"><Ico :n="icon || \'alert\'" :size="24"/></div><h1>{{ title }}</h1><p>{{ text }}</p><button v-if="action" type="button" class="bk-btn ghost" @click="$emit(\'action\')">{{ action }}</button></div>',
	}
	var Skeleton = {
		template: '<div class="bk-card bk-skel-card" aria-busy="true" aria-label="Loading"><div class="bk-panel"><div class="sk" style="width:44px;height:44px;border-radius:12px"></div><div class="sk" style="width:60%;height:14px;margin-top:20px"></div><div class="sk" style="width:85%;height:26px;margin-top:14px"></div><div class="sk" style="width:100%;height:12px;margin-top:20px"></div><div class="sk" style="width:90%;height:12px;margin-top:8px"></div></div><div class="bk-sched"><div class="bk-sched-cols"><div class="bk-cal"><div class="sk" style="width:40%;height:22px"></div><div class="bk-skel-grid"><span v-for="i in 35" :key="i" class="sk"></span></div></div><div class="bk-slots"><div class="sk" style="width:50%;height:22px"></div><div v-for="i in 5" :key="i" class="sk" style="height:40px;margin-top:8px"></div></div></div></div></div>',
	}

	/* ------------------------------------------------------------------ Book app (/book/<slug>) */
	var BookApp = {
		components: { BrandPanel: BrandPanel, Scheduler: Scheduler, BookingForm: BookingForm, Confirmation: Confirmation, StateCard: StateCard, Skeleton: Skeleton },
		props: { slug: String },
		setup: function (props) {
			var demo = ref(null), err = ref(null), step = ref('slots'), picked = ref(null)
			var busy = ref(false), formError = ref(''), banner = ref(''), booking = ref(null), email = ref(''), schedKey = ref(0)
			var attr = attribution()
			var prefill = { name: QS.get('name') || '', email: QS.get('email') || '', phone: QS.get('phone') || '' }
			var start = Date.now()
			function load() {
				err.value = null; demo.value = null
				call('get_demo', { slug: props.slug }).then(function (d) {
					if (!d) throw new ApiError('', 'not_found', 404)
					demo.value = d
					applyBrand(d)
					document.title = (d.title || 'Book a demo') + (d.brand && d.brand.name ? ' | ' + d.brand.name : '')
					nextTick(reportHeight)
				}).catch(function (e) { err.value = e })
			}
			onMounted(load)
			var when = computed(function () {
				if (!picked.value || !demo.value) return null
				var end = new Date(new Date(picked.value.start).getTime() + (demo.value.duration_minutes || 30) * 60000).toISOString()
				return { date: dayInTz(picked.value.start), start: picked.value.start, end: end }
			})
			function dayInTz(iso) { return todayInDate(new Date(iso)) }
			function todayInDate(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: store.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) }
			function onPick(p) { picked.value = p; banner.value = ''; formError.value = ''; step.value = 'form'; scrollTop() }
			function back() { step.value = 'slots'; formError.value = ''; scrollTop() }
			function scrollTop() { nextTick(function () { var c = document.querySelector('.bk-card'); if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: 'start' }); if (EMBED) post({ type: 'crm-demo:scroll-top' }) }) }
			function submit(f) {
				busy.value = true; formError.value = ''
				var em = ''
				;(demo.value.fields || []).forEach(function (x) { if (x.kind === 'Email' && !em) em = f.answers[x.key] })
				var payload = Object.assign({ slug: props.slug, start: picked.value.start, tz: store.tz, answers: f.answers, guests: f.guests, consent: f.consent, hp: f.hp, form_token: demo.value.form_token || '' },
					{ utm: attr.utm, landing_url: attr.landing_url, referrer: attr.referrer })
				// the server refuses a form sent within 3 s of the page opening (bots); a quick human is simply asked to wait a moment, invisibly
				var attempt = function (again) {
					return call('book', payload, true).catch(function (e) {
						if (e.code === 'too_fast' && again) return new Promise(function (ok) { setTimeout(ok, 3200) }).then(function () { return attempt(false) })
						throw e
					})
				}
				attempt(true).then(function (r) {
					booking.value = (r && r.booking) || r; email.value = em; step.value = 'done'
					post({ type: 'crm-demo:booked', slug: props.slug, status: booking.value.status, starts_on_iso: booking.value.starts_on_iso })
					scrollTop(); nextTick(function () { var h = document.getElementById('bk-done-title'); h && h.focus({ preventScroll: true }) })
				}).catch(function (e) {
					if (e.code === 'slot_taken') {
						banner.value = 'Sorry, that time was just taken. Here are the times that are still free.'
						step.value = 'slots'; schedKey.value++; picked.value = null
					} else formError.value = friendly(e, 'We could not complete your booking. Please try again.')
				}).then(function () { busy.value = false })
			}
			return { demo: demo, err: err, step: step, picked: picked, busy: busy, formError: formError, banner: banner, booking: booking, email: email, schedKey: schedKey, when: when, prefill: prefill, load: load, onPick: onPick, back: back, submit: submit }
		},
		template: '\
<div v-if="err" class="bk-card single"><StateCard :icon="err.code === \'not_found\' || err.status === 404 ? \'calendar\' : \'alert\'" :title="err.code === \'not_found\' || err.status === 404 ? \'This booking page is not available\' : \'Something went wrong\'" :text="err.code === \'not_found\' || err.status === 404 ? \'It may have been turned off or the link is not correct. Please check the link or contact the person who shared it.\' : (err.message || \'We could not load this page.\')" :action="err.code === \'not_found\' || err.status === 404 ? \'\' : \'Try again\'" @action="load"/></div>\
<Skeleton v-else-if="!demo"/>\
<template v-else>\
	<div class="bk-card" :class="{ done: step === \'done\', two: step === \'form\' }">\
		<template v-if="step === \'done\'"><Confirmation :booking="booking" :demo="demo" :email="email"/></template>\
		<template v-else>\
			<BrandPanel :demo="demo" :when="step === \'form\' ? when : null"/>\
			<Scheduler v-if="step === \'slots\'" :key="schedKey" :slug="slug" :demo="demo" :banner="banner" @pick="onPick"/>\
			<div v-else class="bk-formwrap"><h2 class="bk-form-title">Your details</h2><BookingForm :demo="demo" :busy="busy" :error="formError" :prefill="prefill" @back="back" @submit="submit"/></div>\
		</template>\
	</div>\
	<footer v-if="demo.brand && demo.brand.footer_text" class="bk-footer">{{ demo.brand.footer_text }}</footer>\
</template>',
	}

	/* ------------------------------------------------------------------ Manage app (/book/manage/<token>) */
	var ManageApp = {
		components: { BrandPanel: BrandPanel, Scheduler: Scheduler, BookingSummary: BookingSummary, StateCard: StateCard, Skeleton: Skeleton, Ico: Ico },
		props: { token: String },
		setup: function (props) {
			var data = ref(null), err = ref(null), mode = ref('view'), busy = ref(false), msg = ref(''), reason = ref(''), newPick = ref(null), done = ref('')
			var banner = ref(''), schedKey = ref(0)
			function norm(r) {
				var b = r.booking || r
				var d = r.demo || {}
				var brand = r.brand || d.brand || b.brand || {}
				var slug = r.slug || d.slug || b.slug || b.demo_slug || ''
				var canChange = r.can_change != null ? r.can_change : (r.can_modify != null ? r.can_modify : (r.can_reschedule != null ? r.can_reschedule : (b.can_change != null ? b.can_change : true)))
				return { booking: b, slug: slug, status: String(b.status || r.status || '').toLowerCase(), canChange: !!canChange, past: !!(r.past || b.past),
					demo: Object.assign({ title: b.title || d.title || 'Demo', description: d.description || r.description || '', duration_minutes: d.duration_minutes || r.duration_minutes || b.duration_minutes, provider: d.provider || r.provider, min_date: d.min_date || r.min_date, max_date: d.max_date || r.max_date, brand: brand, allow_guests: false, fields: [] }, d, { brand: brand }) }
			}
			function load() {
				err.value = null
				call('get_booking', { token: props.token }).then(function (r) {
					if (!r) throw new ApiError('', 'not_found', 404)
					data.value = norm(r)
					applyBrand(data.value.demo)
					document.title = 'Manage your booking' + (data.value.demo.brand && data.value.demo.brand.name ? ' | ' + data.value.demo.brand.name : '')
					var act = QS.get('action') || (location.hash === '#cancel' ? 'cancel' : '')
					if (data.value.canChange && !/cancel/.test(data.value.status) && !data.value.past) { if (act === 'cancel') mode.value = 'cancel'; else if (act === 'reschedule') mode.value = 'reschedule' }
					nextTick(reportHeight)
				}).catch(function (e) { err.value = e })
			}
			onMounted(load)
			var cancelled = computed(function () { return data.value && /cancel/.test(data.value.status) })
			var isPast = computed(function () {
				if (!data.value) return false
				if (data.value.past || /complet|no show|held/.test(data.value.status)) return true
				var e = parseIso(data.value.booking.ends_on_iso || data.value.booking.starts_on_iso, data.value.booking.tz)
				return !!(e && !isNaN(e) && e.getTime() < Date.now())
			})
			var active = computed(function () { return data.value && !cancelled.value && !isPast.value })
			var when = computed(function () {
				if (!newPick.value || !data.value) return null
				var end = new Date(new Date(newPick.value.start).getTime() + (data.value.demo.duration_minutes || 30) * 60000).toISOString()
				return { date: new Intl.DateTimeFormat('en-CA', { timeZone: store.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(newPick.value.start)), start: newPick.value.start, end: end }
			})
			function doCancel() {
				busy.value = true; msg.value = ''
				call('cancel', { token: props.token, reason: reason.value.trim() }, true).then(function () {
					done.value = 'cancelled'; data.value.status = 'cancelled'; mode.value = 'view'; post({ type: 'crm-demo:cancelled' })
				}).catch(function (e) { msg.value = friendly(e, 'We could not cancel this booking. Please try again.') }).then(function () { busy.value = false })
			}
			function doReschedule() {
				busy.value = true; msg.value = ''
				call('reschedule', { token: props.token, start: newPick.value.start, tz: store.tz }, true).then(function (r) {
					var b = (r && r.booking) || r
					if (b) data.value.booking = Object.assign({}, data.value.booking, b)
					data.value.status = String((b && b.status) || 'rescheduled').toLowerCase()
					done.value = 'rescheduled'; mode.value = 'view'; newPick.value = null; post({ type: 'crm-demo:rescheduled' })
				}).catch(function (e) {
					if (e.code === 'slot_taken') { banner.value = 'Sorry, that time was just taken. Here are the times that are still free.'; newPick.value = null; schedKey.value++; mode.value = 'reschedule' }
					else msg.value = friendly(e, 'We could not move this booking. Please try again.')
				}).then(function () { busy.value = false })
			}
			function startReschedule() { mode.value = 'reschedule'; newPick.value = null; msg.value = ''; banner.value = ''; schedKey.value++ }
			function bookAgain() { location.href = '/book/' + encodeURIComponent(data.value.slug) + location.search }
			return { data: data, err: err, mode: mode, busy: busy, msg: msg, reason: reason, newPick: newPick, done: done, banner: banner, schedKey: schedKey, cancelled: cancelled, isPast: isPast, active: active, when: when, load: load, doCancel: doCancel, doReschedule: doReschedule, startReschedule: startReschedule, bookAgain: bookAgain }
		},
		template: '\
<div v-if="err" class="bk-card single"><StateCard icon="calendar" :title="err.code === \'not_found\' || err.status === 404 || err.status === 403 ? \'We could not find this booking\' : \'Something went wrong\'" :text="err.code === \'not_found\' || err.status === 404 || err.status === 403 ? \'This link may be incorrect or no longer valid. Check the link in your confirmation message.\' : (err.message || \'We could not load your booking.\')" :action="(err.code === \'not_found\' || err.status === 404 || err.status === 403) ? \'\' : \'Try again\'" @action="load"/></div>\
<Skeleton v-else-if="!data"/>\
<template v-else>\
	<div class="bk-card" :class="{ two: mode === \'view\' || mode === \'cancel\' }">\
		<BrandPanel :demo="data.demo" :when="mode === \'reschedule\' && when ? when : null" :show-tz="mode !== \'cancel\'"/>\
		<Scheduler v-if="mode === \'reschedule\' && !newPick" :key="schedKey" :slug="data.slug" :token="token" :demo="data.demo" :banner="banner" @pick="newPick = $event"/>\
		<div v-else-if="mode === \'reschedule\' && newPick" class="bk-formwrap">\
			<h2 class="bk-form-title">Confirm the new time</h2>\
			<p class="bk-muted">You are moving your demo. Your previous time will be released.</p>\
			<div v-if="msg" class="bk-banner err" role="alert"><Ico n="alert" :size="18"/><span>{{ msg }}</span></div>\
			<div class="bk-actions"><button type="button" class="bk-btn ghost" :disabled="busy" @click="newPick = null">Back</button><button type="button" class="bk-btn primary" :disabled="busy" @click="doReschedule"><span v-if="busy" class="bk-spin" aria-hidden="true"></span>{{ busy ? "Moving..." : "Confirm new time" }}</button></div>\
		</div>\
		<div v-else class="bk-formwrap">\
			<div class="bk-status" :class="cancelled ? \'bad\' : isPast ? \'mute\' : \'good\'">{{ cancelled ? "Cancelled" : isPast ? "Completed" : (data.status === "rescheduled" ? "Rescheduled" : "Confirmed") }}</div>\
			<h2 class="bk-form-title">{{ done === "cancelled" ? "Your booking is cancelled" : done === "rescheduled" ? "Your demo has been moved" : cancelled ? "This booking was cancelled" : isPast ? "This demo has already taken place" : "Your booking" }}</h2>\
			<BookingSummary :booking="data.booking" :demo="data.demo" :strike="cancelled"/>\
			<div v-if="msg" class="bk-banner err" role="alert"><Ico n="alert" :size="18"/><span>{{ msg }}</span></div>\
			<template v-if="mode === \'cancel\'">\
				<label class="bk-label" for="bk-reason">Why are you cancelling? <span class="bk-opt">optional</span></label>\
				<textarea id="bk-reason" v-model="reason" rows="3" maxlength="500" placeholder="Let us know so we can do better"></textarea>\
				<p class="bk-muted">Are you sure? This frees your time and we will let the team know.</p>\
				<div class="bk-actions"><button type="button" class="bk-btn ghost" :disabled="busy" @click="mode = \'view\'">Keep my booking</button><button type="button" class="bk-btn danger" :disabled="busy" @click="doCancel"><span v-if="busy" class="bk-spin" aria-hidden="true"></span>{{ busy ? "Cancelling..." : "Yes, cancel booking" }}</button></div>\
			</template>\
			<template v-else-if="active">\
				<p v-if="!data.canChange" class="bk-banner warn"><Ico n="alert" :size="18"/><span>It is too close to the start time to change this booking online. Please contact us if you need help.</span></p>\
				<div class="bk-actions"><button type="button" class="bk-btn danger ghost" :disabled="!data.canChange" @click="mode = \'cancel\'">Cancel booking</button><button type="button" class="bk-btn primary" :disabled="!data.canChange" @click="startReschedule">Reschedule</button></div>\
			</template>\
			<div v-else-if="cancelled && data.slug" class="bk-actions"><button type="button" class="bk-btn primary" @click="bookAgain">Book a new time</button></div>\
		</div>\
	</div>\
	<footer v-if="data.demo.brand && data.demo.brand.footer_text" class="bk-footer">{{ data.demo.brand.footer_text }}</footer>\
</template>',
	}

	/* ------------------------------------------------------------------ theme + accent */
	var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
	var brandTheme = 'auto', brandAccent = ''
	function resolveTheme() {
		var t = (QS.get('theme') || brandTheme || CFG.theme || 'auto').toLowerCase()
		if (t !== 'light' && t !== 'dark') t = mq && mq.matches ? 'dark' : 'light'
		return t
	}
	function paint() {
		var t = resolveTheme(), root = document.documentElement
		root.setAttribute('data-theme', t)
		var surf = hexRgb(t === 'dark' ? '#111113' : '#ffffff')
		var ac = hexRgb(brandAccent) || hexRgb(CFG.accent) || hexRgb('#2563eb')
		var btn = ac
		// a very dark accent disappears on a dark card (and a pale one on a light card): use a readable fill instead
		if (contrast(ac, surf) < 1.6) btn = t === 'dark' ? [250, 250, 250] : [17, 17, 17]
		root.style.setProperty('--ac', rgbHex(btn))
		root.style.setProperty('--ac-fg', onColor(btn))
		root.style.setProperty('--ac-text', rgbHex(ensure(ac, surf, 4.5)))
	}
	function applyBrand(d) {
		var b = (d && d.brand) || {}
		brandAccent = b.accent || b.accent_color || ''
		brandTheme = b.theme || 'auto'
		paint()
	}
	if (mq && mq.addEventListener) mq.addEventListener('change', paint)
	paint()
	document.documentElement.lang = LOCALE.split('-')[0]
	if (EMBED) document.documentElement.classList.add('bk-embed')
	if (EMBED && QS.get('sheet') === '1') document.documentElement.classList.add('bk-sheet')
	if (EMBED) document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented) post({ type: 'crm-demo:escape' }) })

	/* ------------------------------------------------------------------ boot */
	function route() {
		var m = CFG.mode, v = CFG.value
		if (!m) {
			var parts = location.pathname.split('/').filter(Boolean)
			var i = parts.indexOf('book')
			if (i >= 0 && parts[i + 1] === 'manage' && parts[i + 2]) { m = 'manage'; v = decodeURIComponent(parts[i + 2]) }
			else if (i >= 0 && parts[i + 1]) { m = 'slug'; v = decodeURIComponent(parts[i + 1]) }
		}
		return { mode: m, value: v }
	}
	var r = route()
	var Root = r.mode === 'manage' ? { components: { ManageApp: ManageApp }, template: '<ManageApp token="' + String(r.value).replace(/[^\w\-.~]/g, '') + '"/>' }
		: r.mode === 'slug' ? { components: { BookApp: BookApp }, template: '<BookApp slug="' + String(r.value).replace(/[^\w\-.~]/g, '') + '"/>' }
			: { components: { StateCard: StateCard }, template: '<div class="bk-card single"><StateCard icon="calendar" title="This booking page is not available" text="Please check the link."/></div>' }
	var app = V.createApp(Root)
	app.config.errorHandler = function (e) { if (window.console) console.error(e) }
	app.mount('#app')
	document.documentElement.classList.add('bk-ready')

	if (EMBED) {
		if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.getElementById('app'))
		window.addEventListener('load', reportHeight)
		window.addEventListener('message', function (e) {
			if (!PARENT_ORIGIN || e.origin !== PARENT_ORIGIN || e.source !== window.parent) return
			var d = e.data
			if (d && d.type === 'crm-demo:ping') { reportHeight.last = -1; reportHeight() }
		})
		post({ type: 'crm-demo:ready' })
	}
	window.CRMBook = { store: store, version: CFG.version }
})()
