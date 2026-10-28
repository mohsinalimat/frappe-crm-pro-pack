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


class TestMoreProviders(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	def test_each_provider_gets_its_servers_and_is_recognised(self):
		for provider, host, login in (("outlook", "smtp-mail.outlook.com", None), ("yahoo", "smtp.mail.yahoo.com", None), ("yandex", "smtp.yandex.com", None), ("sendgrid", "smtp.sendgrid.net", "apikey"), ("sparkpost", "smtp.sparkpostmail.com", "SMTP_Injection"), ("microsoft365", "smtp.office365.com", None)):
			with patch(VALIDATE):
				name = integrations.add_provider(provider, f"{provider}@example.com", "pw")["name"]
			doc = frappe.get_doc("Email Account", name)
			self.assertEqual((doc.smtp_server, doc.enable_incoming), (host, 0))
			self.assertEqual(doc.get("login_id") if login else None, login)
			self.assertEqual(next(a for a in integrations.get_integrations()["email"] if a["name"] == name)["kind"], provider)

	def test_receiving_replies_adds_the_inbox_for_the_providers_that_have_one(self):
		with patch(VALIDATE), patch("frappe.email.doctype.email_account.email_account.EmailAccount.get_incoming_server"):
			name = integrations.add_provider("yahoo", "inbox@example.com", "pw", receive=1)["name"]
		doc = frappe.get_doc("Email Account", name)
		self.assertEqual((doc.enable_incoming, doc.email_server), (1, "imap.mail.yahoo.com"))

	def test_any_other_smtp_server(self):
		with patch(VALIDATE):
			name = integrations.add_provider("smtp", "me@corp.example", "pw", smtp_server="mail.corp.example", smtp_port=465, security="SSL", login_id="corp-user")["name"]
		doc = frappe.get_doc("Email Account", name)
		self.assertEqual((doc.smtp_server, int(doc.smtp_port), doc.use_ssl_for_outgoing, doc.login_id), ("mail.corp.example", 465, 1, "corp-user"))
		with self.assertRaises(frappe.ValidationError):
			integrations.add_provider("smtp", "me2@corp.example", "pw", smtp_server="bad server!")
		with self.assertRaises(frappe.ValidationError):
			integrations.add_provider("nonsense", "me3@corp.example", "pw")

	def test_the_sending_account_cannot_be_removed_but_others_can(self):
		with patch(VALIDATE):
			one = integrations.add_provider("yahoo", "one@example.com", "pw", use_for_sending=1)["name"]
			two = integrations.add_provider("yandex", "two@example.com", "pw")["name"]
		with self.assertRaises(frappe.ValidationError):
			integrations.remove_account(one)
		self.assertTrue(integrations.remove_account(two)["removed"])
		self.assertFalse(frappe.db.exists("Email Account", two))

	def test_a_new_password_is_checked_and_saved(self):
		with patch(VALIDATE):
			name = integrations.add_provider("yahoo", "pw@example.com", "old")["name"]
			integrations.update_password(name, "new-secret")
		self.assertEqual(frappe.get_doc("Email Account", name).get_password("password"), "new-secret")


class TestWhatsAppIntegration(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	def _add(self, phone="1111111111", name="WA One", sending=0, receiving=0):
		with patch.object(integrations, "_graph", return_value=({"verified_name": "Acme", "display_phone_number": "+91 99999 00000"}, "")), patch(
			"frappe_whatsapp.frappe_whatsapp.doctype.whatsapp_account.whatsapp_account.WhatsAppAccount.subscribe_app", return_value={"success": True}
		):
			return integrations.add_whatsapp(name, phone, "2222222222", "EAAB-secret-token", "3333", "v21.0", sending, receiving)

	def test_a_number_is_connected_only_when_whatsapp_accepts_the_token(self):
		with patch.object(integrations, "_graph", return_value=(None, "Invalid OAuth access token")):
			with self.assertRaises(frappe.ValidationError):
				integrations.add_whatsapp("Bad", "1", "2", "nope")
		self.assertFalse(frappe.db.exists("WhatsApp Account", "Bad"))
		out = self._add()
		self.assertEqual(out["number"], "+91 99999 00000")
		row = next(a for a in integrations.get_integrations()["whatsapp"]["accounts"] if a["name"] == "WA One")
		self.assertTrue(row["has_token"])
		self.assertTrue(row["verify_token"])
		self.assertNotIn("EAAB-secret-token", json.dumps(integrations.get_integrations()))
		with self.assertRaises(frappe.ValidationError):
			self._add()  # the same number twice

	def test_sending_and_receiving_move_to_the_chosen_number(self):
		self._add("1111111111", "WA One", 1, 1)
		self._add("4444444444", "WA Two")
		integrations.set_whatsapp("WA Two", "sending", 1)
		self.assertEqual(frappe.db.get_value("WhatsApp Account", "WA One", "is_default_outgoing"), 0)
		self.assertEqual(frappe.db.get_value("WhatsApp Account", "WA Two", "is_default_outgoing"), 1)
		self.assertEqual(frappe.db.get_value("WhatsApp Account", "WA One", "is_default_incoming"), 1)

	def test_switching_off_clears_the_defaults_and_a_switched_off_number_cannot_be_chosen(self):
		self._add("1111111111", "WA One", 1, 1)
		integrations.set_whatsapp("WA One", "active", 0)
		self.assertEqual(frappe.db.get_value("WhatsApp Account", "WA One", ["status", "is_default_outgoing"]), ("Inactive", 0))
		with self.assertRaises(frappe.ValidationError):
			integrations.set_whatsapp("WA One", "sending", 1)

	def test_disconnect_removes_a_number_or_keeps_the_history_switched_off(self):
		self._add("1111111111", "WA One")
		self.assertTrue(integrations.disconnect_whatsapp("WA One")["removed"])
		self._add("5555555555", "WA Used", 1)
		frappe.get_doc({"doctype": "WhatsApp Message", "type": "Outgoing", "to": "919999900000", "message": "hi", "whatsapp_account": "WA Used", "flags": {}}).db_insert()
		out = integrations.disconnect_whatsapp("WA Used")
		self.assertFalse(out["removed"])
		self.assertEqual(frappe.db.get_value("WhatsApp Account", "WA Used", ["status", "is_default_outgoing"]), ("Inactive", 0))
		self.assertFalse(next(a for a in integrations.get_integrations()["whatsapp"]["accounts"] if a["name"] == "WA Used")["has_token"])

	def test_the_connection_tests_report_instead_of_raising(self):
		self._add("1111111111", "WA One")
		with patch.object(integrations, "_graph", return_value=(None, "Session expired")):
			self.assertEqual(integrations.test_whatsapp("WA One"), {"ok": False, "message": "Session expired"})
		with patch.object(integrations, "_graph", return_value=({"verified_name": "Acme", "display_phone_number": "+91 1", "quality_rating": "GREEN"}, "")):
			out = integrations.test_whatsapp("WA One")
			self.assertTrue(out["ok"])
			self.assertEqual(out["quality"], "GREEN")

	def test_the_email_connection_test_reports_a_failed_login(self):
		with patch(VALIDATE):
			name = integrations.add_ses("ses-conn@example.com", "ap-south-1", "AKIA", "pw")["name"]
		with patch("frappe.email.doctype.email_account.email_account.EmailAccount.get_smtp_server", side_effect=Exception("535 Authentication Credentials Invalid")):
			out = integrations.test_email(name)
		self.assertFalse(out["ok"])
		self.assertIn("535", out["message"])

	def test_only_administrators(self):
		frappe.set_user(self.person("wa-sales@example.com", "Sales User"))
		for call in (lambda: integrations.add_whatsapp("x", "1", "2", "t"), lambda: integrations.test_whatsapp("x"), lambda: integrations.disconnect_whatsapp("x"), lambda: integrations.test_email("x")):
			with self.assertRaises(frappe.PermissionError):
				call()


class TestLogs(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")

	def _email(self, mid, status="Sent", delivery="Sent", read=0, error=""):
		comm = frappe.get_doc({"doctype": "Communication", "communication_type": "Communication", "communication_medium": "Email", "sent_or_received": "Sent", "subject": f"Subject {mid}",
			"content": "x", "delivery_status": delivery, "read_by_recipient": read, "recipients": "lead@example.com"}).insert(ignore_permissions=True)
		q = frappe.get_doc({"doctype": "Email Queue", "sender": "log@example.com", "message": "x", "message_id": mid, "status": status, "error": error, "communication": comm.name,
			"recipients": [{"recipient": f"{mid.strip('<>').split('@')[0]}@logtest.example.com"}]}).insert(ignore_permissions=True)
		return q.name

	def test_the_email_log_shows_each_state_and_filters(self):
		self._email("<a1@x>", "Sent", "Sent")
		self._email("<a2@x>", "Sent", "Opened")
		self._email("<a3@x>", "Sent", "Bounced")
		self._email("<a4@x>", "Error", "Error", error="Connection refused")
		waiting = self._email("<a5@x>", "Not Sent", "")
		out = integrations.get_email_log(search="logtest.example.com")
		self.assertEqual(out["total"], 5)
		self.assertEqual({k: out["counts"][k] for k in ("Sent", "Read", "Bounced", "Failed", "Waiting")}, {"Sent": 1, "Read": 1, "Bounced": 1, "Failed": 1, "Waiting": 1})
		self.assertEqual(integrations.get_email_log(status="Failed,Bounced", search="logtest.example.com")["total"], 2)
		failed = next(r for r in integrations.get_email_log(status="Failed", search="logtest.example.com")["rows"])
		self.assertEqual((failed["error"], failed["recipient"]), ("Connection refused", "a4@logtest.example.com"))
		self.assertEqual(len(integrations.get_email_log(page=1, page_size=2, search="logtest.example.com")["rows"]), 2)

	def test_a_failed_email_can_be_sent_again_but_a_sent_one_cannot(self):
		bad = self._email("<b1@x>", "Error", "Error", error="boom")
		good = self._email("<b2@x>", "Sent", "Sent")
		integrations.retry_email(bad)
		self.assertEqual(frappe.db.get_value("Email Queue", bad, ["status", "error"]), ("Not Sent", ""))
		with self.assertRaises(frappe.ValidationError):
			integrations.retry_email(good)

	def test_the_whatsapp_log_maps_provider_status_to_a_state(self):
		for i, (typ, status) in enumerate((("Outgoing", "Success"), ("Outgoing", "delivered"), ("Outgoing", "read"), ("Outgoing", "failed"), ("Outgoing", "Queued"), ("Incoming", "Success"))):
			frappe.get_doc({"doctype": "WhatsApp Message", "type": typ, "to": f"91999000{i}", "message": f"hello {i}", "status": status}).db_insert()
		out = integrations.get_whatsapp_log(search="hello")
		self.assertEqual(out["total"], 6)
		self.assertEqual({k: out["counts"][k] for k in ("Sent", "Delivered", "Read", "Failed", "Waiting", "Received")}, {"Sent": 1, "Delivered": 1, "Read": 1, "Failed": 1, "Waiting": 1, "Received": 1})
		self.assertEqual(integrations.get_whatsapp_log(status="Failed", search="hello")["rows"][0]["provider_status"], "failed")

	def test_the_logs_are_for_administrators_only(self):
		frappe.set_user(self.person("log-sales@example.com", "Sales User"))
		for call in (integrations.get_email_log, integrations.get_whatsapp_log, lambda: integrations.retry_email("x")):
			with self.assertRaises(frappe.PermissionError):
				call()
