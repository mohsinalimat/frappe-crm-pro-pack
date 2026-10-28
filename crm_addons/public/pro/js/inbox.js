/* Suite Pro: the WhatsApp inbox. Every chat in one place: leads' chats and numbers that are not leads yet, shaped like WhatsApp Web.
   Who sees what is decided on the server (Team, WhatsApp inbox): own chats, or all of them and assigning. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.inbox.' + m, a)
	const ago = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); if (isNaN(d)) return ''; const t = new Date(); if (d.toDateString() === t.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); const y = new Date(t); y.setDate(t.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) }

	V.Inbox = {
		setup() {
			const acc = ref(null); const list = reactive({ rows: [], total: 0, page: 1, loading: true, view: 'all', q: '', more: false })
			const cur = ref(CM.route.parts[1] || ''); const chat = ref(null); const chatErr = ref(''); const chatLoading = ref(false)
			const VIEWS = computed(() => [['all', 'All'], ['unread', 'Unread'], ['new', 'New contacts'], ...(acc.value && acc.value.manager ? [['unassigned', 'Unassigned']] : []), ['notlead', 'Not a lead']])
			let tQ = null, seq = 0
			async function loadList(quiet) {
				const my = ++seq; if (!quiet) list.loading = true
				try { const r = await call('list_chats', { view: list.view, search: list.q || undefined, page: 1, page_size: 40 * list.page }); if (my === seq) { list.rows = r.rows; list.total = r.total; list.more = r.rows.length < r.total } } catch (e) { if (!quiet) CM.toast(e.message, 'err') } finally { if (my === seq) list.loading = false }
			}
			async function loadAcc() { try { acc.value = await call('get_access'); PRO.shell.waUnread = acc.value.unread } catch (e) { acc.value = { level: 'none', unread: 0 } } }
			async function openChat(key, quiet) {
				cur.value = key; if (!quiet) { chatLoading.value = true; chatErr.value = '' }
				try { chat.value = await call('get_chat', { key }); await Promise.all([loadAcc(), loadList(true)]) } catch (e) { chatErr.value = e.message; if (!quiet) chat.value = null } finally { chatLoading.value = false }
			}
			watch(() => [list.view], () => { list.page = 1; loadList() }); watch(() => list.q, () => { clearTimeout(tQ); tQ = setTimeout(() => { list.page = 1; loadList() }, 300) })
			watch(() => CM.route.parts[1], (k) => { if (k && k !== cur.value) openChat(k) })
			let poll = null
			onMounted(async () => { await loadAcc(); if (acc.value.level !== 'none') { await loadList(); if (cur.value) openChat(cur.value) } else list.loading = false; poll = setInterval(() => { if (document.hidden || !acc.value || acc.value.level === 'none') return; loadAcc(); loadList(true); if (cur.value && chat.value && !busy.value) openChat(cur.value, true) }, 10000) })
			onBeforeUnmount(() => clearInterval(poll))
			const busy = ref(false)
			// the chat's own calls
			const sendWa = async (p) => { await call('send', { key: cur.value, message: p.text, attach: p.attach, content_type: p.type, reply_to: p.replyTo }); await openChat(cur.value, true) }
			const reactWa = async (m, emoji) => { await call('react', { key: cur.value, message: m.name, emoji }); await openChat(cur.value, true) }
			// templates
			const tp = reactive({ open: false, loading: false, info: null, sel: '', vals: {}, busy: false, error: '' })
			const tpSel = computed(() => (tp.info && tp.info.templates.find((t) => t.name === tp.sel)) || null)
			const preview = computed(() => { const t = tpSel.value; if (!t) return ''; return t.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => tp.vals[n] || m) })
			async function openTpl() {
				Object.assign(tp, { open: true, error: '', vals: {} }); tp.loading = true
				try { tp.info = await call('templates', { key: cur.value }); tp.sel = tp.info.templates.length ? tp.info.templates[0].name : '' } catch (e) { tp.error = e.message } finally { tp.loading = false }
			}
			async function sendTpl() {
				tp.busy = true; tp.error = ''
				try { await call('send_template', { key: cur.value, template: tp.sel, values: JSON.stringify(tp.vals) }); tp.open = false; CM.toast('Template sent'); await openChat(cur.value, true) } catch (e) { tp.error = e.message } finally { tp.busy = false }
			}
			// turn a number into a lead
			const cl = reactive({ open: false, first: '', last: '', email: '', org: '', busy: false, error: '' })
			function openCreate() { const c = chat.value.chat; Object.assign(cl, { open: true, first: c.contact_name || '', last: '', email: '', org: '', error: '' }) }
			async function createLead() {
				cl.busy = true; cl.error = ''
				try { const r = await call('create_lead', { key: cur.value, first_name: cl.first, last_name: cl.last, email: cl.email, organization: cl.org }); cl.open = false; CM.toast('Lead created. The chat is on it now.'); await openChat(cur.value, true) } catch (e) { cl.error = e.message } finally { cl.busy = false }
			}
			const lk = reactive({ open: false, q: '', rows: [], busy: false }); let tL = null
			async function findLeads() { try { lk.rows = await call('search_leads', { txt: lk.q }) } catch (e) { lk.rows = [] } }
			watch(() => lk.q, () => { clearTimeout(tL); tL = setTimeout(findLeads, 250) })
			function openLink() { Object.assign(lk, { open: true, q: '', rows: [] }); findLeads() }
			async function linkTo(l) { lk.busy = true; try { await call('link_lead', { key: cur.value, lead: l.name }); lk.open = false; CM.toast('Linked to ' + (l.lead_name || l.name)); await openChat(cur.value, true) } catch (e) { CM.toast(e.message, 'err') } finally { lk.busy = false } }
			async function notALead(on) { try { await call('set_status', { key: cur.value, status: on ? 'Not a lead' : 'Open' }); CM.toast(on ? 'Marked as not a lead' : 'Back in the inbox'); await openChat(cur.value, true) } catch (e) { CM.toast(e.message, 'err') } }
			const users = ref([]); const asg = ref(false)
			async function openAssign() { asg.value = !asg.value; if (asg.value && !users.value.length) { try { users.value = await call('assignable_users') } catch (e) { CM.toast(e.message, 'err') } } }
			async function assignTo(u) { asg.value = false; try { await call('assign', { key: cur.value, user: u }); CM.toast(u ? 'Assigned' : 'Back to unassigned'); await openChat(cur.value, true) } catch (e) { CM.toast(e.message, 'err') } }
			const back = () => { cur.value = ''; chat.value = null }
			return { acc, list, cur, chat, chatErr, chatLoading, VIEWS, openChat, sendWa, reactWa, tp, tpSel, preview, openTpl, sendTpl, cl, openCreate, createLead, lk, openLink, linkTo, notALead, users, asg, openAssign, assignTo, back, ago, PRO, CM, loadList }
		},
		template: `
		<div class="wi-page">
			<div v-if="acc && acc.level === 'none'" class="page"><Empty icon="whatsapp" title="No access to the WhatsApp inbox" text="Ask an administrator to give you access under Team." /></div>
			<div v-else class="wi-in" :class="{ chatting: !!cur }">
				<aside class="wi-list" aria-label="Chats">
					<div class="wi-lh"><h1>WhatsApp</h1><span v-if="acc && acc.unread" class="pro-badge">{{ acc.unread }}</span></div>
					<div class="wi-search"><Inp v-model="list.q" icon="search" placeholder="Search a name, number or message" clearable aria-label="Search chats" /></div>
					<div class="wi-chips"><button v-for="v in VIEWS" :key="v[0]" type="button" class="fchip" :class="{ on: list.view === v[0] }" @click="list.view = v[0]">{{ v[1] }}</button></div>
					<div class="wi-rows">
						<template v-if="list.loading"><Skel v-for="i in 6" :key="i" h="58" r="8" style="margin:6px 10px" /></template>
						<Empty v-else-if="!list.rows.length" icon="whatsapp" title="No chats" :text="list.view === 'all' && !list.q ? 'Chats appear here when someone messages you or you message a lead.' : 'Nothing matches.'" />
						<template v-else>
							<button v-for="r in list.rows" :key="r.name" type="button" class="wi-row" :class="{ on: cur === r.name }" @click="openChat(r.name)">
								<Pic :name="r.title" :size="42" />
								<span class="wi-mid"><span class="wi-top"><b class="ellipsis">{{ r.title }}</b><span class="wi-time" :class="{ hot: r.unread }">{{ ago(r.last_at) }}</span></span>
									<span class="wi-bot"><span class="ellipsis wi-last"><template v-if="r.last_direction === 'Outgoing'">You: </template>{{ r.last_message }}</span><span v-if="r.unread" class="wi-un">{{ r.unread }}</span></span>
									<span class="wi-tags"><span v-if="!r.lead" class="wi-tag new">New contact</span><span v-else class="wi-tag">Lead</span><span class="wi-tag who">{{ r.owner ? r.owner_name : 'Unassigned' }}</span></span></span>
							</button>
							<button v-if="list.more" type="button" class="wi-more-btn" @click="list.page++; loadList()">Show more</button>
						</template>
					</div>
				</aside>
				<section class="wi-pane">
					<div v-if="!cur" class="wi-blank"><Ico name="whatsapp" size="lg" /><b>WhatsApp inbox</b><span>Pick a chat on the left. New numbers show up here too, so you can turn them into leads.</span></div>
					<div v-else-if="chatLoading" class="wi-blank"><Skel h="300" r="12" style="width:80%" /></div>
					<div v-else-if="!chat" class="wi-blank"><Ico name="alert" size="lg" /><b>Could not open this chat</b><span>{{ chatErr }}</span><Btn @click="back">Back</Btn></div>
					<template v-else>
						<div v-if="!chat.chat.lead" class="wi-banner">
							<div class="grow"><b>{{ chat.chat.status === 'Not a lead' ? 'Marked as not a lead' : 'Not in your CRM yet' }}</b><div class="small">{{ chat.chat.number }} is not a lead. <template v-if="chat.chat.assigned_to">Assigned to {{ (users.find((u) => u.value === chat.chat.assigned_to) || {}).label || chat.chat.assigned_to }}.</template><template v-else>Nobody has picked this number up yet.</template></div></div>
							<div class="wi-acts">
								<Btn v-if="chat.can_write && chat.chat.status !== 'Not a lead'" variant="primary" icon="plus" size="sm" @click="openCreate">Create lead</Btn>
								<Btn v-if="chat.can_write" size="sm" icon="link" @click="openLink">Link to a lead</Btn>
								<Btn v-if="chat.can_write && chat.chat.status !== 'Not a lead'" size="sm" icon="x" @click="notALead(true)">Not a lead</Btn>
								<Btn v-if="chat.chat.status === 'Not a lead'" size="sm" @click="notALead(false)">Move back to inbox</Btn>
								<span v-if="chat.manager" class="wi-asg"><Btn size="sm" icon="users" @click="openAssign">{{ chat.chat.assigned_to ? 'Reassign' : 'Assign' }}</Btn>
									<div v-if="asg" class="wi-asg-menu"><button v-for="u in users" :key="u.value" type="button" @click="assignTo(u.value)">{{ u.label }}</button><button v-if="chat.chat.assigned_to" type="button" class="muted" @click="assignTo('')">Unassign</button></div></span>
							</div>
						</div>
						<WaChat class="wi-chat" :messages="chat.messages" :window-open="chat.window_open" :window-until="chat.window_until" :can-write="chat.can_write" :can-template="chat.can_write" :title="chat.chat.title" :subtitle="chat.chat.number" person="Contact" :send="sendWa" :react="reactWa" @template="openTpl">
							<template #head><button type="button" class="wx-tpl wi-back" @click="back"><Ico name="arrow-left" size="sm" /> Chats</button><a v-if="chat.chat.lead" class="wx-tpl" :href="CM.leadUrl(chat.chat.lead.name)">Open lead</a><a class="wx-tpl" :href="'#/whatsapp/' + cur" target="_blank" rel="noopener" title="Open this chat in a new tab"><Ico name="external-link" size="sm" /></a></template>
						</WaChat>
					</template>
				</section>
			</div>
			<Modal v-if="tp.open" title="Send a template" size="xl" @close="tp.open = false">
				<Skel v-if="tp.loading" h="120" />
				<div v-else-if="tp.error && !tp.info" class="err" role="alert">{{ tp.error }}</div>
				<Empty v-else-if="!tp.info.templates.length" icon="whatsapp" title="No usable templates" text="Approved templates without an image or document header appear here." />
				<div v-else class="tpl-pick"><ul class="tpl-list" role="listbox" aria-label="Templates"><li v-for="t in tp.info.templates" :key="t.name" role="option" :aria-selected="String(tp.sel === t.name)" :class="{ on: tp.sel === t.name }" tabindex="0" @click="tp.sel = t.name; tp.vals = {}" @keydown.enter="tp.sel = t.name; tp.vals = {}"><b>{{ t.label }}</b></li></ul>
					<div class="tpl-view"><div v-if="tpSel"><div v-for="v in tpSel.variables" :key="v" class="field" style="margin-bottom:8px"><label>Variable {{ v }}</label><input class="inp" v-model="tp.vals[v]" /></div>
						<div class="wx-stage"><div class="wx-row out first"><div class="wx-bub"><div class="wx-text">{{ preview }}</div></div></div></div></div>
						<div v-if="tp.error" class="err" role="alert">{{ tp.error }}</div></div></div>
				<template #foot><Btn @click="tp.open = false">Cancel</Btn><Btn variant="primary" icon="send" :loading="tp.busy" :disabled="!tpSel" @click="sendTpl">Send</Btn></template>
			</Modal>
			<Modal v-if="cl.open" title="Create a lead from this number" size="md" @close="cl.open = false">
				<p class="small muted" style="margin:0 0 10px">Source is WhatsApp and the phone is {{ chat && chat.chat.number }}. The whole chat moves onto the lead.</p>
				<div class="row wrap" style="gap:12px"><Field label="First name" required class="grow"><Inp v-model="cl.first" /></Field><Field label="Last name" class="grow"><Inp v-model="cl.last" /></Field></div>
				<Field label="Email"><Inp v-model="cl.email" /></Field><Field label="Organization"><Inp v-model="cl.org" /></Field>
				<div v-if="cl.error" class="err" role="alert">{{ cl.error }}</div>
				<template #foot><Btn @click="cl.open = false">Cancel</Btn><Btn variant="primary" :loading="cl.busy" :disabled="!cl.first.trim()" @click="createLead">Create lead</Btn></template>
			</Modal>
			<Modal v-if="lk.open" title="Link to an existing lead" size="md" @close="lk.open = false">
				<Inp v-model="lk.q" icon="search" placeholder="Search a lead by name, email or phone" aria-label="Search leads" />
				<ul class="list" style="margin-top:10px"><li v-for="l in lk.rows" :key="l.name" class="li row" style="gap:10px;cursor:pointer" @click="linkTo(l)"><Pic :name="l.lead_name || l.name" :size="30" /><div class="grow"><b>{{ l.lead_name || l.name }}</b><div class="small muted">{{ l.mobile_no || l.email || l.name }}</div></div></li><li v-if="!lk.rows.length" class="small muted" style="padding:10px">No lead found.</li></ul>
				<template #foot><Btn @click="lk.open = false">Cancel</Btn></template>
			</Modal>
		</div>`,
	}
})()
