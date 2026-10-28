"""Messages to someone who filled in a lead form: a welcome message at once and, if wanted, a follow-up after a day or two, by email and WhatsApp.

Each message is a row of ``CRM Lead Form Message``: written when the lead is created (a delay of 0 goes out straight away) and sent by the scheduler
(``send_due``, every minute) from the campaign template library, filled in with the lead's own details. Exactly-once: a row is claimed with one guarded
``UPDATE ... WHERE status = 'Pending'``. WhatsApp is sent only when the person ticked the consent box, and never to a number that replied STOP.
Only new leads get these messages: someone who is already a lead is not written to again.
"""

import json
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime, strip_html

from crm_addons.campaigns import optout, personalization
from crm_addons.campaigns.channels import ChannelError, queue_email, send_whatsapp_template
from crm_addons.demos import messaging
from crm_addons.demos.common import LEAD

MESSAGE = "CRM Lead Form Message"
FORM = "CRM Lead Form"
MARKER = "CRMLEADFORM:"
MAX_RULES = 6
MAX_DELAY = 30 * 24 * 60


def clean_messages(raw):
	"""[{after_minutes, send_email, email_template, send_whatsapp, wa_template, wa_account, wa_variables}] from a JSON string or list. A channel that is on needs a template."""
	rows = raw
	if isinstance(raw, str):
		try:
			rows = json.loads(raw) if raw.strip() else []
		except ValueError:
			frappe.throw(_("The messages are not valid."))
	out = []
	for r in (rows or [])[:MAX_RULES]:
		r = r or {}
		after = max(0, min(cint(r.get("after_minutes")), MAX_DELAY))
		row = {
			"after_minutes": after, "send_email": 1 if cint(r.get("send_email")) else 0, "email_template": cstr(r.get("email_template")).strip(),
			"send_whatsapp": 1 if cint(r.get("send_whatsapp")) else 0, "wa_template": cstr(r.get("wa_template")).strip(), "wa_account": cstr(r.get("wa_account")).strip(),
			"wa_variables": cstr(r.get("wa_variables")).strip(),
		}
		if not row["send_email"] and not row["send_whatsapp"]:
			continue
		if row["send_email"] and not row["email_template"]:
			frappe.throw(_("Choose an email template for each message that sends an email."))
		if row["send_whatsapp"] and not row["wa_template"]:
			frappe.throw(_("Choose a WhatsApp template for each message that sends on WhatsApp."))
		out.append(row)
	return out


def load_rules(form):
	try:
		return json.loads(form.get("messages_json") or "[]")
	except ValueError:
		return []


def queue(form, entry, lead, consent):
	"""Write the form's messages for a new lead. A WhatsApp message without consent is written as Skipped, so the log says why."""
	now = now_datetime()
	made = 0
	for i, rule in enumerate(load_rules(form)):
		due = now + timedelta(minutes=cint(rule.get("after_minutes")))
		for channel, on in (("Email", rule.get("send_email")), ("WhatsApp", rule.get("send_whatsapp"))):
			if not cint(on):
				continue
			skip = channel == "WhatsApp" and not consent
			frappe.get_doc({
				"doctype": MESSAGE, "form": form.name, "entry": entry, "lead": lead, "rule_index": i, "channel": channel, "due_at": due,
				"status": "Skipped" if skip else "Pending", "error": _("The person did not agree to WhatsApp messages.") if skip else "",
			}).insert(ignore_permissions=True)
			made += 1
	if made and not frappe.flags.in_test:
		try:
			frappe.enqueue("crm_addons.demos.leadform_messages.send_due", queue="short", enqueue_after_commit=True)
		except Exception:
			frappe.logger().warning("Lead form: could not queue the message job", exc_info=True)
	return made


def _claim(name, token):
	frappe.db.sql(f"update `tab{MESSAGE}` set status = 'Sending', error = %s, modified = %s where name = %s and status = 'Pending'", (token, now_datetime(), name))
	return frappe.db.sql("select row_count()")[0][0] == 1


def _finish(name, status, error="", reference=""):
	frappe.db.sql(f"update `tab{MESSAGE}` set status = %s, error = %s, reference = %s, modified = %s where name = %s", (status, cstr(error)[:500], reference, now_datetime(), name))


def _rule_of(row, form):
	rules = load_rules(form)
	if row.rule_index >= len(rules):
		return None
	return frappe._dict(rules[row.rule_index])


def _deliver(name):
	row = frappe.db.get_value(MESSAGE, name, ["name", "form", "lead", "rule_index", "channel"], as_dict=True)
	if not row.lead or not frappe.db.exists(LEAD, row.lead) or not frappe.db.exists(FORM, row.form):
		raise messaging.Skipped(_("The lead or the form no longer exists."))
	form = frappe.get_doc(FORM, row.form)
	rule = _rule_of(row, form)
	if not rule:
		raise messaging.Skipped(_("This message was removed from the form."))
	lead = frappe.get_doc(LEAD, row.lead)
	owner = lead.get("lead_owner") or "Administrator"
	context = personalization.build_context(lead, frappe._dict(campaign_owner=owner, owner=owner))
	if row.channel == "Email":
		if not lead.get("email"):
			raise messaging.Skipped(_("The lead has no email address."))
		subject, html = messaging._render_email(rule, context)
		sender = frappe.db.get_value("User", owner, "email") if owner != "Administrator" else None
		_comm, mail = queue_email(lead.email, subject, html, html, LEAD, lead.name, sender, unsubscribe=False)
		if not mail:
			raise messaging.Skipped(_("Frappe's mail system has this address unsubscribed."))
		return mail.name
	number = personalization_number(lead)
	if not number:
		raise messaging.Skipped(_("The lead has no WhatsApp number."))
	if optout.is_opted_out("WhatsApp", number):
		raise messaging.Skipped(_("This number replied STOP."))
	template, account, params = messaging._prepare_whatsapp(rule, context)
	return send_whatsapp_template(template, account, number, params, LEAD, lead.name, MARKER + name).name


def personalization_number(lead):
	from crm_addons.campaigns.common import normalize_whatsapp

	return normalize_whatsapp(lead.get("mobile_no") or lead.get("phone"), None)


def process(name):
	token = frappe.generate_hash(length=12)
	if not _claim(name, token):
		return False
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- background job; a claim must be durable before work starts
	try:
		_finish(name, "Sent", reference=_deliver(name))
	except messaging.Skipped as exc:
		_finish(name, "Skipped", cstr(exc))
	except ChannelError as exc:
		frappe.db.rollback()
		_finish(name, "Failed", cstr(exc))
	except Exception as exc:
		frappe.db.rollback()
		frappe.log_error(title="Lead form: a message could not be sent", message=frappe.get_traceback())
		_finish(name, "Failed", strip_html(cstr(exc)) or exc.__class__.__name__)
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- background job
	return True


def send_due(limit=100):
	"""Scheduler, every minute: send what is due. One bad message never stops the others."""
	rows = frappe.db.sql(f"select name from `tab{MESSAGE}` where status = 'Pending' and due_at <= %s order by due_at limit %s", (now_datetime(), cint(limit)))
	sent = 0
	for (name,) in rows:
		try:
			sent += 1 if process(name) else 0
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="Lead form: message worker", message=frappe.get_traceback())
	frappe.db.sql(f"update `tab{MESSAGE}` set status = 'Failed', error = 'The worker stopped before this was confirmed.' where status = 'Sending' and modified < %s", (now_datetime() - timedelta(minutes=15),))
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- background job
	return sent
