"""Send an email template, or an approved WhatsApp template, to the leads picked on the Leads screen.

Nothing is typed here: a person can only pick a template from the library. It goes through the same senders as the Campaigns (opt-outs are respected, emails carry an unsubscribe link,
WhatsApp only through templates Meta approved), each message is saved on its lead, and every send is written to CRM Bulk Send for the Campaigns report."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, validate_email_address

from crm_addons.campaigns import channels, optout, personalization
from crm_addons.campaigns.common import email_account_problem, whatsapp_installed
from crm_addons.pro import leads

LEAD = "CRM Lead"
PER_HOUR = 1000


def _budget(amount):
	"""A per-user hourly cap, so this screen is not a way around the campaign limits."""
	cache, key = frappe.cache(), f"crm_addons:pro_bulk_send:{frappe.session.user}"
	used = cint(cache.get_value(key, expires=True))
	if used + amount > PER_HOUR:
		frappe.throw(_("You can send {0} messages per hour from here. Try again later, or use a campaign.").format(PER_HOUR))
	cache.set_value(key, used + amount, expires_in_sec=3600)


def _maker():
	return frappe._dict(campaign_owner=frappe.session.user, owner=frappe.session.user)


EMAIL_TEMPLATE = "CRM Campaign Email Template"
LOG = "CRM Bulk Send"


@frappe.whitelist()
def options():
	"""What can be sent from here: whether email is set up, the email templates, and the approved WhatsApp templates."""
	leads._check()
	problem = email_account_problem()
	out = {"email": {"ready": not problem, "problem": problem or "", "templates": []}, "whatsapp": {"installed": whatsapp_installed(), "templates": []}}
	out["email"]["templates"] = [
		{"name": r.name, "label": r.template_name or r.name, "subject": r.subject, "body": r.body_html}
		for r in frappe.get_all(EMAIL_TEMPLATE, filters={"enabled": 1}, fields=["name", "template_name", "subject", "body_html"], order_by="template_name asc", limit_page_length=500)
	]
	if out["whatsapp"]["installed"]:
		has_map = frappe.get_meta("WhatsApp Templates").has_field("crm_variable_map")
		fields = ["name", "template_name", "template", "language_code", "status"] + (["crm_variable_map"] if has_map else [])
		for r in frappe.get_all("WhatsApp Templates", fields=fields, order_by="template_name asc", limit_page_length=500):
			if cstr(r.status).upper() != "APPROVED":
				continue
			mapping = _saved_map(r)
			wanted = personalization.placeholders_in(r.template)
			out["whatsapp"]["templates"].append({"name": r.name, "label": r.template_name or r.name, "body": r.template, "language": r.language_code, "missing": [n for n in wanted if str(n) not in mapping]})
	return out


def _saved_map(row):
	try:
		data = json.loads(row.get("crm_variable_map") or "{}")
	except ValueError:
		return {}
	return data if isinstance(data, dict) else {}


def _lead(name):
	doc = frappe.get_doc(LEAD, name)
	doc.check_permission("write")
	return doc


def _log(batch, channel, template, label, total, results):
	"""One CRM Bulk Send per batch id; the screen sends in chunks and each chunk adds to it."""
	batch = cstr(batch)[:40] or frappe.generate_hash(length=12)
	name = frappe.db.get_value(LOG, {"batch": batch})
	doc = frappe.get_doc(LOG, name) if name else frappe.new_doc(LOG)
	if name:
		if doc.owner != frappe.session.user:
			return
		old = json.loads(doc.results or "[]")
	else:
		doc.update({"batch": batch, "channel": channel, "template": template, "template_label": label, "total": total})
		old = []
	allr = (old + results)[:5000]
	doc.results = json.dumps(allr)
	doc.sent = sum(1 for r in allr if r["status"] == "sent")
	doc.skipped = len(allr) - doc.sent
	doc.total = max(cint(doc.total), len(allr))
	doc.save(ignore_permissions=True) if name else doc.insert(ignore_permissions=True)


@frappe.whitelist()
def send_email(names, template, batch=None, total=None):
	leads._check()
	names = leads._names(names)
	if not frappe.db.exists(EMAIL_TEMPLATE, {"name": template, "enabled": 1}):
		frappe.throw(_("Choose an email template."))
	tpl = frappe.db.get_value(EMAIL_TEMPLATE, template, ["template_name", "subject", "body_html"], as_dict=True)
	if email_account_problem():
		frappe.throw(email_account_problem())
	_budget(len(names))
	sender, who, results = frappe.db.get_value("User", frappe.session.user, "email"), _maker(), []
	for name in names:
		try:
			doc = _lead(name)
			to = validate_email_address(cstr(doc.email).strip(), throw=False)
			if not to:
				results.append({"lead": name, "title": doc.lead_name, "status": "skipped", "reason": cstr(_("No email address"))})
				continue
			if optout.is_opted_out("Email", to):
				results.append({"lead": name, "title": doc.lead_name, "status": "skipped", "reason": cstr(_("Opted out"))})
				continue
			ctx = personalization.build_context(doc, who)
			html = personalization.render(tpl.body_html, ctx, html=True)
			channels.queue_email(to, personalization.render(tpl.subject, ctx), html, html, LEAD, name, sender)
			results.append({"lead": name, "title": doc.lead_name, "status": "sent", "reason": ""})
		except Exception as exc:
			results.append({"lead": name, "title": "", "status": "skipped", "reason": cstr(exc)[:200]})
	_log(batch, "Email", template, tpl.template_name or template, cint(total) or len(names), results)
	return _summary(results)


@frappe.whitelist()
def send_whatsapp(names, template, batch=None, total=None):
	leads._check()
	names = leads._names(names)
	if not whatsapp_installed():
		frappe.throw(_("The frappe_whatsapp app is not installed on this site."))
	if not frappe.db.exists("WhatsApp Templates", template):
		frappe.throw(_("Choose a WhatsApp template."))
	row = frappe.db.get_value("WhatsApp Templates", template, ["template_name", "crm_variable_map"] if frappe.get_meta("WhatsApp Templates").has_field("crm_variable_map") else ["template_name"], as_dict=True)
	step = {"wa_template": template, "variable_map": json.dumps(_saved_map(row))}
	sender = channels.get_sender("WhatsApp")
	sender.check_ready(step)
	_budget(len(names))
	who, results = _maker(), []
	for name in names:
		try:
			doc = _lead(name)
			number = sender.address(doc)
			if not number:
				results.append({"lead": name, "title": doc.lead_name, "status": "skipped", "reason": cstr(_("No valid WhatsApp number"))})
				continue
			if optout.is_opted_out("WhatsApp", number):
				results.append({"lead": name, "title": doc.lead_name, "status": "skipped", "reason": cstr(_("Opted out"))})
				continue
			recipient = frappe._dict(name="BULK-" + frappe.generate_hash(length=8), whatsapp_number=number, recipient_type=LEAD, recipient_id=name)
			sender.send(who, step, recipient, doc)
			results.append({"lead": name, "title": doc.lead_name, "status": "sent", "reason": ""})
		except channels.Skip as exc:
			results.append({"lead": name, "title": "", "status": "skipped", "reason": cstr(exc)})
		except Exception as exc:
			results.append({"lead": name, "title": "", "status": "skipped", "reason": cstr(exc)[:200]})
	_log(batch, "WhatsApp", template, row.template_name or template, cint(total) or len(names), results)
	return _summary(results)


def _summary(results):
	return {"sent": sum(1 for r in results if r["status"] == "sent"), "skipped": [{"name": r["lead"], "reason": r["reason"]} for r in results if r["status"] != "sent"]}


@frappe.whitelist()
def get_report(from_date=None, to_date=None):
	"""Bulk sends for the Campaigns report: totals, sends per day, and one row per send. Managers see everyone's, others their own."""
	from crm_addons.campaigns import engine
	from crm_addons.campaigns.api import _check_user
	from crm_addons.team_access import access

	_check_user()
	access.require("campaign_reports", 1, _("You do not have access to the campaign reports."))
	filters = {}
	if from_date:
		filters["creation"] = [">=", f"{from_date} 00:00:00"]
	if to_date:
		filters["creation"] = ["between", [f"{from_date or '1970-01-01'} 00:00:00", f"{to_date} 23:59:59"]]
	if not engine.is_manager():
		filters["owner"] = frappe.session.user
	rows = frappe.get_all(LOG, filters=filters, fields=["name", "creation", "owner", "channel", "template", "template_label", "total", "sent", "skipped", "results"], order_by="creation desc", limit_page_length=500)
	totals = {"sends": len(rows), "leads": 0, "sent": 0, "skipped": 0, "Email": 0, "WhatsApp": 0}
	by_day = {}
	for r in rows:
		totals["leads"] += cint(r.total)
		totals["sent"] += cint(r.sent)
		totals["skipped"] += cint(r.skipped)
		totals[r.channel] = totals.get(r.channel, 0) + cint(r.sent)
		day = str(r.creation)[:10]
		by_day[day] = by_day.get(day, 0) + cint(r.sent)
		r["by"] = frappe.db.get_value("User", r.owner, "full_name") or r.owner
		try:
			res = json.loads(r.pop("results") or "[]")
		except ValueError:
			res = []
		r["skipped_rows"] = [x for x in res if x["status"] != "sent"][:200]
	return {"totals": totals, "by_day": [{"day": d, "sent": n} for d, n in sorted(by_day.items())], "rows": rows}
