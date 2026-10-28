"""Making Frappe CRM Suite Pro the site's default app: the app tile for Frappe's app screen, and the one-time offer shown to an administrator inside the CRM."""

import frappe
from frappe import _

APP = "crm_addons"
ASKED = "crm_addons_default_app_asked"
ROLES = ("System Manager", "Sales Manager", "Sales User")


def check_app_permission():
	"""Who sees the Suite Pro tile on Frappe's app screen: anyone who works in the CRM."""
	if frappe.session.user == "Administrator":
		return True
	return bool(set(frappe.get_roles()) & set(ROLES))


def _can_choose():
	"""Only a System Manager changes the site's default app, and only a Frappe that has the setting."""
	return "System Manager" in frappe.get_roles() and frappe.get_meta("System Settings").has_field("default_app")


@frappe.whitelist()
def offer():
	"""Whether to show this administrator the 'make it your default app' offer: they have not answered it and the default is not already this app."""
	if frappe.session.user == "Guest" or not _can_choose():
		return {"show": False}
	if frappe.db.get_single_value("System Settings", "default_app") == APP:
		return {"show": False}
	return {"show": not _asked()}


def _asked():
	return bool(frappe.db.get_value("DefaultValue", {"parent": frappe.session.user, "defkey": ASKED}, "name"))


def _remember():
	frappe.defaults.set_user_default(ASKED, "1", user=frappe.session.user)


@frappe.whitelist()
def set_default():
	"""Make Suite Pro the default app of the site (everyone who can open it, unless they chose their own)."""
	if not _can_choose():
		frappe.throw(_("Only a System Manager can change the default app."), frappe.PermissionError)
	frappe.db.set_single_value("System Settings", "default_app", APP)
	frappe.clear_cache()
	_remember()
	return {"ok": True}


@frappe.whitelist()
def dismiss():
	"""'Not now' / 'Keep CRM': do not ask this person again. The setting stays in System Settings."""
	if frappe.session.user != "Guest":
		_remember()
	return {"ok": True}
