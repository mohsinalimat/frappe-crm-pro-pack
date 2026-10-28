/* Bookings admin: the Log. Website bookings and lead form entries together, newest first, paged on the server. The page header and the
 * table's column header stay put; the rows scroll. Administrators also see the visitor's IP address. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views
	const SIZE = 25
	const RESULTS = [['', 'All results'], ['Confirmed', 'Booked'], ['Rescheduled', 'Rescheduled'], ['Completed', 'Held'], ['No Show', 'No-show'], ['Cancelled', 'Cancelled'], ['Created', 'New lead'], ['Duplicate', 'Already a lead'], ['Blocked', 'Blocked'], ['Failed', 'Failed']]
	const LABEL = { Confirmed: 'Booked', Rescheduled: 'Rescheduled', Completed: 'Held', 'No Show': 'No-show', Cancelled: 'Cancelled', Created: 'New lead', Duplicate: 'Already a lead', Blocked: 'Blocked', Failed: 'Failed' }
	const TONE = { Confirmed: 'green', Rescheduled: 'blue', Completed: 'green', 'No Show': 'red', Cancelled: 'amber', Created: 'green', Duplicate: 'blue', Blocked: 'amber', Failed: 'red' }
	const KINDS = [['all', 'All', 'layers'], ['bookings', 'Website bookings', 'calendar'], ['forms', 'Lead forms', 'file']]

	V.ActivityLog = {
		setup() {
			const kind = ref(CM.store.get('dm-log-kind') || 'all'); const result = ref([]); const source = ref(''); const sources = ref([]); const card = ref(null); const search = ref(''); const page = ref(1)
			const log = reactive({ rows: [], total: 0, loading: true, error: '', showIp: false })
			let seq = 0, timer = null
			const args = (p, size) => ({ kind: kind.value, result: result.value.length ? result.value.join(',') : undefined, source: source.value || undefined, search: search.value || undefined, page: p, page_size: size })
			async function load() {
				const my = ++seq; log.loading = true; log.error = ''
				try { const r = await CM.call('crm_addons.demos.activity_log.get_log', args(page.value, SIZE)); if (my === seq) { log.rows = r.rows; log.total = r.total; log.showIp = !!r.show_ip } } catch (e) { if (my === seq) log.error = DM.friendly(e) } finally { if (my === seq) log.loading = false }
			}
			function fit() { const el = card.value; if (el) el.style.height = Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 16) + 'px' }
			onMounted(async () => { load(); fit(); window.addEventListener('resize', fit); try { sources.value = (await CM.call('crm_addons.demos.activity_log.get_sources', {})) || [] } catch (e) { /* the filter stays empty */ } setTimeout(fit, 300) }); onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('resize', fit) })
			watch(kind, () => { CM.store.set('dm-log-kind', kind.value); result.value = []; source.value = ''; page.value = 1; load() })
			watch([result, source], () => { page.value = 1; load() })
			watch(page, load)
			watch(search, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load() }, 300) })
			const BOOK = [['', 'All'], ['Confirmed', 'Booked'], ['Rescheduled', 'Rescheduled'], ['Completed', 'Held'], ['No Show', 'No-show'], ['Cancelled', 'Cancelled']]
			const FORM = [['', 'All'], ['Created', 'New lead'], ['Duplicate', 'Already a lead'], ['Blocked', 'Blocked'], ['Failed', 'Failed']]
			const resultOpts = computed(() => (kind.value === 'bookings' ? BOOK : kind.value === 'forms' ? FORM : [...BOOK, ...FORM.slice(1)]).filter((r) => r[0]).map((r) => ({ value: r[0], label: r[1] })))
			const sourceOpts = computed(() => sources.value.filter((x) => kind.value === 'all' || (kind.value === 'bookings') === (x.kind === 'booking')).map((x) => ({ value: x.value, label: x.label, sub: x.kind === 'form' ? 'Lead form' : 'Booking page' })))
			const filtered = computed(() => !!(result.value.length || source.value || search.value))
			async function exportCsv() {
				try {
					const out = [['When', 'Type', 'Booking page / form', 'Result', 'Name', 'Email', 'Phone', 'Source', 'Medium', 'Campaign', 'CRM lead', ...(log.showIp ? ['IP address'] : []), 'Note']]
					for (let p = 1; p <= 40; p++) {
						const r = await CM.call('crm_addons.demos.activity_log.get_log', args(p, 200))
						r.rows.forEach((e) => out.push([e.creation, e.kind === 'form' ? 'Lead form' : 'Booking', e.thing, LABEL[e.result] || e.result, e.name_, e.email, e.phone, e.utm_source, e.utm_medium, e.utm_campaign, e.lead, ...(log.showIp ? [e.ip] : []), e.reason]))
						if (p * 200 >= r.total) break
					}
					CM.csv(out, 'log.csv')
				} catch (e) { CM.toast(DM.friendly(e), 'err') }
			}
			return { card, resultOpts, sourceOpts, source, kind, result, search, page, log, filtered, exportCsv, RESULTS, LABEL, TONE, KINDS, SIZE, CM, DM }
		},
		template: `
		<div class="page logpage">
			<div class="pg-head"><div class="grow"><h1>Log</h1><p>Every website booking and lead form entry, newest first.</p></div>
				<div class="actions"><Btn icon="download" :disabled="!log.total" @click="exportCsv">Export CSV</Btn></div></div>
			<div ref="card" class="card logcard">
				<div class="row wrap logbar"><div style="width:210px"><MultiDd v-model="result" :options="resultOpts" placeholder="All results" /></div>
					<div style="width:230px"><Dd v-model="source" :options="sourceOpts" searchable allow-empty="All websites" placeholder="All websites" aria-label="Website" /></div>
					<div class="seg logseg" role="group" aria-label="Show"><button v-for="k in KINDS" :key="k[0]" type="button" :class="{ on: kind === k[0] }" :aria-pressed="kind === k[0]" :title="k[1]" :aria-label="k[1]" @click="kind = k[0]">{{ k[1] }}</button></div>
					<div class="grow"></div><div style="width:min(200px,100%)"><Inp v-model="search" icon="search" placeholder="Search" clearable aria-label="Search the log" /></div></div>
				<ErrorState v-if="log.error" :message="log.error" @retry="load" />
				<div v-else-if="log.loading && !log.rows.length" style="padding:18px"><Skel h="200" r="10" /></div>
				<Empty v-else-if="!log.rows.length" icon="file" title="Nothing logged" :text="filtered ? 'No entry matches. Clear the filters.' : 'Nothing has been logged yet.'"><Btn v-if="filtered" @click="result = []; source = ''; search = ''">Clear filters</Btn></Empty>
				<div v-else class="table-wrap logscroll" :style="{ opacity: log.loading ? .6 : 1 }"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>Result</th><th>Who</th><th>Source</th><th>CRM lead</th><th v-if="log.showIp">IP address</th></tr></thead>
					<tbody><tr v-for="e in log.rows" :key="e.kind + e.name">
						<td class="nowrap small">{{ CM.fmt(e.creation) }}</td>
						<td><div class="logtype"><span class="logic" :class="e.kind === 'form' ? 'purple' : 'blue'" :title="e.kind === 'form' ? 'Lead form' : 'Website booking'"><Ico :name="e.kind === 'form' ? 'file' : 'calendar'" size="sm" /></span><div style="min-width:0"><b class="ellipsis" style="display:block;max-width:170px" :title="e.thing">{{ e.thing }}</b><span class="small muted">{{ e.kind === 'form' ? 'Lead form' : 'Website booking' }}</span></div></div></td>
						<td><span class="badge" :class="TONE[e.result]" :title="e.reason">{{ LABEL[e.result] || e.result }}</span><div v-if="e.reason" class="small muted ellipsis" style="max-width:220px" :title="e.reason">{{ e.reason }}</div></td>
						<td><b>{{ e.name_ || '-' }}</b><div class="small muted">{{ e.email }}<template v-if="e.email && e.phone"> - </template>{{ e.phone }}</div></td>
						<td class="small"><template v-if="e.utm_source">{{ e.utm_source }}<span v-if="e.utm_medium" class="muted"> / {{ e.utm_medium }}</span></template><span v-else class="faint">direct</span><div v-if="e.utm_campaign" class="muted">{{ e.utm_campaign }}</div></td>
						<td><a v-if="e.lead" :href="CM.leadUrl(e.lead)" target="_blank" rel="noopener" class="mono small">{{ e.lead }}</a><span v-else class="faint">-</span></td>
						<td v-if="log.showIp" class="mono small">{{ e.ip || '-' }}</td>
					</tr></tbody></table></div>
				<Pager v-if="log.rows.length" v-model:page="page" :size="SIZE" :total="log.total" />
			</div>
		</div>`,
	}
})()
