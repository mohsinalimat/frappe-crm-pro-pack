/* Team and access: application shell (left rail, router, access check) and mount. */
(() => {
	const { createApp, computed, watch, nextTick, onMounted, onBeforeUnmount, ref } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views
	const NAV = [
		{ key: 'people', label: 'People', icon: 'users', path: '/people' },
		{ key: 'presets', label: 'Presets', icon: 'shield', path: '/presets' },
	]

	const App = {
		setup() {
			const r = CM.route
			const active = computed(() => (r.parts[0] === 'presets' ? 'presets' : 'people'))
			const view = computed(() => (active.value === 'presets' ? 'Presets' : 'People'))
			onMounted(() => { AX.load(); CM.loadShared() })
			let saved = false; try { saved = localStorage.getItem('ax_rail_collapsed') === '1' } catch (e) { /* storage blocked */ }
			const collapsed = ref(saved)
			const toggleRail = () => { collapsed.value = !collapsed.value; try { localStorage.setItem('ax_rail_collapsed', collapsed.value ? '1' : '0') } catch (e) { /* not remembered */ } }
			watch(active, () => nextTick(() => CM.scrollTop()))
			const denied = computed(() => AX.data.error && /Only a System Manager|permission/i.test(AX.data.error))
			function onEsc(e) {
				if (e.key !== 'Escape' || e.defaultPrevented || CM.overlayOpen()) return
				const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { t.blur(); return }
				CM.requestClose()
			}
			if (CM.embed) { onMounted(() => { window.addEventListener('keydown', onEsc); try { window.focus() } catch (e) { /* the host page focuses the frame too */ } }); onBeforeUnmount(() => window.removeEventListener('keydown', onEsc)) }
			return { view, active, NAV, collapsed, toggleRail, denied, d: AX.data, embedded: CM.embed, close: () => CM.requestClose(), newTab: CM.openInTab }
		},
		template: `
		<div class="app" :class="{ 'rail-collapsed': collapsed }">
			<nav class="rail" :class="{ collapsed }" aria-label="Team and access">
				<div class="brand"><span class="brand-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span><div class="brand-txt"><b>Team and access</b><span>Frappe CRM Suite Pro</span></div></div>
				<template v-if="!denied">
				<a v-for="n in NAV" :key="n.key" :href="'#' + n.path" class="nav" :class="{ on: active === n.key }" :title="collapsed ? n.label : null" :aria-label="n.label" :aria-current="active === n.key ? 'page' : null"><Ico :name="n.icon" /><span class="nav-l">{{ n.label }}</span></a>
				</template>
				<div class="rail-foot">
					<a v-if="!embedded" class="nav" href="/crm" :title="collapsed ? 'Back to CRM' : null" aria-label="Back to CRM"><Ico name="arrow-left" /><span class="nav-l">Back to CRM</span></a>
					<button type="button" class="nav rail-toggle" @click="toggleRail" :title="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'" :aria-expanded="String(!collapsed)"><Ico :name="collapsed ? 'chevron-right' : 'chevron-left'" /><span class="nav-l">Collapse menu</span></button>
				</div>
			</nav>
			<main class="main">
				<div v-if="denied" class="page"><Empty icon="shield" title="Only System Managers can change access" text="Ask a System Manager to open this page. Your own access is set there."><a class="btn primary" href="/crm" v-if="!embedded">Back to CRM</a></Empty></div>
				<component v-else :is="view" :key="active" />
			</main>
			<div v-if="embedded" class="embed-ctl" role="toolbar" aria-label="Pop-up"><button type="button" class="btn ghost icon" title="Open in a new tab" aria-label="Open in a new tab" @click="newTab"><Ico name="external" /></button><button type="button" class="btn ghost icon" title="Close (Esc)" aria-label="Close" @click="close"><Ico name="x" /></button></div>
			<Toasts /><ConfirmHost />
		</div>`,
	}

	const app = createApp(App)
	Object.entries(CM.components).forEach(([k, v]) => app.component(k, v))
	Object.entries(V).forEach(([k, v]) => app.component(k, v))
	app.config.errorHandler = (err, inst, info) => { console.error('[access]', err, info); CM.toast('Something went wrong on this page. ' + (err && err.message ? err.message : ''), 'err') }
	document.title = 'Team and access'
	app.mount('#app')
})()
