"""Settings -> Integrations: the email senders (Gmail, Amazon SES and whatever the site already has) and the WhatsApp account, in one place,
so an administrator never has to open Desk to connect them.

* Every sender is a normal Frappe ``Email Account``; Frappe sends every email (campaigns, lead emails, notifications) through the one marked
  *Default Outgoing*, which only an administrator can change here.
* Amazon SES is added over its SMTP interface (SMTP user name and password from the SES console, not the AWS access keys).
* SES reports what happened to each message (delivered, bounced, complaint) to an Amazon SNS topic; ``ses_events`` is the address SNS
  posts to. Every post is checked (a secret in the address, then Amazon's signature on the message) before it changes anything. A bounce or a
  complaint lands on the email's Communication (``delivery_status``) and on the campaign recipient, exactly where Frappe's own bounce handling
  would put it, so the lists, the lead timeline, the campaign reports and the "clean up bounced addresses" rules need no changes.
* Read / not read comes from Frappe's own tracking pixel, which works with any provider.
"""

import base64
import hmac
import json
import re
import secrets
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, get_url, now_datetime

EMAIL_ACCOUNT = "Email Account"
KEY_TOKEN = "crm_pro_ses_token"
KEY_LAST = "crm_pro_ses_last_event"
KEY_CONFIRMED = "crm_pro_ses_confirmed"
METHOD = "/api/method/crm_addons.pro.integrations.ses_events"

REGIONS = [
	("us-east-1", "US East (N. Virginia)"), ("us-east-2", "US East (Ohio)"), ("us-west-1", "US West (N. California)"), ("us-west-2", "US West (Oregon)"),
	("ap-south-1", "Asia Pacific (Mumbai)"), ("ap-southeast-1", "Asia Pacific (Singapore)"), ("ap-southeast-2", "Asia Pacific (Sydney)"),
	("ap-northeast-1", "Asia Pacific (Tokyo)"), ("ap-northeast-2", "Asia Pacific (Seoul)"), ("ca-central-1", "Canada (Central)"),
	("eu-central-1", "Europe (Frankfurt)"), ("eu-west-1", "Europe (Ireland)"), ("eu-west-2", "Europe (London)"), ("eu-west-3", "Europe (Paris)"),
	("eu-north-1", "Europe (Stockholm)"), ("me-south-1", "Middle East (Bahrain)"), ("sa-east-1", "South America (Sao Paulo)"),
	("af-south-1", "Africa (Cape Town)"),
]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SES_HOST = re.compile(r"^email-smtp\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$")
_SNS_HOST = re.compile(r"^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$")


def _admin():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can change this."), frappe.PermissionError)


def _token():
	token = frappe.db.get_default(KEY_TOKEN)
	if not token:
		token = secrets.token_urlsafe(24)
		frappe.db.set_default(KEY_TOKEN, token)
	return token


def webhook_url():
	return f"{get_url()}{METHOD}?t={_token()}"


def kind_of(row):
	"""Which provider an Email Account is, from where it sends."""
	host = cstr(row.get("smtp_server")).lower()
	if _SES_HOST.match(host):
		return "ses"
	if host == "smtp.gmail.com" or row.get("service") == "GMail":
		return "gmail"
	return "other"


# -- the screen -------------------------------------------------------------------------------------------------


@frappe.whitelist()
def get_integrations():
	_admin()
	since = add_days(now_datetime(), -30)
	rows = frappe.get_all(
		EMAIL_ACCOUNT,
		fields=["name", "email_id", "service", "smtp_server", "enable_outgoing", "enable_incoming", "default_outgoing", "default_incoming", "awaiting_password"],
		order_by="default_outgoing desc, creation asc",
		limit_page_length=50,
	)
	accounts = []
	for r in rows:
		kind = kind_of(r)
		item = {
			"name": r.name, "email_id": r.email_id, "kind": kind, "outgoing": cint(r.enable_outgoing), "incoming": cint(r.enable_incoming),
			"sending": cint(r.default_outgoing), "needs_password": cint(r.awaiting_password), "stats": _stats(r, since),
		}
		if kind == "ses":
			m = _SES_HOST.match(cstr(r.smtp_server).lower())
			item["region"] = m.group(1) if m else ""
		accounts.append(item)
	return {
		"email": accounts,
		"whatsapp": _whatsapp(),
		"regions": [{"value": v, "label": f"{l} ({v})"} for v, l in REGIONS],
		"ses": {"webhook_url": webhook_url(), "last_event": cstr(frappe.db.get_default(KEY_LAST)), "subscribed": bool(frappe.db.get_default(KEY_CONFIRMED))},
		"limits": {"gmail": 2000},
	}


def _stats(account, since):
	"""What happened to the emails this account sent in the last 30 days: sent, not sent yet, failed, read, not read."""
	where = "(q.email_account = %(name)s OR (IFNULL(q.email_account,'') = '' AND q.sender = %(email)s)) AND q.creation >= %(since)s"
	values = {"name": account.name, "email": account.email_id, "since": since}
	status = {s: n for s, n in frappe.db.sql(f"SELECT q.status, COUNT(*) FROM `tabEmail Queue` q WHERE {where} GROUP BY q.status", values)}
	rows = frappe.db.sql(
		f"""SELECT c.delivery_status, c.read_by_recipient, COUNT(*) FROM `tabEmail Queue` q
		JOIN `tabCommunication` c ON c.name = q.communication WHERE {where} AND q.status IN ('Sent', 'Partially Sent')
		GROUP BY c.delivery_status, c.read_by_recipient""",
		values,
	)
	sent = status.get("Sent", 0) + status.get("Partially Sent", 0)
	bounced = sum(n for d, _r, n in rows if d in ("Bounced", "Rejected", "Soft-Bounced", "Marked As Spam"))
	read = sum(n for d, r, n in rows if d not in ("Bounced", "Rejected", "Marked As Spam") and (cint(r) or d == "Opened"))
	return {
		"sent": sent,
		"waiting": status.get("Not Sent", 0) + status.get("Sending", 0),
		"failed": status.get("Error", 0) + bounced,
		"bounced": bounced,
		"read": read,
		"not_read": max(sent - bounced - read, 0),
	}


def _whatsapp():
	if not frappe.db.exists("DocType", "WhatsApp Account"):
		return {"installed": False, "accounts": []}
	rows = frappe.get_all(
		"WhatsApp Account", fields=["name", "account_name", "status", "phone_id", "is_default_outgoing", "is_default_incoming"], limit_page_length=20
	)
	return {
		"installed": True,
		"accounts": [
			{"name": r.name, "title": r.account_name or r.name, "status": cstr(r.status), "phone_id": cstr(r.phone_id), "sending": cint(r.is_default_outgoing), "receiving": cint(r.is_default_incoming)}
			for r in rows
		],
	}


# -- adding senders -----------------------------------------------------------------------------------------------


def _new_account(values, use_for_sending):
	if not _EMAIL.match(cstr(values.get("email_id"))):
		frappe.throw(_("Enter a valid email address."))
	if frappe.db.exists(EMAIL_ACCOUNT, {"email_id": values["email_id"]}) or frappe.db.exists(EMAIL_ACCOUNT, values["email_account_name"]):
		frappe.throw(_("An email account for {0} already exists.").format(values["email_id"]))
	doc = frappe.get_doc({"doctype": EMAIL_ACCOUNT, "default_outgoing": 1 if cint(use_for_sending) else 0, "track_email_status": 1, **values})
	try:
		doc.insert()  # Frappe logs in to the mail server here, so wrong details are refused now
	except frappe.ValidationError:
		raise
	except Exception as exc:
		frappe.throw(_("The mail server did not accept these details: {0}").format(frappe.utils.strip_html(cstr(exc))[:300]))
	return doc


@frappe.whitelist()
def add_ses(email_id, region, smtp_user, smtp_password, use_for_sending=0):
	_admin()
	region = cstr(region).strip()
	if region not in dict(REGIONS):
		frappe.throw(_("Choose the Amazon SES region."))
	if not cstr(smtp_user).strip() or not cstr(smtp_password).strip():
		frappe.throw(_("Enter the SES SMTP user name and password."))
	doc = _new_account(
		{
			"email_id": cstr(email_id).strip(), "email_account_name": f"Amazon SES ({cstr(email_id).strip()})", "service": "",
			"enable_outgoing": 1, "enable_incoming": 0, "smtp_server": f"email-smtp.{region}.amazonaws.com", "smtp_port": 587, "use_tls": 1,
			"login_id_is_different": 1, "login_id": cstr(smtp_user).strip(), "password": cstr(smtp_password).strip(),
			"always_use_account_email_id_as_sender": 1,
		},
		use_for_sending,
	)
	return {"name": doc.name}


@frappe.whitelist()
def add_gmail(email_id, app_password, receive=1, use_for_sending=0):
	_admin()
	if not cstr(app_password).strip():
		frappe.throw(_("Enter the Gmail app password."))
	values = {
		"email_id": cstr(email_id).strip(), "email_account_name": f"Gmail ({cstr(email_id).strip()})", "service": "GMail",
		"enable_outgoing": 1, "smtp_server": "smtp.gmail.com", "smtp_port": 587, "use_tls": 1,
		"password": cstr(app_password).replace(" ", ""), "always_use_account_email_id_as_sender": 1,
	}
	if cint(receive):
		values.update(
			{"enable_incoming": 1, "email_server": "imap.gmail.com", "incoming_port": 993, "use_imap": 1, "use_ssl": 1, "email_sync_option": "ALL",
			 "initial_sync_count": 100, "create_contact": 1, "imap_folder": [{"folder_name": "INBOX", "append_to": "CRM Lead"}]}
		)
	doc = _new_account(values, use_for_sending)
	return {"name": doc.name}


@frappe.whitelist()
def set_sending(account):
	"""The account every email goes out through. Administrators only; nobody else can change it."""
	_admin()
	doc = frappe.get_doc(EMAIL_ACCOUNT, account)
	if not cint(doc.enable_outgoing):
		frappe.throw(_("{0} is not set up to send email.").format(doc.email_id))
	doc.default_outgoing = 1
	doc.save()  # Frappe switches the others off
	return {"name": doc.name}


@frappe.whitelist()
def send_test(account):
	"""A test message from this account to the administrator's own address."""
	_admin()
	doc = frappe.get_doc(EMAIL_ACCOUNT, account)
	to = frappe.db.get_value("User", frappe.session.user, "email")
	if not to:
		frappe.throw(_("Your user has no email address to send the test to."))
	try:
		frappe.sendmail(
			recipients=[to], sender=doc.email_id, subject=_("Test email from your CRM"),
			message=_("This message was sent from {0}. Your email connection works.").format(doc.email_id), now=True,
		)
	except Exception as exc:
		frappe.throw(_("The test email was not sent: {0}").format(frappe.utils.strip_html(cstr(exc))[:300]))
	return {"to": to}


# -- Amazon SNS / SES events --------------------------------------------------------------------------------------


def _string_to_sign(msg):
	if msg.get("Type") == "Notification":
		keys = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
	else:
		keys = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
	return "".join(f"{k}\n{msg[k]}\n" for k in keys if k in msg).encode()


def _certificate(url):
	"""Amazon's signing certificate, only ever fetched from an Amazon SNS address."""
	parsed = urlparse(cstr(url))
	if parsed.scheme != "https" or not _SNS_HOST.match(parsed.hostname or "") or not parsed.path.endswith(".pem"):
		frappe.throw(_("Not an Amazon SNS certificate address."), frappe.PermissionError)
	cache = frappe.cache()
	pem = cache.get_value(f"sns_cert::{url}")
	if not pem:
		import requests

		pem = requests.get(url, timeout=5).content
		cache.set_value(f"sns_cert::{url}", pem, expires_in_sec=86400)
	return pem


def _verify_sns(msg):
	"""Raise unless this message was signed by Amazon SNS."""
	from cryptography import x509
	from cryptography.hazmat.primitives import hashes
	from cryptography.hazmat.primitives.asymmetric import padding

	version = cstr(msg.get("SignatureVersion"))
	algorithm = {"1": hashes.SHA1, "2": hashes.SHA256}.get(version)
	if not algorithm or not msg.get("Signature"):
		frappe.throw(_("Unsigned message."), frappe.PermissionError)
	key = x509.load_pem_x509_certificate(_certificate(msg.get("SigningCertURL"))).public_key()
	try:
		key.verify(base64.b64decode(msg["Signature"]), _string_to_sign(msg), padding.PKCS1v15(), algorithm())
	except Exception:
		frappe.throw(_("The signature does not match."), frappe.PermissionError)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ses_events(t=None):
	"""Where Amazon SNS posts what SES reports about each email. The secret in the address and Amazon's own signature are both checked first."""
	if not t or not hmac.compare_digest(cstr(t), cstr(frappe.db.get_default(KEY_TOKEN))):
		frappe.throw(_("Not allowed."), frappe.PermissionError)
	try:
		msg = json.loads(frappe.request.get_data(as_text=True) or "{}")
	except ValueError:
		frappe.throw(_("Not a valid message."))
	_verify_sns(msg)
	kind = msg.get("Type")
	if kind == "SubscriptionConfirmation":
		parsed = urlparse(cstr(msg.get("SubscribeURL")))
		if parsed.scheme == "https" and _SNS_HOST.match(parsed.hostname or ""):
			import requests

			requests.get(msg["SubscribeURL"], timeout=5)
			frappe.db.set_default(KEY_CONFIRMED, "1")
		return "subscribed"
	if kind == "Notification":
		try:
			event = json.loads(msg.get("Message") or "{}")
		except ValueError:
			return "ignored"
		handle_event(event)
		frappe.db.set_default(KEY_LAST, cstr(now_datetime()))
	return "ok"


def _find_queue(mail):
	"""The Email Queue row of the message SES reports on, found by the Message-ID header Frappe put on it."""
	mid = cstr((mail.get("commonHeaders") or {}).get("messageId") or "").strip()
	if not mid:
		return None
	bare = mid.strip("<>")
	# Frappe may keep the header HTML-escaped (&lt;id@host&gt;) or as it was sent, with or without the angle brackets
	wrapped = f"<{bare}>"
	options = [mid, bare, wrapped, wrapped.replace("<", "&lt;").replace(">", "&gt;")]
	return frappe.db.get_value("Email Queue", {"message_id": ["in", options]}, ["name", "communication"], as_dict=True)


def handle_event(event):
	"""One SES notification: Delivery, Bounce (permanent or temporary) or Complaint. Returns what was recorded."""
	kind = cstr(event.get("notificationType") or event.get("eventType"))
	queue = _find_queue(event.get("mail") or {})
	if not queue or kind not in ("Delivery", "Bounce", "Complaint"):
		return None
	reason = ""
	if kind == "Bounce":
		bounce = event.get("bounce") or {}
		permanent = cstr(bounce.get("bounceType")) == "Permanent"
		status = "Bounced" if permanent else "Soft-Bounced"
		first = (bounce.get("bouncedRecipients") or [{}])[0]
		reason = cstr(first.get("diagnosticCode") or first.get("action") or bounce.get("bounceSubType"))[:300]
	elif kind == "Complaint":
		status = "Marked As Spam"
		reason = _("The reader marked this email as spam.")
	else:
		status = "Sent"
	if queue.communication:
		current = frappe.db.get_value("Communication", queue.communication, "delivery_status")
		# a delivery confirmation never replaces a bounce or an open, and a late "soft bounce" never replaces a hard one
		if status != "Sent" or current in (None, "", "Sent", "Sending", "Scheduled"):
			if not (status == "Soft-Bounced" and current in ("Bounced", "Rejected", "Marked As Spam")):
				frappe.db.set_value("Communication", queue.communication, "delivery_status", status, update_modified=False)
	_advance_recipient(queue.name, status, reason)
	return status


def _advance_recipient(queue_name, status, reason):
	"""Tell the campaign the recipient belongs to, if any. Never raises: the webhook must always answer."""
	try:
		from crm_addons.campaigns.common import RECIPIENT
		from crm_addons.campaigns.engine import advance

		recipient = frappe.db.get_value(RECIPIENT, {"email_queue": queue_name}, "name")
		if not recipient:
			return
		if status == "Sent":
			advance(recipient, "Delivered", provider_status="Delivered")
		elif status in ("Bounced", "Marked As Spam"):
			advance(recipient, "Failed", failure_reason=f"{status}: {reason}"[:500], provider_status=status, failed_at=cstr(now_datetime()))
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Amazon SES event: could not update the campaign recipient")
