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
	const BASE = { converted: 0 }
	const jparse = (s, d) => { if (s && typeof s !== 'string') return s; try { return s ? JSON.parse(s) : d } catch (e) { return d } }
	const TIME_KEYS = ['modified', 'creation', 'first_response_time', 'first_responded_on', 'response_by']

	// ---- filters: conditions <-> CRM's filter object
	const T_STR = ['Data', 'Long Text', 'Small Text', 'Text', 'Text Editor', 'Phone', 'Autocomplete', 'Code']
	const T_NUM = ['Int', 'Float', 'Currency', 'Percent']
	const T_DATE = ['Date', 'Datetime']
	const OPS = (ft, fn) => {
		const eq = [['equals', 'Equals'], ['not equals', 'Not equals']], like = [['like', 'Like'], ['not like', 'Not like']], inn = [['in', 'In'], ['not in', 'Not in']], is = [['is', 'Is']]
		if (fn === '_assign') return [...like, ...is]
		if (T_STR.includes(ft)) return [...eq, ...like, ...inn, ...is]
		if (T_NUM.includes(ft)) return [...eq, ...like, ...inn, ...is, ['<', '<'], ['>', '>'], ['<=', '<='], ['>=', '>=']]
		if (ft === 'Select') return [...eq, ...inn, ...is]
		if (ft === 'Link') return [...eq, ...like, ...inn, ...is]
		if (ft === 'Check') return [['equals', 'Equals']]
		if (T_DATE.includes(ft)) return [...eq, ...is, ['>', '>'], ['<', '<'], ['>=', '>='], ['<=', '<='], ['between', 'Between'], ['timespan', 'Timespan']]
		return [...eq, ...like, ...is]
	}
	const SPANS = ['last week', 'last month', 'last quarter', 'last 6 months', 'last year', 'yesterday', 'today', 'tomorrow', 'this week', 'this month', 'this quarter', 'this year', 'next week', 'next month', 'next quarter', 'next 6 months', 'next year']
	const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean)
	function toFilters(conds) {
		const out = {}
		for (const c of conds) {
			if (!c.field || c.value === '' || c.value == null) continue
			const v = c.value
			if (c.op === 'equals') out[c.field] = v
			else if (c.op === 'not equals') out[c.field] = ['!=', v]
			else if (c.op === 'like') out[c.field] = ['LIKE', '%' + v + '%']
			else if (c.op === 'not like') out[c.field] = ['NOT LIKE', '%' + v + '%']
			else if (c.op === 'in') out[c.field] = ['IN', list(v)]
			else if (c.op === 'not in') out[c.field] = ['NOT IN', list(v)]
			else if (c.op === 'is') out[c.field] = ['IS', v]
			else if (c.op === 'between') { const p = String(v).split(',').map((x) => x.trim()); if (p[0] && p[1]) out[c.field] = ['BETWEEN', p] }
			else if (c.op === 'timespan') out[c.field] = ['TIMESPAN', v]
			else out[c.field] = [c.op, v]
		}
		return out
	}
	function toConds(filters, fields) {
		const rows = []
		for (const [field, val] of Object.entries(filters || {})) {
			if (field in BASE) continue
			if (!Array.isArray(val)) { rows.push({ field, op: 'equals', value: val }); continue }
			const op = String(val[0]).toLowerCase(), v = val[1]
			const strip = (x) => String(x).replace(/^%|%$/g, '')
			if (op === '!=') rows.push({ field, op: 'not equals', value: v })
			else if (op === 'like') rows.push({ field, op: 'like', value: strip(v) })
			else if (op === 'not like') rows.push({ field, op: 'not like', value: strip(v) })
			else if (op === 'in' || op === 'not in') rows.push({ field, op, value: [].concat(v).join(', ') })
			else if (op === 'between') rows.push({ field, op, value: [].concat(v).join(', ') })
			else rows.push({ field, op, value: v })
		}
		return rows
	}
	const describe = (filters) => Object.keys(filters || {}).filter((k) => !(k in BASE)).length

	// ---- small cell components
	V.UserPic = {
		props: { user: String, size: { type: Number, default: 22 } },
		setup(props) { const u = computed(() => (PRO.users[props.user] || { name: props.user, full_name: props.user })); return { u } },
		template: `<span class="row" style="gap:7px;min-width:0"><Pic :name="u.full_name" :image="u.image" :size="size" /><span class="ellipsis">{{ u.full_name }}</span></span>`,
	}
	PRO.users = reactive({})

	/** Filter dialog: one row per condition, built from CRM's filterable fields. */
	V.FilterDialog = {
		props: { fields: Array, filters: Object, linkable: Array },
		emits: ['close', 'apply'],
		setup(props, { emit }) {
			const rows = ref(toConds(props.filters, props.fields).map((r) => ({ ...r })))
			const byName = computed(() => Object.fromEntries(props.fields.map((f) => [f.fieldname, f])))
			const fieldOpts = computed(() => props.fields.map((f) => ({ value: f.fieldname, label: f.label })))
			const add = () => rows.value.push({ field: '', op: 'equals', value: '' })
			if (!rows.value.length) add()
			const spec = (r) => byName.value[r.field] || {}
			const ops = (r) => OPS(spec(r).fieldtype, r.field).map(([value, label]) => ({ value, label }))
			function pickField(r, f) { r.field = f; r.op = OPS(spec(r).fieldtype, f)[0][0]; r.value = '' }
			const kind = (r) => {
				const s = spec(r)
				if (r.op === 'is') return 'is'
				if (r.op === 'timespan') return 'span'
				if (s.fieldtype === 'Check') return 'check'
				if (s.fieldtype === 'Select' && !['in', 'not in'].includes(r.op)) return 'select'
				if (s.fieldtype === 'Link' && ['equals', 'not equals'].includes(r.op) && props.linkable.includes(s.options)) return 'link'
				if (T_DATE.includes(s.fieldtype) && r.op !== 'between') return 'date'
				if (T_NUM.includes(s.fieldtype)) return 'num'
				return 'text'
			}
			const selOpts = (r) => [{ value: '', label: 'Not set' }, ...String(spec(r).options || '').split('\n').filter(Boolean).map((o) => ({ value: o, label: o }))]
			const apply = () => emit('apply', toFilters(rows.value))
			return { rows, fieldOpts, add, ops, pickField, kind, selOpts, apply, SPANS: SPANS.map((s) => ({ value: s, label: s })), spec, remove: (i) => rows.value.splice(i, 1) }
		},
		template: `
		<Modal title="Filter" size="lg" @close="$emit('close')" @submit="apply">
			<div v-for="(r, i) in rows" :key="i" class="frow">
				<div style="width:200px"><Dd :modelValue="r.field" :options="fieldOpts" searchable placeholder="Field" aria-label="Field" @update:modelValue="(f) => pickField(r, f)" /></div>
				<div style="width:140px"><Dd v-model="r.op" :options="ops(r)" :disabled="!r.field" aria-label="Operator" /></div>
				<div class="grow" style="min-width:150px">
					<Dd v-if="kind(r) === 'is'" v-model="r.value" :options="[{ value: 'set', label: 'Set' }, { value: 'not set', label: 'Not set' }]" placeholder="Value" aria-label="Value" />
					<Dd v-else-if="kind(r) === 'span'" v-model="r.value" :options="SPANS" placeholder="Value" aria-label="Value" />
					<Dd v-else-if="kind(r) === 'check'" v-model="r.value" :options="[{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]" placeholder="Value" aria-label="Value" />
					<Dd v-else-if="kind(r) === 'select'" v-model="r.value" :options="selOpts(r)" placeholder="Value" aria-label="Value" />
					<LinkPick v-else-if="kind(r) === 'link'" v-model="r.value" :doctype="spec(r).options" label="Value" />
					<input v-else-if="kind(r) === 'date'" class="inp" type="date" v-model="r.value" aria-label="Value" />
					<input v-else-if="kind(r) === 'num'" class="inp" type="number" step="any" v-model="r.value" aria-label="Value" />
					<input v-else class="inp" v-model="r.value" :placeholder="['in', 'not in', 'between'].includes(r.op) ? 'Separate with commas' : 'Value'" aria-label="Value" />
				</div>
				<Btn size="sm" variant="ghost" icon="trash" aria-label="Remove this filter" @click="remove(i)" />
			</div>
			<Btn size="sm" icon="plus" style="margin-top:8px" @click="add">Add filter</Btn>
			<template #foot><Btn variant="ghost" @click="rows = []; add()">Clear all</Btn><div class="grow"></div><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" @click="apply">Apply</Btn></template>
		</Modal>`,
	}

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
				<div><b class="small">Shown, in order</b><ul class="list"><li v-for="(c, i) in chosen" :key="c.key" class="row li dragrow" :class="{ over: overI === i && dragI !== i }" style="gap:8px;padding:6px 0" draggable="true" @dragstart="dragI = i" @dragend="dragI = overI = -1" @dragover.prevent="overI = i" @drop.prevent="drop(i)"><span class="grip" aria-hidden="true"><Ico name="grip" /></span><span class="grow">{{ c.label }}</span></li></ul></div>
			</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" :disabled="!chosen.length" @click="apply">Apply</Btn></template>
		</Modal>`,
	}

	const STD = [{ type: 'list', label: 'List', icon: 'list' }, { type: 'group_by', label: 'Group by', icon: 'columns' }, { type: 'kanban', label: 'Kanban', icon: 'columns' }]
	const MODES = [{ value: 'list', label: 'List', icon: 'list' }, { value: 'grid', label: 'Grid', icon: 'grid2' }, { value: 'kanban', label: 'Kanban', icon: 'columns' }]

	V.Leads = {
		setup() {
			const data = ref(null); const loading = ref(true); const error = ref(''); const meta = reactive({ statuses: [], owners: [], linkable: [], can_create: false, can_delete: false, can_write: false })
			const view = reactive({ type: 'list', name: '', label: 'List' }) // the view being shown
			const p = reactive({ filters: {}, orderBy: 'modified desc', columns: null, rows: null, groupBy: 'lead_owner', columnField: 'status', titleField: null, kanbanFields: null, kanbanColumns: null, pageLength: 20 })
			const filterFields = ref([]); const sortFields = ref([]); const groupFields = ref([]); const quick = ref([])
			const picked = ref([]); const dlg = ref(''); const busy = ref(false); const creating = ref(false); const importing = ref(false)
			const quickVals = reactive({}); const search = ref(''); let seq = 0, timer

			function params() {
				const f = { ...BASE, ...p.filters }
				const body = { doctype: DOC, filters: f, order_by: p.orderBy, page_length: p.pageLength, page_length_count: 20, view: { custom_view_name: view.name || '', view_type: view.type, group_by_field: p.groupBy } }
				if (p.columns) body.columns = JSON.stringify(p.columns)
				if (p.rows) body.rows = JSON.stringify(p.rows)
				if (view.type === 'kanban') { body.column_field = p.columnField; if (p.titleField) body.title_field = p.titleField; if (p.kanbanFields) body.kanban_fields = JSON.stringify(p.kanbanFields); if (p.kanbanColumns) body.kanban_columns = JSON.stringify(p.kanbanColumns) }
				return body
			}
			async function load(keep) {
				const mine = ++seq; if (!keep) loading.value = true; error.value = ''
				try {
					const body = params()
					if (search.value.trim()) body.filters = { ...body.filters, lead_name: ['LIKE', '%' + search.value.trim() + '%'] }
					const r = await api('crm.api.doc.get_data', body)
					if (mine !== seq) return
					data.value = r; picked.value = []
					if (r.columns && !p.columns) p.columns = r.columns
					if (view.type === 'kanban') { p.columnField = r.column_field || p.columnField; p.titleField = r.title_field; p.kanbanFields = r.kanban_fields; p.kanbanColumns = r.kanban_columns.map((c) => ({ name: c.name, order: c.order, page_length: c.page_length || 20, column: c.column })) }
				} catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			const prefs = () => PRO.leadUtil.store.set('prefs', { columns: p.columns, orderBy: p.orderBy })
			const change = () => { prefs(); load() }

			onMounted(async () => {
				try {
					const [m, ff, sf, gf, qf] = await Promise.all([api('crm_addons.pro.leads.filter_options', {}), api('crm.api.doc.get_filterable_fields', { doctype: DOC }), api('crm.api.doc.sort_options', { doctype: DOC }), api('crm.api.doc.get_group_by_fields', { doctype: DOC }), api('crm.api.doc.get_quick_filters', { doctype: DOC })])
					Object.assign(meta, m); m.owners.forEach((o) => (PRO.users[o.name] = { name: o.name, full_name: o.full_name, image: o.image })); m.statuses.forEach((s) => (PRO.statusColors[s.name] = s.color))
					meta.linkable = ['CRM Lead Status', 'CRM Lead Source', 'CRM Territory', 'CRM Industry', 'CRM Organization', 'User', 'Country', 'Salutation', 'Gender']
					filterFields.value = ff; sortFields.value = sf; groupFields.value = gf; quick.value = qf
				} catch (e) { error.value = e.message }
								await load()
				applyStored()
			})
			function applyStored() {
				const v = currentView.value; if (v) applyView(v, true)
				const pr = PRO.leadUtil.store.get('prefs', null)
				if (pr) { if (pr.columns && pr.columns.length) { p.columns = pr.columns; p.rows = null } if (pr.orderBy) p.orderBy = pr.orderBy }
				load(true)
			}

			// ---- views
			const views = computed(() => (data.value ? data.value.views : []))
			const currentView = computed(() => views.value.find((v) => (view.name ? v.name === view.name : v.is_standard && v.type === view.type)))
			const grid = ref(PRO.leadUtil.store.get('grid', false))
			const mode = computed(() => (view.type === 'kanban' ? 'kanban' : grid.value ? 'grid' : 'list'))
			function setMode(m) {
				grid.value = m === 'grid'; PRO.leadUtil.store.set('grid', grid.value)
				if (m === 'kanban') pickView('std:kanban')
				else if (view.type === 'kanban') pickView('std:list')
				else if (view.type === 'group_by' && grid.value) { view.type = 'list'; load(true) }
			}
			function setGroup(f) { if (!f) { view.type = 'list'; load(true) } else { view.type = 'group_by'; p.groupBy = f; change() } }
			const groupPick = computed(() => [{ value: '', label: 'None' }, ...groupOpts.value])
			function applyView(v, quiet) {
				p.filters = jparse(v.filters, {}); p.orderBy = v.order_by || 'modified desc'
				p.columns = jparse(v.columns, null); p.rows = jparse(v.rows, null)
				p.groupBy = v.group_by_field || 'lead_owner'; p.columnField = v.column_field || 'status'; p.titleField = v.title_field || null
				p.kanbanFields = jparse(v.kanban_fields, null); p.kanbanColumns = jparse(v.kanban_columns, null)
				if (!p.columns || !p.columns.length) p.columns = null
				if (!quiet) { const pr = PRO.leadUtil.store.get('prefs', null); if (pr && view.type !== 'kanban') { if (pr.columns && pr.columns.length) { p.columns = pr.columns; p.rows = null } if (pr.orderBy) p.orderBy = pr.orderBy } load() }
			}
			function pickView(key) {
				picked.value = []
				if (key.startsWith('std:')) { const t = key.slice(4); view.type = t; view.name = ''; view.label = STD.find((s) => s.type === t).label }
				else return
				const v = currentView.value
				if (v) applyView(v)
				else { Object.assign(p, { filters: {}, orderBy: 'modified desc', columns: null, rows: null, kanbanFields: null, kanbanColumns: null, titleField: null }); load() }
			}
			// ---- filters, quick filters, sort, columns
			const nFilters = computed(() => describe(p.filters))
			// the date control (Date added / Follow-up due) and the status picker work on the same filters as the dialog
			const dateField = ref('creation'); const dateRange = ref({ preset: 'any', from: '', to: '' })
			const DATE_FIELDS = [{ id: 'creation', label: 'Date added' }, { id: 'next_follow_up_on', label: 'Follow-up due' }]
			function setDate(r, field) {
				if (field) dateField.value = field
				const f = { ...p.filters }; DATE_FIELDS.forEach((d) => delete f[d.id])
				const x = CM.resolveRange(r); if (x.from) f[dateField.value] = ['BETWEEN', [x.from, x.to || x.from]]
				p.filters = f; dateRange.value = r; change()
			}
			function syncDate() {
				for (const d of DATE_FIELDS) { const v = p.filters[d.id]; if (Array.isArray(v) && String(v[0]).toLowerCase() === 'between') { dateField.value = d.id; dateRange.value = { preset: 'custom', from: String(v[1][0]).slice(0, 10), to: String(v[1][1]).slice(0, 10) }; return } }
				dateRange.value = { preset: 'any', from: '', to: '' }
			}
			const statusSel = computed({
				get: () => { const v = p.filters.status; return Array.isArray(v) && String(v[0]).toLowerCase() === 'in' ? v[1] : (typeof v === 'string' ? [v] : []) },
				set: (vals) => { const f = { ...p.filters }; if (vals.length) f.status = ['IN', vals]; else delete f.status; p.filters = f; change() },
			})
			const statusOpts = computed(() => meta.statuses.map((s) => ({ value: s.name, label: s.name })))
			function applyFilters(f) { p.filters = f; dlg.value = ''; for (const k of Object.keys(quickVals)) delete quickVals[k]; syncDate(); change() }
			function clearAll() { p.filters = {}; search.value = ''; for (const k of Object.keys(quickVals)) delete quickVals[k]; dateRange.value = { preset: 'any', from: '', to: '' }; change() }
			function quickSet(q, v) {
				const f = { ...p.filters }
				if (v === '' || v == null) delete f[q.fieldname]
				else f[q.fieldname] = ['Data', 'Text', 'Small Text', 'Long Text'].includes(q.fieldtype) || q.fieldtype === 'Phone' ? ['LIKE', '%' + v + '%'] : v
				quickVals[q.fieldname] = v; p.filters = f; change()
			}
			const sortParts = computed(() => { const [f, d] = (p.orderBy || 'modified desc').split(' '); return { field: f, dir: d || 'desc' } })
			const sortOpts = computed(() => sortFields.value.map((f) => ({ value: f.fieldname, label: f.label })))
			function setSort(field, dir) { p.orderBy = field + ' ' + dir; change() }
			function applyColumns(cols) { p.columns = cols; p.rows = null; dlg.value = ''; change() }
			const colQ = computed(() => (data.value ? data.value.fields : []).map((f) => ({ ...f })))
			const quickFor = (q) => (q.fieldtype === 'Select' ? [{ value: '', label: 'Any' }, ...String(q.options || '').split('\n').filter(Boolean).map((o) => ({ value: o, label: o }))] : null)
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300) })
			const groupOpts = computed(() => groupFields.value.map((f) => ({ value: f.fieldname, label: f.label })))
			const groupName = computed(() => (data.value && data.value.group_by_field && data.value.group_by_field.fieldname) || p.groupBy)

			// ---- list rows
			const vt = computed(() => (data.value && data.value.view_type ? data.value.view_type : view.type))
			const rows = computed(() => (data.value && vt.value !== 'kanban' ? data.value.data : []))
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
			const more = () => { p.pageLength += 20; load(true) }
			const open = (n) => { location.hash = '#/leads/' + encodeURIComponent(n) }
			const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => picked.value.includes(r.name)))
			const flipAll = () => { picked.value = allOn.value ? [] : rows.value.map((r) => r.name) }
			const flip = (n) => { picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n] }
			const ago = (s) => PRO.ago(s)
			const assignees = (r) => jparse(r._assign, [])
			const slaTone = (s) => ({ Fulfilled: 'green', 'Failed': 'red', 'First Response Due': 'amber', 'Paused': 'neutral' }[s] || 'neutral')
			const colWidth = (c) => ({ width: c.width || '10rem', minWidth: c.width || '10rem' })

			// ---- bulk actions
			const assignUsers = ref([]); const assignOpts = computed(() => meta.owners.map((o) => ({ value: o.name, label: o.full_name })))
			async function bulk(kind) {
				busy.value = true
				try {
					const names = JSON.stringify(picked.value)
					if (kind === 'delete') {
						if (!(await CM.confirm({ title: 'Delete ' + picked.value.length + (picked.value.length === 1 ? ' lead?' : ' leads?'), message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return
						await api('crm.api.doc.delete_bulk_docs', { doctype: DOC, items: names, delete_linked: false })
					} else if (kind === 'clear') await api('frappe.desk.form.assign_to.remove_multiple', { doctype: DOC, names, ignore_permissions: true })
					else if (kind === 'assign') { await api('frappe.desk.form.assign_to.add_multiple', { doctype: DOC, name: names, assign_to: JSON.stringify(assignUsers.value), bulk_assign: true, re_assign: true }); assignUsers.value = []; dlg.value = '' }
					else if (kind === 'convert') { if (!(await CM.confirm({ title: 'Convert ' + picked.value.length + ' to deals?', confirmText: 'Convert' }))) return; for (const n of picked.value) await api('crm.fcrm.doctype.crm_lead.crm_lead.convert_to_deal', { lead: n }) }
					CM.toast('Done'); await load(true)
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}

			// ---- kanban
			const drag = reactive({ name: '', over: '' })
			const board = computed(() => (data.value && vt.value === 'kanban' ? data.value.data.filter((c) => c && c.column) : []))
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
			async function exportCsv() {
				exporting.value = true
				try {
					const cols = await api('crm_addons.pro.form.export_columns', {})
					const f = { ...BASE, ...p.filters }; if (picked.value.length) f.name = ['IN', picked.value]
					const r = await api('crm.api.doc.get_data', { doctype: DOC, filters: f, order_by: p.orderBy, page_length: 20000, page_length_count: 20, columns: JSON.stringify(cols.map((c) => ({ label: c.label, type: 'Data', key: c.key }))), rows: JSON.stringify(cols.map((c) => c.key)), view: { view_type: 'list' } })
					const cell = (v) => { let t = v == null ? '' : String(v); if (/^[=@-]/.test(t) || (t.startsWith('+') && !/^\+[\d\s-]*$/.test(t))) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"' }
					const text = [cols.map((c) => cell(c.label)).join(','), ...r.data.map((row) => cols.map((c) => cell(row[c.key])).join(','))].join('\r\n')
					csvDownload(text, 'leads-' + iso(new Date()) + '.csv')
					CM.toast(r.data.length + (r.data.length === 1 ? ' lead' : ' leads') + ' exported' + (r.total_count > r.data.length ? ' (the first 20,000; narrow the filters for the rest)' : ''))
				} catch (e) { CM.toast(e.message, 'err') } finally { exporting.value = false }
			}
			const sortDirOpts = [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]
			return { statusSel, statusOpts, dateField, dateRange, DATE_FIELDS, setDate, clearAll, MODES, grid, mode, setMode, setGroup, groupPick, vt, data, loading, error, meta, view, p, picked, dlg, busy, creating, importing, quickVals, search, load, nFilters, applyFilters, quick, quickSet, quickFor, filterFields, sortParts, sortOpts, setSort, sortDirOpts, applyColumns, colQ, groupOpts, groupName, rows, columns, groups, total, more, open, allOn, flipAll, flip, ago, assignees, slaTone, colWidth, assignOpts, assignUsers, bulk, drag, board, drop, colMore, cardFields, fieldLabel, exporting, exportCsv, change, TIME_KEYS, PRO, CM }
		},
		template: `
		<div class="page leads">
			<div class="pg-head"><div class="grow"><h1>Leads</h1><p class="muted small">{{ loading && !data ? '' : total + (total === 1 ? ' lead' : ' leads') }}</p></div>
				<div class="actions">
					<Seg :modelValue="mode" :options="MODES" @update:modelValue="setMode" />
					<Btn icon="download" :loading="exporting" title="Download every field of the leads (the selected ones, or all of these filters) as CSV" aria-label="Export leads" @click="exportCsv" />
					<Btn v-if="meta.can_create" icon="upload" title="Upload leads from a CSV file" aria-label="Upload leads" @click="importing = true" />
					<Btn v-if="meta.can_create" variant="primary" icon="plus" @click="creating = true">Create</Btn>
				</div>
			</div>

			<section class="card fbar">
				<div class="row wrap" style="gap:8px">
					<div class="grow" style="min-width:200px"><Inp v-model="search" icon="search" placeholder="Search by name..." clearable aria-label="Search leads" /></div>
					<DateRange v-model="dateRange" any aria-label="Date" @change="(r) => setDate(r)">
						<template #top><div class="dr-tabs row" style="gap:6px;padding:8px 12px 0"><button v-for="d in DATE_FIELDS" :key="d.id" type="button" class="btn sm" :class="{ on: dateField === d.id }" @click="dateField = d.id">{{ d.label }}</button></div></template>
					</DateRange>
					<div style="width:200px"><MultiPick v-model="statusSel" :options="statusOpts" label="Status" searchable /></div>
					<button type="button" class="btn" :class="{ on: nFilters }" @click="dlg = 'filter'"><Ico name="filter" /> Filters<span v-if="nFilters" class="n">{{ nFilters }}</span></button>
					<Btn v-if="nFilters || search" variant="ghost" @click="clearAll">Clear</Btn>
				</div>
				<div v-if="quick.length" class="row wrap fchips" style="gap:8px">
					<template v-for="q in quick.filter((x) => x.fieldname !== 'status')" :key="q.fieldname">
						<div v-if="q.fieldtype === 'Select'" style="width:150px"><Dd :modelValue="quickVals[q.fieldname] || ''" :options="quickFor(q)" :prefix="q.label + ':'" :aria-label="q.label" @update:modelValue="(v) => quickSet(q, v)" /></div>
						<div v-else-if="q.fieldtype === 'Link' && ['CRM Lead Status', 'CRM Lead Source', 'CRM Territory', 'CRM Industry', 'User', 'CRM Organization'].includes(q.options)" style="width:170px"><LinkPick :modelValue="quickVals[q.fieldname] || ''" :doctype="q.options" :label="q.label" @update:modelValue="(v) => quickSet(q, v)" /></div>
						<div v-else style="width:150px"><input class="inp" :placeholder="q.label" :value="quickVals[q.fieldname] || ''" :aria-label="q.label" @input="quickSet(q, $event.target.value)" /></div>
					</template>
				</div>
			</section>

			<div v-if="picked.length" class="card bulk" role="region" aria-label="Selected leads">
				<b>{{ picked.length }} selected</b>
				<Btn size="sm" @click="dlg = 'assign'">Assign to</Btn><Btn size="sm" :loading="busy" @click="bulk('clear')">Clear assignment</Btn><Btn size="sm" :loading="busy" @click="bulk('convert')">Convert to deal</Btn>
				<div class="grow"></div><Btn v-if="meta.can_delete" size="sm" variant="danger" icon="trash" :loading="busy" @click="bulk('delete')">Delete</Btn><Btn size="sm" variant="ghost" @click="picked = []">Cancel</Btn>
			</div>

			<ErrorState v-if="error" :message="error" @retry="load()" />
			<div v-else-if="loading && !data" class="card" style="padding:0"><div v-for="n in 8" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>

			<section v-else-if="data" class="card listcard" :style="{ opacity: loading ? .6 : 1 }">
				<div class="lbar row wrap" style="gap:8px">
					<span class="small muted grow">{{ vt === 'kanban' ? total + (total === 1 ? ' lead' : ' leads') : (rows.length ? 'Showing 1\u2013' + rows.length + ' of ' + total + ' leads' : '0 leads') }}</span>
					<Btn size="sm" icon="refresh" aria-label="Refresh" @click="load(true)">Refresh</Btn>
					<template v-if="true">
						<div style="width:200px"><Dd :modelValue="sortParts.field" :options="sortOpts" searchable prefix="Sort by" aria-label="Sort by" @update:modelValue="(f) => setSort(f, sortParts.dir)" /></div>
						<Btn size="sm" :icon="sortParts.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :aria-label="sortParts.dir === 'asc' ? 'Ascending' : 'Descending'" @click="setSort(sortParts.field, sortParts.dir === 'asc' ? 'desc' : 'asc')" />
						<Btn v-if="vt !== 'kanban' && !grid" size="sm" icon="columns" title="Columns" aria-label="Columns" @click="dlg = 'columns'" />
					</template>
				</div>
				<template v-if="vt !== 'kanban'">
					<Empty v-if="!rows.length" icon="users" title="No leads here" :text="nFilters || search ? 'No lead matches these filters.' : 'There are no leads yet.'"><Btn v-if="nFilters || search" @click="applyFilters({}); search = ''">Clear filters</Btn></Empty>
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
					<div v-if="rows.length" class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)"><span class="small muted">{{ rows.length }} of {{ total }}</span><div class="grow"></div><Btn v-if="rows.length < total" size="sm" :loading="loading" @click="more">Load more</Btn></div>
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

			<FilterDialog v-if="dlg === 'filter'" :fields="filterFields" :filters="p.filters" :linkable="meta.linkable" @close="dlg = ''" @apply="applyFilters" />
			<ColumnsDialog v-if="dlg === 'columns' && data" :fields="colQ" :columns="columns" @close="dlg = ''" @apply="applyColumns" />
			<Modal v-if="dlg === 'assign'" title="Assign to" size="sm" @close="dlg = ''"><Field label="People"><MultiPick v-model="assignUsers" :options="assignOpts" label="Choose people" searchable /></Field>
				<template #foot><Btn @click="dlg = ''">Cancel</Btn><Btn variant="primary" :loading="busy" :disabled="!assignUsers.length" @click="bulk('assign')">Assign</Btn></template></Modal>
			<ImportLeads v-if="importing" @close="importing = false" @done="importing = false; load(true)" />
			<NewLead v-if="creating" :opts="meta" @close="creating = false" @created="(n) => { creating = false; open(n) }" />
		</div>`,
	}
})()
