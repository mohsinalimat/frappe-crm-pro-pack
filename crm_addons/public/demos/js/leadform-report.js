/* Bookings admin: Report > Lead forms. What came in over any date range: counts, per day, where from, and the log. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views
	const SIZE = 25
	const RESULTS = [['', 'All'], ['Created', 'New lead'], ['Duplicate', 'Already a lead'], ['Blocked', 'Blocked'], ['Failed', 'Failed']]
	const RESULT_LABEL = { Created: 'New lead', Duplicate: 'Already a lead', Blocked: 'Blocked', Failed: 'Failed' }
	const RESULT_CLS = { Created: 'green', Duplicate: 'blue', Blocked: 'amber', Failed: 'red' }

	V.ReportTabs = {
		props: { active: String },
		setup: () => ({ go: CM.go }),
		template: `<div class="seg" role="tablist" aria-label="Report" style="margin-bottom:14px"><button type="button" role="tab" :class="{ on: active === 'bookings' }" :aria-selected="active === 'bookings'" @click="go('/report')"><Ico name="calendar" size="sm" /> Bookings</button><button type="button" role="tab" :class="{ on: active === 'forms' }" :aria-selected="active === 'forms'" @click="go('/report/forms')"><Ico name="file" size="sm" /> Lead forms</button></div>`,
	}

	V.LeadFormReport = {
		setup() {
			const data = ref(null); const prev = ref(null); const loading = ref(true); const busy = ref(false); const error = ref('')
			const range = CM.useRange('dm-lfreport-range', '30d')
			const compare = ref(CM.store.get('dm-lfreport-compare') !== '0')
			const form = ref(CM.route.query.form || ''); const forms = ref([])
			const result = ref(''); const search = ref(''); const page = ref(1)
			const log = reactive({ rows: [], total: 0, loading: false, error: '' })
			let seq = 0, lseq = 0, timer = null
			const args = (r) => ({ ...CM.rangeArgs(r), form: form.value || undefined })
			async function load() {
				const my = ++seq; busy.value = true; error.value = ''
				try {
					const before = compare.value ? CM.prevRange(range.value) : null
					const [d, p] = await Promise.all([DM.lf('report', args(range.value)), before ? DM.lf('report', args(before)) : null])
					if (my !== seq) return
					data.value = d; prev.value = p
				} catch (e) { if (my === seq) error.value = DM.friendly(e) } finally { if (my === seq) { loading.value = false; busy.value = false } }
			}
			async function loadLog() {
				const my = ++lseq; log.loading = true; log.error = ''
				try {
					const r = await DM.lf('list_entries', { ...CM.rangeArgs(range.value), form: form.value || undefined, result: result.value || undefined, search: search.value || undefined, page: page.value, page_size: SIZE })
					if (my === lseq) { log.rows = r.rows; log.total = r.total }
				} catch (e) { if (my === lseq) log.error = DM.friendly(e) } finally { if (my === lseq) log.loading = false }
			}
			onMounted(async () => { try { forms.value = (await DM.lf('list_forms')) || [] } catch (e) { /* the filter just stays empty */ } load(); loadLog() })
			watch(() => [range.value.preset, range.value.from, range.value.to, compare.value, form.value], () => { CM.store.set('dm-lfreport-compare', compare.value ? '1' : '0'); page.value = 1; load(); loadLog() })
			watch([result, page], loadLog)
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; loadLog() }, 300) })
			const t = computed(() => (data.value ? data.value.totals : null))
			const rangeText = computed(() => CM.rangeText(range.value))
			function delta(key, lowerIsBetter) {
				if (!prev.value) return null
				const cur = t.value[key], was = prev.value.totals[key]
				if (!cur && !was) return { text: 'no change', cls: 'flat', arrow: '', tip: 'Previous period: 0' }
				const ch = CM.pctChange(cur, was); const up = cur > was
				return { text: ch === null ? 'new' : ch === 0 ? 'no change' : Math.abs(ch).toLocaleString() + '%', cls: cur === was ? 'flat' : up !== !!lowerIsBetter ? 'good' : 'bad', arrow: cur === was ? '' : up ? 'arrow-up' : 'arrow-down', tip: 'Previous period: ' + CM.num(was) }
			}
			const kpis = computed(() => {
				if (!t.value) return []; const x = t.value
				return [
					{ l: 'Submissions', v: CM.num(x.submissions), d: delta('submissions'), s: 'Everything that arrived', i: 'file', c: 'var(--accent)' },
					{ l: 'New leads', v: CM.num(x.created), d: delta('created'), s: CM.pctText(x.created, x.submissions) + ' of submissions', i: 'target', c: 'var(--green)' },
					{ l: 'Already leads', v: CM.num(x.duplicate), d: delta('duplicate'), s: CM.num(x.applied) + ' had their details updated', i: 'users', c: 'var(--purple)' },
					{ l: 'Blocked', v: CM.num(x.blocked), d: delta('blocked', true), s: 'Spam and invalid details', i: 'ban', c: x.blocked ? 'var(--amber)' : 'var(--text-faint)' },
					{ l: 'Failed', v: CM.num(x.failed), d: delta('failed', true), s: 'Could not be saved', i: 'x-circle', c: x.failed ? 'var(--red)' : 'var(--text-faint)' },
				]
			})
			const sections = [['by_form', 'Form'], ['by_source', 'Source'], ['by_medium', 'Medium'], ['by_campaign', 'Campaign']]
			const top = (list) => Math.max(1, ...list.map((r) => r.created + r.duplicate))
			const exportCsv = async () => {
				try {
					const out = [['Period', rangeText.value || 'Any time'], [], ['Time', 'Form', 'Result', 'Name', 'Email', 'Phone', 'Source', 'Medium', 'Campaign', 'Lead', 'Reason']]
					for (let p = 1; p <= 40; p++) {
						const r = await DM.lf('list_entries', { ...CM.rangeArgs(range.value), form: form.value || undefined, result: result.value || undefined, search: search.value || undefined, page: p, page_size: 100 })
						r.rows.forEach((e) => out.push([e.creation, e.form_title, RESULT_LABEL[e.result] || e.result, e.name_, e.email, e.phone, e.utm_source, e.utm_medium, e.utm_campaign, e.lead, e.reason]))
						if (p * 100 >= r.total) break
					}
					CM.csv(out, 'lead-form-log.csv')
				} catch (e) { CM.toast(DM.friendly(e), 'err') }
			}
			const filtered = computed(() => !!(result.value || search.value))
			return { data, loading, busy, error, range, compare, form, forms, result, search, page, log, t, kpis, sections, top, load, loadLog, exportCsv, rangeText, filtered, RESULTS, RESULT_LABEL, RESULT_CLS, SIZE, CM, DM, go: CM.go }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>Report</h1></div><div class="actions"><button v-if="range.preset !== 'any'" type="button" class="fchip" :class="{ on: compare }" :aria-pressed="compare" @click="compare = !compare"><Ico name="refresh" size="sm" />Compare to previous period</button><DateRange v-model="range" any align="right" size="" aria-label="Report dates" /></div></div>
			<div class="row wrap" style="gap:12px;align-items:center"><ReportTabs active="forms" /><div class="grow"></div><div style="width:240px;margin-bottom:14px"><Dd v-model="form" :options="forms.map((f) => ({ value: f.name, label: f.title }))" allow-empty="All forms" placeholder="All forms" aria-label="Form" /></div></div>
			<template v-if="loading"><div class="kpis"><Skel v-for="n in 5" :key="n" h="104" r="12" /></div><Skel h="280" r="12" /></template>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<div v-else class="rep" :class="{ busy }">
				<div class="kpis five"><div v-for="x in kpis" :key="x.l" class="kpi" :style="{ '--kc': x.c }"><div class="l"><Ico :name="x.i" size="sm" />{{ x.l }}</div><div class="v">{{ x.v }}<span v-if="x.d" class="d" :class="x.d.cls" :title="x.d.tip"><Ico v-if="x.d.arrow" :name="x.d.arrow" /> {{ x.d.text }}</span></div><div class="s">{{ x.s }}</div></div></div>
				<div class="card pad"><div class="card-h"><div class="grow"><h3>Leads per day</h3><p>By the day the form was filled in.</p></div><div class="legend"><span><i style="background:var(--green)"></i>New lead</span><span><i style="background:var(--purple)"></i>Already a lead</span><span><i style="background:var(--amber)"></i>Blocked</span></div></div>
					<DayChart v-if="data.by_day.length" :days="data.by_day" :series="[{ key: 'created', label: 'New lead', color: 'var(--green)' }, { key: 'duplicate', label: 'Already a lead', color: 'var(--purple)' }, { key: 'blocked', label: 'Blocked', color: 'var(--amber)' }]" /><div v-else class="chart-empty">No form was filled in over these dates. Pick a longer range.</div></div>
				<div class="grid two">
					<div v-for="s in sections" :key="s[0]" class="card" style="overflow:hidden"><div class="card-h" style="margin:0;padding:16px 18px 6px"><div class="grow"><h3>By {{ s[1].toLowerCase() }}</h3></div></div>
						<div v-if="!data[s[0]].length" class="chart-empty" style="padding:24px">Nothing to show.</div>
						<div v-else class="table-wrap"><table class="tbl compact"><thead><tr><th>{{ s[1] }}</th><th style="width:34%">New leads</th><th class="num">Already leads</th></tr></thead>
							<tbody><tr v-for="r in data[s[0]].slice(0, 12)" :key="r.label"><td class="ellipsis" style="max-width:200px" :title="r.label"><b>{{ r.label }}</b></td><td><div class="barcell"><div class="bar tall"><i :style="{ width: ((r.created + r.duplicate) / top(data[s[0]])) * 100 + '%', background: 'var(--green)' }"></i></div><b>{{ CM.num(r.created) }}</b></div></td><td class="num">{{ CM.num(r.duplicate) }}</td></tr></tbody></table></div>
					</div>
				</div>
				<div class="card" style="overflow:hidden">
					<div class="card-h" style="margin:0;padding:16px 18px 10px"><div class="grow"><h3>Log</h3><p>Every submission in {{ rangeText || 'any time' }}, newest first.</p></div><Btn size="sm" icon="download" :disabled="!log.total" @click="exportCsv">Export CSV</Btn></div>
					<div class="row wrap" style="padding:0 18px 12px;gap:10px"><div class="chips"><button v-for="r in RESULTS" :key="r[0]" type="button" class="fchip" :class="{ on: result === r[0] }" :aria-pressed="result === r[0]" @click="result = r[0]; page = 1">{{ r[1] }}</button></div><div class="grow"></div><div style="width:min(280px,100%)"><Inp v-model="search" icon="search" placeholder="Search name, email, phone or campaign" clearable aria-label="Search the log" /></div></div>
					<ErrorState v-if="log.error" :message="log.error" @retry="loadLog" />
					<Empty v-else-if="!log.loading && !log.rows.length" icon="file" title="Nothing logged" :text="filtered ? 'No entry matches. Clear the filters.' : 'No form was filled in over these dates.'"><Btn v-if="filtered" @click="result = ''; search = ''">Clear filters</Btn></Empty>
					<div v-else class="table-wrap" :style="{ opacity: log.loading ? .6 : 1 }"><table class="tbl"><thead><tr><th>When</th><th>Form</th><th>Result</th><th>Who</th><th>Source</th><th>Lead</th></tr></thead>
						<tbody><tr v-for="e in log.rows" :key="e.name"><td class="nowrap small">{{ CM.fmt(e.creation) }}</td><td>{{ e.form_title }}</td>
							<td><span class="badge" :class="RESULT_CLS[e.result]" :title="e.reason">{{ RESULT_LABEL[e.result] || e.result }}</span><div v-if="e.reason" class="small muted ellipsis" style="max-width:220px" :title="e.reason">{{ e.reason }}</div></td>
							<td><b>{{ e.name_ || '-' }}</b><div class="small muted">{{ e.email }}<template v-if="e.email && e.phone"> - </template>{{ e.phone }}</div></td>
							<td class="small"><template v-if="e.utm_source">{{ e.utm_source }}<span v-if="e.utm_medium" class="muted"> / {{ e.utm_medium }}</span></template><span v-else class="faint">direct</span><div v-if="e.utm_campaign" class="muted">{{ e.utm_campaign }}</div></td>
							<td><a v-if="e.lead" :href="'/crm/leads/' + encodeURIComponent(e.lead)" target="_blank" rel="noopener" class="mono small">{{ e.lead }}</a><span v-else class="faint">-</span></td></tr></tbody></table></div>
					<Pager v-if="log.total > SIZE" v-model:page="page" :size="SIZE" :total="log.total" />
				</div>
			</div>
		</div>`,
	}
})()
