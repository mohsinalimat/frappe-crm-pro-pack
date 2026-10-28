"""The WhatsApp inbox: every chat in one place, including numbers that are not leads yet.

Frappe CRM already files an incoming message under the lead whose number it matches; a message from any other number was stored and never shown.
Here each number is one *chat* (``CRM WhatsApp Chat``, named by the last ten digits). A chat of a lead follows the lead's owner; a chat of an
unknown number waits unassigned until someone with the "All chats" level picks a person. A number that later becomes a lead brings its whole chat along.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, get_datetime, now_datetime

from crm_addons.team_access import access

CHAT = "CRM WhatsApp Chat"
MSG = "WhatsApp Message"
LEAD = "CRM Lead"
WINDOW_HOURS = 24
FIELDS = ["name", "type", "to", "from", "content_type", "message_type", "attach", "template", "use_template", "message_id", "is_reply", "reply_to_message_id", "creation", "message", "status", "reference_doctype", "reference_name", "template_parameters", "template_header_parameters", "profile_name"]


def key_of(number):
	"""The chat a number belongs to: its digits, the last ten when there are more (country codes and a leading 0 differ between sources).

	Two numbers that end in the same ten digits but carry different country codes are different people, so the later one gets a chat of its own, keyed by all its digits."""
	digits = "".join(c for c in cstr(number) if c.isdigit())
	key = digits[-10:]
	code = digits[:-10].lstrip("0")  # a leading 0 is a trunk prefix, not a country code
	if code and key:
		held = "".join(c for c in cstr(frappe.db.get_value(CHAT, key, "number")) if c.isdigit())
		if held[:-10].lstrip("0") not in ("", code):
			return digits
	return key


# -- who may do what ------------------------------------------------------------------------------


def _level(user=None):
	return access.level("whatsapp_inbox", user)


def _check(manager=False):
	lvl = _level()
	if lvl == "none" or (manager and lvl != "all"):
		frappe.throw(_("You do not have access to the WhatsApp inbox.") if lvl == "none" else _("Only someone with access to all chats can do this."), frappe.PermissionError)
	return lvl


def _owner_of(row):
	"""Who is responsible for a chat: the lead's owner for a lead, the assigned person for any other number."""
	return row.get("lead_owner") if row.get("lead") else row.get("assigned_to")


def _can_open(chat, user=None):
	user = user or frappe.session.user
	lvl = _level(user)
	if lvl == "all":
		return True
	if lvl == "none":
		return False
	if chat.lead:
		owner, assign = frappe.db.get_value(LEAD, chat.lead, ["lead_owner", "_assign"]) or (None, None)
		return owner == user or user in cstr(assign)
	return chat.assigned_to == user


def _chat(key):
	if not frappe.db.exists(CHAT, key):
		frappe.throw(_("This chat does not exist."), frappe.DoesNotExistError)
	chat = frappe.get_doc(CHAT, key)
	if not _can_open(chat):
		frappe.throw(_("This chat is not assigned to you."), frappe.PermissionError)
	return chat


# -- keeping chats up to date ----------------------------------------------------------------------


def on_validate(doc, method=None):
	"""Stamp the chat key, and send a message of a number the inbox has already linked to a lead to that lead."""
	try:
		doc.crm_chat_key = key_of(doc.get("from") if doc.type == "Incoming" else doc.get("to"))
		if doc.crm_chat_key and not doc.get("reference_name"):
			lead = frappe.db.get_value(CHAT, doc.crm_chat_key, "lead") or _lead_for(doc.crm_chat_key)
			if lead:
				doc.reference_doctype, doc.reference_name = LEAD, lead
	except Exception:
		frappe.log_error(title="WhatsApp inbox: could not key a message", message=frappe.get_traceback())


def _lead_for(key):
	"""The lead whose phone ends with these digits, whatever way it was typed (+91 98111 00001, 098111-00001)."""
	if len(key) < 7:
		return None
	rows = frappe.db.sql("SELECT name FROM `tabCRM Lead` WHERE RIGHT(REGEXP_REPLACE(IFNULL(mobile_no, ''), '[^0-9]', ''), %s) = %s ORDER BY modified DESC LIMIT 1", (len(key), key))
	return rows[0][0] if rows else None


def _preview(doc):
	text = cstr(doc.get("message"))
	if doc.get("content_type") in ("image", "video", "audio", "document") and (not text or text == doc.get("attach")):
		return "[" + doc.content_type + "]"
	return text[:140]


def on_message(doc, method=None):
	"""Every message keeps its chat's last line, time and unread count current."""
	try:
		if doc.get("content_type") == "reaction" or doc.get("reference_doctype") not in (None, "", LEAD):
			return
		key = doc.get("crm_chat_key") or key_of(doc.get("from") if doc.type == "Incoming" else doc.get("to"))
		if not key:
			return
		incoming = doc.type == "Incoming"
		chat = frappe.get_doc(CHAT, key) if frappe.db.exists(CHAT, key) else frappe.new_doc(CHAT)
		if chat.is_new():
			chat.number_key = key
			chat.number = "+" + "".join(c for c in cstr(doc.get("from") if incoming else doc.get("to")) if c.isdigit())
		if incoming and doc.get("profile_name"):
			chat.contact_name = doc.profile_name
		if doc.get("reference_name") and doc.reference_doctype == LEAD:
			chat.lead = doc.reference_name
		chat.last_message, chat.last_at, chat.last_direction = _preview(doc), doc.creation, "Incoming" if incoming else "Outgoing"
		if incoming:
			chat.last_incoming_at = doc.creation
			if chat.status != "Not a lead":
				chat.unread = cint(chat.unread) + 1
		chat.flags.ignore_permissions = True
		chat.save() if not chat.is_new() else chat.insert()
		if incoming and chat.status != "Not a lead":
			_ping(chat)
	except Exception:
		frappe.log_error(title="WhatsApp inbox: could not file a message", message=frappe.get_traceback())


def _ping(chat):
	"""Tell the people responsible that a message came in, so their menu number moves without a refresh."""
	users = _inbox_users()
	owner = frappe.db.get_value(LEAD, chat.lead, "lead_owner") if chat.lead else chat.assigned_to
	for user in users:
		if user == owner or (not owner and _level(user) == "all"):
			frappe.publish_realtime("crm_wa_inbox", {"chat": chat.name}, user=user, after_commit=True)


def _inbox_users():
	return [u for u in frappe.get_all("User", filters={"enabled": 1, "user_type": "System User"}, pluck="name") if u != "Guest" and _level(u) != "none"]


def rebuild():
	"""Stamp the key on existing messages and make a chat for every number (run once on install)."""
	if not frappe.db.exists("DocType", MSG):
		return
	rows = frappe.get_all(MSG, fields=FIELDS, order_by="creation asc", limit_page_length=0)
	for r in rows:
		if r.reference_doctype not in (None, "", LEAD) or r.content_type == "reaction":
			continue
		key = key_of(r["from"] if r.type == "Incoming" else r["to"])
		if not key:
			continue
		if not r.get("crm_chat_key"):
			frappe.db.set_value(MSG, r.name, "crm_chat_key", key, update_modified=False)
		chat = frappe.get_doc(CHAT, key) if frappe.db.exists(CHAT, key) else frappe.get_doc({"doctype": CHAT, "number_key": key, "number": "+" + "".join(c for c in cstr(r["from"] if r.type == "Incoming" else r["to"]) if c.isdigit())})
		incoming = r.type == "Incoming"
		if incoming and r.profile_name:
			chat.contact_name = r.profile_name
		if r.reference_doctype == LEAD and r.reference_name:
			chat.lead = r.reference_name
		chat.last_message, chat.last_at, chat.last_direction = _preview(frappe._dict(r)), r.creation, "Incoming" if incoming else "Outgoing"
		if incoming:
			chat.last_incoming_at = r.creation
		chat.flags.ignore_permissions = True
		chat.save() if chat.get("creation") else chat.insert()


def attach_lead(lead_name, number=None):
	"""A number became a lead: its chat and every message in it move onto the lead."""
	number = number or frappe.db.get_value(LEAD, lead_name, "mobile_no")
	key = key_of(number)
	if not key or not frappe.db.exists(CHAT, key):
		return False
	chat = frappe.get_doc(CHAT, key)
	if chat.lead == lead_name:
		return False
	chat.db_set({"lead": lead_name, "status": "Open"}, update_modified=False)
	frappe.db.sql("UPDATE `tabWhatsApp Message` SET reference_doctype = %s, reference_name = %s WHERE crm_chat_key = %s AND (reference_name IS NULL OR reference_name = '')", (LEAD, lead_name, key))
	return True


def on_lead_saved(doc, method=None):
	try:
		if doc.get("mobile_no") and (doc.is_new() or doc.has_value_changed("mobile_no") or method == "after_insert"):
			attach_lead(doc.name, doc.mobile_no)
	except Exception:
		frappe.log_error(title="WhatsApp inbox: could not attach a chat to a lead", message=frappe.get_traceback())


def on_lead_deleted(doc, method=None):
	frappe.db.sql("UPDATE `tabCRM WhatsApp Chat` SET lead = NULL WHERE lead = %s", doc.name)


# -- reading ---------------------------------------------------------------------------------------


def _visible_sql(user):
	lvl = _level(user)
	if lvl == "all":
		return "1 = 1", {}
	return "((c.lead IS NULL AND c.assigned_to = %(me)s) OR (c.lead IS NOT NULL AND (l.lead_owner = %(me)s OR l._assign LIKE %(like)s)))", {"me": user, "like": f"%{user}%"}


@frappe.whitelist()
def get_access():
	"""What the person may do here, and how many chats are waiting on them (the number on the menu)."""
	lvl = _level()
	if lvl == "none":
		return {"level": "none", "unread": 0}
	where, vals = _visible_sql(frappe.session.user)
	mine = "(c.lead IS NOT NULL AND l.lead_owner = %(me)s) OR (c.lead IS NULL AND c.assigned_to = %(me)s)" + (" OR (c.lead IS NULL AND (c.assigned_to IS NULL OR c.assigned_to = ''))" if lvl == "all" else "")
	n = frappe.db.sql(f"SELECT COUNT(*) FROM `tabCRM WhatsApp Chat` c LEFT JOIN `tabCRM Lead` l ON l.name = c.lead WHERE c.unread > 0 AND c.status = 'Open' AND {where} AND ({mine})", {**vals, "me": frappe.session.user})[0][0]
	return {"level": lvl, "manager": lvl == "all", "unread": n}


@frappe.whitelist()
def list_chats(view="all", search=None, page=1, page_size=40):
	"""The chats the person may open, newest first. ``view``: all, unread, new (numbers that are not leads), mine, unassigned, notlead."""
	_check()
	page, size = max(1, cint(page)), min(max(1, cint(page_size)), 100)
	where, vals = _visible_sql(frappe.session.user)
	where = [where]
	vals["me"] = frappe.session.user
	if view == "notlead":
		where.append("c.status = 'Not a lead'")
	else:
		where.append("c.status = 'Open'")
	if view == "unread":
		where.append("c.unread > 0")
	elif view == "new":
		where.append("c.lead IS NULL")
	elif view == "leads":
		where.append("c.lead IS NOT NULL")
	elif view == "mine":
		where.append("((c.lead IS NOT NULL AND l.lead_owner = %(me)s) OR (c.lead IS NULL AND c.assigned_to = %(me)s))")
	elif view == "unassigned":
		where.append("c.lead IS NULL AND (c.assigned_to IS NULL OR c.assigned_to = '')")
	txt = cstr(search).strip()
	if txt:
		where.append("(c.number LIKE %(q)s OR c.contact_name LIKE %(q)s OR l.lead_name LIKE %(q)s OR c.last_message LIKE %(q)s)")
		vals["q"] = f"%{txt}%"
	base = f"FROM `tabCRM WhatsApp Chat` c LEFT JOIN `tabCRM Lead` l ON l.name = c.lead WHERE {' AND '.join(where)}"
	total = frappe.db.sql(f"SELECT COUNT(*) {base}", vals)[0][0]
	rows = frappe.db.sql(
		f"""SELECT c.name, c.number, c.contact_name, c.lead, c.assigned_to, c.status, c.last_message, c.last_at, c.last_direction, c.unread, l.lead_name, l.lead_owner
		{base} ORDER BY c.last_at DESC LIMIT %(limit)s OFFSET %(offset)s""", {**vals, "limit": size, "offset": (page - 1) * size}, as_dict=True)
	names = {u.name: u.full_name for u in frappe.get_all("User", filters={"name": ["in", list({r.lead_owner or r.assigned_to for r in rows if (r.lead_owner or r.assigned_to)})]}, fields=["name", "full_name"])} if rows else {}
	for r in rows:
		owner = r.lead_owner if r.lead else r.assigned_to
		r["title"] = r.lead_name or r.contact_name or r.number
		r["owner"], r["owner_name"] = owner, names.get(owner) or owner
		r["last_at"] = cstr(r["last_at"])
		r["mine"] = owner == frappe.session.user or (not owner and _level() == "all")
		if not r["mine"]:
			r["unread"] = 0  # the number belongs to whoever the chat is assigned to
	return {"rows": rows, "total": total, "page": page, "page_size": size, "counts": _counts()}


def _counts():
	"""The numbers on the filter chips, for what the person may open (chats marked not a lead are left out)."""
	where, vals = _visible_sql(frappe.session.user)
	vals["me"] = frappe.session.user
	mine = "((c.lead IS NOT NULL AND l.lead_owner = %(me)s) OR (c.lead IS NULL AND c.assigned_to = %(me)s)" + (" OR (c.lead IS NULL AND (c.assigned_to IS NULL OR c.assigned_to = ''))" if _level() == "all" else "") + ")"
	row = frappe.db.sql(f"""SELECT COUNT(*), SUM(c.unread > 0 AND {mine}), SUM(c.lead IS NOT NULL), SUM(c.lead IS NULL), SUM(c.lead IS NULL AND (c.assigned_to IS NULL OR c.assigned_to = ''))
		FROM `tabCRM WhatsApp Chat` c LEFT JOIN `tabCRM Lead` l ON l.name = c.lead WHERE c.status = 'Open' AND {where}""", vals)[0]
	return {"all": cint(row[0]), "unread": cint(row[1]), "leads": cint(row[2]), "new": cint(row[3]), "unassigned": cint(row[4])}


def _messages(chat):
	rows = frappe.get_all(MSG, filters={"crm_chat_key": chat.name}, fields=FIELDS, order_by="creation asc", limit_page_length=0)
	if chat.lead:
		known = {r.name for r in rows}
		rows += [r for r in frappe.get_all(MSG, filters={"reference_doctype": LEAD, "reference_name": chat.lead}, fields=FIELDS, order_by="creation asc", limit_page_length=0) if r.name not in known]
		rows.sort(key=lambda r: cstr(r.creation))
	rows = [dict(r) for r in rows]
	templates = {}
	for m in rows:
		if m["message_type"] == "Template" and m["template"] and frappe.db.exists("WhatsApp Templates", m["template"]):
			t = templates.get(m["template"]) or templates.setdefault(m["template"], frappe.get_doc("WhatsApp Templates", m["template"]))
			from crm.api.whatsapp import parse_template_parameters

			m["template_name"] = t.template_name
			body, header = t.template, t.header
			if m["template_parameters"]:
				body = parse_template_parameters(body, json.loads(m["template_parameters"]))
			if m["template_header_parameters"]:
				header = parse_template_parameters(header, json.loads(m["template_header_parameters"]))
			m["template"], m["header"], m["footer"] = body, header, t.footer
	by_id = {m["message_id"]: m for m in rows if m["message_id"]}
	for m in reversed([m for m in rows if m["content_type"] == "reaction"]):
		target = by_id.get(m["reply_to_message_id"])
		if target:
			target["reaction"] = m["message"]
	for m in rows:
		m["from_name"] = (chat.contact_name or m.get("profile_name") or chat.number) if m["from"] else _("You")
		if m["is_reply"] and by_id.get(m["reply_to_message_id"]):
			t = by_id[m["reply_to_message_id"]]
			m.update({"reply_message": t["template"] if t["message_type"] == "Template" else t["message"], "reply_to": t["name"], "reply_to_type": t["type"], "reply_to_from": (chat.contact_name or chat.number) if t["from"] else _("You")})
	return [{k: v for k, v in m.items() if k not in ("profile_name",)} for m in rows if m["content_type"] != "reaction"]


@frappe.whitelist()
def get_chat(key):
	"""One chat: its messages, whether free text is still allowed (24 hours after the person's last message), and who may do what with it."""
	chat = _chat(key)
	msgs = _messages(chat)
	last_in = max((m["creation"] for m in msgs if m["type"] == "Incoming"), default=None)
	until = add_to_date(get_datetime(last_in), hours=WINDOW_HOURS) if last_in else None
	open_ = bool(until and until > now_datetime())
	owner = frappe.db.get_value(LEAD, chat.lead, "lead_owner") if chat.lead else chat.assigned_to
	if cint(chat.unread) and (owner == frappe.session.user or (not owner and _level() == "all")):
		chat.db_set("unread", 0, update_modified=False)
	lead = frappe.db.get_value(LEAD, chat.lead, ["name", "lead_name", "status", "lead_owner", "email", "organization", "mobile_no", "source"], as_dict=True) if chat.lead else None
	if lead:
		lead["owner_name"] = frappe.db.get_value("User", lead.lead_owner, "full_name") if lead.lead_owner else None
		lead["status_color"] = frappe.db.get_value("CRM Lead Status", lead.status, "color") if lead.status else None
	can_write = True
	if chat.lead:
		try:
			can_write = bool(frappe.get_doc(LEAD, chat.lead).has_permission("write"))
		except Exception:
			can_write = False
	elif _level() == "own" and chat.assigned_to != frappe.session.user:
		can_write = False
	return {"chat": {"name": chat.name, "number": chat.number, "title": (lead and lead.lead_name) or chat.contact_name or chat.number, "contact_name": chat.contact_name, "lead": lead, "assigned_to": chat.assigned_to, "status": chat.status, "owner": owner},
		"messages": msgs, "window_open": open_, "window_until": cstr(until) if open_ else None, "last_incoming": cstr(last_in) if last_in else None, "can_write": can_write, "manager": _level() == "all"}


# -- acting on a chat ------------------------------------------------------------------------------


def _reply_target(chat, reply_to):
	if not reply_to:
		return ""
	if frappe.db.get_value(MSG, reply_to, "crm_chat_key") != chat.name and not (chat.lead and frappe.db.exists(MSG, {"name": reply_to, "reference_name": chat.lead})):
		frappe.throw(_("That message is not in this chat."))
	return reply_to


def _ready(chat):
	data = get_chat(chat.name)
	if not data["can_write"]:
		frappe.throw(_("This chat is not yours to write in."), frappe.PermissionError)
	if not data["window_open"]:
		frappe.throw(_("They have not written in the last 24 hours, so WhatsApp only allows a template. Send a template first."))


def _new_message(chat, text, attach, content_type, reply_to):
	doc = frappe.new_doc(MSG)
	if reply_to:
		original = frappe.get_doc(MSG, reply_to)
		doc.update({"is_reply": True, "reply_to_message_id": original.message_id})
	doc.update({"message": text or attach, "to": chat.number.lstrip("+"), "attach": attach, "content_type": content_type})
	if chat.lead:
		doc.update({"reference_doctype": LEAD, "reference_name": chat.lead})
	doc.insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def send(key, message="", attach="", content_type="text", reply_to=""):
	chat = _chat(key)
	text, attach = cstr(message).strip(), cstr(attach).strip()
	content_type = content_type if content_type in ("text", "image", "video", "document", "audio") else "text"
	if not text and not attach:
		frappe.throw(_("Write a message first."))
	_ready(chat)
	_new_message(chat, text, attach, content_type, _reply_target(chat, reply_to))
	return True


@frappe.whitelist()
def react(key, message, emoji=""):
	chat = _chat(key)
	_ready(chat)
	target = _reply_target(chat, message)
	if not target or not frappe.db.get_value(MSG, target, "message_id"):
		frappe.throw(_("This message cannot be reacted to yet."))
	_new_message(chat, cstr(emoji).strip()[:8], "", "reaction", target)
	return True


@frappe.whitelist()
def templates(key):
	"""The approved templates, with the variables each one asks for."""
	chat = _chat(key)
	out = []
	from crm_addons.campaigns import personalization

	for t in frappe.get_all("WhatsApp Templates", fields=["name", "template_name", "template", "language_code", "status", "header_type"], order_by="template_name asc", limit_page_length=500):
		if cstr(t.status).upper() != "APPROVED" or t.header_type:
			continue
		out.append({"name": t.name, "label": t.template_name or t.name, "body": t.template, "variables": sorted(personalization.placeholders_in(t.template))})
	return {"templates": out, "lead": chat.lead}


@frappe.whitelist()
def send_template(key, template, values=None):
	chat = _chat(key)
	if not frappe.db.exists("WhatsApp Templates", {"name": template}):
		frappe.throw(_("Choose a template."))
	data = get_chat(key)
	if not data["can_write"]:
		frappe.throw(_("This chat is not yours to write in."), frappe.PermissionError)
	if chat.lead:
		from crm_addons.pro import bulk_send

		bulk_send.send_whatsapp(names=json.dumps([chat.lead]), template=template)
		return True
	vals = json.loads(values) if isinstance(values, str) and values else (values or {})
	from crm_addons.campaigns import personalization

	wanted = sorted(personalization.placeholders_in(frappe.db.get_value("WhatsApp Templates", template, "template")))
	if any(not cstr(vals.get(str(n))).strip() for n in wanted):
		frappe.throw(_("Fill in every variable of the template."))
	doc = frappe.new_doc(MSG)
	doc.update({"message_type": "Template", "message": "Template message", "content_type": "text", "use_template": True, "template": template, "to": chat.number.lstrip("+"), "body_param": json.dumps({str(n): cstr(vals.get(str(n))).strip() for n in wanted})})
	doc.insert(ignore_permissions=True)
	return True


@frappe.whitelist()
def assignable_users():
	_check(manager=True)
	return [{"value": u, "label": frappe.db.get_value("User", u, "full_name") or u} for u in _inbox_users()]


@frappe.whitelist()
def assign(key, user=None):
	"""Give a new number to someone (or take it back). A lead's chat follows the lead's owner instead."""
	_check(manager=True)
	chat = frappe.get_doc(CHAT, key)
	if chat.lead:
		frappe.throw(_("This chat belongs to a lead. Change the lead's owner to move it."))
	if user and _level(user) == "none":
		frappe.throw(_("{0} has no access to the WhatsApp inbox.").format(user))
	chat.db_set("assigned_to", user or None)
	if user:
		frappe.publish_realtime("crm_wa_inbox", {"chat": chat.name}, user=user, after_commit=True)
	return {"assigned_to": user or None}


@frappe.whitelist()
def set_status(key, status):
	"""Mark a number as not a lead, or put it back."""
	chat = _chat(key)
	if chat.lead:
		frappe.throw(_("This chat belongs to a lead."))
	if status not in ("Open", "Not a lead"):
		frappe.throw(_("Unknown status."))
	chat.db_set({"status": status, "unread": 0 if status == "Not a lead" else chat.unread})
	return {"status": status}


@frappe.whitelist()
def search_leads(txt=""):
	_check()
	like = f"%{cstr(txt).strip()}%"
	return frappe.get_list(LEAD, or_filters={"name": ["like", like], "lead_name": ["like", like], "mobile_no": ["like", like], "email": ["like", like]} if cstr(txt).strip() else None,
		fields=["name", "lead_name", "mobile_no", "email"], order_by="modified desc", limit_page_length=10)


@frappe.whitelist()
def link_lead(key, lead):
	"""This number belongs to a lead that is already in the CRM."""
	chat = _chat(key)
	if chat.lead:
		frappe.throw(_("This chat is already a lead."))
	doc = frappe.get_doc(LEAD, lead)
	if _level() != "all":
		doc.check_permission("write")
	chat.db_set({"lead": lead, "status": "Open"}, update_modified=False)
	frappe.db.sql("UPDATE `tabWhatsApp Message` SET reference_doctype = %s, reference_name = %s WHERE crm_chat_key = %s AND (reference_name IS NULL OR reference_name = '')", (LEAD, lead, key))
	if not doc.mobile_no:
		doc.db_set("mobile_no", chat.number)
	return {"lead": lead}


@frappe.whitelist()
def create_lead(key, first_name, last_name="", email="", organization=""):
	"""Make a lead of this number, source WhatsApp, owned by whoever it was assigned to (or by the person creating it). The chat moves onto the lead."""
	chat = _chat(key)
	if chat.lead:
		frappe.throw(_("This chat is already a lead."))
	if not cstr(first_name).strip():
		frappe.throw(_("Enter the person's name."))
	doc = frappe.get_doc({"doctype": LEAD, "first_name": cstr(first_name).strip(), "last_name": cstr(last_name).strip(), "email": cstr(email).strip(), "organization": cstr(organization).strip(), "mobile_no": chat.number, "source": "WhatsApp", "lead_owner": chat.assigned_to or frappe.session.user})
	doc.insert()
	attach_lead(doc.name, chat.number)
	return {"lead": doc.name}
