# Copyright (c) 2026, Siddharth Singh
"""The access levels at work: what a person really gets back from the lists and screens once an admin has set "own", "my team", "everyone" or "none".

Run on a bench:  bench --site <site> run-tests --module crm_addons.team_access.test_enforcement
"""

import json

import frappe

from crm_addons import followups
from crm_addons.demos import admin
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import MONDAY, DemoCase, ist
from crm_addons.follow_ups.doctype.crm_follow_up.test_crm_follow_up import FollowUpBase
from crm_addons.team_access import access
from crm_addons.team_access.test_access import HIER, HierarchyMixin


class Enforcement(HierarchyMixin, FollowUpBase):
	def setUp(self):
		super().setUp()
		access.clear()
		# boss -> mid -> (rep1, rep2);  boss -> other
		self.u = {n: self.person(f"{n}.enf@example.org", "Sales User") for n in ("boss", "mid", "rep1", "rep2", "other")}
		self.tree(self.u["boss"], self.u["mid"], self.u["rep1"], self.u["rep2"], self.u["other"])

	def configure(self, user, overrides):
		frappe.get_doc({"doctype": "CRM User Access", "user": user, "overrides": json.dumps(overrides)}).insert(ignore_permissions=True)
		access.clear()

	def follow_up(self, who, hour):
		doc = frappe.get_doc(
			{
				"doctype": "CRM Follow Up", "reference_doctype": "CRM Lead", "reference_docname": self.lead.name, "mode": "Call", "outcome": "Did Not Pick",
				"followed_up_on": f"2020-01-01 {hour:02d}:00:00", "assigned_to": who,
			}
		).insert(ignore_permissions=True)
		frappe.db.set_value("CRM Follow Up", doc.name, "owner", who)
		return doc.name

	def meeting(self, who, hour):
		doc = frappe.new_doc("CRM Meeting")
		doc.update(
			{
				"subject": f"Meeting of {who}", "reference_doctype": "CRM Lead", "reference_docname": self.lead.name, "starts_on": f"2030-03-05 {hour:02d}:00:00",
				"ends_on": f"2030-03-05 {hour:02d}:30:00", "provider": "Manual Link", "add_video_conferencing": 0, "status": "Scheduled", "organizer": who,
			}
		)
		doc.append("attendees", {"email": who})
		doc.flags.notify_guests = False
		doc.insert(ignore_permissions=True)
		frappe.db.set_value("CRM Meeting", doc.name, "owner", who)
		return doc.name

	def visible(self, doctype, user, field="name"):
		frappe.set_user(user)
		try:
			return set(frappe.get_list(doctype, pluck=field, limit_page_length=500))
		finally:
			frappe.set_user("Administrator")


class TestFollowUpScope(Enforcement):
	def setUp(self):
		super().setUp()
		self.fu = {n: self.follow_up(u, 10 + i) for i, (n, u) in enumerate(self.u.items())}

	def test_default_is_own_only(self):
		self.assertEqual(self.visible("CRM Follow Up", self.u["mid"]), {self.fu["mid"]})

	def test_my_team_sees_the_team_and_nobody_else(self):
		self.configure(self.u["mid"], {"followups": "team"})
		self.assertEqual(self.visible("CRM Follow Up", self.u["mid"]), {self.fu["mid"], self.fu["rep1"], self.fu["rep2"]})
		self.configure(self.u["boss"], {"followups": "team"})
		self.assertEqual(self.visible("CRM Follow Up", self.u["boss"]) & set(self.fu.values()), set(self.fu.values()))

	def test_everyone_and_nobody(self):
		self.configure(self.u["rep1"], {"followups": "all"})
		self.assertTrue(set(self.fu.values()) <= self.visible("CRM Follow Up", self.u["rep1"]))
		self.configure(self.u["rep2"], {"followups": "none"})
		self.assertEqual(self.visible("CRM Follow Up", self.u["rep2"]), set())

	def test_a_manager_can_be_limited_to_their_team(self):
		mgr = self.person("mgr.enf@example.org", "Sales Manager")
		self.assertEqual(self.visible("CRM Follow Up", mgr), set(self.fu.values()) | set(frappe.get_all("CRM Follow Up", pluck="name")))
		self.configure(mgr, {"followups": "own"})
		self.assertEqual(self.visible("CRM Follow Up", mgr), set())

	def test_the_page_offers_the_everyone_view_only_to_team_and_everyone(self):
		self.configure(self.u["mid"], {"followups": "team"})
		frappe.set_user(self.u["mid"])
		try:
			self.assertTrue(followups.get_workspace(scope="all")["scope"]["is_manager"])
			names = {i["name"] for i in followups.get_workspace(scope="all", tab="done")["items"]} | {i["name"] for i in followups.get_workspace(scope="all", tab="worked")["items"]}
			self.assertFalse(names & {self.fu["boss"], self.fu["other"]})
		finally:
			frappe.set_user("Administrator")
		frappe.set_user(self.u["rep1"])
		try:
			self.assertFalse(followups.get_workspace(scope="all")["scope"]["is_manager"])
		finally:
			frappe.set_user("Administrator")

	def test_editing_follows_the_same_scope(self):
		self.configure(self.u["mid"], {"followups": "team"})
		doc = frappe.get_doc("CRM Follow Up", self.fu["rep1"])
		self.assertTrue(doc.has_permission("write", user=self.u["mid"]))
		self.assertFalse(frappe.get_doc("CRM Follow Up", self.fu["other"]).has_permission("write", user=self.u["mid"]))


class TestMeetingScope(Enforcement):
	def setUp(self):
		super().setUp()
		self.mt = {n: self.meeting(u, 9 + i) for i, (n, u) in enumerate(self.u.items())}

	def test_default_is_own_only(self):
		self.assertEqual(self.visible("CRM Meeting", self.u["mid"]), {self.mt["mid"]})

	def test_my_team_everyone_and_none(self):
		self.configure(self.u["mid"], {"meetings": "team"})
		self.assertEqual(self.visible("CRM Meeting", self.u["mid"]), {self.mt["mid"], self.mt["rep1"], self.mt["rep2"]})
		self.configure(self.u["rep1"], {"meetings": "all"})
		self.assertTrue(set(self.mt.values()) <= self.visible("CRM Meeting", self.u["rep1"]))  # everyone: ours, and any other meeting on the site
		self.configure(self.u["rep2"], {"meetings": "none"})
		self.assertEqual(self.visible("CRM Meeting", self.u["rep2"]), set())

	def test_a_guest_still_sees_the_meeting_they_were_invited_to(self):
		doc = frappe.get_doc("CRM Meeting", self.mt["other"])
		doc.append("attendees", {"email": self.u["rep2"]})
		doc.flags.notify_guests = False
		doc.save(ignore_permissions=True)
		self.assertIn(self.mt["other"], self.visible("CRM Meeting", self.u["rep2"]))

	def test_a_manager_limited_to_their_team_cannot_edit_outside_it(self):
		mgr = self.person("mgr2.enf@example.org", "Sales Manager")
		self.configure(mgr, {"meetings": "own"})
		self.assertFalse(frappe.get_doc("CRM Meeting", self.mt["other"]).has_permission("write", user=mgr))
		self.assertFalse(frappe.get_doc("CRM Meeting", self.mt["other"]).has_permission("read", user=mgr))


class TestDashboardScope(Enforcement):
	def setUp(self):
		super().setUp()
		for i, u in enumerate(self.u.values()):
			self.follow_up(u, 10 + i)

	def report(self, viewer, user=None):
		from crm_addons import reports

		frappe.set_user(viewer)
		try:
			return reports._build_report("2020-01-01", "2020-01-31", user)
		finally:
			frappe.set_user("Administrator")

	def people(self, out):
		return {p["user"] for p in out["people"] if p["follow_ups"]}

	def test_a_sales_user_gets_only_their_own_numbers(self):
		out = self.report(self.u["mid"])
		self.assertEqual(self.people(out), {self.u["mid"]})
		self.assertFalse(out["scope"]["is_manager"])

	def test_my_team_adds_up_the_team(self):
		self.configure(self.u["mid"], {"dashboard": "team"})
		out = self.report(self.u["mid"])
		self.assertEqual(self.people(out), {self.u["mid"], self.u["rep1"], self.u["rep2"]})
		self.assertEqual(out["scope"]["label"], "My team")
		self.assertTrue(out["scope"]["is_manager"])
		self.assertEqual({u["name"] for u in out["scope"]["users"]} & set(self.u.values()), {self.u["mid"], self.u["rep1"], self.u["rep2"]})
		one = self.report(self.u["mid"], user=self.u["rep1"])  # narrowed to one person of the team
		self.assertEqual(self.people(one), {self.u["rep1"]})
		outside = self.report(self.u["mid"], user=self.u["other"])  # somebody outside the team: ignored, the team is reported
		self.assertEqual(self.people(outside), {self.u["mid"], self.u["rep1"], self.u["rep2"]})

	def test_everyone_and_nobody(self):
		self.configure(self.u["rep1"], {"dashboard": "all"})
		self.assertTrue(set(self.u.values()) <= self.people(self.report(self.u["rep1"])))
		self.configure(self.u["rep2"], {"dashboard": "none"})
		self.assertEqual(self.people(self.report(self.u["rep2"])), set())

	def test_the_lead_counts_follow_the_same_scope(self):
		from crm_addons import reports

		self.configure(self.u["mid"], {"dashboard": "team"})
		frappe.set_user(self.u["mid"])
		try:
			who = reports._who(None)
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(set(who), {self.u["mid"], self.u["rep1"], self.u["rep2"]})
		frappe.db.set_value("CRM Lead", self.lead.name, "lead_owner", self.u["rep2"])
		self.assertGreaterEqual(reports._extras(who)["lead_totals"]["total"], 1)
		self.assertEqual(reports._extras(self.u["other"])["lead_totals"]["total"], 0)


class TestDemoAccess(HierarchyMixin, DemoCase):
	def setUp(self):
		super().setUp()
		access.clear()
		self.u = {n: self.person(f"{n}.dem@example.org", "Sales User") for n in ("boss", "mid", "rep1", "rep2", "other")}
		self.tree(self.u["boss"], self.u["mid"], self.u["rep1"], self.u["rep2"], self.u["other"])
		self.demo_a = self.make_demo("access-demo-a", owners=[self.u["rep1"]])
		self.demo_b = self.make_demo("access-demo-b", owners=[self.u["other"]])
		self.ba = self.book(self.demo_a, ist(MONDAY, 10))
		self.bb = self.book(self.demo_b, ist(MONDAY, 12))

	def configure(self, user, overrides):
		frappe.get_doc({"doctype": "CRM User Access", "user": user, "overrides": json.dumps(overrides)}).insert(ignore_permissions=True)
		access.clear()

	def as_(self, user):
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")

	def seen(self, user):
		self.as_(user)
		try:
			return {r["name"] for r in admin.list_bookings()["rows"]}
		finally:
			frappe.set_user("Administrator")

	def test_own_team_everyone_and_none(self):
		self.assertEqual(self.seen(self.u["mid"]), set())  # not a host of anything
		self.assertEqual(self.seen(self.u["rep1"]), {self.ba})
		self.configure(self.u["mid"], {"demos": "team"})
		self.assertEqual(self.seen(self.u["mid"]), {self.ba})  # rep1 is below mid; the other host is not
		self.configure(self.u["boss"], {"demos": "team"})
		self.assertEqual(self.seen(self.u["boss"]), {self.ba, self.bb})
		self.configure(self.u["rep2"], {"demos": "all"})
		self.assertTrue({self.ba, self.bb} <= self.seen(self.u["rep2"]))
		self.configure(self.u["other"], {"demos": "none"})
		self.as_(self.u["other"])
		with self.assertRaises(frappe.PermissionError):
			admin.list_bookings()
		self.assertEqual(admin.my_demos(scope="all"), [])

	def test_the_demos_view_in_meetings_follows_the_scope(self):
		self.configure(self.u["mid"], {"demos": "team"})
		self.as_(self.u["mid"])
		self.assertEqual({r["name"] for r in admin.my_demos(scope="all")}, {self.ba})
		self.assertEqual(admin.my_demos(scope="mine"), [])  # "mine" is always only their own

	def test_acting_on_other_peoples_demos_needs_team_or_everyone(self):
		self.configure(self.u["mid"], {"demos": "team"})
		self.as_(self.u["mid"])
		self.assertEqual(admin.set_booking_status(self.ba, "Completed")["booking"]["status"], "Completed")
		with self.assertRaises(frappe.PermissionError):
			admin.set_booking_status(self.bb, "Completed")  # outside the team

	def test_demo_widgets_levels(self):
		self.as_(self.u["mid"])
		with self.assertRaises(frappe.PermissionError):
			admin.list_demo_types()
		frappe.set_user("Administrator")
		self.configure(self.u["mid"], {"demo_widgets": "view"})
		self.as_(self.u["mid"])
		self.assertTrue(admin.list_demo_types())
		with self.assertRaises(frappe.PermissionError):
			admin.duplicate_demo_type(self.demo_a.name)
		frappe.set_user("Administrator")
		access.clear()
		frappe.db.set_value("CRM User Access", self.u["mid"], "overrides", json.dumps({"demo_widgets": "manage"}))
		access.clear()
		self.as_(self.u["mid"])
		self.assertTrue(admin.duplicate_demo_type(self.demo_a.name))

	def test_the_report_is_a_switch_and_follows_the_scope(self):
		mgr = self.person("mgr.dem@example.org", "Sales Manager")
		self.as_(mgr)
		self.assertGreaterEqual(admin.demo_report()["totals"]["booked"], 2)
		frappe.set_user("Administrator")
		self.configure(mgr, {"demo_report": 0})
		self.as_(mgr)
		with self.assertRaises(frappe.PermissionError):
			admin.demo_report()
		frappe.set_user("Administrator")
		self.configure(self.u["mid"], {"demo_report": 1, "demos": "team"})
		self.as_(self.u["mid"])
		self.assertEqual(admin.demo_report()["totals"]["booked"], 1)  # only the team's demo


class TestAssignmentAccess(Enforcement):
	def lead_for(self, user, name):
		return frappe.get_doc({"doctype": "CRM Lead", "first_name": name, "lead_owner": user, "job_title": "AccessTest"}).insert(ignore_permissions=True).name

	def as_(self, user):
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")

	def test_nothing_by_default_except_for_system_managers(self):
		from crm_addons import assignment as asg

		for who in (self.u["mid"], self.person("sm.enf@example.org", "Sales Manager")):
			self.as_(who)
			for fn in (asg.list_rules, asg.list_people, asg.list_history):
				with self.assertRaises(frappe.PermissionError, msg=fn.__name__):
					fn()
			frappe.set_user("Administrator")
		self.assertIsInstance(asg.list_rules(), list)  # a System Manager (here Administrator) always can

	def test_rules_can_be_viewed_without_being_changed(self):
		from crm_addons import assignment as asg

		self.configure(self.u["mid"], {"assignment_rules": "view"})
		self.as_(self.u["mid"])
		self.assertIsInstance(asg.list_rules(), list)
		with self.assertRaises(frappe.PermissionError):
			asg.save_rule({"rule_name": "X", "conditions": [["job_title", "=", "x"]], "assignees": [self.u["rep1"]], "distribution": "Round robin", "match_mode": "All conditions", "enabled": 0}, confirm=1)
		with self.assertRaises(frappe.PermissionError):
			asg.delete_rule("X")
		with self.assertRaises(frappe.PermissionError):
			asg.transfer([self.u["rep1"]], [self.u["rep2"]], "Round robin")  # moving is a different permission

	def test_moving_leads_stays_inside_the_scope(self):
		from crm_addons import assignment as asg

		mine = self.lead_for(self.u["mid"], "MineLead")
		team = self.lead_for(self.u["rep1"], "TeamLead")
		other = self.lead_for(self.u["other"], "OtherLead")
		self.configure(self.u["mid"], {"assignment_move": "team"})
		self.as_(self.u["mid"])
		self.assertEqual(asg.preview_transfer([self.u["rep1"]])["count"], 1)  # a person of their team
		with self.assertRaises(frappe.PermissionError):
			asg.preview_transfer([self.u["other"]])  # not in the team
		out = asg.transfer([self.u["rep1"]], [self.u["rep2"]], "Round robin")
		self.assertEqual(out["assigned"], 1)
		self.assertEqual(frappe.db.get_value("CRM Lead", team, "lead_owner"), self.u["rep2"])
		self.assertEqual(frappe.db.get_value("CRM Lead", other, "lead_owner"), self.u["other"])
		# "assign now" by conditions only reaches the leads inside the scope
		pre = asg.preview_manual({"conditions": [["job_title", "=", "AccessTest"]], "assignees": [self.u["rep2"]], "distribution": "Round robin", "scope": "all"})
		self.assertEqual({s["name"] for s in pre["sample"]}, {mine, team})

	def test_own_means_only_myself(self):
		from crm_addons import assignment as asg

		self.configure(self.u["rep1"], {"assignment_move": "own"})
		self.as_(self.u["rep1"])
		with self.assertRaises(frappe.PermissionError):
			asg.preview_transfer([self.u["rep2"]])
		self.assertEqual(asg.preview_transfer([self.u["rep1"]])["count"], 0)

	def test_history_is_limited_to_runs_by_people_in_the_scope(self):
		from crm_addons import assignment as asg

		for who in (self.u["rep1"], self.u["other"]):
			frappe.get_doc({"doctype": "CRM Assignment Log", "lead": "-", "lead_name": f"by {who}", "source": "Manual", "by_user": who, "to_users": who}).insert(ignore_permissions=True)
		self.configure(self.u["mid"], {"assignment_history": "team"})
		self.as_(self.u["mid"])
		seen = {g["by_user"] for g in asg.list_history()["groups"]}
		self.assertIn(self.u["rep1"], seen)
		self.assertNotIn(self.u["other"], seen)
		self.assertTrue(all(r["by_user"] in {self.u["mid"], self.u["rep1"], self.u["rep2"]} for r in asg.list_log()))
