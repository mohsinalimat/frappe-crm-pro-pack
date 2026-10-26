# Copyright (c) 2026, Siddharth Singh
"""Real concurrency: several threads, each with its own database connection, race for the same slot or the same message.

These tests COMMIT (a transaction nobody else can see cannot race), so they create their own users, demo types and leads with a fixed prefix
and delete everything they made when the class is done. They are the only tests in the add-on that do.

Run on a bench:  bench --site <site> run-tests --module crm_addons.demos.doctype.crm_demo_booking.test_concurrency
"""

import threading
import unittest
from unittest.mock import patch
import time

import frappe

from crm_addons.demos import booking, common, messaging
from crm_addons.demos.common import BOOKING, DEMO_TYPE, MESSAGE, DemoError
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import FROZEN, MONDAY, FakeGoogle, FakeQueue, google_patch, hours, ist

PREFIX = "conc-"
MAIL = "conc.%@example.com"


def _delete(doctype, filters):
	try:
		frappe.db.delete(doctype, filters)
	except Exception:
		frappe.db.rollback()


class TestConcurrency(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		frappe.set_user("Administrator")
		frappe.flags.in_test = True
		cls.site_name, cls.sites_path = frappe.local.site, frappe.local.sites_path
		cls.made_calendar = not frappe.db.exists("Google Calendar", "CRM Add-ons")
		if cls.made_calendar:
			calendar = frappe.get_doc({"doctype": "Google Calendar", "calendar_name": "CRM Add-ons", "user": "Administrator"})
			calendar.flags.ignore_validate = True
			calendar.insert(ignore_permissions=True)
		cls.users = []
		for n in (1, 2):
			email = f"conc.owner{n}@example.com"
			if not frappe.db.exists("User", email):
				user = frappe.get_doc({"doctype": "User", "email": email, "first_name": f"Conc{n}", "send_welcome_email": 0, "roles": [{"role": "Sales User"}]})
				user.flags.ignore_permissions = True
				user.insert()
			cls.users.append(email)
		cls.demo = cls.make_demo(f"{PREFIX}one", cls.users)
		cls.other = cls.make_demo(f"{PREFIX}two", cls.users[:1])
		frappe.db.commit()

	@classmethod
	def make_demo(cls, slug, owners):
		return frappe.get_doc(
			{"doctype": DEMO_TYPE, "title": "Conc Demo", "slug": slug, "enabled": 1, "duration_minutes": 30, "timezone": "Asia/Kolkata", "min_notice_hours": 0,
			"max_days_ahead": 90, "hours": hours(), "owners": [{"user": u} for u in owners], "max_per_ip_per_hour": 0, "max_active_per_contact": 0}
		).insert(ignore_permissions=True)

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		types = frappe.get_all(DEMO_TYPE, filters={"name": ["like", f"{PREFIX}%"]}, pluck="name")
		bookings = frappe.get_all(BOOKING, filters={"demo_type": ["in", types or [""]]}, pluck="name")
		meetings = frappe.get_all("CRM Meeting", filters={"demo_type": ["in", types or [""]]}, pluck="name")
		leads = frappe.get_all("CRM Lead", filters={"email": ["like", MAIL]}, pluck="name")
		_delete(MESSAGE, {"parent": ["in", bookings or [""]]})
		_delete(BOOKING, {"name": ["in", bookings or [""]]})
		_delete("CRM Meeting Attendee", {"parent": ["in", meetings or [""]]})
		_delete("CRM Meeting", {"name": ["in", meetings or [""]]})
		for doctype in ("Comment", "CRM Notification", "ToDo", "Communication", "DocShare", "Version", "Activity Log"):
			for field in ("reference_name", "reference_docname", "docname"):
				if leads and frappe.get_meta(doctype).has_field(field):
					_delete(doctype, {field: ["in", leads]})
		_delete("CRM Lead", {"name": ["in", leads or [""]]})
		for child in ("CRM Demo Owner", "CRM Demo CC", "CRM Demo Hours", "CRM Demo Date Override", "CRM Demo Field", "CRM Demo Message Rule"):
			_delete(child, {"parent": ["in", types or [""]]})
		_delete(DEMO_TYPE, {"name": ["in", types or [""]]})
		for email in cls.users:
			_delete("Has Role", {"parent": email})
			_delete("User", {"name": email})
		if cls.made_calendar:
			_delete("Google Calendar", {"name": "CRM Add-ons"})
		frappe.db.commit()

	def setUp(self):
		for target in (
			patch.object(common, "utcnow", return_value=FROZEN), patch("frappe.log_error"), patch.object(messaging, "kick"),
			patch.object(frappe, "sendmail", side_effect=self.fake_mail),
		):
			target.start()
			self.addCleanup(target.stop)
		for p in google_patch(FakeGoogle()):
			p.start()
			self.addCleanup(p.stop)
		self.mails = []
		self.n = 0

	def fake_mail(self, **kw):
		self.mails.append(kw)
		time.sleep(0.2)  # long enough for the other worker to try
		return FakeQueue(name=f"Q-{len(self.mails)}", message_id="<x>")

	def tearDown(self):
		frappe.db.rollback()
		for doctype, filters in ((MESSAGE, None), (BOOKING, {"demo_type": ["like", f"{PREFIX}%"]})):
			if doctype == BOOKING:
				names = frappe.get_all(BOOKING, filters=filters, pluck="name")
				_delete(MESSAGE, {"parent": ["in", names or [""]]})
				_delete(BOOKING, {"name": ["in", names or [""]]})
		for name in frappe.get_all("CRM Meeting", filters={"demo_type": ["like", f"{PREFIX}%"]}, pluck="name"):
			_delete("CRM Meeting Attendee", {"parent": name})
			_delete("CRM Meeting", {"name": name})
		frappe.db.commit()

	def contact(self):
		self.n += 1
		return {"name": f"Racer {self.n} Test", "email": f"conc.racer{self.n}.{id(self)}@example.com", "phone": f"98124{self.n:05d}"}

	def race(self, *jobs):
		"""Run every job in its own thread (and database connection) at the same moment. Returns [("ok", value) | ("err", exception)]."""
		barrier = threading.Barrier(len(jobs))
		results = [None] * len(jobs)
		site, sites_path = type(self).site_name, type(self).sites_path

		def run(i, job):
			frappe.init(site=site, sites_path=sites_path)
			frappe.connect()
			frappe.set_user("Administrator")
			frappe.flags.in_test = False  # as in production: the snapshot is refreshed, nothing is skipped
			try:
				barrier.wait(15)
				results[i] = ("ok", job())
				frappe.db.commit()
			except Exception as exc:
				frappe.db.rollback()
				results[i] = ("err", exc)
			finally:
				frappe.destroy()

		threads = [threading.Thread(target=run, args=(i, job)) for i, job in enumerate(jobs)]
		for t in threads:
			t.start()
		for t in threads:
			t.join(60)
		frappe.db.rollback()  # see what they committed
		return results

	def book_job(self, demo_name, start):
		contact = self.contact()

		def job():
			demo = frappe.get_doc(DEMO_TYPE, demo_name)
			return booking.create_booking(demo, start, "Asia/Kolkata", answers=contact, fresh=True)

		return job

	def codes(self, results):
		return sorted(r[1].code if isinstance(r[1], DemoError) else r[0] for r in results)

	def test_two_visitors_race_for_the_same_slot(self):
		start = ist(MONDAY, 10)
		results = self.race(self.book_job(self.demo.name, start), self.book_job(self.demo.name, start))
		self.assertEqual(self.codes(results), ["ok", "slot_taken"], [str(r[1]) for r in results])
		rows = frappe.get_all(BOOKING, filters={"demo_type": self.demo.name, "status": "Confirmed"}, fields=["name", "meeting", "slot_key"])
		self.assertEqual(len(rows), 1)
		self.assertEqual(frappe.db.count("CRM Meeting", {"demo_type": self.demo.name}), 1)

	def test_several_visitors_race_for_the_same_slot(self):
		start = ist(MONDAY, 11)
		results = self.race(*[self.book_job(self.demo.name, start) for _ in range(5)])
		self.assertEqual(self.codes(results), ["ok"] + ["slot_taken"] * 4, [str(r[1]) for r in results])
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": self.demo.name, "status": "Confirmed"}), 1)

	def test_visitors_of_different_slots_all_get_one(self):
		results = self.race(*[self.book_job(self.demo.name, ist(MONDAY, 10 + i)) for i in range(4)])
		self.assertEqual(self.codes(results), ["ok"] * 4, [str(r[1]) for r in results])
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": self.demo.name, "status": "Confirmed"}), 4)

	def test_two_demo_types_with_a_shared_owner_cannot_both_take_the_time(self):
		start = ist(MONDAY, 12)
		results = self.race(self.book_job(self.demo.name, start), self.book_job(self.other.name, start))
		self.assertEqual(self.codes(results), ["ok", "slot_taken"], [str(r[1]) for r in results])
		self.assertEqual(frappe.db.count("CRM Meeting", {"demo_type": ["like", f"{PREFIX}%"]}), 1)

	def test_a_move_and_a_new_booking_race_for_the_same_slot(self):
		first = booking.create_booking(self.demo, ist(MONDAY, 10), "Asia/Kolkata", answers=self.contact())
		frappe.db.commit()
		target = ist(MONDAY, 14)
		results = self.race(lambda: booking.reschedule(first, target, "Asia/Kolkata", fresh=True), self.book_job(self.demo.name, target))
		self.assertEqual(self.codes(results), ["ok", "slot_taken"], [str(r[1]) for r in results])
		at_target = frappe.get_all(BOOKING, filters={"demo_type": self.demo.name, "starts_utc": target, "status": ["in", ["Confirmed", "Rescheduled"]]})
		self.assertEqual(len(at_target), 1)

	def test_two_workers_send_a_message_once(self):
		self.demo.reload()
		template = frappe.get_doc(
			{"doctype": "CRM Campaign Email Template", "template_name": f"{PREFIX}tpl", "subject": "Hi {{ demo_title }}", "body_html": "<p>{{ demo_time }}</p>", "enabled": 1}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: (frappe.db.rollback(), _delete("CRM Campaign Email Template", {"name": template.name}), _delete("Email Template", {"name": ["like", f"{template.name}%"]}), frappe.db.commit()))
		demo = frappe.get_doc(DEMO_TYPE, self.demo.name)
		demo.set("messages", [])
		demo.append("messages", {"event": "Confirmed", "send_email": 1, "email_template": template.name})
		demo.save(ignore_permissions=True)
		name = booking.create_booking(demo, ist("2030-03-06", 10), "Asia/Kolkata", answers=self.contact())
		frappe.db.commit()
		rows = frappe.get_all(MESSAGE, filters={"parent": name}, pluck="name", parent_doctype=BOOKING)
		self.assertEqual(len(rows), 1)
		with patch.object(messaging, "email_account_problem", return_value=None):
			results = self.race(lambda: messaging.process(rows[0]), lambda: messaging.process(rows[0]), lambda: messaging.send_due())
		visitor_mails = [m for m in self.mails if m.get("communication")]
		self.assertEqual(len(visitor_mails), 1, results)
		self.assertEqual(frappe.db.get_value(MESSAGE, rows[0], "status"), "Sent")
		self.assertEqual(sorted(r[0] for r in results), ["ok", "ok", "ok"])
