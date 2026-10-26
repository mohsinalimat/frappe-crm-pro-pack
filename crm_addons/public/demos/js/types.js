/* Demo booking admin: the Widgets list (cards). */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	DM.nextSlotText = (s, tz) => {
		if (!s) return ''
		const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'))
		if (isNaN(d)) return String(s)
		const opt = tz ? { timeZone: tz } : {}
		const day = (x) => new Intl.DateTimeFormat('en-CA', { ...opt, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
		const diff = Math.round((new Date(day(d)) - new Date(DM.todayIn(tz || 'UTC'))) / 864e5)
		const t = d.toLocaleTimeString([], { ...opt, hour: 'numeric', minute: '2-digit' })
		return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { ...opt, weekday: 'short', day: 'numeric', month: 'short' })) + ', ' + t
	}

	V.DemoTypes = {
		setup() {
			const rows = ref([]); const loading = ref(true); const error = ref(''); const q = ref(''); const busy = reactive({})
			const filter = ref('all')
			// cards or a list: the choice is remembered in this browser
			const layout = ref((() => { try { return localStorage.getItem('crm_widgets_layout') === 'list' ? 'list' : 'cards' } catch (e) { return 'cards' } })())
			watch(layout, (v) => { try { localStorage.setItem('crm_widgets_layout', v) } catch (e) { /* not saved */ } })
			async function load(quiet) {
				if (!quiet) loading.value = true; error.value = ''
				try { rows.value = (await DM.api('list_demo_types')) || []; DM.typesCache = rows.value; enrich(rows.value) } catch (e) { error.value = DM.friendly(e) } finally { loading.value = false }
			}
			// The list gives the basics at once; the next free slot (from the public page's own slot search) and this month's
			// bookings arrive a moment later, so the cards never wait for them.
			const extra = reactive({})
			async function enrich(list) {
				await Promise.all(list.slice(0, 24).map(async (r) => {
					const tz = r.timezone || 'UTC'; const today = DM.todayIn(tz); const month = today.slice(0, 7)
					const jobs = []
					if (r.next_slot === undefined && DM.bool(r.enabled)) jobs.push(CM.call('crm_addons.demos.public.get_slots', { slug: r.slug, from_date: today, to_date: DM.addDay(today, 40), tz }).then((s) => { const d = s && s.days && s.days.find((x) => x.slots && x.slots.length); extra[r.name] = { ...extra[r.name], next: d ? d.slots[0].start : '', nextTz: tz } }).catch(() => { extra[r.name] = { ...extra[r.name], next: '' } }))
					if (r.bookings_month === undefined) jobs.push(DM.api('list_bookings', { filters: { demo_type: r.name }, from_date: month + '-01', to_date: DM.addDay(month + '-' + new Date(+month.slice(0, 4), +month.slice(5), 0).getDate(), 0), page_size: 1 }).then((b) => { extra[r.name] = { ...extra[r.name], month: b.total } }).catch(() => {}))
					await Promise.all(jobs)
				}))
			}
			const nextSlot = (r) => { const e = extra[r.name]; return r.next_slot !== undefined ? r.next_slot : e && e.next !== undefined ? e.next : undefined }
			const monthCount = (r) => (r.bookings_month !== undefined ? r.bookings_month : extra[r.name] && extra[r.name].month)
			onMounted(load)
			const shown = computed(() => rows.value.filter((r) => (filter.value === 'all' || (filter.value === 'on') === !!DM.bool(r.enabled)) && (!q.value || (r.title + ' ' + r.slug).toLowerCase().includes(q.value.toLowerCase()))))
			const counts = computed(() => ({ all: rows.value.length, on: rows.value.filter((r) => DM.bool(r.enabled)).length, off: rows.value.filter((r) => !DM.bool(r.enabled)).length }))
			const url = (r) => r.public_url || DM.publicUrl(r.slug)
			const owners = (r) => (r.owners || []).map((o) => (typeof o === 'string' ? { user: o } : o))
			const edit = (r) => CM.go('/types/' + encodeURIComponent(r.name) + '/details')

			async function setEnabled(r, on) {
				busy[r.name] = true
				try {
					const d = DM.fromServer((await DM.api('get_demo_type', { name: r.name })).doc)
					d.enabled = on
					await DM.api('save_demo_type', { doc: DM.toServer(d) })
					r.enabled = on ? 1 : 0
					CM.toast(on ? 'Widget is on: its page accepts bookings' : 'Widget is off: its page shows "not available"')
				} catch (e) { CM.toast(DM.friendly(e), 'err'); load(true) } finally { busy[r.name] = false }
			}
			async function duplicate(r) {
				busy[r.name] = true
				try { const d = await DM.api('duplicate_demo_type', { name: r.name }); const c = (d && d.doc) || d || {}; CM.toast('Duplicated as "' + (c.title || c.name) + '". It is off until you switch it on.'); await load(true); if (c.name) CM.go('/types/' + encodeURIComponent(c.name) + '/details') } catch (e) { CM.toast(DM.friendly(e), 'err') } finally { busy[r.name] = false }
			}
			async function remove(r) {
				if (Number(r.total ?? r.bookings_total) > 0) {
					const ok = await CM.confirm({ title: 'This widget has bookings', message: `"${r.title}" has ${r.total ?? r.bookings_total} booking${Number(r.total ?? r.bookings_total) === 1 ? '' : 's'}, so it cannot be deleted: the bookings, leads and reports would lose their link to it. Turn it off instead. Its page stops taking new bookings and the history stays.`, confirmText: DM.bool(r.enabled) ? 'Turn it off' : 'Close', danger: false })
					if (ok && DM.bool(r.enabled)) setEnabled(r, false)
					return
				}
				const ok = await CM.confirm({ title: 'Delete this widget?', message: `"${r.title}" and its public page /book/${r.slug} will be removed. This cannot be undone.`, confirmText: 'Delete', danger: true })
				if (!ok) return
				busy[r.name] = true
				try { await DM.api('delete_demo_type', { name: r.name }); CM.toast('Widget deleted'); await load(true) } catch (e) {
					const m = DM.friendly(e)
					if (/booking/i.test(m)) { const off = await CM.confirm({ title: 'It has bookings', message: m + ' Turn it off instead?', confirmText: 'Turn it off' }); if (off) await setEnabled(r, false); load(true) } else CM.toast(m, 'err')
				} finally { busy[r.name] = false }
			}
			const menu = (r) => [
				{ label: 'Edit', icon: 'edit', run: () => edit(r) },
				{ label: 'Open public page', icon: 'external', run: () => window.open(url(r), '_blank', 'noopener'), disabled: !DM.bool(r.enabled) },
				{ label: 'Copy link', icon: 'link', run: () => DM.copy(url(r), 'Link') },
				{ label: 'Bookings', icon: 'calendar', run: () => CM.go('/bookings?demo_type=' + encodeURIComponent(r.name)) },
				{ label: 'Duplicate', icon: 'copy', run: () => duplicate(r) },
				{ sep: true },
				{ label: 'Delete', icon: 'trash', danger: true, run: () => remove(r) },
			]
			const canManage = computed(() => DM.session.widgets === 'manage')
			return { layout, canManage, extra, nextSlot, monthCount, rows, shown, loading, error, q, filter, counts, busy, url, owners, edit, setEnabled, load, menu, DM, CM, go: CM.go }
		},
		template: `
		<div class="page">
			<div v-if="!canManage" class="alert info"><Ico name="info" /><div class="grow"><b>View only.</b> You can see the widgets but not change them.</div></div>
			<div class="pg-head"><div class="grow"><h1>Widgets</h1><p>Each widget is a public booking page for one website or offer: its own hours, hosts, form, messages and branding.</p></div><div class="actions"><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/types/new/details')">Create widget</Btn></div></div>
			<div v-if="!loading && !error && rows.length" class="row wrap tools"><div class="chips"><button v-for="f in [['all', 'All'], ['on', 'On'], ['off', 'Off']]" :key="f[0]" type="button" class="fchip" :class="{ on: filter === f[0] }" :aria-pressed="filter === f[0]" @click="filter = f[0]">{{ f[1] }}<span class="n">{{ counts[f[0]] }}</span></button></div><div class="grow"></div><div class="seg" role="group" aria-label="Layout"><button type="button" :class="{ on: layout === 'cards' }" :aria-pressed="layout === 'cards'" title="Cards" aria-label="Cards" @click="layout = 'cards'"><Ico name="grid" /></button><button type="button" :class="{ on: layout === 'list' }" :aria-pressed="layout === 'list'" title="List" aria-label="List" @click="layout = 'list'"><Ico name="list" /></button></div><div style="width:min(300px,100%)"><Inp v-model="q" icon="search" placeholder="Search widgets" clearable aria-label="Search widgets" /></div></div>
			<div v-if="loading" class="dgrid"><Skel v-for="n in 3" :key="n" h="212" r="12" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load()" />
			<Empty v-else-if="!rows.length" icon="calendar" title="No widgets yet" text="Create one to get a booking page you can put on a website: visitors pick a time, you get the lead, the meeting and the messages."><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/types/new/details')">Create widget</Btn></Empty>
			<Empty v-else-if="!shown.length" icon="search" title="No widget matches" text="Try a different search or filter."><Btn @click="q = ''; filter = 'all'">Clear filters</Btn></Empty>
			<div v-else-if="layout === 'cards'" class="dgrid">
				<article v-for="r in shown" :key="r.name" class="card dcard" :class="{ off: !DM.bool(r.enabled) }">
					<div class="dcard-h">
						<button type="button" class="dcard-t" @click="edit(r)" :aria-label="'Edit ' + r.title"><b class="ellipsis">{{ r.title }}</b><span class="small muted">{{ DM.durationLabel(r.duration_minutes) }}<template v-if="r.provider"> - <Ico v-if="r.provider === 'Google Meet'" name="gmeet" size="sm" style="vertical-align:-3px" /> {{ r.provider }}</template></span></button>
						<span class="dcard-sw"><span class="small" :class="DM.bool(r.enabled) ? '' : 'faint'">{{ DM.bool(r.enabled) ? 'On' : 'Off' }}</span><Switch :model-value="DM.bool(r.enabled)" :aria-disabled="!canManage" :label="'Turn ' + r.title + (DM.bool(r.enabled) ? ' off' : ' on')" @update:model-value="(v) => !busy[r.name] && setEnabled(r, v)" /></span>
						<Menu v-if="canManage" :items="menu(r)" :label="'Actions for ' + r.title" />
					</div>
					<div class="dcard-link"><Ico name="link" size="sm" /><a :href="url(r)" target="_blank" rel="noopener" class="mono ellipsis" @click.stop>/book/{{ r.slug }}</a><CopyBtn :text="url(r)" bare label="Copy link" what="Link" /></div>
					<dl class="dcard-d">
						<div><dt>Next free slot</dt><dd><template v-if="nextSlot(r)">{{ DM.nextSlotText(nextSlot(r), r.timezone) }}</template><span v-else class="faint">{{ !DM.bool(r.enabled) ? 'Off' : nextSlot(r) === undefined ? '...' : 'No free slot' }}</span></dd></div>
						<div><dt>Bookings this month</dt><dd><b>{{ monthCount(r) === undefined ? '-' : CM.num(monthCount(r)) }}</b></dd></div>
					</dl>
					<div class="dcard-f"><AvatarStack v-if="owners(r).length" :people="owners(r)" /><span v-else class="small" style="color:var(--amber)"><Ico name="alert" size="sm" /> No host yet</span><span class="grow small muted ellipsis">{{ owners(r).map((o) => o.full_name || o.user).slice(0, 2).join(', ') }}<template v-if="owners(r).length > 2"> +{{ owners(r).length - 2 }}</template></span><Btn size="sm" @click="edit(r)">Edit</Btn></div>
				</article>
			</div>
			<div v-else class="card" style="padding:0"><div class="table-wrap"><table class="tbl wl-tbl">
				<thead><tr><th>Widget</th><th>Page</th><th>Hosts</th><th>Next free slot</th><th class="num">This month</th><th>On</th><th></th></tr></thead>
				<tbody><tr v-for="r in shown" :key="r.name" class="click" :class="{ off: !DM.bool(r.enabled) }" tabindex="0" @click="edit(r)" @keydown.enter="edit(r)">
					<td><b class="ellipsis" style="display:block;max-width:230px">{{ r.title }}</b><div class="small muted">{{ DM.durationLabel(r.duration_minutes) }}<template v-if="r.provider"> - <Ico v-if="r.provider === 'Google Meet'" name="gmeet" size="sm" style="vertical-align:-3px" /> {{ r.provider }}</template></div></td>
					<td @click.stop><span class="row" style="gap:4px;flex-wrap:nowrap"><a :href="url(r)" target="_blank" rel="noopener" class="mono ellipsis" style="max-width:170px">/book/{{ r.slug }}</a><CopyBtn :text="url(r)" bare label="Copy link" what="Link" /></span></td>
					<td><AvatarStack v-if="owners(r).length" :people="owners(r)" /><span v-else class="small" style="color:var(--amber)">No host yet</span></td>
					<td class="nowrap"><template v-if="nextSlot(r)">{{ DM.nextSlotText(nextSlot(r), r.timezone) }}</template><span v-else class="faint">{{ !DM.bool(r.enabled) ? 'Off' : nextSlot(r) === undefined ? '...' : 'No free slot' }}</span></td>
					<td class="num"><b>{{ monthCount(r) === undefined ? '-' : CM.num(monthCount(r)) }}</b></td>
					<td @click.stop><Switch :model-value="DM.bool(r.enabled)" :aria-disabled="!canManage" :label="'Turn ' + r.title + (DM.bool(r.enabled) ? ' off' : ' on')" :disabled="!canManage || busy[r.name]" @update:model-value="canManage && setEnabled(r, $event)" /></td>
					<td class="num nowrap" @click.stop><Menu v-if="canManage" :items="menu(r)" :label="'Actions for ' + r.title" /></td>
				</tr></tbody>
			</table></div></div>
		</div>`,
	}
})()
