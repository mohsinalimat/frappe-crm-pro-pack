/* Team and access: the presets (ready-made sets of access) and the editor for one. */
(() => {
	const { ref, reactive, computed, onMounted } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	V.PresetEditor = {
		props: { name: String, copyOf: String },
		emits: ['close'],
		setup(props, { emit }) {
			const isNew = !props.name
			const src = AX.data.presets.find((p) => p.name === (props.name || props.copyOf))
			const draft = reactive({ preset_name: props.name || (props.copyOf && src ? src.preset_name + ' copy' : ''), description: src ? src.description || '' : '', grants: {} })
			// every feature has a value: a copy / a new preset starts from the source (or from what a plain Sales User gets)
			AX.data.features.forEach((f) => { draft.grants[f.key] = src && f.key in src.grants ? src.grants[f.key] : AX.legacy(f, ['Sales User']) })
			const base = JSON.stringify(draft)
			const dirty = computed(() => JSON.stringify(draft) !== base)
			const saving = ref(false); const error = ref('')
			const rows = computed(() => AX.data.features.map((f) => ({ feature: f, value: draft.grants[f.key], source: 'preset' })))
			const change = (k, v) => { draft.grants[k] = v }
			const users = computed(() => (src && props.name ? src.users : 0))
			async function save() {
				error.value = ''
				if (!draft.preset_name.trim()) { error.value = 'Give the preset a name.'; return }
				saving.value = true
				try {
					await AX.api('save_preset', { preset_name: draft.preset_name.trim(), description: draft.description, grants: JSON.stringify(draft.grants), name: props.name || undefined })
					CM.toast('Preset saved'); await AX.load(true); emit('close')
				} catch (e) { error.value = e.message } finally { saving.value = false }
			}
			async function close() {
				if (dirty.value && !(await CM.confirm({ title: 'Discard your changes?', message: 'The preset has not been saved.', confirmText: 'Discard', danger: true }))) return
				emit('close')
			}
			return { isNew, draft, rows, change, dirty, saving, error, save, close, users }
		},
		template: `
		<Drawer wide :title="isNew ? 'New preset' : draft.preset_name" @close="close">
			<template #head><div class="grow"><h2>{{ isNew ? (copyOf ? 'Copy of ' + copyOf : 'New preset') : draft.preset_name }}</h2><p>{{ users ? users + ' ' + (users === 1 ? 'person uses' : 'people use') + ' this preset. Changes apply to them straight away.' : 'A preset is a ready-made set of access you can give to several people.' }}</p></div></template>
			<div class="col" style="gap:16px">
				<div v-if="error" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
				<div class="row wrap" style="gap:12px;align-items:flex-start">
					<Field label="Name" required class="grow"><input class="inp" v-model="draft.preset_name" :readonly="!isNew" aria-label="Preset name" placeholder="For example: Regional Manager" /></Field>
					<Field label="What it is for" class="grow" style="flex:2"><input class="inp" v-model="draft.description" aria-label="Description" placeholder="One line your team understands" /></Field>
				</div>
				<AccessGrid :rows="rows" @change="change" />
			</div>
			<template #foot><Btn @click="close">Cancel</Btn><Btn variant="primary" icon="save" :loading="saving" :disabled="!dirty" @click="save">{{ isNew ? 'Create preset' : 'Save preset' }}</Btn></template>
		</Drawer>`,
	}

	V.Presets = {
		setup() {
			const editing = ref(null); const copyOf = ref('')
			onMounted(() => AX.load())
			const d = AX.data
			function open(name, copy) { editing.value = { name: name || '' }; copyOf.value = copy || '' }
			const duplicate = (p) => open('', p.name) // the editor opens as a new preset filled from this one; you give it a name
			async function remove(p) {
				if (p.users) return CM.toast(p.users + ' ' + (p.users === 1 ? 'person uses' : 'people use') + ' this preset. Give them another one first.', 'warn')
				if (!(await CM.confirm({ title: 'Delete ' + p.preset_name + '?', message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return
				try { await AX.api('delete_preset', { name: p.name }); CM.toast('Preset deleted'); AX.load(true) } catch (e) { CM.toast(e.message, 'err') }
			}
			const summary = (p) => {
				const pick = ['followups', 'meetings', 'demos', 'campaigns']
				return pick.map((k) => AX.feature(k)).filter(Boolean).map((f) => ({ label: f.label, value: AX.label(f, p.grants[f.key] !== undefined ? p.grants[f.key] : AX.legacy(f, ['Sales User'])) }))
			}
			return { d, editing, copyOf, open, duplicate, remove, summary }
		},
		template: `
		<div class="page wide">
			<div class="pg-head"><div class="grow"><h1>Presets</h1><p>A preset is a ready-made set of access. Give one to a person on the People page, then change anything on top. Edit a preset and everyone using it follows.</p></div><div class="actions"><Btn variant="primary" icon="plus" @click="open()">New preset</Btn></div></div>
			<div v-if="d.error" class="alert err"><Ico name="alert" /><div class="grow">{{ d.error }}</div></div>
			<div v-if="!d.loaded && !d.error" class="ax-cards"><Skel h="170" r="12" v-for="n in 4" :key="n" /></div>
			<div v-else-if="d.loaded" class="ax-cards">
				<article v-for="p in d.presets" :key="p.name" class="card pad ax-preset">
					<div class="row" style="gap:8px"><b class="grow" style="font-size:15px">{{ p.preset_name }}</b><span v-if="p.is_system" class="badge sm nodot">Ready-made</span></div>
					<p class="small muted" style="margin:4px 0 10px;min-height:36px">{{ p.description || 'No description.' }}</p>
					<dl class="ax-sum"><template v-for="s in summary(p)" :key="s.label"><dt>{{ s.label }}</dt><dd>{{ s.value }}</dd></template></dl>
					<div class="row" style="gap:6px;margin-top:12px"><span class="small muted grow">{{ p.users }} {{ p.users === 1 ? 'person' : 'people' }}</span><Btn size="sm" @click="open(p.name)">Edit</Btn><Btn size="sm" variant="ghost" icon="copy" aria-label="Duplicate" title="Duplicate" @click="duplicate(p)" /><Btn size="sm" variant="ghost" icon="trash" aria-label="Delete" title="Delete" @click="remove(p)" /></div>
				</article>
			</div>
			<PresetEditor v-if="editing" :name="editing.name" :copy-of="copyOf" @close="editing = null" />
		</div>`,
	}
})()
