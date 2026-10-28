/* Suite Pro: Settings, Integrations. The email senders (Gmail, Amazon SES, and what the site already has) and the WhatsApp account in one place.
   Only an administrator sees it. Passwords are typed once and never shown again. */
(() => {
	const { ref, reactive, computed, onMounted } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.integrations.' + m, a)
	const NAME = { gmail: 'Gmail', ses: 'Amazon SES', other: 'Email' }
	const STATS = [['sent', 'Sent', 'green'], ['waiting', 'Not sent yet', 'amber'], ['failed', 'Failed', 'red'], ['read', 'Read', 'blue'], ['not_read', 'Not read', '']]

	const WSTATS = [['sent', 'Sent', 'green'], ['delivered', 'Delivered', 'blue'], ['read', 'Read', 'blue'], ['not_read', 'Delivered, not read', ''], ['failed', 'Failed', 'red']]

	V.Integrations = {
		props: { part: { type: String, default: 'email' } },
		setup() {
			const loading = ref(true); const error = ref(''); const d = ref({ email: [], whatsapp: { installed: false, accounts: [] }, regions: [], ses: {}, limits: {} })
			const dlg = ref(''); const busy = ref(false); const f = reactive({ email_id: '', region: 'ap-south-1', smtp_user: '', smtp_password: '', app_password: '', receive: true, use: false })
			const working = ref(''); const res = reactive({}); const wd = ref(''); const wf = reactive({ name: '', account_name: '', phone_id: '', business_id: '', app_id: '', version: 'v21.0', token: '', send: false, recv: false }); const gone = ref(null)
			async function load() {
				try { d.value = await call('get_integrations'); error.value = '' } catch (e) { error.value = e.message } finally { loading.value = false }
			}
			onMounted(load)
			const sending = computed(() => d.value.email.find((a) => a.sending))
			const hasSes = computed(() => d.value.email.some((a) => a.kind === 'ses'))
			function open(kind) { Object.assign(f, { email_id: '', smtp_user: '', smtp_password: '', app_password: '', receive: true, use: !d.value.email.some((a) => a.sending) }); dlg.value = kind }
			async function add() {
				busy.value = true
				try {
					if (dlg.value === 'ses') await call('add_ses', { email_id: f.email_id, region: f.region, smtp_user: f.smtp_user, smtp_password: f.smtp_password, use_for_sending: f.use ? 1 : 0 })
					else await call('add_gmail', { email_id: f.email_id, app_password: f.app_password, receive: f.receive ? 1 : 0, use_for_sending: f.use ? 1 : 0 })
					CM.toast((dlg.value === 'ses' ? 'Amazon SES' : 'Gmail') + ' connected'); dlg.value = ''; f.smtp_password = f.app_password = ''; await load()
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
			async function copy(text) { try { await navigator.clipboard.writeText(text); CM.toast('Copied') } catch (e) { CM.toast('Select the address and copy it', 'err') } }
			const when = (s) => (s ? CM.fmt(s) : '')
			return { loading, error, d, dlg, f, busy, working, sending, hasSes, open, add, use, test, copy, NAME, STATS, when, res, testConn, wd, wf, gone, openWa, saveWa, setWa, testWa, disconnect, WSTATS }
		},
		template: `
		<div class="page it-page">
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<section v-if="part !== 'whatsapp'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Email</b><div class="small muted">Every email the CRM sends (campaigns, lead emails, notifications) goes out from the account marked <b>Sending</b>. Only an administrator can change it.</div></div>
						<Btn icon="plus" @click="open('gmail')">Add Gmail</Btn><Btn variant="primary" icon="plus" @click="open('ses')">Add Amazon SES</Btn></div>
					<Empty v-if="!d.email.length" icon="mail" title="No email account yet" text="Add Gmail or Amazon SES to start sending." />
					<div v-for="a in d.email" :key="a.name" class="it-acc" :class="{ on: a.sending }">
						<div class="it-ic" :class="a.kind"><Ico :name="a.kind === 'other' ? 'mail' : 'send'" /></div>
						<div class="it-main">
							<div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ NAME[a.kind] }}</b><span class="muted">{{ a.email_id }}</span>
								<span v-if="a.sending" class="badge green">Sending</span><span v-if="!a.outgoing" class="badge">Receives only</span><span v-if="a.incoming" class="badge blue">Receives replies</span><span v-if="a.region" class="badge">{{ a.region }}</span><span v-if="a.needs_password" class="badge amber">Password needed</span></div>
							<div class="it-stats"><span v-for="s in STATS" :key="s[0]" class="it-s" :class="s[2]"><b>{{ a.stats[s[0]] }}</b>{{ s[1] }}</span><span class="small faint">last 30 days</span></div>
							<div v-if="res[a.name]" class="small it-res" :class="res[a.name].ok ? 'ok' : 'bad'" role="status"><Ico :name="res[a.name].ok ? 'check-circle' : 'x-circle'" size="sm" /> {{ res[a.name].message }}</div>
							<div v-if="a.sending && a.kind === 'gmail'" class="small it-warn"><Ico name="alert" size="sm" /> Gmail stops after about {{ d.limits.gmail }} emails a day. For bigger campaigns connect Amazon SES and switch sending to it.</div>
						</div>
						<div class="it-act"><Btn v-if="a.outgoing && !a.sending" size="sm" :loading="working === a.name" @click="use(a)">Use for sending</Btn><Btn size="sm" variant="ghost" icon="check-circle" :loading="working === 'c' + a.name" @click="testConn(a)">Test connection</Btn><Btn v-if="a.outgoing" size="sm" variant="ghost" icon="send" :loading="working === 't' + a.name" @click="test(a)">Send test email</Btn></div>
					</div>
				</section>

				<section v-if="part !== 'whatsapp'" class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Amazon SES delivery tracking</b><div class="small muted">SES tells the CRM what happened to each email: delivered, bounced or marked as spam. Bounced and spam addresses are kept off future campaigns.</div></div>
						<span class="badge" :class="d.ses.subscribed ? 'green' : 'amber'">{{ d.ses.subscribed ? 'Connected' : 'Not connected yet' }}</span></div>
					<ol class="it-steps">
						<li>In the AWS console open <b>Amazon SNS</b>, create a <b>Standard</b> topic (for example <i>crm-email-events</i>).</li>
						<li>On that topic choose <b>Create subscription</b>, protocol <b>HTTPS</b>, and paste this address. It confirms itself.</li>
						<li>In <b>Amazon SES</b> open your verified domain or address, then <b>Notifications</b>, and pick that topic for <b>Bounces</b>, <b>Complaints</b> and <b>Deliveries</b>.</li>
					</ol>
					<div class="row it-url"><code class="grow">{{ d.ses.webhook_url }}</code><Btn size="sm" icon="copy" @click="copy(d.ses.webhook_url)">Copy</Btn></div>
					<div class="small muted" style="margin-top:8px">{{ d.ses.last_event ? 'Last report from SES: ' + when(d.ses.last_event) : 'No report from SES yet.' }} Anyone with this address cannot change anything without Amazon's signature.</div>
					<div class="small muted" style="margin-top:4px">New SES accounts can only send to verified addresses until Amazon moves them out of the <b>sandbox</b>; request production access in the SES console. Read and not-read counts come from the CRM's own tracking and work with every provider.</div>
				</section>

				<template v-if="part === 'whatsapp'">
					<section class="card it-card">
						<div class="row it-h"><div class="grow"><b class="it-t">WhatsApp numbers</b><div class="small muted">The WhatsApp Business numbers the CRM sends from. One number sends all messages and one receives replies; only an administrator can change that. To use a different number, connect it here, make it the sending number, then disconnect the old one.</div></div>
							<Btn v-if="d.whatsapp.installed" variant="primary" icon="plus" @click="openWa(null)">Connect a number</Btn></div>
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
					<section v-if="d.whatsapp.installed" class="card it-card">
						<div class="row it-h"><div class="grow"><b class="it-t">Where to find the details</b><div class="small muted">All of these are in your Meta account. Nothing here creates anything at Meta.</div></div></div>
						<ol class="it-steps">
							<li>Open <b>developers.facebook.com</b>, your app, then <b>WhatsApp</b> and <b>API Setup</b>. Copy the <b>Phone number ID</b> and the <b>WhatsApp Business Account ID</b>. The <b>App ID</b> is under App settings, Basic.</li>
							<li>For the <b>access token</b> use a permanent one: in Business Settings create a <b>System user</b>, give it the app and the permissions <i>whatsapp_business_messaging</i> and <i>whatsapp_business_management</i>, then generate the token. The temporary token on API Setup stops working after a day.</li>
							<li>To receive replies and delivery updates, open <b>WhatsApp, Configuration</b> in the same app. Paste the callback address and verify token below, verify, and subscribe to <b>messages</b>.</li>
						</ol>
						<div class="it-kv"><span>Callback address</span><b class="it-code">{{ d.whatsapp.webhook_url }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(d.whatsapp.webhook_url)">Copy</Btn></b>
							<template v-for="w in d.whatsapp.accounts" :key="w.name"><span>Verify token ({{ w.title }})</span><b class="it-code">{{ w.verify_token }} <Btn size="sm" variant="ghost" icon="copy" @click="copy(w.verify_token)">Copy</Btn></b></template></div>
						<div class="small muted" style="margin-top:10px">Message templates belong to the Meta business account. If you move to a number in a different business account, create and get approval for the templates there; campaigns can only use approved templates.</div>
					</section>
				</template>
			</template>

			<Modal v-if="dlg" size="md" :title="dlg === 'ses' ? 'Connect Amazon SES' : 'Connect Gmail'" :subtitle="dlg === 'ses' ? 'Use the SMTP details from the SES console (SMTP settings, Create SMTP credentials), not your AWS access keys.' : 'Use an app password: Google Account, Security, 2-Step Verification, App passwords.'" @close="dlg = ''" @submit="add">
				<div class="it-form">
					<Field :label="dlg === 'ses' ? 'From email address (verified in SES)' : 'Gmail address'" required><Inp v-model="f.email_id" placeholder="you@yourcompany.com" autofocus /></Field>
					<Field v-if="dlg === 'ses'" label="Region" hint="The region where your SES account is set up."><Dd v-model="f.region" :options="d.regions" searchable /></Field>
					<Field v-if="dlg === 'ses'" label="SMTP user name" required><Inp v-model="f.smtp_user" placeholder="AKIA..." /></Field>
					<Field v-if="dlg === 'ses'" label="SMTP password" required hint="Saved safely. It is not shown again."><Inp v-model="f.smtp_password" type="password" /></Field>
					<Field v-if="dlg === 'gmail'" label="App password" required hint="16 letters. Saved safely. It is not shown again."><Inp v-model="f.app_password" type="password" /></Field>
					<div v-if="dlg === 'gmail'" class="row it-sw"><div class="grow"><b>Also receive replies</b><div class="small muted">Emails sent to this address appear on the lead.</div></div><Switch v-model="f.receive" label="Also receive replies" /></div>
					<div class="row it-sw"><div class="grow"><b>Send all emails from this account</b><div class="small muted">Campaigns, lead emails and notifications.</div></div><Switch v-model="f.use" label="Send all emails from this account" /></div>
				</div>
				<template #foot><Btn @click="dlg = ''">Cancel</Btn><Btn variant="primary" :loading="busy" @click="add">Connect</Btn></template>
			</Modal>
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
