/* Frappe CRM Suite Pro - one look for pickers on every page (Pro, Campaigns, Meetings, Bookings, Team, the public pages).
   Plain JS, no build. It does not add components: it upgrades what the pages already render, so v-model keeps working.
     - <input type="date | time | datetime-local"> opens the calendar / time list below instead of the browser's own picker.
     - <select> shows a styled button and list instead of the browser's own menu.
   The real element stays in the page (hidden for a select), keeps its value, and gets the usual input and change events. */
(function () {
	if (window.__crmUi) return
	window.__crmUi = true
	var DOC = document
	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
	var DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
	var CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
	var CHECK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
	var PREV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
	var NEXT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

	// the same font everywhere (the pages already load it; a page that does not gets it here)
	if (!DOC.querySelector('link[href*="Instrument+Sans"]')) {
		var fl = DOC.createElement('link'); fl.rel = 'stylesheet'; fl.href = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap'
		DOC.head.appendChild(fl)
	}

	function el(tag, cls, html) { var e = DOC.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
	function pad(n) { return (n < 10 ? '0' : '') + n }
	function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d) }
	function fire(input) { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) }

	// ---- the popover -----------------------------------------------------------------------------------------------
	var cur = null
	function closePop(refocus) {
		if (!cur) return
		var c = cur; cur = null
		if (c.node.parentNode) c.node.parentNode.removeChild(c.node)
		if (c.anchor) c.anchor.setAttribute('aria-expanded', 'false')
		if (refocus && c.anchor && c.anchor.focus) c.anchor.focus()
	}
	function openPop(anchor, node, opts) {
		closePop()
		node.classList.add('pk-pop'); node.style.visibility = 'hidden'
		DOC.body.appendChild(node)
		;['mousedown', 'click', 'pointerdown'].forEach(function (t) { node.addEventListener(t, function (e) { e.stopPropagation() }) }) // a page's own "click outside closes me" must not fire while a picker inside it is used
		cur = { node: node, anchor: anchor, onKey: opts && opts.onKey }
		anchor.setAttribute('aria-expanded', 'true')
		place(node, anchor, opts && opts.matchWidth)
		node.style.visibility = ''
		return cur
	}
	function place(node, anchor, matchWidth) {
		var r = anchor.getBoundingClientRect(), vw = DOC.documentElement.clientWidth, vh = window.innerHeight
		if (matchWidth) node.style.minWidth = r.width + 'px'
		var w = node.offsetWidth, h = node.offsetHeight
		var left = Math.max(8, Math.min(r.left, vw - w - 8))
		var below = vh - r.bottom - 8, above = r.top - 8
		var top = (h <= below || below >= above) ? r.bottom + 4 : r.top - h - 4
		if (h > below && h > above) { top = Math.max(8, vh - h - 8) } // neither side fits: pin to the bottom edge
		node.style.left = left + 'px'; node.style.top = Math.max(8, top) + 'px'
		if (h > Math.max(below, above) + 4) node.style.maxHeight = Math.max(160, Math.max(below, above)) + 'px'
	}
	DOC.addEventListener('mousedown', function (e) { if (cur && !cur.node.contains(e.target) && !(cur.anchor && cur.anchor.contains(e.target))) closePop() }, true)
	DOC.addEventListener('keydown', function (e) {
		if (!cur) return
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true) } else if (cur.onKey) cur.onKey(e)
	}, true)
	window.addEventListener('resize', function () { closePop() })
	DOC.addEventListener('scroll', function (e) { if (cur && !cur.node.contains(e.target)) closePop() }, true)

	// ---- date and time ---------------------------------------------------------------------------------------------
	function parseVal(kind, v) {
		v = String(v || '')
		var out = { y: null, m: null, d: null, h: null, i: null }
		var md = v.match(/(\d{4})-(\d{2})-(\d{2})/); if (md && kind !== 'time') { out.y = +md[1]; out.m = +md[2] - 1; out.d = +md[3] }
		var mt = v.match(/(\d{2}):(\d{2})/); if (mt && kind !== 'date') { out.h = +mt[1]; out.i = +mt[2] }
		return out
	}
	function openPicker(input) {
		var kind = input.type === 'datetime-local' ? 'datetime' : input.type
		var v = parseVal(kind, input.value), now = new Date()
		var minD = String(input.min || '').slice(0, 10), maxD = String(input.max || '').slice(0, 10)
		var st = { y: v.y != null ? v.y : now.getFullYear(), m: v.m != null ? v.m : now.getMonth(), d: v.d, h: v.h, i: v.i }
		var box = el('div', 'pk-cal'), calBox = null, timeBox = null
		function write() {
			var out = ''
			if (kind === 'date') { if (st.d == null) return; out = iso(st.y, st.m, st.d) }
			else if (kind === 'time') { if (st.h == null) return; out = pad(st.h) + ':' + pad(st.i == null ? 0 : st.i) }
			else { if (st.d == null) return; out = iso(st.y, st.m, st.d) + 'T' + pad(st.h == null ? 9 : st.h) + ':' + pad(st.i == null ? 0 : st.i) }
			if (input.value !== out) { input.value = out; fire(input) }
		}
		function calendar() {
			var c = el('div', 'pk-month')
			var head = el('div', 'pk-head')
			var pb = el('button', 'pk-nav', PREV); pb.type = 'button'; pb.setAttribute('aria-label', 'Previous month')
			var nb = el('button', 'pk-nav', NEXT); nb.type = 'button'; nb.setAttribute('aria-label', 'Next month')
			var title = el('div', 'pk-title', MONTHS[st.m] + ' ' + st.y)
			pb.onclick = function () { st.m--; if (st.m < 0) { st.m = 11; st.y-- } render() }
			nb.onclick = function () { st.m++; if (st.m > 11) { st.m = 0; st.y++ } render() }
			head.appendChild(pb); head.appendChild(title); head.appendChild(nb); c.appendChild(head)
			var grid = el('div', 'pk-grid')
			DAYS.forEach(function (d) { grid.appendChild(el('div', 'pk-dow', d)) })
			var first = (new Date(st.y, st.m, 1).getDay() + 6) % 7, days = new Date(st.y, st.m + 1, 0).getDate(), prevDays = new Date(st.y, st.m, 0).getDate()
			var todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate())
			for (var k = 0; k < 42; k++) {
				var day, mm = st.m, yy = st.y, other = false
				if (k < first) { day = prevDays - first + k + 1; mm = st.m - 1; other = true } else if (k >= first + days) { day = k - first - days + 1; mm = st.m + 1; other = true } else day = k - first + 1
				if (mm < 0) { mm = 11; yy-- } else if (mm > 11) { mm = 0; yy++ }
				var s = iso(yy, mm, day)
				var b = el('button', 'pk-day' + (other ? ' other' : '') + (s === todayIso ? ' today' : '') + (st.d != null && s === iso(st.y, st.m, st.d) ? ' on' : ''), String(day)); b.type = 'button'
				if ((minD && s < minD) || (maxD && s > maxD)) b.disabled = true
				;(function (yy2, mm2, day2) {
					b.onclick = function () {
						st.y = yy2; st.m = mm2; st.d = day2
						write()
						if (kind === 'date') closePop(true); else render()
					}
				})(yy, mm, day)
				grid.appendChild(b)
			}
			c.appendChild(grid)
			return c
		}
		function column(count, step, active, onPick, label) {
			var col = el('div', 'pk-col'); col.setAttribute('role', 'listbox'); col.setAttribute('aria-label', label)
			var list = []
			for (var n = 0; n < count; n += step) list.push(n)
			if (active != null && list.indexOf(active) < 0) { list.push(active); list.sort(function (a, b) { return a - b }) }
			list.forEach(function (n) {
				var b = el('button', 'pk-opt' + (n === active ? ' on' : ''), pad(n)); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', n === active ? 'true' : 'false')
				b.onclick = function () { onPick(n) }
				col.appendChild(b)
			})
			return col
		}
		function times() {
			var t = el('div', 'pk-time')
			t.appendChild(column(24, 1, st.h, function (n) { st.h = n; if (st.i == null) st.i = 0; write(); render() }, 'Hour'))
			t.appendChild(el('div', 'pk-colon', ':'))
			t.appendChild(column(60, 5, st.i, function (n) { st.i = n; if (st.h == null) st.h = 9; write(); render() }, 'Minute'))
			return t
		}
		function foot() {
			var f = el('div', 'pk-foot')
			var a = el('button', 'pk-link', kind === 'time' ? 'Now' : 'Today'); a.type = 'button'
			a.onclick = function () {
				if (kind !== 'time') { st.y = now.getFullYear(); st.m = now.getMonth(); st.d = now.getDate() }
				if (kind !== 'date') { st.h = now.getHours(); st.i = Math.round(now.getMinutes() / 5) * 5 % 60 }
				write(); if (kind === 'date') closePop(true); else render()
			}
			f.appendChild(a)
			var right = el('span', 'pk-foot-r')
			if (!input.required) { var x = el('button', 'pk-link', 'Clear'); x.type = 'button'; x.onclick = function () { if (input.value) { input.value = ''; fire(input) } closePop(true) }; right.appendChild(x) }
			if (kind !== 'date') { var ok = el('button', 'pk-done', 'Done'); ok.type = 'button'; ok.onclick = function () { closePop(true) }; right.appendChild(ok) }
			f.appendChild(right)
			return f
		}
		function render() {
			var keep = box.querySelectorAll('.pk-col'), sc = []
			for (var q = 0; q < keep.length; q++) sc.push(keep[q].scrollTop)
			box.innerHTML = ''
			if (kind !== 'time') box.appendChild(calendar())
			if (kind !== 'date') box.appendChild(times())
			box.appendChild(foot())
			var cols = box.querySelectorAll('.pk-col')
			for (var r = 0; r < cols.length; r++) {
				if (sc.length) cols[r].scrollTop = sc[r]
				else { var on = cols[r].querySelector('.on'); if (on) cols[r].scrollTop = Math.max(0, on.offsetTop - 60) }
			}
			if (cur) place(box, input)
		}
		box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', kind === 'time' ? 'Choose a time' : 'Choose a date')
		render()
		openPop(input, box)
		render()
	}
	DOC.addEventListener('mousedown', function (e) {
		var t = e.target.closest && e.target.closest('input[type=date],input[type=time],input[type=datetime-local]')
		if (!t || t.disabled || t.readOnly || t.classList.contains('pk-skip')) return
		e.preventDefault(); t.focus(); if (cur && cur.anchor === t) closePop(); else openPicker(t)
	}, true)
	DOC.addEventListener('keydown', function (e) {
		var t = e.target
		if (cur || !t || !t.matches || !t.matches('input[type=date],input[type=time],input[type=datetime-local]') || t.disabled || t.readOnly) return
		if ((e.key === 'ArrowDown' && e.altKey) || e.key === 'F4') { e.preventDefault(); openPicker(t) }
	}, true)

	// ---- select ----------------------------------------------------------------------------------------------------
	var enhanced = []
	function selLabel(sel) {
		var o = sel.options[sel.selectedIndex]
		return { text: o ? o.text : '', empty: !o || o.value === '' }
	}
	function syncSel(sel) {
		var b = sel.__pk; if (!b) return
		var l = selLabel(sel), lab = b.firstChild
		if (lab.textContent !== (l.text || ' ')) lab.textContent = l.text || ' '
		lab.className = 'pk-lab' + (l.empty ? ' ph' : '')
		b.disabled = sel.disabled
		b.classList.toggle('bad', sel.getAttribute('aria-invalid') === 'true')
	}
	function enhanceSelect(sel) {
		if (sel.__pk || sel.multiple || sel.size > 1 || sel.classList.contains('pk-skip')) return
		var b = el('button', 'pk-sel ' + (sel.className || ''), '<span class="pk-lab"></span><span class="pk-chev">' + CHEV + '</span>')
		b.type = 'button'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false')
		var name = sel.getAttribute('aria-label'); if (name) b.setAttribute('aria-label', name)
		if (sel.id) { var lb = DOC.querySelector('label[for="' + sel.id + '"]'); if (lb && !lb.id) lb.id = sel.id + '-label'; if (lb) b.setAttribute('aria-labelledby', lb.id) }
		sel.__pk = b; sel.classList.add('pk-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true')
		sel.parentNode.insertBefore(b, sel)
		enhanced.push(sel); syncSel(sel)
		b.onclick = function () { if (cur && cur.anchor === b) closePop(); else openList(sel, b) }
		b.onkeydown = function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(sel, b) } }
	}
	function openList(sel, b) {
		var box = el('div', 'pk-list'); box.setAttribute('role', 'listbox')
		var items = [], active = -1
		function add(o, group) {
			var d = el('button', 'pk-item' + (o.selected ? ' on' : '') + (o.disabled ? ' off' : ''), '<span class="pk-it">' + '</span>' + (o.selected ? CHECK : ''))
			d.firstChild.textContent = o.text || ' '; d.type = 'button'; d.disabled = o.disabled; d.setAttribute('role', 'option'); d.setAttribute('aria-selected', o.selected ? 'true' : 'false')
			if (group) d.classList.add('in-group')
			d.onclick = function () { choose(o) }
			box.appendChild(d); items.push({ node: d, opt: o })
		}
		Array.prototype.forEach.call(sel.children, function (c) {
			if (c.tagName === 'OPTGROUP') { var h = el('div', 'pk-group'); h.textContent = c.label; box.appendChild(h); Array.prototype.forEach.call(c.children, function (o) { add(o, true) }) } else if (c.tagName === 'OPTION') add(c, false)
		})
		function choose(o) { if (sel.value !== o.value) { sel.value = o.value; fire(sel) } syncSel(sel); closePop(true) }
		function mark(i) {
			if (i < 0 || i >= items.length) return
			items.forEach(function (x) { x.node.classList.remove('hot') })
			active = i; items[i].node.classList.add('hot'); items[i].node.scrollIntoView({ block: 'nearest' })
		}
		var typed = '', typedAt = 0
		var pop = openPop(b, box, {
			matchWidth: true,
			onKey: function (e) {
				var n = items.length
				function step(dir) { var i = active; do { i += dir } while (i >= 0 && i < n && items[i].opt.disabled); if (i >= 0 && i < n) mark(i) }
				if (e.key === 'ArrowDown') { e.preventDefault(); step(1) } else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
				else if (e.key === 'Home') { e.preventDefault(); active = -1; step(1) } else if (e.key === 'End') { e.preventDefault(); active = n; step(-1) }
				else if (e.key === 'Enter' || e.key === ' ') { if (active >= 0) { e.preventDefault(); choose(items[active].opt) } }
				else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
					var t = Date.now(); typed = (t - typedAt > 700 ? '' : typed) + e.key.toLowerCase(); typedAt = t
					for (var i = 0; i < n; i++) if (!items[i].opt.disabled && items[i].opt.text.toLowerCase().indexOf(typed) === 0) { mark(i); break }
				} else if (e.key === 'Tab') closePop()
			}
		})
		var s = items.findIndex ? items.findIndex(function (x) { return x.opt.selected }) : -1
		mark(s >= 0 ? s : Math.max(0, items.findIndex(function (x) { return !x.opt.disabled })))
		if (pop) b.focus()
	}
	setInterval(function () {
		for (var i = enhanced.length - 1; i >= 0; i--) { var s = enhanced[i]; if (!s.isConnected) { if (s.__pk && s.__pk.parentNode) s.__pk.parentNode.removeChild(s.__pk); enhanced.splice(i, 1) } else syncSel(s) }
	}, 300)

	// ---- pick up what the page renders, now and later ----------------------------------------------------------------
	function scan(root) {
		if (!root || root.nodeType !== 1) return
		if (root.tagName === 'SELECT') enhanceSelect(root)
		var found = root.querySelectorAll ? root.querySelectorAll('select') : []
		for (var i = 0; i < found.length; i++) enhanceSelect(found[i])
	}
	function start() {
		scan(DOC.body)
		new MutationObserver(function (list) { for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) scan(list[i].addedNodes[j]) }).observe(DOC.body, { childList: true, subtree: true })
	}
	if (DOC.body) start(); else DOC.addEventListener('DOMContentLoaded', start)
})()
