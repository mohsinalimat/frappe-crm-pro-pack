/* Suite Pro: forms drawn from CRM's own field layout. FormFields draws every field of the sections the server sends (see pro/form.py). */
(() => {
	const { ref, computed, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const NUM = ['Int', 'Float', 'Currency', 'Percent']
	const TEXT = ['Small Text', 'Text', 'Long Text']

	/** A Link field: type to search the linked records; the list comes from the server as you type. */
	V.LinkPick = {
		props: { modelValue: String, doctype: String, label: String, disabled: Boolean },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const opts = ref([]); const id = 'lp' + Math.random().toString(36).slice(2, 8); let timer
			async function search(txt) { try { opts.value = await CM.call('crm_addons.pro.form.link_options', { doctype: props.doctype, txt }) } catch (e) { opts.value = [] } }
			const input = (e) => { emit('update:modelValue', e.target.value); clearTimeout(timer); timer = setTimeout(() => search(e.target.value), 250) }
			search('')
			return { opts, id, input }
		},
		template: `<span><input class="inp" :list="id" :value="modelValue" :disabled="disabled" :aria-label="label" autocomplete="off" @input="input" /><datalist :id="id"><option v-for="o in opts" :key="o.value" :value="o.value">{{ o.label !== o.value ? o.label : '' }}</option></datalist></span>`,
	}

	V.FormField = {
		props: { spec: Object, modelValue: [String, Number, Boolean], disabled: Boolean },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const set = (v) => emit('update:modelValue', v)
			const kind = computed(() => { const t = props.spec.fieldtype; return t === 'Select' ? 'select' : t === 'Link' ? 'link' : t === 'Check' ? 'check' : t === 'Date' ? 'date' : t === 'Datetime' ? 'datetime' : NUM.includes(t) ? 'num' : TEXT.includes(t) ? 'area' : 'text' })
			const opts = computed(() => (props.spec.options || []).map((o) => ({ value: o, label: o || 'Not set' })))
			const dt = computed(() => String(props.modelValue || '').slice(0, 16).replace(' ', 'T'))
			return { set, kind, opts, dt }
		},
		template: `
		<Field :label="spec.label" :required="!!spec.reqd" :hint="spec.description || ''">
			<Dd v-if="kind === 'select'" :modelValue="modelValue || ''" :options="opts" :disabled="disabled" :aria-label="spec.label" @update:modelValue="set" />
			<LinkPick v-else-if="kind === 'link'" :modelValue="modelValue || ''" :doctype="spec.options" :label="spec.label" :disabled="disabled" @update:modelValue="set" />
			<Switch v-else-if="kind === 'check'" :modelValue="!!Number(modelValue)" :label="spec.label" @update:modelValue="(v) => set(v ? 1 : 0)" />
			<input v-else-if="kind === 'date'" class="inp" type="date" :value="modelValue || ''" :disabled="disabled" :aria-label="spec.label" @input="set($event.target.value)" />
			<input v-else-if="kind === 'datetime'" class="inp" type="datetime-local" :value="dt" :disabled="disabled" :aria-label="spec.label" @input="set($event.target.value ? $event.target.value.replace('T', ' ') + ':00' : '')" />
			<input v-else-if="kind === 'num'" class="inp" type="number" step="any" :value="modelValue ?? ''" :disabled="disabled" :aria-label="spec.label" @input="set($event.target.value)" />
			<textarea v-else-if="kind === 'area'" class="inp" rows="3" :value="modelValue || ''" :disabled="disabled" :aria-label="spec.label" @input="set($event.target.value)"></textarea>
			<input v-else class="inp" :value="modelValue || ''" :disabled="disabled" :aria-label="spec.label" @input="set($event.target.value)" />
		</Field>`,
	}

	/** The sections of a CRM layout as a form. ``values`` is one object edited in place. */
	V.FormFields = {
		props: { sections: Array, values: Object },
		template: `<div><section v-for="(s, i) in sections" :key="i" class="fsec"><h4 v-if="s.label" class="dh">{{ s.label }}</h4><div class="grid2"><FormField v-for="f in s.fields" :key="f.fieldname" :spec="f" :modelValue="values[f.fieldname]" @update:modelValue="(v) => (values[f.fieldname] = v)" /></div></section></div>`,
	}
})()
