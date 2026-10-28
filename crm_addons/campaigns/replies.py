"""WhatsApp saved replies: short messages with variables that anyone can drop into a chat from the lead page (type / in the message box).

They are not templates: nothing is sent from here. The chosen reply is filled in for the lead and shown in the message box, where the person can change it before sending."""

import json

import frappe
from frappe import _
from frappe.utils import cstr

KEY = "crm_pro_whatsapp_replies_v2"
MAX = 200


def all_replies():
	try:
		saved = json.loads(frappe.db.get_default(KEY) or "[]")
	except ValueError:
		saved = []
	if not isinstance(saved, list):
		return []
	return [{"id": cstr(r.get("id")), "title": cstr(r.get("title")), "text": cstr(r.get("text"))} for r in saved if isinstance(r, dict) and r.get("id") and r.get("title") and r.get("text")]


def _write(rows):
	frappe.db.set_default(KEY, json.dumps(rows))
	return rows


def save(title, text, reply_id=None):
	title, text = cstr(title).strip()[:60], cstr(text).strip()[:1000]
	if not title or not text:
		frappe.throw(_("Give the reply a short title and a message."))
	rows = all_replies()
	if reply_id:
		row = next((r for r in rows if r["id"] == reply_id), None)
		if not row:
			frappe.throw(_("This saved reply no longer exists."), frappe.DoesNotExistError)
		row.update(title=title, text=text)
	else:
		if len(rows) >= MAX:
			frappe.throw(_("You can keep up to {0} saved replies.").format(MAX))
		rows.append({"id": frappe.generate_hash(length=8), "title": title, "text": text})
	return _write(rows)


def remove(reply_id):
	return _write([r for r in all_replies() if r["id"] != reply_id])
