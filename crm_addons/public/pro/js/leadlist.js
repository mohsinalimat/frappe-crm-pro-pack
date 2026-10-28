/* Suite Pro: the Leads list, built on Frappe CRM's own list API (crm.api.doc.get_data and CRM View Settings). Filters, sorting, columns, views, group by and
   Kanban are CRM's: the same data and the same saved views, so this page and the CRM's own Leads page agree and follow CRM when it changes. */
(() => {
	const { ref, reactive, computed, onMounted, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const { csvDownload, iso } = PRO.leadUtil
	const api = (m, a) => CM.call(m, a)
	const DOC = 'CRM Lead'
	const jparse = (s, d) => { if (s && typeof s !== 'string') return s; try { return s ? JSON.parse(s) : d } catch (e) { return d } }
	const TIME_KEYS = ['modified', 'creation', 'first_response_time', 'first_responded_on', 'response_by']

	const BASE = { converted: 0 }

	// ---- small cell components
	V.UserPic = {
		props: { user: String, size: { type: Number, default: 22 } },
		setup(props) { const u = computed(() => (PRO.users[props.user] || { name: props.user, full_name: props.user })); return { u } },
		template: `<span class="row" style="gap:7px;min-width:0"><Pic :name="u.full_name" :image="u.image" :size="size" /><span class="ellipsis">{{ u.full_name }}</span></span>`,
	}
	PRO.users = reactive({})

	/** Column settings: tick the fields to show, drag to reorder. */
	V.ColumnsDialog = {
		props: { fields: Array, columns: Array },
		emits: ['close', 'apply'],
		setup(props, { emit }) {
			const chosen = ref(props.columns.map((c) => ({ ...c })))
			const q = ref('')
			const has = (k) => chosen.value.some((c) => c.key === k)
			function flip(f) { if (has(f.fieldname)) chosen.value = chosen.value.filter((c) => c.key !== f.fieldname); else chosen.value.push({ label: f.label, type: f.fieldtype, key: f.fieldname, options: f.options, width: '10rem' }) }
			const dragI = ref(-1); const overI = ref(-1)
			function drop(j) { const i = dragI.value; dragI.value = overI.value = -1; if (i < 0 || i === j) return; const a = chosen.value; a.splice(j, 0, a.splice(i, 1)[0]) }
			const shown = computed(() => props.fields.filter((f) => f.label.toLowerCase().includes(q.value.trim().toLowerCase())))
			return { chosen, q, has, flip, dragI, overI, drop, shown, apply: () => emit('apply', chosen.value) }
		},
		template: `
		<Modal title="Columns" size="lg" @close="$emit('close')">
			<div class="grid2" style="align-items:start">
				<div><Inp v-model="q" icon="search" placeholder="Find a field" aria-label="Find a field" /><div class="colpick"><label v-for="f in shown" :key="f.fieldname" class="row" style="gap:8px;padding:5px 2px"><input type="checkbox" :checked="has(f.fieldname)" @change="flip(f)" /> {{ f.label }}</label></div></div>
				<div><b class="small">Shown, in order</b><ul class="list"><li v-for="(c, i) in chosen" :key="c.key" class="row li dragrow" :class="{ over: overI === i && dragI !== i }" style="gap:8px;padding:6px 0" draggable="true" @dragstart="dragI = i" @dragend="dragI = overI = -1" @dragover.prevent="overI = i" @drop.prevent="drop(i)"><span class="grip" aria-hidden="true"><Ico name="grip" /></span><span class="grow">{{ c.label }}</span><Btn size="sm" variant="ghost" icon="x" :aria-label="'Remove ' + c.label" title="Remove" @click="chosen = chosen.filter((x) => x.key !== c.key)" /></li></ul></div>
			</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" :disabled="!chosen.length" @click="apply">Apply</Btn></template>
		</Modal>`,
	}

	const MODES = [{ value: 'list', label: 'List', icon: 'list' }, { value: 'kanban', label: 'Kanban', icon: 'columns' }, { value: 'grid', label: 'Grid', icon: 'grid2' }]

	/** Download: choose the columns and their order, then Excel or CSV. */
	V.ExportDialog = {
		props: { fields: Array, start: Array, count: Number, selected: Number, busy: Boolean },
		emits: ['close', 'go'],
		setup(props, { emit }) {
			const by = Object.fromEntries(props.fields.map((f) => [f.key, f]))
			const chosen = ref((props.start || []).filter((k) => by[k]).map((k) => ({ key: k, label: by[k].label })))
			const q = ref(''); const format = ref(PRO.leadUtil.store.get('exportFormat', 'xlsx'))
			const has = (k) => chosen.value.some((c) => c.key === k)
			const flip = (f) => { chosen.value = has(f.key) ? chosen.value.filter((c) => c.key !== f.key) : [...chosen.value, { key: f.key, label: f.label }] }
			const shown = computed(() => props.fields.filter((f) => f.label.toLowerCase().includes(q.value.trim().toLowerCase())))
			function go() { PRO.leadUtil.store.set('exportFormat', format.value); PRO.leadUtil.store.set('exportCols', chosen.value.map((c) => c.key)); emit('go', { cols: chosen.value, format: format.value }) }
			return { chosen, q, format, has, flip, shown, go, all: () => (chosen.value = props.fields.map((f) => ({ key: f.key, label: f.label }))), none: () => (chosen.value = []), FORMATS: [{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }] }
		},
		template: `
		<Modal title="Download leads" :subtitle="(selected ? selected + ' selected' : count + ' leads in these filters')" size="lg" @close="$emit('close')">
			<div class="grid2" style="align-items:start">
				<div><Inp v-model="q" icon="search" placeholder="Find a field" aria-label="Find a field" />
					<div class="row small" style="gap:10px;margin:6px 0"><button type="button" class="link" @click="all">Select all</button><button type="button" class="link" @click="none">None</button></div>
					<div class="colpick"><label v-for="f in shown" :key="f.key" class="row" style="gap:8px;padding:5px 2px"><input type="checkbox" :checked="has(f.key)" @change="flip(f)" /> {{ f.label }}</label></div></div>
				<div><b class="small">Columns in the file, in order</b><DragList v-model="chosen" empty="Pick at least one field." /></div>
			</div>
			<template #foot><Seg v-model="format" :options="FORMATS" /><div class="grow"></div><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="download" :loading="busy" :disabled="!chosen.length" @click="go">Download</Btn></template>
		</Modal>`,
	}

	/** Bulk actions in a dialog in the middle of the screen: pick what to do on the left, set it up on the right. */
	V.BulkDialog = {
		props: { count: Number, canDelete: Boolean, owners: Array, statuses: Array, run: Object },
		emits: ['close', 'go'],
		setup(props, { emit }) {
			const action = ref('assign')
			const form = reactive({ users: [], status: '', owner: '', field: '', value: '' })
			const specs = ref([])
			const ACTIONS = computed(() => [
				{ key: 'assign', label: 'Assign to', icon: 'users', text: 'Give the leads to one or more people.' },
				{ key: 'clear', label: 'Clear assignment', icon: 'x', text: 'Take the leads off whoever they are assigned to.' },
				{ key: 'status', label: 'Change status', icon: 'check-circle', text: 'Move the leads to another status.' },
				{ key: 'owner', label: 'Change lead owner', icon: 'user', text: 'Set who owns the leads, or nobody.' },
				{ key: 'field', label: 'Edit a field', icon: 'file-text', text: 'Set one field to the same value on all of them.' },
				...(props.canDelete ? [{ key: 'delete', label: 'Delete', icon: 'trash', text: 'Remove the leads for good. This cannot be undone.', danger: true }] : []),
			])
			const cur = computed(() => ACTIONS.value.find((a) => a.key === action.value))
			async function loadFields() {
				if (specs.value.length) return
				try {
					const secs = await CM.call('crm_addons.pro.form.get_form', { kind: 'edit' }); const seen = new Set()
					specs.value = secs.flatMap((x) => x.fields).filter((f) => !f.read_only && !['status', 'lead_owner', 'first_name'].includes(f.fieldname) && !seen.has(f.fieldname) && seen.add(f.fieldname))
				} catch (e) { /* the list stays empty */ }
			}
			const fieldOpts = computed(() => specs.value.map((f) => ({ value: f.fieldname, label: f.label })))
			const spec = computed(() => specs.value.find((f) => f.fieldname === form.field))
			const pick = (k) => { if (props.run.busy) return; action.value = k; if (k === 'field') loadFields() }
			const ready = computed(() => ({ assign: form.users.length > 0, status: !!form.status, field: !!form.field && form.value !== '' && form.value != null, owner: true }[action.value] ?? true))
			function go() {
				const k = action.value
				const payload = k === 'assign' ? { users: form.users } : k === 'status' ? { values: { status: form.status } } : k === 'owner' ? { values: { lead_owner: form.owner || '__none__' } } : k === 'field' ? { values: { [form.field]: form.value } } : {}
				emit('go', { kind: k, payload })
			}
			const pct = computed(() => (props.run.total ? Math.round((props.run.done / props.run.total) * 100) : 0))
			return { action, form, ACTIONS, cur, fieldOpts, spec, pick, ready, go, pct, ownerOpts: computed(() => [{ value: '', label: 'Nobody' }, ...props.owners.map((o) => ({ value: o.name, label: o.full_name }))]), assignOpts: computed(() => props.owners.map((o) => ({ value: o.name, label: o.full_name }))), statusOpts: computed(() => props.statuses.map((x) => ({ value: x.name, label: x.name }))) }
		},
		template: `
		<Modal title="Bulk actions" :subtitle="count + (count === 1 ? ' lead selected' : ' leads selected')" size="lg" @close="run.busy ? null : $emit('close')">
			<div class="bulk-grid">
				<div class="bulk-list" role="listbox" aria-label="Actions"><button v-for="a in ACTIONS" :key="a.key" type="button" class="bulk-act" :class="{ on: action === a.key, danger: a.danger }" role="option" :aria-selected="action === a.key" :disabled="run.busy" @click="pick(a.key)"><Ico :name="a.icon" /><span>{{ a.label }}</span></button></div>
				<div class="bulk-form">
					<b>{{ cur.label }}</b><p class="small muted" style="margin:2px 0 14px">{{ cur.text }}</p>
					<Field v-if="action === 'assign'" label="People"><MultiPick v-model="form.users" :options="assignOpts" label="Choose people" searchable /></Field>
					<Field v-else-if="action === 'status'" label="New status"><Dd v-model="form.status" :options="statusOpts" placeholder="Choose a status" aria-label="New status" /></Field>
					<Field v-else-if="action === 'owner'" label="Lead owner"><Dd v-model="form.owner" :options="ownerOpts" searchable aria-label="Lead owner" /></Field>
					<template v-else-if="action === 'field'">
						<Field label="Field"><Dd v-model="form.field" :options="fieldOpts" searchable placeholder="Choose a field" aria-label="Field" @update:modelValue="form.value = ''" /></Field>
						<FormField v-if="spec" :spec="{ ...spec, label: 'New value', reqd: 0 }" v-model="form.value" />
					</template>
					<p v-else-if="action === 'delete'" class="err" style="margin:0">{{ count }} {{ count === 1 ? 'lead' : 'leads' }} will be deleted.</p>
					<div v-if="run.busy || run.finished" style="margin-top:16px"><div class="bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }"></i></div>
						<p class="small">{{ run.busy ? 'Working... ' + run.done + ' of ' + run.total : run.done - run.failed.length + ' done' + (run.failed.length ? ', ' + run.failed.length + ' could not be changed' : '') }}</p>
						<ul v-if="run.failed.length && !run.busy" class="list" style="max-height:140px;overflow:auto"><li v-for="f in run.failed.slice(0, 100)" :key="f.name" class="li small">{{ f.name }}: {{ f.reason }}</li></ul></div>
				</div>
			</div>
			<template #foot><Btn :disabled="run.busy" @click="$emit('close')">{{ run.finished ? 'Close' : 'Cancel' }}</Btn><Btn :variant="cur.danger ? 'danger' : 'primary'" :loading="run.busy" :disabled="!ready" @click="go">{{ cur.danger ? 'Delete' : 'Apply' }} {{ count }} {{ count === 1 ? 'lead' : 'leads' }}</Btn></template>
		</Modal>`,
	}

	V.Leads = {
		setup() {
			const data = ref(null); const loading = ref(true); const error = ref(''); const meta = reactive({ statuses: [], owners: [], linkable: [], can_create: false, can_delete: false, can_write: false })
			const view = reactive({ type: 'list', name: '', label: 'List' }) // the view being shown
			const p = reactive({ filters: {}, orderBy: 'modified desc', columns: null, rows: null, groupBy: 'lead_owner', columnField: 'status', titleField: null, kanbanFields: null, kanbanColumns: null, pageLength: 20 })
			const filterFields = ref([]); const sortFields = ref([]); const groupFields = ref([])
			const cfg = reactive({ default_view: 'list', show_date: 1, show_status: 1, filters: [], columns: null, sort: 'modified desc' })
			const showFilters = ref(PRO.leadUtil.store.get('showFilters', false))
			const picked = ref([]); const selAll = ref(false); const page = ref(1); const pageSize = ref(PRO.leadUtil.store.get('pageSize', 20)); const dlg = ref(''); const busy = ref(false); const creating = ref(false); const importing = ref(false)
			const search = ref(''); let seq = 0, timer

			function params() {
				const f = { ...BASE, ...p.filters }
				if (view.type === 'kanban') delete f[p.columnField]  // the board hides columns itself; CRM would drop every other column
				const body = { doctype: DOC, filters: f, order_by: p.orderBy, page_length: view.type === 'kanban' ? p.pageLength : page.value * pageSize.value, page_length_count: 20, view: { custom_view_name: view.name || '', view_type: view.type, group_by_field: p.groupBy } }
				if (p.columns && view.type !== 'kanban') body.columns = JSON.stringify(p.columns)
				if (p.rows) body.rows = JSON.stringify(p.rows)
				if (view.type === 'kanban') { body.column_field = p.columnField; if (p.titleField) body.title_field = p.titleField; if (p.kanbanFields) body.kanban_fields = JSON.stringify(p.kanbanFields); if (p.kanbanColumns) body.kanban_columns = JSON.stringify(p.kanbanColumns) }
				return body
			}
			async function load(keep) {
				const mine = ++seq; if (!keep) loading.value = true; error.value = ''
				try {
					const body = params()
					if (search.value.trim()) { const names = await api('crm_addons.pro.leads.search_names', { text: search.value.trim() }); if (mine !== seq) return; body.filters = { ...body.filters, name: ['IN', names.length ? names : ['-']] } }
					const r = await api('crm.api.doc.get_data', body)
					if (mine !== seq) return
					if (view.type !== 'kanban' && !r.data.length && page.value > 1 && r.total_count > 0) { page.value = Math.ceil(r.total_count / pageSize.value); return load(true) }
					data.value = r
					if (r.columns && !p.columns) p.columns = r.columns
					if (view.type === 'kanban') { p.columnField = r.column_field || p.columnField; p.titleField = r.title_field; p.kanbanFields = r.kanban_fields; p.kanbanColumns = r.kanban_columns.map((c) => ({ name: c.name, order: c.order, page_length: c.page_length || 20, column: c.column })) }
				} catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			const cfgKey = () => JSON.stringify([cfg.columns, cfg.sort])
			const prefs = () => PRO.leadUtil.store.set('prefs', { base: cfgKey(), columns: p.columns, orderBy: p.orderBy })
			const resetSel = () => { picked.value = []; selAll.value = false }
			const change = () => { prefs(); page.value = 1; resetSel(); load() }

			onMounted(async () => {
				try {
					const [cf, m, ff, sf, gf] = await Promise.all([api('crm_addons.pro.config.get_config', {}), api('crm_addons.pro.leads.filter_options', {}), api('crm.api.doc.get_filterable_fields', { doctype: DOC }), api('crm.api.doc.sort_options', { doctype: DOC }), api('crm.api.doc.get_group_by_fields', { doctype: DOC })])
					Object.assign(meta, m); m.owners.forEach((o) => (PRO.users[o.name] = { name: o.name, full_name: o.full_name, image: o.image })); m.statuses.forEach((s) => (PRO.statusColors[s.name] = s.color))
					meta.linkable = ['CRM Lead Status', 'CRM Lead Source', 'CRM Territory', 'CRM Industry', 'CRM Organization', 'User', 'Country', 'Salutation', 'Gender']
					filterFields.value = ff; sortFields.value = sf; groupFields.value = gf
					Object.assign(cfg, cf)
					const m0 = PRO.leadUtil.store.get('mode', null) || cfg.default_view
					grid.value = m0 === 'grid'; view.type = m0 === 'kanban' ? 'kanban' : 'list'
					p.orderBy = cfg.sort || 'modified desc'
					if (cfg.columns && cfg.columns.length) { const by = Object.fromEntries(ff.map((f) => [f.fieldname, f])); p.columns = cfg.columns.map((k) => ({ key: k, label: (by[k] || {}).label || k, type: (by[k] || {}).fieldtype || 'Data', width: '10rem' })) }
					const pr = PRO.leadUtil.store.get('prefs', null)   // the person's own columns and sorting, kept only while the admin's defaults are the ones they were made on
					if (pr && pr.base === cfgKey()) { if (pr.columns && pr.columns.length) p.columns = pr.columns; if (pr.orderBy) p.orderBy = pr.orderBy }
				} catch (e) { error.value = e.message }
				await load()
			})
			// ---- views: List / Kanban / Grid
			const grid = ref(false)
			const mode = computed(() => (view.type === 'kanban' ? 'kanban' : grid.value ? 'grid' : 'list'))
			function setMode(m) {
				grid.value = m === 'grid'; PRO.leadUtil.store.set('mode', m); resetSel(); page.value = 1
				const t = m === 'kanban' ? 'kanban' : 'list'
				if (t !== view.type) { view.type = t; if (t === 'kanban') { p.kanbanFields = null; p.kanbanColumns = null; p.titleField = null } }
				load()
			}
			function setGroup(f) { if (!f) { view.type = 'list'; load(true) } else { view.type = 'group_by'; p.groupBy = f; change() } }
			const groupPick = computed(() => [{ value: '', label: 'None' }, ...groupOpts.value])
			// ---- filters, quick filters, sort, columns
			const nFilters = computed(() => PRO.filt.activeKeys(p.filters).filter((k) => !MAIN.includes(k)).length)
			// the date control (Date added / Follow-up due) and the status picker work on the same filters as the second row
			const MAIN = ['creation', 'next_follow_up_on', 'status']
			const dateField = ref('creation'); const dateRange = ref({ ...PRO.filt.NONE })
			const DATE_FIELDS = [{ id: 'creation', label: 'Date added' }, { id: 'next_follow_up_on', label: 'Follow-up due' }]
			function setDate(r, field) {
				if (field) dateField.value = field
				let f = { ...p.filters }; DATE_FIELDS.forEach((d) => delete f[d.id])
				f = PRO.filt.withRange(f, dateField.value, r)
				p.filters = f; dateRange.value = r; change()
			}
			function syncDate() {
				for (const d of DATE_FIELDS) { const r = PRO.filt.rangeOf(p.filters, d.id); if (r.preset !== 'any') { dateField.value = d.id; dateRange.value = r; return } }
				dateRange.value = { ...PRO.filt.NONE }
			}
			const statusSel = computed({
				get: () => PRO.filt.valueOf(p.filters, 'status').values,
				set: (vals) => { p.filters = PRO.filt.withValue(p.filters, 'status', { op: 'in', values: vals }); change() },
			})
			const statusOpts = computed(() => meta.statuses.map((s) => ({ value: s.name, label: s.name })))
			function applyFilters(f) { p.filters = f; dlg.value = ''; syncDate(); change() }
			function setFilters(f) { p.filters = f; syncDate(); change() }
			function clearAll() { p.filters = {}; search.value = ''; dateRange.value = { ...PRO.filt.NONE }; change() }
			// the second row: the admin's default filters, plus any other filter that is switched on
			const chips = computed(() => {
				const by = Object.fromEntries(filterFields.value.map((f) => [f.fieldname, f]))
				const keys = [...new Set([...(cfg.filters || []), ...PRO.filt.activeKeys(p.filters)])].filter((k) => !MAIN.includes(k) && by[k])
				return keys.map((k) => by[k])
			})
			const anyFilter = computed(() => !!(PRO.filt.activeKeys(p.filters).length || search.value.trim()))
			function flipFilters() { showFilters.value = !showFilters.value; PRO.leadUtil.store.set('showFilters', showFilters.value) }
			const sortParts = computed(() => { const [f, d] = (p.orderBy || 'modified desc').split(' '); return { field: f, dir: d || 'desc' } })
			const sortOpts = computed(() => sortFields.value.map((f) => ({ value: f.fieldname, label: f.label })))
			function setSort(field, dir) { p.orderBy = field + ' ' + dir; change() }
			function applyColumns(cols) { p.columns = cols; p.rows = null; dlg.value = ''; change() }
			const colQ = computed(() => (data.value ? data.value.fields : []).map((f) => ({ ...f })))
						watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; resetSel(); load(true) }, 300) })
			const groupOpts = computed(() => groupFields.value.map((f) => ({ value: f.fieldname, label: f.label })))
			const groupName = computed(() => (data.value && data.value.group_by_field && data.value.group_by_field.fieldname) || p.groupBy)

			// ---- list rows
			const vt = computed(() => (data.value && data.value.view_type ? data.value.view_type : view.type))
			const rows = computed(() => (data.value && vt.value !== 'kanban' ? data.value.data.slice((page.value - 1) * pageSize.value, page.value * pageSize.value) : []))
			const columns = computed(() => (data.value ? data.value.columns : []))
			const groups = computed(() => {
				if (vt.value !== 'group_by' || !data.value) return []
				const g = data.value.group_by_field; const key = typeof g === 'object' ? g.fieldname : p.groupBy
				const order = typeof g === 'object' ? g.options || [] : []
				const out = order.map((o) => ({ value: o, rows: rows.value.filter((r) => (r[key] || '') === o) })).filter((x) => x.rows.length)
				const seen = new Set(order); rows.value.forEach((r) => { const v = r[key] || ''; if (!seen.has(v)) { seen.add(v); out.push({ value: v, rows: rows.value.filter((x) => (x[key] || '') === v) }) } })
				return out
			})
			const total = computed(() => (data.value ? data.value.total_count : 0))
			const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
			const pageNums = computed(() => { const n = pages.value, c = page.value; if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1); const out = [1]; if (c > 3) out.push('...'); for (let i = Math.max(2, c - 1); i <= Math.min(n - 1, c + 1); i++) out.push(i); if (c < n - 2) out.push('...'); out.push(n); return out })
			const range = computed(() => { const from = (page.value - 1) * pageSize.value + 1; return rows.value.length ? from + '\u2013' + (from + rows.value.length - 1) : '0' })
			const setPage = (n) => { if (n < 1 || n > pages.value || n === page.value) return; page.value = n; load(true) }
			const setSize = (n) => { pageSize.value = Number(n); PRO.leadUtil.store.set('pageSize', pageSize.value); page.value = 1; load(true) }
			const SIZES = [20, 50, 100].map((n) => ({ value: n, label: n + ' per page' }))
			const open = (n) => { location.hash = '#/leads/' + encodeURIComponent(n) }
			const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => picked.value.includes(r.name)))
			const flipAll = () => { selAll.value = false; const on = allOn.value; const here = rows.value.map((r) => r.name); picked.value = on ? picked.value.filter((n) => !here.includes(n)) : [...new Set([...picked.value, ...here])] }
			const flip = (n) => { selAll.value = false; picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n] }
			const ago = (s) => PRO.ago(s)
			const assignees = (r) => jparse(r._assign, [])
			const slaTone = (s) => ({ Fulfilled: 'green', 'Failed': 'red', 'First Response Due': 'amber', 'Paused': 'neutral' }[s] || 'neutral')
			const colWidth = (c) => ({ width: c.width || '10rem', minWidth: c.width || '10rem' })

			// ---- bulk actions
			const assignUsers = ref([]); const assignOpts = computed(() => meta.owners.map((o) => ({ value: o.name, label: o.full_name })))
			// every lead of the current filters, not just this page
			async function selectEvery() {
				busy.value = true
				try {
					const f = { ...BASE, ...p.filters }
					if (search.value.trim()) { const names = await api('crm_addons.pro.leads.search_names', { text: search.value.trim() }); f.name = ['IN', names.length ? names : ['-']] }
					const r = await api('crm.api.doc.get_data', { doctype: DOC, filters: f, order_by: p.orderBy, page_length: Math.min(total.value, 20000), page_length_count: 20, columns: JSON.stringify([{ label: 'ID', type: 'Data', key: 'name' }]), rows: JSON.stringify(['name']), view: { view_type: 'list' } })
					picked.value = r.data.map((x) => x.name); selAll.value = true
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			const bulkRun = reactive({ busy: false, finished: false, done: 0, total: 0, failed: [] })
			const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
			async function runBulk({ kind, payload }) {
				const all = [...picked.value]
				if (kind === 'delete' && !(await CM.confirm({ title: 'Delete ' + all.length + (all.length === 1 ? ' lead?' : ' leads?'), message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return
				Object.assign(bulkRun, { busy: true, finished: false, done: 0, total: all.length, failed: [] })
				try {
					for (const part of chunks(all, 100)) {
						const names = JSON.stringify(part)
						if (kind === 'delete') await api('crm.api.doc.delete_bulk_docs', { doctype: DOC, items: names, delete_linked: false })
						else if (kind === 'clear') await api('frappe.desk.form.assign_to.remove_multiple', { doctype: DOC, names, ignore_permissions: true })
						else if (kind === 'assign') await api('frappe.desk.form.assign_to.add_multiple', { doctype: DOC, name: names, assign_to: JSON.stringify(payload.users), bulk_assign: true, re_assign: true })
						else { const r = await api('crm_addons.pro.leads.bulk_edit', { names, values: JSON.stringify(payload.values) }); bulkRun.failed.push(...r.failed) }
						bulkRun.done += part.length
					}
					const ok = bulkRun.done - bulkRun.failed.length
					CM.toast(ok + (ok === 1 ? ' lead' : ' leads') + ' updated' + (bulkRun.failed.length ? ', ' + bulkRun.failed.length + ' could not be changed' : ''))
					bulkRun.finished = true; resetSel(); await load(true)
					if (!bulkRun.failed.length) dlg.value = ''
				} catch (e) { CM.toast(e.message, 'err') } finally { bulkRun.busy = false }
			}
			function openBulk() { Object.assign(bulkRun, { busy: false, finished: false, done: 0, total: 0, failed: [] }); dlg.value = 'bulk' }

			// ---- kanban
			const drag = reactive({ name: '', over: '' })
			const board = computed(() => {
				if (!data.value || vt.value !== 'kanban') return []
				const cols = data.value.data.filter((c) => c && c.column), sel = PRO.filt.valueOf(p.filters, p.columnField)
				if (!sel.values || !sel.values.length) return cols
				return cols.filter((c) => (sel.op === 'not in') === !sel.values.includes(c.column.name))
			})
			async function drop(col) {
				const name = drag.name; drag.name = ''; drag.over = ''; if (!name) return
				const from = board.value.find((c) => c.data.some((r) => r.name === name)); if (!from || from.column.name === col.column.name) return
				const card = from.data.find((r) => r.name === name)
				from.data = from.data.filter((r) => r.name !== name); from.column.all_count--
				col.data.unshift({ ...card, [p.columnField]: col.column.name }); col.column.all_count++
				try { await api('frappe.client.set_value', { doctype: DOC, name, fieldname: p.columnField, value: col.column.name }) } catch (e) { CM.toast(e.message, 'err'); load(true) }
			}
			async function colMore(col) {
				const kc = (p.kanbanColumns || []).find((c) => c.name === col.column.name); if (kc) kc.page_length = (kc.page_length || 20) + 20
				await load(true)
			}
			const cardFields = computed(() => (data.value ? data.value.kanban_fields || [] : []))
			const fieldLabel = (k) => { const f = data.value && data.value.fields.find((x) => x.fieldname === k); return f ? f.label : k }

			// ---- export: every field, of the selected rows or of the current filters
			const exporting = ref(false)
			const exportFields = ref([])
			async function openExport() {
				try { if (!exportFields.value.length) exportFields.value = await api('crm_addons.pro.form.export_columns', {}); dlg.value = 'export' } catch (e) { CM.toast(e.message, 'err') }
			}
			const exportStart = computed(() => PRO.leadUtil.store.get('exportCols', null) || (columns.value || []).map((c) => c.key).filter((k) => k && k !== '_assign'))
			async function exportCsv({ cols, format }) {
				exporting.value = true
				try {
					const f = { ...BASE, ...p.filters }; if (picked.value.length) f.name = ['IN', picked.value]
					if (search.value.trim()) { const names = await api('crm_addons.pro.leads.search_names', { text: search.value.trim() }); f.name = ['IN', picked.value.length ? picked.value.filter((n) => names.includes(n)) : names.length ? names : ['-']] }
					const r = await api('crm.api.doc.get_data', { doctype: DOC, filters: f, order_by: p.orderBy, page_length: 20000, page_length_count: 20, columns: JSON.stringify(cols.map((c) => ({ label: c.label, type: 'Data', key: c.key }))), rows: JSON.stringify(cols.map((c) => c.key)), view: { view_type: 'list' } })
					const val = (v) => (v == null ? '' : v)
					const stamp = 'leads-' + iso(new Date())
					if (format === 'xlsx') {
						const b64 = await api('crm_addons.pro.form.to_xlsx', { columns: JSON.stringify(cols.map((c) => c.label)), rows: JSON.stringify(r.data.map((row) => cols.map((c) => val(row[c.key])))) })
						const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
						const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = stamp + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
					} else {
						const cell = (v) => { let t = String(val(v)); if (/^[=@-]/.test(t) || (t.startsWith('+') && !/^\+[\d\s-]*$/.test(t))) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"' }
						csvDownload([cols.map((c) => cell(c.label)).join(','), ...r.data.map((row) => cols.map((c) => cell(row[c.key])).join(','))].join('\r\n'), stamp + '.csv')
					}
					dlg.value = ''
					CM.toast(r.data.length + (r.data.length === 1 ? ' lead' : ' leads') + ' downloaded' + (r.total_count > r.data.length ? ' (the first 20,000; narrow the filters for the rest)' : ''))
				} catch (e) { CM.toast(e.message, 'err') } finally { exporting.value = false }
			}
			const sortDirOpts = [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]
			return { page, pageSize, pages, pageNums, range, setPage, setSize, SIZES, selAll, selectEvery, bulkRun, runBulk, openBulk, anyFilter, openExport, exportFields, exportStart, cfg, showFilters, flipFilters, chips, setFilters, MAIN, statusSel, statusOpts, dateField, dateRange, DATE_FIELDS, setDate, clearAll, MODES, grid, mode, setMode, setGroup, groupPick, vt, data, loading, error, meta, view, p, picked, dlg, busy, creating, importing, search, load, nFilters, applyFilters, filterFields, sortParts, sortOpts, setSort, sortDirOpts, applyColumns, colQ, groupOpts, groupName, rows, columns, groups, total, open, allOn, flipAll, flip, ago, assignees, slaTone, colWidth, drag, board, drop, colMore, cardFields, fieldLabel, exporting, exportCsv, change, TIME_KEYS, PRO, CM }
		},
		template: `
		<div class="page leads">
			<div class="pg-head"><div class="grow"><h1>Leads</h1><p class="muted small">{{ loading && !data ? '' : total + (total === 1 ? ' lead' : ' leads') }}</p></div>
				<div class="actions">
					<Seg :modelValue="mode" :options="MODES" @update:modelValue="setMode" />
					<Btn icon="download" :loading="exporting" title="Download leads: choose the columns and their order" aria-label="Download leads" @click="openExport" />
					<Btn v-if="meta.can_create" icon="upload" title="Upload leads from a CSV file" aria-label="Upload leads" @click="importing = true" />
					<Btn v-if="meta.can_create" variant="primary" icon="plus" @click="creating = true">Create</Btn>
				</div>
			</div>

			<section class="card fbar">
				<div class="row wrap" style="gap:8px">
					<div class="grow" style="min-width:200px"><Inp v-model="search" icon="search" placeholder="Search anything: name, email, phone ..." clearable aria-label="Search leads" /></div>
					<DateRange v-if="cfg.show_date" v-model="dateRange" any one-month aria-label="Date" @change="(r) => setDate(r)">
						<template #top><div class="dr-tabs row" style="gap:6px;padding:8px 12px 0"><button v-for="d in DATE_FIELDS" :key="d.id" type="button" class="btn sm" :class="{ on: dateField === d.id }" @click="dateField = d.id">{{ d.label }}</button></div></template>
					</DateRange>
					<div v-if="cfg.show_status" style="width:170px"><MultiPick v-model="statusSel" :options="statusOpts" label="Status" searchable /></div>
					<button type="button" class="btn icon" :class="{ on: showFilters || nFilters }" :aria-expanded="showFilters" aria-label="Filters" title="Filters" @click="flipFilters"><Ico name="filter" /><span v-if="nFilters" class="n">{{ nFilters }}</span></button>
					<button type="button" class="btn icon clr" :class="{ on: anyFilter }" :disabled="!anyFilter" aria-label="Clear all filters" title="Clear all filters" @click="clearAll"><Ico name="x" /></button>
				</div>
				<div v-if="showFilters" class="row wrap fchips" style="gap:8px">
					<FilterChip v-for="f in chips" :key="f.fieldname" :field="f" :filters="p.filters" @change="setFilters" />
					<Btn size="sm" icon="plus" @click="dlg = 'filter'">Custom filter</Btn>
				</div>
			</section>

			<div v-if="picked.length" class="card bulk" role="region" aria-label="Selected leads">
				<b>{{ picked.length }} selected</b>
				<button v-if="!selAll && total > picked.length && vt !== 'kanban'" type="button" class="link" :disabled="busy" @click="selectEvery">Select all {{ total }} leads</button>
				<span v-else-if="selAll" class="small muted">That is every lead in these filters.</span>
				<div class="grow"></div><Btn size="sm" variant="primary" @click="openBulk">Bulk actions</Btn><Btn size="sm" variant="ghost" @click="picked = []; selAll = false">Clear selection</Btn>
			</div>

			<ErrorState v-if="error" :message="error" @retry="load()" />
			<div v-else-if="loading && !data" class="card" style="padding:0"><div v-for="n in 8" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>

			<section v-else-if="data" class="card listcard" :style="{ opacity: loading ? .6 : 1 }">
				<div class="lbar row wrap" style="gap:8px">
					<span class="small muted grow">{{ vt === 'kanban' ? total + (total === 1 ? ' lead' : ' leads') : (rows.length ? 'Showing ' + range + ' of ' + total + ' leads' : '0 leads') }}</span>
					<Btn size="sm" icon="refresh" aria-label="Refresh" title="Refresh" @click="load(true)" />
					<template v-if="true">
						<div style="width:200px"><Dd :modelValue="sortParts.field" :options="sortOpts" searchable prefix="Sort by" aria-label="Sort by" @update:modelValue="(f) => setSort(f, sortParts.dir)" /></div>
						<Btn size="sm" :icon="sortParts.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :aria-label="sortParts.dir === 'asc' ? 'Ascending' : 'Descending'" @click="setSort(sortParts.field, sortParts.dir === 'asc' ? 'desc' : 'asc')" />
						<Btn v-if="vt !== 'kanban' && !grid" size="sm" icon="columns" title="Columns" aria-label="Columns" @click="dlg = 'columns'" />
					</template>
				</div>
				<template v-if="vt !== 'kanban'">
					<Empty v-if="!rows.length" icon="users" title="No leads here" :text="nFilters || search ? 'No lead matches these filters.' : 'There are no leads yet.'"><Btn v-if="nFilters || search" @click="clearAll">Clear filters</Btn></Empty>
					<div v-else-if="grid" class="gridv"><div v-for="r in rows" :key="r.name" class="kcard" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
						<div class="row" style="gap:10px"><Pic :name="r.lead_name || r.first_name || '?'" :image="r.image" :size="36" /><div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">{{ r.lead_name || r.name }}</b><span class="small muted ellipsis" style="display:block">{{ r.organization || '' }}</span></div><input type="checkbox" :checked="picked.includes(r.name)" :aria-label="'Select ' + (r.lead_name || r.name)" @click.stop @change="flip(r.name)" /></div>
						<div class="row" style="gap:6px;flex-wrap:wrap"><StatusTag :status="r.status" /><span v-if="r.sla_status" class="badge nodot" :class="slaTone(r.sla_status)">{{ r.sla_status }}</span></div>
						<div v-if="r.mobile_no" class="small">{{ r.mobile_no }}</div><div v-if="r.email" class="small muted ellipsis">{{ r.email }}</div>
						<div class="row small muted" style="justify-content:space-between;gap:6px"><span v-if="assignees(r).length" class="row" style="gap:4px"><UserPic v-for="u in assignees(r).slice(0, 2)" :key="u" :user="u" :size="18" /></span><span v-else class="faint">Unassigned</span><span :title="r.modified">{{ ago(r.modified) }}</span></div>
					</div></div>
					<div v-else class="table-wrap"><table class="tbl">
						<thead><tr><th style="width:36px"><input type="checkbox" :checked="allOn" aria-label="Select all" @change="flipAll" /></th><th v-for="c in columns" :key="c.key" :style="colWidth(c)">{{ c.label }}</th></tr></thead>
						<tbody>
							<template v-for="g in (vt === 'group_by' ? groups : [{ value: null, rows }])" :key="g.value">
								<tr v-if="vt === 'group_by'" class="grp"><td :colspan="columns.length + 1"><b>{{ g.value ? (PRO.users[g.value] ? PRO.users[g.value].full_name : g.value) : 'Empty' }}</b> <span class="muted small">{{ g.rows.length }}</span></td></tr>
								<tr v-for="r in g.rows" :key="r.name" class="click" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
									<td @click.stop><input type="checkbox" :checked="picked.includes(r.name)" :aria-label="'Select ' + (r.lead_name || r.name)" @change="flip(r.name)" /></td>
									<td v-for="c in columns" :key="c.key">
										<span v-if="c.key === 'lead_name'" class="row" style="gap:8px;min-width:0"><Pic :name="r.lead_name || r.first_name || '?'" :image="r.image" :size="24" /><b class="ellipsis">{{ r.lead_name || r.name }}</b></span>
										<StatusTag v-else-if="c.key === 'status'" :status="r.status" />
										<UserPic v-else-if="c.key === 'lead_owner' || c.key === 'owner' || c.key === 'modified_by'" :user="r[c.key]" />
										<span v-else-if="c.key === '_assign'" class="row" style="gap:4px"><template v-if="assignees(r).length"><UserPic v-for="u in assignees(r).slice(0, 2)" :key="u" :user="u" :size="22" /><span v-if="assignees(r).length > 2" class="small muted">+{{ assignees(r).length - 2 }}</span></template><span v-else class="faint">-</span></span>
										<span v-else-if="c.key === 'sla_status'"><span v-if="r.sla_status" class="badge nodot" :class="slaTone(r.sla_status)">{{ r.sla_status }}</span></span>
										<span v-else-if="TIME_KEYS.includes(c.key) || c.type === 'Datetime'" class="muted" :title="r[c.key]">{{ ago(r[c.key]) || '-' }}</span>
										<span v-else-if="c.type === 'Check'">{{ r[c.key] ? 'Yes' : 'No' }}</span>
										<span v-else class="ellipsis" style="display:block;max-width:260px">{{ r[c.key] == null || r[c.key] === '' ? '-' : r[c.key] }}</span>
									</td>
								</tr>
							</template>
						</tbody>
					</table></div>
					<div v-if="rows.length || page > 1" class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
						<div style="width:140px"><Dd :modelValue="pageSize" :options="SIZES" size="sm" aria-label="Rows per page" @update:modelValue="setSize" /></div><div class="grow"></div>
						<nav class="pgn row" style="gap:4px" aria-label="Pages"><Btn size="sm" icon="chevron-left" aria-label="Previous page" :disabled="page <= 1" @click="setPage(page - 1)" />
							<template v-for="(n, i) in pageNums" :key="i"><span v-if="n === '...'" class="small muted" style="padding:0 4px">...</span><button v-else type="button" class="btn sm pg" :class="{ on: n === page }" :aria-current="n === page ? 'page' : null" @click="setPage(n)">{{ n }}</button></template>
							<Btn size="sm" icon="chevron-right" aria-label="Next page" :disabled="page >= pages" @click="setPage(page + 1)" /></nav>
					</div>
				</template>

				<div v-else class="board">
					<section v-for="col in board" :key="col.column.name" class="col" :class="{ over: drag.over === col.column.name }" :aria-label="col.column.name" @dragover.prevent="drag.over = col.column.name" @dragleave="drag.over = ''" @drop.prevent="drop(col)">
						<header><span class="row" style="gap:6px"><StatusTag v-if="p.columnField === 'status'" :status="col.column.name" /><b v-else>{{ col.column.name }}</b></span><span class="count">{{ col.column.all_count }}</span></header>
						<div class="col-body">
							<div v-for="r in col.data" :key="r.name" class="kcard" draggable="true" tabindex="0" @dragstart="drag.name = r.name" @dragend="drag.name = ''; drag.over = ''" @click="open(r.name)" @keydown.enter="open(r.name)">
								<b class="ellipsis">{{ r[p.titleField || 'lead_name'] || r.lead_name || r.name }}</b>
								<template v-for="k in cardFields" :key="k"><div v-if="r[k] != null && r[k] !== '' && k !== (p.titleField || 'lead_name')" class="small" :class="{ muted: k !== 'mobile_no' }"><UserPic v-if="k === 'lead_owner'" :user="r[k]" :size="18" /><span v-else-if="k === '_assign'" class="row" style="gap:4px"><UserPic v-for="u in assignees(r).slice(0, 2)" :key="u" :user="u" :size="18" /></span><span v-else-if="TIME_KEYS.includes(k)" :title="r[k]">{{ ago(r[k]) }}</span><span v-else class="ellipsis" style="display:block">{{ r[k] }}</span></div></template>
							</div>
							<div v-if="!col.data.length" class="small faint" style="padding:10px 4px">No leads</div>
							<Btn v-if="col.column.all_count > col.data.length" size="sm" variant="ghost" @click="colMore(col)">Load more ({{ col.column.all_count - col.data.length }})</Btn>
						</div>
					</section>
				</div>
			</section>

			<ExportDialog v-if="dlg === 'export'" :fields="exportFields" :start="exportStart" :count="total" :selected="picked.length" :busy="exporting" @close="dlg = ''" @go="exportCsv" />
			<FilterDialog v-if="dlg === 'filter'" :fields="filterFields" :filters="p.filters" @close="dlg = ''" @apply="applyFilters" />
			<ColumnsDialog v-if="dlg === 'columns' && data" :fields="colQ" :columns="columns" @close="dlg = ''" @apply="applyColumns" />
			<BulkDialog v-if="dlg === 'bulk'" :count="picked.length" :can-delete="meta.can_delete" :owners="meta.owners" :statuses="meta.statuses" :run="bulkRun" @close="dlg = ''" @go="runBulk" />
			<ImportLeads v-if="importing" @close="importing = false" @done="importing = false; load(true)" />
			<NewLead v-if="creating" :opts="meta" @close="creating = false" @created="(n) => { creating = false; open(n) }" />
		</div>`,
	}
})()
