/* Demo booking admin: the Bookings table, its drawer (answers, UTMs, message log), status changes and CSV export. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views
	const SIZE = 25

	const parseJson = (v) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v) } catch (e) { return {} } }
	DM.who = (b) => b.name_ || b.visitor_name || b.full_name || b.email || b.name
	const startOf = (b) => b.starts_on || b.starts_utc
	DM.when = (b, long) => { const s = startOf(b); if (!s) return '-'; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? String(s) : d.toLocaleDateString([], long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
	const meetIcon = (b) => (/meet\.google\.com/.test(meetLink(b)) ? 'gmeet' : 'monitor')
	const meetLink = (b) => b.meet_link || b.meeting_link || b.google_meet_link || ''
	const MSG_TONE = { Sent: 'green', Failed: 'red', Skipped: 'amber', Pending: 'neutral', Sending: 'blue' }

	/** "Notify": send the visitor a booking message again (email and/or WhatsApp), and optionally tell the hosts. */
	V.NotifyModal = {
		props: { booking: Object },
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const info = ref(null); const error = ref(''); const busy = ref(false)
			const f = reactive({ key: '', email: true, whatsapp: true, hosts: false })
			onMounted(async () => {
				try { info.value = await DM.api('get_notify_options', { booking: props.booking.name }); const first = info.value.options[0]; f.key = first ? first.key : ''; f.whatsapp = !!info.value.whatsapp_consent } catch (e) { error.value = DM.friendly(e) }
			})
			const opts = computed(() => ((info.value && info.value.options) || []).map((o) => ({ value: o.key, label: o.label, sub: [o.email ? 'email' : '', o.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(' + ') || 'no template chosen' })))
			const chosen = computed(() => ((info.value && info.value.options) || []).find((o) => o.key === f.key))
			const canWa = computed(() => !!(info.value && info.value.whatsapp_consent && info.value.has_phone && chosen.value && chosen.value.whatsapp))
			watch([chosen, info], () => { if (!info.value) return; if (!canWa.value) f.whatsapp = false; else f.whatsapp = true; if (chosen.value && !chosen.value.email) f.email = false; else if (chosen.value) f.email = true })
			async function send() {
				const o = chosen.value; if (!o) return
				const channels = [f.email && 'Email', f.whatsapp && 'WhatsApp'].filter(Boolean)
				if (!channels.length && !f.hosts) { error.value = 'Choose email, WhatsApp or both.'; return }
				busy.value = true; error.value = ''
				try {
					const r = await DM.api('notify_booking', { booking: props.booking.name, event: o.event, minutes_before: o.minutes_before, channels: JSON.stringify(channels.length ? channels : ['Email']), hosts: f.hosts ? 1 : 0 })
					const bits = []
					if (r.sent.length) bits.push('sent by ' + r.sent.join(' and ').toLowerCase())
					if (r.hosts) bits.push(r.hosts + ' host' + (r.hosts === 1 ? '' : 's') + ' told')
					const skipped = (r.skipped || []).map((x) => x.channel + ': ' + x.reason).join(' ')
					CM.toast((bits.length ? 'Notification ' + bits.join(', ') + '.' : 'Nothing was sent.') + (skipped ? ' ' + skipped : ''), skipped && !bits.length ? 'err' : undefined)
					emit('done')
				} catch (e) { error.value = DM.friendly(e) } finally { busy.value = false }
			}
			return { info, error, busy, f, opts, chosen, canWa, send, DM }
		},
		template: `
		<Modal title="Notify" :subtitle="'Send ' + DM.who(booking) + ' the booking details again.'" @close="$emit('close')">
			<div class="col" style="gap:14px">
				<Skel v-if="!info && !error" h="120" r="10" />
				<div v-if="error" class="alert err"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
				<template v-if="info">
					<div v-if="!opts.length" class="alert warn"><Ico name="info" /><div class="grow">This widget has no messages set up. Add them under Widgets, Messages.</div></div>
					<template v-else>
						<Field label="What to send"><Dd v-model="f.key" :options="opts" aria-label="What to send" /></Field>
						<div class="col" style="gap:8px"><label class="check"><input type="checkbox" v-model="f.email" :disabled="chosen && !chosen.email" /> Email to {{ booking.email }}</label>
							<label class="check"><input type="checkbox" v-model="f.whatsapp" :disabled="!info.whatsapp_consent || !info.has_phone || (chosen && !chosen.whatsapp)" /> WhatsApp to {{ booking.phone || 'their number' }} <span class="small muted">{{ !info.has_phone ? '(no number)' : !info.whatsapp_consent ? '(they did not agree to WhatsApp updates)' : chosen && !chosen.whatsapp ? '(no WhatsApp template chosen)' : '' }}</span></label>
							<label class="check"><input type="checkbox" v-model="f.hosts" /> Also tell the hosts (CRM notification and email)</label></div>
					</template>
				</template>
			</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="send" :loading="busy" :disabled="!info || !chosen" @click="send">Send now</Btn></template>
		</Modal>`,
	}

	V.BookingDrawer = {
		props: { name: String },
		emits: ['close', 'changed'],
		setup(props, { emit }) {
			const b = ref(null); const loading = ref(true); const error = ref(''); const busy = ref('')
			async function load() { loading.value = true; error.value = ''; try { const r = await DM.api('get_booking_admin', { name: props.name }); b.value = { ...(r.booking || r), messages: r.messages || (r.booking && r.booking.messages) || [], lead_url: r.lead_url, meeting_url: r.meeting_url, sync_error: r.sync_error } } catch (e) { error.value = DM.friendly(e) } finally { loading.value = false } }
			onMounted(load); watch(() => props.name, load)
			const answers = computed(() => { const a = parseJson(b.value && b.value.answers); return Object.keys(a).map((k) => ({ k, label: k.replace(/_/g, ' '), v: typeof a[k] === 'object' ? JSON.stringify(a[k]) : String(a[k]) })) })
			const touch = computed(() => parseJson(b.value && b.value.first_touch))
			const utm = computed(() => b.value ? [['Source', b.value.utm_source], ['Medium', b.value.utm_medium], ['Campaign', b.value.utm_campaign], ['Term', b.value.utm_term], ['Content', b.value.utm_content], ['Google click id', b.value.gclid], ['Facebook click id', b.value.fbclid]].filter((x) => x[1]) : [])
			const pretty = (k) => { const w = k.replace(/_/g, ' '); return /^(utm|gclid|fbclid)/i.test(w) ? { gclid: 'Google click id', fbclid: 'Facebook click id' }[w.toLowerCase()] || w.replace(/^utm /i, 'UTM ') : w.charAt(0).toUpperCase() + w.slice(1) }
			const touchRows = computed(() => Object.keys(touch.value).map((k) => [pretty(k), String(touch.value[k])]).filter((x) => x[1]))
			const msgs = computed(() => ((b.value && b.value.messages) || []).slice().sort((x, y) => String(x.due_at).localeCompare(String(y.due_at))))
			async function setStatus(status) { await DM.changeStatus(b.value, status, () => { load(); emit('changed') }) }
			async function resend(m) {
				if (!(await CM.confirm({ title: 'Send this message again?', message: `${m.event} on ${m.channel} will be sent to ${DM.who(b.value)} now.`, confirmText: 'Send now' }))) return
				busy.value = m.name || m.event + m.channel
				try { await DM.api('resend_message', m.name ? { booking: b.value.name, message: m.name } : { booking: b.value.name, event: m.event }); CM.toast('Message queued to send'); load() } catch (e) { CM.toast(DM.friendly(e), 'err') } finally { busy.value = '' }
			}
			const notifyOpen = ref(false)
			const leadUrl = computed(() => (b.value && b.value.lead ? b.value.lead_url || CM.leadUrl(b.value.lead) : ''))
			const statusItems = computed(() => [{ label: 'Mark as held', icon: 'check-circle', run: () => setStatus('Completed') }, { label: 'Mark as no-show', icon: 'ban', run: () => setStatus('No Show') }, ...(DM.canActOnOthers() ? [{ sep: true }, { label: 'Cancel booking', icon: 'x-circle', danger: true, run: () => setStatus('Cancelled') }] : [])])
			return { notifyOpen, statusItems, b, loading, error, load, answers, utm, touchRows, msgs, setStatus, resend, busy, leadUrl, meetLink, meetIcon, MSG_TONE, DM, CM }
		},
		template: `
		<Drawer wide :title="b ? DM.who(b) : 'Booking'" :subtitle="b ? b.demo_title || b.demo_type_title || b.demo_type : ''" @close="$emit('close')">
			<div v-if="loading" class="col"><Skel h="28" /><Skel h="120" r="10" /><Skel h="180" r="10" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<template v-else-if="b">
				<div class="bd-top"><StatusBadge :value="b.status" /><span class="b">{{ DM.when(b, true) }}</span><span v-if="b.visitor_timezone" class="small faint">visitor zone {{ b.visitor_timezone }}</span></div>
				<div class="row wrap" style="gap:8px">
					<a v-if="leadUrl" class="btn sm" :href="leadUrl" @click="CM.openCrm($event, leadUrl)"><Ico name="user" />Open lead</a>
					<a v-if="meetLink(b)" class="btn sm" :href="meetLink(b)" target="_blank" rel="noopener"><Ico :name="meetIcon(b)" />Meeting link</a>
					<Btn v-if="b.status !== 'Cancelled'" size="sm" icon="send" @click="notifyOpen = true">Notify</Btn>
					<Menu :items="statusItems" label="Change status"><Btn size="sm" icon="chevron-down">Change status</Btn></Menu>
				</div>
				<h4 class="dh">Visitor</h4>
				<dl class="dl"><dt>Name</dt><dd>{{ DM.who(b) }}</dd><dt>Email</dt><dd><a :href="'mailto:' + b.email">{{ b.email }}</a></dd><dt>Phone</dt><dd>{{ b.phone || '-' }}</dd><dt v-if="b.organization">Organisation</dt><dd v-if="b.organization">{{ b.organization }}</dd><dt v-if="b.guests">Guests</dt><dd v-if="b.guests" style="white-space:pre-wrap">{{ b.guests }}</dd><dt>WhatsApp consent</dt><dd>{{ DM.bool(b.whatsapp_consent) ? 'Given' : 'Not given' }}</dd><dt v-if="b.cancel_reason">Cancel reason</dt><dd v-if="b.cancel_reason">{{ b.cancel_reason }}</dd></dl>
				<template v-if="answers.length"><h4 class="dh">Answers</h4><dl class="dl"><template v-for="a in answers" :key="a.k"><dt style="text-transform:capitalize">{{ a.label }}</dt><dd style="white-space:pre-wrap">{{ a.v || '-' }}</dd></template></dl></template>
				<h4 class="dh">Where they came from</h4>
				<dl v-if="utm.length" class="dl"><template v-for="u in utm" :key="u[0]"><dt>{{ u[0] }}</dt><dd class="mono">{{ u[1] }}</dd></template></dl><p v-else class="small faint" style="margin:0">No campaign details on this booking (a direct visit).</p>
				<dl v-if="b.landing_url || b.referrer" class="dl"><template v-if="b.landing_url"><dt>Landing page</dt><dd class="ellipsis" :title="b.landing_url">{{ b.landing_url }}</dd></template><template v-if="b.referrer"><dt>Referrer</dt><dd class="ellipsis" :title="b.referrer">{{ b.referrer }}</dd></template></dl>
				<template v-if="touchRows.length"><h4 class="dh">First touch <span class="faint small">the visitor's first visit to the website</span></h4><dl class="dl"><template v-for="t in touchRows" :key="t[0]"><dt>{{ t[0] }}</dt><dd class="mono ellipsis" :title="t[1]">{{ t[1] }}</dd></template></dl></template>
				<h4 class="dh">Messages</h4>
				<div v-if="!msgs.length" class="small faint">No messages were queued for this booking.</div>
				<ul v-else class="mlog" role="list"><li v-for="(m, i) in msgs" :key="i"><ChannelBadge :value="m.channel" /><div class="grow"><b>{{ m.event === 'Reminder' && m.minutes_before !== undefined ? DM.offsetLabel(m.minutes_before) + ' reminder' : m.event }}</b><div class="small muted">Due {{ CM.fmt(m.due_at) }}<template v-if="m.sent_at"> - sent {{ CM.fmt(m.sent_at) }}</template></div><div v-if="m.error" class="small" style="color:var(--red)">{{ m.error }}</div></div><span class="badge" :class="MSG_TONE[m.status] || 'neutral'">{{ m.status }}</span><Btn v-if="(m.status === 'Failed' || m.status === 'Sent') && DM.canActOnOthers()" size="sm" variant="ghost" icon="retry" :loading="busy === (m.name || m.event + m.channel)" :aria-label="'Resend ' + m.event" title="Send again" @click="resend(m)" /></li></ul>
			</template>
			<NotifyModal v-if="notifyOpen && b" :booking="b" @close="notifyOpen = false" @done="notifyOpen = false; load()" />
		</Drawer>`,
	}

	/** Change a booking's status after a confirmation that says what happens. */
	// people who see other people's demos (team / everyone) may also cancel; a host records how their own demo went
	DM.canActOnOthers = () => ['team', 'all'].includes(DM.session.demos)
	DM.changeStatus = async (b, status, done) => {
		const words = { Completed: ['Mark as held?', 'The demo took place. It counts in the show rate.', 'Mark as held'], 'No Show': ['Mark as no-show?', 'The visitor did not join. It counts against the show rate.', 'Mark as no-show'], Cancelled: ['Cancel this booking?', 'The slot is freed, the meeting is cancelled and the visitor gets the cancellation message.', 'Cancel booking'] }[status]
		if (!(await CM.confirm({ title: words[0], message: DM.who(b) + ' - ' + DM.when(b) + '. ' + words[1], confirmText: words[2], danger: status === 'Cancelled' }))) return
		try { await (DM.canActOnOthers() ? DM.api('set_booking_status', { name: b.name, status }) : DM.api('set_my_demo_outcome', { booking: b.name, outcome: status })); CM.toast(status === 'Completed' ? 'Marked as held' : status === 'No Show' ? 'Marked as no-show' : 'Booking cancelled'); done && done() } catch (e) { CM.toast(DM.friendly(e), 'err') }
	}

	V.Bookings = {
		setup() {
			const rows = ref([]); const total = ref(0); const loading = ref(true); const busy = ref(false); const error = ref(''); const page = ref(0)
			const q = ref(''); const status = ref(''); const demoType = ref(CM.route.query.demo_type || ''); const owner = ref('')
			const range = CM.useRange('dm-bookings-range', 'any')
			const types = ref(DM.typesCache || [])
			const open = computed(() => CM.route.parts[1] || '')
			let seq = 0
			const args = (extra) => ({ filters: { status: status.value || undefined, demo_type: demoType.value || undefined, owner: owner.value || undefined, ...(extra || {}) }, search: q.value || undefined, ...CM.rangeArgs(range.value) })
			// A host filter: the widgets that person hosts are asked one by one and merged (the server's own `owner` filter is also sent,
			// so a server that knows it gives the same answer).
			const hosted = (u) => types.value.filter((t) => (t.owners || []).some((o) => (typeof o === 'string' ? o : o.user) === u)).map((t) => t.name)
			async function fetchPage(p, size) {
				const ask = (extra, pg, sz) => CM.call('crm_addons.demos.admin.list_bookings', { ...args(extra), page: pg, page_size: sz })
				const norm = (r) => (Array.isArray(r) ? { rows: r, total: r.length } : { rows: r.rows || [], total: r.total ?? r.count ?? (r.rows || []).length })
				if (!owner.value) return norm(await ask({}, p + 1, size))
				const mine = hosted(owner.value).filter((n) => !demoType.value || n === demoType.value)
				if (!mine.length) return { rows: [], total: 0 }
				if (mine.length === 1) return norm(await ask({ demo_type: mine[0] }, p + 1, size))
				let all = []
				for (const n of mine) { const r = norm(await ask({ demo_type: n }, 1, 200)); all = all.concat(r.rows) }
				all.sort((a, b) => String(b.starts_utc || b.starts_on).localeCompare(String(a.starts_utc || a.starts_on)))
				return { rows: all.slice(p * size, p * size + size), total: all.length }
			}
			async function load(quiet) {
				const my = ++seq; if (!quiet) busy.value = true; error.value = ''
				try {
					const r = await fetchPage(page.value, SIZE)
					if (my !== seq) return
					rows.value = r.rows; total.value = r.total
				} catch (e) { if (my === seq) error.value = DM.friendly(e) } finally { if (my === seq) { loading.value = false; busy.value = false } }
			}
			const reload = CM.debounce(() => { page.value = 0; load() }, 300)
			watch([status, demoType, owner, () => range.value.preset, () => range.value.from, () => range.value.to], () => { page.value = 0; load() })
			watch(q, reload); watch(page, () => load())
			onMounted(async () => { load(); if (!types.value.length) { try { types.value = (await DM.api('list_demo_types')) || []; DM.typesCache = types.value } catch (e) { /* filters just have no widgets */ } } })
			const typeOpts = computed(() => types.value.map((t) => ({ value: t.name, label: t.title })))
			const ownerOpts = computed(() => { const m = new Map(); types.value.forEach((t) => (t.owners || []).forEach((o) => { const u = typeof o === 'string' ? o : o.user; if (u) m.set(u, typeof o === 'object' ? o.full_name || u : u) })); return [...m].map(([value, label]) => ({ value, label })) })
			const typeTitle = (b) => b.demo_title || b.demo_type_title || (types.value.find((t) => t.name === b.demo_type) || {}).title || b.demo_type
			const view = (b) => CM.go('/bookings/' + encodeURIComponent(b.name))
			const closeDrawer = () => CM.go('/bookings')
			const leadUrl = (b) => (b.lead ? CM.leadUrl(b.lead) : '')
			const filtered = computed(() => !!(q.value || status.value || demoType.value || owner.value || range.value.preset !== 'any'))
			function clear() { q.value = ''; status.value = ''; demoType.value = ''; owner.value = ''; range.value = { preset: 'any', from: '', to: '' } }
			const menu = (b) => [
				{ label: 'View details', icon: 'eye', run: () => view(b) },
				b.lead ? { label: 'Open lead', icon: 'user', run: () => CM.openCrm(null, leadUrl(b)) } : null,
				meetLink(b) ? { label: 'Open meeting link', icon: meetIcon(b) === 'gmeet' ? 'gmeet' : 'external', run: () => window.open(meetLink(b), '_blank', 'noopener') } : null,
				b.status !== 'Cancelled' ? { label: 'Notify', icon: 'send', run: () => (notify.value = b) } : null,
				{ sep: true },
				{ label: 'Mark as held', icon: 'check-circle', run: () => DM.changeStatus(b, 'Completed', () => load(true)), disabled: b.status === 'Completed' },
				{ label: 'Mark as no-show', icon: 'ban', run: () => DM.changeStatus(b, 'No Show', () => load(true)), disabled: b.status === 'No Show' },
				DM.canActOnOthers() ? { label: 'Cancel booking', icon: 'x-circle', danger: true, run: () => DM.changeStatus(b, 'Cancelled', () => load(true)), disabled: b.status === 'Cancelled' } : null,
			]
			const notify = ref(null)
			const exporting = ref(false)
			async function exportCsv() {
				exporting.value = true
				try {
					let all = [], p = 0, tot = Infinity
					while (all.length < tot && p < 200) { const r = await fetchPage(p, 200); all = all.concat(r.rows); tot = r.total; if (!r.rows.length) break; p++ }
					CM.csv([['Booking', 'Status', 'Widget', 'Starts', 'Name', 'Email', 'Phone', 'Organisation', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM term', 'UTM content', 'Lead', 'Meeting link', 'Created'], ...all.map((b) => [b.name, b.status, typeTitle(b), startOf(b), DM.who(b), b.email, b.phone, b.organization, b.utm_source, b.utm_medium, b.utm_campaign, b.utm_term, b.utm_content, b.lead, meetLink(b), b.creation])], 'demo-bookings' + (range.value.preset === 'any' ? '' : '-' + CM.resolveRange(range.value).from + '-to-' + CM.resolveRange(range.value).to) + '.csv')
					CM.toast(all.length + ' booking' + (all.length === 1 ? '' : 's') + ' exported')
				} catch (e) { CM.toast(DM.friendly(e), 'err') } finally { exporting.value = false }
			}
			const layout = CM.useLayout('crm_bookings_layout', 'list')
			const chips = [['', 'All'], ...DM.STATUSES.map((s) => [s, s])]
			return { notify, layout, rows, total, loading, busy, error, page, SIZE, q, status, demoType, owner, range, typeOpts, ownerOpts, typeTitle, view, closeDrawer, open, load, filtered, clear, menu, exportCsv, exporting, chips, leadUrl, meetLink, meetIcon, DM, CM }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Bookings</h1><p>Everyone who booked, where they came from, and how it went.</p></div><div class="actions"><DateRange v-model="range" any align="right" size="" aria-label="Booking dates" /><Btn icon="download" :loading="exporting" :disabled="!rows.length" @click="exportCsv">Export CSV</Btn></div></div>
			<div class="row wrap tools">
				<div class="chips" role="group" aria-label="Status"><button v-for="c in chips" :key="c[0]" type="button" class="fchip" :class="{ on: status === c[0] }" :aria-pressed="status === c[0]" @click="status = c[0]">{{ c[1] }}</button></div>
				<div class="grow"></div><LayoutSwitch v-model="layout" />
				<div style="width:200px"><Dd v-model="demoType" :options="typeOpts" allow-empty="All widgets" placeholder="All widgets" aria-label="Widget" size="sm" /></div>
				<div style="width:180px"><Dd v-model="owner" :options="ownerOpts" allow-empty="All hosts" placeholder="All hosts" aria-label="Host" size="sm" /></div>
				<div style="width:min(260px,100%)"><Inp v-model="q" icon="search" placeholder="Search name, email or phone" clearable aria-label="Search bookings" /></div>
			</div>
			<template v-if="loading"><div class="card"><div v-for="n in 6" :key="n" style="padding:14px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div></template>
			<ErrorState v-else-if="error" :message="error" @retry="load()" />
			<Empty v-else-if="!rows.length" icon="calendar" :title="filtered ? 'No bookings match' : 'No bookings yet'" :text="filtered ? 'Change the filters or the date range.' : 'When a visitor books a demo through one of your pages, it shows up here.'"><Btn v-if="filtered" @click="clear">Clear filters</Btn><Btn v-else variant="primary" @click="CM.go('/types')">Go to widgets</Btn></Empty>
			<div v-else-if="layout === 'cards'" :class="{ busy }">
				<div class="dgrid">
					<article v-for="b in rows" :key="b.name" class="card dcard click" tabindex="0" @click="view(b)" @keydown.enter="view(b)">
						<div class="dcard-h"><div class="dcard-t" style="cursor:pointer"><b class="ellipsis">{{ DM.who(b) }}</b><span class="small muted ellipsis">{{ b.email }}</span></div><StatusBadge :value="b.status" /><span @click.stop><Menu :items="menu(b)" :label="'Actions for ' + DM.who(b)" /></span></div>
						<dl class="dcard-d"><div><dt>When</dt><dd>{{ DM.when(b) }}</dd></div><div><dt>Widget</dt><dd class="ellipsis" :title="typeTitle(b)">{{ typeTitle(b) }}</dd></div></dl>
						<div class="dcard-f"><span class="grow small muted ellipsis" :title="[b.utm_source, b.utm_medium, b.utm_campaign].filter(Boolean).join(' / ')">{{ [b.utm_source, b.utm_medium].filter(Boolean).join(' / ') || 'No source' }}</span><a v-if="meetLink(b)" class="btn ghost icon sm" :href="meetLink(b)" target="_blank" rel="noopener" title="Meeting link" aria-label="Meeting link" @click.stop><Ico :name="meetIcon(b)" /></a></div>
					</article>
				</div>
				<div class="card" style="margin-top:12px"><Pager v-model:page="page" :size="SIZE" :total="total" /></div>
			</div>
			<div v-else class="card" :class="{ busy }" style="overflow:hidden">
				<div class="table-wrap"><table class="tbl bk-tbl">
					<thead><tr><th>Visitor</th><th>Widget</th><th>When</th><th>Status</th><th>Source</th><th>Medium</th><th>Campaign</th><th></th></tr></thead>
					<tbody><tr v-for="b in rows" :key="b.name" class="click" tabindex="0" @click="view(b)" @keydown.enter="view(b)">
						<td><b class="ellipsis" style="display:block;max-width:210px">{{ DM.who(b) }}</b><div class="small muted ellipsis" style="max-width:210px" :title="b.email + ' ' + (b.phone || '')">{{ b.email }}</div></td>
						<td class="ellipsis" style="max-width:150px" :title="typeTitle(b)">{{ typeTitle(b) }}</td>
						<td class="nowrap">{{ DM.when(b) }}</td>
						<td><StatusBadge :value="b.status" /></td>
						<td>{{ b.utm_source || '-' }}</td><td>{{ b.utm_medium || '-' }}</td><td class="ellipsis" style="max-width:130px" :title="b.utm_campaign">{{ b.utm_campaign || '-' }}</td>
						<td class="num nowrap" @click.stop><a v-if="b.lead" class="btn ghost icon sm" :href="leadUrl(b)" title="Open lead" aria-label="Open lead" @click="CM.openCrm($event, leadUrl(b))"><Ico name="user" /></a><a v-if="meetLink(b)" class="btn ghost icon sm" :href="meetLink(b)" target="_blank" rel="noopener" title="Meeting link" aria-label="Meeting link"><Ico :name="meetIcon(b)" /></a><Menu :items="menu(b)" :label="'Actions for ' + DM.who(b)" /></td>
					</tr></tbody>
				</table></div>
				<Pager v-model:page="page" :size="SIZE" :total="total" />
			</div>
			<NotifyModal v-if="notify" :booking="notify" @close="notify = null" @done="notify = null; load(true)" />
			<BookingDrawer v-if="open" :name="open" @close="closeDrawer" @changed="load(true)" />
		</div>`,
	}
})()
