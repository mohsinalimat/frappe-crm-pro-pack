"""Settings, Forms: the Add lead / Add organization / Add person forms use only what already exists in the CRM."""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons.pro import config, forms_config, form, leads, orgs


class TestFormsConfig(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.addCleanup(self.reset)
		self.reset()

	def reset(self):
		frappe.set_user("Administrator")
		for kind in forms_config.KINDS:
			forms_config.reset_form(kind)

	def test_every_form_starts_as_the_crm_has_it(self):
		for kind in forms_config.KINDS:
			self.assertIsNone(forms_config.effective(kind))
			self.assertTrue(forms_config.default_rows(kind))
		self.assertEqual([r["fieldname"] for r in forms_config.default_rows("organization")][:2], ["organization_name", "website"])

	def test_nothing_that_is_not_in_the_crm_can_be_added(self):
		with self.assertRaises(frappe.ValidationError):
			forms_config.save_form("lead", json.dumps([{"fieldname": "first_name"}, {"fieldname": "made_up_field"}]))
		with self.assertRaises(frappe.ValidationError):  # a value the CRM does not have, even for a real field
			forms_config.save_form("lead", json.dumps([{"fieldname": "first_name"}, {"fieldname": "source", "hide": ["No Such Source XYZ"]}]))
		with self.assertRaises(frappe.ValidationError):
			forms_config.save_form("person", json.dumps([{"fieldname": "shoe_size"}]))
		self.assertIsNone(forms_config.effective("lead"))

	def test_locked_fields_stay_and_stay_required(self):
		out = forms_config.save_form("lead", json.dumps([{"fieldname": "email"}]))["chosen"]
		first = next(r for r in out if r["fieldname"] == "first_name")
		self.assertEqual(first["reqd"], 1)
		out = forms_config.save_form("person", json.dumps([{"fieldname": "mobile_no", "reqd": 1}]))["chosen"]
		self.assertTrue({"first_name", "email", "role"} <= {r["fieldname"] for r in out})

	def test_the_lead_form_follows_the_choice_with_labels_and_hidden_values(self):
		sources = [s["values"] for s in forms_config.pool("lead") if s["fieldname"] == "source"]
		self.assertTrue(sources and len(sources[0]) >= 2, "needs two lead sources on the site")
		hide = sources[0][0]
		forms_config.save_form("lead", json.dumps([{"fieldname": "mobile_no", "reqd": 1, "label": "WhatsApp number"}, {"fieldname": "first_name"}, {"fieldname": "source", "hide": [hide]}]))
		fields = {f["fieldname"]: f for s in form.get_form("create") for f in s["fields"]}
		self.assertEqual(fields["mobile_no"]["label"], "WhatsApp number")
		self.assertEqual(fields["mobile_no"]["reqd"], 1)
		self.assertEqual(list(fields)[:2], ["mobile_no", "first_name"])
		self.assertEqual(fields["source"].get("hide") or [], [hide])
		with self.assertRaises(frappe.ValidationError):
			leads.create_lead(json.dumps({"first_name": "Zq FormsConfig"}))

	def test_an_older_choice_on_the_leads_screen_still_applies_until_reset(self):
		config.save_config(json.dumps({"create_fields": [{"fieldname": "mobile_no", "reqd": 1}, {"fieldname": "first_name"}]}))
		self.assertEqual([r["fieldname"] for r in forms_config.effective("lead")][:2], ["mobile_no", "first_name"])
		config.save_config(json.dumps({"sort": "modified desc"}))  # saving the screen leaves the form as it was
		self.assertIsNotNone(forms_config.effective("lead"))
		forms_config.reset_form("lead")
		self.assertIsNone(forms_config.effective("lead"))

	def test_organization_form_and_required_fields(self):
		forms_config.save_form("organization", json.dumps([{"fieldname": "organization_name"}, {"fieldname": "website", "reqd": 1}]))
		runtime = forms_config.runtime("organization")
		self.assertTrue(runtime["custom"])
		self.assertEqual([f["fieldname"] for f in runtime["fields"]], ["organization_name", "website"])
		with self.assertRaises(frappe.ValidationError):
			orgs.create_org(json.dumps({"organization_name": "Zq Org No Site"}))
		with self.assertRaises(frappe.ValidationError):
			orgs.create_org(json.dumps({"organization_name": "Zq Org", "not_a_field": "x"}))

	def test_only_a_system_manager_can_arrange_forms(self):
		user = frappe.db.get_value("User", {"enabled": 1, "name": ["not in", ["Administrator", "Guest"]]})
		if not user or "System Manager" in frappe.get_roles(user):
			self.skipTest("needs a user without System Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			forms_config.save_form("lead", json.dumps([{"fieldname": "first_name"}]))

	def test_add_person_enforces_what_was_made_required(self):
		from crm_addons.team_access import admin

		forms_config.save_form("person", json.dumps([{"fieldname": "first_name"}, {"fieldname": "email"}, {"fieldname": "role"}, {"fieldname": "mobile_no", "reqd": 1}]))
		with self.assertRaises(frappe.ValidationError):
			admin.add_person("zq.forms.person@example.org", "Zq", "", "Sales User", None, 0)
		self.assertFalse(frappe.db.exists("User", "zq.forms.person@example.org"))
		self.assertTrue(forms_config.runtime("person")["custom"])
