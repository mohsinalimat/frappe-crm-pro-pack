/* Team and access: the people list and the editor for one person. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	V.PersonEditor = {
		props: { user: String },
		emits: ['close', 'saved'],
		setup(props, { emit }) {
			const person = computed(() => AX.data.people.find((p) => p.user === props.user) || {})
			const loading = ref(true); const saving = ref(false); const resetting = ref(false); const error = ref('')
			const draft = reactive({ preset: '', overrides: {} })
			let saved = { preset: '', overrides: {} }
			const team = ref([])
			async function load() {
				loading.value = true; error.value = ''
				try {
					const r = await AX.api('get_user_access', { user: props.user })
					draft.preset = r.preset || ''; draft.overrides = { ...(r.overrides || {}) }; team.value = r.team || []
					saved = { preset: draft.preset, overrides: { ...draft.overrides } }
				} catch (e) { error.value = e.message } finally { loading.value = false }
			}
			onMounted(load)
			const preset = computed(() => AX.data.presets.find((p) => p.name === draft.preset))
			const isAdmin = computed(() => !!person.value.admin)
			const rows = computed(() => AX.data.features.map((f) => {
				const k = f.key
				if (isAdmin.value) return { feature: f, value: AX.top(f), source: 'admin' }
				if (k in draft.overrides) return { feature: f, value: draft.overrides[k], source: 'override' }
				if (preset.value && k in preset.value.grants) return { feature: f, value: preset.value.grants[k], source: 'preset' }
				return { feature: f, value: AX.legacy(f, person.value.roles), source: 'default' }
			}))
			const dirty = computed(() => draft.preset !== saved.preset || !AX.sameMap(draft.overrides, saved.overrides))
			function change(key, value) {
				const base = preset.value && key in preset.value.grants ? preset.value.grants[key] : undefined
				if (base !== undefined && String(base) === String(value)) delete draft.overrides[key]
				else draft.overrides[key] = value
			}
			const reset = (key) => { delete draft.overrides[key] }
			function onPreset(name) { draft.preset = name || '' }
			async function save() {
				saving.value = true
				try {
					await AX.api('save_user_access', { user: props.user, preset: draft.preset || null, overrides: JSON.stringify(draft.overrides) })
					CM.toast('Access saved for ' + person.value.full_name)
					await AX.load(true); emit('saved'); emit('close')
				} catch (e) { CM.toast(e.message, 'err') } finally { saving.value = false }
			}
			async function resetPassword() {
				if (!(await CM.confirm({ title: 'Send a password reset email?', message: person.value.full_name + ' gets an email with a link to choose a new password.', confirmText: 'Send email' }))) return
				resetting.value = true
				try { await AX.api('send_password_reset', { user: props.user }); CM.toast('Reset email sent to ' + props.user) } catch (e) { CM.toast(e.message, 'err') } finally { resetting.value = false }
			}
			async function close() {
				if (dirty.value && !(await CM.confirm({ title: 'Discard your changes?', message: 'The access settings of ' + person.value.full_name + ' have not been saved.', confirmText: 'Discard', danger: true }))) return
				emit('close')
			}
			const presetOptions = computed(() => [{ value: '', label: 'No preset (what their role gives them)' }, ...AX.data.presets.map((p) => ({ value: p.name, label: p.preset_name }))])
			return { person, loading, saving, resetting, error, draft, team, rows, dirty, isAdmin, change, reset, onPreset, save, resetPassword, close, presetOptions, preset, AX, CM }
		},
		template: `
		<Drawer wide :title="person.full_name" :subtitle="person.user" @close="close">
			<template #head>
				<div class="row" style="gap:12px"><Avatar :name="person.full_name || person.user" :size="40" /><div class="grow"><h2>{{ person.full_name }}</h2><p>{{ person.user }}</p></div></div>
			</template>
			<div v-if="loading" class="col" style="gap:12px"><Skel h="60" r="10" /><Skel h="220" r="12" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="$emit('close')" />
			<div v-else class="col" style="gap:16px">
				<div class="ax-facts">
					<div><span class="small muted">Roles</span><div class="row wrap" style="gap:4px"><span v-for="r in person.roles" :key="r" class="badge sm nodot">{{ r }}</span></div></div>
					<div><span class="small muted">Reports to</span><b>{{ person.reports_to || (AX.data.hierarchy.available ? 'Nobody (top of the tree, or not in it)' : 'No Sales Hierarchy in this CRM') }}</b></div>
					<div><span class="small muted">Their team</span><b>{{ person.team_size ? person.team_size + ' ' + (person.team_size === 1 ? 'person' : 'people') + ' below them' : 'Nobody below them' }}</b></div>
				</div>
				<div v-if="isAdmin" class="alert info"><Ico name="shield" /><div class="grow"><b>System Managers always have full access.</b> It cannot be limited here, so an administrator can never lock themselves out.</div></div>
				<Field v-else label="Preset" hint="A preset is a ready-made set of access. Change anything below to give this person more or less than the preset.">
					<Dd :model-value="draft.preset" :options="presetOptions" aria-label="Preset" @update:model-value="onPreset" />
				</Field>
				<AccessGrid :rows="rows" show-source :readonly="isAdmin" @change="change" @reset="reset" />
				<div class="card pad ax-acct">
					<div class="grow"><b>Account</b><div class="small muted">Adding people and the Sales Hierarchy are in CRM's own Settings (Users, Invite User, Sales Hierarchy). Passwords use Frappe's own reset.</div></div>
					<Btn icon="mail" :loading="resetting" @click="resetPassword">Send password reset email</Btn>
					<a class="btn" :href="'/app/user/' + encodeURIComponent(person.user)" target="_blank" rel="noopener"><Ico name="external" />Open the user</a>
				</div>
			</div>
			<template #foot>
				<span v-if="dirty" class="small" style="margin-right:auto;color:var(--amber)">Unsaved changes</span>
				<Btn @click="close">Cancel</Btn><Btn variant="primary" icon="save" :loading="saving" :disabled="!dirty || isAdmin" @click="save">Save access</Btn>
			</template>
		</Drawer>`,
	}

	V.People = {
		setup() {
			const q = ref(''); const filter = ref('all'); const editing = ref(null)
			onMounted(() => AX.load())
			const d = AX.data
			const people = computed(() => d.people.filter((p) => {
				if (filter.value === 'custom' && !p.configured) return false
				if (filter.value === 'default' && p.configured) return false
				const s = q.value.trim().toLowerCase()
				return !s || (p.full_name + ' ' + p.user).toLowerCase().includes(s)
			}))
			const counts = computed(() => ({ all: d.people.length, custom: d.people.filter((p) => p.configured).length, default: d.people.filter((p) => !p.configured).length }))
			return { d, q, filter, editing, people, counts, AX }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Team and access</h1><p>Choose who sees what in Pro Pack: follow-ups, meetings, demos, assignment and the Campaign Manager. Each person gets a preset, and you can change anything on top of it.</p></div></div>
			<div v-if="d.error" class="alert err"><Ico name="alert" /><div class="grow">{{ d.error }}</div></div>
			<div v-if="d.loaded && !d.hierarchy.available" class="alert warn"><Ico name="info" /><div class="grow"><b>This CRM has no Sales Hierarchy.</b> "My team" then means just the person themselves. Newer Frappe CRM versions have the hierarchy in Settings, under User Management.</div></div>
			<div v-else-if="d.loaded && !d.hierarchy.enabled" class="alert info"><Ico name="info" /><div class="grow"><b>The Sales Hierarchy is switched off in CRM.</b> "My team" still follows the tree ({{ d.hierarchy.people }} people in it); CRM itself only uses it for leads once you switch it on in Settings.</div></div>
			<div class="row wrap" style="gap:10px">
				<div style="width:300px"><Inp v-model="q" icon="search" placeholder="Search people" clearable aria-label="Search people" /></div>
				<Seg v-model="filter" :options="[{ value: 'all', label: 'All (' + counts.all + ')' }, { value: 'custom', label: 'Customised (' + counts.custom + ')' }, { value: 'default', label: 'Role default (' + counts.default + ')' }]" />
			</div>
			<div v-if="!d.loaded && !d.error" class="col" style="gap:10px"><Skel h="56" r="10" v-for="n in 6" :key="n" /></div>
			<Empty v-else-if="d.loaded && !people.length" icon="users" title="Nobody matches" text="Only people with a Sales User, Sales Manager, System Manager or Campaign Manager role are listed. Add and invite people in CRM's own Settings." />
			<div v-else-if="d.loaded" class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="tbl ax-tbl">
				<thead><tr><th>Person</th><th>Roles</th><th>Reports to</th><th>Access</th><th></th></tr></thead>
				<tbody><tr v-for="p in people" :key="p.user" class="click" tabindex="0" @click="editing = p.user" @keydown.enter="editing = p.user">
					<td><div class="row" style="gap:10px"><Avatar :name="p.full_name" :size="32" /><div><b>{{ p.full_name }}</b><div class="small muted">{{ p.user }}</div></div></div></td>
					<td><div class="row wrap" style="gap:4px"><span v-for="r in p.roles" :key="r" class="badge sm nodot">{{ r }}</span></div></td>
					<td><template v-if="p.reports_to">{{ p.reports_to }}</template><span v-else class="muted">-</span><div v-if="p.team_size" class="small muted">{{ p.team_size }} below</div></td>
					<td><span v-if="p.admin" class="badge sm nodot green">Full access</span><template v-else><span v-if="p.preset" class="badge sm nodot blue">{{ p.preset }}</span><span v-else class="small muted">Role default</span><span v-if="p.overrides" class="badge sm nodot amber" style="margin-left:6px">{{ p.overrides }} change{{ p.overrides === 1 ? '' : 's' }}</span></template></td>
					<td style="text-align:right"><Btn size="sm" @click.stop="editing = p.user">Edit access</Btn></td>
				</tr></tbody>
			</table></div></div>
			<PersonEditor v-if="editing" :user="editing" @close="editing = null" />
		</div>`,
	}
})()
