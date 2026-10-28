"""Organizations for the Suite Pro app. Reads and writes go through CRM's permissions; the leads and deals of an organization are the ones that name it."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr

ORG = "CRM Organization"
FIELDS = ["name", "organization_name", "website", "territory", "industry", "no_of_employees", "annual_revenue", "currency", "organization_logo", "creation", "modified"]
EDITABLE = ("organization_name", "website", "territory", "industry", "no_of_employees", "annual_revenue")
SORTS = ("creation", "modified", "organization_name", "annual_revenue")


def _check(perm="read"):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	frappe.has_permission(ORG, perm, throw=True)


def _counts(names):
	"""{organization: {"leads": n, "deals": n}} for a page of organizations."""
	out = {n: {"leads": 0, "deals": 0} for n in names}
	if not names:
		return out
	for dt, key in (("CRM Lead", "leads"), ("CRM Deal", "deals")):
		for r in frappe.get_list(dt, filters={"organization": ["in", names]}, fields=["organization", "count(name) as n"], group_by="organization", limit_page_length=0):
			out[r.organization][key] = r.n
	return out


@frappe.whitelist()
def options():
	_check()
	return {
		"industries": frappe.get_all("CRM Industry", pluck="name", order_by="name asc"), "territories": frappe.get_all("CRM Territory", pluck="name", order_by="name asc"),
		"sizes": [o for o in (frappe.get_meta(ORG).get_field("no_of_employees").options or "").split("\n") if o],
		"can_create": bool(frappe.has_permission(ORG, "create")), "can_write": bool(frappe.has_permission(ORG, "write")), "can_delete": bool(frappe.has_permission(ORG, "delete")),
	}


@frappe.whitelist()
def list_orgs(search=None, industry=None, territory=None, no_of_employees=None, order_by="organization_name", order_dir="asc", start=0, page_length=25):
	_check()
	flt = []
	if industry:
		flt.append([ORG, "industry", "=", industry])
	if territory:
		flt.append([ORG, "territory", "=", territory])
	if no_of_employees:
		flt.append([ORG, "no_of_employees", "=", no_of_employees])
	term = cstr(search).strip()
	or_flt = [[ORG, c, "like", f"%{term}%"] for c in ("organization_name", "website")] if term else None
	col = order_by if order_by in SORTS else "organization_name"
	direction = "desc" if cstr(order_dir).lower() == "desc" else "asc"
	rows = frappe.get_list(ORG, fields=FIELDS, filters=flt, or_filters=or_flt, order_by=f"{col} {direction}", limit_start=max(0, cint(start)), limit_page_length=max(1, min(cint(page_length) or 25, 200)))
	total = len(frappe.get_list(ORG, fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name"))
	counts = _counts([r.name for r in rows])
	for r in rows:
		r.update(counts[r.name])
	return {"rows": rows, "total": total}


@frappe.whitelist()
def get_org(name):
	_check()
	doc = frappe.get_doc(ORG, name)
	doc.check_permission("read")
	out = {k: doc.get(k) for k in FIELDS}
	out.update(_counts([name])[name])
	out["can_write"] = bool(doc.has_permission("write"))
	out["can_delete"] = bool(doc.has_permission("delete"))
	out["leads_list"] = frappe.get_list("CRM Lead", filters={"organization": name}, fields=["name", "lead_name", "status", "mobile_no", "email", "lead_owner", "creation"], order_by="creation desc", limit_page_length=100)
	out["deals_list"] = frappe.get_list("CRM Deal", filters={"organization": name}, fields=["name", "status", "annual_revenue", "deal_owner", "creation"], order_by="creation desc", limit_page_length=100) if frappe.db.exists("DocType", "CRM Deal") else []
	return out


def _clean(values):
	values = values if isinstance(values, dict) else json.loads(values or "{}")
	bad = [k for k in values if k not in EDITABLE]
	if bad:
		frappe.throw(_("Cannot set: {0}").format(", ".join(bad)))
	return {k: (v if cstr(v).strip() != "" else None) for k, v in values.items()}


@frappe.whitelist()
def create_org(values):
	_check("create")
	data = _clean(values)
	if not cstr(data.get("organization_name")).strip():
		frappe.throw(_("Give the organization a name."))
	return frappe.get_doc({"doctype": ORG, **data}).insert().name


@frappe.whitelist()
def update_org(name, values):
	_check("write")
	doc = frappe.get_doc(ORG, name)
	doc.check_permission("write")
	for k, v in _clean(values).items():
		if k == "organization_name":
			continue  # the name is the record's ID
		doc.set(k, v)
	doc.save()
	return get_org(name)


@frappe.whitelist()
def delete_org(name):
	_check("delete")
	frappe.delete_doc(ORG, name)
	return True
