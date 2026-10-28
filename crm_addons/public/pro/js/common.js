/* Suite Pro app: shared helpers on top of the Campaign Manager's core (window.CM). Everything lives on window.PRO. */
(() => {
	const { reactive } = Vue
	const CM = window.CM
	const PRO = (window.PRO = { views: {} })
	// icons the shell needs that the Campaign Manager's set does not have
	Object.assign(CM.ICONS, {
		'bell-off': '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.7.5 4.8 1.1 6.3"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
		'check-check': '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
		'panel-left-close': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
		bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
		grid2: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
		message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
		'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
		grip: '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
		house: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
	})
	PRO.api = (m, a) => CM.call('crm_addons.pro.api.' + m, a)
	PRO.shell = reactive({ loaded: false, user: '', full_name: '', image: '', brand: { name: '', logo: '' }, unread: 0, waUnread: 0, config: null, error: '' })
	PRO.loadShell = async () => {
		try {
			const [s, c] = await Promise.all([PRO.api('get_shell', {}), CM.call('crm_addons.api.get_client_config', {})])
			Object.assign(PRO.shell, s, { config: c, loaded: true })
		} catch (e) { PRO.shell.error = e.message || 'This did not load.' }
	}
	/** "5 min ago", "Yesterday", or the date. */
	PRO.ago = (s) => {
		if (!s) return ''
		const d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return ''
		const sec = Math.round((Date.now() - d.getTime()) / 1000)
		if (sec < 60) return 'just now'
		if (sec < 3600) return Math.floor(sec / 60) + ' min ago'
		if (sec < 86400) return Math.floor(sec / 3600) + ' h ago'
		if (sec < 172800) return 'Yesterday'
		return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
	}
	/** The CRM address of a record. */
	PRO.crmUrl = (doctype, name) => {
		const route = { 'CRM Lead': 'leads', 'CRM Deal': 'deals', 'Contact': 'contacts', 'CRM Organization': 'organizations', 'CRM Task': 'tasks', 'FCRM Note': 'notes' }[doctype]
		if (doctype === 'CRM Lead' && name) return '/suite#/leads/' + encodeURIComponent(name)
		return route && name ? '/crm/' + route + '/' + encodeURIComponent(name) : ''
	}
})()
