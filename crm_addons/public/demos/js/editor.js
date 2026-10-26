/* Demo booking admin: the demo widget editor (tabs, sticky save bar, validation, draft safety) and its simpler tabs:
 * Details, Form, Embed and Anti-spam. Availability, Team, Messages and Branding are in their own files. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	const TABS = [
		{ key: 'details', label: 'Details', icon: 'file', comp: 'DetailsTab' },
		{ key: 'availability', label: 'Availability', icon: 'clock', comp: 'AvailabilityTab' },
		{ key: 'team', label: 'Team', icon: 'users', comp: 'TeamTab' },
		{ key: 'form', label: 'Form', icon: 'rows', comp: 'FormTab' },
		{ key: 'messages', label: 'Messages', icon: 'mail', comp: 'MessagesTab' },
		{ key: 'branding', label: 'Branding', icon: 'palette', comp: 'BrandingTab' },
		{ key: 'embed', label: 'Embed', icon: 'code', comp: 'EmbedTab' },
		{ key: 'antispam', label: 'Anti-spam', icon: 'shield', comp: 'AntiSpamTab' },
	]
	DM.TABS = TABS

	/** Which tab each problem belongs to, so the tab can show a dot and Save can jump to the first one. */
	const ERR_TAB = { title: 'details', slug: 'details', duration: 'details', manual_link: 'details', hours: 'availability', owners: 'team', fields: 'form', messages: 'messages', accent: 'branding', redirect: 'branding', origins: 'branding' }

	function validate(doc, takenSlugs) {
		const e = {}
		if (!doc.title.trim()) e.title = 'Give the demo widget a title.'
		if (!doc.slug) e.slug = 'A web address is needed.'
		else if (!/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$/.test(doc.slug)) e.slug = 'Use lower-case letters, numbers and dashes only.'
		else if (DM.RESERVED.includes(doc.slug)) e.slug = '"' + doc.slug + '" is reserved. Choose another.'
		else if (takenSlugs.includes(doc.slug)) e.slug = 'Another demo widget already uses this address.'
		if (!(doc.duration_minutes >= 5 && doc.duration_minutes <= 480)) e.duration = 'Between 5 minutes and 8 hours.'
		if (doc.provider === 'Manual Link' && !/^https?:\/\//i.test(doc.manual_link || '')) e.manual_link = 'Enter the full meeting link, starting with https://'
		if (doc.enabled && !doc.owners.length) e.owners = 'Add at least one host before turning this demo widget on.'
		if (doc.enabled && !doc.hours.length) e.hours = 'Set weekly hours, or visitors will find nothing to book.'
		const bad = DM.WEEKDAYS.some((d) => {
			const r = doc.hours.filter((h) => h.weekday === d).map((h) => [DM.toMin(h.from_time), DM.toMin(h.to_time)])
			if (r.some((x) => isNaN(x[0]) || isNaN(x[1]) || x[1] <= x[0])) return true
			const s = r.slice().sort((a, b) => a[0] - b[0]); return s.some((x, i) => i && x[0] < s[i - 1][1])
		})
		if (bad) e.hours = 'Fix the weekly hours marked in red.'
		const keys = doc.fields.map((f) => f.key)
		if (doc.fields.some((f) => !f.label.trim() || !f.key)) e.fields = 'Every question needs a label.'
		else if (new Set(keys).size !== keys.length) e.fields = 'Two questions have the same key. Rename one.'
		else if (doc.fields.some((f) => f.kind === 'Select' && !String(f.options).trim())) e.fields = 'A choice question needs its options.'
		const m = doc.messages.find((x) => (x.send_email && !x.email_template) || (x.send_whatsapp && !x.wa_template))
		if (m) e.messages = (m.event === 'Reminder' ? DM.offsetLabel(m.minutes_before) + ' reminder' : m.event) + ': choose a template for each channel that is on.'
		if (!DM.isHex(doc.accent_color)) e.accent = 'Use a colour like #2d36a3.'
		if (doc.redirect_url && !/^https?:\/\/\S+$/i.test(doc.redirect_url)) e.redirect = 'Enter a full address starting with https://'
		const origins = String(doc.allowed_origins || '').split('\n').map((s) => s.trim()).filter(Boolean)
		if (origins.some((o) => !/^https?:\/\/[^/\s]+$/i.test(o))) e.origins = 'One origin per line, like https://www.example.com (no path).'
		return e
	}

	V.DemoEditor = {
		props: { name: String, tab: String },
		setup(props) {
			const isNew = props.name === 'new'
			const doc = ref(null); const loading = ref(true); const loadError = ref(''); const saving = ref(false); const loadKey = ref(0)
			const serverName = ref(isNew ? '' : props.name)
			let baseline = ''; const snap = () => JSON.stringify(doc.value)
			const dirty = computed(() => !!doc.value && snap() !== baseline)
			const tab = computed(() => (TABS.some((t) => t.key === props.tab) ? props.tab : 'details'))
			const cur = computed(() => TABS.find((t) => t.key === tab.value))
			const taken = ref([]); const showErrors = ref(false)
			const errs = computed(() => (doc.value ? validate(doc.value, taken.value) : {}))
			const tabErr = (k) => Object.keys(errs.value).some((e) => ERR_TAB[e] === k)
			const draftKey = 'dm-draft:' + props.name
			const draft = ref(null)
			async function load() {
				loading.value = true; loadError.value = ''
				try {
					await CM.loadShared()
					const [d, list] = await Promise.all([isNew ? Promise.resolve(null) : DM.api('get_demo_type', { name: props.name }).then((r) => r.doc || r), DM.api('list_demo_types').catch(() => DM.typesCache || [])])
					taken.value = (list || []).filter((r) => r.name !== serverName.value).map((r) => r.slug)
					DM.typesCache = list || []
					doc.value = isNew ? DM.newDoc() : DM.fromServer(d)
					// a new demo widget starts with the ready-made messages (before the baseline, so it is not an "unsaved change" or a draft)
					if (isNew) { await DM.loadDefaults(); doc.value.messages.forEach(DM.applyDefault) }
					baseline = snap(); loadKey.value++
					const saved = CM.store.json(draftKey, null)
					draft.value = saved && saved.doc && JSON.stringify(saved.doc) !== baseline ? saved : null
				} catch (e) { loadError.value = DM.friendly(e) } finally { loading.value = false }
			}
			// the draft is kept in this browser while there are changes, so a closed tab or a crash loses nothing
			const saveDraft = CM.debounce(() => { if (dirty.value) CM.store.set(draftKey, JSON.stringify({ doc: doc.value, at: Date.now() })) }, 700)
			watch(doc, () => { if (!loading.value) saveDraft() }, { deep: true })
			function restore() { doc.value = DM.fromServer(draft.value.doc); draft.value = null; loadKey.value++ }
			function discardDraft() { try { localStorage.removeItem(draftKey) } catch (e) { /* ignore */ } draft.value = null }
			async function discard() {
				if (!dirty.value) return
				if (!(await CM.confirm({ title: 'Discard your changes?', message: 'The demo widget goes back to how it was last saved.', confirmText: 'Discard', danger: true }))) return
				doc.value = JSON.parse(baseline); discardDraft(); loadKey.value++
			}
			function goTab(k) { CM.replace('/types/' + encodeURIComponent(props.name) + '/' + k) }
			async function save() {
				if (saving.value || !doc.value) return false
				showErrors.value = true
				const keys = Object.keys(errs.value)
				if (keys.length) {
					const first = TABS.find((t) => keys.some((k) => ERR_TAB[k] === t.key))
					CM.toast(errs.value[keys[0]], 'err')
					if (first && first.key !== tab.value) goTab(first.key)
					return false
				}
				saving.value = true
				try {
					const res = await DM.api('save_demo_type', { doc: DM.toServer({ ...doc.value, name: serverName.value || undefined }) })
					const saved = res && (res.doc || res)
					if (saved && saved.name) {
						discardDraft()
						if (isNew) { DM.guard.fn = null; CM.toast('Demo widget created'); CM.replace('/types/' + encodeURIComponent(saved.name) + '/' + tab.value); return true }
						serverName.value = saved.name
						doc.value = DM.fromServer(saved); baseline = snap(); loadKey.value++
					} else baseline = snap()
					CM.toast('Saved')
					return true
				} catch (e) {
					const m = DM.friendly(e)
					if (/slug|address|already|duplicate/i.test(m)) { goTab('details') }
					CM.toast(m, 'err', 9000)
					return false
				} finally { saving.value = false }
			}
			// unsaved changes: ask before leaving through the screen's own links, the browser's tab close and the pop-up Close
			DM.guard.dirty = () => dirty.value
			DM.guard.fn = async () => {
				if (!dirty.value) return true
				const keep = await CM.confirm({ title: 'Leave without saving?', message: 'You have changes that are not saved. A draft is kept in this browser, so you can come back to it.', confirmText: 'Leave', danger: true })
				return keep
			}
			function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
			onMounted(() => { load(); window.addEventListener('keydown', onKey) })
			onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); DM.guard.fn = null; DM.guard.dirty = null })
			const url = computed(() => (doc.value && doc.value.slug ? DM.publicUrl(doc.value.slug) : ''))
			const draftText = computed(() => (draft.value ? new Date(draft.value.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''))
			const viewOnly = computed(() => DM.session.widgets !== 'manage')
			return { viewOnly, doc, loading, loadError, saving, dirty, tab, cur, TABS, errs, tabErr, showErrors, load, save, discard, goTab, isNew, loadKey, url, draft, draftText, restore, discardDraft, serverName, back: () => DM.leave('/types'), DM, CM }
		},
		template: `
		<div class="page wide editor">
			<div v-if="loading" class="col"><Skel h="44" r="10" /><Skel h="40" r="10" /><Skel h="360" r="12" /></div>
			<ErrorState v-else-if="loadError" :message="loadError" @retry="load" />
			<template v-else>
			<div class="ed-bar">
				<div class="ed-l"><button type="button" class="back" @click="back"><Ico name="arrow-left" /> Demo widgets</button>
					<div class="ed-title"><h1 class="ellipsis">{{ doc.title || (isNew ? 'New demo widget' : 'Untitled demo widget') }}</h1><span v-if="dirty" class="badge amber"><span class="sr">Status: </span>Unsaved changes</span><span v-else-if="!isNew" class="badge green">Saved</span></div></div>
				<div class="ed-r"><a v-if="!isNew && doc.enabled && !dirty" class="btn" :href="url" target="_blank" rel="noopener"><Ico name="external" />Open page</a><Btn :disabled="!dirty || saving" @click="discard">Discard</Btn><Btn variant="primary" icon="save" :loading="saving" :disabled="(!dirty && !isNew) || viewOnly" title="Save (Ctrl+S)" @click="save">{{ isNew ? 'Create demo widget' : 'Save changes' }}</Btn></div>
			</div>
			<div v-if="draft" class="alert info" role="status"><Ico name="info" /><div class="grow">Unsaved changes from <b>{{ draftText }}</b> were found in this browser.</div><Btn size="sm" variant="primary" @click="restore">Restore them</Btn><Btn size="sm" @click="discardDraft">Discard</Btn></div>
			<div class="tabs ed-tabs" role="tablist" aria-label="Demo widget sections"><button v-for="t in TABS" :key="t.key" type="button" class="tab" :class="{ on: t.key === tab }" role="tab" :aria-selected="t.key === tab" @click="goTab(t.key)"><Ico :name="t.icon" />{{ t.label }}<i v-if="tabErr(t.key) && (showErrors || !isNew)" class="tab-dot" title="Needs attention"></i></button></div>
			<div v-if="viewOnly" class="alert info"><Ico name="info" /><div class="grow"><b>View only.</b> You can look at this demo widget but not change it.</div></div>
			<fieldset :disabled="viewOnly" class="ro"><component :is="cur.comp" :key="cur.key + loadKey" :doc="doc" :errs="showErrors || !isNew ? errs : {}" :saved-name="serverName" :is-new="isNew" :dirty="dirty" /></fieldset>
			</template>
		</div>`,
	}

	// ------------------------------------------------------------------ Details
	V.DetailsTab = {
		props: { doc: Object, errs: Object, isNew: Boolean, savedName: String },
		setup(props) {
			const doc = props.doc
			let slugTouched = !props.isNew || !!doc.slug
			const st = reactive({ state: '', text: '' })
			function onTitle() { if (!slugTouched) doc.slug = DM.slugify(doc.title) }
			function onSlug(v) { slugTouched = true; doc.slug = DM.slugify(v) }
			watch(() => doc.slug, (s) => {
				if (!s) { st.state = ''; return }
				if (DM.RESERVED.includes(s)) { st.state = 'bad'; st.text = 'Reserved'; return }
				const other = (DM.typesCache || []).find((r) => r.slug === s && r.name !== props.savedName)
				if (other) { st.state = 'bad'; st.text = 'Used by "' + other.title + '"'; return }
				st.state = 'ok'; st.text = 'Available'
			}, { immediate: true })
			const durations = [15, 20, 30, 45, 60, 90, 120]
			const durOpts = computed(() => [...new Set([...durations, Number(doc.duration_minutes) || 30])].sort((a, b) => a - b).map((v) => ({ value: v, label: DM.durationLabel(v) })))
			const intervalOpts = computed(() => [...new Set([5, 10, 15, 20, 30, 45, 60, 90, 120, Number(doc.slot_interval_minutes) || 30])].sort((a, b) => a - b).map((v) => ({ value: v, label: DM.durationLabel(v) })))
			function onDuration(v) { const same = doc.slot_interval_minutes === doc.duration_minutes; doc.duration_minutes = v; if (same) doc.slot_interval_minutes = v }
			const url = computed(() => (doc.slug ? DM.publicUrl(doc.slug) : ''))
			return { onTitle, onSlug, st, durOpts, intervalOpts, onDuration, url, DM }
		},
		template: `
		<div class="col tabcol">
			<Section title="Basics" icon="file">
				<Field label="Title" required :error="errs.title" hint="Shown to visitors at the top of the booking page."><input class="inp" :class="{ bad: errs.title }" v-model="doc.title" maxlength="120" placeholder="For example: 30-minute product demo" @input="onTitle" /></Field>
				<Field label="Web address" required :error="errs.slug"><div class="slugbox" :class="{ bad: errs.slug || (!isNew ? false : st.state === 'bad'), locked: !isNew }"><span class="slug-pre mono">{{ DM.publicUrl('') }}</span><input class="slug-in mono" :value="doc.slug" maxlength="60" placeholder="product-demo" aria-label="Web address" :readonly="!isNew" @input="onSlug($event.target.value)" /><span v-if="!isNew" class="slug-st"><Ico name="shield" size="sm" />Fixed</span><span v-else-if="st.state" class="slug-st" :class="st.state"><Ico :name="st.state === 'ok' ? 'check-circle' : 'x-circle'" size="sm" />{{ st.text }}</span></div>
					<div v-if="!errs.slug" class="hint"><template v-if="isNew">Lower-case letters, numbers and dashes. It cannot be changed after the demo widget is created, because links already shared would break.</template><template v-else>The address is fixed once a demo widget exists. To use a different one, duplicate the demo widget.</template><template v-if="doc.slug"> <CopyBtn :text="url" label="Copy link" what="Link" /></template></div></Field>
				<Field label="Description" hint="Shown under the title. What will the visitor see in the demo?"><textarea class="inp" v-model="doc.description" rows="3" maxlength="600" placeholder="A walk through the product, tailored to your school, with time for questions."></textarea></Field>
				<Toggle v-model="doc.enabled" label="Accepting bookings" text="When off, the page shows that bookings are closed. Existing bookings are not affected." />
			</Section>
			<Section title="Length and time zone" icon="clock">
				<div class="g3">
					<Field label="Duration" :error="errs.duration"><Dd :model-value="doc.duration_minutes" :options="durOpts" aria-label="Duration" @update:model-value="onDuration" /></Field>
					<Field label="A start time every" hint="Slot interval: how often a start time is offered."><Dd :model-value="doc.slot_interval_minutes" :options="intervalOpts" aria-label="Slot interval" @update:model-value="doc.slot_interval_minutes = $event" /></Field>
					<Field label="Time zone" hint="The weekly hours are in this zone."><Dd :model-value="doc.timezone" :options="DM.zoneOptions(doc.timezone)" searchable aria-label="Time zone" @update:model-value="doc.timezone = $event" /></Field>
				</div>
			</Section>
			<Section title="Where the demo happens" icon="monitor">
				<Seg v-model="doc.provider" :options="[{ value: 'Google Meet', label: 'Google Meet', icon: 'monitor' }, { value: 'Manual Link', label: 'Your own link', icon: 'link' }]" />
				<p v-if="doc.provider === 'Google Meet'" class="small muted" style="margin:0">A Google Meet link is created for every booking, on the first host's Google Calendar, and all hosts are invited.</p>
				<Field v-else label="Meeting link" required :error="errs.manual_link" hint="The same link is sent to every visitor (Zoom, Teams, a room link ...)."><input class="inp" :class="{ bad: errs.manual_link }" v-model="doc.manual_link" placeholder="https://" /></Field>
				<Field label="Note for the visitor (optional)" hint="Added to the confirmation, for example 'Join 5 minutes early'."><input class="inp" v-model="doc.location_note" maxlength="200" /></Field>
			</Section>
		</div>`,
	}

	// ------------------------------------------------------------------ Form
	const KINDS = ['Text', 'Email', 'Phone', 'Long Text', 'Select', 'Checkbox']
	V.FormTab = {
		props: { doc: Object, errs: Object },
		setup(props) {
			const doc = props.doc
			const fixed = computed(() => doc.fields.filter((f) => DM.FIXED_FIELDS.includes(f.key)))
			const extra = computed(() => doc.fields.filter((f) => !DM.FIXED_FIELDS.includes(f.key)))
			const open = reactive({}); const dragFrom = ref(null); const dragOver = ref(null)
			function add() {
				let n = extra.value.length + 1; while (doc.fields.some((f) => f.key === 'question_' + n)) n++
				const f = { key: 'question_' + n, label: '', kind: 'Text', required: false, options: '', placeholder: '', enabled: true, lead_field: '' }
				doc.fields.push(f); open[f.key] = true
				nextTick(() => { const el = document.querySelector('[data-q="' + f.key + '"] input'); if (el) el.focus() })
			}
			function setLabel(f, v) { const auto = f.key === DM.keyify(f.label) || /^question_\d+$/.test(f.key); f.label = v; if (auto && v.trim()) { let k = DM.keyify(v) || f.key, i = 2; const base = k; while (doc.fields.some((x) => x !== f && x.key === k)) k = base + '_' + i++; f.key = k } }
			function remove(f) { doc.fields.splice(doc.fields.indexOf(f), 1) }
			function move(f, d) { const i = doc.fields.indexOf(f); const others = extra.value; const j = others.indexOf(f) + d; if (j < 0 || j >= others.length) return; const t = doc.fields.indexOf(others[j]); doc.fields.splice(i, 1); doc.fields.splice(t, 0, f) }
			function drop(t) { const f = dragFrom.value; dragFrom.value = dragOver.value = null; if (!f || f === t) return; doc.fields.splice(doc.fields.indexOf(f), 1); doc.fields.splice(doc.fields.indexOf(t), 0, f) }
			const leadFields = computed(() => {
				const list = (CM.shared.fields && CM.shared.fields.fields) || []
				return list.map((x) => ({ value: x.fieldname || x.name, label: x.label || x.fieldname || x.name })).filter((x) => x.value)
			})
			const KIND_ICON = { Text: 'text', Email: 'mail', Phone: 'phone', 'Long Text': 'rows', Select: 'list', Checkbox: 'check-circle' }
			onMounted(() => { DM.loadLookups() })
			const sources = computed(() => DM.lookups.sources.map((s) => ({ value: s, label: s })))
			const statuses = computed(() => DM.lookups.statuses.map((s) => ({ value: s, label: s })))
			return { fixed, extra, open, add, setLabel, remove, move, dragFrom, dragOver, drop, leadFields, KINDS, KIND_ICON, kindOpts: KINDS.map((k) => ({ value: k, label: k, icon: KIND_ICON[k] })), sources, statuses, DM }
		},
		template: `
		<div class="col tabcol">
			<div class="formgrid">
				<div class="col">
					<Section title="Questions" icon="rows" text="Name, email and phone are always asked. Add anything else you want to know before the demo.">
						<div v-if="errs.fields" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ errs.fields }}</div></div>
						<ul class="qlist" role="list">
							<li v-for="f in fixed" :key="f.key" class="q fixed"><span class="grip off" aria-hidden="true"><Ico name="shield" /></span><div class="grow"><b>{{ f.label || f.key }}</b><span class="small muted"> - {{ f.kind }}, always required</span></div><span class="badge neutral nodot">Fixed</span>
								<input class="inp q-ph" v-model="f.placeholder" :aria-label="'Placeholder for ' + f.key" placeholder="Placeholder" /></li>
							<li v-for="(f, n) in extra" :key="f.key" class="q" :data-q="f.key" :class="{ over: dragOver === f && dragFrom !== f, off: !f.enabled }" draggable="true" @dragstart="dragFrom = f" @dragover.prevent="dragOver = f" @dragleave="dragOver = null" @drop.prevent="drop(f)" @dragend="dragFrom = dragOver = null">
								<div class="q-h"><span class="grip" aria-hidden="true"><Ico name="grip" /></span><Ico :name="KIND_ICON[f.kind]" class="faint" />
									<input class="inp q-l" :value="f.label" placeholder="Question, for example: How many students?" :aria-label="'Question ' + (n + 1)" @input="setLabel(f, $event.target.value)" />
									<span class="small muted nowrap">Required</span><Switch v-model="f.required" :label="'Required: ' + f.label" />
									<Btn size="sm" variant="ghost" icon="arrow-up" :disabled="n === 0" :aria-label="'Move up'" @click="move(f, -1)" /><Btn size="sm" variant="ghost" icon="arrow-down" :disabled="n === extra.length - 1" aria-label="Move down" @click="move(f, 1)" />
									<Btn size="sm" variant="ghost" :icon="open[f.key] ? 'chevron-up' : 'chevron-down'" :aria-expanded="!!open[f.key]" aria-label="More settings" @click="open[f.key] = !open[f.key]" /><Btn size="sm" variant="ghost" icon="trash" aria-label="Remove question" @click="remove(f)" /></div>
								<div v-if="open[f.key]" class="q-b">
									<div class="g3"><Field label="Answer type"><Dd v-model="f.kind" :options="kindOpts" aria-label="Answer type" /></Field><Field label="Placeholder"><input class="inp" v-model="f.placeholder" /></Field><Field label="Save the answer on the lead as" hint="Optional."><Dd v-model="f.lead_field" :options="leadFields" searchable allow-empty="Do not copy to the lead" placeholder="Do not copy to the lead" aria-label="Lead field" /></Field></div>
									<Field v-if="f.kind === 'Select'" label="Options" hint="One per line."><textarea class="inp" rows="3" v-model="f.options" placeholder="Option one&#10;Option two"></textarea></Field>
									<Toggle v-model="f.enabled" label="Show this question" text="Switch off to hide it without losing it." />
								</div>
							</li>
						</ul>
						<div><Btn icon="plus" @click="add">Add a question</Btn></div>
					</Section>
					<Section title="Guests and WhatsApp" icon="whatsapp">
						<Toggle v-model="doc.allow_guests" label="Let the visitor add guests" text="They can add colleagues' email addresses; each is invited to the meeting." />
						<Field label="WhatsApp consent text" hint="Shown as a tick box under the form. Messages on WhatsApp are sent only when it is ticked."><textarea class="inp" rows="2" v-model="doc.consent_text" maxlength="300"></textarea></Field>
						<label class="check"><input type="checkbox" v-model="doc.consent_default" /><span>Ticked by default<span class="small faint" style="display:block">Only where the law and Meta's rules allow a pre-ticked box.</span></span></label>
					</Section>
				</div>
				<div class="col">
					<Section title="Leads" icon="target" text="A booking creates a lead, or finds the visitor's existing one by email, then phone.">
						<Field label="Lead source"><Dd v-model="doc.lead_source" :options="sources" searchable allow-empty="Leave the source as it is" placeholder="Leave the source as it is" aria-label="Lead source" /></Field>
						<Field label="Lead status" hint="Used only for new leads."><Dd v-model="doc.lead_status" :options="statuses" searchable allow-empty="Default status" placeholder="Default status" aria-label="Lead status" /></Field>
						<Toggle v-model="doc.assign_lead_to_owner" label="Assign the lead to the first host" text="The organizer becomes the lead's owner when it is created." />
					</Section>
					<Section title="How the form looks" icon="eye">
						<div class="formpv"><div class="fp-t">Your details</div><div v-for="f in doc.fields.filter((x) => x.enabled)" :key="f.key" class="fp-f"><span>{{ f.label || f.key }}<b v-if="f.required"> *</b></span><div class="fp-i" :class="f.kind === 'Long Text' ? 'tall' : ''">{{ f.kind === 'Checkbox' ? '' : f.placeholder }}</div></div><div v-if="doc.allow_guests" class="fp-f"><span>Add guests</span><div class="fp-i">Email addresses</div></div><label v-if="doc.consent_text" class="fp-c"><i :class="{ on: doc.consent_default }"></i>{{ doc.consent_text }}</label></div>
					</Section>
				</div>
			</div>
		</div>`,
	}

	// ------------------------------------------------------------------ Embed
	V.EmbedTab = {
		props: { doc: Object, savedName: String, isNew: Boolean, dirty: Boolean },
		setup(props) {
			const kind = ref('button'); const server = ref(null); const loading = ref(false)
			const slug = props.doc.slug; const base = location.origin
			const url = DM.publicUrl(slug)
			const script = `<script src="${base}/assets/crm_addons/book/embed.js" async><\/script>`
			const snippets = computed(() => {
				const s = server.value || {}
				return {
					button: { title: 'Pop-up button', text: 'Put this on any page. The button opens the booking window over your site; the visitor never leaves it.', code: s.button || s.script || `${script}\n<button type="button" data-crm-demo="${slug}">Book a demo</button>` },
					link: { title: 'Plain link', text: 'A normal link. With the script on the page it opens as a pop-up, otherwise as the full booking page.', code: s.link || `${script}\n<a href="${url}" data-crm-demo="${slug}">Book a demo</a>` },
					inline: { title: 'Inline on the page', text: 'The booking page shown inside your page.', code: s.iframe || s.inline || `<iframe src="${url}?embed=1" title="Book a demo" style="width:100%;height:720px;border:0;border-radius:12px" loading="lazy"></iframe>` },
				}
			})
			onMounted(async () => {
				if (!slug || props.isNew) return
				loading.value = true
				try { const r = await DM.api('get_embed_code', { slug }); if (r && typeof r === 'object') server.value = r; else if (typeof r === 'string') server.value = { button: r } } catch (e) { /* the built-in snippets are shown */ } finally { loading.value = false }
			})
			const origins = computed(() => String(props.doc.allowed_origins || '').split('\n').map((s) => s.trim()).filter(Boolean))
			return { kind, snippets, url, loading, origins, DM }
		},
		template: `
		<div class="col tabcol">
			<div v-if="isNew || !doc.slug" class="alert warn"><Ico name="alert" /><div class="grow">Create the demo widget first. Its page address and embed code are available once it is saved.</div></div>
			<div v-else-if="dirty" class="alert info"><Ico name="info" /><div class="grow">You have unsaved changes. The embed code does not depend on them, but the public page shows the saved version only.</div></div>
			<Section title="Your booking page" icon="globe">
				<div class="urlbox"><Ico name="link" /><a class="mono grow ellipsis" :href="url" target="_blank" rel="noopener">{{ url }}</a><CopyBtn :text="url" label="Copy link" what="Link" /><a class="btn sm" :href="url" target="_blank" rel="noopener"><Ico name="external" />Open</a></div>
				<p v-if="!doc.enabled" class="small" style="margin:0;color:var(--amber)"><Ico name="alert" size="sm" /> This demo widget is switched off, so the page shows that bookings are closed.</p>
			</Section>
			<Section title="Put it on your website" icon="code" text="Copy one of these into the page where the button should be.">
				<Seg v-model="kind" :options="[{ value: 'button', label: 'Pop-up button' }, { value: 'link', label: 'Link' }, { value: 'inline', label: 'Inline' }]" />
				<p class="small muted" style="margin:0">{{ snippets[kind].text }}</p>
				<div class="code"><pre tabindex="0"><code>{{ snippets[kind].code }}</code></pre><CopyBtn class="code-copy" :text="snippets[kind].code" label="Copy code" what="Code" /></div>
				<div class="alert" :class="origins.length ? 'info' : 'warn'"><Ico :name="origins.length ? 'shield' : 'alert'" /><div class="grow"><template v-if="origins.length">The pop-up works on: <b>{{ origins.join(', ') }}</b>. Other websites cannot show this page inside theirs.</template><template v-else>No websites are allowed yet. The link works everywhere, but the pop-up and inline versions only show on websites listed under <b>Branding &gt; Allowed websites</b>.</template></div></div>
			</Section>
			<Section title="Tracking" icon="chart" text="Add the campaign details to the link and they are saved on the booking and the lead.">
				<p class="small muted" style="margin:0">Use normal UTM parameters, for example <span class="mono">{{ url }}?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=spring</span>. With the script on your page the first-visit UTMs of your site are captured as well, even when the visitor books later.</p>
			</Section>
		</div>`,
	}

	// ------------------------------------------------------------------ Anti-spam
	V.AntiSpamTab = {
		props: { doc: Object, errs: Object },
		template: `
		<div class="col tabcol">
			<Section title="Limits" icon="shield" text="Protect the calendar from repeat and automated bookings. There is no CAPTCHA or one-time code.">
				<div class="g2">
					<Field label="Upcoming demos per person" hint="The same phone number or email cannot hold more than this many upcoming demos of this type."><NumInp v-model="doc.max_active_per_contact" :min="1" :max="20" unit="at a time" /></Field>
					<Field label="Bookings per IP address" hint="Most bookings one network can make in an hour. Offices share an address, so keep this above 5."><NumInp v-model="doc.max_per_ip_per_hour" :min="1" :max="500" unit="per hour" /></Field>
				</div>
			</Section>
			<Section title="Always on" icon="check-circle">
				<ul class="checks"><li><Ico name="check" /> Phone and email are validated (a 10-digit Indian mobile number by default).</li><li><Ico name="check" /> A hidden field and a minimum fill time catch most bots.</li><li><Ico name="check" /> Disposable email addresses are refused.</li><li><Ico name="check" /> A slot is taken once: two visitors cannot book the same time.</li><li><Ico name="check" /> IP addresses are never stored, only a salted hash.</li></ul>
			</Section>
		</div>`,
	}
})()
