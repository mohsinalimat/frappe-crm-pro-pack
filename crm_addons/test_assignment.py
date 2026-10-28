# Copyright (c) 2026, Siddharth Singh
"""Lead assignment: rules, new leads, existing leads, transfer, and who may use it.

Run on a bench:  bench --site <site> run-tests --app crm_addons --module crm_addons.test_assignment
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons import assignment as asg
from crm_addons.test_access_and_sync import make_user


def lead(first, **kw):
	return frappe.get_doc({"doctype": "CRM Lead", "first_name": first, **kw}).insert(ignore_permissions=True)


def rule(name, conditions, people, mode="Round robin", match="All conditions", confirm=1, enabled=1):
	out = asg.save_rule(
		{"rule_name": name, "conditions": conditions, "assignees": people, "distribution": mode, "match_mode": match, "enabled": enabled}, confirm=confirm
	)
	return out


class TestAssignment(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		for n in frappe.get_all("CRM Assignment Rule", pluck="name"):
			frappe.delete_doc("CRM Assignment Rule", n, force=1)
		cls.a, cls.b, cls.c = (make_user(f"asg_{x}@example.com", ["Sales User"]) for x in "abc")
		cls.sales_other = make_user("asg_plain@example.com", ["Sales User"])

	def tearDown(self):
		frappe.set_user("Administrator")
		for n in frappe.get_all("CRM Assignment Rule", pluck="name"):
			frappe.delete_doc("CRM Assignment Rule", n, force=1)

	def owner(self, name):
		return frappe.db.get_value("CRM Lead", name, "lead_owner")

	def test_a_new_lead_is_shared_round_robin_by_its_fields(self):
		rule("Bihar", [["job_title", "=", "Bihar"]], [self.a, self.b])
		owners = [self.owner(lead(f"R{i}", job_title="Bihar").name) for i in range(4)]
		self.assertEqual(owners, [self.a, self.b, self.a, self.b])
		self.assertNotIn(self.owner(lead("Other", job_title="Kerala").name), (self.a, self.b))  # no rule: untouched

	def test_all_of_them_gives_everyone_the_lead(self):
		rule("Team", [["job_title", "=", "Goa"]], [self.a, self.b], mode="All of them")
		name = lead("Shared", job_title="Goa").name
		self.assertEqual(self.owner(name), self.a)
		for user in (self.a, self.b):
			frappe.set_user(user)
			self.assertIn(name, frappe.get_list("CRM Lead", pluck="name", limit_page_length=500), user)
		frappe.set_user(self.c)
		self.assertNotIn(name, frappe.get_list("CRM Lead", pluck="name", limit_page_length=500))

	def test_least_workload_picks_the_person_with_less_to_do(self):
		for i in range(3):
			lead(f"Busy{i}", lead_owner=self.a)
		rule("Smart", [["job_title", "=", "Assam"]], [self.a, self.b], mode="Least workload")
		self.assertEqual(self.owner(lead("Smart1", job_title="Assam").name), self.b)

	def test_any_condition_and_conditions_can_be_combined(self):
		rule("OR", [["job_title", "=", "Bihar"], ["website", "=", "school.example"]], [self.c], match="Any condition")
		self.assertEqual(self.owner(lead("Or1", job_title="Bihar").name), self.c)

	def test_overlapping_rules_ask_first_and_then_assign_to_everyone(self):
		rule("Bihar2", [["job_title", "=", "Bihar"]], [self.a])
		out = rule("School2", [["website", "=", "india.example"]], [self.b], confirm=0)
		self.assertTrue(out["needs_confirm"])
		self.assertEqual(out["clashes"][0]["rule"], "Bihar2")
		self.assertFalse(frappe.db.exists("CRM Assignment Rule", "School2"))
		rule("School2", [["website", "=", "india.example"]], [self.b], confirm=1)
		name = lead("Both", job_title="Bihar", website="india.example").name
		self.assertEqual({self.owner(name), *asg._open_assignees(name)}, {self.a, self.b})

	def test_rules_that_cannot_overlap_do_not_warn(self):
		rule("Bihar3", [["job_title", "=", "Bihar"]], [self.a])
		self.assertTrue(rule("Delhi3", [["job_title", "=", "Delhi"]], [self.b], confirm=0).get("saved"))

	def test_existing_leads_by_rule_only_the_unowned_or_all(self):
		mine = lead("Mine", job_title="Odisha", lead_owner=self.c).name
		free = lead("Free", job_title="Odisha").name
		frappe.db.set_value("CRM Lead", free, "lead_owner", None)
		rule("Odisha", [["job_title", "=", "Odisha"]], [self.a], enabled=0)
		pre = asg.preview_rule("Odisha", "unassigned")
		self.assertEqual(pre["count"], 1)
		res = asg.run_rule("Odisha", "unassigned")
		self.assertEqual((res["assigned"], self.owner(free), self.owner(mine)), (1, self.a, self.c))
		asg.run_rule("Odisha", "all")
		self.assertEqual(self.owner(mine), self.a)

	def test_transfer_moves_everything_from_one_person_to_others(self):
		src = make_user("asg_src@example.com", ["Sales User"])
		names = [lead(f"T{i}", lead_owner=src).name for i in range(4)]
		before = frappe.db.count("CRM Notification", {"to_user": self.b})
		res = asg.transfer([src], [self.b, self.c], "Round robin")
		self.assertEqual(res["assigned"], 4)
		self.assertEqual([self.owner(n) for n in names], [self.b, self.c, self.b, self.c])
		for n in names:
			self.assertNotIn(src, asg._open_assignees(n))
		self.assertGreater(frappe.db.count("CRM Notification", {"to_user": self.b}), before)  # CRM's own notification
		self.assertFalse(frappe.db.exists("Email Queue", {"message": ["like", "%T0%"]}))  # and no email
		self.assertTrue(frappe.db.exists("CRM Assignment Log", {"lead": names[0], "source": "Transfer"}))

	def test_transfer_can_move_just_a_number_of_leads(self):
		src = make_user("asg_lim@example.com", ["Sales User"])
		names = [lead(f"L{i}", lead_owner=src).name for i in range(5)]
		pre = asg.preview_transfer([src], "open", 2)
		self.assertEqual((pre["count"], pre["available"]), (2, 5))
		res = asg.transfer([src], [self.b], "Round robin", limit=2)
		self.assertEqual(res["assigned"], 2)
		self.assertEqual(sum(1 for n in names if self.owner(n) == self.b), 2)
		self.assertEqual(sum(1 for n in names if self.owner(n) == src), 3)

	def test_only_a_system_manager_can_use_it(self):
		frappe.set_user(self.a)
		for fn, args in ((asg.list_rules, ()), (asg.list_people, ()), (asg.list_log, ()), (asg.transfer, ([self.a], [self.b], "Round robin"))):
			with self.assertRaises(frappe.PermissionError):
				fn(*args)
		with self.assertRaises(frappe.PermissionError):
			asg.save_rule({"rule_name": "x"})

	def test_a_rule_needs_a_condition_and_a_person(self):
		with self.assertRaises(frappe.ValidationError):
			rule("Empty", [], [self.a])
		with self.assertRaises(frappe.ValidationError):
			rule("Nobody", [["job_title", "=", "Bihar"]], [])


class TestUndo(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.a, cls.b, cls.c = (make_user(f"und_{x}@example.com", ["Sales User"]) for x in "abc")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_a_run_can_be_undone_and_the_leads_go_back_to_their_owners(self):
		names = [lead(f"U{i}", lead_owner=self.a).name for i in range(3)]
		asg.transfer([self.a], [self.b], "Round robin")
		hist = asg.list_history()
		group = next(g for g in hist["groups"] if g["source"] == "Transfer" and g["to_users"] and self.b in g["to_users"])
		self.assertEqual((group["count"], group["open"]), (3, 3))
		res = asg.undo(batch=group["batch"])
		self.assertEqual(res["assigned"], 3)
		for n in names:
			self.assertEqual(frappe.db.get_value("CRM Lead", n, "lead_owner"), self.a)
			self.assertEqual(asg._open_assignees(n), [self.a])
		self.assertEqual(asg.undo(batch=group["batch"])["assigned"], 0)  # not twice

	def test_a_lead_changed_since_is_left_alone(self):
		n = lead("Changed", lead_owner=self.a).name
		asg.transfer([self.a], [self.b], "Round robin")
		asg.transfer([self.b], [self.c], "Round robin")
		entry = frappe.get_all("CRM Assignment Log", filters={"lead": n, "to_users": self.b}, pluck="name")[0]
		self.assertEqual(asg.undo(entry=entry)["assigned"], 0)
		self.assertEqual(frappe.db.get_value("CRM Lead", n, "lead_owner"), self.c)

	def test_the_time_to_undo_runs_out(self):
		n = lead("Old", lead_owner=self.a).name
		asg.transfer([self.a], [self.b], "Round robin")
		entry = frappe.get_all("CRM Assignment Log", filters={"lead": n}, pluck="name")[0]
		frappe.db.set_value("CRM Assignment Log", entry, "creation", frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(asg.UNDO_HOURS + 1)), update_modified=False)
		self.assertEqual(asg.undo(entry=entry)["assigned"], 0)
		self.assertEqual(frappe.db.get_value("CRM Lead", n, "lead_owner"), self.b)

	def test_a_new_lead_with_no_owner_before_goes_back_to_no_owner(self):
		n = lead("Fresh").name
		frappe.db.set_value("CRM Lead", n, "lead_owner", None)
		asg.assign_lead(n, [self.a], "Manual")
		entry = frappe.get_all("CRM Assignment Log", filters={"lead": n}, pluck="name")[0]
		self.assertEqual(asg.undo(entry=entry)["assigned"], 1)
		self.assertFalse(frappe.db.get_value("CRM Lead", n, "lead_owner"))
		self.assertEqual(asg._open_assignees(n), [])
