/* Lead assignment: its own page (per the person's access settings), opened from "Assignment" in CRM's left menu or at /assignment.
 * Built like the Campaign Manager - a left menu, a page per task - but it is not part of it. */
(() => {
	const { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM

	// each part shows only if the person's access allows it (Team and access); with no access settings loaded yet, all of it
	const lvl = (k) => { const a = CM.shared.config && CM.shared.config.access; return a && a[k] !== undefined ? a[k] : 'manage' }
	const NAV = [
		{ key: 'rules', label: 'Rules', icon: 'zap', path: '/rules', show: () => lvl('assignment_rules') !== 'none' },
		{ key: 'assign', label: 'Assign leads now', icon: 'users', path: '/assign', show: () => lvl('assignment_move') !== 'none' },
		{ key: 'move', label: 'Move leads', icon: 'arrow-right', path: '/move', show: () => lvl('assignment_move') !== 'none' },
		{ key: 'history', label: 'History', icon: 'clock', path: '/history', show: () => lvl('assignment_history') !== 'none' },
	]

	const App = {
		setup() {
			const r = CM.route
			const view = computed(() => {
				const p = r.parts
				switch (p[0]) {
					case 'assign': return { comp: 'AsgAssign', key: 'assign' }
					case 'move': return { comp: 'AsgMove', key: 'move' }
					case 'history': return { comp: 'AsgHistory', key: 'history' }
					case 'rules':
						if (p[1] === 'new') return { comp: 'AsgRuleEdit', key: 'new' }
						if (p[1] === 'edit' && p[2]) return { comp: 'AsgRuleEdit', key: 'edit' + p[2], props: { name: p[2] } }
						if (p[1] === 'run' && p[2]) return { comp: 'AsgRun', key: 'run' + p[2], props: { name: p[2] } }
						return { comp: 'AsgRules', key: 'rules' }
					default: return NAV.find((n) => n.show()) && NAV.find((n) => n.show()).key !== 'rules' ? { comp: { assign: 'AsgAssign', move: 'AsgMove', history: 'AsgHistory' }[NAV.find((n) => n.show()).key], key: NAV.find((n) => n.show()).key } : { comp: 'AsgRules', key: 'rules' }
				}
			})
			const active = computed(() => { const p = r.parts[0]; return ['assign', 'move', 'history'].includes(p) ? p : 'rules' })
			let saved = false; try { saved = localStorage.getItem('cm_rail_collapsed') === '1' } catch (e) { /* storage blocked */ }
			const collapsed = ref(saved)
			const toggleRail = () => { collapsed.value = !collapsed.value; try { localStorage.setItem('cm_rail_collapsed', collapsed.value ? '1' : '0') } catch (e) { /* not remembered */ } }
			const allowed = computed(() => !CM.shared.config || !!CM.shared.config.can_assign)
			const canConfigure = computed(() => !!(CM.shared.config && CM.shared.config.can_configure))
			watch(() => view.value.key, () => nextTick(() => CM.scrollTop()))
			function onEsc(e) {
				if (e.key !== 'Escape' || e.defaultPrevented || CM.overlayOpen()) return
				const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { t.blur(); return }
				CM.requestClose()
			}
			onMounted(() => { CM.loadShared(); if (CM.embed) { window.addEventListener('keydown', onEsc); try { window.focus() } catch (e) { /* the host page focuses the frame too */ } } })
			onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
			const navShown = computed(() => NAV.filter((n) => n.show()))
			return { view, active, NAV: navShown, collapsed, toggleRail, allowed, canConfigure, shared: CM.shared, embedded: CM.embed, close: () => CM.requestClose(), newTab: CM.openInTab }
		},
		template: `
		<div class="app" :class="{ 'rail-collapsed': collapsed }">
			<nav class="rail" :class="{ collapsed }" aria-label="Lead assignment">
				<div class="brand"><span class="brand-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><div class="brand-txt"><b>Lead assignment</b><span>Frappe CRM Suite Pro</span></div></div>
				<div class="nav-sec">Manage</div>
				<a v-for="n in NAV" :key="n.key" :href="'#' + n.path" class="nav" :class="{ on: active === n.key }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === n.key ? 'page' : null"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span></a>
				<div class="rail-foot">
					<a v-if="canConfigure" class="nav" href="/pro-pack-setup" target="_blank" rel="noopener" :title="collapsed ? 'Settings' : null" aria-label="Settings"><Ico name="settings" /><span class="nav-l">Settings</span><Ico name="external" size="sm" class="nav-x" style="margin-left:auto" /></a>
					<a v-if="!embedded" class="nav" href="/crm" :title="collapsed ? 'Back to CRM' : null" aria-label="Back to CRM"><Ico name="arrow-left" /><span class="nav-l">Back to CRM</span></a>
					<button type="button" class="nav rail-toggle" @click="toggleRail" :title="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-expanded="String(!collapsed)"><Ico :name="collapsed ? 'chevron-right' : 'chevron-left'" /><span class="nav-l">Collapse menu</span></button>
				</div>
			</nav>
			<main class="main">
				<div v-if="shared.error" class="page" style="padding-bottom:0"><div class="alert err"><Ico name="alert" /><div class="grow">{{ shared.error }}</div></div></div>
				<div v-if="!allowed" class="page"><Empty icon="shield" title="You do not have access to lead assignment" text="Ask a System Manager to give you access on the Team and access page." /></div>
				<component v-else :is="view.comp" :key="view.key" v-bind="view.props || {}" />
			</main>
			<div v-if="embedded" class="embed-ctl" role="toolbar" aria-label="Pop-up"><button type="button" class="btn ghost icon" title="Open in a new tab" aria-label="Open in a new tab" @click="newTab"><Ico name="external" /></button><button type="button" class="btn ghost icon" title="Close (Esc)" aria-label="Close" @click="close"><Ico name="x" /></button></div>
			<Toasts /><ConfirmHost />
		</div>`,
	}

	const app = createApp(App)
	Object.entries(CM.components).forEach(([k, v]) => app.component(k, v))
	Object.entries(CM.views).forEach(([k, v]) => app.component(k, v))
	app.config.errorHandler = (err, inst, info) => { console.error('[assignment]', err, info); CM.toast('Something went wrong on this page. ' + (err && err.message ? err.message : ''), 'err') }
	document.title = 'Lead assignment'
	app.mount('#app')
})()
