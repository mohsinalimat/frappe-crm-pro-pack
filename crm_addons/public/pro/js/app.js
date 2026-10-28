/* Suite Pro app: the shell at /crm-pro. A left menu with every Suite Pro page: the ones that are native here (Notifications ...) and the existing ones shown in a frame. */
(() => {
	const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const ver = () => (PRO.shell.config && PRO.shell.config.asset_version) || new URLSearchParams(location.search).get('v') || ''

	// existing pages, shown in a frame (their own left menus stay inside them)
	const FRAMES = {
		dashboard: 'meetings/dashboard.html', followups: 'meetings/followups.html', meetings: 'meetings/index.html', campaigns: 'campaigns/index.html', templates: 'campaigns/index.html',
		assignment: 'campaigns/assignment.html', bookings: 'demos/index.html', access: 'access/index.html', settings: 'setup/index.html',
	}

	/** Which menu rows this person gets: the same rules as the CRM's left menu. */
	function menu(c) {
		if (!c) return []
		const a = c.access || {}
		const campaignAccess = ['campaigns', 'automations', 'email_templates', 'whatsapp_templates', 'audiences'].some((k) => a[k] !== undefined && a[k] !== 'none') || !!Number(a.campaign_reports) || !!Number(a.list_cleanup)
		const shown = (k) => a[k] === undefined || (typeof a[k] === 'string' ? a[k] !== 'none' : !!Number(a[k])) // a page the person has no access to is hidden, not greyed out
		const rows = [{ key: 'notifications', label: 'Notifications', icon: 'bell', native: true, badge: true }]
		if (shown('dashboard')) rows.push({ key: 'dashboard', label: 'Sales Dashboard', icon: 'chart' })
		if (shown('leads')) rows.push({ key: 'leads', label: 'Leads', icon: 'users', native: true })
		if (c.follow_ups_enabled !== 0 && shown('followups')) rows.push({ key: 'followups', label: 'Follow-ups', icon: 'phone' })
		if (shown('organizations')) rows.push({ key: 'organizations', label: 'Organizations', icon: 'building', native: true })
		if (shown('meetings')) rows.push({ key: 'meetings', label: 'Meetings', icon: 'calendar' })
		if (c.campaigns_enabled !== 0 && campaignAccess) { rows.push({ key: 'campaigns', label: 'Campaigns', icon: 'send' }); if (['email_templates', 'whatsapp_templates'].some((k) => shown(k)) || !!Number(a.campaign_create)) rows.push({ key: 'templates', label: 'Templates', icon: 'file' }) }
		if (c.can_assign) rows.push({ key: 'assignment', label: 'Assignment', icon: 'users' })
		if (c.demos_enabled !== 0 && (a.demos !== 'none' || (a.demo_widgets || 'none') !== 'none' || Number(a.demo_report))) rows.push({ key: 'bookings', label: 'Bookings', icon: 'target' })
		if (c.can_manage_access || (a.team && a.team !== 'none')) rows.push({ key: 'access', label: 'Team', icon: 'shield' })
		if (c.can_manage_access) rows.push({ key: 'settings', label: 'Settings', icon: 'settings', native: true })
		return rows
	}


	/** The signed-in person at the bottom of the left menu: a small card with Profile, a theme choice and Log out. */
	V.ProfileMenu = {
		props: { collapsed: Boolean },
		setup() {
			const open = ref(false); const dlg = ref(false); const busy = ref(false); const err = ref(''); const sec = ref('profile'); const edit = ref(false)
			const theme = ref((() => { try { return localStorage.getItem('crm_addons_theme_pref') || 'auto' } catch (e) { return 'auto' } })())
			const p = reactive({ first_name: '', last_name: '', mobile_no: '', email: '', designation: '', company: '', role: '', reports_to: '', joined: '', full_name: '' }); const pw = reactive({ old: '', n1: '', n2: '' })
			function setTheme(t) {
				theme.value = t
				const eff = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t
				try { localStorage.setItem('crm_addons_theme_pref', t); if (t === 'auto') { localStorage.removeItem('theme'); localStorage.removeItem('crm_addons_theme') } else { localStorage.setItem('theme', t); localStorage.setItem('crm_addons_theme', t) } } catch (e) { /* not remembered */ }
				document.documentElement.setAttribute('data-theme', eff)
			}
			async function openProfile(s) { open.value = false; err.value = ''; sec.value = s || 'profile'; edit.value = false; dlg.value = true; try { Object.assign(p, await PRO.api('get_profile', {})) } catch (e) { err.value = e.message } }
			async function save() { busy.value = true; err.value = ''; try { const r = await PRO.api('update_profile', { first_name: p.first_name, last_name: p.last_name, mobile_no: p.mobile_no, designation: p.designation, company: p.company }); Object.assign(p, r); PRO.shell.full_name = r.full_name; edit.value = false; CM.toast('Profile saved') } catch (e) { err.value = e.message } finally { busy.value = false } }
			async function changePw() {
				if (pw.n1 !== pw.n2) { err.value = 'The two new passwords are not the same.'; return }
				busy.value = true; err.value = ''
				try { await PRO.api('change_password', { old_password: pw.old, new_password: pw.n1 }); pw.old = pw.n1 = pw.n2 = ''; CM.toast('Password changed') } catch (e) { err.value = e.message } finally { busy.value = false }
			}
			const ROLE = { 'System Manager': ['Administrator', 'You can manage the whole CRM, its settings and its people.'], 'Sales Manager': ['Sales Manager', 'You can see and manage your team\'s leads, meetings and follow-ups.'], 'Sales User': ['Sales User', 'You can manage your own leads, meetings and follow-ups.'] }
			const role = computed(() => ROLE[p.role] || [p.role || 'Team member', 'What you can see and change is set by an administrator.'])
			const logout = () => { location.href = '/api/method/logout' }
			const onDoc = (e) => { if (open.value && !(e.target.closest && e.target.closest('.pf-wrap'))) open.value = false }
			onMounted(() => document.addEventListener('click', onDoc)); onBeforeUnmount(() => document.removeEventListener('click', onDoc))
			const SECS = [['profile', 'Profile', 'user'], ['security', 'Account & security', 'shield'], ['prefs', 'Preferences', 'settings']]
			return { open, dlg, busy, err, sec, edit, theme, setTheme, p, pw, openProfile, save, changePw, logout, role, SECS, PRO, CM }
		},
		template: `
		<div class="pf-wrap">
			<div v-if="open" class="pf-card">
				<div class="pf-me"><Avatar :name="PRO.shell.full_name || PRO.shell.user" :size="36" /><div style="min-width:0"><b class="ellipsis" style="display:block">{{ PRO.shell.full_name }}</b><span class="small muted ellipsis" style="display:block">{{ PRO.shell.user }}</span></div></div>
				<button type="button" class="pf-i" @click="openProfile('profile')"><Ico name="user" /> My profile</button>
				<button type="button" class="pf-i" @click="openProfile('security')"><Ico name="shield" /> Account &amp; security</button>
				<div class="pf-th" role="group" aria-label="Theme"><button v-for="t in [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'monitor']]" :key="t[0]" type="button" :class="{ on: theme === t[0] }" :aria-pressed="theme === t[0]" @click="setTheme(t[0])"><Ico :name="t[2]" size="sm" />{{ t[1] }}</button></div>
				<button type="button" class="pf-i danger" @click="logout"><Ico name="log-out" /> Log out</button>
			</div>
			<button type="button" class="nav pf-btn" :title="collapsed ? PRO.shell.full_name : null" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open"><Avatar :name="PRO.shell.full_name || PRO.shell.user" :size="24" /><span class="nav-l ellipsis">{{ PRO.shell.full_name || PRO.shell.user }}</span><Ico name="chevron-up" size="sm" class="nav-l" style="margin-left:auto" /></button>
			<Modal v-if="dlg" size="xl" title="My profile" subtitle="Manage your personal information and account settings." @close="dlg = false" @submit="save">
				<div class="pfm">
					<nav class="pfm-nav" aria-label="Profile sections"><button v-for="s in SECS" :key="s[0]" type="button" :class="{ on: sec === s[0] }" @click="sec = s[0]; err = ''"><Ico :name="s[2]" />{{ s[1] }}</button></nav>
					<div class="pfm-main">
						<div v-if="err" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ err }}</div></div>
						<template v-if="sec === 'profile'">
							<div class="pfm-hero card"><Avatar :name="p.full_name || p.user" :size="68" /><div class="grow" style="min-width:0"><h3 style="margin:0">{{ p.full_name }}</h3><div class="muted">{{ [p.designation, p.company].filter(Boolean).join(' - ') || 'Add your designation and company below' }}</div>
								<div class="row wrap" style="gap:16px;margin-top:8px"><span class="small muted"><Ico name="mail" size="sm" /> {{ p.email }}</span><span v-if="p.mobile_no" class="small muted"><Ico name="phone" size="sm" /> {{ p.mobile_no }}</span></div></div></div>
							<section class="card pfm-sec"><div class="row"><b class="grow">Personal information</b><Btn size="sm" :icon="edit ? 'x' : 'edit'" @click="edit = !edit">{{ edit ? 'Cancel' : 'Edit' }}</Btn></div>
								<div class="g2"><Field label="First name" required><Inp icon="user" v-model="p.first_name" :disabled="!edit" aria-label="First name" /></Field><Field label="Last name"><Inp icon="user" v-model="p.last_name" :disabled="!edit" aria-label="Last name" /></Field></div>
								<div class="g2"><Field label="Email" hint="Your login. An administrator changes it."><Inp icon="mail" :modelValue="p.email" disabled aria-label="Email" /></Field><Field label="Contact number"><Inp icon="phone" v-model="p.mobile_no" :disabled="!edit" aria-label="Contact number" /></Field></div></section>
							<section class="card pfm-sec"><div class="row"><b class="grow">Job and team</b></div>
								<div class="g2"><Field label="Designation"><Inp icon="briefcase" v-model="p.designation" :disabled="!edit" aria-label="Designation" /></Field><Field label="Company"><Inp icon="building" v-model="p.company" :disabled="!edit" aria-label="Company" /></Field></div>
								<div class="g2"><Field label="Reports to" hint="Set by an administrator."><Inp icon="user" :modelValue="p.reports_to || 'Nobody'" disabled aria-label="Reports to" /></Field></div></section>
						</template>
						<section v-if="sec === 'security'" class="card pfm-sec"><b>Password</b><p class="small muted" style="margin:0">Use at least 8 characters. You stay signed in on this device.</p>
							<div class="g3"><Field label="Current password"><Inp icon="lock" v-model="pw.old" type="password" aria-label="Current password" /></Field><Field label="New password"><Inp icon="lock" v-model="pw.n1" type="password" aria-label="New password" /></Field><Field label="New password again"><Inp icon="lock" v-model="pw.n2" type="password" aria-label="New password again" /></Field></div>
							<div><Btn variant="primary" :loading="busy" :disabled="!pw.old || !pw.n1" @click="changePw">Change password</Btn></div></section>
						<section v-if="sec === 'prefs'" class="card pfm-sec"><b>Theme</b><p class="small muted" style="margin:0">How the CRM looks for you on this device.</p>
							<div class="pf-th" style="max-width:320px"><button v-for="t in [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'monitor']]" :key="t[0]" type="button" :class="{ on: theme === t[0] }" @click="setTheme(t[0])"><Ico :name="t[2]" size="sm" />{{ t[1] }}</button></div></section>
					</div>
					<aside class="pfm-side">
						<section class="card pfm-sec"><b>My role</b><div class="pfm-role"><Ico name="user" /> {{ role[0] }}</div><p class="small muted" style="margin:0">{{ role[1] }}</p></section>
						<section class="card pfm-sec"><b>Quick info</b>
							<div v-if="p.company" class="pfm-q"><Ico name="building" size="sm" /><span>{{ p.company }}</span></div>
							<div v-if="p.reports_to" class="pfm-q"><Ico name="user" size="sm" /><span>Reports to {{ p.reports_to }}</span></div>
							<div class="pfm-q"><Ico name="calendar" size="sm" /><span>Joined {{ CM.fmtDate(p.joined) }}</span></div></section>
					</aside>
				</div>
				<template #foot><button type="button" class="btn pf-out" @click="logout"><Ico name="log-out" /> Log out</button><span class="grow"></span><Btn @click="dlg = false">Close</Btn><Btn v-if="sec === 'profile'" variant="primary" icon="save" :loading="busy" :disabled="!edit" @click="save">Save changes</Btn></template>
			</Modal>
		</div>`,
	}

	V.Frame = {
		props: { page: String, tab: String },
		setup(props) {
			const theme = document.documentElement.getAttribute('data-theme') || 'light'
			const first = props.tab
			const src = computed(() => '/assets/crm_addons/' + FRAMES[props.page] + '?embed=1&inline=1&pro=1&theme=' + theme + (first ? '&tab=' + encodeURIComponent(first) : '') + (props.page === 'templates' ? '&only=templates' : props.page === 'campaigns' ? '&only=campaigns' : '') + '&v=' + encodeURIComponent(ver()))
			const el = ref(null)
			// the pages draw a close / open-in-a-tab toolbar when they are a pop-up: not wanted here
			function tidy() {
				try {
					const d = el.value.contentDocument; if (!d || d.getElementById('pro-tidy')) return
					const s = d.createElement('style'); s.id = 'pro-tidy'
					s.textContent = '.embed-ctl, [aria-label="Close"].icon, [title="Close (Esc)"], [title="Open in a new tab"] { display: none !important; }'
					d.head.appendChild(s)
				} catch (e) { /* not ours */ }
			}
			watch(() => props.tab, (t) => { try { if (t && el.value) el.value.contentWindow.postMessage({ source: 'pro-shell', tab: t }, location.origin) } catch (e) { /* the page is not there yet */ } })
			return { src, el, tidy }
		},
		template: `<iframe ref="el" class="pro-frame" :src="src" :title="page" @load="tidy"></iframe>`,
	}

	// The settings, sorted into a few groups for the menu on the left
	const LF = 'Leads and sales'
	const SALES = ['followups', 'insights', 'dashboard'] // one menu entry: Follow-ups, Scoring and stale leads, Sales Dashboard counts
	const tabOf = (t) => (SALES.includes(t) ? 'sales' : t)
	const GROUP_OF = { branding: 'General', ui: 'General', views: 'General', leads: LF, orgs: LF, forms: LF, meetings: LF, followups: LF, insights: LF, dashboard: LF, campaigns: 'Campaigns', alerts: 'Campaigns', prices: 'Campaigns' }
	const GROUP_ICON = { General: 'settings', [LF]: 'briefcase', Campaigns: 'send', Other: 'settings' }
	const SHORT = { start: 'Checklist', branding: 'Branding', ui: 'Screen', views: 'Default views', leads: 'Lead page', orgs: 'Organization page', forms: 'Forms', sales: 'Sales' } // the short names on the tabs
	const TAB_ICON = { start: 'list', branding: 'palette', ui: 'monitor', views: 'columns', leads: 'users', orgs: 'building', forms: 'rows', sales: 'trend', meetings: 'calendar', followups: 'phone', insights: 'chart', dashboard: 'chart', campaigns: 'send', alerts: 'alert', prices: 'hash' }
	PRO.settingsGroups = () => {
		const all = [{ value: 'start', label: 'Setup checklist', group: 'General' }, ...((window.SETUP_SCHEMA || []).filter((g) => !SALES.includes(g.key)).map((g) => ({ value: g.key, label: g.title, group: GROUP_OF[g.key] || 'Other' }))), { value: 'leads', label: 'Lead page', group: LF }, { value: 'orgs', label: 'Organization page', group: LF }, { value: 'forms', label: 'Add forms', group: LF }, { value: 'sales', label: 'Follow-ups, scoring and sales', group: LF }].map((x) => ({ ...x, short: SHORT[x.value] || x.label, icon: TAB_ICON[x.value] || 'settings' }))
		return ['General', LF, 'Campaigns', 'Other'].map((t) => ({ title: t, icon: GROUP_ICON[t], items: all.filter((x) => x.group === t) })).filter((g) => g.items.length)
	}
	// one search over every setting: each option, and the pages that have no list of options (Branding, Default views, Leads screen)
	PRO.settingsSearch = (term) => {
		const t = String(term || '').trim().toLowerCase(); if (!t) return []
		const hit = (s) => String(s || '').toLowerCase().includes(t)
		const groups = PRO.settingsGroups(); const groupOf = (tab) => (groups.find((g) => g.items.some((i) => i.value === tab)) || {}).title || ''
		const out = []
		const page = (tab, label, words) => { if (hit(label + ' ' + words)) out.push({ tab, label, sub: groupOf(tab) }) }
		page('start', 'Setup checklist', 'checklist ready connect google calendar')
		page('leads', 'Lead page', 'columns list view filters card fields quick filters sort top row search')
		page('forms', 'Add forms', 'add lead organization person user form fields required options dropdown source industry territory customise')
		page('orgs', 'Organization page', 'organizations filters industry territory top row')
		for (const g of window.SETUP_SCHEMA || []) {
			if (g.custom) page(g.key, g.title, (g.desc || '') + ' ' + (g.words || ''))
			else if (hit(g.title)) out.push({ tab: tabOf(g.key), label: g.title, sub: groupOf(tabOf(g.key)) })
			for (const it of g.items) { if (it.k && (hit(it.label) || hit(it.info && (it.info.what + ' ' + (it.info.eg || '') + ' ' + (it.info.note || ''))))) out.push({ tab: tabOf(g.key), field: it.k, label: it.label, sub: g.title + ' \u00b7 ' + groupOf(tabOf(g.key)) }) }
		}
		return out.slice(0, 12)
	}

	/** Settings: the existing setup page, and the Leads screen setup beside it. */
	V.SettingsPage = {
		props: { tab: String },
		setup(props) {
			const TABS = computed(() => PRO.settingsGroups().flatMap((g) => g.items.map((i) => ({ ...i, group: g.title }))))
			const cur = computed(() => { const t = tabOf(props.tab); return TABS.value.some((x) => x.value === t) ? t : 'start' })
			const first = props.tab && props.tab !== 'leads' && props.tab !== 'orgs' && props.tab !== 'forms' ? props.tab : 'start'
			const frameTab = ref(first); watch(cur, (t) => { if (t !== 'leads' && t !== 'orgs' && t !== 'forms') frameTab.value = t })
			const native = (t) => t === 'leads' || t === 'orgs' || t === 'forms'
			const seen = ref(native(cur.value) ? false : true)   // the setup page loads when first needed, and then stays (its unsaved changes survive a visit to the other tab)
			watch(cur, (t) => { if (!native(t)) seen.value = true })
			const curItem = computed(() => TABS.value.find((t) => t.value === cur.value) || {})
			const group = computed(() => PRO.settingsGroups().find((g) => g.title === curItem.value.group) || { title: 'Settings', items: [] })
			const q = ref(''); const results = computed(() => PRO.settingsSearch(q.value))
			function pick(r) {
				q.value = ''
				if (cur.value !== r.tab) location.hash = '#/settings/' + r.tab
				if (r.field) setTimeout(() => { try { const f = document.querySelector('.settings-body iframe'); f && f.contentWindow.postMessage({ source: 'pro-shell', tab: r.tab, field: r.field }, location.origin) } catch (e) { /* the page is not there yet */ } }, 350)
			}
			return { TABS, cur, curItem, group, frameTab, seen, q, results, pick }
		},
		template: `
		<div class="settings-wrap">
			<div class="subtabs"><div class="st-head set-head"><b class="st-title">{{ group.title }}</b>
				<div id="hdr-ctl" class="st-ctl"><div class="gs"><Inp v-model="q" icon="search" placeholder="Search all settings" clearable aria-label="Search all settings" />
					<div v-if="q.trim()" class="gs-pop" role="listbox"><button v-for="(r, i) in results" :key="i" type="button" class="gs-i" role="option" @click="pick(r)"><b>{{ r.label }}</b><span class="small muted">{{ r.sub }}</span></button><div v-if="!results.length" class="small muted" style="padding:10px">No setting matches "{{ q.trim() }}".</div></div></div></div></div>
				<nav class="st-tabs" :aria-label="group.title"><a v-for="t in group.items" :key="t.value" :href="'#/settings/' + t.value" class="st-tab" :class="{ on: cur === t.value }" :aria-current="cur === t.value ? 'page' : null"><Ico :name="t.icon" size="sm" />{{ t.short }}</a></nav>
			</div>
			<div class="settings-body"><LeadSetup v-if="cur === 'leads'" :key="'cfg'" /><OrgSetup v-else-if="cur === 'orgs'" :key="'orgcfg'" /><FormsSetup v-else-if="cur === 'forms'" :key="'formcfg'" /><Frame v-if="seen" v-show="cur !== 'leads' && cur !== 'orgs' && cur !== 'forms'" page="settings" :tab="frameTab" key="settings" /></div>
		</div>`,
	}

	const App = {
		setup() {
			const r = CM.route
			// Follow-ups (in a frame) asks for an email / WhatsApp to the leads it has selected
			const sendDlg = ref(null); const sendRun = PRO.bulkRun()
			window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.source === 'crm-addons' && e.data.type === 'pro-send' && e.data.names && e.data.names.length) { Object.assign(sendRun, { busy: false, finished: false, done: 0, total: 0, failed: [] }); sendDlg.value = { kind: e.data.kind, names: e.data.names } } })
			async function runSend({ kind, payload }) { if (await PRO.bulkExec(sendRun, kind, payload, sendDlg.value.names) && !sendRun.failed.length) sendDlg.value = null }
			window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.source === 'crm-addons' && e.data.type === 'pro-open-lead' && e.data.name) location.hash = '#/leads/' + encodeURIComponent(e.data.name) })
			window.addEventListener('message', (e) => { // a frame asks the app to open a record: a lead is our own page, anything else goes where it says
				if (e.origin !== location.origin || !e.data || e.data.source !== 'crm-addons' || e.data.type !== 'navigate' || !e.data.url) return
				const m = String(e.data.url).match(/#\/leads\/([^?]+)/)
				if (m) location.hash = '#/leads/' + m[1]; else location.href = e.data.url
			})
			if (!location.hash) CM.replace('/dashboard')   // the shared router starts on Campaigns; this app starts on the Sales Dashboard
			const items = computed(() => menu(PRO.shell.config))
			const active = computed(() => { const k = r.parts[0] && r.parts[0] !== 'notifications' ? r.parts[0] : 'dashboard'; return items.value.some((i) => i.key === k) ? k : (items.value[0] ? items.value[0].key : 'notifications') })
			const current = computed(() => items.value.find((i) => i.key === active.value) || {})
			const health = ref(null); const ntf = ref(false)
			async function checkHealth() { try { const h = await CM.call('crm_addons.pro.compat.get_health', {}); health.value = h.show ? h : null } catch (e) { /* the check is a help, never a blocker */ } }
			async function seen() { try { await CM.call('crm_addons.pro.compat.acknowledge', {}); health.value = null } catch (e) { CM.toast(e.message, 'err') } }
			onMounted(async () => { await PRO.loadShell(); CM.loadShared(); if (PRO.shell.config && PRO.shell.config.can_manage_access) checkHealth() })
			let saved = false; try { saved = localStorage.getItem('pro_rail_collapsed') === '1' } catch (e) { /* storage blocked */ }
			const collapsed = ref(saved)
			const toggleRail = () => { collapsed.value = !collapsed.value; try { localStorage.setItem('pro_rail_collapsed', collapsed.value ? '1' : '0') } catch (e) { /* not remembered */ } }
			watch(() => r.parts[0], (v) => { if (v === 'notifications') { ntf.value = true; location.hash = '#/dashboard' } }, { immediate: true })
			watch(active, () => { document.title = (current.value.label || 'Suite Pro') + ' - ' + (PRO.shell.brand.name || 'Suite Pro') })
			// the unread count stays fresh while the page is open
			let t; onMounted(() => { t = setInterval(async () => { if (!document.hidden) { try { PRO.shell.unread = (await PRO.api('get_shell', {})).unread } catch (e) { /* later */ } } }, 120000) }); onBeforeUnmount(() => clearInterval(t))
			const setOpen = ref(r.parts[0] === 'settings'); watch(() => r.parts[0], (v) => { if (v === 'settings') setOpen.value = true })
			const settingsMenu = computed(() => PRO.settingsGroups())
			return { setOpen, settingsMenu, sendDlg, sendRun, runSend, ntf, health, seen, r, items, active, current, collapsed, toggleRail, PRO, FRAMES }
		},
		template: `
		<div class="app" :class="{ 'rail-collapsed': collapsed }">
			<nav class="rail" :class="{ collapsed }" aria-label="Suite Pro">
				<div class="brand"><img v-if="PRO.shell.brand.logo" :src="PRO.shell.brand.logo" alt="" class="brand-img" /><span v-else class="brand-ico" aria-hidden="true"><Ico name="grid2" /></span><div class="brand-txt"><b>{{ PRO.shell.brand.name || 'Suite Pro' }}</b><span>{{ PRO.shell.full_name }}</span></div></div>
				<template v-for="n in items" :key="n.key"><button v-if="n.key === 'notifications'" type="button" class="nav" :class="{ on: ntf }" :aria-expanded="String(ntf)" :title="collapsed ? n.label : null" :aria-label="n.label" @click="ntf = !ntf"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span><span v-if="n.badge && PRO.shell.unread" class="pro-badge">{{ PRO.shell.unread > 99 ? '99+' : PRO.shell.unread }}</span></button>
								<div v-else-if="n.key === 'settings'" class="nav-grp"><div class="nav-split"><a :href="'#/settings/' + (r.parts[0] === 'settings' && r.parts[1] ? r.parts[1] : 'start')" class="nav" :class="{ on: active === 'settings' }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === 'settings' ? 'page' : null" @click="setOpen = active === 'settings' ? !setOpen : true"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span></a><button v-if="!collapsed" type="button" class="nav-chev" :class="{ open: setOpen }" :aria-expanded="String(setOpen)" aria-label="Show the settings groups" @click="setOpen = !setOpen"><Ico name="chevron-down" size="sm" /></button></div>
									<div v-if="setOpen && !collapsed" class="nav-sub"><a v-for="g in settingsMenu" :key="g.title" :href="'#/settings/' + g.items[0].value" class="nav-sub-i" :class="{ on: active === 'settings' && g.items.some((t) => t.value === (r.parts[1] || 'start')) }"><Ico :name="g.icon" size="sm" />{{ g.title }}</a></div></div>
								<a v-else :href="'#/' + n.key" class="nav" :class="{ on: active === n.key }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === n.key ? 'page' : null"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span><span v-if="n.badge && PRO.shell.unread" class="pro-badge">{{ PRO.shell.unread > 99 ? '99+' : PRO.shell.unread }}</span></a></template>
				<div class="rail-foot">
					<ProfileMenu :collapsed="collapsed" />
					<button type="button" class="nav rail-toggle" @click="toggleRail" :title="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-expanded="String(!collapsed)"><Ico :name="collapsed ? 'chevron-right' : 'chevron-left'" /><span class="nav-l">Collapse menu</span></button>
				</div>
			</nav>
			<main class="main">
				<div v-if="health" class="compat" role="alert"><Ico name="alert" /><div class="grow"><b>Frappe CRM changed or something it needs is missing.</b>
					<ul><li v-for="(p, i) in health.problems" :key="'p' + i" :class="p.level">{{ p.text }}</li><li v-for="(c, i) in health.changes" :key="'c' + i">{{ c }}</li></ul></div>
					<Btn v-if="!health.problems.length" size="sm" @click="seen">I have seen this</Btn></div>
				<div v-if="PRO.shell.error" class="page"><Empty icon="alert" title="Could not start" :text="PRO.shell.error"><a class="btn primary" href="/login?redirect-to=/crm-pro">Log in</a></Empty></div>
				<div v-else-if="!PRO.shell.loaded" class="page"><Skel h="40" r="10" /><Skel h="300" r="12" /></div>
								<Lead v-else-if="active === 'leads' && r.parts[1]" :key="'l' + r.parts[1]" :name="r.parts[1]" />
				<Leads v-else-if="active === 'leads'" :key="'ls'" />
				<Organization v-else-if="active === 'organizations' && r.parts[1]" :key="'o' + r.parts[1]" :name="r.parts[1]" />
				<Organizations v-else-if="active === 'organizations'" :key="'os'" />
				<SettingsPage v-else-if="active === 'settings'" :tab="r.parts[1]" />
				<Frame v-else :page="active" :key="active" />
			</main>
			<template v-if="ntf"><div class="ntf-back" @click="ntf = false"></div><aside class="ntf-panel" role="dialog" aria-label="Notifications" @keydown.esc="ntf = false"><Notifications panel @close="ntf = false" /></aside></template>
			<BulkDialog v-if="sendDlg" :count="sendDlg.names.length" :only="sendDlg.kind ? [sendDlg.kind] : ['email', 'whatsapp']" :start="sendDlg.kind" :owners="[]" :statuses="[]" :run="sendRun" @close="sendDlg = null" @go="runSend" />
			<Toasts /><ConfirmHost />
		</div>`,
	}

	const app = createApp(App)
	Object.entries(CM.components).forEach(([k, v]) => app.component(k, v))
	Object.entries(V).forEach(([k, v]) => app.component(k, v))
	app.config.errorHandler = (err, inst, info) => { console.error('[pro]', err, info); CM.toast('Something went wrong on this page. ' + (err && err.message ? err.message : ''), 'err') }
	document.title = 'Suite Pro'
	app.mount('#app')
})()
