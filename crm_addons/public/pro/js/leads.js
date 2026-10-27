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
		{ id: 'source', label: 'Source' },
		{ id: 'lead_owner', label: 'Assigned to' },
		{ id: 'next_follow_up_on', label: 'Next follow-up', sort: 'next_follow_up_on' },
		{ id: 'creation', label: 'Added', sort: 'creation' },
	]
	const DEFAULT_COLS = ['lead_name', 'organization', 'mobile_no', 'status', 'lead_owner', 'next_follow_up_on', 'creation']
	const store = {
		get(k, d) { try { const v = localStorage.getItem('pro_leads_' + k); return v === null ? d : JSON.parse(v) } catch (e) { return d } },
		set(k, v) { try { localStorage.setItem('pro_leads_' + k, JSON.stringify(v)) } catch (e) { /* not remembered */ } },
	}
	const EMPTY = () => ({ status: [], source: [], territory: [], organization: [], lead_owner: [], from: '', to: '', followup: '' })
	const when = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + (String(s).length > 10 ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') }
	const overdue = (s) => !!s && new Date(String(s).replace(' ', 'T')) < new Date()

	V.Leads = {
		setup() {
			const opts = reactive({ statuses: [], sources: [], territories: [], organizations: [], owners: [], can_write: false, can_create: false, can_delete: false })
			const filters = reactive(EMPTY()); const search = ref(''); const scope = ref(store.get('scope', 'all'))
			const mode = ref(store.get('mode', 'table')); const perPage = ref(store.get('perPage', 25)); const cols = ref(store.get('cols', DEFAULT_COLS))
			const sort = reactive({ by: 'creation', dir: 'desc' }); const page = ref(1)
			const rows = ref([]); const total = ref(0); const board = ref([]); const loading = ref(true); const error = ref('')
			const picked = ref([]); const views = ref(store.get('views', []))
			const showMore = ref(false)
			let timer, seq = 0

			const query = () => ({ filters: JSON.stringify(filters), search: search.value || undefined, scope: scope.value })
			async function load() {
				const mine = ++seq; loading.value = true; error.value = ''
				try {
					const r = await CM.call('crm_addons.pro.leads.list_leads', { ...query(), order_by: sort.by, order_dir: sort.dir, start: (page.value - 1) * perPage.value, page_length: perPage.value })
					if (mine !== seq) return
					rows.value = r.rows; total.value = r.total
					picked.value = []
				} catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			async function loadBoard() {
				const mine = ++seq; loading.value = true; error.value = ''
				try { const b = await CM.call('crm_addons.pro.leads.board', query()); if (mine === seq) board.value = b } catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			const refresh = () => (mode.value === 'board' ? loadBoard() : load())
			onMounted(async () => {
				try { Object.assign(opts, await CM.call('crm_addons.pro.leads.filter_options', {})); opts.statuses.forEach((s) => (PRO.statusColors[s.name] = s.color)) } catch (e) { error.value = e.message }
				refresh()
			})
			watch(filters, () => { page.value = 1; refresh() }, { deep: true })
			watch([scope, mode, perPage], () => { page.value = 1; store.set('scope', scope.value); store.set('mode', mode.value); store.set('perPage', perPage.value); refresh() })
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; refresh() }, 300) })
			watch(cols, () => store.set('cols', cols.value))

			const activeCount = computed(() => ['status', 'source', 'territory', 'organization', 'lead_owner'].filter((k) => filters[k].length).length + (filters.from || filters.to ? 1 : 0) + (filters.followup ? 1 : 0))
			const clear = () => { Object.assign(filters, EMPTY()); search.value = '' }
			function sortBy(c) { if (!c.sort) return; if (sort.by === c.sort) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.by = c.sort; sort.dir = 'asc' } page.value = 1; load() }
			const pages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))
			const go = (n) => { page.value = Math.min(pages.value, Math.max(1, n)); load() }
			const visible = computed(() => COLS.filter((c) => cols.value.includes(c.id)))
			const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => picked.value.includes(r.name)))
			const flipAll = () => { picked.value = allOn.value ? [] : rows.value.map((r) => r.name) }
			const flip = (n) => { picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n] }
			const open = (n) => { location.hash = '#/leads/' + encodeURIComponent(n) }

			// bulk actions
			const bulk = reactive({ status: '', owner: '', busy: false })
			async function applyBulk(kind) {
				const v = kind === 'status' ? bulk.status : bulk.owner; if (!v) return
				bulk.busy = true
				try {
					const r = await CM.call('crm_addons.pro.leads.bulk_update', { names: JSON.stringify(picked.value), [kind]: v })
					CM.toast(r.done + (r.done === 1 ? ' lead updated' : ' leads updated') + (r.failed.length ? '; ' + r.failed.length + ' could not be changed' : ''), r.failed.length ? 'warn' : 'ok')
					bulk.status = ''; bulk.owner = ''; await refresh()
				} catch (e) { CM.toast(e.message, 'err') } finally { bulk.busy = false }
			}
			async function removeBulk() {
				if (!(await CM.confirm({ title: 'Delete ' + picked.value.length + (picked.value.length === 1 ? ' lead?' : ' leads?'), message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return
				try { const r = await CM.call('crm_addons.pro.leads.bulk_delete', { names: JSON.stringify(picked.value) }); CM.toast(r.done + ' deleted' + (r.failed.length ? '; ' + r.failed.length + ' could not be deleted' : '')); await refresh() } catch (e) { CM.toast(e.message, 'err') }
			}

			// board: drag a card to another status
			const drag = reactive({ name: '', over: '' })
			async function drop(status) {
				const name = drag.name; drag.name = ''; drag.over = ''; if (!name) return
				const from = board.value.find((c) => c.rows.some((r) => r.name === name)); if (!from || from.name === status) return
				const card = from.rows.find((r) => r.name === name)
				from.rows = from.rows.filter((r) => r.name !== name); from.count--
				const to = board.value.find((c) => c.name === status); to.rows.unshift({ ...card, status }); to.count++
				try { await CM.call('crm_addons.pro.leads.set_status', { name, status }) } catch (e) { CM.toast(e.message, 'err'); loadBoard() }
			}

			// saved views (kept in this browser)
			const viewName = ref('')
			const saveView = () => {
				const n = viewName.value.trim(); if (!n) return
				views.value = [...views.value.filter((v) => v.name !== n), { name: n, filters: JSON.parse(JSON.stringify(filters)), scope: scope.value, mode: mode.value }]
				store.set('views', views.value); viewName.value = ''; CM.toast('View saved')
			}
			const applyView = (v) => { Object.assign(filters, EMPTY(), v.filters); scope.value = v.scope || 'all'; mode.value = v.mode || 'table' }
			const dropView = (v) => { views.value = views.value.filter((x) => x.name !== v.name); store.set('views', views.value) }

			const statusOpts = computed(() => opts.statuses.map((s) => ({ value: s.name, label: s.name })))
			const ownerOpts = computed(() => [{ value: '__none__', label: 'Unassigned' }, ...opts.owners.map((o) => ({ value: o.name, label: o.full_name }))])
			const assignOpts = computed(() => [{ value: '__none__', label: 'Nobody (unassign)' }, ...opts.owners.map((o) => ({ value: o.name, label: o.full_name }))])
			const scopeOpts = [{ value: 'all', label: 'All leads' }, { value: 'mine', label: 'My leads' }, { value: 'team', label: 'My team' }]
			const followOpts = [{ value: '', label: 'Any follow-up' }, { value: 'due', label: 'Follow-up due' }, { value: 'none', label: 'No follow-up planned' }]
			const colOpts = COLS.map((c) => ({ value: c.id, label: c.label }))
			return { opts, filters, search, scope, mode, perPage, cols, sort, page, rows, total, board, loading, error, picked, views, showMore, activeCount, clear, sortBy, pages, go, visible, allOn, flipAll, flip, open, bulk, applyBulk, removeBulk, drag, drop, viewName, saveView, applyView, dropView, statusOpts, ownerOpts, assignOpts, scopeOpts, followOpts, colOpts, refresh, when, overdue, PRO, CM }
		},
		template: `
		<div class="page leads">
			<div class="pg-head"><div class="grow"><h1>Leads</h1><p class="muted small" v-if="mode === 'table' && !loading">{{ total }} {{ total === 1 ? 'lead' : 'leads' }}</p></div>
				<div class="actions">
					<div class="seg" role="group" aria-label="View"><button type="button" :class="{ on: mode === 'table' }" :aria-pressed="String(mode === 'table')" @click="mode = 'table'"><Ico name="list" /> List</button><button type="button" :class="{ on: mode === 'board' }" :aria-pressed="String(mode === 'board')" @click="mode = 'board'"><Ico name="columns" /> Board</button></div>
					<a v-if="opts.can_create" class="btn primary" href="/crm/leads" target="_blank" rel="noopener"><Ico name="plus" /> New lead</a>
				</div>
			</div>
			<div class="row wrap tools" style="gap:8px">
				<div style="width:min(300px,100%)"><Inp v-model="search" icon="search" placeholder="Search name, phone, email, organization" clearable aria-label="Search leads" /></div>
				<div style="width:140px"><Dd v-model="scope" :options="scopeOpts" size="sm" aria-label="Whose leads" /></div>
				<div style="width:150px"><MultiPick v-model="filters.status" :options="statusOpts" label="Status" /></div>
				<div style="width:190px"><MultiPick v-model="filters.lead_owner" :options="ownerOpts" label="Assigned to" searchable /></div>
				<button type="button" class="fchip" :class="{ on: showMore }" @click="showMore = !showMore"><Ico name="filter" size="sm" /> More filters<span v-if="activeCount" class="n">{{ activeCount }}</span></button>
				<button v-if="activeCount || search" type="button" class="btn ghost sm" @click="clear">Clear</button>
				<div class="grow"></div>
			</div>
			<div v-if="views.length" class="chips" aria-label="Saved views"><span v-for="v in views" :key="v.name" class="fchip"><span role="button" tabindex="0" style="cursor:pointer" @click="applyView(v)" @keydown.enter="applyView(v)"><Ico name="bookmark" size="sm" /> {{ v.name }}</span><button type="button" class="x" :aria-label="'Delete view ' + v.name" @click="dropView(v)"><Ico name="x" size="sm" /></button></span></div>
			<div v-if="showMore" class="card more-filters">
				<div style="width:160px"><MultiPick v-model="filters.source" :options="opts.sources" label="Source" /></div>
				<div style="width:170px"><MultiPick v-model="filters.territory" :options="opts.territories" label="Territory" /></div>
				<div style="width:200px"><MultiPick v-model="filters.organization" :options="opts.organizations" label="Organization" searchable /></div>
				<div style="width:190px"><Dd v-model="filters.followup" :options="followOpts" size="sm" aria-label="Follow-up" /></div>
				<label class="small muted row" style="gap:6px">Added from <input class="inp sm" type="date" v-model="filters.from" aria-label="Added from" /></label>
				<label class="small muted row" style="gap:6px">to <input class="inp sm" type="date" v-model="filters.to" aria-label="Added to" /></label>
				<div v-if="mode === 'table'" style="width:150px"><MultiPick v-model="cols" :options="colOpts" label="Columns" /></div>
				<div class="row" style="gap:6px;margin-left:auto"><input class="inp sm" v-model="viewName" placeholder="Name this view" aria-label="View name" @keydown.enter="saveView" style="width:150px" /><Btn size="sm" icon="bookmark" :disabled="!viewName.trim()" @click="saveView">Save view</Btn></div>
			</div>

			<div v-if="picked.length" class="card bulk" role="region" aria-label="Selected leads">
				<b>{{ picked.length }} selected</b>
				<div style="width:190px"><Dd v-model="bulk.owner" :options="assignOpts" placeholder="Assign to..." size="sm" searchable aria-label="Assign to" :disabled="!opts.can_write" /></div><Btn size="sm" :disabled="!bulk.owner" :loading="bulk.busy" @click="applyBulk('owner')">Assign</Btn>
				<div style="width:170px"><Dd v-model="bulk.status" :options="statusOpts" placeholder="Set status..." size="sm" aria-label="Set status" :disabled="!opts.can_write" /></div><Btn size="sm" :disabled="!bulk.status" :loading="bulk.busy" @click="applyBulk('status')">Apply</Btn>
				<div class="grow"></div><Btn v-if="opts.can_delete" size="sm" variant="danger" icon="trash" @click="removeBulk">Delete</Btn><Btn size="sm" variant="ghost" @click="picked = []">Cancel</Btn>
			</div>

			<ErrorState v-if="error" :message="error" @retry="refresh()" />
			<div v-else-if="loading && !(mode === 'table' ? rows.length : board.length)" class="card" style="padding:0"><div v-for="n in 8" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>

			<template v-else-if="mode === 'table'">
				<Empty v-if="!rows.length" icon="users" title="No leads here" :text="activeCount || search ? 'No lead matches these filters.' : 'There are no leads yet.'"><Btn v-if="activeCount || search" @click="clear">Clear filters</Btn></Empty>
				<div v-else class="card" style="padding:0" :style="{ opacity: loading ? .6 : 1 }">
					<div class="table-wrap"><table class="tbl">
						<thead><tr>
							<th style="width:36px"><input type="checkbox" :checked="allOn" aria-label="Select all on this page" @change="flipAll" /></th>
							<th v-for="c in visible" :key="c.id" :class="{ sort: c.sort, on: sort.by === c.sort }" @click="sortBy(c)" :aria-sort="sort.by === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null">{{ c.label }}<Ico v-if="sort.by === c.sort" :name="sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'" size="sm" /></th>
						</tr></thead>
						<tbody>
							<tr v-for="r in rows" :key="r.name" class="click" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
								<td @click.stop><input type="checkbox" :checked="picked.includes(r.name)" :aria-label="'Select ' + r.display_name" @change="flip(r.name)" /></td>
								<td v-for="c in visible" :key="c.id">
									<div v-if="c.id === 'lead_name'" class="row" style="gap:10px"><Pic :name="r.display_name" :image="r.image" :size="30" /><div style="min-width:0"><b class="ellipsis" style="display:block;max-width:240px">{{ r.display_name }}</b><span v-if="r.job_title" class="small muted">{{ r.job_title }}</span></div></div>
									<StatusTag v-else-if="c.id === 'status'" :status="r.status" />
									<div v-else-if="c.id === 'lead_owner'" class="row" style="gap:8px"><template v-if="r.lead_owner"><Pic :name="r.owner_name" :image="r.owner_image" :size="22" /><span>{{ r.owner_name }}</span></template><span v-else class="faint">Unassigned</span></div>
									<span v-else-if="c.id === 'next_follow_up_on'" :class="{ 'overdue': overdue(r.next_follow_up_on) }">{{ when(r.next_follow_up_on) || '-' }}</span>
									<span v-else-if="c.id === 'creation'" class="muted">{{ PRO.ago(r.creation) }}</span>
									<span v-else>{{ r[c.id] || '-' }}</span>
								</td>
							</tr>
						</tbody>
					</table></div>
					<div class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)">
						<span class="small muted">{{ (page - 1) * perPage + 1 }}-{{ Math.min(total, page * perPage) }} of {{ total }}</span><div class="grow"></div>
						<div style="width:110px"><Dd v-model="perPage" :options="[{ value: 10, label: '10 / page' }, { value: 25, label: '25 / page' }, { value: 50, label: '50 / page' }, { value: 100, label: '100 / page' }]" size="sm" aria-label="Rows per page" /></div>
						<Btn size="sm" icon="chevron-left" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)" /><span class="small">{{ page }} / {{ pages }}</span><Btn size="sm" icon="chevron-right" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)" />
					</div>
				</div>
			</template>

			<div v-else class="board" :style="{ opacity: loading ? .6 : 1 }">
				<section v-for="c in board" :key="c.name" class="col" :class="{ over: drag.over === c.name }" :aria-label="c.name"
					@dragover.prevent="drag.over = c.name" @dragleave="drag.over = ''" @drop.prevent="drop(c.name)">
					<header><span class="badge" :class="PRO.statusTone(c.color)">{{ c.name }}</span><span class="small muted">{{ c.count }}</span></header>
					<div v-for="r in c.rows" :key="r.name" class="kcard" draggable="true" tabindex="0" @dragstart="drag.name = r.name" @dragend="drag.name = ''; drag.over = ''" @click="open(r.name)" @keydown.enter="open(r.name)">
						<div class="row" style="gap:8px"><Pic :name="r.display_name" :image="r.image" :size="26" /><b class="ellipsis grow">{{ r.display_name }}</b></div>
						<div v-if="r.organization && r.organization !== r.display_name" class="small muted ellipsis">{{ r.organization }}</div>
						<div v-if="r.mobile_no" class="small">{{ r.mobile_no }}</div>
						<div class="row small muted" style="gap:6px;justify-content:space-between"><span v-if="r.lead_owner" class="row" style="gap:5px"><Pic :name="r.owner_name" :image="r.owner_image" :size="18" />{{ r.owner_name }}</span><span v-else class="faint">Unassigned</span><span :class="{ overdue: overdue(r.next_follow_up_on) }">{{ r.next_follow_up_on ? when(r.next_follow_up_on) : '' }}</span></div>
					</div>
					<div v-if="c.count > c.rows.length" class="small muted" style="padding:6px 4px">+ {{ c.count - c.rows.length }} more. Use the filters to narrow the list.</div>
					<div v-if="!c.rows.length" class="small faint" style="padding:10px 4px">No leads</div>
				</section>
			</div>
		</div>`,
	}
})()
