# Copyright (c) 2026, Siddharth Singh
"""A Sales User sees only their own data, WhatsApp templates are created through frappe_whatsapp, and campaign email templates
are kept in step with CRM's own Email Templates.

Run on a bench:  bench --site <site> run-tests --app crm_addons --module crm_addons.test_access_and_sync
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons import dashboard, followups
from crm_addons.campaigns import api as capi
from crm_addons.campaigns import email_sync


def make_user(email, roles):
	if frappe.db.exists("User", email):
		frappe.delete_doc("User", email, force=1)
	user = frappe.get_doc({"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0, "enabled": 1}).insert(ignore_permissions=True)
	user.add_roles(*roles)
	return user.name


class TestSalesUserSeesOnlyTheirOwn(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.a = make_user("acc_a@example.com", ["Sales User"])
		cls.b = make_user("acc_b@example.com", ["Sales User"])
		cls.mgr = make_user("acc_mgr@example.com", ["Sales Manager"])
		cls.leads = {}
		for user in (cls.a, cls.b):
			lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": user.split("@")[0], "lead_owner": user}).insert(ignore_permissions=True)
			cls.leads[user] = lead.name
			frappe.set_user(user)
			ref = {"reference_doctype": "CRM Lead", "reference_docname": lead.name}
			frappe.get_doc({"doctype": "CRM Call Log", "id": "acc-" + lead.name, "from": "1", "to": "2", "type": "Outgoing", "status": "Completed", "duration": 1, "caller": user, **ref}).insert(ignore_permissions=True)
			frappe.get_doc({"doctype": "FCRM Note", "title": "n", "content": "x", **ref}).insert(ignore_permissions=True)
			frappe.get_doc({"doctype": "CRM Task", "title": "t", "assigned_to": user, **ref}).insert(ignore_permissions=True)
			frappe.get_doc({"doctype": "CRM Follow Up", "mode": "Call", "outcome": "Interested", "remark": "r", "assigned_to": user, **ref}).insert(ignore_permissions=True)
			frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")

	def seen(self, user, doctype):
		frappe.set_user(user)
		field = "name" if doctype == "CRM Lead" else "reference_docname"
		return {r[field] for r in frappe.get_list(doctype, fields=[field], limit_page_length=500)}

	def test_lists_are_limited_for_a_sales_user_and_open_for_a_manager(self):
		for doctype in ("CRM Lead", "CRM Call Log", "FCRM Note", "CRM Task", "CRM Follow Up"):
			mine = self.seen(self.a, doctype)
			self.assertIn(self.leads[self.a], mine, doctype)
			self.assertNotIn(self.leads[self.b], mine, doctype)
			both = self.seen(self.mgr, doctype)
			self.assertTrue({self.leads[self.a], self.leads[self.b]} <= both, doctype)

	def test_another_users_records_cannot_be_opened_directly(self):
		frappe.set_user(self.a)
		self.assertTrue(frappe.has_permission("CRM Lead", "read", doc=self.leads[self.a]))
		self.assertFalse(frappe.has_permission("CRM Lead", "read", doc=self.leads[self.b]))
		for doctype in ("CRM Call Log", "FCRM Note", "CRM Task", "CRM Follow Up"):
			name = frappe.get_all(doctype, filters={"reference_docname": self.leads[self.b]}, pluck="name")[0]
			self.assertFalse(frappe.has_permission(doctype, "read", doc=name), doctype)

	def test_the_follow_ups_panel_ignores_who_is_asked_for(self):
		frappe.set_user(self.a)
		for tab in ("worked", "overdue", "today", "upcoming", "done"):
			res = followups.get_workspace(tab=tab, scope="all", owner=self.b)
			self.assertNotIn(self.leads[self.b], {i["reference_docname"] for i in res["items"]}, tab)
			self.assertEqual(res["owners"], [])
			self.assertFalse(res["scope"]["is_manager"])
		worked = followups.get_workspace(tab="worked")["items"]
		self.assertEqual([(i["reference_docname"], i["remark"], i["calls_today"]) for i in worked], [(self.leads[self.a], "r", 1)])

	def test_only_managers_customise_a_dashboard_and_campaign_results_are_company_wide(self):
		frappe.set_user(self.a)
		with self.assertRaises(frappe.PermissionError):
			dashboard.save_layout("sales", json.dumps({"kpis": [], "widgets": []}))
		self.assertIsNone(dashboard.get_layout("sales"))
		self.assertIsNone(dashboard.get_nurturing(user=self.b)["scope"]["user"])
		frappe.set_user(self.mgr)
		self.assertIsNotNone(dashboard.save_layout("sales", json.dumps({"kpis": [], "widgets": []})))

	def test_create_campaign_is_for_managers_not_sales_users(self):
		cm = make_user("acc_cm@example.com", ["Campaign Manager"])
		for user, expected in ((self.a, False), (self.mgr, True), (cm, True), ("Administrator", True)):
			frappe.set_user(user)
			self.assertEqual(capi.get_config()["is_manager"], expected, user)


class TestWhatsAppCreate(FrappeTestCase):
	DATA = {"template_name": "acc_reminder", "category": "marketing", "language": "en", "template": "Hello {{1}}, see you {{2}}.", "sample_values": ["Sid", "Monday"],
		"header_type": "TEXT", "header": "Reminder", "footer": "Reply STOP", "buttons": [{"button_type": "Quick Reply", "button_label": "Yes"}]}

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_checks_before_anything_is_sent_to_meta(self):
		for bad in ({"template": "Hello {{2}}", "sample_values": ["a"]}, {"template": "Hi {{1}}", "sample_values": []}, {"template_name": "Bad Name!"}, {"category": "AUTHENTICATION"}, {"header_type": "IMAGE"}):
			with self.assertRaises(frappe.ValidationError, msg=str(bad)):
				capi._template_fields(dict(self.DATA, **bad))
		fields = capi._template_fields(self.DATA)
		self.assertEqual((fields["category"], fields["sample_values"]), ("MARKETING", "Sid,Monday"))

	def test_a_sales_user_cannot_create_one(self):
		frappe.set_user(make_user("acc_wa_sales@example.com", ["Sales User"]))
		with self.assertRaises(frappe.PermissionError):
			capi.create_whatsapp_template(json.dumps(self.DATA))


class TestEmailTemplateSync(FrappeTestCase):
	BODY = '<table style="background:#fff"><tr><td style="color:red">Hi {{ first_name }} from {{ organization }}, I am {{ owner_name }}.</td></tr></table>'

	def setUp(self):
		frappe.set_user("Administrator")

	def test_a_campaign_template_shows_up_in_crm_and_renders_the_same(self):
		saved = capi.save_email_template({"template_name": "acc_sync_one", "subject": "Hello {{ first_name }}", "body_html": self.BODY, "editor_mode": "HTML"})
		twin = frappe.get_doc("Email Template", saved["crm_email_template"])
		self.assertEqual((twin.use_html, twin.reference_doctype), (1, "CRM Lead"))
		self.assertIn("<table", twin.response_html)
		self.assertIn("color:red", twin.response_html)
		lead = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Zed", "organization": "Acme", "lead_owner": "Administrator"}).insert(ignore_permissions=True)
		out = twin.get_formatted_email({**lead.as_dict(), "doc": lead.as_dict()})
		self.assertEqual(out["subject"], "Hello Zed")
		self.assertIn(f"Hi Zed from Acme, I am {frappe.utils.get_fullname('Administrator')}.", out["message"])
		self.assertNotIn("{{", out["message"])

	def test_an_edit_in_crm_comes_back_and_a_crm_template_is_mirrored(self):
		saved = capi.save_email_template({"template_name": "acc_sync_two", "subject": "S", "body_html": self.BODY, "editor_mode": "Visual Builder", "builder_json": "{}"})
		twin = frappe.get_doc("Email Template", saved["crm_email_template"])
		twin.response_html = twin.response_html.replace("Hi {{ first_name }}", "Dear {{ doc.first_name }}")
		twin.save(ignore_permissions=True)
		back = frappe.get_doc("CRM Campaign Email Template", "acc_sync_two")
		self.assertIn("Dear {{ first_name }}", back.body_html)
		self.assertIn("{{ owner_name }}", back.body_html)
		self.assertEqual(back.editor_mode, "HTML")  # edited as code in CRM, so the builder's blocks no longer apply
		made = frappe.get_doc({"doctype": "Email Template", "subject": "Hi {{ doc.first_name }}", "use_html": 1, "response_html": "<p>Hello {{ first_name }}</p>", "reference_doctype": "CRM Lead", "enabled": 1})
		setattr(made, "__newname", "acc_from_crm")  # (not made.__newname: inside a class that name is mangled)
		made.insert(ignore_permissions=True)
		self.assertEqual(frappe.db.get_value("CRM Campaign Email Template", "acc_from_crm", "subject"), "Hi {{ first_name }}")

	def test_the_translation_is_reversible(self):
		text = "{{ first_name }} {{ owner_name }} {{ sender_name }} {{ today }} {{ lead_url }}"
		self.assertEqual(email_sync.from_crm(email_sync.to_crm(text)), text)


class TestDefaultTemplatesAndMapping(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_the_default_email_templates_are_valid_builder_templates(self):
		from crm_addons.campaigns import default_templates as dt

		items = dt.default_templates()
		self.assertGreaterEqual(len(items), 8)
		for name, subject, category, _desc, builder_json, html in items:
			doc = json.loads(builder_json)
			self.assertTrue(doc["blocks"], name)
			self.assertIn("<table", html, name)
			tpl = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "t " + name, "subject": subject, "category": category,
				"editor_mode": "Visual Builder", "builder_json": builder_json, "body_html": html})
			tpl.validate()  # no variable the campaign engine does not know

	def test_a_variable_map_is_checked_and_kept_with_the_template(self):
		data = dict(TestWhatsAppCreate.DATA, variable_map={"1": "{{ first_name }}", "2": "{{ organization }}"})
		self.assertEqual(capi._template_fields(data)["variable_map"], {"1": "{{ first_name }}", "2": "{{ organization }}"})
		with self.assertRaises(frappe.ValidationError):
			capi._template_fields(dict(data, variable_map={"1": "{{ not_a_field }}", "2": ""}))


class TestWhatsAppNames(FrappeTestCase):
	def test_names_follow_metas_rules_and_are_unique_per_language(self):
		self.assertFalse(capi._wa_name_status("Bad Name!", "en")["ok"])
		self.assertIsNone(capi._wa_name_status("", "en")["ok"])
		self.assertTrue(capi._wa_name_status("Fresh Name 1", "en")["ok"])
		doc = frappe.get_doc({"doctype": "WhatsApp Templates", "template_name": "acc_taken", "actual_name": "acc_taken", "language": "en", "language_code": "en", "category": "MARKETING", "template": "x"})
		doc.flags.ignore_mandatory = True
		doc.db_insert()
		taken = capi._wa_name_status("acc_taken", "en")
		self.assertFalse(taken["ok"])
		self.assertEqual(taken["suggestion"], "acc_taken_v2")
		self.assertTrue(capi._wa_name_status("acc_taken", "hi")["ok"])  # the same name in another language is allowed by Meta


class TestAssignedLeadsReport(FrappeTestCase):
	def test_open_leads_are_counted_per_owner(self):
		from crm_addons import reports

		owner = make_user("acc_owner@example.com", ["Sales User"])
		frappe.get_doc({"doctype": "CRM Lead", "first_name": "Zed", "lead_owner": owner}).insert(ignore_permissions=True)
		data = reports.get_sales_report()
		row = next(r for r in data["assigned"] if r["user"] == owner)
		self.assertEqual(row["open"], 1)
		self.assertIn("statuses", row)


class TestSidebarLayout(FrappeTestCase):
	def test_the_saved_menu_layout_reaches_the_page_and_junk_is_dropped(self):
		from crm_addons import api, setup_page

		frappe.set_user("Administrator")
		setup_page.save_setup(json.dumps({"sidebar_layout": json.dumps([{"key": "leads", "hidden": 0}, {"key": "dashboard", "hidden": 1}, "junk", {"nokey": 1}])}))
		self.assertEqual(api.get_client_config()["sidebar_layout"], [{"key": "leads", "hidden": 0}, {"key": "dashboard", "hidden": 1}])
		setup_page.save_setup(json.dumps({"sidebar_layout": ""}))
		self.assertEqual(api.get_client_config()["sidebar_layout"], [])


class TestDefaultViewsAndCounts(FrappeTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_admin_defaults_become_each_persons_views_until_they_change_them(self):
		from crm_addons import views

		a = make_user("view_a@example.com", ["Sales User"])
		b = make_user("view_b@example.com", ["Sales User"])
		cfg = {"CRM Lead": {"default_view": "kanban", "columns": ["lead_name", "mobile_no", "status"], "order_by": "creation desc", "filters": [["status", "=", "New"]],
			"kanban": {"column_field": "status", "card_fields": ["email", "mobile_no"]}}, "CRM Organization": {"columns": ["organization_name", "industry"]}}
		res = views.save_view_config(json.dumps(cfg), apply=1)
		self.assertTrue(res["saved"])
		for u in (a, b):
			lst = frappe.db.get_value("CRM View Settings", {"dt": "CRM Lead", "type": "list", "is_standard": 1, "user": u}, ["name", "columns", "filters", "order_by", "is_default"], as_dict=True)
			kan = frappe.db.get_value("CRM View Settings", {"dt": "CRM Lead", "type": "kanban", "is_standard": 1, "user": u}, ["name", "kanban_fields", "column_field", "is_default"], as_dict=True)
			self.assertEqual([c["key"] for c in json.loads(lst.columns)], ["lead_name", "mobile_no", "status"])
			self.assertEqual(json.loads(lst.filters), {"status": "New"})
			self.assertEqual((lst.order_by, lst.is_default, kan.is_default, kan.column_field), ("creation desc", 0, 1, "status"))
			self.assertEqual(json.loads(kan.kanban_fields), ["email", "mobile_no"])
		# person b saves their own columns in CRM: the administrator's next change leaves b alone
		name = frappe.db.get_value("CRM View Settings", {"dt": "CRM Lead", "type": "list", "is_standard": 1, "user": b})
		frappe.db.set_value("CRM View Settings", name, "columns", json.dumps([{"label": "Email", "type": "Data", "key": "email", "width": "10rem"}]))
		cfg["CRM Lead"]["columns"] = ["lead_name", "email"]
		views.save_view_config(json.dumps(cfg), apply=1)
		cols = lambda u: [c["key"] for c in json.loads(frappe.db.get_value("CRM View Settings", {"dt": "CRM Lead", "type": "list", "is_standard": 1, "user": u}, "columns"))]  # noqa: E731
		self.assertEqual((cols(a), cols(b)), (["lead_name", "email"], ["email"]))
		views.save_view_config(json.dumps(cfg), apply=1, overwrite=1)
		self.assertEqual(cols(b), ["lead_name", "email"])

	def test_bad_fields_are_dropped(self):
		from crm_addons import views

		out = views.clean("CRM Lead", {"columns": ["lead_name", "nope"], "filters": [["status", "=", "x"], ["nope", "=", "y"], ["status", "drop table", "z"]], "kanban": {"column_field": "email"}})
		self.assertEqual((out["columns"], out["filters"]), (["lead_name"], [["status", "=", "x"]]))
		self.assertNotIn("kanban", out)

	def test_the_dashboard_counts_leads_by_a_field_and_by_named_counts(self):
		from crm_addons import reports

		frappe.db.set_single_value("CRM Addons Settings", "dashboard_breakdowns", json.dumps(["job_title"]))
		frappe.db.set_single_value("CRM Addons Settings", "dashboard_counters", json.dumps([{"label": "Schools", "field": "job_title", "op": "=", "value": "cnt_school"}]))
		for n in range(3):
			frappe.get_doc({"doctype": "CRM Lead", "first_name": f"c{n}", "job_title": "cnt_school"}).insert(ignore_permissions=True)
		out = reports.get_sales_report()
		self.assertEqual(next(c["count"] for c in out["counters"] if c["label"] == "Schools"), 3)
		bd = next(b for b in out["breakdowns"] if b["field"] == "job_title")
		self.assertEqual(next(r["count"] for r in bd["rows"] if r["value"] == "cnt_school"), 3)
		self.assertGreaterEqual(out["lead_totals"]["total"], 3)
