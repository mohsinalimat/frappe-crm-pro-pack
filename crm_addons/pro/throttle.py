"""A small per-address request budget for the public (guest) webhooks, so a flood of unsigned calls cannot keep the server busy."""

import time

import frappe
from frappe import _
from frappe.utils import cint

WINDOW = 60  # seconds


def client_ip():
	"""The connecting address as Frappe saw it. A forwarded-for header is not used: the caller could invent it."""
	return getattr(frappe.local, "request_ip", None) or "unknown"


def check(kind, limit=600):
	"""Count this call against the caller's address for the current minute; refuse with 429 once ``limit`` is passed."""
	cache = frappe.cache()
	key = f"crm_addons:hook:{kind}:{client_ip()}:{int(time.time() // WINDOW)}"
	used = cint(cache.get_value(key, expires=True)) + 1
	cache.set_value(key, used, expires_in_sec=WINDOW * 2)
	if used > limit:
		frappe.local.response["http_status_code"] = 429
		frappe.throw(_("Too many requests. Try again in a minute."), frappe.TooManyRequestsError)
