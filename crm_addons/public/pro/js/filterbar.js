/* Suite Pro: the filter controls of the Leads list. Every filter is "includes these values" or "does not include these values" (any number of values, picked
   from the values the leads really have): no "equals" anywhere. They read and write CRM's own filter object (IN / NOT IN / BETWEEN), so a filter set here is a
   filter CRM understands. */
(() => {
	const { ref, reactive, computed, watch, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const api = (m, a) => CM.call(m, a)
	const BASE = { converted: 0 }
	const isDate = (f) => !!f && ['Date', 'Datetime'].includes(f.fieldtype)
	const NONE = { preset: 'any', from: '', to: '' }

	/** The value of one field in CRM's filter object, as {op: 'in' | 'not in', values}. */
	function valueOf(filters, k) {
		const v = (filters || {})[k]
		if (v == null) return { op: 'in', values: [] }
		if (!Array.isArray(v)) return { op: 'in', values: [v] }
		const o = String(v[0]).toLowerCase()
		if (o === 'in' || o === 'not in') return { op: o, values: [].concat(v[1]) }
		if (o === '!=') return { op: 'not in', values: [v[1]] }
		return { op: 'in', values: [String(v[1]).replace(/^%|%$/g, '')] }
	}
	function withValue(filters, k, val) {
		const f = { ...filters }
		if (val && val.values && val.values.length) f[k] = [val.op === 'not in' ? 'NOT IN' : 'IN', val.values]
		else delete f[k]
		return f
	}
	function rangeOf(filters, k) {
		const v = (filters || {})[k]
		if (Array.isArray(v) && String(v[0]).toLowerCase() === 'between') return { preset: 'custom', from: String(v[1][0]).slice(0, 10), to: String(v[1][1]).slice(0, 10) }
		return { ...NONE }
	}
	function withRange(filters, k, r) {
		const f = { ...filters }; const x = CM.resolveRange(r)
		if (x.from) f[k] = ['BETWEEN', [x.from, x.to || x.from]]; else delete f[k]
		return f
	}
	const activeKeys = (filters) => Object.keys(filters || {}).filter((k) => !(k in BASE))
	PRO.filt = { valueOf, withValue, rangeOf, withRange, activeKeys, isDate, BASE, NONE }

	const label = (f, v) => (f && f.fieldtype === 'Check' ? (+v ? 'Yes' : 'No') : PRO.users[v] ? PRO.users[v].full_name : String(v))

	/** Pick values of one field: includes / does not include. Greyed-out clear icon until something is picked. */
	V.ValuePick = {
		props: { field: Object, modelValue: { type: Object, default: () => ({ op: 'in', values: [] }) }, showOp: { type: Boolean, default: true }, bare: Boolean },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const trig = ref(null); const q = ref(''); const opts = ref([]); const busy = ref(false); let seq = 0, timer
			const p = CM.usePop(() => trig.value, { width: 260 })
			const vals = computed(() => props.modelValue.values || [])
			async function load() {
				const mine = ++seq; busy.value = true
				try {
					if (props.field.fieldtype === 'Check') { opts.value = [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]; return }
					const r = await api('crm_addons.pro.leads.field_values', { fieldname: props.field.fieldname, txt: q.value.trim() })
					if (mine === seq) opts.value = r.map((x) => ({ value: x.value, count: x.count, label: label(props.field, x.value) }))
				} catch (e) { if (mine === seq) opts.value = [] } finally { if (mine === seq) busy.value = false }
			}
			const list = computed(() => {
				const have = new Set(opts.value.map((o) => o.value))
				const t = q.value.trim().toLowerCase()
				const picked = vals.value.filter((v) => !have.has(v) && (!t || label(props.field, v).toLowerCase().includes(t))).map((v) => ({ value: v, label: label(props.field, v) }))
				return [...picked, ...opts.value]
			})
			const has = (v) => vals.value.includes(v)
			const set = (values, op) => emit('update:modelValue', { op: op || props.modelValue.op || 'in', values })
			const flip = (v) => set(has(v) ? vals.value.filter((x) => x !== v) : [...vals.value, v])
			const text = computed(() => {
				const n = vals.value.length; if (!n) return props.field.label
				const pre = props.modelValue.op === 'not in' ? 'not ' : ''
				return props.field.label + ': ' + pre + label(props.field, vals.value[0]) + (n > 1 ? ' +' + (n - 1) : '')
			})
			function toggle() { if (!p.open.value) { q.value = ''; load() } p.toggle() }
			watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 250) })
			return { ...p, trig, q, list, has, flip, text, toggle, vals, busy, set, clear: () => set([]) }
		},
		template: `
		<div class="vp dd" :class="{ on: vals.length }">
			<button ref="trig" type="button" class="dd-btn sm" :class="{ open }" :aria-label="field.label" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
				<span class="lab" :class="{ ph: !vals.length }">{{ text }}</span><Ico v-if="bare" name="chevron-down" size="sm" class="chev" />
			</button>
			<button v-if="!bare" type="button" class="vp-x" :class="{ on: vals.length }" :aria-label="'Clear ' + field.label" title="Clear this filter" :disabled="!vals.length" @click.stop="clear"><Ico name="x" size="sm" /></button>
			<Teleport to="body">
				<div v-if="open" ref="pop" class="pop vp-pop" :style="style" role="dialog" :aria-label="field.label">
					<div v-if="showOp" class="vp-ops" role="group" aria-label="Include or exclude">
						<button type="button" class="btn sm" :class="{ on: modelValue.op !== 'not in' }" @click="set(vals, 'in')">Includes</button>
						<button type="button" class="btn sm" :class="{ on: modelValue.op === 'not in' }" @click="set(vals, 'not in')">Does not include</button>
					</div>
					<div class="pop-search"><input class="inp" style="height:32px" v-model="q" placeholder="Search" :aria-label="'Search ' + field.label" /></div>
					<div class="pop-list" role="listbox" aria-multiselectable="true">
						<button v-for="o in list" :key="String(o.value)" type="button" class="opt" :class="{ on: has(o.value) }" role="option" :aria-selected="has(o.value)" @click="flip(o.value)">
							<span class="mp-box" :class="{ on: has(o.value) }"><Ico v-if="has(o.value)" name="check" size="sm" /></span>
							<span class="grow ellipsis">{{ o.label }}</span><span v-if="o.count != null" class="small faint">{{ o.count }}</span>
						</button>
						<div v-if="!list.length" class="pop-empty">{{ busy ? 'Loading...' : 'Nothing found' }}</div>
					</div>
					<div v-if="vals.length" class="pop-foot"><button type="button" class="btn ghost sm" @click="clear">Clear</button></div>
				</div>
			</Teleport>
		</div>`,
	}

	/** One filter of the second row: values for most fields, a calendar for dates. */
	V.FilterChip = {
		props: { field: Object, filters: Object },
		emits: ['change'],
		setup(props, { emit }) {
			return {
				isDate: computed(() => isDate(props.field)),
				val: computed(() => valueOf(props.filters, props.field.fieldname)),
				range: computed(() => rangeOf(props.filters, props.field.fieldname)),
				setVal: (v) => emit('change', withValue(props.filters, props.field.fieldname, v)),
				setRange: (r) => emit('change', withRange(props.filters, props.field.fieldname, r)),
				clearRange: () => emit('change', withRange(props.filters, props.field.fieldname, NONE)),
			}
		},
		template: `
		<div v-if="isDate" class="vp dd" :class="{ on: range.preset !== 'any' }"><span class="small muted" style="margin-right:6px">{{ field.label }}</span>
			<DateRange :modelValue="range" any one-month :aria-label="field.label" @change="setRange" />
			<button type="button" class="vp-x" :class="{ on: range.preset !== 'any' }" :aria-label="'Clear ' + field.label" title="Clear this filter" :disabled="range.preset === 'any'" @click.stop="clearRange"><Ico name="x" size="sm" /></button>
		</div>
		<ValuePick v-else :field="field" :modelValue="val" @update:modelValue="setVal" />`,
	}

	/** Custom filter: any field of the lead, each with the values it includes or does not include. */
	V.FilterDialog = {
		props: { fields: Array, filters: Object },
		emits: ['close', 'apply'],
		setup(props, { emit }) {
			const fl = computed(() => props.fields.filter((f) => f.fieldname !== '_assign'))
			const by = computed(() => Object.fromEntries(fl.value.map((f) => [f.fieldname, f])))
			const rows = ref(activeKeys(props.filters).filter((k) => by.value[k]).map((k) => (isDate(by.value[k]) ? { field: k, op: 'in', values: [], range: rangeOf(props.filters, k) } : { field: k, ...valueOf(props.filters, k), range: { ...NONE } })))
			const add = () => rows.value.push({ field: '', op: 'in', values: [], range: { ...NONE } })
			if (!rows.value.length) add()
			const fieldOpts = computed(() => fl.value.map((f) => ({ value: f.fieldname, label: f.label })))
			const OPS = [{ value: 'in', label: 'Includes' }, { value: 'not in', label: 'Does not include' }]
			const spec = (r) => by.value[r.field]
			function pick(r, f) { r.field = f; r.values = []; r.range = { ...NONE }; r.op = 'in' }
			function apply() {
				let f = {}
				for (const r of rows.value) { if (!r.field) continue; f = isDate(spec(r)) ? withRange(f, r.field, r.range) : withValue(f, r.field, r) }
				emit('apply', f)
			}
			return { rows, fieldOpts, OPS, spec, pick, add, apply, isDate, remove: (i) => rows.value.splice(i, 1) }
		},
		template: `
		<Modal title="Custom filter" size="lg" @close="$emit('close')" @submit="apply">
			<p class="small muted" style="margin:0 0 10px">Pick a field, then the values it should include, or should not include. Pick as many values as you need.</p>
			<div v-for="(r, i) in rows" :key="i" class="frow">
				<div style="width:210px"><Dd :modelValue="r.field" :options="fieldOpts" searchable placeholder="Field" aria-label="Field" @update:modelValue="(f) => pick(r, f)" /></div>
				<template v-if="r.field && isDate(spec(r))"><div class="grow"><DateRange v-model="r.range" any one-month aria-label="Dates" /></div></template>
				<template v-else>
					<div style="width:170px"><Dd v-model="r.op" :options="OPS" :disabled="!r.field" aria-label="Includes or does not include" /></div>
					<div class="grow" style="min-width:160px"><ValuePick v-if="r.field" bare :show-op="false" :field="{ ...spec(r), label: 'Choose values' }" :modelValue="{ op: r.op, values: r.values }" @update:modelValue="(v) => (r.values = v.values)" /><span v-else class="small faint">Choose a field first</span></div>
				</template>
				<Btn size="sm" variant="ghost" icon="trash" aria-label="Remove this filter" @click="remove(i)" />
			</div>
			<Btn size="sm" icon="plus" style="margin-top:8px" @click="add">Add filter</Btn>
			<template #foot><Btn variant="ghost" @click="rows = []; add()">Clear all</Btn><div class="grow"></div><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" @click="apply">Apply</Btn></template>
		</Modal>`,
	}
})()
