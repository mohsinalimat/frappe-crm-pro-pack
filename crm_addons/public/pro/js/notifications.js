/* Suite Pro: Notifications. The person's own CRM notifications (assigned to you, mentions, tasks, WhatsApp). */
(() => {
	const { ref, reactive, computed, onMounted, onBeforeUnmount, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views

	/** A person's picture, or their initials. */
	V.Pic = {
		props: { name: String, image: String, size: { type: Number, default: 32 } },
		template: `<img v-if="image" :src="image" alt="" :width="size" :height="size" style="border-radius:50%;object-fit:cover;flex:none" /><Avatar v-else :name="name || '?'" :size="size" />`,
	}

	const TYPE_ICON = { Assignment: 'users', Mention: 'mail', Task: 'check-circle', WhatsApp: 'whatsapp', Automation: 'bell' }
	const TYPE_TONE = { Assignment: 'blue', Mention: 'purple', Task: 'green', WhatsApp: 'teal', Automation: 'blue' }
	const TABS = [
		{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' },
		{ id: 'assignments', label: 'Assignments', types: ['Assignment'] }, { id: 'mentions', label: 'Mentions', types: ['Mention'] },
		{ id: 'tasks', label: 'Tasks', types: ['Task'] }, { id: 'whatsapp', label: 'WhatsApp', types: ['WhatsApp'] },
	]

	/** Browser alerts: a desktop notification and a short sound when a new notification arrives while the page is open. */
	const KEY = 'pro.ntf.alerts'
	const store = { get() { try { return localStorage.getItem(KEY) === '1' } catch (e) { return false } }, set(v) { try { localStorage.setItem(KEY, v ? '1' : '0') } catch (e) { /* not kept */ } } }
	let audio
	function beep() {
		try {
			audio = audio || new (window.AudioContext || window.webkitAudioContext)()
			const o = audio.createOscillator(); const g = audio.createGain(); o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(audio.destination)
			g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35)
			o.start(); o.stop(audio.currentTime + 0.36)
		} catch (e) { /* no sound */ }
	}
	const seen = new Set(); let primed = false; let started = false
	async function poll() {
		if (!store.get()) return
		try {
			const r = await PRO.api('list_notifications', { show: 'unread', page_length: 10 })
			PRO.shell.unread = r.unread
			const fresh = r.rows.filter((n) => !seen.has(n.name)); r.rows.forEach((n) => seen.add(n.name))
			if (!primed) { primed = true; return }
			if (!fresh.length) return
			beep()
			if ('Notification' in window && Notification.permission === 'granted') {
				const n = fresh[0]; const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''
				try { new Notification(`${n.from_name || 'CRM'}${more}`, { body: n.quote || n.text || n.type, tag: 'pro-ntf' }) } catch (e) { /* blocked */ }
			}
		} catch (e) { /* the next poll tries again */ }
	}
	PRO.notifier = {
		enabled: reactive({ on: store.get() }),
		start() { if (started) return; started = true; setInterval(() => { if (!document.hidden) poll() }, 30000); poll() },
		async set(on) {
			if (on && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission() } catch (e) { /* ask again later */ } }
			if (on && 'Notification' in window && Notification.permission === 'denied') CM.toast('Desktop alerts are blocked in this browser; you will still hear the sound', 'err')
			store.set(on); this.enabled.on = on; primed = false; if (on) { beep(); poll() }
		},
	}

	V.Notifications = {
		props: { panel: Boolean },
		emits: ['close'],
		setup() {
			const rows = ref([]); const total = ref(0); const loading = ref(true); const error = ref(''); const more = ref(false)
			const tab = ref('all'); const type = ref(''); const q = ref(''); const counts = ref({ all: 0, by_type: {} })
			const menu = ref(''); const filt = ref(false); const tabsEl = ref(null)
			let dx = 0, sx = 0, dragging = false, moved = false
			let timer
			async function load(append) {
				if (!append) loading.value = true; error.value = ''
				const t = TABS.find((x) => x.id === tab.value)
				const types = type.value ? type.value : t.types ? t.types.join(',') : ''
				try {
					const r = await PRO.api('list_notifications', { show: tab.value === 'unread' ? 'unread' : 'all', type: types || undefined, search: q.value || undefined, start: append ? rows.value.length : 0, page_length: 30 })
					rows.value = append ? [...rows.value, ...r.rows] : r.rows; total.value = r.total; PRO.shell.unread = r.unread; counts.value = r.counts || counts.value
				} catch (e) { error.value = e.message } finally { loading.value = false; more.value = false }
			}
			const closeMenus = () => { menu.value = ''; filt.value = false }
			onMounted(() => { load(); document.addEventListener('click', closeMenus) })
			onBeforeUnmount(() => document.removeEventListener('click', closeMenus))
			watch([tab, type], () => load())
			watch(q, () => { clearTimeout(timer); timer = setTimeout(() => load(), 300) })
			async function open(n) {
				if (!n.read) { n.read = 1; PRO.shell.unread = Math.max(0, PRO.shell.unread - 1); try { const r = await PRO.api('mark_read', { names: [n.name] }); PRO.shell.unread = r.unread } catch (e) { /* the next load corrects it */ } }
				const url = PRO.crmUrl(n.reference_doctype, n.reference_name)
				if (url) window.open(url, '_blank', 'noopener')
			}
			async function toggle(n) { menu.value = ''; n.read = n.read ? 0 : 1; try { const r = await PRO.api('mark_read', { names: [n.name], read: n.read }); PRO.shell.unread = r.unread } catch (e) { n.read = n.read ? 0 : 1; CM.toast(e.message, 'err') } }
			async function readAll() { try { const r = await PRO.api('mark_all_read', {}); PRO.shell.unread = r.unread; rows.value.forEach((n) => (n.read = 1)); CM.toast('All notifications are marked as read') } catch (e) { CM.toast(e.message, 'err') } }
			const groups = computed(() => {
				const out = []; const today = new Date().toDateString(); const yest = new Date(Date.now() - 864e5).toDateString()
				for (const n of rows.value) {
					const d = new Date(String(n.creation).replace(' ', 'T')); const key = d.toDateString()
					const label = key === today ? 'Today' : key === yest ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
					let g = out[out.length - 1]; if (!g || g.label !== label) { g = { label, items: [] }; out.push(g) }
					g.items.push(n)
				}
				return out
			})
			const tabCount = (t) => (t.id === 'all' ? counts.value.all : t.id === 'unread' ? PRO.shell.unread : t.types ? t.types.reduce((a, k) => a + (counts.value.by_type[k] || 0), 0) : 0)
			/** The action without the leading name: the name is shown in bold on its own. */
			const action = (n) => {
				let t = (n.text || '').trim()
				for (const w of [n.from_name, n.from_user]) if (w && t.toLowerCase().startsWith(w.toLowerCase())) { t = t.slice(w.length).trim(); break }
				return t.replace(/^[^:]{1,60}:\s*/, '').replace(/^:\s*/, '')
			}
			const noun = (n) => (n.reference_doctype === 'CRM Deal' ? 'Deal' : n.reference_doctype === 'CRM Lead' ? 'Lead' : 'Record')
			const typeOpts = []
			const dragStart = (e) => { if (e.pointerType !== 'mouse') return; dragging = true; moved = false; sx = e.clientX; dx = tabsEl.value.scrollLeft }
			const dragMove = (e) => { if (!dragging) return; const d = e.clientX - sx; if (Math.abs(d) > 4) { moved = true; tabsEl.value.classList.add('drag') } if (moved) tabsEl.value.scrollLeft = dx - d }
			const dragEnd = () => { dragging = false; if (tabsEl.value) tabsEl.value.classList.remove('drag') }
			const tabClick = (id) => { if (moved) { moved = false; return } tab.value = id }
			return { tabsEl, dragStart, dragMove, dragEnd, tabClick, rows, total, loading, error, tab, type, q, groups, typeOpts, open, toggle, readAll, load, more, TYPE_ICON, TYPE_TONE, TABS, tabCount, notifier: PRO.notifier, action, noun, menu, filt, PRO, CM }
		},
		template: `
		<div :class="panel ? 'ntf-in' : 'page'">
			<div class="pg-head ntf-head"><div class="grow"><h1>Notifications <span v-if="PRO.shell.unread" class="ntf-count">{{ PRO.shell.unread }}</span></h1></div><div class="actions"><Btn size="sm" variant="ghost" :class="{ 'ntf-on': notifier.enabled.on }" :icon="notifier.enabled.on ? 'bell' : 'bell-off'" :aria-pressed="String(notifier.enabled.on)" :title="notifier.enabled.on ? 'Sound and desktop alerts are on. Click to turn off' : 'Sound and desktop alerts are off. Click to turn on'" aria-label="Sound and desktop alerts" @click="notifier.set(!notifier.enabled.on)" /><Btn size="sm" variant="ghost" icon="check-check" :disabled="!PRO.shell.unread" title="Mark all as read" aria-label="Mark all as read" @click="readAll" /><Btn v-if="panel" size="sm" variant="ghost" icon="panel-left-close" aria-label="Hide notifications" title="Hide" @click="$emit('close')" /></div></div>
			<div class="chips ntf-tabs" ref="tabsEl" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointerleave="dragEnd"><button v-for="t in TABS" :key="t.id" type="button" class="fchip" :class="{ on: tab === t.id }" @click="tabClick(t.id)">{{ t.label }}<span v-if="t.id === 'all' || t.id === 'unread'" class="n">{{ tabCount(t) }}</span></button></div>
			<div class="row tools" style="gap:8px">
				<div class="grow"><Inp v-model="q" icon="search" placeholder="Search notifications..." clearable aria-label="Search notifications" /></div>
			</div>
			<div :class="panel ? 'ntf-body' : ''">
			<div v-if="loading" class="card" style="padding:0"><div v-for="n in 6" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>
			<ErrorState v-else-if="error" :message="error" @retry="load()" />
			<Empty v-else-if="!rows.length" icon="bell" :title="tab === 'unread' ? 'You are all caught up' : 'No notifications yet'" :text="tab === 'unread' ? 'Nothing unread.' : 'Assignments, mentions, tasks and WhatsApp messages for you show up here.'" />
			<template v-else>
				<section v-for="g in groups" :key="g.label" class="ntf-group"><h4 class="dh">{{ g.label }}</h4>
					<div class="card" style="padding:0">
						<div v-for="n in g.items" :key="n.name" class="ntf" :class="{ unread: !n.read }" role="button" tabindex="0" @click="open(n)" @keydown.enter="open(n)">
							<span class="ntf-av"><Pic :name="n.from_name" :image="n.from_image" :size="40" /><span class="ntf-ic" :class="TYPE_TONE[n.type]" :title="n.type"><Ico :name="TYPE_ICON[n.type] || 'bell'" size="sm" /></span></span>
							<div class="grow" style="min-width:0">
								<div class="ntf-t"><span><b>{{ n.from_name || 'Someone' }}</b> {{ action(n) }}</span><span class="small muted nowrap ntf-time">{{ PRO.ago(n.creation) }}</span></div>
								<div v-if="n.quote" class="ntf-q">{{ n.quote }}</div>
								<div v-if="n.title" class="small muted">{{ noun(n) }}: {{ n.title }}</div>
							</div>
							<span class="ntf-end"><span v-if="!n.read" class="ntf-dot" title="Unread"></span><span class="ntf-pop"><Btn size="sm" variant="ghost" icon="more-vertical" aria-label="More actions" title="More" @click.stop="menu = menu === n.name ? '' : n.name; filt = false" />
								<div v-if="menu === n.name" class="ntf-menu" @click.stop><button type="button" @click="toggle(n)"><Ico :name="n.read ? 'eye' : 'check'" size="sm" /> {{ n.read ? 'Mark as unread' : 'Mark as read' }}</button><button type="button" @click="menu = ''; open(n)"><Ico name="external-link" size="sm" /> Open in CRM</button></div></span></span>
						</div>
					</div>
				</section>
				<div v-if="rows.length < total" style="text-align:center"><Btn :loading="more" @click="more = true; load(true)">Show more</Btn></div>
			</template>
			</div>
		</div>`,
	}
})()
