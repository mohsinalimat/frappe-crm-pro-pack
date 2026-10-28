/* Suite Pro: Settings, Integrations, Meta. Facebook and Instagram lead ads come straight into Leads: connect once, choose the forms, map the questions to CRM
   fields. New leads arrive instantly, with the campaign, ad set and ad they came from. Only an administrator sees this. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.meta.' + m, a)
	const GUIDE = [
		{ t: 'Before you start', items: ['You need admin access to the Facebook Page that runs the lead ads, and to the Meta Business account that owns it.', 'Everything below is done in Meta. Nothing here creates or changes anything at Meta except subscribing your Page to new leads.'] },
		{ t: '1. Create a Meta app', link: ['https://developers.facebook.com/apps', 'Open Meta for Developers'], items: ['Create app, choose <b>Other</b>, then type <b>Business</b>. Name it, for example, "CRM Lead Sync", and attach your Business account.', 'Open <b>App settings, Basic</b> and copy the <b>App ID</b> and the <b>App secret</b>. You will paste both in the Connection box here. The secret lets the CRM check that a notice really came from Meta.', 'Add the <b>Webhooks</b> product to the app.'] },
		{ t: '2. Make a system user and a permanent token', link: ['https://business.facebook.com/settings/system-users', 'Open Business Settings, System users'], items: ['Add a system user with the role <b>Admin</b>, for example "CRM".', 'Choose <b>Add assets</b>: give it your <b>Page</b> (full control) and your <b>app</b> (full control).', 'Choose <b>Generate new token</b>, pick your app, set the expiry to <b>Never</b>, and tick: <b>leads_retrieval</b>, <b>pages_show_list</b>, <b>pages_read_engagement</b>, <b>pages_manage_metadata</b>, <b>pages_manage_ads</b>. Also tick <b>ads_read</b> and <b>business_management</b> if you want campaign and ad names on every lead.', 'Copy the token now: Meta shows it once. Paste it in the Connection box here.'] },
		{ t: '3. Let the CRM read your leads', link: ['https://business.facebook.com/settings/leads-access', 'Open Business Settings, Leads access'], items: ['Under <b>Integrations, Leads access</b> choose your Page, open the <b>CRMs</b> tab and assign your app. Without this Meta refuses to hand over the lead details.'] },
		{ t: '4. Connect the CRM', items: ['Paste the token, App ID and App secret in the <b>Connection</b> box here and choose <b>Save</b>, then <b>Test connection</b>.', 'The test lists every permission with a tick or a cross, and tells you how many Pages the token can reach. Fix anything that has a cross, then test again.'] },
		{ t: '5. Send new leads to the CRM instantly', link: ['https://developers.facebook.com/apps', 'Open your app, Webhooks'], items: ['In your app open <b>Webhooks</b>, choose the <b>Page</b> object and <b>Subscribe to this object</b>.', 'Paste the <b>Callback address</b> and the <b>Verify token</b> shown in the "Instant leads" box here, then <b>Verify and save</b>.', 'In the list of fields, subscribe to <b>leadgen</b>.', 'Connecting a form here also subscribes your Page to new leads, so this is the only manual webhook step.'] },
		{ t: '6. Choose your forms', items: ['Choose <b>Add a form</b>, pick the Page and the lead form, then match each question to a CRM field. Name and email or phone are required. Questions you do not match are still kept in a note on the lead.', 'Leads from Instagram get the source <b>Instagram</b>, the rest <b>Facebook</b>. Each lead keeps its campaign, ad set and ad.'] },
		{ t: '7. Test it', link: ['https://developers.facebook.com/tools/lead-ads-testing', 'Open Meta\'s Lead Ads Testing Tool'], items: ['Press <b>Test</b> on a form here first: it checks the Page, the form, the instant subscription and shows how a sample lead would be saved, without creating anything.', 'Then in Meta\'s testing tool choose your Page and form and press <b>Create lead</b>. It should appear under "Recent Meta leads" here and in Leads within seconds. Delete the test lead in Meta\'s tool afterwards.'] },
		{ t: '8. Going live', items: ['For real ads, switch the app to <b>Live</b> mode (App settings, Basic needs a privacy policy address). While it is in development mode Meta only sends notices for people with a role on the app.', 'If a notice is ever missed, the CRM asks Meta for the last three days of leads every hour, so nothing is lost. Failed leads can be retried here.'] },
	]

	V.MetaSetup = {
		setup() {
			const loading = ref(true); const error = ref(''); const d = ref({ connected: false, forms: [], permissions: [], recent: [], fields: [], webhook_url: '', verify_token: '' })
			const c = reactive({ token: '', app_id: '', app_secret: '', version: 'v23.0' }); const busy = ref(''); const res = ref(null); const formRes = reactive({})
			const wiz = ref(false); const pages = ref([]); const page = ref(''); const forms = ref([]); const pick = ref(''); const map = reactive({}); const loadingF = ref(false)
			const edit = ref(null); const gone = ref(null); const guide = ref(false)
			const SUBS = [['leads', 'Recent Meta leads', 'users'], ['forms', 'Lead forms', 'file'], ['connection', 'Meta connection', 'meta']]
			const sub = ref(['leads', 'forms', 'connection'].includes(CM.store.get('meta-sub')) ? CM.store.get('meta-sub') : 'leads'); watch(sub, (v) => { CM.store.set('meta-sub', v); if (v === 'leads') loadLog() })
			const lg = reactive({ rows: [], total: 0, counts: {}, forms: [], sync: {}, loading: false }); const lres = ref(''); const lform = ref(''); const lq = ref(''); const lrange = CM.useRange('meta-log-range', 'any'); const lpage = ref(1); const LSIZE = 20
			let seq = 0, timer = null, poll = null
			async function loadLog(quiet) {
				const my = ++seq; if (!quiet) lg.loading = true
				try { const r = await call('get_leads', { ...CM.rangeArgs(lrange.value), page: lpage.value, page_size: LSIZE, result: lres.value || undefined, form: lform.value || undefined, search: lq.value || undefined }); if (my === seq) Object.assign(lg, r) } catch (e) { CM.toast(e.message, 'err') } finally { if (my === seq) lg.loading = false }
			}
			watch([lres, lform, () => lrange.value.preset, () => lrange.value.from, () => lrange.value.to], () => { lpage.value = 1; loadLog() }); watch(lpage, () => loadLog())
			watch(lq, () => { clearTimeout(timer); timer = setTimeout(() => { lpage.value = 1; loadLog() }, 300) })
			onMounted(() => { if (sub.value === 'leads') loadLog(); poll = setInterval(() => { if (sub.value === 'leads' && !document.hidden) loadLog(true) }, 15000) })
			onBeforeUnmount(() => { clearInterval(poll); clearTimeout(timer) })
			const syncNow = () => run('sync', async () => { await call('sync_now'); CM.toast('Sync started. New leads appear in a moment.'); setTimeout(() => loadLog(true), 4000) })
			const setSync = (on) => run('ss', async () => { lg.sync = await call('set_sync', { running: on ? 1 : 0 }); CM.toast(on ? 'Sync started. Waiting leads are being imported.' : 'Sync stopped. New leads wait until you start it again.'); await load(); setTimeout(() => loadLog(true), on ? 4000 : 0) })
			const RES = [{ value: '', label: 'All results' }, { value: 'Created', label: 'New lead' }, { value: 'Duplicate', label: 'Already a lead' }, { value: 'Failed', label: 'Failed' }, { value: 'Waiting', label: 'Waiting (sync stopped)' }, { value: 'Ignored', label: 'Skipped' }]
			const found = ref({ whatsapp: [], pages: [], forms: [] })
			async function detect() { try { found.value = await call('detect') } catch (e) { /* nothing to show */ } }
			const useApp = (w) => run('ua' + w.name, async () => { const r = await call('use_whatsapp_app', { account: w.name }); c.app_id = r.app_id; CM.toast('App ID ' + r.app_id + ' saved. Add the App secret from Meta.'); await load() })
			const useToken = (w) => run('ut' + w.name, async () => { await call('use_whatsapp_token', { account: w.name }); CM.toast('Token accepted and saved'); await Promise.all([load(), detect()]) })
			const importForm = (f) => run('im' + f.form_id, async () => { const r = await call('import_crm_form', { form_id: f.form_id }); CM.toast('Form taken over.' + (r.frappe_sync_switched_off ? " Frappe CRM's own sync of it was switched off so leads are not imported twice." : '') + (r.subscribed ? '' : ' Instant delivery needs the connection token.')); await Promise.all([load(), detect()]) })
			const todo = computed(() => found.value.forms.filter((f) => !f.connected))
			async function load() {
				try { d.value = await call('get_overview'); c.app_id = d.value.app_id || c.app_id; c.version = d.value.version; error.value = '' } catch (e) { error.value = e.message } finally { loading.value = false }
			}
			onMounted(() => { load(); detect() })
			async function run(key, fn) { busy.value = key; try { return await fn() } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = '' } }
			const save = () => run('save', async () => { await call('save_connection', { token: c.token, app_id: c.app_id, app_secret: c.app_secret, api_version: c.version }); c.token = c.app_secret = ''; CM.toast('Saved'); await load() })
			const test = () => run('test', async () => { res.value = await call('test_connection') })
			const disconnect = () => run('disc', async () => { await call('disconnect'); res.value = null; CM.toast('Disconnected. Leads already imported stay.'); await load() })
			const toggle = (f) => run('t' + f.form_id, async () => { await call('set_form', { form_id: f.form_id, enabled: f.enabled ? 0 : 1 }); await load() })
			const testForm = (f) => run('f' + f.form_id, async () => { formRes[f.form_id] = await call('test_form', { form_id: f.form_id }); await load() })
			const retry = (r) => run('r' + r.name, async () => { const o = await call('retry', { entry: r.name }); CM.toast('Result: ' + o.result); await load(); if (sub.value === 'leads') await loadLog(true) })
			const remove = () => run('rm', async () => { await call('remove_form', { form_id: gone.value.form_id }); CM.toast('Form disconnected'); gone.value = null; await load() })
			async function openWizard() {
				wiz.value = true; page.value = pick.value = ''; forms.value = []; Object.keys(map).forEach((k) => delete map[k])
				try { pages.value = (await call('list_pages')).map((p) => ({ value: p.id, label: p.name + (p.category ? ' (' + p.category + ')' : '') })) } catch (e) { CM.toast(e.message, 'err'); wiz.value = false }
			}
			async function choosePage(id) {
				page.value = id; pick.value = ''; forms.value = []; loadingF.value = true
				try { forms.value = await call('list_forms', { page_id: id }) } catch (e) { CM.toast(e.message, 'err') } finally { loadingF.value = false }
			}
			const current = computed(() => forms.value.find((f) => f.id === pick.value))
			function choose(id) { pick.value = id; Object.keys(map).forEach((k) => delete map[k]); const f = forms.value.find((x) => x.id === id); if (f) Object.assign(map, f.mapping) }
			const formOpts = computed(() => forms.value.map((f) => ({ value: f.id, label: f.name + (f.added ? ' (already connected)' : ''), disabled: f.added })))
			const addForm = () => run('add', async () => {
				const r = await call('add_form', { page_id: page.value, form_id: pick.value, mapping: JSON.stringify(map) })
				CM.toast(r.subscribed ? 'Form connected. New leads will arrive instantly.' : 'Form connected, but the instant subscription failed: ' + r.note, r.subscribed ? undefined : 'err'); wiz.value = false; await load()
			})
			async function openEdit(f) {
				const r = await run('e' + f.form_id, () => call('form_detail', { form_id: f.form_id })); if (!r) return
				Object.keys(map).forEach((k) => delete map[k]); Object.assign(map, r.mapping); edit.value = r
			}
			const refreshQ = () => run('rq', async () => { const r = await call('form_detail', { form_id: edit.value.form_id, refresh: 1 }); Object.keys(map).forEach((k) => delete map[k]); Object.assign(map, r.mapping); edit.value = r; CM.toast('Questions refreshed from Meta') })
			const saveMap = () => run('sm', async () => { await call('save_mapping', { form_id: edit.value.form_id, mapping: JSON.stringify(map) }); CM.toast('Mapping saved'); edit.value = null; await load() })
			async function copy(text) { try { await navigator.clipboard.writeText(text); CM.toast('Copied') } catch (e) { CM.toast('Select it and copy', 'err') } }
			const when = (s) => (s ? CM.fmt(s) : '')
			const fieldOpts = computed(() => [{ value: '', label: 'Do not import' }, ...d.value.fields])
			const tone = (r) => ({ Created: 'green', Duplicate: 'blue', Failed: 'red', Ignored: 'amber', Waiting: 'amber' }[r] || '')
			const word = (r) => ({ Created: 'New lead', Duplicate: 'Already a lead', Failed: 'Failed', Ignored: 'Skipped', Waiting: 'Waiting' }[r] || r)
			return { found, todo, useApp, useToken, importForm, SUBS, sub, lg, lres, lform, lq, lrange, lpage, LSIZE, RES, syncNow, setSync, loading, error, d, c, busy, res, formRes, wiz, pages, page, forms, pick, map, loadingF, edit, gone, guide, GUIDE, save, test, disconnect, toggle, testForm, retry, remove, openWizard, choosePage, current, choose, formOpts, addForm, openEdit, saveMap, refreshQ, copy, when, fieldOpts, tone, word, CM }
		},
		template: `
		<div class="page it-page">
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<div class="row fs-kinds" style="margin-top:6px"><div class="fs-seg" role="tablist" aria-label="Meta"><button v-for="t in SUBS" :key="t[0]" type="button" role="tab" :class="{ on: sub === t[0] }" :aria-selected="sub === t[0]" @click="sub = t[0]"><Ico :name="t[2]" size="sm" />{{ t[1] }}</button></div></div>
				<section v-if="sub === 'connection' && found.whatsapp.length" class="card it-card mt-found">
					<div class="row it-h"><div class="grow"><b class="it-t">Found in your system</b><div class="small muted">Your WhatsApp connection already uses a Meta app. You can reuse its App ID. Its token is used only if Meta confirms it may read leads.</div></div></div>
					<div v-for="w in found.whatsapp" :key="w.name" class="row mt-fr"><Ico name="whatsapp" /><div class="grow"><b>{{ w.title }}</b><div class="small muted">App ID {{ w.app_id || 'not set' }}<template v-if="w.business_id"> · Business account {{ w.business_id }}</template></div></div>
						<Btn size="sm" :disabled="!w.app_id" :loading="busy === 'ua' + w.name" @click="useApp(w)">Use this App ID</Btn><Btn size="sm" :disabled="!w.has_token" :loading="busy === 'ut' + w.name" @click="useToken(w)">Try its token</Btn></div>
				</section>
				<section v-if="sub === 'connection'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Meta connection</b><div class="small muted">Facebook and Instagram lead ads. New leads come straight into Leads with the campaign, ad set and ad they came from.</div></div>
						<span class="badge" :class="d.connected ? 'green' : 'amber'">{{ d.connected ? 'Token saved' : 'Not connected' }}</span><Btn icon="file" @click="guide = true">Setup guide</Btn></div>
					<div class="mt-grid">
						<Field label="System user access token" :hint="d.connected ? 'A token is saved. Leave empty to keep it.' : 'A permanent token for a system user. The guide shows how to make one.'"><Inp v-model="c.token" type="password" :placeholder="d.connected ? 'Saved (hidden)' : 'EAAB...'" /></Field>
						<Field label="App ID"><Inp v-model="c.app_id" placeholder="1234567890" /></Field>
						<Field label="App secret" :hint="d.has_secret ? 'Saved. Leave empty to keep it.' : 'Lets the CRM check that a notice really came from Meta.'"><Inp v-model="c.app_secret" type="password" :placeholder="d.has_secret ? 'Saved (hidden)' : ''" /></Field>
						<Field label="API version"><Dd v-model="c.version" :options="['v23.0', 'v22.0', 'v21.0']" /></Field>
					</div>
					<div class="row" style="gap:8px;margin-top:12px"><Btn variant="primary" :loading="busy === 'save'" @click="save">Save</Btn><Btn icon="check-circle" :loading="busy === 'test'" :disabled="!d.connected" @click="test">Test connection</Btn><div class="grow"></div><Btn v-if="d.connected" variant="ghost" icon="trash" :loading="busy === 'disc'" @click="disconnect">Disconnect</Btn></div>
					<div v-if="res" class="mt-res" role="status"><div class="it-res" :class="res.ok ? 'ok' : 'bad'"><Ico :name="res.ok ? 'check-circle' : 'x-circle'" size="sm" /> {{ res.message }}<template v-if="res.never_expires"> The token never expires.</template><template v-else-if="res.expires_at"> It expires on {{ new Date(res.expires_at * 1000).toLocaleDateString() }}.</template></div>
						<ul v-if="res.permissions" class="mt-perms"><li v-for="p in res.permissions" :key="p.key"><Ico :name="p.granted ? 'check-circle' : 'x-circle'" size="sm" :class="p.granted ? 'okc' : p.required ? 'badc' : 'mutedc'" /><b>{{ p.key }}</b><span class="muted">{{ p.label }}{{ p.required ? '' : ' (optional)' }}</span></li></ul></div>
				</section>

				<section v-if="sub === 'forms' && todo.length" class="card it-card mt-found">
					<div class="row it-h"><div class="grow"><b class="it-t">Already connected in Frappe CRM</b><div class="small muted">These lead forms are set up in Frappe CRM's own Facebook sync. Take one over to keep its Page and mapping, get leads instantly, and see it here with the campaign and ad. Frappe's own sync of that form is switched off, so nothing is imported twice.</div></div></div>
					<div v-for="f in todo" :key="f.form_id" class="row mt-fr"><Ico name="facebook" /><div class="grow"><b>{{ f.name }}</b><div class="small muted">{{ f.page_name }} · {{ f.mapped }} of {{ f.questions }} questions mapped<template v-if="f.crm_sync_on"> · syncing every few minutes in Frappe CRM</template></div></div><Btn size="sm" variant="primary" :loading="busy === 'im' + f.form_id" @click="importForm(f)">Take over</Btn></div>
				</section>
				<section v-if="sub === 'forms'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Lead forms</b><div class="small muted">Each connected form sends its leads to the CRM. You choose which question goes into which CRM field.</div></div><Btn variant="primary" icon="plus" :disabled="!d.connected" @click="openWizard">Add a form</Btn></div>
					<Empty v-if="!d.forms.length" icon="file" title="No form connected" :text="d.connected ? 'Add a form to start receiving leads.' : 'Save your token first, then add a form.'" />
					<div v-for="f in d.forms" :key="f.form_id" class="it-acc" :class="{ on: f.enabled }">
						<div class="it-ic meta"><Ico name="meta" /></div>
						<div class="it-main">
							<div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ f.form_name }}</b><span class="muted">{{ f.page_name }}</span><span class="badge" :class="f.enabled ? 'green' : ''">{{ f.enabled ? 'On' : 'Off' }}</span><span class="badge" :class="f.subscribed ? 'blue' : 'amber'">{{ f.subscribed ? 'Instant' : 'Not instant yet' }}</span></div>
							<div class="it-stats"><span class="it-s"><b>{{ f.stats.received }}</b>Received</span><span class="it-s green"><b>{{ f.stats.created }}</b>New leads</span><span class="it-s blue"><b>{{ f.stats.duplicate }}</b>Already leads</span><span class="it-s red"><b>{{ f.stats.failed }}</b>Failed</span><span class="small faint">last 30 days</span><span class="small faint">{{ f.mapped }} questions mapped</span><span v-if="f.last_lead_at" class="small faint">Last lead {{ when(f.last_lead_at) }}</span></div>
							<div v-if="formRes[f.form_id]" class="mt-res"><div class="it-res" :class="formRes[f.form_id].ok ? 'ok' : 'bad'"><Ico :name="formRes[f.form_id].ok ? 'check-circle' : 'x-circle'" size="sm" /> {{ formRes[f.form_id].ok ? 'Everything works for this form.' : 'Something needs attention.' }}</div>
								<ul class="mt-perms"><li v-for="(s, i) in formRes[f.form_id].steps" :key="i"><Ico :name="s.ok ? 'check-circle' : 'x-circle'" size="sm" :class="s.ok ? 'okc' : 'badc'" /><b>{{ s.label }}</b><span class="muted">{{ s.detail }}</span></li></ul></div>
						</div>
						<div class="it-act it-wrap"><Btn size="sm" variant="ghost" icon="check-circle" :loading="busy === 'f' + f.form_id" @click="testForm(f)">Test</Btn><Btn size="sm" variant="ghost" icon="edit" :loading="busy === 'e' + f.form_id" @click="openEdit(f)">Mapping</Btn><Btn size="sm" variant="ghost" :loading="busy === 't' + f.form_id" @click="toggle(f)">{{ f.enabled ? 'Switch off' : 'Switch on' }}</Btn><Btn size="sm" variant="ghost" icon="trash" @click="gone = f">Remove</Btn></div>
					</div>
				</section>

				<section v-if="sub === 'connection'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Instant leads</b><div class="small muted">Give Meta this address (app, Webhooks, Page, field <i>leadgen</i>) so leads arrive in seconds. The guide shows where. Without it the CRM still catches up every hour.</div></div>
						<span class="badge" :class="d.last_event ? 'green' : 'amber'">{{ d.last_event ? 'Receiving' : 'Nothing received yet' }}</span></div>
					<div class="it-kv"><span>Callback address</span><b class="it-code">{{ d.webhook_url }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(d.webhook_url)">Copy</Btn></b><span>Verify token</span><b class="it-code">{{ d.verify_token }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(d.verify_token)">Copy</Btn></b></div>
					<div class="small muted" style="margin-top:8px">{{ d.last_event ? 'Last notice from Meta: ' + when(d.last_event) + '.' : 'No notice from Meta yet.' }} A notice without Meta's signature is refused.</div>
				</section>

				<section v-if="sub === 'leads'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Recent Meta leads</b><div class="small muted">Every lead, duplicate and failure from your Meta forms, newest first. The same entries show in the Log under Meta ads.</div></div>
						<DateRange v-model="lrange" any one-month align="right" aria-label="Received between" /><span class="badge" :class="lg.sync.running === false ? 'amber' : 'green'">{{ lg.sync.running === false ? 'Sync stopped' : 'Sync running' }}</span>
						<Btn icon="refresh" :loading="busy === 'sync'" :disabled="!d.connected" @click="syncNow">Sync now</Btn>
						<Btn v-if="lg.sync.running !== false" icon="x-circle" :loading="busy === 'ss'" @click="setSync(false)">Stop sync</Btn><Btn v-else variant="primary" icon="check-circle" :loading="busy === 'ss'" @click="setSync(true)">Start sync</Btn></div>
					<div class="small muted" style="margin:-4px 0 10px">{{ lg.sync.running === false ? 'While stopped, new leads from Meta are kept as Waiting and nothing is lost. Start the sync to import them. ' : '' }}{{ lg.sync.waiting ? lg.sync.waiting + ' waiting. ' : '' }}Last sync: {{ lg.sync.last_sync ? when(lg.sync.last_sync) : 'not yet' }}. Last notice from Meta: {{ lg.sync.last_event ? when(lg.sync.last_event) : 'none yet' }}.</div>
					<div class="row wrap" style="gap:10px;margin-bottom:12px"><div style="width:200px"><Dd v-model="lres" :options="RES" aria-label="Result" /></div><div style="width:240px"><Dd v-model="lform" :options="lg.forms" searchable allow-empty="All forms" placeholder="All forms" aria-label="Form" /></div><div class="grow"></div>
						<span v-for="(n, k) in lg.counts" :key="k" class="small muted">{{ word(k) }}: <b>{{ n }}</b></span><div style="width:220px"><Inp v-model="lq" icon="search" placeholder="Search" clearable aria-label="Search the Meta leads" /></div></div>
					<Skel v-if="lg.loading && !lg.rows.length" h="40" />
					<Empty v-else-if="!lg.rows.length" icon="users" title="No Meta leads" :text="lres || lform || lq || lrange.preset !== 'any' ? 'Nothing matches these filters.' : 'Leads from your connected forms will appear here.'" />
					<div v-else class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Lead</th><th>Campaign / ad set / ad</th><th>Form</th><th>Result</th></tr></thead><tbody>
						<tr v-for="r in lg.rows" :key="r.name"><td class="nowrap">{{ when(r.creation) }}</td>
							<td><b>{{ r.person_name || '-' }}</b><div class="small muted">{{ r.email || r.phone }}</div></td>
							<td><span class="badge" :class="r.source === 'Instagram' ? 'purple' : 'blue'"><Ico :name="r.source === 'Instagram' ? 'instagram' : 'facebook'" size="sm" /> {{ r.source }}</span><div class="small muted">{{ r.campaign_name }}<template v-if="r.adset_name"> / {{ r.adset_name }}</template><template v-if="r.ad_name"> / {{ r.ad_name }}</template></div></td>
							<td>{{ r.form_name }}<div class="small muted">{{ r.via }}</div></td>
							<td><span class="badge" :class="tone(r.result)">{{ word(r.result) }}</span><div v-if="r.error" class="small it-res bad">{{ r.error }}</div><div v-if="r.lead"><a class="mono small" :href="CM.leadUrl(r.lead)">{{ r.lead }}</a></div><Btn v-if="['Failed', 'Ignored', 'Waiting'].includes(r.result)" size="sm" :loading="busy === 'r' + r.name" @click="retry(r)">{{ r.result === 'Waiting' ? 'Import now' : 'Retry' }}</Btn></td></tr></tbody></table></div>
					<Pager v-if="lg.rows.length" v-model:page="lpage" :size="LSIZE" :total="lg.total" />
				</section>
			</template>

			<Modal v-if="wiz" size="lg" title="Add a lead form" subtitle="Choose the Page and the form, then match its questions to CRM fields." @close="wiz = false">
				<div class="it-form">
					<Field label="Facebook Page" required><Dd v-model="page" :options="pages" searchable placeholder="Choose a Page" @update:modelValue="choosePage" /></Field>
					<Field v-if="page" label="Lead form" required><Skel v-if="loadingF" h="20" /><Dd v-else :model-value="pick" :options="formOpts" searchable placeholder="Choose a form" @update:modelValue="choose" /><div v-if="!loadingF && !forms.length" class="small muted">This Page has no lead forms yet.</div></Field>
					<div v-if="current" class="mt-map"><div class="mt-maph"><span>Question on the form</span><span>CRM field</span></div>
						<div v-for="q in current.questions" :key="q.key" class="mt-mapr"><span><b>{{ q.label }}</b><span class="small muted"> {{ q.key }}</span></span><Dd v-model="map[q.key]" :options="fieldOpts" searchable /></div>
						<div class="small muted" style="margin-top:6px">A name (full name or first name) and an email or phone number are needed, so duplicates can be found. Questions you do not match are still kept in a note on the lead.</div></div>
				</div>
				<template #foot><Btn @click="wiz = false">Cancel</Btn><Btn variant="primary" :loading="busy === 'add'" :disabled="!current" @click="addForm">Connect this form</Btn></template>
			</Modal>
			<Modal v-if="edit" size="lg" :title="'Mapping: ' + edit.form_name" subtitle="Which question goes into which CRM field." @close="edit = null">
				<div class="mt-map"><div class="mt-maph"><span>Question on the form</span><span>CRM field</span></div>
					<div v-for="q in edit.questions" :key="q.key" class="mt-mapr"><span><b>{{ q.label }}</b><span class="small muted"> {{ q.key }}</span></span><Dd v-model="map[q.key]" :options="fieldOpts" searchable /></div></div>
				<template #foot><Btn variant="ghost" icon="refresh" :loading="busy === 'rq'" @click="refreshQ">Refresh questions from Meta</Btn><div class="grow"></div><Btn @click="edit = null">Cancel</Btn><Btn variant="primary" :loading="busy === 'sm'" @click="saveMap">Save mapping</Btn></template>
			</Modal>
			<Modal v-if="gone" size="sm" :title="'Remove ' + gone.form_name + '?'" @close="gone = null">
				<p>The CRM stops receiving leads from this form. The leads already imported and the log stay.</p>
				<template #foot><Btn @click="gone = null">Keep it</Btn><Btn variant="danger" :loading="busy === 'rm'" @click="remove">Remove</Btn></template>
			</Modal>
			<Modal v-if="guide" size="xl" title="Connect Meta lead ads: step by step" subtitle="All of this is done in Meta. It takes about 20 minutes the first time." @close="guide = false">
				<div class="mt-guide"><section v-for="g in GUIDE" :key="g.t"><h3>{{ g.t }}</h3><ul><li v-for="(it, i) in g.items" :key="i" v-html="it"></li></ul>
					<a v-if="g.link" :href="g.link[0]" target="_blank" rel="noopener noreferrer" class="btn sm">{{ g.link[1] }}</a></section></div>
				<template #foot><Btn variant="primary" @click="guide = false">Close</Btn></template>
			</Modal>
		</div>`,
	}
})()
