/* Bookings admin: Report > Lead form report. What came in over any date range: counts, per day and where from. The log is its own page. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views
	
	V.LeadFormReport = {
		setup() {
			const data = ref(null); const prev = ref(null); const loading = ref(true); const busy = ref(false); const error = ref('')
			const range = CM.useRange('dm-lfreport-range', '30d')
			const compare = ref(CM.store.get('dm-lfreport-compare') !== '0')
			const form = ref(CM.route.query.form || ''); const forms = ref([])
			let seq = 0
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
			onMounted(async () => { try { forms.value = (await DM.lf('list_forms')) || [] } catch (e) { /* the filter just stays empty */ } load() })
			watch(() => [range.value.preset, range.value.from, range.value.to, compare.value, form.value], () => { CM.store.set('dm-lfreport-compare', compare.value ? '1' : '0'); load() })
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
			const exportCsv = () => {
				const out = [['Period', rangeText.value || 'Any time'], [], ['Group', 'Value', 'New leads', 'Already leads']]
				sections.forEach(([k, name]) => data.value[k].forEach((r) => out.push([name, r.label, r.created, r.duplicate])))
				out.push([], ['Day', '', 'New leads', 'Already leads', 'Blocked']); data.value.by_day.forEach((d) => out.push(['Day', d.date, d.created, d.duplicate, d.blocked]))
				CM.csv(out, 'lead-form-report.csv')
			}
			return { data, loading, busy, error, range, compare, form, forms, t, kpis, sections, top, load, exportCsv, rangeText, CM, DM, go: CM.go }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>Lead form report</h1></div><div class="actions"><button v-if="range.preset !== 'any'" type="button" class="fchip" :class="{ on: compare }" :aria-pressed="compare" @click="compare = !compare"><Ico name="refresh" size="sm" />Compare to previous period</button><DateRange v-model="range" any align="right" size="" aria-label="Report dates" /><Btn icon="download" :disabled="!data" @click="exportCsv">Export CSV</Btn></div></div>
			<div class="row wrap" style="gap:12px;align-items:center"><div class="grow"></div><div style="width:240px;margin-bottom:14px"><Dd v-model="form" :options="forms.map((f) => ({ value: f.name, label: f.title }))" allow-empty="All forms" placeholder="All forms" aria-label="Form" /></div></div>
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
			</div>
		</div>`,
	}
})()
