"""The manager API behind the Demos admin page, plus ``my_demos`` for everyone who takes demos.

Every function checks the role on the server (the page hiding a button protects nothing). Managers are Administrator, System Managers and
Sales Managers; a Sales User only gets ``my_demos``, limited to the demos they take part in.
"""

import json
import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, cstr, get_url_to_form

from crm_addons.campaigns import personalization
from crm_addons.campaigns.common import date_range, email_account_problem, whatsapp_installed
from crm_addons.demos import booking, common, defaults, messaging, report, slots
from crm_addons.demos.common import ACTIVE, BOOKING, DEMO_TYPE, LEAD, MESSAGE
from crm_addons.demos.permissions import involved_sql
from frappe.utils import get_url

from crm_addons.utils import is_manager

PAGE = 25
BOOKING_COLUMNS = (
	"name", "demo_type", "status", "starts_on", "ends_on", "starts_utc", "visitor_timezone", "name_", "email", "phone", "organization", "lead",
	"meeting", "whatsapp_consent", "utm_source", "utm_medium", "utm_campaign", "creation",
)


def _manager():
	if not is_manager():
		frappe.throw(_("Only a Sales Manager or System Manager can manage demo booking."), frappe.PermissionError)


def _json(value, default):
	if value in (None, ""):
		return default
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("That is not valid JSON."))


# -- demo types ---------------------------------------------------------------------------------------------------------------


def _type_dict(name):
	doc = frappe.get_doc(DEMO_TYPE, name)
	return {
		"doc": doc.as_dict(convert_dates_to_str=True),
		"public_url": common.public_url(doc.name),
		"bookings": frappe.db.count(BOOKING, {"demo_type": doc.name}),
	}


@frappe.whitelist()
def list_demo_types():
	_manager()
	types = frappe.get_all(DEMO_TYPE, fields=["name", "slug", "title", "enabled", "duration_minutes", "timezone", "provider", "modified"], order_by="title asc")
	owners = {}
	for row in frappe.get_all("CRM Demo Owner", filters={"parenttype": DEMO_TYPE}, fields=["parent", "user"], order_by="idx asc", parent_doctype=DEMO_TYPE):
		owners.setdefault(row.parent, []).append({"user": row.user, "full_name": common.full_name(row.user)})
	counts = {
		r.demo_type: r
		for r in frappe.db.sql(
			f"select demo_type, count(*) as total, sum(status in %(active)s and starts_utc >= %(now)s) as upcoming from `tab{BOOKING}` group by demo_type",
			{"active": ACTIVE, "now": common.utcnow()},
			as_dict=True,
		)
	}
	month = common.site_now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
	next_month = (month + timedelta(days=32)).replace(day=1)
	this_month = dict(
		frappe.db.sql(
			f"select demo_type, count(*) from `tab{BOOKING}` where status != 'Cancelled' and starts_on >= %s and starts_on < %s group by demo_type", (month, next_month)
		)
	)
	for t in types:
		count = counts.get(t.name)
		t.update(
			owners=owners.get(t.name, []), upcoming=int(count.upcoming or 0) if count else 0, total=int(count.total) if count else 0,
			public_url=common.public_url(t.slug), modified=str(t.modified), bookings_month=int(this_month.get(t.name, 0)), next_slot=_next_slot(t.name),
		)
	return types


def _next_slot(name):
	"""UTC ISO time of the first free slot of a demo type (None when there is none in its booking window)."""
	try:
		demo = frappe.get_cached_doc(DEMO_TYPE, name)
		now = common.utcnow()
		found = slots.available_slots(demo, now, now + timedelta(days=min(max(cint(demo.max_days_ahead), 1), 60) + 1))
		return common.iso_z(found[0]) if found else None
	except Exception:
		return None


@frappe.whitelist()
def get_demo_type(name):
	_manager()
	if not frappe.db.exists(DEMO_TYPE, name):
		frappe.throw(_("Demo type {0} was not found.").format(name), frappe.DoesNotExistError)
	return _type_dict(name)


@frappe.whitelist()
def save_demo_type(doc):
	_manager()
	data = _json(doc, {})
	name = data.get("name")
	for key in ("creation", "modified", "modified_by", "owner", "docstatus", "idx"):
		data.pop(key, None)
	if name and frappe.db.exists(DEMO_TYPE, name):
		target = frappe.get_doc(DEMO_TYPE, name)
		data.pop("slug", None)  # the slug is the name of the record and the address of its page
		target.update(data)
	else:
		target = frappe.get_doc({**data, "doctype": DEMO_TYPE})
	target.save(ignore_permissions=True) if not target.is_new() else target.insert(ignore_permissions=True)
	return _type_dict(target.name)


@frappe.whitelist()
def duplicate_demo_type(name, slug=None, title=None):
	_manager()
	source = frappe.get_doc(DEMO_TYPE, name)
	copy = frappe.copy_doc(source)
	base = re.sub(r"-copy(-\d+)?$", "", source.slug)
	slug = cstr(slug).strip().lower() or f"{base}-copy"
	n = 2
	while frappe.db.exists(DEMO_TYPE, slug):
		slug, n = f"{base}-copy-{n}", n + 1
	copy.slug = slug
	copy.title = title or _("{0} (copy)").format(source.title)
	copy.enabled = 0
	copy.insert(ignore_permissions=True)
	return _type_dict(copy.name)


@frappe.whitelist()
def delete_demo_type(name):
	_manager()
	if frappe.db.count(BOOKING, {"demo_type": name}):
		frappe.throw(_("This demo type has bookings, so it cannot be deleted. Switch it off instead."))
	frappe.delete_doc(DEMO_TYPE, name, ignore_permissions=True)
	return {"ok": True}


# -- bookings -------------------------------------------------------------------------------------------------------------------


def _decorate(rows):
	if not rows:
		return rows
	titles = dict(frappe.get_all(DEMO_TYPE, filters={"name": ["in", list({r["demo_type"] for r in rows})]}, fields=["name", "title"], as_list=True))
	links = {
		str(m.name): m.google_meet_link
		for m in frappe.get_all("CRM Meeting", filters={"name": ["in", [r["meeting"] for r in rows if r.get("meeting")] or [""]]}, fields=["name", "google_meet_link"])
	}
	for r in rows:
		r["demo_title"] = titles.get(r["demo_type"]) or r["demo_type"]
		r["meet_link"] = links.get(str(r.get("meeting"))) or ""
		for key in ("starts_on", "ends_on", "starts_utc", "creation"):
			r[key] = str(r[key]) if r.get(key) else ""
	return rows


def _filters_sql(filters, search, from_date, to_date, extra=None):
	filters = _json(filters, {})
	parts, values = ["1 = 1"], {}
	for key in ("demo_type", "status", "utm_source", "utm_medium", "utm_campaign"):
		if filters.get(key):
			parts.append(f"b.`{key}` = %({key})s")
			values[key] = filters[key]
	if filters.get("owner"):
		parts.append(
			"b.demo_type in (select parent from `tabCRM Demo Owner` where parenttype = 'CRM Demo Type' and user = %(owner)s)"
		)
		values["owner"] = filters["owner"]
	if search:
		parts.append("(b.name_ like %(q)s or b.email like %(q)s or b.phone like %(q)s or b.organization like %(q)s)")
		values["q"] = f"%{cstr(search).strip()}%"
	start, end = date_range(from_date, to_date)
	if start:
		parts.append("b.starts_on >= %(start)s")
		values["start"] = start
	if end:
		parts.append("b.starts_on < %(end)s")
		values["end"] = end
	if extra:
		parts.append(extra)
	return " and ".join(parts), values


def _query_bookings(where, values, page, page_size, order="b.starts_utc desc"):
	page, page_size = max(1, cint(page)), min(max(1, cint(page_size) or PAGE), 200)
	columns = ", ".join(f"b.`{c}`" for c in BOOKING_COLUMNS)
	total = frappe.db.sql(f"select count(*) from `tab{BOOKING}` b where {where}", values)[0][0]
	rows = frappe.db.sql(
		f"select {columns} from `tab{BOOKING}` b where {where} order by {order} limit %(limit)s offset %(offset)s",
		{**values, "limit": page_size, "offset": (page - 1) * page_size},
		as_dict=True,
	)
	return _decorate(rows), total, page, page_size


@frappe.whitelist()
def list_bookings(filters=None, search=None, from_date=None, to_date=None, page=1, page_size=PAGE):
	_manager()
	where, values = _filters_sql(filters, search, from_date, to_date)
	rows, total, page, page_size = _query_bookings(where, values, page, page_size)
	return {"rows": rows, "total": total, "page": page, "page_size": page_size}


def _booking_admin(name):
	if not frappe.db.exists(BOOKING, name):
		frappe.throw(_("Booking {0} was not found.").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc(BOOKING, name)
	data = doc.as_dict(convert_dates_to_str=True)
	messages = data.pop("messages", [])
	data["answers"] = _json(data.get("answers"), {})
	data["first_touch"] = _json(data.get("first_touch"), {})
	meeting = frappe.db.get_value("CRM Meeting", doc.meeting, ["google_meet_link", "sync_status", "sync_error"], as_dict=True) if doc.meeting else {}
	demo = frappe.db.get_value(DEMO_TYPE, doc.demo_type, ["title"], as_dict=True)
	data["demo_title"] = demo.title if demo else doc.demo_type
	data["meet_link"] = (meeting or {}).get("google_meet_link") or ""
	return {
		"booking": data,
		"messages": [
			{k: (str(m.get(k)) if k in ("due_at", "sent_at") and m.get(k) else m.get(k)) for k in ("name", "event", "minutes_before", "channel", "status", "due_at", "sent_at", "error", "reference")}
			for m in sorted(messages, key=lambda m: m.get("idx") or 0)
		],
		"lead_url": get_url(f"/crm/leads/{doc.lead}") if doc.lead else "",
		"meeting_url": get_url_to_form("CRM Meeting", doc.meeting) if doc.meeting else "",
		"sync_status": (meeting or {}).get("sync_status") or "",
		"sync_error": (meeting or {}).get("sync_error") or "",
		"owners": [{"user": u, "full_name": common.full_name(u)} for u in (common.owners_of(frappe.get_doc(DEMO_TYPE, doc.demo_type), False) if frappe.db.exists(DEMO_TYPE, doc.demo_type) else [])],
	}


@frappe.whitelist()
def get_booking_admin(name):
	_manager()
	return _booking_admin(name)


def _close(name, status):
	"""Mark a demo Completed or No Show, with the same outcome on its CRM Meeting."""
	row = frappe.db.get_value(BOOKING, name, ["status", "meeting"], as_dict=True)
	if row.status == "Cancelled":
		frappe.throw(_("A cancelled booking cannot be completed."))
	frappe.db.set_value(BOOKING, name, "status", status, update_modified=False)
	messaging.cancel_pending(name, _("The demo is over."))
	if row.meeting and frappe.db.exists("CRM Meeting", row.meeting):
		meeting = frappe.get_doc("CRM Meeting", row.meeting)
		if meeting.status != "Cancelled":
			meeting.meeting_outcome = "Held" if status == "Completed" else "No Show"
			meeting.status = "Completed"
			meeting.flags.notify_guests = False
			meeting.flags.demo_sync = True
			meeting.save(ignore_permissions=True)


@frappe.whitelist()
def set_booking_status(name, status):
	_manager()
	if status not in ("Completed", "No Show", "Cancelled"):
		frappe.throw(_("A booking can be marked Completed, No Show or Cancelled."))
	if not frappe.db.exists(BOOKING, name):
		frappe.throw(_("Booking {0} was not found.").format(name), frappe.DoesNotExistError)
	if status == "Cancelled":
		booking.cancel(name, _("Cancelled by the team."), by_team=True)
	else:
		_close(name, status)
	return _booking_admin(name)


@frappe.whitelist()
def set_my_demo_outcome(booking, outcome):
	"""A person who takes a demo records how it went (Completed or No Show). Managers can do it for any demo."""
	if outcome not in ("Completed", "No Show"):
		frappe.throw(_("Choose Completed or No Show."))
	if not frappe.db.exists(BOOKING, booking):
		frappe.throw(_("Booking {0} was not found.").format(booking), frappe.DoesNotExistError)
	if not is_manager() and not frappe.db.sql(f"select 1 from `tab{BOOKING}` where name = %s and {involved_sql(frappe.session.user)}", booking):
		frappe.throw(_("You can only record the outcome of a demo you take part in."), frappe.PermissionError)
	_close(booking, outcome)
	return {"ok": True, "status": outcome}


@frappe.whitelist()
def send_test_message(demo_type, event, minutes_before=0, channel="Email"):
	"""Send one of the demo type's messages, with sample data, to the logged-in manager's own email / mobile number."""
	_manager()
	if channel not in ("Email", "WhatsApp"):
		frappe.throw(_("Choose Email or WhatsApp."))
	demo = frappe.get_doc(DEMO_TYPE, demo_type)
	rule = next(
		(r for r in demo.messages if r.event == event and (event != "Reminder" or cint(r.minutes_before) == cint(minutes_before))), None
	)
	if not rule:
		frappe.throw(_("That message is not part of this demo type. Save it first."))
	return {"message": messaging.send_test(demo, rule, channel, frappe.session.user)}


@frappe.whitelist()
def resend_message(booking, event=None, message=None):
	"""With ``message`` (a row name) that row goes back in line; with ``event`` a fresh message for that event is queued now."""
	_manager()
	if not frappe.db.exists(BOOKING, booking):
		frappe.throw(_("Booking {0} was not found.").format(booking), frappe.DoesNotExistError)
	queued = 0
	if message:
		if frappe.db.get_value(MESSAGE, message, "parent") != booking:
			frappe.throw(_("That message belongs to another booking."))
		queued = 1 if messaging.retry(message) else 0
	elif event in ("Confirmed", "Rescheduled", "Cancelled"):
		queued = messaging.queue_messages_now(booking, event)
	else:
		frappe.throw(_("Choose which message to send again."))
	if queued:
		messaging.send_for_booking(booking)
	return {"ok": True, "queued": queued}


@frappe.whitelist()
def demo_report(from_date=None, to_date=None, demo_type=None):
	_manager()
	return report.demo_report(from_date, to_date, demo_type)


# -- helpers for the editor ------------------------------------------------------------------------------------------------------


@frappe.whitelist()
def get_embed_code(slug):
	_manager()
	if not frappe.db.exists(DEMO_TYPE, slug):
		frappe.throw(_("Demo type {0} was not found.").format(slug), frappe.DoesNotExistError)
	url = common.public_url(slug)
	script = get_url("/assets/crm_addons/book/embed.js")
	return {
		"url": url,
		"script": f'<script src="{script}" defer></script>',
		"button": f'<script src="{script}" defer></script>\n<button data-crm-demo="{slug}">Book a demo</button>',
		"iframe": f'<iframe src="{url}" style="width:100%;height:720px;border:0" title="Book a demo" loading="lazy"></iframe>',
	}


@frappe.whitelist()
def list_templates():
	_manager()
	email = frappe.get_all("CRM Campaign Email Template", filters={"enabled": 1}, fields=["name", "subject", "category"], order_by="template_name asc")
	whatsapp, accounts = [], []
	if whatsapp_installed():
		for t in frappe.get_all("WhatsApp Templates", fields=["name", "status", "language_code", "template"], order_by="name asc", limit_page_length=500):
			whatsapp.append(
				{"name": t.name, "status": t.status, "language": t.language_code, "body": t.template, "variables": personalization.placeholders_in(t.template)}
			)
		accounts = frappe.get_all("WhatsApp Account", filters={"status": ["in", ["active", "Active"]]}, pluck="name")
	return {"email": email, "whatsapp": whatsapp, "whatsapp_accounts": accounts, "whatsapp_installed": whatsapp_installed(), "email_problem": email_account_problem() or ""}


@frappe.whitelist()
def get_demo_variables():
	_manager()
	return [{"name": v["name"], "label": v["label"]} for v in personalization.available_variables()]


# -- everyone who takes demos --------------------------------------------------------------------------------------------------------


@frappe.whitelist()
def my_demos(from_date=None, to_date=None, scope="mine", page=1, page_size=100):
	"""The demos a person takes part in. A Sales User always gets just theirs; a manager can pass ``scope="all"``."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	extra = None if (scope == "all" and is_manager(user)) else involved_sql(user, "b")
	where, values = _filters_sql(None, None, from_date, to_date, extra)
	rows, total, page, page_size = _query_bookings(where, values, page, page_size, order="b.starts_utc asc")
	leads = dict(frappe.get_all(LEAD, filters={"name": ["in", [r["lead"] for r in rows if r.get("lead")] or [""]]}, fields=["name", "lead_name"], as_list=True)) if rows else {}
	for r in rows:
		r["lead_title"] = leads.get(r.get("lead")) or r.get("name_")
	return rows


@frappe.whitelist()
def default_messages():
	"""The ready-made message for every rule (demos/defaults.py): the library email template and the Utility WhatsApp template with
	its state on this site (NOT CREATED, PENDING, APPROVED ...). The Messages tab fills empty rules from this."""
	_manager()
	from crm_addons.campaigns import api as campaign_api
	from crm_addons.install import ensure_default_email_templates

	ensure_default_email_templates()  # a site that has not run migrate yet still gets them
	on_site = {}
	if whatsapp_installed():
		for r in campaign_api.list_whatsapp_templates().get("rows", []):
			on_site[cstr(r.get("actual_name") or r.get("template_name")).lower()] = r
	out = []
	for key in defaults.ORDER:
		spec, row = defaults.WHATSAPP[key], on_site.get(defaults.WHATSAPP[key]["template_name"])
		out.append(
			{
				"event": key[0], "minutes_before": key[1], "email_template": defaults.EMAIL[key],
				"email_exists": bool(frappe.db.exists("CRM Campaign Email Template", defaults.EMAIL[key])),
				"whatsapp": {
					"template_name": spec["template_name"], "category": spec["category"], "body": spec["template"], "samples": spec["sample_values"],
					"variable_map": spec["variable_map"], "state": (row or {}).get("state") or "NOT CREATED", "approved": bool(row and row.get("approved")),
					"name": (row or {}).get("name") or "", "whatsapp_account": (row or {}).get("whatsapp_account") or "",
				},
			}
		)
	return out


@frappe.whitelist()
def create_default_whatsapp_template(event, minutes_before=0):
	"""Submit the ready-made Utility template of a rule to Meta (through frappe_whatsapp, like the campaign template creator). It stays
	Pending until Meta approves it; then it can be chosen in the rule. Managers only."""
	_manager()
	from crm_addons.campaigns import api as campaign_api

	spec = defaults.WHATSAPP.get(defaults.key_of(event, minutes_before))
	if not spec:
		frappe.throw(_("There is no ready-made WhatsApp template for this message."))
	return campaign_api.create_whatsapp_template(json.loads(json.dumps(spec)))
