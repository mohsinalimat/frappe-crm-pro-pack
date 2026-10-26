/* Team and access: the Sales Hierarchy as an org tree. Drag a person onto the one they report to. */
(() => {
	const { ref, reactive, computed, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	const ROLE_TONE = { 'System Manager': 'green', 'Sales Manager': 'blue', 'Campaign Manager': 'amber' }
	// the one tag shown next to a name: the highest by permission level
	const RANK = ['System Manager', 'Campaign Manager', 'Sales Manager', 'Sales User']
	const topRole = (roles) => RANK.find((r) => (roles || []).includes(r)) || ''
	let dragUser = ref('') // shared by every node and the side list

	/** One person in the tree, with their team below. Drop another person on it to make them report here. */
	V.HxNode = {
		name: 'HxNode',
		props: { node: Object, kids: Object, ctx: Object },
		setup(props) {
			const open = ref(true); const over = ref(false)
			const children = computed(() => props.kids[props.node.user] || [])
			const onDrop = (e) => { e.preventDefault(); over.value = false; props.ctx.drop(props.node.user) }
			const onOver = (e) => { if (dragUser.value && dragUser.value !== props.node.user) { e.preventDefault(); over.value = true } }
			return { open, over, children, onDrop, onOver, dragUser, ROLE_TONE, topRole }
		},
		template: `
		<li class="hx-li">
			<div class="hx-card" :class="['lv' + (node.depth % 5), { over, inactive: !node.enabled, drag: dragUser === node.user }]" draggable="true" @dragstart="dragUser = node.user; $event.dataTransfer.effectAllowed = 'move'; $event.dataTransfer.setData('text/plain', node.user)" @dragend="dragUser = ''; over = false" @dragover="onOver" @dragleave="over = false" @drop="onDrop">
				<button v-if="children.length" type="button" class="hx-tog" :aria-expanded="open" :aria-label="(open ? 'Collapse ' : 'Expand ') + node.full_name" @click="open = !open"><Ico :name="open ? 'chevron-down' : 'chevron-right'" size="sm" /></button><span v-else class="hx-tog sp"></span>
				<span class="hx-grip" aria-hidden="true">&#8942;&#8942;</span>
				<Pic :name="node.full_name" :image="node.image" :size="32" />
				<div class="grow hx-line"><b class="ellipsis hx-name">{{ node.full_name }}</b><span v-if="topRole(node.roles)" class="badge sm nodot" :class="ROLE_TONE[topRole(node.roles)]">{{ topRole(node.roles) }}</span><span v-if="!node.enabled" class="badge sm nodot">Inactive</span><span v-if="node.designation" class="small muted ellipsis">{{ node.designation }}</span></div>
				<span v-if="node.below" class="hx-count" :title="node.below + (node.below === 1 ? ' person' : ' people') + ' below'"><Ico name="users" size="sm" />{{ node.below }}</span>
				<Btn size="sm" variant="ghost" icon="plus" title="Add an existing user under them" :aria-label="'Add an existing user under ' + node.full_name" @click.stop="ctx.add(node.user)" />
				<Btn size="sm" variant="ghost" icon="trash" class="hx-del" :disabled="node.below > 0" :title="node.below > 0 ? 'Move their team first' : 'Remove from the hierarchy'" :aria-label="'Remove ' + node.full_name + ' from the hierarchy'" @click.stop="ctx.remove(node)" />
			</div>
			<ul v-if="children.length && open" class="hx-ul"><HxNode v-for="c in children" :key="c.user" :node="c" :kids="kids" :ctx="ctx" /></ul>
		</li>`,
	}

	V.Hierarchy = {
		setup() {
			const h = ref(null); const loading = ref(true); const error = ref(''); const busy = ref(''); const q = ref('')
			const adding = ref(null) // '' = at the top, a user = under them, null = closed
			const rootOver = ref(false); const sideOver = ref(false); const pickQ = ref('')
			async function load() { loading.value = true; error.value = ''; try { h.value = await AX.api('get_hierarchy', {}) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(load)
			async function act(method, args, ok) {
				busy.value = args.user || method
				try { h.value = await AX.api(method, args); AX.load(true); if (ok) CM.toast(ok) } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = '' }
			}
			const kids = computed(() => {
				const m = {}
				if (h.value) for (const n of h.value.tree) (m[n.reports_to || ''] = m[n.reports_to || ''] || []).push(n)
				return m
			})
			const tops = computed(() => kids.value[''] || [])
			const loose = computed(() => (h.value ? h.value.loose : []).filter((p) => !q.value.trim() || (p.full_name + ' ' + p.user).toLowerCase().includes(q.value.trim().toLowerCase())))
			const inTree = (u) => !!(h.value && h.value.tree.some((n) => n.user === u))
			const name = (u) => { const n = h.value && [...h.value.tree, ...h.value.loose].find((x) => x.user === u); return n ? n.full_name : u }
			const ctx = {
				drop: (leader) => { const u = dragUser.value; dragUser.value = ''; if (u && u !== leader) act('set_leader', { user: u, reports_to: leader || null }, name(u) + ' now reports to ' + (leader ? name(leader) : 'the top')) },
				add: (leader) => (adding.value = leader),
				remove: async (n) => {
					if (!(await CM.confirm({ title: 'Take ' + n.full_name + ' out of the hierarchy?', message: 'They stay a user. Their access is unchanged; "My team" for them is then just themselves.', confirmText: 'Take out' }))) return
					act('remove_from_hierarchy', { user: n.user }, n.full_name + ' is out of the hierarchy')
				},
			}
			const dropRoot = (e) => { e.preventDefault(); rootOver.value = false; ctx.drop('') }
			const overRoot = (e) => { if (dragUser.value) { e.preventDefault(); rootOver.value = true } }
			const dropSide = (e) => { e.preventDefault(); sideOver.value = false; const u = dragUser.value; dragUser.value = ''; const n = h.value.tree.find((x) => x.user === u); if (n) ctx.remove(n) }
			const overSide = (e) => { if (dragUser.value && inTree(dragUser.value)) { e.preventDefault(); sideOver.value = true } }
			const toggleCrm = (on) => act('set_hierarchy_enabled', { enabled: on ? 1 : 0 }, on ? 'Switched on in CRM' : 'Switched off in CRM')
			const pickList = computed(() => (h.value ? h.value.loose : []).filter((p) => !pickQ.value.trim() || (p.full_name + ' ' + p.user).toLowerCase().includes(pickQ.value.trim().toLowerCase())))
			function pickUser(p) { const leader = adding.value; adding.value = null; pickQ.value = ''; act('set_leader', { user: p.user, reports_to: leader || null }, p.full_name + ' now reports to ' + (leader ? name(leader) : 'the top')) }
			return { h, loading, error, busy, q, tops, kids, loose, ctx, adding, rootOver, sideOver, dropRoot, overRoot, dropSide, overSide, toggleCrm, pickQ, pickList, pickUser, name, load, dragUser, ROLE_TONE, topRole, AX }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Hierarchy</h1></div></div>
			<div v-if="loading" class="col" style="gap:10px"><Skel h="56" r="10" v-for="n in 5" :key="n" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<div v-else-if="!h.available" class="alert warn"><Ico name="info" /><div class="grow"><b>This CRM has no Sales Hierarchy.</b> It exists in newer versions of Frappe CRM. Update CRM to use it; until then "My team" means just the person themselves.</div></div>
			<template v-else>
				<div class="card pad row" style="gap:12px"><div class="grow"><b class="hx-big">Use the Sales Hierarchy in CRM</b></div><Switch :model-value="!!h.enabled" label="Use the Sales Hierarchy in CRM" :aria-disabled="busy === 'set_hierarchy_enabled'" @update:model-value="(v) => !busy && toggleCrm(v)" /></div>
				<div class="hx-grid">
					<div class="hx-tree card pad">
						<div class="hx-card hx-root" :class="{ over: rootOver }" @dragover="overRoot" @dragleave="rootOver = false" @drop="dropRoot">
							<span class="hx-tog sp"></span><Pic :name="h.root.full_name" :image="h.root.image" :size="36" />
							<div class="grow hx-line"><b class="hx-name">{{ h.root.full_name }}</b><span class="badge sm nodot green">System Manager</span></div>
						</div>
						<ul class="hx-ul top"><HxNode v-for="n in tops" :key="n.user" :node="n" :kids="kids" :ctx="ctx" /></ul>
						<div v-if="!tops.length" class="muted" style="padding:14px 6px 4px">Nobody is in the hierarchy yet.</div>
					</div>
					<aside class="hx-side card pad" :class="{ over: sideOver }" @dragover="overSide" @dragleave="sideOver = false" @drop="dropSide">
						<b class="hx-big">Users</b>
						<Inp v-model="q" icon="search" placeholder="Search users" clearable aria-label="Search users" />
						<div class="hx-list">
							<div v-for="p in loose" :key="p.user" class="hx-chip" :class="{ drag: dragUser === p.user }" draggable="true" @dragstart="dragUser = p.user; $event.dataTransfer.effectAllowed = 'move'; $event.dataTransfer.setData('text/plain', p.user)" @dragend="dragUser = ''">
								<span class="hx-grip" aria-hidden="true">&#8942;&#8942;</span><Pic :name="p.full_name" :image="p.image" :size="26" />
								<div class="grow hx-line"><b class="ellipsis hx-name">{{ p.full_name }}</b><span v-if="topRole(p.roles)" class="badge sm nodot" :class="ROLE_TONE[topRole(p.roles)]">{{ topRole(p.roles) }}</span></div></div>
							</div>
							<div v-if="!loose.length" class="muted">{{ q ? 'No user matches.' : 'Everyone is in the hierarchy.' }}</div>
						</div>
					</aside>
				</div>
			</template>
			<div v-if="adding !== null" class="hx-ov" @mousedown.self="adding = null"><div class="hx-pick" role="dialog" aria-label="Add an existing user"><div class="row" style="gap:10px"><b class="grow hx-big">Add under {{ name(adding) }}</b><Btn size="sm" @click="adding = null">Close</Btn></div>
				<Inp v-model="pickQ" icon="search" placeholder="Search users" clearable aria-label="Search users" autofocus />
				<div class="hx-list"><button v-for="p in pickList" :key="p.user" type="button" class="hx-chip hx-pickrow" @click="pickUser(p)"><Pic :name="p.full_name" :image="p.image" :size="26" /><div class="grow hx-line"><b class="ellipsis hx-name">{{ p.full_name }}</b><span v-if="topRole(p.roles)" class="badge sm nodot" :class="ROLE_TONE[topRole(p.roles)]">{{ topRole(p.roles) }}</span></div></button>
					<div v-if="!pickList.length" class="muted">{{ pickQ ? 'No user matches.' : 'Every user is already in the hierarchy.' }}</div></div></div></div>
		</div>`,
	}
})()
