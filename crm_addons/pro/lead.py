"""One lead, for the Suite Pro lead page: the details, notes, tasks, calls and the timeline. Reads and writes go through the document, so CRM's own
permissions decide what a person may see or change."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, strip_html

LEAD = "CRM Lead"
EDITABLE = (
	"salutation", "first_name", "last_name", "email", "mobile_no", "phone", "organization", "website", "job_title", "territory", "source", "industry",
	"gender", "no_of_employees", "annual_revenue", "status", "lead_owner", "lost_reason", "lost_notes",
)
TASK_STATUS = ("Backlog", "Todo", "In Progress", "Done", "Canceled")
PRIORITY = ("Low", "Medium", "High")


def _lead(name, perm="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	doc = frappe.get_doc(LEAD, name)
	doc.check_permission(perm)
	return doc


def _person(user):
	if not user:
		return None
	u = frappe.db.get_value("User", user, ["name", "full_name", "user_image"], as_dict=True)
	return {"name": user, "full_name": (u and u.full_name) or user, "image": u and u.user_image}


@frappe.whitelist()
def get_lead(name):
	doc = _lead(name)
	d = doc.as_dict()
	out = {k: d.get(k) for k in ("name", "lead_name", "image", "creation", "modified", "owner", "converted", "addons_score", "next_follow_up_on", "next_meeting_on", "addons_last_outcome", "addons_last_remark", "addons_call_attempts", "crm_wa_opt_in", "crm_demo_first_utm_source", "crm_demo_first_utm_medium", "crm_demo_first_utm_campaign")}
	out.update({k: d.get(k) for k in EDITABLE})
	out["lead_owner_info"] = _person(d.get("lead_owner"))
	out["created_by"] = _person(d.get("owner"))
	out["can_write"] = bool(doc.has_permission("write"))
	out["counts"] = {
		"notes": frappe.db.count("FCRM Note", {"reference_doctype": LEAD, "reference_docname": name}),
		"tasks": frappe.db.count("CRM Task", {"reference_doctype": LEAD, "reference_docname": name}),
		"calls": frappe.db.count("CRM Call Log", {"reference_doctype": LEAD, "reference_docname": name}),
	}
	out["statuses"] = frappe.get_all("CRM Lead Status", fields=["name", "color", "type", "position"], order_by="position asc, name asc")
	out["fields"] = _field_meta()
	return out


def _field_meta():
	"""The editable fields with the options a Select / Link needs, so the page can draw them."""
	meta = frappe.get_meta(LEAD)
	out = {}
	for f in EDITABLE:
		df = meta.get_field(f)
		if df:
			out[f] = {"label": df.label, "type": df.fieldtype, "options": df.options if df.fieldtype in ("Select", "Link") else None}
	return out


@frappe.whitelist()
def update_lead(name, values):
	"""Change some details. Only the fields in EDITABLE can be set; a status change goes through the document so CRM's status log is kept."""
	doc = _lead(name, "write")
	values = values if isinstance(values, dict) else json.loads(values or "{}")
	bad = [k for k in values if k not in EDITABLE]
	if bad:
		frappe.throw(_("Cannot change: {0}").format(", ".join(bad)))
	for k, v in values.items():
		doc.set(k, v if v not in ("",) else None)
	doc.save()
	return get_lead(name)


@frappe.whitelist()
def get_notes(name):
	_lead(name)
	rows = frappe.get_list("FCRM Note", filters={"reference_doctype": LEAD, "reference_docname": name}, fields=["name", "title", "content", "owner", "creation", "modified"], order_by="creation desc", limit_page_length=200)
	for r in rows:
		r["by"] = _person(r.owner)
	return rows


@frappe.whitelist()
def add_note(name, title, content=""):
	_lead(name, "write")
	title, content = cstr(title).strip(), cstr(content).strip()
	if not title and not strip_html(content):
		frappe.throw(_("Write something first."))
	doc = frappe.get_doc({"doctype": "FCRM Note", "title": title or strip_html(content)[:60], "content": content, "reference_doctype": LEAD, "reference_docname": name}).insert()
	return doc.name


@frappe.whitelist()
def delete_note(name, note):
	_lead(name, "write")
	frappe.delete_doc("FCRM Note", note)
	return True


@frappe.whitelist()
def get_tasks(name):
	_lead(name)
	rows = frappe.get_list("CRM Task", filters={"reference_doctype": LEAD, "reference_docname": name}, fields=["name", "title", "description", "status", "priority", "due_date", "assigned_to", "creation"], order_by="due_date is null, due_date asc, creation desc", limit_page_length=200)
	for r in rows:
		r["assignee"] = _person(r.assigned_to)
	return rows


@frappe.whitelist()
def add_task(name, title, due_date=None, assigned_to=None, priority="Medium", description=""):
	_lead(name, "write")
	if not cstr(title).strip():
		frappe.throw(_("Give the task a title."))
	if priority not in PRIORITY:
		frappe.throw(_("Unknown priority."))
	doc = frappe.get_doc({
		"doctype": "CRM Task", "title": cstr(title).strip(), "due_date": due_date or None, "assigned_to": assigned_to or frappe.session.user, "priority": priority,
		"status": "Todo", "description": description, "reference_doctype": LEAD, "reference_docname": name,
	}).insert()
	return doc.name


@frappe.whitelist()
def set_task_status(name, task, status):
	_lead(name, "write")
	if status not in TASK_STATUS:
		frappe.throw(_("Unknown status."))
	doc = frappe.get_doc("CRM Task", task)
	if doc.reference_docname != name:
		frappe.throw(_("That task belongs to another lead."))
	doc.status = status
	doc.save()
	return True


@frappe.whitelist()
def get_calls(name):
	_lead(name)
	rows = frappe.get_list("CRM Call Log", filters={"reference_doctype": LEAD, "reference_docname": name}, fields=["name", "type", "status", "duration", "start_time", "caller", "receiver", "from", "to", "recording_url", "note"], order_by="creation desc", limit_page_length=100)
	for r in rows:
		r["by"] = _person(r.caller or r.receiver)
	return rows


@frappe.whitelist()
def add_comment(name, content):
	doc = _lead(name, "write")
	text = cstr(content).strip()
	if not text:
		frappe.throw(_("Write something first."))
	doc.add_comment("Comment", text)
	return True


@frappe.whitelist()
def get_timeline(name):
	"""Newest first: comments, assignments, and what changed on the lead (from CRM's version history)."""
	_lead(name)
	out = []
	for c in frappe.get_all("Comment", filters={"reference_doctype": LEAD, "reference_name": name, "comment_type": ["in", ["Comment", "Assigned"]]}, fields=["name", "comment_type", "content", "owner", "creation"], limit_page_length=200):
		out.append({"kind": "comment" if c.comment_type == "Comment" else "assigned", "text": strip_html(c.content or ""), "by": _person(c.owner), "creation": c.creation})
	for v in frappe.get_all("Version", filters={"ref_doctype": LEAD, "docname": name}, fields=["data", "owner", "creation"], order_by="creation desc", limit_page_length=100):
		try:
			data = json.loads(v.data or "{}")
		except ValueError:
			continue
		for f, old, new in (data.get("changed") or [])[:6]:
			if f in ("modified", "modified_by", "status_change_log", "rolling_responses", "last_response_time", "last_responded_on"):
				continue
			label = frappe.get_meta(LEAD).get_label(f) or f
			out.append({"kind": "change", "field": label, "old": cstr(old), "new": cstr(new), "by": _person(v.owner), "creation": v.creation})
	out.sort(key=lambda r: str(r["creation"]), reverse=True)
	return out[:150]

