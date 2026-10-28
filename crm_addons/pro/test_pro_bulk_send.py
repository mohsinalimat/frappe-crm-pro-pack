"""Sending email / WhatsApp to picked leads: who is skipped and what is refused."""

import json
from unittest import mock

import frappe

from crm_addons.pro import bulk_send
from crm_addons.team_access.test_access import AccessCase


class TestBulkSend(AccessCase):
	def make_lead(self, **kw):
		doc = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Bulk", "last_name": frappe.generate_hash(length=6), **kw}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", doc.name, force=True, ignore_permissions=True)
		return doc

	def test_email_sends_to_leads_with_an_address_only(self):
		frappe.set_user("Administrator")
		a, b = self.make_lead(email="zq.bulk@example.com"), self.make_lead()
		with mock.patch.object(bulk_send, "email_account_problem", return_value=""), mock.patch.object(bulk_send.channels, "queue_email") as q:
			res = bulk_send.send_email(json.dumps([a.name, b.name]), "Hi {{ first_name }}", "Hello {{ first_name }}\n<b>x</b>")
		self.assertEqual(res["sent"], 1)
		self.assertEqual([s["name"] for s in res["skipped"]], [b.name])
		args = q.call_args.args
		self.assertEqual(args[0], "zq.bulk@example.com")
		self.assertEqual(args[1], "Hi Bulk")
		self.assertIn("&lt;b&gt;", args[2])  # what was typed is text, not markup

	def test_email_skips_opted_out(self):
		frappe.set_user("Administrator")
		a = self.make_lead(email="zq.out@example.com")
		with mock.patch.object(bulk_send, "email_account_problem", return_value=""), mock.patch.object(bulk_send.channels, "queue_email") as q, mock.patch.object(bulk_send.optout, "is_opted_out", return_value=True):
			res = bulk_send.send_email(json.dumps([a.name]), "s", "m")
		self.assertEqual(res["sent"], 0)
		self.assertEqual(res["skipped"][0]["reason"], "Opted out")
		q.assert_not_called()

	def test_refuses_empty_unknown_and_guest(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			bulk_send.send_email(json.dumps(["x"]), "", "m")
		with self.assertRaises(frappe.ValidationError):
			bulk_send.send_email(json.dumps(["x"]), "s", "Hi {{ nonsense_variable }}")
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			bulk_send.options()

	def test_whatsapp_needs_a_ready_template(self):
		frappe.set_user("Administrator")
		a = self.make_lead(mobile_no="+911234567890")
		with mock.patch.object(bulk_send, "whatsapp_installed", return_value=False):
			with self.assertRaises(frappe.ValidationError):
				bulk_send.send_whatsapp(json.dumps([a.name]), "nope")

	def test_options_lists_email_state(self):
		frappe.set_user("Administrator")
		self.assertIn("ready", bulk_send.options()["email"])
