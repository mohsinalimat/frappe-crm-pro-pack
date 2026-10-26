"""Which times a demo type can be booked.

``candidates`` is pure (no database): weekly hours, date overrides, minimum notice and the booking horizon, worked out in the demo type's
time zone so a daylight-saving change moves the UTC time but not the wall-clock time. ``available_slots`` then removes what is taken:
the owners' CRM Meetings (as organizer or guest, all owners when there are several), the type's own bookings, the buffers and the per-day cap.
Everything is naive UTC inside; the visitor's zone only matters when the days are labelled.
"""

from datetime import datetime, time, timedelta, timezone

import frappe
from frappe import _
from frappe.utils import cint, getdate

from crm_addons.demos import common
from crm_addons.demos.common import ACTIVE, BOOKING, WEEKDAYS, as_utc

MAX_RANGE_DAYS = 62


def _to_time(value):
	"""A datetime.time from a time, a timedelta (what Frappe returns for a Time field) or 'HH:MM[:SS]'."""
	if isinstance(value, time):
		return value
	if isinstance(value, timedelta):
		seconds = int(value.total_seconds()) % 86400
		return time(seconds // 3600, seconds // 60 % 60, seconds % 60)
	if value in (None, ""):
		return None
	parts = [int(float(p)) for p in str(value).split(":")]
	parts += [0] * (3 - len(parts))
	return time(parts[0] % 24, parts[1], parts[2])


def config_of(demo):
	"""The numbers and tables of a demo type as plain data (a Document or a dict)."""
	get = demo.get
	duration = common.minutes(get("duration_minutes"), 30)
	hours = {}
	for row in get("hours") or []:
		start, end = _to_time(row.get("from_time")), _to_time(row.get("to_time"))
		if row.get("weekday") in WEEKDAYS and start and end and end > start:
			hours.setdefault(row.get("weekday"), []).append((start, end))
	overrides = {}
	for row in get("overrides") or []:
		if not row.get("date"):
			continue
		entry = overrides.setdefault(getdate(row.get("date")), {"off": False, "windows": []})
		start, end = _to_time(row.get("from_time")), _to_time(row.get("to_time"))
		if row.get("kind") == "Custom hours" and start and end and end > start:
			entry["windows"].append((start, end))
		elif row.get("kind") != "Custom hours":
			entry["off"] = True
	return {
		"tz": get("timezone") or common.system_timezone(),
		"duration": duration,
		"interval": common.minutes(get("slot_interval_minutes"), duration),
		"buffer_before": max(0, cint(get("buffer_before_minutes"))),
		"buffer_after": max(0, cint(get("buffer_after_minutes"))),
		"min_notice_hours": max(0, cint(get("min_notice_hours"))),
		"max_days": max(0, cint(get("max_days_ahead"))),
		"max_per_day": max(0, cint(get("max_per_day"))),
		"hours": hours,
		"overrides": overrides,
	}


def _utc(day, at, tz):
	"""Wall-clock ``at`` on ``day`` in ``tz`` -> naive UTC. A time that does not exist (the spring-forward gap) lands on the instant after it."""
	return datetime.combine(day, at, tzinfo=tz).astimezone(timezone.utc).replace(tzinfo=None)


def windows_for(cfg, day):
	entry = cfg["overrides"].get(day)
	if entry:
		return [] if entry["off"] else entry["windows"]
	return cfg["hours"].get(WEEKDAYS[day.weekday()], [])


def candidates(cfg, lo, hi, now):
	"""Slot starts (naive UTC, sorted) in [lo, hi) allowed by the hours, overrides, minimum notice and horizon. No bookings considered."""
	tz = common.zone(cfg["tz"])
	lo = max(lo, now + timedelta(hours=cfg["min_notice_hours"]))
	# the last bookable day is today (in the demo's zone) plus max_days, up to its midnight
	last_day = as_utc(now).astimezone(tz).date() + timedelta(days=cfg["max_days"])
	hi = min(hi, _utc(last_day + timedelta(days=1), time.min, tz))
	if lo >= hi:
		return []
	step, length = timedelta(minutes=cfg["interval"]), timedelta(minutes=cfg["duration"])
	day = as_utc(lo).astimezone(tz).date()
	end_day = as_utc(hi - timedelta(seconds=1)).astimezone(tz).date()
	out = set()
	while day <= end_day:
		for start, end in windows_for(cfg, day):
			begin, stop = _utc(day, start, tz), _utc(day, end, tz)
			slot = begin
			while slot + length <= stop:
				if lo <= slot < hi:
					out.add(slot)
				slot += step
		day += timedelta(days=1)
	return sorted(out)


# -- what is already taken ---------------------------------------------------------------------------------------


def _busy(owners, lo, hi, exclude_meeting=None):
	"""(start, end) in naive UTC of the owners' meetings that overlap [lo, hi): one query for all owners."""
	if not owners:
		return []
	rows = frappe.db.sql(
		"""select m.name, m.starts_on, m.ends_on from `tabCRM Meeting` m
		where m.status != 'Cancelled' and m.ends_on > %(lo)s and m.starts_on < %(hi)s
		and (m.organizer in %(owners)s or exists (select 1 from `tabCRM Meeting Attendee` a
			where a.parent = m.name and a.parenttype = 'CRM Meeting' and a.user in %(owners)s))"""
		,
		{"lo": common.to_site(lo), "hi": common.to_site(hi), "owners": tuple(owners)},
		as_dict=True,
	)
	return [
		(common.from_site(r.starts_on), common.from_site(r.ends_on))
		for r in rows
		if not exclude_meeting or str(r.name) != str(exclude_meeting)
	]


def _bookings(demo_name, lo, hi, exclude_booking=None):
	"""Starts (naive UTC) of the type's active bookings in [lo, hi)."""
	rows = frappe.db.sql(
		f"""select name, starts_utc from `tab{BOOKING}` where demo_type = %(d)s and status in %(active)s
		and starts_utc >= %(lo)s and starts_utc < %(hi)s""",
		{"d": demo_name, "active": ACTIVE, "lo": lo, "hi": hi},
		as_dict=True,
	)
	return [r.starts_utc for r in rows if r.name != exclude_booking]


def available_slots(demo, lo, hi, exclude_booking=None, now=None):
	"""Bookable slot starts (naive UTC) in [lo, hi). ``exclude_booking``: a booking being moved, whose own slot and meeting do not block."""
	now = now or common.utcnow()
	cfg = config_of(demo)
	found = candidates(cfg, lo, hi, now)
	owners = common.owners_of(demo)
	if not found or not owners:
		return []
	exclude_meeting = frappe.db.get_value(BOOKING, exclude_booking, "meeting") if exclude_booking else None
	before, after = timedelta(minutes=cfg["buffer_before"]), timedelta(minutes=cfg["buffer_after"])
	length = timedelta(minutes=cfg["duration"])

	busy = _busy(owners, found[0] - before, found[-1] + length + after, exclude_meeting)
	# the type's own bookings block too (normally their meeting already does; this also covers a booking whose meeting was deleted)
	mine = _bookings(demo.name, found[0] - timedelta(days=1), found[-1] + timedelta(days=1), exclude_booking)
	busy += [(s, s + length) for s in mine]

	tz = common.zone(cfg["tz"])
	per_day = {}
	if cfg["max_per_day"]:
		for s in mine:
			day = as_utc(s).astimezone(tz).date()
			per_day[day] = per_day.get(day, 0) + 1

	out = []
	for slot in found:
		start, end = slot - before, slot + length + after
		if any(b_start < end and b_end > start for b_start, b_end in busy):
			continue
		if cfg["max_per_day"] and per_day.get(as_utc(slot).astimezone(tz).date(), 0) >= cfg["max_per_day"]:
			continue
		out.append(slot)
	return out


def is_available(demo, start, exclude_booking=None, now=None):
	return start in available_slots(demo, start, start + timedelta(minutes=1), exclude_booking, now)


# -- the guest-facing shape ---------------------------------------------------------------------------------------


def get_slots(demo, from_date, to_date, tz_name, exclude_booking=None, now=None):
	"""``{tz, days: [{date, slots: [{start, label}]}]}``; dates are in ``tz_name`` (inclusive) and only days with a slot are listed."""
	try:
		first, last = getdate(from_date), getdate(to_date)
	except Exception:
		common.fail("not_found", _("Choose a valid date range."))
	if last < first:
		first, last = last, first
	last = min(last, first + timedelta(days=MAX_RANGE_DAYS - 1))
	tz = common.zone(tz_name, demo.get("timezone"))
	lo = _utc(first, time.min, tz)
	hi = _utc(last + timedelta(days=1), time.min, tz)
	days = {}
	for slot in available_slots(demo, lo, hi, exclude_booking, now=now):
		local = as_utc(slot).astimezone(tz)
		days.setdefault(local.date().isoformat(), []).append({"start": common.iso_z(slot), "label": common.local_time_label(slot, tz)})
	return {"tz": getattr(tz, "key", cfg_tz(demo)), "days": [{"date": d, "slots": days[d]} for d in sorted(days)]}


def cfg_tz(demo):
	return demo.get("timezone") or common.system_timezone()
