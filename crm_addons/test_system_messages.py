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
