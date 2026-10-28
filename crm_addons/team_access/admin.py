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


def _viewer():
	"""The Team page can be looked at by anyone Team and access gives "View only"; changing anything is for System Managers."""
	if not (access.is_admin() or access.allows("team", "view")):
		frappe.throw(_("You do not have access to the Team page."), frappe.PermissionError)


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


def _extra_fields():
	"""The designation and company fields this app adds to User (missing until the first migrate)."""
	meta = frappe.get_meta("User")
	return [f for f in ("crm_designation", "crm_company") if meta.has_field(f)]


def _login_template():
	from crm_addons import system_messages

	return system_messages.login_template_status()


@frappe.whitelist()
def get_login_templates():
	"""For the picker in Team and access: the approved WhatsApp templates, and which one the login link uses now."""
	_admin()
	from crm_addons import system_messages

	return {"templates": system_messages.approved_templates(), "status": system_messages.login_template_status()}


@frappe.whitelist()
def link_login_template(name=None):
	"""Use an approved WhatsApp template for the login link (empty = back to the ready-made one)."""
	_admin()
	from crm_addons import system_messages

	return system_messages.link_login_template(name)


@frappe.whitelist()
def create_login_template():
	"""Submit the ready-made WhatsApp login-link template to Meta (System Managers). It stays Pending until Meta approves it."""
	_admin()
	from crm_addons import system_messages

	return system_messages.create_login_template()


def _people():
	"""Everyone who holds a CRM role, whatever their Frappe user type: System Users and also the CRM agents that are Website Users."""
	roles = {}
	for r in frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", list(CRM_ROLES)]}, fields=["parent", "role"], limit_page_length=50000):
		roles.setdefault(r.parent, []).append(r.role)
	users = frappe.get_all(
		"User", filters={"name": ["in", [n for n in roles if n not in ("Administrator", "Guest")] or [""]]},
		fields=["name", "full_name", "user_image", "last_active", "enabled", "mobile_no"] + _extra_fields(), order_by="full_name asc", limit_page_length=5000,
	)
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
				"enabled": bool(u.enabled), "mobile_no": u.mobile_no, "designation": u.get("crm_designation"), "company": u.get("crm_company"),
				"admin": "System Manager" in roles[u.name], "in_hierarchy": bool(node), "reports_to": boss, "team_size": len(team),
				"preset": cfg.preset if cfg else None, "overrides": len(overrides), "configured": bool(cfg),
			}
		)
	return out


@frappe.whitelist()
def get_overview():
	"""Everything the screen needs in one call."""
	_viewer()
	return {**_registry(), "can_manage": access.is_admin(), "presets": _presets(), "people": _people(), "hierarchy": access.hierarchy_info(), "me": frappe.session.user, "login_template": _login_template()}


@frappe.whitelist()
def get_user_access(user):
	_viewer()
	if not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	cfg = access.configured(user)
	return {
		"user": user, "preset": cfg["preset"] if cfg else None, "overrides": cfg["overrides"] if cfg else {}, "profile": _profile(user),
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


def _profile(user):
	doc = frappe.get_doc("User", user)
	return {
		"first_name": doc.first_name, "last_name": doc.last_name, "mobile_no": doc.mobile_no, "image": doc.user_image, "enabled": bool(doc.enabled),
		"designation": doc.get("crm_designation"), "company": doc.get("crm_company"), "reports_to": _leader(user),
	}


def _node(user):
	if not frappe.db.exists("DocType", access.HIERARCHY):
		return None
	return frappe.db.get_value(access.HIERARCHY, {"user": user}, ["name", "reports_to"], as_dict=True)


def _leader(user):
	"""The user this person reports to in CRM's Sales Hierarchy (None when they are at the top or not in it)."""
	node = _node(user)
	if not node or not node.reports_to:
		return None
	return frappe.db.get_value(access.HIERARCHY, node.reports_to, "user")


def _place(user, leader):
	"""Put the person under a team leader in CRM's Sales Hierarchy (the leader is added at the top first when they are not in it yet).
	Passing no leader takes the person out from under anyone. Nothing happens when this CRM has no hierarchy."""
	if not frappe.db.exists("DocType", access.HIERARCHY):
		return
	meta = frappe.get_meta(access.HIERARCHY)
	boss = _node(leader) if leader else None
	if leader and not boss:
		frappe.get_doc({"doctype": access.HIERARCHY, "user": leader, **({"is_group": 1} if meta.has_field("is_group") else {})}).insert(ignore_permissions=True)
		boss = _node(leader)
	if boss and meta.has_field("is_group"):
		frappe.db.set_value(access.HIERARCHY, boss.name, "is_group", 1)
	mine = _node(user)
	if mine:
		if (mine.reports_to or None) != (boss.name if boss else None):
			doc = frappe.get_doc(access.HIERARCHY, mine.name)
			doc.reports_to = boss.name if boss else None
			doc.save(ignore_permissions=True)
	elif boss:
		frappe.get_doc({"doctype": access.HIERARCHY, "user": user, "reports_to": boss.name}).insert(ignore_permissions=True)


def _check_leader(user, leader):
	leader = cstr(leader).strip() or None
	if not leader:
		return None
	if leader == user:
		frappe.throw(_("A person cannot be their own team leader."))
	if not frappe.db.get_value("User", leader, "enabled"):
		frappe.throw(_("{0} is not an active user.").format(frappe.bold(leader)))
	# no loops: the leader must not already sit below this person (walk up from the leader through the reports-to links)
	cursor, steps = leader, 0
	while cursor and steps < 200:
		if cursor == user:
			frappe.throw(_("You cannot put {0} under {1}: {1} already reports to {0}.").format(frappe.bold(frappe.utils.get_fullname(user)), frappe.bold(frappe.utils.get_fullname(leader))))
		cursor, steps = _leader(cursor), steps + 1
	return leader


def _clean_number(value):
	value = cstr(value).strip()
	if not value:
		return ""
	digits = "".join(ch for ch in value if ch.isdigit())
	if not 7 <= len(digits) <= 15 or any(ch not in "+0123456789 -()." for ch in value):
		frappe.throw(_("{0} does not look like a phone number.").format(frappe.bold(value)))
	return value


def _apply_profile(doc, first_name=None, last_name=None, mobile_no=None, designation=None, company=None, user_image=None):
	if first_name is not None:
		doc.first_name = cstr(first_name).strip() or doc.first_name
	if last_name is not None:
		doc.last_name = cstr(last_name).strip()
	if mobile_no is not None:
		doc.mobile_no = _clean_number(mobile_no)
	if user_image is not None:
		doc.user_image = cstr(user_image).strip() or None
	for field, value in (("crm_designation", designation), ("crm_company", company)):
		if value is not None and frappe.get_meta("User").has_field(field):
			doc.set(field, cstr(value).strip()[:140])


@frappe.whitelist()
def add_person(email, first_name, last_name="", role="Sales User", preset=None, send_invite=1, mobile_no="", designation="", company="", user_image="", reports_to=None, send_whatsapp=0):
	"""Add a person to the CRM: a user with a CRM role (Frappe decides System User or Website User from the role's desk access, so on a site where Sales User has no desk access they are a Website User like the other agents), profile details, an optional preset and team leader, and (by default) the
	welcome email with the link to set a password.

	An existing user (for example a website user, or someone without a CRM role) is given the role instead of being created again."""
	_admin()
	email = cstr(email).strip().lower()
	first_name, last_name = cstr(first_name).strip(), cstr(last_name).strip()
	if not frappe.utils.validate_email_address(email):
		frappe.throw(_("{0} is not a valid email address.").format(frappe.bold(email or "-")))
	if role not in ("Sales User", "Sales Manager"):
		frappe.throw(_("Choose Sales User or Sales Manager."))
	if preset and not frappe.db.exists("CRM Access Preset", cstr(preset)):
		frappe.throw(_("Preset {0} was not found.").format(frappe.bold(cstr(preset))))
	mobile_no = _clean_number(mobile_no)
	leader = _check_leader(email, reports_to)
	created = False
	if frappe.db.exists("User", email):
		if email in ("Administrator", "Guest"):
			frappe.throw(_("That user cannot be changed here."))
		doc = frappe.get_doc("User", email)
		if not doc.enabled:
			frappe.throw(_("{0} is disabled. Enable the user first.").format(frappe.bold(email)))
		if role not in [r.role for r in doc.roles]:
			doc.add_roles(role)
		doc = frappe.get_doc("User", email)
		_apply_profile(doc, None, None, mobile_no or None, designation or None, company or None, user_image or None)
		doc.save(ignore_permissions=True)
	else:
		if not first_name:
			frappe.throw(_("Enter the first name."))
		doc = frappe.get_doc(
			{"doctype": "User", "email": email, "first_name": first_name, "last_name": last_name, "user_type": "System User", "send_welcome_email": 0, "roles": [{"role": role}]}
		)
		_apply_profile(doc, None, None, mobile_no, designation, company, user_image)
		doc.insert(ignore_permissions=True)
		created = True
	if preset:
		save_user_access(email, preset, {})
	problems = []
	if leader:
		try:
			_place(email, leader)
		except Exception as exc:
			frappe.clear_messages()
			problems.append(_("Could not put them under {0} in the Sales Hierarchy: {1}").format(leader, frappe.utils.strip_html(cstr(exc))[:160]))
	invited, problem = False, ""
	if created and cint(send_invite):
		try:
			doc.reload()
			doc.send_welcome_mail_to_user()
			invited = True
		except Exception as exc:
			frappe.clear_messages()
			problem = frappe.utils.strip_html(cstr(exc))[:200]
	if created and cint(send_whatsapp):
		try:
			from crm_addons import system_messages

			doc.reload()
			link = doc._reset_password(send_email=False) if hasattr(doc, "_reset_password") else doc.reset_password(send_email=False)
			system_messages.send_login_link(email, link)
		except Exception as exc:
			frappe.clear_messages()
			problems.append(_("The WhatsApp login link was not sent: {0}").format(frappe.utils.strip_html(cstr(exc))[:200]))
	access.clear()
	return {"user": email, "created": created, "invited": invited, "invite_problem": problem, "problems": problems}


@frappe.whitelist()
def update_person(user, first_name=None, last_name=None, mobile_no=None, designation=None, company=None, user_image=None, reports_to=None, set_leader=0):
	"""Change a person's profile and, when ``set_leader`` is on, who they report to (empty = nobody)."""
	_admin()
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	doc = frappe.get_doc("User", user)
	_apply_profile(doc, first_name, last_name, mobile_no, designation, company, user_image)
	doc.save(ignore_permissions=True)
	if cint(set_leader):
		_place(user, _check_leader(user, reports_to))
	access.clear()
	return _profile(user)


@frappe.whitelist()
def set_active(user, enabled):
	"""Switch a person's account on or off. Off = they can no longer log in (their data stays). Not for yourself or the last administrator."""
	_admin()
	enabled = cint(enabled)
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	if not enabled:
		if user == frappe.session.user:
			frappe.throw(_("You cannot switch off your own account."))
		if "System Manager" in frappe.get_roles(user):
			others = frappe.db.sql(
				"""select count(distinct u.name) from `tabUser` u join `tabHas Role` r on r.parent = u.name and r.parenttype = 'User'
				where r.role = 'System Manager' and u.enabled = 1 and u.name not in (%s, 'Administrator')""", user,
			)[0][0]
			if not others:
				frappe.throw(_("This is the last System Manager. Make someone else a System Manager first."))
	doc = frappe.get_doc("User", user)
	doc.enabled = enabled
	doc.save(ignore_permissions=True)
	access.clear()
	return {"user": user, "enabled": bool(enabled)}


# -- the Sales Hierarchy ---------------------------------------------------------------------------------------------------------


def _tree():
	"""Every person in CRM's Sales Hierarchy as a flat list, parents before children (built from the reports-to links, so it does not
	depend on how the tree is numbered): [{user, full_name, image, designation, enabled, reports_to, depth, below}]."""
	if not frappe.db.exists("DocType", access.HIERARCHY):
		return []
	rows = _hierarchy_rows()
	user_of = {r.name: r.user for r in rows}
	boss_of = {r.user: user_of.get(r.get("reports_to")) for r in rows}
	people = {u.name: u for u in frappe.get_all("User", filters={"name": ["in", list(boss_of) or [""]]}, fields=["name", "full_name", "user_image", "enabled"] + _extra_fields(), limit_page_length=5000)}
	kids = {}
	for user, boss in boss_of.items():
		kids.setdefault(boss if boss in boss_of else None, []).append(user)
	for k in kids.values():
		k.sort(key=lambda u: (people.get(u).full_name if people.get(u) else u).lower())
	roles = {}
	for row in frappe.get_all("Has Role", filters={"parenttype": "User", "parent": ["in", list(boss_of) or [""]], "role": ["in", list(CRM_ROLES)]}, fields=["parent", "role"], limit_page_length=20000):
		roles.setdefault(row.parent, []).append(row.role)
	out, seen = [], set()

	def count_below(user, path):
		path = path | {user}
		return sum(1 + count_below(c, path) for c in kids.get(user, []) if c not in path)

	def walk(user, depth):
		if user in seen:
			return
		seen.add(user)
		p = people.get(user)
		size = count_below(user, set())
		out.append({"user": user, "full_name": (p.full_name if p else user) or user, "image": p.user_image if p else None, "designation": p.get("crm_designation") if p else None,
			"enabled": bool(p.enabled) if p else False, "reports_to": boss_of.get(user), "depth": depth, "below": size, "roles": roles.get(user, [])})
		for c in kids.get(user, []):
			walk(c, depth + 1)

	for root in kids.get(None, []):
		walk(root, 0)
	for user in boss_of:  # a loop or a leader missing from the list: still shown, at the top
		if user not in seen:
			walk(user, 0)
	return out


@frappe.whitelist()
def get_hierarchy():
	"""The Sales Hierarchy for the Hierarchy page: the tree, and the people who are not in it yet."""
	_viewer()
	info = access.hierarchy_info()
	tree = _tree()
	placed = {n["user"] for n in tree}
	loose = [p for p in _people() if p["user"] not in placed and p["enabled"]]
	admin = frappe.db.get_value("User", "Administrator", ["full_name", "user_image"], as_dict=True) or {}
	return {
		**info, "tree": tree, "root": {"user": "Administrator", "full_name": admin.get("full_name") or "Administrator", "image": admin.get("user_image"), "roles": ["System Manager"]},
		"loose": [{"user": p["user"], "full_name": p["full_name"], "image": p["image"], "designation": p.get("designation"), "roles": p["roles"]} for p in loose],
	}


@frappe.whitelist()
def set_leader(user, reports_to=None):
	"""Put a person under a team leader (or at the top when none is given). Adds them to the hierarchy when they are not in it yet."""
	_admin()
	if not frappe.db.exists("DocType", access.HIERARCHY):
		frappe.throw(_("This CRM has no Sales Hierarchy."))
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("User {0} was not found.").format(frappe.bold(user)))
	leader = _check_leader(user, reports_to)
	if leader:
		_place(user, leader)
	else:
		if not _node(user):
			frappe.get_doc({"doctype": access.HIERARCHY, "user": user}).insert(ignore_permissions=True)
		else:
			_place(user, None)
	access.clear()
	return get_hierarchy()


@frappe.whitelist()
def remove_from_hierarchy(user):
	"""Take a person out of the hierarchy. Not possible while people report to them: move their team first."""
	_admin()
	node = _node(user)
	if not node:
		return get_hierarchy()
	if frappe.db.count(access.HIERARCHY, {"reports_to": node.name}):
		frappe.throw(_("Other people report to {0}. Move them first.").format(frappe.bold(user)))
	frappe.delete_doc(access.HIERARCHY, node.name, ignore_permissions=True, force=True)
	access.clear()
	return get_hierarchy()


@frappe.whitelist()
def set_hierarchy_enabled(enabled):
	"""CRM's own switch for using the Sales Hierarchy (Settings in CRM). 'My team' in this app follows the tree either way."""
	_admin()
	if not frappe.get_meta("FCRM Settings").has_field("enable_sales_hierarchy"):
		frappe.throw(_("This CRM has no Sales Hierarchy switch."))
	frappe.db.set_single_value("FCRM Settings", "enable_sales_hierarchy", cint(enabled))
	frappe.clear_cache()
	return get_hierarchy()
