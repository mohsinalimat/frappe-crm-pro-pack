"""Ready-made templates are protected from deletion (campaigns/protected.py)."""

from unittest.mock import patch

import frappe

from crm_addons.campaigns import api, protected
from crm_addons.team_access.test_access import AccessCase


class TestProtectedTemplates(AccessCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, "Administrator")
		self.system = self.make("Test Ready-made", 1)
		self.plain = self.make("Test Plain", 0)
		self.spare = self.make("Test Spare", 0)

	def make(self, name, system):
		if frappe.db.exists("CRM Campaign Email Template", name):
			frappe.flags.crm_template_delete_ok = True
			frappe.delete_doc("CRM Campaign Email Template", name, force=True, ignore_permissions=True)
			frappe.flags.crm_template_delete_ok = False
		doc = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": name, "subject": "s", "body_html": "<p>x</p>", "enabled": 1, "category": "System" if system else "Other", "is_system": system})
		doc.insert(ignore_permissions=True)

		def cleanup():
			frappe.flags.crm_template_delete_ok = True
			if frappe.db.exists("CRM Campaign Email Template", name):
				frappe.delete_doc("CRM Campaign Email Template", name, force=True, ignore_permissions=True)
			frappe.flags.crm_template_delete_ok = False

		self.addCleanup(cleanup)
		return doc.name

	def test_a_direct_delete_is_refused(self):
		with self.assertRaises(frappe.PermissionError):
			frappe.delete_doc("CRM Campaign Email Template", self.system, ignore_permissions=True)
		frappe.delete_doc("CRM Campaign Email Template", self.plain, ignore_permissions=True)  # an ordinary template still goes

	def test_only_a_system_manager_deletes_or_archives_one(self):
		rep = self.person("prot.rep@example.org", "Sales User")
		self.configure(rep, None, {"email_templates": "edit"})
		frappe.set_user(rep)
		with self.assertRaises(frappe.PermissionError):
			api.delete_email_template(self.system)
		with self.assertRaises(frappe.PermissionError):
			api.save_email_template({"enabled": 0}, self.system)
		self.assertTrue(frappe.db.exists("CRM Campaign Email Template", self.system))
		info = api.template_delete_info("email", self.system)
		self.assertTrue(info["protected"] and not info["can_delete"])

	def test_in_use_needs_a_replacement_and_the_users_follow(self):
		in_use = {"campaigns": ["C-1"], "bookings": ["Intro session"]}
		with patch.object(protected, "usage", return_value=in_use), patch.object(protected, "repoint") as repoint:
			with self.assertRaises(frappe.ValidationError):
				api.delete_email_template(self.system)  # no replacement
			with self.assertRaises(frappe.ValidationError):
				api.delete_email_template(self.system, self.system)  # itself is no replacement
			out = api.delete_email_template(self.system, self.spare)
		repoint.assert_called_once_with("email", self.system, self.spare)
		self.assertEqual(out["replaced_by"], self.spare)
		self.assertFalse(frappe.db.exists("CRM Campaign Email Template", self.system))

	def test_unused_deletes_without_a_replacement(self):
		with patch.object(protected, "usage", return_value={"campaigns": [], "bookings": []}):
			api.delete_email_template(self.system)
		self.assertFalse(frappe.db.exists("CRM Campaign Email Template", self.system))

	def test_the_list_tags_default_utility_and_marketing(self):
		rows = {r["name"]: r for r in api.list_email_templates()}
		self.assertEqual(rows[self.system]["purpose"], "System")
		self.assertEqual(rows[self.plain]["purpose"], "")
