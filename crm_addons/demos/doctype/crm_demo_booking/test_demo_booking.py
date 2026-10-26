# Copyright (c) 2026, Siddharth Singh
"""Demo booking tests.

Run on a bench:  bench --site <site> run-tests --module crm_addons.demos.doctype.crm_demo_booking.test_demo_booking

Same conventions as the rest of the add-on: plain unittest, every test rolled back, Google and the mail / WhatsApp providers faked. Time is frozen at
Monday 2030-03-04 00:00 UTC (05:30 in Kolkata) by patching ``common.utcnow``; ``self.now`` can be moved forward inside a test.
The pure slot arithmetic (no database) is in ``TestSlotMath``.
"""

import json
import time
import unittest
from datetime import datetime, time, timedelta
from unittest.mock import patch

import frappe

from crm_addons.demos import booking, common, messaging, slots, spam
from crm_addons.demos.common import BOOKING, DEMO_TYPE, MESSAGE, DemoError
from crm_addons.meetings.doctype.crm_meeting.test_crm_meeting import MEET, FakeGoogle, google_patch
from crm_addons.meetings.doctype.crm_meeting.test_crm_meeting import TestCase as Base
from crm_addons.providers.base import ProviderNotConfigured

FROZEN = datetime(2030, 3, 4, 0, 0)  # a Monday, 00:00 UTC = 05:30 in Kolkata
MONDAY = "2030-03-04"
WEEK = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def hours(days=WEEK, start="09:00:00", end="17:00:00"):
	return [{"weekday": d, "from_time": start, "to_time": end} for d in days]


def utc(day, hh, mm=0):
	return datetime.fromisoformat(f"{day}T{hh:02d}:{mm:02d}:00")


def ist(day, hh, mm=0):
	"""A Kolkata wall-clock time as naive UTC."""
	return utc(day, hh, mm) - timedelta(hours=5, minutes=30)


class FakeQueue(frappe._dict):
	pass


def pure_config(**kw):
	demo = {
		"timezone": "Asia/Kolkata", "duration_minutes": 30, "hours": hours(WEEK[:5]), "overrides": [],
		"min_notice_hours": 0, "max_days_ahead": 30, "buffer_before_minutes": 0, "buffer_after_minutes": 0, "max_per_day": 0,
	}
	demo.update(kw)
	return slots.config_of(demo)


class TestSlotMath(unittest.TestCase):
	"""Hours, overrides, notice, horizon and daylight saving, without a database."""

	def cand(self, cfg, lo, hi, now=FROZEN):
		return slots.candidates(cfg, lo, hi, now)

	def test_weekly_hours_follow_the_demo_zone(self):
		found = self.cand(pure_config(), utc(MONDAY, 0), utc("2030-03-11", 0))
		monday = [s for s in found if s.date().isoformat() == MONDAY or s < utc("2030-03-05", 3)]
		self.assertEqual(found[0], ist(MONDAY, 9))
		self.assertEqual(len([s for s in found if ist(MONDAY, 0) <= s < ist("2030-03-05", 0)]), 16)  # 09:00-17:00 in 30 minutes
		weekdays = {(s + timedelta(hours=5, minutes=30)).weekday() for s in found}
		self.assertEqual(weekdays, {0, 1, 2, 3, 4})  # nothing on Saturday or Sunday
		self.assertTrue(monday)

	def test_interval_shorter_than_duration(self):
		found = self.cand(pure_config(slot_interval_minutes=15), utc(MONDAY, 0), utc("2030-03-05", 0))
		self.assertEqual(len(found), 31)  # 09:00 .. 16:30 every 15 minutes
		self.assertEqual(found[1] - found[0], timedelta(minutes=15))

	def test_two_windows_in_a_day(self):
		rows = hours(["Mon"], "09:00:00", "10:00:00") + hours(["Mon"], "14:00:00", "15:00:00")
		found = self.cand(pure_config(hours=rows), utc(MONDAY, 0), utc("2030-03-05", 0))
		self.assertEqual(found, [ist(MONDAY, 9), ist(MONDAY, 9, 30), ist(MONDAY, 14), ist(MONDAY, 14, 30)])

	def test_date_override_unavailable_and_custom_hours(self):
		rows = [
			{"date": "2030-03-05", "kind": "Unavailable"},
			{"date": "2030-03-09", "kind": "Custom hours", "from_time": "10:00:00", "to_time": "12:00:00"},  # a Saturday
		]
		found = self.cand(pure_config(overrides=rows), utc(MONDAY, 0), utc("2030-03-11", 0))
		days = {(s + timedelta(hours=5, minutes=30)).date().isoformat() for s in found}
		self.assertNotIn("2030-03-05", days)
		self.assertIn("2030-03-09", days)
		saturday = [s for s in found if (s + timedelta(hours=5, minutes=30)).date().isoformat() == "2030-03-09"]
		self.assertEqual(saturday, [ist("2030-03-09", 10), ist("2030-03-09", 10, 30), ist("2030-03-09", 11), ist("2030-03-09", 11, 30)])

	def test_custom_override_replaces_the_weekly_hours_of_that_day(self):
		rows = [{"date": MONDAY, "kind": "Custom hours", "from_time": "15:00:00", "to_time": "16:00:00"}]
		found = self.cand(pure_config(overrides=rows), utc(MONDAY, 0), utc("2030-03-05", 0))
		self.assertEqual(found, [ist(MONDAY, 15), ist(MONDAY, 15, 30)])

	def test_minimum_notice(self):
		now = ist(MONDAY, 8, 30)
		found = self.cand(pure_config(min_notice_hours=2), utc(MONDAY, 0), utc("2030-03-05", 0), now)
		self.assertEqual(found[0], ist(MONDAY, 10, 30))  # 08:30 + 2 h
		self.assertTrue(all(s >= now + timedelta(hours=2) for s in found))

	def test_the_past_is_never_offered(self):
		now = ist(MONDAY, 12, 10)
		found = self.cand(pure_config(), utc(MONDAY, 0), utc("2030-03-05", 0), now)
		self.assertEqual(found[0], ist(MONDAY, 12, 30))

	def test_horizon_is_counted_in_the_demo_zone(self):
		found = self.cand(pure_config(hours=hours(), max_days_ahead=2), utc(MONDAY, 0), utc("2030-04-01", 0))
		last = max(s + timedelta(hours=5, minutes=30) for s in found)
		self.assertEqual(last.date().isoformat(), "2030-03-06")  # Monday + 2 days, to the end of that day

	def test_daylight_saving_moves_utc_not_wall_clock(self):
		cfg = pure_config(timezone="America/New_York", hours=hours())
		now = utc("2030-03-01", 0)
		saturday = self.cand(cfg, utc("2030-03-09", 0), utc("2030-03-10", 0), now)  # before the change (EST, UTC-5)
		monday = self.cand(cfg, utc("2030-03-11", 0), utc("2030-03-12", 0), now)  # after it (EDT, UTC-4)
		self.assertEqual(saturday[0], utc("2030-03-09", 14))  # 09:00 EST
		self.assertEqual(monday[0], utc("2030-03-11", 13))  # 09:00 EDT
		self.assertEqual(len(saturday), len(monday))

	def test_daylight_saving_end(self):
		cfg = pure_config(timezone="America/New_York", hours=hours(), max_days_ahead=60)
		now = utc("2030-10-01", 0)
		before = self.cand(cfg, utc("2030-11-02", 0), utc("2030-11-03", 0), now)  # EDT
		after = self.cand(cfg, utc("2030-11-04", 0), utc("2030-11-05", 0), now)  # EST
		self.assertEqual(before[0], utc("2030-11-02", 13))
		self.assertEqual(after[0], utc("2030-11-04", 14))

	def test_window_inside_the_spring_forward_gap(self):
		cfg = pure_config(timezone="America/New_York", hours=hours(["Sun"], "02:00:00", "04:00:00"))
		found = self.cand(cfg, utc("2030-03-10", 0), utc("2030-03-11", 0), utc("2030-03-01", 0))
		# 02:00 does not exist on that day: the window is the single real hour 03:00-04:00 EDT = 07:00-08:00 UTC
		self.assertEqual(found, [utc("2030-03-10", 7), utc("2030-03-10", 7, 30)])

	def test_day_in_a_zone_ahead_of_utc(self):
		cfg = pure_config(timezone="Pacific/Auckland", hours=hours(["Tue"], "09:00:00", "10:00:00"))
		found = self.cand(cfg, utc(MONDAY, 0), utc("2030-03-06", 0), utc("2030-03-01", 0))
		self.assertEqual(found, [utc(MONDAY, 20), utc(MONDAY, 20, 30)])  # Tuesday 09:00 in NZDT (UTC+13) is Monday 20:00 UTC

	def test_time_field_values_of_every_shape(self):
		self.assertEqual(slots._to_time(timedelta(hours=9, minutes=30)), time(9, 30))
		self.assertEqual(slots._to_time("09:30"), time(9, 30))
		self.assertEqual(slots._to_time("09:30:15"), time(9, 30, 15))
		self.assertIsNone(slots._to_time(""))


class TestSpamRules(unittest.TestCase):
	def test_phone_numbers(self):
		valid = {
			"9812345678": "919812345678",
			"+91 98123 45678": "919812345678",
			"09812345678": "919812345678",
			"919812345678": "919812345678",
			"0091-9812345678": "919812345678",
			"+44 7911 123456": "447911123456",
			"+1 (415) 555-0132": "14155550132",
		}
		for raw, expected in valid.items():
			self.assertEqual(spam.validate_phone(raw), expected, raw)
		for raw in ("", "12345", "5812345678", "981234567", "98123456789", "abcdefghij", "9999999999", "+919999999999", "+91 12345 67890", "+1234", "+12345678901234567"):
			with self.assertRaises(DemoError, msg=raw) as cm:
				spam.validate_phone(raw)
			self.assertEqual(cm.exception.code, "invalid_phone")

	def test_default_country_code_setting(self):
		self.assertEqual(spam.validate_phone("7911123456", "44"), "447911123456")
		self.assertEqual(spam.validate_phone("+91 9812345678", "44"), "919812345678")

	def test_emails(self):
		self.assertEqual(spam.validate_email("  Asha.Test@Example.COM "), "asha.test@example.com")
		for raw in ("", "nobody", "a@b", "a@@b.com", "x@mailinator.com", "x@yopmail.com", "a b@example.com"):
			with self.assertRaises(DemoError, msg=raw) as cm:
				spam.validate_email(raw)
			self.assertEqual(cm.exception.code, "invalid_email")

	def test_form_token_minimum_fill_time_and_expiry(self):
		now = 2_000_000_000
		token = spam.make_form_token("slug-a", at=now)
		spam.check_form_token("slug-a", token, now=now + spam.MIN_FILL_SECONDS + 1)  # fine
		for bad, when, code in (
			(token, now + 1, "too_fast"),
			(token, now + spam.TOKEN_MAX_AGE_SECONDS + 5, "form_expired"),
			(spam.make_form_token("slug-b", at=now), now + 60, "form_expired"),  # a token of another page
			(token[:-3] + "abc", now + 60, "form_expired"),
			("", now + 60, "form_expired"),
			("nonsense", now + 60, "form_expired"),
		):
			with self.assertRaises(DemoError) as cm:
				spam.check_form_token("slug-a", bad, now=when)
			self.assertEqual(cm.exception.code, code)

	def test_ip_is_hashed_never_stored_raw(self):
		hashed = spam.ip_hash("203.0.113.9")
		self.assertNotIn("203.0.113.9", hashed)
		self.assertEqual(hashed, spam.ip_hash("203.0.113.9"))
		self.assertNotEqual(hashed, spam.ip_hash("203.0.113.10"))
		self.assertIsNone(spam.ip_hash(None))


class DemoCase(Base):
	"""Frozen time, a faked Google, faked mail, one Sales User owner and helpers to make demo types and bookings."""

	def setUp(self):
		self.park_foreign_data()
		super().setUp()
		self.now = FROZEN
		for target in (patch.object(common, "utcnow", side_effect=lambda: self.now),
			patch.object(messaging, "_commit"), patch.object(messaging, "_rollback")):
			target.start()
			self.addCleanup(target.stop)
		self.google = FakeGoogle()
		for p in google_patch(self.google):
			p.start()
			self.addCleanup(p.stop)
		self.owner2 = self.make_user("owner2.test@example.org", "Sales User")
		self.n = 0

	def park_foreign_data(self):
		"""A site that is also used by hand has bookings and waiting messages of its own. For this test (it is rolled back) they are set aside,
		so what the test counts and what the scheduler sends is only what the test made."""
		for _attempt in range(5):  # first thing in the test, so a clash with somebody else's write (MariaDB asks to restart) loses nothing
			try:
				frappe.db.sql(f"update `tab{MESSAGE}` set status = 'Skipped' where status in ('Pending', 'Sending')")
				frappe.db.sql(f"update `tab{BOOKING}` set creation = '2001-01-01 00:00:00'")
				frappe.db.sql(f"update `tab{BOOKING}` set starts_utc = '2001-01-01 00:00:00', starts_on = '2001-01-01 00:00:00' where starts_utc > '2029-01-01'")
				return
			except frappe.QueryDeadlockError:
				frappe.db.rollback()
				time.sleep(0.3)

	# -- fixtures
	def make_demo(self, slug="test-demo", owners=None, **kw):
		values = {
			"doctype": DEMO_TYPE, "title": "Test Demo", "slug": slug, "enabled": 1, "duration_minutes": 30, "timezone": "Asia/Kolkata",
			"min_notice_hours": 0, "max_days_ahead": 90, "hours": hours(), "owners": [{"user": u} for u in (owners or [self.owner.name])],
			"lead_source": None, "max_per_ip_per_hour": 10,
		}
		values.update(kw)
		return frappe.get_doc(values).insert(ignore_permissions=True)

	def contact(self, **kw):
		self.n += 1
		return {"name": f"Visitor {self.n} Test", "email": f"visitor{self.n}.demo@example.com", "phone": f"98123{self.n:05d}", **kw}

	def book(self, demo, start, tz="Asia/Kolkata", consent=0, utm=None, guests=None, **answers):
		return booking.create_booking(demo, start, tz, answers={**self.contact(), **answers}, guests=guests, consent=consent, utm=utm)

	def row(self, name):
		return frappe.get_doc(BOOKING, name)

	def raw_booking(self, demo, start, status="Confirmed", **kw):
		"""A booking row without the lead / meeting machinery (for counting and reporting)."""
		self.n += 1
		values = {
			"doctype": BOOKING, "demo_type": demo.name, "status": status, "starts_utc": start, "starts_on": common.to_site(start),
			"ends_on": common.to_site(start + timedelta(minutes=30)), "name_": f"Raw {self.n}", "email": f"raw{self.n}@example.com",
			"phone": f"98999{self.n:05d}", "slot_key": booking.slot_key(demo.name, start) if status in common.ACTIVE else None,
		}
		values.update(kw)
		return frappe.get_doc(values).insert(ignore_permissions=True)

	def starts(self, demo, lo=None, hi=None):
		lo = lo or self.now
		return slots.available_slots(demo, lo, hi or lo + timedelta(days=3))

	def assertCode(self, code, fn, *args, **kwargs):
		with self.assertRaises(DemoError) as cm:
			fn(*args, **kwargs)
		self.assertEqual(cm.exception.code, code)

	def meeting_for(self, user, start, end, status="Scheduled", as_attendee=False):
		"""A CRM Meeting of one of the owners, made without any provider."""
		doc = frappe.new_doc("CRM Meeting")
		doc.update(
			{
				"subject": "Busy", "reference_doctype": "CRM Lead", "reference_docname": self.lead.name, "starts_on": common.to_site(start),
				"ends_on": common.to_site(end), "provider": "Manual Link", "add_video_conferencing": 0, "status": status,
				"organizer": self.owner.name if as_attendee else user,
			}
		)
		# a meeting with no guests would get the lead's contact and owner added, which would make the lead owner a guest of everything
		doc.append("attendees", {"email": frappe.db.get_value("User", user, "email")})
		doc.flags.notify_guests = False
		return doc.insert(ignore_permissions=True)


class TestSlots(DemoCase):
	def test_an_owners_meeting_blocks_exactly_its_time(self):
		demo = self.make_demo()
		self.meeting_for(self.owner.name, ist(MONDAY, 10), ist(MONDAY, 10, 30))
		found = self.starts(demo)
		self.assertNotIn(ist(MONDAY, 10), found)
		self.assertIn(ist(MONDAY, 9, 30), found)
		self.assertIn(ist(MONDAY, 10, 30), found)

	def test_every_owner_counts_when_there_are_several(self):
		demo = self.make_demo(owners=[self.owner.name, self.owner2.name])
		self.meeting_for(self.owner2.name, ist(MONDAY, 11), ist(MONDAY, 11, 30), as_attendee=True)  # second owner only a guest
		self.meeting_for(self.owner.name, ist(MONDAY, 12), ist(MONDAY, 12, 30))
		found = self.starts(demo)
		self.assertNotIn(ist(MONDAY, 11), found)
		self.assertNotIn(ist(MONDAY, 12), found)

	def test_someone_elses_meeting_and_cancelled_meetings_do_not_block(self):
		demo = self.make_demo()
		other = self.make_user("other.person@example.org", "Sales User")
		self.meeting_for(other.name, ist(MONDAY, 10), ist(MONDAY, 10, 30))
		self.meeting_for(self.owner.name, ist(MONDAY, 11), ist(MONDAY, 11, 30), status="Cancelled")
		found = self.starts(demo)
		self.assertIn(ist(MONDAY, 10), found)
		self.assertIn(ist(MONDAY, 11), found)

	def test_buffers_keep_distance_from_other_meetings(self):
		demo = self.make_demo(buffer_before_minutes=15, buffer_after_minutes=15)
		self.meeting_for(self.owner.name, ist(MONDAY, 10), ist(MONDAY, 10, 30))
		found = self.starts(demo)
		self.assertIn(ist(MONDAY, 9), found)  # ends 09:30, +15 = 09:45, clear of 10:00
		self.assertNotIn(ist(MONDAY, 9, 30), found)  # would end 10:00, +15 overlaps the meeting
		self.assertNotIn(ist(MONDAY, 10, 30), found)  # starts 10:30, -15 overlaps
		self.assertIn(ist(MONDAY, 11), found)

	def test_per_day_cap(self):
		demo = self.make_demo(max_per_day=2)
		self.raw_booking(demo, ist(MONDAY, 9))
		self.assertTrue([s for s in self.starts(demo) if s < ist("2030-03-05", 0)])
		self.raw_booking(demo, ist(MONDAY, 14))
		found = self.starts(demo)
		self.assertFalse([s for s in found if s < ist("2030-03-05", 0)])  # Monday is full
		self.assertTrue([s for s in found if s >= ist("2030-03-05", 0)])  # Tuesday is not

	def test_cancelled_bookings_do_not_count_toward_the_cap(self):
		demo = self.make_demo(max_per_day=1)
		self.raw_booking(demo, ist(MONDAY, 9), status="Cancelled")
		self.assertIn(ist(MONDAY, 10), self.starts(demo))

	def test_a_booked_slot_disappears(self):
		demo = self.make_demo()
		self.assertIn(ist(MONDAY, 10), self.starts(demo))
		self.book(demo, ist(MONDAY, 10))
		self.assertNotIn(ist(MONDAY, 10), self.starts(demo))

	def test_get_slots_labels_days_in_the_visitors_zone(self):
		demo = self.make_demo()
		result = slots.get_slots(demo, "2030-03-03", "2030-03-05", "America/Los_Angeles")
		self.assertEqual(result["tz"], "America/Los_Angeles")
		days = {d["date"]: d["slots"] for d in result["days"]}
		# Monday 09:00 IST = Sunday 2030-03-03 19:30 in Los Angeles (PST)
		self.assertEqual(days["2030-03-03"][0], {"start": "2030-03-04T03:30:00Z", "label": "7:30 PM"})
		self.assertTrue(all(d["slots"] for d in result["days"]))  # only days that have a slot are listed

	def test_the_range_is_capped(self):
		demo = self.make_demo(max_days_ahead=365)
		result = slots.get_slots(demo, "2030-03-04", "2031-03-04", "Asia/Kolkata")
		self.assertLessEqual(len(result["days"]), slots.MAX_RANGE_DAYS)

	def test_unknown_visitor_zone_falls_back_to_the_demo_zone(self):
		demo = self.make_demo()
		result = slots.get_slots(demo, MONDAY, MONDAY, "Not/AZone")
		self.assertEqual(result["tz"], "Asia/Kolkata")

	def test_no_owner_no_slots(self):
		demo = self.make_demo()
		frappe.db.set_value("User", self.owner.name, "enabled", 0)
		self.assertEqual(self.starts(demo), [])

	def test_slot_query_count_does_not_grow_with_the_range(self):
		demo = self.make_demo()
		for hour in (10, 11, 12):
			self.meeting_for(self.owner.name, ist(MONDAY, hour), ist(MONDAY, hour, 30))
		slots.available_slots(demo, self.now, self.now + timedelta(days=2))  # warm the caches
		calls = []
		original = frappe.db.sql

		def counting(query, *a, **k):
			calls.append(str(query))
			return original(query, *a, **k)

		with patch.object(frappe.db, "sql", side_effect=counting):
			slots.available_slots(demo, self.now, self.now + timedelta(days=2))
			few = len(calls)
			calls.clear()
			slots.available_slots(demo, self.now, self.now + timedelta(days=60))
		self.assertEqual(len(calls), few)  # one query for the meetings and one for the bookings, however long the range


class TestBooking(DemoCase):
	def test_booking_makes_the_lead_the_meeting_and_the_invitations(self):
		cc_user = self.make_user("cc.user@example.org", "Sales User")
		demo = self.make_demo(
			owners=[self.owner.name, self.owner2.name], allow_guests=1,
			cc=[{"user": cc_user.name}, {"email": "boss@example.com"}],
			lead_source=None, lead_status=None, manual_link="https://example.com/fallback",
		)
		utm = {"utm_source": "google", "utm_medium": "cpc", "utm_campaign": "spring", "gclid": "abc"}
		name = self.book(demo, ist(MONDAY, 10), consent=1, utm=utm, guests="friend@example.com, friend@example.com", organization="Little School", notes="hello")
		b = self.row(name)
		self.assertEqual((b.status, b.demo_type), ("Confirmed", demo.name))
		self.assertEqual(b.starts_utc, ist(MONDAY, 10))
		self.assertEqual(b.starts_on, common.to_site(ist(MONDAY, 10)))
		self.assertGreaterEqual(len(b.token), 32)
		self.assertEqual(b.slot_key, booking.slot_key(demo.name, ist(MONDAY, 10)))
		self.assertEqual((b.utm_source, b.utm_medium, b.utm_campaign, b.gclid), ("google", "cpc", "spring", "abc"))
		self.assertEqual(json.loads(b.answers), {"notes": "hello"})
		self.assertEqual(b.guests, "friend@example.com")

		lead = frappe.get_doc("CRM Lead", b.lead)
		self.assertEqual(lead.email, b.email)
		self.assertEqual(lead.lead_owner, self.owner.name)  # a new lead goes to the first owner
		self.assertEqual(lead.mobile_no, "+" + b.phone)
		self.assertEqual(lead.get("crm_demo_first_utm_source"), "google")
		self.assertEqual(lead.get("crm_wa_opt_in"), 1)

		meeting = frappe.get_doc("CRM Meeting", b.meeting)
		self.assertEqual((meeting.is_demo, meeting.demo_type, str(meeting.demo_booking)), (1, demo.name, b.name))
		self.assertEqual(meeting.organizer, self.owner.name)  # one meeting, the first owner organizes
		self.assertEqual(meeting.owner, self.owner.name)
		emails = {a.email for a in meeting.attendees}
		self.assertEqual(emails, {self.owner.email, self.owner2.email, cc_user.email, "boss@example.com", b.email, "friend@example.com"})
		self.assertEqual(frappe.db.count("CRM Meeting", {"demo_booking": b.name}), 1)
		self.assertEqual((meeting.sync_status, meeting.google_meet_link), ("Synced", MEET))
		self.assertEqual(self.google.verbs("insert")[0]["sendUpdates"], "all")

	def test_google_not_connected_still_books_and_falls_back_to_the_manual_link(self):
		demo = self.make_demo(manual_link="https://example.com/room")
		with patch("crm_addons.providers.google_meet.pick_calendar", side_effect=ProviderNotConfigured("No Google Calendar is connected.")):
			name = self.book(demo, ist(MONDAY, 10))
		meeting = frappe.get_doc("CRM Meeting", self.row(name).meeting)
		self.assertEqual(meeting.sync_status, "Not synced")
		self.assertEqual(meeting.google_meet_link, "https://example.com/room")
		self.assertEqual(booking.payload(name)["meet_link"], "https://example.com/room")

	def test_a_failing_google_call_does_not_lose_the_booking(self):
		demo = self.make_demo()
		self.google.error = Exception("boom")
		name = self.book(demo, ist(MONDAY, 10))
		self.assertEqual(frappe.db.get_value("CRM Meeting", self.row(name).meeting, "sync_status"), "Failed")
		self.assertEqual(self.row(name).status, "Confirmed")

	def test_lead_matched_by_email_is_reused_and_left_alone(self):
		demo = self.make_demo(lead_source=None)
		existing = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Known", "last_name": "Lead", "email": "known.lead@example.com", "lead_owner": self.owner2.name}).insert(ignore_permissions=True)
		name = self.book(demo, ist(MONDAY, 10), email="Known.Lead@example.com", utm={"utm_source": "facebook"})
		b = self.row(name)
		self.assertEqual(b.lead, existing.name)
		self.assertEqual(frappe.db.get_value("CRM Lead", existing.name, "lead_owner"), self.owner2.name)
		self.assertFalse(frappe.db.get_value("CRM Lead", existing.name, "crm_demo_first_utm_source"))  # first touch is for a new lead only
		self.assertEqual(b.utm_source, "facebook")  # but the booking keeps its own
		self.assertEqual(frappe.db.count("CRM Lead", {"email": "known.lead@example.com"}), 1)

	def test_lead_matched_by_phone_when_the_email_is_new(self):
		demo = self.make_demo()
		existing = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Phone", "last_name": "Lead", "email": "phone.lead@example.com", "mobile_no": "+91 98123-45670"}).insert(ignore_permissions=True)
		name = self.book(demo, ist(MONDAY, 10), email="different.mail@example.com", phone="9812345670")
		self.assertEqual(self.row(name).lead, existing.name)

	def test_a_new_lead_gets_the_configured_source_status_and_no_owner_when_switched_off(self):
		source = frappe.db.get_value("CRM Lead Source", {}, "name")
		status = frappe.db.get_value("CRM Lead Status", {"name": "Contacted"}, "name")
		demo = self.make_demo(lead_source=source, lead_status=status, assign_lead_to_owner=0)
		lead = frappe.get_doc("CRM Lead", self.row(self.book(demo, ist(MONDAY, 10))).lead)
		if source:
			self.assertEqual(lead.source, source)
		if status:
			self.assertEqual(lead.status, status)
		self.assertFalse(lead.lead_owner)

	def test_double_booking_is_refused(self):
		demo = self.make_demo()
		self.book(demo, ist(MONDAY, 10))
		self.assertCode("slot_taken", self.book, demo, ist(MONDAY, 10))
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": demo.name}), 1)

	def test_the_unique_key_alone_stops_a_double_booking(self):
		"""Even if the availability check were fooled (a race), the database refuses the second row and the visitor is told slot_taken."""
		demo = self.make_demo()
		self.book(demo, ist(MONDAY, 10))
		with patch.object(slots, "is_available", return_value=True):
			self.assertCode("slot_taken", self.book, demo, ist(MONDAY, 10))
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": demo.name}), 1)
		self.assertEqual(frappe.db.count("CRM Meeting", {"demo_type": demo.name}), 1)  # nothing half-made was left behind

	def test_a_slot_that_is_not_offered_cannot_be_booked(self):
		demo = self.make_demo()
		self.assertCode("slot_taken", self.book, demo, ist(MONDAY, 3))  # 03:00 in the morning
		self.assertCode("slot_taken", self.book, demo, FROZEN - timedelta(days=1))  # the past

	def test_two_owners_demo_types_share_the_calendar(self):
		first = self.make_demo(slug="demo-one", owners=[self.owner.name, self.owner2.name])
		second = self.make_demo(slug="demo-two", owners=[self.owner2.name])
		self.book(first, ist(MONDAY, 10))
		self.assertCode("slot_taken", self.book, second, ist(MONDAY, 10))  # owner2 is busy in the other type's meeting

	def test_reschedule_frees_the_old_slot_and_takes_the_new_one(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		token = self.row(name).token
		booking.reschedule(name, ist(MONDAY, 14), "Asia/Kolkata")
		b = self.row(name)
		self.assertEqual((b.status, b.token, b.starts_utc, b.rescheduled_from), ("Rescheduled", token, ist(MONDAY, 14), ist(MONDAY, 10)))
		self.assertEqual(b.slot_key, booking.slot_key(demo.name, ist(MONDAY, 14)))
		self.assertEqual(frappe.db.get_value("CRM Meeting", b.meeting, "starts_on"), common.to_site(ist(MONDAY, 14)))
		found = self.starts(demo)
		self.assertIn(ist(MONDAY, 10), found)
		self.assertNotIn(ist(MONDAY, 14), found)
		self.book(demo, ist(MONDAY, 10))  # someone else can have the freed slot
		self.assertTrue(self.google.verbs("patch"))  # Google was told

	def test_reschedule_to_a_taken_slot_changes_nothing(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		self.book(demo, ist(MONDAY, 14))
		self.assertCode("slot_taken", booking.reschedule, name, ist(MONDAY, 14))
		b = self.row(name)
		self.assertEqual((b.status, b.starts_utc), ("Confirmed", ist(MONDAY, 10)))
		self.assertEqual(frappe.db.get_value("CRM Meeting", b.meeting, "starts_on"), common.to_site(ist(MONDAY, 10)))

	def test_reschedule_next_to_your_own_slot_is_allowed(self):
		demo = self.make_demo(slot_interval_minutes=15)
		name = self.book(demo, ist(MONDAY, 10))
		booking.reschedule(name, ist(MONDAY, 10, 15))  # overlaps the booking being moved, not anyone else's
		self.assertEqual(self.row(name).starts_utc, ist(MONDAY, 10, 15))

	def test_cancel_frees_the_slot_and_the_meeting(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		booking.cancel(name, "Changed my mind")
		b = self.row(name)
		self.assertEqual((b.status, b.slot_key, b.cancel_reason), ("Cancelled", None, "Changed my mind"))
		self.assertEqual(frappe.db.get_value("CRM Meeting", b.meeting, "status"), "Cancelled")
		self.assertIn(ist(MONDAY, 10), self.starts(demo))
		self.assertTrue(self.google.verbs("delete"))
		self.book(demo, ist(MONDAY, 10))

	def test_a_started_or_cancelled_demo_cannot_be_changed(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		booking.cancel(name)
		self.assertCode("not_changeable", booking.cancel, name)
		self.assertCode("not_changeable", booking.reschedule, name, ist(MONDAY, 14))
		other = self.book(demo, ist(MONDAY, 12))
		self.now = ist(MONDAY, 12, 5)
		self.assertCode("not_changeable", booking.cancel, other)
		self.assertCode("not_changeable", booking.reschedule, other, ist("2030-03-05", 12))

	def test_repeat_contact_limit(self):
		demo = self.make_demo(max_active_per_contact=1)
		name = self.book(demo, ist(MONDAY, 10), email="same.person@example.com", phone="9812345001")
		self.assertCode("repeat_contact", self.book, demo, ist(MONDAY, 11), email="same.person@example.com", phone="9812345002")
		self.assertCode("repeat_contact", self.book, demo, ist(MONDAY, 11), email="other.person@example.com", phone="9812345001")
		booking.cancel(name)
		self.book(demo, ist(MONDAY, 11), email="same.person@example.com", phone="9812345001")  # the old one is gone

	def test_repeat_limit_can_be_raised(self):
		demo = self.make_demo(max_active_per_contact=2)
		self.book(demo, ist(MONDAY, 10), email="two@example.com", phone="9812345003")
		self.book(demo, ist(MONDAY, 11), email="two@example.com", phone="9812345003")
		self.assertCode("repeat_contact", self.book, demo, ist(MONDAY, 12), email="two@example.com", phone="9812345003")

	def test_per_ip_limit_and_only_a_hash_is_stored(self):
		demo = self.make_demo(max_per_ip_per_hour=1)
		first = booking.create_booking(demo, ist(MONDAY, 10), "Asia/Kolkata", answers=self.contact(), ip="203.0.113.77")
		self.assertCode("rate_limited", booking.create_booking, demo, ist(MONDAY, 11), "Asia/Kolkata", answers=self.contact(), ip="203.0.113.77")
		booking.create_booking(demo, ist(MONDAY, 11), "Asia/Kolkata", answers=self.contact(), ip="203.0.113.78")  # another address is fine
		b = self.row(first)
		self.assertEqual(b.ip_hash, spam.ip_hash("203.0.113.77"))
		self.assertNotIn("203.0.113.77", json.dumps(b.as_dict(), default=str))

	def test_required_and_optional_fields_are_checked(self):
		demo = self.make_demo(fields=[
			{"key": "organization", "label": "School", "kind": "Text", "required": 1, "enabled": 1},
			{"key": "grade", "label": "Grade", "kind": "Select", "options": "One\nTwo", "enabled": 1},
			{"key": "notes", "label": "Notes", "kind": "Long Text", "enabled": 0},
		])
		self.assertCode("field_required", self.book, demo, ist(MONDAY, 10))  # school missing
		self.assertCode("field_required", self.book, demo, ist(MONDAY, 10), organization="S", grade="Three")
		self.assertCode("field_required", booking.create_booking, demo, ist(MONDAY, 10), "Asia/Kolkata", {"email": "a@example.com", "phone": "9812345678", "organization": "S"})  # no name
		name = self.book(demo, ist(MONDAY, 10), organization="S", grade="Two", notes="ignored")
		self.assertEqual(json.loads(self.row(name).answers), {"grade": "Two"})  # a disabled field is dropped

	def test_guests_only_when_allowed_and_capped(self):
		off = self.make_demo(slug="no-guests", allow_guests=0)
		on = self.make_demo(slug="with-guests", allow_guests=1)
		self.assertFalse(self.row(self.book(off, ist(MONDAY, 10), guests="a@example.com")).guests)
		many = ",".join(f"g{i}@example.com" for i in range(9))
		self.assertEqual(len(self.row(self.book(on, ist(MONDAY, 11), guests=many)).guests.split(", ")), booking.MAX_GUESTS)
		self.assertCode("invalid_email", self.book, on, ist(MONDAY, 12), guests="not-an-email")

	def test_the_team_cancelling_in_crm_cancels_the_booking(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		meeting = frappe.get_doc("CRM Meeting", self.row(name).meeting)
		meeting.status = "Cancelled"
		meeting.save(ignore_permissions=True)
		b = self.row(name)
		self.assertEqual((b.status, b.slot_key), ("Cancelled", None))
		self.assertFalse(frappe.get_all(MESSAGE, filters={"parent": name, "event": ["!=", "Cancelled"], "status": "Pending"}, parent_doctype=BOOKING))  # nothing else waits

	def test_the_team_moving_or_closing_the_meeting_in_crm_updates_the_booking(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		meeting = frappe.get_doc("CRM Meeting", self.row(name).meeting)
		meeting.starts_on, meeting.ends_on = common.to_site(ist(MONDAY, 13)), common.to_site(ist(MONDAY, 13, 30))
		meeting.save(ignore_permissions=True)
		b = self.row(name)
		self.assertEqual((b.status, b.starts_utc), ("Rescheduled", ist(MONDAY, 13)))
		self.assertIn(ist(MONDAY, 10), self.starts(demo))
		meeting.reload()
		meeting.meeting_outcome = "Held"
		meeting.save(ignore_permissions=True)
		self.assertEqual(self.row(name).status, "Completed")

	def test_booking_survives_a_deleted_lead_in_the_messages(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		frappe.db.set_value(BOOKING, name, "lead", "CRM-LEAD-NOPE-0", update_modified=False)
		context = messaging.demo_context(self.row(name))
		self.assertTrue(context["demo_title"])
