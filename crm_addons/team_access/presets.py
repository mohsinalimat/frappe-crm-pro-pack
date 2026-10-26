"""The ready-made presets. An admin can edit or delete them; a deleted one is not brought back until the next version changes the list."""

VERSION = "2"

PRESETS = [
	(
		"Sales Executive", "Works their own leads: sees their own meetings, follow-ups, bookings and numbers, and uses the shared templates.",
		{
			"meetings": "own", "meetings_demos_tab": 1, "followups": "own", "dashboard": "own", "dashboard_campaigns_tab": 1, "demos": "own",
			"demo_widgets": "none", "demo_report": 0, "assignment_rules": "none", "assignment_move": "none", "assignment_history": "none",
			"campaigns": "own", "campaign_create": 0, "automations": "view", "email_templates": "view", "whatsapp_templates": "view",
			"audiences": "edit", "campaign_reports": 1, "list_cleanup": 0,
		},
	),
	(
		"Team Lead", "Sees their own work and their whole team's (everyone below them in the Sales Hierarchy). Can move their team's leads.",
		{
			"meetings": "team", "meetings_demos_tab": 1, "followups": "team", "dashboard": "team", "dashboard_campaigns_tab": 1, "demos": "team",
			"demo_widgets": "none", "demo_report": 0, "assignment_rules": "none", "assignment_move": "team", "assignment_history": "team",
			"campaigns": "team", "campaign_create": 0, "automations": "view", "email_templates": "view", "whatsapp_templates": "view",
			"audiences": "edit", "campaign_reports": 1, "list_cleanup": 0,
		},
	),
	(
		"Sales Manager", "Sees everything in sales and bookings, and can manage the widgets, assignment and campaigns.",
		{
			"meetings": "all", "meetings_demos_tab": 1, "followups": "all", "dashboard": "all", "dashboard_campaigns_tab": 1, "demos": "all",
			"demo_widgets": "manage", "demo_report": 1, "assignment_rules": "view", "assignment_move": "all", "assignment_history": "all",
			"campaigns": "all", "campaign_create": 1, "automations": "manage", "email_templates": "edit", "whatsapp_templates": "create",
			"audiences": "edit", "campaign_reports": 1, "list_cleanup": 1,
		},
	),
	(
		"Campaign Executive", "Runs campaigns and builds the templates, automations and audiences. Sees only their own sales data.",
		{
			"meetings": "own", "meetings_demos_tab": 0, "followups": "own", "dashboard": "own", "dashboard_campaigns_tab": 1, "demos": "none",
			"demo_widgets": "none", "demo_report": 0, "assignment_rules": "none", "assignment_move": "none", "assignment_history": "none",
			"campaigns": "all", "campaign_create": 1, "automations": "manage", "email_templates": "edit", "whatsapp_templates": "create",
			"audiences": "edit", "campaign_reports": 1, "list_cleanup": 1,
		},
	),
	(
		"Template Designer", "Only builds the email and WhatsApp templates. No campaigns, automations or sales data beyond their own.",
		{
			"meetings": "own", "meetings_demos_tab": 0, "followups": "own", "dashboard": "own", "dashboard_campaigns_tab": 0, "demos": "none",
			"demo_widgets": "none", "demo_report": 0, "assignment_rules": "none", "assignment_move": "none", "assignment_history": "none",
			"campaigns": "none", "campaign_create": 0, "automations": "none", "email_templates": "edit", "whatsapp_templates": "create",
			"audiences": "none", "campaign_reports": 0, "list_cleanup": 0,
		},
	),
	(
		"Booking Host", "Takes the website bookings: sees the bookings they host or are invited to, and their own meetings and follow-ups.",
		{
			"meetings": "own", "meetings_demos_tab": 1, "followups": "own", "dashboard": "own", "dashboard_campaigns_tab": 0, "demos": "own",
			"demo_widgets": "none", "demo_report": 0, "assignment_rules": "none", "assignment_move": "none", "assignment_history": "none",
			"campaigns": "none", "campaign_create": 0, "automations": "none", "email_templates": "view", "whatsapp_templates": "view",
			"audiences": "none", "campaign_reports": 0, "list_cleanup": 0,
		},
	),
]
