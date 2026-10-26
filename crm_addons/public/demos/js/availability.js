/* Demo booking admin: the Availability tab - weekly hours, date overrides, booking rules, and a live preview of the slots. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	const PRESETS = [
		{ key: 'wk', label: 'Mon-Fri, 9 am - 5 pm', days: 5, ranges: [['09:00', '17:00']] },
		{ key: 'wk2', label: 'Mon-Fri with lunch break', days: 5, ranges: [['09:00', '13:00'], ['14:00', '18:00']] },
		{ key: 'sat', label: 'Mon-Sat, 10 am - 6 pm', days: 6, ranges: [['10:00', '18:00']] },
		{ key: 'all', label: 'Every day, 9 am - 9 pm', days: 7, ranges: [['09:00', '21:00']] },
	]

	/** The slots a visitor would see for the next days, from the editor's current values (not from the server). */
	DM.previewSlots = (doc, days = 14) => {
		const tz = doc.timezone || 'UTC'; const now = new Date()
		const dur = Math.max(5, Number(doc.duration_minutes) || 30); const step = Math.max(5, Number(doc.slot_interval_minutes) || dur)
		const earliest = now.getTime() + (Number(doc.min_notice_hours) || 0) * 3600000
		const latest = now.getTime() + (Number(doc.max_days_ahead) || 0) * 864e5
		const today = DM.todayIn(tz, now); const out = []
		for (let i = 0; i < days; i++) {
			const day = DM.addDay(today, i); const wd = DM.weekdayOf(day)
			const ov = doc.overrides.filter((o) => o.date === day)
			let ranges
			if (ov.some((o) => o.kind === 'Unavailable')) ranges = []
			else if (ov.some((o) => o.kind === 'Custom hours')) ranges = ov.filter((o) => o.kind === 'Custom hours').map((o) => [o.from_time, o.to_time])
			else ranges = doc.hours.filter((h) => h.weekday === wd).map((h) => [h.from_time, h.to_time])
			const slots = []
			ranges.forEach(([a, b]) => {
				const from = DM.toMin(a), to = DM.toMin(b)
				if (isNaN(from) || isNaN(to)) return
				for (let s = from; s + dur <= to; s += step) {
					const at = DM.zoned(day, s, tz).getTime()
					if (at < earliest || (doc.max_days_ahead && at > latest)) continue
					slots.push(s)
				}
			})
			out.push({ day, wd, slots: [...new Set(slots)].sort((x, y) => x - y), closed: !ranges.length, override: ov.length ? (ov.some((o) => o.kind === 'Unavailable') ? 'blocked' : 'custom') : '' })
		}
		return out
	}

	V.AvailabilityTab = {
		props: { doc: Object, errs: Object },
		setup(props) {
			const doc = props.doc
			// ---- weekly hours (edited per weekday, written back to the flat list the server stores)
			const week = reactive({})
			DM.WEEKDAYS.forEach((d) => { week[d] = doc.hours.filter((h) => h.weekday === d).map((h) => ({ from: h.from_time, to: h.to_time })) })
			let writing = false
			watch(week, () => { writing = true; doc.hours = DM.WEEKDAYS.flatMap((d) => week[d].map((r) => ({ weekday: d, from_time: r.from, to_time: r.to }))); Vue.nextTick(() => (writing = false)) }, { deep: true })
			const dayErr = (d) => {
				const r = week[d].map((x) => [DM.toMin(x.from), DM.toMin(x.to)])
				if (r.some((x) => isNaN(x[0]) || isNaN(x[1]))) return 'Fill in both times.'
				if (r.some((x) => x[1] <= x[0])) return 'The end must be after the start.'
				const s = r.slice().sort((a, b) => a[0] - b[0])
				for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1]) return 'These ranges overlap.'
				return ''
			}
			const anyDay = computed(() => DM.WEEKDAYS.some((d) => week[d].length))
			function toggleDay(d, on) { week[d].splice(0, week[d].length, ...(on ? [{ from: '09:00', to: '17:00' }] : [])) }
			function addRange(d) {
				const l = week[d][week[d].length - 1]
				if (!l) return week[d].push({ from: '09:00', to: '17:00' })
				const start = Math.min(DM.toMin(l.to) + 60, 22 * 60); week[d].push({ from: DM.fromMin(start), to: DM.fromMin(Math.min(start + 120, 23 * 60 + 59)) })
			}
			const copyTo = (d, targets) => { const src = week[d].map((r) => ({ ...r })); targets.forEach((t) => { if (t !== d) week[t].splice(0, week[t].length, ...src.map((r) => ({ ...r }))) }); CM.toast('Hours copied') }
			function preset(p) { DM.WEEKDAYS.forEach((d, i) => week[d].splice(0, week[d].length, ...(i < p.days ? p.ranges.map((r) => ({ from: r[0], to: r[1] })) : []))) }
			const dayMenu = (d) => [{ label: 'Copy to all days', icon: 'copy', run: () => copyTo(d, DM.WEEKDAYS) }, { label: 'Copy to Monday-Friday', icon: 'copy', run: () => copyTo(d, DM.WEEKDAYS.slice(0, 5)) }, { sep: true }, { label: 'Clear this day', icon: 'trash', run: () => toggleDay(d, false) }]

			// ---- date overrides
			const cur = ref(new Date(CM.today().getFullYear(), CM.today().getMonth(), 1))
			const dlg = reactive({ open: false, day: '', mode: 'unavailable', ranges: [], note: '' })
			const ovByDay = computed(() => { const m = {}; doc.overrides.forEach((o) => (m[o.date] = m[o.date] || []).push(o)); return m })
			const grid = computed(() => {
				const first = cur.value; const lead = (first.getDay() + 6) % 7; const total = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
				const today = CM.ymd(CM.today())
				return [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => {
					const d = new Date(first.getFullYear(), first.getMonth(), i + 1); const s = CM.ymd(d); const ov = ovByDay.value[s]
					const closed = !week[DM.weekdayOf(s)].length
					return { s, n: i + 1, past: s < today, today: s === today, state: ov ? (ov.some((o) => o.kind === 'Unavailable') ? 'blocked' : 'custom') : closed ? 'closed' : '' }
				})]
			})
			const monthTitle = computed(() => cur.value.toLocaleDateString([], { month: 'long', year: 'numeric' }))
			const step = (n) => (cur.value = new Date(cur.value.getFullYear(), cur.value.getMonth() + n, 1))
			function openDay(s) {
				const ov = ovByDay.value[s] || []
				dlg.day = s; dlg.note = (ov[0] && ov[0].note) || ''
				if (ov.some((o) => o.kind === 'Unavailable')) { dlg.mode = 'unavailable'; dlg.ranges = [{ from: '09:00', to: '17:00' }] }
				else if (ov.length) { dlg.mode = 'custom'; dlg.ranges = ov.map((o) => ({ from: o.from_time, to: o.to_time })) }
				else { dlg.mode = 'unavailable'; const w = week[DM.weekdayOf(s)]; dlg.ranges = w.length ? w.map((r) => ({ ...r })) : [{ from: '09:00', to: '17:00' }] }
				dlg.hadOverride = ov.length > 0
				dlg.open = true
			}
			const dlgErr = computed(() => {
				if (dlg.mode !== 'custom') return ''
				const r = dlg.ranges.map((x) => [DM.toMin(x.from), DM.toMin(x.to)])
				if (!r.length) return 'Add at least one time range.'
				if (r.some((x) => isNaN(x[0]) || isNaN(x[1]) || x[1] <= x[0])) return 'Each range needs an end after its start.'
				const s = r.slice().sort((a, b) => a[0] - b[0]); for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1]) return 'These ranges overlap.'
				return ''
			})
			function applyDay(mode) {
				if (dlgErr.value && mode === 'custom') return
				doc.overrides = doc.overrides.filter((o) => o.date !== dlg.day)
				if (mode === 'unavailable') doc.overrides.push({ date: dlg.day, kind: 'Unavailable', from_time: '', to_time: '', note: dlg.note })
				else if (mode === 'custom') dlg.ranges.forEach((r) => doc.overrides.push({ date: dlg.day, kind: 'Custom hours', from_time: r.from, to_time: r.to, note: dlg.note }))
				dlg.open = false
			}
			const sortedOverrides = computed(() => Object.keys(ovByDay.value).sort().map((s) => ({ s, rows: ovByDay.value[s] })))
			const ovText = (rows) => (rows.some((o) => o.kind === 'Unavailable') ? 'Unavailable' : rows.map((o) => DM.clock(o.from_time) + ' - ' + DM.clock(o.to_time)).join(', '))
			const removeDay = (s) => (doc.overrides = doc.overrides.filter((o) => o.date !== s))
			const newDate = ref('')
			function addDate() { if (newDate.value) { const d = CM.parseDay(newDate.value); if (d) { cur.value = new Date(d.getFullYear(), d.getMonth(), 1); openDay(newDate.value); newDate.value = '' } } }
			function dayKey(e, c) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(c.s) } }

			// ---- preview
			const preview = computed(() => DM.previewSlots(doc, 14))
			const totalSlots = computed(() => preview.value.reduce((a, d) => a + d.slots.length, 0))
			const h12 = ref(true)
			const dayLabel = (s) => CM.parseDay(s).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
						return { week, dayErr, anyDay, toggleDay, addRange, dayMenu, preset: preset, PRESETS, cur, grid, monthTitle, step, openDay, dlg, dlgErr, applyDay, sortedOverrides, ovText, removeDay, newDate, addDate, dayKey, preview, totalSlots, h12, dayLabel, DM, CM, weekdays: DM.WEEKDAYS }
		},
		template: `
		<div class="col tabcol">
			<div class="avgrid">
				<Section title="Weekly hours" icon="clock" text="When visitors can book, in the time zone of this widget.">
					<template #actions><Menu :items="PRESETS.map((p) => ({ label: p.label, icon: 'clock', run: () => preset(p) })).concat([{ sep: true }, { label: 'Clear all days', icon: 'trash', run: () => weekdays.forEach((d) => toggleDay(d, false)) }])" label="Quick presets"><Btn size="sm" icon="zap">Presets</Btn></Menu></template>
					<div class="chips presets"><button v-for="p in PRESETS.slice(0, 2)" :key="p.key" type="button" class="fchip" @click="preset(p)">{{ p.label }}</button></div>
					<div v-if="errs.hours" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ errs.hours }}</div></div>
					<div class="week">
						<div v-for="d in weekdays" :key="d" class="wd" :class="{ off: !week[d].length, bad: dayErr(d) }">
							<div class="wd-h"><Switch :model-value="week[d].length > 0" :label="d" @update:model-value="toggleDay(d, $event)" /><b>{{ d.slice(0, 3) }}</b></div>
							<div class="wd-b">
								<span v-if="!week[d].length" class="faint">Unavailable</span>
								<template v-else><div v-for="(r, i) in week[d]" :key="i" class="wd-r"><TimeRange v-model:from="r.from" v-model:to="r.to" :bad="!!dayErr(d)"><Btn v-if="week[d].length > 1" size="sm" variant="ghost" icon="x" :aria-label="'Remove range on ' + d" @click="week[d].splice(i, 1)" /></TimeRange></div>
								<div v-if="dayErr(d)" class="err small" role="alert">{{ dayErr(d) }}</div></template>
							</div>
							<div class="wd-a"><Btn size="sm" variant="ghost" icon="plus" :aria-label="'Add hours on ' + d" title="Add another range" @click="addRange(d)" /><Menu v-if="week[d].length" :items="dayMenu(d)" :label="'More for ' + d" /></div>
						</div>
					</div>
				</Section>
				<div class="col">
					<Section title="Booking rules" icon="settings">
						<p class="small muted" style="margin:0">Hours are in <b>{{ doc.timezone }}</b>, a start time every <b>{{ DM.durationLabel(doc.slot_interval_minutes) }}</b>. Change both on the Details tab.</p>
						<div class="g2">
							<Field label="Minimum notice" hint="No bookings sooner than this."><NumInp v-model="doc.min_notice_hours" :min="0" :max="720" unit="hours" /></Field>
							<Field label="Book up to" hint="How far ahead visitors can book."><NumInp v-model="doc.max_days_ahead" :min="1" :max="365" unit="days ahead" /></Field>
							<Field label="Buffer before" hint="Kept free before each demo."><NumInp v-model="doc.buffer_before_minutes" :min="0" :max="240" unit="min" /></Field>
							<Field label="Buffer after" hint="Kept free after each demo."><NumInp v-model="doc.buffer_after_minutes" :min="0" :max="240" unit="min" /></Field>
							<Field label="Max bookings per day" hint="0 means no limit."><NumInp v-model="doc.max_per_day" :min="0" :max="200" unit="per day" /></Field>
						</div>
					</Section>
					<Section title="Date overrides" icon="calendar" text="Block a day, or give it its own hours. Click a day.">
						<div class="ovcal">
							<div class="ovcal-h"><Btn size="sm" variant="ghost" icon="chevron-left" aria-label="Previous month" @click="step(-1)" /><b aria-live="polite">{{ monthTitle }}</b><Btn size="sm" variant="ghost" icon="chevron-right" aria-label="Next month" @click="step(1)" /></div>
							<div class="ovgrid dow" aria-hidden="true"><span v-for="d in weekdays" :key="d">{{ d[0] }}</span></div>
							<div class="ovgrid" role="grid">
								<template v-for="(c, i) in grid" :key="i"><span v-if="!c"></span><button v-else type="button" class="ovday" :class="[c.state, { past: c.past, today: c.today }]" :aria-label="c.s + (c.state === 'blocked' ? ', unavailable' : c.state === 'custom' ? ', custom hours' : c.state === 'closed' ? ', closed by weekly hours' : '')" @click="openDay(c.s)" @keydown="dayKey($event, c)">{{ c.n }}</button></template>
							</div>
							<div class="legend"><span><i style="background:var(--red)"></i>Unavailable</span><span><i style="background:var(--amber)"></i>Custom hours</span><span><i style="background:var(--border-strong)"></i>Closed (weekly)</span></div>
						</div>
						<div class="row" style="gap:8px"><input class="inp" type="date" v-model="newDate" style="max-width:190px" aria-label="Add a date" @keydown.enter="addDate" /><Btn size="sm" icon="plus" :disabled="!newDate" @click="addDate">Add date</Btn></div>
						<ul v-if="sortedOverrides.length" class="ovlist" role="list"><li v-for="o in sortedOverrides" :key="o.s"><span class="mono">{{ CM.fmtDate(o.s) }}</span><span class="grow" :class="o.rows.some((r) => r.kind === 'Unavailable') ? '' : 'muted'"><Ico :name="o.rows.some((r) => r.kind === 'Unavailable') ? 'ban' : 'clock'" size="sm" /> {{ ovText(o.rows) }}<span v-if="o.rows[0].note" class="faint"> - {{ o.rows[0].note }}</span></span><Btn size="sm" variant="ghost" icon="edit" :aria-label="'Edit ' + o.s" @click="openDay(o.s)" /><Btn size="sm" variant="ghost" icon="trash" :aria-label="'Remove override on ' + o.s" @click="removeDay(o.s)" /></li></ul>
					</Section>
				</div>
			</div>
			<Section title="Preview: the next 14 days" icon="eye" text="What visitors would be offered, from the values above (before they are saved), in the demo's time zone.">
				<template #actions><Seg v-model="h12" :options="[{ value: true, label: '12h' }, { value: false, label: '24h' }]" /></template>
				<div v-if="!anyDay" class="alert warn"><Ico name="alert" /><div class="grow">No weekly hours are set, so there is nothing to book. Switch on at least one weekday.</div></div>
				<p class="small muted" style="margin:0"><b>{{ totalSlots }}</b> slot{{ totalSlots === 1 ? '' : 's' }} in {{ doc.timezone }}. The real page also hides times when a host has another meeting; that cannot be shown here.</p>
				<div class="pvdays"><div v-for="d in preview" :key="d.day" class="pvday" :class="{ closed: !d.slots.length, blocked: d.override === 'blocked' }"><div class="pvday-h"><b>{{ dayLabel(d.day) }}</b><span v-if="d.override === 'blocked'" class="badge red nodot">Blocked</span><span v-else-if="d.override === 'custom'" class="badge amber nodot">Custom</span><span v-else class="tiny faint">{{ d.slots.length ? d.slots.length + ' slots' : '' }}</span></div>
					<div v-if="d.slots.length" class="slots"><span v-for="s in d.slots.slice(0, 12)" :key="s" class="slot">{{ DM.clock(DM.fromMin(s), h12) }}</span><span v-if="d.slots.length > 12" class="slot more">+{{ d.slots.length - 12 }}</span></div>
					<div v-else class="faint small">{{ d.override === 'blocked' ? 'Day off' : d.closed ? 'Closed' : 'No time left' }}</div></div></div>
			</Section>
			<Modal v-if="dlg.open" size="sm" :title="CM.fmtDate(dlg.day)" :subtitle="DM.weekdayOf(dlg.day)" @close="dlg.open = false" @submit="applyDay(dlg.mode)">
				<Seg v-model="dlg.mode" :options="[{ value: 'unavailable', label: 'Unavailable' }, { value: 'custom', label: 'Custom hours' }]" />
				<p v-if="dlg.mode === 'unavailable'" class="small muted" style="margin:0">Nobody can book this day, whatever the weekly hours say.</p>
				<template v-else><div v-for="(r, i) in dlg.ranges" :key="i" class="wd-r"><TimeRange v-model:from="r.from" v-model:to="r.to"><Btn size="sm" variant="ghost" icon="x" aria-label="Remove range" :disabled="dlg.ranges.length < 2" @click="dlg.ranges.splice(i, 1)" /></TimeRange></div>
					<div><Btn size="sm" icon="plus" @click="dlg.ranges.push({ from: '09:00', to: '17:00' })">Add range</Btn></div><div v-if="dlgErr" class="err small" role="alert">{{ dlgErr }}</div></template>
				<Field label="Note (only you see it)"><input class="inp" v-model="dlg.note" maxlength="140" placeholder="For example: public holiday" /></Field>
				<template #foot><Btn v-if="dlg.hadOverride" variant="danger" @click="removeDay(dlg.day); dlg.open = false">Remove override</Btn><span class="grow"></span><Btn @click="dlg.open = false">Cancel</Btn><Btn variant="primary" :disabled="!!dlgErr" @click="applyDay(dlg.mode)">Apply</Btn></template>
			</Modal>
		</div>`,
	}
})()
