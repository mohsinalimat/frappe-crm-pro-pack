"""One lead, for the Suite Pro lead page: the details, notes, tasks, calls and the timeline. Reads and writes go through the document, so CRM's own
permissions decide what a person may see or change."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, strip_html

LEAD = "CRM Lead"
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
	from crm_addons.pro import form

	side = form.sections("Side Panel")
	writable = form.writable()
	out["side_panel"] = [{"label": s["label"], "fields": [{**f, "value": d.get(f["fieldname"]), "display": _display(f, d.get(f["fieldname"]))} for f in s["fields"]]} for s in side]
	out["values"] = {k: d.get(k) for k in writable}
	for k in ("first_name", "last_name", "mobile_no", "email", "organization", "job_title", "website", "territory", "source", "industry", "status", "lead_owner"):
		out[k] = d.get(k)
	out["lead_owner_info"] = _person(d.get("lead_owner"))
	out["created_by"] = _person(d.get("owner"))
	out["can_write"] = bool(doc.has_permission("write"))
	out["counts"] = {
		"notes": frappe.db.count("FCRM Note", {"reference_doctype": LEAD, "reference_docname": name}),
		"tasks": frappe.db.count("CRM Task", {"reference_doctype": LEAD, "reference_docname": name}),
		"calls": frappe.db.count("CRM Call Log", {"reference_doctype": LEAD, "reference_docname": name}),
	}
	out["statuses"] = frappe.get_all("CRM Lead Status", fields=["name", "color", "type", "position"], order_by="position asc, name asc")
	return out


def _display(spec, value):
	if value in (None, ""):
		return ""
	if spec["fieldtype"] == "Check":
		return "Yes" if value else "No"
	return cstr(value)


@frappe.whitelist()
def update_lead(name, values):
	"""Change some details. Only the fields CRM's layouts allow can be set (see ``form.writable``); a status change goes through the document so CRM's status log is kept."""
	doc = _lead(name, "write")
	values = values if isinstance(values, dict) else json.loads(values or "{}")
	from crm_addons.pro import form

	for k, v in form.clean_values(values).items():
		doc.set(k, v)
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



# ---------------------------------------------------------------- the other tabs


def _clip(text, n=140):
	text = " ".join(strip_html(cstr(text)).split())
	return text if len(text) <= n else text[: n - 1] + "…"


@frappe.whitelist()
def get_emails(name):
	_lead(name)
	rows = frappe.get_all(
		"Communication", filters={"reference_doctype": LEAD, "reference_name": name, "communication_type": "Communication", "communication_medium": "Email"},
		fields=["name", "subject", "content", "sender", "recipients", "sent_or_received", "communication_date", "creation", "delivery_status"], order_by="creation desc", limit_page_length=100,
	)
	for r in rows:
		r["preview"] = _clip(r.content, 220)
	return rows


@frappe.whitelist()
def email_templates(name):
	"""The app's email templates, filled in for this lead, plus whether mail can go out from this site."""
	from crm_addons.campaigns import personalization
	from crm_addons.campaigns.common import email_account_problem

	doc = _lead(name)
	who = frappe._dict(campaign_owner=frappe.session.user, owner=frappe.session.user)
	ctx = personalization.build_context(doc, who)
	rows = frappe.get_all("CRM Campaign Email Template", filters={"enabled": 1}, fields=["name", "template_name", "subject", "body_html"], order_by="template_name asc", limit_page_length=500)
	templates = [{"name": r.name, "label": r.template_name or r.name, "subject": personalization.render(r.subject, ctx), "body": personalization.render(r.body_html, ctx, html=True)} for r in rows]
	return {"templates": templates, "problem": email_account_problem() or "", "from": frappe.db.get_value("User", frappe.session.user, "email")}


def _addresses(value, label):
	from frappe.utils import validate_email_address

	out = []
	for part in cstr(value).replace(";", ",").split(","):
		part = part.strip()
		if not part:
			continue
		if not validate_email_address(part, throw=False):
			frappe.throw(_("{0} is not a valid email address ({1}).").format(part, label))
		out.append(part)
	return ", ".join(out)


@frappe.whitelist()
def send_email(name, recipients, subject, content, cc=None, bcc=None, html=0):
	"""Send an email from the lead page. It is stored on the lead like any CRM email. ``html`` means the message is already HTML (from the editor)."""
	doc = _lead(name, "write")
	recipients, subject, content = _addresses(recipients, _("To")), cstr(subject).strip(), cstr(content).strip()
	cc, bcc = _addresses(cc, "CC"), _addresses(bcc, "BCC")
	if not recipients or not subject or not strip_html(content).strip():
		frappe.throw(_("Add the address, a subject and a message."))
	from frappe.core.doctype.communication.email import make
	from frappe.utils import escape_html
	from frappe.utils.html_utils import clean_html

	body = clean_html(content) if cint(html) else escape_html(content).replace("\n", "<br>")
	make(doctype=LEAD, name=doc.name, content=body, subject=subject, recipients=recipients, cc=cc, bcc=bcc, sender=frappe.db.get_value("User", frappe.session.user, "email"), communication_medium="Email", send_email=True, sent_or_received="Sent")
	return True


@frappe.whitelist()
def followup_options():
	meta = frappe.get_meta("CRM Follow Up")

	def opts(f):
		return [o for o in (meta.get_field(f).options or "").split("\n") if o]

	return {"modes": opts("mode"), "call_statuses": opts("call_status"), "outcomes": opts("outcome")}


@frappe.whitelist()
def get_followups(name):
	_lead(name)
	rows = frappe.get_all(
		"CRM Follow Up", filters={"reference_doctype": LEAD, "reference_docname": name},
		fields=["name", "followed_up_on", "mode", "assigned_to", "call_status", "attempt_no", "outcome", "remark", "next_follow_up_on", "next_closed", "creation"], order_by="followed_up_on desc, creation desc", limit_page_length=200,
	)
	for r in rows:
		r["by"] = _person(r.assigned_to)
	return rows


@frappe.whitelist()
def log_followup(name, data):
	"""Log a follow-up (mode, outcome, remark, next date, and optionally a new lead status) through the add-on's own follow-up rules."""
	_lead(name, "write")
	from crm_addons import followups

	data = data if isinstance(data, dict) else json.loads(data or "{}")
	allowed = ("followed_up_on", "mode", "call_status", "outcome", "remark", "next_follow_up_on", "lead_status", "assigned_to")
	clean = {k: v for k, v in data.items() if k in allowed}
	clean.update({"reference_doctype": LEAD, "reference_docname": name})
	followups.save_follow_up(json.dumps(clean))
	return True


@frappe.whitelist()
def complete_followup(name, followup):
	_lead(name, "write")
	from crm_addons import followups

	followups.complete_follow_up(followup)
	return True


@frappe.whitelist()
def get_meetings(name):
	_lead(name)
	rows = frappe.get_all(
		"CRM Meeting", filters={"reference_doctype": LEAD, "reference_docname": name},
		fields=["name", "subject", "status", "starts_on", "ends_on", "google_meet_link", "description", "meeting_outcome", "organizer", "creation"], order_by="starts_on desc", limit_page_length=100,
	)
	for r in rows:
		r["by"] = _person(r.organizer)
	return rows


@frappe.whitelist()
def schedule_meeting(name, subject, starts_on, ends_on, video=0, description="", invite=1):
	doc = _lead(name, "write")
	from crm_addons import api as meetings

	if not cstr(subject).strip() or not starts_on or not ends_on:
		frappe.throw(_("Add a subject, a start and an end."))
	attendees = [{"email": doc.email, "full_name": doc.lead_name}] if cint(invite) and doc.email else []
	data = {"reference_doctype": LEAD, "reference_docname": name, "subject": cstr(subject).strip(), "starts_on": starts_on, "ends_on": ends_on, "add_video_conferencing": cint(video), "description": description, "attendees": attendees}
	meetings.save_meeting(json.dumps(data), "all" if attendees else "none")
	return True


@frappe.whitelist()
def get_campaigns(name):
	"""What the lead went through in campaigns: one row per step sent or planned."""
	_lead(name)
	rows = frappe.get_all(
		"CRM Campaign Recipient", filters={"recipient_type": LEAD, "recipient_id": name},
		fields=["name", "campaign", "step_idx", "channel", "status", "due_at", "sent_at", "delivered_at", "read_at", "clicked_at", "click_count", "failure_reason", "skip_reason", "creation"], order_by="creation desc", limit_page_length=200,
	)
	titles = {c.name: c.get("campaign_name") or c.name for c in frappe.get_all("CRM Campaign", filters={"name": ["in", list({r.campaign for r in rows}) or [""]]}, fields=["name", "campaign_name"])} if frappe.get_meta("CRM Campaign").has_field("campaign_name") else {}
	for r in rows:
		r["campaign_title"] = titles.get(r.campaign) or r.campaign
	return rows


@frappe.whitelist()
def get_whatsapp(name):
	"""The lead's WhatsApp chat, read through Frappe CRM's own WhatsApp (the ``frappe_whatsapp`` app)."""
	_lead(name)
	if not frappe.db.exists("DocType", "WhatsApp Message"):
		return {"installed": False, "messages": []}
	msgs = frappe.get_attr("crm.api.whatsapp.get_whatsapp_messages")(LEAD, name)
	out = [{k: m.get(k) for k in ("name", "type", "message", "creation", "status", "content_type", "attach", "template", "is_reply", "reply_to_message_id")} for m in (msgs or [])]
	return {"installed": True, "messages": out, "number": frappe.db.get_value(LEAD, name, "mobile_no")}


@frappe.whitelist()
def send_whatsapp(name, message):
	doc = _lead(name, "write")
	text = cstr(message).strip()
	if not text:
		frappe.throw(_("Write a message first."))
	if not doc.mobile_no:
		frappe.throw(_("This lead has no phone number."))
	frappe.get_attr("crm.api.whatsapp.create_whatsapp_message")(LEAD, name, text, doc.mobile_no, "", "", "text")
	return True


@frappe.whitelist()
def get_data(name):
	"""Every field of the lead (custom ones too) that has a value, grouped the way the CRM lays them out."""
	doc = _lead(name)
	sections, current = [], {"label": _("Details"), "fields": []}
	skip = {"Column Break", "Tab Break", "HTML", "Table", "Table MultiSelect", "Button", "Image", "Attach Image"}
	for df in frappe.get_meta(LEAD).fields:
		if df.fieldtype == "Section Break":
			if current["fields"]:
				sections.append(current)
			current = {"label": df.label or "", "fields": []}
			continue
		if df.fieldtype in skip or df.hidden:
			continue
		value = doc.get(df.fieldname)
		if value in (None, "", 0) and df.fieldtype != "Check":
			continue
		current["fields"].append({"label": df.label or df.fieldname, "value": ("Yes" if value else "No") if df.fieldtype == "Check" else cstr(value)})
	if current["fields"]:
		sections.append(current)
	return sections


@frappe.whitelist()
def get_activity(name):
	"""One stream, newest first: changes, comments, assignments, follow-ups, meetings, calls, notes, emails, WhatsApp and campaign steps."""
	_lead(name)
	# the add-on posts a comment for each follow-up and meeting; they are shown from their own records below
	rows = [r for r in get_timeline(name) if not (r["kind"] == "comment" and r["text"][:1] in ("\U0001F4DE", "\U0001F4C5"))]

	def add(kind, icon, title, detail, by, creation):
		rows.append({"kind": kind, "icon": icon, "title": title, "detail": detail, "by": by, "creation": creation})

	for f in get_followups(name):
		add("followup", "phone", "Follow-up: " + " - ".join(x for x in (f.mode, f.call_status or f.outcome) if x), _clip(f.remark), f.by, f.followed_up_on or f.creation)
	for m in get_meetings(name):
		add("meeting", "calendar", "Meeting: " + cstr(m.subject) + " (" + cstr(m.status) + ")", frappe.utils.format_datetime(m.starts_on, "d MMM yyyy, h:mm a") if m.starts_on else "", m.by, m.creation)
	for c in get_calls(name):
		add("call", "phone", cstr(c.type) + " call - " + cstr(c.status), "", c.by, c.start_time or frappe.utils.now())
	for n in get_notes(name):
		add("note", "file-text", "Note: " + cstr(n.title), _clip(n.content), n.by, n.creation)
	for e in get_emails(name):
		add("email", "mail", ("Email sent: " if e.sent_or_received == "Sent" else "Email received: ") + cstr(e.subject), e.preview, None, e.creation)
	if frappe.db.exists("DocType", "WhatsApp Message"):
		for w in get_whatsapp(name)["messages"][-30:]:
			add("whatsapp", "whatsapp", "WhatsApp " + ("received" if w.get("type") == "Incoming" else "sent"), _clip(w.get("message")), None, w.get("creation"))
	for r in get_campaigns(name):
		if r.sent_at or r.status in ("Failed", "Skipped"):
			add("campaign", "send", cstr(r.campaign_title) + " - " + cstr(r.channel) + " " + cstr(r.status).lower(), _clip(r.failure_reason or r.skip_reason), None, r.sent_at or r.creation)
	for r in rows:
		r["creation"] = cstr(r["creation"])
	rows.sort(key=lambda r: r["creation"], reverse=True)
	return rows[:250]
