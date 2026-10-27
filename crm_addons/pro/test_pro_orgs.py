"""Organizations in the Suite Pro app."""

import json

import frappe

from crm_addons.pro import orgs
from crm_addons.team_access.test_access import AccessCase


class TestProOrgs(AccessCase):
	def test_create_update_list(self):
		frappe.set_user("Administrator")
		name = orgs.create_org(json.dumps({"organization_name": "Zq Pro Org", "website": "zq.example.com"}))
		self.addCleanup(frappe.delete_doc, "CRM Organization", name, force=True, ignore_permissions=True)
		self.assertEqual(orgs.update_org(name, json.dumps({"no_of_employees": "11-50"}))["no_of_employees"], "11-50")
		self.assertEqual(orgs.list_orgs(search="Zq Pro")["total"], 1)
		self.assertEqual(orgs.get_org(name)["leads"], 0)
		with self.assertRaises(frappe.ValidationError):
			orgs.create_org(json.dumps({"organization_name": "x", "creation": "2000-01-01"}))
		with self.assertRaises(frappe.ValidationError):
			orgs.create_org(json.dumps({"website": "no name"}))

	def test_counts_leads_that_name_the_organization(self):
		frappe.set_user("Administrator")
		name = orgs.create_org(json.dumps({"organization_name": "Zq Count Org"}))
		self.addCleanup(frappe.delete_doc, "CRM Organization", name, force=True, ignore_permissions=True)
		lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Zq", "organization": name}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Lead", lead.name, force=True, ignore_permissions=True)
		row = orgs.list_orgs(search="Zq Count")["rows"][0]
		self.assertEqual(row["leads"], 1)
		self.assertEqual(orgs.get_org(name)["leads_list"][0]["name"], lead.name)

	def test_guest_is_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			orgs.list_orgs()
