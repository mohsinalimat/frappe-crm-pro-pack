"""What the Leads screen of the Suite Pro app starts with, set once by an admin for everybody: the default view, which controls sit in the top row, the
filters shown under the Filter icon, the columns, the sorting and the fields of the new-lead form. Stored as one JSON value; people can still change columns and
sorting for themselves (kept in their browser), and "Reset" in the page goes back to these."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr

KEY = "crm_pro_leads_config"
VIEWS = ("list", "kanban", "grid")
DEFAULT = {
	"default_view": "list",
	"show_date": 1,
	"show_status": 1,
	"filters": ["lead_owner", "source", "territory"],
	"top_filters": [],  # fields that sit in the top row, next to search
	"columns": None,  # None: CRM's own default columns
	"sort": "modified desc",
	"create_fields": None,  # None: CRM's quick entry layout; else [{"fieldname", "reqd"}]
}


def _admin():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can change this."), frappe.PermissionError)


def _check():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)


def load():
	try:
		saved = json.loads(frappe.db.get_default(KEY) or "{}")
	except ValueError:
		saved = {}
	out = dict(DEFAULT)
	out.update({k: v for k, v in (saved if isinstance(saved, dict) else {}).items() if k in DEFAULT})
	return out


@frappe.whitelist()
def get_config():
	_check()
	return load()


def _fieldnames(names, allowed, what):
	if names is None:
		return None
	if not isinstance(names, list):
		frappe.throw(_("{0} must be a list.").format(what))
	bad = [n for n in names if not isinstance(n, str) or (n not in allowed and n != "_assign")]
	if bad:
		frappe.throw(_("Unknown {0}: {1}").format(what, ", ".join(cstr(b) for b in bad[:5])))
	return list(dict.fromkeys(names))


@frappe.whitelist()
def save_config(config):
	"""System Managers only. Unknown or hidden fields are refused."""
	_admin()
	from crm_addons.pro import form

	cfg = json.loads(config) if isinstance(config, str) else config
	if not isinstance(cfg, dict):
		frappe.throw(_("Nothing to save."))
	allowed = {k for k, _l in form.export_fields()}
	out = dict(DEFAULT)
	if cfg.get("default_view") in VIEWS:
		out["default_view"] = cfg["default_view"]
	out["show_date"] = cint(cfg.get("show_date", 1))
	out["show_status"] = cint(cfg.get("show_status", 1))
	out["top_filters"] = [f for f in _fieldnames(cfg.get("top_filters") or [], allowed, "top row field") if f not in ("status", "_assign", "name")]
	out["filters"] = [f for f in _fieldnames(cfg.get("filters") or [], allowed, "filter field") if f not in out["top_filters"]]
	cols = cfg.get("columns")
	out["columns"] = [c for c in (_fieldnames([c if isinstance(c, str) else c.get("key") for c in cols], allowed, "column") or [])] if cols else None
	sort = cstr(cfg.get("sort") or DEFAULT["sort"]).split()
	if len(sort) != 2 or sort[1] not in ("asc", "desc") or sort[0] not in allowed | {"modified", "creation"}:
		frappe.throw(_("That sorting is not valid."))
	out["sort"] = " ".join(sort)
	cf = cfg.get("create_fields")
	if cf:
		writable = set(form.writable())
		rows = []
		for r in cf:
			n = r.get("fieldname") if isinstance(r, dict) else r
			if n not in writable:
				frappe.throw(_("{0} cannot be on the new-lead form.").format(cstr(n)))
			rows.append({"fieldname": n, "reqd": cint(r.get("reqd")) if isinstance(r, dict) else 0})
		out["create_fields"] = rows
	else:
		out["create_fields"] = None
	frappe.db.set_default(KEY, json.dumps(out))
	return out


@frappe.whitelist()
def choices():
	"""Fields an admin can pick from: for the filters, columns and sorting (``list``) and for the new-lead form (``form``, with what CRM itself requires)."""
	_admin()
	from crm_addons.pro import form

	meta = frappe.get_meta("CRM Lead")
	lst = []
	for k, label in form.export_fields():
		df = meta.get_field(k)
		lst.append({"fieldname": k, "label": label, "fieldtype": df.fieldtype if df else "Data", "options": df.options if df else None})
	forms = [{"fieldname": n, "label": s["label"], "fieldtype": s["fieldtype"], "reqd": s["reqd"]} for n, s in form.writable().items()]
	return {"list": lst, "form": forms}


# -- Organizations: only which filters sit in the top row ----------------------------------------------------------------------------------------

ORG_KEY = "crm_pro_orgs_config"
ORG_FILTERS = {"industry": "Industry", "territory": "Territory", "no_of_employees": "Number of employees"}


ORG_COLUMNS = {
	"organization_name": ("Name", "Data"), "website": ("Website", "Data"), "industry": ("Industry", "Data"), "territory": ("Territory", "Data"),
	"no_of_employees": ("Employees", "Data"), "leads": ("Leads", "Int"), "deals": ("Deals", "Int"), "annual_revenue": ("Annual revenue", "Currency"),
	"creation": ("Added", "Datetime"), "modified": ("Last modified", "Datetime"),
}
ORG_DEFAULT_COLUMNS = ["organization_name", "website", "industry", "territory", "no_of_employees", "leads", "deals", "annual_revenue"]


def load_orgs():
	try:
		saved = json.loads(frappe.db.get_default(ORG_KEY) or "{}")
	except ValueError:
		saved = {}
	got = saved.get("filters") if isinstance(saved, dict) else None
	cols = saved.get("columns") if isinstance(saved, dict) else None
	cols = [c for c in cols if c in ORG_COLUMNS] if isinstance(cols, list) else []
	return {"filters": [f for f in got if f in ORG_FILTERS] if isinstance(got, list) else ["industry", "territory"], "columns": cols or list(ORG_DEFAULT_COLUMNS)}


@frappe.whitelist()
def get_orgs_config():
	_check()
	return {**load_orgs(), "choices": [{"fieldname": k, "label": v} for k, v in ORG_FILTERS.items()], "all_columns": [{"fieldname": k, "label": v[0], "fieldtype": v[1]} for k, v in ORG_COLUMNS.items()], "default_columns": ORG_DEFAULT_COLUMNS}


@frappe.whitelist()
def save_orgs_config(config):
	"""System Managers only: which filters sit in the top row of the Organizations screen, and which columns it starts with."""
	_admin()
	cfg = json.loads(config) if isinstance(config, str) else config
	names = (cfg or {}).get("filters") if isinstance(cfg, dict) else None
	if not isinstance(names, list) or any(n not in ORG_FILTERS for n in names):
		frappe.throw(_("Choose the filters from the list."))
	cols = cfg.get("columns") or []
	if not isinstance(cols, list) or any(c not in ORG_COLUMNS for c in cols):
		frappe.throw(_("Choose the columns from the list."))
	out = {"filters": list(dict.fromkeys(names)), "columns": list(dict.fromkeys(cols)) or list(ORG_DEFAULT_COLUMNS)}
	frappe.db.set_default(ORG_KEY, json.dumps(out))
	return out


WA_REPLIES_KEY = "crm_pro_whatsapp_replies"
MAX_REPLIES = 100


def _replies():
	try:
		saved = json.loads(frappe.db.get_default(WA_REPLIES_KEY) or "[]")
	except ValueError:
		saved = []
	return [{"title": cstr(r.get("title")), "text": cstr(r.get("text"))} for r in saved if isinstance(r, dict) and r.get("title") and r.get("text")] if isinstance(saved, list) else []


@frappe.whitelist()
def get_whatsapp_replies():
	"""The saved replies everyone can pick in a WhatsApp chat (type / in the message box)."""
	_check()
	return {"replies": _replies(), "can_manage": frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles()}


@frappe.whitelist()
def save_whatsapp_replies(replies):
	"""System Managers only: the whole list of saved replies, each with a short title and the message."""
	_admin()
	rows = json.loads(replies) if isinstance(replies, str) else replies
	if not isinstance(rows, list) or len(rows) > MAX_REPLIES:
		frappe.throw(_("Send a list of at most {0} replies.").format(MAX_REPLIES))
	out = []
	for r in rows:
		title, text = cstr((r or {}).get("title")).strip()[:60], cstr((r or {}).get("text")).strip()[:1000]
		if title and text:
			out.append({"title": title, "text": text})
	frappe.db.set_default(WA_REPLIES_KEY, json.dumps(out))
	return {"replies": out}
