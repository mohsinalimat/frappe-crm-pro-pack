/* Demo booking admin: the Team tab (hosts, CC, notifications) and the people picker. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const DM = window.DM
	const C = CM.components
	const V = DM.views

	/** Search CRM team members (and, if allowed, type any email address). Emits pick({user, email, full_name}). */
	C.PeoplePicker = {
		props: { placeholder: { type: String, default: 'Search team members' }, allowEmail: Boolean, exclude: { type: Array, default: () => [] }, ariaLabel: String },
		emits: ['pick'],
		setup(props, { emit }) {
			const q = ref(''); const items = ref([]); const loading = ref(false); const hi = ref(0); const wrap = ref(null); const error = ref('')
			const p = CM.usePop(() => wrap.value, { width: 320, maxH: 300 })
			let seq = 0, timer
			async function search() {
				const my = ++seq; loading.value = true; error.value = ''
				try { const r = await DM.searchUsers(q.value); if (my === seq) { items.value = r; hi.value = 0 } } catch (e) { if (my === seq) error.value = e.message } finally { if (my === seq) loading.value = false }
			}
			const typedEmail = computed(() => (props.allowEmail && DM.isEmail(q.value) ? q.value.trim() : ''))
			const list = computed(() => {
				const taken = new Set(props.exclude.map((x) => String(x).toLowerCase()))
				const out = items.value.filter((x) => !taken.has(String(x.user).toLowerCase()))
				if (typedEmail.value && !taken.has(typedEmail.value.toLowerCase()) && !out.some((x) => x.email.toLowerCase() === typedEmail.value.toLowerCase())) out.push({ email: typedEmail.value, user: '', full_name: typedEmail.value, kind: 'Email address' })
				return out
			})
			function onInput() { p.openIt(); clearTimeout(timer); timer = setTimeout(search, 220) }
			function focus() { p.openIt(); if (!items.value.length) search() }
			function choose(x) { if (!x) return; emit('pick', x.kind === 'Email address' ? { user: '', email: x.email, full_name: '' } : { user: x.user, email: x.email, full_name: x.full_name }); q.value = ''; p.close(); nextTick(() => wrap.value && wrap.value.querySelector('input').focus()) }
			function key(e) {
				if (e.key === 'ArrowDown') { e.preventDefault(); p.openIt(); hi.value = Math.min(list.value.length - 1, hi.value + 1) }
				else if (e.key === 'ArrowUp') { e.preventDefault(); hi.value = Math.max(0, hi.value - 1) }
				else if (e.key === 'Enter') { e.preventDefault(); if (p.open.value && list.value[hi.value]) choose(list.value[hi.value]) }
			}
			onBeforeUnmount(() => clearTimeout(timer))
			return { q, list, loading, error, hi, wrap, onInput, focus, choose, key, ...p }
		},
		template: `
		<div ref="wrap" class="inp-wrap"><Ico name="search" /><input class="inp" :value="q" :placeholder="placeholder" :aria-label="ariaLabel || placeholder" role="combobox" aria-autocomplete="list" :aria-expanded="open" autocomplete="off" @input="q = $event.target.value; onInput()" @focus="focus" @click="focus" @keydown="key" />
			<Teleport to="body">
				<div v-if="open" ref="pop" class="pop" :style="style" role="listbox">
					<div class="pop-list">
						<div v-if="loading && !list.length" class="pop-empty"><span class="spin"></span></div>
						<div v-else-if="error" class="pop-empty" style="color:var(--red)">{{ error }}</div>
						<button v-for="(x, i) in list" :key="x.email" type="button" class="opt" :class="{ hi: i === hi }" role="option" @mouseenter="hi = i" @mousedown.prevent @click="choose(x)"><Avatar :name="x.full_name || x.email" :size="26" /><span class="grow"><span class="ellipsis" style="display:block">{{ x.full_name || x.email }}</span><span class="sub">{{ x.email }}<template v-if="x.kind && x.kind !== 'Team'"> - {{ x.kind }}</template></span></span></button>
						<div v-if="!loading && !error && !list.length" class="pop-empty">{{ allowEmail ? 'No match. Type a full email address to add it.' : 'No team member found' }}</div>
					</div>
				</div>
			</Teleport>
		</div>`,
	}

	V.TeamTab = {
		props: { doc: Object, errs: Object },
		setup(props) {
			const dragFrom = ref(-1); const dragOver = ref(-1)
			const ownerKeys = computed(() => props.doc.owners.map((o) => o.user))
			const ccKeys = computed(() => props.doc.cc.map((o) => o.user || o.email))
			function addOwner(x) { if (x.user && !props.doc.owners.some((o) => o.user === x.user)) props.doc.owners.push({ user: x.user, full_name: x.full_name }) }
			function addCc(x) { const k = x.user || x.email; if (!props.doc.cc.some((o) => (o.user || o.email) === k)) props.doc.cc.push(x.user ? { user: x.user, email: '', full_name: x.full_name } : { user: '', email: x.email, full_name: '' }) }
			function move(i, d) { const a = props.doc.owners; const j = i + d; if (j < 0 || j >= a.length) return; a.splice(j, 0, a.splice(i, 1)[0]) }
			function drop(i) { if (dragFrom.value >= 0 && dragFrom.value !== i) { const a = props.doc.owners; a.splice(i, 0, a.splice(dragFrom.value, 1)[0]) } dragFrom.value = dragOver.value = -1 }
			return { addOwner, addCc, move, drop, dragFrom, dragOver, ownerKeys, ccKeys, DM }
		},
		template: `
		<div class="col tabcol">
			<Section title="Hosts" icon="users" text="The people who run the demo.">
				<div class="alert info"><Ico name="info" /><div class="grow"><b>All selected hosts are invited to ONE meeting.</b> The first host is the organizer: the Google Meet link and the calendar event belong to them. Everyone else is added as a guest. There is no round robin.</div></div>
				<Field label="Add a host" :error="errs.owners"><PeoplePicker :exclude="ownerKeys" placeholder="Search CRM users by name or email" @pick="addOwner" /></Field>
				<ul v-if="doc.owners.length" class="plist" role="list" aria-label="Hosts, first is the organizer">
					<li v-for="(o, i) in doc.owners" :key="o.user" class="pitem" :class="{ over: dragOver === i && dragFrom !== i }" draggable="true" @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver = -1" @drop.prevent="drop(i)" @dragend="dragFrom = dragOver = -1">
						<span class="grip" aria-hidden="true"><Ico name="grip" /></span>
						<Avatar :name="DM.nameOf(o)" :size="32" />
						<div class="grow"><b class="ellipsis" style="display:block">{{ DM.nameOf(o) }}</b><span class="small muted ellipsis" style="display:block">{{ o.user }}</span></div>
						<span v-if="i === 0" class="badge blue nodot">Organizer</span><span v-else class="badge neutral nodot">Guest</span>
						<Btn size="sm" variant="ghost" icon="arrow-up" :disabled="i === 0" :aria-label="'Move ' + DM.nameOf(o) + ' up'" @click="move(i, -1)" />
						<Btn size="sm" variant="ghost" icon="arrow-down" :disabled="i === doc.owners.length - 1" :aria-label="'Move ' + DM.nameOf(o) + ' down'" @click="move(i, 1)" />
						<Btn size="sm" variant="ghost" icon="x" :aria-label="'Remove ' + DM.nameOf(o)" @click="doc.owners.splice(i, 1)" />
					</li>
				</ul>
				<div v-else class="plist-empty"><Ico name="users" size="lg" /><div><b>No host yet</b><div class="small muted">Add at least one. A demo widget without a host cannot be turned on.</div></div></div>
				<p v-if="doc.owners.length > 1" class="small faint" style="margin:0">Drag to change the order, or use the arrows. Slots are offered only when every host is free.</p>
			</Section>
			<Section title="Copy (CC)" icon="mail" text="People who are added to every meeting as guests, for example a manager or a shared inbox.">
				<Field label="Add CC" hint="Search a team member, or type any email address and press Enter."><PeoplePicker allow-email :exclude="ccKeys" placeholder="Name or email address" @pick="addCc" /></Field>
				<div v-if="doc.cc.length" class="chips-in"><span v-for="(c, i) in doc.cc" :key="c.user || c.email" class="pchip"><Avatar :name="c.full_name || c.user || c.email" :size="20" />{{ c.full_name || c.user || c.email }}<button type="button" class="pchip-x" :aria-label="'Remove ' + (c.user || c.email)" @click="doc.cc.splice(i, 1)"><Ico name="x" size="sm" /></button></span></div>
				<p v-else class="small faint" style="margin:0">Nobody in CC.</p>
			</Section>
			<Section title="Notifications" icon="inbox">
				<Toggle v-model="doc.owner_notify" label="Tell the hosts about new bookings" text="Each host gets a CRM notification and an email when someone books, reschedules or cancels." />
			</Section>
		</div>`,
	}
})()
