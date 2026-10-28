"""Lead forms: fields come from the CRM lead, phone and email are asked by default, duplicates never create a second lead."""

import json
import time

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons.demos import leadforms, spam

FORM = "CRM Lead Form"
ENTRY = "CRM Lead Form Entry"


def answers(**kw):
	return {"first_name": "Asha", "last_name": "Rao", "email": "asha.rao.lf@example.org", "mobile_no": "9812367045", **kw}


class TestLeadForms(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.slug = "lf-test-form"
		self.cleanup()
		self.form = frappe.get_doc({"doctype": FORM, "title": "Test form", "slug": self.slug, "enabled": 1, "assignment_mode": "Unassigned"}).insert(ignore_permissions=True)

	def tearDown(self):
		self.cleanup()
		frappe.set_user("Administrator")

	def cleanup(self):
		for lead in frappe.get_all("CRM Lead", filters={"email": ["like", "%.lf@example.org"]}, pluck="name"):
			frappe.delete_doc("CRM Lead", lead, force=True, ignore_permissions=True)
		for e in frappe.get_all(ENTRY, filters={"form": self.slug}, pluck="name"):
			frappe.delete_doc(ENTRY, e, force=True, ignore_permissions=True)
		if frappe.db.exists(FORM, self.slug):
			frappe.delete_doc(FORM, self.slug, force=True, ignore_permissions=True)

	def submit(self, **kw):
		token = spam.make_form_token(leadforms.TOKEN_NS + self.slug, at=time.time() - 60)
		return leadforms.submit(self.slug, answers=json.dumps(kw.pop("values", answers())), form_token=token, **kw)

	def test_a_form_starts_with_name_email_and_phone_required(self):
		fields = {f["fieldname"]: f for f in leadforms.load_fields(self.form)}
		self.assertEqual((fields["first_name"]["required"], fields["email"]["required"], fields["mobile_no"]["required"]), (1, 1, 1))

	def test_only_real_lead_fields_can_be_asked(self):
		for bad in ("not_a_field", "lead_owner", "status"):
			with self.assertRaises(frappe.ValidationError):
				leadforms.clean_fields([{"fieldname": bad}])
		rows = leadforms.clean_fields([{"fieldname": "email", "required": 0}])
		names = [r["fieldname"] for r in rows]
		self.assertIn("first_name", names)
		self.assertIn("mobile_no", names)

	def test_the_catalog_never_offers_owner_status_or_source(self):
		names = {f["fieldname"] for f in leadforms.catalog()}
		for protected in ("lead_owner", "status", "source"):
			self.assertNotIn(protected, names)
		self.assertTrue({"first_name", "email", "mobile_no"} <= names)

	def test_a_submission_creates_a_lead_and_a_log_entry(self):
		with self.assertRaises(frappe.ValidationError):  # too fast: the timer token is fresh
			leadforms.submit(self.slug, answers=json.dumps(answers()), form_token=spam.make_form_token(leadforms.TOKEN_NS + self.slug))
		self.submit(utm=json.dumps({"utm_source": "google", "utm_campaign": "spring", "first_touch": {"utm_source": "newsletter"}}), landing_url="https://x.example/p", referrer="https://g.example")
		lead = frappe.db.get_value("CRM Lead", {"email": "asha.rao.lf@example.org"}, ["name", "mobile_no"], as_dict=True)
		self.assertTrue(lead)
		self.assertEqual(lead.mobile_no, "+919812367045")
		e = frappe.get_all(ENTRY, filters={"form": self.slug}, fields=["result", "lead", "utm_source", "utm_campaign", "landing_url", "referrer", "first_touch"])[0]
		self.assertEqual((e.result, e.lead, e.utm_source, e.utm_campaign), ("Created", lead.name, "google", "spring"))
		self.assertIn("newsletter", e.first_touch)

	def test_phone_and_email_can_be_optional_but_not_both_empty(self):
		self.form.fields_json = leadforms.dump_fields(leadforms.clean_fields([{"fieldname": "first_name"}, {"fieldname": "email", "required": 0}, {"fieldname": "mobile_no", "required": 0}]))
		self.form.save(ignore_permissions=True)
		self.submit(values={"first_name": "Only", "email": "only.lf@example.org"})
		self.assertTrue(frappe.db.exists("CRM Lead", {"email": "only.lf@example.org"}))
		with self.assertRaises(frappe.ValidationError):
			self.submit(values={"first_name": "Nobody"})

	def test_required_phone_is_enforced_by_default(self):
		with self.assertRaises(frappe.ValidationError):
			self.submit(values=answers(mobile_no=""))

	def test_the_same_email_or_phone_never_creates_a_second_lead_and_the_lead_gets_a_note(self):
		self.submit()
		first = frappe.db.get_value("CRM Lead", {"email": "asha.rao.lf@example.org"}, "name")
		before = frappe.db.count("CRM Lead")
		self.submit(values=answers(email="other.lf@example.org", last_name="Changed"))  # same phone
		self.submit(values=answers(mobile_no="9123450876"))  # same email
		self.assertEqual(frappe.db.count("CRM Lead"), before)
		dups = frappe.get_all(ENTRY, filters={"form": self.slug, "result": "Duplicate"}, fields=["name", "lead", "matched_by", "comment", "applied"], order_by="creation asc")
		self.assertEqual([(d.lead, d.matched_by) for d in dups], [(first, "phone"), (first, "email")])
		self.assertTrue(all(d.comment and frappe.db.exists("Comment", d.comment) for d in dups))
		self.assertEqual(set(leadforms.entries_for_lead(first)), {d.comment for d in dups})

	def test_update_details_applies_only_what_was_shared_once(self):
		self.submit()
		lead = frappe.db.get_value("CRM Lead", {"email": "asha.rao.lf@example.org"}, "name")
		frappe.db.set_value("CRM Lead", lead, "last_name", "Old")
		self.submit(values={"first_name": "Asha", "email": "asha.rao.lf@example.org", "mobile_no": "9812367045", "last_name": "Newname"})
		entry = frappe.get_all(ENTRY, filters={"form": self.slug, "result": "Duplicate"}, pluck="name")[0]
		changed = leadforms.apply_entry(entry, lead)
		self.assertEqual(changed, ["Last Name"])
		self.assertEqual(frappe.db.get_value("CRM Lead", lead, "last_name"), "Newname")
		with self.assertRaises(frappe.ValidationError):
			leadforms.apply_entry(entry, lead)
		with self.assertRaises(frappe.ValidationError):
			leadforms.apply_entry(entry, "no-such-lead")

	def test_the_hidden_field_is_logged_as_blocked_and_creates_nothing(self):
		self.submit(hp="http://spam.example")
		self.assertFalse(frappe.db.exists("CRM Lead", {"email": "asha.rao.lf@example.org"}))
		self.assertEqual(frappe.db.count(ENTRY, {"form": self.slug, "result": "Blocked"}), 1)

	def test_an_unknown_or_switched_off_form_is_not_available(self):
		self.form.enabled = 0
		self.form.save(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			leadforms.get_public_form(self.slug)

	def test_a_specific_person_gets_the_lead(self):
		self.form.assignment_mode = "Specific person"
		self.form.assign_to = "Administrator"
		self.form.save(ignore_permissions=True)
		self.submit()
		self.assertEqual(frappe.db.get_value("CRM Lead", {"email": "asha.rao.lf@example.org"}, "lead_owner"), "Administrator")

	def test_stats_count_what_came_in(self):
		self.submit()
		self.submit()
		stats = leadforms.form_stats(30, self.slug)
		self.assertEqual((stats["totals"]["Created"], stats["totals"]["Duplicate"]), (1, 1))
