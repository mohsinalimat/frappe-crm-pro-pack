"""Every Suite Pro permission an admin can give a person, in one list.

A feature has a *kind*:
  scope   whose data the person sees: none / own / team / all   (team = themselves and everyone below them in CRM's Sales Hierarchy)
  level   what the person may do with a thing: an ordered list, lowest to highest (for example none / view / edit)
  switch  on or off

``legacy`` is what a person gets when nobody has configured them (nothing changes for existing users): a value for managers
(System / Sales Manager), one for the Campaign Manager role, one for everybody else. Administrators and System Managers always
get the highest value of everything, so an admin can never lock themselves out.
"""

NONE, OWN, TEAM, ALL = "none", "own", "team", "all"
SCOPE = [(NONE, "No access"), (OWN, "Own only"), (TEAM, "My team"), (ALL, "Everyone")]
SWITCH = [(0, "Off"), (1, "On")]

GROUPS = [
	("team", "Team", "The Team page: who is who and who sees what."),
	("crm", "Leads and organizations", "The Leads and Organizations pages, and whose leads the person sees."),
	("sales", "Sales", "Meetings, follow-ups and the Sales Dashboard."),
	("demos", "Bookings", "Website bookings, and the widgets (booking pages) that visitors book through."),
	("assignment", "Lead assignment", "Moving leads between people, and the rules that do it automatically."),
	("campaigns", "Campaign Manager", "Campaigns, automations, templates and audiences."),
	("whatsapp", "WhatsApp inbox", "The WhatsApp inbox: every chat, including numbers that are not leads yet."),
]


def _f(key, group, label, kind, legacy, help="", options=None):
	return {"key": key, "group": group, "label": label, "kind": kind, "legacy": legacy, "help": help, "options": options or {"scope": SCOPE, "switch": SWITCH}[kind]}


def _level(*pairs):
	return list(pairs)


FEATURES = [
	_f("leads", "crm", "Leads", "scope", (ALL, ALL, ALL), "Whose leads the person sees on the Leads page. No access hides the page."),
	_f("lead_delete", "crm", "Delete leads", "switch", (1, 0, 0), "Allow the person to delete leads, one by one or in bulk. Editing a lead is always allowed; every edit is kept in the lead's activity."),
	_f("organizations", "crm", "Organizations", "switch", (1, 1, 1), "Show the Organizations page."),
	_f("team", "team", "Team page", "level", ("none", "none", "none"), "View only shows the Team page. Add and edit people also lets them add and edit people, presets and the hierarchy, but never a System Manager. Settings stay with System Managers.", _level(("none", "No access"), ("view", "View only"), ("manage", "Add and edit people"))),
	_f("meetings", "sales", "Meetings", "scope", (ALL, OWN, OWN), "Whose meetings the person sees in Meetings."),
	_f("meetings_demos_tab", "sales", "Bookings tab inside Meetings", "switch", (1, 1, 1), "Show the Bookings view next to Mine and Everyone."),
	_f("followups", "sales", "Follow-ups", "scope", (ALL, OWN, OWN), "Whose follow-ups the person sees."),
	_f("dashboard", "sales", "Sales Dashboard numbers", "scope", (ALL, OWN, OWN), "Whose numbers the dashboard adds up."),
	_f("dashboard_campaigns_tab", "sales", "Campaigns tab in the Sales Dashboard", "switch", (1, 1, 1), "Show the campaign numbers."),
	_f("demos", "demos", "Bookings", "scope", (ALL, OWN, OWN), "Which bookings the person sees. Own = bookings they host or are invited to."),
	_f("demo_widgets", "demos", "Widgets", "level", ("manage", "none", "none"), "The booking pages: their times, team, form, messages and branding.",
		_level(("none", "No access"), ("view", "View only"), ("manage", "Create and edit"))),
	_f("demo_report", "demos", "Bookings report", "switch", (1, 0, 0), "The booking numbers by source, campaign and day."),
	_f("assignment_rules", "assignment", "Assignment rules", "level", ("none", "none", "none"), "The rules that give new leads to people.",
		_level(("none", "No access"), ("view", "View only"), ("manage", "Create and edit"))),
	_f("assignment_move", "assignment", "Moving leads", "scope", (NONE, NONE, NONE), "Give leads to other people. Own = leads they own; team = their team's; everyone = any lead."),
	_f("assignment_history", "assignment", "Assignment history", "scope", (NONE, NONE, NONE), "See who moved which lead, and when."),
	_f("campaigns", "campaigns", "Campaigns", "scope", (ALL, ALL, OWN), "Which campaigns the person sees and reports on."),
	_f("campaign_create", "campaigns", "Create and send campaigns", "switch", (1, 1, 0), "Build, launch, pause and cancel campaigns."),
	_f("automations", "campaigns", "Automations", "level", ("manage", "manage", "view"), "Things that happen when a lead replies, clicks or is created.",
		_level(("none", "No access"), ("view", "View only"), ("manage", "Create and edit"))),
	_f("email_templates", "campaigns", "Email templates", "level", ("edit", "edit", "view"), "The shared email template library.",
		_level(("none", "No access"), ("view", "View and use"), ("edit", "Create and edit"))),
	_f("whatsapp_templates", "campaigns", "WhatsApp templates", "level", ("create", "create", "view"), "Templates from Meta, and creating new ones.",
		_level(("none", "No access"), ("view", "View and use"), ("create", "Create and sync"))),
	_f("audiences", "campaigns", "Audiences (saved segments)", "level", ("edit", "edit", "edit"), "Saved lead filters used as audiences.",
		_level(("none", "No access"), ("view", "View and use"), ("edit", "Create and edit"))),
	_f("campaign_reports", "campaigns", "Campaign reports", "switch", (1, 1, 1), "The Reports page of the Campaign Manager."),
	_f("whatsapp_inbox", "whatsapp", "WhatsApp inbox", "level", ("all", "none", "none"), "Own = the chats of leads they own, and the new numbers assigned to them. Everyone = all chats, the new numbers nobody has picked up yet, and assigning them.",
		_level(("none", "No access"), ("own", "Own chats"), ("all", "All chats and assigning"))),
	_f("list_cleanup", "campaigns", "List clean-up", "switch", (1, 1, 0), "Bounced emails and invalid numbers kept off future campaigns."),
]
BY_KEY = {f["key"]: f for f in FEATURES}


def values(feature):
	return [o[0] for o in feature["options"]]


def top(feature):
	return values(feature)[-1]


def normalise(feature, value):
	"""The stored form of a value, or ``None`` if it is not one of the feature's options."""
	if feature["kind"] == "switch":
		try:
			return 1 if int(value) else 0
		except (TypeError, ValueError):
			return 1 if str(value).lower() in ("true", "on", "yes") else (0 if str(value).lower() in ("false", "off", "no", "") else None)
	return value if value in values(feature) else None


def rank(feature, value):
	value = normalise(feature, value)
	return values(feature).index(value) if value in values(feature) else 0
