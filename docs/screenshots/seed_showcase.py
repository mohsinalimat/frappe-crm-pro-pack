"""Seed a clean site with believable FAKE data for the CRM Pro Pack screenshots.

Everything here is made up: a fictional company ("Acme Learning"), people with example.com / example.org addresses,
and obviously fake phone numbers (patterned digits and the ranges that regulators reserve for fiction). Campaign
numbers (sent / opened / clicked / replied) are SAMPLE DATA inserted straight into the recipient table so reports and
charts have shape. They are not benchmarks.

Run it on a bench where `frappe`, `crm`, `frappe_whatsapp` and `crm_addons` are installed on a site you can throw away:

    SHOWCASE_BENCH=/path/to/bench SHOWCASE_SITE=showcase.local  /path/to/bench/env/bin/python seed_showcase.py

It is idempotent only in the sense that it refuses to run twice on the same site (it checks for the marker user). To
start again, reinstall the site. Never run it on a real site.
"""

import json
import os
import random
import sys
from datetime import datetime, timedelta

BENCH = os.environ.get("SHOWCASE_BENCH", "/Users/sid/demo-bench")
SITE = os.environ.get("SHOWCASE_SITE", "showcase.local")  # not $SITE: a bench's env script often exports SITE for another site
if SITE == "demo.local" or not SITE.startswith("showcase"):
	sys.exit("Refusing to seed %r: this script only seeds a throw-away site whose name starts with 'showcase'." % SITE)
PASSWORD = os.environ.get("SHOWCASE_PASSWORD", "Showcase#2026")

os.chdir(BENCH + "/sites")
sys.path.insert(0, BENCH + "/apps/frappe")

import frappe  # noqa: E402

frappe.init(site=SITE, sites_path=BENCH + "/sites")
frappe.connect()
frappe.flags.in_install = False
rnd = random.Random(2026)

NOW = datetime.now().replace(microsecond=0)
TODAY = NOW.replace(hour=0, minute=0, second=0)


def when(days_ago=0, hour=10, minute=0, jitter=0):
	"""A naive datetime `days_ago` days back at hour:minute (+/- jitter minutes)."""
	d = TODAY - timedelta(days=days_ago) + timedelta(hours=hour, minutes=minute)
	if jitter:
		d += timedelta(minutes=rnd.randint(-jitter, jitter))
	return d


def commit():
	frappe.db.commit()


def log(*a):
	print("[seed]", *a, flush=True)


# --------------------------------------------------------------------------------------------------- users

PEOPLE = [
	# email, first, last, roles
	("alex.morgan@example.com", "Alex", "Morgan", ["System Manager", "Sales Manager", "Campaign Manager", "Sales User"]),
	("aisha.verma@example.com", "Aisha", "Verma", ["Sales User"]),
	("ben.carter@example.com", "Ben", "Carter", ["Sales User"]),
	("chloe.nguyen@example.com", "Chloe", "Nguyen", ["Sales User", "Campaign Manager"]),
	("dev.malhotra@example.com", "Dev", "Malhotra", ["Sales User"]),
	("elena.rossi@example.com", "Elena", "Rossi", ["Sales User"]),
]
SALES = [p[0] for p in PEOPLE[1:5]] + [PEOPLE[5][0]]
MANAGER = PEOPLE[0][0]
MARKETER = PEOPLE[3][0]


def make_users():
	if frappe.db.exists("User", MANAGER):
		log("marker user exists: this site was already seeded. Reinstall the site to start again.")
		sys.exit(1)
	for role in ("Campaign Manager",):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role}).insert(ignore_permissions=True)
	for email, first, last, roles in PEOPLE:
		u = frappe.get_doc(
			{
				"doctype": "User", "email": email, "first_name": first, "last_name": last, "enabled": 1,
				"send_welcome_email": 0, "user_type": "System User",
				"roles": [{"role": r} for r in roles],
			}
		)
		u.flags.no_welcome_mail = True
		u.insert(ignore_permissions=True)
		from frappe.utils.password import update_password

		update_password(email, PASSWORD)
	# the Administrator account would show up in places: give it a neutral name
	frappe.db.set_value("User", "Administrator", {"first_name": "Showcase", "last_name": "Admin"})
	commit()
	log("users", len(PEOPLE))


# ----------------------------------------------------------------------------------------------- taxonomy

SOURCES = ["Website", "Webinar", "Referral", "Education Fair", "Facebook Ads", "Google Ads", "Walk-in", "LinkedIn"]
INDUSTRIES = ["School", "College", "University", "Coaching Institute", "EdTech"]
STATUS_WEIGHTS = [("New", 16), ("Contacted", 17), ("Nurture", 10), ("Qualified", 10), ("Unqualified", 4), ("Junk", 3)]


def make_taxonomy():
	for s in SOURCES:
		if not frappe.db.exists("CRM Lead Source", s):
			frappe.get_doc({"doctype": "CRM Lead Source", "source_name": s}).insert(ignore_permissions=True)
	for i in INDUSTRIES:
		if not frappe.db.exists("CRM Industry", i):
			frappe.get_doc({"doctype": "CRM Industry", "industry": i}).insert(ignore_permissions=True)
	for name, weight in STATUS_WEIGHTS:
		if not frappe.db.exists("CRM Lead Status", name):
			log("missing lead status", name, "(created)")
			frappe.get_doc({"doctype": "CRM Lead Status", "lead_status": name, "type": "Open", "color": "gray", "position": 99}).insert(ignore_permissions=True)
	commit()


# ------------------------------------------------------------------------------------------------- leads

FIRST = ["Ananya", "Rohan", "Meera", "Karan", "Sofia", "Liam", "Noah", "Priya", "Arjun", "Isabella", "Omar", "Layla", "Kavya", "Ethan",
	"Zara", "Vikram", "Hannah", "Rahul", "Mia", "Anand", "Leila", "Jonas", "Tara", "Nikhil", "Amelia", "Farah", "Tomas", "Ishaan",
	"Grace", "Yusuf", "Diya", "Lucas", "Neha", "Oliver", "Sana", "Pedro", "Anika", "Hugo", "Riya", "Marcus", "Aditi", "Felix", "Pooja",
	"Daniel", "Naomi", "Kabir", "Elise", "Rajat", "Camila", "Aarav", "Julia", "Imran", "Sneha", "Victor", "Alina", "Harsh", "Clara",
	"Tejas", "Nora", "Samir"]
LAST = ["Iyer", "Kapoor", "Bennett", "Sharma", "Alvarez", "Tan", "Okafor", "Reddy", "Fischer", "Mehta", "Haddad", "Larsen", "Nair",
	"Brooks", "Khan", "Rao", "Novak", "Gupta", "Silva", "Joshi", "Rahman", "Moreau", "Bose", "Kim", "Patel", "Hughes", "Dutta",
	"Costa", "Singh", "Lindqvist", "Menon", "Ortiz", "Verma", "Castro", "Banerjee", "Walker", "Chopra", "Santos", "Das", "Evans",
	"Kulkarni", "Dubois", "Pillai", "Murray", "Saxena", "Romano", "Thomas", "Ahmed", "Fernandez", "Shah", "Lopez", "Sen", "Clarke",
	"Bhatt", "Weber", "Nambiar", "Young", "Grover", "Ibrahim", "Cohen"]
ORGS = [("Alder Creek Academy", "School"), ("Northwind Public School", "School"), ("Lakeview College", "College"),
	("Summit Coaching Institute", "Coaching Institute"), ("Harbor University", "University"), ("Maple Grove School", "School"),
	("Brightwater Institute", "Coaching Institute"), ("Riverstone College", "College"), ("Cedar Point Academy", "School"),
	("Ironwood Technical College", "College"), ("Larkspur International School", "School"), ("Meridian EdTech Labs", "EdTech"),
	("Silverleaf University", "University"), ("Oakridge Learning Centre", "Coaching Institute"), ("Bluebird Primary School", "School"),
	("Quillstone Business School", "College"), ("Pinecrest Academy", "School"), ("Foxglove Online Academy", "EdTech"),
	("Redwood Polytechnic", "College"), ("Starling Heights School", "School"), ("Tidewater Institute", "Coaching Institute"),
	("Willowbrook University", "University"), ("Juniper Skills Hub", "EdTech"), ("Kestrel Hill School", "School")]
TITLES = ["Principal", "Admissions Head", "Director", "Dean of Studies", "Head of Training", "Trustee", "Programme Coordinator", "Founder"]
DOMAINS = ["example.com", "example.org", "example.net"]


def fake_phone(i):
	kind = i % 5
	if kind in (0, 1):
		return "+91 99999 %05d" % (10100 + i * 7)  # patterned digits, plainly fake
	if kind == 2:
		return "+1 202 555 01%02d" % (i % 100)  # 555-01xx is reserved for fiction
	if kind == 3:
		return "+44 7700 900%03d" % (100 + i)  # Ofcom drama range
	return "+61 491 570 %03d" % (100 + i)  # ACMA reserved range


def pick_status():
	total = sum(w for _, w in STATUS_WEIGHTS)
	r = rnd.uniform(0, total)
	for name, w in STATUS_WEIGHTS:
		r -= w
		if r <= 0:
			return name
	return "New"


def make_leads(count=60):
	names = list(zip(FIRST, LAST))
	rnd.shuffle(names)
	leads = []
	for i in range(count):
		first, last = names[i % len(names)]
		org, industry = ORGS[i % len(ORGS)]
		owner = None if i % 10 == 9 else SALES[i % len(SALES)]
		created = when(rnd.choice([1, 2, 3, 4, 5, 7, 9, 12, 15, 18, 22, 27, 31, 36, 40, 44, 48, 53, 58, 63, 70]), rnd.randint(9, 17), rnd.randint(0, 59))
		doc = frappe.get_doc(
			{
				"doctype": "CRM Lead", "first_name": first, "last_name": last, "status": "New",
				"email": f"{first}.{last}@{DOMAINS[i % 3]}".lower(),
				"mobile_no": fake_phone(i), "organization": org, "job_title": TITLES[i % len(TITLES)],
				"source": SOURCES[(i * 3) % len(SOURCES)], "industry": industry, "lead_owner": owner,
				"no_of_employees": rnd.choice(["11-50", "51-200", "201-500", "501-1000"]),
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert()
		frappe.db.set_value("CRM Lead", doc.name, "creation", created, update_modified=False)
		frappe.db.set_value("CRM Lead", doc.name, "modified", created, update_modified=False)
		leads.append({"name": doc.name, "owner": owner, "created": created, "target_status": pick_status(), "phone": fake_phone(i)})
	commit()
	log("leads", len(leads))
	return leads


def set_lead_statuses(leads):
	for l in leads:
		if l["target_status"] != "New":
			frappe.db.set_value("CRM Lead", l["name"], "status", l["target_status"], update_modified=False)
	commit()


# ------------------------------------------------------------------------------------------ follow-ups

REMARKS = {
	"Did Not Pick": ["Rang twice, no answer.", "Phone rang out. Will try after lunch.", "No answer, left a voicemail.", "Busy line."],
	"Did Not Connect": ["Phone switched off.", "Out of coverage, will retry.", "Call dropped, number was not reachable."],
	"Interested": ["Wants the prospectus and the fee structure.", "Interested in the spring batch, sending details.", "Asked for a demo for their staff.", "Happy with the programme, discussing with the trustees."],
	"Not Interested": ["Already signed with another provider.", "Budget frozen until next year."],
	"Meeting Scheduled": ["Booked a walkthrough for Thursday.", "Meeting set with the principal and two heads of department."],
	"Ask for Detail": ["Asked for the syllabus by email.", "Wants references from similar schools."],
	"Call Back Later": ["In a meeting, asked to call after 4 pm.", "Traveling this week, call on Monday."],
}
OUTCOME_WEIGHTS = [("Did Not Pick", 24), ("Did Not Connect", 8), ("Interested", 22), ("Not Interested", 6), ("Meeting Scheduled", 10), ("Ask for Detail", 14), ("Call Back Later", 16)]


def pick_outcome(prev_unreached):
	if prev_unreached and rnd.random() < 0.55:
		return rnd.choice(["Interested", "Call Back Later", "Ask for Detail", "Meeting Scheduled"])
	total = sum(w for _, w in OUTCOME_WEIGHTS)
	r = rnd.uniform(0, total)
	for name, w in OUTCOME_WEIGHTS:
		r -= w
		if r <= 0:
			return name
	return "Interested"


def make_follow_ups(leads):
	"""Spread over the last 30 days; the newest follow-up of each lead decides overdue / today / upcoming / done."""
	owned = [l for l in leads if l["owner"]]
	rnd.shuffle(owned)
	made = 0
	for n, lead in enumerate(owned[:44]):
		count = rnd.choice([1, 2, 2, 3, 3, 4])
		first_day = min(29, max(1, int((NOW - lead["created"]).days) - 0))
		days = sorted(rnd.sample(range(0, min(first_day, 29) + 1), min(count, min(first_day, 29) + 1)), reverse=True)
		prev_unreached = False
		for k, d in enumerate(days):
			last = k == len(days) - 1
			outcome = pick_outcome(prev_unreached)
			prev_unreached = outcome in ("Did Not Pick", "Did Not Connect")
			at = when(d, rnd.randint(9, 18), rnd.randint(0, 59))
			if at > NOW:
				at = NOW - timedelta(minutes=30)
			if last:
				bucket = n % 5
				if outcome == "Not Interested":
					nxt = None
				elif bucket == 0:
					nxt = when(rnd.randint(1, 4), rnd.randint(10, 17), 0)  # overdue: it was due days ago
					if nxt < at:
						nxt = at + timedelta(hours=3)
					if nxt >= NOW:
						nxt = NOW - timedelta(hours=rnd.randint(2, 30))
						if nxt < at:
							at = nxt - timedelta(hours=2)
				elif bucket == 1:
					nxt = TODAY + timedelta(hours=rnd.randint(NOW.hour + 1 if NOW.hour < 20 else 20, 21), minutes=rnd.choice([0, 15, 30, 45]))
					if nxt < at:
						nxt = at + timedelta(minutes=45)
				elif bucket in (2, 3):
					nxt = TODAY + timedelta(days=rnd.randint(1, 8), hours=rnd.randint(10, 17))
				else:
					nxt = None
			else:
				nxt = at + timedelta(days=rnd.randint(1, 3))
				if nxt > NOW:
					nxt = None
			frappe.set_user(lead["owner"])
			doc = frappe.get_doc(
				{
					"doctype": "CRM Follow Up", "reference_doctype": "CRM Lead", "reference_docname": lead["name"],
					"followed_up_on": at, "mode": "Call", "outcome": outcome, "assigned_to": lead["owner"],
					"remark": rnd.choice(REMARKS[outcome]), "next_follow_up_on": nxt,
				}
			)
			doc.flags.ignore_permissions = True
			doc.insert()
			frappe.db.set_value("CRM Follow Up", doc.name, {"creation": at, "modified": at}, update_modified=False)
			made += 1
		frappe.set_user("Administrator")
	commit()
	log("follow-ups", made)


def refresh_lead_fields(leads):
	from crm_addons import followups, scoring

	for l in leads:
		followups.refresh_next_follow_up("CRM Lead", l["name"])
	try:
		scoring.refresh_all()
	except Exception as e:  # scoring needs the scheduler-free path only
		log("score refresh skipped:", e)
	commit()


# ------------------------------------------------------------------------------------------------ meetings

MEET_SUBJECTS = ["Intro call", "Programme walkthrough", "Demo for the staff room", "Fee and scholarship discussion", "Campus visit planning", "Onboarding kickoff"]


def make_meetings(leads):
	owned = [l for l in leads if l["owner"]]
	rnd.shuffle(owned)
	plan = [(-12, "Held"), (-9, "Held"), (-8, "No Show"), (-6, "Held"), (-5, "Rescheduled"), (-3, "Held"), (-2, "Held"), (-1, "Held"),
		(0, None), (0, None), (1, None), (2, None), (2, None), (3, None), (4, None), (6, None), (7, None), (9, None), (11, None)]
	count = 0
	for i, (offset, outcome) in enumerate(plan):
		lead = owned[i]
		org = frappe.db.get_value("CRM Lead", lead["name"], "organization")
		hour = rnd.choice([10, 11, 12, 14, 15, 16])
		starts = TODAY + timedelta(days=offset, hours=hour, minutes=rnd.choice([0, 30]))
		doc = frappe.get_doc(
			{
				"doctype": "CRM Meeting", "subject": f"{MEET_SUBJECTS[i % len(MEET_SUBJECTS)]} - {org}",
				"reference_doctype": "CRM Lead", "reference_docname": lead["name"], "provider": "Manual Link",
				"starts_on": starts, "ends_on": starts + timedelta(minutes=rnd.choice([30, 45, 60])), "add_video_conferencing": 1,
				"google_meet_link": "https://meet.google.com/abc-defg-%03d" % (100 + i), "organizer": lead["owner"],
				"description": "Walk through the programme, answer questions and agree the next step.",
			}
		)
		doc.flags.notify_guests = False
		doc.flags.ignore_permissions = True
		frappe.set_user(lead["owner"])
		doc.insert()
		frappe.set_user("Administrator")
		fields = {"provider": "Google Meet", "sync_status": "Synced"}
		if outcome:
			fields.update({"status": "Completed", "meeting_outcome": outcome, "outcome_notes": "Sample outcome note." if outcome == "Held" else ""})
		frappe.db.set_value("CRM Meeting", doc.name, fields, update_modified=False)
		count += 1
	commit()
	log("meetings", count)


# ----------------------------------------------------------------------------------- email and whatsapp setup

LEAD = "CRM Lead"


def upload_assets():
	"""Public files for the email builder images and the WhatsApp header image (drawn by make_assets.js)."""
	here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
	urls = {}
	for fname in sorted(os.listdir(here)):
		if not fname.endswith((".png", ".jpg")):
			continue
		with open(os.path.join(here, fname), "rb") as fh:
			content = fh.read()
		f = frappe.get_doc({"doctype": "File", "file_name": fname, "content": content, "is_private": 0})
		f.insert(ignore_permissions=True)
		urls[fname] = f.file_url
	commit()
	return urls


def make_infra():
	s = frappe.get_doc("CRM Addons Settings")
	s.update(
		{
			"campaigns_enabled": 1, "default_country_code": "91", "whatsapp_consent_mode": "Require opt-in",
			"default_provider": "Google Meet", "stale_lead_days": 7, "escalate_after_attempts": 3,
			"campaign_cost_email": 0.12, "campaign_cost_whatsapp_marketing": 0.78, "campaign_cost_whatsapp_utility": 0.35,
			"campaign_cost_whatsapp_authentication": 0.30,
		}
	)
	s.flags.ignore_permissions = True
	s.save()

	frappe.flags.in_patch = True  # skip the live SMTP check: nothing is ever sent from this showcase site
	if not frappe.db.exists("Email Account", "Acme Learning Admissions"):
		frappe.get_doc(
			{
				"doctype": "Email Account", "email_account_name": "Acme Learning Admissions",
				"email_id": "admissions@acme-learning.example.com", "enable_outgoing": 1, "default_outgoing": 1,
				"smtp_server": "localhost", "smtp_port": 1025, "use_tls": 0, "password": "not-a-real-password",
				"track_email_status": 1, "always_use_account_email_id_as_sender": 1, "awaiting_password": 0,
			}
		).insert(ignore_permissions=True)
	frappe.flags.in_patch = False

	if not frappe.db.exists("WhatsApp Account", "Acme Learning"):
		frappe.get_doc(
			{
				"doctype": "WhatsApp Account", "account_name": "Acme Learning", "status": "Active", "is_default_incoming": 1,
				"is_default_outgoing": 1, "phone_id": "100000000000001", "business_id": "200000000000001", "app_id": "300000000000001",
				"token": "showcase-not-a-real-token", "url": "https://graph.facebook.com", "version": "v17.0",
				"webhook_verify_token": "showcase",
			}
		).insert(ignore_permissions=True)

	# opt-in on most leads (the default consent mode needs it for WhatsApp)
	for l in frappe.get_all(LEAD, pluck="name"):
		frappe.db.set_value(LEAD, l, "crm_wa_opt_in", 1 if rnd.random() < 0.78 else 0, update_modified=False)
	commit()
	log("infra: settings, email account, whatsapp account")


WA_TEMPLATES = [
	# name, category, status, header_type, header, body, footer, buttons, samples
	("admission_open_2026", "MARKETING", "APPROVED", "TEXT", "Admissions are open",
	 "Hi {{1}}, admissions for the {{2}} programme at Acme Learning are now open. Reply to book a free counselling call with our team.",
	 "Acme Learning", [("Quick Reply", "Book a call"), ("Quick Reply", "Not now")], "Ananya,Spring 2026"),
	("open_house_reminder", "UTILITY", "APPROVED", "TEXT", "Open house on Saturday",
	 "Hello {{1}}, a reminder that our open house is on Saturday at 11 am. Show this message at the gate. We look forward to meeting you.",
	 "Acme Learning", [("Visit Website", "Get directions")], "Rohan"),
	("demo_class_invite", "MARKETING", "APPROVED", "IMAGE", "",
	 "Hi {{1}}, join a free demo class this week and see how learning works at Acme. Only {{2}} seats left.",
	 "Reply STOP to opt out", [("Visit Website", "Reserve a seat")], "Meera,12"),
	("welcome_message", "UTILITY", "APPROVED", "TEXT", "Welcome to Acme Learning",
	 "Hi {{1}}, thanks for your enquiry. Your counsellor {{2}} will call you shortly. Reply here if you prefer to chat.",
	 "Acme Learning", [("Quick Reply", "Chat on WhatsApp")], "Karan,Aisha"),
	("fee_instalment_reminder", "UTILITY", "APPROVED", "TEXT", "",
	 "Dear {{1}}, this is a friendly reminder that the next instalment for {{2}} is due on {{3}}.",
	 "Acme Learning", [], "Sofia,Spring batch,15 March"),
	("scholarship_test_2026", "MARKETING", "PENDING", "TEXT", "Scholarship test",
	 "Hi {{1}}, registrations for the Acme scholarship test close on Friday. Tap below to register in two minutes.",
	 "Acme Learning", [("Visit Website", "Register now")], "Liam"),
	("flash_discount_offer", "MARKETING", "REJECTED", "TEXT", "",
	 "Hi {{1}}, last chance: 40% off all programmes today only!",
	 "", [], "Noah"),
]


def make_wa_templates(urls):
	account = frappe.db.get_value("WhatsApp Account", {"is_default_outgoing": 1}, "name")
	for n, (name, cat, status, htype, header, body, footer, buttons, samples) in enumerate(WA_TEMPLATES):
		doc = frappe.new_doc("WhatsApp Templates")
		doc.update(
			{
				"template_name": name, "actual_name": name, "language": "en", "language_code": "en", "category": cat,
				"status": status, "header_type": htype, "header": header, "template": body, "footer": footer,
				"sample_values": samples, "whatsapp_account": account, "id": "9100000000%05d" % n,
			}
		)
		if htype == "IMAGE":
			doc.sample = urls.get("banner-open-house.jpg", "")
		for kind, label in buttons:
			row = {"button_type": kind, "button_label": label}
			if kind == "Visit Website":
				row.update({"website_url": "https://www.example.com/acme", "url_type": "Static"})
			doc.append("buttons", row)
		doc.set_new_name()
		doc.set_user_and_timestamp()
		doc.db_insert()
		for row in doc.buttons:
			row.parent, row.parenttype, row.parentfield = doc.name, doc.doctype, "buttons"
			row.set_new_name()
			row.set_user_and_timestamp()
			row.db_insert()
	commit()
	log("whatsapp templates", len(WA_TEMPLATES))


def make_segments():
	frappe.set_user(MANAGER)
	from crm_addons.campaigns import api

	api.save_segment("Hot leads: Qualified", [["status", "=", "Qualified"]], 1)
	api.save_segment("New this month", [["status", "=", "New"]], 1)
	api.save_segment("Webinar and referral leads", [["source", "in", ["Webinar", "Referral"]]], 1)
	api.save_segment("Schools in the pipeline", [["industry", "=", "School"], ["status", "in", ["Contacted", "Nurture", "Qualified"]]], 1)
	frappe.set_user("Administrator")
	commit()
	log("segments")


def make_orgs():
	"""CRM Organizations for the fictional schools (deals link to them, and CRM's Organizations page looks alive)."""
	for name, industry in ORGS:
		if not frappe.db.exists("CRM Organization", name):
			frappe.get_doc({"doctype": "CRM Organization", "organization_name": name, "industry": industry, "no_of_employees": rnd.choice(["11-50", "51-200", "201-500"]), "website": "https://www.example.com"}).insert(ignore_permissions=True)
	commit()
	log("organizations", len(ORGS))


def retime_leads():
	"""Move about a third of the leads further back in time (never later than their first follow-up), so that the first
	campaigns (which started weeks ago) have a believable audience. Idempotent."""
	rows = frappe.get_all(LEAD, fields=["name", "creation"], order_by="name asc")
	moved = 0
	for n, r in enumerate(rows):
		if n % 3 == 2 and (NOW - r.creation).days < 45:
			target = when(rnd.randint(46, 75), rnd.randint(9, 17), rnd.randint(0, 59))
			first = frappe.db.sql("select min(followed_up_on) from `tabCRM Follow Up` where reference_docname=%s", r.name)[0][0]
			if first and target > first - timedelta(days=1):
				target = first - timedelta(days=rnd.randint(1, 4))
			if target < r.creation:
				frappe.db.set_value(LEAD, r.name, {"creation": target, "modified": target}, update_modified=False)
				moved += 1
	commit()
	log("leads moved back in time", moved)


# ----------------------------------------------------------------------------------------------- campaigns

ELIGIBLE_EMAIL = "email is not null"


def eligible(channel, before=None, owner_filter=None, status_in=None, source_in=None, industry=None, limit=None):
	"""Lead rows as the engine would pick them: a valid address, and for WhatsApp an opt-in."""
	f = {"email": ["is", "set"]} if channel == "Email" else {"mobile_no": ["is", "set"], "crm_wa_opt_in": 1}
	if before:
		f["creation"] = ["<", before]
	if status_in:
		f["status"] = ["in", status_in]
	if source_in:
		f["source"] = ["in", source_in]
	if industry:
		f["industry"] = industry
	rows = frappe.get_all(LEAD, filters=f, fields=["name", "lead_name", "first_name", "email", "mobile_no", "lead_owner", "creation"], order_by="name asc")
	if limit:
		rnd.shuffle(rows)
		rows = sorted(rows[:limit], key=lambda r: r.name)
	return rows


def norm_phone(p):
	return "".join(ch for ch in p if ch.isdigit())


def add_recipient(campaign, step_idx, channel, lead, status, template, **kw):
	from crm_addons.campaigns.common import dedupe_key

	doc = frappe.new_doc("CRM Campaign Recipient")
	doc.update(
		{
			"campaign": campaign, "step_idx": step_idx, "channel": channel, "status": status, "recipient_type": LEAD,
			"recipient_id": lead.name, "recipient_name": lead.lead_name or lead.first_name,
			"email": lead.email if channel == "Email" else None,
			"whatsapp_number": norm_phone(lead.mobile_no) if channel == "WhatsApp" else None,
			"template": template, "dedupe_key": dedupe_key(campaign, step_idx, channel, lead.name),
			"provider_status": kw.pop("provider_status", None),
		}
	)
	doc.update(kw)
	doc.flags.ignore_permissions = True
	doc.flags.ignore_links = True
	doc.insert()
	stamp = kw.get("sent_at") or kw.get("queued_at") or kw.get("failed_at") or kw.get("due_at")
	if stamp:
		frappe.db.set_value("CRM Campaign Recipient", doc.name, {"creation": kw.get("created_at") or stamp, "modified": stamp}, update_modified=False)
	return doc


def sent_times(n, start, span_hours, batches=4):
	"""n timestamps in `batches` clusters across span_hours (rate limited batches look like this in the daily chart)."""
	out = []
	for i in range(n):
		b = i % batches
		base = start + timedelta(hours=span_hours * b / max(batches - 1, 1))
		out.append(base + timedelta(seconds=rnd.randint(0, 3000)))
	rnd.shuffle(out)
	return sorted(out)


def email_outcome(open_p, click_p, fail_p, skip_p):
	r = rnd.random()
	if r < skip_p:
		return "skip"
	if r < skip_p + fail_p:
		return "fail"
	if rnd.random() < open_p:
		return "click" if rnd.random() < click_p / max(open_p, 0.01) else "open"
	return "sent"


def wa_outcome(read_p, deliver_p, fail_p, skip_p):
	r = rnd.random()
	if r < skip_p:
		return "skip"
	if r < skip_p + fail_p:
		return "fail"
	r = rnd.random()
	if r < read_p:
		return "read"
	if r < read_p + deliver_p:
		return "delivered"
	return "sent"


EMAIL_FAIL_REASONS = ["Bounced: mailbox does not exist (5.1.1)", "Bounced: recipient address rejected", "Rejected by the receiving server: mailbox full (4.2.2)"]
WA_FAIL_REASONS = ["131026: Message undeliverable (the number is not on WhatsApp)", "Meta reported the message as failed"]


def fill_email_rows(camp, step_idx, template, leads, start, span_hours, open_p, click_p, fail_p, skip_p, batches=4, now_limit=None):
	times = sent_times(len(leads), start, span_hours, batches)
	n = {"sent": 0}
	for lead, t in zip(leads, times):
		if now_limit and t > now_limit:
			add_recipient(camp, step_idx, "Email", lead, "Pending", template, due_at=t, created_at=start - timedelta(minutes=5))
			continue
		res = email_outcome(open_p, click_p, fail_p, skip_p)
		kw = {"created_at": start - timedelta(minutes=5)}
		if res == "skip":
			add_recipient(camp, step_idx, "Email", lead, "Skipped", template, skip_reason=rnd.choice(["Opted out", "Opted out", "Duplicate address in this campaign"]), created_at=start - timedelta(minutes=5), queued_at=start)
		elif res == "fail":
			add_recipient(camp, step_idx, "Email", lead, "Failed", template, failure_reason=rnd.choice(EMAIL_FAIL_REASONS), failed_at=t, queued_at=t - timedelta(seconds=20), provider_status="Bounced", **kw)
		else:
			extra = {}
			status = "Sent"
			if res in ("open", "click"):
				status = "Read"
				extra["read_at"] = t + timedelta(minutes=rnd.randint(2, 600))
			if res == "click":
				extra["clicked_at"] = extra["read_at"] + timedelta(minutes=rnd.randint(0, 6))
				extra["click_count"] = rnd.choice([1, 1, 1, 2, 3])
			add_recipient(camp, step_idx, "Email", lead, status, template, sent_at=t, queued_at=t - timedelta(seconds=20), started_at=t - timedelta(seconds=10), provider_status="Sent", **extra, **kw)


def fill_wa_rows(camp, step_idx, template, leads, start, span_hours, read_p, deliver_p, fail_p, skip_p, batches=4, now_limit=None):
	times = sent_times(len(leads), start, span_hours, batches)
	for lead, t in zip(leads, times):
		if now_limit and t > now_limit:
			add_recipient(camp, step_idx, "WhatsApp", lead, rnd.choice(["Pending", "Pending", "Queued"]), template, due_at=t, created_at=start - timedelta(minutes=5))
			continue
		res = wa_outcome(read_p, deliver_p, fail_p, skip_p)
		kw = {"created_at": start - timedelta(minutes=5)}
		if res == "skip":
			add_recipient(camp, step_idx, "WhatsApp", lead, "Skipped", template, skip_reason=rnd.choice(["Opted out", "Not opted in to WhatsApp", "Opted out"]), queued_at=start, **kw)
		elif res == "fail":
			add_recipient(camp, step_idx, "WhatsApp", lead, "Failed", template, failure_reason=rnd.choice(WA_FAIL_REASONS), failed_at=t, queued_at=t - timedelta(seconds=15), **kw)
		else:
			extra = {"sent_at": t}
			status = "Sent"
			if res in ("delivered", "read"):
				status = "Delivered"
				extra["delivered_at"] = t + timedelta(seconds=rnd.randint(3, 90))
			if res == "read":
				status = "Read"
				extra["read_at"] = extra["delivered_at"] + timedelta(minutes=rnd.randint(1, 900))
			add_recipient(camp, step_idx, "WhatsApp", lead, status, template, queued_at=t - timedelta(seconds=15), started_at=t - timedelta(seconds=8), provider_status=status.lower(), provider_message_id="wamid.SHOWCASE%08d" % rnd.randint(1, 10**8), **extra, **kw)


def new_campaign(name, ctype, steps, status, created, started=None, completed=None, scheduled=None, filters=None, owner=MARKETER, saved_view=None, stop_on_reply=0, window=False, track_clicks=0, description="", consent=1):
	frappe.set_user(owner)
	doc = frappe.new_doc("CRM Campaign")
	doc.update(
		{
			"campaign_name": name, "campaign_type": ctype, "campaign_owner": owner, "description": description,
			"audience_mode": "Saved Segment" if saved_view else "CRM Filters",
			"audience_filters": json.dumps(filters or []), "saved_view": saved_view,
			"send_mode": "Schedule" if scheduled else "Send Now", "scheduled_at": scheduled, "timezone": "Asia/Kolkata",
			"stop_on_reply": stop_on_reply, "track_clicks": track_clicks, "consent_confirmed": consent,
			"window_enabled": 1 if window else 0, "window_start": "09:00:00" if window else None, "window_end": "19:00:00" if window else None,
			"window_weekdays_only": 1 if window else 0,
		}
	)
	for st in steps:
		doc.append("steps", st)
	doc.flags.ignore_permissions = True
	doc.insert()
	frappe.set_user("Administrator")
	vals = {"status": status, "creation": created, "modified": completed or started or created}
	if started:
		vals["started_at"] = started
	if completed:
		vals["completed_at"] = completed
	frappe.db.set_value("CRM Campaign", doc.name, vals, update_modified=False)
	return doc.name


def email_step(template, day=0, condition=""):
	return {"channel": "Email", "day_offset": day, "email_template": template, "condition": condition}


def wa_step(template, mapping, day=0, condition=""):
	return {"channel": "WhatsApp", "day_offset": day, "wa_template": template, "variable_map": json.dumps(mapping), "condition": condition}


def make_campaigns(): 
	frappe.flags.in_import = True
	T_WELCOME, T_OPEN, T_SCHOL = "Welcome to Acme Learning", "Open House Invitation", "Spring Admissions Offer"
	for t in (T_WELCOME, T_OPEN, T_SCHOL):
		if not frappe.db.exists("CRM Campaign Email Template", t):
			sys.exit("Create the three email templates first: node capture.js templates")
	wa = lambda n: n + "-en"

	# 1. completed email campaign, 24 days ago
	start = when(24, 10, 0)
	c = new_campaign("Spring Admissions 2026", "Marketing", [email_step(T_SCHOL)], "Completed", when(26, 16), start, start + timedelta(hours=5, minutes=40),
		filters=[["status", "in", ["New", "Contacted", "Nurture"]]], track_clicks=1, description="Announce the spring batch to every open lead.")
	leads = eligible("Email", before=start, status_in=None)
	fill_email_rows(c, 0, T_SCHOL, leads, start, 5, 0.58, 0.21, 0.05, 0.06)
	frappe.db.set_value("CRM Campaign", c, "total_recipients", len(leads), update_modified=False)
	log("campaign", c, len(leads))
	first_email_campaign = c

	# 2. completed WhatsApp campaign, 16 days ago
	start = when(16, 11, 0)
	leads = eligible("WhatsApp", before=start)
	c = new_campaign("Webinar Invite: Career Paths", "Announcement", [wa_step(wa("demo_class_invite"), {"1": "{{ first_name }}", "2": "12"})], "Completed", when(18, 15), start, start + timedelta(hours=3, minutes=10),
		filters=[["source", "in", ["Webinar", "Referral", "Website", "LinkedIn"]]], description="Free demo class for warm leads.")
	fill_wa_rows(c, 0, wa("demo_class_invite"), leads, start, 3, 0.52, 0.30, 0.04, 0.05, batches=3)
	frappe.db.set_value("CRM Campaign", c, "total_recipients", len(leads), update_modified=False)
	log("campaign", c, len(leads))
	webinar = c

	# 3. completed email campaign, 9 days ago, a smaller one
	start = when(9, 9, 30)
	leads = eligible("Email", before=start, status_in=["Qualified", "Nurture", "Contacted"])
	c = new_campaign("Scholarship Test Announcement", "Announcement", [email_step(T_OPEN)], "Completed", when(10, 17), start, start + timedelta(hours=2, minutes=20),
		filters=[["status", "in", ["Qualified", "Nurture", "Contacted"]]], track_clicks=1)
	fill_email_rows(c, 0, T_OPEN, leads, start, 2, 0.64, 0.27, 0.03, 0.04, batches=3)
	frappe.db.set_value("CRM Campaign", c, "total_recipients", len(leads), update_modified=False)
	log("campaign", c, len(leads))
	scholarship = c

	# 4. RUNNING WhatsApp campaign started this morning (some rows still waiting)
	start = NOW - timedelta(hours=3, minutes=20)
	leads = eligible("WhatsApp")
	c = new_campaign("Open House Reminder", "Reminder", [wa_step(wa("open_house_reminder"), {"1": "{{ first_name }}"})], "Running", when(1, 17), start, None,
		filters=[["status", "in", ["New", "Contacted", "Qualified", "Nurture"]]], window=True, description="Saturday open house reminder, sent in working hours only.")
	fill_wa_rows(c, 0, wa("open_house_reminder"), leads, start, 5, 0.46, 0.30, 0.03, 0.05, batches=5, now_limit=NOW - timedelta(minutes=4))
	frappe.db.set_value("CRM Campaign", c, "total_recipients", len(leads), update_modified=False)
	log("campaign", c, len(leads))
	running = c

	# 5. RUNNING multi-channel journey, started 4 days ago: day 0 email, day 2 WhatsApp if not opened, day 5 email
	start = when(4, 10, 0)
	leads = eligible("Email", before=start, status_in=["New", "Contacted"])
	steps = [
		email_step(T_WELCOME, 0),
		wa_step(wa("welcome_message"), {"1": "{{ first_name }}", "2": "{{ owner_name }}"}, 2, "Previous step was not read or opened"),
		email_step(T_OPEN, 5),
	]
	c = new_campaign("Welcome Journey", "Follow-up", steps, "Running", when(5, 12), start, None, filters=[["status", "in", ["New", "Contacted"]]], stop_on_reply=1, track_clicks=1,
		description="Day 0 email, day 2 WhatsApp if the email was not opened, day 5 invitation.")
	fill_email_rows(c, 0, T_WELCOME, leads, start, 2, 0.61, 0.24, 0.04, 0.04, batches=2)
	# step 1 (day 2): WhatsApp only for those who did not open the email; the others are skipped by the condition
	rows = frappe.get_all("CRM Campaign Recipient", filters={"campaign": c, "step_idx": 0, "status": ["in", ["Sent", "Read"]]}, fields=["recipient_id", "status"])
	by_lead = {l.name: l for l in leads}
	day2 = when(2, 10, 0)
	opted = []
	for r in rows:
		lead = by_lead[r.recipient_id]
		if r.status == "Read":
			add_recipient(c, 1, "WhatsApp", lead, "Skipped", wa("welcome_message"), skip_reason="Condition not met: previous step was not read or opened was false for this lead", queued_at=day2, created_at=start)
		elif lead.mobile_no and frappe.db.get_value(LEAD, lead.name, "crm_wa_opt_in"):
			opted.append((lead, r))
	times = sent_times(len(opted), day2, 1, 2)
	for (lead, r), t in zip(opted, times):
		res = wa_outcome(0.5, 0.35, 0.04, 0)
		if res == "fail":
			add_recipient(c, 1, "WhatsApp", lead, "Failed", wa("welcome_message"), failure_reason=WA_FAIL_REASONS[0], failed_at=t, queued_at=t, created_at=start)
		else:
			st = {"sent": "Sent", "delivered": "Delivered", "read": "Read"}[res]
			extra = {"sent_at": t}
			if st != "Sent":
				extra["delivered_at"] = t + timedelta(seconds=30)
			if st == "Read":
				extra["read_at"] = t + timedelta(minutes=rnd.randint(2, 500))
			add_recipient(c, 1, "WhatsApp", lead, st, wa("welcome_message"), queued_at=t, provider_status=st.lower(), provider_message_id="wamid.SHOWCASE%08d" % rnd.randint(1, 10**8), created_at=start, **extra)
	# step 2 (day 5): waiting for its day
	due = when(-1, 10, 0)
	for lead in leads:
		add_recipient(c, 2, "Email", lead, "Pending", T_OPEN, due_at=due, created_at=start)
	frappe.db.set_value("CRM Campaign", c, "total_recipients", len(leads) * 2 + len(opted), update_modified=False)
	log("campaign", c, len(leads))
	journey = c

	# 6. SCHEDULED campaign for tomorrow
	tomorrow = TODAY + timedelta(days=1, hours=10)
	c = new_campaign("Scholarship Test: Final Call", "Announcement",
		[email_step(T_SCHOL, 0), wa_step(wa("scholarship_test_2026"), {"1": "{{ first_name }}"}, 1, "Previous step was not read or opened")], "Scheduled", when(0, 9), None, None,
		scheduled=tomorrow, filters=[["status", "in", ["New", "Contacted", "Nurture", "Qualified"]]], stop_on_reply=1, description="Last reminder before registrations close.")
	log("campaign", c)

	# 7. A DRAFT
	c = new_campaign("Summer Camp Early Bird", "Marketing", [email_step(T_OPEN), wa_step(wa("admission_open_2026"), {"1": "{{ first_name }}", "2": "Summer Camp"}, 2, "Previous step was not read or opened")], "Draft", when(0, 8), None, None,
		filters=[["industry", "in", ["School", "College"]], ["status", "in", ["New", "Contacted", "Nurture"]]], description="Early-bird offer for the summer camp.")
	log("campaign", c)
	commit()
	return {"spring": first_email_campaign, "webinar": webinar, "scholarship": scholarship, "running": running, "journey": journey}


def topup_completed():
	"""Add the leads that became eligible for the early campaigns after retime_leads() (additive, run once after `orgs`)."""
	spec = [
		("Spring Admissions 2026", "Email", "Spring Admissions Offer", dict(open_p=0.58, click_p=0.21, fail_p=0.05, skip_p=0.06), 5, 4),
		("Webinar Invite: Career Paths", "WhatsApp", "demo_class_invite-en", dict(read_p=0.52, deliver_p=0.30, fail_p=0.04, skip_p=0.05), 3, 3),
		("Scholarship Test Announcement", "Email", "Open House Invitation", dict(open_p=0.64, click_p=0.27, fail_p=0.03, skip_p=0.04), 2, 3),
	]
	for name, channel, tpl, p, span, batches in spec:
		camp = frappe.db.get_value("CRM Campaign", {"campaign_name": name}, "name")
		start = frappe.db.get_value("CRM Campaign", camp, "started_at")
		have = set(frappe.get_all("CRM Campaign Recipient", filters={"campaign": camp}, pluck="recipient_id"))
		kw = {}
		if name.startswith("Scholarship"):
			kw["status_in"] = ["Qualified", "Nurture", "Contacted"]
		leads = [l for l in eligible(channel, before=start, **kw) if l.name not in have]
		if channel == "Email":
			fill_email_rows(camp, 0, tpl, leads, start, span, batches=batches, **p)
		else:
			fill_wa_rows(camp, 0, tpl, leads, start, span, batches=batches, **p)
		total = frappe.db.count("CRM Campaign Recipient", {"campaign": camp})
		frappe.db.set_value("CRM Campaign", camp, "total_recipients", total, update_modified=False)
		log("topup", name, "+", len(leads), "=", total)
	commit()


def make_replies(camps):
	"""A few leads wrote back after a campaign: an incoming WhatsApp message or a received email (these feed the Replied numbers)."""
	count = 0
	for key, channel, n in (("webinar", "WhatsApp", 6), ("running", "WhatsApp", 4), ("spring", "Email", 5), ("scholarship", "Email", 3), ("journey", "Email", 3)):
		camp = camps[key]
		started = frappe.db.get_value("CRM Campaign", camp, "started_at")
		rows = frappe.get_all("CRM Campaign Recipient", filters={"campaign": camp, "channel": channel, "status": ["in", ["Sent", "Delivered", "Read"]], "sent_at": ["is", "set"]}, fields=["recipient_id", "sent_at", "email", "whatsapp_number"], limit=200)
		rnd.shuffle(rows)
		for r in rows[:n]:
			at = r.sent_at + timedelta(minutes=rnd.randint(8, 900))
			if at > NOW:
				at = NOW - timedelta(minutes=10)
			if channel == "WhatsApp":
				m = frappe.new_doc("WhatsApp Message")
				m.update({"type": "Incoming", "from": r.whatsapp_number, "message": rnd.choice(["Yes please, call me tomorrow", "Can I get the fee structure?", "Interested, what are the timings?", "Thanks, send details"]), "message_type": "Manual", "content_type": "text", "reference_doctype": LEAD, "reference_name": r.recipient_id, "status": "received"})
				m.set_new_name(); m.set_user_and_timestamp(); m.db_insert()
				frappe.db.set_value("WhatsApp Message", m.name, {"creation": at, "modified": at}, update_modified=False)
			else:
				c = frappe.new_doc("Communication")
				c.update({"communication_type": "Communication", "communication_medium": "Email", "sent_or_received": "Received", "sender": r.email, "recipients": "admissions@acme-learning.example.com", "subject": "Re: " + rnd.choice(["Spring admissions", "Open house", "Scholarship test"]), "content": "<p>Thanks, please send the details.</p>", "reference_doctype": LEAD, "reference_name": r.recipient_id, "status": "Open"})
				c.flags.ignore_permissions = True
				c.insert()
				frappe.db.set_value("Communication", c.name, {"creation": at, "modified": at}, update_modified=False)
			count += 1
	commit()
	log("replies", count)


def make_opt_outs():
	from crm_addons.campaigns import optout

	rows = frappe.get_all(LEAD, fields=["name", "email", "mobile_no"], order_by="name desc", limit=14)
	for i, r in enumerate(rows):
		if i < 4:
			optout.add_opt_out("Email", r.email, source="Unsubscribe Link", lead=r.name)
		elif i < 7:
			optout.add_opt_out("WhatsApp", norm_phone(r.mobile_no), source="WhatsApp Reply", reason="Replied STOP", lead=r.name)
		elif i < 10:
			optout.add_opt_out("Email", r.email, source="Bounce", reason="The address failed permanently: Bounced: mailbox does not exist (5.1.1)", lead=r.name)
		elif i < 12:
			optout.add_opt_out("WhatsApp", norm_phone(r.mobile_no), source="Invalid Number", reason="The address failed permanently: 131026 not on WhatsApp", lead=r.name)
	commit()
	log("opt-outs")


def make_automations():
	frappe.set_user(MANAGER)
	from crm_addons.campaigns import automation

	wa = lambda n: n + "-en"
	specs = [
		{"automation_name": "Welcome new website leads", "description": "Send the welcome email the moment a website lead arrives.", "trigger_event": "Lead created", "audience_mode": "CRM Filters",
		 "audience_filters": [["source", "=", "Website"]], "enabled": 1,
		 "actions": [{"action": "Send messages"}, {"action": "Add a note to the lead", "value": "Welcome email sent automatically."}],
		 "steps": [email_step("Welcome to Acme Learning", 0)]},
		{"automation_name": "Reply received: book a follow-up", "description": "When a lead writes back, make sure someone calls within a day.", "trigger_event": "Lead replied", "audience_mode": "CRM Filters",
		 "audience_filters": [["status", "in", ["New", "Contacted", "Nurture"]]], "enabled": 1,
		 "actions": [{"action": "Set lead status", "value": "Contacted"}, {"action": "Create a follow-up", "value": "1"}]},
		{"automation_name": "Clicked the offer: nudge on WhatsApp", "description": "Leads who click a link get a WhatsApp message the same day.", "trigger_event": "Lead clicked a link", "audience_mode": "CRM Filters",
		 "audience_filters": [["status", "!=", "Junk"]], "enabled": 0,
		 "actions": [{"action": "Send messages"}], "steps": [wa_step(wa("admission_open_2026"), {"1": "{{ first_name }}", "2": "Spring 2026"}, 0)]},
		{"automation_name": "Opted out: note it on the lead", "description": "Keep the sales team informed when someone unsubscribes.", "trigger_event": "Lead opted out", "audience_mode": "CRM Filters",
		 "audience_filters": [["status", "!=", "Junk"]], "enabled": 1,
		 "actions": [{"action": "Add a note to the lead", "value": "Asked not to be contacted by campaigns."}]},
	]
	for spec in specs:
		try:
			automation.save_automation(json.dumps(spec))
		except Exception as e:
			log("automation failed:", spec["automation_name"], e)
	frappe.set_user("Administrator")
	commit()
	log("automations")


def make_deals(camps):
	"""A few deals so the cost and ROI cards have something to show (created from leads a campaign reached)."""
	if not frappe.db.exists("DocType", "CRM Deal"):
		return
	won = frappe.db.get_value("CRM Deal Status", {"type": "Won"}, "name")
	if not won:
		return
	made = 0
	for key, n in (("spring", 3), ("scholarship", 2), ("webinar", 2)):
		camp = camps[key]
		started = frappe.db.get_value("CRM Campaign", camp, "started_at")
		rows = frappe.get_all("CRM Campaign Recipient", filters={"campaign": camp, "status": ["in", ["Read", "Delivered"]]}, fields=["recipient_id"], limit=40)
		rnd.shuffle(rows)
		for r in rows[:n]:
			lead = frappe.get_doc(LEAD, r.recipient_id)
			try:
				d = frappe.new_doc("CRM Deal")
				d.update({"lead": lead.name, "organization": lead.organization, "status": won, "deal_owner": lead.lead_owner or SALES[0], "deal_value": rnd.choice([45000, 60000, 85000, 120000]), "email": lead.email, "mobile_no": lead.mobile_no})
				d.flags.ignore_permissions = True
				d.flags.ignore_mandatory = True
				d.insert()
				at = started + timedelta(days=rnd.randint(2, 6))
				frappe.db.set_value("CRM Deal", d.name, {"creation": min(at, NOW), "modified": min(at, NOW)}, update_modified=False)
				made += 1
			except Exception as e:
				log("deal skipped:", str(e)[:120])
	commit()
	log("deals", made)


# --------------------------------------------------------------------------------------- assignment and runs


def fix_draft():
	"""(Only needed on a site seeded before the draft had two channels.) Give the draft both channels and a real audience."""
	name = frappe.db.get_value("CRM Campaign", {"campaign_name": "Summer Camp Early Bird"}, "name")
	doc = frappe.get_doc("CRM Campaign", name)
	if len(doc.steps) < 2:
		doc.append("steps", wa_step("admission_open_2026-en", {"1": "{{ first_name }}", "2": "Summer Camp"}, 2, "Previous step was not read or opened"))
	doc.audience_filters = json.dumps([["industry", "in", ["School", "College"]], ["status", "in", ["New", "Contacted", "Nurture"]]])
	doc.description = "Early-bird offer for the summer camp."
	frappe.set_user(MARKETER)
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.set_user("Administrator")
	commit()


def make_assignment():
	"""Rules, a few new leads that the rules place (they show in History), and one rule run for leads without an owner."""
	from crm_addons import assignment

	frappe.set_user(MANAGER)
	rules = [
		({"rule_name": "Website enquiries", "description": "Every enquiry from the website goes to the inbound team, taking turns.", "match_mode": "All conditions", "distribution": "Round robin",
		  "conditions": [["source", "=", "Website"]], "assignees": [SALES[0], SALES[1]], "enabled": 1, "priority": 1}),
		({"rule_name": "Colleges and universities", "description": "Higher-education leads go to whoever has the lightest workload.", "match_mode": "All conditions", "distribution": "Least workload",
		  "conditions": [["industry", "in", ["College", "University"]]], "assignees": [SALES[2], SALES[3]], "enabled": 1, "priority": 2}),
		({"rule_name": "EdTech partnerships", "description": "Partnership leads are worked together by the manager and the senior rep.", "match_mode": "All conditions", "distribution": "All of them",
		  "conditions": [["industry", "=", "EdTech"]], "assignees": [MANAGER, SALES[3]], "enabled": 1, "priority": 3}),
		({"rule_name": "Paid ads (paused)", "description": "Facebook and Google ads leads, switched off during the holiday.", "match_mode": "Any condition", "distribution": "Round robin",
		  "conditions": [["source", "=", "Facebook Ads"], ["source", "=", "Google Ads"]], "assignees": [SALES[2], SALES[3]], "enabled": 0, "priority": 4}),
	]
	for r in rules:
		res = assignment.save_rule(json.dumps(r), confirm=1)
		log("rule", r["rule_name"], res.get("saved"))
	frappe.set_user("Administrator")

	# new leads placed by the rules (History shows them as "new lead"); automations are switched off while they arrive
	frappe.db.sql("update `tabCRM Campaign Automation` set enabled = 0")
	frappe.flags.in_import = False
	fresh = [("Yara", "Hassan", "Website", "School", "Pinecrest Academy"), ("Mateo", "Ruiz", "Website", "College", "Redwood Polytechnic"), ("Ines", "Barros", "Website", "EdTech", "Juniper Skills Hub"),
		("Kiran", "Rao", "Website", "School", "Kestrel Hill School"), ("Lena", "Hartmann", "LinkedIn", "University", "Willowbrook University")]
	for i, (first, last, source, industry, org) in enumerate(fresh):
		doc = frappe.get_doc({"doctype": "CRM Lead", "first_name": first, "last_name": last, "status": "New", "email": f"{first}.{last}@example.com".lower(), "mobile_no": "+91 99999 %05d" % (20100 + i * 11),
			"organization": org, "job_title": "Admissions Head", "source": source, "industry": industry})
		doc.flags.ignore_permissions = True
		doc.insert()
		at = NOW - timedelta(hours=2 + i * 5)
		frappe.db.set_value("CRM Lead", doc.name, {"creation": at, "modified": at}, update_modified=False)
		frappe.db.sql("update `tabCRM Assignment Log` set creation=%s, modified=%s where lead=%s", (at, at, doc.name))
		frappe.db.set_value("CRM Lead", doc.name, "crm_wa_opt_in", 1, update_modified=False)
	frappe.db.sql("update `tabCRM Campaign Automation` set enabled = 1 where automation_name != 'Clicked the offer: nudge on WhatsApp'")
	commit()

	frappe.set_user(MANAGER)
	rid = frappe.db.get_value("CRM Assignment Rule", {"rule_name": "Colleges and universities"}, "name")
	res = assignment.run_rule(rid, scope="unassigned", confirm=1)
	log("rule run", res)
	frappe.set_user("Administrator")
	commit()
	# keep History looking like a week of work
	frappe.db.sql("update `tabCRM Assignment Log` set creation = date_sub(creation, interval 3 hour) where source != 'New lead' and creation > date_sub(now(), interval 1 hour)")
	commit()


def make_automation_runs():
	"""Runs per automation (one per lead), plus the messages the 'welcome' automation sent through its managed campaign."""
	auts = {a.automation_name: a for a in frappe.get_all("CRM Campaign Automation", fields=["name", "automation_name", "campaign", "trigger_event"])}
	website = frappe.get_all(LEAD, filters={"source": "Website"}, fields=["name", "lead_name", "first_name", "email", "mobile_no", "creation"], order_by="creation desc", limit=14)
	plan = [("Welcome new website leads", website, "Lead created"), ("Reply received: book a follow-up", frappe.get_all(LEAD, fields=["name"], order_by="modified desc", limit=7), "Lead replied"),
		("Opted out: note it on the lead", frappe.get_all(LEAD, fields=["name"], order_by="name desc", limit=3), "Lead opted out")]
	n = 0
	for name, leads, event in plan:
		a = auts.get(name)
		if not a:
			continue
		for k, lead in enumerate(leads):
			run = frappe.new_doc("CRM Automation Run")
			run.update({"automation": a.name, "lead": lead["name"] if isinstance(lead, dict) else lead.name, "event": event, "run_key": f"{a.name}|{lead['name'] if isinstance(lead, dict) else lead.name}"})
			run.flags.ignore_permissions = True
			run.insert()
			at = NOW - timedelta(days=rnd.choice([0, 1, 1, 2, 3, 4, 5, 6]), hours=rnd.randint(0, 20))
			frappe.db.set_value("CRM Automation Run", run.name, {"creation": at, "modified": at}, update_modified=False)
			n += 1
	a = auts.get("Welcome new website leads")
	if a and a.campaign:
		c = frappe.db.get_value("CRM Campaign", a.campaign, ["name", "status"], as_dict=True)
		tpl = "Welcome to Acme Learning"
		for lead in website[:12]:
			t = lead.creation + timedelta(minutes=rnd.randint(1, 4))
			if t > NOW:
				t = NOW - timedelta(minutes=5)
			res = rnd.random()
			if res < 0.55:
				add_recipient(c.name, 0, "Email", frappe._dict(lead), "Read", tpl, sent_at=t, queued_at=t, read_at=t + timedelta(minutes=rnd.randint(3, 400)), provider_status="Sent", created_at=t)
			else:
				add_recipient(c.name, 0, "Email", frappe._dict(lead), "Sent", tpl, sent_at=t, queued_at=t, provider_status="Sent", created_at=t)
	commit()
	log("automation runs", n)


def spread_days():
	"""Real sends are rate limited and cross days: move part of each completed campaign to the next one or two days."""
	cols = ["queued_at", "started_at", "sent_at", "delivered_at", "read_at", "clicked_at", "failed_at", "due_at"]
	for name, shifts in (("Spring Admissions 2026", (0.45, 0.2)), ("Webinar Invite: Career Paths", (0.35, 0.15)), ("Scholarship Test Announcement", (0.4, 0.0))):
		camp = frappe.db.get_value("CRM Campaign", {"campaign_name": name}, "name")
		rows = frappe.get_all("CRM Campaign Recipient", filters={"campaign": camp}, pluck="name")
		last = 0
		for r in rows:
			x = rnd.random()
			days = 1 if x < shifts[0] else 2 if x < shifts[0] + shifts[1] else 0
			if not days:
				continue
			last = max(last, days)
			sets = ", ".join(f"`{c}` = date_add(`{c}`, interval {days} day)" for c in cols)
			frappe.db.sql(f"update `tabCRM Campaign Recipient` set {sets} where name = %s", r)
		if last:
			frappe.db.sql("update `tabCRM Campaign` set completed_at = date_add(completed_at, interval %s day), modified = date_add(modified, interval %s day) where name = %s", (last, last, camp))
	commit()
	log("spread over days")


# --------------------------------------------------------------------------------------------------- main


def main(stage):
	if stage == "base":
		make_users()
		make_taxonomy()
		leads = make_leads()
		set_lead_statuses(leads)
		make_follow_ups(leads)
		refresh_lead_fields(leads)
		make_meetings(leads)
		log("base done: next  seed_showcase.py infra")
	elif stage == "infra":
		urls = upload_assets()
		make_infra()
		make_wa_templates(urls)
		make_segments()
		log("infra done: now run  node capture.js templates  and then  seed_showcase.py campaigns")
	elif stage == "orgs":
		make_orgs()
		retime_leads()
	elif stage == "draft":
		fix_draft()
	elif stage == "assign":
		make_assignment()
	elif stage == "autoruns":
		make_automation_runs()
	elif stage == "spread":
		spread_days()
	elif stage == "topup":
		topup_completed()
	elif stage == "deals":
		make_deals({"spring": frappe.db.get_value("CRM Campaign", {"campaign_name": "Spring Admissions 2026"}, "name"), "scholarship": frappe.db.get_value("CRM Campaign", {"campaign_name": "Scholarship Test Announcement"}, "name"), "webinar": frappe.db.get_value("CRM Campaign", {"campaign_name": "Webinar Invite: Career Paths"}, "name")})
	elif stage == "campaigns":
		camps = make_campaigns()
		make_replies(camps)
		make_opt_outs()
		make_deals(camps)
		make_automations()
		log("campaigns done")
	else:
		sys.exit("usage: seed_showcase.py base | infra | campaigns (in that order, with `node capture.js templates` before campaigns)")


if __name__ == "__main__":
	main(sys.argv[1] if len(sys.argv) > 1 else "")
