"""The Leads screen defaults an admin sets for everybody, and the one search box."""

import json

import frappe

from crm_addons.pro import config, form, leads
from crm_addons.team_access.test_access import AccessCase


class TestProConfig(AccessCase):
	def setUp(self):
		super().setUp()
		self.old = frappe.db.get_default(config.KEY)
		self.addCleanup(lambda: frappe.db.set_default(config.KEY, self.old or "{}"))

	def test_defaults_and_save(self):
		frappe.set_user("Administrator")
		self.assertEqual(config.get_config()["default_view"], "list")
		out = config.save_config(json.dumps({"default_view": "kanban", "filters": ["source"], "sort": "creation asc", "columns": ["lead_name", "status"]}))
		self.assertEqual(out["default_view"], "kanban")
		self.assertEqual(config.get_config()["columns"], ["lead_name", "status"])

	def test_refuses_unknown_things(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			config.save_config(json.dumps({"filters": ["no_such_field"]}))
		with self.assertRaises(frappe.ValidationError):
			config.save_config(json.dumps({"sort": "creation sideways"}))
		with self.assertRaises(frappe.ValidationError):
			config.save_config(json.dumps({"create_fields": [{"fieldname": "creation"}]}))

	def test_top_row_fields_leave_the_filter_list(self):
		frappe.set_user("Administrator")
		out = config.save_config(json.dumps({"top_filters": ["source", "status"], "filters": ["source", "territory"]}))
		self.assertEqual(out["top_filters"], ["source"])
		self.assertEqual(out["filters"], ["territory"])

	def test_organizations_top_row(self):
		frappe.set_user("Administrator")
		old = frappe.db.get_default(config.ORG_KEY)
		self.addCleanup(lambda: frappe.db.set_default(config.ORG_KEY, old or "{}"))
		self.assertEqual(config.get_orgs_config()["filters"], ["industry", "territory"] if not old else config.load_orgs()["filters"])
		self.assertEqual(config.save_orgs_config(json.dumps({"filters": ["territory"]}))["filters"], ["territory"])
		with self.assertRaises(frappe.ValidationError):
			config.save_orgs_config(json.dumps({"filters": ["creation"]}))
		out = config.save_orgs_config(json.dumps({"filters": [], "columns": ["organization_name", "leads"]}))
		self.assertEqual(out["columns"], ["organization_name", "leads"])
		self.assertEqual(config.get_orgs_config()["columns"], ["organization_name", "leads"])
		with self.assertRaises(frappe.ValidationError):
			config.save_orgs_config(json.dumps({"filters": [], "columns": ["no_such_column"]}))

	def test_only_admins_save(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			config.save_config("{}")

	def test_create_form_follows_config(self):
		frappe.set_user("Administrator")
		config.save_config(json.dumps({"create_fields": [{"fieldname": "mobile_no", "reqd": 1}, {"fieldname": "first_name"}]}))
		names = [f["fieldname"] for s in form.get_form("create") for f in s["fields"]]
		self.assertEqual(names[:2], ["mobile_no", "first_name"])
		with self.assertRaises(frappe.ValidationError):
			leads.create_lead(json.dumps({"first_name": "Zq NoPhone"}))

	def test_search_any_field(self):
		frappe.set_user("Administrator")
		lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Zq Search", "email": "zq.unique.mail@example.com", "mobile_no": "+919811223344"}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", lead.name, force=True, ignore_permissions=True)
		self.assertIn(lead.name, leads.search_names("zq.unique.mail"))
		self.assertIn(lead.name, leads.search_names("9811223344"))
		self.assertEqual(leads.search_names(" "), [])

	def test_field_values(self):
		frappe.set_user("Administrator")
		lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Zq Vals", "job_title": "Zqville"}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", lead.name, force=True, ignore_permissions=True)
		self.assertIn("Zqville", [v["value"] for v in leads.field_values("job_title", "zqv")])
		self.assertTrue(leads.field_values("status"))
		with self.assertRaises(frappe.ValidationError):
			leads.field_values("creation")
		with self.assertRaises(frappe.ValidationError):
			leads.field_values("owner")


class TestWhatsAppReplies(AccessCase):
	def test_only_a_system_manager_saves_replies_and_blanks_are_dropped(self):
		frappe.set_user("Administrator")
		out = config.save_whatsapp_replies(json.dumps([{"title": " Pricing ", "text": "Hi {name}"}, {"title": "", "text": "x"}, {"title": "y", "text": ""}]))
		self.assertEqual(out["replies"], [{"title": "Pricing", "text": "Hi {name}"}])
		self.assertTrue(config.get_whatsapp_replies()["can_manage"])
		person = self.person("pro.replies@example.org", "Sales User")
		self.addCleanup(frappe.set_user, "Administrator")
		self.addCleanup(lambda: frappe.db.set_default(config.WA_REPLIES_KEY, "[]"))
		frappe.set_user(person)
		self.assertEqual(config.get_whatsapp_replies()["replies"], out["replies"])
		self.assertFalse(config.get_whatsapp_replies()["can_manage"])
		with self.assertRaises(frappe.PermissionError):
			config.save_whatsapp_replies("[]")
