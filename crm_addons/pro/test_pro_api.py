"""The Suite Pro app's own API: notifications are always the signed-in person's own."""

import frappe

from crm_addons.pro import api
from crm_addons.team_access.test_access import AccessCase


class TestNotifications(AccessCase):
	def make(self, to_user, text, read=0, type="Assignment"):
		doc = frappe.get_doc({"doctype": "CRM Notification", "to_user": to_user, "from_user": "Administrator", "type": type, "read": read, "notification_text": text}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "CRM Notification", doc.name, force=True, ignore_permissions=True)
		return doc.name

	def setUp(self):
		super().setUp()
		self.me = self.person("pro.me@example.org", "Sales User")
		self.other = self.person("pro.other@example.org", "Sales User")
		self.addCleanup(frappe.set_user, "Administrator")

	def test_a_person_sees_only_their_own_notifications(self):
		mine = self.make(self.me, "pro-test mine")
		theirs = self.make(self.other, "pro-test theirs")
		frappe.set_user(self.me)
		out = api.list_notifications(search="pro-test")
		names = [r["name"] for r in out["rows"]]
		self.assertIn(mine, names)
		self.assertNotIn(theirs, names)

	def test_unread_filter_counts_and_marking_read(self):
		a, b = self.make(self.me, "pro-test a"), self.make(self.me, "pro-test b", read=1)
		other = self.make(self.other, "pro-test c")
		frappe.set_user(self.me)
		before = api.unread_count()
		self.assertEqual([r["name"] for r in api.list_notifications(show="unread", search="pro-test")["rows"]], [a])
		res = api.mark_read([a, other])  # somebody else's notification is ignored
		self.assertEqual(res["changed"], 1)
		self.assertEqual(api.unread_count(), before - 1)
		self.assertEqual(frappe.db.get_value("CRM Notification", other, "read"), 0)
		api.mark_read([a], 0)
		self.assertEqual(api.unread_count(), before)
		api.mark_all_read()
		self.assertEqual(api.unread_count(), 0)
		self.assertEqual(frappe.db.get_value("CRM Notification", other, "read"), 0)

	def test_a_guest_is_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			api.get_shell()
		with self.assertRaises(frappe.PermissionError):
			api.list_notifications()
