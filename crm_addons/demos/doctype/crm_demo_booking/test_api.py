# Copyright (c) 2026, Siddharth Singh
"""The guest API, the manager API, permissions, the report and the framing headers.

Run on a bench:  bench --site <site> run-tests --module crm_addons.demos.doctype.crm_demo_booking.test_api
"""

import json
import time
from datetime import timedelta
from unittest.mock import patch

import frappe
from werkzeug.wrappers import Response

from crm_addons.demos import admin, common, framing, public, report, spam
from crm_addons.demos.common import BOOKING, DEMO_TYPE, MESSAGE, DemoError
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import MONDAY, DemoCase, ist


class ApiCase(DemoCase):
	def guest_book(self, demo, start, tz="Asia/Kolkata", consent=0, hp=None, token_age=60, **answers):
		"""What the booking page does: post the form with the token it was given a minute ago."""
		return public.book(
			slug=demo.name, start=common.iso_z(start), tz=tz, answers=json.dumps({**self.contact(), **answers}), consent=consent,
			utm=json.dumps({"utm_source": "google", "utm_medium": "cpc"}), landing_url="https://school.example.com/?utm_source=google", referrer="https://www.google.com/",
			form_token=spam.make_form_token(demo.name, at=time.time() - token_age), hp=hp,
		)

	def as_user(self, user):
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")


class TestGuestApi(ApiCase):
	def test_get_demo_gives_the_page_what_it_needs_and_nothing_more(self):
		demo = self.make_demo(brand_name="Coding Junior", accent_color="#2563eb", theme="Dark", allowed_origins="https://www.codingjunior.example", consent_text="WhatsApp me", allow_guests=1)
		self.as_user("Guest")
		data = public.get_demo(demo.name)
		self.assertEqual((data["slug"], data["title"], data["duration_minutes"], data["timezone"], data["provider"]), (demo.name, "Test Demo", 30, "Asia/Kolkata", "Google Meet"))
		self.assertEqual(data["brand"]["name"], "Coding Junior")
		self.assertEqual((data["brand"]["accent"], data["brand"]["theme"]), ("#2563eb", "dark"))
		self.assertEqual([f["key"] for f in data["fields"]][:3], ["name", "email", "phone"])
		self.assertTrue(all(f["required"] for f in data["fields"][:3]))
		self.assertEqual(data["consent"], {"text": "WhatsApp me", "default": 0})
		self.assertEqual((data["min_date"], data["max_date"]), (MONDAY, "2030-06-02"))
		self.assertTrue(data["form_token"])
		text = json.dumps(data)
		for secret in (self.owner.name, self.owner.email, "allowed_origins", "lead_field", "max_per_ip"):
			self.assertNotIn(secret, text)

	def test_disabled_and_unknown_pages_are_not_found(self):
		demo = self.make_demo(enabled=0, owners=[self.owner.name])
		self.as_user("Guest")
		self.assertCode("unavailable", public.get_demo, demo.name)
		self.assertCode("not_found", public.get_demo, "no-such-demo")
		self.assertCode("not_found", public.get_demo, "../etc/passwd")
		self.assertCode("not_found", public.get_slots, "no-such-demo", MONDAY, MONDAY, "UTC")

	def test_the_full_visitor_journey_as_a_guest(self):
		demo = self.make_demo()
		self.as_user("Guest")
		slots = public.get_slots(demo.name, MONDAY, "2030-03-05", "Asia/Kolkata")
		first = slots["days"][0]["slots"][1]["start"]
		result = self.guest_book(demo, common.parse_start(first), consent=1)
		self.assertTrue(result["ok"])
		b = result["booking"]
		self.assertEqual((b["status"], b["starts_on_iso"], b["tz"], b["meet_link"]), ("Confirmed", first, "Asia/Kolkata", MEET_LINK))
		self.assertEqual(b["manage_url"], frappe.utils.get_url(f"/book/manage/{b['token']}"))
		self.assertIn("calendar.google.com", b["add_to_calendar_url"])
		self.assertTrue(b["can_change"])
		self.assertEqual(frappe.session.user, "Guest")  # the meeting was made as the owner, then the session went back

		# the booked slot is gone from the list
		after = public.get_slots(demo.name, MONDAY, "2030-03-05", "Asia/Kolkata")
		self.assertNotIn(first, [s["start"] for d in after["days"] for s in d["slots"]])

		# manage: look, move, cancel
		shown = public.get_booking(b["token"])
		self.assertEqual((shown["booking"]["token"], shown["can_change"], shown["demo"]["slug"]), (b["token"], True, demo.name))
		own = public.get_slots(demo.name, MONDAY, "2030-03-05", "Asia/Kolkata", token=b["token"])
		self.assertEqual(len([s for d in own["days"] for s in d["slots"]]), len([s for d in slots["days"] for s in d["slots"]]))  # own slot does not block
		new_start = slots["days"][1]["slots"][3]["start"]
		moved = public.reschedule(b["token"], new_start, "Asia/Kolkata")
		self.assertEqual((moved["booking"]["status"], moved["booking"]["starts_on_iso"], moved["booking"]["token"]), ("Rescheduled", new_start, b["token"]))
		cancelled = public.cancel(b["token"], "Changed my mind")
		self.assertEqual(cancelled["booking"]["status"], "Cancelled")
		self.assertFalse(cancelled["booking"]["can_change"])
		self.assertCode("not_changeable", public.cancel, b["token"])
		self.assertCode("not_changeable", public.reschedule, b["token"], new_start)

	def test_errors_carry_a_code_and_a_friendly_message(self):
		demo = self.make_demo()
		self.as_user("Guest")
		self.guest_book(demo, ist(MONDAY, 10))
		with self.assertRaises(DemoError) as cm:
			self.guest_book(demo, ist(MONDAY, 10))
		self.assertEqual(cm.exception.code, "slot_taken")
		self.assertEqual(frappe.local.response.get("code"), "slot_taken")
		self.assertIn("pick another", str(cm.exception).lower())
		self.assertCode("invalid_phone", self.guest_book, demo, ist(MONDAY, 11), phone="12345")
		self.assertCode("invalid_email", self.guest_book, demo, ist(MONDAY, 11), email="nope")

	def test_honeypot_looks_like_success_and_stores_nothing(self):
		demo = self.make_demo()
		self.as_user("Guest")
		result = self.guest_book(demo, ist(MONDAY, 10), hp="http://spam.example")
		self.assertTrue(result["ok"])
		self.assertEqual(frappe.db.count(BOOKING), frappe.db.count(BOOKING, {"demo_type": ["!=", demo.name]}))
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": demo.name}), 0)
		self.assertIn(ist(MONDAY, 10), self.starts(demo))

	def test_form_filled_too_fast_or_too_late_is_refused(self):
		demo = self.make_demo()
		self.as_user("Guest")
		self.assertCode("too_fast", self.guest_book, demo, ist(MONDAY, 10), token_age=0)
		self.assertCode("form_expired", self.guest_book, demo, ist(MONDAY, 10), token_age=13 * 3600)
		with self.assertRaises(DemoError):
			public.book(slug=demo.name, start=common.iso_z(ist(MONDAY, 10)), answers=json.dumps(self.contact()), form_token=None)
		self.assertEqual(frappe.db.count(BOOKING, {"demo_type": demo.name}), 0)

	def test_a_token_opens_only_its_own_booking(self):
		demo = self.make_demo()
		self.as_user("Guest")
		one = self.guest_book(demo, ist(MONDAY, 10))["booking"]
		two = self.guest_book(demo, ist(MONDAY, 11))["booking"]
		self.assertNotEqual(one["token"], two["token"])
		self.assertGreaterEqual(len(one["token"]), 32)
		self.assertEqual(public.get_booking(one["token"])["booking"]["starts_on_iso"], one["starts_on_iso"])
		for bad in ("", "short", one["token"][:-1], one["token"] + "x", "DBK-00001", "' or 1=1 --", one["token"].lower() if one["token"].lower() != one["token"] else "A" * 32):
			self.assertCode("not_found", public.get_booking, bad)
			self.assertCode("not_found", public.cancel, bad)
			self.assertCode("not_found", public.reschedule, bad, common.iso_z(ist(MONDAY, 14)))
		text = json.dumps(public.get_booking(one["token"]), default=str)
		for other in (two["token"], self.row(frappe.db.get_value(BOOKING, {"token": two["token"]}, "name")).email):
			self.assertNotIn(other, text)

	def test_a_token_of_another_demo_type_does_not_unlock_slots_there(self):
		first = self.make_demo(slug="first-page")
		second = self.make_demo(slug="second-page", owners=[self.owner2.name])
		token = self.guest_book(first, ist(MONDAY, 10))["booking"]["token"]
		days = public.get_slots(second.name, MONDAY, MONDAY, "Asia/Kolkata", token=token)["days"]
		self.assertTrue(days)  # no error, no special treatment

	def test_ics_download(self):
		demo = self.make_demo()
		token = self.guest_book(demo, ist(MONDAY, 10))["booking"]["token"]
		public.ics(token)
		body = frappe.response["filecontent"].decode()
		self.assertIn("BEGIN:VCALENDAR", body)
		self.assertIn("DTSTART:20300304T043000Z", body)
		self.assertIn(MEET_LINK, body)
		self.assertEqual(frappe.response["type"], "download")

	def test_only_a_hash_of_the_ip_reaches_the_booking(self):
		demo = self.make_demo()
		with patch.object(frappe.local, "request_ip", "198.51.100.23", create=True):
			token = self.guest_book(demo, ist(MONDAY, 10))["booking"]["token"]
		stored = self.row(frappe.db.get_value(BOOKING, {"token": token}, "name"))
		self.assertEqual(stored.ip_hash, spam.ip_hash("198.51.100.23"))
		self.assertNotIn("198.51.100.23", json.dumps(stored.as_dict(), default=str))
		for dt in (BOOKING, "CRM Lead Form Entry"):
			self.assertFalse(frappe.get_meta(dt).has_field("ip_address"), "a plain IP address must not be stored")

	def test_get_slots_is_throttled_per_address(self):
		demo = self.make_demo()
		with patch.object(frappe.local, "request_ip", "198.51.100.24", create=True), patch.object(spam, "_cache") as cache:
			cache.return_value.incr.return_value = 301
			self.assertCode("rate_limited", public.get_slots, demo.name, MONDAY, MONDAY, "UTC")


MEET_LINK = "https://meet.google.com/abc-defg-hij"


class TestManagerApi(ApiCase):
	def test_every_manager_function_refuses_a_sales_user(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		self.as_user(self.owner2.name)  # a Sales User who is not part of this demo
		calls = [
			(admin.list_demo_types, ()), (admin.get_demo_type, (demo.name,)), (admin.save_demo_type, (json.dumps({"title": "x"}),)),
			(admin.duplicate_demo_type, (demo.name,)), (admin.delete_demo_type, (demo.name,)),
			(admin.get_booking_admin, (name,)), (admin.set_booking_status, (name, "Completed")), (admin.resend_message, (name, "Confirmed")),
			(admin.demo_report, ()), (admin.get_embed_code, (demo.name,)), (admin.list_templates, ()), (admin.get_demo_variables, ()),
		]
		for fn, args in calls:
			with self.assertRaises(frappe.PermissionError, msg=fn.__name__):
				fn(*args)
		self.assertEqual(frappe.db.get_value(BOOKING, name, "status"), "Confirmed")
		self.assertTrue(frappe.db.exists(DEMO_TYPE, demo.name))

	def test_a_sales_user_sees_only_the_demos_they_take_part_in(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		self.as_user(self.owner2.name)
		self.assertEqual(admin.list_bookings()["rows"], [])
		self.assertEqual(admin.my_demos(scope="all"), [])
		frappe.set_user("Administrator")
		self.as_user(self.owner.name)  # the host
		self.assertEqual([r["name"] for r in admin.list_bookings()["rows"]], [name])
		self.assertEqual(admin.get_booking_admin(name)["booking"]["name"], name)
		with self.assertRaises(frappe.PermissionError):
			admin.set_booking_status(name, "Cancelled")  # acting on bookings is for people who see other people's demos
		self.assertEqual(admin.set_my_demo_outcome(name, "Completed")["status"], "Completed")  # but a host records how their own demo went

	def test_guest_cannot_use_my_demos_or_the_manager_api(self):
		self.as_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			admin.my_demos()
		with self.assertRaises(frappe.PermissionError):
			admin.list_demo_types()

	def test_a_sales_manager_can(self):
		manager = self.make_user("manager.demo@example.org", "Sales Manager")
		self.as_user(manager.name)
		self.assertIsInstance(admin.list_demo_types(), list)
		self.assertIsInstance(admin.demo_report()["totals"], dict)

	def test_create_edit_duplicate_delete(self):
		doc = {
			"title": "Admin Made", "slug": "admin-made", "owners": [{"user": self.owner.name}], "allowed_origins": "https://site.example.com/\nhttps://other.example.com",
		}
		saved = admin.save_demo_type(json.dumps(doc))
		self.assertEqual(saved["public_url"], frappe.utils.get_url("/book/admin-made"))
		d = saved["doc"]
		self.assertEqual([f["key"] for f in d["fields"]][:3], ["name", "email", "phone"])  # defaults seeded
		self.assertEqual(len(d["hours"]), 5)
		self.assertEqual([(m["event"], m["minutes_before"]) for m in d["messages"] if m["event"] == "Reminder"], [("Reminder", 1440), ("Reminder", 60), ("Reminder", 30), ("Reminder", 0)])
		# the ready-made email templates are chosen where they exist (a site that has them), WhatsApp stays off until Meta approves one
		self.assertFalse(any(m["send_whatsapp"] for m in d["messages"]))
		for m in d["messages"]:
			from crm_addons.demos import defaults

			expect = defaults.EMAIL[defaults.key_of(m["event"], m.get("minutes_before"))]
			if frappe.db.exists("CRM Campaign Email Template", expect):
				self.assertEqual((m["send_email"], m["email_template"]), (1, expect))
		self.assertEqual(d["allowed_origins"], "https://site.example.com\nhttps://other.example.com")

		d["title"] = "Renamed"
		d["duration_minutes"] = 45
		d["slug"] = "ignored-change"
		again = admin.save_demo_type(json.dumps(d))["doc"]
		self.assertEqual((again["name"], again["slug"], again["title"], again["duration_minutes"]), ("admin-made", "admin-made", "Renamed", 45))
		self.assertEqual(admin.get_demo_type("admin-made")["doc"]["title"], "Renamed")

		copy = admin.duplicate_demo_type("admin-made")["doc"]
		self.assertEqual((copy["slug"], copy["enabled"]), ("admin-made-copy", 0))
		self.assertEqual(len(copy["hours"]), 5)
		self.assertEqual(admin.duplicate_demo_type("admin-made")["doc"]["slug"], "admin-made-copy-2")

		listed = {t["slug"]: t for t in admin.list_demo_types()}
		self.assertEqual(listed["admin-made"]["owners"][0]["user"], self.owner.name)
		self.assertEqual(listed["admin-made"]["total"], 0)
		self.assertTrue(admin.delete_demo_type("admin-made-copy")["ok"])
		self.assertFalse(frappe.db.exists(DEMO_TYPE, "admin-made-copy"))

	def test_a_demo_type_with_bookings_cannot_be_deleted(self):
		demo = self.make_demo()
		self.book(demo, ist(MONDAY, 10))
		with self.assertRaises(frappe.ValidationError):
			admin.delete_demo_type(demo.name)
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc(DEMO_TYPE, demo.name)
		self.assertTrue(frappe.db.exists(DEMO_TYPE, demo.name))

	def test_validation_of_a_demo_type(self):
		base = {"title": "V", "owners": [{"user": self.owner.name}]}
		gone = self.make_user("gone.owner@example.org", "Sales User")
		frappe.db.set_value("User", gone.name, "enabled", 0)
		bad = [
			{"slug": "manage"}, {"slug": "Has Space"}, {"slug": "ab"}, {"slug": "api"},
			{"slug": "tz-bad", "timezone": "Mars/Base"},
			{"slug": "no-owner", "owners": []},
			{"slug": "dur-bad", "duration_minutes": 1},
			{"slug": "hours-bad", "hours": [{"weekday": "Mon", "from_time": "10:00:00", "to_time": "09:00:00"}]},
			{"slug": "override-bad", "overrides": [{"date": "2030-03-05", "kind": "Custom hours"}]},
			{"slug": "origin-bad", "allowed_origins": "not a url"},
			{"slug": "origin-path", "allowed_origins": "https://a.example.com/page"},
			{"slug": "accent-bad", "accent_color": "blue"},
			{"slug": "link-bad", "manual_link": "ftp://x"},
			{"slug": "manual-needs-link", "provider": "Manual Link"},
			{"slug": "cc-bad", "cc": [{"email": "nope"}]},
			{"slug": "tpl-missing", "messages": [{"event": "Confirmed", "send_email": 1}]},
			{"slug": "wa-missing", "messages": [{"event": "Confirmed", "send_whatsapp": 1}]},
			{"slug": "dup-reminder", "messages": [{"event": "Reminder", "minutes_before": 60}, {"event": "Reminder", "minutes_before": 60}]},
			{"slug": "key-bad", "fields": [{"key": "Bad Key", "label": "x", "kind": "Text"}]},
			{"slug": "lead-field-bad", "fields": [{"key": "grade", "label": "G", "kind": "Text", "lead_field": "no_such_field"}]},
			{"slug": "disabled-owner", "owners": [{"user": gone.name}]},
		]
		for extra in bad:
			with self.assertRaises(frappe.ValidationError, msg=extra["slug"]):
				admin.save_demo_type(json.dumps({**base, **extra}))
		self.assertEqual(frappe.db.count(DEMO_TYPE, {"title": "V"}), 0)

	def test_core_fields_cannot_be_switched_off(self):
		doc = admin.save_demo_type(json.dumps({"title": "C", "slug": "core-fields", "owners": [{"user": self.owner.name}], "fields": [{"key": "email", "label": "Mail", "kind": "Text", "required": 0, "enabled": 0}]}))["doc"]
		by_key = {f["key"]: f for f in doc["fields"]}
		self.assertEqual((by_key["email"]["enabled"], by_key["email"]["required"], by_key["email"]["kind"]), (1, 1, "Email"))
		self.assertIn("name", by_key)
		self.assertIn("phone", by_key)

	def test_bookings_list_filters_search_and_paging(self):
		one = self.make_demo(slug="list-one")
		two = self.make_demo(slug="list-two", owners=[self.owner2.name])
		a = self.raw_booking(one, ist(MONDAY, 10), utm_source="google", name_="Asha Rao", email="asha@example.com")
		b = self.raw_booking(one, ist(MONDAY, 11), utm_source="facebook", status="Cancelled", name_="Bina Das")
		c = self.raw_booking(two, ist("2030-03-05", 11), name_="Chet Nair", organization="Sunrise School")
		everything = admin.list_bookings(from_date="2030-03-01", to_date="2030-03-31")  # the site may hold other bookings; these are all in 2030
		self.assertEqual((everything["total"], [r["name"] for r in everything["rows"]]), (3, [c.name, b.name, a.name]))  # newest demo first
		self.assertEqual(everything["rows"][0]["demo_title"], "Test Demo")
		self.assertEqual({r["name"] for r in admin.list_bookings(filters=json.dumps({"demo_type": "list-one"}))["rows"]}, {a.name, b.name})
		self.assertEqual([r["name"] for r in admin.list_bookings(filters={"status": "Cancelled"}, from_date="2030-03-01")["rows"]], [b.name])
		self.assertEqual([r["name"] for r in admin.list_bookings(filters={"utm_source": "google"}, from_date="2030-03-01")["rows"]], [a.name])
		self.assertEqual([r["name"] for r in admin.list_bookings(search="sunrise")["rows"]], [c.name])
		self.assertEqual([r["name"] for r in admin.list_bookings(search="asha@")["rows"]], [a.name])
		self.assertEqual([r["name"] for r in admin.list_bookings(from_date="2030-03-05", to_date="2030-03-05")["rows"]], [c.name])
		paged = admin.list_bookings(from_date="2030-03-01", to_date="2030-03-31", page=2, page_size=2)
		self.assertEqual((paged["total"], len(paged["rows"]), paged["page"]), (3, 1, 2))

	def test_booking_detail_and_status_changes(self):
		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10), utm={"utm_source": "google", "first_touch": {"utm_source": "bing"}}, notes="hi")
		detail = admin.get_booking_admin(name)
		self.assertEqual(detail["booking"]["answers"], {"notes": "hi"})
		self.assertEqual(detail["booking"]["first_touch"], {"utm_source": "bing"})
		self.assertEqual(detail["sync_status"], "Synced")
		self.assertEqual(detail["owners"][0]["user"], self.owner.name)
		self.assertIn("/suite#/leads/", detail["lead_url"])

		done = admin.set_booking_status(name, "Completed")
		self.assertEqual(done["booking"]["status"], "Completed")
		meeting = frappe.get_doc("CRM Meeting", detail["booking"]["meeting"])
		self.assertEqual((meeting.status, meeting.meeting_outcome), ("Completed", "Held"))
		with self.assertRaises(frappe.ValidationError):
			admin.set_booking_status(name, "Confirmed")

		other = self.book(demo, ist(MONDAY, 12))
		self.assertEqual(admin.set_booking_status(other, "No Show")["booking"]["status"], "No Show")
		third = self.book(demo, ist(MONDAY, 13))
		self.assertEqual(admin.set_booking_status(third, "Cancelled")["booking"]["status"], "Cancelled")
		self.assertIn(ist(MONDAY, 13), self.starts(demo))

	def test_resend_message(self):
		demo = self.make_demo(messages=[{"event": "Confirmed", "send_email": 1, "email_template": self._template()}])
		name = self.book(demo, ist("2030-03-06", 10))
		row = frappe.get_all(MESSAGE, filters={"parent": name}, pluck="name", parent_doctype=BOOKING)[0]
		frappe.db.set_value(MESSAGE, row, {"status": "Failed", "error": "boom"})
		sent = []
		with patch.object(frappe, "sendmail", side_effect=lambda **kw: sent.append(kw) or frappe._dict(name="Q-1", message_id="<x>")), patch.object(
			messaging_module(), "email_account_problem", return_value=None
		), patch.object(messaging_module(), "_commit"), patch.object(messaging_module(), "_rollback"):
			self.assertEqual(admin.resend_message(name, message=row)["queued"], 1)
			self.assertEqual(frappe.db.get_value(MESSAGE, row, "status"), "Sent")
			self.assertEqual(admin.resend_message(name, event="Confirmed")["queued"], 1)  # a fresh copy
		self.assertEqual(len([m for m in sent if m.get("communication")]), 2)
		with self.assertRaises(frappe.ValidationError):
			admin.resend_message(name)

	def _template(self):
		return frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "Resend Test", "subject": "{{ demo_title }}", "body_html": "<p>{{ demo_time }}</p>", "enabled": 1}).insert(ignore_permissions=True).name

	def test_embed_code_and_pickers(self):
		demo = self.make_demo(slug="embed-me")
		code = admin.get_embed_code("embed-me")
		self.assertEqual(code["url"], frappe.utils.get_url("/book/embed-me"))
		self.assertIn("/assets/crm_addons/book/embed.js", code["script"])
		self.assertIn('data-crm-demo="embed-me"', code["button"])
		self.assertIn(code["url"], code["iframe"])
		templates = admin.list_templates()
		self.assertEqual(set(templates), {"email", "whatsapp", "whatsapp_accounts", "whatsapp_installed", "email_problem"})
		names = {v["name"] for v in admin.get_demo_variables()}
		self.assertTrue({"demo_title", "meet_link", "cancel_link", "first_name"} <= names)
		self.assertTrue(demo)


class TestScreenSupport(ApiCase):
	"""What the admin screens and the Meetings screen ask for."""

	def test_demo_type_cards_have_the_next_slot_the_month_and_the_provider(self):
		demo = self.make_demo(slug="cards-one")
		self.raw_booking(demo, ist(MONDAY, 10))
		self.raw_booking(demo, ist(MONDAY, 11), status="Cancelled")
		card = {t["slug"]: t for t in admin.list_demo_types()}["cards-one"]
		self.assertEqual(card["provider"], "Google Meet")
		self.assertEqual(card["bookings_month"], 1)  # the cancelled one does not count
		self.assertEqual(card["next_slot"], common.iso_z(ist(MONDAY, 9)))
		self.assertEqual((card["upcoming"], card["total"]), (1, 2))

	def test_owner_filter_lists_the_bookings_of_the_demos_a_person_hosts(self):
		mine = self.make_demo(slug="host-mine", owners=[self.owner.name])
		theirs = self.make_demo(slug="host-theirs", owners=[self.owner2.name])
		a, b = self.raw_booking(mine, ist(MONDAY, 10)), self.raw_booking(theirs, ist(MONDAY, 10))
		rows = admin.list_bookings(filters={"owner": self.owner.name}, from_date="2030-03-01", to_date="2030-03-31")["rows"]
		self.assertEqual([r["name"] for r in rows], [a.name])
		rows = admin.list_bookings(filters=json.dumps({"owner": self.owner2.name}), from_date="2030-03-01", to_date="2030-03-31")["rows"]
		self.assertEqual([r["name"] for r in rows], [b.name])

	def test_a_person_who_takes_the_demo_records_the_outcome(self):
		demo = self.make_demo(owners=[self.owner.name])
		name = self.book(demo, ist(MONDAY, 10))
		other = self.book(self.make_demo(slug="not-mine", owners=[self.owner2.name]), ist(MONDAY, 12))
		self.as_user(self.owner.name)
		self.assertEqual(admin.set_my_demo_outcome(name, "No Show"), {"ok": True, "status": "No Show"})
		self.assertEqual(frappe.db.get_value(BOOKING, name, "status"), "No Show")
		self.assertEqual(frappe.db.get_value("CRM Meeting", self.row(name).meeting, "meeting_outcome"), "No Show")
		with self.assertRaises(frappe.PermissionError):
			admin.set_my_demo_outcome(other, "Completed")  # somebody else's demo
		with self.assertRaises(frappe.ValidationError):
			admin.set_my_demo_outcome(name, "Cancelled")
		self.assertEqual(frappe.db.get_value(BOOKING, other, "status"), "Confirmed")

	def test_send_test_message_goes_to_the_manager_only(self):
		template = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "Test Send", "subject": "Hello {{ demo_title }}", "body_html": "<p>{{ demo_time }} {{ host_names }}</p>", "enabled": 1}).insert(ignore_permissions=True)
		demo = self.make_demo(slug="test-send", messages=[{"event": "Reminder", "minutes_before": 60, "send_email": 1, "email_template": template.name}])
		sent = []
		fake = lambda **kw: sent.append(kw) or frappe._dict(name="Q-1", message_id="<x>")
		with patch.object(frappe, "sendmail", side_effect=fake), patch.object(messaging_module(), "email_account_problem", return_value=None):
			result = admin.send_test_message("test-send", "Reminder", 60, "Email")
		self.assertIn(frappe.db.get_value("User", "Administrator", "email"), result["message"])
		self.assertEqual(sent[0]["recipients"], [frappe.db.get_value("User", "Administrator", "email")])
		self.assertTrue(sent[0]["subject"].startswith("[Test] Hello Test Demo"))
		self.assertIn("owner.test", sent[0]["message"])
		with self.assertRaises(frappe.ValidationError):
			admin.send_test_message("test-send", "Cancelled", 0, "Email")  # not a rule of this demo type
		with self.assertRaises(frappe.ValidationError):
			admin.send_test_message("test-send", "Reminder", 60, "SMS")
		self.assertTrue(demo)
		self.as_user(self.owner.name)
		with self.assertRaises(frappe.PermissionError):
			admin.send_test_message("test-send", "Reminder", 60, "Email")

	def test_meetings_list_filters_demos_and_carries_their_details(self):
		from crm_addons import api

		demo = self.make_demo(slug="meet-list", owners=[self.owner.name])
		name = self.book(demo, ist(MONDAY, 10), utm={"utm_source": "google", "utm_medium": "cpc", "utm_campaign": "spring"})
		plain = self.meeting_for(self.owner.name, ist(MONDAY, 14), ist(MONDAY, 14, 30))
		rows = api.list_meetings(f"{MONDAY} 00:00:00", "2030-03-05 00:00:00", scope="all", demos_only=1)
		self.assertEqual([str(r["name"]) for r in rows], [str(self.row(name).meeting)])
		row = rows[0]
		self.assertEqual((row["demo_type_title"], row["demo_utm_source"], row["demo_utm_medium"], row["demo_utm_campaign"]), ("Test Demo", "google", "cpc", "spring"))
		everything = api.list_meetings(f"{MONDAY} 00:00:00", "2030-03-05 00:00:00", scope="all")
		self.assertIn(str(plain.name), {str(r["name"]) for r in everything})
		self.assertNotIn("demo_utm_source", [r for r in everything if str(r["name"]) == str(plain.name)][0])

	def test_client_config_says_demos_are_on(self):
		from crm_addons import api

		self.assertEqual(api.get_client_config()["demos_enabled"], 1)


def messaging_module():
	from crm_addons.demos import messaging

	return messaging


class TestPermissions(ApiCase):
	def setUp(self):
		super().setUp()
		self.mine = self.make_demo(slug="mine-demo", owners=[self.owner.name])
		self.theirs = self.make_demo(slug="theirs-demo", owners=[self.owner2.name])
		self.a = self.book(self.mine, ist(MONDAY, 10))
		self.b = self.book(self.theirs, ist(MONDAY, 11))

	def test_a_sales_user_sees_only_the_demos_they_take(self):
		self.as_user(self.owner.name)
		self.assertEqual(frappe.get_list(BOOKING, pluck="name"), [self.a])
		self.assertEqual([r["name"] for r in admin.my_demos()], [self.a])
		self.assertTrue(frappe.has_permission(BOOKING, "read", doc=self.a))
		self.assertFalse(frappe.has_permission(BOOKING, "read", doc=self.b))
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(BOOKING, self.b).check_permission("read")
		self.as_user(self.owner2.name)
		self.assertEqual(frappe.get_list(BOOKING, pluck="name"), [self.b])

	def test_a_sales_user_cannot_change_or_create_or_delete(self):
		self.as_user(self.owner.name)
		for ptype in ("write", "create", "delete"):
			self.assertFalse(frappe.has_permission(BOOKING, ptype, doc=self.a), ptype)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(BOOKING, self.a).save()

	def test_a_sales_user_never_sees_a_demo_type(self):
		self.as_user(self.owner.name)
		self.assertFalse(frappe.has_permission(DEMO_TYPE, "read", doc=self.mine.name))
		self.assertFalse(frappe.has_permission(DEMO_TYPE, "read"))
		with self.assertRaises(frappe.PermissionError):
			frappe.get_list(DEMO_TYPE)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(DEMO_TYPE, self.mine.name).check_permission("read")

	def test_a_guest_of_the_meeting_counts_as_taking_part(self):
		cc = self.make_user("guest.member@example.org", "Sales User")
		meeting = frappe.get_doc("CRM Meeting", self.row(self.a).meeting)
		meeting.append("attendees", {"email": cc.email})
		meeting.flags.notify_guests = False
		meeting.save(ignore_permissions=True)
		self.as_user(cc.name)
		self.assertEqual(frappe.get_list(BOOKING, pluck="name"), [self.a])

	def test_managers_see_everything_and_can_choose_scope(self):
		manager = self.make_user("boss.demo@example.org", "Sales Manager")
		self.as_user(manager.name)
		self.assertTrue({self.a, self.b} <= set(frappe.get_list(BOOKING, pluck="name", limit_page_length=0)))
		self.assertTrue({self.a, self.b} <= {r["name"] for r in admin.my_demos(scope="all")})
		self.assertEqual(admin.my_demos(scope="mine"), [])  # a manager who takes no demo has none of their own
		self.assertTrue({self.a, self.b} <= {r["name"] for r in admin.list_bookings(page_size=200)["rows"]})

	def test_a_sales_user_cannot_get_everything_by_asking_for_scope_all(self):
		self.as_user(self.owner.name)
		self.assertEqual([r["name"] for r in admin.my_demos(scope="all")], [self.a])

	def test_my_demos_dates_and_fields(self):
		self.as_user(self.owner.name)
		rows = admin.my_demos(from_date="2030-03-04", to_date="2030-03-04")
		self.assertEqual(len(rows), 1)
		self.assertTrue(rows[0]["lead_title"])
		self.assertTrue(rows[0]["meet_link"])
		self.assertEqual(admin.my_demos(from_date="2030-03-05", to_date="2030-03-06"), [])


class TestReport(ApiCase):
	def test_numbers_match_the_bookings(self):
		one = self.make_demo(slug="rep-one")
		two = self.make_demo(slug="rep-two", owners=[self.owner2.name])
		start = ist("2030-03-06", 10)
		self.raw_booking(one, start, utm_source="google", utm_medium="cpc", utm_campaign="spring")
		self.raw_booking(one, start + timedelta(hours=1), status="Completed", utm_source="google", utm_medium="cpc", utm_campaign="spring")
		self.raw_booking(one, start + timedelta(hours=2), status="No Show", utm_source="google", utm_medium="email")
		self.raw_booking(two, start, status="Cancelled", utm_source="facebook", utm_medium="social", utm_campaign="spring")
		self.raw_booking(two, start + timedelta(hours=1), status="Rescheduled")
		self.raw_booking(two, start + timedelta(hours=2), status="Completed", utm_source="google")
		today = frappe.utils.nowdate()  # bookings made earlier (by hand on this site) are not in the range
		result = report.demo_report(today)
		self.assertEqual(result["totals"], {"booked": 6, "upcoming": 2, "held": 2, "no_show": 1, "cancelled": 1, "rescheduled": 1, "held_rate": 33.3})
		by = lambda key: {r["label"]: r for r in result[key]}
		self.assertEqual(by("by_source")["google"], {"label": "google", "booked": 4, "held": 2, "no_show": 1, "cancelled": 0})
		self.assertEqual(by("by_source")["facebook"]["cancelled"], 1)
		self.assertEqual(by("by_source")["(direct)"]["booked"], 1)
		self.assertEqual(by("by_medium")["cpc"]["booked"], 2)
		self.assertEqual(by("by_campaign")["spring"], {"label": "spring", "booked": 3, "held": 1, "no_show": 0, "cancelled": 1})
		self.assertEqual(by("by_demo_type")["rep-one"]["booked"], 3)
		self.assertEqual(sum(d["booked"] for d in result["by_source"]), 6)
		self.assertEqual(sum(d["booked"] for d in result["by_day"]), 6)
		only_two = report.demo_report(today, demo_type="rep-two")
		self.assertEqual(only_two["totals"]["booked"], 3)
		self.assertEqual(admin.demo_report(today, demo_type="rep-one")["totals"]["booked"], 3)

	def test_the_range_includes_the_whole_last_day(self):
		demo = self.make_demo()
		row = self.raw_booking(demo, ist("2030-03-06", 10))
		frappe.db.set_value(BOOKING, row.name, "creation", "2030-02-01 23:59:59.500000", update_modified=False)
		self.assertEqual(report.demo_report("2030-02-01", "2030-02-01")["totals"]["booked"], 1)
		self.assertEqual(report.demo_report("2030-02-02", "2030-02-03")["totals"]["booked"], 0)
		self.assertEqual(report.demo_report("2030-02-01", "2030-12-31")["totals"]["booked"], 1)

	def test_an_empty_report_is_all_zeros(self):
		result = report.demo_report("1990-01-01", "1990-01-02")
		self.assertEqual(result["totals"]["booked"], 0)
		self.assertEqual(result["totals"]["held_rate"], 0)
		self.assertEqual(result["by_source"], [])


class TestFraming(ApiCase):
	def response(self, path, headers=None):
		response = Response("<html></html>", headers=headers or {"X-Frame-Options": "SAMEORIGIN"})
		request = frappe._dict(path=path)
		framing.add_frame_headers(response=response, request=request)
		return response

	def test_a_booking_page_may_be_framed_only_by_the_listed_origins(self):
		self.make_demo(slug="framed", allowed_origins="https://www.codingjunior.example\nhttps://codingpro.example:8443")
		r = self.response("/book/framed")
		self.assertEqual(r.headers["Content-Security-Policy"], "frame-ancestors 'self' https://www.codingjunior.example https://codingpro.example:8443")
		self.assertNotIn("X-Frame-Options", r.headers)

	def test_the_manage_page_follows_its_booking(self):
		demo = self.make_demo(slug="framed-two", allowed_origins="https://www.codingjunior.example")
		token = self.row(self.book(demo, ist(MONDAY, 10))).token
		r = self.response(f"/book/manage/{token}")
		self.assertIn("https://www.codingjunior.example", r.headers["Content-Security-Policy"])
		self.assertNotIn("X-Frame-Options", r.headers)
		r = self.response("/book/manage/" + "x" * 32)  # unknown token
		self.assertEqual(r.headers["Content-Security-Policy"], "frame-ancestors 'self'")
		self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN")

	def test_a_page_without_origins_unknown_or_disabled_stays_protected(self):
		self.make_demo(slug="no-origins")
		self.make_demo(slug="off-page", enabled=1, allowed_origins="https://a.example.com")
		frappe.db.set_value(DEMO_TYPE, "off-page", "enabled", 0)
		for path in ("/book/no-origins", "/book/off-page", "/book/never-made", "/book/manage"):
			r = self.response(path)
			self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN", path)
		self.assertEqual(self.response("/book/no-origins").headers["Content-Security-Policy"], "frame-ancestors 'self'")
		# "manage" is reserved and not a demo type: no special treatment, nothing written for it
		self.assertNotIn("Content-Security-Policy", self.response("/book/manage").headers)

	def test_other_pages_keep_their_protection(self):
		self.make_demo(slug="elsewhere", allowed_origins="https://a.example.com")
		for path in ("/crm", "/app", "/login", "/api/method/ping", "/booking/elsewhere", "/bookmark", "/"):
			r = self.response(path)
			self.assertEqual(r.headers["X-Frame-Options"], "SAMEORIGIN", path)
			self.assertNotIn("Content-Security-Policy", r.headers, path)

	def test_an_existing_policy_is_extended_not_replaced(self):
		self.make_demo(slug="has-csp", allowed_origins="https://a.example.com")
		r = self.response("/book/has-csp", {"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'"})
		self.assertEqual(r.headers["Content-Security-Policy"], "default-src 'self'; frame-ancestors 'self' https://a.example.com")

	def test_origins_are_cleaned(self):
		self.assertEqual(framing.clean_origins("https://a.example.com/\n  http://b.example.com:81 \nnot-a-url\njavascript:alert(1)\nhttps://a.example.com"), ["https://a.example.com", "http://b.example.com:81"])
		self.assertEqual(framing.clean_origins(""), [])
		self.assertEqual(framing.clean_origins("https://*.example.com"), ["https://*.example.com"])


class TestWiring(ApiCase):
	def test_hooks(self):
		rules = frappe.get_hooks("website_route_rules")
		self.assertIn({"from_route": "/book/manage/<token>", "to_route": "book"}, rules)
		self.assertIn({"from_route": "/book/<slug>", "to_route": "book"}, rules)
		self.assertIn("crm_addons.demos.messaging.send_due", frappe.get_hooks("scheduler_events")["cron"]["* * * * *"])
		self.assertIn("crm_addons.demos.framing.add_frame_headers", frappe.get_hooks("after_request"))
		self.assertTrue(frappe.get_hooks("permission_query_conditions")["CRM Demo Booking"])
		self.assertTrue(frappe.get_hooks("has_permission")["CRM Demo Type"])
		self.assertEqual(frappe.get_hooks("doc_events")["CRM Meeting"]["on_update"], ["crm_addons.demos.booking.on_meeting_update"])

	def test_route_rules_resolve_to_the_book_page(self):
		from werkzeug.routing import Map, Rule

		urls = Map([Rule(r["from_route"], endpoint=r["to_route"]) for r in frappe.get_hooks("website_route_rules") if "book" in r["from_route"]]).bind("")
		self.assertEqual(urls.match("/book/my-demo"), ("book", {"slug": "my-demo"}))
		self.assertEqual(urls.match("/book/manage/abc_DEF-123"), ("book", {"token": "abc_DEF-123"}))

	def test_the_module_custom_fields_and_indexes_exist(self):
		for field in ("is_demo", "demo_type", "demo_booking"):
			self.assertTrue(frappe.get_meta("CRM Meeting").has_field(field), field)
		for field in ("crm_demo_first_utm_source", "crm_demo_first_utm_medium", "crm_demo_first_utm_campaign"):
			self.assertTrue(frappe.get_meta("CRM Lead").has_field(field), field)
		indexes = {}
		for row in frappe.db.sql("show index from `tabCRM Demo Booking`", as_dict=True):
			indexes.setdefault(row["Key_name"], []).append(row["Column_name"])
		wanted = [["demo_type", "starts_utc"], ["email"], ["phone"], ["status"]]
		for columns in wanted:
			self.assertTrue(any(cols[: len(columns)] == columns for cols in indexes.values()), columns)
		unique = {row["Key_name"] for row in frappe.db.sql("show index from `tabCRM Demo Booking` where Non_unique = 0", as_dict=True)}
		self.assertTrue({"token", "slot_key"} <= unique)

	def test_meeting_list_api_returns_the_demo_flags(self):
		from crm_addons import api

		demo = self.make_demo()
		name = self.book(demo, ist(MONDAY, 10))
		row = api.get_meeting(self.row(name).meeting)
		self.assertEqual((row["is_demo"], row["demo_type"], str(row["demo_booking"])), (1, demo.name, name))

	def test_slugs_that_clash_with_pages_are_reserved(self):
		for slug in common.RESERVED_SLUGS:
			with self.assertRaises(frappe.ValidationError):
				frappe.get_doc({"doctype": DEMO_TYPE, "title": "x", "slug": slug, "owners": [{"user": self.owner.name}]}).insert(ignore_permissions=True)
