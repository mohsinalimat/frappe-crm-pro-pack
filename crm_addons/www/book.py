"""Public booking page: /book/<slug> and /book/manage/<token> (standalone, no website chrome).

The page is a minimal HTML shell. Only what is needed for the first paint (title, brand colours, theme) is
rendered here; everything else is fetched by the widget from crm_addons.demos.public.*.
"""

import re

import frappe
from frappe import _  # noqa: F401

import crm_addons

no_cache = 1
sitemap = 0

no_header = 1
no_breadcrumbs = 1

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _route_args():
	"""-> (mode, value): ('slug', 'x'), ('manage', token) or ('', '')."""
	form = frappe.form_dict or {}
	if form.get("token"):
		return "manage", str(form.get("token"))[:200]
	if form.get("slug"):
		return "slug", str(form.get("slug"))[:140]
	parts = [p for p in (frappe.local.request.path or "").split("/") if p]
	if parts and parts[0] == "book":
		if len(parts) >= 3 and parts[1] == "manage":
			return "manage", parts[2][:200]
		if len(parts) >= 2:
			return "slug", parts[1][:140]
	return "", ""


def get_context(context):
	context.no_cache = 1
	context.no_header = 1
	context.no_breadcrumbs = 1
	context.no_sidebar = 1
	context.show_sidebar = 0
	context.sitemap = 0
	context.title = "Book a demo"
	context.version = crm_addons.__version__
	context.lang = (frappe.local.lang or "en").split("-")[0]
	context.accent = "#171717"
	context.theme = "auto"
	context.brand = ""
	context.public = 0
	context.mode, context.value = _route_args()
	slug = context.value if context.mode == "slug" else ""
	try:
		if context.mode == "manage":
			bk = frappe.db.get_value("CRM Demo Booking", {"token": context.value}, "demo_type")
			slug = frappe.db.get_value("CRM Demo Type", bk, "name") if bk else ""
			name = slug
		else:
			name = frappe.db.get_value("CRM Demo Type", {"slug": slug, "enabled": 1}, "name") if slug else None
		if name:
			d = frappe.db.get_value(
				"CRM Demo Type", name, ["title", "brand_name", "accent_color", "theme"], as_dict=True
			)
			if d:
				context.brand = d.brand_name or ""
				context.title = (d.title or "Book a demo") + (" | " + d.brand_name if d.brand_name else "")
				if d.accent_color and _HEX.match(d.accent_color):
					context.accent = d.accent_color
				context.theme = d.theme if d.theme in ("Light", "Dark") else "Auto"
				context.theme = context.theme.lower()
	except Exception:
		frappe.clear_last_message()
	# Booking pages are reached from the owner's own sites, never from search: not indexed (also for manage links).
	# Framing headers (frame-ancestors from the demo type's allowed_origins) are set by crm_addons.demos.framing, not here.
	context.robots = "noindex, nofollow"
	return context
