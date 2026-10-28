"""Does the installed Frappe CRM still have everything the Suite Pro pages use? A check lists what is missing or changed, so an update of CRM (or Frappe) that
renames a field or moves a function shows up as a clear message on the Suite Pro page instead of an error deep in a screen."""

import json

import frappe
from frappe import _

# what each page reads or writes: doctype -> fields. A missing one breaks that page.
NEEDS = {
	"CRM Lead": ["lead_name", "first_name", "last_name", "mobile_no", "phone", "email", "organization", "status", "source", "territory", "lead_owner", "job_title", "website", "industry", "image", "converted"],
	"CRM Lead Status": ["color", "type", "position"],
	"CRM Organization": ["organization_name", "website", "territory", "industry", "no_of_employees", "annual_revenue", "organization_logo"],
	"CRM Deal": ["organization", "status", "deal_owner"],
	"CRM Notification": ["to_user", "from_user", "type", "read", "notification_text", "message", "reference_doctype", "reference_name"],
	"CRM Task": ["title", "status", "priority", "due_date", "assigned_to", "reference_doctype", "reference_docname"],
	"FCRM Note": ["title", "content", "reference_doctype", "reference_docname"],
	"CRM Call Log": ["type", "status", "duration", "start_time", "caller", "receiver", "reference_doctype", "reference_docname"],
	"CRM Fields Layout": ["dt", "type", "layout"],
	"CRM Follow Up": ["mode", "call_status", "outcome", "remark", "next_follow_up_on", "reference_doctype", "reference_docname"],
	"CRM Meeting": ["subject", "status", "starts_on", "ends_on", "reference_doctype", "reference_docname"],
}
# Python functions of CRM the lead page calls (WhatsApp chat) or relies on. A missing one only disables that part.
FUNCTIONS = {
	"crm.api.whatsapp.get_whatsapp_messages": "the WhatsApp tab",
	"crm.api.whatsapp.create_whatsapp_message": "sending WhatsApp messages",
	"crm.fcrm.doctype.crm_fields_layout.crm_fields_layout.get_fields_layout": "the lead form layout",
}
OPTIONAL_DOCTYPES = {"WhatsApp Message": "the WhatsApp tab and the WhatsApp Business inbox"}
# what Suite Pro itself adds and the inbox, Meta and Calendar pages rely on: doctype -> what stops working without it
OURS = {"CRM WhatsApp Chat": "the WhatsApp Business inbox", "CRM Meta Settings": "the Meta lead-ad connection", "CRM Meta Form": "the Meta lead-ad connection", "CRM Meta Lead Log": "the Meta lead log"}


def _snapshot():
	"""What the lead form looks like now: {fieldname: fieldtype} of the lead, plus the layout fields."""
	from crm_addons.pro import form

	meta = frappe.get_meta("CRM Lead")
	return {
		"lead_fields": {df.fieldname: df.fieldtype for df in meta.fields if df.fieldtype not in form.SKIP_TYPES},
		"layouts": {k: [n for _l, names in form._layout_fieldnames(k) for n in names] for k in form.LAYOUT_TYPES},
		"versions": {"frappe": getattr(frappe, "__version__", ""), "crm": _version("crm")},
	}


def _version(app):
	try:
		return frappe.get_attr(f"{app}.__version__")
	except Exception:
		try:
			return frappe.get_module(app).__version__
		except Exception:
			return ""


def problems():
	"""[{level: error|warn, text}] for what is missing right now."""
	out = []
	for dt, fields in NEEDS.items():
		if not frappe.db.exists("DocType", dt):
			out.append({"level": "error", "text": _("{0} no longer exists in this CRM.").format(dt)})
			continue
		meta = frappe.get_meta(dt)
		missing = [f for f in fields if not meta.has_field(f)]
		if missing:
			out.append({"level": "error", "text": _("{0} no longer has: {1}.").format(dt, ", ".join(missing))})
	for path, what in FUNCTIONS.items():
		try:
			frappe.get_attr(path)
		except Exception:
			out.append({"level": "warn", "text": _("CRM no longer provides {0}; {1} will not work.").format(path, what)})
	for dt, what in OPTIONAL_DOCTYPES.items():
		if not frappe.db.exists("DocType", dt):
			out.append({"level": "warn", "text": _("{0} is not installed; {1} is switched off.").format(dt, what)})
	for dt, what in OURS.items():
		if not frappe.db.exists("DocType", dt):
			out.append({"level": "error", "text": _("{0} is missing; {1} will not work. Run bench migrate.").format(dt, what)})
	if frappe.db.exists("DocType", "WhatsApp Message") and not frappe.get_meta("WhatsApp Message").has_field("crm_chat_key"):
		out.append({"level": "error", "text": _("WhatsApp Message has no CRM Chat Key field; the WhatsApp Business inbox cannot match messages to chats. Run bench migrate.")})
	hooks = frappe.get_hooks("doc_events").get("WhatsApp Message", {})
	if "crm_addons.pro.inbox.on_validate" not in str(hooks.get("validate", [])):
		out.append({"level": "warn", "text": _("The WhatsApp Business inbox hook is not registered; new messages will not reach the inbox.")})
	from crm_addons.pro import form

	meta = frappe.get_meta("CRM Lead")
	for kind in form.LAYOUT_TYPES:
		stale = sorted({n for _l, names in form._layout_fieldnames(kind) for n in names if not meta.has_field(n)})
		if stale:
			out.append({"level": "warn", "text": _("CRM's {0} layout of the lead lists fields that no longer exist: {1}. They are skipped.").format(kind, ", ".join(stale))})
	return out


def changes(old, new):
	"""Readable differences between two snapshots (the one saved when an admin last confirmed, and now)."""
	if not old:
		return []
	out = []
	a, b = old.get("lead_fields", {}), new["lead_fields"]
	add, gone = sorted(set(b) - set(a)), sorted(set(a) - set(b))
	if add:
		out.append(_("New lead fields since you last checked: {0}.").format(", ".join(add)))
	if gone:
		out.append(_("Lead fields removed since you last checked: {0}.").format(", ".join(gone)))
	retyped = sorted(k for k in set(a) & set(b) if a[k] != b[k])
	if retyped:
		out.append(_("Lead fields whose type changed: {0}.").format(", ".join(f"{k} ({a[k]} to {b[k]})" for k in retyped)))
	for kind, names in new["layouts"].items():
		was = old.get("layouts", {}).get(kind)
		if was is not None and sorted(was) != sorted(names):
			out.append(_("CRM's {0} layout of the lead changed. These pages follow it automatically.").format(kind))
	ov, nv = old.get("versions", {}), new["versions"]
	for app in ("frappe", "crm"):
		if ov.get(app) and nv.get(app) and ov[app] != nv[app]:
			out.append(_("{0} was updated from {1} to {2}.").format(app, ov[app], nv[app]))
	return out


KEY = "crm_pro_compat_snapshot"


@frappe.whitelist()
def get_health():
	"""For the person who manages access: what is broken, and what changed since they last confirmed. Everyone else gets nothing."""
	from crm_addons.team_access import access

	if frappe.session.user == "Guest" or not access.is_admin():
		return {"problems": [], "changes": [], "show": False}
	now = _snapshot()
	raw = frappe.db.get_default(KEY)
	old = json.loads(raw) if raw else None
	if old is None:
		frappe.db.set_default(KEY, json.dumps(now))  # first run: remember today's state as the baseline
	probs, diff = problems(), changes(old, now)
	return {"problems": probs, "changes": diff, "show": bool(probs or diff), "versions": now["versions"]}


@frappe.whitelist()
def acknowledge():
	"""The admin has seen the changes: today's state becomes the new baseline."""
	from crm_addons.team_access import access

	if not access.is_admin():
		frappe.throw(_("Only an administrator can do this."), frappe.PermissionError)
	frappe.db.set_default(KEY, json.dumps(_snapshot()))
	return True
