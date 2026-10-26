# Copyright (c) 2026, Siddharth Singh
# For use in Frappe CRM.

import json

import frappe
from frappe.model.document import Document

from crm_addons.team_access import access
from crm_addons.team_access.doctype.crm_access_preset.crm_access_preset import clean_grants


class CRMUserAccess(Document):
	def validate(self):
		self.overrides = json.dumps(clean_grants(self.overrides), sort_keys=True)

	def on_update(self):
		access.clear()

	def on_trash(self):
		access.clear()
