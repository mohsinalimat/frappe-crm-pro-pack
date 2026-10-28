/* The access grid: every feature in its group, with a control for the value. Used for a person (with where each value comes from) and for a preset.
 * Groups fold open and closed, say how many of their permissions are on, and the whole list can be searched. */
(() => {
	const { computed, reactive, ref } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	const GROUP_ICON = { sales: 'chart', demos: 'calendar', assignment: 'users', campaigns: 'send' }
	const KIND_ICON = { scope: 'eye', switch: 'zap', level: 'edit' }
	const on = (v) => !(v === 'none' || v === 0 || v === '0' || v === '' || v == null)

	V.AccessGrid = {
		props: { rows: Array, showSource: Boolean, readonly: Boolean },
		emits: ['change', 'reset'],
		setup(props) {
			const q = ref(''); const shut = reactive({})   // groups the person folded; all start open
			const term = computed(() => q.value.trim().toLowerCase())
			const hit = (r) => !term.value || (r.feature.label + ' ' + (r.feature.help || '')).toLowerCase().includes(term.value)
			const groups = computed(() => AX.data.groups.map((g) => {
				const all = props.rows.filter((r) => r.feature.group === g.key)
				return { ...g, all: all.length, enabled: all.filter((r) => on(r.value)).length, rows: all.filter(hit), icon: GROUP_ICON[g.key] || 'settings' }
			}).filter((g) => g.all && g.rows.length))
			const open = (g) => !!term.value || !shut[g.key]
			const flip = (g) => { shut[g.key] = open(g) }
			const setAll = (v) => AX.data.groups.forEach((g) => (shut[g.key] = !v))
			const SRC = { override: ['Custom', 'blue'], preset: ['From preset', 'neutral'], default: ['Role default', 'neutral'], admin: ['Always full', 'green'] }
			const options = (f) => f.options.map((o) => ({ value: o.value, label: o.label }))
			return { q, groups, open, flip, setAll, SRC, options, AX, KIND_ICON }
		},
		template: `
		<section class="ax-perms">
			<div class="ax-ph"><div class="grow"><h2>Permissions</h2><p class="small muted">Control what this {{ showSource ? 'user' : 'preset' }} can access and do.</p></div>
				<div class="ax-psearch"><Inp v-model="q" icon="search" placeholder="Search permissions (e.g. meetings, campaigns...)" clearable aria-label="Search permissions" /></div>
				<Btn size="sm" icon="chevron-down" @click="setAll(true)">Expand all</Btn><Btn size="sm" icon="chevron-up" @click="setAll(false)">Collapse all</Btn></div>
			<div class="ax-grid">
				<section v-for="g in groups" :key="g.key" class="card ax-group" :class="{ shut: !open(g) }">
					<button type="button" class="ax-gh" :aria-expanded="open(g)" @click="flip(g)">
						<span class="ax-gi"><Ico :name="g.icon" /></span><span class="grow"><b>{{ g.label }}</b><span class="small muted">{{ g.help }}</span></span>
						<span class="ax-cnt">{{ g.enabled }} of {{ g.all }} enabled</span><Ico :name="open(g) ? 'chevron-up' : 'chevron-down'" size="sm" />
					</button>
					<template v-if="open(g)"><div v-for="r in g.rows" :key="r.feature.key" class="ax-row" :class="{ changed: showSource && r.source === 'override' }">
						<span class="ax-ri"><Ico :name="KIND_ICON[r.feature.kind] || 'eye'" size="sm" /></span>
						<div class="ax-name"><b>{{ r.feature.label }}</b><span class="small muted">{{ r.feature.help }}</span></div>
						<div class="ax-ctl">
							<span v-if="showSource" class="badge sm nodot" :class="SRC[r.source][1]">{{ SRC[r.source][0] }}</span>
							<button v-if="showSource && r.source === 'override' && !readonly" type="button" class="btn ghost icon sm" title="Back to the preset / role default" aria-label="Undo this change" @click="$emit('reset', r.feature.key)"><Ico name="refresh" size="sm" /></button>
							<Switch v-if="r.feature.kind === 'switch'" :model-value="!!Number(r.value)" :label="r.feature.label" :aria-disabled="readonly" @update:model-value="(v) => !readonly && $emit('change', r.feature.key, v ? 1 : 0)" />
							<div v-else style="width:170px"><Dd :model-value="r.value" :options="options(r.feature)" size="sm" :disabled="readonly" :aria-label="r.feature.label" @update:model-value="(v) => $emit('change', r.feature.key, v)" /></div>
						</div>
					</div></template>
				</section>
				<p v-if="!groups.length" class="small muted">No permission matches "{{ q.trim() }}".</p>
			</div>
		</section>`,
	}
})()
