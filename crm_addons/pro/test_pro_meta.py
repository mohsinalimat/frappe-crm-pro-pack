"""Meta lead ads: connecting, mapping, the signed webhook, a lead becoming a CRM Lead or a note on an existing one, and the log."""

import hashlib
import hmac
import json
from unittest.mock import patch

import frappe

from crm_addons.pro import meta
from crm_addons.team_access.test_access import AccessCase

QUESTIONS = [{"key": "full_name", "label": "Full name", "type": "FULL_NAME"}, {"key": "email", "label": "Email", "type": "EMAIL"},
	{"key": "phone_number", "label": "Phone", "type": "PHONE"}, {"key": "budget", "label": "Budget", "type": "CUSTOM"}]


def lead_payload(lid="L1", email="meta.person@example.com", platform="ig"):
	return {"id": lid, "created_time": "2026-10-28T10:00:00+0000", "platform": platform, "campaign_id": "c1", "campaign_name": "Diwali Offer", "adset_id": "a1", "adset_name": "Pune 25-40",
		"ad_id": "ad1", "ad_name": "Video 1", "form_id": "F1", "field_data": [{"name": "full_name", "values": ["Meera Iyer"]}, {"name": "email", "values": [email]},
		{"name": "phone_number", "values": ["+919811100022"]}, {"name": "budget", "values": ["50k"]}]}


class TestMeta(AccessCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		meta.save_connection(token="TOKEN-SECRET", app_id="123", app_secret="app-secret")
		frappe.get_doc({"doctype": meta.FORM, "form_id": "F1", "form_name": "Diwali form", "page_id": "P1", "page_name": "Acme", "page_token": "PAGE-TOKEN", "enabled": 1,
			"mapping": json.dumps({"full_name": "__full_name", "email": "email", "phone_number": "mobile_no", "budget": ""}), "questions": json.dumps(QUESTIONS)}).insert(ignore_permissions=True)

	def test_only_a_system_manager(self):
		frappe.set_user(self.person("meta-sales@example.com", "Sales User"))
		for call in (meta.get_overview, meta.test_connection, lambda: meta.save_connection(token="x"), lambda: meta.retry("x")):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_secrets_never_leave_the_server(self):
		out = json.dumps(meta.get_overview())
		for secret in ("TOKEN-SECRET", "app-secret", "PAGE-TOKEN"):
			self.assertNotIn(secret, out)
		self.assertTrue(meta.get_overview()["connected"])

	def test_an_empty_box_keeps_the_saved_token(self):
		meta.save_connection(token="", app_id="", app_secret="")
		self.assertEqual(meta._system_token(), "TOKEN-SECRET")

	def test_the_connection_test_names_the_missing_permissions(self):
		def fake(path, token, params=None, method="get"):
			if path == "me":
				return {"id": "1", "name": "CRM System User"}
			if path == "me/permissions":
				return {"data": [{"permission": "leads_retrieval", "status": "granted"}, {"permission": "pages_show_list", "status": "granted"}]}
			if path == "me/accounts":
				return {"data": [{"id": "P1", "name": "Acme", "access_token": "t"}]}
			return {"data": {"is_valid": True, "expires_at": 0}}
		with patch.object(meta, "graph", side_effect=fake):
			out = meta.test_connection()
		self.assertFalse(out["ok"])
		self.assertIn("pages_manage_metadata", out["message"])
		self.assertTrue(out["never_expires"])

	def test_a_bad_token_is_reported_not_raised(self):
		with patch.object(meta, "graph", side_effect=meta.MetaError("Invalid OAuth access token")):
			self.assertEqual(meta.test_connection(), {"ok": False, "message": "Invalid OAuth access token"})

	def test_adding_a_form_needs_a_name_and_a_way_to_find_duplicates(self):
		with self.assertRaises(frappe.ValidationError):
			meta._clean_mapping({"email": "email"})
		with self.assertRaises(frappe.ValidationError):
			meta._clean_mapping({"full_name": "__full_name"})
		with self.assertRaises(frappe.ValidationError):
			meta._clean_mapping({"full_name": "__full_name", "email": "no_such_field"})
		ok = meta._clean_mapping({"full_name": "__full_name", "email": "email"})
		self.assertEqual(ok["email"], "email")
		self.assertEqual(meta.default_mapping(QUESTIONS), {"full_name": "__full_name", "email": "email", "phone_number": "mobile_no", "budget": ""})

	def test_a_lead_becomes_a_crm_lead_with_its_source_and_ad(self):
		self.assertEqual(meta.process_lead("L1", "F1", "Webhook", lead_payload()), "Created")
		log = frappe.get_doc(meta.LOG, {"leadgen_id": "L1"})
		lead = frappe.get_doc("CRM Lead", log.lead)
		self.assertEqual((lead.first_name, lead.last_name, lead.email, lead.source), ("Meera", "Iyer", "meta.person@example.com", "Instagram"))
		self.assertEqual((lead.get("crm_meta_campaign_name"), lead.get("crm_meta_adset_name"), lead.get("crm_meta_ad_name"), lead.get("crm_meta_campaign_id")), ("Diwali Offer", "Pune 25-40", "Video 1", "c1"))
		self.assertEqual((log.result, log.via, log.source), ("Created", "Webhook", "Instagram"))
		note = " ".join(c.content for c in frappe.get_all("Comment", filters={"reference_name": lead.name}, fields=["content"]))
		self.assertIn("Diwali Offer", note)
		self.assertIn("Budget: 50k", note)  # an answer without a mapping is kept on the lead
		self.assertEqual(meta.process_lead("L1", "F1", "Retry", lead_payload()), "Created")  # the same lead twice changes nothing
		self.assertEqual(frappe.db.count("CRM Lead", {"email": "meta.person@example.com"}), 1)

	def test_facebook_is_the_default_source(self):
		meta.process_lead("L2", "F1", "Webhook", lead_payload("L2", "fb.person@example.com", "fb"))
		self.assertEqual(frappe.db.get_value("CRM Lead", frappe.db.get_value(meta.LOG, {"leadgen_id": "L2"}, "lead"), "source"), "Facebook")

	def test_someone_who_is_already_a_lead_is_noted_and_can_be_updated_with_one_click(self):
		existing = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Old", "email": "meta.person@example.com", "lead_owner": self.owner.name}).insert(ignore_permissions=True)
		self.assertEqual(meta.process_lead("L3", "F1", "Webhook", lead_payload("L3")), "Duplicate")
		self.assertEqual(frappe.db.count("CRM Lead", {"email": "meta.person@example.com"}), 1)
		log = frappe.get_doc(meta.LOG, {"leadgen_id": "L3"})
		self.assertEqual((log.result, log.lead, log.matched_by), ("Duplicate", existing.name, "email"))
		self.assertTrue(frappe.db.exists("Notification Log", {"document_name": existing.name, "for_user": self.owner.name}))
		entries = meta.entries_for_lead(existing.name)
		self.assertEqual(entries[log.comment]["entry"], log.name)
		self.assertEqual(entries[log.comment]["label"], "Meta lead ad")
		changed = meta.apply_entry(log.name, existing.name)
		self.assertIn("First Name", changed)
		self.assertEqual(frappe.db.get_value("CRM Lead", existing.name, "first_name"), "Meera")
		with self.assertRaises(frappe.ValidationError):
			meta.apply_entry(log.name, existing.name)  # only once

	def test_a_failed_fetch_is_logged_and_can_be_retried(self):
		with patch.object(meta, "graph", side_effect=meta.MetaError("(#100) Unsupported get request")):
			self.assertEqual(meta.process_lead("L4", "F1", "Webhook"), "Failed")
		log = frappe.get_doc(meta.LOG, {"leadgen_id": "L4"})
		self.assertIn("Unsupported", log.error)
		with patch.object(meta, "graph", return_value=lead_payload("L4", "retry.person@example.com")):
			self.assertEqual(meta.retry(log.name)["result"], "Created")
		self.assertEqual(frappe.db.get_value(meta.LOG, log.name, "result"), "Created")

	def test_a_form_that_is_off_or_unknown_is_ignored_and_logged(self):
		meta.set_form("F1", 0)
		self.assertEqual(meta.process_lead("L5", "F1", "Webhook", lead_payload("L5")), "Ignored")
		self.assertEqual(meta.process_lead("L6", "NOPE", "Webhook", lead_payload("L6")), "Ignored")
		self.assertEqual(frappe.db.count("CRM Lead", {"email": "meta.person@example.com"}), 0)

	def _post(self, body, secret="app-secret", sign=True):
		raw = json.dumps(body).encode()
		headers = {"X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()} if sign else {}
		old = getattr(frappe.local, "request", None)
		self.addCleanup(lambda: setattr(frappe.local, "request", old))
		frappe.local.request = type("R", (), {"method": "POST", "path": "/", "get_data": lambda self, as_text=False: raw, "headers": headers})()

	def test_the_webhook_answers_metas_verification_only_with_the_verify_token(self):
		old = getattr(frappe.local, "request", None)
		self.addCleanup(lambda: setattr(frappe.local, "request", old))
		frappe.local.request = type("R", (), {"method": "GET", "path": "/"})()
		token = meta._verify_token()
		frappe.form_dict.update({"hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "12345"})
		self.assertEqual(meta.webhook().get_data(as_text=True), "12345")
		frappe.form_dict["hub.verify_token"] = "wrong"
		with self.assertRaises(frappe.PermissionError):
			meta.webhook()

	def test_the_webhook_needs_a_valid_signature_and_queues_the_lead(self):
		body = {"entry": [{"changes": [{"field": "leadgen", "value": {"leadgen_id": "W1", "form_id": "F1", "page_id": "P1"}}]}]}
		self._post(body, sign=False)
		with self.assertRaises(frappe.PermissionError):
			meta.webhook()
		self._post(body, secret="wrong-secret")
		with self.assertRaises(frappe.PermissionError):
			meta.webhook()
		self._post(body)
		with patch("frappe.enqueue") as queue:
			meta.webhook()
		self.assertEqual(queue.call_args.kwargs["leadgen_id"], "W1")
		self.assertEqual(queue.call_args.kwargs["via"], "Webhook")

	def test_the_hourly_catch_up_picks_up_a_missed_lead_once(self):
		with patch.object(meta, "graph", return_value={"data": [lead_payload("C1", "catch.up@example.com")]}):
			meta.catch_up()
			meta.catch_up()
		self.assertEqual(frappe.db.count("CRM Lead", {"email": "catch.up@example.com"}), 1)
		self.assertEqual(frappe.db.get_value(meta.LOG, {"leadgen_id": "C1"}, "via"), "Catch-up")

	def test_the_form_test_checks_without_creating_anything(self):
		def fake(path, token, params=None, method="get"):
			if path.endswith("subscribed_apps"):
				return {"data": [{"subscribed_fields": ["leadgen"]}]}
			return {"id": "F1", "name": "Diwali form", "status": "ACTIVE"}
		before = frappe.db.count("CRM Lead")
		with patch.object(meta, "graph", side_effect=fake):
			out = meta.test_form("F1")
		self.assertTrue(out["ok"])
		self.assertEqual(out["sample"]["first_name"], "Asha")
		self.assertEqual(frappe.db.count("CRM Lead"), before)
