# Copyright (c) 2026, Siddharth Singh
"""The ready-made demo messages: the email templates, the Utility WhatsApp definitions and how a new demo type uses them.

Run on a bench:  bench --site <site> run-tests --module crm_addons.demos.doctype.crm_demo_booking.test_default_messages
Meta is never called.
"""

import copy
import re
from unittest.mock import patch

import frappe

from crm_addons.campaigns import api as campaign_api
from crm_addons.campaigns import personalization
from crm_addons.demos import admin, defaults
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import DemoCase
from crm_addons.install import ensure_default_email_templates


class TestDefaultMessages(DemoCase):
	def seed_emails(self):
		frappe.db.set_default("crm_addons_default_email_templates", "")  # rolled back with the test
		ensure_default_email_templates()

	def as_user(self, user):
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")

	def test_every_email_exists_and_only_uses_known_variables(self):
		self.seed_emails()
		for key, name in defaults.EMAIL.items():
			doc = frappe.get_doc("CRM Campaign Email Template", name)
			self.assertEqual(personalization.unknown_variables(doc.subject, doc.body_html), [], name)
			self.assertIn("{{ meet_link }}", doc.body_html if key != defaults.CANCELLED else doc.body_html + "{{ meet_link }}", name)
			self.assertEqual(doc.category, "System")

	def test_the_email_templates_are_all_in_the_seed_list(self):
		from crm_addons.campaigns import default_templates

		names = {n for n, *_rest in default_templates.default_templates()}
		self.assertTrue(set(defaults.EMAIL.values()) <= names)

	def test_every_whatsapp_definition_passes_the_creators_checks(self):
		for key, spec in defaults.WHATSAPP.items():
			fields = campaign_api._template_fields(copy.deepcopy(spec))  # raises with Meta's rules in plain words
			numbers = personalization.placeholders_in(spec["template"])
			self.assertEqual(numbers, list(range(1, len(numbers) + 1)), key)
			self.assertEqual(len(spec["sample_values"]), len(numbers), key)
			self.assertEqual(sorted(int(k) for k in spec["variable_map"]), numbers, key)
			self.assertEqual(spec["category"], "UTILITY")
			self.assertEqual(fields["template_name"], spec["template_name"])
			for value in spec["variable_map"].values():  # every value is a variable a demo message can use
				self.assertEqual(personalization.unknown_variables(value, ""), [], value)

	def test_the_names_follow_metas_rules_and_are_unique(self):
		names = [s["template_name"] for s in defaults.WHATSAPP.values()]
		self.assertEqual(len(names), len(set(names)))
		for n in names:
			self.assertRegex(n, r"^[a-z0-9_]{1,100}$")
		self.assertEqual(set(defaults.EMAIL), set(defaults.WHATSAPP))

	def test_a_new_demo_type_starts_with_the_ready_made_emails(self):
		self.seed_emails()
		demo = self.make_demo("defaults-demo")
		self.assertEqual(len(demo.messages), 7)
		for row in demo.messages:
			key = defaults.key_of(row.event, row.minutes_before)
			self.assertEqual(row.email_template, defaults.EMAIL[key])
			self.assertEqual(row.send_email, 1)
			self.assertFalse(row.send_whatsapp)  # nothing approved by Meta yet
			self.assertFalse(row.wa_template)

	def test_an_approved_whatsapp_template_is_picked_up_with_its_variables(self):
		self.seed_emails()
		real = frappe.get_all
		fake = [frappe._dict(name="booking_confirmed-en", actual_name="booking_confirmed", template_name="booking_confirmed", whatsapp_account="Acme")]

		def get_all(doctype, *a, **k):
			return fake if doctype == "WhatsApp Templates" else real(doctype, *a, **k)

		with patch.object(frappe, "get_all", side_effect=get_all):
			demo = self.make_demo("defaults-wa")
		rule = next(r for r in demo.messages if r.event == "Confirmed")
		self.assertEqual((rule.send_whatsapp, rule.wa_template, rule.wa_account), (1, "booking_confirmed-en", "Acme"))
		self.assertEqual(frappe.parse_json(rule.wa_variables)["1"], "{{ first_name }}")
		other = next(r for r in demo.messages if r.event == "Cancelled")
		self.assertFalse(other.send_whatsapp)

	def test_a_choice_is_never_overwritten(self):
		self.seed_emails()
		own = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "My own confirm", "subject": "s {{ demo_title }}", "body_html": "<p>x</p>", "enabled": 1}).insert()
		demo = self.make_demo("defaults-own", messages=[{"event": "Confirmed", "send_email": 1, "email_template": own.name}])
		row = next(r for r in demo.messages if r.event == "Confirmed")
		self.assertEqual(row.email_template, own.name)

	def test_the_manager_api_lists_every_message_with_its_whatsapp_state(self):
		self.seed_emails()
		rows = admin.default_messages()
		self.assertEqual([(r["event"], r["minutes_before"]) for r in rows], defaults.ORDER)
		first = rows[0]
		self.assertTrue(first["email_exists"])
		self.assertEqual(first["whatsapp"]["template_name"], "booking_confirmed")
		self.assertIn(first["whatsapp"]["state"], ("NOT CREATED", "PENDING", "APPROVED", "REJECTED", "NOT SYNCED"))
		self.assertEqual(len(re.findall(r"\{\{\d\}\}", first["whatsapp"]["body"])), 6)

	def test_submitting_a_default_goes_through_the_creator_and_only_for_managers(self):
		with patch.object(campaign_api, "create_whatsapp_template", return_value={"name": "booking_reminder_1h-en", "status": "PENDING"}) as create:
			out = admin.create_default_whatsapp_template("Reminder", 60)
		self.assertEqual(out["status"], "PENDING")
		sent = create.call_args[0][0]
		self.assertEqual((sent["template_name"], sent["category"]), ("booking_reminder_1h", "UTILITY"))
		with self.assertRaises(frappe.ValidationError):
			admin.create_default_whatsapp_template("Reminder", 7)  # no ready-made message for that one
		self.as_user(self.owner.name)
		with self.assertRaises(frappe.PermissionError):
			admin.create_default_whatsapp_template("Confirmed")
		with self.assertRaises(frappe.PermissionError):
			admin.default_messages()


from frappe.tests.utils import FrappeTestCase  # noqa: E402


class TestMetaWordingRules(FrappeTestCase):
	def test_no_ready_made_whatsapp_text_starts_or_ends_with_a_variable(self):
		"""Meta refuses a template body that begins or ends with a {{n}} (or has two next to each other)."""
		import re

		from crm_addons import system_messages
		from crm_addons.demos import defaults

		bodies = {f"booking {k}": v["template"] for k, v in defaults.WHATSAPP.items()}
		bodies["login"] = system_messages.LOGIN["template"]
		bodies["missed call"] = system_messages.MISSED_CALL["template"]
		for name, body in bodies.items():
			text = body.strip()
			self.assertFalse(re.match(r"^\{\{\d+\}\}", text), f"{name} starts with a variable")
			self.assertFalse(re.search(r"\{\{\d+\}\}[\s.!?,:;]*$", text), f"{name} ends with a variable")
			self.assertFalse(re.search(r"\{\{\d+\}\}\s*\{\{\d+\}\}", text), f"{name} has two variables in a row")
