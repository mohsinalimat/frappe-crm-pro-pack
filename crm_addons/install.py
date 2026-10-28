"""Everything the app sets up in a CRM site, on install and on every migrate.

All steps are idempotent: they add what is missing and never overwrite what an
admin has customised (settings, dashboard layout, the quick-entry layout).
"""

import json

import frappe

APP_VERSION_KEY = "crm_addons_scripts_version"
SEEDED_KEY = "crm_addons_dashboard_seeded"  # comma-separated chart groups already added once
SCRIPT_VERSION = "6"  # bump when the scripts below change
SCRIPT_PREFIX = "CRM Add-ons"

NEW_SETTING_DEFAULTS = {
	"lead_scoring_enabled": 1,
	"stale_lead_days": 7,
	"missed_call_whatsapp_text": "Hi, I just tried to call you but could not reach you. When is a good time to talk?",
	"enable_follow_ups": 1,
	"follow_up_reminders": 1,
	"escalate_after_attempts": 3,
	"show_floating_buttons": 1,
	"show_sidebar_links": 1,
	"show_record_tabs": 1,
	"show_follow_up_button": 1,
	"hide_deals_menu": 0,
	"hide_notes_menu": 0,
	"hide_tasks_menu": 0,
	"hide_call_logs_menu": 0,
	"hide_convert_button": 0,
	"campaigns_enabled": 1,
	"campaign_batch_size": 100,
	"campaign_rate_per_minute": 300,
	"campaign_max_retries": 2,
	"whatsapp_consent_mode": "Require opt-in",
	"campaign_alerts_enabled": 1,
	"campaign_alert_failure_percent": 30,
	"campaign_alert_min_messages": 20,
}

NEXT_FOLLOWUP_FIELD = {
	"fieldname": "next_follow_up_on",
	"fieldtype": "Datetime",
	"label": "Next Follow-up",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
	"description": "Set automatically by Frappe CRM Suite Pro.",
}

SCORE_FIELD = {
	"fieldname": "addons_score",
	"fieldtype": "Int",
	"label": "Lead Score",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
	"description": "0-100, worked out by Frappe CRM Suite Pro from calls, outcomes, meetings and recent activity.",
}

STALE_FIELD = {
	"fieldname": "addons_stale_alerted_on",
	"fieldtype": "Date",
	"label": "Stale Alert Sent On",
	"read_only": 1,
	"hidden": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 1,
}

NEXT_MEETING_FIELD = {
	"fieldname": "next_meeting_on",
	"fieldtype": "Datetime",
	"label": "Next Meeting",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
	"description": "Set automatically by Frappe CRM Suite Pro.",
}

# Consent is the one thing a campaign must never lose, so this field is NOT removed on uninstall.
WA_OPT_IN_FIELD = {
	"fieldname": "crm_wa_opt_in",
	"fieldtype": "Check",
	"label": "WhatsApp Opt-in",
	"no_copy": 1,
	"in_standard_filter": 1,
	"description": "The lead agreed to receive WhatsApp messages. Meta requires this for marketing templates.",
}

# Demo booking: the first campaign a new Lead came from. Like the consent field above, it is data, so it is NOT removed on uninstall.
DEMO_LEAD_FIELDS = [
	{"fieldname": "crm_demo_first_utm_source", "fieldtype": "Data", "label": "First UTM Source", "read_only": 1, "no_copy": 1, "in_standard_filter": 1, "description": "Where the lead first came from, when it started with a demo booking."},
	{"fieldname": "crm_demo_first_utm_medium", "fieldtype": "Data", "label": "First UTM Medium", "read_only": 1, "no_copy": 1},
	{"fieldname": "crm_demo_first_utm_campaign", "fieldtype": "Data", "label": "First UTM Campaign", "read_only": 1, "no_copy": 1},
]

# Meta lead ads: where a lead came from. Data, so (like the fields above) not removed on uninstall.
META_LEAD_FIELDS = [
	{"fieldname": f, "fieldtype": "Data", "label": label, "read_only": 1, "no_copy": 1, **extra}
	for f, label, extra in (
		("crm_meta_form", "Meta Lead Form", {"in_standard_filter": 1}), ("crm_meta_campaign_name", "Meta Campaign", {"in_standard_filter": 1}),
		("crm_meta_campaign_id", "Meta Campaign ID", {}), ("crm_meta_adset_name", "Meta Ad Set", {}), ("crm_meta_adset_id", "Meta Ad Set ID", {}),
		("crm_meta_ad_name", "Meta Ad", {}), ("crm_meta_ad_id", "Meta Ad ID", {}), ("crm_meta_leadgen_id", "Meta Lead ID", {"search_index": 1}),
	)
]

STARTER_EMAIL_TEMPLATES = [
	(
		"Follow-up (starter)",
		"Following up on your enquiry, {{ first_name }}",
		"<p>Hi {{ first_name }},</p><p>{{ owner_name or sender_name }} from our team is following up on your enquiry. "
		"Reply to this email or call us whenever it suits you.</p><p>Regards,<br>{{ sender_name }}</p>",
	),
]

# -- CRM scripts ----------------------------------------------------------------------
# Loaded by CRM's own script engine, so no CRM source file is ever edited.

LOADER = """// Managed by the Frappe CRM Suite Pro app. It is rewritten when the app updates - do not edit.
function crmAddonsLoad() {
	// the page's own Suite Pro script did not start (an old saved copy of the CRM page): start it from here
	if (!window.__crmAddonsUI && !window.__craEnsuring) {
		window.__craEnsuring = true
		const a = document.createElement("script")
		a.src = "/assets/crm_addons/addons.js?v=__VERSION__"
		document.head.appendChild(a)
	}
	if (window.crmAddons) return Promise.resolve(window.crmAddons)
	// the add-on script is already on the page and knows the current version of every file
	if (window.crmAddonsUI && window.crmAddonsUI.loadBridge) return window.crmAddonsUI.loadBridge()
	return new Promise((resolve, reject) => {
		const s = document.createElement("script")
		s.src = "/assets/crm_addons/bridge.js?v=__VERSION__"
		s.onload = () => resolve(window.crmAddons)
		s.onerror = () => reject(new Error("Frappe CRM Suite Pro could not be loaded"))
		document.head.appendChild(s)
	})
}
"""

FORM_SCRIPT = (
	LOADER
	+ """
class __CLASS__ {
	async onLoad() {
		let cm
		try { cm = await crmAddonsLoad() } catch (e) { return }
		const config = await cm.config()
		const buttons = []
		if (config.show_record_buttons) {
			buttons.push({
				label: "Schedule Meeting",
				icon: "calendar",
				onClick: () => cm.openEditor({ reference_doctype: "__DT__", reference_docname: this.doc.name }),
			})
		}
		if (config.follow_ups_enabled && config.show_follow_up_button) {
			buttons.push({
				label: "Add Follow Up",
				icon: "phone-call",
				onClick: () => cm.openFollowUp({ reference_docname: this.doc.name }),
			})
		}
		if (!buttons.length) return
		// append, never replace: other scripts may have added their own buttons
		this.actions = [...(this.actions || []), ...buttons]
	}
}
"""
)

LIST_SCRIPT = (
	LOADER
	+ """
async function setupList() {
	let cm
	try { cm = await crmAddonsLoad() } catch (e) { return {} }
	const config = await cm.config()
	if (!config.show_list_button) return {}
	const actions = [
		{ label: "Meetings", icon: "calendar", onClick: () => cm.openCalendar({ reference_doctype: "__DT__", view: "agenda" }) },
	]
	if (config.follow_ups_enabled) {
		actions.push({
			label: "Follow-ups",
			icon: "phone-call",
			onClick: () => window.crmAddonsUI && window.crmAddonsUI.openQueue("__DT__"),
		})
	}
	return { actions }
}
"""
)

SCRIPTS = [
	# (record name, doctype, view, class name, template)
	("Lead page", "CRM Lead", "Form", "CRMLead", FORM_SCRIPT),
	("Leads list", "CRM Lead", "List", None, LIST_SCRIPT),
]

LAST_OUTCOME_FIELD = {
	"fieldname": "addons_last_outcome",
	"fieldtype": "Data",
	"label": "Last Call Outcome",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
}

LAST_REMARK_FIELD = {
	"fieldname": "addons_last_remark",
	"fieldtype": "Small Text",
	"label": "Last Follow-up Remark",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
}

ATTEMPT_FIELD = {
	"fieldname": "addons_call_attempts",
	"fieldtype": "Int",
	"label": "Call Attempt",
	"read_only": 1,
	"no_copy": 1,
	"print_hide": 1,
	"report_hide": 0,
	"description": "The attempt number of the latest call: calls in a row until someone picked up.",
}

CUSTOM_FIELDS = [
	NEXT_MEETING_FIELD,
	NEXT_FOLLOWUP_FIELD,
	LAST_OUTCOME_FIELD,
	LAST_REMARK_FIELD,
	ATTEMPT_FIELD,
	SCORE_FIELD,
	STALE_FIELD,
]

DEFAULT_TEMPLATES = [
	# title, outcome, remark, next follow-up after (hours)
	("Did not pick - try in 2 hours", "Did Not Pick", "Phone was ringing, no pick-up.", 2),
	("Did not pick - try tomorrow", "Did Not Pick", "Did not pick up.", 24),
	("Did not connect - try tomorrow", "Did Not Connect", "Busy, switched off or not reachable.", 24),
	("Interested - follow up in 2 days", "Interested", "Interested. Follow up in a couple of days.", 48),
	("Ask for detail - send and follow up", "Ask for Detail", "Asked for details. Send them and follow up.", 48),
	("Call back later", "Call Back Later", "Asked to be called back later.", 72),
	("Meeting scheduled", "Meeting Scheduled", "Meeting agreed.", 0),
	("Not interested", "Not Interested", "Not interested right now.", 0),
]

DASHBOARD_GROUPS = {
	# group: [(name, type, x, y-offset (rows below the bottom at the time), w, h)]
	"meetings": [
		("meetings_today", "number_chart", 0, 0, 4, 3),
		("upcoming_meetings_week", "number_chart", 4, 0, 4, 3),
		("meetings_in_period", "number_chart", 8, 0, 4, 3),
		("meetings_by_day", "axis_chart", 0, 3, 10, 9),
		("meetings_by_status", "donut_chart", 10, 3, 10, 9),
	],
	"insights": [
		("activity_by_salesperson", "axis_chart", 0, 0, 10, 9),
		("leads_by_score_band", "donut_chart", 10, 0, 10, 9),
		("meetings_by_outcome", "donut_chart", 0, 9, 10, 9),
	],
	"follow_ups": [
		("follow_ups_due_today", "number_chart", 0, 0, 4, 3),
		("overdue_follow_ups", "number_chart", 4, 0, 4, 3),
		("call_connect_rate", "number_chart", 8, 0, 4, 3),
		("attempts_to_connect", "number_chart", 12, 0, 4, 3),
		("follow_ups_by_day", "axis_chart", 0, 3, 10, 9),
		("follow_ups_by_outcome", "donut_chart", 10, 3, 10, 9),
		("calls_by_status", "donut_chart", 0, 12, 10, 9),
	],
}
DASHBOARD_ITEMS = [item for group in DASHBOARD_GROUPS.values() for item in group]


def after_install():
	run_all()


def after_migrate():
	run_all()


def ensure_campaign_role():
	"""The role that can create and change campaigns without being a Sales Manager."""
	if not frappe.db.exists("Role", "Campaign Manager"):
		frappe.get_doc({"doctype": "Role", "role_name": "Campaign Manager", "desk_access": 1}).insert(ignore_permissions=True)


def run_all():
	ensure_campaign_role()
	if not frappe.db.exists("DocType", "CRM Lead"):
		return  # Frappe CRM is not on this site
	ensure_settings()
	remove_deal_leftovers()
	ensure_custom_fields()
	ensure_meta_setup()
	ensure_inbox_setup()
	ensure_templates()
	ensure_quick_entry_layout()
	ensure_scripts()
	ensure_dashboard()
	ensure_workspace()
	backfill_next_meetings()
	ensure_campaign_setup()
	ensure_demo_setup()
	ensure_whatsapp_template_fields()
	ensure_view_fields()
	ensure_default_email_templates()
	ensure_user_fields()
	ensure_access_presets()
	sync_email_templates()


def sync_email_templates():
	"""Mirror campaign email templates and CRM's own Email Templates into each other (see campaigns/email_sync.py)."""
	from crm_addons.campaigns import email_sync

	try:
		email_sync.backfill()
	except Exception:
		frappe.log_error(title="Frappe CRM Suite Pro: email template sync", message=frappe.get_traceback())


# -- Desk workspace --------------------------------------------------------------------------

WORKSPACE = "CRM Pro Pack"  # the stored name of the Desk workspace: kept so existing sites do not get a second one
WORKSPACE_SHORTCUTS = [
	# label, type, target (a doctype, or a URL)
	("CRM Addons Settings", "DocType", "CRM Addons Settings"),
	("Meetings", "DocType", "CRM Meeting"),
	("Follow-ups", "DocType", "CRM Follow Up"),
	("Follow-up Templates", "DocType", "CRM Follow Up Template"),
	("Sales Dashboard", "URL", "/sales-dashboard"),
	("Campaign Manager", "URL", "/campaigns"),
	("Campaigns", "DocType", "CRM Campaign"),
	("Campaign Email Templates", "DocType", "CRM Campaign Email Template"),
	("Campaign Opt-outs", "DocType", "CRM Campaign Opt Out"),
	("Demo Types", "DocType", "CRM Demo Type"),
	("Demo Bookings", "DocType", "CRM Demo Booking"),
]


def ensure_workspace():
	"""A Desk workspace with the app's settings, lists and the Sales Dashboard, so they can be
	found without knowing the doctype names. Created once; after that the admin owns it. It is
	only a convenience: if the site's Frappe cannot create it, everything else still works."""
	if not frappe.db.exists("DocType", "Workspace") or frappe.db.exists("Workspace", WORKSPACE):
		return
	try:
		blocks = [
			{"id": frappe.generate_hash(length=10), "type": "header", "data": {"text": '<span class="h4"><b>Frappe CRM Suite Pro</b></span>', "col": 12}}
		] + [
			{"id": frappe.generate_hash(length=10), "type": "shortcut", "data": {"shortcut_name": label, "col": 3}}
			for label, _type, _target in WORKSPACE_SHORTCUTS
		]
		shortcuts = [
			{"label": label, "type": kind, **({"link_to": target, "doc_view": "List"} if kind == "DocType" else {"url": target})}
			for label, kind, target in WORKSPACE_SHORTCUTS
		]
		frappe.get_doc(
			{
				"doctype": "Workspace",
				"name": WORKSPACE,
				"label": WORKSPACE,
				"title": WORKSPACE,
				"module": "Meetings",
				"public": 1,
				"content": json.dumps(blocks),
				"shortcuts": shortcuts,
			}
		).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Frappe CRM Suite Pro: could not create the Desk workspace", message=frappe.get_traceback())


# -- settings ----------------------------------------------------------------------------


def ensure_settings():
	"""Create the settings with sensible defaults; auto-select a connected Google Calendar."""
	from crm_addons.providers.google_meet import _usable

	first_time = not frappe.db.sql("select 1 from `tabSingles` where doctype = 'CRM Addons Settings' limit 1")
	settings = frappe.get_doc("CRM Addons Settings")
	changed = first_time

	if not settings.google_calendar:
		usable = [
			name
			for name in frappe.get_all(
				"Google Calendar", filters={"enable": 1, "push_to_google_calendar": 1}, pluck="name"
			)
			if _usable(name)
		]
		if len(usable) == 1:  # unambiguous: use it, the admin can change it later
			settings.google_calendar = usable[0]
			changed = True

	if changed:
		settings.flags.ignore_permissions = True
		settings.save()

	# Settings added after a site's first install have no stored value and would read as "off".
	for fieldname, value in NEW_SETTING_DEFAULTS.items():
		stored = frappe.db.sql(
			"select 1 from `tabSingles` where doctype = 'CRM Addons Settings' and field = %s limit 1", fieldname
		)
		if not stored:
			frappe.db.set_single_value("CRM Addons Settings", fieldname, value)
	frappe.clear_document_cache("CRM Addons Settings", "CRM Addons Settings")


def ensure_campaign_setup():
	"""Campaign Manager: the Lead's consent field and one starter email template. Idempotent, and it
	never touches anything an admin already changed."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"CRM Lead": [WA_OPT_IN_FIELD]}, ignore_validate=True)
	if frappe.db.get_default("crm_addons_campaign_templates_seeded") or not frappe.db.exists(
		"DocType", "CRM Campaign Email Template"
	):
		return
	for title, subject, body in STARTER_EMAIL_TEMPLATES:
		if not frappe.db.exists("CRM Campaign Email Template", title):
			frappe.get_doc(
				{"doctype": "CRM Campaign Email Template", "template_name": title, "subject": subject, "body_html": body, "enabled": 1}
			).insert(ignore_permissions=True)
	frappe.db.set_default("crm_addons_campaign_templates_seeded", "1")


def ensure_demo_setup():
	"""Demo booking: the Lead's first-touch UTM fields and the indexes the booking queries rely on. Idempotent; seeds no demo type."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"CRM Lead": [dict(f) for f in DEMO_LEAD_FIELDS]}, ignore_validate=True)
	if not frappe.db.exists("DocType", "CRM Demo Booking"):
		return
	try:
		# email, phone and status already have single-column indexes (search_index in the doctype); this one serves the slot and list queries
		frappe.db.add_index("CRM Demo Booking", ["demo_type", "starts_utc"])
		frappe.db.add_index("CRM Demo Booking Message", ["status", "due_at"])
	except Exception:
		frappe.log_error(title="Frappe CRM Suite Pro: could not add the demo booking indexes", message=frappe.get_traceback())


WA_TEMPLATE_FIELDS = [
	{
		"fieldname": "crm_system", "fieldtype": "Check", "label": "Ready-made by Frappe CRM Suite Pro", "read_only": 1, "no_copy": 1, "default": "0",
		"description": "Created by the app for its own messages. Protected from deletion.", "insert_after": "crm_variable_map",
	},
	{
		"fieldname": "crm_variable_map", "fieldtype": "Long Text", "label": "Default variable mapping (Frappe CRM Suite Pro)", "read_only": 1,
		"description": "Which Lead field fills each {{n}} by default when a campaign uses this template.", "insert_after": "field_names",
	}
]


def ensure_view_fields():
	"""A mark on CRM's saved views, so the app can tell the views it wrote from the ones a person changed (views.py)."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if frappe.db.exists("DocType", "CRM View Settings"):
		create_custom_fields(
			{"CRM View Settings": [{"fieldname": "crm_addons_sig", "fieldtype": "Data", "label": "Frappe CRM Suite Pro mark", "read_only": 1, "hidden": 1, "no_copy": 1}]}, ignore_validate=True
		)


def ensure_whatsapp_template_fields():
	"""A column on frappe_whatsapp's templates for the default variable mapping. Only when frappe_whatsapp is installed."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	if frappe.db.exists("DocType", "WhatsApp Templates"):
		create_custom_fields({"WhatsApp Templates": WA_TEMPLATE_FIELDS}, ignore_validate=True)
		# the ready-made booking templates already on the site are protected like new ones
		from crm_addons.demos import defaults

		names = [s["template_name"] for s in defaults.WHATSAPP.values()]
		frappe.db.sql("update `tabWhatsApp Templates` set crm_system = 1 where template_name in %(n)s or actual_name in %(n)s", {"n": names})


def ensure_default_email_templates():
	"""Ready-made email templates (campaigns/default_templates.py), added once per release. The admin owns them after
	that: edit, archive or delete them; a deleted one is not brought back until the next release adds more."""
	from crm_addons.campaigns import default_templates as dt
	from crm_addons.demos import defaults as booking_defaults

	if not frappe.db.exists("DocType", "CRM Campaign Email Template") or frappe.db.get_default("crm_addons_default_email_templates") == dt.VERSION:
		return
	booking_names = set(booking_defaults.EMAIL.values())
	for name, subject, category, description, builder_json, body_html in dt.default_templates():
		old = next((o for o, n in dt.RENAMED.items() if n == name), None)
		if old and frappe.db.exists("CRM Campaign Email Template", old) and not frappe.db.exists("CRM Campaign Email Template", name):
			frappe.rename_doc("CRM Campaign Email Template", old, name, force=True)  # the booking rules that use it follow
			doc = frappe.get_doc("CRM Campaign Email Template", name)
			if (doc.modified - doc.creation).total_seconds() < 120:  # not edited since it was seeded: bring the new wording too
				doc.update({"subject": subject, "description": description, "builder_json": builder_json, "body_html": body_html})
				doc.save(ignore_permissions=True)
			continue
		if frappe.db.exists("CRM Campaign Email Template", name):
			continue
		frappe.get_doc(
			{
				"doctype": "CRM Campaign Email Template", "template_name": name, "subject": subject, "category": category, "description": description,
				"editor_mode": "Visual Builder", "builder_json": builder_json, "body_html": body_html, "enabled": 1, "is_system": 1 if name in booking_names else 0,
			}
		).insert(ignore_permissions=True)
	# The booking messages are System templates (the app's own service messages, not marketing). Sites that seeded them as "Transactional" or with the old
	# "demo" wording get the new category, and the new wording when the text is still the ready-made one.
	fresh = {n: (sub, desc, bj, bh) for n, sub, c, desc, bj, bh in dt.default_templates()}
	for n in list(booking_names) + ["Counselling session reminder"]:
		if n in fresh and frappe.db.exists("CRM Campaign Email Template", n):
			doc = frappe.get_doc("CRM Campaign Email Template", n)
			changed = False
			if doc.category != "System":
				doc.category, changed = "System", True
			if any(m in (doc.body_html or "") for m in ("Join the demo", "Your demo ", "demo_title")) and n in booking_names:
				doc.update({"subject": fresh[n][0], "description": fresh[n][1], "builder_json": fresh[n][2], "body_html": fresh[n][3]})
				changed = True
			if changed:
				doc.flags.ignore_permissions = True
				doc.save()
	# the booking messages are protected from deletion (see campaigns/api.py): mark the ones already on the site too
	booking = list(booking_names)
	if booking and frappe.get_meta("CRM Campaign Email Template").has_field("is_system"):
		frappe.db.sql("update `tabCRM Campaign Email Template` set is_system = 1 where name in %s", (booking,))
	frappe.db.set_default("crm_addons_default_email_templates", dt.VERSION)


USER_FIELDS = [
	{"fieldname": "crm_designation", "fieldtype": "Data", "label": "Designation", "insert_after": "mobile_no", "description": "Shown next to the name in Team and access (Frappe CRM Suite Pro)."},
	{"fieldname": "crm_company", "fieldtype": "Data", "label": "Company", "insert_after": "crm_designation"},
]


def ensure_user_fields():
	"""Designation and company on the User, set from Team and access. They are data, so uninstalling does not remove them."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"User": [dict(f) for f in USER_FIELDS]}, ignore_validate=True)


def ensure_access_presets():
	"""The ready-made access presets (team_access/presets.py), added once per version. The admin owns them after that."""
	import json

	from crm_addons.team_access import presets

	if not frappe.db.exists("DocType", "CRM Access Preset") or frappe.db.get_default("crm_addons_access_presets") == presets.VERSION:
		return
	# "Demo Host" is now "Booking Host": rename the ready-made one (people using it follow), unless the admin already made their own with the new name
	if frappe.db.exists("CRM Access Preset", "Demo Host") and not frappe.db.exists("CRM Access Preset", "Booking Host"):
		frappe.rename_doc("CRM Access Preset", "Demo Host", "Booking Host", force=True)
		frappe.db.set_value("CRM Access Preset", "Booking Host", "preset_name", "Booking Host")
	for name, description, grants in presets.PRESETS:
		if frappe.db.exists("CRM Access Preset", name):
			continue
		frappe.get_doc({"doctype": "CRM Access Preset", "preset_name": name, "description": description, "is_system": 1, "grants": json.dumps(grants)}).insert(ignore_permissions=True)
	frappe.db.set_default("crm_addons_access_presets", presets.VERSION)


def backfill_next_meetings():
	"""Fill the "Next Meeting" column for meetings that already exist."""
	from crm_addons.utils import refresh_next_meeting

	for row in frappe.db.sql(
		"select distinct reference_doctype, reference_docname from `tabCRM Meeting` where status = 'Scheduled'"
	):
		refresh_next_meeting(*row)


# -- Leads only: remove what an earlier version added to Deals -----------------------------------------------


def remove_deal_leftovers():
	"""This app works on Leads only. Clean up the Deal scripts and fields older versions created."""
	if frappe.db.exists("DocType", "CRM Form Script"):
		keep = {f"{SCRIPT_PREFIX}: {label}" for label, *_rest in SCRIPTS}
		for name in frappe.get_all("CRM Form Script", filters={"name": ["like", f"{SCRIPT_PREFIX}:%"]}, pluck="name"):
			if name not in keep:
				frappe.delete_doc("CRM Form Script", name, force=1, ignore_permissions=True)
	for definition in CUSTOM_FIELDS:
		field = f"CRM Deal-{definition['fieldname']}"
		if frappe.db.exists("Custom Field", field):
			frappe.delete_doc("Custom Field", field, force=1, ignore_permissions=True)


# -- follow-up templates ------------------------------------------------------------------------------


def ensure_templates():
	"""Add the starter templates once. After that the admin owns them (edit, disable, delete)."""
	if frappe.db.get_default("crm_addons_templates_seeded") or not frappe.db.exists("DocType", "CRM Follow Up Template"):
		return
	for title, outcome, remark, hours in DEFAULT_TEMPLATES:
		if not frappe.db.exists("CRM Follow Up Template", title):
			frappe.get_doc(
				{
					"doctype": "CRM Follow Up Template",
					"title": title,
					"outcome": outcome,
					"remark": remark,
					"next_follow_up_after_hours": hours,
				}
			).insert(ignore_permissions=True)
	frappe.db.set_default("crm_addons_templates_seeded", "1")


# -- custom fields ------------------------------------------------------------------------


def ensure_meta_setup():
	"""The lead fields that say which Meta campaign, ad set and ad a lead came from, and the Facebook / Instagram lead sources."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"CRM Lead": [dict(f) for f in META_LEAD_FIELDS]}, ignore_validate=True)
	if frappe.db.exists("DocType", "CRM Lead Source"):
		for name in ("Facebook", "Instagram"):
			if not frappe.db.exists("CRM Lead Source", name):
				frappe.get_doc({"doctype": "CRM Lead Source", "source_name": name}).insert(ignore_permissions=True)


def ensure_inbox_setup():
	"""The chat key on every WhatsApp message (so a chat is found by index, not by scanning numbers), the WhatsApp lead source, and the chats of messages that already exist."""
	if not frappe.db.exists("DocType", "WhatsApp Message"):
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields({"WhatsApp Message": [{"fieldname": "crm_chat_key", "fieldtype": "Data", "label": "CRM Chat Key", "hidden": 1, "read_only": 1, "search_index": 1, "insert_after": "type"}]}, ignore_validate=True)
	if frappe.db.exists("DocType", "CRM Lead Source") and not frappe.db.exists("CRM Lead Source", "WhatsApp"):
		frappe.get_doc({"doctype": "CRM Lead Source", "source_name": "WhatsApp"}).insert(ignore_permissions=True)
	if frappe.db.exists("DocType", "CRM WhatsApp Chat") and not frappe.db.count("CRM WhatsApp Chat"):
		from crm_addons.pro import inbox

		inbox.rebuild()


def ensure_custom_fields():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{"CRM Lead": list(CUSTOM_FIELDS)}, ignore_validate=True
	)


# -- quick-entry layout (Desk / generic CRM dialogs) ---------------------------------------------

QUICK_ENTRY_LAYOUT = [
	{
		"name": "first_tab",
		"sections": [
			{"name": "meeting_section", "columns": [{"name": "meeting_column", "fields": ["subject"]}]},
			{
				"name": "time_section",
				"columns": [
					{"name": "starts_column", "fields": ["starts_on"]},
					{"name": "ends_column", "fields": ["ends_on"]},
				],
				"hideBorder": True,
			},
			{
				"name": "details_section",
				"columns": [{"name": "details_column", "fields": ["add_video_conferencing", "description"]}],
				"hideBorder": True,
			},
		],
	}
]


def ensure_quick_entry_layout():
	if not frappe.db.exists("DocType", "CRM Fields Layout"):
		return
	if frappe.db.exists("CRM Fields Layout", {"dt": "CRM Meeting", "type": "Quick Entry"}):
		return
	frappe.get_doc(
		{
			"doctype": "CRM Fields Layout",
			"dt": "CRM Meeting",
			"type": "Quick Entry",
			"layout": json.dumps(QUICK_ENTRY_LAYOUT),
		}
	).insert(ignore_permissions=True)


# -- CRM form / list scripts ----------------------------------------------------------------------


def _script_body(template, dt, cls):
	return template.replace("__VERSION__", SCRIPT_VERSION).replace("__DT__", dt).replace("__CLASS__", cls or "")


def ensure_scripts():
	"""Install or refresh the scripts that add the buttons to CRM. Standard scripts
	are read-only for admins outside developer mode, so they are updated in place."""
	if not frappe.db.exists("DocType", "CRM Form Script"):
		return
	for label, dt, view, cls, template in SCRIPTS:
		name = f"{SCRIPT_PREFIX}: {label}"
		body = _script_body(template, dt, cls)
		if frappe.db.exists("CRM Form Script", name):
			if frappe.db.get_value("CRM Form Script", name, "script") != body:
				frappe.db.set_value("CRM Form Script", name, {"script": body, "enabled": 1}, update_modified=False)
			continue
		frappe.get_doc(
			{
				"doctype": "CRM Form Script",
				"name": name,
				"dt": dt,
				"view": view,
				"enabled": 1,
				"is_standard": 1,
				"script": body,
			}
		).insert(ignore_permissions=True)


# -- dashboard ---------------------------------------------------------------------------------------


def _seeded():
	return {g for g in (frappe.db.get_default(SEEDED_KEY) or "").split(",") if g}


def ensure_dashboard():
	"""Add each group of add-on charts to the CRM dashboard once. After that the admin owns
	the layout: removing a chart from the dashboard is respected."""
	if not frappe.db.exists("DocType", "CRM Dashboard"):
		return
	todo = [g for g in DASHBOARD_GROUPS if g not in _seeded()]
	if not todo:
		return
	try:
		from crm.fcrm.doctype.crm_dashboard.crm_dashboard import create_default_manager_dashboard

		create_default_manager_dashboard()
		doc = frappe.get_doc("CRM Dashboard", "Manager Dashboard")
		layout = json.loads(doc.layout or "[]")
		present = {item.get("name") for item in layout}
		for group in todo:
			bottom = max((i["layout"]["y"] + i["layout"]["h"] for i in layout if i.get("layout")), default=0)
			for name, chart_type, x, dy, w, h in DASHBOARD_GROUPS[group]:
				if name not in present:
					layout.append({"name": name, "type": chart_type, "layout": {"x": x, "y": bottom + dy, "w": w, "h": h, "i": name}})
		doc.layout = json.dumps(layout)
		doc.save(ignore_permissions=True)
		frappe.db.set_default(SEEDED_KEY, ",".join(sorted(_seeded() | set(todo))))
	except Exception:
		frappe.log_error(title="CRM Add-ons: could not add the dashboard charts", message=frappe.get_traceback())


# -- uninstall ------------------------------------------------------------------------------------------


def before_uninstall():
	if frappe.db.exists("Workspace", WORKSPACE):
		frappe.delete_doc("Workspace", WORKSPACE, force=1, ignore_permissions=True)
	for name in frappe.get_all("CRM Form Script", filters={"name": ["like", f"{SCRIPT_PREFIX}:%"]}, pluck="name"):
		frappe.delete_doc("CRM Form Script", name, force=1, ignore_permissions=True)
	for dt in ("CRM Lead", "CRM Deal"):
		for definition in CUSTOM_FIELDS:
			field = f"{dt}-{definition['fieldname']}"
			if frappe.db.exists("Custom Field", field):
				frappe.delete_doc("Custom Field", field, force=1, ignore_permissions=True)
	if frappe.db.exists("CRM Fields Layout", "CRM Meeting-Quick Entry"):
		frappe.delete_doc("CRM Fields Layout", "CRM Meeting-Quick Entry", force=1, ignore_permissions=True)
	if frappe.db.exists("CRM Dashboard", "Manager Dashboard"):
		doc = frappe.get_doc("CRM Dashboard", "Manager Dashboard")
		ours = {item[0] for item in DASHBOARD_ITEMS}
		layout = [i for i in json.loads(doc.layout or "[]") if i.get("name") not in ours]
		doc.layout = json.dumps(layout)
		doc.save(ignore_permissions=True)
	frappe.db.set_default(SEEDED_KEY, "")
	frappe.db.set_default("crm_addons_templates_seeded", "")
