/* Bookings admin: the logs. One page for the website bookings, one for the lead forms: when, what it was, the result, who, where it came
 * from, the CRM lead (opens on our own Leads page) and, for administrators only, the IP address. Same date range picker as the reports. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views
	const SIZE = 25
	const KINDS = {
		forms: {
			title: 'Lead form log', sub: 'Every time a lead form was filled in, newest first.', back: '/forms', noun: 'Lead form', what: 'Form',
			results: [['', 'All'], ['Created', 'New lead'], ['Duplicate', 'Already a lead'], ['Blocked', 'Blocked'], ['Failed', 'Failed']],
			label: { Created: 'New lead', Duplicate: 'Already a lead', Blocked: 'Blocked', Failed: 'Failed' }, tone: { Created: 'green', Duplicate: 'blue', Blocked: 'amber', Failed: 'red' },
			fetch: (a) => DM.lf('list_entries', a), result: (r) => r.result, thing: (r) => r.form_title, reason: (r) => r.reason,
		},
		bookings: {
			title: 'Booking log', sub: 'Every booking made through a website widget, newest first.', back: '/bookings', noun: 'Booking', what: 'Widget',
			results: [['', 'All'], ['Confirmed', 'Booked'], ['Rescheduled', 'Rescheduled'], ['Completed', 'Held'], ['No Show', 'No-show'], ['Cancelled', 'Cancelled']],
			label: { Confirmed: 'Booked', Rescheduled: 'Rescheduled', Completed: 'Held', 'No Show': 'No-show', Cancelled: 'Cancelled' }, tone: { Confirmed: 'green', Rescheduled: 'blue', Completed: 'green', 'No Show': 'red', Cancelled: 'amber' },
			fetch: (a) => DM.api('booking_log', { ...a, status: a.result, result: undefined }), result: (r) => r.status, thing: (r) => r.demo_title || r.demo_type, reason: (r) => (r.rescheduled_from ? 'Moved from an earlier booking' : ''),
		},
	}

	V.ActivityLog = {
		props: { kind: String },
		setup(props) {
			const K = KINDS[props.kind]
			const range = CM.useRange('dm-log-range-' + props.kind, '30d')
			const result = ref(''); const search = ref(''); const page = ref(1)
			const log = reactive({ rows: [], total: 0, loading: true, error: '', showIp: false })
			let seq = 0, timer = null
			const args = (p, size) => ({ ...CM.rangeArgs(range.value), result: result.value || undefined, search: search.value || undefined, page: p, page_size: size })
			async function load() {
				const my = ++seq; log.loading = true; log.error = ''
				try { const r = await K.fetch(args(page.value, SIZE)); if (my === seq) { log.rows = r.rows; log.total = r.total; log.showIp = !!r.show_ip } } catch (e) { if (my === seq) log.error = DM.friendly(e) } finally { if (my === seq) log.loading = false }
			}
			onMounted(load); onBeforeUnmount(() => clearTimeout(timer))
			watch(() => [range.value.preset, range.value.from, range.value.to, result.value], () => { page.value = 1; load() })
			watch(page, load)
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load() }, 300) })
			const filtered = computed(() => !!(result.value || search.value))
			async function exportCsv() {
				try {
					const out = [['Period', CM.rangeText(range.value) || 'Any time'], [], ['When', 'Type', K.what, 'Result', 'Name', 'Email', 'Phone', 'Source', 'Medium', 'Campaign', 'CRM lead', ...(log.showIp ? ['IP address'] : []), 'Note']]
					for (let p = 1; p <= 40; p++) {
						const r = await K.fetch(args(p, 100))
						r.rows.forEach((e) => out.push([e.creation, K.noun, K.thing(e), K.label[K.result(e)] || K.result(e), e.name_, e.email, e.phone, e.utm_source, e.utm_medium, e.utm_campaign, e.lead, ...(log.showIp ? [e.ip] : []), K.reason(e)]))
						if (p * 100 >= r.total) break
					}
					CM.csv(out, props.kind + '-log.csv')
				} catch (e) { CM.toast(DM.friendly(e), 'err') }
			}
			return { K, range, result, search, page, log, filtered, exportCsv, SIZE, CM, DM, go: CM.go }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>Log</h1><p>{{ K.sub }}</p></div>
				<div class="actions"><DateRange v-model="range" any align="right" size="" aria-label="Log dates" /><Btn icon="download" :disabled="!log.total" @click="exportCsv">Export CSV</Btn></div></div>
			<div class="seg" role="tablist" aria-label="Log" style="margin-bottom:14px"><button type="button" role="tab" :class="{ on: kind === 'bookings' }" :aria-selected="kind === 'bookings'" @click="go('/log')"><Ico name="calendar" size="sm" /> Website bookings</button><button type="button" role="tab" :class="{ on: kind === 'forms' }" :aria-selected="kind === 'forms'" @click="go('/log/forms')"><Ico name="file" size="sm" /> Lead forms</button></div>
			<div class="card" style="overflow:hidden">
				<div class="row wrap" style="padding:14px 18px;gap:10px"><div class="chips"><button v-for="r in K.results" :key="r[0]" type="button" class="fchip" :class="{ on: result === r[0] }" :aria-pressed="result === r[0]" @click="result = r[0]">{{ r[1] }}</button></div><div class="grow"></div><div style="width:min(300px,100%)"><Inp v-model="search" icon="search" placeholder="Search name, email, phone or campaign" clearable aria-label="Search the log" /></div></div>
				<ErrorState v-if="log.error" :message="log.error" @retry="load" />
				<div v-else-if="log.loading && !log.rows.length" style="padding:18px"><Skel h="200" r="10" /></div>
				<Empty v-else-if="!log.rows.length" icon="file" title="Nothing logged" :text="filtered ? 'No entry matches. Clear the filters.' : 'Nothing was logged over these dates. Pick a longer range.'"><Btn v-if="filtered" @click="result = ''; search = ''">Clear filters</Btn></Empty>
				<div v-else class="table-wrap" :style="{ opacity: log.loading ? .6 : 1 }"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>Result</th><th>Who</th><th>Source</th><th>CRM lead</th><th v-if="log.showIp">IP address</th></tr></thead>
					<tbody><tr v-for="e in log.rows" :key="e.name">
						<td class="nowrap small">{{ CM.fmt(e.creation) }}</td>
						<td><span class="badge" :class="kind === 'forms' ? 'purple' : 'blue'">{{ K.noun }}</span><div class="small muted ellipsis" style="max-width:160px" :title="K.thing(e)">{{ K.thing(e) }}</div></td>
						<td><span class="badge" :class="K.tone[K.result(e)]" :title="K.reason(e)">{{ K.label[K.result(e)] || K.result(e) }}</span><div v-if="K.reason(e)" class="small muted ellipsis" style="max-width:220px" :title="K.reason(e)">{{ K.reason(e) }}</div></td>
						<td><b>{{ e.name_ || '-' }}</b><div class="small muted">{{ e.email }}<template v-if="e.email && e.phone"> - </template>{{ e.phone }}</div></td>
						<td class="small"><template v-if="e.utm_source">{{ e.utm_source }}<span v-if="e.utm_medium" class="muted"> / {{ e.utm_medium }}</span></template><span v-else class="faint">direct</span><div v-if="e.utm_campaign" class="muted">{{ e.utm_campaign }}</div></td>
						<td><a v-if="e.lead" :href="CM.leadUrl(e.lead)" target="_blank" rel="noopener" class="mono small">{{ e.lead }}</a><span v-else class="faint">-</span></td>
						<td v-if="log.showIp" class="mono small">{{ e.ip || '-' }}</td>
					</tr></tbody></table></div>
				<Pager v-if="log.total > SIZE" v-model:page="page" :size="SIZE" :total="log.total" />
			</div>
		</div>`,
	}
})()
