/* Bookings admin: the Lead forms tab. A public web form (a link, or embedded on other websites) that creates a CRM lead.
 * The list of forms, and the editor with the same tabs as a booking widget: Details, Form, Leads, Messages, Branding, Embed, Anti-spam.
 * What came in (log, counts, charts) is in the Report. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue
	const CM = window.CM
	const DM = window.DM
	const V = DM.views

	DM.lf = (m, a) => CM.call('crm_addons.demos.leadforms.' + m, a)
	DM.lfUrl = (slug) => location.origin + '/lead-form/' + slug
	const origins = (doc) => String(doc.allowed_origins || '').split('\n').map((s) => s.trim()).filter(Boolean)

	// ------------------------------------------------------------------ the list
	V.LeadForms = {
		setup() {
			const rows = ref([]); const loading = ref(true); const error = ref(''); const busy = reactive({}); const q = ref(''); const filter = ref('all')
			const layout = ref((() => { try { return localStorage.getItem('crm_leadforms_layout') === 'list' ? 'list' : 'cards' } catch (e) { return 'cards' } })())
			watch(layout, (v) => { try { localStorage.setItem('crm_leadforms_layout', v) } catch (e) { /* not saved */ } })
			async function load(quiet) {
				if (!quiet) loading.value = true; error.value = ''
				try { rows.value = (await DM.lf('list_forms')) || []; DM.formsCache = rows.value } catch (e) { error.value = DM.friendly(e) } finally { loading.value = false }
			}
			onMounted(load)
			const canManage = computed(() => DM.session.widgets === 'manage')
			const edit = (r) => CM.go('/forms/' + encodeURIComponent(r.name) + '/details')
			const shown = computed(() => rows.value.filter((r) => (filter.value === 'all' || (filter.value === 'on') === !!DM.bool(r.enabled)) && (!q.value || (r.title + ' ' + r.slug).toLowerCase().includes(q.value.toLowerCase()))))
			const counts = computed(() => ({ all: rows.value.length, on: rows.value.filter((r) => DM.bool(r.enabled)).length, off: rows.value.filter((r) => !DM.bool(r.enabled)).length }))
			async function setEnabled(r, on) {
				busy[r.name] = true
				try { const d = (await DM.lf('get_form_admin', { name: r.name })).doc; d.enabled = on ? 1 : 0; await DM.lf('save_form', { doc: JSON.stringify(d) }); r.enabled = on ? 1 : 0; CM.toast(on ? 'Form is on' : 'Form is off: its page shows "not available"') } catch (e) { CM.toast(DM.friendly(e), 'err'); load(true) } finally { busy[r.name] = false }
			}
			async function remove(r) {
				if (r.entries > 0) {
					const ok = await CM.confirm({ title: 'This form has a history', message: `"${r.title}" has ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'} in the lead form report, so it cannot be deleted: the history would lose its link to it. Turn it off instead.`, confirmText: DM.bool(r.enabled) ? 'Turn it off' : 'Close', danger: false })
					if (ok && DM.bool(r.enabled)) setEnabled(r, false)
					return
				}
				if (!(await CM.confirm({ title: 'Delete this form?', message: `"${r.title}" and its page /lead-form/${r.slug} will be removed. This cannot be undone.`, confirmText: 'Delete', danger: true }))) return
				try { await DM.lf('delete_form', { name: r.name }); CM.toast('Form deleted'); load(true) } catch (e) { CM.toast(DM.friendly(e), 'err') }
			}
			async function duplicate(r) {
				busy[r.name] = true
				try { const d = await DM.lf('duplicate_form', { name: r.name }); CM.toast('Duplicated. It is off until you switch it on.'); await load(true); CM.go('/forms/' + encodeURIComponent(d.doc.name) + '/details') } catch (e) { CM.toast(DM.friendly(e), 'err') } finally { busy[r.name] = false }
			}
			const menu = (r) => [
				{ label: 'Edit', icon: 'edit', run: () => edit(r) },
				{ label: 'Open public page', icon: 'external', run: () => window.open(r.url, '_blank', 'noopener'), disabled: !DM.bool(r.enabled) },
				{ label: 'Copy link', icon: 'link', run: () => DM.copy(r.url, 'Link') },
				{ label: 'Report', icon: 'chart', run: () => CM.go('/report/forms?form=' + encodeURIComponent(r.name)) },
				{ label: 'Duplicate', icon: 'copy', run: () => duplicate(r) },
				{ sep: true },
				{ label: 'Delete', icon: 'trash', danger: true, run: () => remove(r) },
			]
			const pg = CM.usePaged(() => shown.value)
			return { pg, rows, shown, counts, loading, error, busy, q, filter, layout, canManage, edit, setEnabled, menu, load, DM, CM, go: CM.go }
		},
		template: `
		<div class="page">
			<div v-if="!canManage" class="alert info"><Ico name="info" /><div class="grow"><b>View only.</b> You can see the forms but not change them.</div></div>
			<div class="pg-head"><div class="grow"><h1>Lead forms</h1><p>Each form is a public page, or a form on your own website, that creates a lead in the CRM: its own fields, messages, branding and spam protection. What came in is in the <a href="#/report/forms">Lead form report</a>.</p></div><div class="actions"><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/forms/new/details')">Create form</Btn></div></div>
			<div v-if="!loading && !error && rows.length" class="row wrap tools"><div class="chips"><button v-for="f in [['all', 'All'], ['on', 'On'], ['off', 'Off']]" :key="f[0]" type="button" class="fchip" :class="{ on: filter === f[0] }" :aria-pressed="filter === f[0]" @click="filter = f[0]">{{ f[1] }}<span class="n">{{ counts[f[0]] }}</span></button></div><div class="grow"></div><div style="width:min(300px,100%)"><Inp v-model="q" icon="search" placeholder="Search forms" clearable aria-label="Search forms" /></div><div class="seg" role="group" aria-label="Layout"><button type="button" :class="{ on: layout === 'cards' }" :aria-pressed="layout === 'cards'" title="Cards" aria-label="Cards" @click="layout = 'cards'"><Ico name="grid" /></button><button type="button" :class="{ on: layout === 'list' }" :aria-pressed="layout === 'list'" title="List" aria-label="List" @click="layout = 'list'"><Ico name="list" /></button></div></div>
			<div v-if="loading" class="dgrid"><Skel v-for="n in 3" :key="n" h="190" r="12" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load()" />
			<Empty v-else-if="!rows.length" icon="file" title="No lead forms yet" text="Create one to get a page, or a form for your website. Whoever fills it in becomes a lead in the CRM."><Btn v-if="canManage" variant="primary" icon="plus" @click="go('/forms/new/details')">Create form</Btn></Empty>
			<Empty v-else-if="!shown.length" icon="search" title="No form matches" text="Try a different search or filter."><Btn @click="q = ''; filter = 'all'">Clear filters</Btn></Empty>
			<div v-else-if="layout === 'cards'" class="dgrid">
				<article v-for="r in shown" :key="r.name" class="card dcard" :class="{ off: !DM.bool(r.enabled) }">
					<div class="dcard-h">
						<button type="button" class="dcard-t" @click="edit(r)" :aria-label="'Edit ' + r.title"><b class="ellipsis">{{ r.title }}</b><span class="small muted">{{ r.assignment_mode }}<template v-if="r.lead_source"> - source {{ r.lead_source }}</template></span></button>
						<span class="dcard-sw"><span class="small" :class="DM.bool(r.enabled) ? '' : 'faint'">{{ DM.bool(r.enabled) ? 'On' : 'Off' }}</span><Switch :model-value="DM.bool(r.enabled)" :aria-disabled="!canManage" :label="'Turn ' + r.title + (DM.bool(r.enabled) ? ' off' : ' on')" @update:model-value="(v) => canManage && !busy[r.name] && setEnabled(r, v)" /></span>
						<Menu v-if="canManage" :items="menu(r)" :label="'Actions for ' + r.title" />
					</div>
					<div class="dcard-link"><Ico name="link" size="sm" /><a :href="r.url" target="_blank" rel="noopener" class="mono ellipsis" @click.stop>/lead-form/{{ r.slug }}</a><CopyBtn :text="r.url" bare label="Copy link" what="Link" /></div>
					<dl class="dcard-d"><div><dt>Fields</dt><dd><b>{{ r.field_count }}</b></dd></div><div><dt>Messages</dt><dd><b>{{ r.message_count }}</b></dd></div></dl>
					<div class="dcard-f"><Btn size="sm" variant="ghost" icon="chart" @click="go('/report/forms?form=' + encodeURIComponent(r.name))">Report</Btn><span class="grow"></span><Btn size="sm" @click="edit(r)">Edit</Btn></div>
				</article>
			</div>
			<div v-else class="card" style="padding:0"><div class="table-wrap"><table class="tbl wl-tbl">
				<thead><tr><th>Form</th><th>Page</th><th>New leads go to</th><th class="num">Fields</th><th class="num">Messages</th><th>On</th><th></th></tr></thead>
				<tbody><tr v-for="r in pg.rows" :key="r.name" class="click" :class="{ off: !DM.bool(r.enabled) }" tabindex="0" @click="edit(r)" @keydown.enter="edit(r)">
					<td><b class="ellipsis" style="display:block;max-width:230px">{{ r.title }}</b><div class="small muted"><template v-if="r.lead_source">Source {{ r.lead_source }}</template></div></td>
					<td @click.stop><span class="row" style="gap:4px;flex-wrap:nowrap"><a :href="r.url" target="_blank" rel="noopener" class="mono ellipsis" style="max-width:170px">/lead-form/{{ r.slug }}</a><CopyBtn :text="r.url" bare label="Copy link" what="Link" /></span></td>
					<td>{{ r.assignment_mode }}</td><td class="num">{{ r.field_count }}</td><td class="num">{{ r.message_count }}</td>
					<td @click.stop><Switch :model-value="DM.bool(r.enabled)" :aria-disabled="!canManage" :label="'Turn ' + r.title + (DM.bool(r.enabled) ? ' off' : ' on')" :disabled="!canManage || busy[r.name]" @update:model-value="canManage && setEnabled(r, $event)" /></td>
					<td class="num nowrap" @click.stop><Menu v-if="canManage" :items="menu(r)" :label="'Actions for ' + r.title" /></td>
				</tr></tbody>
			</table></div><Pager v-model:page="pg.page" :size="pg.size" :total="pg.total" style="padding:10px 14px;border-top:1px solid var(--border)" /></div>
		</div>`,
	}

	// ------------------------------------------------------------------ the editor
	const TABS = [
		{ key: 'details', label: 'Details', icon: 'file', comp: 'LfDetailsTab' },
		{ key: 'form', label: 'Form', icon: 'rows', comp: 'LfFormTab' },
		{ key: 'leads', label: 'Leads', icon: 'target', comp: 'LfLeadsTab' },
		{ key: 'messages', label: 'Messages', icon: 'mail', comp: 'LfMessagesTab' },
		{ key: 'branding', label: 'Branding', icon: 'palette', comp: 'LfBrandingTab' },
		{ key: 'embed', label: 'Embed', icon: 'code', comp: 'LfEmbedTab' },
		{ key: 'antispam', label: 'Anti-spam', icon: 'shield', comp: 'LfAntiSpamTab' },
	]
	const ERR_TAB = { title: 'details', slug: 'details', fields: 'form', assign: 'leads', messages: 'messages', accent: 'branding', redirect: 'branding', origins: 'branding' }
	const newDoc = () => ({ name: '', title: '', slug: '', enabled: 1, brand_name: '', logo: '', accent_color: '', theme: 'Auto', heading: '', description: '', button_text: '', success_title: '', success_text: '', redirect_url: '', footer_text: '', allowed_origins: '', consent_text: '', consent_default: 0, max_per_ip_per_hour: 20, lead_source: '', lead_status: '', assignment_mode: 'Follow assignment rules', assign_to: '', notify_owner: 1, fields_list: [], messages_list: [] })
	const fromServer = (d) => ({ ...newDoc(), ...d, fields_list: (d.fields_list || []).map((f) => ({ label: '', placeholder: '', help: '', ...f, required: f.required ? 1 : 0 })), messages_list: (d.messages_list || []).map((m) => ({ after_minutes: 0, send_email: 0, email_template: '', send_whatsapp: 0, wa_template: '', wa_account: '', wa_variables: '', ...m })), enabled: d.enabled ? 1 : 0 })

	function validate(doc, taken, isNew) {
		const e = {}
		if (!doc.title.trim()) e.title = 'Give the form a title.'
		if (isNew) {
			if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(doc.slug)) e.slug = 'Use lower-case letters, numbers and dashes (at least 3 characters).'
			else if (DM.RESERVED.includes(doc.slug)) e.slug = '"' + doc.slug + '" is reserved. Choose another.'
			else if (taken.includes(doc.slug)) e.slug = 'Another form already uses this address.'
		}
		if (doc.assignment_mode === 'Specific person' && !doc.assign_to) e.assign = 'Choose who new leads go to.'
		const m = doc.messages_list.find((x) => (x.send_email && !x.email_template) || (x.send_whatsapp && !x.wa_template))
		if (m) e.messages = 'Choose a template for each channel that is on.'
		if (doc.accent_color && !DM.isHex(doc.accent_color)) e.accent = 'Use a colour like #2563eb.'
		if (doc.redirect_url && !/^https:\/\/\S+$/i.test(doc.redirect_url)) e.redirect = 'Enter a full address starting with https://'
		if (origins(doc).some((o) => !/^https?:\/\/[^/\s]+$/i.test(o))) e.origins = 'One origin per line, like https://www.example.com (no path).'
		return e
	}

	V.LeadFormEditor = {
		props: { name: String, tab: String },
		setup(props) {
			const isNew = props.name === 'new'
			const doc = ref(null); const loading = ref(true); const loadError = ref(''); const saving = ref(false); const loadKey = ref(0); const serverName = ref(isNew ? '' : props.name)
			const taken = ref([]); const showErrors = ref(false); const info = reactive({ url: '', sources: [], statuses: [], catalog: [] })
			let baseline = ''; const snap = () => JSON.stringify(doc.value)
			const dirty = computed(() => !!doc.value && snap() !== baseline)
			const tab = computed(() => (TABS.some((t) => t.key === props.tab) ? props.tab : 'details'))
			const cur = computed(() => TABS.find((t) => t.key === tab.value))
			const errs = computed(() => (doc.value ? validate(doc.value, taken.value, isNew) : {}))
			const tabErr = (k) => Object.keys(errs.value).some((e) => ERR_TAB[e] === k)
			async function load() {
				loading.value = true; loadError.value = ''
				try {
					await CM.loadShared()
					const [d, list, ch, cat] = await Promise.all([isNew ? Promise.resolve(null) : DM.lf('get_form_admin', { name: props.name }), DM.lf('list_forms').catch(() => []), DM.lf('choices'), DM.lf('get_catalog')])
					taken.value = (list || []).filter((r) => r.name !== serverName.value).map((r) => r.slug)
					Object.assign(info, { sources: ch.sources, statuses: ch.statuses, catalog: cat, url: d ? d.url : '' })
					if (isNew) { const n = await DM.lf('new_form_defaults'); doc.value = fromServer({ fields_list: n.fields_list }) } else doc.value = fromServer(d.doc)
					baseline = snap(); loadKey.value++
				} catch (e) { loadError.value = DM.friendly(e) } finally { loading.value = false }
			}
			function goTab(k) { CM.replace('/forms/' + encodeURIComponent(props.name) + '/' + k) }
			async function discard() {
				if (!dirty.value) return
				if (!(await CM.confirm({ title: 'Discard your changes?', message: 'The form goes back to how it was last saved.', confirmText: 'Discard', danger: true }))) return
				doc.value = JSON.parse(baseline); loadKey.value++
			}
			async function save() {
				if (saving.value || !doc.value) return false
				showErrors.value = true
				const keys = Object.keys(errs.value)
				if (keys.length) { const first = TABS.find((t) => keys.some((k) => ERR_TAB[k] === t.key)); CM.toast(errs.value[keys[0]], 'err'); if (first && first.key !== tab.value) goTab(first.key); return false }
				saving.value = true
				try {
					const res = await DM.lf('save_form', { doc: JSON.stringify({ ...doc.value, name: serverName.value || undefined }) })
					if (isNew) { DM.guard.fn = null; CM.toast('Form created'); CM.replace('/forms/' + encodeURIComponent(res.doc.name) + '/' + tab.value); return true }
					serverName.value = res.doc.name; info.url = res.url; doc.value = fromServer(res.doc); baseline = snap(); loadKey.value++
					CM.toast('Saved'); return true
				} catch (e) { CM.toast(DM.friendly(e), 'err', 9000); return false } finally { saving.value = false }
			}
			DM.guard.dirty = () => dirty.value
			DM.guard.fn = async () => (!dirty.value ? true : CM.confirm({ title: 'Leave without saving?', message: 'You have changes that are not saved.', confirmText: 'Leave', danger: true }))
			function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
			onMounted(() => { load(); window.addEventListener('keydown', onKey) })
			onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); DM.guard.fn = null; DM.guard.dirty = null })
			const viewOnly = computed(() => DM.session.widgets !== 'manage')
			return { viewOnly, doc, loading, loadError, saving, dirty, tab, cur, TABS, errs, tabErr, showErrors, load, save, discard, goTab, isNew, loadKey, info, serverName, back: () => DM.leave('/forms'), DM, CM }
		},
		template: `
		<div class="page wide editor">
			<div v-if="loading" class="col"><Skel h="44" r="10" /><Skel h="40" r="10" /><Skel h="360" r="12" /></div>
			<ErrorState v-else-if="loadError" :message="loadError" @retry="load" />
			<template v-else>
			<div class="ed-bar">
				<div class="ed-l"><button type="button" class="back" @click="back"><Ico name="arrow-left" /> Lead forms</button>
					<div class="ed-title"><h1 class="ellipsis">{{ doc.title || (isNew ? 'New lead form' : 'Untitled form') }}</h1><span v-if="dirty" class="badge amber"><span class="sr">Status: </span>Unsaved changes</span><span v-else-if="!isNew" class="badge green">Saved</span></div></div>
				<div class="ed-r"><a v-if="!isNew && doc.enabled && !dirty" class="btn" :href="info.url" target="_blank" rel="noopener"><Ico name="external" />Open page</a><Btn :disabled="!dirty || saving" @click="discard">Discard</Btn><Btn variant="primary" icon="save" :loading="saving" :disabled="(!dirty && !isNew) || viewOnly" title="Save (Ctrl+S)" @click="save">{{ isNew ? 'Create form' : 'Save' }}</Btn></div>
			</div>
			<div class="tabs ed-tabs" role="tablist" aria-label="Form sections"><button v-for="t in TABS" :key="t.key" type="button" class="tab" :class="{ on: t.key === tab }" role="tab" :aria-selected="t.key === tab" @click="goTab(t.key)"><Ico :name="t.icon" />{{ t.label }}<i v-if="tabErr(t.key) && (showErrors || !isNew)" class="tab-dot" title="Needs attention"></i></button></div>
			<div v-if="viewOnly" class="alert info"><Ico name="info" /><div class="grow"><b>View only.</b> You can look at this form but not change it.</div></div>
			<fieldset :disabled="viewOnly" class="ro"><component :is="cur.comp" :key="cur.key + loadKey" :doc="doc" :errs="showErrors || !isNew ? errs : {}" :info="info" :saved-name="serverName" :is-new="isNew" :dirty="dirty" /></fieldset>
			</template>
		</div>`,
	}

	// ------------------------------------------------------------------ Details
	V.LfDetailsTab = {
		props: { doc: Object, errs: Object, isNew: Boolean, savedName: String, info: Object },
		setup(props) {
			const doc = props.doc
			let slugTouched = !props.isNew || !!doc.slug
			const st = reactive({ state: '', text: '' })
			function onTitle() { if (!slugTouched) doc.slug = DM.slugify(doc.title) }
			function onSlug(v) { slugTouched = true; doc.slug = DM.slugify(v) }
			watch(() => doc.slug, (s) => {
				if (!s) { st.state = ''; return }
				if (DM.RESERVED.includes(s)) { st.state = 'bad'; st.text = 'Reserved'; return }
				const other = (DM.formsCache || []).find((r) => r.slug === s && r.name !== props.savedName)
				if (other) { st.state = 'bad'; st.text = 'Used by "' + other.title + '"'; return }
				st.state = 'ok'; st.text = 'Available'
			}, { immediate: true })
			return { onTitle, onSlug, st, DM, publicUrl: DM.lfUrl }
		},
		template: `
		<div class="col tabcol">
			<Section title="Basics" icon="file">
				<Field label="Title" required :error="errs.title" hint="Shown at the top of the form."><input class="inp" :class="{ bad: errs.title }" v-model="doc.title" maxlength="120" placeholder="For example: Free trial sign-up" @input="onTitle" /></Field>
				<Field label="Web address" required :error="errs.slug"><div class="slugbox" :class="{ bad: errs.slug || (isNew && st.state === 'bad'), locked: !isNew }"><span class="slug-pre mono">{{ publicUrl('') }}</span><input class="slug-in mono" :value="doc.slug" maxlength="60" placeholder="free-trial" aria-label="Web address" :disabled="!isNew" @input="onSlug($event.target.value)" /><span v-if="isNew && st.state" class="slug-st" :class="st.state">{{ st.text }}</span></div>
					<div v-if="!errs.slug" class="hint"><template v-if="isNew">Lower-case letters, numbers and dashes. It cannot be changed after the form is created, because links already shared would break.</template><template v-else>The address is fixed once a form exists. To use a different one, duplicate the form.</template></div></Field>
				<Field label="Description" hint="Shown under the title. What happens after someone fills it in?"><textarea class="inp" v-model="doc.description" rows="3" maxlength="400" placeholder="Tell us a little about you and we will get back to you within a day."></textarea></Field>
				<Toggle v-model="doc.enabled" label="Accepting submissions" text="When off, the page shows that the form is not available. Leads already created are not affected." />
			</Section>
		</div>`,
	}

	// ------------------------------------------------------------------ Form
	V.LfFormTab = {
		props: { doc: Object, errs: Object, info: Object },
		setup(props) {
			const doc = props.doc
			const spec = (n) => props.info.catalog.find((c) => c.fieldname === n) || { label: n, fieldtype: 'Data' }
			const isCore = (f) => ['first_name', 'email', 'mobile_no'].includes(f.fieldname)
			const addable = computed(() => props.info.catalog.filter((c) => !doc.fields_list.some((f) => f.fieldname === c.fieldname)).map((c) => ({ value: c.fieldname, label: c.label, sub: c.fieldtype })))
			function addField(v) { if (v) doc.fields_list.push({ fieldname: v, label: '', required: spec(v).reqd ? 1 : 0, placeholder: '', help: '' }) }
			const move = (i, d) => { const j = i + d; if (j < 0 || j >= doc.fields_list.length) return; const [x] = doc.fields_list.splice(i, 1); doc.fields_list.splice(j, 0, x) }
			const removeField = (i) => doc.fields_list.splice(i, 1)
			const open = reactive({}); const help = ref(false); const dragFrom = ref(-1); const dragOver = ref(-1)
			function drop(j) { const i = dragFrom.value; dragFrom.value = dragOver.value = -1; if (i < 0 || i === j) return; const [x] = doc.fields_list.splice(i, 1); doc.fields_list.splice(j, 0, x) }
			return { spec, isCore, addable, addField, move, removeField, open, help, dragFrom, dragOver, drop, DM }
		},
		template: `
		<div class="col tabcol"><div class="formgrid">
			<div class="col">
				<Section title="Questions" icon="rows" text="Only fields that already exist on the CRM lead can be asked, so what comes in matches the rest of your CRM. Name, email and phone are always on the form.">
					<ul class="qlist" role="list">
						<li v-for="(f, i) in doc.fields_list" :key="f.fieldname" class="q" :class="{ over: dragOver === i && dragFrom !== i }" draggable="true" @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver = -1" @drop.prevent="drop(i)" @dragend="dragFrom = dragOver = -1">
							<div class="q-h"><span class="grip" aria-hidden="true"><Ico name="grip" /></span>
								<div class="grow"><b>{{ f.label || spec(f.fieldname).label }}</b><span class="small muted"> - {{ spec(f.fieldname).fieldtype }}</span></div>
								<span class="small muted nowrap">Required</span><Switch :model-value="!!f.required" :disabled="f.fieldname === 'first_name'" :label="'Required: ' + spec(f.fieldname).label" @update:model-value="(v) => (f.required = v ? 1 : 0)" />
								<Btn size="sm" variant="ghost" icon="arrow-up" :disabled="i === 0" aria-label="Move up" @click="move(i, -1)" /><Btn size="sm" variant="ghost" icon="arrow-down" :disabled="i === doc.fields_list.length - 1" aria-label="Move down" @click="move(i, 1)" />
								<Btn size="sm" variant="ghost" :icon="open[f.fieldname] ? 'chevron-up' : 'chevron-down'" aria-label="More settings" @click="open[f.fieldname] = !open[f.fieldname]" /><Btn size="sm" variant="ghost" icon="trash" aria-label="Remove question" :disabled="isCore(f)" :title="isCore(f) ? 'Name, email and phone are always on the form' : 'Remove'" @click="removeField(i)" /></div>
							<div v-if="open[f.fieldname]" class="q-b"><div class="g3"><Field label="Label"><input class="inp" v-model="f.label" :placeholder="spec(f.fieldname).label" maxlength="80" /></Field><Field label="Placeholder"><input class="inp" v-model="f.placeholder" maxlength="120" /></Field><Field label="Help text"><input class="inp" v-model="f.help" maxlength="200" /></Field></div></div>
						</li>
					</ul>
					<div class="row" style="gap:10px;align-items:center"><div style="width:260px"><Dd :model-value="''" :options="addable" searchable placeholder="Add a question" :disabled="!addable.length" aria-label="Add a question" @update:model-value="addField" /></div><button type="button" class="btn ghost" @click="help = !help"><Ico name="info" /> A field is missing</button></div>
					<div v-if="help" class="alert info"><Ico name="info" /><div class="grow"><b>Add it in the CRM first.</b> A form never creates fields, so the data stays the same everywhere. Ask an admin to add the field to the CRM Lead (Customize Form, CRM Lead) and any new option values there as well. Once it exists in the CRM it shows up in this list.</div></div>
					<p class="small muted" style="margin:0">Email and phone are required by default. Untick Required to make either optional; at least one has to be filled in. Someone who matches an existing lead by email or phone is never added twice.</p>
				</Section>
				<Section title="WhatsApp consent" icon="whatsapp">
					<Field label="Consent text" hint="Shown as a tick box under the form. WhatsApp messages (see Messages) are sent only when it is ticked. Leave empty for no WhatsApp."><textarea class="inp" rows="2" v-model="doc.consent_text" maxlength="300" placeholder="Send me updates on WhatsApp."></textarea></Field>
					<label class="check"><input type="checkbox" :checked="!!doc.consent_default" @change="doc.consent_default = $event.target.checked ? 1 : 0" /><span>Ticked by default<span class="small faint" style="display:block">Only where the law and Meta's rules allow a pre-ticked box.</span></span></label>
				</Section>
			</div>
			<div class="col"><Section title="How the form looks" icon="eye"><div class="formpv"><div class="fp-t">{{ doc.heading || doc.title || 'Your details' }}</div><div v-for="f in doc.fields_list" :key="f.fieldname" class="fp-f"><span>{{ f.label || spec(f.fieldname).label }}<b v-if="f.required"> *</b></span><div class="fp-i" :class="['Small Text', 'Text', 'Long Text'].includes(spec(f.fieldname).fieldtype) ? 'tall' : ''">{{ f.placeholder }}</div></div><div v-if="doc.consent_text" class="small muted">&#9744; {{ doc.consent_text }}</div><div class="fp-b">{{ doc.button_text || 'Send' }}</div></div></Section></div>
		</div></div>`,
	}

	// ------------------------------------------------------------------ Leads
	V.LfLeadsTab = {
		props: { doc: Object, errs: Object, info: Object },
		setup(props) {
			const people = ref([])
			async function findPeople(txt) { const r = await DM.api('search_team', { txt: txt || '', limit: 300 }); people.value = (r || []).map((x) => ({ value: x.email, label: x.full_name || x.email, sub: x.email })) }
			onMounted(() => findPeople(''))
			return { people, findPeople, DM }
		},
		template: `
		<div class="col tabcol">
			<Section title="New leads" icon="target" text="What a lead created by this form starts with. Only sources and statuses that already exist in the CRM are offered.">
				<div class="g2"><Field label="Lead source"><Dd v-model="doc.lead_source" :options="info.sources.map((s) => ({ value: s, label: s }))" searchable allow-empty="Leave the source empty" placeholder="Leave the source empty" aria-label="Lead source" /></Field>
				<Field label="Lead status" hint="Used only for new leads."><Dd v-model="doc.lead_status" :options="info.statuses.map((s) => ({ value: s, label: s }))" allow-empty="CRM default" placeholder="CRM default" aria-label="Lead status" /></Field></div>
				<Field label="Who gets new leads" :error="errs.assign"><Seg v-model="doc.assignment_mode" :options="[{ value: 'Follow assignment rules', label: 'Assignment rules' }, { value: 'Specific person', label: 'A specific person' }, { value: 'Unassigned', label: 'Nobody (unassigned)' }]" /></Field>
				<Field v-if="doc.assignment_mode === 'Specific person'" label="Person" :error="errs.assign"><Dd v-model="doc.assign_to" :options="people" searchable placeholder="Choose a person" aria-label="Person" /></Field>
			</Section>
			<Section title="Someone who is already a lead" icon="users" text="Matched by email or phone. No second lead is created.">
				<ul class="small muted" style="margin:0;padding-left:18px;display:grid;gap:4px"><li>The lead gets a note with everything they shared, and an Update details button that puts the new details on the lead.</li><li>The lead stays with its owner. Nothing is reassigned.</li><li>The attempt is in the Lead form report.</li></ul>
				<Toggle v-model="doc.notify_owner" label="Tell the lead's owner" text="The owner gets a notification when their lead fills in the form again." />
			</Section>
		</div>`,
	}

	// ------------------------------------------------------------------ Messages
	const DELAYS = [0, 60, 180, 1440, 2880, 4320, 10080]
	const delayLabel = (m) => { m = Number(m) || 0; if (!m) return 'Right away'; const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60; return 'After ' + [d ? d + (d === 1 ? ' day' : ' days') : '', h ? h + (h === 1 ? ' hour' : ' hours') : '', mi ? mi + ' min' : ''].filter(Boolean).join(' ') }

	V.LfRule = {
		props: { rule: Object, index: Number },
		emits: ['remove', 'pick-email', 'edit-email', 'preview-email'],
		setup(props, { emit }) {
			const rule = props.rule
			const open = ref((rule.send_email && !rule.email_template) || (rule.send_whatsapp && !rule.wa_template) || props.index === 0)
			const tpl = ref(null)
			async function loadTpl() { tpl.value = rule.email_template ? await CM.getEmailTemplate(rule.email_template) : null }
			watch(() => rule.email_template, loadTpl); onMounted(() => { loadTpl(); if (rule.send_whatsapp) DM.loadWa() })
			watch(() => rule.send_whatsapp, (v) => { if (v) DM.loadWa() })
			const wa = DM.waTemplates
			const waTpl = computed(() => wa.rows.find((t) => t.name === rule.wa_template))
			const waOptions = computed(() => wa.rows.slice().sort((x, y) => Number(y.approved) - Number(x.approved) || x.template_name.localeCompare(y.template_name)).map((t) => ({ value: t.name, label: t.template_name, sub: t.approved ? (t.category || '').toLowerCase() + ' - ' + (t.language_code || 'en') : 'Not approved: ' + CM.waState.label(t.state), disabled: !t.approved })))
			const map = reactive({})
			function readMap() { Object.keys(map).forEach((k) => delete map[k]); try { Object.assign(map, JSON.parse(rule.wa_variables || '{}')) } catch (e) { /* empty */ } }
			readMap()
			watch(map, () => { rule.wa_variables = Object.keys(map).length ? JSON.stringify(map) : '' }, { deep: true })
			function pickWa(n) {
				rule.wa_template = n
				const t = wa.rows.find((x) => x.name === n); rule.wa_account = (t && t.whatsapp_account) || ''
				const saved = (t && t.variable_map) || {}; const defaults = ['{{ first_name }}', '{{ last_name }}']
				const next = {}; ;(t ? t.placeholders : []).forEach((p, i) => { next[p] = map[p] || saved[p] || defaults[i] || '' })
				Object.keys(map).forEach((k) => delete map[k]); Object.assign(map, next)
			}
			const missing = computed(() => (waTpl.value ? waTpl.value.placeholders.filter((p) => !String(map[p] || '').trim()) : []))
			const vals = computed(() => (waTpl.value ? waTpl.value.placeholders.map((p) => DM.fill(map[p] || '')) : []))
			const insert = (p, tok) => CM.insertAtCursor(document.querySelector(`[data-lfm="${props.index}-${p}"]`), tok)
			const status = computed(() => { const on = []; if (rule.send_email) on.push('Email'); if (rule.send_whatsapp) on.push('WhatsApp'); return on })
			const incomplete = computed(() => (rule.send_email && !rule.email_template) || (rule.send_whatsapp && !rule.wa_template))
			const delayOpts = computed(() => [...new Set([...DELAYS, Number(rule.after_minutes) || 0])].sort((a, b) => a - b).map((v) => ({ value: v, label: delayLabel(v) })))
			const emailReady = computed(() => !CM.shared.config || CM.shared.config.email.ready)
			const waReady = computed(() => !CM.shared.config || CM.shared.config.whatsapp.ready)
			return { open, tpl, wa, waTpl, waOptions, map, pickWa, missing, vals, insert, status, incomplete, delayOpts, delayLabel, emailReady, waReady, loadWa: DM.loadWa, DM, CM }
		},
		template: `
		<article class="card rule" :class="{ on: status.length, open }">
			<div class="rule-h" role="button" tabindex="0" :aria-expanded="open" @click="open = !open" @keydown.enter.self="open = !open" @keydown.space.self.prevent="open = !open">
				<div class="rule-i"><Ico :name="rule.after_minutes ? 'clock' : 'send'" /></div>
				<div class="grow"><b>{{ delayLabel(rule.after_minutes) }}</b><div class="small muted ellipsis">{{ rule.after_minutes ? 'A follow-up after the form was filled in.' : 'A welcome message as soon as the form is filled in.' }}</div></div>
				<span v-for="c in status" :key="c" class="ch" :class="c"><Ico :name="c === 'Email' ? 'mail' : 'whatsapp'" size="sm" />{{ c }}</span>
				<span v-if="!status.length" class="small faint">Off</span><span v-if="incomplete" class="badge amber nodot">Pick a template</span>
				<Btn size="sm" variant="ghost" icon="trash" aria-label="Remove this message" @click.stop="$emit('remove')" /><Ico :name="open ? 'chevron-up' : 'chevron-down'" class="faint" />
			</div>
			<div v-if="open" class="rule-b">
				<Field label="When is it sent?"><div style="width:260px"><Dd v-model="rule.after_minutes" :options="delayOpts" aria-label="When is it sent" /></div></Field>
				<div class="chan">
					<div class="chan-h"><ChannelBadge value="Email" /><span v-if="!emailReady" class="badge amber nodot" title="No outgoing email account is set up">Cannot send yet</span><span class="grow"></span><Switch :model-value="!!rule.send_email" :label="'Send email'" @update:model-value="(v) => (rule.send_email = v ? 1 : 0)" /></div>
					<template v-if="rule.send_email">
						<div v-if="!rule.email_template" class="pick-empty"><Ico name="mail" size="lg" /><div class="grow"><b>Choose an email template</b><div class="small muted">From the campaign template library.</div></div><Btn variant="primary" @click="$emit('pick-email')">Choose</Btn></div>
						<div v-else class="tsel"><div class="tsel-th"><Thumb v-if="tpl && !tpl.missing" :html="DM.fill(tpl.body_html)" :height="120" /><div v-else class="skel" style="height:120px"></div></div>
							<div class="grow" style="min-width:0"><div class="lbl">Email template</div><b class="ellipsis" style="font-size:15px">{{ rule.email_template }}</b><div v-if="tpl && tpl.missing" class="small" style="color:var(--red)">This template no longer exists. Choose another.</div><div v-else-if="tpl" class="small muted ellipsis">Subject: {{ DM.fill(tpl.subject) }}</div>
								<div class="row wrap" style="margin-top:10px;gap:6px"><Btn size="sm" @click="$emit('pick-email')">Change</Btn><Btn size="sm" icon="eye" @click="$emit('preview-email')">Preview</Btn><Btn size="sm" icon="edit" @click="$emit('edit-email')">Edit template</Btn></div></div></div>
					</template>
				</div>
				<div class="chan">
					<div class="chan-h"><ChannelBadge value="WhatsApp" /><span v-if="!waReady" class="badge amber nodot" title="No active WhatsApp account">Cannot send yet</span><span class="grow"></span><Switch :model-value="!!rule.send_whatsapp" :label="'Send WhatsApp'" @update:model-value="(v) => (rule.send_whatsapp = v ? 1 : 0)" /></div>
					<template v-if="rule.send_whatsapp">
						<Field label="WhatsApp template" required>
							<div class="row" style="gap:8px"><div class="grow"><Dd :model-value="rule.wa_template" :options="waOptions" searchable placeholder="Choose an approved template" aria-label="WhatsApp template" @update:model-value="pickWa" /></div><Btn icon="refresh" :loading="wa.loading" aria-label="Refresh the template list" title="Refresh the list" @click="loadWa(true)" /></div>
							<div class="hint">WhatsApp only allows templates approved by Meta. Sent only to people who ticked the consent box on the form.</div>
							<div v-if="wa.error" class="err">{{ wa.error }}</div>
						</Field>
						<div v-if="waTpl" class="wa-grid"><div class="col" style="gap:12px">
							<template v-if="waTpl.placeholders.length"><div class="lbl">Fill the variables</div>
								<div v-for="p in waTpl.placeholders" :key="p" class="wa-map"><span class="wa-map-n mono">{{ $wa(p) }}</span><div class="grow"><input class="inp" :class="{ bad: !map[p] }" v-model="map[p]" :data-lfm="index + '-' + p" placeholder="Type text or insert a variable" :aria-label="'Value for variable ' + p" /><div class="tiny"><VarMenu size="sm" @pick="(t) => insert(p, t)" /></div></div></div>
								<div v-if="missing.length" class="small" style="color:var(--red)">Fill {{ missing.map($wa).join(', ') }}. An empty value makes WhatsApp refuse the message.</div></template>
							<div v-else class="small muted">This template has no variables.</div></div>
							<div class="wa-side"><WaBubble :header="waTpl.header" :header-type="waTpl.header_type" :body="waTpl.template" :footer="waTpl.footer" :buttons="waTpl.buttons" :values="vals" compact /></div></div>
						<div v-else class="wa-ph"><Ico name="whatsapp" size="xl" /><span>Pick a template to see the message</span></div>
					</template>
				</div>
			</div>
		</article>`,
	}

	V.LfMessagesTab = {
		props: { doc: Object, errs: Object },
		setup(props) {
			const doc = props.doc
			const pickFor = ref(null); const editTpl = reactive({ open: false, name: '', mode: '', rule: null }); const previewTpl = ref(null)
			onMounted(() => { CM.loadShared() })
			const add = (m) => doc.messages_list.push({ after_minutes: m, send_email: 0, email_template: '', send_whatsapp: 0, wa_template: '', wa_account: '', wa_variables: '' })
			async function remove(i) {
				const m = doc.messages_list[i]
				if ((m.send_email || m.send_whatsapp) && !(await CM.confirm({ title: 'Remove this message?', message: 'It will no longer be sent to new leads from this form.', confirmText: 'Remove', danger: true }))) return
				doc.messages_list.splice(i, 1)
			}
			const menuItems = computed(() => [...DELAYS.map((p) => ({ label: delayLabel(p), icon: p ? 'clock' : 'send', run: () => add(p) }))])
			const cfg = computed(() => CM.shared.config)
			function editTemplate(m) { editTpl.rule = m; editTpl.name = m.email_template; editTpl.mode = ''; editTpl.open = true }
			function createTemplate(m) { editTpl.rule = m; editTpl.name = ''; editTpl.mode = 'builder'; editTpl.open = true; pickFor.value = null }
			function tplSaved(n) { delete CM.tplCache[n]; if (editTpl.rule && !editTpl.rule.email_template) editTpl.rule.email_template = n; editTpl.name = n; CM.getEmailTemplate(n) }
			function picked(t) { pickFor.value.email_template = t.name; pickFor.value = null }
			const preview = computed(() => (previewTpl.value ? CM.tplCache[previewTpl.value] || {} : {}))
			watch(previewTpl, (n) => n && CM.getEmailTemplate(n))
			return { add, remove, menuItems, cfg, pickFor, editTpl, previewTpl, editTemplate, createTemplate, tplSaved, picked, preview, DM, CM }
		},
		template: `
		<div class="col tabcol">
			<div class="alert info"><Ico name="info" /><div class="grow"><b>Messages to the person who filled in the form.</b> A welcome message right away and, if you like, a follow-up after a day or two. They use your campaign templates, filled in with the lead's own details, and go to new leads only (not to someone who is already a lead). A WhatsApp STOP and a missing consent tick are always respected.</div></div>
			<div v-if="errs.messages" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ errs.messages }}</div></div>
			<div v-if="cfg && !cfg.email.ready" class="alert warn"><Ico name="alert" /><div class="grow"><b>No outgoing email account.</b> {{ cfg.email.problem }}</div></div>
			<div v-if="cfg && !cfg.whatsapp.ready" class="alert warn"><Ico name="alert" /><div class="grow"><b>WhatsApp account missing.</b> No active WhatsApp account is set up in frappe_whatsapp, so WhatsApp messages cannot be sent yet.</div></div>
			<div class="row grp-row"><h3 class="grp grow">Messages</h3><Menu :items="menuItems" label="Add a message"><Btn icon="plus" size="sm">Add a message</Btn></Menu></div>
			<LfRule v-for="(m, i) in doc.messages_list" :key="i" :rule="m" :index="i" @remove="remove(i)" @pick-email="pickFor = m" @edit-email="editTemplate(m)" @preview-email="previewTpl = m.email_template" />
			<Empty v-if="!doc.messages_list.length" icon="mail" title="No messages" text="Add a welcome message so people know their details arrived, and a follow-up after a day or two if you like."><Menu :items="menuItems"><Btn icon="plus">Add a message</Btn></Menu></Empty>
			<TemplatePicker v-if="pickFor" title="Choose an email template" subtitle="The shared campaign template library." :selected="pickFor.email_template" allow-create @pick="picked" @create="createTemplate(pickFor)" @close="pickFor = null" />
			<TemplateEditor v-if="editTpl.open" embedded :name="editTpl.name || undefined" :mode="editTpl.mode" @saved="tplSaved" @close="editTpl.open = false" />
			<Modal v-if="previewTpl" size="xl" :title="previewTpl" subtitle="Shown with sample details." @close="previewTpl = null">
				<EmailPreview :subject="DM.fill(preview.subject)" :html="DM.fill(preview.body_html)" :from-name="cfg && cfg.sender_name" :from-email="cfg && cfg.sender_email" :loading="!preview.body_html && !preview.missing" />
			</Modal>
		</div>`,
	}

	// ------------------------------------------------------------------ Branding
	V.LfBrandingTab = {
		props: { doc: Object, errs: Object },
		setup(props) {
			const doc = props.doc
			const logo = computed({ get: () => (doc.logo ? [{ file_url: doc.logo, file_name: doc.logo.split('/').pop(), file_size: 0 }] : []), set: (v) => { doc.logo = v[0] ? v[0].file_url : '' } })
			const onLight = computed(() => DM.contrast(doc.accent_color, '#ffffff')), onDark = computed(() => DM.contrast(doc.accent_color, '#111113'))
			const advice = computed(() => {
				if (!DM.isHex(doc.accent_color)) return null
				const msgs = []
				if (onLight.value < 1.6) msgs.push('Very pale: on a light page the button is shown in near-black instead.')
				else if (onLight.value < 3) msgs.push('Faint on a light page (' + onLight.value.toFixed(1) + ':1). A darker colour reads better.')
				if (onDark.value < 1.6) msgs.push('Very dark: on a dark page the button is shown in white instead.')
				else if (onDark.value < 3) msgs.push('Faint on a dark page (' + onDark.value.toFixed(1) + ':1). A lighter colour reads better.')
				return { ok: !msgs.length, msgs }
			})
			function setHex(v) { v = String(v).trim(); if (v && v[0] !== '#') v = '#' + v; doc.accent_color = v }
			const SW = ['#2d36a3', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#c026d3', '#7c3aed', '#111827']
			const accent = computed(() => (DM.isHex(doc.accent_color) ? doc.accent_color : '#2563eb'))
			const spec = (n) => (CM.shared.fields && 0) || n
			return { logo, advice, onLight, onDark, setHex, SW, accent, DM, CM }
		},
		template: `
		<div class="brgrid">
			<div class="col tabcol">
				<Section title="Identity" icon="palette">
					<Field label="Brand name" hint="Shown at the top of the form, for example the name of the website."><input class="inp" v-model="doc.brand_name" maxlength="80" placeholder="Coding Junior" /></Field>
					<Field label="Logo" hint="PNG, JPG, SVG or WebP."><Uploader v-model="logo" :multiple="false" :is-private="false" accept="image/*" :max-mb="3" title="Upload a logo" hint="Up to 3 MB" /></Field>
					<div v-if="doc.logo" class="logo-pv"><img :src="doc.logo" alt="Logo preview" /><Btn size="sm" variant="ghost" icon="trash" @click="doc.logo = ''">Remove</Btn></div>
					<Field label="Accent colour" :error="errs.accent">
						<div class="colorrow"><input type="color" class="colorpick" :value="accent" aria-label="Pick a colour" @input="setHex($event.target.value)" /><input class="inp mono" style="max-width:130px" :class="{ bad: errs.accent }" :value="doc.accent_color" maxlength="7" placeholder="#2563eb" aria-label="Colour code" @input="setHex($event.target.value)" />
							<div class="swatches"><button v-for="c in SW" :key="c" type="button" class="sw-c" :class="{ on: doc.accent_color === c }" :style="{ background: c }" :aria-label="'Use ' + c" @click="doc.accent_color = c"></button></div></div>
						<div v-if="advice" class="contrast" :class="advice.ok ? 'ok' : 'warn'"><Ico :name="advice.ok ? 'check-circle' : 'alert'" size="sm" /><span><template v-if="advice.ok">Readable on light and dark pages ({{ onLight.toFixed(1) }}:1 on white, {{ onDark.toFixed(1) }}:1 on dark).</template><template v-else>{{ advice.msgs.join(' ') }}</template></span></div>
					</Field>
					<Field label="Theme" hint="Auto follows the visitor's device."><Seg v-model="doc.theme" :options="[{ value: 'Auto', label: 'Auto', icon: 'monitor' }, { value: 'Light', label: 'Light', icon: 'sun' }, { value: 'Dark', label: 'Dark' }]" /></Field>
				</Section>
				<Section title="Wording" icon="text" text="Leave a field empty to use the default wording.">
					<Field label="Heading" hint="Replaces the title at the top of the form."><input class="inp" v-model="doc.heading" maxlength="120" placeholder="Start your free trial" /></Field>
					<div class="g2"><Field label="Button text"><input class="inp" v-model="doc.button_text" maxlength="40" placeholder="Send" /></Field><Field label="Footer text"><input class="inp" v-model="doc.footer_text" maxlength="160" placeholder="We never share your details." /></Field></div>
					<Field label="Thank-you title"><input class="inp" v-model="doc.success_title" maxlength="80" placeholder="Thank you" /></Field>
					<Field label="Thank-you message"><textarea class="inp" rows="2" v-model="doc.success_text" maxlength="400"></textarea></Field>
				</Section>
				<Section title="After the form" icon="external">
					<Field label="Redirect address (optional)" :error="errs.redirect" hint="Send the person to your own thank-you page instead of showing the thank-you message."><input class="inp" :class="{ bad: errs.redirect }" v-model="doc.redirect_url" placeholder="https://www.example.com/thanks" /></Field>
					<Field label="Allowed websites" :error="errs.origins" hint="Websites that may show this form inside theirs (pop-up or inline). One per line, for example https://www.codingjunior.com. The direct link works everywhere."><textarea class="inp mono" :class="{ bad: errs.origins }" rows="3" v-model="doc.allowed_origins" placeholder="https://www.example.com"></textarea></Field>
				</Section>
			</div>
			<div class="brprev"><div class="card pad prev-card"><div class="lfmock" :style="{ '--lf-ac': accent }">
				<div class="lfm-brand"><img v-if="doc.logo" :src="doc.logo" alt="" /><b v-else>{{ doc.brand_name || 'Your brand' }}</b></div>
				<h2>{{ doc.heading || doc.title || 'Your form' }}</h2><p v-if="doc.description">{{ doc.description }}</p>
				<div v-for="f in doc.fields_list" :key="f.fieldname" class="lfm-f"><span>{{ f.label || f.fieldname }}<b v-if="f.required"> *</b></span><div class="lfm-i">{{ f.placeholder }}</div></div>
				<div class="lfm-b">{{ doc.button_text || 'Send' }}</div><div v-if="doc.footer_text" class="lfm-foot">{{ doc.footer_text }}</div>
			</div><p class="small faint" style="margin:10px 0 0">A sketch of the form. Save, then open the page to see the real thing.</p></div></div>
		</div>`,
	}

	// ------------------------------------------------------------------ Embed
	V.LfEmbedTab = {
		props: { doc: Object, savedName: String, isNew: Boolean, dirty: Boolean, info: Object },
		setup(props) {
			const kind = ref('button'); const slug = props.doc.slug; const base = location.origin; const url = DM.lfUrl(slug)
			const script = `<script src="${base}/assets/crm_addons/book/lead-form-embed.js" async><\/script>`
			const snippets = computed(() => ({
				button: { text: 'Put this on any page. The button opens the form over your site; the visitor never leaves it.', code: `${script}\n<button type="button" data-crm-lead-form="${slug}">Get in touch</button>` },
				link: { text: 'A normal link. With the script on the page it opens as a pop-up, otherwise as the full page.', code: `${script}\n<a href="${url}" data-crm-lead-form="${slug}">Get in touch</a>` },
				inline: { text: 'The form shown inside your page. Its height follows the form.', code: `${script}\n<div data-crm-lead-form-inline="${slug}"></div>` },
				iframe: { text: 'A plain iframe, if you cannot add a script. The height is fixed, so give it room.', code: `<iframe src="${url}?embed=1" title="Get in touch" style="width:100%;height:640px;border:0;border-radius:12px" loading="lazy"></iframe>` },
			}))
			const list = computed(() => origins(props.doc))
			return { kind, snippets, url, list, DM }
		},
		template: `
		<div class="col tabcol">
			<div v-if="isNew || !doc.slug" class="alert warn"><Ico name="alert" /><div class="grow">Create the form first. Its page address and embed code are available once it is saved.</div></div>
			<div v-else-if="dirty" class="alert info"><Ico name="info" /><div class="grow">You have unsaved changes. The embed code does not depend on them, but the public page shows the saved version only.</div></div>
			<Section title="Your form page" icon="globe">
				<div class="urlbox"><Ico name="link" /><a class="mono grow ellipsis" :href="url" target="_blank" rel="noopener">{{ url }}</a><CopyBtn :text="url" label="Copy link" what="Link" /><a class="btn sm" :href="url" target="_blank" rel="noopener"><Ico name="external" />Open</a></div>
				<p v-if="!doc.enabled" class="small" style="margin:0;color:var(--amber)"><Ico name="alert" size="sm" /> This form is switched off, so the page shows that it is not available.</p>
			</Section>
			<Section title="Put it on your website" icon="code" text="Copy one of these into the page where the form should be.">
				<Seg v-model="kind" :options="[{ value: 'button', label: 'Pop-up button' }, { value: 'link', label: 'Link' }, { value: 'inline', label: 'Inline' }, { value: 'iframe', label: 'Iframe' }]" />
				<p class="small muted" style="margin:0">{{ snippets[kind].text }}</p>
				<div class="code"><pre tabindex="0"><code>{{ snippets[kind].code }}</code></pre><CopyBtn class="code-copy" :text="snippets[kind].code" label="Copy code" what="Code" /></div>
				<div class="alert" :class="list.length ? 'info' : 'warn'"><Ico :name="list.length ? 'shield' : 'alert'" /><div class="grow"><template v-if="list.length">The form works on: <b>{{ list.join(', ') }}</b>. Other websites cannot show it inside theirs.</template><template v-else>No websites are allowed yet. Add your website under Branding, Allowed websites, or the pop-up and inline form will not show on it. The direct link always works.</template></div></div>
			</Section>
			<Section title="Tracking" icon="chart" text="Add the campaign details to the link and they are saved in the log and on the lead.">
				<p class="small muted" style="margin:0">Use normal UTM parameters, for example <span class="mono">{{ url }}?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=spring</span>. With the script on your page, the first-visit UTMs of your site, the page address and the referrer are captured as well, even when the form is filled in later.</p>
			</Section>
		</div>`,
	}

	// ------------------------------------------------------------------ Anti-spam
	V.LfAntiSpamTab = {
		props: { doc: Object, errs: Object },
		template: `
		<div class="col tabcol">
			<Section title="Limits" icon="shield" text="Protect the CRM from junk and automated submissions. There is no CAPTCHA or one-time code.">
				<Field label="Forms per IP address" hint="Most forms one network can send in an hour. Offices share an address, so keep this above 5."><NumInp v-model="doc.max_per_ip_per_hour" :min="1" :max="500" unit="per hour" /></Field>
			</Section>
			<Section title="Always on" icon="check-circle">
				<ul class="checks"><li><Ico name="check" /> Phone and email are validated (a 10-digit Indian mobile number by default).</li><li><Ico name="check" /> A hidden field and a minimum fill time catch most bots.</li><li><Ico name="check" /> Disposable email addresses are refused.</li><li><Ico name="check" /> Someone who is already a lead is never added twice.</li><li><Ico name="check" /> Blocked attempts are kept in the report, so you can see them.</li></ul>
			</Section>
		</div>`,
	}
})()
