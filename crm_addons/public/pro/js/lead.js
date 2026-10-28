/* Suite Pro: the lead page. Activity, emails, comments, data, meetings, follow-ups, campaigns, WhatsApp, of one lead, with its details beside them. */
(() => {
	const { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.lead.' + m, a)
	const day = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + (String(s).length > 10 ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') }
	const digits = (s) => String(s || '').replace(/[^\d]/g, '')
	const local = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00'
	const TABS = [
		{ id: 'activity', label: 'Activity', icon: 'clock' }, { id: 'emails', label: 'Emails', icon: 'mail' }, { id: 'comments', label: 'Comments', icon: 'message' }, { id: 'data', label: 'Data', icon: 'list' },
		{ id: 'meetings', label: 'Meetings', icon: 'calendar' }, { id: 'followups', label: 'Follow-ups', icon: 'phone' }, { id: 'campaigns', label: 'Campaign', icon: 'send' }, { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
	]
	const LOADERS = { activity: 'get_activity', emails: 'get_emails', comments: 'get_timeline', data: 'get_data', meetings: 'get_meetings', followups: 'get_followups', campaigns: 'get_campaigns', whatsapp: 'get_whatsapp' }

	V.Fact = {
		props: { label: String, value: [String, Number] },
		template: `<div class="fact"><span class="fact-l">{{ label }}</span><span class="fact-v"><slot>{{ value || '-' }}</slot></span></div>`,
	}

	V.Lead = {
		props: { name: String },
		setup(props) {
			const lead = ref(null); const error = ref(''); const loading = ref(true)
			const tab = ref(TABS.some((t) => t.id === CM.route.query.tab) ? CM.route.query.tab : 'activity')
			const owners = ref([]); const data = reactive({}); const busyTab = ref('')
			async function load() {
				loading.value = true; error.value = ''
				try { lead.value = await call('get_lead', { name: props.name }) } catch (e) { error.value = e.message } finally { loading.value = false }
			}
			async function loadTab(t, force) {
				if (data[t] && !force) return
				busyTab.value = t
				try { data[t] = await call(LOADERS[t], { name: props.name }) } catch (e) { CM.toast(e.message, 'err') } finally { busyTab.value = '' }
			}
			const reload = (...tabs) => Promise.all(tabs.map((t) => loadTab(t, true)))
			onMounted(async () => {
				load(); loadTab(tab.value)
				try { owners.value = (await CM.call('crm_addons.pro.leads.filter_options', {})).owners } catch (e) { /* the pickers stay empty */ }
			})
			watch(tab, (t) => loadTab(t))
			const back = () => { location.hash = '#/leads' }
			// the leads of the list the person came from, so they can step through them without going back
			const around = computed(() => {
				let list = []; try { list = JSON.parse(sessionStorage.getItem('pro.leadlist') || '[]') } catch (e) { /* no list kept */ }
				const i = list.indexOf(props.name)
				return { i, n: list.length, prev: i > 0 ? list[i - 1] : '', next: i >= 0 && i < list.length - 1 ? list[i + 1] : '' }
			})
			const step = (n) => { if (n) location.hash = '#/leads/' + encodeURIComponent(n) }
			const statusOpts = computed(() => (lead.value ? lead.value.statuses.map((s) => ({ value: s.name, label: s.name })) : []))
			const ownerOpts = computed(() => {
				const l = owners.value.map((o) => ({ value: o.name, label: o.full_name })); const cur = lead.value && lead.value.lead_owner_info
				if (cur && !l.some((o) => o.value === cur.name)) l.unshift({ value: cur.name, label: cur.full_name })
				return [{ value: '', label: 'Unassigned' }, ...l]
			})
			async function save(values, done) {
				try { lead.value = await call('update_lead', { name: props.name, values: JSON.stringify(values) }); delete data.activity; delete data.comments; delete data.data; if (done) CM.toast(done) } catch (e) { CM.toast(e.message, 'err'); await load() }
			}
			const setStatus = (v) => { if (v !== lead.value.status) save({ status: v }, 'Status updated').then(() => loadTab(tab.value, true)) }
			const setOwner = (v) => { if ((v || null) !== (lead.value.lead_owner || null)) save({ lead_owner: v }, 'Assigned to ' + ((owners.value.find((o) => o.name === v) || {}).full_name || 'nobody')).then(() => loadTab(tab.value, true)) }
			const title = computed(() => (lead.value ? lead.value.lead_name || lead.value.organization || lead.value.name : ''))
			watch(title, (t) => { if (t) document.title = t + ' - ' + (PRO.shell.brand.name || 'Suite Pro') })
			const copy = async (t) => { try { await navigator.clipboard.writeText(t); CM.toast('Copied') } catch (e) { CM.toast('Could not copy', 'err') } }

			// edit: every writable field, laid out as CRM lays it out
			const edit = reactive({ open: false, v: {}, sections: [], busy: false, error: '' })
			async function openEdit() {
				try { edit.sections = await CM.call('crm_addons.pro.form.get_form', { kind: 'edit' }) } catch (e) { CM.toast(e.message, 'err'); return }
				edit.v = Object.fromEntries(edit.sections.flatMap((s) => s.fields).map((f) => [f.fieldname, lead.value.values[f.fieldname] ?? '']))
				edit.error = ''; edit.open = true
			}
			async function saveEdit() { edit.busy = true; edit.error = ''; try { lead.value = await call('update_lead', { name: props.name, values: JSON.stringify(edit.v) }); delete data.activity; delete data.comments; delete data.data; edit.open = false; CM.toast('Saved') } catch (e) { edit.error = e.message } finally { edit.busy = false } }

			// comments
			const comment = ref('')
			async function addComment() { try { await call('add_comment', { name: props.name, content: comment.value }); comment.value = ''; delete data.activity; await loadTab('comments', true) } catch (e) { CM.toast(e.message, 'err') } }
			const comments = computed(() => (data.comments || []).filter((e) => e.kind === 'comment'))

			// follow-ups and meetings: the same forms as the Meetings page, shown over this page
			const ovl = reactive({ open: false, src: '', title: '', height: 560, kind: '' })
			function openOverlay(kind) {
				const q = new URLSearchParams({ embed: '1', mode: kind === 'followups' ? 'followup' : 'editor', reference_name: props.name, theme: document.documentElement.getAttribute('data-theme') || '', v: String(Date.now()) })
				if (kind !== 'followups') { q.set('reference_doctype', 'CRM Lead'); q.set('reference_title', title.value) }
				Object.assign(ovl, { open: true, kind, title: kind === 'followups' ? 'Log a follow-up' : 'Schedule a meeting', src: '/assets/crm_addons/meetings/index.html?' + q.toString(), height: 560 })
			}
			const frame = ref(null)
			function onMessage(e) {
				if (e.origin !== location.origin || !e.data || e.data.source !== 'crm-addons' || !ovl.open) return
				if (frame.value && e.source !== frame.value.contentWindow) return
				if (e.data.type === 'close') ovl.open = false
				else if (e.data.type === 'resize' && e.data.height) ovl.height = Math.min(e.data.height + 2, window.innerHeight - 120)
				else if (e.data.type === 'saved') { const k = ovl.kind; ovl.open = false; delete data.activity; reload(k).then(load); CM.toast(k === 'followups' ? 'Follow-up saved' : 'Meeting scheduled') }
			}
			onMounted(() => window.addEventListener('message', onMessage))
			onBeforeUnmount(() => window.removeEventListener('message', onMessage))
			async function doneFollowup(f) { try { await call('complete_followup', { name: props.name, followup: f.name }); delete data.activity; await reload('followups'); load() } catch (e) { CM.toast(e.message, 'err') } }

			// emails: write one, or start from one of the app's templates and edit it before it goes
			const em = reactive({ open: false, busy: false, loading: false, v: {}, error: '', tpl: '', info: null, cc: false, bcc: false })
			const body = ref(null)
			async function openEmail() {
				em.v = { recipients: lead.value.email || '', cc: '', bcc: '', subject: '', content: '' }; em.tpl = ''; em.error = ''; em.cc = false; em.bcc = false; em.open = true; em.loading = true
				try { em.info = await call('email_templates', { name: props.name }) } catch (e) { em.error = e.message } finally { em.loading = false }
			}
			const tplOpts = computed(() => [{ value: '', label: 'No template - write my own' }, ...((em.info && em.info.templates) || []).map((t) => ({ value: t.name, label: t.label }))])
			function pickTemplate(v) {
				em.tpl = v; const t = ((em.info && em.info.templates) || []).find((x) => x.name === v)
				if (!t) return
				em.v.subject = t.subject; em.v.content = t.body; if (body.value) body.value.innerHTML = t.body
			}
			const typed = (e) => { em.v.content = e.target.innerHTML }
			function format(cmd) { if (body.value) body.value.focus(); if (cmd === 'link') { const u = window.prompt('Link address', 'https://'); if (u) document.execCommand('createLink', false, u) } else document.execCommand(cmd); if (body.value) em.v.content = body.value.innerHTML }
			async function sendEmail() { em.busy = true; em.error = ''; try { await call('send_email', { name: props.name, ...em.v, html: 1 }); em.open = false; delete data.activity; await reload('emails'); CM.toast('Email queued to send') } catch (e) { em.error = e.message } finally { em.busy = false } }

			// whatsapp
			const wa = reactive({ text: '', busy: false }); const chat = ref(null)
			const waTemplate = () => window.postMessage({ source: 'crm-addons', type: 'pro-send', kind: 'whatsapp', names: [props.name] }, location.origin)
			const waMessages = computed(() => (data.whatsapp ? data.whatsapp.messages : []))
			watch(waMessages, () => nextTick(() => { if (chat.value) chat.value.scrollTop = chat.value.scrollHeight }))
			async function sendWa() { wa.busy = true; try { await call('send_whatsapp', { name: props.name, message: wa.text }); wa.text = ''; delete data.activity; await reload('whatsapp') } catch (e) { CM.toast(e.message, 'err') } finally { wa.busy = false } }

			const ICON = { change: 'edit', comment: 'message', assigned: 'users' }
			return { lead, error, loading, tab, TABS, data, busyTab, back, around, step, statusOpts, ownerOpts, setStatus, setOwner, title, copy, edit, openEdit, saveEdit, comment, addComment, comments, ovl, openOverlay, frame, doneFollowup, em, openEmail, tplOpts, pickTemplate, typed, format, body, sendEmail, wa, waTemplate, sendWa, chat, waMessages, ICON, day, digits, load, PRO, CM }
		},
		template: `
		<div class="page lead-page">
			<div class="row lead-nav"><button type="button" class="btn ghost sm back" @click="back"><Ico name="chevron-left" /> Leads</button><span class="grow"></span>
				<template v-if="around.i >= 0"><span class="small muted">{{ around.i + 1 }} of {{ around.n }}</span><button type="button" class="btn icon sm" aria-label="Previous lead" title="Previous lead" :disabled="!around.prev" @click="step(around.prev)"><Ico name="chevron-up" /></button><button type="button" class="btn icon sm" aria-label="Next lead" title="Next lead" :disabled="!around.next" @click="step(around.next)"><Ico name="chevron-down" /></button></template></div>
			<ErrorState v-if="error" :message="error" @retry="load" />
			<div v-else-if="loading && !lead" class="card"><Skel h="60" /><Skel h="200" /></div>
			<template v-else-if="lead">
				<header class="lead-head card">
					<Pic :name="title" :image="lead.image" :size="52" />
					<div class="grow" style="min-width:0">
						<h1 class="ellipsis">{{ title }}</h1>
						<div class="row wrap small muted" style="gap:14px">
							<span v-if="lead.mobile_no" class="row" style="gap:6px"><Ico name="phone" size="sm" /> {{ lead.mobile_no }} <button type="button" class="btn ghost icon sm" aria-label="Copy phone number" @click="copy(lead.mobile_no)"><Ico name="copy" size="sm" /></button></span>
							<span v-if="lead.email" class="row" style="gap:6px"><Ico name="mail" size="sm" /> {{ lead.email }}</span>
							<span v-if="lead.organization">{{ lead.organization }}</span>
						</div>
					</div>
					<div class="head-dd"><Dd :modelValue="lead.status" :options="statusOpts" :disabled="!lead.can_write" aria-label="Status" @update:modelValue="setStatus" /></div>
					<div class="head-dd"><Dd :modelValue="lead.lead_owner || ''" :options="ownerOpts" searchable :disabled="!lead.can_write" aria-label="Assigned to" @update:modelValue="setOwner" /></div>
					<a v-if="lead.mobile_no" class="btn" :href="'tel:' + lead.mobile_no"><Ico name="phone" /> Call</a>
					<Btn v-if="lead.can_write" icon="edit" @click="openEdit">Edit</Btn>
				</header>

				<div class="lead-layout">
					<div class="lead-main">
						<div class="ltabs" role="tablist"><button v-for="t in TABS" :key="t.id" type="button" role="tab" class="ltab" :class="{ on: tab === t.id }" :aria-selected="String(tab === t.id)" @click="tab = t.id"><Ico :name="t.icon" size="sm" /> {{ t.label }}</button></div>

						<section class="card tabbody" :aria-busy="String(busyTab === tab)">
							<template v-if="tab === 'activity'">
								<Skel v-if="!data.activity" h="40" />
								<Empty v-else-if="!data.activity.length" icon="clock" title="No activity yet" text="Everything that happens with this lead shows up here." />
								<ul v-else class="list"><li v-for="(e, i) in data.activity" :key="i" class="li row act" style="gap:12px;align-items:flex-start">
									<span class="act-ico"><Ico :name="e.icon || ICON[e.kind] || 'clock'" size="sm" /></span>
									<div class="grow">
										<div v-if="e.kind === 'change'"><b>{{ e.by ? e.by.full_name : 'System' }}</b> changed <b>{{ e.field }}</b><template v-if="e.old"> from {{ e.old }}</template> to <b>{{ e.new || 'empty' }}</b></div>
										<div v-else-if="e.kind === 'assigned'" class="muted">{{ e.text }}</div>
										<div v-else-if="e.kind === 'comment'"><b>{{ e.by ? e.by.full_name : 'System' }}</b> commented<div class="note-body">{{ e.text }}</div></div>
										<div v-else><b>{{ e.title }}</b><span v-if="e.by" class="muted"> - {{ e.by.full_name }}</span><div v-if="e.detail" class="small muted">{{ e.detail }}</div></div>
									</div><span class="small muted nowrap">{{ PRO.ago(e.creation) }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'emails'">
								<div class="row" style="justify-content:space-between"><h3>Emails</h3><Btn v-if="lead.can_write" size="sm" icon="mail" @click="openEmail">New email</Btn></div>
								<Skel v-if="!data.emails" h="40" />
								<Empty v-else-if="!data.emails.length" icon="mail" title="No emails yet" text="Emails sent to or received from this lead show here." />
								<ul v-else class="list"><li v-for="e in data.emails" :key="e.name" class="li"><div class="row" style="justify-content:space-between;gap:10px"><b>{{ e.subject || '(no subject)' }}</b><span class="small muted nowrap">{{ PRO.ago(e.communication_date || e.creation) }}</span></div>
									<div class="small muted">{{ e.sent_or_received === 'Sent' ? 'To ' + (e.recipients || '') : 'From ' + (e.sender || '') }}<template v-if="e.delivery_status"> - {{ e.delivery_status }}</template></div>
									<div class="small" style="margin-top:4px">{{ e.preview }}</div></li></ul>
							</template>

							<template v-else-if="tab === 'comments'">
								<h3>Comments</h3>
								<form v-if="lead.can_write" class="row" style="gap:8px;margin-bottom:14px" @submit.prevent="addComment"><div class="grow"><Inp v-model="comment" placeholder="Write a comment" aria-label="Comment" /></div><Btn type="submit" variant="primary" :disabled="!comment.trim()">Comment</Btn></form>
								<Skel v-if="!data.comments" h="40" />
								<Empty v-else-if="!comments.length" icon="message" title="No comments yet" text="Leave a note for your team." />
								<ul v-else class="list"><li v-for="(e, i) in comments" :key="i" class="li row" style="gap:12px;align-items:flex-start"><Pic :name="e.by && e.by.full_name" :image="e.by && e.by.image" :size="30" /><div class="grow"><div><b>{{ e.by ? e.by.full_name : 'System' }}</b> <span class="small muted">{{ PRO.ago(e.creation) }}</span></div><div class="note-body">{{ e.text }}</div></div></li></ul>
							</template>

							<template v-else-if="tab === 'data'">
								<h3>Data</h3>
								<Skel v-if="!data.data" h="40" />
								<Empty v-else-if="!data.data.length" icon="list" title="No data" text="This lead has no filled-in fields." />
								<div v-else v-for="(s, i) in data.data" :key="i" class="dsec"><h4 v-if="s.label" class="dh">{{ s.label }}</h4><div class="facts"><Fact v-for="f in s.fields" :key="f.label" :label="f.label" :value="f.value" /></div></div>
							</template>

							<template v-else-if="tab === 'meetings'">
								<div class="row" style="justify-content:space-between"><h3>Meetings</h3><Btn v-if="lead.can_write" size="sm" icon="plus" @click="openOverlay('meetings')">Schedule meeting</Btn></div>
								<Skel v-if="!data.meetings" h="40" />
								<Empty v-else-if="!data.meetings.length" icon="calendar" title="No meetings" text="Schedule a meeting or a demo with this lead." />
								<ul v-else class="list"><li v-for="m in data.meetings" :key="m.name" class="li row" style="gap:12px"><Ico name="calendar" /><div class="grow"><b>{{ m.subject }}</b><div class="small muted">{{ day(m.starts_on) }}<template v-if="m.by"> - {{ m.by.full_name }}</template></div><div v-if="m.meeting_outcome" class="small">{{ m.meeting_outcome }}</div></div><a v-if="m.google_meet_link" class="btn sm" :href="m.google_meet_link" target="_blank" rel="noopener">Join</a><span class="badge nodot" :class="m.status === 'Completed' ? 'green' : m.status === 'Cancelled' ? 'red' : 'blue'">{{ m.status }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'followups'">
								<div class="row" style="justify-content:space-between"><h3>Follow-ups</h3><Btn v-if="lead.can_write" size="sm" icon="plus" @click="openOverlay('followups')">Log follow-up</Btn></div>
								<Skel v-if="!data.followups" h="40" />
								<Empty v-else-if="!data.followups.length" icon="phone" title="No follow-ups yet" text="Log each call or visit so the next step is never missed." />
								<ul v-else class="list"><li v-for="f in data.followups" :key="f.name" class="li row" style="gap:12px;align-items:flex-start"><Ico name="phone" /><div class="grow"><b>{{ [f.mode, f.call_status, f.outcome].filter(Boolean).join(' - ') }}</b><span class="small muted"> attempt {{ f.attempt_no }}</span><div v-if="f.remark" class="small">{{ f.remark }}</div><div class="small muted">{{ day(f.followed_up_on) }}<template v-if="f.by"> - {{ f.by.full_name }}</template></div>
									<div v-if="f.next_follow_up_on && !f.next_closed" class="small" style="margin-top:4px"><Ico name="calendar" size="sm" /> Next: <b>{{ day(f.next_follow_up_on) }}</b> <Btn v-if="lead.can_write" size="sm" variant="ghost" @click="doneFollowup(f)">Mark done</Btn></div></div></li></ul>
							</template>

							<template v-else-if="tab === 'campaigns'">
								<h3>Campaign</h3>
								<Skel v-if="!data.campaigns" h="40" />
								<Empty v-else-if="!data.campaigns.length" icon="send" title="Not in any campaign" text="Campaign emails and WhatsApp messages sent to this lead show here." />
								<ul v-else class="list"><li v-for="r in data.campaigns" :key="r.name" class="li row" style="gap:12px"><Ico :name="r.channel === 'WhatsApp' ? 'whatsapp' : 'mail'" /><div class="grow"><b>{{ r.campaign_title }}</b><span class="small muted"> step {{ (r.step_idx || 0) + 1 }} - {{ r.channel }}</span>
									<div class="small muted"><template v-if="r.sent_at">Sent {{ day(r.sent_at) }}</template><template v-else-if="r.due_at">Due {{ day(r.due_at) }}</template><template v-if="r.read_at"> - read</template><template v-if="r.clicked_at"> - clicked {{ r.click_count }}x</template></div><div v-if="r.failure_reason || r.skip_reason" class="small" style="color:var(--red)">{{ r.failure_reason || r.skip_reason }}</div></div><span class="badge nodot" :class="['Sent', 'Delivered', 'Read'].includes(r.status) ? 'green' : r.status === 'Failed' ? 'red' : 'neutral'">{{ r.status }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'whatsapp'">
								<div class="row" style="justify-content:space-between"><h3>WhatsApp</h3><Btn v-if="lead.can_write && lead.mobile_no && data.whatsapp && data.whatsapp.installed" size="sm" icon="send" @click="waTemplate">Send a template</Btn></div>
								<Skel v-if="!data.whatsapp" h="40" />
								<Empty v-else-if="!data.whatsapp.installed" icon="whatsapp" title="WhatsApp is not set up" text="Install and connect the Frappe WhatsApp app to chat with leads here." />
								<template v-else>
									<div ref="chat" class="chat"><p v-if="!waMessages.length" class="muted small" style="text-align:center">No messages yet.</p>
										<div v-for="m in waMessages" :key="m.name" class="bub" :class="m.type === 'Incoming' ? 'in' : 'out'"><div>{{ m.message || (m.template ? 'Template: ' + m.template : '[' + (m.content_type || 'message') + ']') }}</div><div class="small muted" style="text-align:right">{{ PRO.ago(m.creation) }}<template v-if="m.type !== 'Incoming' && m.status"> - {{ m.status }}</template></div></div></div>
									<form v-if="lead.can_write && lead.mobile_no" class="row" style="gap:8px;margin-top:12px" @submit.prevent="sendWa"><div class="grow"><Inp v-model="wa.text" placeholder="Type a message" aria-label="WhatsApp message" /></div><Btn type="submit" variant="primary" icon="send" :loading="wa.busy" :disabled="!wa.text.trim()">Send</Btn></form>
									<p v-else-if="!lead.mobile_no" class="small muted">Add a phone number to message this lead.</p>
								</template>
							</template>

						</section>
					</div>

					<aside class="lead-side">
						<section v-for="(s, i) in lead.side_panel" :key="'sp' + i" class="card"><h3>{{ s.label || 'Details' }}</h3>
							<div class="facts one"><Fact v-for="f in s.fields" :key="f.fieldname" :label="f.label" :value="f.display" /></div>
						</section>
						<section class="card"><h3>Added</h3><div class="facts one"><Fact label="Added on" :value="day(lead.creation)" /><Fact label="Added by" :value="lead.created_by && lead.created_by.full_name" /></div></section>
						<section class="card"><h3>Follow-up</h3>
							<div class="facts one"><Fact label="Next follow-up"><span :class="{ overdue: lead.next_follow_up_on && new Date(lead.next_follow_up_on.replace(' ', 'T')) < new Date() }">{{ day(lead.next_follow_up_on) || '-' }}</span></Fact><Fact label="Next meeting" :value="day(lead.next_meeting_on)" /><Fact label="Last call" :value="lead.addons_last_outcome" /><Fact label="Call attempts" :value="lead.addons_call_attempts" /><Fact label="Score" :value="lead.addons_score" /></div>
						</section>
						<section v-if="lead.crm_demo_first_utm_source || lead.crm_demo_first_utm_medium || lead.crm_demo_first_utm_campaign" class="card"><h3>Where they came from</h3>
							<div class="facts one"><Fact label="UTM source" :value="lead.crm_demo_first_utm_source" /><Fact label="UTM medium" :value="lead.crm_demo_first_utm_medium" /><Fact label="UTM campaign" :value="lead.crm_demo_first_utm_campaign" /></div>
						</section>
					</aside>
				</div>

				<Modal v-if="edit.open" title="Edit lead" size="lg" @close="edit.open = false" @submit="saveEdit">
					<FormFields :sections="edit.sections" :values="edit.v" />
					<div v-if="edit.error" class="err" role="alert" style="margin-top:10px">{{ edit.error }}</div>
					<template #foot><Btn @click="edit.open = false">Cancel</Btn><Btn variant="primary" :loading="edit.busy" @click="saveEdit">Save</Btn></template>
				</Modal>
					<div v-if="ovl.open" class="ovl" role="dialog" aria-modal="true" :aria-label="ovl.title" @click.self="ovl.open = false"><div class="ovl-box"><iframe ref="frame" :src="ovl.src" :title="ovl.title" :style="{ height: ovl.height + 'px' }"></iframe></div></div>
					<Modal v-if="em.open" title="New email" size="lg" @close="em.open = false">
						<div v-if="em.info && em.info.problem" class="err" role="alert" style="margin-bottom:10px">{{ em.info.problem }}</div>
						<Field label="Template"><Dd :modelValue="em.tpl" :options="tplOpts" searchable aria-label="Email template" @update:modelValue="pickTemplate" /></Field>
						<Field label="To"><div class="row" style="gap:8px"><div class="grow"><Inp v-model="em.v.recipients" aria-label="To" /></div><button v-if="!em.cc" type="button" class="btn ghost sm" @click="em.cc = true">CC</button><button v-if="!em.bcc" type="button" class="btn ghost sm" @click="em.bcc = true">BCC</button></div></Field>
						<Field v-if="em.cc" label="CC"><Inp v-model="em.v.cc" placeholder="Separate addresses with commas" aria-label="CC" /></Field>
						<Field v-if="em.bcc" label="BCC"><Inp v-model="em.v.bcc" placeholder="Separate addresses with commas" aria-label="BCC" /></Field>
						<Field label="Subject"><Inp v-model="em.v.subject" aria-label="Subject" /></Field>
						<Field label="Message"><div class="mail-ed"><div class="mail-bar"><button type="button" class="btn ghost sm" aria-label="Bold" @click="format('bold')"><b>B</b></button><button type="button" class="btn ghost sm" aria-label="Italic" @click="format('italic')"><i>I</i></button><button type="button" class="btn ghost sm" aria-label="Add a link" @click="format('link')">Link</button></div><div ref="body" class="mail-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" @input="typed"></div></div></Field>
						<div v-if="em.error" class="err" role="alert">{{ em.error }}</div>
						<template #foot><Btn @click="em.open = false">Cancel</Btn><Btn variant="primary" icon="send" :loading="em.busy" :disabled="em.loading" @click="sendEmail">Send</Btn></template>
					</Modal>
			</template>
		</div>`,
	}
})()
