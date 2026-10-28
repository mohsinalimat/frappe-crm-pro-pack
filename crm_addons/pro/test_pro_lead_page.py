"""The lead page: only a System Manager may delete a lead, and comments keep their formatting but not scripts."""

import frappe

from crm_addons.pro import lead
from crm_addons.team_access.test_access import AccessCase


class TestLeadPage(AccessCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, "Administrator")
		self.lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Page Test", "email": "page.test@example.org"}).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.db.exists("CRM Lead", self.lead.name) and frappe.delete_doc("CRM Lead", self.lead.name, force=True, ignore_permissions=True))

	def test_a_sales_user_cannot_delete_a_lead(self):
		user = self.person("page.sales@example.org", "Sales User")
		frappe.set_user(user)
		doc = frappe.get_doc("CRM Lead", self.lead.name)
		self.assertFalse(lead._may_delete(doc))
		with self.assertRaises(frappe.PermissionError):
			lead.delete_lead(self.lead.name)
		self.assertTrue(frappe.db.exists("CRM Lead", self.lead.name))

	def test_a_system_manager_can_delete_a_lead(self):
		frappe.set_user("Administrator")
		self.assertTrue(lead.get_lead(self.lead.name)["can_delete"])
		lead.delete_lead(self.lead.name)
		self.assertFalse(frappe.db.exists("CRM Lead", self.lead.name))

	def test_comments_keep_formatting_and_lose_scripts(self):
		lead.add_comment(self.lead.name, "<p><b>Hello</b></p><script>alert(1)</script>")
		html = [e["html"] for e in lead.get_timeline(self.lead.name) if e["kind"] == "comment"][0]
		self.assertIn("<b>Hello</b>", html)
		self.assertNotIn("script", html)
		with self.assertRaises(frappe.ValidationError):
			lead.add_comment(self.lead.name, "<p> </p>")

	def test_the_activity_stream_includes_follow_ups(self):
		from crm_addons import followups

		followups.save_follow_up(frappe.as_json({"reference_doctype": "CRM Lead", "reference_docname": self.lead.name, "mode": "Call", "call_status": "Did Not Pick", "outcome": "Did Not Pick", "remark": "no answer"}))
		rows = lead.get_activity(self.lead.name)
		self.assertTrue([r for r in rows if r["kind"] == "followup"])
		self.assertEqual(lead.get_followups(self.lead.name)["summary"]["calls"], 1)
