"""Sample bookings and notifications for the /suite screenshots (made-up data, a throw-away showcase site only).

    bench --site showcase.local execute "exec(open('docs/screenshots/seed_suite.py').read(), globals())"
"""

import frappe
from frappe.utils import add_days, add_to_date, now_datetime

OWNERS = ["aisha.verma@example.com", "ben.carter@example.com", "chloe.nguyen@example.com", "dev.malhotra@example.com"]
ME = "alex.morgan@example.com"


def widgets():
	for title, slug, minutes in (("Programme walkthrough", "programme-walkthrough", 30), ("Campus visit planning", "campus-visit", 45)):
		if frappe.db.exists("CRM Demo Type", slug):
			continue
		doc = frappe.get_doc({
			"doctype": "CRM Demo Type", "title": title, "slug": slug, "enabled": 1, "duration_minutes": minutes, "slot_interval_minutes": 30, "timezone": "Asia/Kolkata",
			"description": "A short call to walk you through the programme.", "provider": "Google Meet", "accent_color": "#4f46e5", "brand_name": "Acme Learning",
			"owners": [{"user": u} for u in OWNERS[:3]],
			"hours": [{"weekday": d, "from_time": "10:00:00", "to_time": "17:00:00"} for d in ("Mon", "Tue", "Wed", "Thu", "Fri")],
		})
		doc.insert(ignore_permissions=True)


def bookings():
	if frappe.db.count("CRM Demo Booking"):
		return
	leads = frappe.get_all("CRM Lead", fields=["name", "first_name", "last_name", "email", "mobile_no", "organization"], limit=16, order_by="creation asc")
	plan = ["Confirmed"] * 6 + ["Rescheduled", "Rescheduled", "Cancelled", "Completed", "Completed", "Completed", "No Show", "Confirmed", "Confirmed", "Completed"]
	for i, (lead, status) in enumerate(zip(leads, plan)):
		day = add_days(now_datetime().replace(hour=11, minute=0, second=0, microsecond=0), (i % 9) - 3 if status in ("Confirmed", "Rescheduled") else -(i % 6 + 1))
		start = add_to_date(day, hours=(i % 4) * 1)
		doc = frappe.get_doc({
			"doctype": "CRM Demo Booking", "demo_type": "programme-walkthrough" if i % 3 else "campus-visit", "status": status, "starts_on": start, "ends_on": add_to_date(start, minutes=30),
			"starts_utc": add_to_date(start, hours=-5, minutes=-30), "visitor_timezone": "Asia/Kolkata", "name_": f"{lead.first_name} {lead.last_name or ''}".strip(), "email": lead.email,
			"phone": lead.mobile_no, "organization": lead.organization, "lead": lead.name, "token": frappe.generate_hash(length=20), "slot_key": frappe.generate_hash(length=12),
			"utm_source": ("google", "facebook", "instagram", "")[i % 4], "utm_medium": ("cpc", "paid_social", "paid_social", "")[i % 4], "utm_campaign": ("spring-admissions", "summer-camp")[i % 2],
		})
		doc.insert(ignore_permissions=True)


def notifications():
	lead = frappe.get_all("CRM Lead", pluck="name", limit=6, order_by="creation desc")
	rows = [
		("Mention", "Ben Carter", "ben.carter@example.com", "mentioned you in a comment", "Can you take the parent call for this one? They asked for the evening batch.", 0),
		("WhatsApp", "Aisha Verma", "aisha.verma@example.com", "received a WhatsApp reply from a lead", "Yes please, call me tomorrow after 5.", 0),
		("Assignment", "Chloe Nguyen", "chloe.nguyen@example.com", "assigned a lead to you", "", 0),
		("Task", "Dev Malhotra", "dev.malhotra@example.com", "set a task due for you", "Send the fee structure before the walkthrough", 1),
		("WhatsApp", "Elena Rossi", "elena.rossi@example.com", "received a WhatsApp reply from a lead", "Thanks, I will check and revert.", 1),
	]
	for i, (t, who, frm, text, msg, read) in enumerate(rows):
		d = frappe.get_doc({"doctype": "CRM Notification", "to_user": ME, "from_user": frm, "type": t, "read": read, "notification_text": f"{who} {text}", "message": msg, "reference_doctype": "CRM Lead", "reference_name": lead[i % len(lead)]})
		d.insert(ignore_permissions=True)
		frappe.db.set_value("CRM Notification", d.name, "creation", add_to_date(now_datetime(), hours=-(i * 3 + 1)), update_modified=False)


widgets(); bookings(); notifications()
frappe.db.commit()
print("seeded", frappe.db.count("CRM Demo Booking"), "bookings")
