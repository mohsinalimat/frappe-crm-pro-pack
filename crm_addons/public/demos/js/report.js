/* Demo booking admin: the Report - bookings, show rate and where they came from, with compare to the previous period. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	const n = (v) => Number(v) || 0
	const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return 0 }
	const labelOf = (r) => r.label ?? r.source ?? r.medium ?? r.campaign ?? r.demo_type_title ?? r.demo_type ?? r.key ?? r.name ?? r.title ?? '(none)'
	/** One row of any breakdown, whatever the server calls the columns. */
	const normRow = (r) => ({ label: String(labelOf(r) || '(none)'), bookings: n(pick(r, 'bookings', 'booked', 'total', 'count')), held: n(pick(r, 'held', 'completed')), no_show: n(pick(r, 'no_show', 'noshow', 'no_shows')), cancelled: n(pick(r, 'cancelled', 'canceled')) })
	const normList = (l) => (Array.isArray(l) ? l : l && typeof l === 'object' ? Object.entries(l).map(([k, v]) => (typeof v === 'object' ? { label: k, ...v } : { label: k, bookings: v })) : []).map(normRow)
	DM.normReport = (r) => {
		r = r || {}
		const t = normRow(r.totals || r.summary || r.kpis || r)
		const days = (r.by_day || r.days || []).map((d) => ({ date: d.date || d.day, ...normRow(d) }))
		const funnelSrc = r.funnel
		return { t, days, source: normList(r.by_source || r.sources), medium: normList(r.by_medium || r.mediums), campaign: normList(r.by_campaign || r.campaigns), type: normList(r.by_demo_type || r.by_type || r.demo_types), funnel: funnelSrc }
	}
	const showRate = (t) => (t.held + t.no_show ? Math.round((t.held / (t.held + t.no_show)) * 1000) / 10 : null)

	V.Report = {
		setup() {
			const data = ref(null); const prev = ref(null); const loading = ref(true); const busy = ref(false); const error = ref('')
			const range = CM.useRange('dm-report-range', '30d')
			const compare = ref(CM.store.get('dm-report-compare') !== '0')
			let seq = 0
			async function load() {
				const my = ++seq; busy.value = true; error.value = ''
				try {
					await CM.loadShared()
					const before = compare.value ? CM.prevRange(range.value) : null
					const [d, p] = await Promise.all([DM.api('demo_report', CM.rangeArgs(range.value)), before ? DM.api('demo_report', CM.rangeArgs(before)) : null])
					if (my !== seq) return
					data.value = DM.normReport(d); prev.value = p ? DM.normReport(p) : null
				} catch (e) { if (my === seq) error.value = DM.friendly(e) } finally { if (my === seq) { loading.value = false; busy.value = false } }
			}
			onMounted(load)
			watch(() => [range.value.preset, range.value.from, range.value.to, compare.value], () => { CM.store.set('dm-report-compare', compare.value ? '1' : '0'); load() })
			const rangeText = computed(() => CM.rangeText(range.value))
			const prevText = computed(() => (compare.value && prev.value ? CM.rangeText(CM.prevRange(range.value)) : ''))
			const t = computed(() => (data.value ? data.value.t : null))
			function delta(key, lowerIsBetter) {
				if (!prev.value) return null
				const cur = key === 'rate' ? showRate(t.value) : t.value[key], was = key === 'rate' ? showRate(prev.value.t) : prev.value.t[key]
				if (cur === null || was === null) return null
				if (key === 'rate') { const d = Math.round((cur - was) * 10) / 10; return { text: d === 0 ? 'no change' : Math.abs(d) + ' pts', cls: d === 0 ? 'flat' : d > 0 ? 'good' : 'bad', arrow: d === 0 ? '' : d > 0 ? 'arrow-up' : 'arrow-down', tip: 'Previous period: ' + was + '%' } }
				if (!cur && !was) return { text: 'no change', cls: 'flat', arrow: '', tip: 'Previous period: 0' }
				const ch = CM.pctChange(cur, was); const up = cur > was
				return { text: ch === null ? 'new' : ch === 0 ? 'no change' : Math.abs(ch).toLocaleString() + '%', cls: cur === was ? 'flat' : up !== !!lowerIsBetter ? 'good' : 'bad', arrow: cur === was ? '' : up ? 'arrow-up' : 'arrow-down', tip: 'Previous period: ' + CM.num(was) }
			}
			const kpis = computed(() => {
				if (!t.value) return []; const x = t.value; const r = showRate(x)
				return [
					{ l: 'Bookings', v: CM.num(x.bookings), d: delta('bookings'), s: 'Booked in this period', i: 'calendar', c: 'var(--accent)' },
					{ l: 'Held', v: CM.num(x.held), d: delta('held'), s: CM.pctText(x.held, x.bookings) + ' of bookings', i: 'check-circle', c: 'var(--green)' },
					{ l: 'No-show', v: CM.num(x.no_show), d: delta('no_show', true), s: CM.pctText(x.no_show, x.bookings) + ' of bookings', i: 'ban', c: x.no_show ? 'var(--red)' : 'var(--text-faint)' },
					{ l: 'Cancelled', v: CM.num(x.cancelled), d: delta('cancelled', true), s: CM.pctText(x.cancelled, x.bookings) + ' of bookings', i: 'x-circle', c: 'var(--amber)' },
					{ l: 'Show rate', v: r === null ? '-' : r + '%', d: delta('rate'), s: 'Held out of held + no-show', i: 'target', c: 'var(--purple)' },
				]
			})
			const funnel = computed(() => {
				if (!t.value) return []; const x = t.value
				const f = data.value.funnel
				if (Array.isArray(f) && f.length) return f.map((s, i) => ({ label: s.label || s.step || s.name, value: n(s.value ?? s.count), color: ['var(--border-strong)', 'var(--accent)', 'var(--green)', 'var(--red)'][i] || 'var(--accent)' }))
				return [{ label: 'Booked', value: x.bookings, color: 'var(--border-strong)' }, { label: 'Still on (not cancelled)', value: Math.max(0, x.bookings - x.cancelled), color: 'var(--accent)' }, { label: 'Held', value: x.held, color: 'var(--green)' }]
			})
			const sections = [['source', 'By source'], ['medium', 'By medium'], ['campaign', 'By campaign'], ['type', 'By widget']]
			const top = (list) => Math.max(1, ...list.map((r) => r.bookings))
			const rows = (key) => (data.value ? data.value[key].slice().sort((a, b) => b.bookings - a.bookings) : [])
			const rate = (r) => (r.held + r.no_show ? Math.round((r.held / (r.held + r.no_show)) * 100) + '%' : '-')
			const exportCsv = () => {
				const out = [['Period', rangeText.value || 'Any time'], [], ['Group', 'Value', 'Bookings', 'Held', 'No-show', 'Cancelled', 'Show rate']]
				sections.forEach(([k, name]) => rows(k).forEach((r) => out.push([name, r.label, r.bookings, r.held, r.no_show, r.cancelled, rate(r)])))
				out.push([], ['Day', '', 'Bookings', 'Held', 'No-show', 'Cancelled']); data.value.days.forEach((d) => out.push(['Day', d.date, d.bookings, d.held, d.no_show, d.cancelled]))
				CM.csv(out, 'demo-report' + (rangeText.value ? '-' + CM.resolveRange(range.value).from + '-to-' + CM.resolveRange(range.value).to : '') + '.csv')
			}
			return { data, loading, busy, error, range, compare, rangeText, prevText, t, kpis, funnel, sections, top, rows, rate, load, exportCsv, CM, DM, go: CM.go }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>Report</h1></div><div class="actions"><button v-if="range.preset !== 'any'" type="button" class="fchip" :class="{ on: compare }" :aria-pressed="compare" @click="compare = !compare"><Ico name="refresh" size="sm" />Compare to previous period</button><DateRange v-model="range" any align="right" size="" aria-label="Report dates" /><Btn icon="download" :disabled="!data || !t.bookings" @click="exportCsv">Export CSV</Btn></div></div>
			<ReportTabs active="bookings" />
			<template v-if="loading"><div class="kpis"><Skel v-for="n in 5" :key="n" h="104" r="12" /></div><Skel h="280" r="12" /></template>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<Empty v-else-if="!t.bookings" icon="chart" title="No bookings in this period" text="Choose a longer date range, or share your booking page to get the first ones."><Btn @click="go('/types')">Go to widgets</Btn></Empty>
			<div v-else class="rep" :class="{ busy }">
				<div class="kpis five"><div v-for="x in kpis" :key="x.l" class="kpi" :style="{ '--kc': x.c }"><div class="l"><Ico :name="x.i" size="sm" />{{ x.l }}</div><div class="v">{{ x.v }}<span v-if="x.d" class="d" :class="x.d.cls" :title="x.d.tip"><Ico v-if="x.d.arrow" :name="x.d.arrow" /> {{ x.d.text }}</span></div><div class="s">{{ x.s }}</div></div></div>
				<div class="grid two-one">
					<div class="card pad"><div class="card-h"><div class="grow"><h3>Bookings per day</h3><p>Booked, held and no-show, by the day the booking was made.</p></div><div class="legend"><span><i style="background:var(--accent)"></i>Booked</span><span><i style="background:var(--green)"></i>Held</span><span><i style="background:var(--red)"></i>No-show</span></div></div>
						<DayChart v-if="data.days.length" :days="data.days" :series="[{ key: 'bookings', label: 'Booked', color: 'var(--accent)' }, { key: 'held', label: 'Held', color: 'var(--green)' }, { key: 'no_show', label: 'No-show', color: 'var(--red)' }]" /><div v-else class="chart-empty">No daily numbers for this period.</div></div>
					<div class="card pad"><div class="card-h"><div class="grow"><h3>Funnel</h3><p>From booking to the demo happening.</p></div></div><Funnel :steps="funnel" /><p class="small faint" style="margin:12px 0 0">{{ CM.num(t.no_show) }} no-show and {{ CM.num(t.cancelled) }} cancelled.</p></div>
				</div>
				<div class="grid two">
					<div v-for="s in sections" :key="s[0]" class="card" style="overflow:hidden"><div class="card-h" style="margin:0;padding:16px 18px 6px"><div class="grow"><h3>{{ s[1] }}</h3></div></div>
						<div v-if="!rows(s[0]).length" class="chart-empty" style="padding:24px">Nothing to show.</div>
						<div v-else class="table-wrap"><table class="tbl compact"><thead><tr><th>{{ s[1].replace('By ', '').replace(/^./, (c) => c.toUpperCase()) }}</th><th style="width:34%">Bookings</th><th class="num">Held</th><th class="num">No-show</th><th class="num">Show rate</th></tr></thead>
							<tbody><tr v-for="r in rows(s[0]).slice(0, 12)" :key="r.label"><td class="ellipsis" style="max-width:200px" :title="r.label"><b>{{ r.label }}</b></td><td><div class="barcell"><div class="bar tall"><i :style="{ width: (r.bookings / top(rows(s[0]))) * 100 + '%', background: 'var(--accent)' }"></i></div><b>{{ CM.num(r.bookings) }}</b></div></td><td class="num">{{ CM.num(r.held) }}</td><td class="num" :style="r.no_show ? 'color:var(--red)' : ''">{{ CM.num(r.no_show) }}</td><td class="num">{{ rate(r) }}</td></tr></tbody></table></div>
					</div>
				</div>
			</div>
		</div>`,
	}
})()
