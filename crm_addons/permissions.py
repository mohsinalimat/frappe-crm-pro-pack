"""Who can see and change a meeting.

* System Managers, Sales Managers and Administrator: every meeting.
* Everyone else (Sales Users): only meetings they created, organize, or were
  added to as a guest. Only the creator / organizer can edit or cancel.
"""

import frappe

from crm_addons.team_access import access
from crm_addons.utils import is_manager


def get_permission_query_conditions(user=None):
	user = user or frappe.session.user
	users = access.scope_users("meetings", user)
	if users is None:
		return ""
	if not users:
		return "1 = 0"
	who = ", ".join(frappe.db.escape(u) for u in sorted(users))
	return (
		f"(`tabCRM Meeting`.owner in ({who}) or `tabCRM Meeting`.organizer in ({who}) or exists ("
		"select 1 from `tabCRM Meeting Attendee` a where a.parent = `tabCRM Meeting`.name "
		f"and a.parenttype = 'CRM Meeting' and a.user in ({who})))"
	)


def has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype == "create":
		return True
	users = access.scope_users("meetings", user)
	is_author = user in (doc.owner, doc.get("organizer"))
	visible = users is None or bool({doc.owner, doc.get("organizer")} & users) or any(row.user in users for row in (doc.get("attendees") or []) if row.get("user"))
	if ptype in ("write", "delete", "cancel", "submit", "amend"):
		# the author, or a manager who can see this meeting
		return is_author or (is_manager(user) and visible)
	return is_author or visible


# -- follow-ups: what the person's access settings allow (own / their team's / everyone's) ------------------------


def get_follow_up_query_conditions(user=None):
	user = user or frappe.session.user
	users = access.scope_users("followups", user)
	if users is None:
		return ""
	if not users:
		return "1 = 0"
	who = ", ".join(frappe.db.escape(u) for u in sorted(users))
	return f"(`tabCRM Follow Up`.owner in ({who}) or `tabCRM Follow Up`.assigned_to in ({who}))"


def has_follow_up_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype == "create":
		return True
	users = access.scope_users("followups", user)
	return users is None or bool({doc.owner, doc.get("assigned_to")} & users)


# -- a Sales User sees only their own data -------------------------------------------------------------------------
#
# Managers, System Managers, Administrator and Campaign Managers keep full access. For everyone else the server
# adds these conditions to every list and report (the UI hiding things is not what protects the data):
#
# * CRM Lead: CRM's own condition (crm.permissions.org_hierarchy) already limits a Sales User to the leads they own or
#   are assigned. Older CRM releases have none, so Pro Pack adds the same rule - but only when CRM has not.
# * CRM Call Log, FCRM Note, CRM Task: what the user created, was assigned or took part in, plus whatever is attached
#   to a lead they own or are assigned (so the lead's own timeline stays complete after it is reassigned).

LEAD_OWNED = (
	"(`tab{dt}`.reference_doctype = 'CRM Lead' and (exists (select 1 from `tabCRM Lead` _l where _l.name = `tab{dt}`.reference_docname "
	"and _l.lead_owner = {me}) or exists (select 1 from `tabToDo` _t where _t.reference_type = 'CRM Lead' "
	"and _t.reference_name = `tab{dt}`.reference_docname and _t.allocated_to = {me} and _t.status != 'Cancelled')))"
)


def sees_everything(user=None):
	"""Who is not limited to their own records: Administrator, System / Sales / Campaign Managers."""
	from crm_addons.utils import is_campaign_manager

	return is_campaign_manager(user or frappe.session.user)


def _crm_limits_leads():
	"""Does Frappe CRM (or another app) already add a permission condition on CRM Lead?"""
	hooks = frappe.get_hooks("permission_query_conditions").get("CRM Lead") or []
	return any(not str(m).startswith("crm_addons.") for m in hooks)


def _owns_lead(docname, user):
	if not docname:
		return False
	if frappe.db.get_value("CRM Lead", docname, "lead_owner") == user:
		return True
	return bool(
		frappe.db.exists("ToDo", {"reference_type": "CRM Lead", "reference_name": docname, "allocated_to": user, "status": ["!=", "Cancelled"]})
	)


def lead_query_conditions(user=None):
	user = user or frappe.session.user
	if sees_everything(user) or _crm_limits_leads():
		return ""
	me = frappe.db.escape(user)
	return (
		f"(`tabCRM Lead`.lead_owner = {me} or exists (select 1 from `tabToDo` _t where _t.reference_type = 'CRM Lead' "
		f"and _t.reference_name = `tabCRM Lead`.name and _t.allocated_to = {me} and _t.status != 'Cancelled'))"
	)


def lead_has_permission(doc, ptype=None, user=None, debug=False):
	"""Frappe stops at the first hook that answers, so "allowed" is ``None`` (no opinion): that leaves CRM's own
	check in charge. Only a refusal is returned."""
	user = user or frappe.session.user
	if sees_everything(user) or ptype == "create" or _crm_limits_leads() or not doc.get("name"):
		return None
	return True if (user == doc.get("lead_owner") or _owns_lead(doc.name, user)) else False


def _linked_conditions(doctype, user, own_fields):
	if sees_everything(user):
		return ""
	me = frappe.db.escape(user)
	table = f"`tab{doctype}`"
	own = " or ".join(f"{table}.`{f}` = {me}" for f in own_fields)
	return f"({own} or {LEAD_OWNED.format(dt=doctype, me=me)})"


def _linked_has_permission(doc, ptype, user, own_fields):
	user = user or frappe.session.user
	if sees_everything(user) or ptype == "create" or user in [doc.get(f) for f in own_fields]:
		return None
	return None if doc.get("reference_doctype") == "CRM Lead" and _owns_lead(doc.get("reference_docname"), user) else False


def call_log_query_conditions(user=None):
	return _linked_conditions("CRM Call Log", user or frappe.session.user, ("owner", "caller", "receiver"))


def call_log_has_permission(doc, ptype=None, user=None, debug=False):
	return _linked_has_permission(doc, ptype, user, ("owner", "caller", "receiver"))


def note_query_conditions(user=None):
	return _linked_conditions("FCRM Note", user or frappe.session.user, ("owner",))


def note_has_permission(doc, ptype=None, user=None, debug=False):
	return _linked_has_permission(doc, ptype, user, ("owner",))


def task_query_conditions(user=None):
	return _linked_conditions("CRM Task", user or frappe.session.user, ("owner", "assigned_to"))


def task_has_permission(doc, ptype=None, user=None, debug=False):
	return _linked_has_permission(doc, ptype, user, ("owner", "assigned_to"))
