/* Suite Pro: the lead page. Activity, emails, comments, data, meetings, follow-ups, campaigns and WhatsApp of one lead, with its details beside them. */
(() => {
	const { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.lead.' + m, a)
	const day = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + (String(s).length > 10 ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') }
	const clock = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
	const dayKey = (s) => String(s || '').slice(0, 10)
	const dayLabel = (s) => { const d = new Date(dayKey(s) + 'T00:00:00'); if (isNaN(d)) return ''; const t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((t - d) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' }) }
	const TABS = [
		{ id: 'activity', label: 'Activity', icon: 'clock' }, { id: 'followups', label: 'Follow-ups', icon: 'phone' }, { id: 'meetings', label: 'Meetings', icon: 'calendar' }, { id: 'emails', label: 'Emails', icon: 'mail' },
		{ id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' }, { id: 'comments', label: 'Comments', icon: 'message' }, { id: 'data', label: 'Data', icon: 'list' }, { id: 'campaigns', label: 'Campaign', icon: 'send' },
	]
	const LOADERS = { activity: 'get_activity', emails: 'get_emails', comments: 'get_timeline', data: 'get_data', meetings: 'get_meetings', followups: 'get_followups', campaigns: 'get_campaigns', whatsapp: 'get_whatsapp' }
	const HEX = { gray: '#94a3b8', blue: '#3b82f6', green: '#22c55e', teal: '#14b8a6', red: '#ef4444', orange: '#f97316', yellow: '#eab308', purple: '#a855f7', pink: '#ec4899', cyan: '#06b6d4' }
	const EMOJI = {
		'😀': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬'],
		'👍': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '👏', '🙌', '👐', '🤲', '💪', '✍️', '🤳', '👀', '👁️', '🧠', '🗣️', '👤', '👥'],
		'❤️': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💢', '💥', '💫', '💦', '💤', '✨', '⭐', '🌟', '🔥', '🎉', '🎊', '🎁', '🏆', '🥇', '🎯', '✅', '❌', '⚠️', '❓', '❗', '➕', '➖', '➡️', '⬅️', '⬆️', '⬇️', '🔔', '🔒', '🔑'],
		'💼': ['💼', '📁', '📂', '📄', '📃', '📋', '📌', '📍', '📎', '🖇️', '📝', '✏️', '🖊️', '📅', '📆', '🗓️', '⏰', '⏳', '⌛', '📞', '☎️', '📱', '💻', '🖥️', '📧', '✉️', '📨', '📩', '📤', '📥', '📦', '💰', '💵', '💳', '🧾', '📈', '📉', '📊', '🔍', '💡', '🔗', '🏢', '🏠', '🏭', '🛒'],
		'🍕': ['☕', '🍵', '🍺', '🍷', '🥂', '🍕', '🍔', '🍟', '🌮', '🍝', '🍣', '🍰', '🎂', '🍫', '🍎', '🍌', '🍇', '🍉', '🥗', '🌞', '🌙', '⛅', '🌧️', '🌈', '🌸', '🌹', '🌻', '🌳', '🐶', '🐱', '🐼', '🦁'],
		'🚗': ['🚗', '🚕', '🚌', '🚆', '✈️', '🚀', '🚲', '🏍️', '⛽', '🗺️', '🧭', '🏖️', '🏔️', '🌆', '🌍', '⚽', '🏏', '🏀', '🎮', '🎵', '🎬', '📷'],
	}
	const EMOJI_TABS = Object.keys(EMOJI)

	V.Fact = {
		props: { label: String, value: [String, Number], link: String },
		template: `<div class="fact"><span class="fact-l">{{ label }}</span><span class="fact-v"><slot><a v-if="link && value" :href="link" target="_blank" rel="noopener">{{ value }}</a><template v-else>{{ value || '-' }}</template></slot></span></div>`,
	}

	/** A text box with a formatting bar (headings, bold, italic, underline, lists, quote, alignment, colour, link). Its value is HTML. */
	V.RichEditor = {
		props: { modelValue: { type: String, default: '' }, placeholder: { type: String, default: 'Write here' }, minHeight: { type: Number, default: 150 }, label: { type: String, default: 'Message' } },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const el = ref(null)
			onMounted(() => { el.value.innerHTML = props.modelValue || '' })
			watch(() => props.modelValue, (v) => { if (el.value && (v || '') !== el.value.innerHTML) el.value.innerHTML = v || '' })
			const sync = () => { const h = el.value.innerHTML; emit('update:modelValue', !el.value.textContent.trim() && !/<(img|a|li)/.test(h) ? '' : h) }
			function run(cmd, val) { el.value.focus(); document.execCommand(cmd, false, val); sync() }
			function link() { const u = window.prompt('Link address', 'https://'); if (u) run('createLink', u) }
			const BAR = [
				[{ t: 'P', tip: 'Paragraph', f: () => run('formatBlock', 'P') }, { t: 'H2', tip: 'Heading 2', f: () => run('formatBlock', 'H2') }, { t: 'H3', tip: 'Heading 3', f: () => run('formatBlock', 'H3') }, { t: 'H4', tip: 'Heading 4', f: () => run('formatBlock', 'H4') }],
				[{ i: 'bold', tip: 'Bold', f: () => run('bold') }, { i: 'italic', tip: 'Italic', f: () => run('italic') }, { i: 'underline', tip: 'Underline', f: () => run('underline') }, { t: 'S', tip: 'Strikethrough', f: () => run('strikeThrough'), s: 'text-decoration:line-through' }],
				[{ i: 'list', tip: 'Bulleted list', f: () => run('insertUnorderedList') }, { i: 'list-ol', tip: 'Numbered list', f: () => run('insertOrderedList') }, { t: '❝', tip: 'Quote', f: () => run('formatBlock', 'BLOCKQUOTE') }],
				[{ i: 'align-left', tip: 'Align left', f: () => run('justifyLeft') }, { i: 'align-center', tip: 'Align centre', f: () => run('justifyCenter') }, { i: 'align-right', tip: 'Align right', f: () => run('justifyRight') }],
				[{ i: 'link', tip: 'Add a link', f: link }, { t: 'Tx', tip: 'Clear formatting', f: () => run('removeFormat') }],
			]
			const colour = (e) => run('foreColor', e.target.value)
			return { el, sync, BAR, colour, run }
		},
		template: `<div class="rte">
			<div class="rte-bar" role="toolbar" aria-label="Formatting"><template v-for="(g, gi) in BAR" :key="gi"><span v-if="gi" class="rte-sep"></span><button v-for="b in g" :key="b.tip" type="button" class="rte-b" :title="b.tip" :aria-label="b.tip" @mousedown.prevent @click="b.f"><Ico v-if="b.i" :name="b.i" size="sm" /><span v-else :style="b.s">{{ b.t }}</span></button></template>
				<span class="rte-sep"></span><label class="rte-b rte-c" title="Text colour"><Ico name="palette" size="sm" /><input type="color" aria-label="Text colour" @input="colour" /></label></div>
			<div ref="el" class="rte-body" contenteditable="true" role="textbox" aria-multiline="true" :aria-label="label" :data-ph="placeholder" :style="{ minHeight: minHeight + 'px' }" @input="sync"></div>
		</div>`,
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
			const statusOpts = computed(() => (lead.value ? lead.value.statuses.map((s) => ({ value: s.name, label: s.name, dot: HEX[s.color] || HEX.gray })) : []))
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
			async function dropLead() {
				if (!(await CM.confirm({ title: 'Delete ' + title.value + '?', text: 'The lead and everything on it will be removed. This cannot be undone.', confirmText: 'Delete', danger: true }))) return
				try { await call('delete_lead', { name: props.name }); CM.toast('Lead deleted'); back() } catch (e) { CM.toast(e.message, 'err') }
			}

			// edit: every writable field, laid out as CRM lays it out
			const edit = reactive({ open: false, v: {}, sections: [], busy: false, error: '' })
			async function openEdit() {
				try { edit.sections = await CM.call('crm_addons.pro.form.get_form', { kind: 'edit' }) } catch (e) { CM.toast(e.message, 'err'); return }
				edit.v = Object.fromEntries(edit.sections.flatMap((s) => s.fields).map((f) => [f.fieldname, lead.value.values[f.fieldname] ?? '']))
				edit.error = ''; edit.open = true
			}
			async function saveEdit() { edit.busy = true; edit.error = ''; try { lead.value = await call('update_lead', { name: props.name, values: JSON.stringify(edit.v) }); delete data.activity; delete data.comments; delete data.data; edit.open = false; CM.toast('Saved') } catch (e) { edit.error = e.message } finally { edit.busy = false } }

			// comments
			const comment = ref(''); const commenting = ref(false)
			async function addComment() { commenting.value = true; try { await call('add_comment', { name: props.name, content: comment.value }); comment.value = ''; delete data.activity; await loadTab('comments', true) } catch (e) { CM.toast(e.message, 'err') } finally { commenting.value = false } }
			const comments = computed(() => (data.comments || []).filter((e) => e.kind === 'comment'))

			// follow-ups and meetings: the same forms as the Meetings page, shown over this page
			const ovl = reactive({ open: false, src: '', title: '', height: 560, kind: '' })
			function openOverlay(kind, followup) {
				const q = new URLSearchParams({ embed: '1', mode: kind === 'followups' ? 'followup' : 'editor', reference_name: props.name, theme: document.documentElement.getAttribute('data-theme') || '', v: String(Date.now()) })
				if (kind !== 'followups') { q.set('reference_doctype', 'CRM Lead'); q.set('reference_title', title.value) } else if (followup) q.set('followup', followup)
				Object.assign(ovl, { open: true, kind, title: kind === 'followups' ? (followup ? 'Edit follow-up' : 'Add follow-up') : 'Schedule a meeting', src: '/assets/crm_addons/meetings/index.html?' + q.toString(), height: 560 })
			}
			const frame = ref(null)
			function onMessage(e) {
				if (e.origin !== location.origin || !e.data || e.data.source !== 'crm-addons' || !ovl.open) return
				if (frame.value && e.source !== frame.value.contentWindow) return
				if (e.data.type === 'close') ovl.open = false
				else if (e.data.type === 'resize' && e.data.height) ovl.height = Math.min(e.data.height + 2, window.innerHeight - 120)
				else if (e.data.type === 'saved') { const k = ovl.kind; ovl.open = false; delete data.activity; reload(k).then(load); CM.toast(k === 'followups' ? 'Follow-up saved' : 'Meeting scheduled') }
			}
			// a click anywhere else closes the emoji picker, the attach menu and a message's menu
			function closeChatPops(e) { if (!wa.emoji && !wa.menu && !wa.menuFor) return; if (e.target.closest && e.target.closest('.wx-emoji, .wx-attach, .wx-ib, .wx-more, .wx-menu')) return; wa.emoji = false; wa.menu = false; wa.menuFor = '' }
			onMounted(() => { window.addEventListener('message', onMessage); document.addEventListener('click', closeChatPops) })
			onBeforeUnmount(() => { window.removeEventListener('message', onMessage); document.removeEventListener('click', closeChatPops) })
			async function doneFollowup(f) { try { await call('complete_followup', { name: props.name, followup: f.name }); delete data.activity; await reload('followups'); load() } catch (e) { CM.toast(e.message, 'err') } }
			async function dropFollowup(f) {
				if (!(await CM.confirm({ title: 'Delete this follow-up?', confirmText: 'Delete', danger: true }))) return
				try { await call('delete_followup', { name: props.name, followup: f.name }); delete data.activity; await reload('followups'); load() } catch (e) { CM.toast(e.message, 'err') }
			}
			const fu = computed(() => data.followups || null)
			const overdue = (s) => !!s && new Date(String(s).replace(' ', 'T')) < new Date()
			const attemptTone = (f) => {
				const o = String(f.outcome || '').toLowerCase()
				if (/not interested|lost|wrong/.test(o)) return 'red'
				if (f.mode === 'Call' && f.call_status && f.call_status !== 'Connected') return 'red'
				if (/meeting|interested|won|demo/.test(o)) return 'green'
				return 'blue'
			}
			const bandTone = (b) => (b === 'Hot' ? 'red' : b === 'Warm' ? 'amber' : 'neutral')

			// emails: write one, or start from one of the app's templates and edit it before it goes
			const em = reactive({ open: false, busy: false, loading: false, v: {}, error: '', tpl: '', info: null, cc: false, bcc: false, files: [], upBusy: false, pick: false, sel: '' })
			const opened = reactive({})
			async function loadTemplates() {
				if (em.info) return
				em.loading = true
				try { em.info = await call('email_templates', { name: props.name }) } catch (e) { em.error = e.message } finally { em.loading = false }
			}
			// a blank email to write by hand
			async function openEmail() {
				em.v = { recipients: lead.value.email || '', cc: '', bcc: '', subject: '', content: '' }; em.tpl = ''; em.error = ''; em.cc = false; em.bcc = false; em.files = []; em.open = true
				loadTemplates()
			}
			// the templates already in the CRM, each shown as it will look, then used as the start of an email
			async function openTemplates() { em.pick = true; em.sel = em.tpl; await loadTemplates(); if (!em.sel && em.info && em.info.templates.length) em.sel = em.info.templates[0].name }
			const selTemplate = computed(() => ((em.info && em.info.templates) || []).find((t) => t.name === em.sel) || null)
			async function useTemplate(t) {
				if (!em.open) await openEmail()
				em.tpl = t.name; em.v.subject = t.subject; em.v.content = t.body; em.pick = false
			}
			async function attach(e) {
				const picked = [...e.target.files]; e.target.value = ''; em.upBusy = true
				try { for (const f of picked) em.files.push(await CM.upload(f, { isPrivate: true })) } catch (x) { em.error = x.message } finally { em.upBusy = false }
			}
			async function sendEmail() { em.busy = true; em.error = ''; try { await call('send_email', { name: props.name, ...em.v, html: 1, attachments: JSON.stringify(em.files.map((f) => f.name)) }); em.open = false; delete data.activity; await reload('emails'); CM.toast('Email queued to send') } catch (e) { em.error = e.message } finally { em.busy = false } }
			const mailState = (e) => (e.sent_or_received === 'Received' ? 'Received' : e.read_by_recipient ? 'Read' : e.delivery_status || 'Sent')

			// whatsapp: shaped like the app, with the 24-hour rule of the WhatsApp Business platform
			const wa = reactive({ text: '', busy: false, emoji: false, cat: '😀', menu: false, replies: [], hi: 0, reply: null, pending: null, menuFor: '' }); const chat = ref(null); const pics = ref(null); const vids = ref(null); const docs = ref(null)
			const wt = reactive({ open: false, loading: false, info: null, sel: '', busy: false, error: '' })
			async function waTemplate() {
				Object.assign(wt, { open: true, sel: '', error: '' }); if (wt.info) return
				wt.loading = true
				try { wt.info = await call('whatsapp_templates', { name: props.name }); if (wt.info.templates.length) wt.sel = wt.info.templates[0].name } catch (e) { wt.error = e.message } finally { wt.loading = false }
			}
			const wtSel = computed(() => (wt.info && wt.info.templates.find((t) => t.name === wt.sel)) || null)
			async function sendTemplate() {
				wt.busy = true; wt.error = ''
				try { await CM.call('crm_addons.pro.bulk_send.send_whatsapp', { names: JSON.stringify([props.name]), template: wt.sel }); wt.open = false; wt.info = null; delete data.activity; await reload('whatsapp'); CM.toast('Template sent') } catch (e) { wt.error = e.message } finally { wt.busy = false }
			}
			const waMessages = computed(() => (data.whatsapp ? [...data.whatsapp.messages].sort((a, b) => String(a.creation).localeCompare(String(b.creation))) : []))
			const waDays = computed(() => { const out = []; for (const m of waMessages.value) { const k = dayKey(m.creation); const last = out[out.length - 1]; if (last && last.key === k) last.items.push(m); else out.push({ key: k, label: dayLabel(m.creation), items: [m] }) } return out })
			watch(() => data.whatsapp, () => nextTick(() => { if (chat.value) chat.value.scrollTop = chat.value.scrollHeight }))
			// saved replies: type / in the box and pick one
			async function loadReplies() { try { const r = await CM.call('crm_addons.pro.config.get_whatsapp_replies', {}); wa.replies = r.replies } catch (e) { /* the box works without them */ } }
			watch(tab, (t) => { if (t === 'whatsapp') loadReplies() }, { immediate: true })
			const slash = computed(() => { if (!wa.text.startsWith('/')) return []; const q = wa.text.slice(1).toLowerCase(); return wa.replies.filter((r) => (r.title + ' ' + r.text).toLowerCase().includes(q)).slice(0, 8) })
			watch(slash, () => { wa.hi = 0 })
			// the reply is filled in for this lead on the server and only put in the box: the person reads and edits it, then sends
			async function useReply(r) {
				wa.menu = false; wa.text = r.text; wa.pending = r.attach_url ? { url: r.attach_url, name: r.attach_name, type: r.attach_type || 'document' } : null
				try { wa.text = await call('render_reply', { name: props.name, text: r.text }) } catch (e) { /* the raw text stays for editing */ }
				nextTick(() => { const el = document.querySelector('.wx-in'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
			}
			function onKeys(e) {
				if (!slash.value.length) return
				if (e.key === 'ArrowDown') { e.preventDefault(); wa.hi = Math.min(slash.value.length - 1, wa.hi + 1) } else if (e.key === 'ArrowUp') { e.preventDefault(); wa.hi = Math.max(0, wa.hi - 1) }
				else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); useReply(slash.value[wa.hi]) } else if (e.key === 'Escape') wa.text = ''
			}
			const grouped = (d, i) => i > 0 && d.items[i - 1].type === d.items[i].type
			const mediaOf = (m) => { const a = m.attach; if (!a) return ''; const t = m.content_type; if (t === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(a)) return 'image'; if (t === 'video' || /\.(mp4|3gp|mov)$/i.test(a)) return 'video'; if (t === 'audio' || /\.(mp3|ogg|opus|m4a|aac|amr)$/i.test(a)) return 'audio'; return 'document' }
			const fileName = (u) => decodeURIComponent(String(u || '').split('/').pop().split('?')[0])
			const caption = (m) => (m.message && m.message !== m.attach ? m.message : '')
			const bubbleText = (m) => caption(m) || (!m.attach ? (m.template_name ? (m.template || '') : (m.message || (m.template ? m.template : '[' + (m.content_type || 'message') + ']'))) : '')
			const tick = (m) => { const st = String(m.status || '').toLowerCase(); return st === 'read' ? 'read' : st === 'delivered' ? 'delivered' : st === 'failed' ? 'failed' : 'sent' }
			const REACTS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
			function startReply(m) { wa.reply = m; wa.menuFor = ''; nextTick(() => { const el = document.querySelector('.wx-in'); if (el) el.focus() }) }
			async function copyText(m) { wa.menuFor = ''; copy(bubbleText(m) || m.message || '') }
			async function applyEntry(e) {
				try {
					const done = await call('apply_form_entry', { name: props.name, entry: e.form_entry.entry })
					CM.toast(done && done.length ? 'Updated: ' + done.join(', ') : 'Nothing was different, so nothing changed')
					e.form_entry.applied = 1
					await Promise.all([reload('activity'), reload('comments'), load()])
				} catch (err) { CM.toast(err.message, 'err') }
			}
			async function react(m, x) { wa.menuFor = ''; try { await call('react_whatsapp', { name: props.name, message: m.name, emoji: m.reaction === x ? '' : x }); await reload('whatsapp') } catch (e) { CM.toast(e.message, 'err') } }
			async function sendWa(file) {
				wa.busy = true
				try {
					let attachUrl = ''; let type = 'text'
					if (file) { const up = await CM.upload(file, { isPrivate: false }); attachUrl = up.file_url; type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document' }
					else if (wa.pending) { attachUrl = wa.pending.url; type = wa.pending.type }
					await call('send_whatsapp', { name: props.name, message: wa.text, attach: attachUrl, content_type: type, reply_to: wa.reply ? wa.reply.name : '' }); wa.text = ''; wa.emoji = false; wa.reply = null; wa.pending = null; delete data.activity; await reload('whatsapp')
				} catch (e) { CM.toast(e.message, 'err'); reload('whatsapp') } finally { wa.busy = false }
			}
			function pickFile(e) { wa.menu = false; const f = e.target.files[0]; e.target.value = ''; if (f) sendWa(f) }
			const addEmoji = (x) => { wa.text += x }
			const shortTime = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return ''; const t = new Date(); const sameDay = d.toDateString() === t.toDateString(); return (sameDay ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }

			const ICON = { change: 'edit', comment: 'message', assigned: 'users' }
			return { applyEntry, wt, wtSel, sendTemplate, openTemplates, selTemplate, useTemplate, lead, error, loading, tab, TABS, data, busyTab, back, around, step, statusOpts, ownerOpts, setStatus, setOwner, title, copy, dropLead, edit, openEdit, saveEdit, comment, commenting, addComment, comments, ovl, openOverlay, frame, doneFollowup, dropFollowup, fu, overdue, attemptTone, bandTone, em, opened, openEmail, attach, sendEmail, mailState, wa, waTemplate, sendWa, pickFile, pics, vids, docs, addEmoji, EMOJI, EMOJI_TABS, REACTS, startReply, copyText, react, slash, useReply, onKeys, shortTime, grouped, chat, waMessages, waDays, mediaOf, fileName, caption, bubbleText, tick, clock, ICON, day, load, PRO, CM }
		},
		template: `
		<div class="page lead-page">
			<ErrorState v-if="error" :message="error" @retry="load" />
			<div v-else-if="loading && !lead" class="card"><Skel h="60" /><Skel h="200" /></div>
			<template v-else-if="lead">
				<header class="lead-head card">
					<div class="lh-top">
						<button type="button" class="btn ghost sm back" @click="back"><Ico name="chevron-left" /> Leads</button>
						<span class="lead-id" title="Lead ID">{{ lead.name }}</span>
						<span class="grow"></span>
						<template v-if="around.i >= 0"><span class="small muted">{{ around.i + 1 }} of {{ around.n }}</span><button type="button" class="btn icon sm" aria-label="Previous lead" title="Previous lead" :disabled="!around.prev" @click="step(around.prev)"><Ico name="chevron-left" /></button><button type="button" class="btn icon sm" aria-label="Next lead" title="Next lead" :disabled="!around.next" @click="step(around.next)"><Ico name="chevron-right" /></button></template>
					</div>
					<div class="lh-main">
						<Pic :name="title" :image="lead.image" :size="52" />
						<div class="grow" style="min-width:0">
							<h1 class="ellipsis">{{ title }}</h1>
							<div class="row wrap small muted" style="gap:14px">
								<span v-if="lead.organization" class="row" style="gap:6px"><Ico name="building" size="sm" /> {{ lead.organization }}</span>
								<span v-if="lead.mobile_no" class="row" style="gap:6px"><Ico name="phone" size="sm" /> {{ lead.mobile_no }} <button type="button" class="btn ghost icon sm" aria-label="Copy phone number" @click="copy(lead.mobile_no)"><Ico name="copy" size="sm" /></button></span>
								<span v-if="lead.email" class="row" style="gap:6px"><Ico name="mail" size="sm" /> {{ lead.email }}</span>
							</div>
						</div>
						<div class="head-dd"><Dd :modelValue="lead.status" :options="statusOpts" :disabled="!lead.can_write" aria-label="Status" @update:modelValue="setStatus" /></div>
						<div class="head-dd"><Dd :modelValue="lead.lead_owner || ''" :options="ownerOpts" searchable :disabled="!lead.can_write" aria-label="Assigned to" @update:modelValue="setOwner" /></div>
						<Btn v-if="lead.can_write" icon="edit" @click="openEdit">Edit</Btn>
						<Btn v-if="lead.can_delete" icon="trash" class="danger-o" aria-label="Delete lead" title="Delete lead" @click="dropLead" />
					</div>
				</header>

				<div class="lead-layout">
					<div class="lead-main">
						<div class="ltabs" role="tablist"><button v-for="t in TABS" :key="t.id" type="button" role="tab" class="ltab" :class="{ on: tab === t.id }" :aria-selected="String(tab === t.id)" @click="tab = t.id"><Ico :name="t.icon" size="sm" /> {{ t.label }}</button></div>

						<section class="card tabbody" :class="{ fill: tab === 'whatsapp' }" :aria-busy="String(busyTab === tab)">
							<template v-if="tab === 'activity'">
								<Skel v-if="!data.activity" h="40" />
								<Empty v-else-if="!data.activity.length" icon="clock" title="No activity yet" text="Everything that happens with this lead shows up here." />
								<ul v-else class="list tline"><li v-for="(e, i) in data.activity" :key="i" class="li row act" style="gap:12px;align-items:flex-start">
									<span class="act-ico"><Ico :name="e.icon || ICON[e.kind] || 'clock'" size="sm" /></span>
									<div class="grow">
										<div v-if="e.kind === 'change'"><b>{{ e.by ? e.by.full_name : 'System' }}</b> edited {{ (e.changes || []).length > 1 ? (e.changes || []).length + ' fields' : 'a field' }}<ul class="chg"><li v-for="(c, ci) in (e.changes || [{ field: e.field, old: e.old, new: e.new }])" :key="ci"><span class="chg-f">{{ c.field }}</span><span class="chg-o">{{ c.old || 'empty' }}</span><Ico name="arrow-right" size="sm" /><b class="chg-n">{{ c.new || 'empty' }}</b></li></ul></div>
										<div v-else-if="e.kind === 'assigned'" class="muted">{{ e.text }}</div>
										<div v-else-if="e.kind === 'comment' && e.form_entry"><b>Lead form</b> - someone who is already a lead tried to register<div class="cbub" v-html="e.html"></div>
											<div v-if="lead.can_write" class="row" style="gap:8px;margin-top:6px"><Btn v-if="!e.form_entry.applied" size="sm" variant="primary" icon="refresh" @click="applyEntry(e)">Update details</Btn><span v-else class="small muted">Details updated</span></div></div>
										<div v-else-if="e.kind === 'comment'"><b>{{ e.by && e.by.full_name !== 'Guest' ? e.by.full_name : 'Lead form' }}</b> commented<div class="cbub" v-html="e.html || e.text"></div></div>
										<div v-else><b>{{ e.title }}</b><span v-if="e.by" class="muted"> - {{ e.by.full_name }}</span><div v-if="e.detail" class="small muted">{{ e.detail }}</div></div>
									</div><span class="small muted nowrap">{{ PRO.ago(e.creation) }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'emails'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="mail" /> Emails</h3><div v-if="lead.can_write" class="row" style="gap:8px"><Btn icon="file-text" @click="openTemplates">Templates</Btn><Btn variant="primary" icon="plus" @click="openEmail">New email</Btn></div></div>
								<Skel v-if="!data.emails" h="40" />
								<Empty v-else-if="!data.emails.length" icon="mail" title="No emails yet" text="Emails sent to or received from this lead show here." />
								<div v-else class="mails"><article v-for="e in data.emails" :key="e.name" class="mail" :class="e.sent_or_received === 'Sent' ? 'out' : 'in'">
									<Pic :name="e.sender_full_name || e.sender" :size="34" />
									<div class="mail-card">
										<div class="row" style="gap:8px;align-items:flex-start"><div class="grow" style="min-width:0"><b>{{ e.sender_full_name || e.sender }}</b> <span class="small muted">&lt;{{ e.sender }}&gt;</span></div><span class="badge nodot" :class="mailState(e) === 'Read' ? 'blue' : mailState(e) === 'Received' ? 'neutral' : /fail|error/i.test(mailState(e)) ? 'red' : 'green'">{{ mailState(e) }}</span><span class="small muted nowrap">{{ PRO.ago(e.communication_date || e.creation) }}</span></div>
										<div class="mail-sub">{{ e.subject || '(no subject)' }}</div>
										<div class="small muted">To: {{ e.recipients }}<template v-if="e.cc"> - CC: {{ e.cc }}</template></div>
										<div class="mail-view" :class="{ open: opened[e.name] }" v-html="e.body"></div>
										<button v-if="(e.body || '').length > 400" type="button" class="btn ghost sm" @click="opened[e.name] = !opened[e.name]">{{ opened[e.name] ? 'Show less' : 'Show more' }}</button>
									</div></article></div>
							</template>

							<template v-else-if="tab === 'comments'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="message" /> Comments</h3></div>
								<div v-if="lead.can_write" class="comment-box"><RichEditor v-model="comment" placeholder="Write a comment" label="Comment" :min-height="90" /><div class="row" style="justify-content:flex-end;margin-top:8px"><Btn variant="primary" icon="send" :loading="commenting" :disabled="!comment" @click="addComment">Comment</Btn></div></div>
								<Skel v-if="!data.comments" h="40" />
								<Empty v-else-if="!comments.length" icon="message" title="No comments yet" text="Leave a note for your team." />
								<ul v-else class="list"><li v-for="(e, i) in comments" :key="i" class="li row" style="gap:12px;align-items:flex-start"><Pic :name="e.by && e.by.full_name" :image="e.by && e.by.image" :size="32" /><div class="grow"><div><b>{{ e.by && e.by.full_name !== 'Guest' ? e.by.full_name : 'Lead form' }}</b> <span class="small muted">{{ PRO.ago(e.creation) }}</span></div><div class="cbub" v-html="e.html || e.text"></div><div v-if="e.form_entry && lead.can_write" class="row" style="gap:8px;margin-top:6px"><Btn v-if="!e.form_entry.applied" size="sm" variant="primary" icon="refresh" @click="applyEntry(e)">Update details</Btn><span v-else class="small muted">Details updated</span></div></div></li></ul>
							</template>

							<template v-else-if="tab === 'data'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="list" /> Data</h3></div>
								<Skel v-if="!data.data" h="40" />
								<Empty v-else-if="!data.data.length" icon="list" title="No data" text="This lead has no filled-in fields." />
								<div v-else class="dcards"><section v-for="(s, i) in data.data" :key="i" class="dcard"><h4 class="dh">{{ s.label || 'Details' }}</h4><div class="facts two"><Fact v-for="f in s.fields" :key="f.label" :label="f.label" :value="f.value" /></div></section></div>
							</template>

							<template v-else-if="tab === 'meetings'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="calendar" /> Meetings</h3><Btn v-if="lead.can_write" variant="primary" icon="plus" @click="openOverlay('meetings')">Schedule meeting</Btn></div>
								<Skel v-if="!data.meetings" h="40" />
								<Empty v-else-if="!data.meetings.length" icon="calendar" title="No meetings" text="Schedule a meeting or a demo with this lead." />
								<ul v-else class="list"><li v-for="m in data.meetings" :key="m.name" class="li row" style="gap:12px"><Ico name="calendar" /><div class="grow"><b>{{ m.subject }}</b><div class="small muted">{{ day(m.starts_on) }}<template v-if="m.by"> - {{ m.by.full_name }}</template></div><div v-if="m.meeting_outcome" class="small">{{ m.meeting_outcome }}</div></div><a v-if="m.google_meet_link" class="btn sm" :href="m.google_meet_link" target="_blank" rel="noopener">Join</a><span class="badge nodot" :class="m.status === 'Completed' ? 'green' : m.status === 'Cancelled' ? 'red' : 'blue'">{{ m.status }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'followups'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="phone" /> Follow-ups</h3><Btn v-if="lead.can_write" variant="primary" icon="plus" @click="openOverlay('followups')">Add follow-up</Btn></div>
								<Skel v-if="!fu" h="40" />
								<template v-else>
									<div v-if="fu.summary.next" class="fu-next" :class="{ late: overdue(fu.summary.next.next_follow_up_on) }"><Ico :name="overdue(fu.summary.next.next_follow_up_on) ? 'alert' : 'clock'" /><div class="grow"><b>{{ overdue(fu.summary.next.next_follow_up_on) ? 'Follow-up overdue' : 'Next follow-up' }}: {{ day(fu.summary.next.next_follow_up_on) }}</b><div v-if="fu.summary.next.remark" class="small">{{ fu.summary.next.remark }}</div></div><Btn v-if="lead.can_write" icon="check" @click="doneFollowup(fu.summary.next)">Mark done</Btn></div>
									<div v-if="fu.items.length" class="chips"><span v-if="fu.summary.streak" class="badge nodot amber">{{ fu.summary.streak }} call{{ fu.summary.streak === 1 ? '' : 's' }} in a row not picked / connected</span><span class="badge nodot neutral">{{ fu.summary.calls }} call{{ fu.summary.calls === 1 ? '' : 's' }} logged</span><span v-if="fu.score !== null" class="badge nodot" :class="bandTone(fu.score_band)">Score {{ fu.score }} - {{ fu.score_band }}</span></div>
									<Empty v-if="!fu.items.length" icon="phone" title="No follow-ups yet" text="Log each call or visit so the next step is never missed." />
									<div v-else class="fcards"><article v-for="f in fu.items" :key="f.name" class="fcard">
										<div class="row" style="gap:8px;align-items:flex-start"><span class="badge nodot big" :class="attemptTone(f)">Attempt {{ f.attempt_no }} - {{ f.outcome || f.call_status || f.mode }}</span><span class="grow"></span>
											<button v-if="f.can_edit" type="button" class="btn ghost icon sm" aria-label="Edit follow-up" title="Edit" @click="openOverlay('followups', f.name)"><Ico name="edit" /></button>
											<button v-if="fu.can_delete" type="button" class="btn ghost icon sm" aria-label="Delete follow-up" title="Delete" @click="dropFollowup(f)"><Ico name="trash" /></button></div>
										<div v-if="f.remark" class="fremark">{{ f.remark }}</div>
										<div class="small muted fmeta"><span>{{ day(f.followed_up_on) }}</span><span v-if="f.by">by {{ f.by }}</span><span v-if="f.mode && f.mode !== 'Call'">{{ f.mode }}</span><span v-if="f.next_follow_up_on">Next: {{ day(f.next_follow_up_on) }}<template v-if="f.next_closed"> (done)</template></span></div>
									</article></div>
								</template>
							</template>

							<template v-else-if="tab === 'campaigns'">
								<div class="tab-head"><h3 class="row" style="gap:8px"><Ico name="send" /> Campaign</h3></div>
								<Skel v-if="!data.campaigns" h="40" />
								<Empty v-else-if="!data.campaigns.length" icon="send" title="Not in any campaign" text="Campaign emails and WhatsApp messages sent to this lead show here." />
								<ul v-else class="list"><li v-for="r in data.campaigns" :key="r.name" class="li row" style="gap:12px"><Ico :name="r.channel === 'WhatsApp' ? 'whatsapp' : 'mail'" /><div class="grow"><b>{{ r.campaign_title }}</b><span class="small muted"> step {{ (r.step_idx || 0) + 1 }} - {{ r.channel }}</span>
									<div class="small muted"><template v-if="r.sent_at">Sent {{ day(r.sent_at) }}</template><template v-else-if="r.due_at">Due {{ day(r.due_at) }}</template><template v-if="r.read_at"> - read</template><template v-if="r.clicked_at"> - clicked {{ r.click_count }}x</template></div><div v-if="r.failure_reason || r.skip_reason" class="small" style="color:var(--red)">{{ r.failure_reason || r.skip_reason }}</div></div><span class="badge nodot" :class="['Sent', 'Delivered', 'Read'].includes(r.status) ? 'green' : r.status === 'Failed' ? 'red' : 'neutral'">{{ r.status }}</span></li></ul>
							</template>

							<template v-else-if="tab === 'whatsapp'">
								<Skel v-if="!data.whatsapp" h="40" />
								<Empty v-else-if="!data.whatsapp.installed" icon="whatsapp" title="WhatsApp is not set up" text="Install and connect the Frappe WhatsApp app to chat with leads here." />
								<div v-else class="wx">
									<div class="wx-head"><Pic :name="title" :image="lead.image" :size="30" /><div class="grow"><b>{{ title }}</b><div class="small">{{ lead.mobile_no || 'No phone number' }}</div></div>
										<span class="wx-win" :class="{ on: data.whatsapp.window_open }" :title="data.whatsapp.window_open ? 'Free chat is open until ' + day(data.whatsapp.window_until) : 'The lead has not written in 24 hours'">{{ data.whatsapp.window_open ? 'Open till ' + shortTime(data.whatsapp.window_until) : 'Template needed' }}</span>
										<button v-if="lead.can_write && lead.mobile_no" type="button" class="wx-tpl" @click="waTemplate"><Ico name="send" size="sm" /> Template</button></div>
									<div ref="chat" class="wx-chat" @click="wa.menuFor = ''"><p v-if="!waMessages.length" class="wx-note">No messages yet. Start with a template.</p>
										<template v-for="d in waDays" :key="d.key"><div class="wx-day"><span>{{ d.label }}</span></div>
											<div v-for="(m, mi) in d.items" :key="m.name" class="wx-row" :class="[m.type === 'Incoming' ? 'in' : 'out', grouped(d, mi) ? 'cont' : 'first']"><div class="wx-bub" :class="{ reacted: m.reaction }">
												<button v-if="lead.can_write && data.whatsapp.window_open" type="button" class="wx-more" aria-label="Message options" @click.stop="wa.menuFor = wa.menuFor === m.name ? '' : m.name"><Ico name="chevron-down" size="sm" /></button>
												<div v-if="wa.menuFor === m.name" class="wx-menu" @click.stop><div class="wx-react"><button v-for="x in REACTS" :key="x" type="button" :class="{ on: m.reaction === x }" :aria-label="'React ' + x" @click="react(m, x)">{{ x }}</button></div><button type="button" @click="startReply(m)"><Ico name="arrow-left" size="sm" /> Reply</button><button type="button" @click="copyText(m)"><Ico name="copy" size="sm" /> Copy</button></div>
												<div v-if="m.is_reply && m.reply_message" class="wx-quote"><b>{{ m.reply_to_from || 'Message' }}</b><span>{{ m.reply_message }}</span></div>
												<template v-if="mediaOf(m) === 'image'"><a :href="m.attach" target="_blank" rel="noopener"><img class="wx-img" :src="m.attach" alt="Image" loading="lazy" /></a></template>
												<video v-else-if="mediaOf(m) === 'video'" class="wx-img" :src="m.attach" controls preload="metadata"></video>
												<audio v-else-if="mediaOf(m) === 'audio'" :src="m.attach" controls preload="metadata"></audio>
												<a v-else-if="mediaOf(m) === 'document'" class="wx-doc" :href="m.attach" target="_blank" rel="noopener"><Ico name="file" /><span class="ellipsis">{{ fileName(m.attach) }}</span><Ico name="download" size="sm" /></a>
												<div v-if="m.template_name && m.header" class="wx-text"><b>{{ m.header }}</b></div>
												<div v-if="bubbleText(m)" class="wx-text">{{ bubbleText(m) }}</div>
												<div v-if="m.template_name && m.footer" class="wx-foot-t">{{ m.footer }}</div>
												<div class="wx-meta">{{ clock(m.creation) }}<template v-if="m.type !== 'Incoming'"><svg v-if="tick(m) === 'failed'" class="wx-tick failed" viewBox="0 0 16 16" width="14" height="14" aria-label="Failed"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.5v4.2M8 10.8v.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg><svg v-else class="wx-tick" :class="tick(m)" viewBox="0 0 17 11" width="17" height="11" :aria-label="tick(m)"><path d="M1 5.8 4.2 9 10.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /><path v-if="tick(m) !== 'sent'" d="M6 8.6 6.6 9 13 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></template></div>
												<span v-if="m.reaction" class="wx-reaction">{{ m.reaction }}</span></div></div></template></div>
									<div v-if="!lead.mobile_no" class="wx-lock">Add a phone number to message this lead.</div>
									<div v-else-if="!data.whatsapp.window_open" class="wx-lock"><div><b>Send a template first.</b> The lead has not written in the last 24 hours, so WhatsApp only allows an approved template. Once they reply, you can chat freely here.</div><Btn v-if="lead.can_write" variant="primary" icon="send" @click="waTemplate">Send a template</Btn></div>
									<form v-else-if="lead.can_write" class="wx-compose" @submit.prevent="sendWa()">
										<div v-if="wa.reply" class="wx-replybar"><div class="wx-quote grow"><b>{{ wa.reply.type === 'Incoming' ? (wa.reply.from_name || 'Lead') : 'You' }}</b><span>{{ bubbleText(wa.reply) || 'Attachment' }}</span></div><button type="button" class="wx-ib" aria-label="Cancel reply" @click="wa.reply = null"><Ico name="x" size="sm" /></button></div>
										<div v-if="wa.pending" class="wx-replybar"><Ico :name="wa.pending.type === 'image' ? 'image' : 'file'" /><span class="grow ellipsis">{{ wa.pending.name }} <span class="small muted">goes with this message</span></span><button type="button" class="wx-ib" aria-label="Remove attachment" @click="wa.pending = null"><Ico name="x" size="sm" /></button></div>
										<div v-if="wa.emoji" class="wx-emoji"><div class="wx-etabs"><button v-for="t in EMOJI_TABS" :key="t" type="button" :class="{ on: wa.cat === t }" :aria-label="'Emoji group ' + t" @click="wa.cat = t">{{ t }}</button></div><div class="wx-egrid"><button v-for="x in EMOJI[wa.cat]" :key="x" type="button" :aria-label="'Emoji ' + x" @click="addEmoji(x)">{{ x }}</button></div></div>
										<div v-if="wa.menu" class="wx-attach"><button type="button" @click="pics.click()"><Ico name="image" /> Image</button><button type="button" @click="vids.click()"><Ico name="play" /> Video</button><button type="button" @click="docs.click()"><Ico name="file" /> Document</button></div>
										<div v-if="slash.length || (wa.text === '/' && !wa.replies.length)" class="wx-slash" role="listbox" aria-label="Saved replies"><button v-for="(r, i) in slash" :key="r.title" type="button" role="option" :class="{ on: i === wa.hi }" :aria-selected="String(i === wa.hi)" @mousedown.prevent="useReply(r)" @mouseenter="wa.hi = i"><b>{{ r.title }}</b><span class="ellipsis">{{ r.text }}</span></button><p v-if="!slash.length" class="small muted" style="margin:6px 10px">No saved replies yet. Add them under Campaigns, WhatsApp templates, Saved replies.</p></div>
										<button type="button" class="wx-ib" aria-label="Emoji" title="Emoji" @click="wa.emoji = !wa.emoji; wa.menu = false">😊</button>
										<button type="button" class="wx-ib" aria-label="Attach an image, video or document" title="Attach" :disabled="wa.busy" @click="wa.menu = !wa.menu; wa.emoji = false"><Ico name="paperclip" /></button>
										<button type="button" class="wx-ib" aria-label="Saved replies" title="Saved replies (or type /)" @click="wa.text = '/'; wa.emoji = false; wa.menu = false"><Ico name="zap" /></button>
										<input ref="pics" type="file" hidden accept="image/*" @change="pickFile" /><input ref="vids" type="file" hidden accept="video/*" @change="pickFile" /><input ref="docs" type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,audio/*" @change="pickFile" />
										<input class="wx-in" v-model="wa.text" placeholder="Type a message, or / for saved replies" aria-label="WhatsApp message" @keydown="onKeys" @focus="wa.emoji = false" />
										<button type="submit" class="wx-send" aria-label="Send" :disabled="wa.busy || (!wa.text.trim() && !wa.pending) || (wa.text.startsWith('/') && slash.length > 0)"><Ico name="send" /></button>
									</form>
								</div>
							</template>
						</section>
					</div>

					<aside class="lead-side">
						<section v-for="(s, i) in lead.side_panel" :key="'sp' + i" class="card"><h3>{{ s.label || 'Details' }}</h3>
							<div class="facts one"><Fact v-for="f in s.fields" :key="f.fieldname" :label="f.label" :value="f.display" /></div>
						</section>
						<section class="card"><h3>Added</h3><div class="facts one"><Fact label="Added on" :value="day(lead.creation)" /><Fact label="Added by" :value="lead.created_by && lead.created_by.full_name" /></div></section>
						<section class="card"><h3>Follow-up</h3>
							<div class="facts one"><Fact label="Next follow-up"><span :class="{ overdue: overdue(lead.next_follow_up_on) }">{{ day(lead.next_follow_up_on) || '-' }}</span></Fact><Fact label="Next meeting" :value="day(lead.next_meeting_on)" /><Fact label="Last call" :value="lead.addons_last_outcome" /><Fact label="Call attempts" :value="lead.addons_call_attempts" /><Fact label="Score" :value="lead.addons_score" /></div>
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
					<div class="row" style="gap:8px;margin-bottom:12px"><Btn size="sm" icon="file-text" @click="openTemplates">{{ em.tpl ? 'Change template' : 'Use a template' }}</Btn><span v-if="em.tpl" class="small muted">Started from: {{ (((em.info && em.info.templates) || []).find((t) => t.name === em.tpl) || {}).label }}</span></div>
					<Field label="To"><div class="row" style="gap:8px"><div class="grow"><Inp v-model="em.v.recipients" aria-label="To" /></div><button v-if="!em.cc" type="button" class="btn ghost sm" @click="em.cc = true">CC</button><button v-if="!em.bcc" type="button" class="btn ghost sm" @click="em.bcc = true">BCC</button></div></Field>
					<Field v-if="em.cc" label="CC"><Inp v-model="em.v.cc" placeholder="Separate addresses with commas" aria-label="CC" /></Field>
					<Field v-if="em.bcc" label="BCC"><Inp v-model="em.v.bcc" placeholder="Separate addresses with commas" aria-label="BCC" /></Field>
					<Field label="Subject"><Inp v-model="em.v.subject" aria-label="Subject" /></Field>
					<Field label="Message"><RichEditor v-model="em.v.content" placeholder="Write your message" :min-height="200" /></Field>
					<div class="row wrap" style="gap:8px"><label class="btn sm" :class="{ disabled: em.upBusy }"><Ico name="paperclip" size="sm" /> Attach files<input type="file" multiple hidden @change="attach" /></label>
						<span v-for="f in em.files" :key="f.name" class="chip-file"><Ico name="file" size="sm" /> {{ f.file_name }}<button type="button" class="btn ghost icon sm" :aria-label="'Remove ' + f.file_name" @click="em.files = em.files.filter((x) => x !== f)"><Ico name="x" size="sm" /></button></span></div>
					<div v-if="em.error" class="err" role="alert" style="margin-top:8px">{{ em.error }}</div>
					<template #foot><Btn @click="em.open = false">Cancel</Btn><Btn variant="primary" icon="send" :loading="em.busy" :disabled="em.loading || em.upBusy" @click="sendEmail">Send</Btn></template>
				</Modal>
				<Modal v-if="wt.open" title="WhatsApp templates" size="xl" @close="wt.open = false">
					<Skel v-if="wt.loading" h="120" />
					<div v-else-if="wt.error && !wt.info" class="err" role="alert">{{ wt.error }}</div>
					<Empty v-else-if="!wt.info || !wt.info.installed" icon="whatsapp" title="WhatsApp is not set up" text="Install and connect the Frappe WhatsApp app first." />
					<Empty v-else-if="!wt.info.templates.length" icon="whatsapp" title="No approved templates yet" text="Create one under Campaigns, WhatsApp templates and wait for Meta to approve it." />
					<div v-else class="tpl-pick"><ul class="tpl-list" role="listbox" aria-label="Templates"><li v-for="t in wt.info.templates" :key="t.name"><button type="button" role="option" :aria-selected="String(wt.sel === t.name)" :class="{ on: wt.sel === t.name }" @click="wt.sel = t.name"><b class="ellipsis">{{ t.label }}</b><span class="small muted ellipsis">{{ t.body }}</span></button></li></ul>
						<div class="tpl-view"><div v-if="wtSel" class="wx-stage"><div class="wx-row out first"><div class="wx-bub"><div v-if="wtSel.header" class="wx-text"><b>{{ wtSel.header }}</b></div><div class="wx-text">{{ wtSel.body }}</div><div v-if="wtSel.footer" class="wx-foot-t">{{ wtSel.footer }}</div></div></div></div>
							<div v-if="wtSel && wtSel.missing.length" class="err" role="alert">This template has variables with no value set up, so it cannot be sent yet. Map them under Campaigns, WhatsApp templates.</div>
							<div v-if="wt.error" class="err" role="alert">{{ wt.error }}</div></div></div>
					<template #foot><Btn @click="wt.open = false">Cancel</Btn><Btn variant="primary" icon="send" :loading="wt.busy" :disabled="!wtSel || (wtSel && wtSel.missing.length > 0) || !(wt.info && wt.info.number)" @click="sendTemplate">Send to {{ wt.info && wt.info.number }}</Btn></template>
				</Modal>
				<Modal v-if="em.pick" title="Email templates" size="xl" @close="em.pick = false">
					<div v-if="em.info && em.info.problem" class="err" role="alert" style="margin-bottom:10px">{{ em.info.problem }}</div>
					<Skel v-if="em.loading" h="120" />
					<Empty v-else-if="!em.info || !em.info.templates.length" icon="mail" title="No email templates yet" text="Create them under Campaigns, Email templates." />
					<div v-else class="tpl-pick"><ul class="tpl-list" role="listbox" aria-label="Templates"><li v-for="t in em.info.templates" :key="t.name"><button type="button" role="option" :aria-selected="String(em.sel === t.name)" :class="{ on: em.sel === t.name }" @click="em.sel = t.name"><b class="ellipsis">{{ t.label }}</b><span class="small muted ellipsis">{{ t.subject }}</span></button></li></ul>
						<div class="tpl-view"><template v-if="selTemplate"><div class="tpl-sub"><span class="small muted">Subject</span><b>{{ selTemplate.subject || '(no subject)' }}</b></div><iframe class="tpl-frame" sandbox="" :srcdoc="selTemplate.body" :title="'Preview of ' + selTemplate.label"></iframe></template></div></div>
					<template #foot><Btn @click="em.pick = false">Cancel</Btn><Btn variant="primary" icon="check" :disabled="!selTemplate" @click="useTemplate(selTemplate)">Use this template</Btn></template>
				</Modal>
			</template>
		</div>`,
	}
})()
