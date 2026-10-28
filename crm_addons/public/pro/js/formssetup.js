/* Suite Pro: Settings, Forms. An admin arranges the Add lead, Add organization and Add person forms. The fields and the dropdown values can only be ones the CRM
   already has (nothing is created here, so the data stays the same everywhere); a pop-up explains how to add a missing field or value in the CRM. */
(() => {
	const { ref, reactive, computed, onMounted, nextTick } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.forms_config.' + m, a)
	const slug = (dt) => String(dt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')

	V.FormsSetup = {
		setup() {
			const hdr = ref(false); onMounted(() => nextTick(() => (hdr.value = true)))
			const loading = ref(true); const error = ref(''); const busy = ref(false)
			const all = ref({}); const kind = ref('lead'); const rows = reactive({ lead: [], organization: [], person: [] }); const custom = reactive({ lead: false, organization: false, person: false })
			const dirty = ref(false); const guide = ref(false); const opt = ref(null)
			const TABS = [{ value: 'lead', label: 'Add lead', icon: 'users' }, { value: 'organization', label: 'Add organization', icon: 'building' }, { value: 'person', label: 'Add person', icon: 'user' }]
			function fill(k) {
				const d = all.value[k]
				const src = d.chosen || d.default.map((r) => ({ fieldname: r.fieldname, label: '', reqd: r.reqd, hide: [] }))
				rows[k] = src.map((r) => ({ fieldname: r.fieldname, label: r.label || '', reqd: r.reqd ? 1 : 0, hide: [...(r.hide || [])] }))
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
			function add(k) { if (!k) return; rows[kind.value].push({ fieldname: k, label: '', reqd: spec(k).locked ? 1 : 0, hide: [] }); dirty.value = true; custom[kind.value] = true }
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
			return { hdr, loading, error, busy, kind, TABS, items, row, spec, canRequire, addable, add, touch, rows, custom, dirty, guide, opt, openOptions, applyOptions, shownValues, toggle, save, reset, links, slug, dt, GUIDE, CM, all, pool }
		},
		template: `
		<div class="page">
			<Teleport v-if="hdr" to="#hdr-ctl"><Btn variant="primary" :loading="busy" :disabled="loading || !dirty" @click="save">Save</Btn></Teleport>
			<ErrorState v-if="error" :message="error" />
			<div v-else-if="loading" class="card" style="padding:18px"><Skel h="20" /></div>
			<template v-else>
				<div class="card" style="padding:16px 18px">
					<b>Forms</b>
					<p class="small muted" style="margin:2px 0 10px">Choose which questions each form asks and in what order. Only fields and dropdown values that already exist in the CRM can be used: a new Source, Industry or field is added in the CRM first, so your dashboards and data always agree.</p>
					<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><Seg v-model="kind" :options="TABS" /><span class="small muted">{{ custom[kind] ? 'Arranged by you' : 'Following the CRM' }}</span><span class="grow"></span><Btn size="sm" variant="ghost" icon="info" @click="guide = true">A field or value is missing</Btn><Btn v-if="custom[kind]" size="sm" variant="ghost" @click="reset">Reset to the CRM form</Btn></div>
				</div>
				<section class="card" style="padding:16px 18px">
					<b>{{ all[kind].title }} form</b>
					<p class="small muted" style="margin:2px 0 8px">Drag to reorder. Fields the CRM insists on stay on the form and stay required.</p>
					<DragList v-model="items" empty="No fields.">
						<template #default="{ item: it }">
							<input class="inp" style="width:170px" :value="row(it.key).label" :placeholder="spec(it.key).label" maxlength="80" :aria-label="'Label of ' + spec(it.key).label" @input="row(it.key).label = $event.target.value; touch()" />
							<Btn v-if="spec(it.key).values.length" size="sm" icon="list" @click="openOptions(it.key)">Options<template v-if="row(it.key).hide.length"> ({{ spec(it.key).values.length - row(it.key).hide.length }} of {{ spec(it.key).values.length }})</template></Btn>
							<span class="small muted">Required</span><Switch :modelValue="!!row(it.key).reqd || spec(it.key).locked" :disabled="!canRequire(it.key)" :label="'Required: ' + spec(it.key).label" @update:modelValue="(v) => { if (canRequire(it.key)) { row(it.key).reqd = v ? 1 : 0; touch() } }" />
						</template>
					</DragList>
					<div style="width:260px;margin-top:8px"><Dd modelValue="" :options="addable" searchable placeholder="Add a field" aria-label="Add a field to the form" @update:modelValue="add" /></div>
				</section>
			</template>

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
