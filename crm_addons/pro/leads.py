"""Leads for the standalone Suite Pro app. Every read goes through ``frappe.get_list``, so CRM's own permissions decide what a person sees; the
``scope`` (all / mine / my team) only narrows it further."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, strip_html

LEAD = "CRM Lead"
FIELDS = [
	"name", "lead_name", "first_name", "last_name", "organization", "mobile_no", "phone", "email", "status", "source", "territory", "lead_owner",
	"addons_score", "next_follow_up_on", "next_meeting_on", "creation", "modified", "image", "job_title",
]
SORTS = ("creation", "modified", "lead_name", "status", "organization", "next_follow_up_on", "addons_score", "source", "lead_owner")
PAGE_MAX = 200


def _check():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	frappe.has_permission(LEAD, "read", throw=True)


def _loads(value, default):
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return default
	return value if isinstance(value, type(default)) else default


def _scope_users(scope):
	if scope == "mine":
		return {frappe.session.user}
	if scope == "team":
		from crm_addons.team_access import access

		return access.team_users(frappe.session.user)
	return None


def _conditions(filters, search, scope):
	"""(filters, or_filters) for get_list from the filter bar. A list value means "any of"; ``__none__`` in owners means unassigned."""
	f = _loads(filters, {})
	out, or_out = [], None
	for key in ("status", "source", "territory", "organization"):
		vals = [cstr(v).strip() for v in _loads(f.get(key), []) if cstr(v).strip()]
		if vals:
			out.append([LEAD, key, "in", vals])
	owners = [cstr(v) for v in _loads(f.get("lead_owner"), []) if cstr(v)]
	users = _scope_users(scope)
	if users is not None:
		owners = [o for o in owners if o in users] if owners else sorted(users)
		if not owners:
			out.append([LEAD, "name", "=", "__nobody__"])
	if owners:
		real = [o for o in owners if o != "__none__"]
		if "__none__" in owners and real:
			or_out = [[LEAD, "lead_owner", "in", real], [LEAD, "lead_owner", "is", "not set"]]
		elif "__none__" in owners:
			out.append([LEAD, "lead_owner", "is", "not set"])
		else:
			out.append([LEAD, "lead_owner", "in", real])
	if cstr(f.get("from")):
		out.append([LEAD, "creation", ">=", cstr(f["from"])[:10] + " 00:00:00"])
	if cstr(f.get("to")):
		out.append([LEAD, "creation", "<=", cstr(f["to"])[:10] + " 23:59:59"])
	if cstr(f.get("followup")) == "due":
		out.append([LEAD, "next_follow_up_on", "<=", frappe.utils.now_datetime()])
	elif cstr(f.get("followup")) == "none":
		out.append([LEAD, "next_follow_up_on", "is", "not set"])
	quick = cstr(f.get("followup"))
	if f.get("has_followup") and quick != "none":
		out.append([LEAD, "next_follow_up_on", "is", "set"])
	if f.get("never_called"):
		out.append([LEAD, "addons_last_outcome", "is", "not set"])
	if f.get("stale"):
		out.append([LEAD, "modified", "<", frappe.utils.add_days(frappe.utils.now_datetime(), -7)])
	if f.get("has_meeting"):
		out.append([LEAD, "next_meeting_on", "is", "set"])
	term = cstr(search).strip()
	search_or = None
	if term:
		like = f"%{term}%"
		search_or = [[LEAD, c, "like", like] for c in ("lead_name", "organization", "mobile_no", "phone", "email", "name")]
	return out, or_out, search_or


def _get_list(**kw):
	"""get_list with an OR group for the search box and one for "owner or unassigned" (get_list takes a single or_filters)."""
	return frappe.get_list(LEAD, **kw)


@frappe.whitelist()
def list_leads(filters=None, search=None, scope="all", order_by="creation", order_dir="desc", start=0, page_length=25):
	"""One page of leads plus the total. ``scope`` is all, mine or team."""
	_check()
	flt, or_flt, search_or = _conditions(filters, search, scope)
	if search_or and or_flt:  # both need an OR: keep the search, filter owners in Python-free way by nesting through a name list
		names = _get_list(fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name")
		flt = flt + [[LEAD, "name", "in", names or [""]]]
		or_flt = search_or
	elif search_or:
		or_flt = search_or
	col = order_by if order_by in SORTS else "creation"
	direction = "asc" if cstr(order_dir).lower() == "asc" else "desc"
	page = max(1, min(cint(page_length) or 25, PAGE_MAX))
	rows = _get_list(fields=FIELDS, filters=flt, or_filters=or_flt, order_by=f"{col} {direction}", limit_start=max(0, cint(start)), limit_page_length=page)
	total = len(_get_list(fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name"))
	return {"rows": _decorate(rows), "total": total}


def _decorate(rows):
	owners = {r.lead_owner for r in rows if r.lead_owner}
	people = {u.name: u for u in frappe.get_all("User", filters={"name": ["in", list(owners) or [""]]}, fields=["name", "full_name", "user_image"])}
	for r in rows:
		o = people.get(r.lead_owner)
		r["owner_name"] = (o.full_name if o else None) or r.lead_owner
		r["owner_image"] = o.user_image if o else None
		r["display_name"] = r.lead_name or r.organization or r.name
	return rows


@frappe.whitelist()
def board(filters=None, search=None, scope="all", per_column=20):
	"""Kanban data: for each status, its first leads and its total count."""
	_check()
	flt, or_flt, search_or = _conditions(filters, search, scope)
	if search_or and or_flt:
		names = _get_list(fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name")
		flt = flt + [[LEAD, "name", "in", names or [""]]]
		or_flt = search_or
	elif search_or:
		or_flt = search_or
	statuses = _statuses()
	out = []
	for s in statuses:
		f = flt + [[LEAD, "status", "=", s["name"]]]
		rows = _get_list(fields=FIELDS, filters=f, or_filters=or_flt, order_by="modified desc", limit_page_length=max(1, min(cint(per_column) or 30, 100)))
		count = len(_get_list(fields=["name"], filters=f, or_filters=or_flt, limit_page_length=0, pluck="name"))
		out.append({**s, "count": count, "rows": _decorate(rows)})
	return out


@frappe.whitelist()
def board_more(status, filters=None, search=None, scope="all", start=0, page_length=20):
	"""The next leads of one board column."""
	_check()
	flt, or_flt, search_or = _conditions(filters, search, scope)
	if search_or and or_flt:
		names = _get_list(fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name")
		flt = flt + [[LEAD, "name", "in", names or [""]]]
		or_flt = search_or
	elif search_or:
		or_flt = search_or
	rows = _get_list(fields=FIELDS, filters=flt + [[LEAD, "status", "=", status]], or_filters=or_flt, order_by="modified desc", limit_start=max(0, cint(start)), limit_page_length=max(1, min(cint(page_length) or 20, 100)))
	return _decorate(rows)


def _statuses():
	return frappe.get_all("CRM Lead Status", fields=["name", "color", "type", "position"], order_by="position asc, name asc")


@frappe.whitelist()
def filter_options():
	"""What the filter bar can pick from: statuses (with their colour), sources, territories, organizations and the people who own leads."""
	_check()
	owners = frappe.get_all("User", filters={"enabled": 1, "name": ["not in", ["Guest"]]}, fields=["name", "full_name", "user_image"], order_by="full_name asc", limit_page_length=500)
	return {
		"statuses": _statuses(),
		"sources": frappe.get_all("CRM Lead Source", pluck="name", order_by="name asc") if frappe.db.exists("DocType", "CRM Lead Source") else [],
		"territories": frappe.get_all("CRM Territory", pluck="name", order_by="name asc") if frappe.db.exists("DocType", "CRM Territory") else [],
		"organizations": frappe.get_all("CRM Organization", pluck="name", order_by="name asc", limit_page_length=500) if frappe.db.exists("DocType", "CRM Organization") else [],
		"owners": [{"name": o.name, "full_name": o.full_name or o.name, "image": o.user_image} for o in owners],
		"can_write": bool(frappe.has_permission(LEAD, "write")),
		"can_create": bool(frappe.has_permission(LEAD, "create")),
		"can_delete": bool(frappe.has_permission(LEAD, "delete")),
	}


def _names(names):
	names = [cstr(n) for n in _loads(names, [])]
	if not names:
		frappe.throw(_("Pick at least one lead."))
	if len(names) > 500:
		frappe.throw(_("Pick at most 500 leads at a time."))
	return names


@frappe.whitelist()
def set_status(name, status):
	_check()
	if not frappe.db.exists("CRM Lead Status", status):
		frappe.throw(_("Unknown status."))
	doc = frappe.get_doc(LEAD, name)
	doc.check_permission("write")
	doc.status = status
	doc.save()
	return {"name": name, "status": status}


@frappe.whitelist()
def bulk_update(names, status=None, owner=None):
	"""Change the status and/or the owner of many leads. ``owner`` of ``__none__`` clears the owner. Returns {done, failed}."""
	_check()
	names = _names(names)
	if status and not frappe.db.exists("CRM Lead Status", status):
		frappe.throw(_("Unknown status."))
	if owner and owner != "__none__" and not frappe.db.exists("User", owner):
		frappe.throw(_("Unknown person."))
	if not status and not owner:
		frappe.throw(_("Pick a status or a person."))
	done, failed = 0, []
	for n in names:
		try:
			doc = frappe.get_doc(LEAD, n)
			doc.check_permission("write")
			if status:
				doc.status = status
			if owner:
				doc.lead_owner = None if owner == "__none__" else owner
			doc.save()
			done += 1
		except Exception as e:
			failed.append({"name": n, "reason": strip_html(cstr(e))[:140]})
	return {"done": done, "failed": failed}


@frappe.whitelist()
def bulk_delete(names):
	_check()
	done, failed = 0, []
	for n in _names(names):
		try:
			frappe.delete_doc(LEAD, n)
			done += 1
		except Exception as e:
			failed.append({"name": n, "reason": strip_html(cstr(e))[:140]})
	return {"done": done, "failed": failed}


@frappe.whitelist()
def create_lead(values):
	"""A new lead from the form: the fields CRM's layouts allow (see ``form.writable``). Returns its name."""
	_check()
	from crm_addons.pro import form

	frappe.has_permission(LEAD, "create", throw=True)
	data = {k: v for k, v in form.clean_values(values).items() if v is not None}
	if not cstr(data.get("first_name")).strip():
		frappe.throw(_("First name is needed."))
	data.setdefault("lead_owner", frappe.session.user)
	return frappe.get_doc({"doctype": LEAD, **data}).insert().name


@frappe.whitelist()
def export_csv(filters=None, search=None, scope="all", names=None):
	"""Every exportable field of the leads of the current filters (or of the chosen ``names``) as CSV text. Returns {csv, count, truncated}."""
	_check()
	import csv
	import io

	from crm_addons.pro import form

	cols = form.export_fields()
	fieldnames = [c for c, _l in cols]
	cap = 20000
	chosen = _loads(names, []) if names else []
	if chosen:
		flt, or_flt = [[LEAD, "name", "in", [cstr(n) for n in chosen][:cap]]], None
	else:
		flt, or_flt, search_or = _conditions(filters, search, scope)
		if search_or and or_flt:
			ids = _get_list(fields=["name"], filters=flt, or_filters=or_flt, limit_page_length=0, pluck="name")
			flt = flt + [[LEAD, "name", "in", ids or [""]]]
			or_flt = search_or
		elif search_or:
			or_flt = search_or
	rows = _get_list(fields=fieldnames, filters=flt, or_filters=or_flt, order_by="creation desc", limit_page_length=cap + 1)
	truncated = len(rows) > cap
	buf = io.StringIO()
	w = csv.writer(buf)
	w.writerow([label for _c, label in cols])
	for r in rows[:cap]:
		w.writerow([form.safe_cell(r.get(c)) for c in fieldnames])
	return {"csv": buf.getvalue(), "count": min(len(rows), cap), "truncated": truncated}
