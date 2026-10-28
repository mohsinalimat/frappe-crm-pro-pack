/* Suite Pro: Notifications. The person's own CRM notifications (assigned to you, mentions, tasks, WhatsApp). */
(() => {
	const { ref, reactive, computed, onMounted, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views

	/** A person's picture, or their initials. */
	V.Pic = {
		props: { name: String, image: String, size: { type: Number, default: 32 } },
		template: `<img v-if="image" :src="image" alt="" :width="size" :height="size" style="border-radius:50%;object-fit:cover;flex:none" /><Avatar v-else :name="name || '?'" :size="size" />`,
	}

	const TYPE_ICON = { Assignment: 'users', Mention: 'mail', Task: 'check-circle', WhatsApp: 'whatsapp' }

	V.Notifications = {
		props: { panel: Boolean },
		emits: ['close'],
		setup() {
			const rows = ref([]); const total = ref(0); const loading = ref(true); const error = ref(''); const more = ref(false)
			const show = ref('all'); const type = ref(''); const q = ref('')
			let timer
			async function load(append) {
				if (!append) loading.value = true; error.value = ''
				try {
					const r = await PRO.api('list_notifications', { show: show.value, type: type.value || undefined, search: q.value || undefined, start: append ? rows.value.length : 0, page_length: 30 })
					rows.value = append ? [...rows.value, ...r.rows] : r.rows; total.value = r.total; PRO.shell.unread = r.unread
				} catch (e) { error.value = e.message } finally { loading.value = false; more.value = false }
			}
			onMounted(() => load())
			watch([show, type], () => load())
			watch(q, () => { clearTimeout(timer); timer = setTimeout(() => load(), 300) })
			async function open(n) {
				if (!n.read) { n.read = 1; PRO.shell.unread = Math.max(0, PRO.shell.unread - 1); try { const r = await PRO.api('mark_read', { names: [n.name] }); PRO.shell.unread = r.unread } catch (e) { /* the next load corrects it */ } }
				const url = PRO.crmUrl(n.reference_doctype, n.reference_name)
				if (url) window.open(url, '_blank', 'noopener')
			}
			async function toggle(n) { n.read = n.read ? 0 : 1; try { const r = await PRO.api('mark_read', { names: [n.name], read: n.read }); PRO.shell.unread = r.unread } catch (e) { n.read = n.read ? 0 : 1; CM.toast(e.message, 'err') } }
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
			const typeOpts = [{ value: '', label: 'All types' }, ...['Assignment', 'Mention', 'Task', 'WhatsApp'].map((t) => ({ value: t, label: t }))]
			return { rows, total, loading, error, show, type, q, groups, typeOpts, open, toggle, readAll, load, more, TYPE_ICON, PRO, CM }
		},
		template: `
		<div :class="panel ? 'ntf-in' : 'page'">
			<div class="pg-head"><div class="grow"><h1>Notifications</h1></div><div class="actions"><Btn icon="check" :disabled="!PRO.shell.unread" @click="readAll">Mark all as read</Btn><Btn v-if="panel" variant="ghost" icon="x" aria-label="Close notifications" title="Close" @click="$emit('close')" /></div></div>
			<div class="row wrap tools" style="gap:10px">
				<div class="chips"><button type="button" class="fchip" :class="{ on: show === 'all' }" @click="show = 'all'">All</button><button type="button" class="fchip" :class="{ on: show === 'unread' }" @click="show = 'unread'">Unread<span class="n">{{ PRO.shell.unread }}</span></button></div>
				<div class="grow"></div>
				<div v-if="!panel" style="width:170px"><Dd v-model="type" :options="typeOpts" size="sm" aria-label="Type" /></div>
				<div :style="{ width: panel ? '100%' : 'min(280px,100%)' }"><Inp v-model="q" icon="search" placeholder="Search notifications" clearable aria-label="Search notifications" /></div>
			</div>
			<div v-if="loading" class="card" style="padding:0"><div v-for="n in 6" :key="n" style="padding:16px 18px;border-bottom:1px solid var(--border)"><Skel h="18" /></div></div>
			<ErrorState v-else-if="error" :message="error" @retry="load()" />
			<Empty v-else-if="!rows.length" icon="bell" :title="show === 'unread' ? 'You are all caught up' : 'No notifications yet'" :text="show === 'unread' ? 'Nothing unread.' : 'Assignments, mentions, tasks and WhatsApp messages for you show up here.'" />
			<template v-else>
				<section v-for="g in groups" :key="g.label" class="ntf-group"><h4 class="dh">{{ g.label }}</h4>
					<div class="card" style="padding:0;overflow:hidden">
						<div v-for="n in g.items" :key="n.name" class="ntf" :class="{ unread: !n.read }" role="button" tabindex="0" @click="open(n)" @keydown.enter="open(n)">
							<span class="ntf-dot" :title="n.read ? 'Read' : 'Unread'"></span>
							<Pic :name="n.from_name" :image="n.from_image" :size="36" />
							<div class="grow" style="min-width:0"><div class="ntf-t"><b>{{ n.from_name || 'Someone' }}</b><span class="badge sm nodot"><Ico :name="TYPE_ICON[n.type] || 'bell'" size="sm" /> {{ n.type }}</span></div>
								<div class="ntf-x">{{ n.text }}</div><div v-if="n.title" class="small muted">{{ n.title }}</div></div>
							<span class="small muted nowrap">{{ PRO.ago(n.creation) }}</span>
							<Btn size="sm" variant="ghost" :icon="n.read ? 'eye' : 'check'" :title="n.read ? 'Mark as unread' : 'Mark as read'" :aria-label="n.read ? 'Mark as unread' : 'Mark as read'" @click.stop="toggle(n)" />
						</div>
					</div>
				</section>
				<div v-if="rows.length < total" style="text-align:center"><Btn :loading="more" @click="more = true; load(true)">Show more</Btn></div>
			</template>
		</div>`,
	}
})()
