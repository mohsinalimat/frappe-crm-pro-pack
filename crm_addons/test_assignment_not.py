"""Negative conditions in assignment rules ("is not", "is not any of", "does not contain")."""

import frappe

from crm_addons import assignment
from crm_addons.team_access.test_access import AccessCase


class TestNegativeConditions(AccessCase):
	def make(self, tag, state):
		doc = frappe.get_doc({"doctype": "CRM Lead", "first_name": f"Neg {tag}", "organization": state} if state is not None else {"doctype": "CRM Lead", "first_name": f"Neg {tag}"}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", doc.name, force=True, ignore_permissions=True)
		return doc.name

	def matches(self, rule, lead):
		return assignment.rule_matches(rule, lead)

	def test_is_not_excludes_exactly_the_named_value(self):
		school, school_lower, college, empty = self.make("a", "School"), self.make("b", "school"), self.make("c", "College"), self.make("d", None)
		rule = {"match_mode": "All conditions", "conditions": [["organization", "!=", "School"]]}
		self.assertFalse(self.matches(rule, school))
		self.assertFalse(self.matches(rule, school_lower))  # not case sensitive, like the rest of CRM's filters
		self.assertTrue(self.matches(rule, college))
		self.assertTrue(self.matches(rule, empty))  # a lead with nothing there is "not School"

	def test_is_not_any_of_and_does_not_contain(self):
		a, b, c = self.make("e", "School"), self.make("f", "Junior School"), self.make("g", "College")
		not_in = {"match_mode": "All conditions", "conditions": [["organization", "not in", "School, University"]]}
		self.assertFalse(self.matches(not_in, a))
		self.assertTrue(self.matches(not_in, b))
		self.assertTrue(self.matches(not_in, c))
		not_like = {"match_mode": "All conditions", "conditions": [["organization", "not like", "%School%"]]}
		self.assertFalse(self.matches(not_like, a))
		self.assertFalse(self.matches(not_like, b))
		self.assertTrue(self.matches(not_like, c))

	def test_a_value_typed_with_spaces_still_matches_the_same_word(self):
		a, c = self.make("h", "School"), self.make("i", "College")
		rule = {"match_mode": "All conditions", "conditions": [["organization", "!=", "  School "]]}
		self.assertFalse(self.matches(rule, a))
		self.assertTrue(self.matches(rule, c))

	def test_any_condition_mode_with_a_negative_part(self):
		a, c = self.make("j", "School"), self.make("k", "College")
		rule = {"match_mode": "Any condition", "conditions": [["organization", "!=", "School"], ["organization", "=", "Nowhere"]]}
		self.assertFalse(self.matches(rule, a))
		self.assertTrue(self.matches(rule, c))


class TestLinkFieldValues(AccessCase):
	def test_link_field_values_list_the_records_of_crm_not_just_ten(self):
		from crm_addons.campaigns import api

		field = next((f for f in frappe.get_meta("CRM Lead").fields if f.fieldtype == "Link" and f.options in ("CRM Lead Source", "CRM Territory", "CRM Industry")), None)
		if not field:
			self.skipTest("no Link field on this site's Lead")
		names = []
		for i in range(14):
			n = f"zz-link-{i:02d}"
			if not frappe.db.exists(field.options, n):
				key = {"CRM Lead Source": "source_name", "CRM Territory": "territory_name", "CRM Industry": "industry"}[field.options]
				frappe.get_doc({"doctype": field.options, key: n}).insert(ignore_permissions=True)
				self.addCleanup(frappe.delete_doc, field.options, n, force=True, ignore_permissions=True)
			names.append(n)
		out = [r["value"] for r in api.search_field_values(field.fieldname, "", 200)]
		self.assertTrue(set(names) <= set(out), "all values are offered, not only the first ten")
		self.assertTrue(all(r["value"] for r in api.search_field_values(field.fieldname, "zz-link-0", 50)))
