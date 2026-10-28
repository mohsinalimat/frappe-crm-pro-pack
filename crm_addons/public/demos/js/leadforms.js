/* Bookings admin: the Lead forms tab. A public web form that creates a CRM lead; the list with numbers, the editor, and the log. */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	DM.lf = (m, a) => CM.call('crm_addons.demos.leadforms.' + m, a)
	DM.lfUrl = (slug) => location.origin + '/lead-form/' + slug
	const RESULT_TONE = { Created: 'green', Duplicate: 'amber', Blocked: 'neutral', Failed: 'red' }
	const RESULT_TEXT = { Created: 'New lead', Duplicate: 'Already a lead', Blocked: 'Blocked as spam', Failed: 'Failed' }

	// ------------------------------------------------------------------ the log
	V.LeadFormLog = {
		props: { form: { type: String, default: '' } },
		setup(props) {
			const rows = ref([]); const total = ref(0); const loading = ref(true); const error = ref(''); const page = ref(0); const q = ref(''); const result = ref('')
			const SIZE = 25
			let seq = 0
			async function load() {
				const mine = ++seq; loading.value = true; error.value = ''
				try {
					const r = await DM.lf('list_entries', { form: props.form || undefined, result: result.value || undefined, search: q.value || undefined, page: page.value + 1, page_size: SIZE })
					if (mine !== seq) return
					rows.value = r.rows; total.value = r.total
				} catch (e) { if (mine === seq) error.value = DM.friendly(e) } finally { if (mine === seq) loading.value = false }
			}
			let t; watch(q, () => { clearTimeout(t); t = setTimeout(() => { page.value = 0; load() }, 300) })
			watch([result, () => props.form], () => { page.value = 0; load() })
			watch(page, load)
			onMounted(load)
			const tone = (r) => RESULT_TONE[r] || 'neutral'
			const campaign = (r) => [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ')
			const host = (u) => { try { return new URL(u).pathname } catch (e) { return u || '' } }
			return { rows, total, loading, error, page, q, result, SIZE, load, tone, RESULT_TEXT, campaign, host, CM, DM, go: CM.go }
		},
		template: `
		<div>
			<div class="row wrap tools" style="margin-bottom:12px"><div class="chips"><button v-for="f in [['', 'All'], ['Created', 'New leads'], ['Duplicate', 'Already leads'], ['Blocked', 'Blocked'], ['Failed', 'Failed']]" :key="f[0]" type="button" class="fchip" :class="{ on: result === f[0] }" :aria-pressed="result === f[0]" @click="result = f[0]">{{ f[1] }}</button></div><div class="grow"></div><div style="width:min(300px,100%)"><Inp v-model="q" icon="search" placeholder="Search name, email, phone, campaign" clearable aria-label="Search the log" /></div></div>
			<div v-if="loading && !rows.length" class="col" style="gap:8px"><Skel v-for="n in 4" :key="n" h="44" r="8" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<Empty v-else-if="!rows.length" icon="inbox" title="Nothing in the log yet" text="Every time someone fills in a lead form, it is written here: a new lead, someone who is already a lead, or a blocked attempt." />
			<div v-else class="card" style="padding:0"><div class="table-wrap"><table class="tbl">
				<thead><tr><th>When</th><th>Form</th><th>Person</th><th>Result</th><th>Campaign</th><th>Page</th></tr></thead>
				<tbody><tr v-for="r in rows" :key="r.name">
					<td class="nowrap small">{{ CM.fmt ? CM.fmt(r.creation) : r.creation }}</td>
					<td class="ellipsis" style="max-width:160px">{{ r.form_title }}</td>
					<td><b>{{ r.name_ || '-' }}</b><div class="small muted">{{ r.email }}<template v-if="r.email && r.phone"> - </template>{{ r.phone }}</div></td>
					<td><span class="badge" :class="tone(r.result)">{{ RESULT_TEXT[r.result] || r.result }}</span><div v-if="r.matched_by" class="small muted">same {{ r.matched_by }}<template v-if="r.applied"> - details updated</template></div><div v-if="r.reason" class="small muted">{{ r.reason }}</div>
						<div v-if="r.lead"><a :href="'/crm-pro#/leads/' + encodeURIComponent(r.lead)" class="small" target="_top">Open lead</a></div></td>
					<td class="small">{{ campaign(r) || '-' }}</td>
					<td class="small muted ellipsis" style="max-width:160px" :title="r.landing_url">{{ host(r.landing_url) || '-' }}</td>
				</tr></tbody></table></div></div>
			<Pager v-model:page="page" :size="SIZE" :total="total" />
		</div>`,
	}

	// ------------------------------------------------------------------ the list
	V.LeadForms = {
		setup() {
			const rows = ref([]); const loading = ref(true); const error = ref(''); const busy = reactive({})
			const tab = ref(CM.route.query.tab === 'log' ? 'log' : 'forms')
			const days = ref(30); const stats = ref(null)
			async function load(quiet) {
				if (!quiet) loading.value = true; error.value = ''
				try { rows.value = (await DM.lf('list_forms')) || [] } catch (e) { error.value = DM.friendly(e) } finally { loading.value = false }
			}
			async function loadStats() { try { stats.value = await DM.lf('form_stats', { days: days.value }) } catch (e) { stats.value = null } }
			onMounted(() => { load(); loadStats() })
			watch(days, loadStats)
			const canManage = computed(() => DM.session.widgets === 'manage')
			const edit = (r) => CM.go('/forms/' + encodeURIComponent(r.name))
			async function setEnabled(r, on) {
				busy[r.name] = true
				try { const d = (await DM.lf('get_form_admin', { name: r.name })).doc; d.enabled = on ? 1 : 0; await DM.lf('save_form', { doc: JSON.stringify(d) }); r.enabled = on ? 1 : 0; CM.toast(on ? 'Form is on' : 'Form is off: its page shows "not available"') } catch (e) { CM.toast(DM.friendly(e), 'err'); load(true) } finally { busy[r.name] = false }
			}
			async function remove(r) {
				if (r.total.Created + r.total.Duplicate + r.total.Blocked + r.total.Failed > 0) {
					const ok = await CM.confirm({ title: 'This form has a log', message: `"${r.title}" has entries in its log, so it cannot be deleted: the history would lose its link to it. Turn it off instead.`, confirmText: DM.bool(r.enabled) ? 'Turn it off' : 'Close', danger: false })
					if (ok && DM.bool(r.enabled)) setEnabled(r, false)
					return
				}
				if (!(await CM.confirm({ title: 'Delete this form?', message: `"${r.title}" and its page /lead-form/${r.slug} will be removed.`, confirmText: 'Delete', danger: true }))) return
				try { await DM.lf('delete_form', { name: r.name }); CM.toast('Form deleted'); load(true) } catch (e) { CM.toast(DM.friendly(e), 'err') }
			}
			const menu = (r) => [
				{ label: 'Edit', icon: 'edit', run: () => edit(r) },
				{ label: 'Open public page', icon: 'external', run: () => window.open(r.url, '_blank', 'noopener'), disabled: !DM.bool(r.enabled) },
				{ label: 'Copy link', icon: 'link', run: () => DM.copy(r.url, 'Link') },
				{ sep: true },
				{ label: 'Delete', icon: 'trash', danger: true, run: () => remove(r) },
			]
			const t = computed(() => (stats.value && stats.value.totals) || { Created: 0, Duplicate: 0, Blocked: 0, Failed: 0 })
			const peak = computed(() => Math.max(1, ...((stats.value && stats.value.by_day) || []).map((d) => d.Created + d.Duplicate)))
			return { rows, loading, error, busy, tab, days, stats, t, peak, canManage, edit, setEnabled, menu, load, DM, CM, go: CM.go }
		},
		template: `
		<div class="page">
			<div v-if="!canManage" class="alert info"><Ico name="info" /><div class="grow"><b>View only.</b> You can see the forms but not change them.</div></div>
			<div class="pg-head"><div class="grow"><h1>Lead forms</h1><p>A public page with a form that creates a lead in the CRM. Anyone who is already a lead is not added twice: the lead gets a note with what they shared, and its owner is told.</p></div><div class="actions"><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/forms/new')">Create form</Btn></div></div>
			<div class="row wrap tools" style="margin-bottom:14px"><Seg v-model="tab" :options="[{ value: 'forms', label: 'Forms' }, { value: 'log', label: 'Log' }]" /><div class="grow"></div><Seg v-model="days" :options="[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]" /></div>
			<div class="dgrid" style="margin-bottom:16px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
				<div class="card pad"><div class="small muted">New leads</div><div style="font-size:26px;font-weight:650">{{ CM.num(t.Created) }}</div></div>
				<div class="card pad"><div class="small muted">Already leads</div><div style="font-size:26px;font-weight:650">{{ CM.num(t.Duplicate) }}</div></div>
				<div class="card pad"><div class="small muted">Blocked as spam</div><div style="font-size:26px;font-weight:650">{{ CM.num(t.Blocked) }}</div></div>
				<div class="card pad"><div class="small muted">Failed</div><div style="font-size:26px;font-weight:650">{{ CM.num(t.Failed) }}</div></div>
			</div>
			<div v-if="tab === 'forms' && stats && stats.by_day.length" class="card pad" style="margin-bottom:16px"><div class="row" style="gap:20px;flex-wrap:wrap;align-items:flex-start">
				<div style="flex:2;min-width:260px"><div class="small muted" style="margin-bottom:8px">Leads per day</div><div class="row" style="gap:3px;align-items:flex-end;height:80px"><div v-for="d in stats.by_day" :key="d.day" :title="d.day + ': ' + d.Created + ' new, ' + d.Duplicate + ' already leads'" style="flex:1;min-width:3px;background:var(--accent, #2563eb);border-radius:3px 3px 0 0;opacity:.85" :style="{ height: Math.max(4, (d.Created + d.Duplicate) / peak * 80) + 'px' }"></div></div></div>
				<div style="flex:1;min-width:200px"><div class="small muted" style="margin-bottom:6px">New leads by campaign source</div><div v-for="s in stats.by_source.slice(0, 6)" :key="s.source" class="row" style="justify-content:space-between;gap:8px"><span class="ellipsis">{{ s.source }}</span><b>{{ s.leads }}</b></div><div v-if="!stats.by_source.length" class="small faint">No new leads in this period.</div></div></div></div>
			<template v-if="tab === 'forms'">
				<div v-if="loading" class="dgrid"><Skel v-for="n in 2" :key="n" h="170" r="12" /></div>
				<ErrorState v-else-if="error" :message="error" @retry="load()" />
				<Empty v-else-if="!rows.length" icon="file" title="No lead forms yet" text="Create one to get a page you can link from a website or an ad. Whoever fills it in becomes a lead in the CRM."><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/forms/new')">Create form</Btn></Empty>
				<div v-else class="dgrid">
					<article v-for="r in rows" :key="r.name" class="card dcard" :class="{ off: !DM.bool(r.enabled) }">
						<div class="dcard-h">
							<button type="button" class="dcard-t" @click="edit(r)" :aria-label="'Edit ' + r.title"><b class="ellipsis">{{ r.title }}</b><span class="small muted">{{ r.assignment_mode }}<template v-if="r.lead_source"> - source {{ r.lead_source }}</template></span></button>
							<span class="dcard-sw"><span class="small" :class="DM.bool(r.enabled) ? '' : 'faint'">{{ DM.bool(r.enabled) ? 'On' : 'Off' }}</span><Switch :model-value="DM.bool(r.enabled)" :aria-disabled="!canManage" :label="'Turn ' + r.title + (DM.bool(r.enabled) ? ' off' : ' on')" @update:model-value="(v) => canManage && !busy[r.name] && setEnabled(r, v)" /></span>
							<Menu v-if="canManage" :items="menu(r)" :label="'Actions for ' + r.title" />
						</div>
						<div class="dcard-link"><Ico name="link" size="sm" /><a :href="r.url" target="_blank" rel="noopener" class="mono ellipsis">/lead-form/{{ r.slug }}</a><CopyBtn :text="r.url" bare label="Copy link" what="Link" /></div>
						<dl class="dcard-d"><div><dt>New leads (30 days)</dt><dd><b>{{ CM.num(r.last30.Created) }}</b></dd></div><div><dt>Already leads</dt><dd><b>{{ CM.num(r.last30.Duplicate) }}</b></dd></div></dl>
						<div class="dcard-f"><span class="grow small muted">{{ CM.num(r.total.Created) }} new leads in all</span><Btn size="sm" @click="edit(r)">Edit</Btn></div>
					</article>
				</div>
			</template>
			<LeadFormLog v-else />
		</div>`,
	}

	// ------------------------------------------------------------------ the editor
	V.LeadFormEditor = {
		props: { name: String },
		setup(props) {
			const isNew = props.name === 'new'
			const doc = reactive({ title: '', slug: '', enabled: 1, brand_name: '', logo: '', accent_color: '', theme: 'Auto', heading: '', description: '', button_text: '', success_title: '', success_text: '', redirect_url: '', footer_text: '', lead_source: '', lead_status: '', assignment_mode: 'Follow assignment rules', assign_to: '', notify_owner: 1, fields_list: [] })
			const catalog = ref([]); const opts = reactive({ sources: [], statuses: [] }); const loading = ref(true); const error = ref(''); const saving = ref(false); const errs = reactive({}); const url = ref('')
			const people = ref([]); const slugTouched = ref(false); const help = ref(false)
			const canManage = computed(() => DM.session.widgets === 'manage')
			async function load() {
				loading.value = true; error.value = ''
				try {
					if (isNew) {
						const d = await DM.lf('new_form_defaults')
						doc.fields_list = d.fields_list.map((f) => ({ ...f, label: '', placeholder: '', help: '' })); catalog.value = d.catalog; Object.assign(opts, { sources: d.sources, statuses: d.statuses })
					} else {
						const [d, c, o] = await Promise.all([DM.lf('get_form_admin', { name: props.name }), DM.lf('get_catalog'), DM.lf('choices')])
						Object.assign(doc, d.doc); url.value = d.url; catalog.value = c; Object.assign(opts, o)
						doc.fields_list = (d.doc.fields_list || []).map((f) => ({ ...f }))
					}
				} catch (e) { error.value = DM.friendly(e) } finally { loading.value = false }
			}
			onMounted(load)
			watch(() => doc.title, (v) => { if (isNew && !slugTouched.value) doc.slug = DM.slugify(v) })
			const spec = (fieldname) => catalog.value.find((c) => c.fieldname === fieldname) || { label: fieldname, fieldtype: 'Data' }
			const isCore = (f) => ['first_name', 'email', 'mobile_no'].includes(f.fieldname)
			const addable = computed(() => catalog.value.filter((c) => !doc.fields_list.some((f) => f.fieldname === c.fieldname)).map((c) => ({ value: c.fieldname, label: c.label, sub: c.fieldtype })))
			function addField(v) { if (v) doc.fields_list.push({ fieldname: v, label: '', required: spec(v).reqd ? 1 : 0, placeholder: '', help: '' }) }
			const move = (i, d) => { const j = i + d; if (j < 0 || j >= doc.fields_list.length) return; const [x] = doc.fields_list.splice(i, 1); doc.fields_list.splice(j, 0, x) }
			const removeField = (i) => doc.fields_list.splice(i, 1)
			const logo = computed({ get: () => (doc.logo ? [{ file_url: doc.logo, file_name: doc.logo.split('/').pop(), file_size: 0 }] : []), set: (v) => { doc.logo = v[0] ? v[0].file_url : '' } })
			async function findPeople(txt) { const r = await DM.api('search_team', { txt: txt || '', limit: 300 }); people.value = (r || []).map((x) => ({ user: x.email, email: x.email, full_name: x.full_name || x.email })) }
			onMounted(() => findPeople(''))
			function check() {
				Object.keys(errs).forEach((k) => delete errs[k])
				if (!doc.title.trim()) errs.title = 'Give the form a name.'
				if (isNew && !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(doc.slug)) errs.slug = 'Use letters, numbers and dashes (at least 3 characters).'
				if (doc.accent_color && !DM.isHex(doc.accent_color)) errs.accent = 'Use a colour like #2563eb.'
				if (doc.redirect_url && !/^https:\/\/\S+$/.test(doc.redirect_url)) errs.redirect = 'Use a full https:// address.'
				if (doc.assignment_mode === 'Specific person' && !doc.assign_to) errs.assign = 'Choose who new leads go to.'
				return !Object.keys(errs).length
			}
			async function save() {
				if (!check()) { CM.toast('Please fix what is marked in red.', 'err'); return }
				saving.value = true
				try {
					const d = await DM.lf('save_form', { doc: JSON.stringify({ ...doc, name: isNew ? undefined : props.name }) })
					CM.toast('Form saved')
					if (isNew) CM.go('/forms/' + encodeURIComponent(d.doc.name))
					else { Object.assign(doc, d.doc); doc.fields_list = d.doc.fields_list.map((f) => ({ ...f })); url.value = d.url }
				} catch (e) { CM.toast(DM.friendly(e), 'err') } finally { saving.value = false }
			}
			return { isNew, doc, catalog, opts, loading, error, saving, errs, url, people, findPeople, slugTouched, help, canManage, spec, isCore, addable, addField, move, removeField, logo, save, DM, CM, go: CM.go, load, SW: ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#111827'] }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><button type="button" class="btn ghost" style="margin-left:-8px" @click="go('/forms')"><Ico name="arrow-left" /> Lead forms</button><h1>{{ isNew ? 'Create a lead form' : (doc.title || 'Lead form') }}</h1><p>The page is shared by its link. Someone who fills it in becomes a lead, unless they are already one.</p></div><div class="actions"><Btn v-if="canManage" variant="primary" :loading="saving" @click="save">Save</Btn></div></div>
			<div v-if="loading" class="col" style="gap:12px"><Skel h="160" r="12" /><Skel h="260" r="12" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<div v-else class="col" style="gap:16px;max-width:860px">
				<Section title="Page" icon="file" text="The name and address people see.">
					<div class="g2"><Field label="Form name" :error="errs.title"><input class="inp" :class="{ bad: errs.title }" v-model="doc.title" maxlength="120" placeholder="Free trial sign-up" :disabled="!canManage" /></Field>
					<Field label="Page address" :error="errs.slug" hint="This part of the link cannot be changed after saving."><div class="row" style="gap:6px;flex-wrap:nowrap"><span class="muted small nowrap">/lead-form/</span><input class="inp mono" :class="{ bad: errs.slug }" v-model="doc.slug" :disabled="!isNew || !canManage" maxlength="60" @input="slugTouched = true" /></div></Field></div>
					<div v-if="url" class="row" style="gap:8px"><a :href="url" target="_blank" rel="noopener" class="mono small">{{ url }}</a><CopyBtn :text="url" bare label="Copy link" what="Link" /></div>
					<label class="check"><input type="checkbox" :checked="!!doc.enabled" :disabled="!canManage" @change="doc.enabled = $event.target.checked ? 1 : 0" /> The form is on (when it is off, its page shows "not available")</label>
				</Section>
				<Section title="Fields" icon="rows" text="Only fields that already exist on the CRM lead can be asked, so what comes in matches the rest of your CRM.">
					<div class="col" style="gap:8px">
						<div v-for="(f, i) in doc.fields_list" :key="f.fieldname" class="card pad" style="padding:10px 12px">
							<div class="row" style="gap:10px;flex-wrap:nowrap;align-items:center">
								<div style="flex:1;min-width:0"><b>{{ spec(f.fieldname).label }}</b> <span class="small faint">{{ f.fieldname }}</span><div class="row" style="gap:8px;margin-top:6px"><input class="inp" style="flex:1;min-width:140px" v-model="f.label" :placeholder="'Label (' + spec(f.fieldname).label + ')'" maxlength="80" :disabled="!canManage" /><input class="inp" style="flex:1;min-width:140px" v-model="f.placeholder" placeholder="Hint inside the box" maxlength="120" :disabled="!canManage" /></div></div>
								<label class="check nowrap"><input type="checkbox" :checked="!!f.required" :disabled="!canManage || f.fieldname === 'first_name'" @change="f.required = $event.target.checked ? 1 : 0" /> Required</label>
								<div class="row" style="gap:2px;flex-wrap:nowrap"><Btn size="sm" variant="ghost" icon="chevron-up" aria-label="Move up" :disabled="!canManage || i === 0" @click="move(i, -1)" /><Btn size="sm" variant="ghost" icon="chevron-down" aria-label="Move down" :disabled="!canManage || i === doc.fields_list.length - 1" @click="move(i, 1)" /><Btn size="sm" variant="ghost" icon="trash" aria-label="Remove" :disabled="!canManage || isCore(f)" :title="isCore(f) ? 'Name, email and phone are always on the form' : 'Remove'" @click="removeField(i)" /></div>
							</div>
						</div>
					</div>
					<div class="row" style="gap:10px;align-items:center;margin-top:6px"><div style="width:260px"><Dd :model-value="''" :options="addable" searchable placeholder="Add a field" :disabled="!canManage || !addable.length" aria-label="Add a field" @update:model-value="addField" /></div><button type="button" class="btn ghost" @click="help = !help"><Ico name="info" /> A field is missing</button></div>
					<div v-if="help" class="alert info" style="margin-top:8px"><Ico name="info" /><div class="grow"><b>Add it in the CRM first.</b> This page never creates fields, so the data stays the same everywhere. Ask an admin to add the field to the CRM Lead (in the CRM: Settings, then Customization / Fields layout, or a Custom Field on CRM Lead), and add any new option values there as well. Once it exists in the CRM it shows up in this list.</div></div>
					<p class="small muted" style="margin:8px 0 0">Email and phone are asked by default. Untick Required to make either optional; at least one of them has to be filled in. People who match an existing lead by email or phone are never added twice.</p>
				</Section>
				<Section title="New leads" icon="users" text="What a lead created by this form starts with.">
					<div class="g2"><Field label="Lead source" hint="Pick a source that already exists in the CRM."><Dd v-model="doc.lead_source" :options="[{ value: '', label: 'Leave empty' }, ...opts.sources.map((s) => ({ value: s, label: s }))]" searchable placeholder="Leave empty" :disabled="!canManage" /></Field>
					<Field label="Lead status"><Dd v-model="doc.lead_status" :options="[{ value: '', label: 'CRM default' }, ...opts.statuses.map((s) => ({ value: s, label: s }))]" placeholder="CRM default" :disabled="!canManage" /></Field></div>
					<Field label="Who gets new leads" :error="errs.assign"><Seg v-model="doc.assignment_mode" :options="[{ value: 'Follow assignment rules', label: 'Assignment rules' }, { value: 'Specific person', label: 'A specific person' }, { value: 'Unassigned', label: 'Nobody (unassigned)' }]" /></Field>
					<Field v-if="doc.assignment_mode === 'Specific person'" label="Person" :error="errs.assign"><Dd v-model="doc.assign_to" :options="people.map((p) => ({ value: p.user, label: p.full_name, sub: p.email }))" searchable placeholder="Choose a person" :disabled="!canManage" @search="findPeople" /></Field>
					<label class="check"><input type="checkbox" :checked="!!doc.notify_owner" :disabled="!canManage" @change="doc.notify_owner = $event.target.checked ? 1 : 0" /> When someone who is already a lead fills the form, tell the lead's owner. The lead stays with its owner either way.</label>
				</Section>
				<Section title="Look" icon="palette" text="Leave a field empty to use the default wording.">
					<div class="g2"><Field label="Brand name"><input class="inp" v-model="doc.brand_name" maxlength="80" :disabled="!canManage" /></Field><Field label="Heading"><input class="inp" v-model="doc.heading" maxlength="120" :placeholder="doc.title" :disabled="!canManage" /></Field></div>
					<Field label="Description"><textarea class="inp" rows="2" v-model="doc.description" maxlength="400" :disabled="!canManage"></textarea></Field>
					<Field label="Logo"><Uploader v-model="logo" :multiple="false" :is-private="false" accept="image/*" :max-mb="3" title="Upload a logo" hint="Up to 3 MB" /></Field>
					<div class="g2"><Field label="Accent colour" :error="errs.accent"><div class="row" style="gap:6px"><input type="color" class="colorpick" :value="DM.isHex(doc.accent_color) ? doc.accent_color : '#2563eb'" aria-label="Pick a colour" @input="doc.accent_color = $event.target.value" /><input class="inp mono" style="max-width:120px" :class="{ bad: errs.accent }" v-model="doc.accent_color" maxlength="7" placeholder="#2563eb" /><button v-for="c in SW" :key="c" type="button" class="sw-c" :style="{ background: c }" :aria-label="'Use ' + c" @click="doc.accent_color = c"></button></div></Field>
					<Field label="Theme"><Seg v-model="doc.theme" :options="[{ value: 'Auto', label: 'Auto' }, { value: 'Light', label: 'Light' }, { value: 'Dark', label: 'Dark' }]" /></Field></div>
					<div class="g2"><Field label="Button text"><input class="inp" v-model="doc.button_text" maxlength="40" placeholder="Send" /></Field><Field label="Footer text"><input class="inp" v-model="doc.footer_text" maxlength="160" /></Field></div>
					<div class="g2"><Field label="Thank-you title"><input class="inp" v-model="doc.success_title" maxlength="80" placeholder="Thank you" /></Field><Field label="Redirect address (optional)" :error="errs.redirect" hint="Send people to your own thank-you page instead."><input class="inp" :class="{ bad: errs.redirect }" v-model="doc.redirect_url" placeholder="https://www.example.com/thanks" /></Field></div>
					<Field label="Thank-you message"><textarea class="inp" rows="2" v-model="doc.success_text" maxlength="400"></textarea></Field>
				</Section>
				<Section title="Spam protection and tracking" icon="shield"><ul class="small muted" style="margin:0;padding-left:18px;display:grid;gap:4px"><li>A hidden field catches bots, a signed timer refuses forms sent faster than a person can type, and one address can only send a few forms an hour.</li><li>Throwaway email addresses and made-up phone numbers are refused.</li><li>UTM values (source, medium, campaign, term, content), click ids, the first visit's values, the page address and the referrer are saved in the log.</li></ul></Section>
				<div class="row" style="justify-content:flex-end"><Btn v-if="canManage" variant="primary" :loading="saving" @click="save">Save</Btn></div>
			</div>
		</div>`,
	}
})()
