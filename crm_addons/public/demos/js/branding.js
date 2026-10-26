/* Demo booking admin: the Branding tab with a live preview of the public booking dialog. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	// ------------------------------------------------------------------ colour maths
	const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
	const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
	DM.contrast = (a, b) => { const x = rgb(a), y = rgb(b); if (!x || !y) return 0; const l1 = lum(x), l2 = lum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
	DM.darken = (hex, k) => { const c = rgb(hex); if (!c) return hex; return '#' + c.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('') }
	DM.lighten = (hex, k) => { const c = rgb(hex); if (!c) return hex; return '#' + c.map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('') }
	const SWATCHES = ['#2d36a3', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#c026d3', '#7c3aed', '#111827']

	V.BrandMock = {
		props: { doc: Object, mode: { type: String, default: 'auto' }, step: { type: String, default: 'time' } },
		setup(props) {
			const dark = computed(() => (props.mode === 'dark' ? true : props.mode === 'light' ? false : document.documentElement.getAttribute('data-theme') === 'dark'))
			const chosen = computed(() => (DM.isHex(props.doc.accent_color) ? props.doc.accent_color : '#2d36a3'))
			// the same rule as the public page: a colour that vanishes on the card is swapped for a readable fill, the text on it is picked automatically
			const accent = computed(() => (DM.contrast(chosen.value, dark.value ? '#111113' : '#ffffff') < 1.6 ? (dark.value ? '#fafafa' : '#111111') : chosen.value))
			const onAccent = computed(() => (DM.contrast(accent.value, '#ffffff') >= DM.contrast(accent.value, '#0b0d12') ? '#ffffff' : '#0b0d12'))
			const accentText = computed(() => (dark.value ? (DM.contrast(accent.value, '#14161c') < 4.5 ? DM.lighten(accent.value, 0.45) : accent.value) : (DM.contrast(accent.value, '#ffffff') < 4.5 ? DM.darken(accent.value, 0.65) : accent.value)))
			const days = computed(() => DM.previewSlots(props.doc, 30))
			const first = computed(() => days.value.find((d) => d.slots.length))
			const monthStart = computed(() => { const d = CM.parseDay((first.value || days.value[0]).day); return new Date(d.getFullYear(), d.getMonth(), 1) })
			const cells = computed(() => {
				const m = monthStart.value; const lead = (m.getDay() + 6) % 7; const total = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
				const open = new Set(days.value.filter((d) => d.slots.length).map((d) => d.day))
				const sel = first.value && first.value.day
				return [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => { const s = CM.ymd(new Date(m.getFullYear(), m.getMonth(), i + 1)); return { n: i + 1, open: open.has(s), sel: s === sel } })]
			})
			const style = computed(() => ({ '--bk-accent': accent.value, '--bk-on': onAccent.value, '--bk-accent-text': accentText.value }))
			const title = computed(() => props.doc.title || 'Your demo title')
			const slots = computed(() => (first.value ? first.value.slots.slice(0, 6) : []))
			const when = computed(() => (first.value ? CM.parseDay(first.value.day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + DM.clock(DM.fromMin(first.value.slots[0] || 0)) : 'Tuesday, 12 March, 4:00 pm'))
			return { dark, style, title, cells, monthStart, slots, first, when, DM, CM, accent }
		},
		template: `
		<div class="bk" :class="{ dark }" :style="style" aria-label="Preview of the booking dialog">
			<aside class="bk-side">
				<div class="bk-brand"><img v-if="doc.logo" :src="doc.logo" alt="" class="bk-logo" /><span v-else class="bk-logo ph">{{ CM.initials(doc.brand_name || doc.title || 'D') }}</span><b class="ellipsis">{{ doc.brand_name || 'Your brand' }}</b></div>
				<h2>{{ doc.heading || title }}</h2>
				<p v-if="doc.description" class="bk-desc">{{ doc.description }}</p>
				<ul class="bk-facts"><li><Ico name="clock" size="sm" />{{ DM.durationLabel(doc.duration_minutes) }}</li><li><Ico :name="doc.provider === 'Google Meet' ? 'monitor' : 'link'" size="sm" />{{ doc.provider === 'Google Meet' ? 'Google Meet' : 'Online meeting' }}</li><li><Ico name="globe" size="sm" />{{ doc.timezone }}</li></ul>
			</aside>
			<section class="bk-main">
				<template v-if="step === 'time'">
					<div class="bk-cal"><div class="bk-mh"><b>{{ monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' }) }}</b></div><div class="bk-g dow"><span v-for="(d, i) in ['M','T','W','T','F','S','S']" :key="i">{{ d }}</span></div><div class="bk-g"><template v-for="(c, i) in cells" :key="i"><span v-if="!c"></span><span v-else class="bk-d" :class="{ open: c.open, sel: c.sel }">{{ c.n }}</span></template></div></div>
					<div class="bk-slots"><div class="bk-sh">{{ first ? CM.parseDay(first.day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'No times' }}</div><span v-for="(s, i) in slots" :key="s" class="bk-slot" :class="{ sel: i === 0 }">{{ DM.clock(DM.fromMin(s)) }}</span><span v-if="!slots.length" class="bk-none">No times available</span></div>
				</template>
				<template v-else-if="step === 'form'">
					<div class="bk-form"><div class="bk-when"><Ico name="calendar" size="sm" />{{ when }}</div>
						<div v-for="f in doc.fields.filter((x) => x.enabled).slice(0, 5)" :key="f.key" class="bk-f"><span>{{ f.label || f.key }}<b v-if="f.required"> *</b></span><div class="bk-i">{{ f.placeholder }}</div></div>
						<label v-if="doc.consent_text" class="bk-c"><i :class="{ on: doc.consent_default }"></i>{{ doc.consent_text }}</label>
						<button type="button" class="bk-btn" tabindex="-1">{{ doc.button_text || 'Confirm booking' }}</button></div>
				</template>
				<template v-else>
					<div class="bk-done"><div class="bk-ok"><Ico name="check" size="lg" /></div><h3>{{ doc.success_title || 'You are booked' }}</h3><p>{{ doc.success_text || 'A confirmation is on its way to your email.' }}</p><div class="bk-when"><Ico name="calendar" size="sm" />{{ when }}</div><span class="bk-link">Add to calendar</span></div>
				</template>
				<footer v-if="doc.footer_text" class="bk-foot">{{ doc.footer_text }}</footer>
			</section>
		</div>`,
	}

	V.BrandingTab = {
		props: { doc: Object, errs: Object, savedName: String, isNew: Boolean, dirty: Boolean },
		setup(props) {
			const doc = props.doc
			const view = ref('mock'); const step = ref('time'); const mode = ref('auto'); const frameKey = ref(0)
			const logo = computed({ get: () => (doc.logo ? [{ file_url: doc.logo, file_name: doc.logo.split('/').pop(), file_size: 0 }] : []), set: (v) => { doc.logo = v[0] ? v[0].file_url : '' } })
			// what the public page does with the colour: text on the button is picked automatically, the button itself is swapped when it would
			// disappear on the page (contrast under 1.6). Between 1.6 and 3 it stays but looks faint.
			const onLight = computed(() => DM.contrast(doc.accent_color, '#ffffff')), onDark = computed(() => DM.contrast(doc.accent_color, '#111113'))
			const advice = computed(() => {
				if (!DM.isHex(doc.accent_color)) return null
				const msgs = []
				if (onLight.value < 1.6) msgs.push('Very pale: on a light page the button is shown in near-black instead.')
				else if (onLight.value < 3) msgs.push('Faint on a light page (' + onLight.value.toFixed(1) + ':1). A darker colour reads better.')
				if (onDark.value < 1.6) msgs.push('Very dark: on a dark page the button is shown in white instead.')
				else if (onDark.value < 3) msgs.push('Faint on a dark page (' + onDark.value.toFixed(1) + ':1). A lighter colour reads better.')
				return { ok: !msgs.length, msgs }
			})
			const fix = computed(() => (DM.isHex(doc.accent_color) && onLight.value < 3 && onLight.value <= onDark.value ? DM.darken(doc.accent_color, 0.55) : ''))
			function setHex(v) { v = String(v).trim(); if (v && v[0] !== '#') v = '#' + v; doc.accent_color = v }
			const canFrame = computed(() => !props.isNew && !!props.savedName && !!doc.slug)
			const frameSrc = computed(() => '/book/' + encodeURIComponent(doc.slug) + '?embed=1&preview=1&k=' + frameKey.value)
			const origins = computed(() => String(doc.allowed_origins || '').split('\n').map((s) => s.trim()).filter(Boolean))
			return { view, step, mode, frameKey, logo, onLight, onDark, advice, fix, setHex, SWATCHES, canFrame, frameSrc, origins, DM, CM }
		},
		template: `
		<div class="brgrid">
			<div class="col tabcol">
				<Section title="Identity" icon="palette">
					<Field label="Brand name" hint="Shown at the top of the booking window, for example the name of the website."><input class="inp" v-model="doc.brand_name" maxlength="80" placeholder="Coding Junior" /></Field>
					<Field label="Logo" hint="PNG, JPG, SVG or WebP. A square or wide logo on a transparent background looks best."><Uploader v-model="logo" :multiple="false" :is-private="false" accept="image/*" :max-mb="3" title="Upload a logo" hint="Up to 3 MB" /></Field>
					<div v-if="doc.logo" class="logo-pv"><img :src="doc.logo" alt="Logo preview" /><Btn size="sm" variant="ghost" icon="trash" @click="doc.logo = ''">Remove</Btn></div>
					<Field label="Accent colour" :error="errs.accent">
						<div class="colorrow"><input type="color" class="colorpick" :value="DM.isHex(doc.accent_color) ? doc.accent_color : '#2d36a3'" aria-label="Pick a colour" @input="setHex($event.target.value)" /><input class="inp mono" style="max-width:130px" :class="{ bad: errs.accent }" :value="doc.accent_color" maxlength="7" aria-label="Colour code" @input="setHex($event.target.value)" />
							<div class="swatches"><button v-for="c in SWATCHES" :key="c" type="button" class="sw-c" :class="{ on: doc.accent_color === c }" :style="{ background: c }" :aria-label="'Use ' + c" @click="doc.accent_color = c"></button></div></div>
						<div v-if="advice" class="contrast" :class="advice.ok ? 'ok' : 'warn'"><Ico :name="advice.ok ? 'check-circle' : 'alert'" size="sm" /><span><template v-if="advice.ok">Readable on light and dark pages ({{ onLight.toFixed(1) }}:1 on white, {{ onDark.toFixed(1) }}:1 on dark). Button text colour is chosen automatically.</template><template v-else>{{ advice.msgs.join(' ') }}</template></span><Btn v-if="fix" size="sm" @click="doc.accent_color = fix">Use a darker colour</Btn></div>
					</Field>
					<Field label="Theme" hint="Auto follows the visitor's device."><Seg v-model="doc.theme" :options="[{ value: 'Auto', label: 'Auto', icon: 'monitor' }, { value: 'Light', label: 'Light', icon: 'sun' }, { value: 'Dark', label: 'Dark' }]" /></Field>
				</Section>
				<Section title="Wording" icon="text" text="Leave a field empty to use the default wording.">
					<Field label="Heading" hint="Replaces the title on the left of the booking window."><input class="inp" v-model="doc.heading" maxlength="120" placeholder="Book a free demo" /></Field>
					<Field label="Button text"><input class="inp" v-model="doc.button_text" maxlength="40" placeholder="Confirm booking" /></Field>
					<div class="g2"><Field label="Success title"><input class="inp" v-model="doc.success_title" maxlength="80" placeholder="You are booked" /></Field><Field label="Footer text"><input class="inp" v-model="doc.footer_text" maxlength="160" placeholder="Need help? Write to hello@example.com" /></Field></div>
					<Field label="Success message"><textarea class="inp" rows="2" v-model="doc.success_text" maxlength="400"></textarea></Field>
				</Section>
				<Section title="After booking" icon="external">
					<Field label="Redirect address (optional)" :error="errs.redirect" hint="Send the visitor to your own thank-you page after booking, instead of showing the success message."><input class="inp" :class="{ bad: errs.redirect }" v-model="doc.redirect_url" placeholder="https://www.example.com/thanks" /></Field>
					<Field label="Allowed websites" :error="errs.origins" hint="Websites that may show this page inside theirs. One per line, for example https://www.codingjunior.com. The direct link works everywhere."><textarea class="inp mono" :class="{ bad: errs.origins }" rows="3" v-model="doc.allowed_origins" placeholder="https://www.example.com"></textarea></Field>
				</Section>
			</div>
			<div class="brprev">
				<div class="card pad prev-card">
					<div class="prev-bar"><Seg v-model="view" :options="[{ value: 'mock', label: 'Live preview' }, { value: 'page', label: 'Saved page' }]" /><span class="grow"></span><template v-if="view === 'mock'"><Seg v-model="step" :options="[{ value: 'time', label: 'Time' }, { value: 'form', label: 'Details' }, { value: 'done', label: 'Done' }]" /><Seg v-model="mode" :options="[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]" /></template><Btn v-else size="sm" icon="refresh" aria-label="Reload the preview" :disabled="!canFrame" @click="frameKey++">Reload</Btn></div>
					<BrandMock v-if="view === 'mock'" :doc="doc" :mode="mode" :step="step" />
					<template v-else><div v-if="!canFrame" class="empty" style="padding:40px 12px"><div class="art"><Ico name="eye" size="xl" /></div><h3>Save to see the real page</h3><p>The real booking page is available once the demo widget is saved. Until then the live preview shows how it will look.</p></div>
						<template v-else><div v-if="dirty" class="alert info" style="margin-bottom:10px"><Ico name="info" /><div class="grow">Showing the last saved version. Save, then reload.</div></div><iframe :key="frameKey" class="prev-frame" :src="frameSrc" title="Saved booking page"></iframe></template></template>
					<p class="small faint" style="margin:10px 0 0">The preview shows the first free times from your weekly hours. Visitors see their own time zone.</p>
				</div>
			</div>
		</div>`,
	}
})()
