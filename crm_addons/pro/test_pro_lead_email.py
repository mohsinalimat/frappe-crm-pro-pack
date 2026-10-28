"""The lead page's email: addresses are checked, and templates come back filled in for the lead."""

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons.pro import lead


class TestLeadEmail(FrappeTestCase):
	def test_addresses_are_split_and_checked(self):
		self.assertEqual(lead._addresses("a@example.org; b@example.org,", "CC"), "a@example.org, b@example.org")
		self.assertEqual(lead._addresses("", "CC"), "")
		with self.assertRaises(frappe.ValidationError):
			lead._addresses("a@example.org, nope", "BCC")

	def test_an_empty_message_is_refused(self):
		name = frappe.db.get_value("CRM Lead", {}, "name")
		if not name:
			self.skipTest("no lead on this site")
		with self.assertRaises(frappe.ValidationError):
			lead.send_email(name, "a@example.org", "Hi", "<p> </p>", html=1)

	def test_templates_come_back_with_the_mail_status(self):
		name = frappe.db.get_value("CRM Lead", {}, "name")
		if not name:
			self.skipTest("no lead on this site")
		out = lead.email_templates(name)
		self.assertIn("templates", out)
		self.assertIn("problem", out)
