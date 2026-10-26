# Copyright (c) 2026, Siddharth Singh
# For use in Frappe CRM.

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, validate_email_address

from crm_addons.campaigns.common import valid_timezone
from crm_addons.demos.common import BOOKING, RESERVED_SLUGS, SLUG_RE, WEEKDAYS
from crm_addons.demos.framing import ORIGIN_RE
from crm_addons.demos.slots import _to_time

CORE_FIELDS = [
	# key, label, kind, required
	("name", "Full name", "Text", 1),
	("email", "Email", "Email", 1),
	("phone", "Phone / WhatsApp number", "Phone", 1),
]
OPTIONAL_FIELDS = [
	("organization", "School / company", "Text", 0),
	("notes", "Anything we should know?", "Long Text", 0),
]
DEFAULT_REMINDERS = (1440, 60, 30, 0)  # minutes before the demo; the last is the start time itself


class CRMDemoType(Document):
	def before_naming(self):
		self.slug = cstr(self.slug).strip().lower()  # the slug is the name of the record

	def before_validate(self):
		if self.is_new():
			self.seed_defaults()

	def seed_defaults(self):
		"""A new demo type starts with sensible hours, the usual form and the message rules (ready-made templates are chosen where they exist)."""
		if not self.hours:
			for day in WEEKDAYS[:5]:
				self.append("hours", {"weekday": day, "from_time": "10:00:00", "to_time": "18:00:00"})
		if not self.fields:
			for key, label, kind, required in CORE_FIELDS + OPTIONAL_FIELDS:
				self.append("fields", {"key": key, "label": label, "kind": kind, "required": required, "enabled": 1})
		if not self.messages:
			for event in ("Confirmed", "Rescheduled", "Cancelled"):
				self.append("messages", {"event": event})
			for minutes in DEFAULT_REMINDERS:
				self.append("messages", {"event": "Reminder", "minutes_before": minutes})
			self.use_default_messages()  # only when the rules were not sent by the caller: what a caller sends is kept as it is
		if not self.consent_text:
			self.consent_text = _("Send me updates about this demo on WhatsApp.")

	def use_default_messages(self):
		"""Fill the rules that have no template yet with the ready-made ones (demos/defaults.py): the email template from the
		library, and a WhatsApp template only when Meta has approved the default one on this site. Never overwrites a choice."""
		import json

		from crm_addons.demos import defaults

		approved = {}
		if frappe.db.exists("DocType", "WhatsApp Templates"):
			for r in frappe.get_all("WhatsApp Templates", filters={"status": "APPROVED"}, fields=["name", "actual_name", "template_name", "whatsapp_account"]):
				approved[cstr(r.actual_name or r.template_name).lower()] = r
		for row in self.messages:
			key = defaults.key_of(row.event, row.minutes_before)
			email = defaults.EMAIL.get(key)
			if email and not row.email_template and frappe.db.exists("CRM Campaign Email Template", email):
				row.send_email, row.email_template = 1, email
			spec = defaults.WHATSAPP.get(key)
			wa = approved.get(spec["template_name"]) if spec else None
			if wa and not row.wa_template:
				row.send_whatsapp, row.wa_template, row.wa_account = 1, wa.name, wa.whatsapp_account or ""
				row.wa_variables = json.dumps(spec["variable_map"])

	def validate(self):
		self.slug = cstr(self.slug).strip().lower()
		self.title = cstr(self.title).strip()
		if not SLUG_RE.match(self.slug) or self.slug in RESERVED_SLUGS:
			frappe.throw(_("The slug must be 3 to 60 lower-case letters, numbers or dashes, and cannot be one of: {0}.").format(", ".join(RESERVED_SLUGS)))
		self.validate_numbers()
		self.validate_team()
		self.validate_availability()
		self.validate_form()
		self.validate_messages()
		self.validate_branding()

	def validate_numbers(self):
		self.duration_minutes = cint(self.duration_minutes) or 30
		if not 5 <= self.duration_minutes <= 480:
			frappe.throw(_("The duration must be between 5 minutes and 8 hours."))
		self.slot_interval_minutes = cint(self.slot_interval_minutes) or self.duration_minutes
		if not 5 <= self.slot_interval_minutes <= 480:
			frappe.throw(_("The slot interval must be between 5 minutes and 8 hours."))
		for field in ("buffer_before_minutes", "buffer_after_minutes", "min_notice_hours", "max_per_day", "max_active_per_contact", "max_per_ip_per_hour"):
			if cint(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(self.meta.get_label(field)))
		self.max_days_ahead = cint(self.max_days_ahead) or 30
		if not 1 <= self.max_days_ahead <= 365:
			frappe.throw(_("Days ahead must be between 1 and 365."))
		self.timezone = cstr(self.timezone).strip()
		if self.timezone and not valid_timezone(self.timezone):
			frappe.throw(_("{0} is not a time zone name. Use a name such as Asia/Kolkata.").format(self.timezone))

	def validate_team(self):
		seen = []
		for row in list(self.owners):
			if row.user in seen:
				self.remove(row)
			else:
				seen.append(row.user)
		if cint(self.enabled) and not seen:
			frappe.throw(_("Choose at least one owner for the demos."))
		for user in seen:
			if not frappe.db.get_value("User", user, "enabled"):
				frappe.throw(_("{0} is not an active user.").format(user))
		for row in list(self.cc):
			row.email = cstr(row.email).strip().lower()
			if not row.user and not row.email:
				self.remove(row)
			elif not row.user and not validate_email_address(row.email):
				frappe.throw(_("{0} is not a valid email address.").format(row.email))

	def validate_availability(self):
		for row in self.hours:
			start, end = _to_time(row.from_time), _to_time(row.to_time)
			if not start or not end or end <= start:
				frappe.throw(_("Row {0} of the weekly hours: the end time must be after the start time.").format(row.idx))
		for row in self.overrides:
			if row.kind == "Custom hours":
				start, end = _to_time(row.from_time), _to_time(row.to_time)
				if not start or not end or end <= start:
					frappe.throw(_("Row {0} of the date overrides: custom hours need a start time and a later end time.").format(row.idx))

	def validate_form(self):
		keys = []
		for row in self.fields:
			row.key = cstr(row.key).strip().lower()
			if not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", row.key):
				frappe.throw(_("Form field keys use lower-case letters, numbers and underscores, and start with a letter ({0}).").format(row.key))
			if row.key in keys:
				frappe.throw(_("The form field key {0} is used twice.").format(row.key))
			keys.append(row.key)
			if row.lead_field and not frappe.get_meta("CRM Lead").has_field(row.lead_field):
				frappe.throw(_("{0} is not a field of CRM Lead.").format(row.lead_field))
		# name, email and phone always exist, are always asked for and cannot be switched off
		for key, label, kind, _required in CORE_FIELDS:
			row = next((r for r in self.fields if r.key == key), None)
			if not row:
				self.append("fields", {"key": key, "label": label, "kind": kind, "required": 1, "enabled": 1})
			else:
				row.enabled, row.required, row.kind = 1, 1, kind

	def validate_messages(self):
		seen = set()
		for row in self.messages:
			if row.event == "Reminder":
				row.minutes_before = max(0, cint(row.minutes_before))
				mark = ("Reminder", row.minutes_before)
				if mark in seen:
					frappe.throw(_("There are two reminders for {0} minutes before.").format(row.minutes_before))
				seen.add(mark)
			else:
				row.minutes_before = 0
				if row.event in seen:
					frappe.throw(_("There are two rules for {0}. Use one rule with email and WhatsApp.").format(row.event))
				seen.add(row.event)
			if cint(row.send_email) and not row.email_template:
				frappe.throw(_("Row {0} of the messages: choose an email template or switch email off.").format(row.idx))
			if cint(row.send_whatsapp) and not row.wa_template:
				frappe.throw(_("Row {0} of the messages: choose a WhatsApp template or switch WhatsApp off.").format(row.idx))
			if row.wa_variables:
				from crm_addons.campaigns import personalization

				personalization.parse_variable_map(row.wa_variables)
				unknown = personalization.unknown_variables(*personalization.parse_variable_map(row.wa_variables).values())
				if unknown:
					frappe.throw(_("Row {0} of the messages: unknown variable(s) {1}.").format(row.idx, ", ".join(unknown)))

	def validate_branding(self):
		if self.accent_color and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", self.accent_color.strip()):
			frappe.throw(_("The accent colour must look like #2563eb."))
		for field in ("manual_link", "redirect_url"):
			value = cstr(self.get(field)).strip()
			if value and not re.match(r"^https?://", value, re.I):
				frappe.throw(_("{0} must start with http:// or https://").format(self.meta.get_label(field)))
			self.set(field, value)
		if self.provider == "Manual Link" and not self.manual_link:
			frappe.throw(_("Paste the meeting link to use for a Manual Link demo."))
		lines = [x.strip().rstrip("/") for x in cstr(self.allowed_origins).replace(",", "\n").splitlines() if x.strip()]
		bad = [x for x in lines if not ORIGIN_RE.match(x)]
		if bad:
			frappe.throw(_("{0} is not a website address. Use the form https://www.example.com (no page, no trailing path).").format(bad[0]))
		self.allowed_origins = "\n".join(dict.fromkeys(lines))

	def on_trash(self):
		if frappe.db.count(BOOKING, {"demo_type": self.name}):
			frappe.throw(_("This demo type has bookings, so it cannot be deleted. Switch it off instead."))
