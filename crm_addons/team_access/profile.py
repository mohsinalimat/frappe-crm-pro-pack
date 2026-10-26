"""Rules about a person's own User record."""

import frappe
from frappe import _


def guard_mobile_no(doc, method=None):
	"""The contact number is the person's default number in CRM. Only a System Manager (or Administrator) may set or change it;
	the person cannot edit it in their own profile."""
	if doc.is_new() or frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
		return
	before = doc.get_doc_before_save()
	if not before or (before.mobile_no or "") == (doc.mobile_no or ""):
		return
	if frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles():
		return
	frappe.throw(_("Only a System Manager can change the contact number."), frappe.PermissionError)
