/* Lead assignment (System Managers only). One page with three things to do - give new leads to people automatically, give
 * the leads you already have to people, move one person's leads to others - each a short form that reads like a sentence.
 * The server does all the work and all the checking; this only asks and shows. */
(() => {
	const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue
	const CM = window.CM
	const C = CM.components
	const V = CM.views
	const A = CM.audience

	const HOW = [
		{ value: 'Round robin', label: 'Take turns', hint: 'Each new lead goes to the next person in the list.' },
		{ value: 'Least workload', label: 'Least busy', hint: 'Each lead goes to whoever has the fewest open leads and follow-ups to do.' },
		{ value: 'All of them', label: 'Everyone together', hint: 'Everyone gets every lead and can work it. The first person is the owner.' },
	]
	const HOW_TEXT = { 'Round robin': 'taking turns', 'Least workload': 'to whoever is least busy', 'All of them': 'all together' }

	const state = reactive({ people: [], loaded: false })
	async function loadPeople(force) {
		if (state.loaded && !force) return
		try { state.people = await CM.apiA('list_people', {}); state.loaded = true } catch (e) { CM.toast(e.message, 'err') }
	}
	const nameOf = (u) => {
		const p = state.people.find((x) => x.name === u)
		if (!p) return u
		// two people can share a name: tell them apart by their address
		return state.people.filter((x) => x.full_name === p.full_name).length > 1 ? `${p.full_name} (${p.name})` : p.full_name || u
	}
	const join = (list) => { const n = list.map(nameOf); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] }
	const fields = computed(() => (CM.shared.fields ? CM.shared.fields.fields : []))
	const asText = (r) => A.describe(r, fields.value)
	const plural = (n, w) => `${CM.num(n)} ${w}${n === 1 ? '' : 's'}`

	// ------------------------------------------------------------------ small pieces
	/** People as chips, with one "Add person" button that opens the list. The order picked is kept (the first is the owner). */
	C.PeopleField = {
		props: { modelValue: { type: Array, default: () => [] }, placeholder: { type: String, default: 'Add a person' } },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const open = ref(false); const q = ref(''); const root = ref(null)
			const free = computed(() => state.people.filter((p) => !props.modelValue.includes(p.name) && (!q.value || (p.full_name + p.name).toLowerCase().includes(q.value.toLowerCase()))))
			const add = (u) => { emit('update:modelValue', [...props.modelValue, u]); q.value = '' }
			const remove = (u) => emit('update:modelValue', props.modelValue.filter((x) => x !== u))
			const outside = (e) => { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
			onMounted(() => { loadPeople(); document.addEventListener('mousedown', outside) })
			onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
			const searchBox = ref(null)
			watch(open, (v) => { if (v) nextTick(() => { const i = root.value && root.value.querySelector('.pf-pop input'); if (i) i.focus() }) })
			const emptyText = computed(() => (!state.people.length ? 'Loading...' : q.value.trim() ? 'No one matches "' + q.value.trim() + '".' : 'No one else to add.'))
			return { open, q, free, add, remove, root, nameOf, emptyText, searchBox }
		},
		template: `
		<div ref="root" class="pf">
			<div class="pf-chips">
				<span v-for="u in modelValue" :key="u" class="pf-chip"><span class="pf-av">{{ nameOf(u)[0] }}</span>{{ nameOf(u) }}<button type="button" :aria-label="'Remove ' + nameOf(u)" @click="remove(u)"><Ico name="x" size="sm" /></button></span>
				<button type="button" class="pf-add" :aria-expanded="open" @click="open = !open"><Ico name="plus" size="sm" />{{ modelValue.length ? 'Add another' : placeholder }}</button>
			</div>
			<div v-if="open" class="pf-pop"><Inp v-model="q" icon="search" placeholder="Search people" clearable aria-label="Search people" autofocus />
				<div class="pf-list"><button v-for="p in free" :key="p.name" type="button" class="pf-row" @click="add(p.name)"><span class="pf-av">{{ (p.full_name || p.name)[0] }}</span><span class="grow ellipsis">{{ p.full_name }}<span class="small muted pf-mail" v-if="p.name !== p.full_name">{{ p.name }}</span></span><span class="small muted">{{ p.load }} to do</span></button><div v-if="!free.length" class="small muted" style="padding:8px">{{ emptyText }}</div></div></div>
		</div>`,
	}

	/** How several people share leads: only asked when there is more than one. */
	C.HowField = {
		props: { modelValue: String, count: Number },
		emits: ['update:modelValue'],
		setup() { return { HOW } },
		template: `
		<div v-if="count > 1" class="how"><div class="how-seg" role="radiogroup" aria-label="How to share"><button v-for="h in HOW" :key="h.value" type="button" role="radio" :aria-checked="modelValue === h.value" :class="{ on: modelValue === h.value }" @click="$emit('update:modelValue', h.value)">{{ h.label }}</button></div><div class="small muted">{{ (HOW.find((h) => h.value === modelValue) || {}).hint }}</div></div>`,
	}

	/** The conditions. One row to start with; "all / any" only appears once there are two. */
	C.WhenField = {
		props: { rules: Array, matchMode: String },
		emits: ['update:matchMode'],
		setup(props) {
			onMounted(() => { CM.loadShared().then(() => { if (!props.rules.length) props.rules.push({ id: CM.uid(), field: '', op: '=', value: '' }) }) })
			return {}
		},
		template: `
		<div><FilterBuilder incl :rules="rules" :joiner="matchMode === 'Any condition' ? 'or' : 'and'" />
			<div v-if="rules.length > 1" class="row" style="gap:8px;margin-top:10px"><span class="small muted">A lead matches when</span><Seg :model-value="matchMode" :options="[{ value: 'All conditions', label: 'all of these are true' }, { value: 'Any condition', label: 'any one is true' }]" @update:model-value="$emit('update:matchMode', $event)" /></div></div>`,
	}

	const sample = (rows) => (rows && rows.length ? `<table class="tbl small"><thead><tr><th>Lead</th><th>Status</th><th>Now with</th></tr></thead><tbody>${rows.map((l) => `<tr><td>${CM.escape(l.lead_name || l.name)}</td><td>${CM.escape(l.status || '')}</td><td>${l.lead_owner ? CM.escape(nameOf(l.lead_owner)) : 'No one'}</td></tr>`).join('')}</tbody></table>` : '')
	CM.ICONS['move-people'] = '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'
	C.StepHead = { props: { n: [Number, String], title: String }, template: `<div class="step-h"><span class="step-n">{{ n }}</span><b>{{ title }}</b></div>` }
	const ready = (rules) => rules.length && A.ready({ mode: 'CRM Filters', rules })
	const doneText = (res, verb) => (res.queued ? `${verb} ${plural(res.count, 'lead')} in the background. See Recent activity when it finishes.` : `${plural(res.assigned, 'lead')} ${verb === 'Moving' ? 'moved' : 'assigned'}`)

	/** A form that opens inside the page, under the three buttons (not a pop-up). */
	C.Panel = {
		props: { title: String, subtitle: String },
		emits: ['close'],
		setup() { const el = ref(null); onMounted(() => { if (el.value && el.value.scrollIntoView) el.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }); return { el } },
		template: `<section ref="el" class="asg-panel"><div v-if="title || subtitle" class="asg-panel-h"><div class="grow"><b>{{ title }}</b><div class="small muted" v-if="subtitle">{{ subtitle }}</div></div><button type="button" class="btn ghost icon sm" aria-label="Close" @click="$emit('close')"><Ico name="x" /></button></div><div class="asg-panel-b"><slot /></div><div v-if="$slots.foot" class="asg-panel-f"><slot name="foot" /></div></section>`,
	}

	// ------------------------------------------------------------------ 1. a rule for new leads
	C.RuleEditor = {
		props: { rule: Object },
		emits: ['close', 'saved'],
		setup(props, { emit }) {
			const r = props.rule || {}
			const f = reactive({ rule_name: r.name || '', match_mode: r.match_mode || 'All conditions', rules: A.rulesFromJson(r.conditions || []), assignees: [...(r.assignees || [])], distribution: r.distribution || 'Round robin', existing: !r.name })
			const busy = ref(false); const error = ref(''); const pre = ref(null); const named = ref(!!r.name)
			const ok = computed(() => ready(f.rules) && f.assignees.length)
			const payload = () => ({ rule_name: f.rule_name.trim(), match_mode: f.match_mode, conditions: A.rulesToJson(f.rules), assignees: f.assignees, distribution: f.distribution, enabled: r.name ? r.enabled : 1 })
			const sentence = computed(() => { try { return JSON.parse(A.rulesToJson(f.rules.filter((x) => x.field))).map(asText).join(f.match_mode === 'Any condition' ? ' or ' : ' and ') } catch (e) { return '' } })
			// the rule's name is made from what it says, until someone types their own
			watch(() => sentence.value + join(f.assignees), () => { if (!named.value && !props.rule) f.rule_name = sentence.value ? (sentence.value.length > 40 ? sentence.value.slice(0, 40) + '...' : sentence.value) + (f.assignees.length ? ' to ' + f.assignees.map(nameOf).slice(0, 2).join(' + ') : '') : '' })
			const count = CM.debounce(async () => {
				if (!ok.value) { pre.value = null; return }
				try { pre.value = await CM.apiA('preview_manual', { data: { conditions: A.rulesToJson(f.rules), match_mode: f.match_mode, assignees: f.assignees, distribution: f.distribution, scope: 'unassigned' } }) } catch (e) { pre.value = null }
			}, 500)
			watch(() => [JSON.stringify(f.rules), f.match_mode, f.assignees.join()], count, { immediate: true })
			async function save(confirm) {
				error.value = ''
				if (!ok.value) { error.value = 'Say which leads, and who gets them.'; return }
				if (!f.rule_name.trim()) { error.value = 'Give the rule a name.'; return }
				busy.value = true
				try {
					const res = await CM.apiA('save_rule', { data: payload(), name: props.rule ? props.rule.name : undefined, confirm: confirm ? 1 : 0 })
					if (res.needs_confirm) {
						busy.value = false
						const lines = res.clashes.map((c) => `"${c.rule}" (${join(c.people)})` + (c.existing_leads ? `, ${plural(c.existing_leads, 'lead')} match both now` : ''))
						if (await CM.confirm({ title: 'This overlaps another rule', message: 'A lead that fits both rules goes to the people of both: ' + lines.join('; ') + '.', confirmText: 'Yes, assign to all of them' })) return save(true)
						return
					}
					CM.toast('Rule saved')
					if (f.existing && pre.value && pre.value.count) emit('saved', { run: res.name })
					else emit('saved', {})
				} catch (e) { error.value = e.message } finally { busy.value = false }
			}
			return { f, busy, error, pre, ok, save, sentence, named, isEdit: !!props.rule, plural, join, HOW_TEXT, CM }
		},
		template: `
		<Panel :title="isEdit ? 'Edit rule' : 'New rule for incoming leads'" @close="$emit('close')">
			<StepHead n="1" title="When a new lead comes in and..." /><WhenField :rules="f.rules" v-model:match-mode="f.match_mode" />
			<StepHead n="2" title="Give it to" /><PeopleField v-model="f.assignees" placeholder="Choose who gets these leads" />
			<HowField v-model="f.distribution" :count="f.assignees.length" />
			<div v-if="ok" class="sumbox"><Ico name="check-circle" /><div class="grow">New leads where <b>{{ sentence }}</b> go to <b>{{ join(f.assignees) }}</b><template v-if="f.assignees.length > 1">, {{ HOW_TEXT[f.distribution] }}</template>.<template v-if="pre"> {{ plural(pre.count, 'lead') }} without an owner match today.</template></div></div>
			<label v-if="ok && pre && pre.count && !isEdit" class="check" style="margin-top:12px"><input type="checkbox" v-model="f.existing" /><span>Also give the {{ plural(pre.count, 'matching lead') }} that have no owner to them now</span></label>
			<Field label="Rule name" style="margin-top:14px"><input class="inp" v-model="f.rule_name" :readonly="isEdit" @input="named = true" placeholder="Name this rule" /></Field>
			<div v-if="error" class="alert err" role="alert" style="margin-top:12px"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="check" :loading="busy" :disabled="!ok" @click="save(false)">{{ isEdit ? 'Save' : 'Create rule' }}</Btn></template>
		</Panel>`,
	}

	// ------------------------------------------------------------------ run an existing rule on the leads that exist
	C.RuleRun = {
		props: { rule: Object },
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const takeOver = ref(false); const pre = ref(null); const busy = ref(false); const error = ref('')
			const scope = computed(() => (takeOver.value ? 'all' : 'unassigned'))
			async function load() { pre.value = null; try { pre.value = await CM.apiA('preview_rule', { name: props.rule.name, scope: scope.value }) } catch (e) { error.value = e.message } }
			onMounted(() => { loadPeople(); load() }); watch(scope, load)
			async function run(confirm) {
				busy.value = true; error.value = ''
				try {
					const res = await CM.apiA('run_rule', { name: props.rule.name, scope: scope.value, confirm: confirm ? 1 : 0 })
					if (res.needs_confirm) {
						busy.value = false
						const lines = res.clashes.map((c) => `${plural(c.leads, 'lead')} also match "${c.rule}" (${join(c.people)})`)
						if (await CM.confirm({ title: 'Some leads fit two rules', message: lines.join('; ') + '. They go to the people of both rules.', confirmText: 'Yes, assign to all of them' })) return run(true)
						return
					}
					CM.toast(doneText(res, 'Assigning')); emit('done')
				} catch (e) { error.value = e.message } finally { busy.value = false }
			}
			return { takeOver, pre, busy, error, run, join, plural, sample, CM }
		},
		template: `
		<Panel :title="'Give existing leads to ' + (pre ? join(pre.people) : '...')" :subtitle="'Rule: ' + rule.name" @close="$emit('close')">
			<p v-if="!pre && !error" class="muted">Counting</p>
			<template v-if="pre"><div class="bignum"><b>{{ CM.num(pre.count) }}</b><span>{{ pre.count === 1 ? 'lead matches' : 'leads match' }}</span></div>
				<div v-html="sample(pre.sample)"></div>
				<label class="check" style="margin-top:12px"><input type="checkbox" v-model="takeOver" /><span>Include leads that already have an owner (they move to the new people)</span></label>
				<div v-if="pre.also_matched_by.length" class="alert warn" style="margin-top:10px"><Ico name="alert" /><div class="grow">Some of these also match another rule; you will be asked before they go to both.</div></div></template>
			<div v-if="error" class="alert err" style="margin-top:10px"><Ico name="alert" /><div class="grow">{{ error }}</div></div>
			<template #foot><Btn @click="$emit('close')">Cancel</Btn><Btn variant="primary" icon="users" :loading="busy" :disabled="!pre || !pre.count" @click="run(false)">Assign {{ pre ? plural(pre.count, 'lead') : '' }}</Btn></template>
		</Panel>`,
	}

	// How many leads: all of them, a number, or a number for each person ("I'll set the numbers")
	const newAmount = () => reactive({ mode: 'all', limit: 10, counts: {} })
	const amountLimit = (a) => (a.mode === 'number' ? Math.max(0, parseInt(a.limit, 10) || 0) : 0)
	const amountCounts = (a, people) => (a.mode === 'each' && people.length > 1 ? Object.fromEntries(people.map((u) => [u, Math.max(0, parseInt(a.counts[u], 10) || 0)])) : null)
	const eachTotal = (a, people) => people.reduce((n, u) => n + Math.max(0, parseInt(a.counts[u], 10) || 0), 0)
	const amountKey = (a) => a.mode + a.limit + JSON.stringify(a.counts)
	const initials = (u) => nameOf(u).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

	/** All leads / a certain number (the number of people is not asked here: that is "I'll set the numbers"). */
	C.AmountField = {
		props: { amount: Object, available: Number, noun: { type: String, default: 'leads' } },
		setup() { return { CM } },
		template: `
		<div class="row wrap" style="gap:10px;align-items:center">
<div style="min-width:200px"><Dd v-model="amount.mode" :options="[{ value: 'all', label: 'All ' + noun }, { value: 'number', label: 'A certain number' }]" aria-label="How many leads" /></div>
			<template v-if="amount.mode === 'number'"><input class="inp limit-n" type="number" min="1" :max="available || null" v-model="amount.limit" aria-label="How many leads" /><span class="small muted" v-if="available != null">of {{ CM.num(available) }}</span></template>
		</div>`,
	}

	/** How several people share the leads, as cards: take turns, least busy, everyone together, or "I'll set the numbers". Asked only when there is more than one person. */
	C.ShareCards = {
		props: { modelValue: String, amount: Object, count: Number },
		emits: ['update:modelValue'],
		setup(props, { emit }) {
			const cards = [
				{ value: 'Round robin', label: 'Take turns', hint: 'Each lead goes to the next person in the list.', icon: 'refresh' },
				{ value: 'Least workload', label: 'Least busy', hint: 'Each lead goes to whoever has the fewest open leads and follow-ups to do.', icon: 'users' },
				{ value: 'All of them', label: 'Everyone together', hint: 'Everyone gets every lead and can work it. The first person is the owner.', icon: 'users' },
				{ value: 'each', label: "I'll set the numbers", hint: 'Say how many leads each person gets, like 10 for one and 20 for another.', icon: 'edit' },
			]
			const on = (v) => (props.amount.mode === 'each' ? v === 'each' : v === props.modelValue)
			function pick(v) {
				if (v === 'each') { props.amount.mode = 'each'; return }
				if (props.amount.mode === 'each') props.amount.mode = 'all'
				emit('update:modelValue', v)
			}
			return { cards, on, pick }
		},
		template: `<div v-if="count > 1" class="share" role="radiogroup" aria-label="How are they shared"><button v-for="c in cards" :key="c.value" type="button" role="radio" class="share-c" :class="{ on: on(c.value) }" :aria-checked="on(c.value)" @click="pick(c.value)"><span class="share-i"><Ico :name="c.icon" /></span><span class="share-t"><b>{{ c.label }}</b><span>{{ c.hint }}</span></span><Ico v-if="on(c.value)" name="check" class="share-ok" /></button></div>`,
	}

	/** One number per person, with "Split evenly" and how many are left. */
	C.CountList = {
		props: { amount: Object, people: Array, available: Number },
		setup(props) {
			const total = computed(() => props.available || 0)
			const given = computed(() => props.people.reduce((n, u) => n + Math.max(0, parseInt(props.amount.counts[u], 10) || 0), 0))
			function even() { const n = props.people.length; props.people.forEach((u, i) => { props.amount.counts[u] = Math.floor(total.value / n) + (i < total.value % n ? 1 : 0) }) }
			return { given, total, even, CM, nameOf, initials }
		},
		template: `
		<div v-if="amount.mode === 'each' && people.length > 1" class="cl">
			<div class="cl-list"><div v-for="u in people" :key="u" class="cl-row"><span class="cl-av">{{ initials(u) }}</span><span class="grow">{{ nameOf(u) }}</span><input class="inp cl-n" type="number" min="0" v-model="amount.counts[u]" :aria-label="'Leads for ' + nameOf(u)" /></div></div>
			<div class="row" style="gap:12px;align-items:center;margin-top:12px"><button type="button" class="btn" @click="even">Split evenly</button><span class="small" :class="given > total ? 'err-text' : 'muted'">{{ CM.num(given) }} of {{ CM.num(total) }} given out<template v-if="given <= total">, {{ CM.num(total - given) }} will stay where they are</template><template v-else> (more than there are)</template></span></div>
		</div>`,
	}

	// ------------------------------------------------------------------ 2. give leads that exist to people, now
	C.AssignNow = {
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const m = reactive({ rules: [], match_mode: 'All conditions', assignees: [], distribution: 'Round robin', takeOver: false })
			const amt = newAmount(); const pre = ref(null); const busy = ref(false)
			const ok = computed(() => ready(m.rules) && m.assignees.length)
			const data = () => ({ conditions: A.rulesToJson(m.rules), match_mode: m.match_mode, assignees: m.assignees, distribution: m.distribution, scope: m.takeOver ? 'all' : 'unassigned', limit: amountLimit(amt), counts: amountCounts(amt, m.assignees) })
			const count = CM.debounce(async () => { if (!ok.value) { pre.value = null; return } try { pre.value = await CM.apiA('preview_manual', { data: data() }) } catch (e) { pre.value = null } }, 500)
			watch(() => [JSON.stringify(m.rules), m.match_mode, m.assignees.join(), m.takeOver, amountKey(amt)], count)
			async function go() {
				if (!(await CM.confirm({ title: `Give ${plural(pre.value.count, 'lead')} to ${join(m.assignees)}?`, message: 'Each person gets a CRM notification.', confirmText: 'Assign' }))) return
				busy.value = true
				try { const res = await CM.apiA('assign_manual', { data: data() }); CM.toast(doneText(res, 'Assigning')); emit('done') } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			const avail = computed(() => (pre.value ? (pre.value.available ?? pre.value.count) : null))
			const over = computed(() => amt.mode === 'each' && m.assignees.length > 1 && pre.value && eachTotal(amt, m.assignees) > avail.value)
			return { m, amt, pre, avail, over, busy, ok, go, plural, join, sample, CM }
		},
		template: `
		<div class="mv">
			<div class="mv-main">
				<section class="mv-card"><StepHead n="1" title="Which leads?" /><p class="small muted">Leads that fit these conditions.</p><WhenField :rules="m.rules" v-model:match-mode="m.match_mode" /></section>
				<section class="mv-card"><StepHead n="2" title="Give them to" /><p class="small muted">Choose who gets them.</p><PeopleField v-model="m.assignees" placeholder="Choose who gets these leads" /></section>
				<section v-if="m.assignees.length > 1" class="mv-card"><StepHead n="3" title="How are they shared?" /><ShareCards v-model="m.distribution" :amount="amt" :count="m.assignees.length" /><CountList :amount="amt" :people="m.assignees" :available="avail" /></section>
			</div>
			<aside class="mv-side">
				<section class="mv-card"><h3 class="mv-h">Leads that will be given</h3>
					<Seg v-model="m.takeOver" :options="[{ value: false, label: 'No owner yet' }, { value: true, label: 'Every lead' }]" />
					<div class="mv-big"><b>{{ pre ? CM.num(pre.count) : 0 }}</b> <span>{{ pre && pre.count === 1 ? 'lead' : 'leads' }}</span></div>
					<div v-if="pre && pre.available != null && pre.available !== pre.count" class="small muted">of {{ CM.num(pre.available) }} that match</div>
					<div v-if="amt.mode !== 'each' || m.assignees.length < 2" style="margin-top:12px"><AmountField :amount="amt" :available="avail" noun="matching leads" /></div>
					<p class="small muted" style="margin:12px 0 0">{{ m.takeOver ? 'Leads that already have an owner move to the new people.' : 'Leads that already have an owner stay with them.' }}</p>
					<div v-if="over" class="alert err" style="margin-top:10px"><Ico name="alert" /><div class="grow">More leads are given out than there are.</div></div>
					<div v-if="pre" v-html="sample(pre.sample)" style="margin-top:12px"></div>
				</section>
				<Btn variant="primary" icon="users" class="mv-go" :loading="busy" :disabled="!pre || !pre.count || over" @click="go">Assign {{ pre ? plural(pre.count, 'lead') : '0 leads' }}</Btn>
			</aside>
		</div>`,
	}

	// ------------------------------------------------------------------ 3. move one person's leads to others
	C.MoveLeads = {
		emits: ['close', 'done'],
		setup(props, { emit }) {
			const t = reactive({ from: [], to: [], distribution: 'Round robin', all: false })
			const amt = newAmount()
			const pre = ref(null); const busy = ref(false)
			const ok = computed(() => t.from.length && t.to.length)
			const avail = computed(() => (pre.value ? (pre.value.available ?? pre.value.count) : null))
			const load = CM.debounce(async () => { if (!t.from.length) { pre.value = null; return } try { pre.value = await CM.apiA('preview_transfer', { from_users: t.from, scope: t.all ? 'all' : 'open', limit: amountLimit(amt), to_users: t.to, counts: amountCounts(amt, t.to) }) } catch (e) { pre.value = null } }, 400)
			watch(() => [t.from.join(), t.to.join(), t.all, amountKey(amt)], load)
			async function go() {
				if (!(await CM.confirm({ title: `Move ${plural(pre.value.count, 'lead')}?`, message: `From ${join(t.from)} to ${join(t.to)}. The old owner no longer sees them; the new people are notified in CRM.`, confirmText: 'Move leads', danger: true }))) return
				busy.value = true
				try { const res = await CM.apiA('transfer', { from_users: t.from, to_users: t.to, distribution: t.distribution, scope: t.all ? 'all' : 'open', limit: amountLimit(amt), counts: amountCounts(amt, t.to) }); CM.toast(doneText(res, 'Moving')); emit('done') } catch (e) { CM.toast(e.message, 'err') } finally { busy.value = false }
			}
			const clash = computed(() => t.from.some((u) => t.to.includes(u)))
			const over = computed(() => amt.mode === 'each' && t.to.length > 1 && pre.value && eachTotal(amt, t.to) > avail.value)
			return { t, amt, pre, avail, busy, ok, go, clash, over, plural, join, CM, nameOf }
		},
		template: `
		<div class="mv">
			<div class="mv-main">
				<section class="mv-card"><StepHead n="1" title="Take leads from" /><p class="small muted">Choose the people whose leads should move.</p><PeopleField v-model="t.from" placeholder="Choose who to take leads from" /></section>
				<section class="mv-card"><StepHead n="2" title="Give them to" /><p class="small muted">Choose who gets them.</p><PeopleField v-model="t.to" placeholder="Choose who gets them" /></section>
				<section v-if="t.to.length > 1" class="mv-card"><StepHead n="3" title="How are they shared?" /><ShareCards v-model="t.distribution" :amount="amt" :count="t.to.length" /><CountList :amount="amt" :people="t.to" :available="avail" /></section>
			</div>
			<aside class="mv-side">
				<section class="mv-card"><h3 class="mv-h">Leads that will move</h3>
					<Seg v-model="t.all" :options="[{ value: false, label: 'Open leads' }, { value: true, label: 'Every lead' }]" />
					<div class="mv-big"><b>{{ pre ? CM.num(pre.count) : 0 }}</b> <span>{{ pre && pre.count === 1 ? 'lead' : 'leads' }}</span></div>
					<div v-if="pre && t.from.length" class="mv-src"><div v-for="u in t.from" :key="u"><span>{{ nameOf(u) }}</span><b>{{ CM.num(pre.per_user[u] || 0) }}</b></div></div>
					<div v-if="amt.mode !== 'each' || t.to.length < 2" style="margin-top:12px"><AmountField :amount="amt" :available="avail" noun="their leads" /></div>
					<p class="small muted" style="margin:12px 0 0">{{ t.all ? 'Closed and converted leads move too.' : 'Closed and converted leads stay where they are.' }}</p>
					<div v-if="clash" class="alert err" style="margin-top:10px"><Ico name="alert" /><div class="grow">The same person is on both sides.</div></div>
					<div v-else-if="over" class="alert err" style="margin-top:10px"><Ico name="alert" /><div class="grow">More leads are given out than there are.</div></div>
				</section>
				<Btn variant="primary" icon="move-people" class="mv-go" :loading="busy" :disabled="!ok || clash || over || !pre || !pre.count" @click="go">Move {{ pre ? plural(pre.count, 'lead') : '0 leads' }}</Btn>
			</aside>
		</div>`,
	}

	// ------------------------------------------------------------------ the pages (same look as the Campaign Manager)
	const back = `<Btn variant="ghost" icon="arrow-left" @click="CM.go('/rules')">Rules</Btn>`
	const head = (title, text, actions) => `<div class="pg-head"><div class="grow"><h1>${title}</h1><p>${text}</p></div>${actions || ''}</div>`

	// "Assignment rules" can be View only (Team and access): then nothing on the rules screens changes anything
	CM.canManageRules = () => !(CM.shared.config && CM.shared.config.access) || CM.shared.config.access.assignment_rules === 'manage'

	V.AsgRules = {
		setup() {
			const rules = ref([]); const loading = ref(true); const error = ref(''); const q = reactive({ search: '', state: '' }); const layout = CM.useLayout('crm_asg_rules_layout')
			async function load() { loading.value = true; error.value = ''; try { rules.value = await CM.apiA('list_rules', {}) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(() => { CM.loadShared(); loadPeople(true); load() })
			const shown = computed(() => rules.value.filter((r) => (!q.state || (q.state === 'on' ? r.enabled : !r.enabled)) && (!q.search || (r.name + ' ' + r.assignees.map(nameOf).join(' ')).toLowerCase().includes(q.search.toLowerCase()))))
			const count = (s) => (s === 'on' ? rules.value.filter((r) => r.enabled).length : s === 'off' ? rules.value.filter((r) => !r.enabled).length : rules.value.length)
			async function toggle(r) {
				try {
					const res = await CM.apiA('set_enabled', { name: r.name, enabled: r.enabled ? 0 : 1 })
					if (res.needs_confirm) {
						if (!(await CM.confirm({ title: 'This overlaps another rule', message: 'A lead that fits both goes to the people of both: ' + res.clashes.map((c) => `"${c.rule}" (${join(c.people)})`).join('; ') + '.', confirmText: 'Yes, switch it on' }))) return
						await CM.apiA('set_enabled', { name: r.name, enabled: 1, confirm: 1 })
					}
					load()
				} catch (e) { CM.toast(e.message, 'err') }
			}
			async function remove(r) {
				if (!(await CM.confirm({ title: 'Delete "' + r.name + '"?', message: 'Leads already assigned stay with their people. New leads will no longer follow this rule.', confirmText: 'Delete rule', danger: true }))) return
				try { await CM.apiA('delete_rule', { name: r.name }); CM.toast('Rule deleted'); load() } catch (e) { CM.toast(e.message, 'err') }
			}
			const menu = (r) => CM.canManageRules() ? [{ label: 'Give existing leads to them', icon: 'users', run: () => CM.go('/rules/run/' + encodeURIComponent(r.name)) }, { label: 'Edit', icon: 'edit', run: () => CM.go('/rules/edit/' + encodeURIComponent(r.name)) }, { label: r.enabled ? 'Switch off' : 'Switch on', icon: 'refresh', run: () => toggle(r) }, { sep: true }, { label: 'Delete', icon: 'trash', danger: true, run: () => remove(r) }] : [{ label: 'View', icon: 'eye', run: () => CM.go('/rules/edit/' + encodeURIComponent(r.name)) }]
			const when = (r) => r.conditions.map((c) => asText(c)).join(r.match_mode === 'Any condition' ? ' or ' : ' and ')
			return { layout, rules, loading, error, load, q, shown, count, toggle, menu, when, join, nameOf, HOW_TEXT, CM, plural, go: CM.go }
		},
		template: `
		<div class="page">
			<div class="pg-head"><div class="grow"><h1>Rules</h1><p>Leads that come in are given to the right people automatically. Every rule a new lead matches applies.</p></div><div class="actions"><Btn v-if="CM.canManageRules()" variant="primary" icon="plus" @click="go('/rules/new')">Create rule</Btn></div></div>
			<div class="row wrap tool"><div style="width:300px;max-width:100%"><Inp v-model="q.search" icon="search" placeholder="Search rules" clearable aria-label="Search rules" /></div>
				<div class="chips" role="group" aria-label="State"><button v-for="s in [['', 'All'], ['on', 'On'], ['off', 'Off']]" :key="s[0]" type="button" class="fchip" :class="{ on: q.state === s[0] }" @click="q.state = s[0]">{{ s[1] }} <span class="n">{{ count(s[0]) }}</span></button></div></div>
			<HdrSlot><LayoutSwitch v-model="layout" /></HdrSlot>
			<div v-if="loading" class="cgrid"><div v-for="n in 4" :key="n" class="card pad col" style="gap:12px"><Skel w="60%" h="18" /><Skel w="40%" h="14" /><Skel h="40" /></div></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<Empty v-else-if="!rules.length" icon="users" title="Create your first rule" text="A rule says: leads like this go to these people. For example, every lead with State = Gujarat goes to Siddharth and Aayushi."><Btn v-if="CM.canManageRules()" variant="primary" icon="plus" @click="go('/rules/new')">Create rule</Btn></Empty>
			<Empty v-else-if="!shown.length" icon="search" title="No rules match" text="Try a different search or filter."><Btn @click="q.search = ''; q.state = ''">Clear filters</Btn></Empty>
			<div v-else-if="layout === 'list'" class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="tbl"><thead><tr><th>Rule</th><th>When</th><th>Given to</th><th>Leads assigned</th><th>On</th><th></th></tr></thead><tbody>
				<tr v-for="r in shown" :key="r.name" class="click" :class="{ 'asg-off': !r.enabled }" tabindex="0" @click="go('/rules/edit/' + encodeURIComponent(r.name))" @keydown.enter="go('/rules/edit/' + encodeURIComponent(r.name))"><td><b>{{ r.name }}</b><div v-if="r.overlaps.length" class="small rule-overlap"><Ico name="alert" size="sm" /> Also matches {{ r.overlaps.join(', ') }}</div></td><td class="small">{{ r.match_mode === 'Any condition' ? 'Any of' : 'All of' }}: {{ when(r) }}</td><td class="small">{{ r.assignees.map(nameOf).join(', ') }}<span class="badge blue nodot" v-if="r.assignees.length > 1" style="margin-left:6px">{{ HOW_TEXT[r.distribution] }}</span></td><td>{{ CM.num(r.assigned_count) }}</td>
					<td @click.stop><button type="button" class="sw" :class="{ on: r.enabled }" role="switch" :aria-checked="!!r.enabled" :aria-label="(r.enabled ? 'Turn off ' : 'Turn on ') + r.name" :disabled="!CM.canManageRules()" @click="toggle(r)"><span class="sw-k"></span></button></td><td @click.stop style="text-align:right"><Menu :items="menu(r)" :label="'Actions for ' + r.name" /></td></tr></tbody></table></div></div>
			<div v-else class="cgrid">
				<article v-for="r in shown" :key="r.name" class="ccard card hover" tabindex="0" @click="go('/rules/edit/' + encodeURIComponent(r.name))" @keydown.enter="go('/rules/edit/' + encodeURIComponent(r.name))" :class="{ 'asg-off': !r.enabled }">
					<div class="row" style="align-items:flex-start"><div class="grow" style="min-width:0"><div class="ccard-t" :title="r.name">{{ r.name }}</div><div class="small faint">{{ r.match_mode === 'Any condition' ? 'Any of' : 'All of' }}: {{ when(r) }}</div></div><span class="badge nodot" :class="r.enabled ? 'green' : 'neutral'">{{ r.enabled ? 'On' : 'Off' }}</span><span @click.stop><Menu :items="menu(r)" /></span></div>
					<div class="row wrap" style="gap:6px"><span v-for="(u, i) in r.assignees" :key="u" class="tchip">{{ nameOf(u) }}</span><span class="badge blue nodot" v-if="r.assignees.length > 1">{{ HOW_TEXT[r.distribution] }}</span></div>
					<div v-if="r.overlaps.length" class="small rule-overlap"><Ico name="alert" size="sm" /> Also matches {{ r.overlaps.join(', ') }}</div>
					<div class="ccard-f"><span>{{ plural(r.assigned_count, 'lead') }} assigned</span><span @click.stop><button type="button" class="sw" :class="{ on: r.enabled }" role="switch" :aria-checked="!!r.enabled" :aria-label="(r.enabled ? 'Turn off ' : 'Turn on ') + r.name" :disabled="!CM.canManageRules()" @click="toggle(r)"><span class="sw-k"></span></button></span></div>
				</article>
			</div>
		</div>`,
	}

	V.AsgRuleEdit = {
		props: { name: String },
		setup(props) {
			const rule = ref(null); const error = ref(''); const loading = ref(!!props.name)
			onMounted(async () => { CM.loadShared(); loadPeople(); if (!props.name) return; try { rule.value = (await CM.apiA('list_rules', {})).find((r) => r.name === props.name) || null; if (!rule.value) error.value = 'This rule no longer exists.' } catch (e) { error.value = e.message } finally { loading.value = false } })
			function saved(info) { CM.go(info && info.run ? '/rules/run/' + encodeURIComponent(info.run) : '/rules') }
			return { rule, error, loading, saved, CM }
		},
		template: `
		<div class="page"><div class="row">${back}</div>
			<div v-if="loading" class="card pad col"><Skel h="200" /></div><ErrorState v-else-if="error" :message="error" />
			<template v-else><div v-if="!CM.canManageRules()" class="alert info" style="margin-bottom:12px"><Ico name="info" /><div class="grow"><b>View only.</b> You can look at this rule but not change it.</div></div>
			<fieldset :disabled="!CM.canManageRules()" class="ro"><RuleEditor :key="rule ? rule.name : 'new'" :rule="rule" @close="CM.go('/rules')" @saved="saved" /></fieldset></template></div>`,
	}

	V.AsgRun = {
		props: { name: String },
		setup(props) { onMounted(() => { CM.loadShared(); loadPeople() }); return { CM } },
		template: `<div class="page"><div class="row">${back}</div><RuleRun :rule="{ name }" @close="CM.go('/rules')" @done="CM.go('/history')" /></div>`,
	}

	V.AsgAssign = {
		setup() { onMounted(() => { CM.loadShared(); loadPeople() }); return { CM } },
		template: `<div class="page"><AssignNow @close="CM.go('/rules')" @done="CM.go('/history')" /></div>`,
	}

	V.AsgMove = {
		setup() { onMounted(() => { CM.loadShared(); loadPeople() }); return { CM } },
		template: `<div class="page"><MoveLeads @close="CM.go('/rules')" @done="CM.go('/history')" /></div>`,
	}

	V.AsgHistory = {
		setup() {
			const hist = ref({ groups: [], undo_hours: 24 }); const loading = ref(true); const error = ref(''); const q = ref('')
			async function load() { loading.value = true; error.value = ''; try { hist.value = await CM.apiA('list_history', { limit: 200 }) } catch (e) { error.value = e.message } finally { loading.value = false } }
			onMounted(() => { loadPeople(); load() })
			async function undo(g) {
				const what = g.count === 1 ? 'this assignment' : plural(g.open, 'assignment')
				if (!(await CM.confirm({ title: 'Undo?', message: `Put ${what} back as it was. Leads that someone has changed since are left alone.`, confirmText: 'Undo' }))) return
				try {
					const res = await CM.apiA('undo', g.batch ? { batch: g.batch } : { entry: g.entry })
					CM.toast(res.queued ? `Undoing ${plural(res.count, 'lead')} in the background.` : `${plural(res.assigned, 'lead')} put back` + (res.skipped ? `, ${res.skipped} left alone because they changed` : ''))
					load()
				} catch (e) { CM.toast(e.message, 'err') }
			}
			const plain = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)
			const peopleText = (s) => join(plain(s))
			function what(g) {
				const n = g.count === 1 ? (g.sample[0].lead_name || g.sample[0].lead) : plural(g.count, 'lead')
				if (g.source === 'Transfer') return `Moved ${n} from ${peopleText(g.from_users) || 'someone'}`
				if (g.source === 'New lead') return `New lead ${n}` + (g.rule ? ` (rule: ${g.rule})` : '')
				if (g.source === 'Rule run') return `Rule "${g.rule}" gave ${n}`
				return `Gave ${n}`
			}
			const shown = computed(() => hist.value.groups.filter((g) => !q.value || (what(g) + peopleText(g.to_users)).toLowerCase().includes(q.value.toLowerCase())))
			return { hist, loading, error, load, q, shown, undo, what, peopleText, nameOf, CM }
		},
		template: `
		<div class="page">
			<p class="small muted" style="margin:0">Everything assigned here, by a rule or by hand. You can undo an assignment for {{ hist.undo_hours }} hours.</p>
			<div class="row wrap tool"><div style="width:300px;max-width:100%"><Inp v-model="q" icon="search" placeholder="Search history" clearable aria-label="Search history" /></div></div>
			<div v-if="loading" class="card pad col"><Skel v-for="n in 5" :key="n" h="40" /></div>
			<ErrorState v-else-if="error" :message="error" @retry="load" />
			<Empty v-else-if="!hist.groups.length" icon="clock" title="Nothing assigned yet" text="Every assignment made here is listed with who it went to, and can be undone for a day." />
			<Empty v-else-if="!shown.length" icon="search" title="Nothing matches" text="Try a different search." />
			<div v-else class="card" style="overflow:hidden"><div class="table-wrap"><table class="tbl asg-hist"><thead><tr><th>When</th><th>What</th><th>To</th><th>By</th><th></th></tr></thead><tbody>
				<tr v-for="g in shown" :key="g.id"><td class="nowrap small muted">{{ CM.ago(g.creation) }}</td>
					<td><b>{{ what(g) }}</b><div class="small faint" v-if="g.count > 1">{{ g.sample.map((s) => s.lead_name || s.lead).join(', ') }} ...</div></td>
					<td class="small">{{ peopleText(g.to_users) }}</td><td class="small">{{ nameOf(g.by_user) }}</td>
					<td class="nowrap" style="text-align:right"><Btn v-if="g.open" size="sm" icon="undo" @click="undo(g)">Undo{{ g.count > 1 ? ' all' : '' }}</Btn><span v-else-if="g.undone" class="badge neutral nodot">Undone</span><span v-else class="small faint">Too late to undo</span></td></tr>
			</tbody></table></div></div>
		</div>`,
	}
})()
