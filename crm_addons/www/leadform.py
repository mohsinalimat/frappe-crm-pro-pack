"""Public lead form: /lead-form/<slug> (standalone, no website chrome).

A minimal HTML shell: only the title, brand colour and theme are rendered here, so the first paint has no flash. The widget fetches the rest
from crm_addons.demos.leadforms.get_public_form.
"""

import re

import frappe

import crm_addons

no_cache = 1
sitemap = 0
no_header = 1
no_breadcrumbs = 1

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _slug():
	form = frappe.form_dict or {}
	if form.get("slug"):
		return str(form.get("slug"))[:140]
	parts = [p for p in (frappe.local.request.path or "").split("/") if p]
	return parts[1][:140] if len(parts) >= 2 and parts[0] == "lead-form" else ""


def get_context(context):
	context.no_cache = 1
	context.no_header = 1
	context.no_breadcrumbs = 1
	context.no_sidebar = 1
	context.show_sidebar = 0
	context.sitemap = 0
	context.title = "Get in touch"
	context.version = crm_addons.__version__
	# a person who is logged in to the CRM in this browser needs the CSRF token to post; guests have none
	context.csrf = (frappe.session.data.get("csrf_token") if frappe.session.user != "Guest" and frappe.session.data else "") or ""
	context.lang = (frappe.local.lang or "en").split("-")[0]
	context.accent = "#171717"
	context.theme = "auto"
	context.brand = ""
	slug = _slug()
	try:
		d = frappe.db.get_value("CRM Lead Form", {"slug": slug, "enabled": 1}, ["title", "brand_name", "accent_color", "theme"], as_dict=True) if slug else None
		if d:
			context.brand = d.brand_name or ""
			context.title = (d.title or "Get in touch") + (" | " + d.brand_name if d.brand_name else "")
			if d.accent_color and _HEX.match(d.accent_color):
				context.accent = d.accent_color
			context.theme = (d.theme or "Auto").lower()
	except Exception:
		frappe.clear_last_message()
	context.form_slug = slug
	context.robots = "noindex, nofollow"
	return context
