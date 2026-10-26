/* Demo booking admin: the Messages tab - what is sent when a demo is confirmed, rescheduled, cancelled, and as reminders.
 * Email templates come from the campaign template library, WhatsApp templates from the synced Meta templates. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	const EVENT_META = {
		Confirmed: { icon: 'check-circle', text: 'Sent right after someone books.' },
		Rescheduled: { icon: 'refresh', text: 'Sent when the visitor picks a new time.' },
		Cancelled: { icon: 'x-circle', text: 'Sent when the visitor or a host cancels.' },
	}
	const REMINDER_PRESETS = [10080, 2880, 1440, 720, 180, 120, 60, 30, 15, 10, 5, 0]

	V.MsgRule = {
		props: { rule: Object, doc: Object, savedName: String, dirty: Boolean, isNew: Boolean, removable: Boolean, openFirst: Boolean },
		emits: ['remove', 'pick-email', 'edit-email', 'preview-email', 'create-email'],
		setup(props, { emit }) {
			const rule = props.rule
			const open = ref(!!props.openFirst || (rule.send_email && !rule.email_template) || (rule.send_whatsapp && !rule.wa_template))
			const tpl = ref(null)
			async function loadTpl() { tpl.value = rule.email_template ? await CM.getEmailTemplate(rule.email_template) : null }
			watch(() => rule.email_template, loadTpl); onMounted(() => { loadTpl(); if (rule.send_whatsapp) DM.loadWa() })
			watch(() => rule.send_whatsapp, (v) => { if (v) { DM.loadWa(); DM.loadDefaults().then(() => { if (!rule.wa_template) DM.applyDefault(rule) }) } })
			// switching email on with no template chosen takes the ready-made one instead of asking
			watch(() => rule.send_email, (v) => { if (v && !rule.email_template) DM.loadDefaults().then(() => { const d = DM.defaultFor(rule); if (d && d.email_exists && !rule.email_template) rule.email_template = d.email_template }) })
			onMounted(() => DM.loadDefaults())
			const suggestion = computed(() => { const d = DM.defaultFor(rule); return d ? d.whatsapp : null })
			const submitting = ref(false)
			async function submitDefault() {
				submitting.value = true
				try { const r = await DM.api('create_default_whatsapp_template', { event: rule.event, minutes_before: rule.minutes_before }); CM.toast((r && r.message) || 'Submitted to Meta. It is Pending until Meta approves it.'); await Promise.all([DM.loadDefaults(true), DM.loadWa(true)]) } catch (e) { CM.toast(e.message, 'err') } finally { submitting.value = false }
			}
			async function refreshSuggestion() { await Promise.all([DM.loadDefaults(true), DM.loadWa(true)]) }
			function useSuggestion() { const s = suggestion.value; if (s && s.name) pickWa(s.name) }
			const sugVals = computed(() => (suggestion.value ? suggestion.value.samples : []))
			const wa = DM.waTemplates
			const waTpl = computed(() => wa.rows.find((t) => t.name === rule.wa_template))
			const waOptions = computed(() => wa.rows.slice().sort((x, y) => Number(y.approved) - Number(x.approved) || x.template_name.localeCompare(y.template_name)).map((t) => ({ value: t.name, label: t.template_name, sub: t.approved ? (t.category || '').toLowerCase() + ' - ' + (t.language_code || 'en') : 'Not approved: ' + CM.waState.label(t.state), disabled: !t.approved, icon: 'whatsapp', badge: t.approved ? undefined : CM.waState.label(t.state) })))
			// the placeholders {{1}} {{2}} of the Meta template map to demo variables; stored as JSON like the campaign step's variable_map
			const map = reactive({})
			function readMap() { Object.keys(map).forEach((k) => delete map[k]); try { Object.assign(map, JSON.parse(rule.wa_variables || '{}')) } catch (e) { /* empty */ } }
			readMap()
			watch(map, () => { rule.wa_variables = Object.keys(map).length ? JSON.stringify(map) : '' }, { deep: true })
			function pickWa(n) {
				rule.wa_template = n
				const t = wa.rows.find((x) => x.name === n)
				rule.wa_account = (t && t.whatsapp_account) || ''
				const saved = (t && t.variable_map) || {}; const defaults = ['{{ first_name }}', '{{ demo_title }}', '{{ demo_datetime }}', '{{ meet_link }}', '{{ host_name }}']
				const next = {}; ;(t ? t.placeholders : []).forEach((p, i) => { next[p] = map[p] || saved[p] || defaults[i] || '' })
				Object.keys(map).forEach((k) => delete map[k]); Object.assign(map, next)
			}
			const missing = computed(() => (waTpl.value ? waTpl.value.placeholders.filter((p) => !String(map[p] || '').trim()) : []))
			const vals = computed(() => (waTpl.value ? waTpl.value.placeholders.map((p) => DM.fill(map[p] || '')) : []))
			const insert = (p, tok) => CM.insertAtCursor(document.querySelector(`[data-wam="${rule.event}${rule.minutes_before}-${p}"]`), tok)
			const title = computed(() => (rule.event === 'Reminder' ? DM.offsetLabel(rule.minutes_before) : rule.event))
			const sub = computed(() => (rule.event === 'Reminder' ? (rule.minutes_before ? 'Reminder' : 'Reminder when the demo starts') : EVENT_META[rule.event].text))
			const emailReady = computed(() => !CM.shared.config || CM.shared.config.email.ready)
			const waReady = computed(() => !CM.shared.config || CM.shared.config.whatsapp.ready)
			// "Send me a test": the server sends this very message to the admin's own address / number, with sample data
			const testing = reactive({ Email: false, WhatsApp: false })
			async function test(channel) {
				testing[channel] = true
				try { const r = await DM.api('send_test_message', { demo_type: props.savedName, event: rule.event, minutes_before: rule.minutes_before, channel }); CM.toast((r && r.message) || (channel === 'Email' ? 'Test email sent to you' : 'Test WhatsApp message sent to you')) } catch (e) { CM.toast(DM.friendly(e), 'err', 8000) } finally { testing[channel] = false }
			}
			const canTest = computed(() => !props.isNew && !props.dirty)
			const status = computed(() => {
				const on = []; if (rule.send_email) on.push('Email'); if (rule.send_whatsapp) on.push('WhatsApp'); return on
			})
			const incomplete = computed(() => (rule.send_email && !rule.email_template) || (rule.send_whatsapp && !rule.wa_template))
			return { suggestion, submitting, submitDefault, refreshSuggestion, useSuggestion, sugVals, open, tpl, wa, waTpl, waOptions, map, pickWa, missing, vals, insert, title, sub, emailReady, waReady, test, testing, canTest, status, incomplete, meta: EVENT_META, DM, CM, loadWa: DM.loadWa }
		},
		template: `
		<article class="card rule" :class="{ on: status.length, open }">
			<div class="rule-h" role="button" tabindex="0" :aria-expanded="open" @click="open = !open" @keydown.enter.self="open = !open" @keydown.space.self.prevent="open = !open">
				<div class="rule-i"><Ico :name="rule.event === 'Reminder' ? 'clock' : meta[rule.event].icon" /></div>
				<div class="grow"><b>{{ title }}</b><div class="small muted ellipsis">{{ sub }}</div></div>
				<span v-for="c in status" :key="c" class="ch" :class="c"><Ico :name="c === 'Email' ? 'mail' : 'whatsapp'" size="sm" />{{ c }}</span>
				<span v-if="!status.length" class="small faint">Off</span>
				<span v-if="incomplete" class="badge amber nodot">Pick a template</span>
				<Btn v-if="removable" size="sm" variant="ghost" icon="trash" :aria-label="'Remove the ' + title + ' reminder'" @click.stop="$emit('remove')" />
				<Ico :name="open ? 'chevron-up' : 'chevron-down'" class="faint" />
			</div>
			<div v-if="open" class="rule-b">
				<div class="chan">
					<div class="chan-h"><ChannelBadge value="Email" /><span v-if="!emailReady" class="badge amber nodot" title="No outgoing email account is set up">Cannot send yet</span><span class="grow"></span><Switch v-model="rule.send_email" :label="'Send email: ' + title" /></div>
					<template v-if="rule.send_email">
												<div v-if="!rule.email_template" class="pick-empty" :class="{ bad: false }"><Ico name="mail" size="lg" /><div class="grow"><b>Choose an email template</b><div class="small muted">From the campaign template library. Pick one, or create a new one.</div></div><Btn variant="primary" @click="$emit('pick-email')">Choose</Btn><Btn icon="plus" @click="$emit('create-email')">New</Btn></div>
						<div v-else class="tsel"><div class="tsel-th"><Thumb v-if="tpl && !tpl.missing" :html="DM.fill(tpl.body_html)" :height="120" /><div v-else class="skel" style="height:120px"></div></div>
							<div class="grow" style="min-width:0"><div class="lbl">Email template</div><b class="ellipsis" style="font-size:15px">{{ rule.email_template }}</b><div v-if="tpl && tpl.missing" class="small" style="color:var(--red)">This template no longer exists. Choose another.</div><div v-else-if="tpl" class="small muted ellipsis">Subject: {{ DM.fill(tpl.subject) }}</div>
								<div class="row wrap" style="margin-top:10px;gap:6px"><Btn size="sm" @click="$emit('pick-email')">Change</Btn><Btn size="sm" icon="eye" @click="$emit('preview-email')">Preview</Btn><Btn size="sm" icon="edit" @click="$emit('edit-email')">Edit template</Btn><Btn size="sm" icon="send" :loading="testing.Email" :disabled="!canTest" :title="canTest ? 'Sends this email to your own address' : 'Save the widget first'" @click="test('Email')">Send me a test</Btn></div></div></div>
					</template>
				</div>
				<div class="chan">
					<div class="chan-h"><ChannelBadge value="WhatsApp" /><span v-if="!waReady" class="badge amber nodot" title="No active WhatsApp account">Cannot send yet</span><span class="grow"></span><Switch v-model="rule.send_whatsapp" :label="'Send WhatsApp: ' + title" /></div>
					<template v-if="rule.send_whatsapp">
												<Field label="WhatsApp template" required>
							<div class="row" style="gap:8px"><div class="grow"><Dd :model-value="rule.wa_template" :options="waOptions" searchable placeholder="Choose an approved template" aria-label="WhatsApp template" @update:model-value="pickWa" /></div><Btn icon="refresh" :loading="wa.loading" aria-label="Refresh the template list" title="Refresh the list" @click="loadWa(true)">Refresh</Btn></div>
							<div class="hint">WhatsApp only allows templates approved by Meta. Create and approve templates in Meta; they appear here after sync. <a href="/assets/crm_addons/campaigns/index.html#/templates/whatsapp" target="_blank" rel="noopener">WhatsApp templates</a></div>
							<div v-if="wa.error" class="err">{{ wa.error }}</div>
							<div v-else-if="wa.loaded && !wa.installed" class="hint" style="color:var(--amber)">frappe_whatsapp is not installed on this site.</div>
						</Field>
						<div v-if="waTpl" class="wa-grid">
							<div class="col" style="gap:12px">
								<template v-if="waTpl.placeholders.length"><div class="lbl">Fill the variables</div>
									<div v-for="(p, i) in waTpl.placeholders" :key="p" class="wa-map"><span class="wa-map-n mono">{{ $wa(p) }}</span><div class="grow"><input class="inp" :class="{ bad: !map[p] }" v-model="map[p]" :data-wam="rule.event + rule.minutes_before + '-' + p" placeholder="Type text or insert a variable" :aria-label="'Value for variable ' + p" /><div class="tiny faint" style="margin-top:3px">Sample: {{ DM.fill(map[p] || '') || waTpl.samples[i] || '-' }}</div></div><DemoVarMenu label="" size="sm" @pick="(t) => insert(p, t)" /></div>
									<div v-if="missing.length" class="small" style="color:var(--red)">Fill {{ missing.map($wa).join(', ') }}. An empty value makes WhatsApp refuse the message.</div></template>
								<div v-else class="small muted">This template has no variables.</div>
								<div><Btn size="sm" icon="send" :loading="testing.WhatsApp" :disabled="!canTest" :title="canTest ? 'Sends this message to your own number' : 'Save the widget first'" @click="test('WhatsApp')">Send me a test</Btn></div>
							</div>
							<div class="wa-side"><WaBubble :header="waTpl.header" :header-type="waTpl.header_type" :body="waTpl.template" :footer="waTpl.footer" :buttons="waTpl.buttons" :values="vals" compact /></div>
						</div>
						<div v-else-if="suggestion" class="wa-sug">
							<div class="wa-sug-h"><Ico name="sparkles" /><div class="grow"><b>Ready-made message: {{ suggestion.template_name }}</b><div class="small muted">A Utility template written for this message. WhatsApp needs Meta's approval before it can be sent.</div></div>
								<span v-if="suggestion.state === 'NOT CREATED'" class="badge nodot">Not submitted yet</span><span v-else-if="suggestion.approved" class="badge green nodot">Approved</span><span v-else-if="suggestion.state === 'REJECTED'" class="badge red nodot">Rejected</span><span v-else class="badge amber nodot">{{ suggestion.state === 'PENDING' ? 'Waiting for Meta' : suggestion.state }}</span></div>
							<div class="wa-grid"><div class="col" style="gap:10px"><div class="small muted">The variables are filled from the booking automatically: {{ Object.keys(suggestion.variable_map).map($wa).join(', ') }}. You can change the wording after it is submitted by creating a new template in WhatsApp templates.</div>
								<div class="row wrap" style="gap:8px"><Btn v-if="suggestion.approved" variant="primary" icon="check" @click="useSuggestion">Use this template</Btn><Btn v-else-if="suggestion.state === 'NOT CREATED'" variant="primary" icon="send" :loading="submitting" :disabled="!waReady" :title="waReady ? '' : 'Set up an active WhatsApp account first'" @click="submitDefault">Create and send to Meta for approval</Btn><Btn v-else icon="refresh" :loading="wa.loading" @click="refreshSuggestion">Check the approval status</Btn></div></div>
								<div class="wa-side"><WaBubble header="" header-type="" :body="suggestion.body" footer="" :buttons="[]" :values="sugVals" compact /></div></div>
						</div>
						<div v-else class="wa-ph"><Ico name="whatsapp" size="xl" /><span>Pick a template to see the message</span></div>
					</template>
				</div>
			</div>
		</article>`,
	}

	V.MessagesTab = {
		props: { doc: Object, errs: Object, savedName: String, isNew: Boolean, dirty: Boolean },
		setup(props) {
			const doc = props.doc
			const pickFor = ref(null); const editTpl = reactive({ open: false, name: '', mode: '', rule: null }); const previewTpl = ref(null)
			const events = computed(() => DM.EVENTS.map((e) => doc.messages.find((m) => m.event === e)).filter(Boolean))
			const reminders = computed(() => doc.messages.filter((m) => m.event === 'Reminder').sort((a, b) => b.minutes_before - a.minutes_before))
			onMounted(() => { CM.loadShared(); DM.loadVars(); DM.loadDefaults() })
			// rules with a channel on but no template, or no channel at all while a ready-made message exists
			const fillable = computed(() => DM.defaults.loaded && doc.messages.some((r) => { const d = DM.defaultFor(r); return d && ((!r.email_template && d.email_exists) || (!r.wa_template && d.whatsapp.approved)) }))
			function fillDefaults() { let n = 0; doc.messages.forEach((r) => { n += DM.applyDefault(r).length }); CM.toast(n ? 'Filled ' + n + ' empty message' + (n === 1 ? '' : 's') + ' with the ready-made ones. Save to keep them.' : 'Nothing to fill.') }
			// every event the widget should have exists, even on a document saved before it was added
			DM.EVENTS.forEach((e) => { if (!doc.messages.some((m) => m.event === e)) doc.messages.push(DM.defaultMessages().find((m) => m.event === e)) })
			const custom = reactive({ open: false, value: 2, unit: 'hours' })
			const used = computed(() => new Set(reminders.value.map((m) => m.minutes_before)))
			function addReminder(min) {
				min = Number(min)
				if (isNaN(min) || min < 0) return
				if (used.value.has(min)) return CM.toast('There is already a reminder ' + DM.offsetLabel(min).toLowerCase() + '.', 'warn')
				doc.messages.push({ event: 'Reminder', minutes_before: min, send_email: false, email_template: '', send_whatsapp: false, wa_template: '', wa_account: '', wa_variables: '' })
			}
			const customMin = computed(() => Math.round((Number(custom.value) || 0) * ({ minutes: 1, hours: 60, days: 1440 }[custom.unit])))
			function addCustom() { if (customMin.value > 60 * 24 * 60) return CM.toast('Reminders can be at most 60 days before.', 'err'); addReminder(customMin.value); custom.open = false }
			async function removeReminder(m) {
				if ((m.send_email || m.send_whatsapp) && !(await CM.confirm({ title: 'Remove this reminder?', message: 'The ' + DM.offsetLabel(m.minutes_before).toLowerCase() + ' reminder will no longer be sent for new bookings.', confirmText: 'Remove', danger: true }))) return
				doc.messages.splice(doc.messages.indexOf(m), 1)
			}
			const menuItems = computed(() => [...REMINDER_PRESETS.filter((p) => !used.value.has(p)).map((p) => ({ label: DM.offsetLabel(p), icon: 'clock', run: () => addReminder(p) })), { sep: true }, { label: 'Custom time ...', icon: 'edit', run: () => (custom.open = true) }])
			const cfg = computed(() => CM.shared.config)
			function createTemplate(m) { editTpl.rule = m; editTpl.name = ''; editTpl.mode = 'builder'; editTpl.open = true; pickFor.value = null }
			function editTemplate(m) { editTpl.rule = m; editTpl.name = m.email_template; editTpl.mode = ''; editTpl.open = true }
			function tplSaved(n) { delete CM.tplCache[n]; if (editTpl.rule && !editTpl.rule.email_template) editTpl.rule.email_template = n; editTpl.name = n; CM.getEmailTemplate(n) }
			function picked(t) { pickFor.value.email_template = t.name; pickFor.value = null }
			const preview = computed(() => (previewTpl.value ? CM.tplCache[previewTpl.value] || {} : {}))
			watch(previewTpl, (n) => n && CM.getEmailTemplate(n))
			const summary = computed(() => { const on = doc.messages.filter((m) => m.send_email || m.send_whatsapp).length; return on + ' of ' + doc.messages.length + ' messages on' })
			return { fillable, fillDefaults, events, reminders, pickFor, editTpl, previewTpl, custom, menuItems, addCustom, customMin, removeReminder, cfg, createTemplate, editTemplate, tplSaved, picked, preview, summary, DM, CM }
		},
		template: `
		<div class="col tabcol">
			<div class="alert info"><Ico name="info" /><div class="grow"><b>{{ summary }}.</b> Messages are built from your campaign templates and sent automatically. Confirmations and reminders are service messages: they are not blocked by the marketing unsubscribe list, but a WhatsApp STOP and a missing WhatsApp consent tick are always respected. Google Calendar also sends its own invitation and reminders.</div></div>
			<div v-if="errs.messages" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ errs.messages }}</div></div>
			<div v-if="cfg && !cfg.email.ready" class="alert warn"><Ico name="alert" /><div class="grow"><b>No outgoing email account.</b> {{ cfg.email.problem }}</div></div>
			<div v-if="cfg && !cfg.whatsapp.ready" class="alert warn"><Ico name="alert" /><div class="grow"><b>WhatsApp account missing.</b> No active WhatsApp account is set up in frappe_whatsapp, so WhatsApp messages cannot be sent yet.</div></div>
			<div v-if="fillable" class="alert info"><Ico name="sparkles" /><div class="grow"><b>Ready-made messages are available.</b> Fill the empty messages with them (confirmation, reschedule, cancel and the reminders). You can edit every template afterwards.</div><Btn variant="primary" size="sm" @click="fillDefaults">Use ready-made messages</Btn></div>
			<h3 class="grp">When a booking changes</h3>
			<MsgRule v-for="m in events" :key="m.event" :rule="m" :doc="doc" :saved-name="savedName" :dirty="dirty" :is-new="isNew" @pick-email="pickFor = m" @create-email="createTemplate(m)" @edit-email="editTemplate(m)" @preview-email="previewTpl = m.email_template" />
			<div class="row grp-row"><h3 class="grp grow">Reminders</h3><Menu :items="menuItems" label="Add a reminder"><Btn icon="plus" size="sm">Add a reminder</Btn></Menu></div>
			<p class="small muted" style="margin:-6px 0 0">Sent before the demo starts. A reminder is skipped when the booking is cancelled, and when the demo is booked too close to the start for it to make sense.</p>
			<MsgRule v-for="m in reminders" :key="m.minutes_before" :rule="m" :doc="doc" :saved-name="savedName" :dirty="dirty" :is-new="isNew" removable @remove="removeReminder(m)" @pick-email="pickFor = m" @create-email="createTemplate(m)" @edit-email="editTemplate(m)" @preview-email="previewTpl = m.email_template" />
			<Empty v-if="!reminders.length" icon="clock" title="No reminders" text="Add one so fewer visitors forget the demo. Most teams send 24 hours, 1 hour and 30 minutes before."><Menu :items="menuItems"><Btn icon="plus">Add a reminder</Btn></Menu></Empty>
			<Modal v-if="custom.open" size="sm" title="Custom reminder" subtitle="How long before the demo starts?" @close="custom.open = false" @submit="addCustom">
				<div class="row" style="gap:8px"><NumInp v-model="custom.value" :min="0" :max="9999" width="120px" aria-label="Amount" /><Dd v-model="custom.unit" :options="['minutes', 'hours', 'days']" aria-label="Unit" /></div>
				<p class="small muted" style="margin:0">{{ DM.offsetLabel(customMin) }}</p>
				<template #foot><Btn @click="custom.open = false">Cancel</Btn><Btn variant="primary" @click="addCustom">Add reminder</Btn></template>
			</Modal>
			<TemplatePicker v-if="pickFor" title="Choose an email template" subtitle="The shared campaign template library." :selected="pickFor.email_template" allow-create @pick="picked" @create="createTemplate(pickFor)" @close="pickFor = null" />
			<TemplateEditor v-if="editTpl.open" embedded :name="editTpl.name || undefined" :mode="editTpl.mode" @saved="tplSaved" @close="editTpl.open = false" />
			<Modal v-if="previewTpl" size="xl" :title="previewTpl" subtitle="Shown with sample booking data (Aarav Mehta, a Tuesday at 4 pm)." @close="previewTpl = null">
				<EmailPreview :subject="DM.fill(preview.subject)" :html="DM.fill(preview.body_html)" :from-name="cfg && cfg.sender_name" :from-email="cfg && cfg.sender_email" :loading="!preview.body_html && !preview.missing" />
			</Modal>
		</div>`,
	}
})()
