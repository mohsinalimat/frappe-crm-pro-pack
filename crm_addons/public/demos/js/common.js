/* Demo booking admin: shared helpers on top of the Campaign Manager's core (window.CM): server calls, defaults, time and
 * time-zone maths, the demo variables and a few small components. Everything lives on window.DM. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const C = CM.components
	const DM = (window.DM = { views: {} })

	// ------------------------------------------------------------------ server
	DM.api = (m, a) => CM.call('crm_addons.demos.admin.' + m, a)
	DM.apiLatest = (key, m, a) => CM.call('crm_addons.demos.admin.' + m, a) // keys are used by callers that cancel with CM.cancel
	DM.ERR_MISSING = /not found|has no attribute|no module named|not whitelisted|AttributeError|ImportError|Failed to get method/i
	/** A server that does not have an endpoint yet answers with a technical error; say it in plain words. */
	DM.friendly = (e) => (e && DM.ERR_MISSING.test(e.message || '') ? 'This part of the server is not available yet. Update CRM Pro Pack and run bench migrate.' : (e && e.message) || 'Something went wrong.')

	DM.WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
	DM.SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }
	DM.longDay = (d) => DM.WEEKDAYS.find((w) => w === d || DM.SHORT[w] === d) || d // the server stores Mon..Sun
	DM.RESERVED = ['manage', 'embed', 'api']
	DM.EVENTS = ['Confirmed', 'Rescheduled', 'Cancelled']
	DM.STATUSES = ['Confirmed', 'Rescheduled', 'Cancelled', 'Completed', 'No Show']
	CM.STATUS_TONE = Object.assign(CM.STATUS_TONE, { Confirmed: 'blue', Rescheduled: 'amber', 'No Show': 'red', Failed: 'red', Sent: 'green', Skipped: 'amber', Pending: 'neutral', Sending: 'blue' })
	DM.CHECKS = ['enabled', 'owner_notify', 'allow_guests', 'consent_default', 'assign_lead_to_owner']

	// ------------------------------------------------------------------ small value helpers
	DM.pad = (n) => String(n).padStart(2, '0')
	DM.hhmm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? DM.pad(m[1]) + ':' + m[2] : '' }
	DM.toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : NaN }
	DM.fromMin = (n) => DM.pad(Math.floor(n / 60)) + ':' + DM.pad(n % 60)
	DM.clock = (t, h12 = true) => { const n = DM.toMin(t); if (isNaN(n)) return ''; const h = Math.floor(n / 60), m = n % 60; if (!h12) return DM.pad(h) + ':' + DM.pad(m); return ((h + 11) % 12 + 1) + (m ? ':' + DM.pad(m) : '') + (h < 12 ? ' am' : ' pm') }
	DM.slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
	DM.keyify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
	DM.isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim())
	DM.isHex = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s || ''))
	DM.bool = (v) => v === true || v === 1 || v === '1'
	DM.publicUrl = (slug) => location.origin + '/book/' + slug
	DM.copy = async (text, what) => {
		try { await navigator.clipboard.writeText(text) } catch (e) {
			const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select()
			try { document.execCommand('copy') } catch (e2) { CM.toast('Could not copy. Select the text and copy it by hand.', 'err'); t.remove(); return false }
			t.remove()
		}
		CM.toast((what || 'Text') + ' copied')
		return true
	}
	/** Minutes before a start, in words: 1440 -> "24 hours before", 60 -> "1 hour before", 0 -> "At the start". */
	DM.offsetLabel = (m) => {
		m = Number(m) || 0
		if (m <= 0) return 'At the start'
		const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60
		const parts = []
		if (d) parts.push(d + (d === 1 ? ' day' : ' days'))
		if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'))
		if (mi) parts.push(mi + (mi === 1 ? ' minute' : ' minutes'))
		return parts.join(' ') + ' before'
	}
	DM.durationLabel = (m) => { m = Number(m) || 0; return m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? ' hour' : ' hours') : m + ' min' }
	DM.statusIcon = { Confirmed: 'check-circle', Rescheduled: 'refresh', Cancelled: 'x-circle', Completed: 'check', 'No Show': 'ban' }

	// ------------------------------------------------------------------ time zones
	DM.zones = (() => { try { return Intl.supportedValuesOf('timeZone') } catch (e) { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'] } })()
	if (!DM.zones.includes('UTC')) DM.zones = ['UTC', ...DM.zones]
	DM.zoneOptions = (cur) => { const l = DM.zones.slice(); ;['Asia/Kolkata', 'Asia/Calcutta'].forEach((z) => { if (!l.includes(z)) l.push(z) }); if (cur && !l.includes(cur)) l.push(cur); return l.sort().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })) }
	/** The offset (minutes) of a zone at an instant. */
	DM.tzOffset = (tz, date) => {
		try {
			const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date)
			const g = (t) => +p.find((x) => x.type === t).value
			return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(date.getTime() / 1000) * 1000) / 60000
		} catch (e) { return 0 }
	}
	/** The instant for a wall clock time (YYYY-MM-DD, minutes since midnight) in a zone. */
	DM.zoned = (day, min, tz) => {
		const [y, m, d] = day.split('-').map(Number)
		const guess = Date.UTC(y, m - 1, d, 0, min)
		let t = guess - DM.tzOffset(tz, new Date(guess)) * 60000
		t = guess - DM.tzOffset(tz, new Date(t)) * 60000
		return new Date(t)
	}
	/** "Today" as a day string in a zone. */
	DM.todayIn = (tz, now) => {
		try { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date()); return p } catch (e) { return CM.ymd(new Date()) }
	}
	DM.addDay = (day, n) => { const d = CM.parseDay(day); d.setDate(d.getDate() + n); return CM.ymd(d) }
	DM.weekdayOf = (day) => DM.WEEKDAYS[(CM.parseDay(day).getDay() + 6) % 7]

	// ------------------------------------------------------------------ demo variables (for the message editors and previews)
	DM.VARIABLES = [
		{ name: 'first_name', label: 'Visitor first name' }, { name: 'lead_name', label: 'Visitor full name' }, { name: 'email', label: 'Visitor email' }, { name: 'mobile_no', label: 'Visitor phone' },
		{ name: 'organization', label: 'School or company' }, { name: 'demo_title', label: 'Demo title' }, { name: 'demo_date', label: 'Demo date' }, { name: 'demo_time', label: 'Demo time' },
		{ name: 'demo_datetime', label: 'Date and time (with time zone)' }, { name: 'demo_duration', label: 'Duration' }, { name: 'meet_link', label: 'Meeting link' },
		{ name: 'host_name', label: 'Host name' }, { name: 'host_names', label: 'All host names' }, { name: 'booking_link', label: 'Booking page link' },
		{ name: 'reschedule_link', label: 'Reschedule link' }, { name: 'cancel_link', label: 'Cancel link' },
	]
	DM.vars = reactive({ list: DM.VARIABLES.slice(), loaded: false })
	DM.loadVars = async () => {
		if (DM.vars.loaded) return
		DM.vars.loaded = true
		try { const r = await DM.api('get_demo_variables'); const list = Array.isArray(r) ? r : r && (r.variables || r.rows); if (list && list.length) DM.vars.list = list.map((v) => (typeof v === 'string' ? { name: v, label: v } : { name: v.name || v.key, label: v.label || v.name })) } catch (e) { /* the built-in list stays */ }
	}
	DM.SAMPLE = { first_name: 'Aarav', lead_name: 'Aarav Mehta', last_name: 'Mehta', email: 'aarav@example.com', mobile_no: '+91 98765 43210', organization: 'Greenfield School', demo_title: 'Product demo', demo_date: 'Tuesday, 12 March', demo_time: '4:00 pm', demo_datetime: 'Tuesday, 12 March, 4:00 pm IST', demo_duration: '30 minutes', meet_link: 'https://meet.google.com/abc-defg-hij', host_name: 'Riya Sharma', host_names: 'Riya Sharma, Kabir Rao', booking_link: location.origin + '/book/manage/abc123', reschedule_link: location.origin + '/book/manage/abc123?r=1', cancel_link: location.origin + '/book/manage/abc123?c=1', owner_name: 'Riya Sharma' }
	DM.fill = (s) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in DM.SAMPLE ? DM.SAMPLE[k] : CM.sampleFill(m)))

	// ------------------------------------------------------------------ the doc: defaults, from / to the server
	DM.FIXED_FIELDS = ['name', 'email', 'phone']
	DM.defaultFields = () => [
		{ key: 'name', label: 'Your name', kind: 'Text', required: true, options: '', placeholder: 'Full name', enabled: true, lead_field: 'first_name' },
		{ key: 'email', label: 'Email', kind: 'Email', required: true, options: '', placeholder: 'you@example.com', enabled: true, lead_field: 'email' },
		{ key: 'phone', label: 'Phone', kind: 'Phone', required: true, options: '', placeholder: '98765 43210', enabled: true, lead_field: 'mobile_no' },
	]
	DM.defaultMessages = () => [
		{ event: 'Confirmed', minutes_before: 0 }, { event: 'Rescheduled', minutes_before: 0 }, { event: 'Cancelled', minutes_before: 0 },
		{ event: 'Reminder', minutes_before: 1440 }, { event: 'Reminder', minutes_before: 60 }, { event: 'Reminder', minutes_before: 30 }, { event: 'Reminder', minutes_before: 0 },
	].map((m) => ({ send_email: false, email_template: '', send_whatsapp: false, wa_template: '', wa_account: '', wa_variables: '', ...m }))
	DM.weekdayHours = (days, from = '09:00', to = '17:00') => days.map((weekday) => ({ weekday, from_time: from, to_time: to }))
	DM.newDoc = () => ({
		title: '', slug: '', enabled: true, description: '', duration_minutes: 30, slot_interval_minutes: 30, timezone: (CM.shared.config && CM.shared.config.timezone) || 'Asia/Kolkata', provider: 'Google Meet', manual_link: '', location_note: '',
		buffer_before_minutes: 0, buffer_after_minutes: 0, min_notice_hours: 4, max_days_ahead: 30, max_per_day: 0,
		owners: [], cc: [], owner_notify: true,
		hours: DM.weekdayHours(DM.WEEKDAYS.slice(0, 5)), overrides: [],
		fields: DM.defaultFields(), allow_guests: false, consent_text: 'Send me my booking confirmation and reminders on WhatsApp.', consent_default: true,
		lead_source: '', lead_status: '', assign_lead_to_owner: true,
		messages: DM.defaultMessages(),
		brand_name: '', logo: '', accent_color: '#2d36a3', theme: 'Auto', heading: '', button_text: 'Confirm booking', success_title: 'You are booked', success_text: 'A confirmation is on its way to your email.', footer_text: '', redirect_url: '', allowed_origins: '',
		max_active_per_contact: 1, max_per_ip_per_hour: 10,
	})
	/** The server's document into the shape the editor works on (booleans, HH:MM, every list present). */
	DM.fromServer = (d) => {
		const o = Object.assign(DM.newDoc(), CM.clone(d || {}))
		DM.CHECKS.forEach((k) => { o[k] = DM.bool(d && d[k] !== undefined ? d[k] : DM.newDoc()[k]) })
		o.owners = (d.owners || []).map((x) => (typeof x === 'string' ? { user: x } : { user: x.user, full_name: x.full_name || x.user_name || '' }))
		o.cc = (d.cc || []).map((x) => (typeof x === 'string' ? (DM.isEmail(x) ? { email: x } : { user: x }) : { user: x.user || '', email: x.email || '', full_name: x.full_name || '' }))
		o.hours = (d.hours || []).map((h) => ({ weekday: DM.longDay(h.weekday), from_time: DM.hhmm(h.from_time), to_time: DM.hhmm(h.to_time) }))
		o.overrides = (d.overrides || []).map((x) => ({ date: String(x.date || '').slice(0, 10), kind: x.kind || 'Unavailable', from_time: DM.hhmm(x.from_time), to_time: DM.hhmm(x.to_time), note: x.note || '' }))
		o.fields = (d.fields && d.fields.length ? d.fields : DM.defaultFields()).map((f) => ({ key: f.key, label: f.label || '', kind: f.kind || 'Text', required: DM.bool(f.required), options: f.options || '', placeholder: f.placeholder || '', enabled: f.enabled === undefined ? true : DM.bool(f.enabled), lead_field: f.lead_field || '' }))
		DM.FIXED_FIELDS.forEach((k) => { if (!o.fields.some((f) => f.key === k)) o.fields.unshift(DM.defaultFields().find((f) => f.key === k)) })
		o.messages = (d.messages && d.messages.length ? d.messages : DM.defaultMessages()).map((m) => ({ event: m.event, minutes_before: Number(m.minutes_before) || 0, send_email: DM.bool(m.send_email), email_template: m.email_template || '', send_whatsapp: DM.bool(m.send_whatsapp), wa_template: m.wa_template || '', wa_account: m.wa_account || '', wa_variables: m.wa_variables || '' }))
		;['duration_minutes', 'slot_interval_minutes', 'buffer_before_minutes', 'buffer_after_minutes', 'min_notice_hours', 'max_days_ahead', 'max_per_day', 'max_active_per_contact', 'max_per_ip_per_hour'].forEach((k) => { o[k] = Number(o[k]) || 0 })
		o.accent_color = o.accent_color || '#2d36a3'; o.theme = o.theme || 'Auto'; o.provider = o.provider || 'Google Meet'
		return o
	}
	DM.toServer = (doc) => {
		const o = CM.clone(doc)
		DM.CHECKS.forEach((k) => { o[k] = o[k] ? 1 : 0 })
		o.hours = o.hours.map((h) => ({ weekday: DM.SHORT[h.weekday] || h.weekday, from_time: h.from_time + ':00', to_time: h.to_time + ':00' }))
		o.overrides = o.overrides.map((x) => ({ date: x.date, kind: x.kind, from_time: x.kind === 'Custom hours' ? x.from_time + ':00' : null, to_time: x.kind === 'Custom hours' ? x.to_time + ':00' : null, note: x.note }))
		o.cc = o.cc.map((x) => ({ user: x.user || null, email: x.user ? null : x.email }))
		o.owners = o.owners.map((x) => ({ user: x.user }))
		o.fields = o.fields.map((f) => ({ ...f, required: f.required ? 1 : 0, enabled: f.enabled ? 1 : 0 }))
		o.messages = o.messages.map((m) => ({ ...m, send_email: m.send_email ? 1 : 0, send_whatsapp: m.send_whatsapp ? 1 : 0 }))
		return o
	}

	// ------------------------------------------------------------------ people (team members for owners / CC)
	DM.searchUsers = async (txt) => {
		const r = await CM.call('crm_addons.api.search_guests', { txt: txt || '' })
		return (r || []).map((x) => ({ user: x.email, email: x.email, full_name: x.full_name || x.email, kind: x.attendee_type }))
	}
	DM.nameOf = (p) => (p && (p.full_name || p.user || p.email)) || ''

	// ------------------------------------------------------------------ manager check, shared lookups
	DM.session = reactive({ ready: false, is_manager: false, error: '', demos_enabled: true, demos: 'own', widgets: 'none', report: false })
	DM.loadSession = async () => {
		try {
			const c = await CM.call('crm_addons.api.get_client_config')
			DM.session.is_manager = !!c.is_manager
			DM.session.demos_enabled = c.demos_enabled !== 0
			// what the person's access settings allow (Team and access): which demos, the widgets, the report
			const a = c.access || {}
			DM.session.demos = a.demos || (c.is_manager ? 'all' : 'own')
			DM.session.widgets = a.demo_widgets || (c.is_manager ? 'manage' : 'none')
			DM.session.report = a.demo_report === undefined ? !!c.is_manager : !!Number(a.demo_report)
		} catch (e) { DM.session.error = e.message } finally { DM.session.ready = true }
	}
	DM.lookups = reactive({ sources: [], statuses: [], loaded: false })
	DM.loadLookups = async () => {
		if (DM.lookups.loaded) return
		DM.lookups.loaded = true
		const get = async (dt) => { try { return (await CM.call('frappe.client.get_list', { doctype: dt, fields: ['name'], limit_page_length: 200, order_by: 'name asc' })).map((x) => x.name) } catch (e) { return [] } }
		DM.lookups.sources = await get('CRM Lead Source')
		DM.lookups.statuses = (CM.shared.config && CM.shared.config.lead_statuses) || await get('CRM Lead Status')
	}
	/** Template library caches (the same lists the campaign wizard uses). */
	// the ready-made messages (server: demos/defaults.py): email template names and the Utility WhatsApp definitions with their state on this site
	DM.defaults = reactive({ rows: [], loaded: false, loading: false, error: '' })
	DM.loadDefaults = async (force) => {
		if (DM.defaults.loading || (DM.defaults.loaded && !force)) return
		DM.defaults.loading = true; DM.defaults.error = ''
		try { DM.defaults.rows = await DM.api('default_messages', {}); DM.defaults.loaded = true } catch (e) { DM.defaults.error = e.message } finally { DM.defaults.loading = false }
	}
	DM.defaultFor = (rule) => DM.defaults.rows.find((d) => d.event === rule.event && Number(d.minutes_before) === (rule.event === 'Reminder' ? Number(rule.minutes_before) || 0 : 0))
	/** Fill what is empty in a rule from its ready-made message; never replaces a choice. Returns what it changed. */
	DM.applyDefault = (rule) => {
		const d = DM.defaultFor(rule); const done = []
		if (!d) return done
		if (!rule.email_template && d.email_exists) { rule.email_template = d.email_template; rule.send_email = true; done.push('email') }
		const w = d.whatsapp
		if (!rule.wa_template && w.approved && w.name) { rule.wa_template = w.name; rule.wa_account = w.whatsapp_account || ''; rule.wa_variables = JSON.stringify(w.variable_map); rule.send_whatsapp = true; done.push('WhatsApp') }
		return done
	}
	DM.waTemplates = reactive({ rows: [], loaded: false, loading: false, error: '', installed: true })
	DM.loadWa = async (force) => {
		if (DM.waTemplates.loading || (DM.waTemplates.loaded && !force)) return
		DM.waTemplates.loading = true; DM.waTemplates.error = ''
		try { const r = await CM.api('list_whatsapp_templates', {}); DM.waTemplates.rows = r.rows || []; DM.waTemplates.installed = r.installed !== false; DM.waTemplates.loaded = true } catch (e) { DM.waTemplates.error = e.message } finally { DM.waTemplates.loading = false }
	}

	// ------------------------------------------------------------------ unsaved-changes plumbing
	DM.guard = { fn: null } // set by the editor while it has changes
	DM.leave = async (path) => {
		if (DM.guard.fn && !(await DM.guard.fn())) return false
		CM.go(path)
		return true
	}
	window.addEventListener('beforeunload', (e) => { if (DM.guard.fn && DM.guard.dirty && DM.guard.dirty()) { e.preventDefault(); e.returnValue = '' } })
	CM.closeGuards.add(() => (DM.guard.fn ? DM.guard.fn() : true))

	// ------------------------------------------------------------------ components
	C.CopyBtn = {
		props: { text: String, label: { type: String, default: 'Copy' }, what: String, size: { type: String, default: 'sm' }, bare: Boolean },
		setup(props) {
			const done = ref(false); let t
			async function go() { if (await DM.copy(props.text, props.what)) { done.value = true; clearTimeout(t); t = setTimeout(() => (done.value = false), 1600) } }
			onBeforeUnmount(() => clearTimeout(t))
			return { done, go }
		},
		template: `<button type="button" class="btn" :class="[size, bare ? 'ghost icon' : '']" :aria-label="label" :title="label" @click.stop="go"><Ico :name="done ? 'check' : 'copy'" /><template v-if="!bare">{{ done ? 'Copied' : label }}</template></button>`,
	}
	C.AvatarStack = {
		props: { people: { type: Array, default: () => [] }, max: { type: Number, default: 4 }, size: { type: Number, default: 26 } },
		template: `<span class="av-stack" :aria-label="people.map((p) => p.full_name || p.user || p).join(', ')"><span v-for="(p, i) in people.slice(0, max)" :key="i" class="av-i" :title="p.full_name || p.user || p"><Avatar :name="p.full_name || p.user || String(p)" :size="size" /></span><span v-if="people.length > max" class="av-more" :style="{ width: size + 'px', height: size + 'px' }">+{{ people.length - max }}</span></span>`,
	}
	C.NumInp = {
		props: { modelValue: Number, min: Number, max: Number, step: { type: Number, default: 1 }, unit: String, bad: Boolean, width: { type: String, default: '' } },
		emits: ['update:modelValue'],
		template: `<div class="numinp" :style="width ? { width } : null"><input class="inp" :class="{ bad }" type="number" inputmode="numeric" :min="min" :max="max" :step="step" :value="modelValue" v-bind="$attrs" @input="$emit('update:modelValue', $event.target.value === '' ? 0 : Number($event.target.value))" /><span v-if="unit" class="unit">{{ unit }}</span></div>`,
		inheritAttrs: false,
	}
	C.Section = {
		props: { title: String, text: String, icon: String },
		template: `<section class="card pad sec"><div class="sec-h"><div v-if="icon" class="sec-i"><Ico :name="icon" /></div><div class="grow"><h3>{{ title }}</h3><p v-if="text">{{ text }}</p></div><slot name="actions" /></div><div class="sec-b"><slot /></div></section>`,
	}
	/** A switch with its label and an explanation beside it. */
	C.Toggle = {
		props: { modelValue: Boolean, label: String, text: String, disabled: Boolean },
		emits: ['update:modelValue'],
		template: `<div class="tog" :class="{ off: disabled }"><Switch :model-value="modelValue" :label="label" @update:model-value="!disabled && $emit('update:modelValue', $event)" /><div class="grow"><b>{{ label }}</b><div v-if="text" class="small muted">{{ text }}</div></div><slot /></div>`,
	}
	/** A day-of-week x time range editor row is in availability.js; this is the plain time range pair. */
	C.TimeSel = {
		props: { modelValue: String, bad: Boolean, ariaLabel: String },
		emits: ['update:modelValue'],
		setup(props) {
			const opts = computed(() => {
				const l = []; for (let m = 0; m < 1440; m += 15) l.push({ value: DM.fromMin(m), label: DM.clock(DM.fromMin(m)) })
				const v = DM.hhmm(props.modelValue); if (v && !l.some((x) => x.value === v)) { l.push({ value: v, label: DM.clock(v) }); l.sort((a, b) => a.value.localeCompare(b.value)) }
				return l
			})
			return { opts, DM }
		},
		template: `<div class="timesel"><Dd :model-value="modelValue" :options="opts" size="sm" :bad="bad" searchable :aria-label="ariaLabel || 'Time'" placeholder="--:--" @update:model-value="$emit('update:modelValue', $event)" /></div>`,
	}
	C.TimeRange = {
		props: { from: String, to: String, bad: Boolean },
		emits: ['update:from', 'update:to', 'remove'],
		template: `<div class="trange" :class="{ bad }"><TimeSel :model-value="from" :bad="bad" aria-label="From" @update:model-value="$emit('update:from', $event)" /><span class="faint">to</span><TimeSel :model-value="to" :bad="bad" aria-label="To" @update:model-value="$emit('update:to', $event)" /><slot /></div>`,
	}
	/** Variables as a popover (same look as the campaign editor's Insert variable), with the demo variable list. */
	C.DemoVarMenu = {
		props: { size: String, label: { type: String, default: 'Insert variable' } },
		emits: ['pick'],
		setup(props, { emit }) {
			const trig = ref(null); const q = ref('')
			const p = CM.usePop(() => trig.value, { width: 300, maxH: 380 })
			onMounted(() => DM.loadVars())
			const list = computed(() => { const t = q.value.trim().toLowerCase(); return DM.vars.list.filter((v) => !t || (v.name + ' ' + v.label).toLowerCase().includes(t)) })
			function toggleMenu() { q.value = ''; p.toggle(); if (p.open.value) nextTick(() => p.pop.value && p.pop.value.querySelector('input') && p.pop.value.querySelector('input').focus()) }
			function pick(v) { emit('pick', '{{ ' + v.name + ' }}', v); p.close() }
			return { trig, q, list, toggleMenu, pick, ...p }
		},
		template: `
		<span style="display:inline-flex">
			<button ref="trig" type="button" class="btn" :class="size || 'sm'" @mousedown.prevent @click="toggleMenu"><Ico name="variable" />{{ label }}</button>
			<Teleport to="body">
				<div v-if="open" ref="pop" class="pop" :style="style" @mousedown.prevent.self>
					<div class="pop-search"><input class="inp" style="height:32px" v-model="q" placeholder="Search variables" aria-label="Search variables" /></div>
					<div class="pop-list"><button v-for="v in list" :key="v.name" type="button" class="opt" @mousedown.prevent @click="pick(v)"><span class="grow"><span class="ellipsis" style="display:block">{{ v.label }}</span></span><span class="mono tiny faint">{{ $tok(v.name) }}</span></button><div v-if="!list.length" class="pop-empty">No variable found</div></div>
				</div>
			</Teleport>
		</span>`,
	}
})()
