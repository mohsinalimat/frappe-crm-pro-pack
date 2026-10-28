"""The WhatsApp inbox: chats of numbers that are not leads, who sees what, assigning, turning a number into a lead."""

import frappe
from frappe.utils import add_to_date, now_datetime
from unittest.mock import patch

from crm_addons.pro import inbox
from crm_addons.team_access.test_access import AccessCase

NEW = "919811100001"


class TestInbox(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		self.boss = self.person("wa-boss@example.com", "Sales User")
		self.rep = self.person("wa-rep@example.com", "Sales User")
		self.other = self.person("wa-other@example.com", "Sales User")
		self.nobody = self.person("wa-none@example.com", "Sales User")
		self.configure(self.boss, overrides={"whatsapp_inbox": "all"})
		self.configure(self.rep, overrides={"whatsapp_inbox": "own"})
		self.configure(self.other, overrides={"whatsapp_inbox": "own"})
		self.configure(self.nobody, overrides={"whatsapp_inbox": "none"})

	def _msg(self, number, text, typ="Incoming", name="Maya", ago_hours=0, **extra):
		d = frappe.get_doc({"doctype": "WhatsApp Message", "type": typ, "message": text, "content_type": "text", "profile_name": name if typ == "Incoming" else None, "message_id": frappe.generate_hash(length=12), **extra})
		d.update({"from" if typ == "Incoming" else "to": number})
		inbox.on_validate(d)
		d.db_insert()
		d.creation = add_to_date(now_datetime(), hours=-ago_hours)
		frappe.db.set_value("WhatsApp Message", d.name, "creation", d.creation, update_modified=False)
		inbox.on_message(d)
		return d

	def _lead(self, mobile, owner=None, first="Wa"):
		return frappe.get_doc({"doctype": "CRM Lead", "first_name": first, "last_name": mobile[-4:], "mobile_no": mobile, "lead_owner": owner or self.rep}).insert(ignore_permissions=True)

	def test_a_message_from_an_unknown_number_makes_an_unassigned_chat(self):
		self._msg(NEW, "Hi, do you teach coding?")
		chat = frappe.get_doc("CRM WhatsApp Chat", inbox.key_of(NEW))
		self.assertEqual((chat.unread, chat.lead, chat.assigned_to, chat.contact_name), (1, None, None, "Maya"))
		frappe.set_user(self.boss)
		rows = inbox.list_chats(view="unassigned")["rows"]
		self.assertEqual([r["name"] for r in rows], [chat.name])
		self.assertTrue(rows[0]["mine"])  # nobody has it, so the manager owns the number
		self.assertEqual(inbox.get_access()["unread"], 1)

	def test_an_agent_only_sees_chats_assigned_to_them_and_their_own_leads(self):
		self._msg(NEW, "Hello")
		lead = self._lead("9822200001")
		self._msg("919822200001", "I am a lead", name="Lead")
		frappe.set_user(self.rep)
		self.assertEqual({r["name"] for r in inbox.list_chats()["rows"]}, {"9822200001"})
		self.assertEqual(inbox.get_access()["unread"], 1)
		with self.assertRaises(frappe.PermissionError):
			inbox.get_chat(inbox.key_of(NEW))
		frappe.set_user(self.boss)
		inbox.assign(inbox.key_of(NEW), self.rep)
		frappe.set_user(self.rep)
		self.assertEqual({r["name"] for r in inbox.list_chats()["rows"]}, {"9822200001", inbox.key_of(NEW)})
		self.assertEqual(inbox.get_access()["unread"], 2)
		frappe.set_user(self.other)
		self.assertEqual(inbox.list_chats()["rows"], [])
		self.assertEqual(inbox.get_access()["unread"], 0)

	def test_no_access_means_no_inbox_and_agents_cannot_assign(self):
		frappe.set_user(self.nobody)
		with self.assertRaises(frappe.PermissionError):
			inbox.list_chats()
		frappe.set_user(self.rep)
		with self.assertRaises(frappe.PermissionError):
			inbox.assign("x", self.rep)

	def test_opening_a_chat_clears_the_number_only_for_who_it_belongs_to(self):
		self._msg(NEW, "Hello")
		frappe.set_user(self.boss)
		inbox.assign(inbox.key_of(NEW), self.rep)
		inbox.get_chat(inbox.key_of(NEW))  # the manager looks; it is still the agent's number
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), "unread"), 1)
		frappe.set_user(self.rep)
		inbox.get_chat(inbox.key_of(NEW))
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), "unread"), 0)

	def test_free_text_only_inside_the_24_hour_window(self):
		self._msg(NEW, "old", ago_hours=30)
		frappe.set_user(self.boss)
		self.assertFalse(inbox.get_chat(inbox.key_of(NEW))["window_open"])
		with self.assertRaises(frappe.ValidationError):
			inbox.send(inbox.key_of(NEW), "hello")
		frappe.set_user("Administrator")
		self._msg(NEW, "new", ago_hours=1)
		frappe.set_user(self.boss)
		self.assertTrue(inbox.get_chat(inbox.key_of(NEW))["window_open"])
		base = "frappe_whatsapp.frappe_whatsapp.doctype.whatsapp_message.whatsapp_message.WhatsAppMessage."
		with patch(base + "before_insert"), patch(base + "set_whatsapp_account"):
			inbox.send(inbox.key_of(NEW), "Yes we do")
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), ["last_message", "last_direction"]), ("Yes we do", "Outgoing"))

	def test_not_a_lead_hides_the_chat_and_stops_the_count(self):
		self._msg(NEW, "buy my seo")
		frappe.set_user(self.boss)
		inbox.set_status(inbox.key_of(NEW), "Not a lead")
		self.assertEqual(inbox.list_chats()["rows"], [])
		self.assertEqual(len(inbox.list_chats(view="notlead")["rows"]), 1)
		self._msg(NEW, "buy now")
		self.assertEqual(inbox.get_access()["unread"], 0)
		inbox.set_status(inbox.key_of(NEW), "Open")
		self.assertEqual(len(inbox.list_chats()["rows"]), 1)

	def test_create_lead_moves_the_whole_chat_onto_the_lead(self):
		self._msg(NEW, "first")
		self._msg(NEW, "second")
		frappe.set_user(self.boss)
		inbox.assign(inbox.key_of(NEW), self.rep)
		out = inbox.create_lead(inbox.key_of(NEW), "Maya", "Rao", email="maya.rao@example.com")
		lead = frappe.get_doc("CRM Lead", out["lead"])
		self.assertEqual((lead.source, lead.lead_owner), ("WhatsApp", self.rep))
		self.assertEqual(frappe.db.count("WhatsApp Message", {"reference_name": lead.name}), 2)
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), "lead"), lead.name)
		with self.assertRaises(frappe.ValidationError):
			inbox.assign(inbox.key_of(NEW), self.other)  # a lead's chat follows its owner

	def test_a_number_that_becomes_a_lead_later_brings_its_chat(self):
		self._msg(NEW, "before")
		lead = self._lead("+91 98111 00001", first="Later")
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), "lead"), lead.name)
		self.assertEqual(frappe.db.count("WhatsApp Message", {"reference_name": lead.name}), 1)
		self._msg(NEW, "after")
		self.assertEqual(frappe.db.count("WhatsApp Message", {"reference_name": lead.name}), 2)

	def test_link_to_an_existing_lead(self):
		self._msg(NEW, "hey")
		lead = self._lead("9000000099", first="Existing")
		frappe.set_user(self.boss)
		inbox.link_lead(inbox.key_of(NEW), lead.name)
		self.assertEqual(frappe.db.get_value("CRM WhatsApp Chat", inbox.key_of(NEW), "lead"), lead.name)
		self._msg(NEW, "again")
		self.assertEqual(frappe.db.count("WhatsApp Message", {"reference_name": lead.name}), 2)

	def test_reactions_and_replies_are_folded_into_the_chat(self):
		first = self._msg(NEW, "hello")
		self._msg(NEW, "\U0001f44d", content_type="reaction", reply_to_message_id=first.message_id)
		self._msg(NEW, "re hello", is_reply=1, reply_to_message_id=first.message_id)
		frappe.set_user(self.boss)
		msgs = inbox.get_chat(inbox.key_of(NEW))["messages"]
		self.assertEqual(len(msgs), 2)
		self.assertEqual(msgs[0]["reaction"], "\U0001f44d")
		self.assertEqual(msgs[1]["reply_message"], "hello")
