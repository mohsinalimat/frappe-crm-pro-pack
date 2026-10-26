# Copyright (c) 2026, Siddharth Singh
# For use in Frappe CRM.

import secrets

import frappe
from frappe import _
from frappe.model.document import Document


class CRMDemoBooking(Document):
	def before_insert(self):
		# the secret in the confirmation link: unguessable, and never derived from anything the visitor typed
		self.token = self.token or secrets.token_urlsafe(24)

	def on_trash(self):
		# the meeting is the team's record of the demo; deleting a booking must not leave a live calendar event behind
		if self.meeting and frappe.db.exists("CRM Meeting", self.meeting):
			frappe.db.set_value("CRM Meeting", self.meeting, "demo_booking", None, update_modified=False)
