"""The Add lead, Add organization and Add person forms, as an admin arranges them in Settings.

Every form starts as the CRM has it (the Quick Entry layout for a lead, the usual fields for an organization, the usual questions for a person) and an admin
can then show, hide, reorder and relabel fields, make optional ones required, and hide individual values of a dropdown. Nothing is ever added: a field has to
exist on the CRM record already, and a dropdown only offers values that exist in the CRM (a new Source, Industry or Territory is added in the CRM first), so
the numbers on the dashboards and the data stay the same everywhere. Stored as one JSON value, apart from the CRM, so nothing is merged into Frappe.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr

KEY = "crm_pro_forms_config"
KINDS = ("lead", "organization", "person")
TITLES = {"lead": "Add lead", "organization": "Add organization", "person": "Add person"}
DOCTYPES = {"lead": "CRM Lead", "organization": "CRM Organization"}
ORG_DEFAULT = ["organization_name", "website", "industry", "territory", "no_of_employees", "annual_revenue"]
ORG_TYPES = ("Data", "Select", "Link", "Int", "Float", "Currency", "Check", "Date", "Small Text", "Text", "Long Text", "Phone")
ORG_SKIP = {"name", "organization_logo", "currency", "address", "owner", "naming_series"}
NO_LINKS = {"User", "Contact", "Role", "Address", "File", "Customer", "Lead", "CRM Lead", "CRM Deal"}
# (fieldname, label, locked: always on the form and always required, requirable)
PERSON = [
	("first_name", "First name", True, True), ("last_name", "Last name", False, True), ("email", "Email", True, True), ("mobile_no", "Contact number", False, True),
	("designation", "Designation", False, True), ("company", "Company", False, True), ("image", "Photo", False, False), ("role", "Role in CRM", True, False),
	("preset", "Preset", False, False), ("reports_to", "Team leader", False, False), ("invite", "Email invitation", False, False), ("whatsapp", "WhatsApp login link", False, False),
]
PERSON_DEFAULT_REQD = {"first_name", "email"}


def _admin():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can change this."), frappe.PermissionError)


def _check():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)


def _kind(kind):
	if kind not in KINDS:
		frappe.throw(_("Unknown form."))
	return kind


def _stored():
	try:
		data = json.loads(frappe.db.get_default(KEY) or "{}")
	except ValueError:
		data = {}
	return data if isinstance(data, dict) else {}


# -- what exists in the CRM --------------------------------------------------------------------------------------------


def _choices(doctype):
	"""The values a Link can take, as they exist in the CRM now (at most 300): the picker never offers anything else."""
	if not doctype or doctype in NO_LINKS or not frappe.db.exists("DocType", doctype):
		return []
	title = frappe.get_meta(doctype).title_field
	if title and title != "name":
		return [cstr(r.get("name")) for r in frappe.get_all(doctype, fields=["name"], order_by="name asc", limit_page_length=300)]
	return frappe.get_all(doctype, pluck="name", order_by="name asc", limit_page_length=300)


def _spec(df, locked=False):
	spec = {"fieldname": df.fieldname, "label": df.label or df.fieldname, "fieldtype": df.fieldtype, "locked": bool(locked or cint(df.reqd)), "values": [], "link": ""}
	if df.fieldtype == "Select":
		spec["values"] = [o for o in cstr(df.options).split("\n") if o]
	elif df.fieldtype == "Link":
		spec["link"] = df.options
		spec["values"] = _choices(df.options)
	return spec


def pool(kind):
	"""Every field the form may ask, from what the CRM record has: ``[{fieldname, label, fieldtype, locked, values, link}]``."""
	kind = _kind(kind)
	if kind == "person":
		return [{"fieldname": n, "label": label, "fieldtype": "Data", "locked": locked, "requirable": req, "values": [], "link": ""} for n, label, locked, req in PERSON]
	meta = frappe.get_meta(DOCTYPES[kind])
	if kind == "lead":
		from crm_addons.pro import form

		found = {n: spec for n, spec in form.writable().items() if n not in ("lead_owner",)}
		for sec in form.sections("Quick Entry"):
			for f in sec["fields"]:
				found.setdefault(f["fieldname"], f)
		for df in meta.fields:
			if df.reqd and not df.default and df.fieldname not in form.NEVER and df.fieldtype in form.LIST_TYPES and not df.hidden:
				found.setdefault(df.fieldname, form._spec(df))
		return [_spec(meta.get_field(n)) for n in found if meta.get_field(n)]
	out = []
	for df in meta.fields:
		if df.fieldtype in ORG_TYPES and not df.hidden and not df.read_only and df.fieldname not in ORG_SKIP and not (df.fieldtype == "Link" and df.options in NO_LINKS):
			out.append(_spec(df, df.fieldname == "organization_name"))
	return out


def default_rows(kind):
	"""The form as the CRM has it: ``[{fieldname, reqd}]``."""
	kind = _kind(kind)
	if kind == "person":
		return [{"fieldname": n, "reqd": 1 if n in PERSON_DEFAULT_REQD else 0} for n, _l, _lk, _r in PERSON]
	if kind == "organization":
		have = {p["fieldname"]: p for p in pool(kind)}
		return [{"fieldname": n, "reqd": 1 if have[n]["locked"] else 0} for n in ORG_DEFAULT if n in have]
	from crm_addons.pro import form

	secs = form.sections("Quick Entry")
	rows = [{"fieldname": f["fieldname"], "reqd": cint(f["reqd"])} for s in secs for f in s["fields"]]
	have = {r["fieldname"] for r in rows}
	rows += [{"fieldname": p["fieldname"], "reqd": 1} for p in pool(kind) if p["locked"] and p["fieldname"] not in have]
	return rows


# -- what the admin chose ---------------------------------------------------------------------------------------------------


def effective(kind):
	"""``[{fieldname, label, reqd, hide}]`` the admin chose for this form, or None when the form follows the CRM."""
	kind = _kind(kind)
	rows = _stored().get(kind)
	if rows is None and kind == "lead":  # a choice made on the Leads screen setup before forms had their own page
		from crm_addons.pro import config

		legacy = config.load().get("create_fields")
		rows = [{"fieldname": r["fieldname"], "reqd": cint(r.get("reqd"))} for r in legacy] if legacy else None
	if not rows:
		return None
	return [{"fieldname": r["fieldname"], "label": cstr(r.get("label")), "reqd": cint(r.get("reqd")), "hide": list(r.get("hide") or [])} for r in rows if r.get("fieldname")]


def clean(kind, rows):
	"""Validate an admin's choice against the CRM. Anything that is not already in the CRM is refused with a message that says where to add it."""
	kind = _kind(kind)
	if not isinstance(rows, list):
		frappe.throw(_("The form is not valid."))
	have = {p["fieldname"]: p for p in pool(kind)}
	out, seen = [], set()
	for r in rows[:60]:
		name = cstr((r or {}).get("fieldname")).strip()
		if not name or name in seen:
			continue
		if name not in have:
			frappe.throw(_("{0} is not a field the CRM has, so it cannot be on this form. Add the field in the CRM first, then it shows up here.").format(frappe.bold(name)))
		spec = have[name]
		hide = [cstr(v) for v in (r.get("hide") or [])]
		bad = [v for v in hide if v not in spec["values"]]
		if bad:
			frappe.throw(_("{0} is not a value of {1} in the CRM. Add values in the CRM, never here.").format(frappe.bold(bad[0]), frappe.bold(spec["label"])))
		seen.add(name)
		reqd = 1 if spec["locked"] or cint(r.get("reqd")) else 0
		if kind == "person" and reqd and not spec["locked"] and not spec.get("requirable"):
			reqd = 0
		out.append({"fieldname": name, "label": cstr(r.get("label")).strip()[:80], "reqd": reqd, "hide": hide if len(hide) < len(spec["values"]) else []})  # a dropdown is never left empty
	for name, spec in have.items():  # what the CRM insists on is always there
		if spec["locked"] and name not in seen and (kind != "lead" or spec["fieldname"] != "name"):
			out.append({"fieldname": name, "label": "", "reqd": 1, "hide": []})
	return out


@frappe.whitelist()
def get_forms():
	"""For Settings: per form, what the CRM has, what the admin chose (None = follows the CRM) and the pool to choose from."""
	_admin()
	data = {}
	for kind in KINDS:
		data[kind] = {"title": TITLES[kind], "pool": pool(kind), "default": default_rows(kind), "chosen": effective(kind), "doctype": DOCTYPES.get(kind, "")}
	return data


@frappe.whitelist()
def save_form(kind, fields):
	_admin()
	rows = clean(kind, json.loads(fields) if isinstance(fields, str) else fields)
	data = _stored()
	data[kind] = rows
	frappe.db.set_default(KEY, json.dumps(data))
	return {"chosen": effective(kind)}


@frappe.whitelist()
def reset_form(kind):
	"""Back to the CRM's own form."""
	_admin()
	data = _stored()
	data.pop(_kind(kind), None)
	frappe.db.set_default(KEY, json.dumps(data))
	if kind == "lead":  # an old choice from the Leads screen setup would otherwise come back
		from crm_addons.pro import config

		cfg = config.load()
		if cfg.get("create_fields"):
			cfg["create_fields"] = None
			frappe.db.set_default(config.KEY, json.dumps(cfg))
	return {"chosen": None}


def runtime(kind):
	"""``{custom, fields: [{fieldname, label, fieldtype, reqd, values, link}]}`` in the order to show: the admin's arrangement, or the CRM's own form."""
	kind = _kind(kind)
	chosen = effective(kind)
	rows = chosen if chosen is not None else [{**r, "label": "", "hide": []} for r in default_rows(kind)]
	have = {p["fieldname"]: p for p in pool(kind)}
	fields = []
	for r in rows:
		spec = have.get(r["fieldname"])
		if spec:
			fields.append({**spec, "label": r["label"] or spec["label"], "reqd": 1 if r["reqd"] or spec["locked"] else 0, "values": [v for v in spec["values"] if v not in r["hide"]]})
	return {"custom": chosen is not None, "fields": fields}


@frappe.whitelist()
def get_form_fields(kind):
	"""For the forms themselves, for anybody logged in."""
	_check()
	return runtime(kind)


def required_labels(kind):
	"""``{fieldname: label}`` of what the admin made required on a form (to check on the server too)."""
	rows = effective(kind) or []
	have = {p["fieldname"]: p for p in pool(kind)}
	return {r["fieldname"]: (r["label"] or have[r["fieldname"]]["label"]) for r in rows if r["reqd"] and r["fieldname"] in have}
