/* Suite Pro: Leads. Our own list (table or board), filters, saved views, bulk actions. Every row opens the lead page (#/leads/<name>). */
(() => {
	const { ref, reactive, computed, onMounted, watch, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views

	const TONE = { gray: 'neutral', orange: 'amber', blue: 'blue', green: 'green', teal: 'green', red: 'red', purple: 'purple', yellow: 'amber', pink: 'purple', cyan: 'blue' }
	PRO.statusTone = (color) => TONE[color] || 'neutral'
	PRO.statusColors = {} // status -> tone, filled by the list so other pages can use it

	/** A status as a small coloured tag. */
	V.StatusTag = {
		props: { status: String },
		setup: () => ({ PRO }),
		template: `<span class="badge" :class="PRO.statusTone(PRO.statusColors[status])">{{ status || 'No status' }}</span>`,
	}

	/** A pick-many dropdown: a button that shows how many are chosen, a searchable checklist inside. */
	V.MultiPick = {
		props: { modelValue: { type: Array, default: () => [] }, options: { type: Array, default: () => [] }, label: String, searchable: Boolean },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const trig = ref(null); const q = ref('')
			const p = CM.usePop(() => trig.value, { width: 240 })
			const norm = computed(() => props.options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })))
			const shown = computed(() => { const t = q.value.trim().toLowerCase(); return t ? norm.value.filter((o) => o.label.toLowerCase().includes(t)) : norm.value })
			const has = (v) => props.modelValue.includes(v)
			const flip = (v) => emit('update:modelValue', has(v) ? props.modelValue.filter((x) => x !== v) : [...props.modelValue, v])
			const text = computed(() => {
				const n = props.modelValue.length; if (!n) return props.label
				if (n === 1) { const o = norm.value.find((x) => x.value === props.modelValue[0]); return props.label + ': ' + (o ? o.label : props.modelValue[0]) }
				return props.label + ': ' + n
			})
			function toggle() { if (!p.open.value) q.value = ''; p.toggle() }
			return { ...p, trig, q, shown, has, flip, text, toggle, emit }
		},
		template: `
		<div class="dd">
			<button ref="trig" type="button" class="dd-btn sm" :class="{ open }" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
				<span class="lab" :class="{ ph: !modelValue.length }">{{ text }}</span><Ico name="chevron-down" size="sm" class="chev" />
			</button>
			<Teleport to="body">
				<div v-if="open" ref="pop" class="pop" :style="style" role="listbox" aria-multiselectable="true">
					<div v-if="searchable || options.length > 8" class="pop-search"><input class="inp" style="height:32px" v-model="q" placeholder="Search" :aria-label="'Search ' + label" /></div>
					<div class="pop-list">
						<button v-for="o in shown" :key="o.value" type="button" class="opt" :class="{ on: has(o.value) }" role="option" :aria-selected="has(o.value)" @click="flip(o.value)">
							<span class="mp-box" :class="{ on: has(o.value) }"><Ico v-if="has(o.value)" name="check" size="sm" /></span>
							<span class="grow ellipsis">{{ o.label }}</span>
						</button>
						<div v-if="!shown.length" class="pop-empty">Nothing found</div>
					</div>
					<div v-if="modelValue.length" class="pop-foot"><button type="button" class="btn ghost sm" @click="emit('update:modelValue', [])">Clear</button></div>
				</div>
			</Teleport>
		</div>`,
	}

	const COLS = [
		{ id: 'lead_name', label: 'Name', sort: 'lead_name' },
		{ id: 'organization', label: 'Organization', sort: 'organization' },
		{ id: 'mobile_no', label: 'Phone' },
		{ id: 'email', label: 'Email' },
		{ id: 'status', label: 'Status', sort: 'status' },
		{ id: 'addons_score', label: 'Score', sort: 'addons_score' },
		{ id: 'source', label: 'Source', sort: 'source' },
		{ id: 'territory', label: 'Territory' },
		{ id: 'lead_owner', label: 'Owner', sort: 'lead_owner' },
		{ id: 'next_follow_up_on', label: 'Next follow-up', sort: 'next_follow_up_on' },
		{ id: 'creation', label: 'Added', sort: 'creation' },
	]
	const DEFAULT_COLS = ['lead_name', 'mobile_no', 'organization', 'status', 'source', 'lead_owner', 'next_follow_up_on', 'creation']
	const SORT_OPTS = [{ value: 'creation', label: 'Added date' }, { value: 'modified', label: 'Last changed' }, { value: 'lead_name', label: 'Name' }, { value: 'status', label: 'Status' }, { value: 'next_follow_up_on', label: 'Next follow-up' }, { value: 'addons_score', label: 'Score' }]
	const store = {
		get(k, d) { try { const v = localStorage.getItem('pro_leads_' + k); return v === null ? d : JSON.parse(v) } catch (e) { return d } },
		set(k, v) { try { localStorage.setItem('pro_leads_' + k, JSON.stringify(v)) } catch (e) { /* not remembered */ } },
	}
	const EMPTY = () => ({ status: [], source: [], territory: [], organization: [], lead_owner: [], from: '', to: '', followup: '', has_followup: false, never_called: false, stale: false, has_meeting: false })
	const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
	const DATES = [{ value: '', label: 'Any date' }, { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: 'month', label: 'This month' }, { value: 'custom', label: 'Custom range' }]
	function range(p) {
		const t = new Date(), day = (n) => { const d = new Date(t); d.setDate(d.getDate() - n); return iso(d) }
		if (p === 'today') return [iso(t), iso(t)]
		if (p === 'yesterday') return [day(1), day(1)]
		if (p === '7') return [day(6), iso(t)]
		if (p === '30') return [day(29), iso(t)]
		if (p === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)]
		return ['', '']
	}
	const when = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return ''; const today = d.toDateString() === new Date().toDateString(); return (today ? 'Today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' })) + (String(s).length > 10 ? ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '') }
	const overdue = (s) => !!s && new Date(String(s).replace(' ', 'T')) < new Date()
	const csvDownload = (text, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }

	/** The "new lead" form: the fields of CRM's Quick Entry layout, so a field added in CRM shows up here. */
	V.NewLead = {
		props: { opts: Object },
		emits: ['close', 'created'],
		setup(props, { emit }) {
			const sections = ref([]); const v = reactive({}); const busy = ref(false); const error = ref(''); const loading = ref(true)
			onMounted(async () => {
				try {
					sections.value = await CM.call('crm_addons.pro.form.get_form', { kind: 'create' })
					sections.value.forEach((s) => s.fields.forEach((f) => { v[f.fieldname] = f.default || '' }))
					if ('lead_owner' in v) v.lead_owner = PRO.shell.user
					if ('status' in v && !v.status && props.opts.statuses.length) v.status = props.opts.statuses[0].name
				} catch (e) { error.value = e.message } finally { loading.value = false }
			})
			async function save() {
				const missing = sections.value.flatMap((s) => s.fields).find((f) => f.reqd && !String(v[f.fieldname] ?? '').trim())
				if (missing) { error.value = missing.label + ' is needed.'; return }
				busy.value = true; error.value = ''
				try { const name = await CM.call('crm_addons.pro.leads.create_lead', { values: JSON.stringify(v) }); CM.toast('Lead added'); emit('created', name) } catch (e) { error.value = e.message } finally { busy.value = false }
			}
			return { sections, v, busy, error, save, loading }
		},
		template: `
		<Modal title="New lead" size="lg" @close="$emit('close')" @submit="save">
			<Skel v-if="loading" h="120" />
			<FormFields v-else :sections="sections" :values="v" />
			<div v-if="error" class="err" role="alert" style="margin-top:10px">{{ error }}</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" :loading="busy" :disabled="loading" @click="save">Add lead</Btn></template>
		</Modal>`,
	}

	/** Upload a CSV of leads: check it first (nothing is saved), then add them. */
	/** Upload leads: pick an Excel / CSV file or paste a Google Sheet link, match the sheet's columns to lead fields, check, then add with progress. */
	V.ImportLeads = {
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const call = (m, a) => CM.call('crm_addons.pro.importer.' + m, a)
			const step = ref(1); const source = ref('file'); const url = ref(''); const busy = ref(false); const error = ref('')
			const sheet = reactive({ name: '', headers: [], rows: [], total: 0 })
			const fields = ref([]); const mapping = ref([])
			const run = reactive({ phase: '', done: 0, total: 0, created: 0, failed: [] })   // phase: check | add | checked | added
			const BATCH = 100
			function toBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file) }) }
			async function load(args, name) {
				busy.value = true; error.value = ''
				try {
					const s = await call('read_sheet', args)
					const m = await call('suggest_mapping', { headers: JSON.stringify(s.headers) })
					Object.assign(sheet, { name, headers: s.headers, rows: s.rows, total: s.total }); fields.value = m.fields; mapping.value = m.mapping; step.value = 2
				} catch (e) { error.value = e.message } finally { busy.value = false }
			}
			async function pick(e) {
				const f = e.target.files[0]; e.target.value = ''; if (!f) return
				if (f.size > 8e6) { error.value = 'That file is over 8 MB. Split it into parts.'; return }
				load({ kind: 'file', filename: f.name, content: await toBase64(f) }, f.name)
			}
			const useLink = () => load({ kind: 'sheet', url: url.value.trim() }, 'Google Sheet')
			const example = (i) => { for (const r of sheet.rows.slice(0, 30)) if (r[i]) return r[i].length > 40 ? r[i].slice(0, 40) + '...' : r[i]; return '' }
			const used = computed(() => new Set(mapping.value.filter(Boolean)))
			const opts = (i) => [{ value: '', label: "Don't import" }, ...fields.value.map((f) => ({ value: f.fieldname, label: f.label + (f.fieldname === 'first_name' ? ' (needed)' : ''), disabled: used.value.has(f.fieldname) && mapping.value[i] !== f.fieldname }))]
			const ready = computed(() => used.value.has('first_name'))
			async function go(dry) {
				run.phase = dry ? 'check' : 'add'; run.done = 0; run.total = sheet.rows.length; run.created = 0; run.failed = []; error.value = ''
				try {
					for (let i = 0; i < sheet.rows.length; i += BATCH) {
						const r = await call('add_rows', { mapping: JSON.stringify(mapping.value), rows: JSON.stringify(sheet.rows.slice(i, i + BATCH)), dry_run: dry ? 1 : 0, start: i + 2 })
						run.created += r.created; run.failed.push(...r.failed); run.done = Math.min(sheet.rows.length, i + BATCH)
					}
					run.phase = dry ? 'checked' : 'added'
					if (!dry) { CM.toast(run.created + (run.created === 1 ? ' lead' : ' leads') + ' added'); emit('done') }
				} catch (e) { error.value = e.message; run.phase = dry ? '' : 'checked' }
			}
			function review() { step.value = 3; go(true) }
			async function template() { try { const r = await CM.call('crm_addons.pro.form.import_template', {}); csvDownload(r.csv, 'lead-import-template.csv') } catch (e) { CM.toast(e.message, 'err') } }
			const pct = computed(() => (run.total ? Math.round((run.done / run.total) * 100) : 0))
			return { step, source, url, busy, error, sheet, fields, mapping, run, pick, useLink, example, opts, ready, review, go, template, pct, SRC: [{ value: 'file', label: 'Excel or CSV file' }, { value: 'sheet', label: 'Google Sheet link' }] }
		},
		template: `
		<Modal title="Upload leads" :subtitle="step === 1 ? 'Step 1 of 3: choose your sheet' : step === 2 ? 'Step 2 of 3: match the columns' : 'Step 3 of 3: check and add'" size="lg" @close="$emit('close')">
			<div v-if="step === 1">
				<Seg v-model="source" :options="SRC" />
				<div v-if="source === 'file'" style="margin-top:14px"><label class="btn"><Ico name="upload" /> Choose an Excel or CSV file<input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="pick" /></label>
					<Btn variant="ghost" icon="download" style="margin-left:8px" @click="template">Download a template</Btn></div>
				<div v-else style="margin-top:14px"><Field label="Link of the Google Sheet" hint="Open the sheet, click Share and set General access to Anyone with the link (Viewer). Only the first tab, or the tab in the link, is read."><Inp v-model="url" placeholder="https://docs.google.com/spreadsheets/d/..." aria-label="Google Sheet link" @keydown.enter="useLink" /></Field>
					<Btn variant="primary" :loading="busy" :disabled="!url.trim()" @click="useLink">Read the sheet</Btn></div>
				<p v-if="busy && source === 'file'" class="muted small" style="margin-top:12px">Reading the file...</p>
				<div v-if="error" class="err" role="alert" style="margin-top:12px">{{ error }}</div>
			</div>
			<div v-else-if="step === 2">
				<p class="small muted" style="margin:0 0 10px"><b>{{ sheet.name }}</b>: {{ sheet.total }} leads, {{ sheet.headers.length }} columns. For each column of your sheet, pick the lead field it goes to.</p>
				<div class="mapt"><div class="mh">Column in your sheet</div><div class="mh">An example</div><div class="mh">Field in the CRM</div>
					<template v-for="(h, i) in sheet.headers" :key="i"><div class="ellipsis"><b>{{ h }}</b></div><div class="ellipsis muted small">{{ example(i) || '(empty)' }}</div><div><Dd v-model="mapping[i]" :options="opts(i)" searchable :aria-label="'Field for ' + h" /></div></template></div>
				<div v-if="!ready" class="err" role="alert" style="margin-top:10px">Match one column to First name: every lead needs it.</div>
			</div>
			<div v-else>
				<div class="bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }"></i></div>
				<p v-if="run.phase === 'check'">Checking... {{ run.done }} of {{ run.total }} rows</p>
				<p v-else-if="run.phase === 'add'">Adding leads... {{ run.done }} of {{ run.total }} rows</p>
				<p v-else-if="run.phase === 'checked'"><b>{{ run.created }}</b> of {{ run.total }} leads are ready to add<template v-if="run.failed.length">; <b>{{ run.failed.length }}</b> need fixing and will be skipped</template>.</p>
				<p v-else-if="run.phase === 'added'"><b>Done.</b> {{ run.created }} leads added<template v-if="run.failed.length">, {{ run.failed.length }} skipped</template>.</p>
				<ul v-if="run.failed.length && (run.phase === 'checked' || run.phase === 'added')" class="list" style="max-height:200px;overflow:auto"><li v-for="f in run.failed.slice(0, 200)" :key="f.row" class="li small">Row {{ f.row }}: {{ f.reason }}</li></ul>
				<div v-if="error" class="err" role="alert" style="margin-top:10px">{{ error }}</div>
			</div>
			<template #foot>
				<Btn v-if="step === 2" @click="step = 1">Back</Btn><Btn v-if="step === 3 && run.phase === 'checked'" @click="step = 2">Back</Btn>
				<div class="grow"></div>
				<Btn @click="$emit('close')">{{ run.phase === 'added' ? 'Close' : 'Cancel' }}</Btn>
				<Btn v-if="step === 2" variant="primary" :disabled="!ready" @click="review">Check the sheet</Btn>
				<Btn v-if="step === 3 && run.phase === 'checked'" variant="primary" :disabled="!run.created" @click="go(false)">Add {{ run.created }} leads</Btn>
			</template>
		</Modal>`,
	}

	PRO.leadUtil = { csvDownload, iso, store }
})()
