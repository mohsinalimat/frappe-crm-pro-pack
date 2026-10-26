"""The UTM report: where bookings come from and how many turned into demos that were held. Numbers come straight from the bookings."""

import frappe

from crm_addons.campaigns.common import date_range
from crm_addons.demos import common
from crm_addons.demos.common import ACTIVE, BOOKING

NONE_LABELS = {"utm_source": "(direct)", "utm_medium": "(none)", "utm_campaign": "(none)"}


def _where(from_date, to_date, demo_type):
	start, end = date_range(from_date, to_date)
	parts, values = ["1 = 1"], {}
	if start:
		parts.append("b.creation >= %(start)s")
		values["start"] = start
	if end:
		parts.append("b.creation < %(end)s")
		values["end"] = end
	if demo_type:
		parts.append("b.demo_type = %(demo_type)s")
		values["demo_type"] = demo_type
	return " and ".join(parts), values


COUNTS = """count(*) as booked,
	sum(b.status = 'Completed') as held, sum(b.status = 'No Show') as no_show, sum(b.status = 'Cancelled') as cancelled"""


def _group(column, where, values, label_sql=None):
	label = label_sql or f"coalesce(nullif(b.`{column}`, ''), %(none)s)"
	rows = frappe.db.sql(
		f"select {label} as label, {COUNTS} from `tab{BOOKING}` b where {where} group by label order by booked desc, label limit 100",
		{**values, "none": NONE_LABELS.get(column, "(none)")},
		as_dict=True,
	)
	return [{"label": r.label, "booked": int(r.booked), "held": int(r.held or 0), "no_show": int(r.no_show or 0), "cancelled": int(r.cancelled or 0)} for r in rows]


def demo_report(from_date=None, to_date=None, demo_type=None):
	"""Bookings made in the range (by the day they were booked), by source, medium, campaign, demo type and day, and the funnel."""
	where, values = _where(from_date, to_date, demo_type)
	totals = frappe.db.sql(
		f"""select {COUNTS}, sum(b.status in %(active)s and b.starts_utc >= %(now)s) as upcoming, sum(b.status = 'Rescheduled') as rescheduled
		from `tab{BOOKING}` b where {where}""",
		{**values, "active": ACTIVE, "now": common.utcnow()},
		as_dict=True,
	)[0]
	booked = int(totals.booked or 0)
	held = int(totals.held or 0)
	by_day = frappe.db.sql(
		f"select date(b.creation) as date, {COUNTS} from `tab{BOOKING}` b where {where} group by date(b.creation) order by date(b.creation)",
		values,
		as_dict=True,
	)
	return {
		"totals": {
			"booked": booked,
			"upcoming": int(totals.upcoming or 0),
			"held": held,
			"no_show": int(totals.no_show or 0),
			"cancelled": int(totals.cancelled or 0),
			"rescheduled": int(totals.rescheduled or 0),
			"held_rate": round(100 * held / booked, 1) if booked else 0,
		},
		"by_source": _group("utm_source", where, values),
		"by_medium": _group("utm_medium", where, values),
		"by_campaign": _group("utm_campaign", where, values),
		"by_demo_type": _group("demo_type", where, values, "b.demo_type"),
		"by_day": [
			{"date": str(r.date), "booked": int(r.booked), "held": int(r.held or 0), "no_show": int(r.no_show or 0), "cancelled": int(r.cancelled or 0)}
			for r in by_day
		],
	}
