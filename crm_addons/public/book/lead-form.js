/* Frappe CRM Suite Pro - public lead form (/lead-form/<slug>). Plain Vue, no build. Posts to crm_addons.demos.leadforms. */
(function () {
	'use strict'
	var CFG = window.CRM_LEAD_FORM || {}
	var QS = new URLSearchParams(location.search)
	var Vue = window.Vue
	var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']
	var FIRST = 'crm_lf_first_touch'

	function safe(fn, fallback) { try { return fn() } catch (e) { return fallback } }

	/* Where the visitor came from: this visit's UTM values, and the first visit's (kept in this browser). */
	function attribution() {
		var cur = {}
		UTM_KEYS.forEach(function (k) { var v = QS.get(k); if (v) cur[k] = v.slice(0, 250) })
		var first = safe(function () { return JSON.parse(localStorage.getItem(FIRST) || 'null') }, null)
		if (!first && Object.keys(cur).length) { first = cur; safe(function () { localStorage.setItem(FIRST, JSON.stringify(cur)) }) }
		var utm = Object.assign({}, cur)
		if (first) utm.first_touch = first
		return { utm: utm, landing_url: (location.origin + location.pathname + location.search).slice(0, 500), referrer: (document.referrer || '').slice(0, 500) }
	}

	function stripHtml(s) { var d = document.createElement('div'); d.innerHTML = String(s || ''); return (d.textContent || '').trim() }
	function call(method, params, post) {
		var url = '/api/method/crm_addons.demos.leadforms.' + method
		var opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } }
		if (post) {
			opts.method = 'POST'
			opts.headers['Content-Type'] = 'application/json'
			if (CFG.csrf) opts.headers['X-Frappe-CSRF-Token'] = CFG.csrf
			opts.body = JSON.stringify(params || {})
		} else {
			var q = new URLSearchParams()
			Object.keys(params || {}).forEach(function (k) { if (params[k] != null) q.set(k, params[k]) })
			url += '?' + q.toString()
		}
		return fetch(url, opts).then(function (res) {
			return res.text().then(function (t) {
				var body = safe(function () { return t ? JSON.parse(t) : null }, null) || {}
				if (!res.ok) {
					var msg = '', code = typeof body.code === 'string' ? body.code : ''
					safe(function () { JSON.parse(body._server_messages).forEach(function (x) { var o = JSON.parse(x); if (o && o.message && !msg) msg = stripHtml(o.message) }) })
					if (!code && res.status === 429) code = 'rate_limited'
					if (!code && res.status === 404) code = 'not_found'
					var err = new Error(msg); err.code = code; throw err
				}
				return body.message
			})
		}, function () { var e = new Error('We could not reach the server. Check your connection and try again.'); e.code = 'network'; throw e })
	}
	function friendly(e) {
		if (e.code === 'rate_limited') return 'Too many attempts. Please wait a little and try again.'
		if (e.code === 'form_expired') return 'This page has been open for a long time. Please reload it and try again.'
		return e.message || 'Something went wrong. Please try again.'
	}

	var App = {
		setup: function () {
			var ref = Vue.ref, reactive = Vue.reactive
			var state = ref('loading'), form = ref(null), error = ref(''), busy = ref(false), brand = ref({}), done = ref(false)
			var answers = reactive({}), errors = reactive({}), hp = ref('')
			var attr = attribution()

			function applyBrand(b) {
				brand.value = b || {}
				var root = document.documentElement
				if (b && /^#[0-9a-fA-F]{6}$/.test(b.accent || '')) {
					root.style.setProperty('--ac', b.accent); root.style.setProperty('--ac-text', b.accent)
					var n = parseInt(b.accent.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
					root.style.setProperty('--ac-fg', lum > 0.6 ? '#111' : '#fff')
				}
				if (b && (b.theme === 'light' || b.theme === 'dark') && !QS.get('theme')) root.setAttribute('data-theme', b.theme)
			}
			call('get_public_form', { slug: CFG.slug }).then(function (d) {
				form.value = d; applyBrand(d.brand); document.title = d.brand.heading || d.title
				d.fields.forEach(function (f) { answers[f.fieldname] = f.fieldtype === 'Check' ? 0 : '' })
				state.value = 'ready'
			}).catch(function (e) { state.value = e.code === 'not_found' ? 'missing' : 'broken'; error.value = friendly(e) })

			function kind(f) {
				if (f.fieldname === 'email') return { type: 'email', autocomplete: 'email', inputmode: 'email' }
				if (f.fieldname === 'mobile_no' || f.fieldtype === 'Phone') return { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }
				if (f.fieldtype === 'Date') return { type: 'date' }
				if (f.fieldtype === 'Int' || f.fieldtype === 'Float') return { type: 'text', inputmode: 'decimal' }
				return { type: 'text', autocomplete: f.fieldname === 'first_name' ? 'given-name' : f.fieldname === 'last_name' ? 'family-name' : 'off' }
			}
			function check() {
				var bad = false
				Object.keys(errors).forEach(function (k) { delete errors[k] })
				form.value.fields.forEach(function (f) {
					var v = answers[f.fieldname]
					if (f.required && (f.fieldtype === 'Check' ? !v : !String(v || '').trim())) { errors[f.fieldname] = f.fieldtype === 'Check' ? 'Please tick this box.' : 'This is required.'; bad = true }
					else if (f.fieldname === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())) { errors[f.fieldname] = 'Enter a valid email address.'; bad = true }
					else if (f.fieldname === 'mobile_no' && v && String(v).replace(/\D/g, '').length < 7) { errors[f.fieldname] = 'Enter a valid phone number.'; bad = true }
				})
				var em = answers.email, ph = answers.mobile_no
				if (!bad && !String(em || '').trim() && !String(ph || '').trim()) { error.value = 'Please share an email address or a phone number.'; bad = true }
				return !bad
			}
			function submit() {
				error.value = ''
				if (!check()) return
				busy.value = true
				var payload = { slug: CFG.slug, answers: Object.assign({}, answers), hp: hp.value, form_token: form.value.form_token, utm: attr.utm, landing_url: attr.landing_url, referrer: attr.referrer }
				var attempt = function (again) {
					return call('submit', payload, true).catch(function (e) {
						// a very quick human is asked to wait a moment, invisibly (the server refuses a form sent within a few seconds)
						if (e.code === 'too_fast' && again) return new Promise(function (ok) { setTimeout(ok, 3200) }).then(function () { return attempt(false) })
						throw e
					})
				}
				attempt(true).then(function (r) {
					done.value = true; if (r && r.brand) applyBrand(r.brand)
					var url = brand.value.redirect_url
					if (url && /^https:\/\//i.test(url)) setTimeout(function () { location.href = url }, 2500)
				}).catch(function (e) { error.value = friendly(e) }).finally(function () { busy.value = false })
			}
			return { state: state, form: form, error: error, busy: busy, brand: brand, done: done, answers: answers, errors: errors, hp: hp, kind: kind, submit: submit }
		},
		template: '\
<div v-if="state === \'loading\'" class="lf-card"><div class="lf-head"><span class="sk" style="height:28px;width:60%"></span></div><div class="lf-body"><span class="sk" style="height:42px;margin-bottom:16px"></span><span class="sk" style="height:42px;margin-bottom:16px"></span><span class="sk" style="height:42px"></span></div></div>\
<div v-else-if="state !== \'ready\'" class="lf-card"><div class="bk-state"><h1>{{ state === \'missing\' ? \'This form is not available\' : \'Something went wrong\' }}</h1><p>{{ state === \'missing\' ? \'The link may be wrong, or the form has been switched off.\' : error }}</p></div></div>\
<div v-else class="lf-card">\
	<div v-if="done" class="bk-done"><div class="bk-tick" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div><h1 class="bk-done-title">{{ brand.success_title }}</h1><p class="bk-done-text">{{ brand.success_text }}</p></div>\
	<template v-else>\
		<div class="lf-head"><div v-if="brand.logo_url || brand.name" class="bk-brand"><img v-if="brand.logo_url" :src="brand.logo_url" class="bk-logo" :alt="brand.name"><span v-else class="bk-brand-name">{{ brand.name }}</span></div><h1 class="bk-title">{{ brand.heading }}</h1><p v-if="brand.description" class="bk-desc">{{ brand.description }}</p></div>\
		<div class="lf-body"><form class="bk-form" novalidate @submit.prevent="submit">\
			<div v-if="error" class="bk-banner err" role="alert"><span>{{ error }}</span></div>\
			<div v-for="f in form.fields" :key="f.fieldname" class="bk-field">\
				<label v-if="f.fieldtype !== \'Check\'" class="bk-label" :for="\'f_\' + f.fieldname">{{ f.label }}<i v-if="f.required" class="bk-req"> *</i><span v-else class="bk-opt">optional</span></label>\
				<label v-if="f.fieldtype === \'Check\'" class="bk-check"><input type="checkbox" v-model="answers[f.fieldname]" :true-value="1" :false-value="0"><span class="bk-box"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span>{{ f.label }}<i v-if="f.required" class="bk-req"> *</i></span></label>\
				<textarea v-else-if="[\'Small Text\', \'Text\', \'Long Text\'].includes(f.fieldtype)" :id="\'f_\' + f.fieldname" v-model="answers[f.fieldname]" :placeholder="f.placeholder" :aria-invalid="!!errors[f.fieldname]"></textarea>\
				<div v-else-if="f.fieldtype === \'Select\' || f.fieldtype === \'Link\'" class="bk-select"><select :id="\'f_\' + f.fieldname" v-model="answers[f.fieldname]" :aria-invalid="!!errors[f.fieldname]"><option value="">{{ f.placeholder || \'Choose…\' }}</option><template v-if="f.fieldtype === \'Select\'"><option v-for="o in f.options.filter(Boolean)" :key="o" :value="o">{{ o }}</option></template><template v-else><option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option></template></select><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div>\
				<input v-else :id="\'f_\' + f.fieldname" v-bind="kind(f)" v-model="answers[f.fieldname]" :placeholder="f.placeholder" :aria-invalid="!!errors[f.fieldname]">\
				<p v-if="f.help" class="lf-help">{{ f.help }}</p><p v-if="errors[f.fieldname]" class="bk-err">{{ errors[f.fieldname] }}</p>\
			</div>\
			<div class="bk-hp" aria-hidden="true"><label>Leave this empty<input type="text" tabindex="-1" autocomplete="off" v-model="hp"></label></div>\
			<div class="bk-actions"><button type="submit" class="bk-btn primary" :disabled="busy">{{ busy ? \'Sending…\' : brand.button_text }}</button></div>\
		</form></div>\
		<div v-if="brand.footer_text" class="lf-foot">{{ brand.footer_text }}</div>\
	</template>\
</div>',
	}
	Vue.createApp(App).mount('#app')
})()
