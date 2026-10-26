"""Ready-made email templates for the campaign library (and so for CRM's own Email Template list).

Each one is a Visual Builder template: ``blocks`` is what the builder edits, and ``html`` renders the same blocks the way
public/campaigns/js/email-blocks.js does (a template saved from the builder is re-rendered by the browser, so the two only
have to agree closely). They use only variables every lead has, are seeded once per release, and then belong to the admin.
"""

import json
import zlib
from html import escape

VERSION = "1.5.0"  # bump to seed templates added in a later release
ARIAL = "Arial, Helvetica, sans-serif"
BLUE, INK, GREY = "#2563eb", "#14161a", "#3b4252"
SETTINGS = {"bg": "#f4f5f7", "contentBg": "#ffffff", "width": 600, "font": "Arial"}


def _b(kind, **props):
	return {"type": kind, "props": props}


def banner(title, subtitle, button="", url="https://", bg=BLUE):
	return _b("banner", title=title, subtitle=subtitle, bg=bg, color="#ffffff", button=button, url=url, align="center")


def heading(text, level="h2", align="left"):
	return _b("heading", text=text, level=level, align=align, color=INK, font="", fontSize=0, bold=True, italic=False, underline=False, link="")


def text(html, align="left"):
	return _b("text", html=html, align=align, color=GREY, size=15, font="")


def button(label, url="https://", bg=BLUE):
	return _b("button", label=label, url=url, bg=bg, color="#ffffff", radius=8, align="center", full=False)


def divider():
	return _b("divider", color="#e3e6eb", thickness=1, space=12)


def footer(line):
	return _b("footer", text=line + "\nYou are receiving this email because you enquired with us.", align="center", color="#8b93a1")


def row(*columns, divider_line=False):
	cols = [{"blocks": list(c)} for c in columns]
	cols += [{"blocks": []} for _ in range(6 - len(cols))]
	return _b("row", count=len(columns), divider=divider_line, dividerColor="#e3e6eb", valign="top", cols=cols)


# -- the same rendering as email-blocks.js ----------------------------------------------------------------


def _narrow(html):
	import re

	return re.sub(r"padding:(\d+)px 32px", r"padding:\1px 10px", html)


def _lines(t):
	return escape(t or "").replace("\r\n", "\n").replace("\n", "<br>")


def _render(block, narrow=False):
	k, p = block["type"], block["props"]
	if k == "banner":
		btn = (
			f'<table role="presentation" cellpadding="0" cellspacing="0" align="{p["align"]}" style="margin-top:18px"><tr><td align="center" bgcolor="{p["color"]}" '
			f'style="background-color:{p["color"]};border-radius:8px"><a href="{escape(p["url"])}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;'
			f'font-weight:700;color:{p["bg"]};text-decoration:none">{escape(p["button"])}</a></td></tr></table>'
			if p["button"]
			else ""
		)
		out = (
			f'<tr><td align="{p["align"]}" bgcolor="{p["bg"]}" style="background-color:{p["bg"]};padding:36px 32px;font-family:{ARIAL};text-align:{p["align"]};color:{p["color"]}">'
			f'<div style="font-size:26px;line-height:1.25;font-weight:700;margin:0 0 8px">{escape(p["title"])}</div>'
			f'<div style="font-size:15px;line-height:1.55;opacity:.92">{_lines(p["subtitle"])}</div>{btn}</td></tr>'
		)
	elif k == "heading":
		size = {"h1": 28, "h2": 22, "h3": 18}[p["level"]]
		out = (
			f'<tr><td align="{p["align"]}" style="padding:12px 32px 4px;font-family:{ARIAL};font-size:{size}px;line-height:1.3;font-weight:700;font-style:normal;'
			f'text-decoration:none;color:{p["color"]};text-align:{p["align"]}">{escape(p["text"])}</td></tr>'
		)
	elif k == "text":
		out = f'<tr><td align="{p["align"]}" style="padding:8px 32px;font-family:{ARIAL};font-size:{p["size"]}px;line-height:1.65;color:{p["color"]};text-align:{p["align"]}">{p["html"]}</td></tr>'
	elif k == "button":
		out = (
			f'<tr><td align="{p["align"]}" style="padding:14px 32px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>'
			f'<td align="center" bgcolor="{p["bg"]}" style="background-color:{p["bg"]};border-radius:{p["radius"]}px"><a href="{escape(p["url"])}" target="_blank" '
			f'style="display:inline-block;padding:13px 28px;font-family:{ARIAL};font-size:15px;font-weight:700;line-height:1.2;color:{p["color"]};text-decoration:none;'
			f'border-radius:{p["radius"]}px">{escape(p["label"])}</a></td></tr></table></td></tr>'
		)
	elif k == "divider":
		out = (
			f'<tr><td style="padding:{p["space"]}px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="{p["thickness"]}" '
			f'style="height:{p["thickness"]}px;line-height:{p["thickness"]}px;font-size:0;background-color:{p["color"]}">&nbsp;</td></tr></table></td></tr>'
		)
	elif k == "footer":
		out = (
			f'<tr><td align="{p["align"]}" style="padding:18px 32px 24px;font-family:{ARIAL};font-size:12px;line-height:1.6;color:{p["color"]};text-align:{p["align"]};'
			f'border-top:1px solid #eceff3">{_lines(p["text"])}</td></tr>'
		)
	elif k == "row":
		n = p["count"]
		w = f"{100 / n:.2f}"
		cells = ""
		for i in range(n):
			inner = "".join(_render(b, True) for b in p["cols"][i]["blocks"]) or '<tr><td style="font-size:0;line-height:0">&nbsp;</td></tr>'
			line = f'border-left:1px solid {p["dividerColor"]};' if p["divider"] and i else ""
			cells += (
				f'<td class="cm-col" width="{w}%" valign="top" style="width:{w}%;vertical-align:top;{line}"><table role="presentation" width="100%" cellpadding="0" '
				f'cellspacing="0">{inner}</table></td>'
			)
		out = (
			'<tr><td style="padding:8px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cm-row" style="table-layout:fixed"><tr>'
			f"{cells}</tr></table><style>@media only screen and (max-width:480px){{.cm-col{{display:block!important;width:100%!important;border-left:0!important}}}}</style></td></tr>"
		)
	else:
		out = ""
	return _narrow(out) if narrow else out


def render(blocks, settings=SETTINGS):
	rows = "".join(_render(b) for b in blocks)
	return (
		f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background-color:{settings["bg"]}"><tr><td align="center" '
		f'style="padding:24px 12px"><table role="presentation" width="{settings["width"]}" cellpadding="0" cellspacing="0" style="width:100%;max-width:{settings["width"]}px;'
		f'background-color:{settings["contentBg"]};border-radius:10px;overflow:hidden">{rows}</table></td></tr></table>'
	)


def _benefit(title, body):
	return [heading(title, "h3"), text(f"<p>{body}</p>")]


# -- the templates ----------------------------------------------------------------------------------------


def _templates():
	hi = "<p>Hi {{ first_name }},</p>"
	sign = "<p>Regards,<br>{{ sender_name }}</p>"
	return [
		(
			"Welcome - thanks for your enquiry", "Welcome, {{ first_name }}! Here is what happens next", "Welcome",
			"A friendly first reply to a new lead, with the next steps.",
			[
				banner("Welcome, {{ first_name }}", "Thank you for getting in touch with us.", "Talk to our team", "https://"),
				text(hi + "<p>We have received your enquiry and {{ owner_name }} will be your point of contact. Here is what happens next:</p>"),
				row(
					_benefit("1. We call you", "A short call to understand what you are looking for."),
					_benefit("2. We share options", "Programmes, fees and dates that fit you."),
					_benefit("3. You decide", "No pressure. Ask us anything, any time."),
					divider_line=True,
				),
				text(sign),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Follow-up after a call", "Great speaking with you, {{ first_name }}", "Follow-up",
			"A short note after a phone conversation.",
			[
				heading("Great speaking with you", "h1"),
				text(hi + "<p>Thank you for taking the time to talk with me today. As promised, here is a quick summary and what to do next.</p><ul><li>We discussed your goals and the options that suit you.</li><li>I will send the details you asked for.</li><li>Reply to this email with any questions.</li></ul>"),
				button("Book a time to talk again", "https://"),
				text(sign),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Missed you - we tried to call", "We tried to reach you, {{ first_name }}", "Follow-up",
			"Sent after a call that was not picked up.",
			[
				heading("Sorry we missed you"),
				text(hi + "<p>We tried to call you about your enquiry but could not get through. Tell us a time that suits you and we will call back, or just reply to this email.</p>"),
				button("Choose a time", "https://"),
				text(sign),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Admissions open - promotion", "Admissions are open, {{ first_name }}", "Promotion",
			"A promotion with three reasons to apply.",
			[
				banner("Admissions are open", "Reserve your seat for the next batch before it fills up.", "Apply now", "https://"),
				heading("Why students choose us", "h2", "center"),
				row(
					_benefit("Flexible fees", "Pay in easy instalments."),
					_benefit("Industry mentors", "Learn from people who work in the field."),
					_benefit("Placement help", "Resume and interview support."),
				),
				button("Reserve my seat", "https://"),
				text("<p style=\"text-align:center\">Questions? Reply to this email and {{ owner_name }} will help.</p>", "center"),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Event invitation", "You are invited, {{ first_name }}", "Event",
			"Invite a lead to a webinar or open day.",
			[
				banner("You are invited", "Join us for a live session with our team.", "Save my spot", "https://", bg="#7c3aed"),
				row(
					[heading("When", "h3"), text("<p>Add the date and time here</p>")],
					[heading("Where", "h3"), text("<p>Online or the venue address</p>")],
					[heading("Who", "h3"), text("<p>Speakers and who it is for</p>")],
					divider_line=True,
				),
				text(hi + "<p>We would love to see you there. Seats are limited, so please confirm early.</p>"),
				button("Confirm my seat", "https://", bg="#7c3aed"),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Newsletter", "News from us, {{ first_name }}", "Newsletter",
			"A monthly update with two stories side by side.",
			[
				heading("This month at a glance", "h1"),
				text(hi + "<p>A quick look at what is new.</p>"),
				divider(),
				row(
					[heading("Story one", "h3"), text("<p>A short summary of the first story. Link to the full article below.</p>"), button("Read more", "https://")],
					[heading("Story two", "h3"), text("<p>A short summary of the second story. Link to the full article below.</p>"), button("Read more", "https://")],
				),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Announcement", "An update for you, {{ first_name }}", "Announcement",
			"Share news or a change.",
			[
				heading("An important update", "h1"),
				text(hi + "<p>Write your announcement here. Keep it short: what is changing, when, and what the reader needs to do.</p>"),
				button("Learn more", "https://"),
				text(sign),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Counselling session reminder", "Your session is coming up, {{ first_name }}", "Transactional",
			"A reminder for a booked call or meeting.",
			[
				heading("Your session is coming up", "h1"),
				text(hi + "<p>This is a reminder about your counselling session with {{ owner_name }}. Please keep your questions ready.</p>"),
				button("Add to my calendar", "https://"),
				text("<p>Need to change the time? Just reply to this email.</p>"),
				footer("Your company name, Street address, City"),
			],
		),
		# ---- demo booking messages (names in demos/defaults.py; they use the demo_* variables) ------------------
		(
			"Demo confirmed", "Your {{ demo_title }} is confirmed: {{ demo_date }}", "Transactional",
			"Sent right after someone books a demo.",
			[
				heading("You are booked, {{ first_name }}", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> is confirmed.</p><p><b>When:</b> {{ demo_datetime }}<br><b>With:</b> {{ host_names }}<br><b>Length:</b> {{ demo_duration }} minutes</p>"),
				button("Join the demo", "{{ meet_link }}"),
				text('<p>Need another time? <a href="{{ reschedule_link }}">Reschedule</a> or <a href="{{ cancel_link }}">cancel</a>.</p>'),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo rescheduled", "Your {{ demo_title }} has a new time: {{ demo_date }}", "Transactional",
			"Sent when the visitor picks a new time.",
			[
				heading("Your demo has a new time", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> now takes place on:</p><p><b>{{ demo_datetime }}</b><br>With {{ host_names }}</p>"),
				button("Join the demo", "{{ meet_link }}"),
				text('<p>Plans changed again? <a href="{{ reschedule_link }}">Pick another time</a> or <a href="{{ cancel_link }}">cancel</a>.</p>'),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo cancelled", "Your {{ demo_title }} on {{ demo_date }} was cancelled", "Transactional",
			"Sent when the visitor or a host cancels a demo.",
			[
				heading("Your demo was cancelled", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> on {{ demo_datetime }} has been cancelled.</p><p>We would still love to show you around. Pick a new time whenever it suits you.</p>"),
				button("Book a new time", "{{ booking_link }}"),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo reminder (24 hours)", "Tomorrow: {{ demo_title }} at {{ demo_time }}", "Transactional",
			"A reminder the day before a demo.",
			[
				heading("Your demo is tomorrow", "h1"),
				text(hi + "<p>A quick reminder about your <b>{{ demo_title }}</b>:</p><p><b>{{ demo_datetime }}</b><br>With {{ host_names }}</p>"),
				button("Join the demo", "{{ meet_link }}"),
				text('<p>Cannot make it? <a href="{{ reschedule_link }}">Reschedule</a> or <a href="{{ cancel_link }}">cancel</a>.</p>'),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo reminder (1 hour)", "Starting in 1 hour: {{ demo_title }}", "Transactional",
			"A reminder an hour before a demo.",
			[
				heading("Your demo starts in 1 hour", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> starts at <b>{{ demo_time }}</b>.</p>"),
				button("Join the demo", "{{ meet_link }}"),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo reminder (30 minutes)", "Starting in 30 minutes: {{ demo_title }}", "Transactional",
			"A reminder half an hour before a demo.",
			[
				heading("Your demo starts in 30 minutes", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> starts at <b>{{ demo_time }}</b>. Open the link a minute early to check your sound and video.</p>"),
				button("Join the demo", "{{ meet_link }}"),
				footer("Your company name, Street address, City"),
			],
		),
		(
			"Demo starting now", "{{ demo_title }} is starting now", "Transactional",
			"Sent at the start time of a demo.",
			[
				heading("Your demo is starting", "h1"),
				text(hi + "<p>Your <b>{{ demo_title }}</b> with {{ host_names }} is starting now.</p>"),
				button("Join now", "{{ meet_link }}"),
				footer("Your company name, Street address, City"),
			],
		),
	]


def default_templates():
	"""[(name, subject, category, description, builder_json, body_html)]"""
	out = []
	for name, subject, category, description, blocks in _templates():
		doc = {"settings": SETTINGS, "blocks": blocks}
		_ids(doc["blocks"], name)
		out.append((name, subject, category, description, json.dumps(doc), render(blocks)))
	return out


def _ids(blocks, prefix):
	n = [0]

	def walk(items):
		for b in items:
			n[0] += 1
			b["id"] = f"d{zlib.crc32(prefix.encode()) % 99999}x{n[0]}"
			if b["type"] == "row":
				for c in b["props"]["cols"]:
					walk(c["blocks"])

	walk(blocks)
