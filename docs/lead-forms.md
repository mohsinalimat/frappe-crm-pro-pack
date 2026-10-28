# Lead forms

A public form that turns a visitor into a CRM lead. It is built the same way as a booking widget, and lives under **Bookings, Lead forms**.

- **The form** (`/lead-form/<name>`) asks for the phone and the email by default, plus any question you add. Questions are picked from the **Lead fields the CRM already has**, so what is collected always fits the lead; nothing new is invented.
- **A new person** becomes a lead (source and status as you set). **Someone who matches an existing lead** by email or phone is not added again.
- **Embed** it on any website (a ready snippet is on the Embed tab). **Allowed websites** limits where it may be embedded.
- **Messages:** a welcome message and follow-ups by email and WhatsApp from the template library.
- **Consent** text and a default for the WhatsApp opt-in tick.
- **Anti-spam** without a CAPTCHA: a hidden field, a minimum fill time, phone and email checks and rate limits.
- **Branding:** the logo, name and accent colour of the page.

## Reports and logs

**Lead form report** counts entries by day, source, medium, campaign and form; **Log** lists each entry (type, result, who, source, the CRM lead it created) with a date range, search and export. A visitor's IP address is never stored: only a one-way hash that is used for the spam limits.
