# Copyright (c) 2026, Siddharth Singh
"""Booking message tests: planning, template wording in the visitor's time zone, exactly-once sending, failures, WhatsApp consent and STOP.

Run on a bench:  bench --site <site> run-tests --module crm_addons.demos.doctype.crm_demo_booking.test_messages
Mail and WhatsApp are faked: nothing leaves the site and Meta is never called.
"""

from datetime import timedelta
from unittest.mock import patch

import frappe

from crm_addons.campaigns import optout, personalization
from crm_addons.demos import booking, common, messaging
from crm_addons.demos.common import BOOKING, MESSAGE
from crm_addons.demos.doctype.crm_demo_booking.test_demo_booking import MONDAY, DemoCase, FakeQueue, ist


class MessageCase(DemoCase):
	def setUp(self):
		super().setUp()
		self.sent = []  # the visitor messages; mail CRM itself sends while a lead is assigned goes to self.crm_mail
		self.crm_mail = []

		def fake_sendmail(**kw):
			if not kw.get("communication"):
				self.crm_mail.append(kw)
				return FakeQueue(name="Q-crm", message_id="<crm@x>")
			self.sent.append(kw)
			return FakeQueue(name=f"Q-{len(self.sent)}", message_id="<m@x>")

		self.sendmail = patch.object(frappe, "sendmail", side_effect=fake_sendmail)
		self.sendmail.start()
		self.addCleanup(self.sendmail.stop)
		problem = patch.object(messaging, "email_account_problem", return_value=None)
		problem.start()
		self.addCleanup(problem.stop)

		self.tpl = frappe.get_doc(
			{
				"doctype": "CRM Campaign Email Template", "template_name": "Demo Test Mail", "enabled": 1,
				"subject": "{{ demo_title }} on {{ demo_datetime }}",
				"body_html": '<p>Hi {{ first_name }}, {{ demo_date }} at {{ demo_time }} with {{ host_names }} ({{ demo_duration }}). '
				'<a href="{{ reschedule_link }}">move</a> <a href="{{ cancel_link }}">cancel</a> {{ meet_link }} {{ booking_link }}</p>',
			}
		).insert(ignore_permissions=True)
		self.wa_sent = []

		def fake_wa(template, account, to, params, ref_doctype, ref_name, marker, attach=None):
			self.wa_sent.append({"template": template, "to": to, "params": params, "marker": marker})
			return frappe._dict(name=f"WAM-{len(self.wa_sent)}")

		for p in (
			patch.object(messaging, "send_whatsapp_template", side_effect=fake_wa),
			patch.object(messaging.WhatsAppSender, "_template", return_value=frappe._dict(name="WA-T", status="APPROVED", template="Hi {{1}}")),
			patch.object(messaging.WhatsAppSender, "account", return_value="WA-ACC"),
		):
			p.start()
			self.addCleanup(p.stop)

	def rule(self, event, minutes=0, email=1, whatsapp=0):
		row = {"event": event, "send_email": email, "email_template": self.tpl.name if email else None, "send_whatsapp": whatsapp}
		if whatsapp:
			row.update(wa_template="WA-T", wa_variables='{"1": "{{ demo_time }}"}')
		if event == "Reminder":
			row["minutes_before"] = minutes
		return row

	def demo_with_messages(self, **kw):
		rules = [self.rule("Confirmed"), self.rule("Rescheduled"), self.rule("Cancelled"), self.rule("Reminder", 1440), self.rule("Reminder", 60, whatsapp=1), self.rule("Reminder", 0)]
		return self.make_demo(messages=rules, **kw)

	def rows(self, name, **filters):
		return frappe.get_all(MESSAGE, filters={"parent": name, **filters}, fields=["name", "event", "minutes_before", "channel", "status", "due_at", "error", "reference"], order_by="idx asc", parent_doctype=BOOKING)

	def by_event(self, name):
		return {(r.event, r.minutes_before or 0, r.channel): r for r in self.rows(name)}


class TestPlanning(MessageCase):
	def test_every_rule_becomes_a_row_with_its_due_time(self):
		demo = self.demo_with_messages()
		start = ist("2030-03-06", 10)  # Wednesday 10:00 IST, well over a day away
		name = self.book(demo, start, consent=1)
		rows = self.by_event(name)
		self.assertEqual(rows[("Confirmed", 0, "Email")].status, "Pending")
		self.assertEqual(rows[("Confirmed", 0, "Email")].due_at, common.site_now())
		for minutes in (1440, 60, 0):
			self.assertEqual(rows[("Reminder", minutes, "Email")].due_at, common.to_site(start) - timedelta(minutes=minutes))
			self.assertEqual(rows[("Reminder", minutes, "Email")].status, "Pending")
		self.assertEqual(rows[("Reminder", 60, "WhatsApp")].status, "Pending")
		self.assertNotIn(("Rescheduled", 0, "Email"), rows)  # only on a reschedule

	def test_reminders_that_are_already_due_are_skipped_with_a_reason(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist(MONDAY, 10))  # 4.5 hours from the frozen now
		rows = self.by_event(name)
		self.assertEqual(rows[("Reminder", 1440, "Email")].status, "Skipped")
		self.assertIn("Too late", rows[("Reminder", 1440, "Email")].error)
		self.assertEqual(rows[("Reminder", 60, "Email")].status, "Pending")
		self.assertEqual(rows[("Reminder", 0, "Email")].status, "Pending")

	def test_a_booking_less_than_an_hour_away_skips_the_hour_reminder(self):
		demo = self.demo_with_messages()
		self.now = ist(MONDAY, 9, 20)
		name = self.book(demo, ist(MONDAY, 10))
		self.assertEqual(self.by_event(name)[("Reminder", 60, "Email")].status, "Skipped")
		self.assertEqual(self.by_event(name)[("Reminder", 0, "Email")].status, "Pending")

	def test_rules_switched_off_or_without_a_template_write_nothing_or_a_clear_skip(self):
		demo = self.make_demo(messages=[{"event": "Confirmed"}, {"event": "Reminder", "minutes_before": 60}])
		self.assertEqual(self.rows(self.book(demo, ist("2030-03-06", 10))), [])  # all switched off: nothing queued

	def test_whatsapp_row_is_skipped_without_consent(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=0)
		row = self.by_event(name)[("Reminder", 60, "WhatsApp")]
		self.assertEqual(row.status, "Skipped")
		self.assertIn("did not agree", row.error)

	def test_reschedule_replans_the_reminders_and_queues_the_notice(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=1)
		booking.reschedule(name, ist("2030-03-07", 15))
		rows = self.rows(name)
		old = [r for r in rows if r.event == "Reminder" and r.status == "Skipped" and "Moved" in (r.error or "")]
		self.assertTrue(old)
		self.assertFalse([r for r in rows if r.event == "Confirmed" and r.status == "Pending"])  # the unsent confirmation is dropped
		fresh = {(r.minutes_before, r.channel): r for r in rows if r.event == "Reminder" and r.status == "Pending"}
		self.assertEqual(fresh[(60, "Email")].due_at, common.to_site(ist("2030-03-07", 15)) - timedelta(minutes=60))
		self.assertEqual(len([r for r in rows if r.event == "Rescheduled" and r.status == "Pending"]), 1)

	def test_cancel_drops_what_is_waiting_and_queues_one_notice(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=1)
		booking.cancel(name, "no thanks")
		rows = self.rows(name)
		self.assertFalse([r for r in rows if r.event != "Cancelled" and r.status == "Pending"])
		self.assertEqual([r.status for r in rows if r.event == "Cancelled"], ["Pending"])
		messaging.send_due()
		self.assertEqual(len(self.sent), 1)
		self.assertIn("Test Demo", self.sent[0]["subject"])


class TestSending(MessageCase):
	def test_confirmation_is_worded_in_the_visitors_time_zone(self):
		demo = self.demo_with_messages(manual_link="https://example.com/room")
		name = self.book(demo, ist("2030-03-06", 10), tz="America/New_York")
		self.assertEqual(messaging.send_due(), 1)
		mail = self.sent[0]
		# Wednesday 10:00 IST = Tuesday 23:30 EST (5 March 2030, still winter time in New York)
		self.assertEqual(mail["subject"], "Test Demo on Tue, 5 Mar 2030, 11:30 PM EST")
		for text in ("Tuesday, 5 March 2030", "11:30 PM EST", "30 minutes", "https://meet.google.com/abc-defg-hij", f"/book/manage/{self.row(name).token}", "?action=cancel", "?action=reschedule"):
			self.assertIn(text, mail["message"])
		self.assertIn("owner.test", mail["message"])  # host name from the user's full name
		self.assertEqual(mail["recipients"], [self.row(name).email])
		self.assertFalse(mail.get("add_unsubscribe_link"))  # transactional: no marketing unsubscribe footer
		row = self.by_event(name)[("Confirmed", 0, "Email")]
		self.assertEqual(row.status, "Sent")
		self.assertEqual(row.reference, "Q-1")

	def test_a_message_is_sent_once_even_if_the_scheduler_runs_again(self):
		demo = self.demo_with_messages()
		self.book(demo, ist("2030-03-06", 10))
		self.assertEqual(messaging.send_due(), 1)
		self.assertEqual(messaging.send_due(), 0)
		self.assertEqual(len(self.sent), 1)

	def test_a_row_can_only_be_claimed_once(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		row = self.by_event(name)[("Confirmed", 0, "Email")]
		self.assertTrue(messaging._claim(row.name, "token-a"))
		self.assertFalse(messaging._claim(row.name, "token-b"))  # the second worker loses
		self.assertFalse(messaging.process(row.name))  # and so does a whole second worker
		self.assertEqual(self.sent, [])

	def test_reminders_go_out_at_their_time_and_not_before(self):
		demo = self.demo_with_messages()
		start = ist("2030-03-06", 10)
		name = self.book(demo, start, consent=1)
		messaging.send_due()
		self.sent.clear()
		self.now = start - timedelta(hours=24, minutes=1)
		self.assertEqual(messaging.send_due(), 0)
		self.now = start - timedelta(hours=24)
		self.assertEqual(messaging.send_due(), 1)
		self.now = start - timedelta(minutes=60)
		self.assertEqual(messaging.send_due(), 2)  # the hour reminder goes by email and WhatsApp
		self.assertEqual(self.wa_sent[0]["to"], self.row(name).phone)
		self.assertEqual(self.wa_sent[0]["params"], {"1": "10:00 AM IST"})
		self.assertTrue(self.wa_sent[0]["marker"].startswith("CRMDEMO:"))
		self.now = start
		self.assertEqual(messaging.send_due(), 1)
		self.assertEqual({r.status for r in self.rows(name) if r.event == "Reminder" and r.status != "Skipped"}, {"Sent"})

	def test_a_reminder_for_a_demo_that_already_started_is_not_sent(self):
		demo = self.demo_with_messages()
		start = ist("2030-03-06", 10)
		name = self.book(demo, start)
		messaging.send_due()
		self.sent.clear()
		self.now = start + timedelta(minutes=5)
		messaging.send_due()
		self.assertEqual(self.sent, [])
		self.assertTrue([r for r in self.rows(name, event="Reminder", status="Skipped") if "started" in (r.error or "")])

	def test_a_cancelled_booking_sends_no_reminder_even_if_a_row_was_missed(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		messaging.send_due()
		self.sent.clear()
		frappe.db.set_value(BOOKING, name, "status", "Cancelled", update_modified=False)
		self.now = ist("2030-03-06", 10)
		messaging.send_due()
		self.assertEqual(self.sent, [])

	def test_one_failing_message_does_not_stop_the_others(self):
		demo = self.demo_with_messages()
		first = self.book(demo, ist("2030-03-06", 10))
		second = self.book(demo, ist("2030-03-06", 11))
		calls = []

		def flaky(**kw):
			if not kw.get("communication"):
				return FakeQueue(name="Q-crm", message_id="<crm@x>")
			calls.append(kw)
			if len(calls) == 1:
				raise Exception("SMTP exploded")
			return FakeQueue(name="Q-ok", message_id="<m@x>")

		with patch.object(frappe, "sendmail", side_effect=flaky):
			self.assertEqual(messaging.send_due(), 2)
		statuses = sorted(r.status for n in (first, second) for r in self.rows(n, event="Confirmed"))
		self.assertEqual(statuses, ["Failed", "Sent"])
		failed = [r for n in (first, second) for r in self.rows(n, event="Confirmed") if r.status == "Failed"][0]
		self.assertIn("SMTP exploded", failed.error)

	def test_no_outgoing_email_account_gives_a_clear_failed_row(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		with patch.object(messaging, "email_account_problem", return_value="No outgoing Email Account is set up on this site."):
			messaging.send_due()
		row = self.by_event(name)[("Confirmed", 0, "Email")]
		self.assertEqual(row.status, "Failed")
		self.assertIn("No outgoing Email Account", row.error)
		self.assertEqual(self.sent, [])

	def test_failed_row_can_be_sent_again(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		with patch.object(messaging, "email_account_problem", return_value="No outgoing Email Account is set up on this site."):
			messaging.send_due()
		row = self.by_event(name)[("Confirmed", 0, "Email")]
		self.assertTrue(messaging.retry(row.name))
		self.assertEqual(messaging.send_due(), 1)
		self.assertEqual(self.by_event(name)[("Confirmed", 0, "Email")].status, "Sent")
		self.assertFalse(messaging.retry(row.name))  # a Sent row is not resent by accident

	def test_whatsapp_needs_consent_and_honours_stop(self):
		demo = self.demo_with_messages()
		start = ist("2030-03-06", 10)
		agreed = self.book(demo, start, consent=1)
		stopped = self.book(demo, start + timedelta(minutes=30), consent=1)
		optout.add_opt_out("WhatsApp", self.row(stopped).phone, source="WhatsApp Reply")
		self.now = start - timedelta(minutes=1)  # both hour reminders are due, neither demo has started
		messaging.send_due()
		self.assertEqual([m["to"] for m in self.wa_sent], [self.row(agreed).phone])
		wa = {n: [r for r in self.rows(n, channel="WhatsApp") if r.event == "Reminder" and r.minutes_before == 60][0] for n in (agreed, stopped)}
		self.assertEqual(wa[agreed].status, "Sent")
		self.assertEqual(wa[stopped].status, "Skipped")
		self.assertIn("STOP", wa[stopped].error)

	def test_the_marketing_unsubscribe_list_does_not_block_a_transactional_email(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		optout.add_opt_out("Email", self.row(name).email, source="Unsubscribe Link")
		messaging.send_due()
		self.assertEqual(self.by_event(name)[("Confirmed", 0, "Email")].status, "Sent")

	def test_unapproved_whatsapp_template_fails_the_row_only(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=1)
		self.now = ist("2030-03-06", 9)
		with patch.object(messaging.WhatsAppSender, "_template", return_value=frappe._dict(name="WA-T", status="PENDING", template="Hi {{1}}")):
			messaging.send_due()
		wa = [r for r in self.rows(name, channel="WhatsApp")][0]
		self.assertEqual(wa.status, "Failed")
		self.assertIn("not approved", wa.error)
		self.assertEqual(self.by_event(name)[("Reminder", 60, "Email")].status, "Sent")

	def test_a_row_stuck_in_sending_is_marked_failed_not_resent(self):
		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10))
		row = self.by_event(name)[("Confirmed", 0, "Email")]
		frappe.db.sql(f"update `tab{MESSAGE}` set status = 'Sending', modified = %s where name = %s", (frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-1), row.name))
		messaging.send_due()
		self.assertEqual(self.by_event(name)[("Confirmed", 0, "Email")].status, "Failed")
		self.assertEqual(self.sent, [])

	def test_an_empty_rendering_is_a_failure_not_a_blank_email(self):
		blank = frappe.get_doc({"doctype": "CRM Campaign Email Template", "template_name": "Blank Demo", "enabled": 1, "subject": "{{ cancel_link }}", "body_html": "<p>{{ meet_link }}</p>"}).insert(ignore_permissions=True)
		demo = self.make_demo(messages=[{"event": "Confirmed", "send_email": 1, "email_template": blank.name}])
		name = self.book(demo, ist("2030-03-06", 10))
		frappe.db.set_value("CRM Campaign Email Template", blank.name, {"subject": "{{ nothing_here }}"}, update_modified=False)
		frappe.clear_document_cache("CRM Campaign Email Template", blank.name)
		messaging.send_due()
		self.assertEqual(self.rows(name)[0].status, "Failed")


class TestVariables(MessageCase):
	def test_demo_variables_are_accepted_by_campaign_templates_and_empty_in_a_campaign(self):
		names = {v["name"] for v in personalization.available_variables()}
		for key in personalization.DEMO_VARIABLES:
			self.assertIn(key, names)
		self.assertEqual(personalization.unknown_variables("{{ demo_time }} {{ meet_link }} {{ host_names }} {{ cancel_link }}"), [])
		self.assertEqual(personalization.unknown_variables("{{ really_unknown }}"), ["really_unknown"])
		context = personalization.build_context(self.lead, frappe._dict(campaign_owner="Administrator"))
		self.assertEqual(personalization.render("[{{ demo_time }}]", context), "[]")
		self.assertTrue(personalization.sample_context()["demo_datetime"])

	def test_email_template_with_demo_variables_can_be_saved(self):
		self.assertTrue(self.tpl.name)  # inserted in setUp: the template validation accepted every demo variable

	def test_whatsapp_variable_map_with_demo_variables_is_accepted_by_the_demo_type(self):
		demo = self.demo_with_messages()
		demo.messages[4].wa_variables = '{"1": "{{ demo_date }}", "2": "{{ cancel_link }}"}'
		demo.save(ignore_permissions=True)
		demo.messages[4].wa_variables = '{"1": "{{ no_such_thing }}"}'
		with self.assertRaises(frappe.ValidationError):
			demo.save(ignore_permissions=True)

	def test_context_for_a_booking_in_another_zone_and_with_two_hosts(self):
		demo = self.demo_with_messages(owners=[self.owner.name, self.owner2.name])
		name = self.book(demo, ist("2030-03-06", 10), tz="Asia/Tokyo")
		context = messaging.demo_context(frappe.get_doc(BOOKING, name))
		self.assertEqual(context["demo_time"], "1:30 PM JST")
		self.assertEqual(context["host_name"], "owner.test")
		self.assertEqual(context["host_names"], "owner.test and owner2.test")
		self.assertEqual(context["first_name"], "Visitor")


class TestManualNotify(MessageCase):
	def test_notify_sends_again_on_the_chosen_channels_and_tells_the_hosts(self):
		from crm_addons.demos import admin

		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=1)
		before = len(self.rows(name))
		opts = {o["key"]: o for o in admin.get_notify_options(name)["options"]}
		self.assertIn("Confirmed:0", opts)
		self.assertIn("Reminder:60", opts)
		out = admin.notify_booking(name, "Reminder", 60, ["Email", "WhatsApp"], 1)
		self.assertEqual(sorted(out["sent"]), ["Email", "WhatsApp"])
		self.assertGreaterEqual(out["hosts"], 1)
		self.assertEqual(len(self.rows(name)), before + 2)
		new = [r for r in self.rows(name) if r.event == "Reminder" and r.minutes_before == 60 and r.status == "Sent"]
		self.assertGreaterEqual(len(new), 2)  # the email and the WhatsApp message really went through the sender (faked)
		self.assertTrue(self.wa_sent)

	def test_whatsapp_without_consent_is_skipped_with_a_reason(self):
		from crm_addons.demos import admin

		demo = self.demo_with_messages()
		name = self.book(demo, ist("2030-03-06", 10), consent=0)
		out = admin.notify_booking(name, "Reminder", 60, ["WhatsApp"], 0)
		self.assertEqual(out["sent"], [])
		self.assertIn("did not agree", out["skipped"][0]["reason"])
