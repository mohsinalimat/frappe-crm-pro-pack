"""The Log: website bookings and lead form entries together, newest first, paged on the server (there can be thousands)."""

import frappe
from frappe import _
from frappe.utils import cint, cstr

from crm_addons.campaigns.common import date_range
from crm_addons.demos import common
from crm_addons.demos.common import BOOKING, DEMO_TYPE
from crm_addons.demos.permissions import scope_sql
from crm_addons.team_access import access

FORM, ENTRY = "CRM Lead Form", "CRM Lead Form Entry"
META_FORM, META_LOG = "CRM Meta Form", "CRM Meta Lead Log"


def _sources(kind):
	"""The parts of the log this person may see: bookings by Bookings access, lead forms by Widgets access."""
	out = []
	if kind in ("", "all", "bookings") and access.level("demos") != access.R.NONE:
		out.append("bookings")
	if kind in ("", "all", "forms") and access.allows("demo_widgets", "view"):
		out.append("forms")
	if kind in ("", "all", "meta") and access.allows("demo_widgets", "view") and frappe.db.exists("DocType", META_LOG):
		out.append("meta")
	return out


@frappe.whitelist()
def get_log(kind="all", result=None, search=None, source=None, from_date=None, to_date=None, page=1, page_size=50):
	which = _sources(cstr(kind))
	if not which:
		frappe.throw(_("You do not have access to the log."), frappe.PermissionError)
	values, parts = {}, []
	start, end = date_range(from_date, to_date)
	if "bookings" in which:
		w = [scope_sql(frappe.session.user, "b") or "1 = 1"]
		parts.append(
			f"""select 'booking' as kind, b.demo_type as source, b.name, b.creation, b.status as result, coalesce(t.title, b.demo_type) as thing, b.name_, b.email, b.phone, b.lead,
			b.utm_source, b.utm_medium, b.utm_campaign, if(b.rescheduled_from is null or b.rescheduled_from = '', '', 'Moved from an earlier booking') as reason, b.ip_address
			from `tab{BOOKING}` b left join `tab{DEMO_TYPE}` t on t.name = b.demo_type where {' and '.join(w)}"""
		)
	if "forms" in which:
		parts.append(
			f"""select 'form' as kind, e.form as source, e.name, e.creation, e.result, coalesce(f.title, e.form) as thing, e.name_, e.email, e.phone, e.lead,
			e.utm_source, e.utm_medium, e.utm_campaign, e.reason, e.ip_address from `tab{ENTRY}` e left join `tab{FORM}` f on f.name = e.form"""
		)
	if "meta" in which:
		parts.append(
			f"""select 'meta' as kind, e.form as source, e.name, e.creation, e.result, coalesce(nullif(e.form_name, ''), 'Meta lead form') as thing, e.person_name as name_, e.email, e.phone, e.lead,
			e.source as utm_source, concat_ws(' / ', nullif(e.adset_name, ''), nullif(e.ad_name, '')) as utm_medium, e.campaign_name as utm_campaign, e.error as reason, null as ip_address from `tab{META_LOG}` e"""
		)
	outer = ["1 = 1"]
	if start:
		outer.append("u.creation >= %(start)s")
		values["start"] = start
	if end:
		outer.append("u.creation < %(end)s")
		values["end"] = end
	picked = [r.strip() for r in cstr(result).split(",") if r.strip()]
	if picked:
		outer.append("u.result in %(results)s")
		values["results"] = tuple(picked)
	if source:
		outer.append("u.source = %(source)s")
		values["source"] = source
	txt = cstr(search).strip()
	if txt:
		outer.append("(u.name_ like %(q)s or u.email like %(q)s or u.phone like %(q)s or u.utm_campaign like %(q)s or u.utm_source like %(q)s or u.thing like %(q)s)")
		values["q"] = f"%{txt}%"
	union = " union all ".join(parts)
	where = " and ".join(outer)
	page, size = max(1, cint(page)), min(max(1, cint(page_size) or 50), 200)
	total = frappe.db.sql(f"select count(*) from ({union}) u where {where}", values)[0][0]
	rows = frappe.db.sql(
		f"select u.* from ({union}) u where {where} order by u.creation desc limit %(limit)s offset %(offset)s",
		{**values, "limit": size, "offset": (page - 1) * size}, as_dict=True,
	)
	admin = common.is_admin()
	for r in rows:
		r["creation"] = str(r["creation"])
		r["ip"] = r.pop("ip_address") if admin else None
		r.pop("ip_address", None)
	return {"rows": rows, "total": total, "page": page, "page_size": size, "show_ip": admin, "kinds": which}


@frappe.whitelist()
def get_sources():
	"""The booking pages and lead forms that can appear in the log, for the "All websites" filter."""
	out = []
	if access.level("demos") != access.R.NONE:
		out += [{"value": r.name, "label": r.title or r.name, "kind": "booking"} for r in frappe.get_all(DEMO_TYPE, fields=["name", "title"], order_by="title asc", limit_page_length=200)]
	if access.allows("demo_widgets", "view"):
		out += [{"value": r.name, "label": r.title or r.name, "kind": "form"} for r in frappe.get_all(FORM, fields=["name", "title"], order_by="title asc", limit_page_length=200)]
		if frappe.db.exists("DocType", META_FORM):
			out += [{"value": r.name, "label": r.form_name or r.name, "kind": "meta"} for r in frappe.get_all(META_FORM, fields=["name", "form_name"], order_by="form_name asc", limit_page_length=200)]
	return out
