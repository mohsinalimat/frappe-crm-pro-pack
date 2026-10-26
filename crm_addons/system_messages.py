"""The app's own WhatsApp messages that are not about bookings: the ready-made template for a missed call, and sending it.

A plain WhatsApp text only reaches a lead who wrote to you in the last 24 hours, so after a missed call the safe message is an
approved template. The template is created from the setup page (it goes to Meta for review) and marked as ready-made, so it is
protected from deletion like the booking templates (campaigns/protected.py).
"""

import frappe
from frappe import _
from frappe.utils import cstr

MISSED_CALL = {
	"template_name": "missed_call_followup", "category": "UTILITY", "language": "en",
	"template": "Hi {{1}}, we just tried to call you but could not reach you. When is a good time to talk?",
	"sample_values": ["Asha"], "variable_map": {"1": "{{ first_name }}"}, "buttons": [],
}


LOGIN = {
	"template_name": "crm_login_link", "category": "UTILITY", "language": "en",
	"template": "Hi {{1}}, your CRM account is ready. Set your password and sign in here: {{2}}\n\nThe link works once and expires, so open it soon.",
	"sample_values": ["Asha", "https://crm.example.com/update-password?key=abc123"], "variable_map": {"1": "{{ first_name }}", "2": "{{ login_link }}"}, "buttons": [],
}


def login_template_status():
	"""For the admin screen: {exists, name, state, ready}. The login-link template is created once from Team and access."""
	if not frappe.db.exists("DocType", "WhatsApp Templates"):
		return {"available": False, "exists": False, "state": "", "ready": False}
	name = frappe.db.get_value("WhatsApp Templates", {"template_name": LOGIN["template_name"]}, "name")
	if not name:
		return {"available": True, "exists": False, "state": "", "ready": False}
	state = cstr(frappe.db.get_value("WhatsApp Templates", name, "status")).upper() or "NOT SYNCED"
	return {"available": True, "exists": True, "name": name, "state": state, "ready": state == "APPROVED"}


def create_login_template():
	from crm_addons.campaigns import api as campaign_api

	st = login_template_status()
	if st["exists"]:
		return {"name": st["name"], "status": st["state"], "message": _("This template already exists.")}
	out = campaign_api.create_whatsapp_template(frappe.parse_json(frappe.as_json(LOGIN)))
	if frappe.get_meta("WhatsApp Templates").has_field("crm_system"):
		frappe.db.set_value("WhatsApp Templates", out["name"], "crm_system", 1)
	return out


def send_login_link(user, link):
	"""WhatsApp the new person their set-password link (never a password). Raises with a plain reason when it cannot be sent."""
	from crm_addons.campaigns import personalization
	from crm_addons.campaigns.channels import ChannelError, WhatsAppSender, send_whatsapp_template
	from crm_addons.campaigns.common import normalize_whatsapp

	st = login_template_status()
	if not st["exists"]:
		frappe.throw(_("The WhatsApp login template has not been created yet. Create it in Team and access."))
	if not st["ready"]:
		frappe.throw(_("The WhatsApp login template is {0}, not approved by Meta yet.").format(frappe.bold(st["state"].lower())))
	number = frappe.db.get_value("User", user, "mobile_no")
	to = normalize_whatsapp(number, _settings().get("default_country_code")) if number else None
	if not to:
		frappe.throw(_("This person has no valid mobile number for WhatsApp."))
	first = frappe.db.get_value("User", user, "first_name") or user
	sender = WhatsAppSender()
	step = frappe._dict(wa_template=st["name"], variable_map=frappe.as_json(LOGIN["variable_map"]))
	try:
		template = sender._template(step)
		account = sender.account(step)
		params, _missing = personalization.render_whatsapp_params(step, {"first_name": first, "login_link": link})
		doc = send_whatsapp_template(template.name, account, to, params, None, None, "crm-addons-login-link")
	except ChannelError as exc:
		frappe.throw(cstr(exc))
	return {"message": doc.name, "to": to}


def _settings():
	from crm_addons.utils import get_settings

	return get_settings()


def template_info(name=None):
	"""The chosen missed-call template and whether it can be sent: {name, label, body, state, ready} or None when none is chosen."""
	name = name or _settings().get("missed_call_whatsapp_template")
	if not name or not frappe.db.exists("DocType", "WhatsApp Templates") or not frappe.db.exists("WhatsApp Templates", name):
		return None
	row = frappe.db.get_value("WhatsApp Templates", name, ["template_name", "template", "status"], as_dict=True)
	state = cstr(row.status).upper() or "NOT SYNCED"
	return {"name": name, "label": row.template_name, "body": row.template, "state": state, "ready": state == "APPROVED"}


def create_missed_call_template():
	"""Submit the ready-made template to Meta (System Managers, from the setup page). It stays Pending until Meta approves it."""
	from crm_addons.campaigns import api as campaign_api

	if frappe.db.exists("WhatsApp Templates", {"template_name": MISSED_CALL["template_name"]}):
		name = frappe.db.get_value("WhatsApp Templates", {"template_name": MISSED_CALL["template_name"]}, "name")
		return {"name": name, "status": cstr(frappe.db.get_value("WhatsApp Templates", name, "status")).upper() or "PENDING", "message": _("This template already exists.")}
	out = campaign_api.create_whatsapp_template(frappe.parse_json(frappe.as_json(MISSED_CALL)))
	if frappe.get_meta("WhatsApp Templates").has_field("crm_system"):
		frappe.db.set_value("WhatsApp Templates", out["name"], "crm_system", 1)
	return out


def send_missed_call_template(reference_doctype, reference_name):
	"""Send the chosen template to the lead. Returns {"message", "to"}; raises with a plain reason when it cannot be sent."""
	from crm_addons.campaigns import personalization
	from crm_addons.campaigns.channels import ChannelError, WhatsAppSender, send_whatsapp_template
	from crm_addons.followups import _phone_for

	info = template_info()
	if not info:
		frappe.throw(_("No WhatsApp template is chosen for missed calls."))
	if not info["ready"]:
		frappe.throw(_("The missed-call WhatsApp template is {0}, not approved by Meta yet.").format(frappe.bold(info["state"].lower())))
	number = _phone_for(reference_doctype, reference_name)
	if not number:
		frappe.throw(_("This record has no mobile number to send a WhatsApp message to."))
	from crm_addons.campaigns.common import normalize_whatsapp

	to = normalize_whatsapp(number, _settings().get("default_country_code"))
	if not to:
		frappe.throw(_("The mobile number on this record is not a valid WhatsApp number."))
	sender = WhatsAppSender()
	mapping = frappe.db.get_value("WhatsApp Templates", info["name"], "crm_variable_map") if frappe.get_meta("WhatsApp Templates").has_field("crm_variable_map") else None
	step = frappe._dict(wa_template=info["name"], variable_map=mapping or frappe.as_json(MISSED_CALL["variable_map"]))
	try:
		template = sender._template(step)
		account = sender.account(step)
		lead = frappe.get_doc(reference_doctype, reference_name)
		params, missing = personalization.render_whatsapp_params(step, personalization.build_context(lead, frappe._dict(campaign_owner=frappe.session.user)))
		if missing:
			frappe.throw(_("The template needs {0}, which this lead does not have.").format(", ".join(missing)))
		doc = send_whatsapp_template(template.name, account, to, params, reference_doctype, reference_name, "crm-addons-missed-call")
	except ChannelError as exc:
		frappe.throw(cstr(exc))
	return {"message": doc.name, "to": to}
