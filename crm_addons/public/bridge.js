/* Frappe CRM Suite Pro bridge.
 * Loaded on demand by the scripts the app installs into Frappe CRM. It opens the add-on screens (iframes
 * served by this app) on top of the CRM page, so CRM's own source code never has to change.
 *
 *   window.crmAddons.config()                 -> settings for the current user
 *   window.crmAddons.openCalendar({view})     -> the calendar / agenda
 *   window.crmAddons.openEditor({reference_doctype, reference_docname, meeting, onSaved})
 *   window.crmAddons.openMeeting(name)
 *   window.crmAddons.openDashboard(hash?)     the Sales Dashboard (hash e.g. "#nurturing" for Lead Nurturing)
 *   window.crmAddons.openFollowUps(hash?)     the Follow-ups workspace (hash: #overdue #today #upcoming #done)
 *   window.crmAddons.openCampaigns(hash?)     the Campaign Manager (hash e.g. "#/c/CAMP-00001")
 *   window.crmAddons.openAssignment()         lead assignment (System Managers only)
 *   window.crmAddons.openDemos(hash?)         Bookings, widgets and the report (hash e.g. "#/bookings")
 *   window.crmAddons.openFollowUp({reference_docname, entry})   the "Add follow-up" form for a Lead
 *   window.crmAddons.close()                  close whatever is open
 *   window.addEventListener("crm-addons:changed", ...)  fires after a save / cancel
 *
 * The calendar, the dashboards, the follow-ups and the campaigns all open the same way: a large pop-up over
 * the CRM (an iframe loaded with embed=1 and the CRM's theme; the hash is passed through after the query).
 * The page inside has an "Open in a new tab" button for the full screen version. One pop-up at a time. It is
 * closed by a click on the backdrop, by Esc, by the page's own Close button (postMessage {type: "close"}), by
 * the browser's Back button, and before the CRM tab is moved on by {type: "navigate", url}.
 */
(function () {
	// One version for everything: the page below loads its own scripts and styles with the same ?v=
	var VER = ((document.currentScript && document.currentScript.src) || "").split("v=")[1] || String(Date.now())
	VER = VER.split("&")[0]
	// a bridge of the same release is kept; one left over from an older release is replaced (its screens would load old files)
	if (window.crmAddons && window.crmAddons.ver === VER) return
	if (window.crmAddons && typeof window.crmAddons.close === "function") { try { window.crmAddons.close() } catch (e) { /* nothing open */ } }
	// every screen: where it lives, its frame title, and whether it is a large pop-up (the editors are small panels)
	var KINDS = {
		calendar: { url: "/assets/crm_addons/meetings/index.html?v=" + VER, title: "Meetings", large: true },
		dashboard: { url: "/assets/crm_addons/meetings/dashboard.html?v=" + VER, title: "Sales Dashboard", large: true },
		followups: { url: "/assets/crm_addons/meetings/followups.html?v=" + VER, title: "Follow-ups", large: true },
		campaigns: { url: "/assets/crm_addons/campaigns/index.html?v=" + VER, title: "Campaign Manager", large: true },
		assignment: { url: "/assets/crm_addons/campaigns/assignment.html?v=" + VER, title: "Lead assignment", large: true },
		demos: { url: "/assets/crm_addons/demos/index.html?v=" + VER, title: "Bookings", large: true },
		access: { url: "/assets/crm_addons/access/index.html?v=" + VER, title: "Team and access", large: true },
		settings: { url: "/assets/crm_addons/setup/index.html?v=" + VER, title: "Settings", large: true },
		editor: { url: "/assets/crm_addons/meetings/index.html?v=" + VER, title: "Meeting", large: false },
		followup: { url: "/assets/crm_addons/meetings/index.html?v=" + VER, title: "Add follow-up", large: false },
	}
	// The big screens open as a PAGE of the CRM: they fill the area to the right of CRM's own menu, the menu stays, the address
	// becomes /crm/pro-pack-<name> (so Back, reload and sharing the link work), and the menu row stays lit. Small screens, and
	// the small forms (a meeting, a follow-up), still open as a pop-up.
	var PAGES = { calendar: "meetings", dashboard: "sales-dashboard", followups: "followups", campaigns: "campaigns", assignment: "assignment", demos: "demos", access: "team-access", settings: "settings" }
	var SIDE_KEY = { calendar: "meetings", dashboard: "dashboard", followups: "followups", campaigns: "campaigns", assignment: "assignment", demos: "demos" }
	var pagePath = ""
	var layer = null
	var frameEl = null
	var layerKind = ""
	var pending = null
	var returnFocus = null
	var configPromise = null

	function config() {
		if (!configPromise) {
			// a request that never answers must not leave every caller waiting for ever
			var ctl = typeof AbortController === "function" ? new AbortController() : null
			var timer = ctl ? setTimeout(function () { ctl.abort() }, 20000) : null
			configPromise = fetch("/api/method/crm_addons.api.get_client_config", { credentials: "same-origin", signal: ctl ? ctl.signal : undefined })
				.then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)) })
				.then(function (j) { return j.message })
				.then(function (v) { clearTimeout(timer); return v }, function (e) { clearTimeout(timer); configPromise = null; throw e })
		}
		return configPromise
	}

	// the CRM's theme: its own <html data-theme>, else the 'theme' it keeps in this browser
	function theme() {
		var t = document.documentElement.getAttribute("data-theme")
		if (!t) { try { t = localStorage.getItem("theme") } catch (e) { t = "" } }
		return t === "dark" || t === "light" ? t : ""
	}

	/** Where CRM's own menu ends: the page starts there. 0 when the menu cannot be found. */
	function sidebarEl() {
		var link = document.querySelector('nav a[href^="/crm/"]')
		var nav = link && link.closest("nav")
		if (!nav) {
			// older CRM versions draw the menu as buttons: the nav whose buttons are named like the CRM pages
			var names = ["Dashboard", "Leads", "Deals", "Contacts", "Organizations", "Notes", "Tasks", "Call Logs"]
			var navs = document.querySelectorAll("nav")
			for (var n = 0; n < navs.length && !nav; n++) {
				var hits = 0
				Array.prototype.forEach.call(navs[n].children, function (c) {
					var t = (c.textContent || "").trim()
					if (c.tagName === "BUTTON" && names.some(function (x) { return t === x || (typeof window.__ === "function" && t === window.__(x)) })) hits++
				})
				if (hits >= 2) nav = navs[n]
			}
		}
		if (!nav) return null
		var el = nav
		for (var i = 0; el && i < 6; i++, el = el.parentElement) {
			var r = el.getBoundingClientRect()
			if (r.height >= window.innerHeight * 0.7 && r.width <= window.innerWidth * 0.4 && r.left <= 4) return el
		}
		return nav
	}
	function sidebarEdge() { var el = sidebarEl(); return el ? Math.ceil(el.getBoundingClientRect().right) : 0 }
	var follow = null
	/** The menu can fold to icons (or open again) while a page is shown: the page keeps starting where the menu ends. */
	function followMenu(box) {
		unfollow()
		var el = sidebarEl()
		var move = function () { if (layer === box) { var e = sidebarEdge(); if (e > 0) box.style.left = e + "px" } }
		window.addEventListener("resize", move)
		var ro = el && typeof ResizeObserver === "function" ? new ResizeObserver(move) : null
		if (ro) ro.observe(el)
		var timer = setInterval(move, 600) // a menu that animates or is redrawn without a size change of its own
		follow = function () { window.removeEventListener("resize", move); if (ro) ro.disconnect(); clearInterval(timer) }
	}
	function unfollow() { if (follow) { follow(); follow = null } }

	function lightMenu(kind) {
		Array.prototype.forEach.call(document.querySelectorAll(".cra-side-on"), function (n) { n.classList.remove("cra-side-on") })
		var row = kind && document.querySelector('[data-cra-side="' + SIDE_KEY[kind] + '"]')
		if (row) row.classList.add("cra-side-on")
	}

	// CRM's own dialogs (Settings, a confirmation) and menus are drawn at the end of <body> with a low z-index. Our page sits at
	// z-index 30 over the area right of the menu, so it used to hide them: only the dimmed backdrop and a sliver of the dialog
	// showed. While one of our pages is open, anything CRM adds to <body> above the page level is lifted over it.
	var LIFT_Z = 2147482500
	function lift(node) {
		if (!layer || !node || node.nodeType !== 1 || node === layer || node.closest("[data-crm-addons]") || node.hasAttribute("data-cra")) return
		if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|IFRAME)$/.test(node.tagName) || node.id === "app") return
		var cs = getComputedStyle(node)
		var z = parseInt(cs.zIndex, 10)
		if (z >= LIFT_Z) return
		if (cs.position === "static") {
			// a portal root has no position of its own; its children (fixed dialogs) follow its stacking order
			if (node.id !== "headlessui-portal-root" && !node.querySelector('[role="dialog"], [role="menu"]')) return
			node.style.position = "relative"
		}
		node.style.zIndex = String(LIFT_Z)
	}
	function liftAll() { Array.prototype.forEach.call(document.body.children, lift) }
	new MutationObserver(function (records) {
		if (!layer) return
		records.forEach(function (r) { Array.prototype.forEach.call(r.addedNodes, lift) })
	}).observe(document.body, { childList: true })

	// a click on any of CRM's own menu rows leaves our page (and CRM goes where the row says)
	document.addEventListener("click", function (e) {
		if (!layer || !pagePath) return
		// any row of CRM's menu (Notifications included: its panel would open underneath this page)
		var a = e.target && e.target.closest && e.target.closest("nav a[href], aside a[href], nav button, aside button, #notifications-btn")
		// no history.back() here: the row is about to take CRM somewhere itself, and a "back" queued first would undo that move
		if (a && !a.closest("[data-cra]")) close(true)
	}, true)
	// CRM moved to another screen by itself (its menu, a link): our page is not the current one any more
	window.addEventListener("cra:route", function () { if (layer && pagePath && location.pathname !== pagePath) close(true) })

	function close(noBack) {
		var had = layer
		var wasPage = pagePath
		if (had) {
			document.removeEventListener("keydown", onKey, true)
			had.remove()
		}
		lightMenu("")
		unfollow()
		pagePath = ""
		layer = null
		frameEl = null
		layerKind = ""
		pending = null
		if (had && returnFocus && document.contains(returnFocus)) { try { returnFocus.focus({ preventScroll: true }) } catch (e) { /* ignore */ } }
		returnFocus = null
		// the address was changed to ours when the page opened: put it back, unless CRM (or Back) already moved it
		if (had && wasPage && noBack !== true && location.pathname === wasPage) { try { history.back() } catch (e) { /* ignore */ } }
	}

	// Focus is in the CRM page (not in the frame) when this runs, so the page inside cannot handle Esc itself.
	function onKey(e) { if (e.key === "Escape" && layer && !pagePath) { e.preventDefault(); e.stopPropagation(); close() } }

	function hashOf(h) { h = h ? String(h) : ""; return h && h.charAt(0) !== "#" ? "#" + h : h }

	function open(kind, params, opts, hash, fromUrl) {
		var switching = !!pagePath // from one of our pages to another: the address is swapped, not stacked
		var previous = pagePath
		if (switching) { var l = layer; layer = null; pagePath = ""; if (l) l.remove(); document.removeEventListener("keydown", onKey, true); lightMenu("") }
		else close()
		var K = KINDS[kind]
		var large = K.large
		var edge = PAGES[kind] && window.innerWidth >= 900 ? sidebarEdge() : 0
		var q = new URLSearchParams(Object.assign({ embed: "1", theme: theme() }, params || {}))
		if (edge) q.set("inline", "1")
		if (kind === "editor" || kind === "followup") q.set("mode", kind)

		returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null
		layer = document.createElement("div")
		layer.setAttribute("data-crm-addons", kind)
		layer.setAttribute("aria-label", K.title)
		if (!edge) { layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true") }
		// pointer-events: CRM's own dialogs lock the page (body { pointer-events: none }) and we are a child of the body
		layer.style.cssText = edge
			? "position:fixed;top:0;right:0;bottom:0;left:" + edge + "px;z-index:30;pointer-events:auto;overscroll-behavior:contain;background:" + (theme() === "dark" ? "#0b1020" : "#ffffff")
			: "position:fixed;inset:0;z-index:2147483000;pointer-events:auto;overscroll-behavior:contain;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:" + (!large ? "16px" : "clamp(8px,3vh,32px) clamp(8px,3vw,40px)")
		var frame = document.createElement("iframe")
		frame.src = K.url + "&" + q.toString() + hashOf(hash)
		frame.title = K.title
		frame.allow = "clipboard-write"
		frame.style.cssText = edge
			? "display:block;border:0;width:100%;height:100%;background:transparent"
			: "border:0;background:var(--bg,#fff);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);width:" + (!large ? "min(680px,100%);height:min(720px,100%)" : "min(1240px,100%);height:100%")
		layer.appendChild(frame)
		frameEl = frame
		layerKind = kind
		if (!edge) layer.addEventListener("mousedown", function (e) { if (e.target === layer) close() })
		document.body.appendChild(layer)
		if (edge) {
			pagePath = "/crm/pro-pack-" + PAGES[kind]
			lightMenu(kind)
			followMenu(layer)
			try {
				if (switching) history.replaceState({ cra: PAGES[kind] }, "", pagePath + hashOf(hash))
				else if (!fromUrl) history.pushState({ cra: PAGES[kind] }, "", pagePath + hashOf(hash))
			} catch (e) { /* the address stays as it was */ }
		}
		document.addEventListener("keydown", onKey, true)
		liftAll()
		pending = opts || {}
		// the page inside gets the keyboard (Esc, shortcuts) once it is there
		frame.addEventListener("load", function () { if (frameEl === frame) { try { frame.focus() } catch (e) { /* ignore */ } } })
		try { frame.focus() } catch (e) { /* ignore */ }
	}

	window.addEventListener("message", function (e) {
		if (e.origin !== location.origin || !e.data || e.data.source !== "crm-addons") return
		// only the pop-up that is open now may speak: a page that was closed a moment ago must not close the next one
		if (!frameEl || e.source !== frameEl.contentWindow) return
		var d = e.data
		if (d.type === "saved") {
			window.dispatchEvent(new CustomEvent("crm-addons:changed", { detail: d.meeting }))
			if (pending && typeof pending.onSaved === "function") pending.onSaved(d.meeting)
			if (d.followup) window.dispatchEvent(new CustomEvent("crm-addons:follow-up-saved", { detail: d }))
		} else if (d.type === "resize") {
			// the editor is a small panel: fit it to the form instead of leaving empty space
			if (frameEl && !pagePath && !KINDS[layerKind].large && d.height) frameEl.style.height = Math.min(d.height + 2, window.innerHeight - 32) + "px"
		} else if (d.type === "close") {
			if (!pagePath) close() // a page is left through CRM's menu or Back, not by a script inside it
		} else if (d.type === "navigate" && d.url) {
			// a lead / meeting / campaign link inside a pop-up: the CRM tab goes there, the pop-up goes away
			try {
				var u = new URL(d.url, location.origin)
				close(true)
				// the server writes absolute links with the site's configured host name, which can differ from the address
				// this tab was opened on (an IP, another domain): the path is what matters, and it stays on this origin
				if (u.origin === location.origin || /^\/(crm|app)(\/|$)/.test(u.pathname)) window.location.assign(u.pathname + u.search + u.hash)
			} catch (err) { close() }
		}
	})
	// Back / Forward moved the CRM somewhere else: a pop-up left over the new page would be a trap
	window.addEventListener("popstate", function () { close(true) })

	window.crmAddons = {
		version: 2,
		ver: VER,
		config: config,
		close: close,
		openCalendar: function (p) { open("calendar", p) },
		openEditor: function (p) {
			p = p || {}
			var params = {}
			if (p.meeting) params.meeting = String(p.meeting.name || p.meeting)
			else {
				if (p.reference_doctype) params.reference_doctype = p.reference_doctype
				if (p.reference_docname) params.reference_name = p.reference_docname
			}
			open("editor", params, p)
		},
		// large pop-ups; the page inside has an "Open in a new tab" button for the full screen version
		openDashboard: function (hash) { open("dashboard", {}, null, typeof hash === "string" ? hash : "") },
		openFollowUps: function (hash) { open("followups", {}, null, typeof hash === "string" ? hash : "") },
		openCampaigns: function (hash) { open("campaigns", {}, null, typeof hash === "string" ? hash : "") },
		openAssignment: function (hash) { open("assignment", {}, null, typeof hash === "string" ? hash : "") },
		openDemos: function (hash) { open("demos", {}, null, typeof hash === "string" ? hash : "") },
		openAccess: function (hash) { open("access", {}, null, typeof hash === "string" ? hash : "") },
		openSettings: function (hash) { open("settings", {}, null, typeof hash === "string" ? hash : "") },
		// a reload (or a shared link) on /crm/pro-pack-<name>: open that page. False while CRM has not drawn its menu yet.
		openPage: function (slug) {
			var kind = Object.keys(PAGES).filter(function (k) { return PAGES[k] === slug })[0]
			if (!kind || sidebarEdge() <= 0 || window.innerWidth < 900) return false
			if (layer && pagePath === "/crm/pro-pack-" + slug) return true
			open(kind, kind === "calendar" ? { view: "agenda", reference_doctype: "CRM Lead" } : {}, null, location.hash, true)
			return true
		},
		openFollowUp: function (p) {
			p = p || {}
			var params = {}
			if (p.reference_docname) params.reference_name = p.reference_docname
			if (p.entry) params.followup = String(p.entry.name || p.entry)
			open("followup", params, p)
		},
		openMeeting: function (name) { open("calendar", { meeting: String(name), view: "agenda" }) },
	}
})()
