/* Suite Pro: the lead page. Details with quick status/owner changes, follow-up tasks, calls, notes and the timeline. */
(() => {
	const { ref, reactive, computed, onMounted, watch } = Vue
	const CM = window.CM
	const PRO = window.PRO
	const V = PRO.views
	const call = (m, a) => CM.call('crm_addons.pro.lead.' + m, a)
	const day = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + (String(s).length > 10 ? ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') }
	const digits = (s) => String(s || '').replace(/[^\d]/g, '')
	const TABS = [{ id: 'info', label: 'Lead info' }, { id: 'tasks', label: 'Follow-ups' }, { id: 'calls', label: 'Calls' }, { id: 'notes', label: 'Notes' }, { id: 'timeline', label: 'Timeline' }]

	V.Fact = {
		props: { label: String, value: [String, Number] },
		template: `<div class="fact"><span class="fact-l">{{ label }}</span><span class="fact-v"><slot>{{ value || '-' }}</slot></span></div>`,
	}

	V.Lead = {
		props: { name: String },
		setup(props) {
			const lead = ref(null); const error = ref(''); const loading = ref(true)
			const tab = ref(CM.route.query.tab || 'info')
			const owners = ref([])
			const notes = ref(null); const tasks = ref(null); const calls = ref(null); const timeline = ref(null)
			async function load() {
				loading.value = true; error.value = ''
				try { lead.value = await call('get_lead', { name: props.name }) } catch (e) { error.value = e.message } finally { loading.value = false }
			}
			async function loadTab(t) {
				try {
					if (t === 'notes') notes.value = await call('get_notes', { name: props.name })
					else if (t === 'tasks') tasks.value = await call('get_tasks', { name: props.name })
					else if (t === 'calls') calls.value = await call('get_calls', { name: props.name })
					else if (t === 'timeline') timeline.value = await call('get_timeline', { name: props.name })
				} catch (e) { CM.toast(e.message, 'err') }
			}
			onMounted(async () => {
				load(); loadTab(tab.value)
				try { owners.value = (await CM.call('crm_addons.pro.leads.filter_options', {})).owners } catch (e) { /* the pickers stay empty */ }
			})
			watch(tab, (t) => loadTab(t))
			const back = () => { location.hash = '#/leads' }
			const statusOpts = computed(() => (lead.value ? lead.value.statuses.map((s) => ({ value: s.name, label: s.name })) : []))
			const ownerOpts = computed(() => [{ value: '', label: 'Unassigned' }, ...owners.value.map((o) => ({ value: o.name, label: o.full_name }))])
			async function save(values, done) {
				try { lead.value = await call('update_lead', { name: props.name, values: JSON.stringify(values) }); if (tab.value === 'timeline') loadTab('timeline'); if (done) CM.toast(done) } catch (e) { CM.toast(e.message, 'err'); await load() }
			}
			const setStatus = (v) => { if (v !== lead.value.status) save({ status: v }, 'Status updated') }
			const setOwner = (v) => { if ((v || null) !== (lead.value.lead_owner || null)) save({ lead_owner: v }, 'Assigned to ' + ((owners.value.find((o) => o.name === v) || {}).full_name || 'nobody')) }
			const title = computed(() => (lead.value ? lead.value.lead_name || lead.value.organization || lead.value.name : ''))
			watch(title, (t) => { if (t) document.title = t + ' - ' + (PRO.shell.brand.name || 'Suite Pro') })
			const copy = async (t) => { try { await navigator.clipboard.writeText(t); CM.toast('Copied') } catch (e) { CM.toast('Could not copy', 'err') } }

			// edit
			const edit = reactive({ open: false, v: {}, busy: false })
			const EDIT_FIELDS = ['first_name', 'last_name', 'mobile_no', 'email', 'organization', 'job_title', 'website', 'territory', 'source']
			function openEdit() { edit.v = Object.fromEntries(EDIT_FIELDS.map((f) => [f, lead.value[f] || ''])); edit.open = true }
			async function saveEdit() { edit.busy = true; await save(edit.v, 'Saved'); edit.busy = false; edit.open = false }

			// notes
			const noteForm = reactive({ title: '', content: '', busy: false })
			async function addNote() { noteForm.busy = true; try { await call('add_note', { name: props.name, title: noteForm.title, content: noteForm.content }); noteForm.title = ''; noteForm.content = ''; await loadTab('notes'); lead.value.counts.notes = notes.value.length } catch (e) { CM.toast(e.message, 'err') } finally { noteForm.busy = false } }
			async function dropNote(n) { if (!(await CM.confirm({ title: 'Delete this note?', confirmText: 'Delete', danger: true }))) return; try { await call('delete_note', { name: props.name, note: n.name }); await loadTab('notes'); lead.value.counts.notes = notes.value.length } catch (e) { CM.toast(e.message, 'err') } }

			// tasks
			const taskForm = reactive({ open: false, title: '', due: '', who: '', priority: 'Medium', busy: false })
			const prioOpts = ['Low', 'Medium', 'High'].map((p) => ({ value: p, label: p }))
			async function addTask() { taskForm.busy = true; try { await call('add_task', { name: props.name, title: taskForm.title, due_date: taskForm.due || undefined, assigned_to: taskForm.who || undefined, priority: taskForm.priority }); Object.assign(taskForm, { open: false, title: '', due: '', who: '', priority: 'Medium' }); await loadTab('tasks'); lead.value.counts.tasks = tasks.value.length } catch (e) { CM.toast(e.message, 'err') } finally { taskForm.busy = false } }
			async function toggleTask(t) { const to = t.status === 'Done' ? 'Todo' : 'Done'; try { await call('set_task_status', { name: props.name, task: t.name, status: to }); t.status = to } catch (e) { CM.toast(e.message, 'err') } }
			const late = (t) => t.status !== 'Done' && t.status !== 'Canceled' && t.due_date && new Date(String(t.due_date).replace(' ', 'T')) < new Date()

			// comments
			const comment = ref('')
			async function addComment() { try { await call('add_comment', { name: props.name, content: comment.value }); comment.value = ''; await loadTab('timeline') } catch (e) { CM.toast(e.message, 'err') } }
			return { lead, error, loading, tab, TABS, back, statusOpts, ownerOpts, setStatus, setOwner, title, copy, edit, openEdit, saveEdit, EDIT_FIELDS, notes, tasks, calls, timeline, noteForm, addNote, dropNote, taskForm, prioOpts, addTask, toggleTask, late, comment, addComment, day, digits, load, PRO, CM }
		},
		template: `
		<div class="page lead-page">
			<button type="button" class="btn ghost sm back" @click="back"><Ico name="chevron-left" /> Leads</button>
			<ErrorState v-if="error" :message="error" @retry="load" />
			<div v-else-if="loading && !lead" class="card"><Skel h="60" /><Skel h="200" /></div>
			<template v-else-if="lead">
				<header class="lead-head card">
					<Pic :name="title" :image="lead.image" :size="56" />
					<div class="grow" style="min-width:0">
						<h1 class="ellipsis">{{ title }}</h1>
						<div class="row wrap small muted" style="gap:14px">
							<span v-if="lead.mobile_no" class="row" style="gap:6px"><Ico name="phone" size="sm" /> {{ lead.mobile_no }} <button type="button" class="btn ghost icon sm" aria-label="Copy phone number" @click="copy(lead.mobile_no)"><Ico name="copy" size="sm" /></button></span>
							<span v-if="lead.email" class="row" style="gap:6px"><Ico name="mail" size="sm" /> {{ lead.email }}</span>
							<span v-if="lead.organization">{{ lead.organization }}</span>
						</div>
					</div>
					<StatusTag :status="lead.status" />
					<a v-if="lead.mobile_no" class="btn" :href="'tel:' + lead.mobile_no"><Ico name="phone" /> Call</a>
					<a v-if="lead.mobile_no" class="btn" :href="'https://wa.me/' + digits(lead.mobile_no)" target="_blank" rel="noopener"><Ico name="whatsapp" /> WhatsApp</a>
					<Btn v-if="lead.can_write" icon="edit" @click="openEdit">Edit</Btn>
				</header>
				<div class="ltabs" role="tablist"><button v-for="t in TABS" :key="t.id" type="button" role="tab" class="ltab" :class="{ on: tab === t.id }" :aria-selected="String(tab === t.id)" @click="tab = t.id">{{ t.label }}<span v-if="lead.counts[t.id === 'tasks' ? 'tasks' : t.id]" class="n">{{ lead.counts[t.id === 'tasks' ? 'tasks' : t.id] }}</span></button></div>

				<div v-if="tab === 'info'" class="lead-grid">
					<div class="stack">
						<section class="card"><h3>Basic information</h3>
							<div class="facts">
								<Fact label="Phone" :value="lead.mobile_no" /><Fact label="Email" :value="lead.email" /><Fact label="Organization" :value="lead.organization" /><Fact label="Job title" :value="lead.job_title" />
								<Fact label="Website" :value="lead.website" /><Fact label="Territory" :value="lead.territory" /><Fact label="Source" :value="lead.source" /><Fact label="Industry" :value="lead.industry" />
								<Fact label="Added on" :value="day(lead.creation)" /><Fact label="Added by" :value="lead.created_by && lead.created_by.full_name" />
							</div>
						</section>
						<section v-if="lead.crm_demo_first_utm_source || lead.crm_demo_first_utm_medium || lead.crm_demo_first_utm_campaign" class="card"><h3>Where they came from</h3>
							<div class="facts"><Fact label="UTM source" :value="lead.crm_demo_first_utm_source" /><Fact label="UTM medium" :value="lead.crm_demo_first_utm_medium" /><Fact label="UTM campaign" :value="lead.crm_demo_first_utm_campaign" /></div>
						</section>
					</div>
					<div class="stack">
						<section class="card"><h3>Status and owner</h3>
							<Field label="Status"><Dd :modelValue="lead.status" :options="statusOpts" :disabled="!lead.can_write" aria-label="Status" @update:modelValue="setStatus" /></Field>
							<Field label="Assigned to"><Dd :modelValue="lead.lead_owner || ''" :options="ownerOpts" searchable :disabled="!lead.can_write" aria-label="Assigned to" @update:modelValue="setOwner" /></Field>
						</section>
						<section class="card"><h3>Next follow-up</h3>
							<div v-if="lead.next_follow_up_on" class="row" style="gap:8px"><Ico name="calendar" /><b>{{ day(lead.next_follow_up_on) }}</b></div>
							<p v-else class="muted small">No follow-up planned.</p>
							<Btn size="sm" icon="plus" style="margin-top:10px" @click="tab = 'tasks'; taskForm.open = true">Add a follow-up</Btn>
						</section>
						<section class="card"><h3>Additional information</h3>
							<div class="facts one"><Fact label="Score" :value="lead.addons_score" /><Fact label="Last call" :value="lead.addons_last_outcome" /><Fact label="Call attempts" :value="lead.addons_call_attempts" /><Fact label="Next meeting" :value="day(lead.next_meeting_on)" /></div>
						</section>
					</div>
				</div>

				<section v-else-if="tab === 'tasks'" class="card">
					<div class="row" style="justify-content:space-between"><h3>Follow-ups</h3><Btn v-if="lead.can_write" size="sm" icon="plus" @click="taskForm.open = !taskForm.open">Add</Btn></div>
					<form v-if="taskForm.open" class="row wrap" style="gap:8px;margin:10px 0" @submit.prevent="addTask">
						<div style="flex:1;min-width:220px"><Inp v-model="taskForm.title" placeholder="What needs doing?" aria-label="Task title" /></div>
						<input class="inp" type="datetime-local" v-model="taskForm.due" aria-label="Due" style="width:210px" />
						<div style="width:200px"><Dd v-model="taskForm.who" :options="ownerOpts" placeholder="Assign to" searchable size="sm" aria-label="Assign to" /></div>
						<div style="width:120px"><Dd v-model="taskForm.priority" :options="prioOpts" size="sm" aria-label="Priority" /></div>
						<Btn variant="primary" type="submit" :loading="taskForm.busy" :disabled="!taskForm.title.trim()">Save</Btn>
					</form>
					<Skel v-if="!tasks" h="40" />
					<Empty v-else-if="!tasks.length" icon="check-circle" title="No follow-ups yet" text="Plan the next call or visit so this lead is not forgotten." />
					<ul v-else class="list">
						<li v-for="t in tasks" :key="t.name" class="li row" style="gap:12px"><input type="checkbox" :checked="t.status === 'Done'" :disabled="!lead.can_write" :aria-label="'Mark ' + t.title + ' done'" @change="toggleTask(t)" />
							<div class="grow" :style="{ opacity: t.status === 'Done' ? .55 : 1 }"><b :style="{ textDecoration: t.status === 'Done' ? 'line-through' : 'none' }">{{ t.title }}</b><div class="small muted">{{ t.assignee ? t.assignee.full_name : 'Nobody' }}<template v-if="t.due_date"> - <span :class="{ overdue: late(t) }">{{ day(t.due_date) }}</span></template></div></div>
							<span class="badge nodot" :class="t.priority === 'High' ? 'red' : t.priority === 'Low' ? 'neutral' : 'amber'">{{ t.priority }}</span></li>
					</ul>
				</section>

				<section v-else-if="tab === 'calls'" class="card"><h3>Calls</h3>
					<Skel v-if="!calls" h="40" />
					<Empty v-else-if="!calls.length" icon="phone" title="No calls logged" text="Calls made through the CRM's telephony show up here." />
					<ul v-else class="list"><li v-for="c in calls" :key="c.name" class="li row" style="gap:12px"><Ico name="phone" /><div class="grow"><b>{{ c.type }} call - {{ c.status }}</b><div class="small muted">{{ day(c.start_time) }}<template v-if="c.by"> - {{ c.by.full_name }}</template><template v-if="c.duration"> - {{ Math.round(c.duration) }}s</template></div></div></li></ul>
				</section>

				<section v-else-if="tab === 'notes'" class="card"><h3>Notes</h3>
					<form v-if="lead.can_write" class="stack" style="gap:8px;margin-bottom:14px" @submit.prevent="addNote">
						<Inp v-model="noteForm.title" placeholder="Title" aria-label="Note title" /><textarea class="inp" rows="3" v-model="noteForm.content" placeholder="Write a note" aria-label="Note"></textarea>
						<div><Btn variant="primary" type="submit" :loading="noteForm.busy" :disabled="!noteForm.title.trim() && !noteForm.content.trim()">Add note</Btn></div>
					</form>
					<Skel v-if="!notes" h="40" />
					<Empty v-else-if="!notes.length" icon="file-text" title="No notes yet" text="Keep what you learn about this lead here." />
					<ul v-else class="list"><li v-for="n in notes" :key="n.name" class="li"><div class="row" style="justify-content:space-between"><b>{{ n.title }}</b><Btn v-if="lead.can_write" size="sm" variant="ghost" icon="trash" aria-label="Delete note" @click="dropNote(n)" /></div><div class="note-body" v-html="n.content"></div><div class="small muted">{{ n.by ? n.by.full_name : '' }} - {{ PRO.ago(n.creation) }}</div></li></ul>
				</section>

				<section v-else-if="tab === 'timeline'" class="card"><h3>Timeline</h3>
					<form v-if="lead.can_write" class="row" style="gap:8px;margin-bottom:14px" @submit.prevent="addComment"><div class="grow"><Inp v-model="comment" placeholder="Write a comment" aria-label="Comment" /></div><Btn type="submit" :disabled="!comment.trim()">Comment</Btn></form>
					<Skel v-if="!timeline" h="40" />
					<Empty v-else-if="!timeline.length" icon="clock" title="Nothing yet" text="Changes and comments will show here." />
					<ul v-else class="list"><li v-for="(e, i) in timeline" :key="i" class="li row" style="gap:12px;align-items:flex-start"><Pic :name="e.by && e.by.full_name" :image="e.by && e.by.image" :size="28" />
						<div class="grow"><div><b>{{ e.by ? e.by.full_name : 'System' }}</b>
							<span v-if="e.kind === 'change'" class="muted"> changed <b>{{ e.field }}</b><template v-if="e.old"> from {{ e.old }}</template> to <b>{{ e.new || 'empty' }}</b></span>
							<span v-else-if="e.kind === 'assigned'" class="muted"> {{ e.text }}</span><span v-else class="muted"> commented</span></div>
							<div v-if="e.kind === 'comment'" class="note-body">{{ e.text }}</div></div><span class="small muted nowrap">{{ PRO.ago(e.creation) }}</span></li></ul>
				</section>

				<Modal v-if="edit.open" title="Edit lead" @close="edit.open = false" @submit="saveEdit">
					<div class="grid2"><Field v-for="f in EDIT_FIELDS" :key="f" :label="lead.fields[f] ? lead.fields[f].label : f"><Inp v-model="edit.v[f]" :aria-label="f" /></Field></div>
					<template #foot><Btn @click="edit.open = false">Cancel</Btn><Btn variant="primary" :loading="edit.busy" @click="saveEdit">Save</Btn></template>
				</Modal>
			</template>
		</div>`,
	}
})()
