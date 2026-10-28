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
	V.ImportLeads = {
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const text = ref(''); const fileName = ref(''); const result = ref(null); const busy = ref(false); const error = ref('')
			async function pick(e) {
				const f = e.target.files[0]; if (!f) return
				if (f.size > 5e6) { error.value = 'That file is over 5 MB. Split it into parts.'; return }
				fileName.value = f.name; text.value = await f.text(); result.value = null; error.value = ''; await run(1)
			}
			async function run(dry) {
				busy.value = true; error.value = ''
				try { result.value = await CM.call('crm_addons.pro.form.import_csv', { content: text.value, dry_run: dry }); if (!dry) { CM.toast(result.value.created + ' leads added'); emit('done') } } catch (e) { error.value = e.message; result.value = null } finally { busy.value = false }
			}
			async function template() { try { const r = await CM.call('crm_addons.pro.form.import_template', {}); csvDownload(r.csv, 'lead-import-template.csv') } catch (e) { CM.toast(e.message, 'err') } }
			return { text, fileName, result, busy, error, pick, run, template }
		},
		template: `
		<Modal title="Upload leads" subtitle="A CSV file whose first row holds the column names of the lead form." @close="$emit('close')">
			<div class="row" style="gap:10px;flex-wrap:wrap"><label class="btn"><Ico name="upload" /> Choose a CSV file<input type="file" accept=".csv,text/csv" hidden @change="pick" /></label><Btn variant="ghost" icon="download" @click="template">Download the template</Btn><span v-if="fileName" class="small muted">{{ fileName }}</span></div>
			<div v-if="error" class="err" role="alert" style="margin-top:10px">{{ error }}</div>
			<div v-if="result" style="margin-top:14px">
				<p><b>{{ result.created }}</b> of {{ result.total }} {{ result.dry_run ? 'leads are ready to add' : 'leads added' }}<template v-if="result.failed.length">; <b>{{ result.failed.length }}</b> need fixing</template>.</p>
				<p v-if="result.unknown.length" class="small muted">Columns not used (no such field on the lead form): {{ result.unknown.join(', ') }}</p>
				<ul v-if="result.failed.length" class="list" style="max-height:200px;overflow:auto"><li v-for="f in result.failed" :key="f.row" class="li small">Row {{ f.row }}: {{ f.reason }}</li></ul>
			</div>
			<template #foot><Btn @click="$emit('close')">Close</Btn><Btn variant="primary" :loading="busy" :disabled="!result || !result.dry_run || !result.created" @click="run(0)">Add {{ result && result.dry_run ? result.created : '' }} leads</Btn></template>
		</Modal>`,
	}

	PRO.leadUtil = { csvDownload, iso, store }
})()
