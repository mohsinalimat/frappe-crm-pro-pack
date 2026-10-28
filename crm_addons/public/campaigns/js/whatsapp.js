/* Campaign Manager: WhatsApp Templates section. Templates are created and approved in Meta and synced by the
 * frappe_whatsapp app; this page only reads them (and asks frappe_whatsapp to sync). */
(() => {
	const { ref, reactive, computed, watch, onMounted } = Vue
	const CM = window.CM
	const C = CM.components
	const V = CM.views

	const STATUSES = [['', 'All'], ['APPROVED', 'Approved'], ['PENDING', 'Pending'], ['REJECTED', 'Rejected'], ['DISABLED', 'Disabled']]
	const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'TRANSACTIONAL', 'OTP']
	const catLabel = (c) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : '')
	const stateTone = (s) => CM.STATUS_TONE[s] || 'neutral'
	const stateLabel = (s) => (s === 'NOT SYNCED' ? 'Not synced' : s.charAt(0) + s.slice(1).toLowerCase())
	CM.waState = { tone: stateTone, label: stateLabel, catLabel }

	/** Shared bubble for a template row (list drawer, wizard content, preview). */
	C.WaTemplateBubble = {
		props: { t: Object, values: [Array, Object], compact: Boolean, mediaUrl: String },
		setup(props) {
			const vals = computed(() => props.values || props.t.samples || [])
			return { vals }
		},
		template: `<WaBubble :header="t.header" :header-type="t.header_type" :body="t.template || t.body" :footer="t.footer" :buttons="t.buttons || []" :values="vals" :compact="compact" :media-url="mediaUrl" />`,
	}

	/** Create a template: saved through frappe_whatsapp's own WhatsApp Templates document, which submits it to Meta. */
	C.WaTemplateCreate = {
		props: { languages: { type: Array, default: () => ['en'] } },
		emits: ['close', 'created'],
		setup(props, { emit }) {
			const f = reactive({ template_name: '', category: 'MARKETING', language: props.languages.includes('en') ? 'en' : props.languages[0], header_type: '', header: '', sample: '', template: '', footer: '', buttons: [], sample_values: [], variable_map: {} })
			const files = ref([]); const busy = ref(false); const error = ref(''); const bodyEl = ref(null); const emojiOpen = ref(false)
			// is this name free for this language? (checked on the server, against the templates already here)
			const nameCheck = reactive({ ok: null, message: '' })
			const checkName = CM.debounce(async () => {
				if (!f.template_name.trim()) { nameCheck.ok = null; nameCheck.message = ''; return }
				try { Object.assign(nameCheck, await CM.api('check_whatsapp_template_name', { template_name: f.template_name, language: f.language })) } catch (e) { nameCheck.ok = null }
			}, 350)
			watch(() => [f.template_name, f.language], checkName)
			// formatting is written the way WhatsApp reads it: *bold* _italic_ ~strike~ ```mono```, "- " bullets, "1. " lists, "> " quotes
			function edit(fn) { const el = bodyEl.value; if (!el) return; const a = el.selectionStart, b = el.selectionEnd; const r = fn(el.value, a, b); el.value = r.text; el.selectionStart = r.a; el.selectionEnd = r.b; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus() }
			const wrap = (l, r) => edit((t, a, b) => (a === b ? { text: t.slice(0, a) + l + r + t.slice(b), a: a + l.length, b: a + l.length } : { text: t.slice(0, a) + l + t.slice(a, b) + r + t.slice(b), a: a + l.length, b: b + l.length }))
			const prefix = (p) => edit((t, a, b) => { const s0 = t.lastIndexOf('\n', a - 1) + 1; let e0 = t.indexOf('\n', b); if (e0 < 0) e0 = t.length; let n = 0; const block = t.slice(s0, e0).split('\n').map((ln) => (p === '1. ' ? (++n) + '. ' : p) + ln.replace(/^(- |\d+\. |> )/, '')).join('\n'); return { text: t.slice(0, s0) + block + t.slice(e0), a: s0, b: s0 + block.length } })
			const EMOJI = [['Smileys', ['\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F602}', '\u{1F923}', '\u{1F60A}', '\u{1F607}', '\u{1F642}', '\u{1F643}', '\u{1F609}', '\u{1F60C}', '\u{1F60D}', '\u{1F970}', '\u{1F618}', '\u{1F617}', '\u{1F619}', '\u{1F61A}', '\u{1F60B}', '\u{1F61B}', '\u{1F61C}', '\u{1F92A}', '\u{1F61D}', '\u{1F917}', '\u{1F92D}', '\u{1F914}', '\u{1F910}', '\u{1F610}', '\u{1F611}', '\u{1F636}', '\u{1F644}', '\u{1F60F}', '\u{1F62C}', '\u{1F62E}', '\u{1F62F}', '\u{1F632}', '\u{1F633}', '\u{1F97A}', '\u{1F622}', '\u{1F62D}', '\u{1F624}', '\u{1F620}', '\u{1F621}', '\u{1F92F}', '\u{1F631}', '\u{1F634}', '\u{1F929}', '\u{1F60E}', '\u{1F913}', '\u{1F973}', '\u{1F91D}']], ['Hands', ['\u{1F44B}', '\u{1F91A}', '\u270B', '\u{1F590}\uFE0F', '\u{1F44C}', '\u270C\uFE0F', '\u{1F91E}', '\u{1F91F}', '\u{1F919}', '\u{1F448}', '\u{1F449}', '\u{1F446}', '\u{1F447}', '\u261D\uFE0F', '\u{1F44D}', '\u{1F44E}', '\u270A', '\u{1F44A}', '\u{1F44F}', '\u{1F64C}', '\u{1F64F}', '\u{1F4AA}', '\u{1FAF6}', '\u270D\uFE0F']], ['Hearts', ['\u2764\uFE0F', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F5A4}', '\u{1F90D}', '\u{1F4AF}', '\u2728', '\u{1F525}', '\u2B50', '\u{1F31F}', '\u{1F4AB}', '\u{1F4A5}', '\u{1F389}', '\u{1F38A}', '\u{1F381}', '\u{1F388}', '\u{1F3C6}', '\u{1F947}', '\u{1F3C5}']], ['Study & work', ['\u{1F393}', '\u{1F4DA}', '\u{1F4D6}', '\u{1F4DD}', '\u270F\uFE0F', '\u{1F4D2}', '\u{1F3EB}', '\u{1F3E2}', '\u{1F3DB}\uFE0F', '\u{1F4BC}', '\u{1F4CA}', '\u{1F4C8}', '\u{1F4BB}', '\u{1F5A5}\uFE0F', '\u{1F4F1}', '\u{1F4DE}', '\u260E\uFE0F', '\u{1F4E7}', '\u2709\uFE0F', '\u{1F4E9}', '\u{1F4AC}', '\u{1F5E3}\uFE0F', '\u{1F4E2}', '\u{1F4E3}', '\u{1F514}', '\u{1F4A1}', '\u{1F511}', '\u{1F512}']], ['Time & place', ['\u{1F4C5}', '\u{1F4C6}', '\u{1F5D3}\uFE0F', '\u23F0', '\u23F3', '\u231B', '\u{1F550}', '\u{1F4CD}', '\u{1F4CC}', '\u{1F5FA}\uFE0F', '\u{1F3E0}', '\u{1F697}', '\u2708\uFE0F', '\u{1F680}', '\u{1F30D}', '\u{1F1EE}\u{1F1F3}']], ['Money', ['\u{1F4B0}', '\u{1F4B5}', '\u{1F4B3}', '\u{1F9FE}', '\u{1FA99}', '\u{1F4B8}', '\u{1F3E6}']], ['Symbols', ['\u2705', '\u2611\uFE0F', '\u2714\uFE0F', '\u274C', '\u274E', '\u26A0\uFE0F', '\u2757', '\u2753', '\u2795', '\u2796', '\u27A1\uFE0F', '\u2B05\uFE0F', '\u2B06\uFE0F', '\u2B07\uFE0F', '\u{1F534}', '\u{1F7E2}', '\u{1F535}', '\u{1F7E1}', '\u25B6\uFE0F', '\u{1F517}']]]
			function putEmoji(e) { emojiOpen.value = false; CM.insertAtCursor(bodyEl.value, e) }
			const count = computed(() => { const m = f.template.match(/\{\{\s*\d+\s*\}\}/g); return m ? new Set(m.map((x) => x.replace(/\D/g, ''))).size : 0 })
			// one example value per variable, kept in step with the body
			watch(count, (n) => { while (f.sample_values.length < n) f.sample_values.push(''); f.sample_values.length = n }, { immediate: true })
			// each variable can be tied to a field of the lead, so a campaign (and the next person) starts with it already filled in
			const fieldOptions = computed(() => [{ value: '', label: 'Type my own value' }, ...((CM.shared.fields && CM.shared.fields.variables) || []).map((v) => ({ value: '{{ ' + v.name + ' }}', label: v.label || v.name, sub: v.name }))])
			function mapTo(i, token) {
				f.variable_map[i + 1] = token
				if (token) f.sample_values[i] = CM.sampleFill(token) || f.sample_values[i]
			}
			const mapped = (i) => f.variable_map[i + 1] || ''
			const addVar = () => { const el = bodyEl.value; const t = '{{' + (count.value + 1) + '}}'; if (el) CM.insertAtCursor(el, t); else f.template += t }
			const addButton = (type) => { if (f.buttons.length < 10) f.buttons.push({ button_type: type, button_label: '', website_url: '', phone_number: '', example_url: '' }) }
			watch(files, (v) => { f.sample = v[0] ? v[0].file_url : '' })
			const tok = (n) => '{{' + n + '}}'
			const kinds = [{ value: 'MARKETING', label: 'Marketing' }, { value: 'UTILITY', label: 'Utility' }]
			const headers = [{ value: '', label: 'No header' }, { value: 'TEXT', label: 'Text' }, { value: 'IMAGE', label: 'Image' }, { value: 'DOCUMENT', label: 'Document' }]
			const preview = computed(() => ({ header: f.header_type === 'TEXT' ? f.header : '', header_type: f.header_type, template: f.template || 'Your message appears here.', footer: f.footer, buttons: f.buttons.filter((b) => b.button_label), samples: f.sample_values.map((v, i) => v || '{{' + (i + 1) + '}}') }))
			const mediaUrl = computed(() => (files.value[0] ? files.value[0].file_url : ''))
			async function submit() {
				if (busy.value) return
				busy.value = true; error.value = ''
				try { const r = await CM.api('create_whatsapp_template', { data: JSON.stringify(f) }); CM.toast(r.message); emit('created', r) } catch (e) { error.value = e.message } finally { busy.value = false }
			}
			const ticks = '\u0060\u0060\u0060'
			return { ticks, nameCheck, emojiOpen, EMOJI, wrap, prefix, putEmoji, fieldOptions, mapTo, mapped, mediaUrl, tok, f, files, busy, error, bodyEl, count, addVar, addButton, kinds, headers, preview, submit, CM }
		},
		template: `
		<Modal size="xl" title="Create a WhatsApp template" subtitle="Sent to Meta for approval through your WhatsApp account. It stays Pending until Meta approves it." @close="$emit('close')" @submit="submit">
			<div class="wa-create">
				<div class="col" style="gap:14px;min-width:0">
					<div class="wa-top-row"><Field label="Template name" :error="nameCheck.ok === false ? nameCheck.message : ''"><input class="inp" :class="{ bad: nameCheck.ok === false }" v-model="f.template_name" placeholder="admission_reminder" aria-label="Template name" /></Field>
						<Field label="Category"><Dd v-model="f.category" :options="kinds" /></Field>
						<Field label="Language"><Dd v-model="f.language" :options="languages" /></Field></div>
					<div class="hint wa-name-hint" :class="{ ok: nameCheck.ok }"><template v-if="nameCheck.ok">{{ nameCheck.message }}</template><template v-else-if="nameCheck.ok === null">Lower case letters, numbers and underscores, e.g. admission_reminder. The name must be new for this language: Meta refuses a name that is already in use.</template></div>
					<Field label="Header (optional)"><div class="col" style="gap:8px"><div style="width:180px"><Dd v-model="f.header_type" :options="headers" /></div>
						<input v-if="f.header_type === 'TEXT'" class="inp" v-model="f.header" maxlength="60" placeholder="Up to 60 characters, no variables" aria-label="Header text" />
						<Uploader v-else-if="f.header_type" v-model="files" :is-private="false" :multiple="false" :accept="f.header_type === 'IMAGE' ? 'image/*' : '.pdf'" :max-mb="5" :title="'Example ' + f.header_type.toLowerCase() + ' for Meta'" hint="Meta reviews this example. Stored publicly." /></div></Field>
					<Field label="Body" :hint="f.template.length + ' / 1024. Variables are {{1}}, {{2}}... in order.'"><div class="wa-fmt" role="toolbar" aria-label="Message formatting">
							<button type="button" title="Bold: *text*" aria-label="Bold" @click="wrap('*', '*')"><Ico name="bold" size="sm" /></button><button type="button" title="Italic: _text_" aria-label="Italic" @click="wrap('_', '_')"><Ico name="italic" size="sm" /></button><button type="button" title="Strikethrough: ~text~" aria-label="Strikethrough" @click="wrap('~', '~')"><s>S</s></button><button type="button" title="Monospace" aria-label="Monospace" @click="wrap(ticks, ticks)"><Ico name="code" size="sm" /></button>
							<span class="re-sep"></span><button type="button" title="Bullet list" aria-label="Bullet list" @click="prefix('- ')"><Ico name="list" size="sm" /></button><button type="button" title="Numbered list" aria-label="Numbered list" @click="prefix('1. ')"><Ico name="list-ol" size="sm" /></button><button type="button" title="Quote" aria-label="Quote" @click="prefix('> ')">&ldquo;</button>
							<span class="re-sep"></span><span class="wa-emoji"><button type="button" title="Emoji" aria-label="Emoji" @click="emojiOpen = !emojiOpen">&#128578;</button><div v-if="emojiOpen" class="wa-emoji-pop" role="listbox"><template v-for="g in EMOJI" :key="g[0]"><div class="wa-emoji-g">{{ g[0] }}</div><div class="wa-emoji-row"><button v-for="e in g[1]" :key="e" type="button" @click="putEmoji(e)">{{ e }}</button></div></template></div></span>
						</div><textarea ref="bodyEl" class="inp" rows="6" maxlength="1024" v-model="f.template" placeholder="Hello {{1}}, your counselling session is on {{2}}."></textarea><div style="margin-top:6px"><Btn size="sm" icon="plus" @click="addVar">Add variable {{ tok(count + 1) }}</Btn></div></Field>
					<div v-if="count" class="wa-vars"><div class="lbl">Variables</div>
						<div class="wa-var wa-var-h"><span>Variable</span><span>Filled from (lead field)</span><span>Example for Meta and the preview</span></div>
						<div v-for="(v, i) in f.sample_values" :key="i" class="wa-var"><span class="tchip">{{ tok(i + 1) }}</span><div class="wa-var-f"><Dd :model-value="mapped(i)" :options="fieldOptions" searchable placeholder="Type my own value" size="sm" @update:model-value="(t) => mapTo(i, t)" /></div><input class="inp" v-model="f.sample_values[i]" placeholder="e.g. Siddharth" :aria-label="'Example for variable ' + (i + 1)" /></div></div>
					<Field label="Footer (optional)"><input class="inp" v-model="f.footer" maxlength="60" placeholder="Up to 60 characters, no variables" /></Field>
					<Field label="Buttons (optional)"><div class="col" style="gap:8px">
						<div v-for="(b, i) in f.buttons" :key="i" class="card pad" style="padding:10px;box-shadow:none"><div class="row" style="gap:6px"><span class="tchip">{{ b.button_type }}</span><input class="inp grow" style="height:32px" v-model="b.button_label" maxlength="25" placeholder="Button label" :aria-label="'Button ' + (i + 1) + ' label'" /><Btn size="sm" variant="ghost" icon="x" aria-label="Remove button" @click="f.buttons.splice(i, 1)" /></div>
							<input v-if="b.button_type === 'Visit Website'" class="inp" style="margin-top:6px;height:32px" v-model="b.website_url" placeholder="https://example.com or https://example.com/{{1}}" aria-label="Website address" />
							<input v-if="b.button_type === 'Visit Website' && b.website_url.includes('{{')" class="inp" style="margin-top:6px;height:32px" v-model="b.example_url" placeholder="Example link, e.g. https://example.com/abc" aria-label="Example link" />
							<input v-if="b.button_type === 'Call Phone'" class="inp" style="margin-top:6px;height:32px" v-model="b.phone_number" placeholder="+919876543210" aria-label="Phone number" /></div>
						<div class="row wrap" style="gap:6px"><Btn size="sm" icon="plus" :disabled="f.buttons.length >= 10" @click="addButton('Quick Reply')">Quick reply</Btn><Btn size="sm" icon="plus" :disabled="f.buttons.length >= 10" @click="addButton('Visit Website')">Website</Btn><Btn size="sm" icon="plus" :disabled="f.buttons.length >= 10" @click="addButton('Call Phone')">Call</Btn></div></div></Field>
					<div v-if="error" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
				</div>
				<div class="wa-create-pv"><div class="lbl" style="margin-bottom:8px">Preview</div><div class="wa-stage"><WaTemplateBubble :t="preview" :media-url="mediaUrl" sender="Your business" /></div></div>
			</div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="send" :loading="busy" :disabled="nameCheck.ok === false" @click="submit">{{ busy ? 'Sending to Meta' : 'Create and submit to Meta' }}</Btn></template>
		</Modal>`,
	}

	/** Saved replies for the WhatsApp chat on a lead: short messages with variables. They are filled in for the lead and shown in the message box first, never sent on their own. */
	V.WaReplies = {
		setup() {
			const rows = ref([]); const loading = ref(true); const error = ref(''); const canEdit = ref(false); const ed = ref(null); const busy = ref(false); const box = ref(null)
			async function load() { loading.value = true; error.value = ''; try { const r = await CM.api('list_whatsapp_replies', {}); rows.value = r.rows; canEdit.value = r.can_edit } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(() => { CM.loadShared(); load() })
			const openNew = () => { ed.value = { id: '', title: '', text: '' } }
			const openEdit = (r) => { ed.value = { ...r } }
			const vars = (t) => [...new Set([...String(t).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))]
			const insert = (token) => CM.insertAtCursor(box.value, token)
			async function save() { busy.value = true; try { const r = await CM.api('save_whatsapp_reply', { title: ed.value.title, text: ed.value.text, reply_id: ed.value.id || undefined }); rows.value = r.rows; ed.value = null; CM.toast('Saved reply stored') } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false } }
			async function drop(r) { if (!(await CM.confirm({ title: 'Delete "' + r.title + '"?', confirmText: 'Delete', danger: true }))) return; try { rows.value = (await CM.api('delete_whatsapp_reply', { reply_id: r.id })).rows } catch (e) { CM.toast(e.message, 'err') } }
			return { rows, loading, error, canEdit, ed, busy, box, openNew, openEdit, vars, insert, save, drop, load }
		},
		template: `
		<div class="stack" style="gap:14px">
			<div class="alert"><Ico name="info" /><div class="grow"><b>Saved replies are not templates.</b> <span style="color:inherit;opacity:.85">They are quick messages for an open chat (the lead wrote in the last 24 hours). On a lead's WhatsApp tab, type <b>/</b> to pick one: it is filled in with the lead's details and shown in the message box so you can change it before sending.</span></div></div>
			<div class="row"><div class="grow"></div><Btn v-if="canEdit" variant="primary" icon="plus" @click="openNew">New saved reply</Btn></div>
			<div v-if="loading" class="card pad"><Skel h="60" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<Empty v-else-if="!rows.length" icon="whatsapp" title="No saved replies yet" :text="canEdit ? 'Add the answers your team gives again and again, such as pricing or a thank-you.' : 'Someone who edits templates can add them.'" />
			<div v-else class="card" style="padding:0;overflow:hidden"><ul class="list" style="margin:0">
				<li v-for="r in rows" :key="r.id" class="li row" style="gap:12px;align-items:flex-start;padding:12px 16px"><Ico name="whatsapp" /><div class="grow" style="min-width:0"><b>{{ r.title }}</b><div class="small muted" style="white-space:pre-wrap;overflow-wrap:anywhere">{{ r.text }}</div><div v-if="vars(r.text).length" class="row wrap" style="gap:6px;margin-top:6px"><span v-for="v in vars(r.text)" :key="v" class="tchip">{{ v }}</span></div></div>
					<template v-if="canEdit"><Btn size="sm" icon="edit" @click="openEdit(r)">Edit</Btn><Btn size="sm" variant="ghost" icon="trash" aria-label="Delete reply" @click="drop(r)" /></template></li></ul></div>
			<Modal v-if="ed" :title="ed.id ? 'Edit saved reply' : 'New saved reply'" @close="ed = null">
				<Field label="Title" hint="What people see when they type /"><Inp v-model="ed.title" placeholder="e.g. Pricing" aria-label="Reply title" /></Field>
				<Field label="Message"><textarea ref="box" class="inp" rows="5" v-model="ed.text" placeholder="Hi {{ first_name }}, ..." aria-label="Reply message"></textarea><div style="margin-top:6px"><VarMenu @pick="insert" /></div></Field>
				<div class="small muted">Variables such as <b v-pre>{{ first_name }}</b> are filled in from the lead. The person can still edit the text before it is sent.</div>
				<template #foot><Btn @click="ed = null">Cancel</Btn><Btn variant="primary" :loading="busy" :disabled="!ed.title.trim() || !ed.text.trim()" @click="save">Save</Btn></template>
			</Modal>
		</div>`,
	}

	V.WhatsAppTemplates = {
		setup() {
			const data = ref(null); const loading = ref(true); const error = ref(''); const syncing = ref(false)
			const view = ref('templates'); const q = reactive({ search: '', category: '', status: '', purpose: '' }); const layout = CM.useLayout('crm_wa_templates_layout'); const protectedDel = ref(null); const detail = ref(null); const createOpen = ref(false)
			const created = async () => { createOpen.value = false; await load(true) }
			async function load(quiet) { if (!quiet) loading.value = true; error.value = ''; try { data.value = await CM.api('list_whatsapp_templates', {}) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(() => { CM.loadShared(); load() })
			const rows = computed(() => (data.value ? data.value.rows : []))
			const shown = computed(() => {
				const term = q.search.trim().toLowerCase()
				const rank = { APPROVED: 0, PENDING: 1, REJECTED: 2, PAUSED: 3, DISABLED: 3 }
				return rows.value.slice().sort((x, y) => (rank[x.state] ?? 4) - (rank[y.state] ?? 4) || x.template_name.localeCompare(y.template_name)).filter((r) => (!q.category || r.category === q.category) && (!q.purpose || r.purpose === q.purpose) && (!q.status || r.state === q.status || (q.status === 'DISABLED' && ['PAUSED', 'DISABLED'].includes(r.state))) && (!term || `${r.template_name} ${r.template}`.toLowerCase().includes(term)))
			})
			const purposeCount = (p) => rows.value.filter((r) => !p || r.purpose === p).length
			const count = (s) => (s ? rows.value.filter((r) => r.state === s || (s === 'DISABLED' && r.state === 'PAUSED')).length : rows.value.length)
			async function sync() {
				syncing.value = true
				try { const r = await CM.api('sync_whatsapp_templates', {}); CM.toast(r.message || 'Templates synced'); await load(true) } catch (e) { CM.toast(e.message, 'err', 9000) } finally { syncing.value = false }
			}
			async function refresh() { await load(true); CM.toast('List refreshed') }
			const use = (t) => { if (!t.approved) return CM.toast('Only templates approved by Meta can be used in a campaign.', 'warn'); CM.go('/campaigns/new?wa=' + encodeURIComponent(t.name)) }
			const cats = computed(() => CATEGORIES.filter((c) => rows.value.some((r) => r.category === c)).map((c) => ({ value: c, label: catLabel(c) })))
			return { view, protectedDel, layout, purposeCount, createOpen, created, data, loading, error, syncing, q, shown, rows, count, sync, refresh, detail, use, load, STATUSES, cats, stateTone, stateLabel, catLabel, CM }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>{{ view === 'templates' ? 'WhatsApp templates' : 'WhatsApp saved replies' }}</h1><p>{{ view === 'templates' ? 'Message templates approved by Meta for WhatsApp Business. Pick one when you build a campaign.' : 'Quick messages with variables for open chats. Shown to the person before they send.' }}</p></div>
				<div v-show="view === 'templates'" class="actions"><Btn v-if="data && data.installed && data.can_create" variant="primary" icon="plus" @click="createOpen = true">Create template</Btn><Btn icon="refresh" :loading="loading && !!data" @click="refresh">Refresh</Btn><Btn v-if="data && data.can_sync" variant="primary" icon="download" :loading="syncing" @click="sync">{{ syncing ? 'Syncing' : 'Sync status from Meta' }}</Btn></div></div>
			<Seg v-model="view" :options="[{ value: 'templates', label: 'Templates' }, { value: 'replies', label: 'Saved replies' }]" style="align-self:flex-start" />
			<WaReplies v-if="view === 'replies'" />
			<template v-if="view === 'templates'">
			<div class="alert"><Ico name="info" /><div class="grow"><b>Create a template here and Meta reviews it.</b> <span class="muted" style="color:inherit;opacity:.85">New templates start as Pending and can be used once Meta approves them. Press Sync from Meta to update their status.</span> <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener">Open WhatsApp Manager <Ico name="external" size="sm" /></a></div></div>
			<div v-if="data && !data.can_sync" class="small faint">Only managers can sync from Meta. Use Refresh to reload this list.</div>
			<div v-if="data && !data.installed"><Empty icon="whatsapp" title="WhatsApp is not set up" text="The frappe_whatsapp app is not installed on this site, so there are no WhatsApp templates. Email campaigns work without it." /></div>
			<template v-else>
				<div class="row wrap tool">
					<div style="width:300px;max-width:100%"><Inp v-model="q.search" icon="search" placeholder="Search templates" clearable aria-label="Search templates" /></div>
 					<div class="chips"><button v-for="p in ['', 'System']" :key="p" type="button" class="fchip" :class="{ on: q.purpose === p }" :aria-pressed="q.purpose === p" @click="q.purpose = p">{{ p || 'All' }} <span class="n">{{ purposeCount(p) }}</span></button></div>
					<div style="width:180px"><Dd v-model="q.category" :options="cats" placeholder="All categories" allow-empty="All categories" size="sm" /></div>
					<div class="chips"><button v-for="s in STATUSES" :key="s[0]" type="button" class="fchip" :class="{ on: q.status === s[0] }" @click="q.status = s[0]">{{ s[1] }} <span class="n">{{ count(s[0]) }}</span></button></div>
					<div class="grow"></div><HdrSlot><LayoutSwitch v-model="layout" /></HdrSlot>
				</div>
				<div v-if="loading" class="wgrid"><div v-for="n in 6" :key="n" class="card pad"><Skel h="150" r="10" /><Skel w="60%" h="14" style="margin-top:12px" /></div></div>
				<ErrorState v-else-if="error" :message="error" @retry="load" />
				<Empty v-else-if="!shown.length" icon="whatsapp" :title="rows.length ? 'No templates match' : 'No WhatsApp templates yet'" :text="rows.length ? 'Try a different search or status.' : 'Create a template in Meta (WhatsApp Manager), then press Sync from Meta. It appears here once synced.'"><Btn v-if="!rows.length && data && data.can_sync" variant="primary" icon="download" :loading="syncing" @click="sync">Sync from Meta</Btn></Empty>
 				<div v-else-if="layout === 'list'" class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="tbl">
					<thead><tr><th>Template</th><th>Group</th><th>Category</th><th>Status</th><th>Language</th><th></th></tr></thead>
					<tbody><tr v-for="t in shown" :key="t.name" class="click" :class="t.purpose ? 'p-system' : ''" tabindex="0" @click="detail = t" @keydown.enter="detail = t">
						<td><b class="ellipsis" style="display:block;max-width:300px" :title="t.template_name">{{ t.template_name }}</b><div class="small muted ellipsis" style="max-width:300px">{{ t.template }}</div></td>
						<td><PurposeTag v-if="t.purpose" :purpose="t.purpose" /><span v-else class="faint">-</span></td><td>{{ catLabel(t.category) || '-' }}</td><td><span class="badge" :class="stateTone(t.state)">{{ stateLabel(t.state) }}</span></td><td>{{ t.language_code || 'en' }}</td>
						<td class="num" @click.stop><Btn v-if="data && data.can_create" size="sm" :variant="t.approved ? 'primary' : ''" :disabled="!t.approved" @click="use(t)">Use in campaign</Btn></td>
					</tr></tbody></table></div></div>
				<div v-else class="wgrid">
					<article v-for="t in shown" :key="t.name" class="wcard card hover" :class="t.purpose ? 'p-system' : ''" tabindex="0" @click="detail = t" @keydown.enter="detail = t">
						<div class="wcard-pv"><WaTemplateBubble :t="t" compact /></div>
						<div class="wcard-b">
							<div class="row"><b class="grow ellipsis" :title="t.template_name">{{ t.template_name }}</b><span class="badge" :class="stateTone(t.state)">{{ stateLabel(t.state) }}</span></div>
							<div class="row wrap" style="gap:6px"><PurposeTag v-if="t.purpose" :purpose="t.purpose" /><span v-if="t.category" class="tchip">{{ catLabel(t.category) }}</span><span class="tchip">{{ t.language_code || 'en' }}</span><span class="tchip" :title="t.synced ? 'Fetched from Meta' : 'Created in this CRM, not synced from Meta'"><Ico :name="t.synced ? 'check-circle' : 'file'" size="sm" style="margin-right:4px" />{{ t.synced ? 'Meta-synced' : 'Local' }}</span><span v-if="t.placeholders.length" class="tchip">{{ t.placeholders.length }} variable{{ t.placeholders.length > 1 ? 's' : '' }}</span></div>
							<div class="row" style="margin-top:6px"><Btn size="sm" :variant="t.approved ? 'primary' : ''" :disabled="!t.approved" :title="t.approved ? '' : 'Only approved templates can be used'" @click.stop="use(t)" v-if="data && data.can_create">Use in campaign</Btn><span class="grow"></span><Btn size="sm" variant="ghost" icon="eye" @click.stop="detail = t">Details</Btn></div>
						</div>
					</article>
				</div>
			</template>
 			</template>
 			<ProtectedDelete v-if="protectedDel" kind="whatsapp" :template="protectedDel" @close="protectedDel = null" @deleted="protectedDel = null; detail = null; load(true)" />
			<WaTemplateCreate v-if="createOpen" :languages="(data && data.languages) || ['en']" @close="createOpen = false" @created="created" />
			<Drawer v-if="detail" :title="detail.template_name" :subtitle="stateLabel(detail.state) + ' - ' + catLabel(detail.category)" @close="detail = null">
				<div class="wa-stage"><WaTemplateBubble :t="detail" /></div>
				<dl class="dl"><dt>Status</dt><dd><span class="badge" :class="stateTone(detail.state)">{{ stateLabel(detail.state) }}</span></dd><dt>Source</dt><dd>{{ detail.synced ? 'Synced from Meta' : 'Local (not synced from Meta)' }}</dd><dt>Category</dt><dd>{{ catLabel(detail.category) || '-' }}</dd><dt>Language</dt><dd>{{ detail.language_code || '-' }}</dd><dt>Header</dt><dd>{{ detail.header_type ? detail.header_type.charAt(0) + detail.header_type.slice(1).toLowerCase() : 'None' }}</dd><dt>Variables</dt><dd><span v-if="!detail.placeholders.length">None</span><div v-for="(p, i) in detail.placeholders" :key="p" class="mono small">{{ $wa(p) }} <span class="faint">sample:</span> {{ detail.samples[i] || '-' }}</div></dd><dt>Buttons</dt><dd><span v-if="!detail.buttons.length">None</span><div v-for="b in detail.buttons" :key="b.button_label">{{ b.button_label }} <span class="faint small">({{ b.button_type }})</span></div></dd><dt>Meta name</dt><dd class="mono small">{{ detail.actual_name || detail.name }}</dd><dt>Last updated</dt><dd>{{ CM.fmt(detail.modified) }}</dd></dl>
				<div v-if="!detail.approved" class="alert warn"><Ico name="alert" /><div class="grow">This template is <b>{{ stateLabel(detail.state) }}</b>. Only templates approved by Meta can be sent. Check its status in WhatsApp Manager, then sync.</div></div>
				<template #foot><Btn v-if="detail.is_system && data && data.can_create" variant="ghost" icon="trash" :disabled="!(CM.shared.config && CM.shared.config.is_admin)" :title="(CM.shared.config && CM.shared.config.is_admin) ? '' : 'Ready-made template: only a System Manager can delete it'" @click="protectedDel = detail">Delete</Btn><Btn @click="detail = null">Close</Btn><Btn v-if="data && data.can_sync && !detail.approved" icon="refresh" :loading="syncing" @click="sync().then(() => { detail = rows.find((r) => r.name === detail.name) || detail })">Check status with Meta</Btn><Btn v-if="data && data.can_create" variant="primary" icon="send" :disabled="!detail.approved" @click="use(detail)">Use in campaign</Btn></template>
			</Drawer>
		</div>`,
	}
})()
