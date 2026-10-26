"""Messages to the visitor: confirmation, reschedule, cancel and reminders, by email and WhatsApp.

Each message is a row in the booking's ``messages`` table. ``queue_messages`` writes the Pending rows (a reminder gets the ``due_at`` it
should go out at) and ``send_due`` (every minute, from the scheduler) sends the ones that are due. The wording comes from the campaign
template library, filled in with the demo variables in the visitor's time zone, and goes out through the same email / frappe_whatsapp code
the campaigns use (``campaigns.channels``).

These are transactional messages: they are not held back by the marketing unsubscribe list, but a WhatsApp STOP and a missing WhatsApp
consent are always honoured. Exactly-once: a row is claimed with one guarded ``UPDATE ... WHERE status = 'Pending'`` that only one worker can win.
Rows are never rewritten through the booking document (that would put a stale copy over a worker's update); they are inserted and updated directly.
"""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, now_datetime, strip_html

from crm_addons.campaigns import optout, personalization
from crm_addons.campaigns.channels import ChannelError, WhatsAppSender, queue_email, send_whatsapp_template
from crm_addons.campaigns.common import email_account_problem, normalize_whatsapp
from crm_addons.demos import common
from crm_addons.demos.common import ACTIVE, BOOKING, DEMO_TYPE, LEAD, MESSAGE, as_utc

EVENTS = ("Confirmed", "Rescheduled", "Cancelled", "Reminder")
STALE_SENDING_MINUTES = 15
WA_MARKER = "CRMDEMO:"


class Skipped(Exception):
	"""Nothing to send, for a reason worth showing (not a failure)."""


def _commit():
	frappe.db.commit()  # nosemgrep: frappe-manual-commit -- background job; a claim must be durable before work starts


def _rollback():
	"""Undo a failed send's partial writes. Never rolls back the claim, which was committed first."""
	frappe.db.rollback()


# -- wording ---------------------------------------------------------------------------------------------------------


def _list_names(names):
	names = [n for n in names if n]
	if len(names) <= 1:
		return "".join(names)
	return ", ".join(names[:-1]) + " " + _("and") + " " + names[-1]


def demo_context(booking, demo=None):
	"""Every variable a template may use for this booking; times are in the visitor's zone."""
	booking = frappe._dict(booking) if not hasattr(booking, "get") else booking
	demo = demo or frappe.get_cached_doc(DEMO_TYPE, booking.demo_type)
	owners = common.owners_of(demo, enabled_only=False)
	hosts = [common.full_name(u) for u in owners]
	tz = common.zone(booking.get("visitor_timezone"), demo.get("timezone"))
	local = as_utc(booking.starts_utc).astimezone(tz)
	hour = local.strftime("%I:%M %p").lstrip("0")
	zone_name = local.tzname() or getattr(tz, "key", "")
	if booking.get("lead") and frappe.db.exists(LEAD, booking.lead):
		lead = frappe.get_doc(LEAD, booking.lead)
	else:  # the lead was deleted: the booking still has the visitor's own details
		lead = {"lead_name": booking.get("name_"), "first_name": cstr(booking.get("name_")).split(" ")[0], "email": booking.get("email"), "mobile_no": booking.get("phone")}
	context = personalization.build_context(lead, frappe._dict(campaign_owner=owners[0] if owners else None))
	meeting_link = frappe.db.get_value("CRM Meeting", booking.meeting, "google_meet_link") if booking.get("meeting") else ""
	token = booking.get("token")
	context.update(
		booking_title=demo.title,
		booking_date=f"{local:%A}, {local.day} {local:%B %Y}",
		booking_time=f"{hour} {zone_name}",
		booking_datetime=f"{local:%a}, {local.day} {local:%b %Y}, {hour} {zone_name}",
		booking_duration=_("{0} minutes").format(common.minutes(demo.duration_minutes, 30)),
		meet_link=meeting_link or demo.get("manual_link") or "",
		host_name=hosts[0] if hosts else "",
		host_names=_list_names(hosts),
		booking_link=common.manage_url(token) if token else "",
		reschedule_link=common.manage_url(token, "reschedule") if token else "",
		cancel_link=common.manage_url(token, "cancel") if token else "",
	)
	# the first names of these, so a template written before the rename keeps working
	context.update(demo_title=context["booking_title"], demo_date=context["booking_date"], demo_time=context["booking_time"], demo_datetime=context["booking_datetime"], demo_duration=context["booking_duration"])
	return context


# -- planning ---------------------------------------------------------------------------------------------------------


def _add_row(booking_name, event, channel, due_at, status="Pending", error="", minutes_before=None):
	idx = (frappe.db.sql(f"select max(idx) from `tab{MESSAGE}` where parent = %s and parenttype = %s", (booking_name, BOOKING))[0][0] or 0) + 1
	return frappe.get_doc(
		{
			"doctype": MESSAGE,
			"parent": booking_name,
			"parenttype": BOOKING,
			"parentfield": "messages",
			"idx": idx,
			"event": event,
			"minutes_before": minutes_before,
			"channel": channel,
			"status": status,
			"due_at": due_at,
			"error": error,
		}
	).insert(ignore_permissions=True)


def _booking_row(booking):
	if isinstance(booking, str):
		return frappe.db.get_value(BOOKING, booking, ["name", "demo_type", "status", "starts_utc", "whatsapp_consent"], as_dict=True)
	return frappe._dict(name=booking.name, demo_type=booking.demo_type, status=booking.status, starts_utc=booking.starts_utc, whatsapp_consent=booking.whatsapp_consent)


def queue_messages(booking, event, now=None, reminders=True):
	"""Write the Pending rows for ``event`` (Confirmed / Rescheduled / Cancelled / Reminder). Confirmed and Rescheduled also plan the reminders.
	A reminder that would be due already (the demo is too soon) or that is for a past demo is written as Skipped, with the reason."""
	b = _booking_row(booking)
	demo = frappe.get_cached_doc(DEMO_TYPE, b.demo_type)
	now = now or common.site_now()
	count = 0
	for rule in demo.get("messages") or []:
		if rule.event != event and not (reminders and event in ("Confirmed", "Rescheduled") and rule.event == "Reminder"):
			continue
		reminder = rule.event == "Reminder"
		if reminder:
			due = common.to_site(b.starts_utc) - timedelta(minutes=max(0, cint(rule.minutes_before)))
		else:
			due = now
		for channel, switched_on, ready in (
			("Email", cint(rule.send_email), bool(rule.email_template)),
			("WhatsApp", cint(rule.send_whatsapp), bool(rule.wa_template)),
		):
			if not switched_on:
				continue
			status, error = "Pending", ""
			if not ready:
				status, error = "Skipped", _("No template is chosen for this message.")
			elif channel == "WhatsApp" and not cint(b.whatsapp_consent):
				status, error = "Skipped", _("The visitor did not agree to WhatsApp updates.")
			elif reminder and due <= now:
				status, error = "Skipped", _("Too late: the booking starts sooner than this reminder.")
			_add_row(b.name, rule.event, channel, due, status, error, rule.minutes_before if reminder else None)
			count += 1
	return count


def notify_options(booking):
	"""What an admin can send again for this booking: its confirmation and each reminder the widget has, with which channels have a template."""
	b = _booking_row(booking)
	demo = frappe.get_cached_doc(DEMO_TYPE, b.demo_type)
	out = []
	for rule in demo.get("messages") or []:
		if rule.event not in ("Confirmed", "Reminder", "Rescheduled"):
			continue
		mins = cint(rule.minutes_before) if rule.event == "Reminder" else None
		label = {"Confirmed": _("Confirmation"), "Rescheduled": _("New time"), "Reminder": (_("Reminder, {0} before").format(common.minutes_label(mins)) if mins else _("Reminder: starting now"))}[rule.event]
		out.append({"key": f"{rule.event}:{mins or 0}", "event": rule.event, "minutes_before": mins or 0, "label": label, "email": bool(rule.email_template), "whatsapp": bool(rule.wa_template)})
	return out


def queue_manual(booking, event, minutes_before=0, channels=("Email", "WhatsApp")):
	"""An admin's "Notify": the widget's own message for ``event`` goes to the visitor now, on the chosen channels, whatever the rule's
	on/off switch says (a template must be chosen; WhatsApp still needs the visitor's consent). Returns [(channel, status, reason)]."""
	b = _booking_row(booking)
	demo = frappe.get_cached_doc(DEMO_TYPE, b.demo_type)
	rule = next((r for r in demo.get("messages") or [] if r.event == event and (event != "Reminder" or cint(r.minutes_before) == cint(minutes_before))), None)
	if not rule:
		frappe.throw(_("That message is not part of this widget."))
	if b.status in ("Cancelled",) and event != "Cancelled":
		frappe.throw(_("This booking is cancelled."))
	now = common.site_now()
	result = []
	for channel, template in (("Email", rule.email_template), ("WhatsApp", rule.wa_template)):
		if channel not in channels:
			continue
		status, error = "Pending", ""
		if not template:
			status, error = "Skipped", _("No template is chosen for this message.")
		elif channel == "WhatsApp" and not cint(b.whatsapp_consent):
			status, error = "Skipped", _("The visitor did not agree to WhatsApp updates.")
		_add_row(b.name, rule.event, channel, now, status, error, rule.minutes_before if event == "Reminder" else None)
		result.append((channel, status, error))
	return result


def queue_messages_now(booking, event):
	"""Only the message for ``event`` itself, due now (an admin's Resend); no reminders are planned."""
	return queue_messages(booking, event, reminders=False)


def cancel_pending(booking_name, reason, events=None):
	"""Pending rows that must not go out any more (cancelled or moved demo). Rows already Sending are left to finish."""
	filters = ""
	values = {"parent": booking_name, "type": BOOKING, "reason": reason, "now": now_datetime()}
	if events:
		filters = " and event in %(events)s"
		values["events"] = tuple(events)
	frappe.db.sql(
		f"""update `tab{MESSAGE}` set status = 'Skipped', error = %(reason)s, modified = %(now)s
		where parent = %(parent)s and parenttype = %(type)s and status = 'Pending'{filters}""",
		values,
	)


# -- sending ----------------------------------------------------------------------------------------------------------


def _claim(name, token):
	"""True for exactly one caller: the one whose UPDATE moved the row from Pending to Sending."""
	frappe.db.sql(
		f"update `tab{MESSAGE}` set status = 'Sending', claim_token = %s, modified = %s where name = %s and status = 'Pending'",
		(token, now_datetime(), name),
	)
	return frappe.db.sql("select row_count()")[0][0] == 1


def _finish(name, token, status, error="", reference=""):
	frappe.db.sql(
		f"""update `tab{MESSAGE}` set status = %(status)s, sent_at = %(sent)s, error = %(error)s, reference = %(ref)s, modified = %(now)s
		where name = %(name)s and claim_token = %(token)s and status = 'Sending'""",
		{
			"status": status,
			"sent": now_datetime() if status == "Sent" else None,
			"error": cstr(error)[:500],
			"ref": reference,
			"now": now_datetime(),
			"name": name,
			"token": token,
		},
	)


def _rule_for(demo, row):
	for rule in demo.get("messages") or []:
		if rule.event == row.event and (row.event != "Reminder" or cint(rule.minutes_before) == cint(row.minutes_before)):
			return rule
	return None


def _render_email(rule, context):
	"""(subject, html) of a rule's email for this context; raises ChannelError when it cannot be sent."""
	if not cint(rule.send_email) or not rule.email_template:
		raise Skipped(_("Email is switched off for this message."))
	problem = email_account_problem()
	if problem:
		raise ChannelError(problem)
	if not frappe.db.exists("CRM Campaign Email Template", rule.email_template):
		raise ChannelError(_("The email template {0} no longer exists.").format(rule.email_template))
	template = frappe.get_cached_doc("CRM Campaign Email Template", rule.email_template)
	if not template.enabled:
		raise ChannelError(_("The email template {0} is switched off.").format(rule.email_template))
	subject = personalization.render(template.subject, context)
	html = personalization.render(template.body_html, context, html=True)
	if not subject or not html:
		raise ChannelError(_("The email is empty after the variables were filled in."))
	return subject, html


def _prepare_whatsapp(rule, context):
	"""(template name, account, params) for a rule's WhatsApp message; raises ChannelError / Skipped."""
	if not cint(rule.send_whatsapp) or not rule.wa_template:
		raise Skipped(_("WhatsApp is switched off for this message."))
	sender = WhatsAppSender()
	step = frappe._dict(wa_template=rule.wa_template, wa_account=rule.wa_account, variable_map=rule.wa_variables)
	try:
		template = sender._template(step)
		account = sender.account(step)
	except frappe.ValidationError as exc:
		raise ChannelError(strip_html(cstr(exc))) from exc
	if cstr(template.status).upper() != "APPROVED":
		raise ChannelError(_("WhatsApp template {0} is not approved by Meta.").format(template.name))
	params, missing = personalization.render_whatsapp_params(step, context)
	if missing:
		raise Skipped(_("Template variable(s) {0} are empty for this booking.").format(", ".join(missing)))
	return template.name, account, params


def _send_email(booking, demo, rule, context):
	subject, html = _render_email(rule, context)
	owner = (common.owners_of(demo, enabled_only=False) or [None])[0]
	sender = frappe.db.get_value("User", owner, "email") if owner else None
	_comm, queue = queue_email(booking.email, subject, html, html, LEAD if booking.lead else None, booking.lead, sender, unsubscribe=False)
	if not queue:
		raise Skipped(_("Frappe's mail system has this address unsubscribed."))
	return queue.name


def _send_whatsapp(booking, demo, rule, context, row):
	if not cint(rule.send_whatsapp) or not rule.wa_template:
		raise Skipped(_("WhatsApp is switched off for this message."))
	if not cint(booking.whatsapp_consent):
		raise Skipped(_("The visitor did not agree to WhatsApp updates."))
	if optout.is_opted_out("WhatsApp", booking.phone):
		raise Skipped(_("This number replied STOP."))
	template, account, params = _prepare_whatsapp(rule, context)
	message = send_whatsapp_template(template, account, booking.phone, params, LEAD if booking.lead else None, booking.lead, WA_MARKER + row.name)
	return message.name


def send_test(demo, rule, channel, user):
	"""A rule's message filled in with sample data, sent to the manager asking (their own email / mobile). Returns a sentence for the screen."""
	context = personalization.sample_context(user)
	hosts = [common.full_name(u) for u in common.owners_of(demo, enabled_only=False)]
	context.update(booking_title=demo.title, demo_title=demo.title, host_name=hosts[0] if hosts else context["host_name"], host_names=_list_names(hosts) or context["host_names"])
	if demo.get("manual_link"):
		context["meet_link"] = demo.manual_link
	try:
		if channel == "Email":
			to = frappe.db.get_value("User", user, "email")
			if not to:
				frappe.throw(_("Your user has no email address."))
			subject, html = _render_email(rule, context)
			queue_email(to, "[" + _("Test") + "] " + subject, html, html, None, None, to, unsubscribe=False)
			return _("A test email was sent to {0}.").format(to)
		number = normalize_whatsapp(frappe.db.get_value("User", user, "mobile_no") or frappe.db.get_value("User", user, "phone"), None)
		if not number:
			frappe.throw(_("Add your mobile number (with the country code) to your user to receive a WhatsApp test."))
		template, account, params = _prepare_whatsapp(rule, context)
		send_whatsapp_template(template, account, number, params, None, None, WA_MARKER + "test")
		return _("A test WhatsApp message was sent to +{0}.").format(number)
	except Skipped as exc:
		frappe.throw(cstr(exc))
	except ChannelError as exc:
		frappe.throw(cstr(exc))


def _deliver(name):
	"""Send one claimed row. Returns the provider reference; raises Skipped or ChannelError."""
	row = frappe.db.get_value(MESSAGE, name, ["name", "parent", "event", "minutes_before", "channel"], as_dict=True)
	booking = frappe.db.get_value(
		BOOKING, row.parent,
		["name", "demo_type", "status", "starts_utc", "visitor_timezone", "lead", "meeting", "token", "name_", "email", "phone", "whatsapp_consent"],
		as_dict=True,
	)
	if not booking or not frappe.db.exists(DEMO_TYPE, booking.demo_type):
		raise Skipped(_("The booking or its widget no longer exists."))
	if row.event == "Cancelled":
		if booking.status != "Cancelled":
			raise Skipped(_("The booking is no longer cancelled."))
	elif booking.status not in ACTIVE:
		raise Skipped(_("The booking was cancelled or is already over."))
	elif row.event == "Reminder" and booking.starts_utc <= common.utcnow():
		raise Skipped(_("The booking has already started."))
	demo = frappe.get_cached_doc(DEMO_TYPE, booking.demo_type)
	rule = _rule_for(demo, row)
	if not rule:
		raise Skipped(_("This message was removed from the widget."))
	context = demo_context(booking, demo)
	if row.channel == "Email":
		return _send_email(booking, demo, rule, context)
	return _send_whatsapp(booking, demo, rule, context, row)


def process(name):
	"""Claim and send one message row. Safe to call from several workers at once: only one of them sends."""
	token = frappe.generate_hash(length=12)
	if not _claim(name, token):
		return False
	_commit()
	try:
		reference = _deliver(name)
		_finish(name, token, "Sent", reference=reference)
	except Skipped as exc:
		_finish(name, token, "Skipped", error=cstr(exc))
	except ChannelError as exc:
		_rollback()
		_finish(name, token, "Failed", error=cstr(exc))
	except Exception as exc:
		_rollback()
		frappe.log_error(title="CRM Demo: a message could not be sent", message=frappe.get_traceback())
		_finish(name, token, "Failed", error=cstr(exc) or exc.__class__.__name__)
	_commit()
	return True


def send_due(limit=100):
	"""Scheduler, every minute: send what is due. One bad message never stops the others."""
	rows = frappe.db.sql(
		f"""select name from `tab{MESSAGE}` where parenttype = %s and status = 'Pending' and due_at <= %s
		order by due_at limit %s""",
		(BOOKING, common.site_now(), cint(limit)),
	)
	sent = 0
	for (name,) in rows:
		try:
			sent += 1 if process(name) else 0
		except Exception:
			_rollback()
			frappe.log_error(title="CRM Demo: message worker", message=frappe.get_traceback())
	_recover_stale()
	return sent


def send_for_booking(booking):
	"""Background job started right after a booking: sends its due messages without waiting for the next scheduler tick."""
	for (name,) in frappe.db.sql(
		f"select name from `tab{MESSAGE}` where parent = %s and parenttype = %s and status = 'Pending' and due_at <= %s order by idx",
		(booking, BOOKING, common.site_now()),
	):
		process(name)


def kick(booking):
	"""Ask a worker to send a booking's due messages as soon as the request has committed (the scheduler is the fallback)."""
	if frappe.flags.in_test:
		return
	try:
		frappe.enqueue(
			"crm_addons.demos.messaging.send_for_booking", queue="short", enqueue_after_commit=True, booking=booking, job_id=None
		)
	except Exception:
		frappe.logger().warning("CRM Demo: could not queue the message job", exc_info=True)


def _recover_stale():
	"""A worker that died after claiming a row leaves it Sending. It may or may not have gone out, so it is marked Failed (not resent)."""
	frappe.db.sql(
		f"""update `tab{MESSAGE}` set status = 'Failed', error = %s, modified = %s
		where parenttype = %s and status = 'Sending' and modified < %s""",
		(
			_("The sending stopped half way. Check the email log or WhatsApp history before sending it again."),
			now_datetime(),
			BOOKING,
			add_to_date(now_datetime(), minutes=-STALE_SENDING_MINUTES),
		),
	)
	_commit()


def retry(message_name):
	"""Put a Failed or Skipped row back in line (an admin's Resend)."""
	frappe.db.sql(
		f"""update `tab{MESSAGE}` set status = 'Pending', error = '', claim_token = NULL, due_at = %s, modified = %s
		where name = %s and status in ('Failed', 'Skipped')""",
		(common.site_now(), now_datetime(), message_name),
	)
	return frappe.db.sql("select row_count()")[0][0] == 1


def notify_hosts(booking, event):
	"""Tell everybody who hosts this booking (CRM bell and an email with the time and the link). Returns how many people were told."""
	from crm_addons import notifications
	from crm_addons.campaigns.channels import queue_email

	row = frappe.db.get_value(BOOKING, booking, ["name", "demo_type", "name_", "lead", "starts_utc"], as_dict=True)
	if not row:
		return 0
	demo = frappe.get_cached_doc(DEMO_TYPE, row.demo_type)
	owners = common.owners_of(demo)
	when = common.to_site(row.starts_utc).strftime("%a %d %b %Y, %I:%M %p")
	meet = frappe.db.get_value(BOOKING, booking, "meeting")
	link = (frappe.db.get_value("CRM Meeting", meet, "google_meet_link") if meet else "") or demo.get("manual_link") or ""
	text = _("{0}: {1} with {2} on {3}").format(_("Reminder") if event == "Reminder" else _("Booking"), demo.title, row.name_, when)
	count = 0
	for user in owners:
		if row.lead:
			notifications.create_record_notification(LEAD, row.lead, user, text, kind="scheduled")
		email = frappe.db.get_value("User", user, "email")
		if email:
			try:
				html = f"<p>{frappe.utils.escape_html(text)}</p>" + (f'<p><a href="{frappe.utils.escape_html(link)}">{frappe.utils.escape_html(link)}</a></p>' if link else "")
				queue_email(email, text, html, html, LEAD if row.lead else None, row.lead, None, unsubscribe=False)
			except Exception:
				frappe.log_error(title="Frappe CRM Suite Pro: host notification email failed", message=frappe.get_traceback())
		count += 1
	return count
