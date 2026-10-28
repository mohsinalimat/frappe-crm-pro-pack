/* Suite Pro: Leads setup. An admin sets, for everybody, what the Leads screen starts with (default view, the controls of the top row, the filters under the
   Filter icon, the columns, the sorting) and which fields the new-lead form asks for. A live preview shows the result as they change it. */
(() => {
	const { ref, reactive, computed, onMounted, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.config.' + m, a)

	/** A list of rows that are reordered by dragging the grip and removed with the cross. Optional per-row extra (slot). */
	V.DragList = {
		props: { modelValue: Array, empty: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const from = ref(-1); const over = ref(-1)
			function drop(j) { const i = from.value; from.value = over.value = -1; if (i < 0 || i === j) return; const a = [...props.modelValue]; a.splice(j, 0, a.splice(i, 1)[0]); emit('update:modelValue', a) }
			return { from, over, drop, remove: (i) => emit('update:modelValue', props.modelValue.filter((_, k) => k !== i)) }
		},
		template: `
		<ul class="list dl">
			<li v-for="(it, i) in modelValue" :key="it.key" class="row li dragrow" :class="{ over: over === i && from !== i }" style="gap:8px;padding:6px 0" draggable="true" @dragstart="from = i" @dragend="from = over = -1" @dragover.prevent="over = i" @drop.prevent="drop(i)">
				<span class="grip" aria-hidden="true"><Ico name="grip" /></span><span class="grow">{{ it.label }}</span><slot :item="it" />
				<Btn size="sm" variant="ghost" icon="x" :aria-label="'Remove ' + it.label" title="Remove" @click="remove(i)" />
			</li>
			<li v-if="!modelValue.length" class="small faint" style="padding:8px 0">{{ empty }}</li>
		</ul>`,
	}

	V.LeadSetup = {
		setup() {
			const hdr = ref(false); onMounted(() => nextTick(() => (hdr.value = true))) // the Save button sits in the page header, which is there once the page is mounted
			const loading = ref(true); const error = ref(''); const busy = ref(false)
			const ch = reactive({ list: [], form: [] })
			const c = reactive({ default_view: 'list', show_date: true, show_status: true, filters: [], top_filters: [], columns: null, sort: 'modified desc', create_fields: null })
			const byL = computed(() => Object.fromEntries(ch.list.map((f) => [f.fieldname, f])))
			const byF = computed(() => Object.fromEntries(ch.form.map((f) => [f.fieldname, f])))
			const item = (k) => ({ key: k, label: (byL.value[k] || {}).label || k })
			// the three lists, as {key, label} rows
			const filters = computed({ get: () => c.filters.map(item), set: (v) => (c.filters = v.map((x) => x.key)) })
			const columns = computed({ get: () => (c.columns || []).map(item), set: (v) => (c.columns = v.map((x) => x.key)) })
			const fform = computed({ get: () => (c.create_fields || []).map((r) => ({ key: r.fieldname, label: (byF.value[r.fieldname] || {}).label || r.fieldname, reqd: r.reqd, locked: !!(byF.value[r.fieldname] || {}).reqd })), set: (v) => (c.create_fields = v.map((x) => ({ fieldname: x.key, reqd: x.reqd }))) })
			const addable = (have, pool, skip) => [{ value: '', label: 'Add a field' }, ...pool.filter((f) => !have.includes(f.fieldname) && !(skip || []).includes(f.fieldname)).map((f) => ({ value: f.fieldname, label: f.label }))]
			const pickable = computed(() => ch.list.filter((f) => !['status', 'name', '_assign'].includes(f.fieldname) && f.fieldtype !== 'Text'))
			const filterAdd = computed(() => addable(c.filters, pickable.value, c.top_filters))
			const topAdd = computed(() => addable(c.top_filters, pickable.value, c.filters))
			const tops = computed({ get: () => c.top_filters.map(item), set: (v) => (c.top_filters = v.map((x) => x.key)) })
			const addTop = (k) => k && c.top_filters.push(k)
			const colAdd = computed(() => addable(c.columns || [], ch.list))
			const formAdd = computed(() => addable((c.create_fields || []).map((r) => r.fieldname), ch.form))
			const sortOpts = computed(() => ch.list.filter((f) => !['Long Text', 'Text', 'Small Text'].includes(f.fieldtype)).map((f) => ({ value: f.fieldname, label: f.label })))
			const sortParts = computed(() => { const [f, d] = c.sort.split(' '); return { f, d: d || 'desc' } })
			const VIEWS = [{ value: 'list', label: 'List', icon: 'list' }, { value: 'kanban', label: 'Kanban', icon: 'columns' }, { value: 'grid', label: 'Grid', icon: 'grid2' }]
			const addFilter = (k) => k && c.filters.push(k)
			const addCol = (k) => { if (!k) return; if (!c.columns) c.columns = ['lead_name', 'status']; c.columns.push(k) }
			const addForm = (k) => { if (!k) return; if (!c.create_fields) c.create_fields = []; c.create_fields.push({ fieldname: k, reqd: 0 }) }
			function useCrmForm() { c.create_fields = null }
			function startForm() { c.create_fields = ['first_name', 'last_name', 'email', 'mobile_no', 'organization', 'status'].filter((k) => byF.value[k]).map((k) => ({ fieldname: k, reqd: k === 'first_name' ? 1 : 0 })) }
			onMounted(async () => {
				try {
					const [cfg, choices] = await Promise.all([call('get_config', {}), call('choices', {})])
					Object.assign(ch, choices); Object.assign(c, cfg, { show_date: !!cfg.show_date, show_status: !!cfg.show_status })
				} catch (e) { error.value = e.message } finally { loading.value = false }
			})
			async function save() {
				busy.value = true
				try {
					await call('save_config', { config: JSON.stringify({ ...c, show_date: c.show_date ? 1 : 0, show_status: c.show_status ? 1 : 0 }) })
					try { localStorage.removeItem('pro_leads_prefs'); localStorage.removeItem('pro_leads_mode') } catch (e) { /* not stored */ }
					CM.toast('Saved. The Leads screen now starts like this for everybody.')
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			return { hdr, tops, topAdd, addTop, loading, error, busy, c, filters, columns, fform, filterAdd, colAdd, formAdd, sortOpts, sortParts, VIEWS, addFilter, addCol, addForm, useCrmForm, startForm, save, item, byL, PRO }
		},
		template: `
		<div class="page">
			<Teleport v-if="hdr" to="#hdr-ctl"><Btn variant="primary" :loading="busy" :disabled="loading" @click="save">Save</Btn></Teleport>
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<section class="card" style="padding:16px 18px" aria-label="Preview">
					<b>Preview</b>
					<div class="prev">
						<div class="row" style="gap:8px;flex-wrap:wrap"><span class="lp grow">Search anything: name, email, phone ...</span><span v-if="c.show_date" class="lp">Any time</span><span v-if="c.show_status" class="lp">Status</span><span v-for="f in tops" :key="f.key" class="lp">{{ f.label }}</span><span class="lp ico" title="Filter icon" aria-label="Filter icon"><Ico name="filter" size="sm" /></span></div>
						<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><span v-for="f in filters" :key="f.key" class="lp">{{ f.label }}</span><span class="lp dash">+ Custom filter</span></div>
						<div class="lp-tbl"><span v-for="col in (columns.length ? columns : [{ key: 'a', label: 'CRM default columns' }])" :key="col.key">{{ col.label }}</span></div>
					</div>
					<p class="small muted" style="margin:6px 0 0">Starts in <b>{{ c.default_view }}</b> view, sorted by <b>{{ (byL[sortParts.f] || {}).label || sortParts.f }}</b> ({{ sortParts.d === 'asc' ? 'oldest or A to Z first' : 'newest or Z to A first' }}).</p>
				</section>

				<section class="card" style="padding:16px 18px"><b>Default view</b>
					<div style="margin-top:8px"><Seg v-model="c.default_view" :options="VIEWS" /></div></section>

				<section class="card" style="padding:16px 18px"><b>Top row</b><p class="small muted" style="margin:2px 0 8px">Search is always there. Choose what else sits next to it; the more you add, the narrower search gets.</p>
					<div class="row" style="gap:10px;padding:4px 0"><Switch v-model="c.show_date" label="Date picker" /><span>Date picker (date added, follow-up due)</span></div>
					<div class="row" style="gap:10px;padding:4px 0"><Switch v-model="c.show_status" label="Status" /><span>Status</span></div>
					<DragList v-model="tops" empty="" />
					<div style="width:240px;margin-top:8px"><Dd modelValue="" :options="topAdd" searchable placeholder="Add to the top row" aria-label="Add a field to the top row" @update:modelValue="addTop" /></div></section>

				<section class="card" style="padding:16px 18px"><b>Default filters</b><p class="small muted" style="margin:2px 0 8px">Shown in the second row when someone clicks the filter icon. Anything else can still be filtered with Custom filter.</p>
					<DragList v-model="filters" empty="No default filters: only Custom filter shows." />
					<div style="width:240px;margin-top:8px"><Dd modelValue="" :options="filterAdd" searchable placeholder="Add a filter" aria-label="Add a default filter" @update:modelValue="addFilter" /></div></section>

				<section class="card" style="padding:16px 18px"><b>Columns</b><p class="small muted" style="margin:2px 0 8px">Drag to reorder. {{ c.columns ? '' : 'Now using the columns Frappe CRM has by default.' }}</p>
					<DragList v-model="columns" empty="CRM's default columns." />
					<div class="row" style="gap:8px;margin-top:8px"><div style="width:240px"><Dd modelValue="" :options="colAdd" searchable placeholder="Add a column" aria-label="Add a column" @update:modelValue="addCol" /></div>
						<Btn v-if="c.columns" size="sm" variant="ghost" @click="c.columns = null">Use CRM's default columns</Btn></div></section>

				<section class="card" style="padding:16px 18px"><b>Default sorting</b>
					<div class="row" style="gap:8px;margin-top:8px"><div style="width:240px"><Dd :modelValue="sortParts.f" :options="sortOpts" searchable aria-label="Sort by" @update:modelValue="(f) => (c.sort = f + ' ' + sortParts.d)" /></div>
						<Btn :icon="sortParts.d === 'asc' ? 'arrow-up' : 'arrow-down'" :aria-label="sortParts.d === 'asc' ? 'Ascending' : 'Descending'" @click="c.sort = sortParts.f + ' ' + (sortParts.d === 'asc' ? 'desc' : 'asc')" /></div></section>

				<section class="card" style="padding:16px 18px"><b>New lead form</b><p class="small muted" style="margin:2px 0 0">The fields asked when someone adds a lead are arranged in <a href="#/settings/forms">Settings, Forms</a>, together with the Add organization and Add person forms.</p></section>
			</template>
		</div>`,
	}

	/** Organizations: only which filters sit in the top row, next to search. */
	V.OrgSetup = {
		setup() {
			const hdr = ref(false); onMounted(() => nextTick(() => (hdr.value = true)))
			const loading = ref(true); const error = ref(''); const busy = ref(false)
			const pool = ref([]); const have = ref([]); const allCols = ref([]); const cols = ref([]); const defaults = ref([])
			const label = (k) => (pool.value.find((x) => x.fieldname === k) || {}).label || k
			const rows = computed({ get: () => have.value.map((k) => ({ key: k, label: label(k) })), set: (v) => (have.value = v.map((x) => x.key)) })
			const addOpts = computed(() => [{ value: '', label: 'Add a filter' }, ...pool.value.filter((f) => !have.value.includes(f.fieldname)).map((f) => ({ value: f.fieldname, label: f.label }))])
			onMounted(async () => { try { const r = await call('get_orgs_config', {}); pool.value = r.choices; have.value = r.filters; allCols.value = r.all_columns; cols.value = r.columns; defaults.value = r.default_columns } catch (e) { error.value = e.message } finally { loading.value = false } })
			async function save() {
				busy.value = true
				try { await call('save_orgs_config', { config: JSON.stringify({ filters: have.value, columns: cols.value }) }); CM.toast('Saved. The Organizations screen now shows these filters.') } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			const colLabel = (k) => (allCols.value.find((x) => x.fieldname === k) || {}).label || k
			const colRows = computed({ get: () => cols.value.map((k) => ({ key: k, label: colLabel(k) })), set: (v) => (cols.value = v.map((x) => x.key)) })
			const colAdd = computed(() => [{ value: '', label: 'Add a column' }, ...allCols.value.filter((f) => !cols.value.includes(f.fieldname)).map((f) => ({ value: f.fieldname, label: f.label }))])
			return { colRows, colAdd, addCol: (k) => k && cols.value.push(k), useDefault: () => (cols.value = [...defaults.value]), cols, hdr, loading, error, busy, rows, addOpts, have, save, add: (k) => k && have.value.push(k) }
		},
		template: `
		<div class="page">
			<Teleport v-if="hdr" to="#hdr-ctl"><Btn variant="primary" :loading="busy" :disabled="loading" @click="save">Save</Btn></Teleport>
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<section v-else class="card" style="padding:16px 18px"><b>Top row filters</b><p class="small muted" style="margin:2px 0 8px">These sit next to search on the Organizations screen, in this order.</p>
				<DragList v-model="rows" empty="No filters: only search shows." />
				<div style="width:240px;margin-top:8px"><Dd modelValue="" :options="addOpts" placeholder="Add a filter" aria-label="Add a filter" @update:modelValue="add" /></div></section>
			<section v-if="!loading && !error" class="card" style="padding:16px 18px"><b>Columns</b><p class="small muted" style="margin:2px 0 8px">What the list starts with, in this order. People can still choose their own columns.</p>
				<DragList v-model="colRows" empty="" />
				<div class="row" style="gap:8px;margin-top:8px"><div style="width:240px"><Dd modelValue="" :options="colAdd" searchable placeholder="Add a column" aria-label="Add a column" @update:modelValue="addCol" /></div><Btn size="sm" variant="ghost" @click="useDefault">Use the default columns</Btn></div></section>
		</div>`,
	}
})()
