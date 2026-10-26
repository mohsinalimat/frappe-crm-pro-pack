"""Creating, moving and cancelling a demo booking.

The order inside a booking is what makes it safe: lock the owners (a ``for update`` on their User rows, so two bookings for the same people
queue up), check the slot again with a locking read, then insert the booking. Its unique ``slot_key`` (``sha1(type|start)``) is the last
line of defence: if two requests still got that far, the database refuses the second one and it is told ``slot_taken``. Cancelling or moving a
booking clears the key in the same statement, which is what frees the slot.
"""

import hashlib
import json
import re
import secrets
from contextlib import contextmanager
from datetime import timedelta
from urllib.parse import urlencode

import frappe
from frappe import _
from frappe.utils import cint, cstr, get_datetime, now_datetime, validate_email_address

from crm_addons import api, notifications
from crm_addons.demos import common, messaging, slots, spam
from crm_addons.demos.common import ACTIVE, BOOKING, DEMO_TYPE, LEAD, fail
from crm_addons.utils import _ics_escape, get_settings, user_details

CORE_KEYS = ("name", "email", "phone", "organization")
MAX_GUESTS = 5
TEXT_LIMIT = {"Text": 300, "Email": 140, "Phone": 40, "Long Text": 3000, "Select": 140, "Checkbox": 1}


# -- small helpers ---------------------------------------------------------------------------------------------------


def _is_duplicate(exc):
	if isinstance(exc, (frappe.DuplicateEntryError, frappe.UniqueValidationError)):
		return True
	text = cstr(exc)
	return "Duplicate entry" in text or "1062" in text or "UniqueViolation" in text


def _undo(savepoint, exc, taken):
	"""Back out of a failed booking. A duplicate key, or MariaDB refusing a locking read because the rows changed under it, both mean
	someone else got there first."""
	lost = _is_duplicate(exc) or isinstance(exc, frappe.QueryDeadlockError)
	if isinstance(exc, frappe.QueryDeadlockError):
		frappe.db.rollback()  # the server already ended the whole transaction ("try restarting transaction")
	else:
		try:
			frappe.db.rollback(save_point=savepoint)
		except Exception:
			# something inside the booking committed (CRM's own assignment code does), which drops the savepoint: undo what is still open
			frappe.db.rollback()
	if lost:
		fail("slot_taken", taken)


def slot_key(demo_name, starts_utc):
	return hashlib.sha1(f"{demo_name}|{starts_utc.strftime('%Y-%m-%d %H:%M')}".encode()).hexdigest()


@contextmanager
def as_user(user):
	"""Run as one of the owners: the meeting is then created by them (owner, organizer, Google calendar, who is told) exactly as if they had scheduled it."""
	previous = frappe.session.user
	frappe.set_user(user)
	try:
		yield
	finally:
		frappe.set_user(previous)


def fresh_snapshot():
	"""Start the transaction of a guest booking request from the latest data. Such a request has written nothing yet (the endpoint calls this before
	anything else), so ending its read-only transaction costs nothing. Done after the owners are locked, so what the person who held the lock before us
	committed is visible. Not done under test, where the fixtures live in the open transaction."""
	if not frappe.flags.in_test:
		frappe.db.rollback()


LOCK_WAIT_SECONDS = 20


def _lock_name(user):
	return "crmdemo:" + hashlib.sha1(f"{frappe.local.site}|{user}".encode()).hexdigest()[:24]


def lock_owners(users, fresh=False):
	"""Make bookings for the same people queue up, so the check "is the slot free" and the write that takes it cannot interleave.

	A named database lock per owner (taken in name order, so two bookings can never wait on each other), held until this request commits or rolls
	back. It is not a row lock: the transaction snapshot is refreshed after it is taken (``fresh``), so the previous holder's work is visible."""
	names = sorted(set(users))
	taken = []
	if frappe.db.db_type == "postgres":
		for user in names:  # released by the commit / rollback by itself
			frappe.db.sql("select pg_advisory_xact_lock(hashtext(%s))", _lock_name(user))
		if fresh:
			fresh_snapshot()
		return
	try:
		for user in names:
			key = _lock_name(user)
			if frappe.db.sql("select get_lock(%s, %s)", (key, LOCK_WAIT_SECONDS))[0][0] != 1:
				fail("slot_taken", _("Many people are booking right now. Please pick a time again."))
			taken.append(key)
		if fresh:
			fresh_snapshot()
	except Exception:
		release_locks(taken)
		raise

	def release():
		release_locks(taken)

	frappe.db.after_commit.add(release)
	frappe.db.after_rollback.add(release)


def release_locks(keys):
	for key in keys:
		try:
			frappe.db.sql("select release_lock(%s)", key)
		except Exception:
			frappe.logger().warning("CRM Demo: could not release a lock", exc_info=True)


def _utm_of(utm):
	utm = utm if isinstance(utm, dict) else {}
	clean = {k: cstr(utm.get(k))[:140] for k in common.UTM_KEYS if utm.get(k)}
	first = utm.get("first_touch")
	first = {k: cstr(first.get(k))[:140] for k in common.UTM_KEYS if first.get(k)} if isinstance(first, dict) else {}
	return clean, first


# -- the visitor's details -------------------------------------------------------------------------------------------


def clean_contact(demo, answers):
	"""Validate the form against the demo type's fields. Returns ``(contact, extra_answers)``."""
	answers = answers if isinstance(answers, dict) else {}
	fields = {row.key: row for row in demo.get("fields") or [] if cint(row.enabled)}
	extra = {}
	for key, row in fields.items():
		value = answers.get(key)
		if row.kind == "Checkbox":
			value = 1 if value in (1, True, "1", "true", "on", "yes") else 0
		else:
			value = cstr(value).strip()[: TEXT_LIMIT.get(row.kind, 300)]
		if cint(row.required) and not value:
			fail("field_required", _("Please fill in {0}.").format(row.label))
		if row.kind == "Select" and value:
			options = [o.strip() for o in cstr(row.options).splitlines() if o.strip()]
			if options and value not in options:
				fail("field_required", _("Please choose a valid option for {0}.").format(row.label))
		if key not in CORE_KEYS:
			extra[key] = value
		else:
			answers[key] = value
	name = cstr(answers.get("name")).strip()
	if len(name) < 2 or len(name) > 140 or re.search(r"https?://|www\.", name, re.I):
		fail("field_required", _("Please enter your name."))
	email = spam.validate_email(answers.get("email"))
	phone = spam.validate_phone(answers.get("phone"), get_settings().get("default_country_code"))
	return {"name": name, "email": email, "phone": phone, "organization": cstr(answers.get("organization")).strip()[:140]}, extra


def clean_guests(demo, guests, visitor_email):
	if not cint(demo.allow_guests) or not guests:
		return []
	found = []
	for part in re.split(r"[\s,;]+", cstr(guests)):
		part = part.strip().lower()
		if not part or part == visitor_email or part in found:
			continue
		if not validate_email_address(part):
			fail("invalid_email", _("{0} is not a valid guest email address.").format(frappe.utils.escape_html(part)))
		found.append(part)
	return found[:MAX_GUESTS]


# -- the lead -----------------------------------------------------------------------------------------------------------


def _last_digits(phone):
	return phone[-10:]


def match_lead(email, phone):
	"""An existing Lead for this visitor: by email first, then by phone number. Returns the name or None."""
	row = frappe.db.sql(f"select name from `tab{LEAD}` where email = %s order by modified desc limit 1", email)
	if row:
		return row[0][0]
	stripped = "replace(replace(replace(replace(replace(replace(`{c}`, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')"
	for column in ("mobile_no", "phone"):
		if not frappe.get_meta(LEAD).has_field(column):
			continue
		row = frappe.db.sql(
			f"select name from `tab{LEAD}` where {stripped.format(c=column)} like %s order by modified desc limit 1", "%" + _last_digits(phone)
		)
		if row:
			return row[0][0]
	return None


def find_or_create_lead(demo, contact, extra, consent, first_touch):
	"""``(lead name, created)``. A new Lead gets the demo type's source / status / owner and the first-touch UTMs; an existing one is left as it is
	(only a WhatsApp consent that was just given is recorded)."""
	meta = frappe.get_meta(LEAD)
	found = match_lead(contact["email"], contact["phone"])
	if found:
		if consent and meta.has_field("crm_wa_opt_in") and not frappe.db.get_value(LEAD, found, "crm_wa_opt_in"):
			frappe.db.set_value(LEAD, found, "crm_wa_opt_in", 1, update_modified=False)
		return found, False

	first, _sep, last = contact["name"].partition(" ")
	values = {
		"doctype": LEAD,
		"first_name": first,
		"last_name": last.strip(),
		"email": contact["email"],
		"mobile_no": "+" + contact["phone"],
		"organization": contact["organization"] or None,
		"source": demo.lead_source or None,
		"status": demo.lead_status or None,
	}
	owners = common.owners_of(demo)
	if cint(demo.assign_lead_to_owner) and owners:
		values["lead_owner"] = owners[0]
	for row in demo.get("fields") or []:
		if row.lead_field and cint(row.enabled) and meta.has_field(row.lead_field) and extra.get(row.key) and not values.get(row.lead_field):
			values[row.lead_field] = extra[row.key]
	if consent and meta.has_field("crm_wa_opt_in"):
		values["crm_wa_opt_in"] = 1
	for column, key in (("crm_demo_first_utm_source", "utm_source"), ("crm_demo_first_utm_medium", "utm_medium"), ("crm_demo_first_utm_campaign", "utm_campaign")):
		if meta.has_field(column) and first_touch.get(key):
			values[column] = first_touch[key]
	values = {k: v for k, v in values.items() if v not in (None, "") or k == "doctype"}
	lead = frappe.get_doc(values).insert(ignore_permissions=True)
	return lead.name, True


# -- the meeting ------------------------------------------------------------------------------------------------------------


def _attendees(demo, contact, guests):
	people, seen = [], set()

	def add(email, name=None):
		email = cstr(email).strip().lower()
		if email and email not in seen:
			seen.add(email)
			people.append({"email": email, "full_name": name})

	for user in common.owners_of(demo):
		if user != "Administrator":  # its address is a placeholder on most sites
			add(*user_details(user))
	for row in demo.get("cc") or []:
		if row.user:
			add(*user_details(row.user))
		else:
			add(row.email)
	add(contact["email"], contact["name"])
	for email in guests:
		add(email)
	return people


def _description(demo, contact, extra, utm):
	lines = [f"{demo.title}", "", f"{_('Booked by')}: {contact['name']} <{contact['email']}>", f"{_('Phone')}: +{contact['phone']}"]
	if contact["organization"]:
		lines.append(f"{_('School / company')}: {contact['organization']}")
	labels = {row.key: row.label for row in demo.get("fields") or []}
	for key, value in extra.items():
		if value:
			lines.append(f"{labels.get(key, key)}: {value}")
	if utm.get("utm_source"):
		lines.append(f"{_('Source')}: {utm.get('utm_source')} / {utm.get('utm_medium', '')} / {utm.get('utm_campaign', '')}")
	return "\n".join(lines)


def _meeting_payload(demo, lead, starts_site, ends_site, contact, guests, extra, utm):
	return {
		"subject": f"{demo.title}: {contact['name']}",
		"reference_doctype": LEAD,
		"reference_docname": lead,
		"starts_on": starts_site,
		"ends_on": ends_site,
		"provider": demo.provider or "Google Meet",
		"add_video_conferencing": 1,
		"google_meet_link": demo.manual_link or "",  # the fallback if Google is not connected; Google's own link replaces it
		"description": _description(demo, contact, extra, utm),
		"attendees": _attendees(demo, contact, guests),
	}


def create_meeting(demo, booking, payload):
	"""The meeting goes through the same code as ``api.save_meeting`` (calendar sync, Meet link, guests, invitations)."""
	owner = common.owners_of(demo)[0]
	doc = frappe.new_doc("CRM Meeting")
	doc.reference_doctype = payload["reference_doctype"]
	doc.reference_docname = payload["reference_docname"]
	doc.organizer = owner
	doc.owner = owner
	api.apply_meeting_data(doc, payload, "all")
	doc.is_demo = 1
	doc.demo_type = demo.name
	doc.demo_booking = booking
	doc.flags.demo_sync = True
	with as_user(owner):
		doc.insert(ignore_permissions=True)
	doc.reload()
	if not doc.google_meet_link and demo.manual_link:
		doc.db_set("google_meet_link", demo.manual_link, update_modified=False)
		doc.google_meet_link = demo.manual_link
	return doc


def _tell_first_owner(demo, lead, text):
	"""The meeting's own notification skips the person who 'scheduled' it, which here is the first owner."""
	if cint(demo.owner_notify):
		owners = common.owners_of(demo)
		if owners:
			notifications.create_record_notification(LEAD, lead, owners[0], text, kind="scheduled")


# -- create ---------------------------------------------------------------------------------------------------------------------


def create_booking(demo, start, tz_name, answers=None, guests=None, consent=0, utm=None, landing_url="", referrer="", ip=None, user_agent="", fresh=False):
	"""Book ``start`` (naive UTC) for a visitor. Returns the booking name. Raises DemoError (with a ``code``) for anything the visitor can fix.
	``fresh``: the caller (the guest endpoint) has written nothing yet, so the transaction may be restarted once the owners are locked."""
	if not common.owners_of(demo):
		fail("unavailable", _("This booking page is not available."))
	contact, extra = clean_contact(demo, answers)
	extra_guests = clean_guests(demo, guests, contact["email"])
	hashed = spam.ip_hash(ip)
	spam.check_ip_limit(hashed, demo.max_per_ip_per_hour)
	tz = common.zone(tz_name, demo.get("timezone"))
	taken = _("That time was just taken. Please pick another.")
	if not slots.is_available(demo, start):
		fail("slot_taken", taken)

	consent = 1 if cint(consent) else 0
	utm_now, first_touch = _utm_of(utm)
	first_touch = first_touch or utm_now
	length = timedelta(minutes=common.minutes(demo.duration_minutes, 30))
	starts_site, ends_site = common.to_site(start), common.to_site(start + length)
	owners = common.owners_of(demo)

	lock_owners(owners, fresh)
	frappe.db.savepoint("demo_booking")
	try:
		spam.check_repeat_contact(demo, contact["email"], contact["phone"])
		if not slots.is_available(demo, start):
			fail("slot_taken", taken)
		booking = frappe.get_doc(
			{
				"doctype": BOOKING,
				"demo_type": demo.name,
				"status": "Confirmed",
				"starts_on": starts_site,
				"ends_on": ends_site,
				"starts_utc": start,
				"visitor_timezone": getattr(tz, "key", None) or demo.get("timezone"),
				"name_": contact["name"],
				"email": contact["email"],
				"phone": contact["phone"],
				"organization": contact["organization"],
				"answers": json.dumps(extra) if extra else None,
				"guests": ", ".join(extra_guests) or None,
				"whatsapp_consent": consent,
				"token": secrets.token_urlsafe(24),
				"slot_key": slot_key(demo.name, start),
				"landing_url": cstr(landing_url)[:500] or None,
				"referrer": cstr(referrer)[:500] or None,
				"first_touch": json.dumps(first_touch) if first_touch else None,
				"ip_hash": hashed,
				"user_agent": cstr(user_agent)[:250] or None,
				**utm_now,
			}
		).insert(ignore_permissions=True)

		lead, created = find_or_create_lead(demo, contact, extra, consent, first_touch)
		booking.db_set("lead", lead, update_modified=False)
		meeting = create_meeting(demo, booking.name, _meeting_payload(demo, lead, starts_site, ends_site, contact, extra_guests, extra, utm_now))
		booking.db_set("meeting", meeting.name, update_modified=False)
		messaging.queue_messages(booking.name, "Confirmed")
		_tell_first_owner(demo, lead, _("New demo booked: {0} on {1}").format(contact["name"], starts_site))
	except Exception as exc:
		_undo("demo_booking", exc, taken)
		raise
	messaging.kick(booking.name)
	return booking.name


# -- change ------------------------------------------------------------------------------------------------------------------------


def _changeable(row):
	if not row or row.status not in ACTIVE or row.starts_utc <= common.utcnow():
		fail("not_changeable", _("This demo has already started or was cancelled, so it can no longer be changed."))


def reschedule(name, start, tz_name=None, by_team=False, fresh=False):
	"""Move a booking to another slot. The old slot is freed in the same statement that takes the new one."""
	row = frappe.db.get_value(BOOKING, name, ["name", "demo_type", "status", "starts_utc", "meeting", "lead", "visitor_timezone"], as_dict=True)
	_changeable(row)
	demo = frappe.get_cached_doc(DEMO_TYPE, row.demo_type)
	if not common.owners_of(demo):
		fail("unavailable", _("This booking page is not available."))
	if start == row.starts_utc:
		fail("slot_taken", _("That is the time you already have. Please pick another."))
	taken = _("That time was just taken. Please pick another.")
	if not slots.is_available(demo, start, exclude_booking=name):
		fail("slot_taken", taken)
	tz = common.zone(tz_name or row.visitor_timezone, demo.get("timezone"))
	length = timedelta(minutes=common.minutes(demo.duration_minutes, 30))
	starts_site, ends_site = common.to_site(start), common.to_site(start + length)

	lock_owners(common.owners_of(demo), fresh)
	frappe.db.savepoint("demo_reschedule")
	try:
		if not slots.is_available(demo, start, exclude_booking=name):
			fail("slot_taken", taken)
		frappe.db.sql(
			f"""update `tab{BOOKING}` set starts_utc = %(utc)s, starts_on = %(on)s, ends_on = %(end)s, slot_key = %(key)s, status = 'Rescheduled',
			rescheduled_from = %(old)s, visitor_timezone = %(tz)s, modified = %(now)s
			where name = %(name)s and status in %(active)s and starts_utc > %(utcnow)s""",
			{
				"utc": start, "on": starts_site, "end": ends_site, "key": slot_key(demo.name, start), "old": row.starts_utc,
				"tz": getattr(tz, "key", None) or row.visitor_timezone, "now": now_datetime(), "name": name, "active": ACTIVE, "utcnow": common.utcnow(),
			},
		)
		if frappe.db.sql("select row_count()")[0][0] != 1:
			fail("not_changeable", _("This demo has already started or was cancelled, so it can no longer be changed."))
		if row.meeting and frappe.db.exists("CRM Meeting", row.meeting):
			_move_meeting(demo, row.meeting, starts_site, ends_site)
		messaging.cancel_pending(name, _("Moved to a new time."), events=("Confirmed", "Rescheduled", "Reminder"))
		messaging.queue_messages(name, "Rescheduled")
		_tell_first_owner(demo, row.lead, _("Demo rescheduled to {0}").format(starts_site))
	except Exception as exc:
		_undo("demo_reschedule", exc, taken)
		raise
	messaging.kick(name)
	return name


def _move_meeting(demo, meeting_name, starts_site, ends_site):
	doc = frappe.get_doc("CRM Meeting", meeting_name)
	if doc.status == "Cancelled":
		return
	doc.starts_on, doc.ends_on = starts_site, ends_site
	doc.flags.notify_guests = True
	doc.flags.demo_sync = True
	with as_user((common.owners_of(demo) or [frappe.session.user])[0]):
		doc.save(ignore_permissions=True)


def cancel(name, reason="", by_team=False, sync_meeting=True):
	"""Cancel a booking: frees the slot, cancels the meeting, drops the messages still waiting and tells the visitor."""
	row = frappe.db.get_value(BOOKING, name, ["name", "demo_type", "status", "starts_utc", "meeting", "lead"], as_dict=True)
	_changeable(row)
	demo = frappe.get_cached_doc(DEMO_TYPE, row.demo_type)
	frappe.db.sql(
		f"""update `tab{BOOKING}` set status = 'Cancelled', slot_key = NULL, cancel_reason = %(reason)s, modified = %(now)s
		where name = %(name)s and status in %(active)s""",
		{"reason": cstr(reason)[:500] or None, "now": now_datetime(), "name": name, "active": ACTIVE},
	)
	if frappe.db.sql("select row_count()")[0][0] != 1:
		fail("not_changeable", _("This demo has already started or was cancelled, so it can no longer be changed."))
	if sync_meeting and row.meeting and frappe.db.exists("CRM Meeting", row.meeting):
		doc = frappe.get_doc("CRM Meeting", row.meeting)
		if doc.status != "Cancelled":
			doc.status = "Cancelled"
			doc.flags.notify_guests = True
			doc.flags.demo_sync = True
			with as_user((common.owners_of(demo) or [frappe.session.user])[0]):
				doc.save(ignore_permissions=True)
	messaging.cancel_pending(name, _("Booking cancelled."))
	messaging.queue_messages(name, "Cancelled")
	_tell_first_owner(demo, row.lead, _("Demo cancelled: {0}").format(common.to_site(row.starts_utc)))
	messaging.kick(name)
	return name


# -- what the guest sees --------------------------------------------------------------------------------------------------------


def payload(name):
	"""The booking in the shape of the guest API (see docs/DEMO_BOOKING.md). Only ever built for the holder of the token."""
	b = frappe.db.get_value(
		BOOKING, name,
		["name", "demo_type", "status", "starts_utc", "visitor_timezone", "meeting", "token", "name_", "email", "cancel_reason", "ends_on", "starts_on"],
		as_dict=True,
	)
	demo = frappe.get_cached_doc(DEMO_TYPE, b.demo_type)
	length = timedelta(minutes=common.minutes(demo.duration_minutes, 30))
	ends = b.starts_utc + length
	link = (frappe.db.get_value("CRM Meeting", b.meeting, "google_meet_link") if b.meeting else "") or demo.get("manual_link") or ""
	changeable = b.status in ACTIVE and b.starts_utc > common.utcnow()
	title = demo.title
	calendar = "https://calendar.google.com/calendar/render?" + urlencode(
		{
			"action": "TEMPLATE",
			"text": title,
			"dates": f"{b.starts_utc:%Y%m%dT%H%M%SZ}/{ends:%Y%m%dT%H%M%SZ}",
			"details": f"{title}\n{link}".strip(),
			"location": link,
		}
	)
	return {
		"token": b.token,
		"status": b.status,
		"starts_on_iso": common.iso_z(b.starts_utc),
		"ends_on_iso": common.iso_z(ends),
		"tz": b.visitor_timezone or demo.get("timezone") or common.system_timezone(),
		"meet_link": link,
		"title": title,
		"manage_url": common.manage_url(b.token),
		"reschedule_url": common.manage_url(b.token, "reschedule"),
		"cancel_url": common.manage_url(b.token, "cancel"),
		"add_to_calendar_url": calendar,
		"ics_url": frappe.utils.get_url(f"/api/method/crm_addons.demos.public.ics?token={b.token}"),
		"can_change": bool(changeable),
		"name": b.name_,
		"email": b.email,
	}


def build_ics(name):
	b = frappe.db.get_value(BOOKING, name, ["name", "demo_type", "status", "starts_utc", "meeting"], as_dict=True)
	demo = frappe.get_cached_doc(DEMO_TYPE, b.demo_type)
	end = b.starts_utc + timedelta(minutes=common.minutes(demo.duration_minutes, 30))
	link = (frappe.db.get_value("CRM Meeting", b.meeting, "google_meet_link") if b.meeting else "") or demo.get("manual_link") or ""
	stamp = common.utcnow().strftime("%Y%m%dT%H%M%SZ")
	lines = [
		"BEGIN:VCALENDAR", "PRODID:-//CRM Pro Pack//Demo booking//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
		"BEGIN:VEVENT", f"UID:crm-demo-{b.name}@{frappe.local.site}", f"DTSTAMP:{stamp}",
		f"DTSTART:{b.starts_utc:%Y%m%dT%H%M%SZ}", f"DTEND:{end:%Y%m%dT%H%M%SZ}", f"SUMMARY:{_ics_escape(demo.title)}",
		f"STATUS:{'CANCELLED' if b.status == 'Cancelled' else 'CONFIRMED'}",
	]
	if link:
		lines += [f"LOCATION:{_ics_escape(link)}", f"URL:{_ics_escape(link)}", f"DESCRIPTION:{_ics_escape(link)}"]
	lines += ["END:VEVENT", "END:VCALENDAR"]
	return ("\r\n".join(lines) + "\r\n").encode()


# -- CRM -> booking: the team changed the meeting inside CRM --------------------------------------------------------------------------


def on_meeting_update(doc, method=None):
	"""``doc_events`` hook on CRM Meeting. When the team cancels, moves or closes a demo meeting in CRM, the booking follows (and the visitor is told)."""
	if not doc.get("is_demo") or not doc.get("demo_booking") or doc.flags.get("demo_sync") or doc.flags.in_insert:
		return
	try:
		before = doc.get_doc_before_save()
		booking = frappe.db.get_value(BOOKING, doc.demo_booking, ["name", "status", "starts_utc"], as_dict=True)
		if not before or not booking:
			return
		if before.status != "Cancelled" and doc.status == "Cancelled" and booking.status in ACTIVE:
			frappe.db.sql(f"update `tab{BOOKING}` set status = 'Cancelled', slot_key = NULL, cancel_reason = %s where name = %s", (_("Cancelled by the team."), booking.name))
			messaging.cancel_pending(booking.name, _("Booking cancelled."))
			messaging.queue_messages(booking.name, "Cancelled")
			messaging.kick(booking.name)
		elif doc.meeting_outcome != before.meeting_outcome and doc.meeting_outcome in ("Held", "No Show"):
			status = "Completed" if doc.meeting_outcome == "Held" else "No Show"
			frappe.db.set_value(BOOKING, booking.name, "status", status, update_modified=False)
			messaging.cancel_pending(booking.name, _("The demo is over."))
		elif doc.status == "Scheduled" and booking.status in ACTIVE and get_datetime(before.starts_on) != get_datetime(doc.starts_on):
			start = common.from_site(get_datetime(doc.starts_on))
			frappe.db.sql(
				f"""update `tab{BOOKING}` set starts_utc = %s, starts_on = %s, ends_on = %s, slot_key = %s, status = 'Rescheduled', rescheduled_from = %s
				where name = %s""",
				(start, get_datetime(doc.starts_on), get_datetime(doc.ends_on), slot_key(doc.demo_type, start), booking.starts_utc, booking.name),
			)
			messaging.cancel_pending(booking.name, _("Moved to a new time."), events=("Confirmed", "Rescheduled", "Reminder"))
			messaging.queue_messages(booking.name, "Rescheduled")
			messaging.kick(booking.name)
	except Exception:
		frappe.log_error(title="CRM Demo: could not follow a meeting change", message=frappe.get_traceback())
