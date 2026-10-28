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

	V.Leads = {
		setup() {
			const opts = reactive({ statuses: [], sources: [], territories: [], organizations: [], owners: [], can_write: false, can_create: false, can_delete: false })
			const filters = reactive(EMPTY()); const search = ref(''); const scope = ref(store.get('scope', 'all')); const datePreset = ref('')
			const mode = ref(store.get('mode', 'table')); const perPage = ref(store.get('perPage', 25)); const cols = ref(store.get('cols', DEFAULT_COLS))
			const sort = reactive({ by: store.get('sortBy', 'creation'), dir: store.get('sortDir', 'desc') }); const page = ref(1)
			const rows = ref([]); const total = ref(0); const board = ref([]); const loading = ref(true); const error = ref('')
			const picked = ref([]); const views = ref(store.get('views', []))
			const showFilters = ref(store.get('showFilters', false)); const showViews = ref(false); const creating = ref(false); const importing = ref(false); const exporting = ref(false)
			let timer, seq = 0

			const query = () => ({ filters: JSON.stringify(filters), search: search.value || undefined, scope: scope.value })
			const totalAll = computed(() => (mode.value === 'table' || mode.value === 'grid' ? total.value : board.value.reduce((n, c) => n + c.count, 0)))
			async function load() {
				const mine = ++seq; loading.value = true; error.value = ''
				try {
					if (mode.value === 'kanban') { const b = await CM.call('crm_addons.pro.leads.board', query()); if (mine !== seq) return; board.value = b.map((c) => ({ ...c, more: false })) }
					else {
						const r = await CM.call('crm_addons.pro.leads.list_leads', { ...query(), order_by: sort.by, order_dir: sort.dir, start: (page.value - 1) * perPage.value, page_length: perPage.value })
						if (mine !== seq) return; rows.value = r.rows; total.value = r.total
					}
					picked.value = []
				} catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			onMounted(async () => {
				try { Object.assign(opts, await CM.call('crm_addons.pro.leads.filter_options', {})); opts.statuses.forEach((s) => (PRO.statusColors[s.name] = s.color)) } catch (e) { error.value = e.message }
				load()
			})
			watch(filters, () => { page.value = 1; load() }, { deep: true })
			watch([scope, mode, perPage], () => { page.value = 1; store.set('scope', scope.value); store.set('mode', mode.value); store.set('perPage', perPage.value); load() })
			watch(() => sort.by + sort.dir, () => { store.set('sortBy', sort.by); store.set('sortDir', sort.dir); page.value = 1; load() })
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load() }, 300) })
			watch(cols, () => store.set('cols', cols.value))
			watch(showFilters, () => store.set('showFilters', showFilters.value))
			watch(datePreset, (p) => { if (p !== 'custom') { const [a, b] = range(p); filters.from = a; filters.to = b } })

			const activeCount = computed(() => ['status', 'source', 'territory', 'organization', 'lead_owner'].filter((k) => filters[k].length).length + (filters.from || filters.to ? 1 : 0) + ['has_followup', 'never_called', 'stale', 'has_meeting'].filter((k) => filters[k]).length + (filters.followup ? 1 : 0) + (scope.value !== 'all' ? 1 : 0))
			const clear = () => { Object.assign(filters, EMPTY()); datePreset.value = ''; scope.value = 'all'; search.value = '' }
			function sortBy(c) { if (!c.sort) return; if (sort.by === c.sort) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.by = c.sort; sort.dir = 'asc' } }
			const pages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))
			const go = (n) => { page.value = Math.min(pages.value, Math.max(1, n)); load() }
			const visible = computed(() => COLS.filter((c) => cols.value.includes(c.id)))
			const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => picked.value.includes(r.name)))
			const flipAll = () => { picked.value = allOn.value ? [] : rows.value.map((r) => r.name) }
			const flip = (n) => { picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n] }
			const open = (n) => { location.hash = '#/leads/' + encodeURIComponent(n) }
			const flag = (k) => { filters[k] = !filters[k]; if (k === 'has_followup' && filters[k]) filters.followup = '' }
			const noFollow = () => { filters.followup = filters.followup === 'none' ? '' : 'none'; filters.has_followup = false }
			const setScope = (s) => { scope.value = scope.value === s ? 'all' : s }
			const showing = computed(() => (total.value ? (page.value - 1) * perPage.value + 1 : 0) + '–' + Math.min(total.value, page.value * perPage.value))

			async function exportCsv() {
				exporting.value = true
				try { const r = await CM.call('crm_addons.pro.leads.export_csv', { ...query(), names: picked.value.length ? JSON.stringify(picked.value) : undefined }); csvDownload(r.csv, 'leads-' + iso(new Date()) + '.csv'); CM.toast(r.count + (r.count === 1 ? ' lead' : ' leads') + ' exported' + (r.truncated ? ' (the first 20,000; narrow the filters for the rest)' : ''), r.truncated ? 'warn' : 'ok') } catch (e) { CM.toast(e.message, 'err') } finally { exporting.value = false }
			}

			// bulk actions
			const bulk = reactive({ status: '', owner: '', busy: false })
			async function applyBulk(kind) {
				const v = kind === 'status' ? bulk.status : bulk.owner; if (!v) return
				bulk.busy = true
				try {
					const r = await CM.call('crm_addons.pro.leads.bulk_update', { names: JSON.stringify(picked.value), [kind]: v })
					CM.toast(r.done + (r.done === 1 ? ' lead updated' : ' leads updated') + (r.failed.length ? '; ' + r.failed.length + ' could not be changed' : ''), r.failed.length ? 'warn' : 'ok')
					bulk.status = ''; bulk.owner = ''; await load()
				} catch (e) { CM.toast(e.message, 'err') } finally { bulk.busy = false }
			}
			async function removeBulk() {
				if (!(await CM.confirm({ title: 'Delete ' + picked.value.length + (picked.value.length === 1 ? ' lead?' : ' leads?'), message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return
				try { const r = await CM.call('crm_addons.pro.leads.bulk_delete', { names: JSON.stringify(picked.value) }); CM.toast(r.done + ' deleted' + (r.failed.length ? '; ' + r.failed.length + ' could not be deleted' : '')); await load() } catch (e) { CM.toast(e.message, 'err') }
			}

			// kanban: drag a card to another status; each column loads its own next leads as it is scrolled
			const drag = reactive({ name: '', over: '' })
			async function drop(status) {
				const name = drag.name; drag.name = ''; drag.over = ''; if (!name) return
				const from = board.value.find((c) => c.rows.some((r) => r.name === name)); if (!from || from.name === status) return
				const card = from.rows.find((r) => r.name === name)
				from.rows = from.rows.filter((r) => r.name !== name); from.count--
				const to = board.value.find((c) => c.name === status); to.rows.unshift({ ...card, status }); to.count++
				try { await CM.call('crm_addons.pro.leads.set_status', { name, status }) } catch (e) { CM.toast(e.message, 'err'); load() }
			}
			async function colScroll(c, e) {
				const el = e.target
				if (c.more || c.rows.length >= c.count || el.scrollTop + el.clientHeight < el.scrollHeight - 160) return
				c.more = true
				try { const r = await CM.call('crm_addons.pro.leads.board_more', { ...query(), status: c.name, start: c.rows.length, page_length: 20 }); const have = new Set(c.rows.map((x) => x.name)); c.rows.push(...r.filter((x) => !have.has(x.name))) } catch (err) { CM.toast(err.message, 'err') } finally { c.more = false }
			}

			// saved views (kept in this browser)
			const viewName = ref('')
			const saveView = () => {
				const n = viewName.value.trim(); if (!n) return
				views.value = [...views.value.filter((v) => v.name !== n), { name: n, filters: JSON.parse(JSON.stringify(filters)), scope: scope.value, mode: mode.value, datePreset: datePreset.value }]
				store.set('views', views.value); viewName.value = ''; CM.toast('View saved')
			}
			const applyView = (v) => { Object.assign(filters, EMPTY(), v.filters); scope.value = v.scope || 'all'; mode.value = v.mode || 'table'; datePreset.value = v.datePreset || (v.filters.from || v.filters.to ? 'custom' : ''); showViews.value = false }
			const dropView = (v) => { views.value = views.value.filter((x) => x.name !== v.name); store.set('views', views.value) }

			const statusOpts = computed(() => opts.statuses.map((s) => ({ value: s.name, label: s.name })))
			const ownerOpts = computed(() => [{ value: '__none__', label: 'Unassigned' }, ...opts.owners.map((o) => ({ value: o.name, label: o.full_name }))])
			const assignOpts = computed(() => [{ value: '__none__', label: 'Nobody (unassign)' }, ...opts.owners.map((o) => ({ value: o.name, label: o.full_name }))])
			const colOpts = COLS.map((c) => ({ value: c.id, label: c.label }))
			const modeOpts = [{ value: 'table', label: 'Table', icon: 'list' }, { value: 'kanban', label: 'Kanban', icon: 'columns' }, { value: 'grid', label: 'Grid', icon: 'grid2' }]
			return { opts, filters, search, scope, datePreset, DATES, SORT_OPTS, mode, modeOpts, perPage, cols, sort, page, rows, total, totalAll, board, loading, error, picked, views, showFilters, showViews, creating, importing, exporting, exportCsv, activeCount, clear, sortBy, pages, go, visible, allOn, flipAll, flip, open, flag, noFollow, setScope, showing, bulk, applyBulk, removeBulk, drag, drop, colScroll, viewName, saveView, applyView, dropView, statusOpts, ownerOpts, assignOpts, colOpts, load, when, overdue, PRO, CM }
		},
		template: `
		<div class="page leads" :class="'m-' + mode">
			<div class="pg-head"><div class="grow"><h1>Leads</h1><p class="muted small">{{ loading && !totalAll ? '' : totalAll + (totalAll === 1 ? ' lead' : ' leads') }}</p></div>
				<div class="actions">
					<Seg v-model="mode" :options="modeOpts" />
					<Btn icon="download" :loading="exporting" title="Download every field of the leads (the selected ones, or all of these filters) as CSV" aria-label="Export leads" @click="exportCsv" />
					<Btn v-if="opts.can_create" icon="upload" title="Upload leads from a CSV file" aria-label="Upload leads" @click="importing = true" />
					<Btn v-if="opts.can_create" variant="primary" icon="plus" @click="creating = true">Add lead</Btn>
				</div>
			</div>

			<section class="card fbar">
				<div class="row wrap" style="gap:8px">
					<div class="grow" style="min-width:220px"><Inp v-model="search" icon="search" placeholder="Search name, phone, email, organization..." clearable aria-label="Search leads" /></div>
					<div style="width:170px"><Dd v-model="datePreset" :options="DATES" prefix="Added:" aria-label="Added date" /></div>
					<div style="width:150px"><MultiPick v-model="filters.status" :options="statusOpts" label="Status" /></div>
					<button type="button" class="btn" :class="{ on: showFilters }" :aria-expanded="String(showFilters)" @click="showFilters = !showFilters"><Ico name="filter" /> Filters<span v-if="activeCount" class="n">{{ activeCount }}</span></button>
					<button type="button" class="btn" :class="{ on: showViews }" :aria-expanded="String(showViews)" @click="showViews = !showViews"><Ico name="bookmark" /> Views<span v-if="views.length" class="n">{{ views.length }}</span></button>
					<button type="button" class="btn icon" :disabled="!activeCount && !search" title="Clear all filters" aria-label="Clear all filters" @click="clear"><Ico name="x" /></button>
				</div>
				<div v-if="datePreset === 'custom'" class="row" style="gap:8px;margin-top:10px"><label class="small muted row" style="gap:6px">From <input class="inp sm" type="date" v-model="filters.from" aria-label="Added from" /></label><label class="small muted row" style="gap:6px">to <input class="inp sm" type="date" v-model="filters.to" aria-label="Added to" /></label></div>
				<div v-if="showFilters" class="row wrap fchips" style="gap:8px">
					<div style="width:150px"><MultiPick v-model="filters.source" :options="opts.sources" label="Source" /></div>
					<div style="width:160px"><MultiPick v-model="filters.territory" :options="opts.territories" label="Territory" /></div>
					<div style="width:190px"><MultiPick v-model="filters.organization" :options="opts.organizations" label="Organization" searchable /></div>
					<div style="width:190px"><MultiPick v-model="filters.lead_owner" :options="ownerOpts" label="Assigned to" searchable /></div>
					<button type="button" class="fchip" :class="{ on: scope === 'mine' }" @click="setScope('mine')">My leads</button>
					<button type="button" class="fchip" :class="{ on: scope === 'team' }" @click="setScope('team')">My team</button>
					<button type="button" class="fchip" :class="{ on: filters.has_followup }" @click="flag('has_followup')">Has follow-up</button>
					<button type="button" class="fchip" :class="{ on: filters.followup === 'none' }" @click="noFollow">No follow-up</button>
					<button type="button" class="fchip" :class="{ on: filters.followup === 'due' }" @click="filters.followup = filters.followup === 'due' ? '' : 'due'; filters.has_followup = false">Follow-up due</button>
					<button type="button" class="fchip" :class="{ on: filters.never_called }" @click="flag('never_called')">Never called</button>
					<button type="button" class="fchip" :class="{ on: filters.stale }" @click="flag('stale')">Stale (7+ days)</button>
					<button type="button" class="fchip" :class="{ on: filters.has_meeting }" @click="flag('has_meeting')">Has meeting</button>
				</div>
				<div v-if="showViews" class="row wrap fchips" style="gap:8px">
					<span v-for="v in views" :key="v.name" class="fchip"><span role="button" tabindex="0" style="cursor:pointer" @click="applyView(v)" @keydown.enter="applyView(v)"><Ico name="bookmark" size="sm" /> {{ v.name }}</span><button type="button" class="x" :aria-label="'Delete view ' + v.name" @click="dropView(v)"><Ico name="x" size="sm" /></button></span>
					<span v-if="!views.length" class="small muted">No saved views yet. Set the filters you like, name them here and save.</span>
					<div class="row" style="gap:6px;margin-left:auto"><input class="inp sm" v-model="viewName" placeholder="Name this view" aria-label="View name" @keydown.enter="saveView" style="width:160px" /><Btn size="sm" icon="bookmark" :disabled="!viewName.trim()" @click="saveView">Save view</Btn></div>
				</div>
			</section>

			<div v-if="picked.length" class="card bulk" role="region" aria-label="Selected leads">
				<b>{{ picked.length }} selected</b>
				<div style="width:190px"><Dd v-model="bulk.owner" :options="assignOpts" placeholder="Assign to..." size="sm" searchable aria-label="Assign to" :disabled="!opts.can_write" /></div><Btn size="sm" :disabled="!bulk.owner" :loading="bulk.busy" @click="applyBulk('owner')">Assign</Btn>
				<div style="width:170px"><Dd v-model="bulk.status" :options="statusOpts" placeholder="Set status..." size="sm" aria-label="Set status" :disabled="!opts.can_write" /></div><Btn size="sm" :disabled="!bulk.status" :loading="bulk.busy" @click="applyBulk('status')">Apply</Btn>
				<div class="grow"></div><Btn v-if="opts.can_delete" size="sm" variant="danger" icon="trash" @click="removeBulk">Delete</Btn><Btn size="sm" variant="ghost" @click="picked = []">Cancel</Btn>
			</div>

			<ErrorState v-if="error" :message="error" @retry="load()" />
			<div v-else-if="loading && !(mode === 'kanban' ? board.length : rows.length)" class="card" style="padding:0"><div v-for="n in 8" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>

			<section v-else class="card listcard" :style="{ opacity: loading ? .6 : 1 }">
				<div class="row wrap lbar" style="gap:10px">
					<span class="muted">{{ mode === 'kanban' ? totalAll + (totalAll === 1 ? ' lead' : ' leads') : 'Showing ' + showing + ' of ' + total + (total === 1 ? ' lead' : ' leads') }}</span><div class="grow"></div>
					<button type="button" class="btn ghost sm" @click="load()"><Ico name="refresh" /> Refresh</button>
					<span class="small muted">Sort by</span><div style="width:150px"><Dd v-model="sort.by" :options="SORT_OPTS" size="sm" aria-label="Sort by" :disabled="mode === 'kanban'" /></div>
					<Btn size="sm" :icon="sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :aria-label="sort.dir === 'asc' ? 'Oldest first' : 'Newest first'" :title="sort.dir === 'asc' ? 'Ascending' : 'Descending'" :disabled="mode === 'kanban'" @click="sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'" />
					<div v-if="mode === 'table'" style="width:140px"><MultiPick v-model="cols" :options="colOpts" label="Columns" /></div>
				</div>

				<template v-if="mode === 'table'">
					<Empty v-if="!rows.length" icon="users" title="No leads here" :text="activeCount || search ? 'No lead matches these filters.' : 'There are no leads yet.'"><Btn v-if="activeCount || search" @click="clear">Clear filters</Btn></Empty>
					<template v-else>
						<div class="table-wrap"><table class="tbl">
							<thead><tr>
								<th style="width:36px"><input type="checkbox" :checked="allOn" aria-label="Select all on this page" @change="flipAll" /></th>
								<th v-for="c in visible" :key="c.id" :class="{ sort: c.sort, on: sort.by === c.sort }" @click="sortBy(c)" :aria-sort="sort.by === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null">{{ c.label }}<Ico v-if="sort.by === c.sort" :name="sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'" size="sm" /></th>
							</tr></thead>
							<tbody>
								<tr v-for="r in rows" :key="r.name" class="click" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
									<td @click.stop><input type="checkbox" :checked="picked.includes(r.name)" :aria-label="'Select ' + r.display_name" @change="flip(r.name)" /></td>
									<td v-for="c in visible" :key="c.id">
										<b v-if="c.id === 'lead_name'" class="ellipsis" style="display:block;max-width:240px">{{ r.display_name }}</b>
										<StatusTag v-else-if="c.id === 'status'" :status="r.status" />
										<span v-else-if="c.id === 'addons_score'" class="badge nodot" :class="r.addons_score >= 60 ? 'red' : r.addons_score >= 30 ? 'amber' : 'neutral'">{{ r.addons_score || r.addons_score === 0 ? r.addons_score : '-' }}</span>
										<div v-else-if="c.id === 'lead_owner'" class="row" style="gap:8px"><template v-if="r.lead_owner"><Pic :name="r.owner_name" :image="r.owner_image" :size="22" /><span>{{ r.owner_name }}</span></template><span v-else class="faint">Unassigned</span></div>
										<span v-else-if="c.id === 'next_follow_up_on'" :class="{ overdue: overdue(r.next_follow_up_on) }"><Ico v-if="r.next_follow_up_on" name="calendar" size="sm" /> {{ when(r.next_follow_up_on) || '-' }}</span>
										<span v-else-if="c.id === 'creation'" class="muted">{{ PRO.ago(r.creation) }}</span>
										<span v-else>{{ r[c.id] || '-' }}</span>
									</td>
								</tr>
							</tbody>
						</table></div>
						<div class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
							<div class="grow"></div>
							<div style="width:110px"><Dd v-model="perPage" :options="[{ value: 10, label: '10 / page' }, { value: 25, label: '25 / page' }, { value: 50, label: '50 / page' }, { value: 100, label: '100 / page' }]" size="sm" aria-label="Rows per page" /></div>
							<Btn size="sm" icon="chevron-left" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)" /><span class="small">{{ page }} / {{ pages }}</span><Btn size="sm" icon="chevron-right" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)" />
						</div>
					</template>
				</template>

				<template v-else-if="mode === 'grid'">
					<Empty v-if="!rows.length" icon="users" title="No leads here" :text="activeCount || search ? 'No lead matches these filters.' : 'There are no leads yet.'"><Btn v-if="activeCount || search" @click="clear">Clear filters</Btn></Empty>
					<template v-else>
						<div class="gridv"><div v-for="r in rows" :key="r.name" class="kcard" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
							<div class="row" style="gap:10px"><Pic :name="r.display_name" :image="r.image" :size="36" /><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">{{ r.display_name }}</b><span class="small muted ellipsis" style="display:block">{{ r.organization || r.job_title || '' }}</span></div></div>
							<div class="row" style="gap:6px;flex-wrap:wrap"><StatusTag :status="r.status" /><span v-if="r.addons_score || r.addons_score === 0" class="badge nodot neutral">Score {{ r.addons_score }}</span></div>
							<div v-if="r.mobile_no" class="small">{{ r.mobile_no }}</div>
							<div class="row small muted" style="justify-content:space-between"><span>{{ r.owner_name || 'Unassigned' }}</span><span :class="{ overdue: overdue(r.next_follow_up_on) }">{{ r.next_follow_up_on ? 'Next: ' + when(r.next_follow_up_on) : '' }}</span></div>
						</div></div>
						<div class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)"><div class="grow"></div><Btn size="sm" icon="chevron-left" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)" /><span class="small">{{ page }} / {{ pages }}</span><Btn size="sm" icon="chevron-right" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)" /></div>
					</template>
				</template>

				<div v-else class="board">
					<section v-for="c in board" :key="c.name" class="col" :class="{ over: drag.over === c.name }" :aria-label="c.name"
						@dragover.prevent="drag.over = c.name" @dragleave="drag.over = ''" @drop.prevent="drop(c.name)">
						<header><b>{{ c.name }}</b><span class="count">{{ c.count }}</span></header>
						<div class="col-body" @scroll.passive="colScroll(c, $event)">
							<div v-for="r in c.rows" :key="r.name" class="kcard" draggable="true" tabindex="0" @dragstart="drag.name = r.name" @dragend="drag.name = ''; drag.over = ''" @click="open(r.name)" @keydown.enter="open(r.name)">
								<b class="ellipsis">{{ r.display_name }}</b>
								<div v-if="r.organization && r.organization !== r.display_name" class="small muted ellipsis">{{ r.organization }}</div>
								<div class="row" style="gap:6px;flex-wrap:wrap"><span v-if="r.addons_score || r.addons_score === 0" class="badge nodot" :class="r.addons_score >= 60 ? 'red' : r.addons_score >= 30 ? 'amber' : 'neutral'">{{ r.addons_score }}</span><span v-if="r.source" class="badge nodot neutral">{{ r.source }}</span></div>
								<div v-if="r.next_follow_up_on" class="small" :class="{ overdue: overdue(r.next_follow_up_on) }">Next: {{ when(r.next_follow_up_on) }}</div>
								<div class="row small muted" style="gap:5px"><Pic :name="r.owner_name" :image="r.owner_image" :size="18" /><span class="ellipsis">{{ r.owner_name || 'Unassigned' }}</span></div>
							</div>
							<div v-if="c.more" class="small muted" style="padding:6px 4px">Loading...</div>
							<div v-else-if="!c.rows.length" class="small faint" style="padding:10px 4px">No leads</div>
						</div>
					</section>
				</div>
			</section>
			<ImportLeads v-if="importing" @close="importing = false" @done="importing = false; load()" />
			<NewLead v-if="creating" :opts="opts" @close="creating = false" @created="(n) => { creating = false; open(n) }" />
		</div>`,
	}
})()
