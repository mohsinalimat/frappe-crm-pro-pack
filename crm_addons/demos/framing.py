"""Who may put a booking page in an iframe.

Frappe pages are not allowed in a frame by default. For ``/book/<slug>`` and ``/book/manage/<token>`` only, the websites listed in the demo
type's ``allowed_origins`` are allowed (``Content-Security-Policy: frame-ancestors``) and ``X-Frame-Options`` is removed; any other
page keeps its protection. A page of an unknown or disabled demo type, or one with no origins, stays same-origin only.
"""

import re

import frappe
from frappe.utils import cstr

from crm_addons.demos.common import BOOKING, DEMO_TYPE, RESERVED_SLUGS, SLUG_RE

ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?$|^https?://\*\.[A-Za-z0-9.-]+(:\d{1,5})?$")
MANAGE = re.compile(r"^/book/manage/([A-Za-z0-9_-]{20,64})/?$")
PAGE = re.compile(r"^/book/([a-z0-9-]+)/?$")
LEAD_FORM = re.compile(r"^/lead-form/([a-z0-9-]+)/?$")


def clean_origins(raw):
	"""One origin per line -> a list of valid ones (``https://www.example.com``, no path, no trailing slash)."""
	out = []
	for line in cstr(raw).replace(",", "\n").splitlines():
		line = line.strip().rstrip("/")
		if line and ORIGIN_RE.match(line) and line not in out:
			out.append(line)
	return out


def origins_for_path(path):
	"""The allowed embedding origins for a /book path, or None when the path is not a booking page."""
	match = MANAGE.match(path)
	if match:
		demo = frappe.db.sql(f"select demo_type from `tab{BOOKING}` where token = %s", match.group(1))
		name = demo[0][0] if demo else None
	else:
		match = PAGE.match(path)
		if not match or match.group(1) in RESERVED_SLUGS or not SLUG_RE.match(match.group(1)):
			return None
		name = match.group(1)
	if not name or not frappe.db.exists(DEMO_TYPE, name):
		return []
	enabled, raw = frappe.db.get_value(DEMO_TYPE, name, ["enabled", "allowed_origins"])
	return clean_origins(raw) if enabled else []


def form_origins(path):
	"""The allowed embedding origins for a /lead-form/<slug> path, or None when the path is not a lead form page."""
	match = LEAD_FORM.match(path)
	if not match or not SLUG_RE.match(match.group(1)):
		return None
	row = frappe.db.get_value("CRM Lead Form", match.group(1), ["enabled", "allowed_origins"])
	return clean_origins(row[1]) if row and row[0] else []


def add_frame_headers(response=None, request=None, **kwargs):
	"""``after_request`` hook."""
	try:
		path = getattr(request, "path", "") or ""
		if response is None or not (path == "/book" or path.startswith("/book/") or path.startswith("/lead-form/")):
			return
		origins = form_origins(path) if path.startswith("/lead-form/") else origins_for_path(path)
		if origins is None:
			return
		ancestors = " ".join(["'self'", *origins])
		existing = [d.strip() for d in (response.headers.get("Content-Security-Policy") or "").split(";") if d.strip()]
		existing = [d for d in existing if not d.lower().startswith("frame-ancestors")]
		response.headers["Content-Security-Policy"] = "; ".join(existing + [f"frame-ancestors {ancestors}"])
		if origins:
			response.headers.pop("X-Frame-Options", None)
		else:
			response.headers["X-Frame-Options"] = "SAMEORIGIN"
	except Exception:
		frappe.logger().error("CRM Demo: could not set the framing headers", exc_info=True)
