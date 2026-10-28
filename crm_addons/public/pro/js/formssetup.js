/* Suite Pro: Settings, Forms. An admin arranges the Add lead, Add organization and Add person forms. The fields and the dropdown values can only be ones the CRM
   already has (nothing is created here, so the data stays the same everywhere); a pop-up explains how to add a missing field or value in the CRM. */
(() => {
	const { ref, reactive, computed, watch, onMounted, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.forms_config.' + m, a)
	const slug = (dt) => String(dt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')


	/** A picture of the Add lead / organization / person pop-up from the rows being edited (it creates nothing). */
	V.FormMock = {
		props: { title: String, fields: Array, bare: Boolean },
		template: `<div class="fm" :class="{ bare }"><div v-if="!bare" class="fm-t">{{ title }}</div><div class="fm-g"><div v-for="f in fields" :key="f.fieldname" class="fm-f" :style="f.full || ['Small Text', 'Text', 'Long Text', 'Text Editor'].includes(f.fieldtype) ? 'grid-column:1/-1' : null"><span class="fm-l">{{ f.label }}<b v-if="f.reqd || f.locked" style="color:var(--red)"> *</b></span><div v-if="f.fieldtype === 'Check'" class="fm-sw"></div><div v-else class="fm-i" :class="{ tall: ['Small Text', 'Text', 'Long Text', 'Text Editor'].includes(f.fieldtype) }"><span v-if="f.values.length || f.fieldtype === 'Link' || f.fieldtype === 'Select'" class="fm-d">Select</span><span v-if="f.values.length || f.fieldtype === 'Link' || f.fieldtype === 'Select'" class="fm-c">&#9662;</span></div></div><div v-if="!fields.length" class="small muted">No fields are shown.</div></div><div class="fm-b"><span>Cancel</span><b>Add</b></div></div>`,
	}

	V.FormsSetup = {
		setup() {
			const hdr = ref(false); onMounted(() => nextTick(() => (hdr.value = true)))
			const loading = ref(true); const error = ref(''); const busy = ref(false)
			const all = ref({}); const kind = ref('lead'); const rows = reactive({ lead: [], organization: [], person: [] }); const custom = reactive({ lead: false, organization: false, person: false })
			const dirty = ref(false); const guide = ref(false); const opt = ref(null)
			const TABS = [{ value: 'lead', label: 'Add lead', icon: 'users' }, { value: 'organization', label: 'Add organization', icon: 'building' }, { value: 'person', label: 'Add person', icon: 'user' }]
			function fill(k) {
				const d = all.value[k]
				const src = d.chosen || d.default.map((r) => ({ fieldname: r.fieldname, label: '', reqd: r.reqd, hidden: 0, full: 0, hide: [] }))
				rows[k] = src.map((r) => ({ fieldname: r.fieldname, label: r.label || '', reqd: r.reqd ? 1 : 0, hidden: r.hidden ? 1 : 0, full: r.full ? 1 : 0, hide: [...(r.hide || [])] }))
				custom[k] = !!d.chosen
			}
			onMounted(async () => {
				try { all.value = await call('get_forms', {}); ['lead', 'organization', 'person'].forEach(fill) } catch (e) { error.value = e.message } finally { loading.value = false }
			})
			const pool = computed(() => (all.value[kind.value] || { pool: [] }).pool)
			const spec = (k) => pool.value.find((p) => p.fieldname === k) || { label: k, locked: false, values: [] }
			const items = computed({
				get: () => rows[kind.value].map((r) => ({ key: r.fieldname, label: spec(r.fieldname).label })),
				set: (v) => {
					const keep = v.map((x) => rows[kind.value].find((r) => r.fieldname === x.key))
					const lost = rows[kind.value].filter((r) => !v.some((x) => x.key === r.fieldname) && spec(r.fieldname).locked)
					if (lost.length) CM.toast(spec(lost[0].fieldname).label + ' is always on this form.', 'err')
					rows[kind.value] = [...keep, ...lost]; dirty.value = true; custom[kind.value] = true
				},
			})
			const row = (k) => rows[kind.value].find((r) => r.fieldname === k)
			const requirable = (k) => { const s = spec(k); return kind.value !== 'person' || s.requirable }
			const canRequire = (k) => !spec(k).locked && requirable(k)
			const addable = computed(() => [{ value: '', label: 'Add a field' }, ...pool.value.filter((p) => !rows[kind.value].some((r) => r.fieldname === p.fieldname)).map((p) => ({ value: p.fieldname, label: p.label, sub: p.fieldtype === 'Data' ? '' : p.fieldtype }))])
			function add(k) { if (!k) return; rows[kind.value].push({ fieldname: k, label: '', reqd: spec(k).locked ? 1 : 0, hidden: 0, full: 0, hide: [] }); dirty.value = true; custom[kind.value] = true }
			function removeRow(k) { if (spec(k).locked) { CM.toast(spec(k).label + ' is always on this form.', 'err'); return } rows[kind.value] = rows[kind.value].filter((r) => r.fieldname !== k); touch() }
			function setHidden(k, v) { const r = row(k); r.hidden = v ? 1 : 0; if (v) r.reqd = 0; touch() }
			const showPv = ref((() => { try { return localStorage.getItem('pro_forms_preview') !== '0' } catch (e) { return true } })()); watch(showPv, (v) => { try { localStorage.setItem('pro_forms_preview', v ? '1' : '0') } catch (e) { /* not remembered */ } })
			const popup = ref(false)
			const dragFrom = ref(-1); const dragOver = ref(-1)
			function drop(j) { const i = dragFrom.value; dragFrom.value = dragOver.value = -1; if (i < 0 || i === j) return; const [x] = rows[kind.value].splice(i, 1); rows[kind.value].splice(j, 0, x); touch() }
			const TYPE = { Data: 'Text', 'Small Text': 'Textarea', Text: 'Textarea', 'Long Text': 'Textarea', 'Text Editor': 'Textarea', Int: 'Number', Float: 'Number', Currency: 'Number', Phone: 'Phone', Check: 'Switch', Date: 'Date', Datetime: 'Date', Link: 'Dropdown', Select: 'Dropdown' }
			const typeOf = (sp) => (sp.fieldname && /email/.test(sp.fieldname) ? 'Email' : sp.fieldname && /mobile|phone/.test(sp.fieldname) ? 'Phone' : TYPE[sp.fieldtype] || 'Text')
			const iconOf = (sp) => ({ Email: 'mail', Phone: 'phone', Number: 'hash', Textarea: 'text', Dropdown: 'list', Date: 'calendar', Switch: 'check' }[typeOf(sp)] || 'text')
			const shown = computed(() => rows[kind.value].filter((r) => !r.hidden).map((r) => ({ ...r, ...spec(r.fieldname), label: r.label || spec(r.fieldname).label, values: spec(r.fieldname).values.filter((x) => !r.hide.includes(x)) })))
			const hiddenCount = computed(() => rows[kind.value].filter((r) => r.hidden).length)
			const touch = () => { dirty.value = true; custom[kind.value] = true }
			function openOptions(k) { opt.value = { key: k, label: spec(k).label, values: spec(k).values, hide: new Set(row(k).hide), q: '' } }
			function applyOptions() {
				const o = opt.value; if (!o) return
				if (o.hide.size >= o.values.length) { CM.toast('Leave at least one value on the form.', 'err'); return }
				row(o.key).hide = [...o.hide]; opt.value = null; touch()
			}
			const shownValues = computed(() => (opt.value ? opt.value.values.filter((v) => !opt.value.q || v.toLowerCase().includes(opt.value.q.toLowerCase())) : []))
			function toggle(v) { const h = opt.value.hide; h.has(v) ? h.delete(v) : h.add(v); opt.value = { ...opt.value, hide: new Set(h) } }
			async function save() {
				busy.value = true
				try {
					const r = await call('save_form', { kind: kind.value, fields: JSON.stringify(rows[kind.value]) })
					all.value[kind.value].chosen = r.chosen; fill(kind.value); dirty.value = false
					CM.toast(all.value[kind.value].title + ' form saved')
				} catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			async function reset() {
				if (!(await CM.confirm({ title: 'Go back to the CRM form?', message: 'The ' + all.value[kind.value].title.toLowerCase() + ' form goes back to the fields the CRM has by default. Nothing in your data changes.', confirmText: 'Reset' }))) return
				busy.value = true
				try { await call('reset_form', { kind: kind.value }); all.value[kind.value].chosen = null; fill(kind.value); dirty.value = false; CM.toast('Back to the CRM form') } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			const links = computed(() => pool.value.filter((p) => p.link && rows[kind.value].some((r) => r.fieldname === p.fieldname)))
			const dt = computed(() => (all.value[kind.value] || {}).doctype || '')
			const GUIDE = {
				lead: { doc: 'CRM Lead', what: 'a lead field' },
				organization: { doc: 'CRM Organization', what: 'an organization field' },
				person: { doc: 'User', what: 'a person field' },
			}
			return { popup, showPv, dragFrom, dragOver, drop, typeOf, iconOf, removeRow, setHidden, shown, hiddenCount, hdr, loading, error, busy, kind, TABS, items, row, spec, canRequire, addable, add, touch, rows, custom, dirty, guide, opt, openOptions, applyOptions, shownValues, toggle, save, reset, links, slug, dt, GUIDE, CM, all, pool }
		},
		template: `
		<div class="page">
			<Teleport v-if="hdr" to="#hdr-ctl"><Btn variant="primary" :loading="busy" :disabled="loading || !dirty" @click="save">Save</Btn></Teleport>
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<div class="row fs-kinds"><div class="fs-seg" role="tablist" aria-label="Form"><button v-for="t in TABS" :key="t.value" type="button" role="tab" :class="{ on: kind === t.value }" :aria-selected="kind === t.value" @click="kind = t.value"><Ico :name="t.icon" size="sm" /> {{ t.label }}</button></div><span class="grow"></span><Btn v-if="custom[kind]" size="sm" variant="ghost" @click="reset">Reset to the CRM form</Btn><div class="row" style="gap:8px;align-items:center"><Btn size="sm" variant="ghost" icon="info" title="A field or value is missing" aria-label="A field or value is missing" @click="guide = true" /><div class="seg" role="group" aria-label="View"><button type="button" :class="{ on: showPv }" :aria-pressed="showPv" title="Split: setup and preview" aria-label="Split view" @click="showPv = true"><Ico name="columns" size="sm" /> Split</button><button type="button" :class="{ on: !showPv }" :aria-pressed="!showPv" title="Form only" aria-label="Form only" @click="showPv = false"><Ico name="rows" size="sm" /> Form</button></div><Btn size="sm" icon="eye" @click="popup = true">Preview</Btn></div></div>
				<div class="fs-split" :class="{ solo: !showPv }">
					<section class="card" style="padding:16px 18px">
						<div class="row" style="margin-bottom:10px"><div class="grow"><b style="font-size:16px">Form fields</b></div>
							<div style="width:190px"><Dd modelValue="" :options="addable" searchable placeholder="+ Add field" aria-label="Add a field to the form" @update:modelValue="add" /></div></div>
						<div class="fs-t-head"><span></span><span>Field name</span><span>Field type</span><span class="c">Full row</span><span class="c">Required</span><span class="c">Hide</span><span class="c">Actions</span></div>
						<div v-for="(r, i) in rows[kind]" :key="r.fieldname" class="fs-t-row" :class="{ off: r.hidden, over: dragOver === i && dragFrom !== i }" draggable="true" @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver = -1" @drop.prevent="drop(i)" @dragend="dragFrom = dragOver = -1">
							<span class="fs-grip" aria-hidden="true"><Ico name="grip" /></span>
							<span class="fs-nm"><Ico :name="iconOf(spec(r.fieldname))" class="faint" /><input class="fs-nin" :value="r.label" :placeholder="spec(r.fieldname).label" maxlength="80" :aria-label="'Label of ' + spec(r.fieldname).label" @input="r.label = $event.target.value; touch()" /></span>
							<span><button v-if="spec(r.fieldname).values.length" type="button" class="fs-chip click" :title="'Choose which of the ' + spec(r.fieldname).values.length + ' values are offered'" @click="openOptions(r.fieldname)"><Ico name="list" size="sm" /> Dropdown<span v-if="r.hide.length" class="small muted"> {{ spec(r.fieldname).values.length - r.hide.length }}/{{ spec(r.fieldname).values.length }}</span> <Ico name="chevron-down" size="sm" /></button><span v-else class="fs-chip"><Ico :name="iconOf(spec(r.fieldname))" size="sm" /> {{ typeOf(spec(r.fieldname)) }}</span></span>
							<span class="c"><button type="button" class="fs-ic" :class="{ on: r.full }" :aria-pressed="!!r.full" title="Full row" aria-label="Full row" @click="r.full = r.full ? 0 : 1; touch()"><Ico name="arrows-h" /></button></span>
							<span class="c"><button type="button" class="fs-ic" :class="{ on: r.reqd || spec(r.fieldname).locked }" :disabled="!canRequire(r.fieldname) || !!r.hidden" :aria-pressed="!!r.reqd" title="Required" aria-label="Required" @click="r.reqd = r.reqd ? 0 : 1; touch()"><b>*</b></button></span>
							<span class="c"><button type="button" class="fs-ic" :class="{ on: r.hidden }" :disabled="spec(r.fieldname).locked" :aria-pressed="!!r.hidden" title="Hide on the form" aria-label="Hide" @click="setHidden(r.fieldname, !r.hidden)"><Ico name="eye-off" /></button></span>
							<span class="c"><button type="button" class="fs-ic plain" :disabled="spec(r.fieldname).locked" :title="spec(r.fieldname).locked ? 'The CRM needs this field' : 'Remove from the form'" aria-label="Remove from the form" @click="removeRow(r.fieldname)"><Ico name="trash" /></button></span>
						</div>
						<p v-if="!rows[kind].length" class="small muted" style="padding:14px">No fields.</p>
					</section>
					<aside v-if="showPv" class="card fs-pv"><div class="row" style="margin-bottom:10px"><b class="grow" style="font-size:16px">Preview</b><span class="small muted">{{ hiddenCount }} hidden</span></div><FormMock :title="all[kind].title" :fields="shown" /></aside>
				</div>
			</template>

			<Modal v-if="popup" size="md" :title="all[kind].title" subtitle="Exactly how it looks to the person adding." @close="popup = false"><FormMock bare :title="all[kind].title" :fields="shown" /><template #foot><Btn variant="primary" @click="popup = false">Close</Btn></template></Modal>

			<Modal v-if="opt" size="sm" :title="'Options of ' + opt.label" subtitle="Untick a value to hide it on this form. It stays in the CRM." @close="opt = null">
				<Inp v-if="opt.values.length > 8" v-model="opt.q" icon="search" placeholder="Search" clearable aria-label="Search the values" />
				<ul class="list" style="max-height:340px;overflow:auto;margin-top:8px"><li v-for="v in shownValues" :key="v" class="li"><label class="check"><input type="checkbox" :checked="!opt.hide.has(v)" @change="toggle(v)" /> {{ v }}</label></li></ul>
				<template #foot><Btn @click="opt = null">Cancel</Btn><Btn variant="primary" @click="applyOptions">Done</Btn></template>
			</Modal>

			<Modal v-if="guide" size="lg" title="A field or a value is missing" subtitle="These forms never add anything to the CRM. It is added in the CRM first, then it shows up here." @close="guide = false">
				<div class="col" style="gap:14px">
					<div><b>A new field</b><p class="small muted" style="margin:2px 0 6px">Ask an admin to add the field to <b>{{ GUIDE[kind].doc }}</b> in the CRM. In Frappe: <i>Customize Form</i>, choose {{ GUIDE[kind].doc }}, add a row for the new field and save. Add it to the CRM's own layout (CRM Settings, then Fields layout) if you want it there too. When it exists, it appears in "Add a field" on this page.</p>
						<a class="btn" :href="'/app/customize-form?doc_type=' + encodeURIComponent(GUIDE[kind].doc)" target="_blank" rel="noopener"><Ico name="external" /> Open Customize Form</a></div>
					<div v-if="kind !== 'person'"><b>A new dropdown value</b><p class="small muted" style="margin:2px 0 6px">A value such as a new Source, Industry or Territory is its own record in the CRM. Add it there first (for example the Source in the list of lead sources) and it appears in the form's dropdown and in your dashboards at the same time. A dropdown with fixed choices gets its new choice in Customize Form, in the field's Options.</p>
						<div v-if="links.length" class="row" style="gap:6px;flex-wrap:wrap"><a v-for="p in links" :key="p.fieldname" class="btn" :href="'/app/' + slug(p.link)" target="_blank" rel="noopener"><Ico name="external" /> {{ p.label }}: {{ p.link }}</a></div></div>
					<div v-if="kind === 'person'" class="small muted">The Add person form only asks what the CRM keeps about a person (name, email, number, designation, company, photo, role, preset and team leader). A new question needs a field on the CRM user first (Customize Form, User) and the team page showing it.</div>
					<div class="alert info"><Ico name="info" /><div class="grow">Only an admin can change fields in the CRM. If you are not one, send them this page.</div></div>
				</div>
				<template #foot><Btn variant="primary" @click="guide = false">Got it</Btn></template>
			</Modal>
		</div>`,
	}
})()
