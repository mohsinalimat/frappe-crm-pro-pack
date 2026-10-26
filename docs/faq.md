# FAQ

**Is this an official Frappe or Frappe CRM app?** No. It is an independent open-source add-on, not affiliated with or endorsed by Frappe Technologies or any other company named in this documentation.

**Do I need to fork or patch Frappe CRM?** No. It is a normal Frappe app. It adds to CRM's screens from the outside (a script added to the CRM page, form scripts, custom fields), so you keep upgrading CRM normally.

**Which versions are supported?** Frappe v15 with Frappe CRM 1.x, MariaDB, Python 3.10 to 3.12. Newer Frappe versions are allowed but untested; PostgreSQL is not supported.

**Do I need ERPNext?** No. Only Frappe and Frappe CRM (and `frappe_whatsapp` if you want WhatsApp).

**Do I need WhatsApp to use the Campaign Manager?** No. Email-only sites work without `frappe_whatsapp`; the WhatsApp channel is then unavailable.

**Does it call Meta directly?** No. WhatsApp goes through the `frappe_whatsapp` app; Pro Pack never calls Meta itself.

**Can the same person get a message twice?** Not by design: the database enforces one recipient row per campaign, step, channel and lead, and Launch and sending are guarded against double clicks, restarts and retries. See [Campaigns](campaigns.md#limits-and-best-practices).

**Why is there no "delivered" number for email?** Frappe's mail system does not report it. The app shows Queued, Sent, Failed; Opened when the Email Account tracks status or through click tracking; Bounced when your provider reports it. It does not guess.

**Are the numbers in the screenshots real?** No. They come from a showcase site with made-up data.

**Do sales users need a Google account?** No. An admin connects one company Google account once.

**Can I use Zoom or Teams?** Paste any link with the Manual Link provider. Automatic Zoom and Teams meetings are not available yet.

**Does it work with Deals?** Features work on Leads. Deals are not extended; you can hide the Deals menu and Convert to Deal button.

**Can a Sales User see other people's leads?** No. See [Roles and permissions](roles-and-permissions.md).

**Is my data sent anywhere?** Only what you enable: meeting details go to Google Calendar, WhatsApp messages go through `frappe_whatsapp` to Meta, and emails through your own mail account. Dashboards and exports run on your server.

**Can I export data?** Yes: the Sales Dashboard exports Excel and CSV, campaign recipients export to CSV, and every doctype supports Frappe's Data Export.

**How do I remove it?** `bench --site your-site.com uninstall-app crm_addons` removes the scripts, custom fields, dashboard charts and workspace it added. Consent fields and campaign data are not deleted on purpose; see the rollback section of [CAMPAIGN_MANAGER.md](CAMPAIGN_MANAGER.md#rollback).

**How can I help?** See [CONTRIBUTING.md](../CONTRIBUTING.md).
