/* Frappe CRM Suite Pro setup page: a guided front for the CRM Addons Settings record.
 * Left: the sections. Top of the first section: a live checklist that says what still needs doing and how.
 * Every option has a switch or field, a short label and an (i) button with the details. Changes are saved together. */
;(() => {
	const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const SCHEMA = window.SETUP_SCHEMA || []

	// ------------------------------------------------------------------ theme (same rules as the other pages)
	const params = new URLSearchParams(location.search)
	if (params.get('pro') === '1') document.documentElement.classList.add('pro')
	const embedded = params.get('embed') === '1' // opened inside the CRM (a page of it): no Back to CRM link
	function readTheme() {
		let t = params.get('theme')
		try { const v = String(localStorage.getItem('theme') || '').replace(/"/g, ''); if (!t && (v === 'dark' || v === 'light')) t = v } catch (e) { /* storage blocked */ }
		try { const v = localStorage.getItem('crm_addons_theme'); if (!t && (v === 'dark' || v === 'light')) t = v } catch (e) { /* storage blocked */ }
		return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
	}
	const applyTheme = () => { const t = readTheme(); if (document.documentElement.getAttribute('data-theme') !== t) document.documentElement.setAttribute('data-theme', t) }
	applyTheme()
	window.addEventListener('storage', applyTheme)

	// ------------------------------------------------------------------ server calls
	let csrf = null
	async function token() {
		if (csrf) return csrf
		const r = await fetch('/api/method/crm_addons.api.get_csrf_token', { credentials: 'same-origin' })
		csrf = (await r.json()).message
		return csrf
	}
	const plain = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent || '' }
	async function call(method, args) {
		const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000)
		try {
			const res = await fetch('/api/method/' + method, { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Frappe-CSRF-Token': await token() }, body: JSON.stringify(args || {}) })
			let body = {}; try { body = await res.json() } catch (e) { /* not json */ }
			if (!res.ok) {
				let msg = ''
				try { msg = JSON.parse(body._server_messages || '[]').map((m) => JSON.parse(m).message).join(' ') } catch (e) { /* none */ }
				const err = new Error(plain(msg) || (res.status === 403 ? 'You do not have permission to open this page.' : res.status === 401 ? 'Please log in to the CRM first.' : 'Something went wrong (' + res.status + ').'))
				err.status = res.status; throw err
			}
			return body.message
		} catch (e) {
			if (e && e.name === 'AbortError') throw new Error('The server took too long to answer. Please try again.')
			throw e
		} finally { clearTimeout(timer) }
	}

	// ------------------------------------------------------------------ small components
	const ICONS = {
		calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
		phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
		trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
		layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
		send: '<path d="M14.5 21.7a.5.5 0 0 0 .9 0l6.5-19a.5.5 0 0 0-.6-.6l-19 6.5a.5.5 0 0 0 0 .9l7.9 3.2a2 2 0 0 1 1.1 1.1z"/><path d="m21.9 2.1-10.9 10.9"/>',
		bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
		palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
		coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9a3 3 0 0 0-2.8-1.5c-1.7 0-3 1-3 2.3 0 3 6 1.6 6 4.5 0 1.3-1.3 2.2-3 2.2a3.2 3.2 0 0 1-3-1.6M12 6v1.5M12 16.5V18"/>',
		check: '<path d="M20 6 9 17l-5-5"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
		alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>',
		external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
		search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
		refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16M8 16H3v5"/>',
		chevron: '<path d="m9 18 6-6-6-6"/>', home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
	}
	const Ico = { props: { name: String, size: { type: Number, default: 18 } }, template: `<svg class="ico" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="path"></svg>`, computed: { path() { return ICONS[this.name] || '' } } }

	// the (i) button: details on hover, keyboard focus or tap
	let openInfo = null
	const Info = {
		props: { info: Object, label: String },
		setup(props) {
			const open = ref(false); const side = ref('left'); const btn = ref(null)
			const close = () => { open.value = false; if (openInfo === close) openInfo = null }
			function show() {
				if (openInfo && openInfo !== close) openInfo()
				open.value = true; openInfo = close
				nextTick(() => { try { const r = btn.value.getBoundingClientRect(); side.value = r.left + 360 > window.innerWidth ? 'right' : 'left' } catch (e) { /* keep default */ } })
			}
			const toggle = () => (open.value ? close() : show())
			const onDoc = (e) => { if (open.value && btn.value && !btn.value.parentNode.contains(e.target)) close() }
			const onKey = (e) => { if (e.key === 'Escape') close() }
			onMounted(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey) })
			onBeforeUnmount(() => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); close() })
			return { open, side, btn, show, close, toggle }
		},
		template: `<span class="info" @mouseenter="show" @mouseleave="close">
			<button ref="btn" type="button" class="info-b" :aria-label="'More about: ' + label" :aria-expanded="open" @click.stop="toggle" @focus="show" @blur="close">i</button>
			<span v-if="open" class="info-pop" :class="side" role="tooltip">
				<b class="info-t">{{ label }}</b>
				<span class="info-p">{{ info.what }}</span>
				<span v-if="info.eg" class="info-p eg"><i>For example</i> {{ info.eg }}</span>
				<span v-if="info.note" class="info-p note"><Ico name="alert" :size="14" /> {{ info.note }}</span>
			</span>
		</span>`,
		components: { Ico },
	}

	const Toggle = {
		props: { modelValue: [Number, Boolean], disabled: Boolean, label: String, id: String },
		emits: ['update:modelValue'],
		template: `<button :id="id" type="button" role="switch" class="sw" :class="{ on: !!modelValue }" :aria-checked="!!modelValue" :aria-label="label" :disabled="disabled" @click="$emit('update:modelValue', modelValue ? 0 : 1)"><span class="sw-k"></span><span class="sw-t">{{ modelValue ? 'On' : 'Off' }}</span></button>`,
	}

	// A dropdown that looks like the rest of the page (not the browser's own list). Searchable once the list is long.
	// `action`: it acts as a menu ("Add a column..."): choosing emits the value and the button keeps showing the placeholder.
	const Sel = {
		components: { Ico },
		props: { modelValue: [String, Number, Boolean], options: { type: Array, default: () => [] }, placeholder: { type: String, default: 'Select' }, searchable: { type: Boolean, default: undefined }, disabled: Boolean, action: Boolean, id: String, small: Boolean, ariaLabel: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const open = ref(false); const btn = ref(null); const pop = ref(null); const q = ref(''); const hi = ref(0); const style = ref({})
			const list = computed(() => { const t = q.value.trim().toLowerCase(); return t ? props.options.filter((o) => (String(o.label) + ' ' + (o.sub || '')).toLowerCase().includes(t)) : props.options })
			const canSearch = computed(() => (props.searchable === undefined ? props.options.length > 7 : props.searchable))
			const current = computed(() => (props.action ? null : props.options.find((o) => o.value === props.modelValue)))
			function place() {
				const r = btn.value.getBoundingClientRect(); const vh = window.innerHeight, vw = window.innerWidth
				const below = vh - r.bottom - 12, above = r.top - 12
				const up = below < 220 && above > below
				const room = Math.max(140, Math.min(340, up ? above : below))
				const w = Math.max(r.width, 220)
				style.value = { left: Math.max(8, Math.min(r.left, vw - w - 8)) + 'px', minWidth: w + 'px', maxHeight: room + 'px', ...(up ? { bottom: vh - r.top + 6 + 'px' } : { top: r.bottom + 6 + 'px' }) }
			}
			function show() {
				if (props.disabled) return
				q.value = ''; place(); hi.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue)); open.value = true
				nextTick(() => { const i = pop.value && pop.value.querySelector('input'); if (i) i.focus() })
			}
			const close = () => { open.value = false }
			function choose(o) { if (o.disabled) return; emit('update:modelValue', o.value); close(); if (btn.value) btn.value.focus() }
			const onDoc = (e) => { if (open.value && !(pop.value && pop.value.contains(e.target)) && !(btn.value && btn.value.contains(e.target))) close() }
			function onKey(e) {
				if (!open.value) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() } return }
				if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); if (btn.value) btn.value.focus() }
				else if (e.key === 'ArrowDown') { e.preventDefault(); hi.value = Math.min(hi.value + 1, list.value.length - 1) }
				else if (e.key === 'ArrowUp') { e.preventDefault(); hi.value = Math.max(hi.value - 1, 0) }
				else if (e.key === 'Enter') { e.preventDefault(); if (list.value[hi.value]) choose(list.value[hi.value]) }
			}
			watch(q, () => { hi.value = 0 })
			onMounted(() => { document.addEventListener('mousedown', onDoc); window.addEventListener('resize', close) })
			onBeforeUnmount(() => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('resize', close) })
			return { open, btn, pop, q, hi, style, list, canSearch, current, show, close, choose, onKey }
		},
		template: `<div class="sel" :class="{ small }">
			<button :id="id" ref="btn" type="button" class="sel-btn" :class="{ open }" :disabled="disabled" :aria-label="ariaLabel || placeholder" aria-haspopup="listbox" :aria-expanded="open" @click="open ? close() : show()" @keydown="onKey">
				<span class="sel-l" :class="{ ph: !current }">{{ current ? current.label : placeholder }}</span>
				<svg class="ico chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
			</button>
			<Teleport to="body"><div v-if="open" ref="pop" class="sel-pop" :style="style" role="listbox" @keydown="onKey">
				<div v-if="canSearch" class="sel-search"><input v-model="q" placeholder="Search" aria-label="Search options" autocomplete="off" @keydown.stop="onKey" /></div>
				<div v-if="!list.length" class="sel-none">No match</div>
				<button v-for="(o, i) in list" :key="String(o.value) + i" type="button" class="sel-opt" :class="{ on: !action && o.value === modelValue, hi: i === hi, dis: o.disabled }" role="option" :aria-selected="o.value === modelValue" :disabled="o.disabled" @mouseenter="hi = i" @click="choose(o)">
					<span class="grow"><span class="ell">{{ o.label }}</span><span v-if="o.sub" class="sel-sub">{{ o.sub }}</span></span>
					<svg v-if="!action && o.value === modelValue" class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
				</button>
			</div></Teleport>
		</div>`,
	}

	// Drag a row to a new place. `onMove(ctx, from, to)` does the reordering; `ctx` says which list (an array or a key).
	function makeDrag(onMove) {
		const s = reactive({ from: -1, over: -1, ctx: null })
		return {
			s,
			start: (ctx, i, e) => { s.from = i; s.ctx = ctx; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)) } catch (x) { /* fine */ } } },
			enter: (ctx, i) => { if (s.from >= 0 && s.ctx === ctx) s.over = i },
			drop: (ctx, i) => { const f = s.from, c = s.ctx; s.from = -1; s.over = -1; s.ctx = null; if (f >= 0 && c === ctx && f !== i) onMove(ctx, f, i) },
			end: () => { s.from = -1; s.over = -1; s.ctx = null },
		}
	}
	const arrayMove = (list, from, to) => { list.splice(to, 0, list.splice(from, 1)[0]) }

	// ------------------------------------------------------------------ default views (Leads, Contacts, Organizations)
	// ------------------------------------------------------------------ branding (name, logos, login page, footer)
	const Branding = {
		components: { Ico },
		setup() {
			const loading = ref(true); const error = ref(''); const saving = ref(false); const msg = ref('')
			const v = reactive({ name: '', logo: '', favicon: '', splash: '', title_prefix: '', copyright: '', address: '', powered: '', hide_signup: 0, footer_on_login: 0 })
			let saved = ''
			const dirty = computed(() => JSON.stringify(v) !== saved)
			const fill = (r) => { Object.assign(v, r); saved = JSON.stringify(v) }
			onMounted(async () => { try { fill(await call('crm_addons.setup_page.get_branding')) } catch (e) { error.value = e.message } finally { loading.value = false } })
			const up = reactive({})
			// choose an image that is already on the site (the upload would only make a duplicate)
			const lib = reactive({ open: false, key: '', q: '', rows: [], busy: false })
			let libTimer = null
			async function loadLib() { lib.busy = true; try { lib.rows = (await call('crm_addons.setup_page.image_library', { search: lib.q })) || [] } catch (e) { msg.value = e.message } finally { lib.busy = false } }
			function openLib(key) { lib.key = key; lib.q = ''; lib.open = true; loadLib() }
			watch(() => lib.q, () => { clearTimeout(libTimer); libTimer = setTimeout(() => lib.open && loadLib(), 250) })
			function useLib(row) { v[lib.key] = row.file_url; lib.open = false }
			async function pick(key, e) {
				const file = e.target.files && e.target.files[0]; e.target.value = ''
				if (!file) return
				if (!/^image\//.test(file.type)) { msg.value = 'Choose an image file.'; return }
				if (file.size > 3 * 1048576) { msg.value = 'The image is over 3 MB.'; return }
				up[key] = true; msg.value = ''
				try {
					const fd = new FormData(); fd.append('file', file, file.name); fd.append('is_private', '0'); fd.append('folder', 'Home')
					const res = await fetch('/api/method/upload_file', { method: 'POST', credentials: 'same-origin', headers: { 'X-Frappe-CSRF-Token': await token(), Accept: 'application/json' }, body: fd })
					const j = await res.json(); if (!res.ok || !j.message) throw new Error('The upload failed.')
					v[key] = j.message.file_url
				} catch (err) { msg.value = err.message } finally { up[key] = false }
			}
			async function save() {
				saving.value = true; msg.value = ''
				try { fill(await call('crm_addons.setup_page.save_branding', { values: JSON.stringify(v) })); msg.value = 'Saved. Open pages pick up the new look when they are refreshed.' } catch (e) { msg.value = e.message } finally { saving.value = false }
			}
			async function reset() {
				if (!window.confirm('Go back to the default look? The name, logos, login image and footer you set here are cleared.')) return
				saving.value = true; msg.value = ''
				try { fill(await call('crm_addons.setup_page.reset_branding')); msg.value = 'Back to the default look.' } catch (e) { msg.value = e.message } finally { saving.value = false }
			}
			return { loading, error, saving, msg, v, dirty, up, pick, save, reset, lib, openLib, useLib }
		},
		template: `
		<div class="br">
			<div v-if="loading" class="muted">Loading</div><div v-else-if="error" class="note-box bad">{{ error }}</div>
			<template v-else>
				<h3 class="sub">Name and logos</h3>
				<div class="br-grid">
					<div class="br-f"><label>Product or company name</label><input class="inp wide" type="text" v-model="v.name" maxlength="140" placeholder="Shown in the CRM menu, the login page and the Desk" /></div>
					<div class="br-f"><label>Browser tab title prefix</label><input class="inp wide" type="text" v-model="v.title_prefix" maxlength="140" placeholder="Optional" /></div>
					<div class="br-f"><label>Logo</label><div class="br-up"><img v-if="v.logo" :src="v.logo" alt="" class="br-img" /><span v-else class="br-none">Default logo</span><label class="btn sm" :class="{ off: up.logo }">{{ up.logo ? 'Uploading...' : v.logo ? 'Change' : 'Upload' }}<input type="file" accept="image/*" hidden @change="pick('logo', $event)" /></label><button type="button" class="btn sm" @click="openLib('logo')">Choose from library</button><button v-if="v.logo" type="button" class="menu-reset" @click="v.logo = ''">Use the default</button></div><span class="small muted">Used in the CRM menu, the login page and the Desk.</span></div>
					<div class="br-f"><label>Favicon</label><div class="br-up"><img v-if="v.favicon" :src="v.favicon" alt="" class="br-img fav" /><span v-else class="br-none">Default icon</span><label class="btn sm" :class="{ off: up.favicon }">{{ up.favicon ? 'Uploading...' : v.favicon ? 'Change' : 'Upload' }}<input type="file" accept="image/*" hidden @change="pick('favicon', $event)" /></label><button type="button" class="btn sm" @click="openLib('favicon')">Choose from library</button><button v-if="v.favicon" type="button" class="menu-reset" @click="v.favicon = ''">Use the default</button></div><span class="small muted">The small icon in the browser tab. Square, at least 64 px.</span></div>
				</div>
				<h3 class="sub">Login page</h3>
				<div class="br-grid">
					<div class="br-f"><label>Picture on the login page</label><div class="br-up"><img v-if="v.splash" :src="v.splash" alt="" class="br-img" /><span v-else class="br-none">Default</span><label class="btn sm" :class="{ off: up.splash }">{{ up.splash ? 'Uploading...' : v.splash ? 'Change' : 'Upload' }}<input type="file" accept="image/*" hidden @change="pick('splash', $event)" /></label><button type="button" class="btn sm" @click="openLib('splash')">Choose from library</button><button v-if="v.splash" type="button" class="menu-reset" @click="v.splash = ''">Use the default</button></div></div>
					<div class="br-f"><label class="check"><input type="checkbox" :checked="!!v.footer_on_login" @change="v.footer_on_login = $event.target.checked ? 1 : 0" /><span>Show the footer on the login page</span></label><label class="check"><input type="checkbox" :checked="!!v.hide_signup" @change="v.hide_signup = $event.target.checked ? 1 : 0" /><span>Hide the sign-up link in the footer</span></label></div>
				</div>
				<h3 class="sub">Footer</h3>
				<div class="br-grid">
					<div class="br-f"><label>Copyright line</label><input class="inp wide" type="text" v-model="v.copyright" maxlength="140" placeholder="e.g. Acme Learning" /></div>
					<div class="br-f"><label>"Powered by" text</label><textarea class="inp wide area" rows="2" v-model="v.powered" maxlength="500" placeholder="Leave empty for the default"></textarea></div>
					<div class="br-f"><label>Company address</label><textarea class="inp wide area" rows="2" v-model="v.address" maxlength="500"></textarea></div>
				</div>
				<h3 class="sub keep">Preview</h3>
				<div class="br-prev">
					<div class="br-card"><div class="br-side"><img v-if="v.logo" :src="v.logo" alt="" class="br-pl" /><span v-else class="br-pl dflt"></span><b>{{ v.name || 'Frappe CRM' }}</b></div><div class="small muted">CRM menu</div></div>
					<div class="br-card login"><img v-if="v.logo" :src="v.logo" alt="" class="br-pl big" /><span v-else class="br-pl big dflt"></span><b>Login to {{ v.name || 'Frappe CRM' }}</b><div class="br-fake"></div><div class="br-fake"></div><div class="small muted">{{ v.copyright || '' }}</div></div>
				</div>
				<div v-if="lib.open" class="br-ov" @mousedown.self="lib.open = false"><div class="br-lib" role="dialog" aria-label="Choose an image"><div class="row" style="gap:10px"><b class="grow">Choose an image from the library</b><button type="button" class="btn sm" @click="lib.open = false">Close</button></div>
					<input class="inp wide" type="text" v-model="lib.q" placeholder="Search by file name" aria-label="Search images" />
					<div v-if="lib.busy" class="muted small">Loading...</div><div v-else-if="!lib.rows.length" class="muted small">No images found. Upload one instead.</div>
					<div class="br-libg"><button v-for="r in lib.rows" :key="r.name" type="button" class="br-tile" :title="r.file_name" @click="useLib(r)"><img :src="r.file_url" alt="" /><span class="ell">{{ r.file_name }}</span></button></div></div></div>
				<div class="card pad vd-save"><button type="button" class="btn primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving...' : 'Save branding' }}</button><button type="button" class="btn" :disabled="saving" @click="reset">Reset to the default look</button><div v-if="msg" class="small">{{ msg }}</div></div>
			</template>
		</div>`,
	}

	const ViewDefaults = {
		components: { Ico, Sel },
		setup() {
			const pages = ref([]); const loading = ref(true); const error = ref(''); const cfg = reactive({}); const saving = ref(false); const msg = ref(''); const overwrite = ref(false)
			const OPS = [['=', 'is'], ['!=', 'is not'], ['like', 'contains'], ['in', 'is any of'], ['is', 'is set / not set']]
			onMounted(async () => {
				try {
					const r = await call('crm_addons.views.get_view_config', {}); pages.value = r.pages
					r.pages.forEach((p) => { const c = JSON.parse(JSON.stringify(p.config || {})); c.columns = c.columns || []; c.filters = c.filters || []; c.kanban = c.kanban || { card_fields: [] }; c.default_view = c.default_view || 'list'; c.order_by = c.order_by || ''; c.quick_filters = c.quick_filters || p.current_quick_filters.slice(); c._qf = 'quick_filters' in (p.config || {}); cfg[p.doctype] = c })
				} catch (e) { error.value = e.message } finally { loading.value = false }
			})
			const label = (p, f) => (p.fields.find((x) => x.fieldname === f) || {}).label || f
			const add = (list, f) => { if (f && !list.includes(f)) list.push(f) }
			const drop = (list, f) => { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1) }
			const move = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; list.splice(j, 0, list.splice(i, 1)[0]) }
			const groupable = (p) => p.fields.filter((f) => ['Select', 'Link'].includes(f.fieldtype))
			// option lists for the dropdowns; a field already chosen is greyed in the "add" lists
			const fieldOpts = (p, taken) => p.fields.map((f) => ({ value: f.fieldname, label: f.label, sub: f.fieldname, disabled: !!(taken && taken.includes(f.fieldname)) }))
			const sortField = (c) => (c.order_by || '').split(' ')[0]
			const sortDir = (c) => (c.order_by || '').split(' ')[1] || 'desc'
			const setSortField = (c, f) => { c.order_by = f ? f + ' ' + sortDir(c) : '' }
			const setSortDir = (c, d) => { if (c.order_by) c.order_by = sortField(c) + ' ' + d }
			const drag = makeDrag((list, f, t) => arrayMove(list, f, t))
			function body() {
				const out = {}
				pages.value.forEach((p) => {
					const c = cfg[p.doctype]
					const o = { default_view: c.default_view, columns: c.columns, order_by: c.order_by, filters: c.filters.filter((f) => f[0] && (f[1] === 'is' || String(f[2]).trim() !== '')).map((f) => [f[0], f[1], f[1] === 'like' ? '%' + String(f[2]).replace(/%/g, '') + '%' : f[2]]) }
					if (c._qf || JSON.stringify(c.quick_filters) !== JSON.stringify(p.current_quick_filters)) o.quick_filters = c.quick_filters
					if (p.kanban) o.kanban = { column_field: c.kanban.column_field, title_field: c.kanban.title_field, card_fields: c.kanban.card_fields }
					out[p.doctype] = o
				})
				return out
			}
			async function save() {
				saving.value = true; msg.value = ''
				try { const r = await call('crm_addons.views.save_view_config', { config: JSON.stringify(body()), apply: 1, overwrite: overwrite.value ? 1 : 0 }); msg.value = 'Saved. ' + r.people + ' people checked, ' + r.written + ' views written. People who changed their own view keep it' + (overwrite.value ? ' (not this time: yours replaced them)' : '') + '.' } catch (e) { msg.value = e.message } finally { saving.value = false }
			}
			return { pages, loading, error, cfg, saving, msg, overwrite, OPS, label, add, drop, move, groupable, save, fieldOpts, sortField, sortDir, setSortField, setSortDir, drag, opOpts: OPS.map((o) => ({ value: o[0], label: o[1] })), setNotSet: [{ value: 'set', label: 'set' }, { value: 'not set', label: 'not set' }] }
		},
		template: `
		<div class="vd">
			<div v-if="loading" class="muted">Loading</div><div v-else-if="error" class="note-box bad">{{ error }}</div>
			<template v-else>
				<article v-for="p in pages" :key="p.doctype" class="card pad vd-card">
					<h3>{{ p.label }}</h3>
					<div class="vd-r"><label>Opens as</label><div class="rolechips"><button type="button" class="rolechip" :class="{ on: cfg[p.doctype].default_view === 'list' }" @click="cfg[p.doctype].default_view = 'list'">List</button><button v-if="p.kanban" type="button" class="rolechip" :class="{ on: cfg[p.doctype].default_view === 'kanban' }" @click="cfg[p.doctype].default_view = 'kanban'">Kanban</button></div></div>
					<div class="vd-r"><label>List columns<span class="muted small"> drag to reorder</span></label><div class="vd-col">
						<div v-for="(f, i) in cfg[p.doctype].columns" :key="f" class="menurow dnd" :class="{ dragging: drag.s.from === i && drag.s.ctx === cfg[p.doctype].columns, over: drag.s.over === i && drag.s.from !== i && drag.s.ctx === cfg[p.doctype].columns }" draggable="true" @dragstart="drag.start(cfg[p.doctype].columns, i, $event)" @dragenter.prevent="drag.enter(cfg[p.doctype].columns, i)" @dragover.prevent @drop.prevent="drag.drop(cfg[p.doctype].columns, i)" @dragend="drag.end()"><span class="grip" aria-hidden="true">&#8942;&#8942;</span><span class="menu-n">{{ i + 1 }}</span><span class="menu-l">{{ label(p, f) }}</span><button type="button" class="menu-b" :disabled="!i" :aria-label="'Move ' + label(p, f) + ' up'" @click="move(cfg[p.doctype].columns, i, -1)">&uarr;</button><button type="button" class="menu-b" :disabled="i === cfg[p.doctype].columns.length - 1" :aria-label="'Move ' + label(p, f) + ' down'" @click="move(cfg[p.doctype].columns, i, 1)">&darr;</button><button type="button" class="menu-b" :aria-label="'Remove ' + label(p, f)" @click="drop(cfg[p.doctype].columns, f)">&times;</button></div>
						<div v-if="!cfg[p.doctype].columns.length" class="muted small">CRM's own columns</div>
						<div class="row wrap" style="gap:8px"><Sel action placeholder="Add a column..." :options="fieldOpts(p, cfg[p.doctype].columns)" @update:model-value="(v) => add(cfg[p.doctype].columns, v)" /><button type="button" class="menu-reset" @click="cfg[p.doctype].columns = p.current_columns.slice()">Start from CRM's columns</button><button v-if="cfg[p.doctype].columns.length" type="button" class="menu-reset" @click="cfg[p.doctype].columns = []">Use CRM's own</button></div></div></div>
					<div class="vd-r"><label>Sort by</label><div class="row wrap" style="gap:8px"><Sel :model-value="sortField(cfg[p.doctype])" :options="[{ value: '', label: 'CRM default (last modified)' }, ...fieldOpts(p)]" placeholder="CRM default (last modified)" @update:model-value="(v) => setSortField(cfg[p.doctype], v)" /><div class="rolechips"><button type="button" class="rolechip" :class="{ on: sortDir(cfg[p.doctype]) === 'desc' }" :disabled="!cfg[p.doctype].order_by" @click="setSortDir(cfg[p.doctype], 'desc')">Newest / biggest first</button><button type="button" class="rolechip" :class="{ on: sortDir(cfg[p.doctype]) === 'asc' }" :disabled="!cfg[p.doctype].order_by" @click="setSortDir(cfg[p.doctype], 'asc')">Oldest / smallest first</button></div></div></div>
					<div class="vd-r"><label>Default filters</label><div class="vd-col">
						<div v-for="(f, i) in cfg[p.doctype].filters" :key="i" class="countrow"><Sel v-model="f[0]" :options="fieldOpts(p)" placeholder="Field" /><Sel small v-model="f[1]" :options="opOpts" placeholder="is" /><Sel v-if="f[1] === 'is'" v-model="f[2]" :options="setNotSet" placeholder="set / not set" /><input v-else class="inp" v-model="f[2]" placeholder="Value (comma-separated for any of)" /><button type="button" class="menu-b" aria-label="Remove this filter" @click="cfg[p.doctype].filters.splice(i, 1)">&times;</button></div>
						<button type="button" class="btn" @click="cfg[p.doctype].filters.push(['', '=', ''])">Add a filter</button></div></div>
					<div class="vd-r"><label>Quick filters<span class="muted small"> the boxes above the list</span></label><div class="vd-col"><div class="rolechips"><span v-for="f in cfg[p.doctype].quick_filters" :key="f" class="rolechip on">{{ label(p, f) }}<button type="button" class="chip-x" :aria-label="'Remove ' + label(p, f)" @click="drop(cfg[p.doctype].quick_filters, f)">&times;</button></span><span v-if="!cfg[p.doctype].quick_filters.length" class="muted small">CRM's own</span></div>
						<Sel action placeholder="Add a quick filter..." :options="fieldOpts(p, cfg[p.doctype].quick_filters)" @update:model-value="(v) => { add(cfg[p.doctype].quick_filters, v); cfg[p.doctype]._qf = true }" /></div></div>
					<template v-if="p.kanban"><h4>Kanban</h4>
						<div class="vd-r"><label>Columns follow</label><Sel v-model="cfg[p.doctype].kanban.column_field" :options="[{ value: '', label: 'Status (CRM default)' }, ...fieldOpts({ fields: groupable(p) })]" placeholder="Status (CRM default)" /></div>
						<div class="vd-r"><label>Card title</label><Sel v-model="cfg[p.doctype].kanban.title_field" :options="[{ value: '', label: 'Lead name (CRM default)' }, ...fieldOpts(p)]" placeholder="Lead name (CRM default)" /></div>
						<div class="vd-r"><label>Card fields</label><div class="vd-col"><div class="rolechips"><span v-for="f in cfg[p.doctype].kanban.card_fields" :key="f" class="rolechip on">{{ label(p, f) }}<button type="button" class="chip-x" :aria-label="'Remove ' + label(p, f)" @click="drop(cfg[p.doctype].kanban.card_fields, f)">&times;</button></span><span v-if="!cfg[p.doctype].kanban.card_fields.length" class="muted small">CRM's own</span></div>
							<Sel action placeholder="Add a field to the cards..." :options="fieldOpts(p, cfg[p.doctype].kanban.card_fields)" @update:model-value="(v) => add(cfg[p.doctype].kanban.card_fields, v)" /></div></div></template>
				</article>
				<div class="card pad vd-save"><label class="check"><input type="checkbox" v-model="overwrite" /><span>Also replace the views people have changed themselves</span></label><button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save and apply to everyone' }}</button><div v-if="msg" class="small" role="status">{{ msg }}</div></div>
			</template>
		</div>`,
	}

	// ------------------------------------------------------------------ the app
	const App = {
		components: { Ico, Info, Toggle, ViewDefaults, Branding, Sel },
		setup() {
			const loading = ref(true); const error = ref(''); const denied = ref(false)
			const server = ref({}) // values as saved
			const draft = reactive({}) // values being edited
			const choices = ref({}); const status = ref({ checks: [], todo: 0, ready: 0, total: 0 })
			const tab = ref(params.get('tab') || 'start'); const q = ref('')
			window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.source === 'pro-shell' && e.data.tab) { q.value = ''; tab.value = e.data.tab; if (e.data.field) nextTick(() => nextTick(() => { if (itemMap[e.data.field]) go(itemMap[e.data.field].group, e.data.field) })) } }) // the Suite Pro app picks the section from its own tabs
			const saving = ref(false); const toast = reactive({ text: '', tone: '' })
			const open = reactive({}); const test = reactive({ busy: false, text: '', ok: false }); const rechecking = ref(false)
			const itemMap = {}; SCHEMA.forEach((g) => g.items.forEach((it) => { if (it.k) { itemMap[it.k] = it; it.group = g.key } }))

			const norm = (it, v) => (it && it.t === 'switch' ? (v ? 1 : 0) : it && (it.t === 'num') ? (v === '' || v == null ? 0 : Number(v)) : it && it.t === 'money' ? (v === '' || v == null ? '' : Number(v)) : v == null ? '' : v)
			const rolesOfDraft = (k) => String(draft[k] || '').split(',').map((r) => r.trim()).filter(Boolean)
			const hasRole = (k, role) => rolesOfDraft(k).includes(role)
			// the left menu: CRM's own entries and this app's, in the order saved (anything not saved yet goes at the end)
			const MENU_ALL = [['notifications', 'Notifications'], ['dashboard', 'Dashboard'], ['leads', 'Leads'], ['deals', 'Deals'], ['contacts', 'Contacts'], ['organizations', 'Organizations'], ['notes', 'Notes'], ['tasks', 'Tasks'], ['call-logs', 'Call Logs'], ['sales-dashboard', 'Sales Dashboard'], ['followups', 'Follow-ups'], ['meetings', 'Meetings'], ['campaigns', 'Campaigns'], ['assignment', 'Assignment'], ['demos', 'Bookings']]
			const MENU_OURS = ['sales-dashboard', 'followups', 'meetings', 'campaigns', 'assignment', 'demos']
			function menuItems(k) {
				let saved = []; try { saved = JSON.parse(draft[k] || '[]') } catch (e) { saved = [] }
				const known = saved.filter((x) => MENU_ALL.some((m) => m[0] === x.key))
				const have = new Set(known.map((x) => x.key))
				return [...known, ...MENU_ALL.filter((m) => !have.has(m[0])).map((m) => ({ key: m[0], hidden: 0 }))].map((x) => ({ key: x.key, hidden: x.hidden ? 1 : 0, label: (MENU_ALL.find((m) => m[0] === x.key) || [])[1], ours: MENU_OURS.includes(x.key) }))
			}
			const setMenu = (k, list) => { draft[k] = JSON.stringify(list.map((x) => ({ key: x.key, hidden: x.hidden ? 1 : 0 }))) }
			function moveMenu(k, i, d) { const l = menuItems(k); const j = i + d; if (j < 0 || j >= l.length) return; ;[l[i], l[j]] = [l[j], l[i]]; setMenu(k, l) }
			function toggleMenu(k, i) { const l = menuItems(k); l[i].hidden = l[i].hidden ? 0 : 1; setMenu(k, l) }
			const resetMenu = (k) => { draft[k] = '' }
			const menuDrag = makeDrag((k, f, t) => { const l = menuItems(k); arrayMove(l, f, t); setMenu(k, l) })
			// "count leads by these fields" and "highlighted counts": JSON lists in the draft
			// WhatsApp templates (with Meta's status) for the missed-call message
			const waInfo = (name) => (choices.value.whatsapp_templates || []).find((t) => t.value === name)
			const waStateText = (s) => ({ APPROVED: 'Approved by Meta', PENDING: 'Waiting for Meta', REJECTED: 'Rejected by Meta' }[s] || s.toLowerCase())
			const waOptions = (current) => [{ value: '', label: 'No template (send the plain text)' }, ...(choices.value.whatsapp_templates || []).map((t) => ({ value: t.value, label: t.label, sub: t.state === 'APPROVED' ? t.category : waStateText(t.state), disabled: t.state !== 'APPROVED' && t.value !== current }))]
			const meta = reactive({ busy: false, data: null })
			async function loadMeta() { meta.busy = true; try { meta.data = await call('crm_addons.setup_page.get_meta_usage') } catch (e) { say(e.message, 'err') } finally { meta.busy = false } }
			const creatingWa = ref(false)
			async function createMissedTemplate(k) {
				creatingWa.value = true
				try {
					const r = await call('crm_addons.setup_page.create_missed_call_template')
					const g = await call('crm_addons.setup_page.get_setup'); choices.value = g.choices; status.value = g.status
					draft[k] = r.name; say(r.message || 'Submitted to Meta.')
				} catch (e) { say(e.message, 'err') } finally { creatingWa.value = false }
			}
			const selectOptions = (it) => [...(it.empty ? [{ value: '', label: it.empty }] : []), ...optionsOf(it)]
			const leadFieldOptions = (taken) => (choices.value.lead_fields || []).map((o) => ({ value: o.value, label: o.label, sub: o.value, disabled: !!(taken && taken.includes(o.value)) }))
			const COUNT_OPS = [{ value: '=', label: 'is' }, { value: '!=', label: 'is not' }, { value: 'like', label: 'contains' }]
			const jlist = (k) => { try { const v = JSON.parse(draft[k] || '[]'); return Array.isArray(v) ? v : [] } catch (e) { return [] } }
			const setJ = (k, v) => { draft[k] = v.length ? JSON.stringify(v) : '' }
			const fieldLabel = (f) => ((choices.value.lead_fields || []).find((x) => x.value === f) || {}).label || f
			const addField = (k, f) => { if (f && !jlist(k).includes(f)) setJ(k, [...jlist(k), f]) }
			const dropField = (k, f) => setJ(k, jlist(k).filter((x) => x !== f))
			const addCounter = (k) => setJ(k, [...jlist(k), { label: '', field: '', op: '=', value: '' }])
			// the values leads really have in a field, for the "highlighted counts" value list (asked once per field)
			const fieldVals = reactive({}); const asked = new Set()
			async function loadValues(f) { try { fieldVals[f] = (await call('crm_addons.setup_page.field_values', { fieldname: f })) || [] } catch (e) { fieldVals[f] = [] } }
			function valueOpts(c) {
				if (!c.field) return []
				if (!asked.has(c.field)) { asked.add(c.field); loadValues(c.field) }
				return (fieldVals[c.field] || []).map((v) => ({ value: v.value, label: v.value, sub: v.count + ' lead' + (v.count === 1 ? '' : 's') }))
			}
			const setCounter = (k, i, key, val) => { const l = jlist(k); l[i] = { ...l[i], [key]: val }; if (key === 'field') l[i].value = ''; setJ(k, l) }
			const dropCounter = (k, i) => setJ(k, jlist(k).filter((_x, n) => n !== i))
			function toggleRole(k, role) { const cur = rolesOfDraft(k); draft[k] = (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]).join(', ') }
			function load(values) { server.value = values; Object.keys(draft).forEach((k) => delete draft[k]); Object.assign(draft, JSON.parse(JSON.stringify(values))) }
			async function init() {
				loading.value = true; error.value = ''; denied.value = false
				try {
					const r = await call('crm_addons.setup_page.get_setup')
					load(r.values); choices.value = r.choices; status.value = r.status
				} catch (e) { if (e.status === 403) denied.value = true; error.value = e.message } finally { loading.value = false }
			}
			onMounted(() => { init(); document.addEventListener('keydown', onKey); window.addEventListener('beforeunload', warn) })
			onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', warn) })

			// ---- what can be edited right now
			const met = (it) => { if (!it.when) return true; const [k, v] = Array.isArray(it.when) ? it.when : [it.when, undefined]; return v === undefined ? !!draft[k] : draft[k] === v }
			const parentLabel = (it) => { const k = Array.isArray(it.when) ? it.when[0] : it.when; const p = itemMap[k]; return p ? p.label : '' }
			const lockText = (it) => { const k = Array.isArray(it.when) ? it.when[0] : it.when; const p = itemMap[k]; if (!p) return ''; return Array.isArray(it.when) ? `Available when “${p.label}” is ${it.when[1]}.` : `Turn on “${p.label}” to change this.` }
			function problem(it) {
				if (!it.k || it.t === 'switch' || !met(it)) return ''
				const v = draft[it.k]
				if (it.t === 'num') {
					if (v === '' || v == null || Number.isNaN(Number(v))) return 'Enter a number.'
					if (!Number.isInteger(Number(v))) return 'Use a whole number.'
					if (it.min != null && Number(v) < it.min) return `Must be at least ${it.min}.`
					if (it.max != null && Number(v) > it.max) return `Must be at most ${it.max}.`
				}
				if (it.t === 'money' && v !== '' && v != null && (Number.isNaN(Number(v)) || Number(v) < 0)) return 'Enter a price of 0 or more.'
				if (it.k === 'default_country_code' && v && !/^\+?\d{1,4}$/.test(String(v).trim())) return 'Digits only, for example 91.'
				return ''
			}
			const dirtyKeys = computed(() => Object.keys(server.value).filter((k) => itemMap[k] && norm(itemMap[k], draft[k]) !== norm(itemMap[k], server.value[k])))
			const problems = computed(() => dirtyKeys.value.filter((k) => problem(itemMap[k])))
			const optionsOf = (it) => (it.choices ? (choices.value[it.choices] || []) : it.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))

			// ---- sections shown
			const term = computed(() => q.value.trim().toLowerCase())
			const matches = (it) => !term.value || (it.label || '').toLowerCase().includes(term.value) || ((it.info && (it.info.what + ' ' + (it.info.eg || '') + ' ' + (it.info.note || ''))) || '').toLowerCase().includes(term.value)
			const groups = computed(() => SCHEMA.map((g) => {
				const items = g.items.filter((it) => it.h || matches(it))
				const real = items.filter((it) => it.k)
				const kept = items.filter((it, i) => !it.h || (items[i + 1] && !items[i + 1].h)) // drop a heading with nothing under it
				const customHit = !!g.custom && !!term.value && (g.title + ' ' + (g.desc || '') + ' ' + (g.words || '')).toLowerCase().includes(term.value)
				return { ...g, shown: term.value ? kept : g.items, count: real.length + (customHit ? 1 : 0), changed: g.items.filter((it) => it.k && dirtyKeys.value.includes(it.k)).length }
			}))
			const visible = computed(() => (term.value ? groups.value.filter((g) => g.count) : groups.value.filter((g) => g.key === tab.value)))
			const noResults = computed(() => term.value && !visible.value.length)

			// ---- saving
			function say(text, tone) { toast.text = text; toast.tone = tone || ''; clearTimeout(say.t); say.t = setTimeout(() => (toast.text = ''), tone === 'err' ? 9000 : 3500) }
			async function save() {
				if (!dirtyKeys.value.length || saving.value) return
				if (problems.value.length) { const it = itemMap[problems.value[0]]; go(it.group, it.k); return say('Fix the highlighted option first: ' + problem(it), 'err') }
				saving.value = true
				try {
					const changed = {}; dirtyKeys.value.forEach((k) => (changed[k] = norm(itemMap[k], draft[k])))
					const r = await call('crm_addons.setup_page.save_setup', { values: JSON.stringify(changed) })
					load(r.values); status.value = r.status
					say('Saved. Pages that are already open pick up the change when they are refreshed.')
				} catch (e) { say(e.message, 'err') } finally { saving.value = false }
			}
			const discard = () => Object.assign(draft, JSON.parse(JSON.stringify(server.value)))
			const warn = (e) => { if (dirtyKeys.value.length) { e.preventDefault(); e.returnValue = '' } }
			function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }

			// ---- navigation and the checklist
			function go(group, key) { q.value = ''; tab.value = group; nextTick(() => { const el = key && document.getElementById('f-' + key); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); try { el.focus({ preventScroll: true }) } catch (e) { /* fine */ } const row = el.closest('.row-i'); if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1800) } } }) }
			function goToField(c) { if (c.key === 'branding') { q.value = ''; tab.value = 'branding'; return } const key = c.field || (c.key === 'google' ? 'google_calendar' : ''); if (key && itemMap[key]) go(itemMap[key].group, key) }
			async function recheck() { rechecking.value = true; try { const r = await call('crm_addons.setup_page.get_setup'); status.value = r.status; choices.value = r.choices } catch (e) { say(e.message, 'err') } finally { rechecking.value = false } }
			async function testGoogle() {
				test.busy = true; test.text = ''
				try { const r = await call('crm_addons.api.test_google_connection'); test.ok = !!r.ok; test.text = r.message } catch (e) { test.ok = false; test.text = e.message } finally { test.busy = false }
			}
			async function copy(text) { try { await navigator.clipboard.writeText(text); say('Copied') } catch (e) { say('Select the text and copy it.', 'err') } }
			const stateText = { ok: 'Ready', todo: 'Needs setup', optional: 'Optional' }
			const urls = (c) => (c.steps || []).map((s) => { const m = /(https?:\/\/\S+)/.exec(s); return m ? m[1] : '' })
			return { embedded, meta, loadMeta, waInfo, waStateText, waOptions, creatingWa, createMissedTemplate, valueOpts, menuDrag, selectOptions, leadFieldOptions, COUNT_OPS, jlist, fieldLabel, addField, dropField, addCounter, setCounter, dropCounter, menuItems, moveMenu, toggleMenu, resetMenu, hasRole, toggleRole, loading, error, denied, draft, server, choices, status, tab, q, groups, visible, noResults, term, saving, toast, open, test, rechecking, dirtyKeys, problems, problem, met, lockText, optionsOf, init, save, discard, go, goToField, recheck, testGoogle, copy, stateText, urls, SCHEMA, parentLabel, itemMap }
		},
		template: `
		<div class="shell">
			<header class="top">
				<div class="top-in">
					<div class="grow"><h1>Frappe CRM Suite Pro setup</h1><p>Switch features on or off, set how they behave, and see what still needs connecting.</p></div>
					<div class="search"><Ico name="search" :size="16" /><input v-model="q" type="search" placeholder="Find an option" aria-label="Find an option" /></div>
					<a v-if="!embedded" class="btn" href="/crm"><Ico name="home" :size="16" /> Back to CRM</a>
				</div>
			</header>

			<div v-if="loading" class="body"><div class="skel" v-for="n in 5" :key="n"></div></div>
			<div v-else-if="error" class="body"><div class="card pad center"><Ico name="lock" :size="28" /><h2>{{ denied ? 'Only a System Manager can open this page' : 'The page could not load' }}</h2><p class="muted">{{ error }}</p><button v-if="!denied" class="btn primary" type="button" @click="init">Try again</button></div></div>

			<div v-else class="body">
				<nav class="side" aria-label="Sections">
					<button type="button" class="tabb" :class="{ on: tab === 'start' && !term }" @click="q = ''; tab = 'start'"><Ico name="list" :size="17" /><span>Setup checklist</span><span v-if="status.todo" class="pill warn">{{ status.todo }}</span><Ico v-else name="check" :size="15" class="okc" /></button>
					<div class="side-h">Options</div>
					<button v-for="g in groups" :key="g.key" type="button" class="tabb" :class="{ on: tab === g.key && !term }" @click="q = ''; tab = g.key"><Ico :name="g.icon" :size="17" /><span>{{ g.title }}</span><span v-if="g.changed" class="dot" title="Unsaved changes"></span></button>
				</nav>

				<main class="main">
					<!-- checklist -->
					<section v-if="tab === 'start' && !term" class="stack">
						<div class="card pad">
							<div class="row"><div class="grow"><h2>Setup checklist</h2><p class="muted">{{ status.todo ? status.todo + (status.todo > 1 ? ' things need' : ' thing needs') + ' your attention. Open one to see how to set it up.' : 'Everything this app needs is set up.' }}</p></div><button class="btn" type="button" :disabled="rechecking" @click="recheck"><Ico name="refresh" :size="16" /> {{ rechecking ? 'Checking...' : 'Check again' }}</button></div>
							<div class="prog" role="progressbar" :aria-valuenow="status.ready" aria-valuemin="0" :aria-valuemax="status.total"><i :style="{ width: (status.total ? 100 * status.ready / status.total : 0) + '%' }"></i></div>
							<div class="small muted">{{ status.ready }} of {{ status.total }} ready</div>
						</div>
						<article v-for="c in status.checks" :key="c.key" class="card chk" :class="c.state">
							<div class="chk-h" @click="open[c.key] = !open[c.key]" role="button" tabindex="0" :aria-expanded="!!open[c.key]" @keydown.enter="open[c.key] = !open[c.key]">
								<span class="chk-i"><Ico :name="c.state === 'ok' ? 'check' : c.state === 'todo' ? 'alert' : 'list'" :size="17" /></span>
								<div class="grow"><b>{{ c.label }}</b><div class="small muted">{{ c.message }}</div></div>
								<span class="pill" :class="c.state">{{ stateText[c.state] }}</span><Ico name="chevron" :size="16" class="chev" :class="{ down: open[c.key] }" />
							</div>
							<div v-if="open[c.key]" class="chk-b">
								<p v-if="c.why" class="small"><b>Why it matters.</b> {{ c.why }}</p>
								<template v-if="c.state !== 'ok' && c.steps && c.steps.length"><b class="small">How to set it up</b><ol class="steps"><li v-for="(s, i) in c.steps" :key="i">{{ s }}</li></ol></template>
								<div class="row wrap" style="gap:8px">
									<a v-if="c.fix" class="btn primary" :href="c.fix.url" target="_blank" rel="noopener">{{ c.fix.label }} <Ico name="external" :size="14" /></a>
									<button v-if="c.field || c.key === 'google' || c.key === 'branding'" class="btn" type="button" @click="goToField(c)">{{ c.key === 'google' ? 'Choose the calendar' : c.key === 'branding' ? 'Open Branding' : 'Go to the setting' }}</button>
									<button v-if="c.key === 'google'" class="btn" type="button" :disabled="test.busy" @click="testGoogle">{{ test.busy ? 'Testing...' : 'Test the connection' }}</button>
								</div>
								<div v-if="c.key === 'google' && test.text" class="note-box" :class="test.ok ? 'ok' : 'bad'">{{ test.text }}</div>
							</div>
						</article>
					</section>

					<!-- options -->
					<section v-for="g in visible" :key="g.key" class="stack">
						<div class="card pad">
							<div class="row g-head"><span class="g-i"><Ico :name="g.icon" :size="19" /></span><div class="grow"><h2>{{ g.title }}</h2><p class="muted">{{ g.desc }}</p></div></div>
							<ViewDefaults v-if="g.custom === 'views'" /><Branding v-if="g.custom === 'branding'" />
							<template v-for="(it, i) in g.shown" :key="(it.k || it.h) + i">
								<h3 v-if="it.h" class="sub">{{ it.h }}</h3>
								<div v-else class="row-i" :class="{ locked: !met(it), child: it.when, bad: problem(it), wide: ['menu', 'fieldlist', 'counters', 'area', 'watemplate', 'metausage'].includes(it.t) }">
									<div class="row-l">
										<div class="lab"><label :for="'f-' + it.k">{{ it.label }}</label><Info :info="it.info" :label="it.label" /></div>
										<div v-if="!met(it)" class="hint"><Ico name="lock" :size="12" /> {{ lockText(it) }}</div>
										<div v-else-if="problem(it)" class="err">{{ problem(it) }}</div>
									</div>
									<div class="row-c">
										<Toggle v-if="it.t === 'switch'" :id="'f-' + it.k" v-model="draft[it.k]" :label="it.label" :disabled="!met(it)" />
										<template v-else-if="it.t === 'num'"><input :id="'f-' + it.k" class="inp num" type="number" inputmode="numeric" :min="it.min" :max="it.max" step="1" v-model="draft[it.k]" :disabled="!met(it)" /><span class="unit">{{ it.unit }}</span></template>
										<template v-else-if="it.t === 'money'"><input :id="'f-' + it.k" class="inp num" type="number" inputmode="decimal" min="0" step="any" :placeholder="it.placeholder" v-model="draft[it.k]" :disabled="!met(it)" /></template>
										<Sel v-else-if="it.t === 'select'" :id="'f-' + it.k" :model-value="draft[it.k]" :options="selectOptions(it)" :placeholder="it.empty || 'Select'" :disabled="!met(it)" :aria-label="it.label" @update:model-value="(v) => (draft[it.k] = v)" />
										<div v-else-if="it.t === 'roles'" class="rolechips" role="group" :aria-label="it.label"><button v-for="o in optionsOf(it)" :key="o.value" type="button" class="rolechip" :class="{ on: hasRole(it.k, o.value) }" :aria-pressed="hasRole(it.k, o.value)" :disabled="!met(it)" @click="toggleRole(it.k, o.value)"><Ico v-if="hasRole(it.k, o.value)" name="check" :size="13" />{{ o.label }}</button></div>
										<div v-else-if="it.t === 'menu'" class="menuedit">
											<div v-for="(m, i) in menuItems(it.k)" :key="m.key" class="menurow dnd" :class="{ off: m.hidden, dragging: menuDrag.s.from === i && menuDrag.s.ctx === it.k, over: menuDrag.s.over === i && menuDrag.s.from !== i && menuDrag.s.ctx === it.k }" draggable="true" @dragstart="menuDrag.start(it.k, i, $event)" @dragenter.prevent="menuDrag.enter(it.k, i)" @dragover.prevent @drop.prevent="menuDrag.drop(it.k, i)" @dragend="menuDrag.end()"><span class="grip" aria-hidden="true">&#8942;&#8942;</span><span class="menu-n">{{ i + 1 }}</span><span class="menu-l">{{ m.label }}<em v-if="m.ours">Suite Pro</em></span>
												<button type="button" class="menu-b" :disabled="i === 0" :aria-label="'Move ' + m.label + ' up'" @click="moveMenu(it.k, i, -1)">&uarr;</button><button type="button" class="menu-b" :disabled="i === menuItems(it.k).length - 1" :aria-label="'Move ' + m.label + ' down'" @click="moveMenu(it.k, i, 1)">&darr;</button>
												<Toggle :model-value="!m.hidden" :label="'Show ' + m.label" @update:model-value="toggleMenu(it.k, i)" /></div>
											<button type="button" class="menu-reset" @click="resetMenu(it.k)">Back to CRM's own order</button></div>
										<div v-else-if="it.t === 'fieldlist'" class="fieldlist">
											<div class="rolechips"><span v-for="f in jlist(it.k)" :key="f" class="rolechip on">{{ fieldLabel(f) }}<button type="button" class="chip-x" :aria-label="'Remove ' + fieldLabel(f)" @click="dropField(it.k, f)">&times;</button></span><span v-if="!jlist(it.k).length" class="muted small">Automatic</span></div>
											<Sel action placeholder="Add a field..." :options="leadFieldOptions(jlist(it.k))" @update:model-value="(v) => addField(it.k, v)" /></div>
										<div v-else-if="it.t === 'counters'" class="countedit">
											<div v-for="(c, i) in jlist(it.k)" :key="i" class="countrow"><input class="inp" placeholder="Name, e.g. Schools" :value="c.label" @input="setCounter(it.k, i, 'label', $event.target.value)" />
												<Sel :model-value="c.field" :options="leadFieldOptions()" placeholder="Field" @update:model-value="(v) => setCounter(it.k, i, 'field', v)" />
												<Sel small :model-value="c.op || '='" :options="COUNT_OPS" placeholder="is" @update:model-value="(v) => setCounter(it.k, i, 'op', v)" />
												<Sel v-if="c.op !== 'like' && valueOpts(c).length" searchable :model-value="c.value" :options="valueOpts(c)" placeholder="Pick a value" @update:model-value="(v) => setCounter(it.k, i, 'value', v)" /><input v-else class="inp" placeholder="Value, e.g. School" :value="c.value" @input="setCounter(it.k, i, 'value', $event.target.value)" /><button type="button" class="menu-b" aria-label="Remove" @click="dropCounter(it.k, i)">&times;</button></div>
											<button type="button" class="btn" @click="addCounter(it.k)">Add a count</button></div>
										<div v-else-if="it.t === 'metausage'" class="metabox">
											<button type="button" class="btn" :disabled="meta.busy" @click="loadMeta">{{ meta.busy ? 'Asking Meta...' : meta.data ? 'Refresh' : 'Check with Meta' }}</button>
											<template v-if="meta.data">
												<div v-if="!meta.data.available" class="small err">{{ meta.data.reason }}</div>
												<template v-else>
													<dl class="metadl"><dt>Daily limit</dt><dd>{{ meta.data.limit_text || 'not available' }}</dd><dt>Quality rating</dt><dd>{{ meta.data.quality || 'not available' }}</dd>
														<template v-if="meta.data.charges"><dt>Last {{ meta.data.charges.days }} days</dt><dd><span v-for="(v, k) in meta.data.charges.by_category" :key="k" class="metarow">{{ k.toLowerCase() }}: {{ v.messages }} messages, {{ v.cost.toFixed(2) }} {{ meta.data.charges.currency }}</span><span v-if="!Object.keys(meta.data.charges.by_category).length">nothing charged</span></dd></template>
														<template v-else><dt>Charges</dt><dd>not available</dd></template></dl>
													<div v-for="n in meta.data.notes" :key="n" class="small muted">{{ n }}</div>
												</template>
											</template></div>
										<div v-else-if="it.t === 'watemplate'" class="watpl">
											<Sel :id="'f-' + it.k" :model-value="draft[it.k]" :options="waOptions(draft[it.k])" placeholder="No template (send the plain text)" searchable :aria-label="it.label" @update:model-value="(v) => (draft[it.k] = v)" />
											<div v-if="waInfo(draft[it.k])" class="wa-card"><div class="row" style="gap:8px"><span class="pill" :class="waInfo(draft[it.k]).state === 'APPROVED' ? 'ok' : waInfo(draft[it.k]).state === 'REJECTED' ? 'todo' : 'warn'">{{ waStateText(waInfo(draft[it.k]).state) }}</span><span class="small muted">{{ waInfo(draft[it.k]).category }}</span></div><div class="wa-body">{{ waInfo(draft[it.k]).body }}</div>
												<div v-if="waInfo(draft[it.k]).state !== 'APPROVED'" class="small err">Not sent until Meta approves it. Check its status in Campaign Manager, WhatsApp templates (Sync from Meta).</div></div>
											<div v-else-if="draft[it.k]" class="small err">This template no longer exists. Choose another.</div>
											<div class="row wrap" style="gap:8px"><button type="button" class="btn" :disabled="creatingWa" @click="createMissedTemplate(it.k)">{{ creatingWa ? 'Sending to Meta...' : 'Create the ready-made template' }}</button><span class="small muted">Submits &ldquo;Hi (name), we just tried to call you...&rdquo; to Meta for review.</span></div></div>
										<textarea v-else-if="it.t === 'area'" :id="'f-' + it.k" class="inp area" rows="3" v-model="draft[it.k]" :disabled="!met(it)"></textarea>
										<input v-else :id="'f-' + it.k" class="inp" type="text" :placeholder="it.placeholder" v-model="draft[it.k]" :disabled="!met(it)" autocomplete="off" />
									</div>
								</div>
							</template>
						</div>
					</section>
					<div v-if="noResults" class="card pad center"><Ico name="search" :size="26" /><h2>No option matches “{{ q }}”</h2><p class="muted">Try another word, for example “reminder”, “WhatsApp” or “hide”.</p></div>
				</main>
			</div>

			<div v-if="!loading && !error && dirtyKeys.length" class="savebar" role="region" aria-label="Unsaved changes">
				<div class="savebar-in"><span><b>{{ dirtyKeys.length }}</b> unsaved change{{ dirtyKeys.length > 1 ? 's' : '' }}<span v-if="problems.length" class="errtxt"> - {{ problems.length }} need{{ problems.length > 1 ? '' : 's' }} fixing</span></span><span class="grow"></span><button class="btn" type="button" :disabled="saving" @click="discard">Discard</button><button class="btn primary" type="button" :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save changes' }}</button></div>
			</div>
			<div v-if="toast.text" class="toast" :class="toast.tone" role="status">{{ toast.text }}</div>
		</div>`,
	}
	createApp(App).mount('#app')
	document.title = 'Suite Pro Setup'
})()
