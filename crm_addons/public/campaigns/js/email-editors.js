/* Campaign Manager: the three ways to write an email (visual builder, HTML editor, rich text) plus the shared
 * "send a test email" dialog and the server-side preview helper. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const C = CM.components

	/** Debounced server rendering of a (possibly unsaved) subject + html with sample data. */
	CM.useRender = (getSubject, getHtml, wait = 450) => {
		const out = reactive({ subject: '', html: '', unknown: [], loading: false, error: '', sample: true })
		const id = CM.uid() // each preview has its own "latest" slot
		let seq = 0
		const run = CM.debounce(async () => {
			const my = ++seq; out.loading = true
			try {
				const r = await CM.apiLatest('render-preview:' + id, 'render_email_preview', { subject: getSubject() || '', html: getHtml() || '' })
				if (my !== seq) return
				Object.assign(out, { subject: r.subject, html: r.html, unknown: r.unknown, error: '' })
			} catch (e) { if (my === seq) out.error = e.message } finally { if (my === seq) out.loading = false }
		}, wait)
		watch(() => [getSubject(), getHtml()], run, { immediate: true })
		onBeforeUnmount(() => { run.cancel(); CM.cancel('render-preview:' + id) })
		return out
	}

	// ------------------------------------------------------------------ small pieces
	C.ColorInp = {
		props: { modelValue: String },
		emits: ['update:modelValue'],
		template: `<div class="color"><input type="color" :value="modelValue" aria-label="Pick colour" @input="$emit('update:modelValue', $event.target.value)" /><input class="inp mono" :value="modelValue" maxlength="9" aria-label="Colour code" @input="$emit('update:modelValue', $event.target.value)" /></div>`,
	}
	C.EmailChips = {
		props: { modelValue: { type: Array, default: () => [] }, max: { type: Number, default: 10 }, placeholder: { type: String, default: 'name@company.com' } },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const text = ref(''); const bad = ref('')
			const ok = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s)
			function commit() {
				const parts = text.value.split(/[\s,;]+/).filter(Boolean)
				if (!parts.length) return
				const next = [...props.modelValue]; const wrong = []
				parts.forEach((p) => { p = p.toLowerCase(); if (!ok(p)) wrong.push(p); else if (!next.includes(p) && next.length < props.max) next.push(p) })
				emit('update:modelValue', next); text.value = wrong.join(' '); bad.value = wrong.length ? `Not a valid email address: ${wrong.join(', ')}` : ''
			}
			const remove = (e) => emit('update:modelValue', props.modelValue.filter((x) => x !== e))
			function key(e) { if (['Enter', ',', ';', ' '].includes(e.key) && text.value.trim()) { e.preventDefault(); e.stopPropagation(); commit() } else if (e.key === 'Backspace' && !text.value && props.modelValue.length) remove(props.modelValue[props.modelValue.length - 1]) }
			return { text, bad, commit, remove, key }
		},
		template: `<div><div class="chips-in inp" :class="{ bad: bad }"><span v-for="e in modelValue" :key="e" class="tchip-x">{{ e }}<button type="button" :aria-label="'Remove ' + e" @click="remove(e)"><Ico name="x" size="sm" /></button></span><input v-model="text" :placeholder="modelValue.length ? '' : placeholder" aria-label="Email addresses" @keydown="key" @blur="commit" @paste.prevent="text += $event.clipboardData.getData('text'); commit()" /></div><div v-if="bad" class="err small" style="margin-top:4px;color:var(--red)">{{ bad }}</div></div>`,
	}

	// ------------------------------------------------------------------ send a test email
	C.SendTest = {
		props: { subject: String, html: String, template: String, attachments: { type: Array, default: () => [] }, lead: String },
		emits: ['close'],
		setup(props, { emit }) {
			const emails = ref([]); const state = ref('idle'); const message = ref('')
			const max = computed(() => (CM.shared.config && CM.shared.config.test_email_max) || 10)
			onMounted(async () => { await CM.loadShared(); const me = CM.shared.config && CM.shared.config.sender_email; if (me && !emails.value.length) emails.value = [me] })
			async function send() {
				if (!emails.value.length) { state.value = 'error'; message.value = 'Add at least one email address.'; return }
				state.value = 'sending'; message.value = ''
				try {
					const r = await CM.api('send_test_email', { emails: emails.value, subject: props.subject, html: props.html, email_template: props.template || undefined, attachments: props.attachments, lead: props.lead || undefined })
					state.value = 'ok'; message.value = `Sent to ${r.to.join(', ')}. It uses sample data and the subject starts with [Test].`
					CM.toast('Test email sent')
				} catch (e) { state.value = 'error'; message.value = e.message }
			}
			return { emails, state, message, max, send }
		},
		template: `
		<Modal title="Send a test email" subtitle="Check how it looks in a real inbox before it goes to your audience." @close="$emit('close')" @submit="send">
			<Field label="Send to" :hint="'Up to ' + max + ' addresses. Separate with comma or Enter.'"><EmailChips v-model="emails" :max="max" /></Field>
			<div class="alert"><Ico name="info" /><div class="grow">The test is filled with sample lead data, the subject starts with <b>[Test]</b>, and nothing is recorded on any lead or campaign.</div></div>
			<div v-if="state === 'ok'" class="alert ok" role="status"><Ico name="check-circle" /><div class="grow">{{ message }}</div></div>
			<div v-if="state === 'error'" class="alert err" role="alert"><Ico name="alert" /><div class="grow">{{ message }}</div></div>
			<template #foot><Btn @click="$emit('close')">{{ state === 'ok' ? 'Done' : 'Cancel' }}</Btn><Btn variant="primary" icon="send" :loading="state === 'sending'" @click="send">{{ state === 'sending' ? 'Sending' : state === 'ok' ? 'Send again' : 'Send test' }}</Btn></template>
		</Modal>`,
	}

	// ------------------------------------------------------------------ small text editor for a builder block
	/** Bold, italic, underline, font, size, colour, alignment, links and lists for the text of one block. The toolbar
	 * belongs to the editor beside it and only ever acts on that editor's own selection. */
	C.MiniRich = {
		props: { modelValue: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const ed = ref(null); let saved = null; const linkOpen = ref(false); const link = reactive({ url: 'https://', text: '' })
			const sizes = CM.FONT_SIZES; const fonts = CM.FONTS
			onMounted(() => { ed.value.innerHTML = CM.sanitizeHtml(props.modelValue || ''); document.addEventListener('selectionchange', track) })
			onBeforeUnmount(() => { document.removeEventListener('selectionchange', track); saved = null })
			watch(() => props.modelValue, (v) => { if (ed.value && document.activeElement !== ed.value && v !== ed.value.innerHTML) ed.value.innerHTML = CM.sanitizeHtml(v || '') })
			function track() { const s = getSelection(); if (s.rangeCount && ed.value && ed.value.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange() }
			function restore() { ed.value.focus(); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved) } }
			const changed = () => emit('update:modelValue', ed.value.innerHTML)
			function cmd(c, v) { restore(); document.execCommand('styleWithCSS', false, true); document.execCommand(c, false, v == null ? null : v); changed(); track() }
			// execCommand only knows seven sizes: ask for the biggest, then turn those <font> tags into exact pixel sizes
			function setSize(px) {
				if (!px) return
				restore(); document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7')
				ed.value.querySelectorAll('font[size="7"]').forEach((f) => { const sp = document.createElement('span'); sp.style.fontSize = px + 'px'; while (f.firstChild) sp.appendChild(f.firstChild); f.replaceWith(sp) })
				changed(); track()
			}
			const setFont = (name) => name && cmd('fontName', CM.FONT_STACKS[name])
			const pick = (e, fn) => { fn(e.target.value); e.target.value = '' }
			function openLink() { track(); link.text = getSelection().toString(); link.url = 'https://'; linkOpen.value = true }
			function applyLink() { linkOpen.value = false; restore(); if (getSelection().toString()) document.execCommand('createLink', false, link.url); else document.execCommand('insertHTML', false, `<a href="${CM.escape(link.url)}">${CM.escape(link.text || link.url)}</a>`); changed(); track() }
			function paste(e) { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); changed() }
			const insertText = (t) => { restore(); document.execCommand('insertText', false, t); changed() }
			return { ed, changed, cmd, setSize, setFont, pick, openLink, applyLink, link, linkOpen, paste, insertText, sizes, fonts }
		},
		template: `
		<div class="mre">
			<div class="mre-bar" role="toolbar" aria-label="Text formatting">
				<button type="button" class="btn ghost icon sm" title="Bold" aria-label="Bold" @mousedown.prevent @click="cmd('bold')"><Ico name="bold" /></button>
				<button type="button" class="btn ghost icon sm" title="Italic" aria-label="Italic" @mousedown.prevent @click="cmd('italic')"><Ico name="italic" /></button>
				<button type="button" class="btn ghost icon sm" title="Underline" aria-label="Underline" @mousedown.prevent @click="cmd('underline')"><Ico name="underline" /></button>
				<span class="re-sep"></span>
				<select class="inp mre-sel" aria-label="Font" @change="pick($event, setFont)"><option value="">Font</option><option v-for="f in fonts" :key="f" :value="f">{{ f }}</option></select>
				<select class="inp mre-sel sm" aria-label="Font size" @change="pick($event, (v) => setSize(+v))"><option value="">Size</option><option v-for="s in sizes" :key="s" :value="s">{{ s }}</option></select>
				<label class="btn ghost icon sm mre-col" title="Text colour"><Ico name="palette" /><input type="color" aria-label="Text colour" @input="cmd('foreColor', $event.target.value)" /></label>
				<span class="re-sep"></span>
				<button type="button" class="btn ghost icon sm" title="Align left" aria-label="Align left" @mousedown.prevent @click="cmd('justifyLeft')"><Ico name="align-left" /></button>
				<button type="button" class="btn ghost icon sm" title="Centre" aria-label="Align centre" @mousedown.prevent @click="cmd('justifyCenter')"><Ico name="align-center" /></button>
				<button type="button" class="btn ghost icon sm" title="Align right" aria-label="Align right" @mousedown.prevent @click="cmd('justifyRight')"><Ico name="align-right" /></button>
				<span class="re-sep"></span>
				<button type="button" class="btn ghost icon sm" title="Bullet list" aria-label="Bullet list" @mousedown.prevent @click="cmd('insertUnorderedList')"><Ico name="list" /></button>
				<button type="button" class="btn ghost icon sm" title="Numbered list" aria-label="Numbered list" @mousedown.prevent @click="cmd('insertOrderedList')"><Ico name="list-ol" /></button>
				<button type="button" class="btn ghost icon sm" title="Link" aria-label="Insert link" @mousedown.prevent @click="openLink"><Ico name="link" /></button>
				<button type="button" class="btn ghost icon sm" title="Clear formatting" aria-label="Clear formatting" @mousedown.prevent @click="cmd('removeFormat')"><Ico name="x" /></button>
				<VarMenu label="" size="sm" @pick="insertText" />
			</div>
			<div ref="ed" class="mre-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Block text" @input="changed" @paste="paste"></div>
			<Modal v-if="linkOpen" size="sm" title="Insert link" top @close="linkOpen = false" @submit="applyLink"><Field label="Link address"><input class="inp" v-model="link.url" placeholder="https://" autofocus /></Field><Field v-if="!link.text" label="Text to show"><input class="inp" v-model="link.text" /></Field><template #foot><Btn @click="linkOpen = false">Cancel</Btn><Btn variant="primary" @click="applyLink">Insert</Btn></template></Modal>
		</div>`,
	}

	// ------------------------------------------------------------------ choose an image: upload, a file already in this site, or an address
	C.ImageDialog = {
		props: { title: { type: String, default: 'Insert image' } },
		emits: ['close', 'pick'],
		setup(props, { emit }) {
			const tab = ref('upload'); const files = ref([]); const url = ref(''); const alt = ref(''); const width = ref(100)
			const list = ref([]); const loading = ref(false); const q = ref(''); const error = ref('')
			const chosen = computed(() => (tab.value === 'upload' ? (files.value[0] && files.value[0].file_url) : tab.value === 'url' ? url.value.trim() : picked.value))
			const picked = ref('')
			async function load() { loading.value = true; error.value = ''; try { list.value = await CM.api('list_image_files', { search: q.value || undefined }) } catch (e) { error.value = e.message } finally { loading.value = false } }
			watch(tab, (t) => { if (t === 'files' && !list.value.length) load() })
			watch(q, CM.debounce(load, 300))
			const absolute = (u) => (u && u.startsWith('/') ? location.origin + u : u)
			function insert() { const u = absolute(chosen.value); if (!u) return; emit('pick', { url: u, alt: alt.value.trim(), width: Math.min(100, Math.max(10, +width.value || 100)) }) }
			return { tab, files, url, alt, width, list, loading, q, error, picked, chosen, insert, load }
		},
		template: `
		<Modal size="lg" :title="title" subtitle="It goes in at the cursor." top @close="$emit('close')" @submit="insert">
			<Seg v-model="tab" :options="[{ value: 'upload', label: 'Upload' }, { value: 'files', label: 'Files on this site' }, { value: 'url', label: 'Web address' }]" />
			<div style="margin-top:12px">
				<Uploader v-if="tab === 'upload'" v-model="files" :is-private="false" :multiple="false" accept="image/*" :max-mb="5" title="Drop an image or browse" hint="PNG, JPG or GIF up to 5 MB. Stored publicly so email apps can show it." />
				<template v-else-if="tab === 'files'">
					<Inp v-model="q" icon="search" placeholder="Search your images" clearable aria-label="Search images" />
					<div v-if="loading" class="small muted" style="margin-top:12px">Loading</div>
					<div v-else-if="error" class="alert err" style="margin-top:12px"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
					<div v-else-if="!list.length" class="small muted" style="margin-top:12px">No public images found. Upload one first.</div>
					<div v-else class="imgpick"><button v-for="f in list" :key="f.name" type="button" class="imgpick-i" :class="{ on: picked === f.file_url }" :title="f.file_name" @click="picked = f.file_url"><img :src="f.file_url" :alt="f.file_name" loading="lazy" /><span class="ellipsis">{{ f.file_name }}</span></button></div>
				</template>
				<Field v-else label="Image address"><input class="inp" v-model="url" placeholder="https://example.com/photo.png" autofocus /></Field>
			</div>
			<div class="row wrap" style="margin-top:14px"><Field label="Alt text (shown if the image is blocked)" class="grow"><input class="inp" v-model="alt" placeholder="Describe the image" /></Field><Field label="Width (%)"><input class="inp" style="width:90px" type="number" min="10" max="100" v-model.number="width" /></Field></div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" :disabled="!chosen" @click="insert">Insert image</Btn></template>
		</Modal>`,
	}

	// ------------------------------------------------------------------ visual builder
	/** One block on the canvas, with its own tools. A row passes its columns in through the slot. */
	C.BlockBox = {
		props: { b: Object, html: String, selected: Boolean, first: Boolean, last: Boolean },
		emits: ['select', 'move', 'dup', 'del', 'dragstart', 'dragend', 'dragover'],
		setup() { return { CM } },
		template: `
		<div class="blk" :class="{ sel: selected }" tabindex="0" role="button" :aria-label="CM.BLOCKS[b.type].label + ' block'" :aria-pressed="selected" @click.stop="$emit('select')" @keydown.enter.self.stop="$emit('select')" @keydown.delete.self.stop="$emit('del')" draggable="true" @dragstart.stop="$emit('dragstart', $event)" @dragend="$emit('dragend')" @dragover.stop="$emit('dragover', $event)">
			<slot><div class="blk-body" v-html="html"></div></slot>
			<div class="blk-tools" @click.stop><span class="blk-tag">{{ CM.BLOCKS[b.type].label }}</span><button type="button" title="Move up" aria-label="Move up" :disabled="first" @click="$emit('move', -1)"><Ico name="arrow-up" size="sm" /></button><button type="button" title="Move down" aria-label="Move down" :disabled="last" @click="$emit('move', 1)"><Ico name="arrow-down" size="sm" /></button><button type="button" title="Duplicate" aria-label="Duplicate" @click="$emit('dup')"><Ico name="copy" size="sm" /></button><button type="button" title="Delete" aria-label="Delete block" @click="$emit('del')"><Ico name="trash" size="sm" /></button></div>
		</div>`,
	}

	C.Builder = {
		props: { doc: Object },
		setup(props) {
			const root = ref(null); const panel = ref(null)
			// ONE thing is selected at a time: a block (selId) or an empty-able column of a row (colSel), never both
			const selId = ref(null); const colSel = ref(null)
			const drag = reactive({ active: '', key: '', i: -1 })
			const blocks = computed(() => props.doc.blocks)
			const found = computed(() => (selId.value ? CM.findBlock(blocks.value, selId.value) : null))
			const sel = computed(() => (found.value ? found.value.block : null))
			const groups = computed(() => { const g = {}; Object.entries(CM.BLOCKS).forEach(([k, v]) => { if (!v.hidden) (g[v.group] = g[v.group] || []).push({ type: k, ...v }) }); return Object.entries(g) })
			const keyOf = (rowId, col) => rowId + ':' + col
			function listFor(key) {
				if (key === 'root') return blocks.value
				const [rowId, col] = key.split(':'); const f = CM.findBlock(blocks.value, rowId)
				return f && f.block.type === 'row' ? f.block.props.cols[+col].blocks : null
			}
			// the canvas HTML of every block (rows' children too) is computed once per change, not on every hover / drag event
			const html = computed(() => { const out = {}; const walk = (list, inner) => list.forEach((b) => { if (b.type === 'row') (b.props.cols || []).slice(0, Math.min(CM.ROW_MAX, +b.props.count || 1)).forEach((c) => walk(c.blocks, true)); else out[b.id] = CM.renderBlockRow(b, props.doc.settings, true, inner) }); walk(props.doc.blocks, false); return out })
			const rowCols = (b) => Array.from({ length: Math.min(CM.ROW_MAX, Math.max(1, +b.props.count || 1)) }, (_x, i) => b.props.cols[i] || { blocks: [] })
			// a row can have 1 to 6 columns; every column keeps its own blocks, so removing the last one and adding it back is lossless
			function setCount(row, d) {
				const p = row.props; const n = Math.min(CM.ROW_MAX, Math.max(1, (+p.count || 1) + d))
				while (p.cols.length < CM.ROW_MAX) p.cols.push({ blocks: [] })
				p.count = n
			}
			const COLTYPES = ['heading', 'text', 'image', 'button', 'divider', 'spacer', 'social', 'html']
			function addInto(row, col, type) { const l = row.props.cols[col] && row.props.cols[col].blocks; if (l) add(type, { key: keyOf(row.id, col), i: l.length }) }

			function select(id) { selId.value = id; colSel.value = null }
			function selectCol(row, col) { selId.value = null; colSel.value = { row: row.id, col } }
			function clear() { selId.value = null; colSel.value = null; drag.active = ''; drag.i = -1 }
			// where a new block goes: into the chosen column, after the selected block (in its own list), or at the end
			function place() {
				if (colSel.value) { const key = keyOf(colSel.value.row, colSel.value.col); const l = listFor(key); if (l) return { key, i: l.length } }
				if (found.value) { const f = found.value; return { key: f.row ? keyOf(f.row.id, f.col) : 'root', i: f.index + 1 } }
				const last = blocks.value[blocks.value.length - 1]
				return { key: 'root', i: last && last.type === 'footer' ? blocks.value.length - 1 : blocks.value.length }
			}
			function add(type, at) {
				const where = at || place(); const list = listFor(where.key)
				if (!list) return
				const b = CM.newBlock(type)
				if (b.type === 'row' && where.key !== 'root') { CM.toast('A row cannot go inside another row: give the row more columns, or put the new row below it.', 'warn'); return }
				list.splice(where.i, 0, b); select(b.id)
			}
			function move(f, d) { const j = f.index + d; if (j < 0 || j >= f.list.length) return; const [b] = f.list.splice(f.index, 1); f.list.splice(j, 0, b) }
			function dup(f) { const c = CM.cloneBlock(f.list[f.index]); f.list.splice(f.index + 1, 0, c); select(c.id) }
			function del(f) { f.list.splice(f.index, 1); clear() }
			const at = (b) => CM.findBlock(blocks.value, b.id)

			function dragNew(e, type) { e.dataTransfer.setData('text/plain', 'new:' + type); e.dataTransfer.effectAllowed = 'copy'; drag.active = 'new' }
			function dragMove(e, b) { e.dataTransfer.setData('text/plain', 'move:' + b.id); e.dataTransfer.effectAllowed = 'move'; drag.active = 'move' }
			function dragOver(e, key, i) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); drag.key = key; drag.i = i + (e.clientY > r.top + r.height / 2 ? 1 : 0) }
			function overEnd(e, key) { e.preventDefault(); e.stopPropagation(); const l = listFor(key); drag.key = key; drag.i = l ? l.length : 0 }
			function drop(e) {
				e.preventDefault(); e.stopPropagation()
				const data = e.dataTransfer.getData('text/plain'); const key = drag.key || 'root'; let i = drag.i < 0 ? (listFor(key) || []).length : drag.i
				endDrag()
				if (data.startsWith('new:')) add(data.slice(4), { key, i })
				else if (data.startsWith('move:')) {
					const f = CM.findBlock(blocks.value, data.slice(5)); const target = listFor(key)
					if (!f || !target) return
					if (f.block.type === 'row' && key !== 'root') { CM.toast('A row cannot go inside another row: give the row more columns, or put the new row below it.', 'warn'); return }
					if (f.block.type === 'row' && key.startsWith(f.block.id + ':')) return // not into itself
					const [b] = f.list.splice(f.index, 1); if (f.list === target && f.index < i) i--
					target.splice(i, 0, b); select(b.id)
				}
			}
			function endDrag() { drag.key = ''; drag.i = -1; drag.active = '' }

			function insertVar(key, token) { const el = panel.value && panel.value.querySelector(`[data-key="${key}"]`); CM.insertAtCursor(el, token) }
			const schema = computed(() => (sel.value ? CM.BLOCKS[sel.value.type].schema || [] : []))
			function setColsCount() { const p = sel.value.props; p.count = +p.count; if (sel.value.type === 'columns') while (p.cols.length < p.count) p.cols.push({ heading: 'Heading', text: 'Text' }) }
			const addLink = () => sel.value.props.links.push({ network: 'Website', url: 'https://' })
			// a custom network's own icon: stored publicly (email apps must be able to load it)
			async function uploadIcon(link, ev) { const file = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!file) return; try { const r = await CM.upload(file, { isPrivate: false }); link.icon = r.file_url } catch (err) { CM.toast(err.message, 'err') } }
			const networks = CM.SOCIAL_NETWORKS
			// a text block saved before the formatting toolbar existed: give the toolbar its plain text as paragraphs
			watch(sel, (b) => { if (b && b.type === 'text' && !b.props.html && b.props.text) b.props.html = '<p>' + CM.escape(b.props.text).replace(/\r?\n/g, '<br>') + '</p>' })
			const colRow = computed(() => (colSel.value ? CM.findBlock(blocks.value, colSel.value.row) : null))
			const quick = ['heading', 'text', 'image', 'button']

			// Clicking anywhere outside the builder (the subject, the toolbar, the page) deselects; so does Escape.
			function outside(e) { if (root.value && !root.value.contains(e.target) && !(e.target.closest && e.target.closest('.overlay, .pop'))) clear() }
			function esc(e) { if (e.key === 'Escape' && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], .overlay'))) clear() }
			onMounted(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc) })
			onBeforeUnmount(() => { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc); const s = getSelection(); if (s && s.rangeCount && root.value && root.value.contains(s.anchorNode)) s.removeAllRanges() })
			return { root, panel, selId, colSel, drag, blocks, sel, found, groups, html, rowCols, keyOf, select, selectCol, clear, add, move, dup, del, at, dragNew, dragMove, dragOver, overEnd, drop, endDrag, insertVar, schema, setColsCount, addLink, uploadIcon, networks, colRow, quick, setCount, addInto, COLTYPES, CM, fonts: CM.FONTS }
		},
		template: `
		<div ref="root" class="bld">
			<aside class="bld-pal" aria-label="Blocks">
				<div class="lbl" style="padding:2px 4px 8px">Add a block</div>
				<template v-for="g in groups" :key="g[0]"><div class="pal-g">{{ g[0] }}</div>
					<button v-for="b in g[1]" :key="b.type" type="button" class="pal-i" draggable="true" :title="'Click to add, or drag into the email'" @click="add(b.type)" @dragstart="dragNew($event, b.type)" @dragend="endDrag"><Ico :name="b.icon" /><span>{{ b.label }}</span></button>
				</template>
			</aside>
			<section class="bld-cv" :style="{ background: doc.settings.bg }" @click.self="clear" @dragover.prevent @drop="drop">
				<div class="cv-card" :style="{ maxWidth: doc.settings.width + 'px', background: doc.settings.contentBg }" @click.self="clear">
					<template v-for="(b, i) in blocks" :key="b.id">
						<div v-if="drag.key === 'root' && drag.i === i && drag.active" class="drop-line"></div>
						<BlockBox :b="b" :html="html[b.id]" :selected="b.id === selId" :first="i === 0" :last="i === blocks.length - 1" @select="select(b.id)" @move="move(at(b), $event)" @dup="dup(at(b))" @del="del(at(b))" @dragstart="dragMove($event, b)" @dragend="endDrag" @dragover="dragOver($event, 'root', i)">
							<table v-if="b.type === 'row'" class="rowt" role="presentation"><tbody><tr>
								<td v-for="(col, ci) in rowCols(b)" :key="ci" class="rowcol" :class="{ target: colSel && colSel.row === b.id && colSel.col === ci, line: b.props.divider && ci > 0 }" :style="b.props.divider && ci > 0 ? { borderLeftColor: b.props.dividerColor } : null" @click.stop="selectCol(b, ci)" @dragover.prevent.stop="overEnd($event, keyOf(b.id, ci))" @drop="drop">
									<template v-for="(c, k) in col.blocks" :key="c.id">
										<div v-if="drag.key === keyOf(b.id, ci) && drag.i === k && drag.active" class="drop-line"></div>
										<BlockBox :b="c" :html="html[c.id]" :selected="c.id === selId" :first="k === 0" :last="k === col.blocks.length - 1" @select="select(c.id)" @move="move(at(c), $event)" @dup="dup(at(c))" @del="del(at(c))" @dragstart="dragMove($event, c)" @dragend="endDrag" @dragover="dragOver($event, keyOf(b.id, ci), k)" />
									</template>
									<div v-if="drag.key === keyOf(b.id, ci) && drag.i === col.blocks.length && drag.active" class="drop-line"></div>
									<div class="col-empty" :class="{ big: !col.blocks.length }" @click.stop><template v-if="!col.blocks.length"><span class="col-hint">Column {{ ci + 1 }}: choose the content</span><div class="col-types"><button v-for="t in COLTYPES" :key="t" type="button" class="col-type" @click.stop="addInto(b, ci, t)"><Ico :name="CM.BLOCKS[t].icon" size="sm" />{{ CM.BLOCKS[t].label }}</button></div></template><button v-else type="button" class="col-more" @click.stop="selectCol(b, ci)"><Ico name="plus" size="sm" />Add content</button></div>
								</td>
							</tr></tbody></table>
						</BlockBox>
					</template>
					<div v-if="drag.key === 'root' && drag.i === blocks.length && drag.active" class="drop-line"></div>
					<div v-if="!blocks.length" class="cv-empty" @dragover.prevent="drag.key = 'root'; drag.i = 0"><Ico name="plus" size="lg" /><b>Drag a block here</b><span>or click a block on the left</span></div>
					<div v-else class="cv-end" @dragover.prevent="overEnd($event, 'root')"></div>
				</div>
			</section>
			<aside ref="panel" class="bld-prop" aria-label="Block settings">
				<template v-if="sel">
					<div class="row" style="margin-bottom:12px"><div class="grow"><div class="lbl">Selected block</div><b style="font-size:15px">{{ CM.BLOCKS[sel.type].label }}</b></div><Btn size="sm" variant="ghost" icon="trash" aria-label="Delete block" @click="del(found)" /></div>
					<div class="col" style="gap:14px" :key="sel.id">
					<template v-for="f in schema" :key="f.key || f.type">
						<template v-if="f.type === 'rowcols'">
							<div class="col" style="gap:10px"><div class="lbl">Columns</div>
								<div class="row" style="gap:10px"><Btn size="sm" icon="minus" aria-label="Fewer columns" :disabled="+sel.props.count <= 1" @click="setCount(sel, -1)" /><b style="min-width:2ch;text-align:center">{{ sel.props.count }}</b><Btn size="sm" icon="plus" aria-label="More columns" :disabled="+sel.props.count >= CM.ROW_MAX" @click="setCount(sel, 1)" /><span class="small muted">1 to {{ CM.ROW_MAX }}</span></div>
								<div v-for="(c, ci) in rowCols(sel)" :key="ci" class="card pad" style="padding:10px;box-shadow:none"><div class="row" style="gap:8px"><b class="grow" style="font-size:13px">Column {{ ci + 1 }}</b><span class="small muted">{{ c.blocks.length }} block{{ c.blocks.length === 1 ? '' : 's' }}</span></div>
									<div class="row wrap" style="gap:4px;margin-top:8px"><button v-for="t in COLTYPES" :key="t" type="button" class="col-type" @click="addInto(sel, ci, t)"><Ico :name="CM.BLOCKS[t].icon" size="sm" />{{ CM.BLOCKS[t].label }}</button></div></div></div>
						</template>
						<template v-else-if="f.type === 'cols'"><div v-for="(c, ci) in sel.props.cols.slice(0, +sel.props.count)" :key="ci" class="card pad" style="padding:12px;box-shadow:none"><div class="lbl" style="margin-bottom:6px">Column {{ ci + 1 }}</div><input class="inp" v-model="c.heading" aria-label="Column heading" placeholder="Heading" style="margin-bottom:8px" /><textarea class="inp" v-model="c.text" aria-label="Column text" rows="3"></textarea></div></template>
						<template v-else-if="f.type === 'links'"><div class="col" style="gap:8px"><div class="lbl">Links</div><div v-for="(l, li) in sel.props.links" :key="li" class="col" style="gap:6px"><div class="row" style="gap:6px"><div style="width:132px"><Dd v-model="l.network" :options="networks" size="sm" searchable /></div><input class="inp grow" style="height:32px" v-model="l.url" aria-label="Link address" placeholder="https://" /><Btn size="sm" variant="ghost" icon="x" aria-label="Remove link" @click="sel.props.links.splice(li, 1)" /></div><div v-if="l.network === 'Custom'" class="row" style="gap:6px;padding-left:4px"><input class="inp" style="height:32px;width:110px" v-model="l.name" aria-label="Name (shown if the image is blocked)" placeholder="Name" /><input class="inp grow" style="height:32px" v-model="l.icon" aria-label="Icon image address" placeholder="Icon image address" /><label class="btn sm" style="cursor:pointer;margin:0">Upload<input type="file" accept="image/*" style="display:none" @change="uploadIcon(l, $event)" /></label></div></div><Btn size="sm" icon="plus" @click="addLink">Add link</Btn><div class="small muted">Not in the list? Choose Custom and add your own icon image.</div></div></template>
						<Field v-else :label="f.label" :hint="f.hint">
							<MiniRich v-if="f.type === 'rich'" :key="sel.id" v-model="sel.props[f.key]" />
							<div v-else-if="f.type === 'text'" class="row" style="gap:6px"><input class="inp grow" :data-key="f.key" v-model="sel.props[f.key]" :placeholder="f.placeholder" /><VarMenu v-if="f.vars" label="" size="sm" @pick="(t) => insertVar(f.key, t)" /></div>
							<template v-else-if="f.type === 'textarea'"><textarea class="inp" :data-key="f.key" rows="4" v-model="sel.props[f.key]"></textarea><div v-if="f.vars" style="margin-top:6px"><VarMenu @pick="(t) => insertVar(f.key, t)" /></div></template>
							<textarea v-else-if="f.type === 'code'" class="inp mono" :data-key="f.key" rows="8" spellcheck="false" v-model="sel.props[f.key]"></textarea>
							<Dd v-else-if="f.type === 'select'" v-model="sel.props[f.key]" :options="f.options" @change="f.key === 'count' && setColsCount()" />
							<ColorInp v-else-if="f.type === 'color'" v-model="sel.props[f.key]" />
							<input v-else-if="f.type === 'number'" class="inp" type="number" :min="f.min" :max="f.max" v-model.number="sel.props[f.key]" />
							<div v-else-if="f.type === 'switch'"><Switch v-model="sel.props[f.key]" :label="f.label" /></div>
							<div v-else-if="f.type === 'image'" class="col" style="gap:8px"><Uploader :model-value="sel.props.src ? [{ file_url: sel.props.src, file_name: sel.props.src.split('/').pop(), file_size: 0 }] : []" :is-private="false" :multiple="false" accept="image/*" :max-mb="5" title="Drop an image or browse" hint="PNG, JPG or GIF up to 5 MB. Stored publicly so email apps can show it." @update:model-value="(v) => (sel.props.src = v[0] ? v[0].file_url : '')" /><input class="inp" v-model="sel.props.src" placeholder="...or paste an image address (https://)" aria-label="Image address" /></div>
						</Field>
					</template></div>
				</template>
				<template v-else-if="colRow">
					<div class="lbl" style="margin-bottom:2px">Selected column</div><b style="font-size:15px">Column {{ colSel.col + 1 }} of {{ colRow.block.props.count }}</b>
					<p class="small muted" style="margin:6px 0 12px">Choose what goes in this column.</p>
					<div class="row wrap" style="gap:6px"><button v-for="t in COLTYPES" :key="t" type="button" class="col-type" @click="add(t)"><Ico :name="CM.BLOCKS[t].icon" size="sm" />{{ CM.BLOCKS[t].label }}</button></div>
					<div style="margin-top:14px"><Btn size="sm" @click="select(colRow.block.id)">Row settings</Btn></div>
				</template>
				<template v-else>
					<div class="lbl" style="margin-bottom:2px">Email style</div><p class="small muted" style="margin:0 0 14px">Click a block to edit it. These settings apply to the whole email.</p>
					<div class="col" style="gap:14px">
						<Field label="Page background"><ColorInp v-model="doc.settings.bg" /></Field>
						<Field label="Content background"><ColorInp v-model="doc.settings.contentBg" /></Field>
						<Field label="Content width (px)"><input class="inp" type="number" min="420" max="720" v-model.number="doc.settings.width" /></Field>
						<Field label="Font"><Dd v-model="doc.settings.font" :options="fonts" /></Field>
					</div>
				</template>
			</aside>
		</div>`,
	}

	// ------------------------------------------------------------------ HTML editor (code | preview)
	C.HtmlEditor = {
		props: { modelValue: String, subject: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const ta = ref(null); const pre = ref(null); const gutter = ref(null); const problems = ref(null); const view = ref('split'); const imgOpen = ref(false)
			const lines = computed(() => (props.modelValue || '').split('\n').length)
			// The coloured overlay re-parses the whole source. Small emails are coloured on every keystroke; a medium one trails
			// the typing by 120 ms (the textarea shows its own text meanwhile, so nothing typed is ever invisible); a huge
			// one (> 120 KB) is shown without colours. Typing stays instant at any size.
			const HL_MAX = 120000
			const colour = (t) => (t.length > HL_MAX ? CM.escape(t) + '\n' : CM.highlightHtml(t))
			const hl = ref(colour(props.modelValue || '')); const stale = ref(false)
			let hlTimer = 0
			watch(() => props.modelValue, (v) => {
				const t = v || ''; clearTimeout(hlTimer)
				if (t.length <= 12000 || t.length > HL_MAX) { hl.value = colour(t); stale.value = false } else { stale.value = true; hlTimer = setTimeout(() => { hl.value = colour(t); stale.value = false }, 120) }
			})
			onBeforeUnmount(() => clearTimeout(hlTimer))
			// one text node for the line numbers instead of one element per line (a 15 000 line email made 15 000 elements)
			const nums = computed(() => { const n = lines.value; let out = '1'; for (let i = 2; i <= n; i++) out += '\n' + i; return out })
			const set = (v) => emit('update:modelValue', v)
			function sync() { if (!ta.value) return; pre.value.scrollTop = ta.value.scrollTop; pre.value.scrollLeft = ta.value.scrollLeft; gutter.value.scrollTop = ta.value.scrollTop }
			function key(e) {
				if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); set(t.value) }
			}
			function format() { set(CM.formatHtml(props.modelValue || '')); problems.value = null; CM.toast('Formatted') }
			async function validate() {
				const list = CM.validateHtml(props.modelValue || '')
				let unknown = []
				try { unknown = (await CM.api('render_email_preview', { subject: props.subject || '', html: props.modelValue || '' })).unknown } catch (e) { /* offline */ }
				if (unknown.length) list.push('Unknown variable(s): ' + unknown.join(', ') + '. Use the Insert variable list.')
				problems.value = list
			}
			const insert = (t) => { CM.insertAtCursor(ta.value, t) }
			// the picture goes in where the cursor was (the textarea keeps its caret while the dialog is open)
			function insertImage(p) {
				imgOpen.value = false
				const w = p.width < 100 ? ` width="${Math.round(536 * p.width / 100)}"` : ''
				CM.insertAtCursor(ta.value, `<img src="${CM.escape(p.url)}" alt="${CM.escape(p.alt)}"${w} style="display:block;max-width:100%;height:auto;border:0">`)
			}
			const render = CM.useRender(() => props.subject, () => props.modelValue)
			return { imgOpen, insertImage, ta, pre, gutter, problems, view, lines, nums, stale, hl, sync, key, format, validate, insert, render, set, fromName: computed(() => CM.shared.config && CM.shared.config.sender_name), fromEmail: computed(() => CM.shared.config && CM.shared.config.sender_email) }
		},
		template: `
		<div class="he">
			<div class="he-bar"><Btn size="sm" icon="sparkles" @click="format">Format</Btn><Btn size="sm" icon="check-circle" @click="validate">Validate</Btn><VarMenu @pick="insert" /><Btn size="sm" icon="image" @click="imgOpen = true">Image</Btn><span class="grow"></span><Seg v-model="view" :options="[{ value: 'code', label: 'Code' }, { value: 'split', label: 'Split' }, { value: 'preview', label: 'Preview' }]" /></div>
			<div v-if="problems" class="alert" :class="problems.length ? 'warn' : 'ok'" role="status" style="margin-bottom:10px"><Ico :name="problems.length ? 'alert' : 'check-circle'" /><div class="grow"><b v-if="!problems.length">Looks good.</b> No problems found.<template v-if="problems.length"><div v-for="p in problems" :key="p">{{ p }}</div></template></div><Btn size="sm" variant="ghost" icon="x" aria-label="Dismiss" @click="problems = null" /></div>
			<div class="he-split" :class="view">
				<div v-show="view !== 'preview'" class="he-code"><div ref="gutter" class="he-gutter" aria-hidden="true"><div v-for="n in lines" :key="n">{{ n }}</div></div><div class="he-ed"><pre ref="pre" class="he-hl" aria-hidden="true" v-html="hl"></pre><textarea ref="ta" class="he-ta" spellcheck="false" wrap="off" aria-label="HTML code" :value="modelValue" @input="set($event.target.value)" @scroll="sync" @keydown="key"></textarea></div></div>
				<div v-show="view !== 'code'" class="he-pv"><EmailPreview :subject="render.subject || subject" :html="render.html" :from-name="fromName" :from-email="fromEmail" :loading="render.loading" note="Filled with sample data" /></div>
			</div>
			<ImageDialog v-if="imgOpen" @close="imgOpen = false" @pick="insertImage" />
		</div>`,
	}

	// ------------------------------------------------------------------ rich text editor
	C.RichEditor = {
		props: { modelValue: String, subject: String },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const ed = ref(null); let saved = null; const linkOpen = ref(false); const link = reactive({ url: 'https://', text: '' }); const imgOpen = ref(false); const img = reactive({ url: '', files: [] })
			onMounted(() => { ed.value.innerHTML = CM.sanitizeHtml(props.modelValue || ''); document.addEventListener('selectionchange', track) })
			onBeforeUnmount(() => document.removeEventListener('selectionchange', track))
			watch(() => props.modelValue, (v) => { if (ed.value && v !== ed.value.innerHTML) ed.value.innerHTML = CM.sanitizeHtml(v || '') })
			function track() { const s = getSelection(); if (s.rangeCount && ed.value && ed.value.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange() }
			function restore() { ed.value.focus(); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved) } }
			const changed = () => emit('update:modelValue', ed.value.innerHTML)
			function cmd(c, v) { restore(); document.execCommand(c, false, v || null); changed() }
			function insertText(t) { restore(); document.execCommand('insertText', false, t); changed() }
			function openLink() { track(); link.text = getSelection().toString(); link.url = 'https://'; linkOpen.value = true }
			function applyLink() { linkOpen.value = false; restore(); if (getSelection().toString()) document.execCommand('createLink', false, link.url); else document.execCommand('insertHTML', false, `<a href="${CM.escape(link.url)}">${CM.escape(link.text || link.url)}</a>`); changed() }
			function openImg() { track(); img.url = ''; img.files = []; imgOpen.value = true }
			function applyImg() { const u = img.files[0] ? img.files[0].file_url : img.url; imgOpen.value = false; if (!u) return; restore(); document.execCommand('insertImage', false, u); changed() }
			function paste(e) { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t) }
			const tools = [
				['bold', 'bold', 'Bold'], ['italic', 'italic', 'Italic'], ['underline', 'underline', 'Underline'], ['|'],
				['formatBlock:h1', 'H1', 'Heading'], ['formatBlock:h2', 'H2', 'Subheading'], ['formatBlock:p', 'P', 'Paragraph'], ['|'],
				['insertUnorderedList', 'list', 'Bullet list'], ['insertOrderedList', 'list-ol', 'Numbered list'], ['|'],
			]
			const run = (t) => { const [c, v] = t[0].split(':'); cmd(c, v ? '<' + v + '>' : null) }
			const render = CM.useRender(() => props.subject, () => CM.richToEmail(props.modelValue || ''))
			const show = ref(true)
			return { ed, changed, cmd, tools, run, openLink, openImg, applyLink, applyImg, link, img, linkOpen, imgOpen, paste, insertText, render, show, fromName: computed(() => CM.shared.config && CM.shared.config.sender_name), fromEmail: computed(() => CM.shared.config && CM.shared.config.sender_email) }
		},
		template: `
		<div class="re">
			<div class="re-bar" role="toolbar" aria-label="Formatting">
				<template v-for="(t, i) in tools" :key="i"><span v-if="t[0] === '|'" class="re-sep"></span><button v-else type="button" class="btn ghost icon sm" :title="t[2]" :aria-label="t[2]" @mousedown.prevent @click="run(t)"><b v-if="/^(H1|H2|P)$/.test(t[1])" style="font-size:12px">{{ t[1] }}</b><Ico v-else :name="t[1]" /></button></template>
				<button type="button" class="btn ghost icon sm" title="Link" aria-label="Insert link" @mousedown.prevent @click="openLink"><Ico name="link" /></button>
				<button type="button" class="btn ghost icon sm" title="Image" aria-label="Insert image" @mousedown.prevent @click="openImg"><Ico name="image" /></button>
				<button type="button" class="btn ghost icon sm" title="Undo" aria-label="Undo" @mousedown.prevent @click="cmd('undo')"><Ico name="undo" /></button>
				<button type="button" class="btn ghost icon sm" title="Clear formatting" aria-label="Clear formatting" @mousedown.prevent @click="cmd('removeFormat')"><Ico name="x" /></button>
				<span class="re-sep"></span><VarMenu @pick="insertText" /><span class="grow"></span><Seg v-model="show" :options="[{ value: true, label: 'Preview on' }, { value: false, label: 'Off' }]" />
			</div>
			<div class="re-split" :class="{ one: !show }">
				<div class="re-page"><div ref="ed" class="re-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Email content" @input="changed" @paste="paste"></div></div>
				<div v-if="show" class="he-pv"><EmailPreview :subject="render.subject || subject" :html="render.html" :from-name="fromName" :from-email="fromEmail" :loading="render.loading" note="Filled with sample data" /></div>
			</div>
			<Modal v-if="linkOpen" size="sm" title="Insert link" top @close="linkOpen = false" @submit="applyLink"><Field label="Link address"><input class="inp" v-model="link.url" placeholder="https://" autofocus /></Field><Field v-if="!link.text" label="Text to show"><input class="inp" v-model="link.text" /></Field><template #foot><Btn @click="linkOpen = false">Cancel</Btn><Btn variant="primary" @click="applyLink">Insert</Btn></template></Modal>
			<Modal v-if="imgOpen" size="sm" title="Insert image" top @close="imgOpen = false" @submit="applyImg"><Uploader v-model="img.files" :is-private="false" :multiple="false" accept="image/*" :max-mb="5" title="Drop an image or browse" hint="Stored publicly so email apps can show it." /><Field label="...or an image address"><input class="inp" v-model="img.url" placeholder="https://" /></Field><template #foot><Btn @click="imgOpen = false">Cancel</Btn><Btn variant="primary" @click="applyImg">Insert</Btn></template></Modal>
		</div>`,
	}
})()
