# Copyright (c) 2026, Siddharth Singh
from frappe.model.document import Document

from crm_addons import assignment


class CRMAssignmentRule(Document):
	def validate(self):
		assignment.validate_rule(self)
