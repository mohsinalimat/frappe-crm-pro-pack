"""The lead form as Frappe CRM defines it. The Suite Pro pages read CRM's own field layouts (Quick Entry for the new-lead form, Side Panel for the details, Data
Fields for the list) instead of keeping a field list of their own, so a field an admin adds or moves in CRM shows up here too. Every write is checked against
the same layouts."""

import csv
import io
import json

import frappe
from frappe import _
from frappe.utils import cint, cstr

LEAD = "CRM Lead"
LAYOUT = "crm.fcrm.doctype.crm_fields_layout.crm_fields_layout"
LAYOUT_TYPES = ("Quick Entry", "Side Panel", "Data Fields")
SKIP_TYPES = {"Section Break", "Column Break", "Tab Break", "HTML", "Table", "Table MultiSelect", "Button", "Image", "Attach Image", "Attach", "Heading", "Fold", "Geolocation", "Signature", "Code", "HTML Editor", "Markdown Editor", "Text Editor"}
# what a person never types: system-kept values
NEVER = {"name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "converted", "naming_series", "lead_name", "status_change_log", "rolling_responses", "last_response_time", "last_responded_on", "first_response_time", "first_responded_on", "sla", "sla_creation", "sla_status", "communication_status", "response_by", "total", "net_total", "products"}
LIST_TYPES = ("Data", "Select", "Link", "Int", "Float", "Currency", "Percent", "Check", "Date", "Datetime", "Time", "Small Text", "Text", "Long Text", "Phone", "Rating", "Read Only", "Dynamic Link", "Duration", "Autocomplete", "Color")


def _meta():
	return frappe.get_meta(LEAD)


def _layout_fieldnames(kind):
	"""Fieldnames CRM lays out for ``kind``, in order, grouped by section: [(section label, [fieldname])]. Empty when CRM has no such layout."""
	row = frappe.db.get_value("CRM Fields Layout", {"dt": LEAD, "type": kind}, "layout")
	if not row:
		return []
	try:
		tabs = json.loads(row)
	except ValueError:
		return []
	if tabs and isinstance(tabs[0], dict) and not any("sections" in t for t in tabs):
		tabs = [{"sections": tabs}]
	out = []
	for tab in tabs if isinstance(tabs, list) else []:
		for section in tab.get("sections") or []:
			names = [f for col in (section.get("columns") or []) if col for f in (col.get("fields") or []) if isinstance(f, str)]
			if names:
				out.append((section.get("label") or "", names))
	return out


def _spec(df):
	opts = df.options if df.fieldtype in ("Select", "Link") else None
	return {
		"fieldname": df.fieldname, "label": df.label or df.fieldname, "fieldtype": df.fieldtype, "reqd": cint(df.reqd), "read_only": cint(df.read_only) or df.fieldname in NEVER,
		"options": ([o for o in (opts or "").split("\n")] if df.fieldtype == "Select" else opts), "default": df.default, "description": df.description,
	}


def sections(kind):
	"""[{label, fields: [spec]}] for a CRM layout, keeping only fields that still exist and that this person may see (CRM's own permission levels apply)."""
	meta = _meta()
	out = []
	for label, names in _layout_fieldnames(kind):
		fields = []
		for n in names:
			df = meta.get_field(n)
			if df and df.fieldtype not in SKIP_TYPES and not df.hidden and meta.has_permlevel_access_to(n, df, "read" if kind != "Quick Entry" else "write"):
				fields.append(_spec(df))
		if fields:
			out.append({"label": label, "fields": fields})
	return out


def writable():
	"""{fieldname: spec} of every lead field a person may set from these pages: the fields CRM lays out (quick entry, side panel, data fields), minus system-kept ones."""
	meta = _meta()
	found = {}
	for kind in LAYOUT_TYPES:
		for _label, names in _layout_fieldnames(kind):
			for n in names:
				df = meta.get_field(n)
				if df and df.fieldtype in LIST_TYPES and n not in NEVER and not df.read_only and not df.hidden and meta.has_permlevel_access_to(n, df, "write"):
					found[n] = _spec(df)
	for n in ("status", "lead_owner"):  # always there: the lead's status and owner
		df = meta.get_field(n)
		if df:
			found.setdefault(n, _spec(df))
	return found


def _apply_create_config(secs):
	"""The admin's arrangement of the new-lead form (Settings, Forms): chosen fields in their order, their labels and required marks, and dropdown values
	hidden. Fields CRM itself requires always stay. Nothing is added: every field and value already exists in the CRM."""
	from crm_addons.pro import forms_config

	chosen = forms_config.effective("lead")
	if not chosen:
		return secs
	allowed = writable()
	known = {f["fieldname"]: f for s in secs for f in s["fields"]}
	fields = []
	for r in chosen:
		spec = known.get(r["fieldname"]) or allowed.get(r["fieldname"])
		if spec and r.get("hidden") and not spec["reqd"]:  # kept in the list but not asked
			continue
		if spec:
			spec = {**spec, "reqd": 1 if (spec["reqd"] or r.get("reqd")) else 0, "full": 1 if r.get("full") else 0}
			if r.get("label"):
				spec["label"] = r["label"]
			if r.get("hide") and isinstance(spec.get("options"), list):
				spec["options"] = [o for o in spec["options"] if o not in r["hide"]]
			elif r.get("hide") and spec.get("fieldtype") == "Link":
				spec["hide"] = list(r["hide"])
			fields.append(spec)
	have = {f["fieldname"] for f in fields}
	fields += [f for f in known.values() if f["reqd"] and f["fieldname"] not in have]
	return [{"label": "", "fields": fields}] if fields else secs


@frappe.whitelist()
def get_form(kind="create"):
	"""The new-lead form (``create``): CRM's Quick Entry layout, with the required fields CRM insists on. ``edit``: every writable field, grouped as CRM groups them."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	secs = sections("Quick Entry")
	if kind == "create":
		secs = _apply_create_config(secs)
	have = {f["fieldname"] for s in secs for f in s["fields"]}
	meta = _meta()
	extra = [_spec(df) for df in meta.fields if df.reqd and not df.default and df.fieldname not in have and df.fieldname not in NEVER and df.fieldtype in LIST_TYPES and not df.hidden]
	if extra:
		secs.append({"label": _("Required"), "fields": extra})
	if kind == "edit":
		allowed = writable()
		seen = {f["fieldname"] for s in secs for f in s["fields"]}
		side = [{"label": s["label"], "fields": [f for f in s["fields"] if f["fieldname"] in allowed]} for s in sections("Side Panel")]
		secs = [s for s in secs + side if s["fields"]]
		dup = set()
		for s in secs:
			s["fields"] = [f for f in s["fields"] if not (f["fieldname"] in dup or dup.add(f["fieldname"]))]
		secs = [s for s in secs if s["fields"]]
		del seen
	return secs


@frappe.whitelist()
def link_options(doctype, txt="", limit=20, exclude=None):
	"""Choices for a Link field of the lead form (only doctypes the lead links to)."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if doctype not in {df.options for df in _meta().fields if df.fieldtype == "Link"}:
		frappe.throw(_("Not a link of the lead."))
	frappe.has_permission(doctype, "read", throw=True)
	title = frappe.get_meta(doctype).title_field
	fields = ["name"] + ([title] if title and title != "name" else [])
	flt = {}
	hidden = json.loads(exclude) if isinstance(exclude, str) and exclude else (exclude or [])
	if hidden:  # values the admin hid on this form (they stay in the CRM)
		flt["name"] = ["not in", [cstr(h) for h in hidden]]
	rows = frappe.get_list(doctype, fields=fields, or_filters=[[doctype, c, "like", f"%{cstr(txt).strip()}%"] for c in fields] if cstr(txt).strip() else None, filters=flt, order_by="modified desc", limit_page_length=max(1, min(cint(limit) or 20, 50)))
	return [{"value": r.name, "label": (r.get(title) if title and title != "name" and r.get(title) else r.name)} for r in rows]


def clean_values(values, only=None):
	"""Check a form's values against what CRM's layouts allow; returns {fieldname: value} with empty strings as None and checks as 0/1."""
	values = values if isinstance(values, dict) else json.loads(values or "{}")
	allowed = only if only is not None else writable()
	bad = [k for k in values if k not in allowed]
	if bad:
		frappe.throw(_("Cannot set: {0}").format(", ".join(bad)))
	out = {}
	for k, v in values.items():
		ft = allowed[k]["fieldtype"]
		if ft == "Check":
			out[k] = 1 if v in (1, True, "1", "true", "Yes", "yes") else 0
		elif cstr(v).strip() == "":
			out[k] = None
		else:
			out[k] = v.strip() if isinstance(v, str) else v
	return out


# ---------------------------------------------------------------- export / import


def export_fields():
	"""Every lead field worth exporting, in the order of the doctype: [(fieldname, label)]. System-internal ones (SLA clocks, change logs) are left out."""
	cols = [("name", "ID")]
	for df in _meta().fields:
		if df.fieldtype in SKIP_TYPES or df.hidden or df.fieldname in NEVER or df.fieldtype not in LIST_TYPES:
			continue
		cols.append((df.fieldname, df.label or df.fieldname))
	cols.insert(1, ("lead_name", "Full name"))
	cols.append(("creation", "Added"))
	return cols


@frappe.whitelist()
def export_columns():
	"""[{key, label}] of every exportable lead field, for the download button."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	return [{"key": k, "label": l} for k, l in export_fields()]


def safe_cell(value):
	"""A spreadsheet runs a cell that starts with = + - or @ as a formula; such text gets a leading quote. A phone number's own plus sign is kept."""
	text = cstr(value)
	if text.startswith(("=", "@", "-")):
		return "'" + text
	if text.startswith("+") and not text[1:].replace(" ", "").replace("-", "").isdigit():
		return "'" + text
	return text


@frappe.whitelist()
def import_template():
	"""A CSV with the headers of the new-lead form and a sample row."""
	secs = get_form("create")
	fields = [f for s in secs for f in s["fields"] if f["fieldtype"] != "Check" or True]
	buf = io.StringIO()
	w = csv.writer(buf)
	w.writerow([f["label"] for f in fields])
	w.writerow([_sample(f) for f in fields])
	return {"csv": buf.getvalue(), "columns": [f["label"] for f in fields]}


def _sample(f):
	ft = f["fieldtype"]
	if ft == "Select":
		return next((o for o in (f["options"] or []) if o), "")
	return {"Data": "", "Phone": "+919800000000", "Check": "0", "Date": "2026-01-31", "Datetime": "2026-01-31 10:00:00", "Int": "0", "Currency": "0", "Float": "0"}.get(ft, "")


@frappe.whitelist()
def import_csv(content, dry_run=1):
	"""Add leads from CSV text. Columns match by the form's label, the field's label or its fieldname. ``dry_run`` checks every row and saves nothing.
	Returns {created, failed: [{row, reason}], unknown: [header], total}."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	frappe.has_permission(LEAD, "create", throw=True)
	text = cstr(content).lstrip("﻿")
	if len(text) > 5_000_000:
		frappe.throw(_("That file is too big. Split it into parts of at most 2,000 leads."))
	rows = list(csv.reader(io.StringIO(text)))
	if len(rows) < 2:
		frappe.throw(_("The file needs a header row and at least one lead."))
	if len(rows) - 1 > 2000:
		frappe.throw(_("At most 2,000 leads per file. This one has {0}.").format(len(rows) - 1))
	allowed = writable()
	by_key = {}
	for n, spec in allowed.items():
		by_key[n.lower()] = n
		by_key[cstr(spec["label"]).strip().lower()] = n
	header, unknown, cols = rows[0], [], []
	for h in header:
		key = by_key.get(cstr(h).strip().lower())
		cols.append(key)
		if not key and cstr(h).strip():
			unknown.append(h)
	if not any(cols):
		frappe.throw(_("None of the columns match the lead form. Download the template and use its headers."))
	created, failed = 0, []
	for i, row in enumerate(rows[1:], start=2):
		if not any(cstr(c).strip() for c in row):
			continue
		values = {cols[j]: c for j, c in enumerate(row) if j < len(cols) and cols[j]}
		frappe.db.savepoint("pro_import_row")
		try:
			data = clean_values(values, allowed)
			data = {k: v for k, v in data.items() if v is not None}
			frappe.get_doc({"doctype": LEAD, **data}).insert()
			if cint(dry_run):
				frappe.db.rollback(save_point="pro_import_row")
			created += 1
		except Exception as e:
			frappe.db.rollback(save_point="pro_import_row")
			failed.append({"row": i, "reason": frappe.utils.strip_html(cstr(e))[:160]})
			if len(failed) >= 200:
				break
	return {"created": created, "failed": failed, "unknown": unknown, "total": len(rows) - 1, "dry_run": bool(cint(dry_run))}


@frappe.whitelist()
def to_xlsx(columns, rows):
	"""An Excel file (base64) of ``rows`` under the header ``columns``; cells that a spreadsheet would run as a formula are quoted."""
	import base64

	from frappe.utils.xlsxutils import make_xlsx

	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	cols = json.loads(columns) if isinstance(columns, str) else columns
	data = json.loads(rows) if isinstance(rows, str) else rows
	if not isinstance(cols, list) or not isinstance(data, list) or len(data) > 20000 or len(cols) > 300:
		frappe.throw(_("That is too much to export in one file."))
	table = [[safe_cell(c) for c in cols]] + [[safe_cell(v) if v is not None else "" for v in r[: len(cols)]] for r in data if isinstance(r, list)]
	return base64.b64encode(make_xlsx(table, "Leads").getvalue()).decode()
