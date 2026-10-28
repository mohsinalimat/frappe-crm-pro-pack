/* Bookings admin: application shell (left rail, router, access check) and mount. */
(() => {
	const { createApp, computed, watch, nextTick, onMounted, onBeforeUnmount, ref } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	// Bookings first, then the widgets (the booking pages), then the report; each shows only if the person's access allows it
	const NAV = [
		{ key: 'bookings', label: 'Bookings', icon: 'users', path: '/bookings', show: (s) => s.demos !== 'none' },
		{ key: 'types', label: 'Widgets', icon: 'calendar', path: '/types', show: (s) => s.widgets !== 'none' },
		{ key: 'report', label: 'Report', icon: 'chart', path: '/report', show: (s) => s.report },
	]

	const App = {
		setup() {
			const r = CM.route
			const view = computed(() => {
				const p = r.parts
				switch (p[0]) {
					case 'types':
						if (p[1]) return { comp: 'DemoEditor', key: 'ed' + p[1], props: { name: p[1], tab: p[2] || 'details' } }
						return { comp: 'DemoTypes', key: 'types' }
					case 'bookings': return { comp: 'Bookings', key: 'bk' }
					case 'report': return { comp: 'Report', key: 'rep' }
					default: return DM.session.demos !== 'none' || DM.session.widgets === 'none' ? { comp: 'Bookings', key: 'bk' } : { comp: 'DemoTypes', key: 'types' }
				}
			})
			const active = computed(() => (r.parts[0] === 'types' ? 'types' : r.parts[0] === 'report' ? 'report' : 'bookings'))
			onMounted(() => { DM.loadSession(); CM.loadShared() })
			let saved = false; try { saved = localStorage.getItem('dm_rail_collapsed') === '1' } catch (e) { /* storage blocked */ }
			const collapsed = ref(saved)
			const toggleRail = () => { collapsed.value = !collapsed.value; try { localStorage.setItem('dm_rail_collapsed', collapsed.value ? '1' : '0') } catch (e) { /* not remembered */ } }
			const canConfigure = computed(() => !!(CM.shared.config && CM.shared.config.can_configure))
			watch(() => view.value.key, () => nextTick(() => CM.scrollTop()))
			function onEsc(e) {
				if (e.key !== 'Escape' || e.defaultPrevented || CM.overlayOpen()) return
				const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { t.blur(); return }
				CM.requestClose()
			}
			if (CM.embed) { onMounted(() => { window.addEventListener('keydown', onEsc); try { window.focus() } catch (e) { /* the host page focuses the frame too */ } }); onBeforeUnmount(() => window.removeEventListener('keydown', onEsc)) }
			function nav(e, path) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; e.preventDefault(); DM.leave(path) }
			const nav_items = computed(() => NAV.filter((n) => n.show(DM.session)))
			const nothing = computed(() => DM.session.ready && !nav_items.value.length)
			return { pro: CM.pro, view, active, NAV: nav_items, nothing, collapsed, toggleRail, canConfigure, s: DM.session, shared: CM.shared, nav, embedded: CM.embed, close: () => CM.requestClose(), newTab: CM.openInTab }
		},
		template: `
		<div class="app" :class="{ 'rail-collapsed': collapsed }">
			<nav class="rail" :class="{ collapsed }" aria-label="Bookings">
				<div class="brand"><span class="brand-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg></span><div class="brand-txt"><b>Bookings</b><span>Frappe CRM Suite Pro</span></div></div>
				<template v-if="!nothing">
				<a v-for="n in NAV" :key="n.key" :href="'#' + n.path" class="nav" :class="{ on: active === n.key }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === n.key ? 'page' : null" @click="nav($event, n.path)"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span></a>
				</template>
				<div class="rail-foot">
					<a v-if="canConfigure" class="nav" href="/pro-pack-setup" target="_blank" rel="noopener" :title="collapsed ? 'Settings' : null" aria-label="Settings"><Ico name="settings" /><span class="nav-l">Settings</span><Ico name="external" size="sm" class="nav-x" style="margin-left:auto" /></a>
					<a v-if="!embedded" class="nav" href="/crm" :title="collapsed ? 'Back to CRM' : null" aria-label="Back to CRM"><Ico name="arrow-left" /><span class="nav-l">Back to CRM</span></a>
					<button type="button" class="nav rail-toggle" @click="toggleRail" :title="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-expanded="String(!collapsed)"><Ico :name="collapsed ? 'chevron-right' : 'chevron-left'" /><span class="nav-l">Collapse menu</span></button>
				</div>
			</nav>
			<div v-if="pro" class="subtabs"><b class="st-title">Bookings</b><nav class="st-tabs" aria-label="Bookings"><a v-for="n in NAV" :key="n.key" :href="'#' + n.path" class="st-tab" :class="{ on: active === n.key }" :aria-current="active === n.key ? 'page' : null">{{ n.label }}</a></nav></div>
			<main class="main">
				<div v-if="!s.ready" class="page"><Skel h="40" r="10" /><Skel h="220" r="12" /></div>
				<div v-else-if="s.error" class="page"><ErrorState :message="s.error" @retry="location.reload()" /></div>
				<div v-else-if="nothing" class="page"><Empty icon="shield" title="You do not have access to Bookings" text="Ask a System Manager to give you access on the Team and access page. Your own demos can also be shown on the Meetings screen, under Bookings."><a class="btn primary" href="/crm" v-if="!embedded">Back to CRM</a></Empty></div>
				<template v-else>
					<div v-if="shared.error" class="page" style="padding-bottom:0"><div class="alert err"><Ico name="alert" /><div class="grow">{{ shared.error }}</div></div></div>
					<component :is="view.comp" :key="view.key" v-bind="view.props || {}" />
				</template>
			</main>
			<div v-if="embedded" class="embed-ctl" role="toolbar" aria-label="Pop-up"><button type="button" class="btn ghost icon" title="Open in a new tab" aria-label="Open in a new tab" @click="newTab"><Ico name="external" /></button><button type="button" class="btn ghost icon" title="Close (Esc)" aria-label="Close" @click="close"><Ico name="x" /></button></div>
			<Toasts /><ConfirmHost />
		</div>`,
	}

	const app = createApp(App)
	Object.entries(CM.components).forEach(([k, v]) => app.component(k, v))
	Object.entries(V).forEach(([k, v]) => app.component(k, v))
	app.config.globalProperties.$wa = (n) => '{{' + n + '}}'
	app.config.globalProperties.$tok = (n) => '{{ ' + n + ' }}'
	app.config.globalProperties.location = window.location
	app.config.errorHandler = (err, inst, info) => { console.error('[demos]', err, info); CM.toast('Something went wrong on this page. ' + (err && err.message ? err.message : ''), 'err') }
	document.title = 'Bookings'
	app.mount('#app')
})()
