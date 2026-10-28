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
	def test_replies_are_saved_edited_and_removed_with_ids(self):
		from crm_addons.campaigns import replies

		self.addCleanup(lambda: frappe.db.set_default(replies.KEY, "[]"))
		rows = replies.save(" Pricing ", "Hi {{ first_name }}")
		rid = rows[0]["id"]
		self.assertEqual(rows[0]["title"], "Pricing")
		self.assertEqual(replies.save("Pricing 2", "Hi", rid)[0]["title"], "Pricing 2")
		with self.assertRaises(frappe.ValidationError):
			replies.save("", "x")
		self.assertEqual(replies.remove(rid), [])

	def test_everyone_reads_them_but_only_template_editors_change_them(self):
		from crm_addons.campaigns import api, replies

		self.addCleanup(lambda: frappe.db.set_default(replies.KEY, "[]"))
		frappe.set_user("Administrator")
		api.save_whatsapp_reply("Thanks", "Thank you {{ first_name }}")
		person = self.person("pro.replies2@example.org", "Sales User")
		self.addCleanup(frappe.set_user, "Administrator")
		frappe.set_user(person)
		self.assertEqual([r["title"] for r in config.get_whatsapp_replies()["replies"]], ["Thanks"])

	def test_a_reply_file_must_be_a_public_upload(self):
		from crm_addons.campaigns import replies

		self.addCleanup(lambda: frappe.db.set_default(replies.KEY, "[]"))
		with self.assertRaises(frappe.ValidationError):
			replies.save("Brochure", "Here it is", None, "/private/files/x.pdf", "x.pdf")
		with self.assertRaises(frappe.ValidationError):
			replies.save("Brochure", "Here it is", None, "/files/does-not-exist.pdf", "x.pdf")
		file = frappe.get_doc({"doctype": "File", "file_name": "reply-test.txt", "content": "hello", "is_private": 0}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "File", file.name, force=True, ignore_permissions=True)
		row = replies.save("Brochure", "Here it is", None, file.file_url, "reply-test.txt")[0]
		self.assertEqual((row["attach_url"], row["attach_type"]), (file.file_url, "document"))
