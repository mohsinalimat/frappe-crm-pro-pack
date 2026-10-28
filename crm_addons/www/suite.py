"""The Suite Pro app at /suite (the old /crm-pro address redirects here): a signed-in page (the app itself is plain scripts under public/pro)."""

import frappe

from crm_addons.inject import asset_version

no_cache = 1
sitemap = 0
no_header = 1
no_breadcrumbs = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/suite"
		raise frappe.Redirect
	context.no_cache = 1
	context.no_header = 1
	context.no_breadcrumbs = 1
	context.no_sidebar = 1
	context.show_sidebar = 0
	context.version = asset_version()
