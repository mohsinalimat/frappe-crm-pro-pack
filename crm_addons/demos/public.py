"""The guest API behind the booking page (``/book/<slug>``): what the page shows, free slots, and book / move / cancel with the secret token
from the confirmation. Nothing here reveals another visitor's booking: every booking is reached only through its own unguessable token."""

import hmac
import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, cstr

from crm_addons.demos import booking, common, slots, spam
from crm_addons.demos.common import BOOKING, DEMO_TYPE, as_utc, fail

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def _json(value, default):
	if value in (None, ""):
		return default
	if isinstance(value, (dict, list)):
		return value
	try:
		return frappe.parse_json(value)
	except Exception:
		return default


def _booking_by_token(token):
	token = cstr(token).strip()
	row = frappe.db.get_value(BOOKING, {"token": token}, ["name", "token"], as_dict=True) if TOKEN_RE.match(token) else None
	# the database compares case-insensitively; a token must match exactly
	name = row.name if row and hmac.compare_digest(cstr(row.token), token) else None
	if not name:
		fail("not_found", _("We could not find this booking. The link may be wrong or out of date."))
	return name


def _public_demo(demo):
	tz = common.zone(demo.get("timezone"))
	now = common.utcnow()
	first = as_utc(now + timedelta(hours=max(0, cint(demo.min_notice_hours)))).astimezone(tz).date()
	last = as_utc(now).astimezone(tz).date() + timedelta(days=max(0, cint(demo.max_days_ahead)))
	return {
		"slug": demo.name,
		"title": demo.title,
		"description": demo.description or "",
		"duration_minutes": common.minutes(demo.duration_minutes, 30),
		"timezone": getattr(tz, "key", None) or demo.get("timezone") or common.system_timezone(),
		"provider": demo.provider or "Google Meet",
		"location_note": demo.location_note or "",
		"brand": common.brand_of(demo),
		"min_date": first.isoformat(),
		"max_date": last.isoformat(),
	}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def get_demo(slug):
	spam.throttle("page", 120, 600)
	demo = common.get_demo_by_slug(slug)
	fields = [
		{"key": r.key, "label": r.label, "kind": r.kind, "required": 1 if cint(r.required) or r.key in ("name", "email", "phone") else 0,
		"options": [o.strip() for o in cstr(r.options).splitlines() if o.strip()], "placeholder": r.placeholder or ""}
		for r in demo.get("fields") or []
		if cint(r.enabled)
	]
	return {
		**_public_demo(demo),
		"fields": fields,
		"allow_guests": 1 if cint(demo.allow_guests) else 0,
		"consent": {"text": demo.consent_text or "", "default": 1 if cint(demo.consent_default) else 0},
		"form_token": spam.make_form_token(demo.name),
		"now_iso": common.iso_z(common.utcnow()),
	}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def get_slots(slug, from_date, to_date, tz=None, token=None):
	spam.throttle("slots", 300, 600)
	demo = common.get_demo_by_slug(slug)
	exclude = None
	if token:
		exclude = _booking_by_token(token)
		if frappe.db.get_value(BOOKING, exclude, "demo_type") != demo.name:
			exclude = None
	return slots.get_slots(demo, from_date, to_date, tz, exclude_booking=exclude)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def book(slug, start, tz=None, answers=None, guests=None, consent=0, utm=None, landing_url=None, referrer=None, form_token=None, hp=None):
	spam.throttle("book", 40, 3600)
	demo = common.get_demo_by_slug(slug)
	if cstr(hp).strip():
		# a bot filled the hidden field: look like a success, store nothing
		return {"ok": True, "booking": {"token": frappe.generate_hash(length=32), "status": "Confirmed", "starts_on_iso": cstr(start), "tz": cstr(tz), "title": demo.title}}
	spam.check_form_token(demo.name, form_token)
	request = getattr(frappe.local, "request", None)
	agent = request.headers.get("User-Agent") if request else ""
	name = booking.create_booking(
		demo,
		common.parse_start(start),
		tz,
		answers=_json(answers, {}),
		guests=guests,
		consent=consent,
		utm=_json(utm, {}),
		landing_url=landing_url,
		referrer=referrer,
		ip=getattr(frappe.local, "request_ip", None),
		user_agent=agent,
		fresh=True,
	)
	return {"ok": True, "booking": booking.payload(name)}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def get_booking(token):
	spam.throttle("token", 60, 600)
	name = _booking_by_token(token)
	data = booking.payload(name)
	demo = frappe.get_cached_doc(DEMO_TYPE, frappe.db.get_value(BOOKING, name, "demo_type"))
	return {"ok": True, "booking": data, "can_change": data["can_change"], "can_cancel": data["can_change"], "demo": _public_demo(demo)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def reschedule(token, start, tz=None):
	spam.throttle("token", 60, 600)
	name = _booking_by_token(token)
	booking.reschedule(name, common.parse_start(start), tz, fresh=True)
	return {"ok": True, "booking": booking.payload(name)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def cancel(token, reason=""):
	spam.throttle("token", 60, 600)
	name = _booking_by_token(token)
	booking.fresh_snapshot()
	booking.cancel(name, reason)
	return {"ok": True, "booking": booking.payload(name)}


@frappe.whitelist(allow_guest=True, methods=["GET"])
def ics(token):
	spam.throttle("token", 60, 600)
	name = _booking_by_token(token)
	frappe.response["filename"] = "demo.ics"
	frappe.response["filecontent"] = booking.build_ics(name)
	frappe.response["type"] = "download"
