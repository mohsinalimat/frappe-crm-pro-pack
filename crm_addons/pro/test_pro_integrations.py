"""Settings -> Integrations: adding Amazon SES / Gmail, who may change what, and what SES reports about an email."""

import json
from unittest.mock import patch

import frappe

from crm_addons.pro import integrations
from crm_addons.team_access.test_access import AccessCase

VALIDATE = "frappe.email.doctype.email_account.email_account.EmailAccount.validate_smtp_conn"


class TestProIntegrations(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	def _ses(self, email="ses-test@example.com", sending=0):
		with patch(VALIDATE):
			return integrations.add_ses(email, "ap-south-1", "AKIATEST", "secret-smtp-password", sending)["name"]

	def test_only_a_system_manager_can_use_it(self):
		frappe.set_user(self.person("pro-int-sales@example.com", "Sales User"))
		for call in (lambda: integrations.get_integrations(), lambda: integrations.add_ses("a@b.co", "ap-south-1", "u", "p"), lambda: integrations.set_sending("x")):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_ses_is_added_as_an_outgoing_account_and_the_password_is_never_returned(self):
		name = self._ses()
		doc = frappe.get_doc("Email Account", name)
		self.assertEqual((doc.smtp_server, int(doc.smtp_port), doc.enable_outgoing, doc.enable_incoming), ("email-smtp.ap-south-1.amazonaws.com", 587, 1, 0))
		self.assertEqual(doc.login_id, "AKIATEST")
		out = integrations.get_integrations()
		row = next(a for a in out["email"] if a["name"] == name)
		self.assertEqual((row["kind"], row["region"]), ("ses", "ap-south-1"))
		self.assertNotIn("secret-smtp-password", json.dumps(out))
		with self.assertRaises(frappe.ValidationError):
			self._ses()  # the same address twice

	def test_wrong_region_or_address_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			integrations.add_ses("a@b.co", "mars-1", "u", "p")
		with self.assertRaises(frappe.ValidationError):
			integrations.add_ses("not-an-email", "ap-south-1", "u", "p")

	def test_the_sending_account_is_switched_by_an_administrator(self):
		first = self._ses("ses-one@example.com", 1)
		second = self._ses("ses-two@example.com", 0)
		integrations.set_sending(second)
		self.assertEqual(frappe.db.get_value("Email Account", second, "default_outgoing"), 1)
		self.assertEqual(frappe.db.get_value("Email Account", first, "default_outgoing"), 0)

	def _sent_email(self, mid):
		comm = frappe.get_doc({"doctype": "Communication", "communication_type": "Communication", "communication_medium": "Email", "sent_or_received": "Sent",
			"subject": "Hello", "content": "x", "delivery_status": "Sent", "recipients": "lead@example.com"}).insert(ignore_permissions=True)
		queue = frappe.get_doc({"doctype": "Email Queue", "sender": "ses-test@example.com", "message": "x", "message_id": mid, "status": "Sent",
			"communication": comm.name, "recipients": [{"recipient": "lead@example.com"}]}).insert(ignore_permissions=True)
		return comm.name, queue.name

	def _event(self, kind, mid, **extra):
		return {"notificationType": kind, "mail": {"commonHeaders": {"messageId": mid}}, **extra}

	def test_a_bounce_a_complaint_and_a_late_delivery_land_on_the_email(self):
		comm, _q = self._sent_email("<bounce-1@example.com>")
		integrations.handle_event(self._event("Bounce", "<bounce-1@example.com>", bounce={"bounceType": "Permanent", "bouncedRecipients": [{"diagnosticCode": "smtp; 550 5.1.1 user unknown"}]}))
		self.assertEqual(frappe.db.get_value("Communication", comm, "delivery_status"), "Bounced")
		integrations.handle_event(self._event("Delivery", "<bounce-1@example.com>"))
		self.assertEqual(frappe.db.get_value("Communication", comm, "delivery_status"), "Bounced")  # a delivery never undoes a bounce
		comm2, _q2 = self._sent_email("<spam-1@example.com>")
		integrations.handle_event(self._event("Complaint", "<spam-1@example.com>", complaint={}))
		self.assertEqual(frappe.db.get_value("Communication", comm2, "delivery_status"), "Marked As Spam")
		comm3, _q3 = self._sent_email("<soft-1@example.com>")
		integrations.handle_event(self._event("Bounce", "bare-soft-id", bounce={"bounceType": "Transient"}))  # unknown message: nothing happens
		integrations.handle_event(self._event("Bounce", "soft-1@example.com", bounce={"bounceType": "Transient"}))
		self.assertEqual(frappe.db.get_value("Communication", comm3, "delivery_status"), "Soft-Bounced")

	def test_the_counts_show_sent_failed_read_and_not_read(self):
		name = self._ses("ses-test@example.com")
		comm, _q = self._sent_email("<count-1@example.com>")
		self._sent_email("<count-2@example.com>")
		frappe.db.set_value("Communication", comm, "read_by_recipient", 1)
		frappe.db.sql("update `tabEmail Queue` set email_account=%s where message_id like '<count-%%'", name)
		_c3, q3 = self._sent_email("<count-3@example.com>")
		frappe.db.set_value("Email Queue", q3, {"email_account": name, "status": "Error"})
		stats = next(a for a in integrations.get_integrations()["email"] if a["name"] == name)["stats"]
		self.assertEqual((stats["sent"], stats["read"], stats["not_read"], stats["failed"]), (2, 1, 1, 1))

	def test_the_webhook_needs_the_secret_and_amazons_signature(self):
		token = integrations._token()
		with self.assertRaises(frappe.PermissionError):
			integrations.ses_events("wrong")
		with self.assertRaises(frappe.PermissionError):
			integrations.ses_events(None)
		old = getattr(frappe.local, "request", None)
		self.addCleanup(lambda: setattr(frappe.local, "request", old))
		frappe.local.request = type("R", (), {"path": "/", "get_data": lambda self, as_text=False: json.dumps({"Type": "Notification", "Message": "{}"})})()
		with self.assertRaises(frappe.PermissionError):
			integrations.ses_events(token)  # right secret, but no signature
		with self.assertRaises(frappe.PermissionError):
			integrations._certificate("https://evil.example.com/cert.pem")
		with self.assertRaises(frappe.PermissionError):
			integrations._certificate("http://sns.us-east-1.amazonaws.com/cert.pem")
		with patch.object(integrations, "_verify_sns"):
			self.assertEqual(integrations.ses_events(token), "ok")
