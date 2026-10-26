/* Team and access: the Sales Hierarchy as an org tree. Drag a person onto the one they report to. */
(() => {
	const { ref, reactive, computed, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	const ROLE_TONE = { 'System Manager': 'green', 'Sales Manager': 'blue', 'Campaign Manager': 'amber' }
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
			return { open, over, children, onDrop, onOver, dragUser, ROLE_TONE }
		},
		template: `
		<li class="hx-li">
			<div class="hx-card" :class="{ over, inactive: !node.enabled, drag: dragUser === node.user }" draggable="true" @dragstart="dragUser = node.user; $event.dataTransfer.effectAllowed = 'move'; $event.dataTransfer.setData('text/plain', node.user)" @dragend="dragUser = ''; over = false" @dragover="onOver" @dragleave="over = false" @drop="onDrop">
				<button v-if="children.length" type="button" class="hx-tog" :aria-expanded="open" :aria-label="(open ? 'Collapse ' : 'Expand ') + node.full_name" @click="open = !open"><Ico :name="open ? 'chevron-down' : 'chevron-right'" size="sm" /></button><span v-else class="hx-tog sp"></span>
				<span class="hx-grip" aria-hidden="true">&#8942;&#8942;</span>
				<Pic :name="node.full_name" :image="node.image" :size="48" />
				<div class="grow" style="min-width:0"><b class="ellipsis hx-name" style="display:block">{{ node.full_name }}<span v-if="!node.enabled" class="badge sm nodot" style="margin-left:6px">Inactive</span></b>
					<div class="row wrap" style="gap:4px"><span v-for="r in node.roles" :key="r" class="badge nodot" :class="ROLE_TONE[r]">{{ r }}</span><span v-if="node.designation" class="muted">{{ node.designation }}</span><span class="muted">{{ node.below ? node.below + ' below' : '' }}</span></div></div>
				<Btn variant="ghost" icon="plus" title="Add a new person under them" :aria-label="'Add a person under ' + node.full_name" @click.stop="ctx.add(node.user)" />
				<Btn variant="ghost" icon="x" :disabled="node.below > 0" :title="node.below > 0 ? 'Move their team first' : 'Take out of the hierarchy'" :aria-label="'Take ' + node.full_name + ' out of the hierarchy'" @click.stop="ctx.remove(node)" />
			</div>
			<ul v-if="children.length && open" class="hx-ul"><HxNode v-for="c in children" :key="c.user" :node="c" :kids="kids" :ctx="ctx" /></ul>
		</li>`,
	}

	V.Hierarchy = {
		setup() {
			const h = ref(null); const loading = ref(true); const error = ref(''); const busy = ref(''); const q = ref('')
			const adding = ref(null) // '' = at the top, a user = under them, null = closed
			const rootOver = ref(false); const sideOver = ref(false)
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
			async function added() { adding.value = null; await load(); AX.load(true) }
			return { h, loading, error, busy, q, tops, kids, loose, ctx, adding, rootOver, sideOver, dropRoot, overRoot, dropSide, overSide, toggleCrm, added, load, dragUser, ROLE_TONE, AX }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Hierarchy</h1></div><div class="actions"><Btn variant="primary" icon="plus" @click="ctx.add('')">Add person</Btn></div></div>
			<div v-if="loading" class="col" style="gap:10px"><Skel h="56" r="10" v-for="n in 5" :key="n" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<div v-else-if="!h.available" class="alert warn"><Ico name="info" /><div class="grow"><b>This CRM has no Sales Hierarchy.</b> It exists in newer versions of Frappe CRM. Update CRM to use it; until then "My team" means just the person themselves.</div></div>
			<template v-else>
				<div class="card pad row" style="gap:12px"><div class="grow"><b class="hx-big">Use the Sales Hierarchy in CRM</b></div><Switch :model-value="!!h.enabled" label="Use the Sales Hierarchy in CRM" :aria-disabled="busy === 'set_hierarchy_enabled'" @update:model-value="(v) => !busy && toggleCrm(v)" /></div>
				<div class="hx-grid">
					<div class="hx-tree card pad">
						<div class="hx-card hx-root" :class="{ over: rootOver }" @dragover="overRoot" @dragleave="rootOver = false" @drop="dropRoot">
							<span class="hx-tog sp"></span><Pic :name="h.root.full_name" :image="h.root.image" :size="52" />
							<div class="grow" style="min-width:0"><b class="hx-name">{{ h.root.full_name }}</b><div class="row wrap" style="gap:4px"><span class="badge nodot green">System Manager</span></div></div>
						</div>
						<ul class="hx-ul top"><HxNode v-for="n in tops" :key="n.user" :node="n" :kids="kids" :ctx="ctx" /></ul>
						<div v-if="!tops.length" class="muted" style="padding:14px 6px 4px">Nobody is in the hierarchy yet.</div>
					</div>
					<aside class="hx-side card pad" :class="{ over: sideOver }" @dragover="overSide" @dragleave="sideOver = false" @drop="dropSide">
						<b class="hx-big">Users</b>
						<Inp v-model="q" icon="search" placeholder="Search users" clearable aria-label="Search users" />
						<div class="hx-list">
							<div v-for="p in loose" :key="p.user" class="hx-chip" :class="{ drag: dragUser === p.user }" draggable="true" @dragstart="dragUser = p.user; $event.dataTransfer.effectAllowed = 'move'; $event.dataTransfer.setData('text/plain', p.user)" @dragend="dragUser = ''">
								<span class="hx-grip" aria-hidden="true">&#8942;&#8942;</span><Pic :name="p.full_name" :image="p.image" :size="40" />
								<div class="grow" style="min-width:0"><b class="ellipsis hx-name" style="display:block">{{ p.full_name }}</b><div class="row wrap" style="gap:4px"><span v-for="r in p.roles" :key="r" class="badge nodot" :class="ROLE_TONE[r]">{{ r }}</span></div></div>
							</div>
							<div v-if="!loose.length" class="muted">{{ q ? 'No user matches.' : 'Everyone is in the hierarchy.' }}</div>
						</div>
						<Btn icon="plus" @click="ctx.add('')">Add a new person</Btn>
					</aside>
				</div>
			</template>
			<AddPerson v-if="adding !== null" :leader="adding || ''" @close="adding = null" @added="added" />
		</div>`,
	}
})()
