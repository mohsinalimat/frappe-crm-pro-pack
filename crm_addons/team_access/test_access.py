# Copyright (c) 2026, Siddharth Singh
"""Access levels: the registry, how a person's value is worked out, the team scope, and that nothing changes for people nobody configured.

Run on a bench:  bench --site <site> run-tests --module crm_addons.team_access.test_access
"""

import json
from unittest.mock import patch

import frappe

from crm_addons.meetings.doctype.crm_meeting.test_crm_meeting import TestCase as Base
from crm_addons.team_access import access
from crm_addons.team_access import registry as R

HIER = "CRM Sales Hierarchy"


class AccessCase(Base):
	def setUp(self):
		super().setUp()
		access.clear()

	def person(self, email, *roles):
		"""A new user with these roles; returns the email (the user's name)."""
		user = frappe.get_doc({"doctype": "User", "email": email, "first_name": email.split("@")[0], "send_welcome_email": 0, "roles": [{"role": r} for r in roles]})
		user.flags.ignore_permissions = True
		return user.insert().name

	def configure(self, user, preset=None, overrides=None):
		doc = frappe.get_doc({"doctype": "CRM User Access", "user": user, "preset": preset, "overrides": json.dumps(overrides or {})}).insert(ignore_permissions=True)
		access.clear()
		return doc

	def preset(self, name, grants):
		doc = frappe.get_doc({"doctype": "CRM Access Preset", "preset_name": name, "grants": json.dumps(grants)}).insert(ignore_permissions=True)
		access.clear()
		return doc


class TestRegistry(AccessCase):
	def test_every_feature_is_well_formed(self):
		self.assertEqual(len({f["key"] for f in R.FEATURES}), len(R.FEATURES))
		groups = {g[0] for g in R.GROUPS}
		for f in R.FEATURES:
			self.assertIn(f["group"], groups, f["key"])
			self.assertIn(f["kind"], ("scope", "level", "switch"))
			self.assertEqual(len(f["legacy"]), 3, f["key"])
			for v in f["legacy"]:
				self.assertIsNotNone(R.normalise(f, v), f"{f['key']} legacy {v}")
			self.assertTrue(f["label"] and f["help"], f["key"])

	def test_values_are_checked(self):
		scope = R.BY_KEY["followups"]
		self.assertEqual(R.normalise(scope, "team"), "team")
		self.assertIsNone(R.normalise(scope, "everything"))
		self.assertEqual(R.normalise(R.BY_KEY["campaign_create"], "1"), 1)
		self.assertEqual(R.normalise(R.BY_KEY["campaign_create"], 0), 0)
		self.assertIsNone(R.normalise(R.BY_KEY["campaign_create"], "maybe"))
		self.assertGreater(R.rank(scope, "all"), R.rank(scope, "team"))
		self.assertGreater(R.rank(scope, "team"), R.rank(scope, "own"))
		self.assertGreater(R.rank(scope, "own"), R.rank(scope, "none"))


class TestLegacyDefaults(AccessCase):
	"""Nobody configured: exactly what each kind of person had before."""

	def test_administrators_and_system_managers_have_everything(self):
		for user in ("Administrator", self.person("sysmgr.acc@example.org", "System Manager", "Sales Manager")):
			for f in R.FEATURES:
				self.assertEqual(access.level(f["key"], user), R.top(f), (user, f["key"]))

	def test_a_sales_manager_keeps_the_manager_view_but_not_assignment(self):
		user = self.person("mgr.acc@example.org", "Sales Manager", "Sales User")
		for key in ("meetings", "followups", "dashboard", "demos", "campaigns"):
			self.assertEqual(access.level(key, user), "all", key)
		self.assertEqual(access.level("assignment_move", user), "none")  # assignment was System Manager only
		self.assertEqual(access.level("demo_widgets", user), "manage")

	def test_a_sales_user_sees_only_their_own(self):
		user = self.person("rep.acc@example.org", "Sales User")
		for key in ("meetings", "followups", "dashboard", "demos"):
			self.assertEqual(access.level(key, user), "own", key)
		self.assertEqual(access.level("campaigns", user), "own")
		self.assertEqual(access.level("campaign_create", user), 0)
		self.assertEqual(access.level("email_templates", user), "view")
		self.assertEqual(access.level("demo_widgets", user), "none")

	def test_the_campaign_manager_role_keeps_campaign_powers_only(self):
		user = self.person("camp.acc@example.org", "Sales User", "Campaign Manager")
		self.assertEqual(access.level("campaigns", user), "all")
		self.assertEqual(access.level("campaign_create", user), 1)
		self.assertEqual(access.level("automations", user), "manage")
		self.assertEqual(access.level("followups", user), "own")  # follow-ups and meetings stay with managers


class TestPresetsAndOverrides(AccessCase):
	def test_demo_host_preset_is_renamed_and_people_follow(self):
		from crm_addons import install
		from crm_addons.team_access import presets

		user = self.person("host.acc@example.org", "Sales User")
		if frappe.db.exists("CRM Access Preset", "Booking Host"):
			frappe.delete_doc("CRM Access Preset", "Booking Host", force=True, ignore_permissions=True)
		if not frappe.db.exists("CRM Access Preset", "Demo Host"):
			self.preset("Demo Host", {"demos": "own"})
		self.configure(user, "Demo Host")
		old = frappe.db.get_default("crm_addons_access_presets")
		frappe.db.set_default("crm_addons_access_presets", "1")
		try:
			install.ensure_access_presets()
		finally:
			frappe.db.set_default("crm_addons_access_presets", old or presets.VERSION)
		self.assertFalse(frappe.db.exists("CRM Access Preset", "Demo Host"))
		self.assertTrue(frappe.db.exists("CRM Access Preset", "Booking Host"))
		self.assertEqual(frappe.db.get_value("CRM User Access", user, "preset"), "Booking Host")

	def test_a_preset_replaces_the_default(self):
		user = self.person("lead.acc@example.org", "Sales User")
		self.preset("Test Lead Preset", {"followups": "team", "campaign_create": 1})
		self.configure(user, "Test Lead Preset")
		self.assertEqual(access.level("followups", user), "team")
		self.assertEqual(access.level("campaign_create", user), 1)
		self.assertEqual(access.level("meetings", user), "own")  # not in the preset: the default stays
		self.assertEqual(access.explain(user)["followups"]["source"], "preset")
		self.assertEqual(access.explain(user)["meetings"]["source"], "default")

	def test_an_override_beats_the_preset(self):
		user = self.person("over.acc@example.org", "Sales User")
		self.preset("Test Narrow", {"followups": "own"})
		self.configure(user, "Test Narrow", {"followups": "all", "automations": "manage"})
		self.assertEqual(access.level("followups", user), "all")
		self.assertEqual(access.level("automations", user), "manage")
		self.assertEqual(access.explain(user)["followups"]["source"], "override")

	def test_a_manager_can_be_restricted(self):
		user = self.person("narrow.acc@example.org", "Sales Manager")
		self.configure(user, None, {"followups": "team"})
		self.assertEqual(access.level("followups", user), "team")
		self.assertEqual(access.level("meetings", user), "all")

	def test_an_admin_cannot_be_locked_out(self):
		user = self.person("admin2.acc@example.org", "System Manager")
		self.configure(user, None, {"followups": "none", "demo_widgets": "none"})
		self.assertEqual(access.level("followups", user), "all")
		self.assertEqual(access.level("demo_widgets", user), "manage")

	def test_bad_values_are_refused(self):
		user = self.person("bad.acc@example.org", "Sales User")
		for bad in ({"followups": "everything"}, {"nonsense": "all"}, {"campaign_create": "maybe"}):
			with self.assertRaises(frappe.ValidationError, msg=str(bad)):
				frappe.get_doc({"doctype": "CRM User Access", "user": user, "overrides": json.dumps(bad)}).insert(ignore_permissions=True)

	def test_a_preset_in_use_cannot_be_deleted(self):
		user = self.person("use.acc@example.org", "Sales User")
		p = self.preset("Test In Use", {"followups": "all"})
		self.configure(user, p.name)
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc("CRM Access Preset", p.name, ignore_permissions=True)

	def test_the_ready_made_presets_are_valid_and_cover_every_feature(self):
		from crm_addons.team_access import presets
		from crm_addons.team_access.doctype.crm_access_preset.crm_access_preset import clean_grants

		names = set()
		for name, description, grants in presets.PRESETS:
			names.add(name)
			clean = clean_grants(grants)
			self.assertEqual(set(clean), set(R.BY_KEY), name)  # a preset says something about every feature
			self.assertTrue(description)
		self.assertEqual(len(names), len(presets.PRESETS))


class HierarchyMixin(AccessCase):
	"""A stand-in for CRM's Sales Hierarchy table when this site's CRM has none (and the real one when it has)."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.made = not frappe.db.exists("DocType", HIER)
		if cls.made:
			frappe.get_doc(
				{
					"doctype": "DocType", "name": HIER, "module": "Team Access", "custom": 1, "istable": 0,
					"fields": [{"fieldname": "user", "fieldtype": "Data", "label": "User"}, {"fieldname": "reports_to", "fieldtype": "Data", "label": "Reports to"},
						{"fieldname": "lft", "fieldtype": "Int", "label": "Lft"}, {"fieldname": "rgt", "fieldtype": "Int", "label": "Rgt"}],
					"permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1}],
				}
			).insert(ignore_permissions=True)
			frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		if cls.made:
			frappe.delete_doc("DocType", HIER, force=1, ignore_permissions=True)
			frappe.db.commit()
		super().tearDownClass()

	def tree(self, boss, mid, rep1, rep2, other):
		# boss (1,10) -> mid (2,7) -> rep1 (3,4), rep2 (5,6);  boss -> other (8,9)
		frappe.db.delete(HIER)
		for user, lft, rgt in ((boss, 1, 10), (mid, 2, 7), (rep1, 3, 4), (rep2, 5, 6), (other, 8, 9)):
			frappe.get_doc({"doctype": HIER, "user": user, "lft": lft, "rgt": rgt}).db_insert()


class TestTeamScope(HierarchyMixin):
	def test_my_team_is_me_and_everyone_below(self):
		u = [self.person(f"t{i}.acc@example.org", "Sales User") for i in range(5)]
		self.tree(*u)
		self.assertEqual(access.team_users(u[0]), set(u))
		self.assertEqual(access.team_users(u[1]), {u[1], u[2], u[3]})
		self.assertEqual(access.team_users(u[2]), {u[2]})
		self.assertEqual(access.team_users(u[4]), {u[4]})

	def test_scope_users_for_each_level(self):
		u = [self.person(f"s{i}.acc@example.org", "Sales User") for i in range(5)]
		self.tree(*u)
		self.configure(u[1], None, {"followups": "team", "meetings": "own", "dashboard": "all", "demos": "none"})
		self.assertEqual(access.scope_users("followups", u[1]), {u[1], u[2], u[3]})
		self.assertEqual(access.scope_users("meetings", u[1]), {u[1]})
		self.assertIsNone(access.scope_users("dashboard", u[1]))
		self.assertEqual(access.scope_users("demos", u[1]), set())
		self.assertTrue(access.can_see_user("followups", u[3], u[1]))
		self.assertFalse(access.can_see_user("followups", u[4], u[1]))

	def test_someone_outside_the_tree_sees_only_themselves(self):
		u = [self.person(f"o{i}.acc@example.org", "Sales User") for i in range(5)]
		self.tree(*u[:5])
		outsider = self.person("outsider.acc@example.org", "Sales User")
		self.configure(outsider, None, {"followups": "team"})
		self.assertEqual(access.scope_users("followups", outsider), {outsider})

	def test_sql_condition(self):
		self.assertEqual(access.sql_in("a.owner", None), "")
		self.assertEqual(access.sql_in("a.owner", set()), "1 = 0")
		cond = access.sql_in("a.owner", {"x@example.org", "y@example.org"})
		self.assertEqual(cond, "a.owner in ('x@example.org', 'y@example.org')")

	def test_without_a_hierarchy_team_is_just_me(self):
		user = self.person("nohier.acc@example.org", "Sales User")
		with patch.object(access, "HIERARCHY", "No Such Hierarchy"):
			self.assertEqual(access.team_users(user), {user})


class TestAdminApi(AccessCase):
	def as_user(self, user):
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")

	def test_only_a_system_manager_may_use_it(self):
		from crm_addons.team_access import admin

		rep = self.person("api.rep@example.org", "Sales User")
		mgr = self.person("api.mgr@example.org", "Sales Manager")
		for who in (rep, mgr):
			self.as_user(who)
			for fn, args in ((admin.get_overview, ()), (admin.get_user_access, (rep,)), (admin.save_user_access, (rep, None, "{}")), (admin.save_preset, ("x", "", "{}")), (admin.delete_preset, ("x",)), (admin.send_password_reset, (rep,))):
				with self.assertRaises(frappe.PermissionError, msg=fn.__name__):
					fn(*args)
			frappe.set_user("Administrator")

	def test_add_person_creates_a_crm_user_with_role_and_preset(self):
		from crm_addons.team_access import admin

		email = "added.acc@example.org"
		if frappe.db.exists("User", email):
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		self.addCleanup(lambda: frappe.db.exists("User", email) and frappe.delete_doc("User", email, force=True, ignore_permissions=True))
		with patch("frappe.core.doctype.user.user.User.send_welcome_mail_to_user") as mail:
			out = admin.add_person(email, "Added", "Person", "Sales User", "Sales Executive", 1)
		self.assertTrue(out["created"] and out["invited"])
		mail.assert_called_once()
		self.assertIn("Sales User", frappe.get_roles(email))
		self.assertEqual(frappe.db.get_value("CRM User Access", email, "preset"), "Sales Executive")
		self.assertIn(email, [p["user"] for p in admin.get_overview()["people"]])
		# again: the existing account is kept, a role is added, nothing is created
		out = admin.add_person(email, "Added", "", "Sales Manager", None, 0)
		self.assertFalse(out["created"])
		self.assertIn("Sales Manager", frappe.get_roles(email))
		for bad in (("not-an-email", "A", "", "Sales User"), (email, "A", "", "System Manager")):
			with self.assertRaises(frappe.ValidationError):
				admin.add_person(*bad)
		rep = self.person("addcheck.rep@example.org", "Sales User")
		self.as_user(rep)
		with self.assertRaises(frappe.PermissionError):
			admin.add_person("x@example.org", "X")

	def test_add_person_still_works_when_the_invitation_cannot_be_sent(self):
		from crm_addons.team_access import admin

		email = "noinvite.acc@example.org"
		if frappe.db.exists("User", email):
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		self.addCleanup(lambda: frappe.db.exists("User", email) and frappe.delete_doc("User", email, force=True, ignore_permissions=True))
		with patch("frappe.core.doctype.user.user.User.send_welcome_mail_to_user", side_effect=Exception("no outgoing email account")):
			out = admin.add_person(email, "No", "Invite")
		self.assertTrue(out["created"] and not out["invited"])
		self.assertIn("outgoing", out["invite_problem"])
		self.assertTrue(frappe.db.exists("User", email))

	def test_the_overview_lists_people_presets_and_the_registry(self):
		from crm_addons.team_access import admin

		rep = self.person("ov.rep@example.org", "Sales User")
		self.configure(rep, "Sales Executive", {"followups": "all"})
		out = admin.get_overview()
		self.assertEqual({f["key"] for f in out["features"]}, set(R.BY_KEY))
		self.assertIn("Sales Executive", {p["preset_name"] for p in out["presets"]})
		me = next(p for p in out["people"] if p["user"] == rep)
		self.assertEqual((me["preset"], me["overrides"], me["configured"]), ("Sales Executive", 1, True))
		self.assertNotIn("Administrator", {p["user"] for p in out["people"]})

	def test_saving_a_person_and_going_back_to_the_default(self):
		from crm_addons.team_access import admin

		rep = self.person("sv.rep@example.org", "Sales User")
		out = admin.save_user_access(rep, "Team Lead", json.dumps({"followups": "all", "meetings": "team"}))
		self.assertEqual(out["effective"]["followups"], {"value": "all", "source": "override"})
		self.assertNotIn("meetings", out["overrides"])  # the preset already says team
		self.assertEqual(out["effective"]["meetings"]["source"], "preset")
		out = admin.save_user_access(rep, None, "{}")
		self.assertFalse(frappe.db.exists("CRM User Access", rep))
		self.assertEqual(out["effective"]["followups"]["source"], "default")

	def test_bad_input_is_refused(self):
		from crm_addons.team_access import admin

		rep = self.person("bi.rep@example.org", "Sales User")
		with self.assertRaises(frappe.ValidationError):
			admin.save_user_access(rep, "No Such Preset", "{}")
		with self.assertRaises(frappe.ValidationError):
			admin.save_user_access(rep, None, json.dumps({"followups": "sideways"}))
		with self.assertRaises(frappe.ValidationError):
			admin.save_user_access("Administrator", None, "{}")

	def test_presets_can_be_created_duplicated_and_deleted(self):
		from crm_addons.team_access import admin

		p = admin.save_preset("Test Preset A", "for testing", json.dumps({"followups": "team"}))
		self.assertEqual(p["grants"], {"followups": "team"})
		with self.assertRaises(frappe.ValidationError):
			admin.save_preset("Test Preset A", "", "{}")
		copy = admin.duplicate_preset("Test Preset A", "Test Preset B")
		self.assertEqual(copy["grants"], {"followups": "team"})
		rep = self.person("pr.rep@example.org", "Sales User")
		admin.save_user_access(rep, "Test Preset B", "{}")
		with self.assertRaises(frappe.ValidationError):
			admin.delete_preset("Test Preset B")
		admin.save_user_access(rep, None, "{}")
		self.assertTrue(admin.delete_preset("Test Preset B"))

	def test_a_password_reset_goes_through_frappe(self):
		from unittest.mock import patch

		from crm_addons.team_access import admin

		rep = self.person("pw.rep@example.org", "Sales User")
		from frappe.core.doctype.user.user import User

		name = "_reset_password" if hasattr(User, "_reset_password") else "reset_password"
		with patch.object(User, name) as reset:
			self.assertEqual(admin.send_password_reset(rep), {"sent_to": rep})
		reset.assert_called_once_with(send_email=True)


class TestPeopleAdmin(HierarchyMixin):
	def setUp(self):
		super().setUp()
		frappe.db.delete(HIER)
		self.addCleanup(frappe.set_user, "Administrator")
		self.addCleanup(lambda: [frappe.db.exists("User", e) and frappe.delete_doc("User", e, force=True, ignore_permissions=True) for e in ("pp.new@example.org",)])

	def test_add_person_with_profile_and_team_leader(self):
		from crm_addons.team_access import admin

		lead = self.person("pp.lead@example.org", "Sales Manager")
		if frappe.db.exists("User", "pp.new@example.org"):
			frappe.delete_doc("User", "pp.new@example.org", force=True, ignore_permissions=True)
		with patch("frappe.core.doctype.user.user.User.send_welcome_mail_to_user"):
			out = admin.add_person("pp.new@example.org", "New", "Hire", "Sales User", None, 0, "+91 98765 43210", "Sales Executive", "Acme", "", lead)
		self.assertEqual(out["problems"], [])
		doc = frappe.get_doc("User", "pp.new@example.org")
		self.assertEqual((doc.mobile_no, doc.get("crm_designation"), doc.get("crm_company")), ("+91 98765 43210", "Sales Executive", "Acme"))
		self.assertEqual(admin._leader("pp.new@example.org"), lead)
		row = next(p for p in admin.get_overview()["people"] if p["user"] == "pp.new@example.org")
		self.assertEqual((row["designation"], row["company"], row["enabled"]), ("Sales Executive", "Acme", True))
		# change the leader and take it away again
		other = self.person("pp.other@example.org", "Sales Manager")
		admin.update_person("pp.new@example.org", reports_to=other, set_leader=1)
		self.assertEqual(admin._leader("pp.new@example.org"), other)
		admin.update_person("pp.new@example.org", designation="Lead", set_leader=0)
		self.assertEqual(admin._leader("pp.new@example.org"), other)  # untouched without set_leader
		admin.update_person("pp.new@example.org", reports_to="", set_leader=1)
		self.assertIsNone(admin._leader("pp.new@example.org"))

	def test_bad_input_is_refused(self):
		from crm_addons.team_access import admin

		lead = self.person("pp.l2@example.org", "Sales Manager")
		with self.assertRaises(frappe.ValidationError):
			admin.add_person("pp.new@example.org", "N", "", "Sales User", None, 0, "abc")
		with self.assertRaises(frappe.ValidationError):
			admin.update_person(lead, reports_to=lead, set_leader=1)
		# no loops: the leader's own leader cannot be put under them
		mid = self.person("pp.mid@example.org", "Sales User")
		admin.update_person(mid, reports_to=lead, set_leader=1)
		self.assertEqual(admin._leader(mid), lead)

	def test_switch_off_and_on(self):
		from crm_addons.team_access import admin

		rep = self.person("pp.rep@example.org", "Sales User")
		admin.set_active(rep, 0)
		self.assertEqual(frappe.db.get_value("User", rep, "enabled"), 0)
		row = next(p for p in admin.get_overview()["people"] if p["user"] == rep)
		self.assertFalse(row["enabled"])
		admin.set_active(rep, 1)
		self.assertEqual(frappe.db.get_value("User", rep, "enabled"), 1)
		with self.assertRaises(frappe.ValidationError):  # not yourself
			frappe.set_user("Administrator")
			admin.set_active("Administrator", 0)

	def test_the_contact_number_is_for_system_managers_only(self):
		rep = self.person("pp.num@example.org", "Sales User")
		frappe.set_user(rep)
		doc = frappe.get_doc("User", rep)
		doc.mobile_no = "9876543210"
		with self.assertRaises(frappe.PermissionError):
			doc.save(ignore_permissions=True)
		frappe.set_user("Administrator")
		doc = frappe.get_doc("User", rep)
		doc.mobile_no = "9876543210"
		doc.save()
		self.assertEqual(frappe.db.get_value("User", rep, "mobile_no"), "9876543210")


class TestLoginLink(HierarchyMixin):
	def test_login_link_by_whatsapp_needs_an_approved_template(self):
		from crm_addons import system_messages
		from crm_addons.team_access import admin

		email = "wl.new@example.org"
		if frappe.db.exists("User", email):
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		self.addCleanup(lambda: frappe.db.exists("User", email) and frappe.delete_doc("User", email, force=True, ignore_permissions=True))
		with patch("frappe.core.doctype.user.user.User.send_welcome_mail_to_user"), \
			patch.object(system_messages, "login_template_status", return_value={"exists": False, "ready": False, "state": ""}):
			out = admin.add_person(email, "Wa", "Link", "Sales User", None, 0, "9876543210", "", "", "", None, 1)
		self.assertTrue(out["created"])  # the person is still added
		self.assertTrue(any("WhatsApp login link was not sent" in p for p in out["problems"]))
		frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		ok = {"exists": True, "ready": True, "state": "APPROVED", "name": "t"}
		with patch("frappe.core.doctype.user.user.User.send_welcome_mail_to_user"), \
			patch.object(system_messages, "login_template_status", return_value=ok), \
			patch.object(system_messages, "send_login_link", return_value={"message": "WM", "to": "91"}) as send:
			out = admin.add_person(email, "Wa", "Link", "Sales User", None, 0, "9876543210", "", "", "", None, 1)
		self.assertEqual(out["problems"], [])
		self.assertIn("update-password?key=", send.call_args[0][1])  # a set-password link, never a password


class TestHierarchyPage(HierarchyMixin):
	def setUp(self):
		super().setUp()
		frappe.db.delete(HIER)
		self.addCleanup(frappe.set_user, "Administrator")

	def test_tree_loose_people_and_changing_leaders(self):
		from crm_addons.team_access import admin

		boss, mid, rep = (self.person(f"hp{i}.acc@example.org", "Sales User") for i in range(3))
		admin.set_leader(boss, None)  # at the top
		admin.set_leader(mid, boss)
		admin.set_leader(rep, mid)
		out = admin.get_hierarchy()
		tree = {n["user"]: n for n in out["tree"]}
		self.assertEqual((tree[boss]["depth"], tree[mid]["depth"], tree[rep]["depth"]), (0, 1, 2))
		self.assertEqual((tree[boss]["below"], tree[mid]["below"], tree[rep]["below"]), (2, 1, 0))
		self.assertEqual([n["user"] for n in out["tree"] if n["user"] in (boss, mid, rep)], [boss, mid, rep])  # parents before children
		other = self.person("hp3.acc@example.org", "Sales User")
		self.assertIn(other, [p["user"] for p in admin.get_hierarchy()["loose"]])
		admin.set_leader(rep, boss)  # moved up one level
		self.assertEqual({n["user"]: n["depth"] for n in admin.get_hierarchy()["tree"]}[rep], 1)

	def test_loops_and_removing_someone_with_a_team_are_refused(self):
		from crm_addons.team_access import admin

		boss, mid = (self.person(f"hq{i}.acc@example.org", "Sales User") for i in range(2))
		admin.set_leader(boss, None)
		admin.set_leader(mid, boss)
		with self.assertRaises(frappe.ValidationError):
			admin.set_leader(boss, mid)  # a loop
		with self.assertRaises(frappe.ValidationError):
			admin.set_leader(boss, boss)
		with self.assertRaises(frappe.ValidationError):
			admin.remove_from_hierarchy(boss)  # mid reports to them
		admin.remove_from_hierarchy(mid)
		self.assertNotIn(mid, [n["user"] for n in admin.get_hierarchy()["tree"]])

	def test_only_a_system_manager(self):
		from crm_addons.team_access import admin

		rep = self.person("hr.acc@example.org", "Sales User")
		self.addCleanup(setattr, frappe.flags, "in_test", frappe.flags.in_test)
		frappe.flags.in_test = False
		frappe.set_user(rep)
		for fn, args in ((admin.get_hierarchy, ()), (admin.set_leader, (rep, None)), (admin.remove_from_hierarchy, (rep,)), (admin.set_hierarchy_enabled, (1,))):
			with self.assertRaises(frappe.PermissionError):
				fn(*args)
