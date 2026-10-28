/* Frappe CRM Suite Pro - lead form embed. One tiny script for the owner's other websites, no dependencies.
 *
 *   <script src="https://CRM-HOST/assets/crm_addons/book/lead-form-embed.js" async></script>
 *   <button data-crm-lead-form="free-trial">Get in touch</button>        (any button or link opens the form as a pop-up)
 *   <div data-crm-lead-form-inline="free-trial"></div>                    (the form inline in the page)
 *
 * Also records the visitor's first touch (utm_*, gclid, fbclid) for 30 days and hands it, with the page address and the referrer, to the form, so the lead
 * in the CRM carries the campaign that really brought the visitor. Never throws on the host page. Styles: one <style id="crmlf-style">, prefix "crmlf-".
 */
(function () {
	'use strict'
	try {
		if (window.CRMLeadForm && window.CRMLeadForm.__loaded) return
		var script = document.currentScript
		if (!script || !script.src) {
			var all = document.getElementsByTagName('script')
			for (var i = all.length - 1; i >= 0; i--) { if (/\/assets\/crm_addons\/book\/lead-form-embed\.js/.test(all[i].src || '')) { script = all[i]; break } }
		}
		if (!script || !script.src) return
		var ORIGIN = new URL(script.src, location.href).origin
		var KEY = 'crmlf_touch', DAYS = 30
		var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']
		function safe(fn, d) { try { return fn() } catch (e) { return d } }

		function current() { var o = {}, q = new URLSearchParams(location.search); KEYS.forEach(function (k) { var v = q.get(k); if (v) o[k] = v.slice(0, 250) }); return o }
		function first() {
			var cur = current()
			var saved = safe(function () { return JSON.parse(localStorage.getItem(KEY) || 'null') }, null)
			if (saved && saved.at && Date.now() - saved.at < DAYS * 864e5 && saved.v) return saved.v
			if (Object.keys(cur).length) { safe(function () { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v: cur })) }); return cur }
			return null
		}
		function b64url(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
		function frameUrl(slug, o) {
			var q = new URLSearchParams(); q.set('embed', '1')
			if (o && o.theme) q.set('theme', o.theme)
			var cur = current(); Object.keys(cur).forEach(function (k) { q.set(k, cur[k]) })
			var ft = first(); if (ft) q.set('ft', b64url(ft))
			q.set('landing', location.href.slice(0, 500)); q.set('ref', (document.referrer || '').slice(0, 500))
			return ORIGIN + '/lead-form/' + encodeURIComponent(slug) + '?' + q.toString()
		}
		function style() {
			if (document.getElementById('crmlf-style')) return
			var s = document.createElement('style'); s.id = 'crmlf-style'
			s.textContent = '.crmlf-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,14,.55);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .15s}.crmlf-ov.on{opacity:1}.crmlf-box{position:relative;width:100%;max-width:640px;max-height:94vh;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.35)}.crmlf-frame{display:block;width:100%;border:0;background:transparent}.crmlf-x{position:absolute;top:8px;right:8px;z-index:2;width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.08);color:#111;font:20px/1 system-ui;cursor:pointer}'
			document.head.appendChild(s)
		}
		function announce(type, slug) { safe(function () { window.dispatchEvent(new CustomEvent('crm-lead-form:' + type, { detail: { slug: slug } })) }); if (type === 'submitted') safe(function () { (window.dataLayer = window.dataLayer || []).push({ event: 'crm_lead_form_submitted', crm_lead_form_slug: slug }) }) }
		function open(slug, o) {
			safe(function () {
				if (!slug) return
				style()
				var ov = document.createElement('div'); ov.className = 'crmlf-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true')
				var box = document.createElement('div'); box.className = 'crmlf-box'
				var x = document.createElement('button'); x.type = 'button'; x.className = 'crmlf-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×'
				var fr = document.createElement('iframe'); fr.className = 'crmlf-frame'; fr.title = (o && o.label) || 'Get in touch'; fr.src = frameUrl(slug, o); fr.style.height = '420px'
				box.appendChild(x); box.appendChild(fr); ov.appendChild(box); document.body.appendChild(ov)
				var prev = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'
				requestAnimationFrame(function () { ov.className += ' on' })
				function close() { window.removeEventListener('message', onMsg); document.removeEventListener('keydown', onKey); ov.remove(); document.documentElement.style.overflow = prev }
				function onKey(e) { if (e.key === 'Escape') close() }
				function onMsg(e) {
					if (e.origin !== ORIGIN || e.source !== fr.contentWindow || !e.data || e.data.source !== 'crm-lead-form') return
					if (e.data.type === 'height' && e.data.height > 0) fr.style.height = Math.min(e.data.height, window.innerHeight * 0.94) + 'px'
					else if (e.data.type === 'submitted') announce('submitted', slug)
					else if (e.data.type === 'redirect' && /^https:\/\//i.test(e.data.url || '')) location.href = e.data.url
				}
				x.addEventListener('click', close); ov.addEventListener('click', function (e) { if (e.target === ov) close() })
				window.addEventListener('message', onMsg); document.addEventListener('keydown', onKey)
			})
		}
		function inline(el, slug, o) {
			safe(function () {
				if (!el || !slug || el.getAttribute('data-crmlf-ready')) return
				el.setAttribute('data-crmlf-ready', '1'); style()
				var fr = document.createElement('iframe'); fr.className = 'crmlf-frame'; fr.title = (o && o.label) || 'Get in touch'; fr.src = frameUrl(slug, o); fr.style.height = '480px'; fr.loading = 'lazy'
				el.appendChild(fr)
				window.addEventListener('message', function (e) {
					if (e.origin !== ORIGIN || e.source !== fr.contentWindow || !e.data || e.data.source !== 'crm-lead-form') return
					if (e.data.type === 'height' && e.data.height > 0) fr.style.height = e.data.height + 'px'
					else if (e.data.type === 'submitted') announce('submitted', slug)
					else if (e.data.type === 'redirect' && /^https:\/\//i.test(e.data.url || '')) location.href = e.data.url
				})
			})
		}
		function optsOf(el) { return { theme: el.getAttribute('data-crm-lead-form-theme') || '', label: el.getAttribute('data-crm-lead-form-label') || '' } }
		function scan() { var list = document.querySelectorAll('[data-crm-lead-form-inline]'); for (var i = 0; i < list.length; i++) inline(list[i], list[i].getAttribute('data-crm-lead-form-inline'), optsOf(list[i])) }
		document.addEventListener('click', function (e) {
			var t = e.target && e.target.closest ? e.target.closest('[data-crm-lead-form]') : null
			if (!t || t.hasAttribute('data-crm-lead-form-inline')) return
			var slug = t.getAttribute('data-crm-lead-form'); if (!slug) return
			e.preventDefault(); open(slug, optsOf(t))
		})
		first()
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan()
		window.CRMLeadForm = { __loaded: true, open: open }
	} catch (err) { /* never break the host page */ }
})()
