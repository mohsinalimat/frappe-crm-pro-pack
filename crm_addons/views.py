"""Default list / Kanban layouts for Leads, Contacts and Organizations, set by the administrator for everybody.

The administrator chooses, per page: which view opens first (list or Kanban), the list columns, the sort order, default
filters, the quick-filter boxes above the list and, for Leads, the Kanban column field and card fields. CRM keeps one
"standard" view per person and page (``CRM View Settings``); this app writes those for everyone, the way CRM would have
written them had the person set the view up themselves. Nobody's own changes are overwritten: a view is marked with the
time it was written, and a view that was saved again since (by its owner, in CRM) is left alone, unless the administrator
asks to overwrite.
"""

import hashlib
import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, now_datetime

SETTINGS = "CRM Addons Settings"
VIEW = "CRM View Settings"
SIG = "crm_addons_sig"
PAGES = {"CRM Lead": "Leads", "Contact": "Contacts", "CRM Organization": "Organizations"}
KANBAN_PAGES = ("CRM Lead",)
LAYOUT = {"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading", "Table", "Table MultiSelect", "Image", "Attach Image", "Password", "Fold", "Geolocation", "Signature", "Code", "HTML Editor", "Markdown Editor", "Text Editor", "Long Text"}
STANDARD = [("name", "ID", "Data"), ("creation", "Created On", "Datetime"), ("modified", "Last Modified", "Datetime"), ("owner", "Created By", "Link"), ("_assign", "Assigned To", "Text")]
FILTER_OPS = ("=", "!=", "like", "not like", "in", "not in", "is", ">", "<", ">=", "<=")


def _admin():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can set the default views."), frappe.PermissionError)


def _controller_defaults(dt):
	try:
		from crm.fcrm.doctype.crm_view_settings.crm_view_settings import get_controller

		ctl = get_controller(dt)
		return ctl.default_list_data() if hasattr(ctl, "default_list_data") else {"columns": [], "rows": []}
	except Exception:
		return {"columns": [], "rows": []}


def field_choices(dt):
	"""Fields the administrator may use as columns, filters and card fields: [{fieldname, label, fieldtype, options}]."""
	meta = frappe.get_meta(dt)
	out = [{"fieldname": n, "label": _(l), "fieldtype": t, "options": ""} for n, l, t in STANDARD]
	have = {r["fieldname"] for r in out}
	for f in meta.fields:
		if f.fieldtype in LAYOUT or not f.fieldname or not f.label or f.hidden or f.fieldname in have:
			continue
		out.append({"fieldname": f.fieldname, "label": _(f.label), "fieldtype": f.fieldtype, "options": f.options or ""})
		have.add(f.fieldname)
	return out


def _column(dt, key, choices):
	"""A column in the shape CRM stores: {label, type, key, width, options}. CRM's own definition wins when it has one."""
	for c in _controller_defaults(dt).get("columns", []):
		if c.get("key") == key:
			return c
	f = choices.get(key) or {"label": key, "fieldtype": "Data", "options": ""}
	kind = "Text" if f["fieldtype"] in ("Small Text", "Text") else "Data" if f["fieldtype"] in ("Select", "Read Only", "Phone", "Autocomplete") else f["fieldtype"]
	col = {"label": f["label"], "type": kind, "key": key, "width": "11rem"}
	if f["fieldtype"] == "Link" and f.get("options"):
		col["options"] = f["options"]
	return col


def clean(dt, cfg):
	"""The administrator's choice for one page, checked against the real fields."""
	cfg = cfg or {}
	choices = {c["fieldname"]: c for c in field_choices(dt)}
	out = {}
	if cfg.get("default_view") in ("list", "kanban"):
		out["default_view"] = "kanban" if (cfg["default_view"] == "kanban" and dt in KANBAN_PAGES) else "list"
	cols = [c for c in dict.fromkeys(cfg.get("columns") or []) if c in choices]
	if cols:
		out["columns"] = cols
	order = cstr(cfg.get("order_by")).strip()
	if order:
		field, _sp, way = order.partition(" ")
		if field in choices and way.lower() in ("asc", "desc", ""):
			out["order_by"] = f"{field} {way.lower() or 'desc'}"
	filters = []
	for row in cfg.get("filters") or []:
		if isinstance(row, (list, tuple)) and len(row) == 3 and row[0] in choices and cstr(row[1]).lower() in FILTER_OPS:
			value = row[2]
			if cstr(row[1]).lower() in ("in", "not in") and not isinstance(value, list):
				value = [v.strip() for v in cstr(value).split(",") if v.strip()]
			filters.append([row[0], cstr(row[1]).lower(), value])
	if filters:
		out["filters"] = filters
	quick = [q for q in dict.fromkeys(cfg.get("quick_filters") or []) if q in choices]
	if "quick_filters" in cfg:
		out["quick_filters"] = quick
	k = cfg.get("kanban") or {}
	if dt in KANBAN_PAGES and k:
		kc = {}
		if k.get("column_field") in choices and choices[k["column_field"]]["fieldtype"] in ("Select", "Link"):
			kc["column_field"] = k["column_field"]
		if k.get("title_field") in choices:
			kc["title_field"] = k["title_field"]
		cards = [c for c in dict.fromkeys(k.get("card_fields") or []) if c in choices]
		if cards:
			kc["card_fields"] = cards
		if kc:
			out["kanban"] = kc
	return out


def load_config():
	raw = frappe.db.get_single_value(SETTINGS, "view_defaults")
	try:
		data = json.loads(raw) if raw else {}
	except ValueError:
		data = {}
	return {dt: clean(dt, data.get(dt)) for dt in PAGES if data.get(dt)}


def _filters_dict(filters):
	"""[[field, op, value]] -> CRM's {field: value | [op, value]}."""
	out = {}
	for f, op, v in filters:
		if op == "=":
			out[f] = v
		elif op == "is":
			out[f] = ["is", v]
		else:
			out[f] = [op, v]
	return out


def targets(dt, cfg):
	"""{"list": fields of the standard list view, "kanban": ... (Leads)} CRM should hold for this page."""
	choices = {c["fieldname"]: c for c in field_choices(dt)}
	base = _controller_defaults(dt)
	out = {}
	columns = [_column(dt, c, choices) for c in cfg["columns"]] if cfg.get("columns") else base.get("columns", [])
	rows = list(dict.fromkeys([*base.get("rows", []), *[c["key"] for c in columns]]))
	out["list"] = {"columns": json.dumps(columns), "rows": json.dumps(rows), "filters": json.dumps(_filters_dict(cfg.get("filters") or [])), "order_by": cfg.get("order_by") or "modified desc"}
	k = cfg.get("kanban") or {}
	if dt in KANBAN_PAGES and (k or cfg.get("default_view") == "kanban"):
		column_field = k.get("column_field") or "status"
		try:
			from crm.fcrm.doctype.crm_view_settings.crm_view_settings import sync_default_columns

			kcolumns = sync_default_columns(frappe._dict(dt=dt, doctype=dt, type="kanban", column_field=column_field))
		except Exception:
			kcolumns = []
		out["kanban"] = {
			"column_field": column_field, "title_field": k.get("title_field") or "lead_name", "kanban_columns": json.dumps(kcolumns),
			"kanban_fields": json.dumps(k.get("card_fields") or ["organization", "email", "mobile_no", "_assign", "modified"]),
			"filters": out["list"]["filters"], "order_by": out["list"]["order_by"], "columns": json.dumps([]), "rows": json.dumps(rows),
		}
	return out


def _hash(values):
	return hashlib.sha1(json.dumps(values, sort_keys=True).encode()).hexdigest()[:12]


def _write(user, dt, kind, values, force):
	"""Create or update this person's standard view. Returns True when something was written."""
	name = frappe.db.get_value(VIEW, {"dt": dt, "type": kind, "is_standard": 1, "user": user})
	digest = _hash(values)
	if name:
		sig, modified = frappe.db.get_value(VIEW, name, [SIG, "modified"])
		mine = bool(sig) and sig.split("|", 1)[-1] == cstr(modified)
		if not mine and not force:
			return False  # the person saved their own layout: it stays theirs
		if mine and sig.split("|", 1)[0] == digest and not force:
			return False
		doc = frappe.get_doc(VIEW, name)
	else:
		doc = frappe.new_doc(VIEW)
		doc.update({"label": "Kanban" if kind == "kanban" else "List", "type": kind, "dt": dt, "user": user, "is_standard": 1, "route_name": PAGES[dt], "group_by_field": "owner"})
	doc.update(values)
	doc.flags.ignore_permissions = True
	doc.save() if name else doc.insert()
	frappe.db.set_value(VIEW, doc.name, SIG, f"{digest}|{frappe.db.get_value(VIEW, doc.name, 'modified')}", update_modified=False)
	return True


def provision_user(user, force=False, config=None):
	"""Give one person the administrator's layouts. Returns how many views were written."""
	if not frappe.db.exists("DocType", VIEW) or not frappe.get_meta(VIEW).has_field(SIG):
		return 0
	config = load_config() if config is None else config
	written = 0
	for dt, cfg in config.items():
		made = targets(dt, cfg)
		for kind, values in made.items():
			if _write(user, dt, kind, values, force):
				written += 1
		# which of the two opens first
		want = cfg.get("default_view") or None
		if want and want in made:
			for kind in made:
				name = frappe.db.get_value(VIEW, {"dt": dt, "type": kind, "is_standard": 1, "user": user})
				if not name:
					continue
				sig, modified = frappe.db.get_value(VIEW, name, [SIG, "modified"])
				if (sig and sig.split("|", 1)[-1] == cstr(modified)) or force:
					flag = 1 if kind == want else 0
					if cint(frappe.db.get_value(VIEW, name, "is_default")) != flag:
						frappe.db.set_value(VIEW, name, "is_default", flag, update_modified=False)
						written += 1
	if config:
		frappe.defaults.set_user_default("crm_addons_views_applied", _hash(config), user)
	return written


def ensure_for_user(user=None):
	"""Called when a person opens the CRM: give them the layouts once per change of the administrator's choice. True if views changed."""
	user = user or frappe.session.user
	if user == "Guest" or not frappe.db.get_single_value(SETTINGS, "view_defaults"):
		return False
	config = load_config()
	if not config or frappe.defaults.get_user_default("crm_addons_views_applied", user) == _hash(config):
		return False
	if not (set(frappe.get_roles(user)) & {"Sales User", "Sales Manager", "System Manager"}) and user != "Administrator":
		return False
	return provision_user(user, False, config) > 0


def crm_users():
	names = frappe.get_all("Has Role", filters={"role": ["in", ["Sales User", "Sales Manager", "System Manager"]], "parenttype": "User"}, pluck="parent")
	return frappe.get_all("User", filters={"name": ["in", list(set(names) - {"Guest"})], "enabled": 1}, pluck="name")


def apply_quick_filters(config):
	"""The boxes above each list are one setting per page for everybody (CRM's own mechanism)."""
	try:
		from crm.api.doc import update_quick_filters
	except Exception:
		return
	for dt, cfg in config.items():
		if "quick_filters" not in cfg:
			continue
		meta = frappe.get_meta(dt)
		old = [f.fieldname for f in meta.fields if f.in_standard_filter]
		update_quick_filters(json.dumps(cfg["quick_filters"]), json.dumps(old), dt)
		frappe.clear_cache(doctype=dt)


@frappe.whitelist()
def get_view_config():
	_admin()
	config = load_config()
	pages = []
	for dt, route in PAGES.items():
		meta = frappe.get_meta(dt)
		cfg = config.get(dt, {})
		base = _controller_defaults(dt)
		pages.append(
			{
				"doctype": dt, "label": route, "kanban": dt in KANBAN_PAGES, "fields": field_choices(dt), "config": cfg,
				"current_columns": [c["key"] for c in base.get("columns", [])],
				"current_quick_filters": [f.fieldname for f in meta.fields if f.in_standard_filter],
			}
		)
	return {"pages": pages}


@frappe.whitelist()
def save_view_config(config, apply=1, overwrite=0):
	"""Save the defaults and give them to everybody (not over their own changes unless ``overwrite``)."""
	_admin()
	data = frappe.parse_json(config) or {}
	cleaned = {dt: clean(dt, data.get(dt)) for dt in PAGES if data.get(dt)}
	frappe.db.set_single_value(SETTINGS, "view_defaults", json.dumps(cleaned))
	frappe.clear_document_cache(SETTINGS, SETTINGS)
	apply_quick_filters(cleaned)
	written = 0
	if cint(apply):
		users = crm_users()
		for u in users:
			written += provision_user(u, bool(cint(overwrite)), cleaned)
		return {"saved": True, "people": len(users), "written": written}
	return {"saved": True, "people": 0, "written": 0}
