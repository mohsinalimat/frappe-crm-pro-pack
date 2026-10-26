/* Team and access: the people list and the editor for one person. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	/** A person's picture, or their initials when there is none. */
	V.Pic = {
		props: { name: String, image: String, size: { type: Number, default: 32 } },
		template: `<img v-if="image" :src="image" alt="" :width="size" :height="size" style="border-radius:50%;object-fit:cover;flex:none" /><Avatar v-else :name="name || '?'" :size="size" />`,
	}
	/** Upload a profile picture (public file); emits the file url. */
	V.PhotoPick = {
		props: { modelValue: String, name: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const input = ref(null); const busy = ref(false)
			async function pick(e) {
				const file = e.target.files && e.target.files[0]; e.target.value = ''
				if (!file) return
				if (!/^image\//.test(file.type)) { CM.toast('Choose an image file.', 'err'); return }
				if (file.size > 3 * 1048576) { CM.toast('The picture is over 3 MB.', 'err'); return }
				busy.value = true
				try { const res = await CM.upload(file, { isPrivate: false }); emit('update:modelValue', res.file_url) } catch (err) { CM.toast(err.message, 'err') } finally { busy.value = false }
			}
			return { input, busy, pick }
		},
		template: `<div class="row" style="gap:12px"><Pic :name="name" :image="modelValue" :size="56" /><div class="col" style="gap:4px;align-items:flex-start"><div class="row" style="gap:8px"><Btn size="sm" :loading="busy" @click="input.click()">{{ modelValue ? 'Change photo' : 'Upload photo' }}</Btn><Btn v-if="modelValue" size="sm" variant="ghost" @click="$emit('update:modelValue', '')">Remove</Btn></div><span class="small muted">PNG or JPG, up to 3 MB.</span></div><input ref="input" type="file" accept="image/*" hidden @change="pick" /></div>`,
	}
	AX.leaderOptions = (except) => AX.data.people.filter((p) => p.enabled && p.user !== except).map((p) => ({ value: p.user, label: p.full_name, sub: p.user }))

	V.PersonEditor = {
		props: { user: String },
		emits: ['close', 'saved'],
		setup(props, { emit }) {
			const person = computed(() => AX.data.people.find((p) => p.user === props.user) || {})
			const loading = ref(true); const saving = ref(false); const resetting = ref(false); const error = ref('')
			const draft = reactive({ preset: '', overrides: {} })
			let saved = { preset: '', overrides: {} }
			const pf = reactive({ first_name: '', last_name: '', mobile_no: '', designation: '', company: '', image: '', reports_to: '' })
			let savedPf = JSON.stringify(pf)
			const toggling = ref(false)
			const team = ref([])
			async function load() {
				loading.value = true; error.value = ''
				try {
					const r = await AX.api('get_user_access', { user: props.user })
					draft.preset = r.preset || ''; draft.overrides = { ...(r.overrides || {}) }; team.value = r.team || []
					saved = { preset: draft.preset, overrides: { ...draft.overrides } }
					const p = r.profile || {}
					Object.assign(pf, { first_name: p.first_name || '', last_name: p.last_name || '', mobile_no: p.mobile_no || '', designation: p.designation || '', company: p.company || '', image: p.image || '', reports_to: p.reports_to || '' })
					savedPf = JSON.stringify(pf)
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
			const accessDirty = computed(() => draft.preset !== saved.preset || !AX.sameMap(draft.overrides, saved.overrides))
			const profileDirty = computed(() => JSON.stringify(pf) !== savedPf)
			const dirty = computed(() => accessDirty.value || profileDirty.value)
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
					if (profileDirty.value) {
						const old = JSON.parse(savedPf)
						await AX.api('update_person', { user: props.user, first_name: pf.first_name, last_name: pf.last_name, mobile_no: pf.mobile_no, designation: pf.designation, company: pf.company, user_image: pf.image, reports_to: pf.reports_to, set_leader: pf.reports_to !== old.reports_to ? 1 : 0 })
						savedPf = JSON.stringify(pf)
					}
					if (accessDirty.value) await AX.api('save_user_access', { user: props.user, preset: draft.preset || null, overrides: JSON.stringify(draft.overrides) })
					CM.toast('Saved for ' + person.value.full_name)
					await AX.load(true); emit('saved'); emit('close')
				} catch (e) { CM.toast(e.message, 'err') } finally { saving.value = false }
			}
			async function toggleActive(on) {
				const name = person.value.full_name
				if (!on && !(await CM.confirm({ title: 'Switch off ' + name + '?', message: 'They are signed out and cannot log in. Their leads, meetings and history stay. You can switch them on again any time.', confirmText: 'Switch off', danger: true }))) return
				toggling.value = true
				try { await AX.api('set_active', { user: props.user, enabled: on ? 1 : 0 }); await AX.load(true); CM.toast(name + (on ? ' is active again.' : ' is switched off.')) } catch (e) { CM.toast(e.message, 'err') } finally { toggling.value = false }
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
			return { pf, toggling, toggleActive, accessDirty, profileDirty, leaderOptions: computed(() => AX.leaderOptions(props.user)), person, loading, saving, resetting, error, draft, team, rows, dirty, isAdmin, change, reset, onPreset, save, resetPassword, close, presetOptions, preset, AX, CM }
		},
		template: `
		<Drawer wide :title="person.full_name" :subtitle="person.user" @close="close">
			<template #head>
				<div class="row ax-head" style="gap:12px">
					<Pic :name="person.full_name || person.user" :image="pf.image || person.image" :size="44" />
					<div class="grow" style="min-width:0"><h2 class="ellipsis">{{ person.full_name }}</h2><p class="ellipsis">{{ person.designation ? person.designation + ' - ' : '' }}{{ person.user }}</p></div>
					<div class="row ax-head-actions" style="gap:8px">
						<label class="row" style="gap:6px" :title="person.enabled ? 'Active: they can log in' : 'Inactive: they cannot log in'"><span class="small" :class="person.enabled ? '' : 'faint'">{{ person.enabled ? 'Active' : 'Inactive' }}</span><Switch :model-value="!!person.enabled" :label="person.enabled ? 'Switch account off' : 'Switch account on'" :aria-disabled="toggling" @update:model-value="(v) => !toggling && toggleActive(v)" /></label>
						<Btn size="sm" icon="mail" :loading="resetting" @click="resetPassword">Reset password</Btn>
						<a class="btn sm" :href="'/app/user/' + encodeURIComponent(person.user)" target="_blank" rel="noopener"><Ico name="external" />Open in browser</a>
					</div>
				</div>
			</template>
			<div v-if="loading" class="col" style="gap:12px"><Skel h="60" r="10" /><Skel h="220" r="12" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="$emit('close')" />
			<div v-else class="col" style="gap:16px">
				<div class="ax-facts">
					<div><span class="small muted">Roles</span><div class="row wrap" style="gap:4px"><span v-for="r in person.roles" :key="r" class="badge sm nodot">{{ r }}</span></div></div>
					<div><span class="small muted">Reports to</span><b>{{ person.reports_to || (AX.data.hierarchy.available ? 'Nobody (top of the tree, or not in it)' : 'No Sales Hierarchy in this CRM') }}</b></div>
					<div><span class="small muted">Their team</span><b>{{ person.team_size ? person.team_size + ' ' + (person.team_size === 1 ? 'person' : 'people') + ' below them' : 'Nobody below them' }}</b></div>
				</div>
				<div class="card pad col" style="gap:12px">
					<b>Profile</b>
					<PhotoPick v-model="pf.image" :name="person.full_name" />
					<div class="ax-two"><Field label="First name"><Inp v-model="pf.first_name" aria-label="First name" /></Field><Field label="Last name"><Inp v-model="pf.last_name" aria-label="Last name" /></Field></div>
					<div class="ax-two"><Field label="Contact number" hint="Their default number in CRM."><Inp v-model="pf.mobile_no" placeholder="+91 98765 43210" aria-label="Contact number" /></Field><Field label="Designation"><Inp v-model="pf.designation" placeholder="e.g. Sales Executive" aria-label="Designation" /></Field></div>
					<div class="ax-two"><Field label="Company"><Inp v-model="pf.company" aria-label="Company" /></Field>
						<Field v-if="AX.data.hierarchy.available" label="Team leader" hint="Reports to, in CRM's Sales Hierarchy."><Dd v-model="pf.reports_to" :options="leaderOptions" searchable allow-empty="Nobody" placeholder="Nobody" aria-label="Team leader" /></Field></div>
				</div>
				<div v-if="isAdmin" class="alert info"><Ico name="shield" /><div class="grow"><b>System Managers always have full access.</b> It cannot be limited here, so an administrator can never lock themselves out.</div></div>
				<Field v-else label="Preset" hint="A preset is a ready-made set of access. Change anything below to give this person more or less than the preset.">
					<Dd :model-value="draft.preset" :options="presetOptions" aria-label="Preset" @update:model-value="onPreset" />
				</Field>
				<AccessGrid :rows="rows" show-source :readonly="isAdmin" @change="change" @reset="reset" />
				<div class="card pad ax-acct" v-if="false">
					<div class="grow"><b>Account</b><div class="small muted">The Sales Hierarchy is in CRM's own Settings. Passwords use Frappe's own reset.</div></div>
					<Btn icon="mail" :loading="resetting" @click="resetPassword">Send password reset email</Btn>
					<a class="btn" :href="'/app/user/' + encodeURIComponent(person.user)" target="_blank" rel="noopener"><Ico name="external" />Open the user</a>
				</div>
			</div>
			<template #foot>
				<span v-if="dirty" class="small" style="margin-right:auto;color:var(--amber)">Unsaved changes</span>
				<Btn @click="close">Cancel</Btn><Btn variant="primary" icon="save" :loading="saving" :disabled="!dirty || (isAdmin && !profileDirty)" @click="save">Save changes</Btn>
			</template>
		</Drawer>`,
	}

	V.AddPerson = {
		emits: ['close', 'added'],
		setup(props, { emit }) {
			const lastCompany = (AX.data.people.map((p) => p.company).filter(Boolean)[0]) || ''
			const f = reactive({ email: '', first_name: '', last_name: '', mobile_no: '', designation: '', company: lastCompany, image: '', role: 'Sales User', preset: '', reports_to: '', invite: true })
			const busy = ref(false); const err = ref('')
			const SHOWN = ['Sales Executive', 'Sales Manager', 'Campaign Executive']
			const presetOptions = computed(() => [{ value: '', label: 'No preset (what their role gives them)' }, ...AX.data.presets.filter((p) => SHOWN.includes(p.name)).map((p) => ({ value: p.name, label: p.preset_name, sub: p.description }))])
			const leaderOptions = computed(() => AX.leaderOptions(''))
			async function submit() {
				err.value = ''
				if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) { err.value = 'Enter a valid email address.'; return }
				if (!f.first_name.trim()) { err.value = 'Enter the first name.'; return }
				busy.value = true
				try {
					const r = await AX.api('add_person', { email: f.email.trim(), first_name: f.first_name.trim(), last_name: f.last_name.trim(), role: f.role, preset: f.preset || null, send_invite: f.invite ? 1 : 0, mobile_no: f.mobile_no, designation: f.designation, company: f.company, user_image: f.image, reports_to: f.reports_to || null })
					await AX.load(true)
					const notes = [...(r.invite_problem ? ['The invitation email could not be sent: ' + r.invite_problem] : []), ...(r.problems || [])]
					CM.toast(!r.created ? f.email + ' already had an account and now has the role.' : (r.invited ? f.email + ' is added and the invitation email is sent.' : f.email + ' is added.') + (notes.length ? ' ' + notes.join(' ') : ''), notes.length ? 'err' : undefined)
					emit('added', r.user)
				} catch (e) { err.value = e.message } finally { busy.value = false }
			}
			return { f, busy, err, presetOptions, leaderOptions, submit, AX }
		},
		template: `
		<Modal size="lg" title="Add a person" subtitle="They get a CRM login with the role below." @close="$emit('close')" @submit="submit">
			<div class="col" style="gap:14px">
				<div v-if="err" class="alert err"><Ico name="alert" /><div class="grow">{{ err }}</div></div>
				<PhotoPick v-model="f.image" :name="(f.first_name + ' ' + f.last_name).trim() || f.email" />
				<div class="ax-two"><Field label="First name" required><Inp v-model="f.first_name" aria-label="First name" /></Field><Field label="Last name"><Inp v-model="f.last_name" aria-label="Last name" /></Field></div>
				<div class="ax-two"><Field label="Email" required><Inp v-model="f.email" placeholder="name@company.com" aria-label="Email" /></Field><Field label="Contact number" hint="Their default number in CRM."><Inp v-model="f.mobile_no" placeholder="+91 98765 43210" aria-label="Contact number" /></Field></div>
				<div class="ax-two"><Field label="Designation"><Inp v-model="f.designation" placeholder="e.g. Sales Executive" aria-label="Designation" /></Field><Field label="Company"><Inp v-model="f.company" aria-label="Company" /></Field></div>
				<Field label="Role in CRM" hint="Sales Manager can also manage other people's leads in CRM. Sales User sees their own."><Seg v-model="f.role" :options="[{ value: 'Sales User', label: 'Sales User' }, { value: 'Sales Manager', label: 'Sales Manager' }]" /></Field>
				<div class="ax-two"><Field label="Preset" hint="The ready-made access to start from."><Dd v-model="f.preset" :options="presetOptions" aria-label="Preset" /></Field>
					<Field v-if="AX.data.hierarchy.available" label="Team leader" hint="They are added under this person in the Sales Hierarchy."><Dd v-model="f.reports_to" :options="leaderOptions" searchable allow-empty="Nobody" placeholder="Nobody" aria-label="Team leader" /></Field></div>
				<label class="check"><input type="checkbox" v-model="f.invite" /> Email them an invitation to set a password</label>
			</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="plus" :loading="busy" @click="submit">Add person</Btn></template>
		</Modal>`,
	}

	V.People = {
		setup() {
			const q = ref(''); const filter = ref('all'); const editing = ref(null); const adding = ref(false)
			onMounted(() => AX.load())
			const d = AX.data
			const people = computed(() => d.people.filter((p) => {
				if (filter.value === 'custom' && !p.configured) return false
				if (filter.value === 'default' && p.configured) return false
				if (filter.value === 'inactive' && p.enabled) return false
				if (filter.value !== 'inactive' && filter.value !== 'all' && !p.enabled) return false
				const s = q.value.trim().toLowerCase()
				return !s || (p.full_name + ' ' + p.user).toLowerCase().includes(s)
			}))
			const counts = computed(() => ({ all: d.people.length, custom: d.people.filter((p) => p.configured).length, default: d.people.filter((p) => !p.configured).length, inactive: d.people.filter((p) => !p.enabled).length }))
			return { d, q, filter, editing, adding, people, counts, AX }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Team and access</h1><p>Choose who sees what in Pro Pack: follow-ups, meetings, demos, assignment and the Campaign Manager. Each person gets a preset, and you can change anything on top of it.</p></div><div class="actions"><Btn variant="primary" icon="plus" @click="adding = true">Add person</Btn></div></div>
			<div v-if="d.error" class="alert err"><Ico name="alert" /><div class="grow">{{ d.error }}</div></div>
			<div v-if="d.loaded && !d.hierarchy.available" class="alert warn"><Ico name="info" /><div class="grow"><b>This CRM has no Sales Hierarchy.</b> "My team" then means just the person themselves. Newer Frappe CRM versions have the hierarchy in Settings, under User Management.</div></div>
			<div v-else-if="d.loaded && !d.hierarchy.enabled" class="alert info"><Ico name="info" /><div class="grow"><b>The Sales Hierarchy is switched off in CRM.</b> "My team" still follows the tree ({{ d.hierarchy.people }} people in it); CRM itself only uses it for leads once you switch it on in Settings.</div></div>
			<div class="row wrap" style="gap:10px">
				<div style="width:300px"><Inp v-model="q" icon="search" placeholder="Search people" clearable aria-label="Search people" /></div>
				<Seg v-model="filter" :options="[{ value: 'all', label: 'All (' + counts.all + ')' }, { value: 'custom', label: 'Customised (' + counts.custom + ')' }, { value: 'default', label: 'Role default (' + counts.default + ')' }, ...(counts.inactive ? [{ value: 'inactive', label: 'Inactive (' + counts.inactive + ')' }] : [])]" />
			</div>
			<div v-if="!d.loaded && !d.error" class="col" style="gap:10px"><Skel h="56" r="10" v-for="n in 6" :key="n" /></div>
			<Empty v-else-if="d.loaded && !people.length" icon="users" title="Nobody matches" text="Only people with a Sales User, Sales Manager, System Manager or Campaign Manager role are listed. Use Add person to invite someone." />
			<div v-else-if="d.loaded" class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="tbl ax-tbl">
				<thead><tr><th>Person</th><th>Roles</th><th>Reports to</th><th>Access</th><th></th></tr></thead>
				<tbody><tr v-for="p in people" :key="p.user" class="click" :class="{ inactive: !p.enabled }" tabindex="0" @click="editing = p.user" @keydown.enter="editing = p.user">
					<td><div class="row" style="gap:10px"><Pic :name="p.full_name" :image="p.image" :size="32" /><div><b>{{ p.full_name }}</b><span v-if="!p.enabled" class="badge sm nodot" style="margin-left:6px">Inactive</span><div class="small muted">{{ p.designation ? p.designation + ' - ' : '' }}{{ p.user }}</div></div></div></td>
					<td><div class="row wrap" style="gap:4px"><span v-for="r in p.roles" :key="r" class="badge sm nodot">{{ r }}</span></div></td>
					<td><template v-if="p.reports_to">{{ p.reports_to }}</template><span v-else class="muted">-</span><div v-if="p.team_size" class="small muted">{{ p.team_size }} below</div></td>
					<td><span v-if="p.admin" class="badge sm nodot green">Full access</span><template v-else><span v-if="p.preset" class="badge sm nodot blue">{{ p.preset }}</span><span v-else class="small muted">Role default</span><span v-if="p.overrides" class="badge sm nodot amber" style="margin-left:6px">{{ p.overrides }} change{{ p.overrides === 1 ? '' : 's' }}</span></template></td>
					<td style="text-align:right"><Btn size="sm" @click.stop="editing = p.user">Edit access</Btn></td>
				</tr></tbody>
			</table></div></div>
			<PersonEditor v-if="editing" :user="editing" @close="editing = null" />
			<AddPerson v-if="adding" @close="adding = false" @added="(u) => { adding = false; editing = u }" />
		</div>`,
	}
})()
