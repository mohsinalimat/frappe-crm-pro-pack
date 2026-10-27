"""Leads and the lead page of the Suite Pro app: scope, bulk changes and which fields can be edited."""

import json

import frappe

from crm_addons.pro import lead, leads
from crm_addons.team_access.test_access import AccessCase


class TestProLeads(AccessCase):
	def make_lead(self, owner=None, **kw):
		doc = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Pro", "last_name": frappe.generate_hash(length=6), "lead_owner": owner, **kw}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", doc.name, force=True, ignore_permissions=True)
		return doc

	def test_scope_mine_only_lists_my_leads(self):
		frappe.set_user("Administrator")
		mine = self.make_lead("Administrator")
		other = self.make_lead(None)
		names = {r.name for r in leads.list_leads(scope="mine", page_length=200)["rows"]}
		self.assertIn(mine.name, names)
		self.assertNotIn(other.name, names)

	def test_unassigned_filter(self):
		frappe.set_user("Administrator")
		a = self.make_lead(None)
		b = self.make_lead("Administrator")
		names = {r.name for r in leads.list_leads(filters=json.dumps({"lead_owner": ["__none__"]}), page_length=200)["rows"]}
		self.assertIn(a.name, names)
		self.assertNotIn(b.name, names)

	def test_bulk_update_status_and_owner(self):
		frappe.set_user("Administrator")
		a, b = self.make_lead(), self.make_lead()
		res = leads.bulk_update(json.dumps([a.name, b.name]), status="Contacted", owner="Administrator")
		self.assertEqual(res["done"], 2)
		self.assertEqual(frappe.db.get_value("CRM Lead", a.name, ["status", "lead_owner"]), ("Contacted", "Administrator"))
		leads.bulk_update(json.dumps([a.name]), owner="__none__")
		self.assertFalse(frappe.db.get_value("CRM Lead", a.name, "lead_owner"))

	def test_bulk_update_needs_something_to_change(self):
		with self.assertRaises(frappe.ValidationError):
			leads.bulk_update(json.dumps(["x"]))

	def test_update_lead_refuses_other_fields(self):
		frappe.set_user("Administrator")
		doc = self.make_lead()
		with self.assertRaises(frappe.ValidationError):
			lead.update_lead(doc.name, {"converted": 1})
		self.assertEqual(lead.update_lead(doc.name, {"job_title": "CTO"})["job_title"], "CTO")

	def test_notes_tasks_and_timeline(self):
		frappe.set_user("Administrator")
		doc = self.make_lead()
		lead.add_note(doc.name, "Hello", "body")
		task = lead.add_task(doc.name, "Call", "2030-01-01 10:00:00")
		lead.set_task_status(doc.name, task, "Done")
		lead.add_comment(doc.name, "hi")
		self.assertEqual(len(lead.get_notes(doc.name)), 1)
		self.assertEqual(lead.get_tasks(doc.name)[0]["status"], "Done")
		self.assertTrue(any(e["kind"] == "comment" for e in lead.get_timeline(doc.name)))
		self.addCleanup(lambda: [frappe.delete_doc(d, n, force=1, ignore_permissions=True) for d, f in (("FCRM Note", {"reference_docname": doc.name}), ("CRM Task", {"reference_docname": doc.name})) for n in frappe.get_all(d, filters=f, pluck="name")])

	def test_guest_is_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			leads.list_leads()
		with self.assertRaises(frappe.PermissionError):
			lead.get_lead("x")
