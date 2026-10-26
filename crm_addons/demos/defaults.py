"""Ready-made messages for demo bookings, so a new demo type works out of the box and nobody starts from a blank template.

- Email: templates named in ``EMAIL`` are added to the campaign template library by ``campaigns/default_templates.py`` (editable like any other).
- WhatsApp: Meta only allows approved templates, so these are *definitions* (Utility category). An admin submits one to Meta with one click
  (``admin.create_default_whatsapp_template``); once Meta approves it, a rule can use it. Placeholders {{1}}, {{2}} ... map to the demo
  variables in ``variable_map`` (same JSON the campaign step uses).
"""

# (event, minutes_before) -> the key of a message rule; minutes_before is 0 for everything except reminders.
CONFIRMED, RESCHEDULED, CANCELLED = ("Confirmed", 0), ("Rescheduled", 0), ("Cancelled", 0)
REMINDER_24H, REMINDER_1H, REMINDER_30M, STARTING = ("Reminder", 1440), ("Reminder", 60), ("Reminder", 30), ("Reminder", 0)
ORDER = [CONFIRMED, RESCHEDULED, CANCELLED, REMINDER_24H, REMINDER_1H, REMINDER_30M, STARTING]


def key_of(event, minutes_before=0):
	return ("Reminder", int(minutes_before or 0)) if event == "Reminder" else (event, 0)


EMAIL = {
	CONFIRMED: "Demo confirmed",
	RESCHEDULED: "Demo rescheduled",
	CANCELLED: "Demo cancelled",
	REMINDER_24H: "Demo reminder (24 hours)",
	REMINDER_1H: "Demo reminder (1 hour)",
	REMINDER_30M: "Demo reminder (30 minutes)",
	STARTING: "Demo starting now",
}

_SAMPLE = ["Asha", "Free demo class", "Tue 27 Oct", "4:00 PM IST", "https://meet.google.com/abc-defg-hij", "https://crm.example.com/book/manage/abc123"]
_V = {"1": "{{ first_name }}", "2": "{{ demo_title }}", "3": "{{ demo_date }}", "4": "{{ demo_time }}", "5": "{{ meet_link }}", "6": "{{ reschedule_link }}"}


def _wa(name, body, variables, samples):
	return {
		"template_name": name, "category": "UTILITY", "language": "en", "template": body,
		"sample_values": samples, "variable_map": {str(i + 1): v for i, v in enumerate(variables)}, "buttons": [],
	}


WHATSAPP = {
	CONFIRMED: _wa(
		"demo_confirmed",
		"Hi {{1}}, your {{2}} is confirmed for {{3}} at {{4}}.\n\nJoin here: {{5}}\n\nNeed another time? Reschedule or cancel: {{6}}",
		[_V["1"], _V["2"], _V["3"], _V["4"], _V["5"], _V["6"]], _SAMPLE,
	),
	RESCHEDULED: _wa(
		"demo_rescheduled",
		"Hi {{1}}, your {{2}} has been moved to {{3}} at {{4}}.\n\nJoin here: {{5}}\n\nChange it again: {{6}}",
		[_V["1"], _V["2"], _V["3"], _V["4"], _V["5"], _V["6"]], _SAMPLE,
	),
	CANCELLED: _wa(
		"demo_cancelled",
		"Hi {{1}}, your {{2}} on {{3}} at {{4}} has been cancelled.\n\nWould you like another time? Book again here: {{5}}",
		[_V["1"], _V["2"], _V["3"], _V["4"], "{{ booking_link }}"], _SAMPLE[:4] + ["https://crm.example.com/book/free-demo"],
	),
	REMINDER_24H: _wa(
		"demo_reminder_24h",
		"Hi {{1}}, a reminder: your {{2}} is tomorrow, {{3}} at {{4}}.\n\nJoin here: {{5}}\n\nCan't make it? Reschedule or cancel: {{6}}",
		[_V["1"], _V["2"], _V["3"], _V["4"], _V["5"], _V["6"]], _SAMPLE,
	),
	REMINDER_1H: _wa(
		"demo_reminder_1h",
		"Hi {{1}}, your {{2}} starts in 1 hour, at {{3}}.\n\nJoin here: {{4}}",
		[_V["1"], _V["2"], _V["4"], _V["5"]], [_SAMPLE[0], _SAMPLE[1], _SAMPLE[3], _SAMPLE[4]],
	),
	REMINDER_30M: _wa(
		"demo_reminder_30m",
		"Hi {{1}}, your {{2}} starts in 30 minutes, at {{3}}.\n\nJoin here: {{4}}",
		[_V["1"], _V["2"], _V["4"], _V["5"]], [_SAMPLE[0], _SAMPLE[1], _SAMPLE[3], _SAMPLE[4]],
	),
	STARTING: _wa(
		"demo_starting_now",
		"Hi {{1}}, your {{2}} is starting now.\n\nJoin here: {{3}}",
		[_V["1"], _V["2"], _V["5"]], [_SAMPLE[0], _SAMPLE[1], _SAMPLE[4]],
	),
}
