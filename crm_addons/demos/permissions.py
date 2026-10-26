"""Who sees which demo.

* Managers (System Manager, Sales Manager, Administrator): every demo type and booking.
* A Sales User: only the bookings whose meeting they organize or were invited to as a guest (the owners of the demo type are guests of it).
  They never see a demo type (its message rules, spam settings and so on), and cannot create, change or delete anything here.
"""

import frappe

from crm_addons.utils import is_manager


def involved_sql(user, bookings="`tabCRM Demo Booking`"):
	"""SQL condition: the booking's meeting is one this user organizes, created or was invited to."""
	me = frappe.db.escape(user)
	return (
		f"exists (select 1 from `tabCRM Meeting` m where m.name = {bookings}.meeting and (m.organizer = {me} or m.owner = {me} "
		"or exists (select 1 from `tabCRM Meeting Attendee` a where a.parent = m.name and a.parenttype = 'CRM Meeting' "
		f"and a.user = {me})))"
	)


def booking_query_conditions(user=None):
	user = user or frappe.session.user
	if is_manager(user):
		return ""
	return "(" + involved_sql(user) + ")"


def booking_has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if is_manager(user):
		return True
	if ptype not in (None, "read", "report", "export", "print"):
		return False
	if not doc.get("meeting"):
		return False
	return bool(frappe.db.sql(f"select 1 from `tabCRM Demo Booking` where name = %s and {involved_sql(user)}", doc.name))


def demo_type_has_permission(doc, ptype=None, user=None, debug=False):
	return is_manager(user or frappe.session.user)


def demo_type_query_conditions(user=None):
	return "" if is_manager(user or frappe.session.user) else "1 = 0"
