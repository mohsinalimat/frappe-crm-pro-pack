"""Leads and the lead page of the Suite Pro app: scope, bulk changes and which fields can be edited."""

import json

import frappe

from crm_addons.pro import form, lead, leads
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

	def test_create_lead_and_export(self):
		frappe.set_user("Administrator")
		name = leads.create_lead(json.dumps({"first_name": "Zq", "last_name": "=cmd", "mobile_no": "+911234567890"}))
		self.addCleanup(frappe.delete_doc, "CRM Lead", name, force=True, ignore_permissions=True)
		self.assertEqual(frappe.db.get_value("CRM Lead", name, "lead_owner"), "Administrator")
		with self.assertRaises(frappe.ValidationError):
			leads.create_lead(json.dumps({"first_name": "x", "converted": 1}))
		with self.assertRaises(frappe.ValidationError):
			leads.create_lead(json.dumps({"last_name": "no first name"}))
		res = leads.export_csv(search="Zq")
		self.assertIn("Zq", res["csv"])
		self.assertIn("+911234567890", res["csv"])  # a phone keeps its plus sign
		self.assertEqual(form.safe_cell("=SUM(A1)"), "'=SUM(A1)")
		self.assertEqual(form.safe_cell("+91 98000"), "+91 98000")

	def test_quick_filters(self):
		frappe.set_user("Administrator")
		doc = self.make_lead("Administrator", mobile_no="+911111111111")
		names = lambda f: {r.name for r in leads.list_leads(filters=json.dumps(f), page_length=200)["rows"]}  # noqa: E731
		self.assertIn(doc.name, names({"never_called": 1}))
		self.assertNotIn(doc.name, names({"has_meeting": 1}))
		self.assertNotIn(doc.name, names({"has_followup": 1}))
		self.assertIn(doc.name, names({"followup": "none"}))

	def test_board_more_pages_one_column(self):
		frappe.set_user("Administrator")
		a = self.make_lead(None, status="Contacted")
		rows = leads.board_more("Contacted", start=0, page_length=100)
		self.assertIn(a.name, {r.name for r in rows})

	def test_activity_merges_followups_and_hides_auto_comments(self):
		frappe.set_user("Administrator")
		doc = self.make_lead("Administrator")
		lead.log_followup(doc.name, json.dumps({"mode": "Call", "call_status": "Connected", "outcome": "Interested", "remark": "talked"}))
		kinds = [e["kind"] for e in lead.get_activity(doc.name)]
		self.assertIn("followup", kinds)
		self.assertFalse(any(e["kind"] == "comment" and e["text"][:1] == "\U0001F4DE" for e in lead.get_activity(doc.name)))
		self.addCleanup(lambda: [frappe.delete_doc("CRM Follow Up", n, force=1, ignore_permissions=True) for n in frappe.get_all("CRM Follow Up", filters={"reference_docname": doc.name}, pluck="name")])

	def test_activity_with_whatsapp_messages(self):
		from unittest import mock

		frappe.set_user("Administrator")
		doc = self.make_lead("Administrator")
		msgs = {"installed": True, "messages": [{"type": "Incoming", "message": "hi", "creation": "2026-01-01 10:00:00"}, {"type": "Outgoing", "message": "hello", "creation": "2026-01-01 10:01:00"}]}
		with mock.patch.object(lead, "get_whatsapp", return_value=msgs), mock.patch.object(frappe.db, "exists", return_value=True):
			titles = [e["title"] for e in lead.get_activity(doc.name) if e["kind"] == "whatsapp"]
		self.assertEqual(sorted(titles), ["WhatsApp received", "WhatsApp sent"])

	def test_bulk_edit_sets_any_writable_field(self):
		frappe.set_user("Administrator")
		a = self.make_lead(None)
		b = self.make_lead(None)
		r = leads.bulk_edit(json.dumps([a.name, b.name]), json.dumps({"job_title": "Zq Boss", "status": "Contacted"}))
		self.assertEqual(r["done"], 2)
		self.assertEqual(frappe.db.get_value("CRM Lead", a.name, ["job_title", "status"]), ("Zq Boss", "Contacted"))
		leads.bulk_edit(json.dumps([a.name]), json.dumps({"lead_owner": "__none__"}))
		self.assertFalse(frappe.db.get_value("CRM Lead", a.name, "lead_owner"))
		with self.assertRaises(frappe.ValidationError):
			leads.bulk_edit(json.dumps([a.name]), json.dumps({"creation": "2000-01-01"}))
		with self.assertRaises(frappe.ValidationError):
			leads.bulk_edit(json.dumps([a.name]), json.dumps({}))
