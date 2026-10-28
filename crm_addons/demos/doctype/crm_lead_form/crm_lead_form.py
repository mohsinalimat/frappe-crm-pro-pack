# Copyright (c) 2026, Siddharth Singh
# For use in Frappe CRM.

import json
import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr

from crm_addons.demos import leadform_messages, leadforms
from crm_addons.demos.framing import ORIGIN_RE
from crm_addons.demos.common import RESERVED_SLUGS, SLUG_RE

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class CRMLeadForm(Document):
	def before_naming(self):
		self.slug = cstr(self.slug).strip().lower()  # the slug is the name of the record and the address of the page

	def validate(self):
		if not SLUG_RE.match(cstr(self.slug)) or self.slug in RESERVED_SLUGS:
			frappe.throw(_("The address can only use letters, numbers and dashes, and must not be a reserved word."))
		if self.accent_color and not HEX.match(self.accent_color):
			frappe.throw(_("The accent colour must look like #2563eb."))
		if self.redirect_url and not re.match(r"^https://[^\s]+$", self.redirect_url):
			frappe.throw(_("The thank-you redirect must be a full https:// address."))
		if self.assignment_mode == "Specific person" and not self.assign_to:
			frappe.throw(_("Choose who new leads go to."))
		if self.assignment_mode != "Specific person":
			self.assign_to = None
		origins = [o.strip().rstrip("/") for o in cstr(self.allowed_origins).replace(",", "\n").splitlines() if o.strip()]
		if any(not ORIGIN_RE.match(o) for o in origins):
			frappe.throw(_("Allowed websites: one per line, like https://www.example.com (no path)."))
		self.allowed_origins = "\n".join(dict.fromkeys(origins))
		self.messages_json = json.dumps(leadform_messages.clean_messages(self.messages_json))
		self.fields_json = leadforms.dump_fields(leadforms.clean_fields(self.fields_json))
