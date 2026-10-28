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
from frappe.utils.password import get_decrypted_password
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


# the providers Frappe already knows (its Email Account "Service" list) and any other SMTP server. login: the user name some of them require
PROVIDERS = {
	"outlook": {"label": "Outlook.com", "smtp": "smtp-mail.outlook.com", "imap": "imap-mail.outlook.com", "service": "Outlook.com"},
	"microsoft365": {"label": "Microsoft 365", "smtp": "smtp.office365.com", "imap": "outlook.office365.com", "service": ""},
	"yahoo": {"label": "Yahoo Mail", "smtp": "smtp.mail.yahoo.com", "imap": "imap.mail.yahoo.com", "service": "Yahoo Mail"},
	"yandex": {"label": "Yandex Mail", "smtp": "smtp.yandex.com", "imap": "imap.yandex.com", "service": "Yandex.Mail"},
	"sendgrid": {"label": "SendGrid", "smtp": "smtp.sendgrid.net", "login": "apikey", "service": "Sendgrid"},
	"sparkpost": {"label": "SparkPost", "smtp": "smtp.sparkpostmail.com", "login": "SMTP_Injection", "service": "SparkPost"},
}
_HOSTS = [("outlook", "smtp-mail.outlook.com"), ("microsoft365", "smtp.office365.com"), ("yahoo", "smtp.mail.yahoo.com"), ("yandex", "smtp.yandex.com"), ("sendgrid", "smtp.sendgrid.net"), ("sparkpost", "smtp.sparkpostmail.com")]


def kind_of(row):
	"""Which provider an Email Account is, from where it sends."""
	host = cstr(row.get("smtp_server")).lower()
	if _SES_HOST.match(host):
		return "ses"
	if host == "smtp.gmail.com" or row.get("service") == "GMail":
		return "gmail"
	return next((k for k, h in _HOSTS if h == host), "other")


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


WA = "WhatsApp Account"
WA_URL = "https://graph.facebook.com"
WA_WEBHOOK = "/api/method/frappe_whatsapp.utils.webhook.webhook"


def _whatsapp():
	if not frappe.db.exists("DocType", WA):
		return {"installed": False, "accounts": [], "webhook_url": ""}
	since = add_days(now_datetime(), -30)
	rows = frappe.get_all(
		WA,
		fields=["name", "account_name", "status", "phone_id", "business_id", "app_id", "version", "webhook_verify_token", "is_default_outgoing", "is_default_incoming", "token"],
		order_by="is_default_outgoing desc, creation asc", limit_page_length=20,
	)
	out = []
	for r in rows:
		counts = {k: n for k, n in frappe.db.sql(
			"SELECT status, COUNT(*) FROM `tabWhatsApp Message` WHERE whatsapp_account = %s AND type = 'Outgoing' AND creation >= %s GROUP BY status", (r.name, since))}
		low = {cstr(k).lower(): n for k, n in counts.items()}
		failed = low.get("failed", 0)
		read = low.get("read", 0)
		delivered = low.get("delivered", 0)
		sent = sum(low.values())
		out.append({
			"name": r.name, "title": r.account_name or r.name, "status": cstr(r.status), "phone_id": cstr(r.phone_id), "business_id": cstr(r.business_id),
			"app_id": cstr(r.app_id), "version": cstr(r.version), "verify_token": cstr(r.webhook_verify_token), "sending": cint(r.is_default_outgoing),
			"receiving": cint(r.is_default_incoming), "has_token": bool(get_decrypted_password(WA, r.name, "token", raise_exception=False)),
			"stats": {"sent": sent, "delivered": delivered + read, "read": read, "failed": failed, "not_read": max(delivered, 0)},
		})
	return {"installed": True, "accounts": out, "webhook_url": f"{get_url()}{WA_WEBHOOK}", "versions": ["v23.0", "v22.0", "v21.0", "v20.0"]}


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
def add_provider(provider, email_id, password, receive=0, use_for_sending=0, smtp_server=None, smtp_port=None, security="TLS", login_id=None, imap_server=None, imap_port=None):
	"""Outlook, Microsoft 365, Yahoo, Yandex, SendGrid, SparkPost, or any other SMTP server. Frappe logs in on saving, so wrong details are refused."""
	_admin()
	email_id, password = cstr(email_id).strip(), cstr(password).strip()
	if not password:
		frappe.throw(_("Enter the password or API key."))
	preset = PROVIDERS.get(provider)
	if provider != "smtp" and not preset:
		frappe.throw(_("Choose an email provider."))
	preset = preset or {"label": "SMTP"}
	server = cstr(smtp_server or preset.get("smtp")).strip()
	if not server or not re.match(r"^[A-Za-z0-9.-]+$", server):
		frappe.throw(_("Enter the SMTP server, for example smtp.yourcompany.com."))
	port = cint(smtp_port) or (465 if security == "SSL" else 587)
	login = cstr(login_id or preset.get("login") or "").strip()
	values = {
		"email_id": email_id, "email_account_name": f"{preset['label']} ({email_id})", "service": preset.get("service", ""), "enable_outgoing": 1, "smtp_server": server, "smtp_port": port,
		"use_tls": 1 if security == "TLS" else 0, "use_ssl_for_outgoing": 1 if security == "SSL" else 0, "password": password, "always_use_account_email_id_as_sender": 1,
	}
	if login and login != email_id:
		values.update({"login_id_is_different": 1, "login_id": login})
	imap = cstr(imap_server or preset.get("imap")).strip()
	if cint(receive) and imap:
		values.update({"enable_incoming": 1, "email_server": imap, "incoming_port": cint(imap_port) or 993, "use_imap": 1, "use_ssl": 1, "email_sync_option": "ALL",
			"initial_sync_count": 100, "create_contact": 1, "imap_folder": [{"folder_name": "INBOX", "append_to": "CRM Lead"}]})
	return {"name": _new_account(values, use_for_sending).name}


@frappe.whitelist()
def remove_account(account):
	"""Remove a sender. The one that sends everything cannot be removed: choose another first."""
	_admin()
	doc = frappe.get_doc(EMAIL_ACCOUNT, account)
	if cint(doc.default_outgoing):
		frappe.throw(_("{0} sends all emails. Choose another account for sending first.").format(doc.email_id))
	frappe.delete_doc(EMAIL_ACCOUNT, account)
	return {"removed": True}


@frappe.whitelist()
def update_password(account, password):
	"""A new password or API key for a sender; Frappe logs in with it before saving."""
	_admin()
	if not cstr(password).strip():
		frappe.throw(_("Enter the new password."))
	doc = frappe.get_doc(EMAIL_ACCOUNT, account)
	doc.password = cstr(password).strip()
	doc.awaiting_password = 0
	try:
		doc.save()
	except frappe.ValidationError:
		raise
	except Exception as exc:
		frappe.throw(_("The mail server did not accept this: {0}").format(frappe.utils.strip_html(cstr(exc))[:300]))
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


# -- connection tests ---------------------------------------------------------------------------------------------


@frappe.whitelist()
def test_email(account):
	"""Log in to the mail server with the saved details without sending anything."""
	_admin()
	doc = frappe.get_doc(EMAIL_ACCOUNT, account)
	problems = []
	if cint(doc.enable_outgoing):
		try:
			doc.get_smtp_server().session  # opens the connection and logs in
		except Exception as exc:
			problems.append(_("Sending: {0}").format(frappe.utils.strip_html(cstr(exc))[:200]))
	if cint(doc.enable_incoming):
		try:
			doc.get_incoming_server()
		except Exception as exc:
			problems.append(_("Receiving: {0}").format(frappe.utils.strip_html(cstr(exc))[:200]))
	if problems:
		return {"ok": False, "message": " ".join(problems)}
	return {"ok": True, "message": _("Connected to {0}.").format(doc.smtp_server or doc.email_server)}


def _graph(doc, path="", token=None, method="get"):
	import requests

	token = token or doc.get_password("token", raise_exception=False)
	if not token:
		return None, _("No access token is saved.")
	try:
		res = requests.request(method, f"{doc.url or WA_URL}/{doc.version or 'v21.0'}/{path}", headers={"Authorization": f"Bearer {token}"}, timeout=10)
		data = res.json()
	except Exception as exc:
		return None, _("Could not reach WhatsApp: {0}").format(cstr(exc)[:150])
	if res.status_code != 200 or data.get("error"):
		return None, cstr((data.get("error") or {}).get("message") or res.status_code)[:300]
	return data, ""


@frappe.whitelist()
def test_whatsapp(account):
	"""Ask WhatsApp who this phone number is, with the saved token: proves the token, the phone number ID and the version work together."""
	_admin()
	doc = frappe.get_doc(WA, account)
	data, err = _graph(doc, f"{doc.phone_id}?fields=verified_name,display_phone_number,quality_rating,code_verification_status")
	if err:
		return {"ok": False, "message": err}
	biz, berr = _graph(doc, f"{doc.business_id}/subscribed_apps") if doc.business_id else (None, "")
	listening = bool(biz and biz.get("data"))
	return {
		"ok": True, "name": data.get("verified_name"), "number": data.get("display_phone_number"), "quality": data.get("quality_rating"),
		"receiving": listening, "message": _("Connected as {0} ({1}).").format(data.get("verified_name") or "", data.get("display_phone_number") or ""),
	}


# -- WhatsApp accounts -----------------------------------------------------------------------------------------


def _wa_fields(values):
	out = {}
	for key, label in (("account_name", "account name"), ("phone_id", "phone number ID"), ("business_id", "business account ID")):
		out[key] = cstr(values.get(key)).strip()
		if not out[key]:
			frappe.throw(_("Enter the {0}.").format(label))
		if key != "account_name" and not out[key].isdigit():
			frappe.throw(_("The {0} is a number, copy it from the Meta dashboard.").format(label))
	out["app_id"] = cstr(values.get("app_id")).strip()
	out["version"] = cstr(values.get("version") or "v21.0").strip()
	if not re.match(r"^v\d+\.\d+$", out["version"]):
		frappe.throw(_("The API version looks like v21.0."))
	return out


@frappe.whitelist()
def add_whatsapp(account_name, phone_id, business_id, token, app_id="", version="v21.0", use_for_sending=0, use_for_receiving=0):
	"""Connect a WhatsApp number. The token is checked against WhatsApp first, so a wrong token or number is refused."""
	_admin()
	values = _wa_fields({"account_name": account_name, "phone_id": phone_id, "business_id": business_id, "app_id": app_id, "version": version})
	token = cstr(token).strip()
	if not token:
		frappe.throw(_("Enter the access token."))
	if frappe.db.exists(WA, {"phone_id": values["phone_id"]}) or frappe.db.exists(WA, values["account_name"]):
		frappe.throw(_("This WhatsApp number or name is already connected."))
	doc = frappe.new_doc(WA)
	doc.update({**values, "url": WA_URL, "token": token, "status": "Active", "webhook_verify_token": secrets.token_urlsafe(16),
		"is_default_outgoing": 1 if cint(use_for_sending) else 0, "is_default_incoming": 1 if cint(use_for_receiving) else 0, "allow_auto_read_receipt": 1})
	data, err = _graph(doc, f"{doc.phone_id}?fields=verified_name,display_phone_number", token=token)
	if err:
		frappe.throw(_("WhatsApp did not accept these details: {0}").format(err))
	doc.insert()
	subscribed = True
	try:
		doc.subscribe_app()  # needed to receive replies
	except Exception:
		subscribed = False
	return {"name": doc.name, "number": data.get("display_phone_number"), "verified_name": data.get("verified_name"), "subscribed": subscribed}


@frappe.whitelist()
def update_whatsapp(account, account_name=None, phone_id=None, business_id=None, app_id=None, version=None, token=None):
	"""Change the details of a connected number. Leave the token empty to keep the saved one."""
	_admin()
	doc = frappe.get_doc(WA, account)
	values = _wa_fields({"account_name": account_name or doc.account_name, "phone_id": phone_id or doc.phone_id, "business_id": business_id or doc.business_id,
		"app_id": app_id if app_id is not None else doc.app_id, "version": version or doc.version})
	if cstr(token).strip():
		values["token"] = cstr(token).strip()
	doc.update(values)
	data, err = _graph(doc, f"{doc.phone_id}?fields=verified_name", token=cstr(token).strip() or None)
	if err:
		frappe.throw(_("WhatsApp did not accept these details: {0}").format(err))
	doc.save()
	return {"name": doc.name}


@frappe.whitelist()
def set_whatsapp(account, what, value):
	"""what: sending | receiving | active. Switching sending or receiving on moves it from the other account."""
	_admin()
	doc = frappe.get_doc(WA, account)
	on = 1 if cint(value) else 0
	if what == "active":
		doc.status = "Active" if on else "Inactive"
		if not on:
			doc.is_default_outgoing = doc.is_default_incoming = 0
	elif what in ("sending", "receiving"):
		if on and cstr(doc.status) != "Active":
			frappe.throw(_("Switch this number on first."))
		doc.set("is_default_outgoing" if what == "sending" else "is_default_incoming", on)
	else:
		frappe.throw(_("Unknown setting."))
	doc.save()
	return {"name": doc.name}


@frappe.whitelist()
def disconnect_whatsapp(account):
	"""Remove a number. When messages were sent from it, the history needs the record, so it is switched off and its token erased instead."""
	_admin()
	doc = frappe.get_doc(WA, account)
	try:
		frappe.delete_doc(WA, account)
		return {"removed": True}
	except frappe.LinkExistsError:
		doc = frappe.get_doc(WA, account)
		doc.status = "Inactive"
		doc.is_default_outgoing = doc.is_default_incoming = 0
		doc.token = ""
		doc.save()
		return {"removed": False}


# -- logs: every email and every WhatsApp message, with what happened to it ---------------------------------------------------

_EMAIL_STATE = """case when q.status in ('Error', 'Expired') then 'Failed'
	when c.delivery_status in ('Bounced', 'Rejected', 'Marked As Spam') then 'Bounced'
	when c.delivery_status = 'Soft-Bounced' then 'Soft bounce'
	when q.status in ('Sent', 'Partially Sent') and (c.read_by_recipient = 1 or c.delivery_status = 'Opened') then 'Read'
	when q.status in ('Sent', 'Partially Sent') then 'Sent'
	else 'Waiting' end"""


def _paging(page, page_size):
	return max(1, cint(page)), min(max(1, cint(page_size) or 25), 100)


@frappe.whitelist()
def get_email_log(page=1, page_size=25, status=None, account=None, search=None):
	"""Every email the CRM queued: state (waiting, sent, read, bounced, failed), who it went to, from which account, the lead, and the error when there is one."""
	_admin()
	page, size = _paging(page, page_size)
	where, values = ["1 = 1"], {}
	if account:
		email = frappe.db.get_value(EMAIL_ACCOUNT, account, "email_id")
		where.append("(q.email_account = %(account)s OR q.sender = %(email)s)")
		values.update({"account": account, "email": email})
	txt = cstr(search).strip()
	if txt:
		where.append("(c.subject LIKE %(q)s OR q.sender LIKE %(q)s OR q.reference_name LIKE %(q)s OR r.recipient LIKE %(q)s)")
		values["q"] = f"%{txt}%"
	base = f"""FROM `tabEmail Queue` q LEFT JOIN `tabCommunication` c ON c.name = q.communication
		LEFT JOIN (SELECT parent, MIN(recipient) AS recipient FROM `tabEmail Queue Recipient` GROUP BY parent) r ON r.parent = q.name WHERE {' AND '.join(where)}"""
	picked = [x.strip() for x in cstr(status).split(",") if x.strip()]
	outer = "WHERE u.state IN %(picked)s" if picked else ""
	if picked:
		values["picked"] = tuple(picked)
	inner = f"SELECT q.name, q.creation, q.status AS queue_status, q.error, q.sender, q.email_account, q.reference_doctype, q.reference_name, q.retry, c.subject, c.delivery_status, r.recipient, {_EMAIL_STATE} AS state {base}"
	total = frappe.db.sql(f"SELECT COUNT(*) FROM ({inner}) u {outer}", values)[0][0]
	rows = frappe.db.sql(f"SELECT u.* FROM ({inner}) u {outer} ORDER BY u.creation DESC LIMIT %(limit)s OFFSET %(offset)s", {**values, "limit": size, "offset": (page - 1) * size}, as_dict=True)
	counts = {s: n for s, n in frappe.db.sql(f"SELECT state, COUNT(*) FROM (SELECT {_EMAIL_STATE} AS state {base}) u GROUP BY state", {k: v for k, v in values.items() if k != "picked"})}
	for r in rows:
		r["creation"] = cstr(r["creation"])
	accounts = [{"value": a.name, "label": a.email_id} for a in frappe.get_all(EMAIL_ACCOUNT, fields=["name", "email_id"], limit_page_length=50)]
	return {"rows": rows, "total": total, "page": page, "page_size": size, "counts": counts, "accounts": accounts}


@frappe.whitelist()
def retry_email(queue):
	"""Put a failed email back in line; Frappe's mail queue sends it on its next run."""
	_admin()
	status = frappe.db.get_value("Email Queue", queue, "status")
	if status not in ("Error", "Expired"):
		frappe.throw(_("Only a failed email can be sent again."))
	frappe.db.set_value("Email Queue", queue, {"status": "Not Sent", "retry": 0, "error": ""})
	frappe.db.sql("UPDATE `tabEmail Queue Recipient` SET status = 'Not Sent' WHERE parent = %s", queue)
	return {"queued": True}


_WA_STATE = """case when m.type = 'Incoming' then 'Received'
	when lower(m.status) = 'failed' then 'Failed'
	when lower(m.status) = 'read' then 'Read'
	when lower(m.status) = 'delivered' then 'Delivered'
	when lower(m.status) in ('sent', 'success') then 'Sent'
	else 'Waiting' end"""


@frappe.whitelist()
def get_whatsapp_log(page=1, page_size=25, status=None, account=None, search=None):
	"""Every WhatsApp message in and out: state (waiting, sent, delivered, read, failed, received), the number, the template and the lead."""
	_admin()
	if not frappe.db.exists("DocType", "WhatsApp Message"):
		return {"rows": [], "total": 0, "page": 1, "page_size": 25, "counts": {}, "accounts": []}
	page, size = _paging(page, page_size)
	where, values = ["1 = 1"], {}
	if account:
		where.append("m.whatsapp_account = %(account)s")
		values["account"] = account
	txt = cstr(search).strip()
	if txt:
		where.append("(m.`to` LIKE %(q)s OR m.`from` LIKE %(q)s OR m.template LIKE %(q)s OR m.reference_name LIKE %(q)s OR m.profile_name LIKE %(q)s OR m.message LIKE %(q)s)")
		values["q"] = f"%{txt}%"
	picked = [x.strip() for x in cstr(status).split(",") if x.strip()]
	outer = "WHERE u.state IN %(picked)s" if picked else ""
	if picked:
		values["picked"] = tuple(picked)
	inner = f"""SELECT m.name, m.creation, m.type, m.status AS provider_status, m.`to` AS to_number, m.`from` AS from_number, m.template, m.content_type, LEFT(m.message, 160) AS message,
		m.whatsapp_account, m.reference_doctype, m.reference_name, m.profile_name, {_WA_STATE} AS state FROM `tabWhatsApp Message` m WHERE {' AND '.join(where)}"""
	total = frappe.db.sql(f"SELECT COUNT(*) FROM ({inner}) u {outer}", values)[0][0]
	rows = frappe.db.sql(f"SELECT u.* FROM ({inner}) u {outer} ORDER BY u.creation DESC LIMIT %(limit)s OFFSET %(offset)s", {**values, "limit": size, "offset": (page - 1) * size}, as_dict=True)
	counts = {s: n for s, n in frappe.db.sql(f"SELECT state, COUNT(*) FROM (SELECT {_WA_STATE} AS state FROM `tabWhatsApp Message` m WHERE {' AND '.join(where)}) u GROUP BY state", {k: v for k, v in values.items() if k != "picked"})}
	for r in rows:
		r["creation"] = cstr(r["creation"])
	accounts = [{"value": a.name, "label": a.account_name or a.name} for a in frappe.get_all("WhatsApp Account", fields=["name", "account_name"], limit_page_length=20)]
	return {"rows": rows, "total": total, "page": page, "page_size": size, "counts": counts, "accounts": accounts}


# -- calendar (Google Calendar + Google Meet) ------------------------------------------------------


@frappe.whitelist()
def get_calendar():
	"""Where Google Calendar / Meet stands: is Google set up, which calendar meetings go on, who connected a personal one, and how the last 30 days of meetings synced."""
	_admin()
	from frappe.utils import get_url

	from crm_addons.providers.google_meet import GoogleMeetProvider, _usable
	from crm_addons.utils import get_settings

	settings = get_settings()
	google = frappe.get_cached_doc("Google Settings")
	calendars = []
	for c in frappe.get_all("Google Calendar", fields=["name", "user", "google_calendar_id", "enable", "push_to_google_calendar"], limit_page_length=100):
		calendars.append({**c, "usable": _usable(c.name), "company": c.name == settings.google_calendar})
	since = frappe.utils.add_days(frappe.utils.nowdate(), -30)
	counts = {s or "None": n for s, n in frappe.db.sql("SELECT sync_status, COUNT(*) FROM `tabCRM Meeting` WHERE creation >= %s AND status != 'Cancelled' AND provider = 'Google Meet' GROUP BY sync_status", since)}
	status = GoogleMeetProvider().status()
	return {
		"ready": status["ready"],
		"message": status["message"],
		"provider": settings.default_provider,
		"company": settings.google_calendar,
		"personal": bool(settings.use_personal_calendars),
		"google_enabled": bool(google.enable),
		"has_client": bool(google.client_id and google.get_password("client_secret", raise_exception=False)),
		"calendars": calendars,
		"counts": {"Synced": counts.get("Synced", 0), "Failed": counts.get("Failed", 0), "Not synced": counts.get("Not synced", 0)},
		"redirect_uri": get_url() + "?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback",
		"site_url": get_url(),
	}


@frappe.whitelist()
def get_calendar_log(page=1, page_size=25, status=None, search=None):
	"""Meetings with how they synced to the calendar, newest first, failures with the reason."""
	_admin()
	page, size = _paging(page, page_size)
	where, values = ["m.status != 'Cancelled'"], {}
	if status in ("Synced", "Failed", "Not synced"):
		where.append("m.provider = 'Google Meet' AND m.sync_status = %(st)s")
		values["st"] = status
	txt = cstr(search).strip()
	if txt:
		where.append("(m.subject LIKE %(q)s OR m.reference_docname LIKE %(q)s OR m.organizer LIKE %(q)s)")
		values["q"] = f"%{txt}%"
	w = " AND ".join(where)
	total = frappe.db.sql(f"SELECT COUNT(*) FROM `tabCRM Meeting` m WHERE {w}", values)[0][0]
	rows = frappe.db.sql(
		f"""SELECT m.name, m.subject, m.starts_on, m.provider, m.sync_status, m.sync_error, m.organizer, m.google_calendar, m.google_meet_link, m.external_event_url, m.reference_doctype, m.reference_docname
		FROM `tabCRM Meeting` m WHERE {w} ORDER BY m.starts_on DESC LIMIT %(limit)s OFFSET %(offset)s""",
		{**values, "limit": size, "offset": (page - 1) * size},
		as_dict=True,
	)
	for r in rows:
		r["starts_on"] = cstr(r["starts_on"])
	return {"rows": rows, "total": total, "page": page, "page_size": size}


@frappe.whitelist()
def retry_meeting(name):
	"""Try the calendar sync of a meeting again (create the event, or update it when it already exists)."""
	_admin()
	doc = frappe.get_doc("CRM Meeting", name)
	if doc.status == "Cancelled":
		frappe.throw(_("A cancelled meeting is not synced."))
	out = doc.sync("update" if doc.external_event_id else "create", False)
	return {"status": out["status"], "error": out["error"]}
