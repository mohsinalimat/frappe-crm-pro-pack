"""Lead assignment: rules for new leads, one-click assignment of existing leads, and moving leads from one person to others.

Only a System Manager can use any of it (every whitelisted function checks), and the CRM left-menu link and the Campaign
Manager's "Assignment" item are shown to them only.

* **Rules** say "a lead whose fields look like this goes to these people". Any Lead field and any mix of conditions (all of
  them, or any of them). People are shared by round robin, by least workload (open leads plus follow-ups still to do), or all of
  them together (the first person is the lead owner, the others are assigned too and can work the same lead).
* **New leads** are assigned by every enabled rule they match when they are created. A lead that matches several rules goes to
  everyone those rules name; the administrator is warned about overlapping rules when saving one and has to agree.
* **Existing leads** are assigned on request: a rule, or conditions typed in, for all matching leads or only those with no owner.
* **Transfer** moves everything one person (or several) has to other people.

Assigning is done the way CRM does it (the lead owner field, a ToDo assignment, CRM's own notification to the person, a
share), and never sends an email. More than SYNC_LIMIT leads are done in a background job; every assignment is written to
``CRM Assignment Log``.
"""

import json

import frappe
from frappe import _
from frappe.desk.form.assign_to import _add as add_assignment
from frappe.desk.form.assign_to import set_status as set_assignment_status
from frappe.utils import cint, cstr, now_datetime

from crm_addons.campaigns import audience

RULE = "CRM Assignment Rule"
LOG = "CRM Assignment Log"
LEAD = "CRM Lead"
SYNC_LIMIT = 300
UNDO_HOURS = 24  # how long an assignment can be taken back
MODES = ("Round robin", "Least workload", "All of them")
SCOPES = ("unassigned", "all")
CRM_ROLES = ("Sales User", "Sales Manager", "System Manager")


def _admin():
	# not frappe.only_for(): that one lets everybody through while tests run
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can assign leads."), frappe.PermissionError)


def _json(value, default):
	if value in (None, ""):
		return default
	if isinstance(value, (list, dict)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("That is not valid JSON."))


# -- people -------------------------------------------------------------------------------------------------


def _enabled_users(users):
	"""``users`` without the ones that are disabled or missing, in the same order."""
	users = [u for u in dict.fromkeys(users) if u]
	if not users:
		return []
	ok = set(frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name"))
	return [u for u in users if u in ok]


def _clean_users(raw):
	users = [cstr(u).strip() for u in _json(raw, [])]
	users = [u for u in dict.fromkeys(users) if u]
	unknown = [u for u in users if not frappe.db.exists("User", u)]
	if unknown:
		frappe.throw(_("Unknown user: {0}").format(", ".join(unknown)))
	return users


def workload(users):
	"""{user: open leads + follow-ups still to do}. This is what "least workload" balances."""
	users = list(users)
	if not users:
		return {}
	load = dict.fromkeys(users, 0)
	for r in frappe.db.sql(
		"""select lead_owner as u, count(*) as n from `tabCRM Lead` where ifnull(converted, 0) = 0 and lead_owner in %(u)s group by lead_owner""",
		{"u": tuple(users)},
		as_dict=True,
	):
		load[r.u] += cint(r.n)
	for r in frappe.db.sql(
		"""select assigned_to as u, count(*) as n from `tabCRM Follow Up` where next_closed = 0 and next_follow_up_on is not null
		and assigned_to in %(u)s group by assigned_to""",
		{"u": tuple(users)},
		as_dict=True,
	):
		load[r.u] += cint(r.n)
	return load


class Distributor:
	"""Hands out people for one lead at a time, by the chosen way of sharing."""

	def __init__(self, users, mode, rule_name=None):
		self.users = _enabled_users(users)
		self.mode = mode if mode in MODES else "Round robin"
		self.rule_name = rule_name
		self.local = 0
		self.load = workload(self.users) if self.mode == "Least workload" else {}

	def _position(self):
		if self.rule_name and frappe.db.exists(RULE, self.rule_name):
			at = cint(frappe.db.get_value(RULE, self.rule_name, "rr_index", for_update=True))
			frappe.db.set_value(RULE, self.rule_name, "rr_index", at + 1, update_modified=False)
			return at
		self.local += 1
		return self.local - 1

	def next(self):
		if not self.users:
			return []
		if self.mode == "All of them":
			return list(self.users)
		if self.mode == "Least workload":
			user = min(self.users, key=lambda u: (self.load.get(u, 0), self.users.index(u)))
			self.load[user] = self.load.get(user, 0) + 1
			return [user]
		return [self.users[self._position() % len(self.users)]]


# -- rules ----------------------------------------------------------------------------------------------------


def rule_users(rule):
	return _json(rule.get("assignees"), [])


def validate_rule(doc):
	conditions = audience.clean_filters(doc.conditions)
	if not conditions:
		frappe.throw(_("Add at least one condition, otherwise the rule would match every lead."))
	doc.conditions = json.dumps([[f, op, v] for _dt, f, op, v in conditions])
	doc.assignees = json.dumps(_clean_users(doc.assignees))
	if not json.loads(doc.assignees):
		frappe.throw(_("Choose at least one person."))
	if doc.distribution not in MODES:
		frappe.throw(_("Choose how the people share the leads."))


def _filters(conditions, match_mode):
	rows = audience.clean_filters(conditions)
	return ([], rows) if match_mode == "Any condition" else (rows, [])


def rule_filters(rule):
	return _filters(rule.get("conditions"), rule.get("match_mode"))


def match_names(filters, or_filters, extra=None, limit=0):
	return frappe.get_all(LEAD, filters=(filters or []) + (extra or []), or_filters=or_filters or None, pluck="name", limit_page_length=limit or 0)


def rule_matches(rule, lead_name):
	f, o = rule_filters(rule)
	return bool(frappe.get_all(LEAD, filters=f + [[LEAD, "name", "=", lead_name]], or_filters=o or None, pluck="name", limit_page_length=1))


def enabled_rules():
	return frappe.get_all(RULE, filters={"enabled": 1}, fields=["*"], order_by="priority asc, creation asc")


def _field_sets(conditions):
	"""{field: set of values} for the equals / is-any-of conditions of a rule."""
	out = {}
	for _dt, field, op, value in audience.clean_filters(conditions):
		if op == "=":
			out.setdefault(field, set()).add(cstr(value).lower())
		elif op == "in":
			out.setdefault(field, set()).update(cstr(v).lower() for v in value)
	return out


def may_overlap(a, b):
	"""Can one lead match both rules? False only when it is provable: both need ALL conditions, and some field is pinned to
	different values by each (Bihar against Delhi). Anything else may well overlap (Bihar against School)."""
	if a.get("match_mode") == "Any condition" or b.get("match_mode") == "Any condition":
		return True
	fa, fb = _field_sets(a.get("conditions")), _field_sets(b.get("conditions"))
	return not any(fa[f] and fb[f] and not (fa[f] & fb[f]) for f in fa.keys() & fb.keys())


def clashes_for(doc):
	"""Other enabled rules that can match the same lead as ``doc``, with how many existing leads match both."""
	out = []
	mine = None
	for other in enabled_rules():
		if other.name == doc.get("name") or not may_overlap(doc, other):
			continue
		if mine is None:
			mine = set(match_names(*rule_filters(doc)))
		both = len(mine & set(match_names(*rule_filters(other))))
		out.append({"rule": other.name, "people": rule_users(other), "existing_leads": both})
	return out


# -- assigning one lead ----------------------------------------------------------------------------------------


def _open_assignees(lead):
	return frappe.get_all("ToDo", filters={"reference_type": LEAD, "reference_name": lead, "status": ["not in", ["Closed", "Cancelled"]]}, pluck="allocated_to")


def _set_assignment(lead, owner, ensure, cancel):
	"""CRM's own way: cancelling a ToDo clears the owner (CRM does that), so the owner is set again after; the owner is
	shared the lead; everyone in ``ensure`` gets a ToDo (which is also what makes CRM notify them, never by email)."""
	for user in dict.fromkeys(cancel):
		set_assignment_status(LEAD, lead, None, user, "Cancelled", ignore_permissions=True)
	have = set(_open_assignees(lead))
	for user in dict.fromkeys(ensure):
		if user not in have:
			add_assignment({"assign_to": [user], "doctype": LEAD, "name": lead}, ignore_permissions=True)
	# CRM makes the newest assignment the owner, so the owner is put back last
	frappe.db.set_value(LEAD, lead, "lead_owner", owner or None, update_modified=False)
	if owner:
		frappe.get_doc(LEAD, lead).share_with_agent(owner)


def _log(lead, source, before, after, rule="", mode="", note="", prev_owner="", batch=""):
	title = frappe.db.get_value(LEAD, lead, "lead_name") or lead
	frappe.get_doc(
		{
			"doctype": LOG, "lead": lead, "lead_name": title, "source": source, "rule": rule, "from_users": ", ".join(before), "to_users": ", ".join(after),
			"distribution": mode, "by_user": frappe.session.user, "note": note, "prev_owner": prev_owner or "", "batch": batch or "",
		}
	).insert(ignore_permissions=True)


def assign_lead(lead, users, source, rule="", mode="", note="", batch=""):
	"""Make ``users`` the people on ``lead``: the first is the owner, the rest share it. Anyone else loses it."""
	users = _enabled_users(users)
	if not users or not frappe.db.exists(LEAD, lead):
		return False
	prev_owner = frappe.db.get_value(LEAD, lead, "lead_owner")
	before = sorted(set(_open_assignees(lead)) | ({prev_owner} - {None}))
	if before == sorted(users) and prev_owner == users[0]:
		return False
	_set_assignment(lead, users[0], users, [u for u in _open_assignees(lead) if u not in users])
	_log(lead, source, before, sorted(users), rule, mode, note, prev_owner, batch)
	return True


def transfer_lead(lead, from_users, new_users, mode="", batch=""):
	"""Take the lead off ``from_users`` and put ``new_users`` on it. Other people already on it stay."""
	new_users = _enabled_users(new_users)
	if not new_users or not frappe.db.exists(LEAD, lead):
		return False
	owner = frappe.db.get_value(LEAD, lead, "lead_owner")
	current = set(_open_assignees(lead)) | ({owner} - {None})
	moving = [u for u in from_users if u in current]
	if not moving:
		return False
	keep_owner = owner if owner and owner not in from_users else new_users[0]
	_set_assignment(lead, keep_owner, new_users, moving)
	_log(lead, "Transfer", sorted(current), sorted((current - set(moving)) | set(new_users)), mode=mode, prev_owner=owner, batch=batch)
	return True


# -- new leads ----------------------------------------------------------------------------------------------------


def people_for(lead, rules, distributors):
	"""Everyone the given rules send ``lead`` to (each rule picks its own people), without repeats, rule order."""
	out = []
	for rule in rules:
		d = distributors.setdefault(rule.name, Distributor(rule_users(rule), rule.distribution, rule.name))
		for u in d.next():
			if u not in out:
				out.append(u)
	return out


def _count(rules_used):
	for name, n in rules_used.items():
		frappe.db.sql("update `tabCRM Assignment Rule` set assigned_count = ifnull(assigned_count, 0) + %s, last_assigned_on = %s where name = %s", (n, now_datetime(), name))


def auto_assign(lead):
	"""A lead was just created: every enabled rule it matches sends it to its people."""
	rules = [r for r in enabled_rules() if rule_matches(r, lead)]
	if not rules:
		return
	users = people_for(lead, rules, {})
	if users and assign_lead(lead, users, "New lead", ", ".join(r.name for r in rules), ", ".join(dict.fromkeys(r.distribution for r in rules))):
		_count({r.name: 1 for r in rules})


def on_lead_insert(doc, method=None):
	"""``CRM Lead`` after_insert. Assigning must never stop a lead from being created."""
	if frappe.flags.get("in_assignment") or frappe.flags.get("in_import"):
		return
	try:
		if frappe.db.exists("DocType", RULE) and frappe.db.exists(RULE, {"enabled": 1}):
			frappe.flags.in_assignment = True
			auto_assign(doc.name)
			doc.lead_owner = frappe.db.get_value(LEAD, doc.name, "lead_owner")
	except Exception:
		frappe.log_error(title="CRM Pro Pack: lead assignment rule failed", message=frappe.get_traceback())
	finally:
		frappe.flags.in_assignment = False


# -- existing leads: preview and apply ---------------------------------------------------------------------------


def _scope_filters(scope):
	return [[LEAD, "lead_owner", "is", "not set"]] if scope == "unassigned" else []


def _sample(names, n=8):
	if not names:
		return []
	return frappe.get_all(LEAD, filters={"name": ["in", names[:n]]}, fields=["name", "lead_name", "lead_owner", "status"])


def _definition(data):
	data = _json(data, {})
	mode = data.get("match_mode") if data.get("match_mode") in ("All conditions", "Any condition") else "All conditions"
	conditions = audience.clean_filters(data.get("conditions"))
	if not conditions:
		frappe.throw(_("Add at least one condition."))
	return [[f, op, v] for _dt, f, op, v in conditions], mode


def _targets(conditions, mode, scope):
	f, o = _filters(conditions, mode)
	return match_names(f, o, _scope_filters(scope))


def _stage(kind, payload):
	"""Run in this request when small, in a background job when big."""
	payload["batch"] = frappe.generate_hash(length=10)
	names = payload.get("names") or payload.get("logs") or []
	if len(names) <= SYNC_LIMIT:
		return {"queued": False, **_apply(kind, payload)}
	frappe.enqueue("crm_addons.assignment.job", queue="long", timeout=3 * 3600, kind=kind, payload=payload, user=frappe.session.user, enqueue_after_commit=True)
	return {"queued": True, "count": len(names)}


def job(kind, payload, user):
	frappe.set_user(user)
	result = _apply(kind, payload)
	frappe.get_doc(
		{"doctype": LOG, "lead": "-", "lead_name": _("Batch finished"), "source": "Batch", "to_users": ", ".join(payload.get("people", [])),
		 "by_user": user, "batch": payload.get("batch", ""), "note": _("{0} lead(s) done, {1} left as they were.").format(result["assigned"], result["skipped"])}
	).insert(ignore_permissions=True)
	frappe.db.commit()


def _apply(kind, p):
	assigned = skipped = 0
	used = {}
	if kind == "rules":  # leads, by every enabled rule they match
		chosen = {r.name: r for r in frappe.get_all(RULE, filters={"name": ["in", p["rules"]]}, fields=["*"])}  # the rule asked for, even if switched off
		rules = {**{r.name: r for r in enabled_rules()}, **chosen}
		dist = {}
		for lead in p["names"]:
			matching = [chosen[n] for n in p["rules"] if n in chosen and rule_matches(chosen[n], lead)] if p.get("only_rules") else [r for r in rules.values() if rule_matches(r, lead)]
			users = people_for(lead, matching, dist) if matching else []
			if users and assign_lead(lead, users, "Rule run", ", ".join(r.name for r in matching), ", ".join(dict.fromkeys(r.distribution for r in matching)), batch=p.get("batch", "")):
				assigned += 1
				for r in matching:
					used[r.name] = used.get(r.name, 0) + 1
			else:
				skipped += 1
		_count(used)
	elif kind == "manual":
		d = Distributor(p["people"], p["distribution"])
		for lead in p["names"]:
			users = d.next()
			if users and assign_lead(lead, users, "Manual", mode=p["distribution"], batch=p.get("batch", "")):
				assigned += 1
			else:
				skipped += 1
	elif kind == "transfer":
		d = Distributor(p["people"], p["distribution"])
		for lead in p["names"]:
			users = d.next()
			if users and transfer_lead(lead, p["from_users"], users, p["distribution"], p.get("batch", "")):
				assigned += 1
			else:
				skipped += 1
	elif kind == "undo":
		for name in p["logs"]:
			if _undo_row(name):
				assigned += 1
			else:
				skipped += 1
	return {"assigned": assigned, "skipped": skipped}


def _users(text):
	return {u.strip() for u in cstr(text).split(",") if u.strip()}


def _undo_row(name):
	"""Put one lead back as it was, if nothing has changed it since and the time to take it back has not run out."""
	row = frappe.db.get_value(LOG, name, ["lead", "from_users", "to_users", "prev_owner", "undone", "creation"], as_dict=True)
	if not row or cint(row.undone) or row.lead in (None, "-") or not frappe.db.exists(LEAD, row.lead):
		return False
	if (now_datetime() - row.creation).total_seconds() > UNDO_HOURS * 3600:
		return False
	owner = frappe.db.get_value(LEAD, row.lead, "lead_owner")
	open_now = set(_open_assignees(row.lead))
	if (open_now | ({owner} - {None})) != _users(row.to_users):
		return False  # somebody has changed the assignment since: leave it alone
	before = _users(row.from_users)
	_set_assignment(row.lead, row.prev_owner or None, sorted(before), [u for u in open_now if u not in before])
	frappe.db.set_value(LOG, name, {"undone": 1, "undone_on": now_datetime()}, update_modified=False)
	return True


# -- whitelisted API ---------------------------------------------------------------------------------------------


@frappe.whitelist()
def list_people():
	"""People that can be given leads, with their present workload (what "least workload" looks at)."""
	_admin()
	names = frappe.get_all("Has Role", filters={"role": ["in", list(CRM_ROLES)], "parenttype": "User"}, pluck="parent")
	users = frappe.get_all("User", filters={"name": ["in", list(set(names) - {"Administrator", "Guest"})], "enabled": 1}, fields=["name", "full_name"], order_by="full_name asc")
	load = workload([u.name for u in users])
	return [{"name": u.name, "full_name": u.full_name or u.name, "load": load.get(u.name, 0)} for u in users]


def _rule_row(r, others):
	return {
		"name": r.name, "enabled": cint(r.enabled), "priority": cint(r.priority), "description": r.description or "", "match_mode": r.match_mode,
		"conditions": _json(r.conditions, []), "assignees": rule_users(r), "distribution": r.distribution, "assigned_count": cint(r.assigned_count),
		"last_assigned_on": cstr(r.last_assigned_on) if r.last_assigned_on else None,
		"overlaps": [o.name for o in others if o.name != r.name and may_overlap(r, o)],
		"ack": _json(r.clash_ack, []),
	}


@frappe.whitelist()
def list_rules():
	_admin()
	rules = frappe.get_all(RULE, fields=["*"], order_by="priority asc, creation asc")
	live = [r for r in rules if cint(r.enabled)]
	return [_rule_row(r, live) for r in rules]


def _doc_from(data, name=None):
	data = _json(data, {})
	doc = frappe.get_doc(RULE, name) if name else frappe.new_doc(RULE)
	for f in ("rule_name", "description", "match_mode", "distribution"):
		if f in data:
			doc.set(f, data[f])
	if "enabled" in data:
		doc.enabled = 1 if cint(data["enabled"]) else 0
	if "priority" in data:
		doc.priority = cint(data["priority"])
	if "conditions" in data:
		doc.conditions = data["conditions"] if isinstance(data["conditions"], str) else json.dumps(data["conditions"])
	if "assignees" in data:
		doc.assignees = data["assignees"] if isinstance(data["assignees"], str) else json.dumps(data["assignees"])
	return doc


@frappe.whitelist()
def save_rule(data, name=None, confirm=0):
	"""Create or change a rule. When another enabled rule can match the same leads and the administrator has not yet agreed
	to share with it, nothing is saved: the clashes come back to be confirmed (``confirm=1`` saves and remembers the choice)."""
	_admin()
	doc = _doc_from(data, name)
	validate_rule(doc)
	if cint(doc.enabled):
		ack = set(_json(doc.clash_ack, []))
		clashes = [c for c in clashes_for(doc) if c["rule"] not in ack]
		if clashes and not cint(confirm):
			return {"needs_confirm": True, "clashes": clashes, "mine": _json(doc.assignees, [])}
		doc.clash_ack = json.dumps(sorted(ack | {c["rule"] for c in clashes}))
	doc.save(ignore_permissions=True)
	return {"saved": True, "name": doc.name}


@frappe.whitelist()
def set_enabled(name, enabled, confirm=0):
	_admin()
	doc = frappe.get_doc(RULE, name)
	if cint(enabled):
		doc.enabled = 1
		ack = set(_json(doc.clash_ack, []))
		clashes = [c for c in clashes_for(doc) if c["rule"] not in ack]
		if clashes and not cint(confirm):
			return {"needs_confirm": True, "clashes": clashes, "mine": rule_users(doc)}
		doc.clash_ack = json.dumps(sorted(ack | {c["rule"] for c in clashes}))
	else:
		doc.enabled = 0
	doc.save(ignore_permissions=True)
	return {"saved": True}


@frappe.whitelist()
def delete_rule(name):
	_admin()
	frappe.delete_doc(RULE, name, ignore_permissions=True)
	return {"deleted": True}


@frappe.whitelist()
def preview_rule(name, scope="unassigned"):
	"""How many leads the rule would assign now, who they would go to, and which of them other rules also claim."""
	_admin()
	scope = scope if scope in SCOPES else "unassigned"
	rule = frappe.get_doc(RULE, name)
	names = match_names(*rule_filters(rule), _scope_filters(scope))
	others = [o for o in enabled_rules() if o.name != rule.name and may_overlap(rule, o)]
	shared = []
	if names:
		mine = set(names)
		for o in others:
			n = len(mine & set(match_names(*rule_filters(o))))
			if n:
				shared.append({"rule": o.name, "leads": n, "people": rule_users(o)})
	return {"count": len(names), "sample": _sample(names), "also_matched_by": shared, "people": _enabled_users(rule_users(rule))}


@frappe.whitelist()
def run_rule(name, scope="unassigned", confirm=0):
	"""Assign the existing leads a rule matches. Leads other rules also match go to those rules' people too, which needs a yes."""
	_admin()
	scope = scope if scope in SCOPES else "unassigned"
	rule = frappe.get_doc(RULE, name)
	pre = preview_rule(name, scope)
	if pre["also_matched_by"] and not cint(confirm):
		return {"needs_confirm": True, "clashes": pre["also_matched_by"], "count": pre["count"]}
	names = match_names(*rule_filters(rule), _scope_filters(scope))
	return _stage("rules", {"names": names, "rules": [rule.name], "only_rules": 0 if pre["also_matched_by"] else 1, "people": rule_users(rule)})


def _manual_args(data):
	data = _json(data, {})
	conditions, mode = _definition(data)
	people = _enabled_users(_clean_users(data.get("assignees")))
	if not people:
		frappe.throw(_("Choose at least one person."))
	dist = data.get("distribution")
	if dist not in MODES:
		frappe.throw(_("Choose how the people share the leads."))
	scope = data.get("scope") if data.get("scope") in SCOPES else "unassigned"
	return conditions, mode, people, dist, scope


@frappe.whitelist()
def preview_manual(data):
	_admin()
	conditions, mode, people, _dist, scope = _manual_args(data)
	names = _targets(conditions, mode, scope)
	return {"count": len(names), "sample": _sample(names), "people": people}


@frappe.whitelist()
def assign_manual(data):
	_admin()
	conditions, mode, people, dist, scope = _manual_args(data)
	names = _targets(conditions, mode, scope)
	if not names:
		return {"queued": False, "assigned": 0, "skipped": 0}
	return _stage("manual", {"names": names, "people": people, "distribution": dist})


def _owned_by(users, scope):
	"""Leads whose owner, or whose assignment, is one of ``users``. ``scope`` "open" leaves out converted ones."""
	users = tuple(users)
	extra = " and ifnull(l.converted, 0) = 0" if scope == "open" else ""
	return [
		r[0]
		for r in frappe.db.sql(
			f"""select distinct l.name from `tabCRM Lead` l where (l.lead_owner in %(u)s or exists (select 1 from `tabToDo` t where t.reference_type = 'CRM Lead'
			and t.reference_name = l.name and t.allocated_to in %(u)s and t.status not in ('Closed', 'Cancelled'))){extra}""",
			{"u": users},
		)
	]


@frappe.whitelist()
def preview_transfer(from_users, scope="open"):
	_admin()
	users = _clean_users(from_users)
	if not users:
		frappe.throw(_("Choose who to move the leads from."))
	scope = "all" if scope == "all" else "open"
	per = {u: len(_owned_by([u], scope)) for u in users}
	names = _owned_by(users, scope)
	return {"count": len(names), "per_user": per, "sample": _sample(names)}


@frappe.whitelist()
def transfer(from_users, to_users, distribution, scope="open"):
	"""Move every lead that is owned by, or assigned to, the ``from_users`` onto the ``to_users``."""
	_admin()
	src = _clean_users(from_users)
	dest = _enabled_users(_clean_users(to_users))
	if not src or not dest:
		frappe.throw(_("Choose who to move the leads from and who to move them to."))
	if set(src) & set(dest):
		frappe.throw(_("The same person cannot be both the source and the destination."))
	if distribution not in MODES:
		frappe.throw(_("Choose how the people share the leads."))
	names = _owned_by(src, "all" if scope == "all" else "open")
	if not names:
		return {"queued": False, "assigned": 0, "skipped": 0}
	return _stage("transfer", {"names": names, "from_users": src, "people": dest, "distribution": distribution})


@frappe.whitelist()
def list_log(limit=200, lead=None):
	_admin()
	filters = {"lead": lead} if lead else {}
	return frappe.get_all(LOG, filters=filters, fields=["name", "lead", "lead_name", "source", "rule", "from_users", "to_users", "distribution", "by_user", "note", "creation", "batch", "undone"], order_by="creation desc", limit_page_length=min(cint(limit) or 200, 1000))


@frappe.whitelist()
def list_history(limit=60):
	"""What was assigned, newest first: one line per run (a rule run, an assign-now, a move) or per new lead, with whether it can still be undone."""
	_admin()
	rows = frappe.get_all(
		LOG, filters={"source": ["!=", "Batch"]}, order_by="creation desc", limit_page_length=3000,
		fields=["name", "lead", "lead_name", "source", "rule", "from_users", "to_users", "by_user", "creation", "batch", "undone"],
	)
	groups, order = {}, []
	now = now_datetime()
	for r in rows:
		key = r.batch or r.name
		if key not in groups:
			if len(order) >= min(cint(limit) or 60, 200):
				continue
			groups[key] = {"id": key, "batch": r.batch or "", "entry": "" if r.batch else r.name, "source": r.source, "rule": r.rule, "from_users": r.from_users, "to_users": r.to_users,
				"by_user": r.by_user, "creation": cstr(r.creation), "count": 0, "undone": 0, "open": 0, "sample": []}
			order.append(key)
		g = groups[key]
		g["count"] += 1
		if cint(r.undone):
			g["undone"] += 1
		elif (now - r.creation).total_seconds() <= UNDO_HOURS * 3600:
			g["open"] += 1
		if len(g["sample"]) < 3:
			g["sample"].append({"lead": r.lead, "lead_name": r.lead_name})
	return {"undo_hours": UNDO_HOURS, "groups": [groups[k] for k in order]}


@frappe.whitelist()
def undo(batch=None, entry=None):
	"""Take back a run (``batch``) or a single assignment (``entry``) made in the last UNDO_HOURS hours. Leads somebody has
	changed since are left alone and counted as skipped."""
	_admin()
	if batch:
		names = frappe.get_all(LOG, filters={"batch": batch, "source": ["!=", "Batch"], "undone": 0}, pluck="name")
	elif entry:
		names = [entry]
	else:
		frappe.throw(_("Choose what to undo."))
	if not names:
		return {"queued": False, "assigned": 0, "skipped": 0}
	return _stage("undo", {"logs": names})
