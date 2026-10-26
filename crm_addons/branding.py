"""Branding from A to Z in one place: the name, logo and favicon shown in the CRM, on the login page, in the Desk and in the footer.

Frappe and CRM keep these in four different settings records (CRM's own brand settings, Website Settings, Navbar Settings). The setup
page's Branding section reads and writes all of them together. An empty value means "the default look", so nothing is forced on a site that
never opens this section, and "Reset" simply empties every value this module owns. System Managers only (the caller checks).
"""

import re

import frappe
from frappe import _
from frappe.utils import cstr, strip_html

CRM = "FCRM Settings"
WEB = "Website Settings"
NAV = "Navbar Settings"

# key -> (kind, [(doctype, fieldname), ...]); the first listed place is the one the value is read from
FIELDS = {
	"name": ("text", [(CRM, "brand_name"), (WEB, "app_name")]),
	"logo": ("image", [(CRM, "brand_logo"), (WEB, "app_logo"), (NAV, "app_logo")]),
	"favicon": ("image", [(CRM, "favicon"), (WEB, "favicon")]),
	"splash": ("image", [(WEB, "splash_image")]),
	"title_prefix": ("text", [(WEB, "title_prefix")]),
	"copyright": ("text", [(WEB, "copyright")]),
	"address": ("area", [(WEB, "address")]),
	"powered": ("area", [(WEB, "footer_powered")]),
	"hide_signup": ("check", [(WEB, "hide_footer_signup")]),
	"footer_on_login": ("check", [(WEB, "show_footer_on_login")]),
}
_IMAGE = re.compile(r"^(/files/|/private/files/|/assets/|https://|http://)[^\s<>\"']{1,480}$")


def _has(doctype, fieldname):
	return frappe.db.exists("DocType", doctype) and frappe.get_meta(doctype).has_field(fieldname)


def get_branding():
	out = {}
	for key, (kind, places) in FIELDS.items():
		value = "" if kind != "check" else 0
		for doctype, fieldname in places:
			if _has(doctype, fieldname):
				got = frappe.db.get_single_value(doctype, fieldname)
				if got not in (None, ""):
					value = got
					break
		if key == "name" and value == "Frappe":  # Frappe's own default is not a name somebody chose
			value = ""
		out[key] = cint_(value) if kind == "check" else cstr(value)
	return out


def cint_(v):
	return 1 if str(v).strip() in ("1", "True", "true") or v is True else 0


def _clean(key, kind, value):
	if kind == "check":
		return cint_(value)
	value = cstr(value).strip()
	if kind == "image":
		if value and not _IMAGE.match(value):
			frappe.throw(_("{0}: use an uploaded image.").format(key))
		return value
	value = strip_html(value)
	limit = 500 if kind == "area" else 140
	if len(value) > limit:
		frappe.throw(_("{0} is too long (at most {1} characters).").format(key, limit))
	return value


def save_branding(values):
	"""Write the given keys (unknown keys are refused) to every place they belong. Returns the branding as now stored."""
	values = frappe.parse_json(values) if isinstance(values, str) else (values or {})
	unknown = [k for k in values if k not in FIELDS]
	if unknown:
		frappe.throw(_("Unknown branding setting: {0}").format(", ".join(unknown)))
	changes = {}  # doctype -> {fieldname: value}
	for key, raw in values.items():
		kind, places = FIELDS[key]
		value = _clean(key, kind, raw)
		for doctype, fieldname in places:
			if _has(doctype, fieldname):
				changes.setdefault(doctype, {})[fieldname] = value
	for doctype, fields in changes.items():
		doc = frappe.get_doc(doctype)
		doc.update(fields)
		doc.flags.ignore_permissions = True
		doc.save()
	frappe.clear_cache()
	return get_branding()


def reset_branding():
	"""Back to the default look: every value this module owns is emptied."""
	return save_branding({k: (0 if v[0] == "check" else "") for k, v in FIELDS.items()})
