"""Sending an email template / WhatsApp template to picked leads: who is skipped, what is refused and what the report shows."""

import json
from unittest import mock

import frappe

from crm_addons.pro import bulk_send
from crm_addons.team_access.test_access import AccessCase


class TestBulkSend(AccessCase):
	def make_lead(self, **kw):
		doc = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Bulk", "last_name": frappe.generate_hash(length=6), **kw}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", doc.name, force=True, ignore_permissions=True)
		return doc

	def make_template(self):
		doc = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "Zq bulk " + frappe.generate_hash(length=5), "subject": "Hi {{ first_name }}", "body_html": "<p>Hello {{ first_name }}</p>", "enabled": 1}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Campaign Email Template", doc.name, force=True, ignore_permissions=True)
		return doc

	def run_email(self, names, tpl, queue=None, opted=False, batch=None):
		with mock.patch.object(bulk_send, "email_account_problem", return_value=""), mock.patch.object(bulk_send.channels, "queue_email") as q, mock.patch.object(bulk_send.optout, "is_opted_out", return_value=opted):
			res = bulk_send.send_email(json.dumps(names), tpl.name, batch=batch)
		return res, q

	def test_email_sends_the_template_to_leads_with_an_address_only(self):
		frappe.set_user("Administrator")
		a, b, tpl = self.make_lead(email="zq.bulk@example.com"), self.make_lead(), self.make_template()
		res, q = self.run_email([a.name, b.name], tpl, batch="zqb1")
		self.addCleanup(lambda: frappe.db.delete("CRM Bulk Send", {"batch": "zqb1"}))
		self.assertEqual(res["sent"], 1)
		self.assertEqual([s["name"] for s in res["skipped"]], [b.name])
		args = q.call_args.args
		self.assertEqual((args[0], args[1]), ("zq.bulk@example.com", "Hi Bulk"))
		self.assertIn("Hello Bulk", args[2])

	def test_only_a_template_can_be_sent(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			bulk_send.send_email(json.dumps(["x"]), "not a template")
		with self.assertRaises(frappe.ValidationError):
			bulk_send.send_email(json.dumps(["x"]), "")
		with self.assertRaises(TypeError):
			bulk_send.send_email(json.dumps(["x"]), "t", subject="free text")

	def test_opted_out_skipped_and_report_keeps_the_send(self):
		frappe.set_user("Administrator")
		a, tpl = self.make_lead(email="zq.out@example.com"), self.make_template()
		self.addCleanup(lambda: frappe.db.delete("CRM Bulk Send", {"batch": "zqb2"}))
		res, q = self.run_email([a.name], tpl, opted=True, batch="zqb2")
		self.assertEqual(res["sent"], 0)
		self.assertEqual(res["skipped"][0]["reason"], "Opted out")
		q.assert_not_called()
		rep = bulk_send.get_report()
		row = next(r for r in rep["rows"] if r["template"] == tpl.name)
		self.assertEqual((row["channel"], row["sent"], row["skipped"]), ("Email", 0, 1))
		self.assertEqual(row["skipped_rows"][0]["lead"], a.name)

	def test_chunks_of_one_send_share_a_report_row(self):
		frappe.set_user("Administrator")
		a, b, tpl = self.make_lead(email="zq.c1@example.com"), self.make_lead(email="zq.c2@example.com"), self.make_template()
		self.addCleanup(lambda: frappe.db.delete("CRM Bulk Send", {"batch": "zqb3"}))
		self.run_email([a.name], tpl, batch="zqb3")
		self.run_email([b.name], tpl, batch="zqb3")
		self.assertEqual(frappe.db.count("CRM Bulk Send", {"batch": "zqb3"}), 1)
		self.assertEqual(frappe.db.get_value("CRM Bulk Send", {"batch": "zqb3"}, "sent"), 2)

	def test_guest_is_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			bulk_send.options()
		with self.assertRaises(frappe.PermissionError):
			bulk_send.get_report()

	def test_whatsapp_needs_a_ready_template(self):
		frappe.set_user("Administrator")
		a = self.make_lead(mobile_no="+911234567890")
		with mock.patch.object(bulk_send, "whatsapp_installed", return_value=False):
			with self.assertRaises(frappe.ValidationError):
				bulk_send.send_whatsapp(json.dumps([a.name]), "nope")

	def test_options_lists_templates(self):
		frappe.set_user("Administrator")
		tpl = self.make_template()
		opts = bulk_send.options()
		self.assertIn(tpl.name, [t["name"] for t in opts["email"]["templates"]])
