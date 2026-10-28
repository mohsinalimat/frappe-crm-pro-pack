/* Suite Pro: Settings, Integrations. The email senders (Gmail, Amazon SES, and what the site already has) and the WhatsApp account in one place.
   Only an administrator sees it. Passwords are typed once and never shown again. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.integrations.' + m, a)
	const NAME = { gmail: 'Gmail', ses: 'Amazon SES', outlook: 'Outlook.com', microsoft365: 'Microsoft 365', yahoo: 'Yahoo Mail', yandex: 'Yandex Mail', sendgrid: 'SendGrid', sparkpost: 'SparkPost', other: 'Email (SMTP)' }
	// what each provider asks for. key: password = a password or API key; receive = can also bring replies in
	const PROV = [
		{ key: 'gmail', blurb: 'Send and receive. About 2,000 emails a day.', pw: 'App password', pwHint: '16 letters from Google Account, Security, 2-Step Verification, App passwords.', receive: true },
		{ key: 'ses', blurb: 'Bulk sending, pennies per thousand. Send only.' },
		{ key: 'outlook', blurb: 'Outlook.com and Hotmail. Use an app password.', pw: 'App password', pwHint: 'Microsoft account, Security, App passwords.', receive: true },
		{ key: 'microsoft365', blurb: 'Work and school accounts. Send and receive.', pw: 'Password or app password', pwHint: 'Your administrator must allow SMTP sign-in (SMTP AUTH) for the mailbox.', receive: true },
		{ key: 'yahoo', blurb: 'Send and receive. Use an app password.', pw: 'App password', pwHint: 'Yahoo Account Security, Generate app password.', receive: true },
		{ key: 'yandex', blurb: 'Send and receive. Use an app password.', pw: 'App password', pwHint: 'Yandex ID, Security, App passwords.', receive: true },
		{ key: 'sendgrid', blurb: 'Bulk sending with its own delivery stats. Send only.', pw: 'API key', pwHint: 'A SendGrid API key with Mail Send permission. The user name apikey is filled in for you.' },
		{ key: 'sparkpost', blurb: 'Bulk sending. Send only.', pw: 'API key', pwHint: 'A SparkPost API key with Send via SMTP permission.' },
		{ key: 'smtp', blurb: 'Any other mail server: Zoho, Mailgun, Brevo, your own.', pw: 'Password', pwHint: 'The password or API key of the mail server.', custom: true, receive: true },
	]
	const BRAND = { gmail: ['#fff', 'M4 7l8 6 8-6v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M4 7l8 6 8-6 M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1', '#EA4335'], ses: ['#FF9900', 'M5 8l7 5 7-5 M5 8v9h14V8z M5 8h14', '#fff'], outlook: ['#0A64AD', 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', '#fff'], microsoft365: ['#D83B01', 'M5 5h6v6H5z M13 5h6v6h-6z M5 13h6v6H5z M13 13h6v6h-6z', '#fff'], yahoo: ['#6001D2', 'M6 6l6 8 6-8 M12 14v5', '#fff'], yandex: ['#FC3F1D', 'M13.5 19V6.5h-1.7c-2 0-3.3 1-3.3 2.8 0 1.6.8 2.4 2.2 3.3l1.4.9L8.4 19 M13.5 12.6l2.5 6.4', '#fff'], sendgrid: ['#1A82E2', 'M5 5h5v5H5z M14 5h5v5h-5z M10 10h4v4h-4z M5 14h5v5H5z M14 14h5v5h-5z', '#fff'], sparkpost: ['#FA6423', 'M13 3L6 13h5l-1 8 8-11h-5z', '#fff'], other: ['#475569', 'M4 7l8 6 8-6 M4 7v10h16V7z M4 7h16', '#fff'] }
	// a small tile in the provider's colour with a simple glyph (a drawing, not the registered logo)
	V.BrandIcon = {
		props: { name: String, size: { type: Number, default: 38 } },
		setup(props) { const b = computed(() => BRAND[props.name === 'smtp' ? 'other' : props.name] || BRAND.other); return { b } },
		template: `<span class="it-brand" :style="{ width: size + 'px', height: size + 'px', background: b[0] }"><svg viewBox="0 0 24 24" :width="size * 0.6" :height="size * 0.6" fill="none" :stroke="b[2]" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="b[1]" :fill="name === 'gmail' ? '#fff' : name === 'sparkpost' || name === 'microsoft365' || name === 'sendgrid' ? b[2] : 'none'" /></svg></span>`,
	}
	const STATS = [['sent', 'Sent', 'green'], ['waiting', 'Not sent yet', 'amber'], ['failed', 'Failed', 'red'], ['read', 'Read', 'blue'], ['not_read', 'Not read', '']]

	const WSTATS = [['sent', 'Sent', 'green'], ['delivered', 'Delivered', 'blue'], ['read', 'Read', 'blue'], ['not_read', 'Delivered, not read', ''], ['failed', 'Failed', 'red']]

	V.Integrations = {
		props: { part: { type: String, default: 'email' } },
		setup(props) {
			const loading = ref(true); const error = ref(''); const d = ref({ email: [], whatsapp: { installed: false, accounts: [] }, regions: [], ses: {}, limits: {} })
			const dlg = ref(''); const busy = ref(false); const f = reactive({ email_id: '', region: 'ap-south-1', smtp_user: '', smtp_password: '', app_password: '', receive: true, use: false, server: '', port: '587', security: 'TLS', login: '', imap: '', imap_port: '993' })
			const pw = ref(''); const remove = ref(null); const newPw = ref(null); const guide = ref('')
			const SUBS = { email: [['logs', 'Email logs', 'mail'], ['connection', 'Email connection', 'plug']], whatsapp: [['logs', 'WhatsApp logs', 'whatsapp'], ['connection', 'WhatsApp connection', 'plug']], calendar: [['logs', 'Meeting logs', 'calendar'], ['connection', 'Calendar connection', 'plug']] }
			const sub = ref(CM.store.get('int-sub-' + props.part) === 'connection' ? 'connection' : 'logs'); watch(sub, (v) => { CM.store.set('int-sub-' + props.part, v); if (v === 'logs') loadLogs() })
			const ESTATES = [['Sent', 'green', 'Sent'], ['Read', 'blue', 'Read'], ['Waiting', 'amber', 'Not sent yet'], ['Bounced', 'red', 'Bounced'], ['Soft bounce', 'amber', 'Soft bounce'], ['Failed', 'red', 'Failed']]
			const WSTATES = [['Sent', 'green', 'Sent'], ['Delivered', 'blue', 'Delivered'], ['Read', 'blue', 'Read'], ['Waiting', 'amber', 'Waiting'], ['Failed', 'red', 'Failed'], ['Received', '', 'Received']]
			const el = reactive({ rows: [], total: 0, counts: {}, accounts: [], loading: false, status: '', account: '', q: '', page: 1 }); const wl = reactive({ rows: [], total: 0, counts: {}, accounts: [], loading: false, status: '', account: '', q: '', page: 1 })
			let tE = null, tW = null, sE = 0, sW = 0
			async function loadEmail(quiet) { const my = ++sE; if (!quiet) el.loading = true; try { const r = await call('get_email_log', { page: el.page, page_size: 25, status: el.status || undefined, account: el.account || undefined, search: el.q || undefined }); if (my === sE) Object.assign(el, r) } catch (e) { CM.toast(e.message, 'err') } finally { if (my === sE) el.loading = false } }
			async function loadWa(quiet) { const my = ++sW; if (!quiet) wl.loading = true; try { const r = await call('get_whatsapp_log', { page: wl.page, page_size: 25, status: wl.status || undefined, account: wl.account || undefined, search: wl.q || undefined }); if (my === sW) Object.assign(wl, r) } catch (e) { CM.toast(e.message, 'err') } finally { if (my === sW) wl.loading = false } }
			watch(() => [el.status, el.account], () => { el.page = 1; loadEmail() }); watch(() => el.page, () => loadEmail()); watch(() => el.q, () => { clearTimeout(tE); tE = setTimeout(() => { el.page = 1; loadEmail() }, 300) })
			watch(() => [wl.status, wl.account], () => { wl.page = 1; loadWa() }); watch(() => wl.page, () => loadWa()); watch(() => wl.q, () => { clearTimeout(tW); tW = setTimeout(() => { wl.page = 1; loadWa() }, 300) })
			const cal = ref(null); const cl = reactive({ rows: [], total: 0, loading: false, status: '', q: '', page: 1 }); let tC = null, sC = 0, cTest = ref(null)
			const loadLogs = () => (props.part === 'email' ? loadEmail() : props.part === 'whatsapp' ? loadWa() : loadCal())
			async function loadCal(quiet) { const my = ++sC; if (!quiet) cl.loading = true; try { const [o, r] = await Promise.all([call('get_calendar'), call('get_calendar_log', { page: cl.page, page_size: 25, status: cl.status || undefined, search: cl.q || undefined })]); if (my === sC) { cal.value = o; Object.assign(cl, r) } } catch (e) { CM.toast(e.message, 'err') } finally { if (my === sC) cl.loading = false } }
			watch(() => cl.status, () => { cl.page = 1; loadCal() }); watch(() => cl.page, () => loadCal()); watch(() => cl.q, () => { clearTimeout(tC); tC = setTimeout(() => { cl.page = 1; loadCal() }, 300) })
			const retryMeeting = async (r) => { working.value = 'm' + r.name; try { const o = await call('retry_meeting', { name: r.name }); if (o.status === 'Synced') CM.toast('Synced to the calendar'); else CM.toast(o.error || 'Still not synced', 'err'); await loadCal(true) } catch (e) { CM.toast(e.message, 'err') } finally { working.value = '' } }
			async function testCal() { cTest.value = { busy: true }; try { cTest.value = await CM.call('crm_addons.api.test_google_connection') } catch (e) { cTest.value = { ok: false, message: e.message } } }
			const gf = reactive({ client_id: '', client_secret: '', calendar_name: 'CRM Meetings', show: false }); const gdisc = ref(false)
			async function connectGoogle() { busy.value = true; try { const r = await call('connect_google', { client_id: gf.client_id, client_secret: gf.client_secret, calendar_name: gf.calendar_name }); window.location.href = r.url } catch (e) { CM.toast(e.message, 'err'); busy.value = false } }
			async function disconnectGoogle() { busy.value = true; try { await call('disconnect_google'); CM.toast('Google Calendar disconnected'); gdisc.value = false; cTest.value = null; await loadCal(true) } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false } }
			watch(cal, (c, old) => { if (c && !old) { gf.client_id = c.client_id || ''; if (c.result) { if (c.result === 'ok') CM.toast('Google Calendar connected'); else CM.toast(c.result, 'err'); sub.value = 'connection' } } })
			const ctone = (s) => ({ Synced: 'green', Failed: 'red', 'Not synced': 'amber' }[s] || '')
			onMounted(() => { if (sub.value === 'logs') loadLogs(); if (props.part === 'calendar') loadCal() })
			const retryEmail = async (r) => { working.value = 'e' + r.name; try { await call('retry_email', { queue: r.name }); CM.toast('Queued to send again'); await loadEmail(true) } catch (e) { CM.toast(e.message, 'err') } finally { working.value = '' } }
			const etone = (s) => ({ Sent: 'green', Read: 'blue', Waiting: 'amber', Bounced: 'red', 'Soft bounce': 'amber', Failed: 'red' }[s] || '')
			const wtone = (s) => ({ Sent: 'green', Delivered: 'blue', Read: 'blue', Waiting: 'amber', Failed: 'red', Received: '' }[s] || '')
			const working = ref(''); const res = reactive({}); const wd = ref(''); const wf = reactive({ name: '', account_name: '', phone_id: '', business_id: '', app_id: '', version: 'v21.0', token: '', send: false, recv: false }); const gone = ref(null)
			async function load() {
				try { d.value = await call('get_integrations'); error.value = '' } catch (e) { error.value = e.message } finally { loading.value = false }
			}
			onMounted(load)
			const sending = computed(() => d.value.email.find((a) => a.sending))
			const hasSes = computed(() => d.value.email.some((a) => a.kind === 'ses'))
			function open(kind) { Object.assign(f, { email_id: '', smtp_user: '', smtp_password: '', app_password: '', receive: true, use: !d.value.email.some((a) => a.sending), server: '', port: '587', security: 'TLS', login: '', imap: '', imap_port: '993' }); dlg.value = kind }
			const prov = computed(() => PROV.find((p) => p.key === dlg.value) || {})
			async function add() {
				busy.value = true
				try {
					if (dlg.value === 'ses') await call('add_ses', { email_id: f.email_id, region: f.region, smtp_user: f.smtp_user, smtp_password: f.smtp_password, use_for_sending: f.use ? 1 : 0 })
					else if (dlg.value !== 'gmail') await call('add_provider', { provider: dlg.value, email_id: f.email_id, password: f.app_password, receive: f.receive ? 1 : 0, use_for_sending: f.use ? 1 : 0, smtp_server: f.server, smtp_port: f.port, security: f.security, login_id: f.login, imap_server: f.imap, imap_port: f.imap_port })
					else await call('add_gmail', { email_id: f.email_id, app_password: f.app_password, receive: f.receive ? 1 : 0, use_for_sending: f.use ? 1 : 0 })
					CM.toast((NAME[dlg.value] || 'Email account') + ' connected'); dlg.value = ''; f.smtp_password = f.app_password = ''; await load()
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function use(a) {
				working.value = a.name
				try { await call('set_sending', { account: a.name }); CM.toast('Emails now go out from ' + a.email_id); await load() } catch (e) { CM.toast(e.message, 'err') } finally { working.value = '' }
			}
			async function test(a) {
				working.value = 't' + a.name
				try { const r = await call('send_test', { account: a.name }); CM.toast('Test email sent to ' + r.to) } catch (e) { CM.toast(e.message, 'err') } finally { working.value = '' }
			}
			async function testConn(a) {
				working.value = 'c' + a.name; delete res[a.name]
				try { res[a.name] = await call('test_email', { account: a.name }) } catch (e) { res[a.name] = { ok: false, message: e.message } } finally { working.value = '' }
			}
			function openWa(a) {
				if (a) Object.assign(wf, { name: a.name, account_name: a.title, phone_id: a.phone_id, business_id: a.business_id, app_id: a.app_id, version: a.version || 'v21.0', token: '' })
				else Object.assign(wf, { name: '', account_name: '', phone_id: '', business_id: '', app_id: '', version: 'v21.0', token: '', send: !d.value.whatsapp.accounts.some((w) => w.sending), recv: !d.value.whatsapp.accounts.some((w) => w.receiving) })
				wd.value = a ? 'edit' : 'add'
			}
			async function saveWa() {
				busy.value = true
				try {
					if (wd.value === 'add') {
						const r = await call('add_whatsapp', { account_name: wf.account_name, phone_id: wf.phone_id, business_id: wf.business_id, app_id: wf.app_id, version: wf.version, token: wf.token, use_for_sending: wf.send ? 1 : 0, use_for_receiving: wf.recv ? 1 : 0 })
						CM.toast('Connected ' + (r.verified_name || '') + ' ' + (r.number || '') + (r.subscribed ? '' : '. Replies need the webhook step below.'))
					} else { await call('update_whatsapp', { account: wf.name, account_name: wf.account_name, phone_id: wf.phone_id, business_id: wf.business_id, app_id: wf.app_id, version: wf.version, token: wf.token }); CM.toast('Saved') }
					wd.value = ''; wf.token = ''; await load()
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function setWa(w, what, v) {
				working.value = what + w.name
				try { await call('set_whatsapp', { account: w.name, what, value: v ? 1 : 0 }); await load() } catch (e) { CM.toast(e.message, 'err') } finally { working.value = '' }
			}
			async function testWa(w) {
				working.value = 'c' + w.name; delete res[w.name]
				try { res[w.name] = await call('test_whatsapp', { account: w.name }) } catch (e) { res[w.name] = { ok: false, message: e.message } } finally { working.value = '' }
			}
			async function disconnect() {
				const w = gone.value; busy.value = true
				try { const r = await call('disconnect_whatsapp', { account: w.name }); CM.toast(r.removed ? 'Disconnected' : 'Switched off. Its message history is kept.'); gone.value = null; await load() } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function removeAcc() {
				busy.value = true
				try { await call('remove_account', { account: remove.value.name }); CM.toast('Removed'); remove.value = null; await load() } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function savePw() {
				busy.value = true
				try { await call('update_password', { account: newPw.value.name, password: pw.value }); CM.toast('Saved. The login works.'); newPw.value = null; pw.value = ''; await load() } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function copy(text) { try { await navigator.clipboard.writeText(text); CM.toast('Copied') } catch (e) { CM.toast('Select the address and copy it', 'err') } }
			const when = (s) => (s ? CM.fmt(s) : '')
			const leadUrl = n => CM.leadUrl(n)
			return { gf, gdisc, connectGoogle, disconnectGoogle, cal, cl, loadCal, retryMeeting, testCal, cTest, ctone, leadUrl, guide, SUBS, sub, ESTATES, WSTATES, el, wl, loadEmail, loadWa, retryEmail, etone, wtone, PROV, prov, pw, remove, newPw, removeAcc, savePw, loading, error, d, dlg, f, busy, working, sending, hasSes, open, add, use, test, copy, NAME, STATS, when, res, testConn, wd, wf, gone, openWa, saveWa, setWa, testWa, disconnect, WSTATS }
		},
		template: `
		<div class="page it-page">
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<div class="row fs-kinds" style="margin-top:6px"><div class="fs-seg" role="tablist" :aria-label="part"><button v-for="t in SUBS[part]" :key="t[0]" type="button" role="tab" :class="{ on: sub === t[0] }" :aria-selected="sub === t[0]" @click="sub = t[0]"><Ico :name="t[2]" size="sm" />{{ t[1] }}</button></div></div>
				<section v-if="part === 'email' && sub === 'logs'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Email logs</b><div class="small muted">Every email the CRM sent: whether it went out, was read, bounced or failed, and why.</div></div><Btn icon="refresh" :loading="el.loading" @click="loadEmail()">Refresh</Btn></div>
					<div class="it-counts"><button v-for="k in ESTATES" :key="k[0]" type="button" class="it-cnt" :class="[k[1], { on: el.status === k[0] }]" @click="el.status = el.status === k[0] ? '' : k[0]"><b>{{ el.counts[k[0]] || 0 }}</b>{{ k[2] }}</button></div>
					<div class="row wrap" style="gap:10px;margin:12px 0"><div style="width:240px"><Dd v-model="el.account" :options="el.accounts" allow-empty="All accounts" placeholder="All accounts" aria-label="Account" /></div><div class="grow"></div><div style="width:240px"><Inp v-model="el.q" icon="search" placeholder="Search subject, address or lead" clearable aria-label="Search the email log" /></div></div>
					<Skel v-if="el.loading && !el.rows.length" h="40" />
					<Empty v-else-if="!el.rows.length" icon="mail" title="No emails" :text="el.status || el.account || el.q ? 'Nothing matches these filters.' : 'Emails the CRM sends will appear here.'" />
					<div v-else class="table-wrap"><table class="table"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>From</th><th>State</th></tr></thead><tbody>
						<tr v-for="r in el.rows" :key="r.name"><td class="nowrap">{{ when(r.creation) }}</td><td>{{ r.recipient }}<div v-if="r.reference_name" class="small muted"><a v-if="r.reference_doctype === 'CRM Lead'" class="mono" :href="leadUrl(r.reference_name)">{{ r.reference_name }}</a></div></td>
							<td class="ellipsis" style="max-width:260px" :title="r.subject">{{ r.subject }}</td><td class="small muted">{{ r.sender }}</td>
							<td><span class="badge" :class="etone(r.state)">{{ r.state }}</span><div v-if="r.error" class="small it-res bad">{{ r.error.slice(-200) }}</div><Btn v-if="r.state === 'Failed'" size="sm" :loading="working === 'e' + r.name" @click="retryEmail(r)">Send again</Btn></td></tr></tbody></table></div>
					<Pager v-if="el.rows.length" v-model:page="el.page" :size="25" :total="el.total" />
				</section>
				<section v-if="part === 'whatsapp' && sub === 'logs'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">WhatsApp logs</b><div class="small muted">Every WhatsApp message in and out: sent, delivered, read, failed, and the replies you received.</div></div><Btn icon="refresh" :loading="wl.loading" @click="loadWa()">Refresh</Btn></div>
					<div class="it-counts"><button v-for="k in WSTATES" :key="k[0]" type="button" class="it-cnt" :class="[k[1], { on: wl.status === k[0] }]" @click="wl.status = wl.status === k[0] ? '' : k[0]"><b>{{ wl.counts[k[0]] || 0 }}</b>{{ k[2] }}</button></div>
					<div class="row wrap" style="gap:10px;margin:12px 0"><div style="width:240px"><Dd v-model="wl.account" :options="wl.accounts" allow-empty="All numbers" placeholder="All numbers" aria-label="Number" /></div><div class="grow"></div><div style="width:240px"><Inp v-model="wl.q" icon="search" placeholder="Search number, template or lead" clearable aria-label="Search the WhatsApp log" /></div></div>
					<Skel v-if="wl.loading && !wl.rows.length" h="40" />
					<Empty v-else-if="!wl.rows.length" icon="whatsapp" title="No messages" :text="wl.status || wl.account || wl.q ? 'Nothing matches these filters.' : 'WhatsApp messages will appear here.'" />
					<div v-else class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Number</th><th>Message</th><th>Lead</th><th>State</th></tr></thead><tbody>
						<tr v-for="r in wl.rows" :key="r.name"><td class="nowrap">{{ when(r.creation) }}</td><td>{{ r.type === 'Incoming' ? (r.from_number || r.profile_name) : r.to_number }}<div class="small muted">{{ r.type === 'Incoming' ? 'Received' : 'Sent' }}<template v-if="r.profile_name && r.type === 'Incoming'"> · {{ r.profile_name }}</template></div></td>
							<td class="ellipsis" style="max-width:300px" :title="r.message"><span v-if="r.template" class="badge">{{ r.template }}</span> {{ r.message }}</td>
							<td><a v-if="r.reference_doctype === 'CRM Lead'" class="mono small" :href="leadUrl(r.reference_name)">{{ r.reference_name }}</a></td>
							<td><span class="badge" :class="wtone(r.state)">{{ r.state }}</span><div v-if="r.state === 'Failed'" class="small it-res bad">Meta did not deliver it. The reason is in Meta's WhatsApp Manager under the message.</div></td></tr></tbody></table></div>
					<Pager v-if="wl.rows.length" v-model:page="wl.page" :size="25" :total="wl.total" />
				</section>

				<section v-if="part === 'calendar' && sub === 'logs'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Meeting logs</b><div class="small muted">Every meeting and whether it reached the calendar. Failed ones show the reason and can be tried again.</div></div><Btn icon="refresh" :loading="cl.loading" @click="loadCal()">Refresh</Btn></div>
					<div v-if="cal" class="it-counts"><button v-for="k in [['Synced', 'green'], ['Not synced', 'amber'], ['Failed', 'red']]" :key="k[0]" type="button" class="it-cnt" :class="[k[1], { on: cl.status === k[0] }]" @click="cl.status = cl.status === k[0] ? '' : k[0]"><b>{{ cal.counts[k[0]] || 0 }}</b> {{ k[0] }}</button><span class="small muted" style="align-self:center">last 30 days</span></div>
					<div class="row wrap" style="gap:10px;margin:12px 0"><div class="grow"></div><div style="width:280px"><Inp v-model="cl.q" icon="search" placeholder="Search meeting, lead or organizer" aria-label="Search meetings" /></div></div>
					<Skel v-if="cl.loading && !cl.rows.length" h="40" />
					<Empty v-else-if="!cl.rows.length" icon="calendar" title="No meetings" :text="cl.status || cl.q ? 'Nothing matches these filters.' : 'Meetings you schedule will appear here.'" />
					<div v-else class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Meeting</th><th>Lead</th><th>Organizer</th><th>Calendar sync</th></tr></thead><tbody>
						<tr v-for="r in cl.rows" :key="r.name"><td class="nowrap">{{ when(r.starts_on) }}</td><td class="ellipsis" style="max-width:260px" :title="r.subject">{{ r.subject }}<div class="small muted">{{ r.provider }}</div></td>
							<td><a v-if="r.reference_doctype === 'CRM Lead'" class="mono small" :href="leadUrl(r.reference_docname)">{{ r.reference_docname }}</a></td><td class="small muted">{{ r.organizer }}</td>
							<td><span class="badge" :class="ctone(r.sync_status)">{{ r.provider === 'Google Meet' ? (r.sync_status || 'Not synced') : 'Manual link' }}</span><div v-if="r.sync_error" class="small it-res bad">{{ r.sync_error.slice(-200) }}</div><Btn v-if="r.sync_status !== 'Synced' && r.provider === 'Google Meet'" size="sm" :loading="working === 'm' + r.name" @click="retryMeeting(r)">Try again</Btn></td></tr></tbody></table></div>
					<Pager v-if="cl.rows.length" v-model:page="cl.page" :size="25" :total="cl.total" />
				</section>
				<section v-if="part === 'calendar' && sub === 'connection'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Google Calendar and Google Meet</b><div class="small muted">Meetings are created on one company calendar with a Meet link, so sales users never log in to Google.</div></div>
						<Btn icon="file" @click="guide = 'calendar'">Setup guide</Btn><Btn v-if="cal && cal.ready" icon="check" :loading="cTest && cTest.busy" @click="testCal">Test connection</Btn><Btn v-if="cal && cal.ready" variant="danger" icon="trash" @click="gdisc = true">Disconnect</Btn></div>
					<div v-if="cTest && cTest.message" class="it-res" :class="cTest.ok ? 'ok' : 'bad'" style="margin-bottom:10px">{{ cTest.message }}</div>
					<Skel v-if="!cal" h="40" />
					<template v-else>
						<div class="it-acc" :class="{ on: cal.ready }"><span class="it-ic"><Ico name="calendar" /></span><div class="grow"><b>{{ cal.ready ? 'Connected' : 'Not connected' }}</b><div class="small muted">{{ cal.message }}</div></div><span class="badge" :class="cal.ready ? 'green' : 'amber'">{{ cal.ready ? 'Ready' : 'Needs setup' }}</span></div>
						<div v-if="!cal.ready || gf.show" class="it-acc" style="display:block">
							<b>{{ cal.ready ? 'Sign in with Google again' : 'Connect Google' }}</b><div class="small muted" style="margin:2px 0 10px">Paste the OAuth client from Google Cloud (the Setup guide shows where), then sign in with the Google account that should own the calendar. Meetings are created on a calendar named below.</div>
							<div class="row wrap" style="gap:12px"><Field label="Client ID" class="grow"><Inp v-model="gf.client_id" placeholder="xxxx.apps.googleusercontent.com" /></Field><Field label="Client secret" class="grow"><Inp v-model="gf.client_secret" type="password" :placeholder="cal.has_secret ? 'Saved. Leave empty to keep it.' : 'GOCSPX-...'" /></Field></div>
							<Field label="Calendar name" hint="Created in Google Calendar if it does not exist."><Inp v-model="gf.calendar_name" /></Field>
							<div class="small muted" style="margin:8px 0">Add this as an Authorized redirect URI in Google Cloud first: <b class="it-code">{{ cal.redirect_uri }}</b> <Btn size="sm" variant="ghost" icon="copy" @click="copy(cal.redirect_uri)">Copy</Btn></div>
							<Btn variant="primary" icon="calendar" :loading="busy" @click="connectGoogle">Connect with Google</Btn>
						</div>
						<div v-else style="margin:10px 0"><Btn icon="refresh" @click="gf.show = true">Sign in with Google again</Btn></div>
						<div class="it-kv" style="margin:12px 0"><span>Meeting provider</span><b>{{ cal.provider }}</b><span>Google Settings</span><b>{{ cal.google_enabled ? 'On' : 'Off' }}, {{ cal.has_client ? 'client ID and secret saved' : 'client ID and secret missing' }}</b><span>Company calendar</span><b>{{ cal.company || 'Not chosen' }}</b><span>Personal calendars</span><b>{{ cal.personal ? 'Used when a person has one' : 'Not used' }}</b></div>
						<Empty v-if="!cal.calendars.length" icon="calendar" title="No Google Calendar yet" text="Open the Setup guide to connect one." />
						<div v-for="c in cal.calendars" :key="c.name" class="it-acc" :class="{ on: c.company }"><span class="it-ic"><Ico name="calendar" /></span><div class="grow"><b>{{ c.name }}</b><div class="small muted">{{ c.user || 'Company' }} {{ c.google_calendar_id ? '· ' + c.google_calendar_id : '' }}</div></div><span v-if="c.company" class="badge blue">Company calendar</span><span class="badge" :class="c.usable ? 'green' : 'amber'">{{ c.usable ? 'Can create events' : 'Not authorised' }}</span></div>
					</template>
				</section>

				<section v-if="part === 'email' && sub === 'connection'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Email</b><div class="small muted">Every email the CRM sends (campaigns, lead emails, notifications) goes out from the account marked <b>Sending</b>. Only an administrator can change it.</div></div>
						<Btn icon="file" @click="guide = 'email'">Setup guide</Btn><Btn variant="primary" icon="plus" @click="open('pick')">Add email account</Btn></div>
					<Empty v-if="!d.email.length" icon="mail" title="No email account yet" text="Add Gmail, Amazon SES, Outlook, SendGrid or any SMTP server to start sending." />
					<div v-for="a in d.email" :key="a.name" class="it-acc" :class="{ on: a.sending }">
						<BrandIcon :name="a.kind" />
						<div class="it-main">
							<div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ NAME[a.kind] }}</b><span class="muted">{{ a.email_id }}</span>
								<span v-if="a.sending" class="badge green">Sending</span><span v-if="!a.outgoing" class="badge">Receives only</span><span v-if="a.incoming" class="badge blue">Receives replies</span><span v-if="a.region" class="badge">{{ a.region }}</span><button v-if="a.kind === 'ses'" type="button" class="badge it-chip" :class="d.ses.last_event ? 'green' : 'amber'" title="Delivery tracking" @click="guide = 'ses'">{{ d.ses.last_event ? 'Delivery tracking on' : 'Set up delivery tracking' }}</button><span v-if="a.needs_password" class="badge amber">Password needed</span></div>
							<div class="it-stats"><span v-for="s in STATS" :key="s[0]" class="it-s" :class="s[2]"><b>{{ a.stats[s[0]] }}</b>{{ s[1] }}</span><span class="small faint">last 30 days</span></div>
							<div v-if="res[a.name]" class="small it-res" :class="res[a.name].ok ? 'ok' : 'bad'" role="status"><Ico :name="res[a.name].ok ? 'check-circle' : 'x-circle'" size="sm" /> {{ res[a.name].message }}</div>
							<div v-if="a.sending && a.kind === 'gmail'" class="small it-warn"><Ico name="alert" size="sm" /> Gmail stops after about {{ d.limits.gmail }} emails a day. For bigger campaigns connect Amazon SES and switch sending to it.</div>
						</div>
						<div class="it-act"><Btn v-if="a.outgoing && !a.sending" size="sm" :loading="working === a.name" @click="use(a)">Use for sending</Btn><Btn size="sm" variant="ghost" icon="check-circle" :loading="working === 'c' + a.name" @click="testConn(a)">Test connection</Btn><Btn v-if="a.outgoing" size="sm" variant="ghost" icon="send" :loading="working === 't' + a.name" @click="test(a)">Send test email</Btn><Btn size="sm" variant="ghost" icon="edit" @click="newPw = a; pw = ''">New password</Btn><Btn v-if="!a.sending" size="sm" variant="ghost" icon="trash" @click="remove = a">Remove</Btn></div>
					</div>
				</section>
				<template v-if="part === 'whatsapp'">
					<section v-if="part === 'whatsapp' && sub === 'connection'" class="card it-card">
						<div class="row it-h"><div class="grow"><b class="it-t">WhatsApp numbers</b><div class="small muted">The WhatsApp Business numbers the CRM sends from. One number sends all messages and one receives replies; only an administrator can change that. To use a different number, connect it here, make it the sending number, then disconnect the old one.</div></div>
							<Btn icon="file" @click="guide = 'whatsapp'">Setup guide</Btn><Btn v-if="d.whatsapp.installed" variant="primary" icon="plus" @click="openWa(null)">Connect a number</Btn></div>
						<div v-if="!d.whatsapp.installed" class="small muted">WhatsApp is not installed on this site.</div>
						<Empty v-else-if="!d.whatsapp.accounts.length" icon="whatsapp" title="No WhatsApp number connected" text="Connect a number from your Meta WhatsApp Business account to send and receive WhatsApp messages." />
						<div v-for="w in d.whatsapp.accounts" :key="w.name" class="it-acc" :class="{ on: w.sending }">
							<div class="it-ic wa"><Ico name="whatsapp" /></div>
							<div class="it-main">
								<div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ w.title }}</b><span class="badge" :class="w.status === 'Active' ? 'green' : 'amber'">{{ w.status === 'Active' ? 'On' : 'Off' }}</span><span v-if="w.sending" class="badge green">Sending</span><span v-if="w.receiving" class="badge blue">Receiving replies</span><span v-if="!w.has_token" class="badge amber">No access token</span></div>
								<div class="it-kv"><span>Phone number ID</span><b>{{ w.phone_id || '-' }}</b><span>Business account ID</span><b>{{ w.business_id || '-' }}</b><span>App ID</span><b>{{ w.app_id || '-' }}</b><span>API version</span><b>{{ w.version || '-' }}</b><span>Access token</span><b>{{ w.has_token ? 'Saved (hidden)' : 'Missing' }}</b></div>
								<div class="it-stats"><span v-for="s in WSTATS" :key="s[0]" class="it-s" :class="s[2]"><b>{{ w.stats[s[0]] }}</b>{{ s[1] }}</span><span class="small faint">last 30 days</span></div>
								<div v-if="res[w.name]" class="small it-res" :class="res[w.name].ok ? 'ok' : 'bad'" role="status"><Ico :name="res[w.name].ok ? 'check-circle' : 'x-circle'" size="sm" /> {{ res[w.name].message }}<template v-if="res[w.name].ok"> Quality: {{ res[w.name].quality || 'n/a' }}. {{ res[w.name].receiving ? 'Replies are reaching the CRM.' : 'Not subscribed to replies yet: finish the webhook step below.' }}</template></div>
							</div>
							<div class="it-act it-wrap">
								<Btn size="sm" variant="ghost" icon="check-circle" :loading="working === 'c' + w.name" @click="testWa(w)">Test connection</Btn>
								<Btn v-if="w.status === 'Active' && !w.sending" size="sm" :loading="working === 'sending' + w.name" @click="setWa(w, 'sending', true)">Use for sending</Btn>
								<Btn v-if="w.status === 'Active' && !w.receiving" size="sm" :loading="working === 'receiving' + w.name" @click="setWa(w, 'receiving', true)">Use for replies</Btn>
								<Btn size="sm" variant="ghost" icon="edit" @click="openWa(w)">Edit</Btn>
								<Btn size="sm" variant="ghost" :loading="working === 'active' + w.name" @click="setWa(w, 'active', w.status !== 'Active')">{{ w.status === 'Active' ? 'Switch off' : 'Switch on' }}</Btn>
								<Btn size="sm" variant="ghost" icon="trash" @click="gone = w">Disconnect</Btn>
							</div>
						</div>
					</section>
				</template>
			</template>

			<Modal v-if="guide === 'email'" size="xl" title="Connect an email provider: where to find the details" subtitle="Everything below is done in the provider's own settings." @close="guide = ''">
				<div class="mt-guide">
					<section><h3>Gmail</h3><ul><li>Turn on <b>2-Step Verification</b>, then create an <b>App password</b> (Google Account, Security). Use that 16-letter password here, not your normal one.</li><li>Gmail stops after about {{ d.limits.gmail }} emails a day.</li></ul><a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" class="btn sm">Open App passwords</a></section>
					<section><h3>Amazon SES</h3><ul><li>Open <b>Amazon SES</b> in the AWS console, then <b>Verified identities</b> and verify your domain or sending address. Ask AWS to move the account out of the <b>sandbox</b>, otherwise it only sends to verified addresses.</li><li>Open <b>SMTP settings</b>, choose <b>Create SMTP credentials</b>. The SMTP user name and password are different from your AWS access keys. Note the region.</li></ul><a href="https://console.aws.amazon.com/ses/home#/smtp" target="_blank" rel="noopener noreferrer" class="btn sm">Open SES SMTP settings</a></section>
					<section><h3>Outlook, Microsoft 365, Yahoo, Yandex</h3><ul><li>Create an <b>app password</b> in the account's security settings and use it here. For Microsoft 365 your administrator must allow SMTP sign-in for the mailbox.</li></ul></section>
					<section><h3>SendGrid and SparkPost</h3><ul><li>Create an <b>API key</b> that may send mail and paste it as the password. The user name (apikey, SMTP_Injection) is filled in for you.</li></ul></section>
					<section><h3>Any other server</h3><ul><li>Ask your mail host for the SMTP server, port, security type and user name. For receiving replies you also need the IMAP server.</li></ul></section>
					<section><h3>Delivery tracking</h3><ul><li>Bounces, spam complaints and delivered reports come from <button type="button" class="linkish" @click="guide = 'ses'">Amazon SES delivery tracking</button>. Read and not-read need nothing: the CRM's own tracking works with every provider.</li></ul></section>
				</div><template #foot><Btn variant="primary" @click="guide = ''">Close</Btn></template>
			</Modal>
			<Modal v-if="guide === 'ses'" size="lg" title="Amazon SES delivery tracking" subtitle="SES tells the CRM what happened to each email. Bounced and spam addresses are kept off future campaigns." @close="guide = ''">
				<div class="row" style="gap:8px;margin-bottom:10px"><span class="badge" :class="d.ses.subscribed ? 'green' : 'amber'">{{ d.ses.subscribed ? 'Connected' : 'Not connected yet' }}</span><span class="small muted">{{ d.ses.last_event ? 'Last report from SES: ' + when(d.ses.last_event) : 'No report from SES yet. This page checks again whenever you open it.' }}</span></div>
				<div class="mt-guide"><section><h3>Set it up once</h3><ul><li>In the AWS console open <b>Amazon SNS</b> and create a <b>Standard</b> topic (for example <i>crm-email-events</i>).</li><li>On that topic choose <b>Create subscription</b>, protocol <b>HTTPS</b>, and paste the address below. It confirms itself.</li><li>In <b>Amazon SES</b> open your verified domain or address, then <b>Notifications</b>, and pick that topic for <b>Bounces</b>, <b>Complaints</b> and <b>Deliveries</b>.</li></ul>
					<div class="row it-url"><code class="grow">{{ d.ses.webhook_url }}</code><Btn size="sm" icon="copy" @click="copy(d.ses.webhook_url)">Copy</Btn></div><div class="small muted" style="margin-top:8px">Nobody can change anything with this address without Amazon's signature.</div></section></div>
				<template #foot><Btn variant="primary" @click="guide = ''">Close</Btn></template>
			</Modal>
			<Modal v-if="gdisc" size="sm" title="Disconnect Google Calendar?" subtitle="New meetings will not be added to Google Calendar until you connect again. Existing meetings and their Google events stay." @close="gdisc = false"><template #foot><Btn @click="gdisc = false">Keep it</Btn><Btn variant="danger" :loading="busy" @click="disconnectGoogle">Disconnect</Btn></template></Modal>
			<Modal v-if="guide === 'calendar'" size="lg" title="Connect Google Calendar and Meet: where to find the details" subtitle="Done once by an administrator. Nothing here creates anything at Google except the sign-in you approve." @close="guide = ''">
				<div class="mt-guide" v-if="cal"><section><h3>1. Google Cloud project</h3><ul><li>Open <b>console.cloud.google.com</b>, create or pick a project, and turn on the <b>Google Calendar API</b> under APIs and services, Library.</li></ul></section>
					<section><h3>2. OAuth client</h3><ul><li>Under APIs and services, Credentials, create an <b>OAuth client ID</b> of type <i>Web application</i>. Add this as an <b>Authorized redirect URI</b>:</li></ul>
						<div class="it-kv"><span>Redirect address</span><b class="it-code">{{ cal.redirect_uri }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(cal.redirect_uri)">Copy</Btn></b><span>Site address</span><b class="it-code">{{ cal.site_url }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(cal.site_url)">Copy</Btn></b></div></section>
					<section><h3>3. Save it in the CRM</h3><ul><li>On the <b>Calendar connection</b> page paste the <b>Client ID</b> and <b>Client secret</b> and press <b>Connect with Google</b>. Sign in with the Google account that should own the calendar and allow access. You come back here connected, and the calendar is made for you.</li><li>Press <b>Test connection</b> to confirm.</li></ul></section>
					<section><h3>If a meeting fails to sync</h3><ul><li>The Meeting logs tab shows Google's reason. "Authorize again" means the saved login expired; "API not enabled" means step 1 was missed. Press <b>Try again</b> once fixed.</li></ul></section></div>
				<template #foot><Btn variant="primary" @click="guide = ''">Close</Btn></template>
			</Modal>
			<Modal v-if="guide === 'whatsapp'" size="lg" title="Connect WhatsApp: where to find the details" subtitle="All of these are in your Meta account. Nothing here creates anything at Meta." @close="guide = ''">
				<div class="mt-guide"><section><h3>The three IDs</h3><ul><li>Open <b>developers.facebook.com</b>, your app, then <b>WhatsApp</b> and <b>API Setup</b>. Copy the <b>Phone number ID</b> and the <b>WhatsApp Business Account ID</b>. The <b>App ID</b> is under App settings, Basic.</li></ul></section>
					<section><h3>The access token</h3><ul><li>Use a permanent one: in Business Settings create a <b>System user</b>, give it the app, and the permissions <i>whatsapp_business_messaging</i> and <i>whatsapp_business_management</i>, then generate the token. The temporary token on API Setup stops working after a day.</li></ul></section>
					<section><h3>Receive replies and delivery updates</h3><ul><li>Open <b>WhatsApp, Configuration</b> in the same app. Paste the callback address and verify token below, verify, and subscribe to <b>messages</b>.</li></ul>
						<div class="it-kv"><span>Callback address</span><b class="it-code">{{ d.whatsapp.webhook_url }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(d.whatsapp.webhook_url)">Copy</Btn></b>
							<template v-for="w in d.whatsapp.accounts" :key="w.name"><span>Verify token ({{ w.title }})</span><b class="it-code">{{ w.verify_token }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(w.verify_token)">Copy</Btn></b></template></div></section>
					<section><h3>Templates</h3><ul><li>Message templates belong to the Meta business account. If you move to a number in a different business account, create and get approval for the templates there; campaigns can only use approved templates.</li></ul></section></div>
				<template #foot><Btn variant="primary" @click="guide = ''">Close</Btn></template>
			</Modal>
			<Modal v-if="dlg === 'pick'" size="lg" title="Add an email account" subtitle="Choose where your email is sent from." @close="dlg = ''">
				<div class="it-pick"><button v-for="p in PROV" :key="p.key" type="button" class="it-pk" @click="open(p.key)"><BrandIcon :name="p.key" :size="42" /><span><b>{{ p.key === 'smtp' ? 'Other SMTP server' : NAME[p.key] }}</b><span class="small muted">{{ p.blurb }}</span></span></button></div>
			</Modal>
			<Modal v-else-if="dlg" size="md" :title="'Connect ' + (dlg === 'smtp' ? 'an SMTP server' : NAME[dlg])" :subtitle="dlg === 'ses' ? 'Use the SMTP details from the SES console (SMTP settings, Create SMTP credentials), not your AWS access keys.' : prov.pwHint" @close="dlg = ''" @submit="add">
				<div class="it-form">
					<Field :label="dlg === 'ses' ? 'From email address (verified in SES)' : 'Email address'" required><Inp v-model="f.email_id" placeholder="you@yourcompany.com" autofocus /></Field>
					<Field v-if="dlg === 'ses'" label="Region" hint="The region where your SES account is set up."><Dd v-model="f.region" :options="d.regions" searchable /></Field>
					<Field v-if="dlg === 'ses'" label="SMTP user name" required><Inp v-model="f.smtp_user" placeholder="AKIA..." /></Field>
					<Field v-if="dlg === 'ses'" label="SMTP password" required hint="Saved safely. It is not shown again."><Inp v-model="f.smtp_password" type="password" /></Field>
					<template v-if="dlg === 'smtp'">
						<Field label="SMTP server" required><Inp v-model="f.server" placeholder="smtp.yourcompany.com" /></Field>
						<div class="row" style="gap:12px"><Field label="Port"><Inp v-model="f.port" /></Field><Field label="Security"><Dd v-model="f.security" :options="[{ value: 'TLS', label: 'STARTTLS (587)' }, { value: 'SSL', label: 'SSL (465)' }, { value: 'NONE', label: 'None' }]" /></Field></div>
						<Field label="User name" hint="Leave empty if it is the email address."><Inp v-model="f.login" /></Field>
					</template>
					<Field v-if="dlg !== 'ses'" :label="prov.pw || 'Password'" required hint="Saved safely. It is not shown again."><Inp v-model="f.app_password" type="password" /></Field>
					<template v-if="dlg === 'smtp' && f.receive"><Field label="Incoming (IMAP) server" hint="Needed to bring replies in."><Inp v-model="f.imap" placeholder="imap.yourcompany.com" /></Field></template>
					<div v-if="prov.receive" class="row it-sw"><div class="grow"><b>Also receive replies</b><div class="small muted">Emails sent to this address appear on the lead.</div></div><Switch v-model="f.receive" label="Also receive replies" /></div>
					<div class="row it-sw"><div class="grow"><b>Send all emails from this account</b><div class="small muted">Campaigns, lead emails and notifications.</div></div><Switch v-model="f.use" label="Send all emails from this account" /></div>
				</div>
				<template #foot><Btn @click="dlg = 'pick'">Back</Btn><Btn variant="primary" :loading="busy" @click="add">Connect</Btn></template>
			</Modal>
			<Modal v-if="remove" size="sm" :title="'Remove ' + remove.email_id + '?'" @close="remove = null"><p>The CRM stops using this account. Emails already sent stay on the leads.</p><template #foot><Btn @click="remove = null">Keep it</Btn><Btn variant="danger" :loading="busy" @click="removeAcc">Remove</Btn></template></Modal>
			<Modal v-if="newPw" size="sm" :title="'New password for ' + newPw.email_id" subtitle="The CRM logs in with it before saving." @close="newPw = null" @submit="savePw"><Field label="Password or API key" required><Inp v-model="pw" type="password" autofocus /></Field><template #foot><Btn @click="newPw = null">Cancel</Btn><Btn variant="primary" :loading="busy" @click="savePw">Save</Btn></template></Modal>
			<Modal v-if="wd" size="md" :title="wd === 'add' ? 'Connect a WhatsApp number' : 'Edit ' + wf.account_name" subtitle="The details are checked with WhatsApp before they are saved." @close="wd = ''" @submit="saveWa">
				<div class="it-form">
					<Field label="A name for this number" required><Inp v-model="wf.account_name" placeholder="Sales WhatsApp" autofocus /></Field>
					<Field label="Phone number ID" required><Inp v-model="wf.phone_id" placeholder="1234567890123456" /></Field>
					<Field label="WhatsApp Business Account ID" required><Inp v-model="wf.business_id" placeholder="1234567890123456" /></Field>
					<Field label="App ID" hint="Optional."><Inp v-model="wf.app_id" /></Field>
					<Field label="API version"><Dd v-model="wf.version" :options="d.whatsapp.versions" /></Field>
					<Field :label="wd === 'add' ? 'Access token' : 'New access token'" :required="wd === 'add'" :hint="wd === 'add' ? 'A permanent system user token. Saved safely, not shown again.' : 'Leave empty to keep the saved token.'"><Inp v-model="wf.token" type="password" /></Field>
					<div v-if="wd === 'add'" class="row it-sw"><div class="grow"><b>Send all WhatsApp messages from this number</b></div><Switch v-model="wf.send" label="Send from this number" /></div>
					<div v-if="wd === 'add'" class="row it-sw"><div class="grow"><b>Receive replies on this number</b></div><Switch v-model="wf.recv" label="Receive replies on this number" /></div>
				</div>
				<template #foot><Btn @click="wd = ''">Cancel</Btn><Btn variant="primary" :loading="busy" @click="saveWa">{{ wd === 'add' ? 'Connect' : 'Save' }}</Btn></template>
			</Modal>
			<Modal v-if="gone" size="sm" :title="'Disconnect ' + gone.title + '?'" @close="gone = null">
				<p>The CRM stops sending from and receiving on this number. {{ gone.sending ? 'It is the sending number, so WhatsApp campaigns will fail until you choose another one. ' : '' }}If messages were sent from it, the history stays and the number is only switched off.</p>
				<template #foot><Btn @click="gone = null">Keep it</Btn><Btn variant="danger" :loading="busy" @click="disconnect">Disconnect</Btn></template>
			</Modal>
		</div>`,
	}
})()
