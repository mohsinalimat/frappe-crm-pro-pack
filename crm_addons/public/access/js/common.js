/* Team and access: shared helpers on top of the Campaign Manager's core (window.CM). Everything lives on window.AX. */
(() => {
	const { reactive } = Vue
	const CM = window.CM
	const AX = (window.AX = { views: {} })

	AX.api = (m, a) => CM.call('crm_addons.team_access.admin.' + m, a)
	AX.data = reactive({ loaded: false, loading: false, error: '', groups: [], features: [], presets: [], people: [], hierarchy: { available: false, enabled: false, people: 0 }, me: '' })
	AX.load = async (force) => {
		if (AX.data.loading || (AX.data.loaded && !force)) return
		AX.data.loading = true; AX.data.error = ''
		try { Object.assign(AX.data, await AX.api('get_overview', {}), { loaded: true }) } catch (e) { AX.data.error = e.message || 'This did not load.' } finally { AX.data.loading = false }
	}
	AX.feature = (key) => AX.data.features.find((f) => f.key === key)

	/** What a person gets when nobody has configured them: the same rule the server uses (manager / Campaign Manager / everybody else). */
	AX.legacy = (feature, roles) => {
		const [manager, campaign, other] = feature.legacy
		const set = new Set(roles || [])
		if (set.has('System Manager') || set.has('Sales Manager')) return manager
		return set.has('Campaign Manager') ? campaign : other
	}
	AX.top = (feature) => feature.options[feature.options.length - 1].value
	AX.label = (feature, value) => { const o = feature.options.find((x) => String(x.value) === String(value)); return o ? o.label : String(value) }
	AX.initials = (name) => CM.initials ? CM.initials(name) : String(name || '?').slice(0, 2).toUpperCase()
	AX.sameMap = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort())
})()
