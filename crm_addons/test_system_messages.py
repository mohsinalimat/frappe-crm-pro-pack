"""The missed-call WhatsApp message: an approved template when one is chosen, plain text otherwise."""

from unittest.mock import patch

import frappe

from crm_addons import followups, system_messages
from crm_addons.team_access.test_access import AccessCase


class TestMissedCall(AccessCase):
	def make_lead(self):
		return frappe.get_doc({"doctype": "CRM Lead", "first_name": "Missed", "mobile_no": "9876543210"}).insert(ignore_permissions=True)

	def test_a_chosen_template_is_what_gets_sent(self):
		lead = self.make_lead()
		self.addCleanup(frappe.delete_doc, "CRM Lead", lead.name, force=True, ignore_permissions=True)
		info = {"name": "t", "label": "missed_call_followup", "body": "Hi {{1}}", "state": "APPROVED", "ready": True}
		with patch.object(followups, "_whatsapp_ready", return_value=True), patch.object(system_messages, "template_info", return_value=info), \
			patch.object(system_messages, "send_missed_call_template", return_value={"message": "WM-1", "to": "919876543210"}) as send:
			out = followups.send_missed_call_whatsapp("CRM Lead", lead.name, "ignored text")
		send.assert_called_once_with("CRM Lead", lead.name)
		self.assertEqual(out["message"], "WM-1")

	def test_a_template_not_approved_yet_is_not_sent(self):
		info = {"name": "t", "label": "x", "body": "Hi", "state": "PENDING", "ready": False}
		with patch.object(system_messages, "template_info", return_value=info):
			with self.assertRaises(frappe.ValidationError):
				system_messages.send_missed_call_template("CRM Lead", "none")

	def test_the_form_config_says_which_template_is_used(self):
		info = {"name": "t", "label": "x", "body": "Hi", "state": "PENDING", "ready": False}
		with patch.object(system_messages, "template_info", return_value=info):
			self.assertEqual(followups._missed_call_template(), {"label": "x", "body": "Hi", "state": "PENDING", "ready": False})
		with patch.object(system_messages, "template_info", return_value=None):
			self.assertIsNone(followups._missed_call_template())


class TestLinkedLoginTemplate(AccessCase):
	def template(self, name, body, status="APPROVED"):
		doc = frappe.get_doc({"doctype": "WhatsApp Templates", "template_name": name, "actual_name": name, "template": body, "status": status, "category": "UTILITY", "language_code": "en", "language": "en"})
		doc.name = name
		doc.db_insert()
		self.addCleanup(lambda: frappe.db.delete("WhatsApp Templates", {"name": name}))
		return name

	def test_an_approved_template_can_be_linked_and_becomes_a_system_template(self):
		name = self.template("zz_login_ok", "Hi {{1}}, continue here: {{2}}")
		self.addCleanup(system_messages.link_login_template, "")
		out = system_messages.link_login_template(name)
		self.assertTrue(out["linked"] and out["ready"] and out["name"] == name)
		if frappe.get_meta("WhatsApp Templates").has_field("crm_system"):
			self.assertEqual(frappe.db.get_value("WhatsApp Templates", name, "crm_system"), 1)
		self.assertEqual(system_messages.login_template_status()["name"], name)
		out = system_messages.link_login_template("")  # back to the ready-made one
		self.assertFalse(out["linked"])

	def test_a_template_that_is_not_approved_or_has_the_wrong_variables_is_refused(self):
		pending = self.template("zz_login_pending", "Hi {{1}} {{2}}", "PENDING")
		many = self.template("zz_login_many", "{{1}} {{2}} {{3}}")
		for bad in (pending, many, "no-such-template"):
			with self.assertRaises(frappe.ValidationError):
				system_messages.link_login_template(bad)

	def test_the_linked_template_is_the_one_that_is_sent(self):
		name = self.template("zz_login_send", "Continue: {{1}}")  # one variable = just the link
		self.addCleanup(system_messages.link_login_template, "")
		system_messages.link_login_template(name)
		user = self.person("login.send@example.org", "Sales User")
		frappe.db.set_value("User", user, "mobile_no", "+919876543210")
		sent = {}

		def fake(template, account, to, params, ref_doctype, ref_name, marker, attach=None):
			sent.update(template=template, to=to, params=params)
			return frappe._dict(name="WAM-1")

		with patch("crm_addons.campaigns.channels.send_whatsapp_template", side_effect=fake), \
			patch("crm_addons.campaigns.channels.WhatsAppSender._template", return_value=frappe._dict(name=name)), \
			patch("crm_addons.campaigns.channels.WhatsAppSender.account", return_value="ACC"):
			system_messages.send_login_link(user, "https://crm.example.com/update-password?key=abc")
		self.assertEqual(sent["template"], name)
		self.assertEqual(sent["params"], {"1": "https://crm.example.com/update-password?key=abc"})
