/* Team and access: the Sales Hierarchy. Who reports to whom, as a tree; change a leader, add or take out people. */
(() => {
	const { ref, reactive, computed, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	V.Hierarchy = {
		setup() {
			const h = ref(null); const loading = ref(true); const error = ref(''); const busy = ref('')
			async function load() { loading.value = true; error.value = ''; try { h.value = await AX.api('get_hierarchy', {}) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(load)
			async function act(key, method, args, ok) {
				busy.value = key
				try { h.value = await AX.api(method, args); AX.load(true); if (ok) CM.toast(ok) } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = '' }
			}
			const people = computed(() => (h.value ? [...h.value.tree, ...h.value.loose] : []))
			const options = (self) => people.value.filter((p) => p.user !== self && p.enabled !== false).map((p) => ({ value: p.user, label: p.full_name, sub: p.designation || p.user }))
			const setLeader = (u, leader) => act(u, 'set_leader', { user: u, reports_to: leader || null }, 'Saved')
			async function remove(n) {
				if (!(await CM.confirm({ title: 'Take ' + n.full_name + ' out of the hierarchy?', message: 'They stay a user. Their access and everything else is unchanged; "My team" for them is then just themselves.', confirmText: 'Take out' }))) return
				act(n.user, 'remove_from_hierarchy', { user: n.user }, n.full_name + ' is out of the hierarchy')
			}
			const toggleCrm = (on) => act('crm', 'set_hierarchy_enabled', { enabled: on ? 1 : 0 }, on ? 'Switched on in CRM' : 'Switched off in CRM')
			return { h, loading, error, busy, options, setLeader, remove, toggleCrm, load, AX }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Hierarchy</h1><p>Who reports to whom. <b>My team</b> means a person and everyone below them, and it is used by every access level that says "My team".</p></div></div>
			<div v-if="loading" class="col" style="gap:10px"><Skel h="56" r="10" v-for="n in 5" :key="n" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<div v-else-if="!h.available" class="alert warn"><Ico name="info" /><div class="grow"><b>This CRM has no Sales Hierarchy.</b> It exists in newer versions of Frappe CRM. Update CRM to use it; until then "My team" means just the person themselves.</div></div>
			<template v-else>
				<div class="card pad row" style="gap:12px"><div class="grow"><b>Use the Sales Hierarchy in CRM</b><div class="small muted">CRM's own switch. {{ h.enabled ? 'On: CRM uses the tree for who sees which leads.' : 'Off: CRM ignores the tree for leads. "My team" in this app still follows it.' }}</div></div><Switch :model-value="!!h.enabled" label="Use the Sales Hierarchy in CRM" :aria-disabled="busy === 'crm'" @update:model-value="(v) => busy !== 'crm' && toggleCrm(v)" /></div>
				<div class="card" style="padding:0;overflow:hidden">
					<div v-if="!h.tree.length" class="pad muted">Nobody is in the hierarchy yet. Add people below, or choose a team leader when you add a person.</div>
					<div v-for="n in h.tree" :key="n.user" class="hx-row" :class="{ inactive: !n.enabled }" :style="{ paddingLeft: (14 + n.depth * 28) + 'px' }">
						<span v-if="n.depth" class="hx-elbow" aria-hidden="true"></span>
						<Pic :name="n.full_name" :image="n.image" :size="32" />
						<div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">{{ n.full_name }}<span v-if="!n.enabled" class="badge sm nodot" style="margin-left:6px">Inactive</span></b><div class="small muted ellipsis">{{ n.designation ? n.designation + ' - ' : '' }}{{ n.below ? n.below + ' below' : 'no team' }}</div></div>
						<div class="hx-dd"><Dd :model-value="n.reports_to || ''" :options="options(n.user)" searchable allow-empty="Top level (reports to nobody)" placeholder="Top level" size="sm" :disabled="busy === n.user" aria-label="Reports to" @change="(v) => setLeader(n.user, v)" /></div>
						<Btn size="sm" variant="ghost" icon="x" :disabled="busy === n.user || n.below > 0" :title="n.below > 0 ? 'Move their team first' : 'Take out of the hierarchy'" aria-label="Take out of the hierarchy" @click="remove(n)" />
					</div>
				</div>
				<template v-if="h.loose.length">
					<h4 class="dh">Not in the hierarchy <span class="faint small">{{ h.loose.length }} {{ h.loose.length === 1 ? 'person' : 'people' }}: choose who they report to</span></h4>
					<div class="card" style="padding:0;overflow:hidden"><div v-for="p in h.loose" :key="p.user" class="hx-row">
						<Pic :name="p.full_name" :image="p.image" :size="32" />
						<div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">{{ p.full_name }}</b><div class="small muted ellipsis">{{ p.designation || p.user }}</div></div>
						<div class="hx-dd"><Dd model-value="" :options="options(p.user)" searchable placeholder="Add under..." size="sm" :disabled="busy === p.user" aria-label="Add under" @change="(v) => v && setLeader(p.user, v)" /></div>
						<Btn size="sm" :disabled="busy === p.user" @click="setLeader(p.user, '')">Add at the top</Btn>
					</div></div>
				</template>
			</template>
		</div>`,
	}
})()
