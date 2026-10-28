"""Send an email, or an approved WhatsApp template, to the leads picked on the Leads screen.

It goes through the same senders as the Campaigns (opt-outs are respected, emails carry an unsubscribe link,
WhatsApp only through templates Meta approved) and each message is saved on its lead."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, escape_html, validate_email_address

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


@frappe.whitelist()
def options():
	"""What can be sent from here: whether email is set up, and the approved WhatsApp templates."""
	leads._check()
	out = {"email": {"ready": not email_account_problem(), "problem": email_account_problem() or ""}, "variables": [v["name"] for v in personalization.available_variables()], "whatsapp": {"installed": whatsapp_installed(), "templates": []}}
	if out["whatsapp"]["installed"]:
		fields = ["name", "template_name", "template", "language_code", "status", "sample_values"] + (["crm_variable_map"] if frappe.get_meta("WhatsApp Templates").has_field("crm_variable_map") else [])
		for r in frappe.get_all("WhatsApp Templates", fields=fields, order_by="template_name asc", limit_page_length=500):
			if cstr(r.status).upper() != "APPROVED":
				continue
			try:
				saved = json.loads(r.get("crm_variable_map") or "{}")
			except ValueError:
				saved = {}
			out["whatsapp"]["templates"].append({"name": r.name, "label": r.template_name or r.name, "body": r.template, "language": r.language_code, "placeholders": personalization.placeholders_in(r.template), "variable_map": saved if isinstance(saved, dict) else {}})
	return out


def _lead(name):
	doc = frappe.get_doc(LEAD, name)
	doc.check_permission("write")
	return doc


@frappe.whitelist()
def send_email(names, subject, content):
	leads._check()
	names = leads._names(names)
	subject, content = cstr(subject).strip(), cstr(content).strip()
	if not subject or not content:
		frappe.throw(_("Add a subject and a message."))
	unknown = personalization.unknown_variables(subject, content)
	if unknown:
		frappe.throw(_("Unknown variable(s): {0}.").format(", ".join(unknown)))
	if email_account_problem():
		frappe.throw(email_account_problem())
	_budget(len(names))
	sender, who, sent, skipped = frappe.db.get_value("User", frappe.session.user, "email"), _maker(), 0, []
	for name in names:
		try:
			doc = _lead(name)
			to = validate_email_address(cstr(doc.email).strip(), throw=False)
			if not to:
				skipped.append({"name": name, "reason": _("No email address")})
				continue
			if optout.is_opted_out("Email", to):
				skipped.append({"name": name, "reason": _("Opted out")})
				continue
			ctx = personalization.build_context(doc, who)
			html = escape_html(personalization.render(content, ctx)).replace("\n", "<br>")
			channels.queue_email(to, personalization.render(subject, ctx), html, html, LEAD, name, sender)
			sent += 1
		except Exception as exc:
			skipped.append({"name": name, "reason": cstr(exc)[:200]})
	return {"sent": sent, "skipped": skipped}


@frappe.whitelist()
def send_whatsapp(names, template, variable_map=None):
	leads._check()
	names = leads._names(names)
	if not whatsapp_installed():
		frappe.throw(_("The frappe_whatsapp app is not installed on this site."))
	step = {"wa_template": template, "variable_map": variable_map if isinstance(variable_map, str) else json.dumps(variable_map or {})}
	sender = channels.get_sender("WhatsApp")
	sender.check_ready(step)
	_budget(len(names))
	who, sent, skipped = _maker(), 0, []
	for name in names:
		try:
			doc = _lead(name)
			number = sender.address(doc)
			if not number:
				skipped.append({"name": name, "reason": _("No valid WhatsApp number")})
				continue
			if optout.is_opted_out("WhatsApp", number):
				skipped.append({"name": name, "reason": _("Opted out")})
				continue
			recipient = frappe._dict(name="BULK-" + frappe.generate_hash(length=8), whatsapp_number=number, recipient_type=LEAD, recipient_id=name)
			sender.send(who, step, recipient, doc)
			sent += 1
		except channels.Skip as exc:
			skipped.append({"name": name, "reason": cstr(exc)})
		except Exception as exc:
			skipped.append({"name": name, "reason": cstr(exc)[:200]})
	return {"sent": sent, "skipped": skipped}
