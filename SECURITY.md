# Security policy

## Supported versions

Security fixes are made for the latest release on the `main` branch (currently 1.4.x).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). If that is not available to you, open a public issue that says only "I need to report a security problem privately" and no details, and a maintainer will arrange a private channel.

Include:

- what is affected (feature, endpoint or page) and the version (see `crm_addons/__init__.py` or the CHANGELOG);
- your Frappe and Frappe CRM versions;
- steps to reproduce or a proof of concept;
- the impact you see (for example "a Sales User can read another user's follow-ups").

You can expect an acknowledgement within a few days, a fix or a mitigation as soon as it is understood, and credit in the CHANGELOG if you want it. Please give us reasonable time to release a fix before you disclose publicly.

## Scope and design notes

- Access rules (a Sales User sees only their own data, Campaign Manager and manager roles) are enforced on the server; reports of a way around them are in scope.
- Unsubscribe links and click-tracking links are signed; a tampered link is refused.
- No secrets are stored by this app itself: Google and WhatsApp credentials live in Frappe's own Google Settings, Google Calendar and `frappe_whatsapp` records.
- Problems in Frappe, Frappe CRM or `frappe_whatsapp` themselves should be reported to those projects.
