"""The standalone Suite Pro app (``/suite``): the pages that are our own, not CRM's. Every call here works on the signed-in person's own data."""

import frappe
from frappe import _
from frappe.utils import cint, cstr, strip_html

NOTIFICATION = "CRM Notification"
TYPES = ("Mention", "Task", "Assignment", "WhatsApp", "Automation")


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


@frappe.whitelist()
def get_profile():
	"""The signed-in person's own profile: what they can edit, and what only an administrator sets (role, team leader)."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	doc = frappe.get_doc("User", frappe.session.user)
	roles = frappe.get_roles()
	role = next((r for r in ("System Manager", "Sales Manager", "Sales User") if r in roles), "")
	leader = None
	try:
		from crm_addons.team_access.admin import _leader

		leader = _leader(frappe.session.user)
	except Exception:
		frappe.clear_messages()
	return {
		"user": doc.name, "first_name": doc.first_name, "last_name": doc.last_name, "email": doc.email, "mobile_no": doc.mobile_no, "full_name": doc.full_name,
		"image": doc.user_image, "designation": doc.get("crm_designation") or "", "company": doc.get("crm_company") or "", "role": role,
		"reports_to": frappe.db.get_value("User", leader, "full_name") if leader else "", "joined": str(doc.creation)[:10],
		"last_login": str(doc.last_login or "")[:16], "timezone": doc.time_zone or "", "preset": _preset(doc.name),
		"leads_owned": frappe.db.count("CRM Lead", {"lead_owner": doc.name}), "notify": _notify(doc.name),
	}


def _preset(user):
	try:
		from crm_addons.team_access import access

		cfg = access.configured(user)
		return (cfg or {}).get("preset") or ""
	except Exception:
		frappe.clear_messages()
		return ""


def _notify(user):
	row = frappe.db.get_value("Notification Settings", user, ["enabled", "enable_email_notifications"], as_dict=True) if frappe.db.exists("Notification Settings", user) else None
	return {"enabled": cint(row.enabled) if row else 1, "email": cint(row.enable_email_notifications) if row else 1}


@frappe.whitelist()
def update_notifications(enabled, email):
	"""Whether they are notified in the CRM, and whether the same also arrives by email."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if frappe.db.exists("Notification Settings", frappe.session.user):
		doc = frappe.get_doc("Notification Settings", frappe.session.user)
	else:
		doc = frappe.get_doc({"doctype": "Notification Settings", "user": frappe.session.user})
	doc.enabled, doc.enable_email_notifications = cint(enabled), cint(email)
	doc.save(ignore_permissions=True)
	return _notify(frappe.session.user)


@frappe.whitelist()
def set_photo(file_url):
	"""Their own profile picture: an image they just uploaded."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	url = cstr(file_url)
	if not (url.startswith("/files/") or url.startswith("/private/files/")) or ".." in url:
		frappe.throw(_("Choose an image you uploaded."))
	if not frappe.db.exists("File", {"file_url": url, "owner": frappe.session.user}):
		frappe.throw(_("Choose an image you uploaded."))
	frappe.db.set_value("User", frappe.session.user, "user_image", url)
	return get_profile()


@frappe.whitelist()
def update_profile(first_name, last_name=None, mobile_no=None):
	"""Their own name and number; job details, role and email are set by an administrator."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if not cstr(first_name).strip():
		frappe.throw(_("Enter your first name."))
	doc = frappe.get_doc("User", frappe.session.user)
	doc.first_name, doc.last_name, doc.mobile_no = cstr(first_name).strip()[:60], cstr(last_name).strip()[:60], cstr(mobile_no).strip()[:20]
	doc.save(ignore_permissions=True)
	return get_profile()


@frappe.whitelist()
def change_password(old_password, new_password):
	"""They prove the current password, then choose a new one."""
	from frappe.utils.password import check_password, update_password

	if frappe.session.user in ("Guest", "Administrator"):
		frappe.throw(_("This account's password is changed in the Frappe desk."))
	if len(cstr(new_password)) < 8:
		frappe.throw(_("Use at least 8 characters."))
	try:
		check_password(frappe.session.user, old_password)
	except frappe.AuthenticationError:
		frappe.throw(_("The current password is not right."))
	update_password(frappe.session.user, new_password)
	return {"ok": True}


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
	kinds = [t for t in cstr(type).split(",") if t in TYPES]
	if kinds:
		filters["type"] = ["in", kinds]
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
			"quote": (strip_html(cstr(r.message))[:200] if r.notification_text and r.message and strip_html(cstr(r.message)) != strip_html(cstr(r.notification_text)) else ""),
			"reference_doctype": r.reference_doctype, "reference_name": r.reference_name, "title": title,
		})
	total = cint(frappe.db.count(NOTIFICATION, filters)) if not or_filters else cint(frappe.get_all(NOTIFICATION, fields=["count(name) as n"], filters=filters, or_filters=or_filters)[0].n)
	mine = {"to_user": frappe.session.user}
	by_type = {t.type: cint(t.n) for t in frappe.get_all(NOTIFICATION, filters=mine, fields=["type", "count(name) as n"], group_by="type")}
	return {"rows": out, "total": total, "unread": unread_count(), "counts": {"all": sum(by_type.values()), "by_type": by_type}}


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
