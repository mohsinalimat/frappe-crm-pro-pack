# Admin guide - CRM Pro Pack

This is a one-time job. After it, sales users schedule meetings without ever signing in to Google.

## What you need

- A Google account for the company (for example `sales@yourcompany.com`). Meetings are created on
  its calendar and the invitations come from it. A personal account works for a test.
- System Manager access to the site.

## 1. Google Cloud

1. Open <https://console.cloud.google.com> and create (or pick) a project.
2. **APIs & Services > Library**: enable the **Google Calendar API**.
3. **Google Auth Platform** (OAuth consent screen): choose **External** (or **Internal** if you use
   Google Workspace and only your own domain will use it).
   - While the app is in **Testing**, add the company account under **Test users**. Google expires
     the login after **7 days** in this mode, so meetings quietly stop getting Meet links until you
     authorize again. Publish the app (or use an Internal one) for a permanent setup.
   - The scope used is `https://www.googleapis.com/auth/calendar`.
4. **Clients > Create client**: type **Web application**.
   - **Authorized redirect URI**: exactly what **CRM Addons Settings** shows under the guide,
     for example
     `https://crm.yourcompany.com?cmd=frappe.integrations.doctype.google_calendar.google_calendar.google_callback`
     (no trailing slash; `https` for a real site).
   - Copy the **Client ID** and **Client secret**.

A separate OAuth client for each environment (production, staging, your laptop) keeps things clean.

## 2. Frappe

1. **Google Settings**: tick **Enable** and paste the Client ID and Client secret.
2. **Google Calendar > New**:
   - **User**: the admin user who is authorizing
   - **Calendar Name**: for example `CRM Pro Pack` (Google creates a calendar with this name)
   - **Enable** and **Push to Google Calendar** ticked. Leave **Pull from Google Calendar** off,
     otherwise the whole personal calendar is imported.
   - Save, then click **Authorize Google Calendar Access** and sign in with the company account.
   You come back to Frappe with a Google Calendar ID filled in.
3. **CRM Addons Settings**: choose that record as **Company Google Calendar** and save. If it was
   the only connected calendar, this was already done for you. Click **Test Google connection**.

## 3. Email and reminders

- Reminders and fallback invitation emails need an outgoing **Email Account**
  (Desk > Email Account, with "Enable Outgoing" ticked). The settings checklist warns you if it is missing.
- The **scheduler** must be running (`bench --site your-site.com enable-scheduler`). Reminders are
  checked every 5 minutes.
- Guests who are invited through Google get Google's own email. The app only sends its own email
  when Google could not do it (a Manual link, no calendar connected, or a Google error), and for
  reminders and **Notify guests**.

## 4. Settings explained

| Setting | What it does |
|---|---|
| Default provider | Google Meet, or Manual link (paste any URL) |
| Default duration | Length of a new meeting |
| Company Google Calendar | The calendar every meeting is created on |
| Use each user's own Google Calendar | If a user has connected their own calendar, they organize their own meetings |
| Send in-app CRM notifications | Team members are notified when a meeting is scheduled, changed or cancelled |
| Reminder (minutes before) / Early reminder | When reminders go out (0 turns the early one off) |
| Email reminders to CRM team members | Email as well as the in-app notification |
| Also email reminders to external guests | Off by default; Google already reminds guests |
| Show a "Schedule Meeting" button on the Lead page | Turn off if your CRM already has a Meetings tab |
| Show "Meetings" and "Follow-ups" buttons on the Leads list page | The entry point to the calendar |

## 5. Who can do what

See the table in the README. Managers (System Manager, Sales Manager) see every meeting; sales
users see meetings they created or were invited to.

**A Sales User only ever sees their own data** (leads, follow-ups, calls, notes, tasks, meetings, their own dashboard numbers),
enforced on the server. A lead counts as theirs when they own it or are assigned to it. System Managers, Sales Managers and
Campaign Managers keep full access; Campaign results on the dashboard are company-wide for everyone. Only Sales Managers and
System Managers can customize a dashboard.

## Team and access (who sees what)

Open **Team and access** from the CRM menu or the Dashboard header (System Managers only), or go to `/team-access`.

**Add person** (top right) creates the login: email, name, role (Sales User or Sales Manager), a starting preset, and an optional invitation email with the link to set a password. If your site has no outgoing email account the person is still added; set the account up and use **Send password reset email** on their access page. Where they sit in the Sales Hierarchy is still set in CRM's own Settings.

- **People** lists everyone with a Sales User, Sales Manager, System Manager or Campaign Manager role: their roles, who they report to (from CRM's **Sales Hierarchy**, in CRM's own
  Settings under User Management) and their access. Click a person to give them a **preset** and change anything on top of it. Add and invite people, and the hierarchy itself, stay in CRM's Settings;
  the person's panel can send a password reset email (Frappe's own reset, it needs an outgoing email account).
- **Presets** are ready-made sets of access: Sales Executive, Team Lead, Sales Manager, Campaign Executive, Template Designer and Booking Host. Edit them, copy them, make your own. Changing a preset changes everyone using it.
- Every part of Pro Pack is one line with a value:
  - **Whose data** (Meetings, Follow-ups, Bookings, Sales Dashboard numbers, Campaigns, moving leads, assignment history): *No access / Own only / My team / Everyone*. **My team** is the person and everyone below them in the Sales Hierarchy.
    Someone who is not in the hierarchy only sees themselves.
  - **What they can do** (widgets, assignment rules, automations, email templates, WhatsApp templates, audiences): *None / View / Create and edit*.
  - **Switches** (create and send campaigns, campaign reports, list clean-up, the demo report, the Bookings tab inside Meetings, the Campaigns tab of the Sales Dashboard).
- **Nothing changes for people you do not configure.** Managers, the Campaign Manager role and Sales Users keep exactly what they had; System Managers always have everything (they cannot be limited, so nobody locks themselves out).
  A person's value is: their own change, else their preset, else what their role gave them before.
- It is checked on the server for every list, report, export and action. Hiding a menu entry is only the convenience on top.

Examples: a manager who should see only their team's follow-ups: *Follow-ups: My team*. Someone who may only build templates: the **Template Designer** preset. A host who only takes demos: **Booking Host**
(*Bookings: Own only* = the demos they host or are invited to). A Sales User who also runs campaigns: the **Campaign Executive** preset, or just switch on *Create and send campaigns*.

## Testing as a new sales user

Sales users never authorize Google. To see exactly what they will see:

1. **Desk > User > New**: an email, the role **Sales User**, and a password.
2. Make that user the **owner** of a test Lead (Lead Owner). CRM only shows sales
   users the records they own, or that they can reach through the organization hierarchy.
3. Log in to the CRM as that user and open the Lead. **Schedule Meeting** (or **New Meeting** on the
   Meetings tab) creates the meeting on the *company* calendar, with a real Meet link, and nothing asks
   them to sign in to Google.
4. They see only their own meetings, and there is no **Mine / Everyone** switch (that is for managers).
5. To see what happens when setup is not finished, clear **Company Google Calendar** in CRM Addons
   Settings. The editor then shows "Google Meet is not set up yet ... Ask your admin to finish the
   one-time setup." and the meeting is still saved, without a link. An admin sees an **Open setup** link
   in the same place. Put the calendar back afterwards.

Delete the test user, Lead and meetings when you are done. Cancelling a meeting removes its Google event.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google Cloud does not match the one in the settings guide. Copy it exactly. |
| `Access blocked ... invalid_request` | Google refuses non-`https` addresses other than `localhost`. Use `https`, or on a laptop open the site as `http://localhost:8000`. |
| `Error 403: access_denied` | The consent screen is in Testing and the account is not a Test user. Add it under Audience > Test users. |
| Meet links stopped after a week | The consent screen is in Testing (7-day login). Publish the app, then authorize again. |
| "Google Calendar API is not enabled" | Enable the Calendar API in the Google Cloud project. |
| "Google rejected the saved login" | The authorization expired or was revoked: open the Google Calendar record and authorize again. |
| A meeting has no Meet link | "Add a video meeting" was off, or no calendar is connected (the timeline comment says which). Open the meeting: the reason is shown. |
| Guests did not get an invitation | Invitations were switched off for that meeting (the timeline comment says "Guests were not notified"), or the Lead has no email. |
| No reminders | Scheduler off, no outgoing Email Account, or reminders disabled in the settings. The checklist shows the first two. |
| A sales user cannot see a meeting | They did not create it and were not added as a team-member guest. Add them as a guest, or make them a Sales Manager. |

## Good to know

- Google does not let you notify only the *new* guests of a change, so a change notifies everyone or nobody.
- Times are in the site's time zone (System Settings).
- The company account can see every meeting on its calendar, and guests see each other's addresses (Google's default).
- Deleting a meeting in Desk removes its Google event without emailing anyone; use **Cancel meeting** to tell the guests.


## Follow-ups

In **CRM Addons Settings > Follow-ups**:

- **Enable follow-ups** turns the feature on or off.
- **Remind the follow-up owner** sends an in-app notification (and an email when "Email reminders to
  CRM team members" is on) when a follow-up becomes due. The scheduler must be running.
- **Escalate after this many missed calls** - after that many calls in a row that were not picked or connected a
  note is added to the Lead and its owner and all Sales Managers are notified. `0` = off.
- **Lead status to set when escalated** - optional; pick a Lead Status such as "Unreachable".

Under **CRM Interface**, **Show floating buttons on the Kanban view** and **Add Meetings and
Follow-ups tabs to Lead pages** can be switched off if you do not want them. **Show an "Add Follow Up" button at the top of the Lead page** controls the header button next to Schedule Meeting.

## Scoring, stale leads and WhatsApp

- **Score Leads from their activity** turns the 0-100 Lead Score on or off. Scores are
  refreshed whenever a follow-up or meeting changes, and once a day.
- **Alert the owner after this many days without activity** (`0` = off) sends one in-app
  notification per quiet spell. It runs daily, so the scheduler must be running.
- **Default WhatsApp message after a missed call** is the text offered in the follow-up form. The
  option only appears when CRM's WhatsApp is set up.
- **Follow-up templates** are managed in Desk under **CRM Follow Up Template** (title, call status,
  outcome, remark and how many hours until the next follow-up). Tick or clear **Enabled** to show or
  hide one.

## Sales Dashboard

Open it with **Sales Dashboard** in CRM's left menu, or the buttons on the Leads list (header), the Leads Kanban view
(floating button) or CRM's own Dashboard page. It opens as a page of the CRM, beside CRM's menu, at
`/crm/pro-pack-sales-dashboard` (Back and reload work); the **Open in a new tab** button gives the full-screen version
(`/sales-dashboard`) with the same date range and person. Clicking any CRM menu row leaves it. On a narrow screen (under 900 px)
it opens as a pop-up instead. Lead and meeting links move the CRM tab to that record.

- **Lead counts** (on top of the activity numbers): total, open and unassigned leads; leads counted by any field (state, type,
  industry, source ...); named counts such as Schools or Private colleges; and **Leads assigned by person**. All of it is chosen
  on the setup page, section *Sales Dashboard counts*. A sales user only gets counts of their own leads.

- **Export** (top right) downloads an Excel workbook with a sheet for each section and the full call
  log, or the call log alone as CSV. Sales users can only export their own numbers.
- The date range picker remembers your last choice per page (per browser). A range is the days from the first
  to the last, both included; the cards, charts, the Excel / CSV export and the comparison with the previous
  period (the same number of days right before) all use that same range. Hover the picker for the dates being
  compared. The dashboard follows CRM's light or dark theme and has no toggle of its own.
- "Stale leads" uses the **Alert the owner after this many days without activity** setting; with it
  at `0` the card says the alerts are off.
- **Lead Nurturing** is a second tab next to **Sales** (`/sales-dashboard#nurturing` opens it). It shows only
  when **Enable Campaign Manager** is on and loads its numbers when you open it, for the date range and person
  picked at the top. A campaign counts when it was created, started or sent something in the range. "Replied"
  means the lead wrote back (a WhatsApp message or an email) within 14 days after a send. Delivery is reported by
  WhatsApp only, and email opens only when open tracking is on for the outgoing Email Account, so those cards
  say so instead of guessing. Managers see every campaign; a sales user only the campaigns they own or run.

## Follow-ups page

Open it from **Follow-ups** (Leads list, Kanban view, Dashboard header or the side menu) or go to `/followups`;
it opens as a large pop-up over the CRM (**Open in a new tab** for the full page, keeping your filters) and follows CRM's light or dark theme. Deep links: `/followups#today`,
`#overdue`, `#upcoming`, `#done`.

- **Who sees what:** managers see everyone's follow-ups by default and can pick one owner or switch to
  *My follow-ups*; a sales user only sees follow-ups assigned to them, whatever the address asks for.
- **Tabs and cards:** Overdue, Due today and Upcoming are open follow-ups; Done lists the ones that were
  completed or followed up by a newer call (the last 30 days unless a date range is set). The cards are
  clickable shortcuts to the tabs. Connect rate covers the calls made in the same window.
- **Filters:** search (lead name, phone, email, organisation or remark), owner, call outcome and due-date range.
- **Row actions:** *Log* opens the usual Add follow-up form; the tick marks it done; the clock moves it to
  another time (quick picks or a date and time); the arrow opens the lead. Select rows to mark many done or
  move them together; each one is checked against your permission on its own.
- *List* shows one table; *By day* groups the same rows under their due day.

- Who sees what is decided by role: **Sales Manager**, **System Manager** and **Administrator** see the
  whole team; everybody else with the **Sales User** role sees only their own numbers, even if they
  change the address to ask for someone else.
- The team table lists everyone who has the Sales User or Sales Manager role (with zeros for people who
  did nothing), so you can see who is not calling.
- "Leads added" counts leads created in the period by their **lead owner**. "Converted" counts deals
  created from a lead in the period, by the deal owner.
- The page refreshes itself every two minutes while it is open.

## Hiding Deals

Under **CRM Interface** in CRM Addons Settings:

- **Hide "Deals" from the CRM side menu** hides the Deals entry and any saved Deals views listed
  under it.
- **Hide the "Convert to Deal" button on the Lead page** hides that button.
- **Hide "Notes" / "Tasks" / "Call Logs" from the CRM side menu** work the same way as the Deals switch (entry and its saved views are hidden on screen; the pages stay reachable).

These only hide things on the screen (they are off by default). They do not stop someone who opens
`/crm/deals` directly or calls the API; use Frappe's role permissions on **CRM Deal** for that. The
button is found by its label, so check it after a CRM update. Reload the CRM page after changing a
switch.

## Setting up the CRM screens (setup page)

Open `/pro-pack-setup` (System Managers). Besides the switches above it has:

- **Left menu: order and what is shown** (section *CRM screens*): every entry of CRM's left menu and this app's
  (Sales Dashboard, Follow-ups, Meetings, Campaigns, Assignment) in one list. Move entries up and down and switch any off, including
  Dashboard, Leads, Contacts and Organizations. It applies to everyone, only hides and re-orders the links (pages and permissions are
  untouched), and *Back to CRM's own order* undoes it. Saved views not in the list follow the listed entries.
- **Default views** (own section): for Leads, Contacts and Organizations - opens as list or Kanban (CRM has Kanban for Leads only),
  list columns, sort order, default filters, the quick-filter boxes above the list, and for Leads the Kanban field, card title and card
  fields. **Save and apply to everyone** writes each person's own CRM view. Someone who saved their own view in CRM keeps it, unless you
  tick *Also replace the views people have changed*. People who log in later get the layout on their first load (the page reloads once).
- **Sales Dashboard counts**: see above.

## Lead assignment

See [ASSIGNMENT.md](ASSIGNMENT.md). System Managers only: rules for new leads, assigning existing leads, moving a person's leads to
others, and a history with Undo for 24 hours.

## Upgrading to 1.4.0

1. `bench --site your-site migrate`, then `bench restart`. (No `bench build` is needed.) Migrate adds doctypes and a few hidden fields
   (settings, CRM View Settings, WhatsApp Templates), adds the ready-made email templates and mirrors email templates with CRM's own
   *Email Template* list.
2. The workers must be running for jobs of more than 300 leads (assignment, undo) and for campaign sending.
3. Everyone hard-refreshes the CRM once (Ctrl/Cmd + Shift + R). From then on a release loads by itself: if Pro Pack has not started 8
   seconds after the CRM loads, the page clears CRM's saved copy of itself and reloads once, then shows a *Pro Pack did not load* bar.

## Demo booking: embedding

Put this once on each of your websites (before `</body>`), using your CRM address:

```html
<script src="https://CRM-HOST/assets/crm_addons/book/embed.js" async></script>
```

Then any button or link with `data-crm-demo="your-demo-slug"` opens the booking pop-up:

```html
<button data-crm-demo="coding-junior-demo">Book a demo</button>
<a data-crm-demo="coding-junior-demo" href="https://CRM-HOST/book/coding-junior-demo">Book a free demo class</a>
<div data-crm-demo-inline="coding-junior-demo"></div>   <!-- the booking page inside the page -->
```

From your own code: `CRMDemo.open('coding-junior-demo', { prefill: { name, email, phone }, utm: { utm_source: 'x' } })`.
Add each website's address (for example `https://codingjunior.com`) to the demo type's **Allowed origins**; other sites cannot show the page in a frame.
The script remembers the visitor's campaign tags (utm_*, gclid, fbclid) and referrer for 30 days, so the lead shows what really brought them. A ready sample is in
`public/book/demo-host.html`.


## Demo booking (book a demo from your websites)

A visitor on one of your websites clicks **Book a demo**, picks a day and time, fills in a short form and gets a confirmation. CRM Pro Pack creates (or finds) the Lead,
creates one CRM Meeting with a Google Meet link, invites the hosts, remembers where the visitor came from (UTM tags) and sends email and WhatsApp messages.
Only Sales Managers and System Managers set it up; a Sales User only sees the demos they take part in (**Meetings > Bookings**, or the *My demos* list).

### 1. Create a demo type
Open **Bookings** in the CRM menu (or `/demos`), then **Widgets > Create widget**. One demo type per website or product (for example *Coding Junior demo*, *Coding Pro demo*).

| Tab | What to set |
|---|---|
| Details | Title, **slug** (the page address `/book/<slug>`; it cannot be changed later; `manage`, `embed` and `api` are taken), length, time zone of your availability, Google Meet or a fixed meeting link. The fixed link is also used when Google is not connected. |
| Availability | Weekly hours (several time ranges per day are fine), days off or special hours on a date, minimum notice, how many days ahead, demos per day, buffer before and after, and how often a slot starts. |
| Team | The **owners** (one or many; no round robin). With several owners there is **one meeting**, every owner is invited, the first owner is the organizer and the one who gets a new Lead. **CC** people (a user or just an email) are invited too. |
| Form | Name, email and phone always exist. Add or hide the other questions, mark them required, and tie an answer to a Lead field. Allow guests, and the text of the WhatsApp consent box. |
| Messages | The confirmation, reschedule and cancel messages and the reminders (24 hours, 1 hour, 30 minutes before, and at the start; edit the list freely). For each, switch Email and/or WhatsApp on and pick the template. They start switched off until you pick templates. |
| Branding | Name, logo, accent colour, light/dark/auto, heading, button and success texts, footer, an optional address to go to after booking, and **Websites that may embed this page**. |

Spam protection is on by default: the phone number must be valid (Indian numbers: 10 digits starting 6-9, with or without +91 or 0; other countries 8 to 15 digits, using *Default country code*
from the setup page), disposable email addresses are refused, one upcoming demo per phone or email, 10 bookings per network address per hour, a hidden field for robots and a minimum fill time.
There is no CAPTCHA and no OTP. Only a scrambled form of the visitor's IP address is stored.

### 2. Put it on your website
In the demo type open **Embed**: copy the script tag and give any button or link `data-crm-demo="<slug>"` (see *Demo booking: embedding* below), or link straight to `https://YOUR-CRM/book/<slug>`.
List each website under **Websites that may embed this page** (one address per line, for example `https://www.codingjunior.com`); no other website can show the page in a frame.

### 3. Templates and variables
Messages use the same **email template library** as the Campaign Manager (an email template can be used in both) and **approved WhatsApp templates** from frappe_whatsapp.
Variables for the demo: `{{ demo_title }}`, `{{ demo_date }}`, `{{ demo_time }}`, `{{ demo_datetime }}` (the visitor's own time zone, with its name), `{{ demo_duration }}`, `{{ meet_link }}`,
`{{ host_name }}`, `{{ host_names }}`, `{{ booking_link }}`, `{{ reschedule_link }}`, `{{ cancel_link }}`, and every Lead variable (`{{ first_name }}` ...). For a WhatsApp template map the numbered variables the same way as a campaign step, for example
`{"1": "{{ first_name }}", "2": "{{ demo_datetime }}", "3": "{{ meet_link }}"}`. Use **Send me a test** to see a message with sample data.

### 4. What happens to a booking
* Confirmation goes out at once; a reminder goes out at its time. A reminder is skipped when the demo is sooner than the reminder (booked 30 minutes ahead, no 24-hour reminder) and is re-planned when the visitor reschedules. Cancelling drops the reminders that were waiting and sends the cancel message.
* WhatsApp is sent only to a visitor who ticked the consent box, and never to a number that replied STOP. These are transactional messages: the marketing unsubscribe list does not block the confirmation email.
* If no outgoing Email Account is set up, or a template is not approved, the message row shows **Failed** with the reason (open the booking, **Messages**), and **Resend** puts it back in line. One failing message never stops the others.
* The visitor can reschedule or cancel from the link in the message, until the demo starts. If your team cancels, moves or closes the meeting inside CRM, the booking follows (and the visitor is told).
* Slots already taken by a host's other meetings (organizer or guest, any owner) are not offered; a booked slot disappears for everyone at once and two people can never get the same slot.
* If Google is not connected the booking still works: the meeting shows *Not synced* and the visitor gets the demo type's fixed link.

### 5. Where did the bookings come from (UTM report)
**Bookings > Report** shows bookings made in a date range by source, medium, campaign, demo type and day, with how many were held, no-show or cancelled. A new Lead also gets
*First UTM Source / Medium / Campaign* (an existing Lead keeps what it had). The booking itself keeps all tags, the landing page and the referrer.

### Upgrading
`bench --site your-site migrate`, then `bench restart` (new doctypes, a few fields on CRM Meeting and CRM Lead, the minute-by-minute message sender). No `bench build` is needed.
If your nginx adds `X-Frame-Options: SAMEORIGIN` to every page, current browsers still allow the listed websites to frame `/book/...` because the page sends `frame-ancestors`; remove that nginx line for `/book` only if you must support very old browsers.
