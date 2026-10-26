"""Who sees which demo, per the person's access settings (Team and access).

* Bookings (a scope): no access / own = the demos whose meeting they organize or were invited to (the owners of a demo type are guests of it) /
  my team = the same for everyone below them in the Sales Hierarchy / everyone. Managers keep "everyone" unless an admin limits them.
* Widgets (the booking pages and their settings): none / view / create and edit.
"""

import frappe

from crm_addons.team_access import access

READ_TYPES = (None, "read", "report", "export", "print")


def involved_sql(user, bookings="`tabCRM Demo Booking`"):
	"""SQL condition: the booking's meeting is one this user (or any of these users) organizes, created or was invited to."""
	users = [user] if isinstance(user, str) else sorted(user)
	who = ", ".join(frappe.db.escape(u) for u in users) or "''"
	return (
		f"exists (select 1 from `tabCRM Meeting` m where m.name = {bookings}.meeting and (m.organizer in ({who}) or m.owner in ({who}) "
		"or exists (select 1 from `tabCRM Meeting Attendee` a where a.parent = m.name and a.parenttype = 'CRM Meeting' "
		f"and a.user in ({who}))))"
	)


def scope_sql(user=None, bookings="`tabCRM Demo Booking`"):
	"""The demos the person may see, as a SQL condition ("" = all of them, "1 = 0" = none)."""
	users = access.scope_users("demos", user)
	if users is None:
		return ""
	return involved_sql(users, bookings) if users else "1 = 0"


def sees_others(user=None):
	return access.level("demos", user) in (access.R.TEAM, access.R.ALL)


def booking_query_conditions(user=None):
	user = user or frappe.session.user
	cond = scope_sql(user)
	return f"({cond})" if cond else ""


def booking_has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype not in READ_TYPES and not sees_others(user):
		return False
	users = access.scope_users("demos", user)
	if users is None:
		return True
	if not doc.get("meeting"):
		return False
	return bool(frappe.db.sql(f"select 1 from `tabCRM Demo Booking` where name = %s and {involved_sql(users)}", doc.name))


def demo_type_has_permission(doc, ptype=None, user=None, debug=False):
	return access.allows("demo_widgets", "view" if ptype in READ_TYPES else "manage", user or frappe.session.user)


def demo_type_query_conditions(user=None):
	return "" if access.allows("demo_widgets", "view", user or frappe.session.user) else "1 = 0"
