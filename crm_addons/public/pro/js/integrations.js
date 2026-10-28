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

	V.Integrations = {
		setup() {
			const loading = ref(true); const error = ref(''); const d = ref({ email: [], whatsapp: { installed: false, accounts: [] }, regions: [], ses: {}, limits: {} })
			const dlg = ref(''); const busy = ref(false); const f = reactive({ email_id: '', region: 'ap-south-1', smtp_user: '', smtp_password: '', app_password: '', receive: true, use: false })
			const working = ref('')
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
			async function copy(text) { try { await navigator.clipboard.writeText(text); CM.toast('Copied') } catch (e) { CM.toast('Select the address and copy it', 'err') } }
			const when = (s) => (s ? CM.fmt(s) : '')
			return { loading, error, d, dlg, f, busy, working, sending, hasSes, open, add, use, test, copy, NAME, STATS, when }
		},
		template: `
		<div class="page it-page">
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<section class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">Email</b><div class="small muted">Every email the CRM sends (campaigns, lead emails, notifications) goes out from the account marked <b>Sending</b>. Only an administrator can change it.</div></div>
						<Btn icon="plus" @click="open('gmail')">Add Gmail</Btn><Btn variant="primary" icon="plus" @click="open('ses')">Add Amazon SES</Btn></div>
					<Empty v-if="!d.email.length" icon="mail" title="No email account yet" text="Add Gmail or Amazon SES to start sending." />
					<div v-for="a in d.email" :key="a.name" class="it-acc" :class="{ on: a.sending }">
						<div class="it-ic" :class="a.kind"><Ico :name="a.kind === 'other' ? 'mail' : 'send'" /></div>
						<div class="it-main">
							<div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ NAME[a.kind] }}</b><span class="muted">{{ a.email_id }}</span>
								<span v-if="a.sending" class="badge green">Sending</span><span v-if="!a.outgoing" class="badge">Receives only</span><span v-if="a.incoming" class="badge blue">Receives replies</span><span v-if="a.region" class="badge">{{ a.region }}</span><span v-if="a.needs_password" class="badge amber">Password needed</span></div>
							<div class="it-stats"><span v-for="s in STATS" :key="s[0]" class="it-s" :class="s[2]"><b>{{ a.stats[s[0]] }}</b>{{ s[1] }}</span><span class="small faint">last 30 days</span></div>
							<div v-if="a.sending && a.kind === 'gmail'" class="small it-warn"><Ico name="alert" size="sm" /> Gmail stops after about {{ d.limits.gmail }} emails a day. For bigger campaigns connect Amazon SES and switch sending to it.</div>
						</div>
						<div class="it-act"><Btn v-if="a.outgoing && !a.sending" size="sm" :loading="working === a.name" @click="use(a)">Use for sending</Btn><Btn v-if="a.outgoing" size="sm" variant="ghost" icon="send" :loading="working === 't' + a.name" @click="test(a)">Send test</Btn></div>
					</div>
				</section>

				<section class="card it-card">
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

				<section class="card it-card">
					<div class="row it-h"><div class="grow"><b class="it-t">WhatsApp</b><div class="small muted">The WhatsApp Business account the CRM sends from. It is connected in the WhatsApp app; this is only what is connected now.</div></div></div>
					<div v-if="!d.whatsapp.installed" class="small muted">WhatsApp is not installed on this site.</div>
					<Empty v-else-if="!d.whatsapp.accounts.length" icon="whatsapp" title="No WhatsApp account" text="Connect one in the WhatsApp app and it will appear here." />
					<div v-for="w in d.whatsapp.accounts" :key="w.name" class="it-acc" :class="{ on: w.sending }">
						<div class="it-ic wa"><Ico name="whatsapp" /></div>
						<div class="it-main"><div class="row" style="gap:8px;flex-wrap:wrap"><b>{{ w.title }}</b><span v-if="w.phone_id" class="muted">Phone ID {{ w.phone_id }}</span><span class="badge" :class="w.status.toLowerCase() === 'active' ? 'green' : 'amber'">{{ w.status || 'Not active' }}</span><span v-if="w.sending" class="badge green">Sending</span><span v-if="w.receiving" class="badge blue">Receiving</span></div></div>
					</div>
				</section>
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
		</div>`,
	}
})()
