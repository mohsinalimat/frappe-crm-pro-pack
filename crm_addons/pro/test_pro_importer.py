"""Bringing leads in from a sheet."""

import base64
import io
import json

import frappe
import openpyxl

from crm_addons.pro import importer
from crm_addons.team_access.test_access import AccessCase


class TestImporter(AccessCase):
	def _xlsx(self, rows):
		wb = openpyxl.Workbook()
		for r in rows:
			wb.active.append(r)
		buf = io.BytesIO()
		wb.save(buf)
		return base64.b64encode(buf.getvalue()).decode()

	def test_reads_csv_and_excel(self):
		frappe.set_user("Administrator")
		csv_b64 = base64.b64encode(b"Name,Email\nAnn,a@example.com\n").decode()
		r = importer.read_sheet("file", csv_b64, "x.csv")
		self.assertEqual((r["headers"], r["total"]), (["Name", "Email"], 1))
		r = importer.read_sheet("file", self._xlsx([["Name", "Phone"], ["Bob", 919800000000]]), "x.xlsx")
		self.assertEqual(r["rows"], [["Bob", "919800000000"]])

	def test_refuses_wrong_files_and_links(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			importer.read_sheet("file", base64.b64encode(b"x").decode(), "x.pdf")
		with self.assertRaises(frappe.ValidationError):
			importer.read_sheet("sheet", url="https://evil.example.com/spreadsheets/d/" + "a" * 30)
		with self.assertRaises(frappe.ValidationError):
			importer.read_sheet("sheet", url="https://docs.google.com/document/d/abc")

	def test_mapping_guess_then_check_then_add(self):
		frappe.set_user("Administrator")
		m = importer.suggest_mapping(json.dumps(["Name", "E-mail", "Mobile", "Mystery"]))
		self.assertEqual(m["mapping"], ["first_name", "email", "mobile_no", ""])
		rows = [["Zq Imp One", "zq.imp1@example.com", "+919800000001", "x"], ["", "zq.imp2@example.com", "", ""]]
		check = importer.add_rows(json.dumps(m["mapping"]), json.dumps(rows), 1, 2)
		self.assertEqual(check["created"], 1)
		self.assertEqual(check["failed"][0]["row"], 3)
		self.assertFalse(frappe.db.exists("CRM Lead", {"email": "zq.imp1@example.com"}))
		both = importer.add_rows(json.dumps(m["mapping"]), json.dumps([["Zq Imp Two", "zq.imp3@example.com", "", ""], ["", "x@example.com", "", ""]]), 0, 2)
		self.assertEqual(both["created"], 1)  # the failed second row must not undo the first
		kept = frappe.db.get_value("CRM Lead", {"email": "zq.imp3@example.com"})
		self.assertTrue(kept)
		self.addCleanup(frappe.delete_doc, "CRM Lead", kept, force=True, ignore_permissions=True)
		real = importer.add_rows(json.dumps(m["mapping"]), json.dumps(rows[:1]), 0, 2)
		self.assertEqual(real["created"], 1)
		name = frappe.db.get_value("CRM Lead", {"email": "zq.imp1@example.com"})
		self.assertTrue(name)
		self.addCleanup(frappe.delete_doc, "CRM Lead", name, force=True, ignore_permissions=True)

	def test_mapping_must_be_sound(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			importer.add_rows(json.dumps(["email", "email"]), json.dumps([["a", "b"]]), 1)
		with self.assertRaises(frappe.ValidationError):
			importer.add_rows(json.dumps(["creation"]), json.dumps([["a"]]), 1)

	def test_guest_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			importer.read_sheet("file", "", "x.csv")
