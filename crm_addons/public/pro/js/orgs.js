/* Suite Pro: Organizations. A list with search and filters, a form to add one, and a page with its details, leads and deals. */
(() => {
	const { ref, reactive, computed, onMounted, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.orgs.' + m, a)
	const money = (n) => (n ? Number(n).toLocaleString() : '')

	V.OrgForm = {
		props: { opts: Object, org: Object },
		emits: ['close', 'saved'],
		setup(props, { emit }) {
			const editing = !!props.org
			// the fields come from Settings, Forms (the CRM's own fields; the admin chooses which and in what order)
			const DEFAULTS = ['organization_name', 'website', 'industry', 'territory', 'no_of_employees', 'annual_revenue']
			const fields = computed(() => (props.opts.form && props.opts.form.fields && props.opts.form.fields.length ? props.opts.form.fields : DEFAULTS.map((k) => ({ fieldname: k, label: k, fieldtype: 'Data', values: [], reqd: k === 'organization_name' ? 1 : 0 }))))
			const v = reactive({})
			fields.value.forEach((f) => { v[f.fieldname] = props.org && props.org[f.fieldname] != null ? props.org[f.fieldname] : (f.fieldtype === 'Check' ? 0 : '') })
			const busy = ref(false); const error = ref('')
			const NUM = ['Int', 'Float', 'Currency']; const TEXT = ['Small Text', 'Text', 'Long Text']
			const kind = (f) => (f.fieldtype === 'Select' || f.fieldtype === 'Link' ? 'list' : f.fieldtype === 'Check' ? 'check' : NUM.includes(f.fieldtype) ? 'num' : TEXT.includes(f.fieldtype) ? 'area' : f.fieldtype === 'Date' ? 'date' : 'text')
			const pick = (f) => [{ value: '', label: 'Not set' }, ...f.values.map((x) => ({ value: x, label: x }))]
			async function save() {
				const miss = fields.value.find((f) => f.reqd && (f.fieldtype === 'Check' ? false : !String(v[f.fieldname] == null ? '' : v[f.fieldname]).trim()))
				if (miss) { error.value = (miss.fieldname === 'organization_name' ? 'Give the organization a name.' : miss.label + ' is needed.'); return }
				busy.value = true; error.value = ''
				try { const r = editing ? await call('update_org', { name: props.org.name, values: JSON.stringify(v) }) : await call('create_org', { values: JSON.stringify(v) }); CM.toast(editing ? 'Saved' : 'Organization added'); emit('saved', r) } catch (e) { error.value = e.message } finally { busy.value = false }
			}
			return { v, busy, error, save, pick, kind, fields, editing }
		},
		template: `
		<Modal :title="editing ? 'Edit organization' : 'New organization'" @close="$emit('close')" @submit="save">
			<div class="grid2">
				<Field v-for="f in fields" :key="f.fieldname" :label="f.label" :required="!!f.reqd" :style="kind(f) === 'area' ? 'grid-column:1/-1' : ''">
					<Dd v-if="kind(f) === 'list'" v-model="v[f.fieldname]" :options="pick(f)" searchable :aria-label="f.label" />
					<Switch v-else-if="kind(f) === 'check'" :modelValue="!!Number(v[f.fieldname])" :label="f.label" @update:modelValue="(x) => (v[f.fieldname] = x ? 1 : 0)" />
					<textarea v-else-if="kind(f) === 'area'" class="inp" rows="3" v-model="v[f.fieldname]" :aria-label="f.label"></textarea>
					<Inp v-else v-model="v[f.fieldname]" :type="kind(f) === 'num' ? 'number' : kind(f) === 'date' ? 'date' : 'text'" :disabled="editing && f.fieldname === 'organization_name'" :aria-label="f.label" />
				</Field>
			</div>
			<div v-if="error" class="err" role="alert" style="margin-top:10px">{{ error }}</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" :loading="busy" @click="save">{{ editing ? 'Save' : 'Add organization' }}</Btn></template>
		</Modal>`,
	}

	V.Organizations = {
		setup() {
			const opts = reactive({ industries: [], territories: [], sizes: [], can_create: false })
			const COLS_KEY = 'pro_orgs_cols'
			const colInfo = ref([]); const defCols = ref([]); const mine = ref(null); const colDlg = ref(false)
			try { const m = JSON.parse(localStorage.getItem(COLS_KEY) || 'null'); if (Array.isArray(m) && m.length) mine.value = m } catch (e) { /* storage blocked */ }
			const search = ref(''); const fv = reactive({ industry: '', territory: '', no_of_employees: '' }); const cfgFilters = ref(['industry', 'territory']); const sort = reactive({ by: 'organization_name', dir: 'asc' })
			const rows = ref([]); const total = ref(0); const page = ref(1); const perPage = ref(25); const loading = ref(true); const error = ref(''); const creating = ref(false)
			let timer, seq = 0
			async function load() {
				const mine = ++seq; loading.value = true; error.value = ''
				try { const r = await call('list_orgs', { search: search.value || undefined, industry: fv.industry || undefined, territory: fv.territory || undefined, no_of_employees: fv.no_of_employees || undefined, order_by: sort.by, order_dir: sort.dir, start: (page.value - 1) * perPage.value, page_length: perPage.value }); if (mine === seq) { rows.value = r.rows; total.value = r.total } } catch (e) { if (mine === seq) error.value = e.message } finally { if (mine === seq) loading.value = false }
			}
			onMounted(async () => { try { const oc = await CM.call('crm_addons.pro.config.get_orgs_config', {}); cfgFilters.value = oc.filters; colInfo.value = oc.all_columns; defCols.value = oc.columns } catch (e) { /* the defaults stay */ } try { Object.assign(opts, await call('options', {})) } catch (e) { error.value = e.message } load() })
			watch([() => JSON.stringify(fv), () => sort.by + sort.dir, perPage], () => { page.value = 1; load() })
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load() }, 300) })
			const pages = computed(() => Math.max(1, Math.ceil(total.value / perPage.value)))
			const go = (n) => { page.value = Math.min(pages.value, Math.max(1, n)); load() }
			const open = (n) => { location.hash = '#/organizations/' + encodeURIComponent(n) }
			const sortOpts = [{ value: 'organization_name', label: 'Name' }, { value: 'creation', label: 'Added date' }, { value: 'annual_revenue', label: 'Annual revenue' }]
			const pick = (list, all) => [{ value: '', label: all }, ...list.map((x) => ({ value: x, label: x }))]
			const clear = () => { search.value = ''; Object.keys(fv).forEach((k) => (fv[k] = '')) }
			const FILTERS = { industry: ['All industries', () => opts.industries], territory: ['All territories', () => opts.territories], no_of_employees: ['Any size', () => opts.sizes] }
			const filterOpts = (k) => pick(FILTERS[k][1](), FILTERS[k][0])
			const anyFv = computed(() => !!(search.value || Object.values(fv).some(Boolean)))
			const byCol = computed(() => Object.fromEntries(colInfo.value.map((c) => [c.fieldname, c])))
			const cols = computed(() => (mine.value || defCols.value).filter((k) => byCol.value[k]).map((k) => ({ key: k, label: byCol.value[k].label, type: byCol.value[k].fieldtype })))
			const COL_SORT = { organization_name: 1, annual_revenue: 1, creation: 1 }
			function applyCols(chosen) { mine.value = chosen.map((c) => c.key); try { localStorage.setItem(COLS_KEY, JSON.stringify(mine.value)) } catch (e) { /* not stored */ } colDlg.value = false }
			function resetCols() { mine.value = null; try { localStorage.removeItem(COLS_KEY) } catch (e) { /* not stored */ } }
			const cell = (r, c) => (c.type === 'Int' ? String(r[c.key] || 0) : c.type === 'Currency' ? money(r[c.key]) : c.type === 'Datetime' ? (r[c.key] ? CM.ago ? CM.ago(r[c.key]) : String(r[c.key]).slice(0, 10) : '') : r[c.key] == null ? '' : r[c.key])
			return { cols, colDlg, colInfo, applyCols, resetCols, mine, cell, fv, cfgFilters, filterOpts, anyFv, opts, search, sort, rows, total, page, perPage, loading, error, creating, load, pages, go, open, sortOpts, pick, clear, money }
		},
		template: `
		<div class="page leads">
			<div class="pg-head"><div class="grow"><h1>Organizations</h1></div>
				<div class="actions"><Btn v-if="opts.can_create" variant="primary" icon="plus" @click="creating = true">Add organization</Btn></div></div>
			<section class="card fbar"><div class="row wrap" style="gap:8px">
				<div class="grow" style="min-width:220px"><Inp v-model="search" icon="search" placeholder="Search name or website..." clearable aria-label="Search organizations" /></div>
				<div v-for="k in cfgFilters" :key="k" style="width:190px"><Dd v-model="fv[k]" :options="filterOpts(k)" searchable :aria-label="k" /></div>
				<button type="button" class="btn icon" :disabled="!anyFv" title="Clear all filters" aria-label="Clear all filters" @click="clear"><Ico name="x" /></button>
			</div></section>
			<ErrorState v-if="error" :message="error" @retry="load" />
			<div v-else-if="loading && !rows.length" class="card" style="padding:0"><div v-for="n in 6" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>
			<section v-else class="card listcard" :style="{ opacity: loading ? .6 : 1 }">
				<div class="row wrap lbar" style="gap:10px"><span class="muted">Showing {{ total ? (page - 1) * perPage + 1 : 0 }}&ndash;{{ Math.min(total, page * perPage) }} of {{ total }}</span><div class="grow"></div>
					<button type="button" class="btn sm icon" aria-label="Refresh" title="Refresh" @click="load"><Ico name="refresh" /></button><button type="button" class="btn sm icon" aria-label="Choose columns" title="Choose columns" @click="colDlg = true"><Ico name="columns" /></button><button v-if="mine" type="button" class="link small" @click="resetCols">Default columns</button><span class="small muted">Sort by</span><div style="width:150px"><Dd v-model="sort.by" :options="sortOpts" size="sm" aria-label="Sort by" /></div>
					<Btn size="sm" :icon="sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :aria-label="sort.dir === 'asc' ? 'Ascending' : 'Descending'" @click="sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'" /></div>
				<Empty v-if="!rows.length" icon="users" title="No organizations"   :text="anyFv ? 'No organization matches these filters.' : 'Add your first organization.'" />
				<div v-else class="table-wrap"><table class="tbl"><thead><tr><th v-for="c in cols" :key="c.key" :class="{ num: ['Int', 'Currency'].includes(c.type) }">{{ c.label }}</th></tr></thead>
					<tbody><tr v-for="r in rows" :key="r.name" class="click" tabindex="0" @click="open(r.name)" @keydown.enter="open(r.name)">
						<td v-for="c in cols" :key="c.key" :class="{ num: ['Int', 'Currency'].includes(c.type) }"><div v-if="c.key === 'organization_name'" class="row" style="gap:10px"><Pic :name="r.organization_name" :image="r.organization_logo" :size="28" /><b>{{ r.organization_name }}</b></div><template v-else>{{ cell(r, c) || '-' }}</template></td></tr></tbody></table></div>
				<div v-if="rows.length" class="pager row" style="gap:10px;padding:10px 14px;border-top:1px solid var(--border)"><div class="grow"></div>
					<div style="width:110px"><Dd v-model="perPage" :options="[{ value: 10, label: '10 / page' }, { value: 25, label: '25 / page' }, { value: 50, label: '50 / page' }]" size="sm" aria-label="Rows per page" /></div>
					<Btn size="sm" icon="chevron-left" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)" /><span class="small">{{ page }} / {{ pages }}</span><Btn size="sm" icon="chevron-right" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)" /></div>
			</section>
			<ColumnsDialog v-if="colDlg" :fields="colInfo" :columns="cols" @close="colDlg = false" @apply="applyCols" />
			<OrgForm v-if="creating" :opts="opts" @close="creating = false" @saved="(n) => { creating = false; open(n) }" />
		</div>`,
	}

	V.Organization = {
		props: { name: String },
		setup(props) {
			const org = ref(null); const opts = reactive({ industries: [], territories: [], sizes: [] }); const error = ref(''); const loading = ref(true); const editing = ref(false)
			async function load() { loading.value = true; error.value = ''; try { org.value = await call('get_org', { name: props.name }) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(async () => { load(); try { Object.assign(opts, await call('options', {})) } catch (e) { /* the form stays empty */ } })
			watch(() => org.value && org.value.organization_name, (t) => { if (t) document.title = t + ' - ' + (PRO.shell.brand.name || 'Suite Pro') })
			const back = () => { location.hash = '#/organizations' }
			const openLead = (n) => { location.hash = '#/leads/' + encodeURIComponent(n) }
			async function remove() {
				if (!(await CM.confirm({ title: 'Delete ' + org.value.organization_name + '?', message: 'Leads that name it keep the text; nothing else is deleted.', confirmText: 'Delete', danger: true }))) return
				try { await call('delete_org', { name: props.name }); CM.toast('Organization deleted'); back() } catch (e) { CM.toast(e.message, 'err') }
			}
			return { org, opts, error, loading, editing, load, back, openLead, remove, money, PRO }
		},
		template: `
		<div class="page lead-page">
			<button type="button" class="btn ghost sm back" @click="back"><Ico name="chevron-left" /> Organizations</button>
			<ErrorState v-if="error" :message="error" @retry="load" />
			<div v-else-if="loading && !org" class="card"><Skel h="60" /><Skel h="200" /></div>
			<template v-else-if="org">
				<header class="lead-head card"><Pic :name="org.organization_name" :image="org.organization_logo" :size="52" />
					<div class="grow" style="min-width:0"><h1 class="ellipsis">{{ org.organization_name }}</h1><div class="small muted">{{ [org.industry, org.territory].filter(Boolean).join(' - ') }}</div></div>
					<a v-if="org.website" class="btn" :href="/^https?:/.test(org.website) ? org.website : 'https://' + org.website" target="_blank" rel="noopener"><Ico name="globe" /> Website</a>
					<Btn v-if="org.can_write" icon="edit" @click="editing = true">Edit</Btn><Btn v-if="org.can_delete" variant="danger" icon="trash" @click="remove">Delete</Btn></header>
				<div class="lead-layout" style="margin-top:14px">
					<div class="lead-main stack">
						<section class="card"><h3>Leads ({{ org.leads }})</h3>
							<Empty v-if="!org.leads_list.length" icon="users" title="No leads" text="Leads whose organization is this one show here." />
							<ul v-else class="list"><li v-for="l in org.leads_list" :key="l.name" class="li row" style="gap:12px;cursor:pointer" tabindex="0" @click="openLead(l.name)" @keydown.enter="openLead(l.name)"><Pic :name="l.lead_name" :size="30" /><div class="grow"><b>{{ l.lead_name || l.name }}</b><div class="small muted">{{ l.mobile_no || l.email || '' }}</div></div><StatusTag :status="l.status" /><span class="small muted nowrap">{{ PRO.ago(l.creation) }}</span></li></ul></section>
						<section v-if="org.deals_list.length" class="card"><h3>Deals ({{ org.deals }})</h3>
							<ul class="list"><li v-for="d in org.deals_list" :key="d.name" class="li row" style="gap:12px"><div class="grow"><b>{{ d.name }}</b><div class="small muted">{{ d.deal_owner || 'Unassigned' }}</div></div><span class="badge nodot neutral">{{ d.status }}</span><span class="small">{{ money(d.annual_revenue) }}</span></li></ul></section>
					</div>
					<aside class="lead-side"><section class="card"><h3>Details</h3><div class="facts one"><Fact label="Website" :value="org.website" /><Fact label="Industry" :value="org.industry" /><Fact label="Territory" :value="org.territory" /><Fact label="Employees" :value="org.no_of_employees" /><Fact label="Annual revenue" :value="money(org.annual_revenue)" /></div></section></aside>
				</div>
				<OrgForm v-if="editing" :opts="opts" :org="org" @close="editing = false" @saved="(r) => { editing = false; org = r }" />
			</template>
		</div>`,
	}
})()
