"""Who may do what in Pro Pack: the resolver every other module asks.

    level("followups")                 -> "all" / "team" / "own" / "none"      (or "view" / "manage" / 1 / 0 for the other kinds)
    allows("automations", "manage")    -> True / False
    scope_users("followups")           -> None (everyone's) or the set of users whose records the person sees (empty = nothing)

Order of precedence for a person: Administrator and System Managers always have everything; otherwise the person's own override, then their
preset, then the *legacy* value for their role (what they got before any of this existed). Nothing configured = nothing changes.
"""

import json

import frappe
from frappe.utils import cstr

from crm_addons.team_access import registry as R
from crm_addons.utils import CAMPAIGN_ROLE, MANAGER_ROLES

PRESET = "CRM Access Preset"
USER_ACCESS = "CRM User Access"
HIERARCHY = "CRM Sales Hierarchy"


def _roles(user):
	return set(frappe.get_roles(user))


def is_admin(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or "System Manager" in _roles(user)


def legacy_value(feature, user=None):
	user = user or frappe.session.user
	roles = _roles(user)
	manager, campaign, other = feature["legacy"]
	if set(MANAGER_ROLES) & roles:
		return manager
	return campaign if CAMPAIGN_ROLE in roles else other


def _loads(text):
	try:
		data = json.loads(text or "{}")
	except ValueError:
		return {}
	return data if isinstance(data, dict) else {}


def configured(user):
	"""The preset name and override dict stored for a person, or None when an admin has not configured them."""
	if not frappe.db.exists("DocType", USER_ACCESS):
		return None
	row = frappe.db.get_value(USER_ACCESS, user, ["preset", "overrides"], as_dict=True)
	return {"preset": row.preset, "overrides": _loads(row.overrides)} if row else None


def preset_grants(name):
	if not name:
		return {}
	return _loads(frappe.db.get_value(PRESET, name, "grants"))


def explain(user=None):
	"""Every feature with its value for a person and where the value comes from: admin / override / preset / default."""
	user = user or frappe.session.user
	admin = is_admin(user)
	cfg = None if admin else configured(user)
	grants = preset_grants(cfg["preset"]) if cfg else {}
	out = {}
	for f in R.FEATURES:
		key = f["key"]
		if admin:
			out[key] = {"value": R.top(f), "source": "admin"}
		elif cfg and key in cfg["overrides"] and R.normalise(f, cfg["overrides"][key]) is not None:
			out[key] = {"value": R.normalise(f, cfg["overrides"][key]), "source": "override"}
		elif key in grants and R.normalise(f, grants[key]) is not None:
			out[key] = {"value": R.normalise(f, grants[key]), "source": "preset"}
		else:
			out[key] = {"value": legacy_value(f, user), "source": "default"}
	return out


def _cache():
	if not hasattr(frappe.local, "crm_access_cache"):
		frappe.local.crm_access_cache = {}
	return frappe.local.crm_access_cache


def clear():
	"""Forget what was worked out in this request (an admin just changed a preset or a person)."""
	frappe.local.crm_access_cache = {}


def level(feature, user=None):
	user = user or frappe.session.user
	f = R.BY_KEY[feature]
	cache = _cache()
	if user not in cache:
		cache[user] = {k: v["value"] for k, v in explain(user).items()}
	return cache[user][feature]


def allows(feature, minimum, user=None):
	"""Does the person have at least ``minimum`` of the feature? (A switch: ``allows("campaign_create", 1)``.)"""
	f = R.BY_KEY[feature]
	return R.rank(f, level(feature, user)) >= R.rank(f, minimum)


def require(feature, minimum, message, user=None):
	if not allows(feature, minimum, user):
		frappe.throw(message, frappe.PermissionError)


def team_users(user):
	"""The person and everyone below them in CRM's Sales Hierarchy (the same rule CRM uses for leads). Just the person when they are not
	in the tree, or when this CRM has no Sales Hierarchy."""
	if not frappe.db.exists("DocType", HIERARCHY):
		return {user}
	rows = frappe.db.sql(
		f"""select m.user from `tab{HIERARCHY}` g join `tab{HIERARCHY}` m on m.lft >= g.lft and m.lft <= g.rgt
		where g.user = %s and m.user is not null and m.user != ''""",
		user,
	)
	return {user} | {r[0] for r in rows}


def scope_users(feature, user=None):
	"""``None`` when the person sees everything, else the set of users whose records they see (empty when they see nothing)."""
	user = user or frappe.session.user
	value = level(feature, user)
	if value == R.ALL:
		return None
	if value == R.NONE:
		return set()
	return team_users(user) if value == R.TEAM else {user}


def can_see_user(feature, owner, user=None):
	"""Is a record owned by ``owner`` inside the person's scope for this feature?"""
	users = scope_users(feature, user)
	return users is None or owner in users


def sql_in(column, users):
	"""A SQL condition ``column in (...)`` for a scope set (``1 = 0`` for an empty set, empty string for everyone)."""
	if users is None:
		return ""
	if not users:
		return "1 = 0"
	return f"{column} in ({', '.join(frappe.db.escape(u) for u in sorted(users))})"


def my_access(user=None):
	"""What the browser needs to hide what the person cannot use: {feature: value} for the current person."""
	user = user or frappe.session.user
	return {k: v["value"] for k, v in explain(user).items()}


def hierarchy_info():
	"""For the admin screen: does this CRM have a Sales Hierarchy, is it switched on, and how many people are in it."""
	if not frappe.db.exists("DocType", HIERARCHY):
		return {"available": False, "enabled": False, "people": 0}
	enabled = False
	try:
		enabled = bool(frappe.db.get_single_value("FCRM Settings", "enable_sales_hierarchy"))
	except Exception:
		frappe.clear_messages()
	return {"available": True, "enabled": enabled, "people": frappe.db.count(HIERARCHY, {"user": ["is", "set"]})}
