# Copyright (c) 2026, Siddharth Singh
# For use in Frappe CRM.

import json

import frappe
from frappe import _
from frappe.model.document import Document

from crm_addons.team_access import access
from crm_addons.team_access import registry as R


def clean_grants(value):
	"""A grants / overrides dict with only known features and valid values; raises on anything else."""
	data = json.loads(value) if isinstance(value, str) else (value or {})
	if not isinstance(data, dict):
		frappe.throw(_("The access settings are not valid."))
	out = {}
	for key, raw in data.items():
		feature = R.BY_KEY.get(key)
		if not feature:
			frappe.throw(_("Unknown access setting: {0}.").format(frappe.bold(key)))
		value = R.normalise(feature, raw)
		if value is None:
			frappe.throw(_("{0} cannot be {1}.").format(frappe.bold(feature["label"]), frappe.bold(str(raw))))
		out[key] = value
	return out


class CRMAccessPreset(Document):
	def validate(self):
		self.preset_name = (self.preset_name or "").strip()
		self.grants = json.dumps(clean_grants(self.grants), sort_keys=True)

	def on_update(self):
		access.clear()

	def on_trash(self):
		if frappe.db.exists("CRM User Access", {"preset": self.name}):
			frappe.throw(_("Some people use this preset. Give them another one first."))
		access.clear()
