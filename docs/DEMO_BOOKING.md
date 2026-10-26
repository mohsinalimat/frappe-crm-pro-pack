# Demo booking (design and API contract)

Status: design agreed with the owner, being built on branch `feature/demo-booking` (from `main` 1.4.0). Nothing here is merged to `main`.

## What it is
A Cal.com-style booking page built into CRM Pro Pack. A visitor on one of the owner's websites (Coding Junior, Coding Pro, ...) clicks
"Book a demo", picks a date and a time slot, fills a short form, and gets a confirmation. The system then creates / matches the **Lead**,
creates a **CRM Meeting** of type Demo (Google Meet link, owners + CC invited), records the **UTMs**, and sends **email and WhatsApp**
messages (confirmation, reminders, reschedule, cancel) built from the **Campaign Manager template library**. Admins create and brand
the demo types; sales users only see the demos scheduled for them.

## Decisions (owner)
- Several websites, so **branding is per demo type** and set by an admin: name, logo, accent colour, light/dark/auto, heading, description,
  button text, success text, footer text.
- **No round robin.** The admin picks the owners when creating the demo type (one or many). With several owners there is **one meeting** and
  every owner is an attendee (invited); the first owner is the organizer. CC people (users or plain email addresses) are added as attendees.
- Reminders: Google Calendar sends its own; in addition our messages go out at **24 h, 1 h, 30 min and at the start time** (editable list
  per demo type: minutes before, channel, templates).
- Visitor can **reschedule or cancel** from a link in the email / WhatsApp message.
- **No CAPTCHA, no OTP.** Spam protection: phone and email validation (Indian 10-digit rule by default), the same phone / email booking again
  and again is refused, per-IP rate limit, a honeypot field and a minimum fill time.
- Templates are chosen from the **campaign template library** (CRM Campaign Email Template; WhatsApp templates from frappe_whatsapp, which
  must be approved in Meta).
- Admin sets the available dates and times per demo type. Sales users cannot create or edit demo types.

## Visitor flow
1. Host site loads `embed.js` (one `<script>` tag or a plain link/button with `data-crm-demo="<slug>"`); it opens `/book/<slug>` in an
   iframe pop-up (or the plain page when opened as a link). `embed.js` also collects first-touch UTMs of the host site.
2. Step 1: month calendar with available days + time slots, 12h/24h switch, time-zone picker (default: visitor's zone). Left panel: logo,
   brand name, title, description, duration, Google Meet, time zone.
3. Step 2: form (fields configured by the admin: name, email, phone with country picker, school/company, notes, extra questions, optional
   guests, WhatsApp-updates consent checkbox).
4. Step 3: confirmation (date, time in visitor zone, Meet link, add-to-calendar, reschedule, cancel).
5. `/book/manage/<token>`: reschedule (same slot picker) or cancel (with optional reason).

## Data model (module "Demos", `crm_addons/demos/`)
All new doctypes. Names are fixed so the three parts of the build agree.

**CRM Demo Type** (`slug` unique, URL-safe; reserved slugs: `manage`, `embed`, `api`)
- Basics: `title`, `slug`, `enabled`, `description` (Small Text), `duration_minutes`, `slot_interval_minutes` (default = duration),
  `timezone` (availability time zone, default site), `provider` (Google Meet / Manual Link), `manual_link`, `location_note`.
- Rules: `buffer_before_minutes`, `buffer_after_minutes`, `min_notice_hours` (default 4), `max_days_ahead` (default 30), `max_per_day` (0 = no limit).
- Team: `owners` (table **CRM Demo Owner**: `user`), `cc` (table **CRM Demo CC**: `user` Link or `email` Data), `owner_notify` (Check).
- Availability: `hours` (table **CRM Demo Hours**: `weekday` Mon..Sun, `from_time`, `to_time`; several rows per weekday allowed),
  `overrides` (table **CRM Demo Date Override**: `date`, `kind` Unavailable / Custom hours, `from_time`, `to_time`, `note`).
- Form: `fields` (table **CRM Demo Field**: `key`, `label`, `kind` Text / Email / Phone / Long Text / Select / Checkbox, `required`, `options`,
  `placeholder`, `enabled`, `lead_field` optional mapping to a CRM Lead fieldname). Name, email and phone always exist (defaults seeded);
  `allow_guests` (Check), `consent_text` (Small Text for WhatsApp updates), `consent_default` (Check).
- Lead: `lead_source` (Link CRM Lead Source), `lead_status` (Link CRM Lead Status), `assign_lead_to_owner` (Check, default on: first owner).
- Messages: `messages` (table **CRM Demo Message Rule**: `event` Confirmed / Rescheduled / Cancelled / Reminder, `minutes_before` for Reminder
  (0 = at the start), `send_email`, `email_template` (Link CRM Campaign Email Template), `send_whatsapp`, `wa_template` (Data, a frappe_whatsapp
  template name), `wa_account` (Data), `wa_variables` (Small Text, same `variable_map` syntax the campaign step uses)). Defaults seeded: Confirmed,
  Rescheduled, Cancelled, Reminder 1440 / 60 / 30 / 0 (switched off until templates are picked).
- Branding: `brand_name`, `logo` (Attach Image), `accent_color`, `theme` (Auto / Light / Dark), `heading`, `button_text`, `success_title`,
  `success_text`, `footer_text`, `redirect_url` (optional, after booking), `allowed_origins` (Small Text, one origin per line; the websites that may embed it).
- Anti-spam: `max_active_per_contact` (default 1 upcoming demo per phone / email per type), `max_per_ip_per_hour` (default 10).

**CRM Demo Booking**: `demo_type`, `status` (Confirmed / Rescheduled / Cancelled / Completed / No Show), `starts_on`, `ends_on` (site time zone, as CRM Meeting),
`starts_utc`, `visitor_timezone`, `lead`, `meeting`, `name_`, `email`, `phone` (normalised), `organization`, `answers` (JSON), `guests` (Small Text),
`whatsapp_consent` (Check), `token` (secret, unique), `slot_key` (unique, `sha1(type|starts_utc)`; set NULL when cancelled/rescheduled so the slot frees),
`rescheduled_from`, `cancel_reason`, UTM + attribution: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid`,
`landing_url`, `referrer`, `first_touch` (JSON), `ip_hash` (salted hash, never the raw IP), `user_agent`,
`messages` (table **CRM Demo Booking Message**: `event`, `due_at`, `channel`, `status` Pending / Sending / Sent / Skipped / Failed, `sent_at`, `error`, `reference`, `claim_token`).

**CRM Meeting** gets: `is_demo` (Check), `demo_type` (Link), `demo_booking` (Link). The Meetings screen filters on `is_demo` (the **Demos** view).
**CRM Lead** gets (custom fields via install.py): `crm_demo_first_utm_source`, `..._medium`, `..._campaign` (first-touch), and the lead's `source` as configured.

## Backend modules (`crm_addons/demos/`)
- `slots.py`: `get_slots(demo_type, from_date, to_date, tz)`; weekly hours - overrides - min notice - max days - max per day - buffers - the
  owners' existing CRM Meetings (organizer or attendee) - already booked slots. Pure and testable.
- `booking.py`: `create_booking`, `reschedule`, `cancel`. Atomic: the unique `slot_key` makes a double booking impossible; owners checked again at write time.
  Lead match by email, then phone, else a new Lead. Meeting created through the same path as `crm_addons.api.save_meeting` (Google Meet + calendar sync).
- `messaging.py`: renders the templates with demo variables and sends through the same Frappe email / frappe_whatsapp path the campaigns use;
  `queue_messages(booking, event)` writes the Pending rows (reminders get `due_at`), `send_due()` runs every minute (scheduler), with guarded
  claim so nothing is sent twice. Confirmation / reminders are **transactional**: not blocked by the marketing unsubscribe list, but a WhatsApp STOP and a
  missing WhatsApp consent are honoured. Cancelled bookings cancel their pending rows.
- `spam.py`: phone / email validation, repeat-contact rule, IP rate limit (cache), honeypot, minimum fill time, disposable-domain list.
- `public.py`: the guest API below. `admin.py`: the manager API below. `report.py`: UTM report. `permissions.py`.
- New template variables (extend `campaigns/personalization.py` so the template editor lists and accepts them): `demo_title`, `demo_date`, `demo_time`,
  `demo_datetime` (in the visitor's time zone, with the zone name), `demo_duration`, `meet_link`, `host_name`, `host_names`, `booking_link`,
  `reschedule_link`, `cancel_link`, plus all existing lead variables.

## Guest API (`crm_addons.demos.public.*`, `allow_guest=True`, POST/GET JSON)
- `get_demo(slug)` -> `{slug, title, description, duration_minutes, timezone, provider, brand:{name, logo_url, accent, theme, heading, button_text, footer_text},
  fields:[{key,label,kind,required,options,placeholder}], allow_guests, consent:{text, default}, min_date, max_date, form_token}`;
  404-style error when disabled / unknown. `form_token` is a signed timestamp (minimum fill time).
- `get_slots(slug, from_date, to_date, tz)` -> `{tz, days:[{date:"YYYY-MM-DD" (in tz), slots:[{start:"ISO UTC", label}]}]}`; range capped at 62 days.
- `book(slug, start, tz, answers, guests, consent, utm, landing_url, referrer, form_token, hp)` -> `{ok, booking:{token, status, starts_on_iso, ends_on_iso, tz, meet_link,
  title, manage_url, add_to_calendar_url}}`. Errors are friendly strings (`slot_taken` code lets the widget refresh the slots).
- `get_booking(token)` -> the booking + demo brand + whether it can still be changed; `reschedule(token, start, tz)`; `cancel(token, reason)`.
- Rate-limited, never reveals other visitors' data, no raw IP stored.

## Manager API (`crm_addons.demos.admin.*`, whitelisted, managers only (`is_manager()`), checked server side)
`list_demo_types`, `get_demo_type(name)`, `save_demo_type(doc)`, `duplicate_demo_type`, `delete_demo_type` (refused when bookings exist; disable instead),
`list_bookings(filters, search, from_date, to_date, page)`, `get_booking_admin(name)`, `set_booking_status(name, status)`, `resend_message(booking, event)`,
`demo_report(from_date, to_date)` (bookings by source / medium / campaign / demo type / day, funnel booked -> held -> no-show / cancelled), `get_embed_code(slug)`,
`list_templates` (campaign email templates + WhatsApp templates for the message editor), `get_demo_variables`.
Sales users: `crm_addons.demos.admin.my_demos(from_date, to_date, scope)` (their demos; managers can pass scope=all).

## Pages
- Public: route `/book/<slug>` and `/book/manage/<token>` (Frappe www page `crm_addons/www/book.*`, rule in `hooks.py`); assets in
  `crm_addons/public/book/` (Vue 3, no build, `embed.js` for host sites). Framing allowed only from the demo type's `allowed_origins` (CSP `frame-ancestors`).
- Admin: `crm_addons/public/demos/` (Vue 3, no build; opened from CRM like the other pages: bridge `openDemos`, side-menu entry **Demos** for managers) -
  demo types list + editor (Details, Availability, Team, Form, Messages, Branding with live preview, Embed code), bookings list, UTM report.
- Meetings screen: a **Demos** view (Mine / Everyone / Demos) in `public/meetings/app.js`.

## Out of scope for now
Google free/busy of other people's calendars beyond what the existing Google Calendar link of each owner gives (CRM Meetings are always checked),
payments, CAPTCHA, OTP, recurring demos.

## Ownership while building (to avoid edit conflicts)
Backend agent: `crm_addons/demos/**`, `hooks.py`, `install.py`, `modules.txt`, `patches*`, `permissions.py`, `campaigns/personalization.py`, CRM Meeting doctype json.
Public widget agent: `crm_addons/www/book.*`, `crm_addons/public/book/**`. Admin UI agent: `crm_addons/public/demos/**`, `public/meetings/app.*`, `bridge.js`, `addons.js`.
Everyone appends to `CHANGELOG.md` (an "Unreleased" section) and this file; nobody commits (the lead does).

## Contract changes (backend agent)
Read this before building against the API. Everything above still holds unless stated here.

**Guest API**
- **Errors** are thrown (HTTP 417, friendly text in `_server_messages` / `exception`) and the JSON body also carries a top-level `code`:
  `slot_taken` (refresh the slots and tell the visitor to pick another), `invalid_email`, `invalid_phone`, `field_required`, `repeat_contact`, `rate_limited`,
  `form_expired` (reload the page: the signed `form_token` is older than 12 h), `too_fast` (submitted within 3 s of loading the page), `not_found`, `not_changeable`
  (already started / cancelled), `unavailable` (demo type disabled or no owner). A honeypot hit returns a normal-looking `{ok: true, booking: {...}}` that is not stored.
- `get_demo` adds to `brand`: `success_title`, `success_text`, `redirect_url`; and to the top level: `location_note`, `timezone` (the availability zone), `now_iso`.
  `min_date` / `max_date` are `YYYY-MM-DD` in the demo type's time zone (calendar bounds only; `get_slots` is what says which days are bookable).
  `fields` lists only enabled fields and always contains `name`, `email`, `phone`. Answers are posted as `answers = {key: value}` (JSON object or string).
- `get_slots(slug, from_date, to_date, tz, token=None)`: `from_date` / `to_date` are dates in `tz` (both inclusive). `days` lists **only days that have at least one slot**.
  `start` is UTC ISO with a trailing `Z`, `label` is the local time in `tz` (`10:30 AM`). Pass the booking `token` on the manage page so the visitor's own current slot does
  not block the slots next to it.
- `book(...)` / `reschedule(token, start, tz)` / `cancel(token, reason)` return `{ok: true, booking: B}` with
  `B = {token, status, starts_on_iso, ends_on_iso (UTC, trailing Z), tz (visitor), meet_link, title, manage_url, reschedule_url, cancel_url, add_to_calendar_url (Google), ics_url, can_change, name, email}`.
  `manage_url` is `<site>/book/manage/<token>`; `reschedule_url` / `cancel_url` add `?action=reschedule` / `?action=cancel`.
- `get_booking(token)` -> `{ok, booking: B, can_change, can_cancel, demo: {slug, title, description, duration_minutes, timezone, provider, location_note, brand, min_date, max_date}}`.
  A wrong token is a `not_found` error (nothing else is revealed).
- **Reschedule keeps the same booking and the same token** (status becomes `Rescheduled`, `rescheduled_from` = the previous start); old links keep working.
  Visitors can change or cancel only while the demo has not started.
- `book` takes `utm` as an object with any of `utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid` and optionally `first_touch` (object).
- `crm_addons.demos.public.ics?token=...` (GET, guest) downloads the `.ics` file.

**Pages**
- `hooks.py` has `website_route_rules` mapping `/book/<slug>` and `/book/manage/<token>` to the route `book`; the www page receives `frappe.form_dict.slug` or
  `frappe.form_dict.token` (never both). `manage` / `embed` / `api` are reserved slugs. Framing headers are set by an `after_request` hook
  (`crm_addons.demos.framing`): `Content-Security-Policy: frame-ancestors 'self' <allowed_origins>` and `X-Frame-Options` removed on `/book/*` only; the www page must not set
  its own `X-Frame-Options` / CSP. A `nginx`-added `X-Frame-Options: SAMEORIGIN` cannot be removed by the app; modern browsers ignore it when `frame-ancestors` is present.

**Data**
- `CRM Demo Hours.weekday` options are the literal short names `Mon Tue Wed Thu Fri Sat Sun`.
- `starts_utc` is a naive **UTC** datetime. `starts_on` / `ends_on` and message `due_at` / `sent_at` are in the **site** time zone (like CRM Meeting).
- `CRM Demo Booking Message` has one extra field `minutes_before` (Int, reminders). Message `status` values: `Pending, Sending, Sent, Skipped, Failed`.
- `rescheduled_from` is a Datetime (the previous `starts_utc`).
- `CRM Meeting` list API (`list_meetings`, `get_meeting`) now also returns `is_demo`, `demo_type`, `demo_booking`.
- Message rule `wa_variables` uses the campaign `variable_map` JSON (`{"1": "{{ demo_time }}"}`).
- Template variables added: `demo_title demo_date demo_time demo_datetime demo_duration meet_link host_name host_names booking_link reschedule_link cancel_link`
  (labelled "Demo: ..." in the campaign variable list; empty in a normal campaign).

**Manager API** (`crm_addons.demos.admin.*`; all refuse non-managers with a PermissionError; docs are plain dicts)
- `list_demo_types()` -> `[{name, slug, title, enabled, duration_minutes, timezone, owners:[{user, full_name}], upcoming, total, public_url, modified}]`
- `get_demo_type(name)` -> `{doc, public_url, bookings}`; `doc` is the full document dict with child tables (`owners, cc, hours, overrides, fields, messages`).
- `save_demo_type(doc)` (JSON string or dict; `name` present = update) -> `{doc, public_url, bookings}`; `duplicate_demo_type(name, slug=None, title=None)` -> same;
  `delete_demo_type(name)` -> `{ok: true}` (refused while bookings exist).
- `list_bookings(filters=None, search=None, from_date=None, to_date=None, page=1, page_size=25)` -> `{rows, total, page, page_size}`; `filters` is a JSON object of
  `demo_type, status, utm_source, utm_medium, utm_campaign`; dates filter the demo's start day (site time zone, inclusive); `filters.owner` (a user) limits to the demo types that user hosts. A row has `name, demo_type, demo_title, status, starts_on, ends_on,
  starts_utc, visitor_timezone, name_, email, phone, organization, lead, meeting, meet_link, whatsapp_consent, utm_source, utm_medium, utm_campaign, creation`.
- `get_booking_admin(name)` -> `{booking (all fields, answers and first_touch parsed), messages:[{name, event, minutes_before, channel, status, due_at, sent_at, error, reference}], lead_url, meeting_url, sync_status, sync_error, owners}`
- `set_booking_status(name, status)`: `Completed` / `No Show` (also sets the meeting outcome) or `Cancelled` (cancels like the visitor would, guests are told) -> `get_booking_admin` shape.
- `resend_message(booking, event=None, message=None)`: with `message` (a message row name) that row goes back to Pending; with `event` a new immediate message for that event is queued. -> `{ok, queued}`.
- `demo_report(from_date, to_date, demo_type=None)` (range on the day the booking was made) -> `{totals:{booked, upcoming, held, no_show, cancelled, rescheduled, held_rate},
  by_source, by_medium, by_campaign, by_demo_type, by_day}` where each group is a list of `{label, booked, held, no_show, cancelled}` (`by_day` rows use `date`).
- `get_embed_code(slug)` -> `{url, script, button, iframe}` (HTML strings). `list_templates()` -> `{email:[{name, subject, category}], whatsapp:[{name, status, language, body, variables}], whatsapp_accounts, whatsapp_installed, email_problem}`.
  `get_demo_variables()` -> `[{name, label}]`. `my_demos(from_date, to_date, scope="mine")` -> list of rows like `list_bookings` plus `lead_title`.
- When a CRM Meeting of a demo is cancelled, rescheduled or given an outcome inside CRM, the booking follows (cancel -> Cancelled and the visitor is told; Held -> Completed; No Show -> No Show).

## Contract changes (admin UI agent)
What the admin screens (`public/demos/`, the Demos view of `public/meetings/app.js`, `bridge.js`, `addons.js`) use and what they still ask the backend for.
Everything below is implemented defensively on the UI side (a missing piece degrades, it never breaks a screen), so none of it blocks a release.
- **Asked of the backend**
  - `get_client_config`: `demos_enabled` (1 when the feature is on). The UI shows the Demos menu entry / shortcut to managers whenever `is_manager` is true and `demos_enabled` is not `0`.
  - `hooks.website_redirects`: `/demos` -> `/assets/crm_addons/demos/index.html` (standalone page, like `/pro-pack-setup`). The friendly in-CRM route `/crm/pro-pack-demos` is handled by `bridge.js` / `addons.js`.
  - `list_bookings`: a `filters.owner` (a user id: bookings of demo types that user hosts) for the owner filter. Until it exists the filter is sent but has no effect.
  - `list_demo_types`: optional `next_slot` (UTC ISO of the first free slot), `bookings_month` (bookings starting this month) and `provider`. Until they exist the cards ask `crm_addons.demos.public.get_slots` and `list_bookings` themselves, per card, after the list is shown.
  - `send_test_message(demo_type, event, minutes_before, channel)` (channel `Email` / `WhatsApp`): sends that rule's message with sample data to the logged-in manager's own email / mobile -> `{message}`. The "Send me a test" buttons call it and show the server's error otherwise.
  - (done without the backend) A Sales User records the outcome of a demo from the Meetings screen with the existing `record_meeting_outcome`; the booking follows the meeting on the server.
  - `list_meetings`: `demos_only=1` argument (only `is_demo` meetings), and per row `demo_type_title`, `demo_utm_source`, `demo_utm_medium`, `demo_utm_campaign` for the Demo cards. Until then the view filters on `is_demo` / `demo_type` / `demo_booking` in the browser and joins the title and UTMs from `my_demos` by meeting.
- **Used as documented above**: `list_demo_types`, `get_demo_type` (`doc`), `save_demo_type`, `duplicate_demo_type`, `delete_demo_type`, `list_bookings` (1-based `page`, `page_size`), `get_booking_admin` (`booking`, `messages`, `lead_url`), `set_booking_status`, `resend_message` (`message` = row name to retry), `demo_report`, `get_embed_code`, `get_demo_variables`, `search_guests` (hosts / CC), campaign `list_email_templates`, `get_email_template`, `list_whatsapp_templates` (template pickers, same as the campaign wizard).
- **UI rules worth knowing**: the slug of a saved demo type is read-only in the editor (the server ignores changes); hours use `Mon..Sun` on the wire and full day names in the editor; booleans are sent as 1 / 0.


## Widget notes (public widget agent)
- Files: `www/book.html` + `book.py` (standalone document, no website chrome, `noindex`), `public/book/book.js|css` (Vue 3, vendored Vue from `public/meetings/vendor`),
  `embed.js`, `demo-host.html` (sample host page), UI regression `demos/tests_ui/book_ui.js` (see its README line in the header comment).
- Embed -> iframe query: `embed=1`, `po` (parent origin, the only origin the page posts to and accepts messages from), `ft` (base64url JSON first touch), `utm_*`/`gclid`/`fbclid` (current visit),
  `landing`, `ref`, `theme`, `lang`, `sheet=1` (phone full-screen), `name`/`email`/`phone` prefill. `book(...)` receives `utm = {utm_*, gclid, fbclid, first_touch:{...}}`, `landing_url`, `referrer`.
- postMessage (iframe -> host, `source: 'crm-demo'`): `ready`, `height`, `booked`, `rescheduled`, `cancelled`, `redirect`, `escape`. The host fires window events `crm-demo:booked` etc. and pushes `crm_demo_booked` to `dataLayer` if present.
- Booking sends `too_fast` once -> the widget silently waits 3.2 s and retries. `slot_taken` -> back to the slots with fresh data and a message.
- Manage links honour `?action=reschedule|cancel`. The page never sets framing headers (the `framing` hook does).
- **Found while testing on the bench (backend)**: `crm_addons.demos.public.book` answers 500 `OperationalError (1305, 'SAVEPOINT demo_booking does not exist')` on Frappe 15.121 (some step inside the booking commits or rolls back, which drops the savepoint). The admin screens were therefore checked with bookings inserted directly.

## Backend notes and answers (backend agent)
- **Implemented from the admin UI list above**: `get_client_config.demos_enabled` (always 1); `/demos` redirect; `list_bookings` `filters.owner`; `list_demo_types` also returns
  `provider`, `bookings_month` (bookings starting this month, not cancelled) and `next_slot` (UTC ISO or null); `send_test_message(demo_type, event, minutes_before=0, channel="Email")`
  (managers; sample data; goes to the manager's own email or `mobile_no` / `phone`) -> `{message}`; `set_my_demo_outcome(booking, outcome)` (`Completed` / `No Show`; the person must take part
  in the demo, managers can for any) -> `{ok, status}`; `list_meetings(..., demos_only=1)` and, per demo row, `demo_type_title`, `demo_utm_source`, `demo_utm_medium`, `demo_utm_campaign`.
- **`OperationalError 1305 SAVEPOINT demo_booking does not exist`** (reported by the widget agent) is fixed: it came from the first version of the booking code restarting the transaction
  after the savepoint. A booking now takes a named database lock per owner, restarts the (still read-only) guest transaction, and only then sets the savepoint.
- Double booking is stopped three times: the availability check, a per-owner lock that makes bookings for the same people queue up (so the check and the write cannot interleave),
  and the unique `slot_key`. Whoever loses gets `slot_taken`. MariaDB 11.6+ (snapshot isolation) can also refuse a statement with "try restarting transaction" while two bookings overlap; that is
  reported as `slot_taken` as well.
- `owner_notify`: when on, the first owner gets an in-app CRM notification for a new / moved / cancelled demo (the other owners and the lead's owner are told by the meeting itself).
- `my_demos` returns a plain list (not paged), earliest first; a Sales User always gets just their own demos, even with `scope="all"`.
- Framing: Frappe 15 itself sends no `X-Frame-Options`; some production nginx setups add one (`add_header X-Frame-Options "SAMEORIGIN"`), which the app cannot remove (not checked on a production nginx here). With `frame-ancestors`
  present, current browsers ignore `X-Frame-Options`; if an old browser must work, delete that nginx line for `location /book`. Checked over HTTP on the bench: `/book/<slug>` answers
  `Content-Security-Policy: frame-ancestors 'self' <allowed origins>` and no `X-Frame-Options`; an unknown slug answers `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`.
- Migration: `bench migrate` adds the module, the doctypes, the CRM Meeting fields, the Lead first-touch fields and the indexes. No data is seeded.


## Ready-made messages (defaults)
- `demos/defaults.py` is the single list: for each message rule (Confirmed, Rescheduled, Cancelled, Reminder 24 h / 1 h / 30 min / at the start) it names the library
  email template (added by `campaigns/default_templates.py`, category Transactional) and holds the Utility WhatsApp template definition (name, body with {{1}}..., sample values,
  variable map to the demo variables).
- A new demo type (`CRM Demo Type.use_default_messages`) fills every *empty* rule: email template + email on; WhatsApp only when the default template is APPROVED on this site.
  Existing demo types: the Messages tab offers **Use ready-made messages**. A choice already made is never replaced.
- WhatsApp: `admin.default_messages()` returns each rule's default with its state (NOT CREATED / PENDING / APPROVED / REJECTED); `admin.create_default_whatsapp_template(event, minutes_before)`
  submits it through `campaigns.api.create_whatsapp_template` (frappe_whatsapp sends it to Meta). Managers only.
