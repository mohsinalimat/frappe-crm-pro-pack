"""Ready-made templates (the booking messages and the like) are protected: the app's own messages depend on them.

* Nobody can delete or archive one except a System Manager, and only through the Campaign Manager, which names what uses it and
  asks for another template to take its place first (the places that used it are switched over, then it is deleted).
* A direct delete anywhere else (the desk, an API) is refused with the same guidance.
"""

import frappe
from frappe import _
from frappe.utils import cint, cstr

from crm_addons.team_access import access

EMAIL = "CRM Campaign Email Template"
WHATSAPP = "WhatsApp Templates"
KINDS = {"email": (EMAIL, "email_template", "is_system"), "whatsapp": (WHATSAPP, "wa_template", "crm_system")}


def is_protected(kind, name):
	doctype, _field, flag = KINDS[kind]
	if not frappe.get_meta(doctype).has_field(flag):
		return False
	return bool(cint(frappe.db.get_value(doctype, name, flag)))


def usage(kind, name):
	"""What uses a template: campaign steps (campaigns and automations) and booking message rules."""
	_dt, field, _flag = KINDS[kind]
	out = {"campaigns": [], "bookings": []}
	for row in frappe.get_all("CRM Campaign Step", filters={field: name}, fields=["parent", "parenttype"], limit_page_length=2000):
		out["campaigns"].append(row.parent)
	if frappe.db.exists("DocType", "CRM Demo Message Rule"):
		for row in frappe.get_all("CRM Demo Message Rule", filters={field: name}, fields=["parent"], limit_page_length=2000):
			out["bookings"].append(frappe.db.get_value("CRM Demo Type", row.parent, "title") or row.parent)
	out["campaigns"] = sorted(set(out["campaigns"]))
	out["bookings"] = sorted(set(out["bookings"]))
	return out


def delete_info(kind, name):
	"""For the delete dialog: is it protected, who may delete it, what uses it, and which templates could take its place."""
	doctype, _f, _flag = KINDS[kind]
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("Template {0} was not found.").format(frappe.bold(name)), frappe.DoesNotExistError)
	protected = is_protected(kind, name)
	used = usage(kind, name)
	choices = []
	if kind == "email":
		choices = frappe.get_all(EMAIL, filters={"enabled": 1, "name": ["!=", name]}, fields=["name", "template_name", "category"], order_by="template_name asc", limit_page_length=500)
	else:
		choices = [
			{"name": r.name, "template_name": r.template_name, "category": r.category}
			for r in frappe.get_all(WHATSAPP, filters={"status": "APPROVED", "name": ["!=", name]}, fields=["name", "template_name", "category"], order_by="template_name asc", limit_page_length=500)
		]
	return {
		"protected": protected, "can_delete": (not protected) or access.is_admin(), "usage": used, "in_use": bool(used["campaigns"] or used["bookings"]),
		"replacements": choices,
	}


def repoint(kind, name, replacement):
	_dt, field, _flag = KINDS[kind]
	for table in ("CRM Campaign Step", "CRM Demo Message Rule"):
		if frappe.db.exists("DocType", table):
			frappe.db.sql(f"update `tab{table}` set `{field}` = %s where `{field}` = %s", (replacement, name))


def delete_protected(kind, name, replacement=None):
	"""Delete a template that may be protected. Used by the Campaign Manager's delete dialog."""
	doctype, _f, _flag = KINDS[kind]
	info = delete_info(kind, name)
	if info["protected"] and not access.is_admin():
		frappe.throw(_("This is a ready-made template the app depends on. Only a System Manager can delete it."), frappe.PermissionError)
	if info["in_use"]:
		replacement = cstr(replacement).strip()
		if not replacement or replacement == name or not frappe.db.exists(doctype, replacement):
			frappe.throw(_("This template is in use. Choose another template to take its place."))
		if kind == "whatsapp" and frappe.db.get_value(doctype, replacement, "status") != "APPROVED":
			frappe.throw(_("The replacement must be a template that Meta has approved."))
		if kind == "email" and not frappe.db.get_value(doctype, replacement, "enabled"):
			frappe.throw(_("The replacement is archived. Choose an active template."))
		repoint(kind, name, replacement)
	frappe.flags.crm_template_delete_ok = True
	try:
		frappe.delete_doc(doctype, name, ignore_permissions=True)
	finally:
		frappe.flags.crm_template_delete_ok = False
	return {"deleted": name, "replaced_by": replacement or None}


def guard_delete(doc, method=None):
	"""on_trash: a ready-made template cannot be deleted outside the Campaign Manager's guided delete."""
	if frappe.flags.crm_template_delete_ok:
		return
	flag = "is_system" if doc.doctype == EMAIL else "crm_system"
	if not cint(doc.get(flag)):
		return
	frappe.throw(
		_("{0} is a ready-made template that the app's own messages (bookings, reminders) depend on, so it cannot be deleted here. "
		"A System Manager can delete it from the Campaign Manager, which asks for another template to take its place first.").format(frappe.bold(doc.name)),
		frappe.PermissionError,
	)


def guard_archive(doc):
	"""Archiving a protected email template switches off the messages that use it: System Managers only."""
	if cint(doc.get("is_system")) and not doc.get("enabled") and not access.is_admin():
		frappe.throw(_("This is a ready-made template the app depends on. Only a System Manager can archive it."), frappe.PermissionError)
