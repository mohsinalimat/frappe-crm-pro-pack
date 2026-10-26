"""The "Team and access" screen: who is who, which preset and changes each person has, and the presets. System Managers only."""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr

from crm_addons.team_access import access
from crm_addons.team_access import registry as R
from crm_addons.team_access.doctype.crm_access_preset.crm_access_preset import clean_grants

CRM_ROLES = ("System Manager", "Sales Manager", "Sales User", "Campaign Manager")


def _admin():
	if not access.is_admin():
		frappe.throw(_("Only a System Manager can change who sees what."), frappe.PermissionError)


def _registry():
	return {
		"groups": [{"key": k, "label": label, "help": help} for k, label, help in R.GROUPS],
		"features": [{**{k: f[k] for k in ("key", "group", "label", "kind", "help")}, "options": [{"value": v, "label": label} for v, label in f["options"]], "legacy": list(f["legacy"])} for f in R.FEATURES],
	}


def _presets():
	rows = frappe.get_all("CRM Access Preset", fields=["name", "preset_name", "description", "is_system", "grants", "modified"], order_by="preset_name asc")
	used = dict(frappe.db.sql("select preset, count(*) from `tabCRM User Access` where preset is not null and preset != '' group by preset"))
	for r in rows:
		r["grants"] = access._loads(r.grants)
		r["users"] = cint(used.get(r.name))
	return rows


def _hierarchy_rows():
	if not frappe.db.exists("DocType", access.HIERARCHY):
		return []
	meta = frappe.get_meta(access.HIERARCHY)
	fields = ["name", "user", "lft", "rgt"] + (["reports_to"] if meta.has_field("reports_to") else [])
	return frappe.get_all(access.HIERARCHY, filters={"user": ["is", "set"]}, fields=fields, limit_page_length=5000)


def _people():
	users = frappe.get_all(
		"User", filters={"enabled": 1, "user_type": "System User", "name": ["not in", ["Administrator", "Guest"]]},
		fields=["name", "full_name", "user_image", "last_active"], order_by="full_name asc", limit_page_length=2000,
	)
	names = [u.name for u in users] or [""]
	roles = {}
	for r in frappe.get_all("Has Role", filters={"parenttype": "User", "parent": ["in", names], "role": ["in", list(CRM_ROLES)]}, fields=["parent", "role"], limit_page_length=20000):
		roles.setdefault(r.parent, []).append(r.role)
	configured = {r.user: r for r in frappe.get_all("CRM User Access", fields=["user", "preset", "overrides"], limit_page_length=5000)}
	tree = _hierarchy_rows()
	node_user = {n.name: n.user for n in tree}
	by_user = {n.user: n for n in tree}
	out = []
	for u in users:
		if u.name not in roles:
			continue  # not a CRM person
		node = by_user.get(u.name)
		boss = node_user.get(node.get("reports_to")) if node else None
		team = [n.user for n in tree if node and n.lft > node.lft and n.rgt < node.rgt and n.user != u.name] if node else []
		cfg = configured.get(u.name)
		overrides = access._loads(cfg.overrides) if cfg else {}
		out.append(
			{
				"user": u.name, "full_name": u.full_name or u.name, "image": u.user_image, "last_active": u.last_active, "roles": sorted(roles[u.name]),
				"admin": "System Manager" in roles[u.name], "in_hierarchy": bool(node), "reports_to": boss, "team_size": len(team),
				"preset": cfg.preset if cfg else None, "overrides": len(overrides), "configured": bool(cfg),
			}
		)
	return out


@frappe.whitelist()
def get_overview():
	"""Everything the screen needs in one call."""
	_admin()
	return {**_registry(), "presets": _presets(), "people": _people(), "hierarchy": access.hierarchy_info(), "me": frappe.session.user}


@frappe.whitelist()
def get_user_access(user):
	_admin()
	if not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	cfg = access.configured(user)
	return {
		"user": user, "preset": cfg["preset"] if cfg else None, "overrides": cfg["overrides"] if cfg else {},
		"effective": access.explain(user), "roles": sorted(set(frappe.get_roles(user)) & set(CRM_ROLES)),
		"team": sorted(access.team_users(user) - {user}),
	}


@frappe.whitelist()
def save_user_access(user, preset=None, overrides=None):
	"""Give a person a preset and changes on top. Neither = back to what their role gives them."""
	_admin()
	if not frappe.db.exists("User", user) or user in ("Administrator", "Guest"):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	preset = cstr(preset).strip() or None
	if preset and not frappe.db.exists("CRM Access Preset", preset):
		frappe.throw(_("Preset {0} was not found.").format(frappe.bold(preset)))
	overrides = clean_grants(overrides or {})
	# an override equal to what the preset (or the default) gives anyway is no override at all
	grants = access.preset_grants(preset)
	overrides = {k: v for k, v in overrides.items() if not (k in grants and R.normalise(R.BY_KEY[k], grants[k]) == v)}
	if frappe.db.exists("CRM User Access", user):
		if not preset and not overrides:
			frappe.delete_doc("CRM User Access", user, ignore_permissions=True)
		else:
			doc = frappe.get_doc("CRM User Access", user)
			doc.preset, doc.overrides = preset, json.dumps(overrides)
			doc.save(ignore_permissions=True)
	elif preset or overrides:
		frappe.get_doc({"doctype": "CRM User Access", "user": user, "preset": preset, "overrides": json.dumps(overrides)}).insert(ignore_permissions=True)
	access.clear()
	return get_user_access(user)


@frappe.whitelist()
def save_preset(preset_name, description="", grants=None, name=None):
	_admin()
	grants = clean_grants(grants or {})
	preset_name = cstr(preset_name).strip()
	if not preset_name:
		frappe.throw(_("Give the preset a name."))
	if name:
		doc = frappe.get_doc("CRM Access Preset", name)
		if preset_name != doc.name:
			frappe.throw(_("A preset cannot be renamed. Duplicate it under the new name instead."))
		doc.description, doc.grants = description, json.dumps(grants)
		doc.save(ignore_permissions=True)
	else:
		if frappe.db.exists("CRM Access Preset", preset_name):
			frappe.throw(_("A preset named {0} already exists.").format(frappe.bold(preset_name)))
		doc = frappe.get_doc({"doctype": "CRM Access Preset", "preset_name": preset_name, "description": description, "grants": json.dumps(grants)}).insert(ignore_permissions=True)
	access.clear()
	return next(p for p in _presets() if p["name"] == doc.name)


@frappe.whitelist()
def duplicate_preset(name, new_name):
	_admin()
	src = frappe.get_doc("CRM Access Preset", name)
	return save_preset(new_name, src.description, access._loads(src.grants))


@frappe.whitelist()
def delete_preset(name):
	_admin()
	frappe.delete_doc("CRM Access Preset", name, ignore_permissions=True)  # refused by the preset itself while people use it
	access.clear()
	return True


@frappe.whitelist()
def send_password_reset(user):
	"""Email the person a link to choose a new password (Frappe's own reset). Needs an outgoing email account."""
	_admin()
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	try:
		doc = frappe.get_doc("User", user)
		if hasattr(doc, "_reset_password"):  # newer Frappe (the name of the method changed); older ones have reset_password(send_email=...)
			doc.validate_reset_password()
			doc._reset_password(send_email=True)
		else:
			doc.reset_password(send_email=True)
	except Exception as exc:
		frappe.clear_messages()
		frappe.throw(_("The reset email could not be sent: {0}").format(frappe.utils.strip_html(cstr(exc))[:200]))
	return {"sent_to": user}
