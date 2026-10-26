/* The access grid: every feature in its group, with a control for the value. Used for a person (with where each value comes from) and for a preset. */
(() => {
	const { computed } = Vue
	const CM = window.CM
	const AX = window.AX
	const V = AX.views

	V.AccessGrid = {
		props: { rows: Array, showSource: Boolean, readonly: Boolean },
		emits: ['change', 'reset'],
		setup(props) {
			const groups = computed(() => AX.data.groups.map((g) => ({ ...g, rows: props.rows.filter((r) => r.feature.group === g.key) })).filter((g) => g.rows.length))
			const SRC = { override: ['Changed', 'blue'], preset: ['From preset', 'neutral'], default: ['Role default', 'neutral'], admin: ['Always full', 'green'] }
			const options = (f) => f.options.map((o) => ({ value: o.value, label: o.label }))
			return { groups, SRC, options, AX }
		},
		template: `
		<div class="ax-grid">
			<section v-for="g in groups" :key="g.key" class="card ax-group">
				<header><h3>{{ g.label }}</h3><p>{{ g.help }}</p></header>
				<div v-for="r in g.rows" :key="r.feature.key" class="ax-row" :class="{ changed: showSource && r.source === 'override' }">
					<div class="ax-name"><b>{{ r.feature.label }}</b><span class="small muted">{{ r.feature.help }}</span></div>
					<div class="ax-ctl">
						<span v-if="showSource" class="badge sm nodot" :class="SRC[r.source][1]">{{ SRC[r.source][0] }}</span>
						<button v-if="showSource && r.source === 'override' && !readonly" type="button" class="btn ghost icon sm" title="Back to the preset / role default" aria-label="Undo this change" @click="$emit('reset', r.feature.key)"><Ico name="refresh" size="sm" /></button>
						<Switch v-if="r.feature.kind === 'switch'" :model-value="!!Number(r.value)" :label="r.feature.label" :aria-disabled="readonly" @update:model-value="(v) => !readonly && $emit('change', r.feature.key, v ? 1 : 0)" />
						<div v-else style="width:170px"><Dd :model-value="r.value" :options="options(r.feature)" size="sm" :disabled="readonly" :aria-label="r.feature.label" @update:model-value="(v) => $emit('change', r.feature.key, v)" /></div>
					</div>
				</div>
			</section>
		</div>`,
	}
})()
