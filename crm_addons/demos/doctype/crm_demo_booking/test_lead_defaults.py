"""Fields a widget sets on the leads it creates (for example Industry or Website)."""

import json

import frappe

from crm_addons.demos import booking, common
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import MONDAY, DemoCase, ist


class TestLeadDefaults(DemoCase):
	def lead_of(self, name):
		return frappe.get_doc("CRM Lead", frappe.db.get_value("CRM Demo Booking", name, "lead"))

	def test_a_new_lead_gets_the_widgets_fields_and_an_existing_one_is_left_alone(self):
		demo = self.make_demo(max_active_per_contact=5, lead_defaults=json.dumps([{"field": "website", "value": "https://school.example.org"}, {"field": "job_title", "value": "Principal"}]))
		first = self.book(demo, ist(MONDAY, 12))
		lead = self.lead_of(first)
		self.assertEqual((lead.website, lead.job_title), ("https://school.example.org", "Principal"))
		# the same visitor books again: their lead is found and not changed
		frappe.db.set_value("CRM Lead", lead.name, "job_title", "Owner")
		contact = {"name": lead.lead_name, "email": lead.email, "phone": lead.mobile_no.lstrip("+")}
		second = booking.create_booking(demo, ist(MONDAY, 14), "Asia/Kolkata", answers=contact)
		self.assertEqual(self.lead_of(second).name, lead.name)
		self.assertEqual(frappe.db.get_value("CRM Lead", lead.name, "job_title"), "Owner")

	def test_only_allowed_fields_and_real_values_are_saved(self):
		for bad in ([{"field": "email", "value": "x@example.org"}], [{"field": "no_such_field", "value": "x"}], [{"field": "territory", "value": "no-such-territory-xyz"}]):
			with self.assertRaises(frappe.ValidationError):
				self.make_demo(slug="bad-defaults", lead_defaults=json.dumps(bad))
		demo = self.make_demo(slug="ok-defaults", lead_defaults=json.dumps([{"field": "website", "value": " https://a.example "}, {"field": "website", "value": "dup"}, {"field": "job_title", "value": ""}]))
		self.assertEqual(json.loads(demo.lead_defaults), [{"field": "website", "value": "https://a.example"}])

	def test_the_editor_is_offered_only_fields_a_widget_may_set(self):
		names = {f["fieldname"] for f in common.lead_default_choices()}
		self.assertIn("website", names)
		for protected in ("email", "mobile_no", "first_name", "lead_owner", "status", "source"):
			self.assertNotIn(protected, names)
