"""The standalone Suite Pro app (``/crm-pro``): the pages that are our own, not CRM's. Every call here works on the signed-in person's own data."""

import frappe
from frappe import _
from frappe.utils import cint, cstr, strip_html

NOTIFICATION = "CRM Notification"
TYPES = ("Mention", "Task", "Assignment", "WhatsApp")


def _check():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if not frappe.db.exists("DocType", NOTIFICATION):
		frappe.throw(_("This CRM has no notifications."))


@frappe.whitelist()
def get_shell():
	"""What the shell needs once: who is signed in, the brand, and how many notifications are unread."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	from crm_addons import branding

	user = frappe.db.get_value("User", frappe.session.user, ["full_name", "user_image"], as_dict=True) or {}
	brand = branding.get_branding()
	return {
		"user": frappe.session.user, "full_name": user.get("full_name") or frappe.session.user, "image": user.get("user_image"),
		"brand": {"name": brand.get("name") or "", "logo": brand.get("logo") or ""},
		"unread": unread_count(),
	}


def unread_count():
	if frappe.session.user == "Guest" or not frappe.db.exists("DocType", NOTIFICATION):
		return 0
	return cint(frappe.db.count(NOTIFICATION, {"to_user": frappe.session.user, "read": 0}))


@frappe.whitelist()
def list_notifications(show="all", type=None, search=None, start=0, page_length=30):
	"""The person's own CRM notifications, newest first: ``show`` is all or unread. Returns {rows, total, unread}."""
	_check()
	filters = {"to_user": frappe.session.user}
	if show == "unread":
		filters["read"] = 0
	if type in TYPES:
		filters["type"] = type
	term = cstr(search).strip()
	or_filters = None
	if term:
		like = f"%{term}%"
		or_filters = {"notification_text": ["like", like], "message": ["like", like], "reference_name": ["like", like]}
	page = max(1, min(cint(page_length) or 30, 100))
	rows = frappe.get_all(
		NOTIFICATION, filters=filters, or_filters=or_filters, order_by="creation desc", limit_start=max(0, cint(start)), limit_page_length=page,
		fields=["name", "from_user", "type", "read", "creation", "notification_text", "message", "reference_doctype", "reference_name"],
	)
	people = {u.name: u for u in frappe.get_all("User", filters={"name": ["in", list({r.from_user for r in rows if r.from_user}) or [""]]}, fields=["name", "full_name", "user_image"])}
	out = []
	for r in rows:
		who = people.get(r.from_user)
		title = ""
		if r.reference_doctype and r.reference_name and frappe.db.exists("DocType", r.reference_doctype):
			meta = frappe.get_meta(r.reference_doctype)
			field = "lead_name" if meta.has_field("lead_name") else ("organization_name" if meta.has_field("organization_name") else None)
			title = (frappe.db.get_value(r.reference_doctype, r.reference_name, field) if field else "") or ""
		out.append({
			"name": r.name, "type": r.type, "read": cint(r.read), "creation": cstr(r.creation),
			"from_user": r.from_user, "from_name": who.full_name if who else r.from_user, "from_image": who.user_image if who else None,
			"text": strip_html(cstr(r.notification_text or r.message))[:300],
			"reference_doctype": r.reference_doctype, "reference_name": r.reference_name, "title": title,
		})
	total = cint(frappe.db.count(NOTIFICATION, filters)) if not or_filters else len(frappe.get_all(NOTIFICATION, filters=filters, or_filters=or_filters, pluck="name", limit_page_length=5000))
	return {"rows": out, "total": total, "unread": unread_count()}


@frappe.whitelist()
def mark_read(names=None, read=1):
	"""Mark some of the person's own notifications read (or unread). Others' notifications are never touched."""
	_check()
	names = frappe.parse_json(names) if isinstance(names, str) else (names or [])
	own = frappe.get_all(NOTIFICATION, filters={"name": ["in", [n for n in names if n] or [""]], "to_user": frappe.session.user}, pluck="name")
	for n in own:
		frappe.db.set_value(NOTIFICATION, n, "read", 1 if cint(read) else 0, update_modified=False)
	return {"changed": len(own), "unread": unread_count()}


@frappe.whitelist()
def mark_all_read():
	_check()
	frappe.db.sql(f"update `tab{NOTIFICATION}` set `read` = 1 where to_user = %s and `read` = 0", frappe.session.user)
	return {"unread": unread_count()}
