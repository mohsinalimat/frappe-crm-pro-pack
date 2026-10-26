"""Who sees which campaign, per the person's access settings (Team and access): Campaigns = own / my team / everyone / none.
Own = campaigns they own or run; my team = the same for everyone below them in the Sales Hierarchy. Managers and the Campaign Manager role
keep "everyone" by default."""

import frappe

from crm_addons.team_access import access


def _who(user):
	users = access.scope_users("campaigns", user)
	if users is None:
		return None
	return ", ".join(frappe.db.escape(u) for u in sorted(users)) if users else "''"


def _sees(doc_owner, doc_runner, user):
	users = access.scope_users("campaigns", user)
	return users is None or bool({doc_owner, doc_runner} & users)


def campaign_query_conditions(user=None):
	who = _who(user or frappe.session.user)
	if who is None:
		return ""
	return f"(`tabCRM Campaign`.owner in ({who}) or `tabCRM Campaign`.campaign_owner in ({who}))"


def campaign_has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype == "create":
		return True
	return _sees(doc.owner, doc.get("campaign_owner"), user)


def recipient_query_conditions(user=None):
	who = _who(user or frappe.session.user)
	if who is None:
		return ""
	return (
		"exists (select 1 from `tabCRM Campaign` c where c.name = `tabCRM Campaign Recipient`.campaign "
		f"and (c.owner in ({who}) or c.campaign_owner in ({who})))"
	)


def recipient_has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype not in (None, "read", "report", "export"):
		return access.scope_users("campaigns", user) is None
	owners = frappe.db.get_value("CRM Campaign", doc.campaign, ["owner", "campaign_owner"])
	return bool(owners) and _sees(owners[0], owners[1], user)


def automation_query_conditions(user=None):
	who = _who(user or frappe.session.user)
	if who is None:
		return ""
	return f"(`tabCRM Campaign Automation`.owner in ({who}) or `tabCRM Campaign Automation`.automation_owner in ({who}))"


def automation_has_permission(doc, ptype=None, user=None, debug=False):
	user = user or frappe.session.user
	if ptype == "create":
		return True
	return _sees(doc.owner, doc.get("automation_owner"), user)
