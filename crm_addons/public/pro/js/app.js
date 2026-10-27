/* Suite Pro app: the shell at /crm-pro. A left menu with every Suite Pro page: the ones that are native here (Notifications ...) and the existing ones shown in a frame. */
(() => {
	const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const ver = () => (PRO.shell.config && PRO.shell.config.asset_version) || new URLSearchParams(location.search).get('v') || ''

	// existing pages, shown in a frame (their own left menus stay inside them)
	const FRAMES = {
		dashboard: 'meetings/dashboard.html', followups: 'meetings/followups.html', meetings: 'meetings/index.html', campaigns: 'campaigns/index.html',
		assignment: 'campaigns/assignment.html', bookings: 'demos/index.html', access: 'access/index.html', settings: 'setup/index.html',
	}

	/** Which menu rows this person gets: the same rules as the CRM's left menu. */
	function menu(c) {
		if (!c) return []
		const a = c.access || {}
		const campaignAccess = ['campaigns', 'automations', 'email_templates', 'whatsapp_templates', 'audiences'].some((k) => a[k] !== undefined && a[k] !== 'none') || !!Number(a.campaign_reports) || !!Number(a.list_cleanup)
		const rows = [
			{ key: 'notifications', label: 'Notifications', icon: 'bell', native: true, badge: true },
			{ key: 'dashboard', label: 'Sales Dashboard', icon: 'chart' },
		]
		if (c.follow_ups_enabled !== 0) rows.push({ key: 'followups', label: 'Follow-ups', icon: 'phone' })
		rows.push({ key: 'meetings', label: 'Meetings', icon: 'calendar' })
		if (c.campaigns_enabled !== 0 && campaignAccess) rows.push({ key: 'campaigns', label: 'Campaigns', icon: 'send' })
		if (c.can_assign) rows.push({ key: 'assignment', label: 'Assignment', icon: 'users' })
		if (c.demos_enabled !== 0 && (a.demos !== 'none' || (a.demo_widgets || 'none') !== 'none' || Number(a.demo_report))) rows.push({ key: 'bookings', label: 'Bookings', icon: 'target' })
		if (c.can_manage_access) { rows.push({ key: 'access', label: 'Team and access', icon: 'shield' }); rows.push({ key: 'settings', label: 'Settings', icon: 'settings' }) }
		return rows
	}

	V.Frame = {
		props: { page: String },
		setup(props) {
			const theme = document.documentElement.getAttribute('data-theme') || 'light'
			const src = computed(() => '/assets/crm_addons/' + FRAMES[props.page] + '?embed=1&theme=' + theme + '&v=' + encodeURIComponent(ver()))
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
			return { src, el, tidy }
		},
		template: `<iframe ref="el" class="pro-frame" :src="src" :title="page" @load="tidy"></iframe>`,
	}

	const App = {
		setup() {
			const r = CM.route
			const items = computed(() => menu(PRO.shell.config))
			const active = computed(() => { const k = r.parts[0] || 'notifications'; return items.value.some((i) => i.key === k) ? k : (items.value[0] ? items.value[0].key : 'notifications') })
			const current = computed(() => items.value.find((i) => i.key === active.value) || {})
			onMounted(() => { PRO.loadShell(); CM.loadShared() })
			let saved = false; try { saved = localStorage.getItem('pro_rail_collapsed') === '1' } catch (e) { /* storage blocked */ }
			const collapsed = ref(saved)
			const toggleRail = () => { collapsed.value = !collapsed.value; try { localStorage.setItem('pro_rail_collapsed', collapsed.value ? '1' : '0') } catch (e) { /* not remembered */ } }
			watch(active, () => { document.title = (current.value.label || 'Suite Pro') + ' - ' + (PRO.shell.brand.name || 'Suite Pro') })
			// the unread count stays fresh while the page is open
			let t; onMounted(() => { t = setInterval(async () => { if (!document.hidden) { try { PRO.shell.unread = (await PRO.api('get_shell', {})).unread } catch (e) { /* later */ } } }, 120000) }); onBeforeUnmount(() => clearInterval(t))
			return { items, active, current, collapsed, toggleRail, PRO, FRAMES }
		},
		template: `
		<div class="app" :class="{ 'rail-collapsed': collapsed }">
			<nav class="rail" :class="{ collapsed }" aria-label="Suite Pro">
				<div class="brand"><img v-if="PRO.shell.brand.logo" :src="PRO.shell.brand.logo" alt="" class="brand-img" /><span v-else class="brand-ico" aria-hidden="true"><Ico name="grid2" /></span><div class="brand-txt"><b>{{ PRO.shell.brand.name || 'Suite Pro' }}</b><span>{{ PRO.shell.full_name }}</span></div></div>
				<a v-for="n in items" :key="n.key" :href="'#/' + n.key" class="nav" :class="{ on: active === n.key }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === n.key ? 'page' : null"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span><span v-if="n.badge && PRO.shell.unread" class="pro-badge">{{ PRO.shell.unread > 99 ? '99+' : PRO.shell.unread }}</span></a>
				<div class="rail-foot">
					<a class="nav" href="/crm" :title="collapsed ? 'Frappe CRM' : null" aria-label="Open the CRM"><Ico name="house" /><span class="nav-l">Open the CRM</span></a>
					<button type="button" class="nav rail-toggle" @click="toggleRail" :title="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-expanded="String(!collapsed)"><Ico :name="collapsed ? 'chevron-right' : 'chevron-left'" /><span class="nav-l">Collapse menu</span></button>
				</div>
			</nav>
			<main class="main">
				<div v-if="PRO.shell.error" class="page"><Empty icon="alert" title="Could not start" :text="PRO.shell.error"><a class="btn primary" href="/login?redirect-to=/crm-pro">Log in</a></Empty></div>
				<div v-else-if="!PRO.shell.loaded" class="page"><Skel h="40" r="10" /><Skel h="300" r="12" /></div>
				<Notifications v-else-if="active === 'notifications'" :key="'n'" />
				<Frame v-else :page="active" :key="active" />
			</main>
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
