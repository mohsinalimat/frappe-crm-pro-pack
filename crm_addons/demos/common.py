"""Shared constants and helpers for demo booking.

Time conventions (also in docs/DEMO_BOOKING.md): ``starts_utc`` is a naive UTC datetime; ``starts_on`` / ``ends_on`` and the message
``due_at`` / ``sent_at`` are naive datetimes in the site time zone, exactly like CRM Meeting. Everything that compares moments converts to UTC first.
"""

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_url

from crm_addons.campaigns.common import valid_timezone
from crm_addons.utils import system_timezone

DEMO_TYPE = "CRM Demo Type"
BOOKING = "CRM Demo Booking"
MESSAGE = "CRM Demo Booking Message"
LEAD = "CRM Lead"

ACTIVE = ("Confirmed", "Rescheduled")  # statuses that hold a slot
RESERVED_SLUGS = ("manage", "embed", "api")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid")


class DemoError(frappe.ValidationError):
	"""A refusal with a machine-readable ``code`` the booking page can act on (see docs/DEMO_BOOKING.md)."""

	code = "error"


def fail(code, message):
	"""Throw a friendly message and put ``code`` in the JSON error body."""
	frappe.local.response["code"] = code
	try:
		frappe.throw(message, DemoError)
	except DemoError as err:
		err.code = code
		raise


def utcnow():
	"""Naive UTC 'now'. A function so tests can freeze it."""
	return datetime.now(timezone.utc).replace(tzinfo=None)


def as_utc(naive_utc):
	return naive_utc.replace(tzinfo=timezone.utc)


def site_tz():
	return ZoneInfo(system_timezone())


def to_site(naive_utc):
	"""Naive UTC -> naive site-time (what CRM Meeting stores)."""
	return as_utc(naive_utc).astimezone(site_tz()).replace(tzinfo=None)


def from_site(naive_site):
	"""Naive site-time -> naive UTC."""
	return naive_site.replace(tzinfo=site_tz()).astimezone(timezone.utc).replace(tzinfo=None)


def zone(name, fallback=None):
	"""A ZoneInfo for ``name``; the fallback (or the site zone) when it is empty or unknown."""
	if name and valid_timezone(name):
		return ZoneInfo(name)
	if fallback:
		return zone(fallback)
	return site_tz()


def site_now():
	"""'Now' as a naive site-time datetime, from the same clock as ``utcnow`` (so one patch moves every comparison)."""
	return to_site(utcnow())


def iso_z(naive_utc):
	return naive_utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_start(value):
	"""'2026-11-03T04:30:00Z' (or with an offset) -> naive UTC datetime. Raises a friendly error."""
	try:
		text = cstr(value).strip().replace(" ", "T")
		dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
	except ValueError:
		fail("slot_taken", _("That time is not available any more. Please pick another."))
	if dt.tzinfo is None:
		dt = dt.replace(tzinfo=timezone.utc)
	return dt.astimezone(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)


def local_time_label(naive_utc, tz):
	"""'4:30 PM' in the visitor's zone."""
	local = as_utc(naive_utc).astimezone(tz)
	return local.strftime("%I:%M %p").lstrip("0")


def public_url(slug):
	return get_url(f"/book/{slug}")


def manage_url(token, action=None):
	url = get_url(f"/book/manage/{token}")
	return f"{url}?action={action}" if action else url


def full_name(user):
	return (frappe.db.get_value("User", user, "full_name") if user else "") or user or ""


def minutes_label(minutes):
	"""1440 -> "24 hours", 60 -> "1 hour", 30 -> "30 minutes"."""
	minutes = int(minutes or 0)
	if minutes and minutes % 1440 == 0:
		n = minutes // 1440
		return f"{n} day" + ("" if n == 1 else "s")
	if minutes and minutes % 60 == 0:
		n = minutes // 60
		return f"{n} hour" + ("" if n == 1 else "s")
	return f"{minutes} minutes"


def owners_of(demo, enabled_only=True):
	"""The owners' user names in the order the admin gave them."""
	users = [row.user for row in demo.get("owners") or [] if row.user]
	if enabled_only and users:
		on = set(frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name"))
		users = [u for u in users if u in on]
	return users


def brand_of(demo):
	"""What the booking page needs to dress itself."""
	return {
		"name": demo.get("brand_name") or demo.get("title"),
		"logo_url": demo.get("logo") or "",
		"accent": demo.get("accent_color") or "",
		"theme": (demo.get("theme") or "Auto").lower(),
		"heading": demo.get("heading") or demo.get("title"),
		"button_text": demo.get("button_text") or _("Confirm booking"),
		"footer_text": demo.get("footer_text") or "",
		"success_title": demo.get("success_title") or _("You are booked"),
		"success_text": demo.get("success_text") or "",
		"redirect_url": demo.get("redirect_url") or "",
	}


def get_demo_by_slug(slug, must_be_enabled=True):
	"""The CRM Demo Type for a slug, or a friendly not-found error."""
	slug = cstr(slug).strip().lower()
	if not slug or not SLUG_RE.match(slug) or not frappe.db.exists(DEMO_TYPE, slug):
		fail("not_found", _("This booking page is not available."))
	demo = frappe.get_cached_doc(DEMO_TYPE, slug)
	if must_be_enabled and not cint(demo.enabled):
		fail("unavailable", _("This booking page is not available."))
	return demo


def minutes(value, default):
	value = cint(value)
	return value if value > 0 else default


# -- fields a widget can set on the leads it creates ----------------------------------------------------------------------------

_DEFAULT_TYPES = ("Data", "Select", "Link", "Check", "Int", "Float", "Small Text", "Text", "Autocomplete", "Percent", "Currency")
_NOT_DEFAULTS = {
	"first_name", "last_name", "lead_name", "salutation", "email", "mobile_no", "phone", "lead_owner", "owner", "name", "converted", "status", "source",
	"converted_by", "sla", "sla_creation", "response_by", "first_response_time", "first_responded_on", "communication_status", "modified_by", "creation",
}


def lead_default_choices():
	"""The Lead fields a widget may set on the leads it creates: [{fieldname, label, fieldtype, options}]. The visitor's own details, the owner,
	the source and the status have their own settings and are not offered."""
	from crm_addons.campaigns import personalization

	return [
		f for f in personalization.lead_fields()
		if f["fieldtype"] in _DEFAULT_TYPES and f["fieldname"] not in _NOT_DEFAULTS and not f["fieldname"].startswith("crm_")
	]


def clean_lead_defaults(raw):
	"""[{field, value}] from a JSON string or list: only real, allowed Lead fields, each value checked against the field (a Select's options, an existing
	Link record, a number). Raises a plain message for anything that would not save on a lead."""
	import json

	if raw in (None, "", []):
		return []
	try:
		rows = json.loads(raw) if isinstance(raw, str) else list(raw)
	except ValueError:
		frappe.throw(_("The lead field settings are not valid."))
	choices = {f["fieldname"]: f for f in lead_default_choices()}
	out, seen = [], set()
	for row in rows[:25]:
		field = cstr((row or {}).get("field")).strip()
		if not field:
			continue
		if field not in choices:
			frappe.throw(_("{0} cannot be set from a widget.").format(frappe.bold(field)))
		if field in seen:
			continue
		seen.add(field)
		f, value = choices[field], (row or {}).get("value")
		kind = f["fieldtype"]
		if kind == "Check":
			value = 1 if cint(value) else 0
		elif kind in ("Int",):
			value = cint(value)
		elif kind in ("Float", "Percent", "Currency"):
			value = flt(value)
		else:
			value = cstr(value).strip()
			if value == "":
				continue
			if kind == "Select":
				allowed = [o.strip() for o in cstr(f["options"]).split("\n") if o.strip()]
				if allowed and value not in allowed:
					frappe.throw(_("{0}: {1} is not one of its options.").format(frappe.bold(f["label"]), frappe.bold(value)))
			elif kind == "Link" and f["options"] and not frappe.db.exists(f["options"], value):
				frappe.throw(_("{0}: {1} does not exist.").format(frappe.bold(f["label"]), frappe.bold(value)))
			else:
				value = value[:500]
		out.append({"field": field, "value": value})
	return out
