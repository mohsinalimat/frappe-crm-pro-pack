# Changelog

All notable changes to CRM Pro Pack (the `crm_addons` Frappe app).

## Unreleased

### Added

- **Demo booking: the backend** (module *Demos*, `crm_addons/demos/`; design and API in [docs/DEMO_BOOKING.md](docs/DEMO_BOOKING.md), admin steps in the Admin guide).
  Demo types (owners, weekly hours, date overrides, notice, horizon, buffers, per-day cap, form fields, message rules, branding, allowed websites), bookings with UTM
  attribution, a slot engine that is correct across time zones and daylight saving and blocks on every owner's CRM Meetings, one CRM Meeting per booking through the same
  code as *Schedule meeting* (Google Meet and Calendar, owners and CC invited, the first owner organizes), Lead matching by email then phone (new Lead gets source,
  status, owner and first-touch UTMs), reschedule and cancel by token, and **no double booking under concurrency** (per-owner lock plus a unique slot key).
- **Booking messages**: confirmation, reschedule, cancel and reminders (default 24 h, 1 h, 30 min and at the start) by email and WhatsApp, built from the campaign template
  library with new variables (`demo_title`, `demo_date`, `demo_time`, `demo_datetime`, `demo_duration`, `meet_link`, `host_name`, `host_names`, `booking_link`, `reschedule_link`,
  `cancel_link`), in the visitor's time zone. Sent every minute by the scheduler, exactly once, a failure is recorded on its own row; WhatsApp needs consent and honours STOP.
- **Spam protection** without CAPTCHA or OTP: phone and email validation (India 10 digits by default), disposable email domains, one upcoming demo per contact, per-IP limit
  (only a hash of the IP is stored), honeypot and a minimum fill time (signed token).
- **Manager API and UTM report** (`crm_addons.demos.admin`), **My demos** for Sales Users (only the demos they take part in), a **Demos** flag on CRM Meetings
  (`is_demo`, `demo_type`, `demo_booking`) and *First UTM Source / Medium / Campaign* on new Leads.
- `/book/<slug>` can be framed only by the websites listed on the demo type (`Content-Security-Policy: frame-ancestors`); every other page keeps its protection.

### Changed

- The campaign email and WhatsApp sending code now has two small shared helpers (`queue_email`, `send_whatsapp_template`) that the demo messages reuse; campaign behaviour is unchanged.

- **Demo booking: public booking widget.** `/book/<slug>` and `/book/manage/<token>` (calendar, time slots with 12h/24h and time-zone search, form with country-flag phone
  field, guests and WhatsApp consent, confirmation with Google / .ics calendar links, reschedule and cancel). Branded per demo type (logo, accent colour, light/dark/auto),
  keyboard accessible, mobile friendly. `embed.js` opens it as a pop-up (or inline) from any website with `data-crm-demo="slug"` and passes the visitor's first-touch UTMs.

## 1.4.0 - 2026-10-21

**Upgrade (self-hosted admin):** `bench --site your-site migrate`, then `bench restart`. Migrate adds one field to the campaign email templates and copies
existing templates to CRM's own Email Template list and back (see below); the restart loads the new permission rules. No `bench build` is needed.
Everyone should hard-refresh the CRM once (Ctrl/Cmd + Shift + R) after this release; from then on a release loads fresh by itself (see *Fixed*).

### Added

- **A Sales User only sees their own data, enforced on the server.** Leads (CRM's own rule, plus the same rule here for CRM versions that have none), Call Logs,
  Notes, Tasks, Follow-ups and Meetings: the lists, direct opens and the Follow-ups, Sales Dashboard and report APIs all refuse another person's records.
  A record also counts as theirs when it is attached to a lead they own or are assigned. Sales Managers, System Managers and Administrator are unchanged; a
  *Campaign Manager* only keeps CRM's own access to leads, calls, notes and tasks unless they also hold a Sales role.
- **Follow-ups panel for a Sales User:** a **Today's work** tab (the calls and follow-ups they logged today), a **Today** column (calls made today on that lead and
  when), and the Remark column. The owner and "Everyone" filters are gone for Sales Users (the server ignores them as well).
- **WhatsApp: Create template** in the campaign panel. It saves frappe_whatsapp's own *WhatsApp Templates* document, whose own code submits it to Meta (no Meta calls
  in Pro Pack). Name, category, language, header (text, image or document), body with numbered variables and example values, footer and buttons, with a live
  preview. Status (Pending, Approved, Rejected) is shown on every template; **Sync status from Meta** (and *Check status with Meta* in the details) uses frappe_whatsapp's
  own sync. Sales Managers, Campaign Managers and System Managers only. Each variable can be **tied to a lead field** (first name, organization, owner ...) while you create the template; that mapping and the header image / document are kept with the template (a new field on frappe_whatsapp's template, added by migrate), so a campaign step that picks the template starts with the variables filled in and the header file attached. The phone preview shows the header image, the filled-in values and the buttons.
- **Email template builder:**
  - **Switch editor type** from any type to any other, inside the editor, keeping the content, with a warning before any conversion that loses formatting.
  - **Text formatting in the visual builder:** bold, italic, underline, font, size, colour, alignment, links, bullet and numbered lists for Text blocks; font, size, bold / italic / underline and a link for Headings.
  - **One Row block with any number of columns (1 to 6).** Add or remove columns with + and -, and pick the content of each column (heading, text, image, button, divider, spacer, social links, custom HTML) right in the column or in the side panel. Optional line between columns; the columns shrink with the screen and stack on a phone where the mail app supports it.
  - **Eight ready-made templates** (welcome, follow-up after a call, missed call, admissions promotion, event invitation, newsletter, announcement, session reminder), added to the library on migrate as editable Visual Builder templates (and so to CRM's Email Template list). You own them afterwards.
  - **HTML editor: Image** button (upload, a file already on the site, or a web address), inserted at the cursor.
- **Lead assignment (System Managers only).** A new *Assignment* page of its own (CRM left menu and `/assignment`; not part of the Campaign Manager; see [docs/ASSIGNMENT.md](docs/ASSIGNMENT.md)):
  - Built like the Campaign Manager: a left menu (Rules, Assign leads now, Move leads, History), rules as cards with an on/off switch, and **Undo** for 24 hours in History. Each form reads like a sentence; the rule asks only for the leads and the people (the sharing choice appears once you pick two or more) and can give the matching leads that have no owner to them at the same time.
  - **Rules** on any Lead field and any mix of conditions (all of them or any of them) give **new leads** to people, by round robin, by least workload (open leads plus follow-ups to do) or to all of them together (the first is the owner). A lead that matches several rules goes to everyone they name; saving a rule that can overlap another asks first.
  - **Assign existing leads** from a rule or from conditions typed in (all matching, or only those with no owner), with a count first.
  - **Move leads**: everything one person has goes to one or more others.
  - CRM notifies the new people; no email is sent. Every assignment is in *History*. Bulk jobs over 300 leads run in the background.
- **Campaign and CRM email templates are one set.** A template saved in the campaign builder also appears in CRM's Email Template list (the one used when mailing a lead by hand), and a template made or edited there for Leads
  comes back into the campaign library. HTML, styles, tables and images are copied untouched; `{{ first_name }}`, `{{ organization }}` and the other lead fields work in both places, and `{{ owner_name }}`, `{{ sender_name }}`, `{{ today }}`
  and `{{ lead_url }}` are written out as the Jinja CRM can evaluate. Archiving a campaign template switches its CRM twin off.

- **WhatsApp Create template, second pass:** the name / category / language row lines up; the body has a WhatsApp formatting bar (bold `*`, italic `_`, strikethrough `~`, monospace, bullets, numbered list, quote, emoji picker) and the preview shows bullets and quotes; the Variables section has column headings and says what each value means; the name is checked live against Meta's rules (lower case, numbers, underscores) and must be new **for that language** (the same name in another language is allowed; a suggestion such as `name_v2` is offered).
- **Sales Dashboard: "Leads assigned by person"** (Sales Managers and System Managers): open leads each person owns, how many are still New, how many were added in the period and their statuses, with an Unassigned row. It shows up on its own for people who already customized their layout.

- **Campaign email templates did not appear in CRM's "Email Templates" picker** (the one on a Lead's email box). Two causes: the copy into CRM's list only starts after `bench migrate` (it needs the new field), and CRM's picker keeps a saved copy of its list and never looks again by itself. Pro Pack now notices when a Lead template was added or changed (also when you come back to the CRM tab) and tells the picker to reload, so a new template shows up without a hard refresh.

- **Pro Pack screens open as pages of the CRM, not pop-ups.** Sales Dashboard, Follow-ups, Meetings, Campaigns and Assignment now fill the area to the right of CRM's own menu: the menu stays, its row is highlighted, and the address becomes `/crm/pro-pack-<name>`, so Back, reload and sharing the link work. Clicking any CRM menu row (Notifications too) leaves the page, the page keeps starting at the menu's edge when the menu folds or opens, and each page keeps its open-in-a-new-tab button. Small forms (a meeting, a follow-up) and screens narrower than 900 px still open as pop-ups.

- **Left menu: order and visibility, set by the administrator.** On the setup page (*CRM screens*), put CRM's own entries (Notifications, Dashboard, Leads, Deals, Contacts, Organizations, Notes, Tasks, Call Logs) and this app's (Sales Dashboard, Follow-ups, Meetings, Campaigns, Assignment) in any order, and switch any of them off. Applies to everyone, only hides and reorders (pages and permissions are untouched), nothing in CRM is moved (the menu is re-ordered with CSS), and "Back to CRM's own order" undoes it. Needs `bench migrate` (one new setting).

- **Sales Dashboard: many more counts.** New cards for *Total leads*, *Open leads* and *Leads with no owner*, and charts that count all leads by any field you choose (state, industry, source, type ...; left empty it picks the usual ones it finds). The administrator can also name **highlighted counts** (for example "Schools" where Industry is School, "Private colleges" where Type is Private) that show as number cards. A sales user only sees counts of their own leads. Set on the setup page, section *Sales Dashboard counts*; the existing "Leads assigned by person" table is there too.
- **Default views for everybody.** Setup page, section *Default views*: for Leads, Contacts and Organizations the administrator sets whether the page opens as list or Kanban (Kanban exists in CRM for Leads only), the list columns, sort order, default filters and the quick-filter boxes, and for Leads the Kanban column field, card title and card fields. *Save and apply to everyone* writes them as each person's own CRM view; a person who changes their view keeps theirs (tick *replace the views people have changed* to override). People who open the CRM later get them on first load. Needs `bench migrate`.
- **One header for every Pro Pack page** inside the CRM: a 56 px bar with the title, a short line beneath and the actions on the right.

### Changed

- **Campaign results on the Sales Dashboard** are the same company-wide numbers for everyone (a Sales User used to see only their own campaigns).
- **Dashboards can only be customized by Sales Managers and System Managers**: the Customize button is gone for Sales Users and the server refuses the layout calls.
- **The attachment limit is 30 MB** (was 10 MB), read from one place on the server (`campaign_max_attachment_mb`, default 30, never more than Frappe's own *Max File Size* from System Settings) and shown by the screens from the same value.
- **Editors no longer scroll as a whole page.** The code, the canvas, the settings panel and the preview each scroll on their own, so the toolbar and subject stay in place while you scroll a long preview. The builder palette is a tile grid.
- Selection in the builder: one block or column is selected at a time, a click outside the builder or Escape deselects, and nothing stays selected after switching editor.

### Fixed

- **Image alignment in the visual builder** (left, centre, right) did nothing when the image filled its row; images are now placed inline, so the alignment applies at any width.
- **Create campaign missing** for the people who should have it: the screen asked for the campaign settings and the audience fields together, so when the second call failed no one was treated as a manager and every Create button stayed hidden. The two are now independent. The button on the Reports and Campaigns dashboard pages is also hidden for Sales Users only.
- **Features not showing until a refresh.** CRM is an installable app whose service worker keeps serving the page it saved, including the script tag of an older Pro Pack release. Now every file URL carries the release and the newest file time, the page is marked `no-cache`, and the Pro Pack script compares itself with the server's version: when it is running old files it loads the new ones under a new address, tells the service worker to look for an update, and replaces the old copy without duplicating anything. The CRM is also looked at again for the first 45 seconds (it draws after our script loads), when the tab comes back into view, and the settings are re-read every 5 minutes. **If Pro Pack still has not started 8 seconds after the CRM loads** (an old saved copy of the page, a script that did not download), the page clears the browser's saved copy of the CRM (its service worker and caches) and reloads once on its own; if it is still missing it shows a "CRM Pro Pack did not load" bar with a **Reload** button. On a Leads list or Lead page the CRM's own Pro Pack scripts also start it directly, even when the page itself carries no Pro Pack tag.

## 1.3.0 - 2026-10-12

### Added

- **Campaign Manager role.** Only System Managers, Sales Managers and the new *Campaign Manager* role can create, edit and duplicate campaigns,
  automations and templates, and they see every campaign. Sales Users can only look (campaigns, results, reports, dashboards): the server refuses
  the writes and the Campaign Manager screens hide the buttons and open the list instead of an editor. A new setup-page option, *Who sees the Campaigns shortcuts*, lets you tick the roles
  that see the Campaigns button and menu link in CRM (nothing ticked: everyone).
- Campaign records are now read-only for Sales Users, and clicks can be read by Sales Managers, Sales Users and Campaign Managers (Sales Users no
  longer get "unable to read campaign").

**Upgrade:** run `bench --site your-site migrate` (it creates the role and updates the permissions), then in Desk give the marketing user the roles
**Sales User** and **Campaign Manager** (the CRM Users screen only shows Admin, Manager and Sales User). Campaigns a Sales User created earlier stay
visible to them but they can no longer edit them; a Campaign Manager can.

## 1.2.0 - 2026-10-10

### Changed

- **Sales Dashboard and Campaigns dashboard are customizable.** *Customize* opens a drawer to show or hide each number and chart, reorder them (grip, arrows or
  drag) and set each chart's width. The layout is saved per user, with *Reset to default*. *Lead Nurturing* is now **Campaigns**, with its own Excel and CSV export.
- **Deals are left out when you do not use them.** With *Hide Deals menu* on, "Converted to deals" disappears from the dashboard, the funnel and the exports.
- **Follow-ups** opens straight onto the list; the big Overdue / Due today / Upcoming cards are gone (the tabs carry the counts, with the connect rate beside them).
- **Automation editor** shows the flow on the left and one step's settings on the right, so it fits one screen. Save buttons stay in a top bar.
- **Email previews:** the phone preview is a real phone shape (the email scales to fit), the desktop preview a browser window.
- **Campaign Manager redesign:** flatter layout, indigo and marigold palette, Instrument Sans, tighter audience step, better template builder.
- Pop-ups (such as *Insert variable*) now stay inside the window.
- The demo lead everywhere is Siddharth Singh.
- **Hide the Calls, Tasks and Notes tabs on Lead pages** (three new switches in the setup page, under *Things to hide*).
- **The same look on the setup page, the Meetings page, and the Schedule meeting and Add follow-up windows**: indigo and marigold, 6px controls, no
  all-caps labels, a plain date column in the agenda, and the setup checklist as one ruled list.

## 1.1.1 - 2026-10-09

### Fixed

- **Insert variable did nothing** (email subject, HTML editor, rich-text editor, email builder, anywhere the *Insert variable* button appears). The button's click
  handler was shadowed by the pop-up's own `open` flag, so the list never opened. The drop-down used everywhere else had the same mix-up in a milder form (its
  search box was not cleared and focused on opening); both are fixed.
- **Every automation run and every lead-update rule logged a spurious error** ("log() got multiple values for argument 'event'"): the diagnostics call used a
  keyword that clashed with the function's own parameter. The actions themselves had run, but the Error Log filled up. Fixed, and the diagnostics `log()` now
  accepts any keyword. The tests now fail if the campaign code writes to the Error Log without being asked to.
- **An automation could be "On" with no messages going out** if its managed campaign was cancelled or ended from the Campaigns page. Saving the automation now
  starts a fresh campaign (the old one stays as an ordinary campaign with its results).

## 1.1.0 - 2026-10-08

### Added: Automations (replaces "automatic campaigns" and the per-campaign lead updates in the wizard)

- **Automations** section in the Campaign Manager (side panel). Several can exist, each with an On switch: *when* (lead created, status changed, replied,
  clicked, opened or read, bounced, opted out; optionally for one campaign's messages) -> *only for leads that match* (optional filters or a saved
  segment; no lead list is chosen) -> *then* an ordered list of actions (send messages, set status, create a follow-up, add a note). Start from
  an idea (welcome new leads, follow up on a reply, act on interest). Backend: `campaigns/automation.py`, doctypes *CRM Campaign Automation*,
  *CRM Automation Action*, *CRM Automation Run* (one row per lead and automation = once per lead).
- "Send messages" keeps one managed campaign (send mode Trigger, `CRM Campaign.automation`), so sending, hours, tracking, retries and reports are the
  campaign engine's. Off pauses it, on resumes it; once leads joined, its steps can be edited or extended but not removed or reordered. It is
  hidden from the Campaigns list and opened from the automation (*Messages and results*).
- The campaign wizard no longer has the *Automatic* option or the *Update the lead automatically* card (existing automatic campaigns and rules keep working).

### Changed: Campaign Manager screens

- **Audience step:** a compact mode switch instead of three big cards; one-click quick filters (Status, Source, Organization type, Territory, Lead owner, Has
  email, Has phone, Created) with the full filter builder under *More filters*; smaller text; the matching-leads summary is one slim bar with a
  collapsible, compact sample table.
- **Previews:** the desktop preview is drawn in a window frame and the mobile preview as a phone (bezel, status bar, home bar, scrolls inside); the
  WhatsApp preview is smaller; the preview step has a tidier toolbar and test card.
- **Brand icon restored** in the left panel. The earlier overflow was a CSS rule (`.brand span`) that overrode the tile's centring; fixed at its root.
- **Menu order and names:** Sales Dashboard first, then Follow-ups, Meetings, Campaigns, in the left menu, header group and floating buttons. The separate
  *Lead Nurturing* link is gone; it is a view inside the Sales Dashboard.

### Added: a proper setup page

- **`/pro-pack-setup`** (`public/setup/`, backend `setup_page.py`). Options grouped by area with real toggle switches, an (i) button on every
  option (what it does, an example, a warning where it matters), options that depend on a switch locked with the reason, number validation
  before saving, search, one Save bar (Ctrl/Cmd+S) that sends only what changed, and a **setup checklist** with what still needs doing, why, the
  steps, and buttons to the right place (Google, Email Account, WhatsApp Account), a Google connection test and a jump to the setting. New
  checks: background worker for the campaign queue, WhatsApp account, default country code. System Managers only. The classic form still works
  and links to the new page.

### Added: Campaign Manager growth features

- **Link click tracking** (`campaigns/tracking.py`). Web links in campaign emails are rewritten per recipient to a signed address on your own site
  (HMAC of recipient and destination with the site key, so it is not an open redirect and clicks cannot be forged). A click is recorded, counts as
  an open, and shows in the numbers and a *Most clicked links* table. Per-campaign switch; the copy kept on the lead keeps the real links.
- **Sending hours** (`journey.window_open`). Optional per campaign: from / until in the campaign's time zone, optionally Monday to Friday. The
  dispatcher claims nothing outside the hours and a batch in flight stops when they end; the campaign page says when sending resumes.
- **Lead updates** (`campaigns/rules.py`, child table *CRM Campaign Rule*). When a lead replies (WhatsApp or email), clicks, opens, bounces or
  opts out: set the lead status, create a follow-up for the lead owner, or add a note. Each event runs once per lead and campaign (one guarded
  `UPDATE`), and a failing rule never breaks the event that triggered it. A WhatsApp "STOP" is not counted as a reply.
- **List clean-up** (`campaigns/hygiene.py`). Permanent failures (hard email bounces, rejected or spam-marked mail, numbers that are not on WhatsApp)
  go on the opt-out list (sources *Bounce* and *Invalid Number*) so later campaigns skip them; soft bounces and temporary errors never do. A
  *List clean-up* page lists them, restores one, and scans earlier failures.
- **Health alerts** (`campaigns/health.py`, every 5 minutes). A running or paused campaign with a high recent failure rate, a refused login or
  no way to send gets a banner and a notification to its owner (not repeated for six hours). Thresholds are in CRM Addons Settings.
- **Pause one step.** A step can be paused and resumed on its own; rows already claimed go back in line. *Retry failed* already existed.
- **Calendar view** of campaigns (start, running span, follow-up step days); days on which more than one campaign sends are flagged.
- **Automatic campaigns** (`campaigns/triggers.py`, send mode *Trigger*). Launched once; every Lead that is created, or reaches a status, and
  matches the audience joins once. Follow-up days count from the day the lead joins and reply checks look from that day. The campaign never
  "completes"; Pause and Cancel work as usual. Enrolment never raises into the save of the Lead.
- **Cost and results** (`campaigns/roi.py`). Message prices in CRM Addons Settings (email; WhatsApp marketing / utility / authentication);
  cost = messages sent x price. Deals created from the leads reached after the campaign started, deals won, revenue and return on spend.
  A *Cost* column in Reports.
- Index on the recipient's lead (`recipient_id`), used by reply and rule lookups.

### Fixed in the same release

- The collapsible left panel from the previous change was missing its state in `app.js`, which would have stopped every Campaign Manager screen
  from rendering. It is in place now and the screens are exercised by an automated page test.
- *Save as campaign template* failed for a campaign with sending hours (a time value is not JSON); it is saved as text now.

### Changed: Campaign Manager left panel

- The panel header reads "Campaign Manager" (no overflowing icon), the panel can be collapsed to icons only (remembered per browser), and **Settings** is shown only to the Administrator and System Managers.

### Fixed: email and WhatsApp previews

- Plain email content now has a margin inside the preview frame instead of touching its edge, the frame follows late-loading images, and the WhatsApp preview has room for its header image and buttons without clipping.

### Fixed: freezes and slow pages

- **Recipient report and CSV export.** With a date range (the pages remember their last range, so this was the default) `list_recipients`
  fetched the name of every recipient in the range and sent them all back to the database as one `IN (...)` list: a multi-megabyte query for
  every page and for each of the up to 250 steps of the CSV export. It is now one bounded query with the range in its `WHERE`.
- **Audience scan on every edit.** The eligibility numbers read every matching lead inside the web request, again for each change of the
  audience, and a request the browser had abandoned kept running on the server. A result up to 45 seconds old is now reused while editing.
  Launching still scans afresh.
- **Reply counts.** The Reports overview recomputed replies per campaign, and the campaign page on every 8-second refresh. A result up to a
  minute old is reused. Saved-segment counts are reused for 45 seconds.
- **WhatsApp send with no time limit.** `frappe_whatsapp` calls Meta without a timeout, so one unresponsive request held a send worker until
  its 30-minute limit. The call now has a time limit (10 s to connect, 30 s to answer). A connect timeout is retried; a read timeout is failed,
  not retried, because Meta may have accepted the message.
- **Refresh timers.** The campaign list and campaign page refresh now skip a turn while the previous refresh is still running, so a slow server
  is not buried in requests.
- **HTML editor.** *Validate* and *Format* (and the highlighter's comment and variable patterns) rescanned the text from every unclosed `<`:
  300 KB of such input froze the tab for about 9 seconds. They are now a single pass (milliseconds), with identical results on valid input.

### Added: temporary diagnostics

- `debuglog.py` and `public/debug.js` log requests, background jobs, send results, stalls (with the stack trace of the stuck code), memory,
  blocked browser threads, DOM-change storms, slow requests and errors to `<bench>/logs/crm_addons_debug.log` and the console. A page that
  froze or crashed is reported by the next page load. See `docs/DEBUGGING.md` (including how to switch it off and remove it).


### Added

- **Campaign Manager** for Email and WhatsApp campaigns: audience (filters, saved segments, selected leads) with an
  eligibility summary, email templates, frappe_whatsapp template selection with variable mapping and preview,
  scheduling, rate-limited background sending with pause / resume / cancel / retry, duplicate protection, opt-out
  list and unsubscribe link, delivery and read tracking from Meta webhooks and Frappe's mail records, per-campaign
  analytics, a recipient report, campaign history on each Lead, duplicate campaign and campaign templates.
  Campaigns can be multi-step journeys: steps on later days across both channels, each with an optional condition
  on the previous step (sent, read or opened, not read or opened, failed or skipped) and an optional stop when the lead replies.
  See `docs/CAMPAIGN_MANAGER.md`.
- Meetings, Follow-ups, Campaigns, Lead Nurturing (opens the Sales Dashboard on its `#nurturing` tab; only with
  Campaign Manager enabled) and Sales Dashboard shortcuts in CRM's left menu and in the Dashboard header
  (setting: *Show links in the side menu*). The rows are copies of CRM's own menu rows placed after the last native
  entry (no heading, same spacing, icon size and stroke); the header shortcuts are one segmented control copied from
  CRM's own Refresh button, icons only below 1100px and a single "..." menu below 800px.
- Settings *Hide "Notes" / "Tasks" / "Call Logs" from the CRM side menu* (`hide_notes_menu`, `hide_tasks_menu`,
  `hide_call_logs_menu`), the same as the existing Deals one. They only hide the entry (and saved views under it);
  the pages stay reachable. Existing sites get them (off) on the next migrate.
- New settings (Campaign Manager section), a `WhatsApp Opt-in` field on CRM Lead, and a *Campaigns* button, tab and
  workspace shortcut. Nothing existing is changed.
- **Follow-ups workspace**: the follow-up queue is now a full-screen page (`/followups`, `followups.html`) built like
  the Sales Dashboard, replacing the small modal. KPI cards and tabs (Overdue, Due today, Upcoming, Done), search,
  owner / outcome / due-date filters, list and by-day views, click-to-call, log / mark done / reschedule / open lead,
  bulk mark done and reschedule, skeleton, empty and error states, and the CRM's light / dark theme. Managers see
  everyone's follow-ups by default; sales users only their own. New endpoints `followups.get_workspace`,
  `followups.reschedule_follow_up` and `followups.bulk_update`; `get_queue` is unchanged. `window.crmAddons.openFollowUps(hash)`
  in the bridge, and `window.crmAddonsUI.openQueue()` now opens the page.
- **Lead Nurturing** tab in the Sales Dashboard (`#nurturing`, shown when the Campaign Manager is enabled): campaign KPI
  cards, sends by day and channel, engagement funnel, Email vs WhatsApp, campaigns by status, top campaigns and leads
  nurtured. New whitelisted `dashboard.get_nurturing(from_date, to_date, user)`, loaded only when the tab is opened and
  scoped to the user's own campaigns unless they are a manager.

- **Pop-ups everywhere**: the Sales Dashboard, Lead Nurturing, Follow-ups and Campaigns now open the same way as the Meetings
  calendar, as a large pop-up over the CRM (iframe with `embed=1` and the CRM's theme; the hash is passed through, e.g.
  `dashboard.html?...#nurturing`, campaigns `#/c/NAME`), with **Open in a new tab** and Close buttons; the new tab keeps the tab,
  date range, filters and theme and drops `embed`. `crmAddons.openDashboard / openFollowUps / openCampaigns(hash)` keep their
  names. One pop-up at a time; backdrop click, Esc, Back and the page's own Close remove it; lead links from inside move the
  CRM tab (also when the server's host name differs from the address in use).
- **Shared date range picker** (`meetings/range-picker.js`, `window.CRMRangePicker`) for the Sales Dashboard and the Follow-ups
  page: keyboard support (arrows, PageUp / PageDown, Home / End, Esc, focus returns to the button), viewport-safe, a tooltip and
  note that says which days the previous period is, "Yesterday" and "Last week" on the Follow-ups page, the range of a new tab in
  the URL. The Sales Dashboard follows the CRM's theme (the `theme` key CRM keeps in the browser) and its toggle is gone.
- Tests for the date boundaries (records at 00:00:00 and 23:59:59 of the first and last day and just outside them) for the Sales
  report and its export, Lead Nurturing, the Follow-ups page and the CRM dashboard card.
- **Campaign Manager as a CRM pop-up**: opened like the Meetings calendar (iframe over CRM, `?embed=1`) with *Open in a new tab* and
  *Close* (also Esc, which never competes with a dialog, drawer, menu or the date picker) in a small top-right cluster; the page fills the
  frame, the left rail always spans its full height (the content scrolls in its own pane), *Back to CRM* is hidden and lead links make the
  CRM tab navigate (`postMessage` `close` / `navigate`). Closing keeps your work: a named draft is saved first, an unsaved template asks.
- **One date range picker for the whole Campaign Manager** (Today ... This year, Any time, one- or two-month calendar with range selection and
  hover, From / To boxes, keyboard support, viewport-safe, light / dark) on the campaign list, the campaign page (numbers, charts and recipient
  report), and Reports (with a *Compare to previous period* change on every KPI card and the chosen range written under the title). The last
  range of each screen is remembered. `get_analytics` and `list_recipients` now take `from_date` / `to_date`; `get_config` returns the site's clock
  (`now`) so "today" is the site's day, not the browser's.
- New app icon (accent gradient rounded square with a white paper plane, the same in light and dark) and a favicon for the page.

### Changed

- **Campaign Manager redesigned** as a premium, theme-following app (left rail, no theme toggle): campaigns grid / list with filters and
  delivery mini-stats, a five-step create flow with a live summary and draft autosave, a visual audience builder with live eligibility and
  "why excluded", saved segments (Audiences), a shared Email Templates library with a visual block builder, HTML editor and rich text editor
  (previews in a desktop / mobile email frame), a WhatsApp Templates page with chat-bubble previews, Meta note, Refresh and Sync from Meta,
  test sends, attachments, a scheduling and two-step launch confirmation, a campaign page with KPIs, SVG charts, a journey table and a
  recipient report with CSV export, and a Reports page comparing campaigns. Existing campaigns, templates and APIs keep working.
- New fields (added by migrate, no data patch): `CRM Campaign Email Template.category`, `.editor_mode`, `.builder_json`; `CRM Campaign Step.attachments`.
- New endpoints: `crm_addons.campaigns.analytics.get_overview(from_date, to_date)` (cross-campaign totals, by channel and day, top campaigns) and, in
  `crm_addons.campaigns.api`, `audience_insight`, `list_segments`, `save_segment`, `delete_segment`, `search_field_values`, `list_email_templates`,
  `delete_email_template`, `render_email_preview`, `render_email_template`, `send_test_email`, `send_test_whatsapp`, `list_whatsapp_templates`,
  `sync_whatsapp_templates`. `list_campaigns` now takes `channel`, `from_date`, `to_date`, `sort` and returns delivery numbers; `get_analytics` also returns
  `replied` and `timeline`; `preview_step` accepts `sample=1`.
- Email steps and templates can carry attachments (default limit 10 MB per email, setting `campaign_max_attachment_mb`), checked on save, launch and send.
- **Report ranges are whole days in the site's time zone, end day included to the last fraction of a second** (they used `<= 23:59:59`). A message belongs
  to a range by its activity (sent, else failed, else created), so Reports totals, the per-day chart, the funnel, the comparison table, the status chart
  and the recipient report all describe the same messages (the totals used to follow the row's creation day and the chart the sending day).

### Fixed

- The "Meetings", "Meetings in the period" and call-rate cards of the CRM dashboard compared with a previous period that was one
  day too short (a 7-day range was compared with 6 days). Now the previous period is as long as the current one.
- The layer inside the CRM page could leave you without a way out: a pop-up opened while one of CRM's own dialogs had locked the
  page (`pointer-events: none` on the body) could not be clicked, Esc did not close it when the focus was outside the frame, it
  stayed over the next page after Back, a message from a page that had just been closed could close the next pop-up, the floating
  buttons left a listener behind each time they were redrawn, a failed request for the CSRF token was remembered for ever and
  `bridge.js` could be added more than once. Requests now give up after 25 seconds, the observer ignores changes made by the
  add-on itself, and the retry for the Dashboard header is bounded.
- Deleting the last follow-up of a lead failed with "Column 'addons_call_attempts' cannot be null".
- The Sales Dashboard's bar chart could show repeated axis labels for small totals (for example 3, 5, 5, 8, 10).
- **Campaign Manager "gets stuck"** (found by driving the real page with a random clicker): the first
  calls of a page opened outside CRM raced to fetch a CSRF token and one of them was rejected; requests had no time limit, so one hung call left a spinner,
  *Saving* or a disabled button for ever (they now give up after 60 s); a second confirm dialog replaced the first one's answer, leaving its caller waiting
  for ever; superseded audience counts, previews and lists kept running and filled the browser's connections so the next click waited behind them (the latest
  one now wins, the older ones are cancelled); a dialog removed in the same tick it appeared could leave the page's scroll lock and Esc handler behind; the
  template library, picker and previews created a scaled iframe per template at once (now only visible ones, one every 60 ms); the HTML editor built one element
  per line and re-coloured the whole source on every key (now a text node, colours trail large sources and are skipped above 120 KB); the visual builder
  re-rendered every block on each drag event.

## 1.0.0 - 2026-09-30

First public release. Built and tested on Frappe v15 with Frappe CRM 1.x.

### Added

- **Meetings**
  - Google Meet and Google Calendar meetings created from a Lead, with guests, invitations, reminders
    and a calendar (Agenda, Month, Week, Day).
  - A Manual Link provider for any Zoom, Teams or other URL, with a calendar file emailed to guests.
  - Meeting outcomes (Held, No Show, Rescheduled) with notes and an optional next follow-up.
- **Follow-ups**
  - Call follow-ups with a call outcome, lead status, remark and next follow-up date.
  - Attempt counting, reminders, escalation after repeated missed calls, a follow-up queue, editable
    quick-fill templates and an optional WhatsApp message after a missed call.
- **Lead intelligence**
  - A 0-100 lead score (Hot, Warm, Cold) and stale-lead alerts.
  - Lead list and Kanban card fields: Next Follow-up, Last Call Outcome, Last Follow-up Remark,
    Call Attempt, Next Meeting, Lead Score.
- **Sales Dashboard**
  - A full-screen, role-aware dashboard (sales users see their own numbers, managers see the team)
    with KPI cards, daily activity, call outcomes, lead funnel, calls by hour, team table, pipeline,
    sources, queue and recent calls.
  - Date range dropdown with presets and a calendar, light and dark theme, and export to Excel or CSV.
- **Inside CRM**
  - Meetings and Follow-ups tabs on the Lead page, header buttons, Kanban buttons, timeline comments
    and charts for CRM's own dashboard, all without changing CRM's code.
  - Optional switches to hide the Deals menu entry and the Convert to Deal button (off by default).
- **Admin**
  - A Desk workspace, a setup checklist with a Google connection test, and a settings page for every
    behaviour. Everything the install sets up is idempotent and removed on uninstall.

### Compatibility

- Frappe v15 (tested). Every Frappe API used also exists on v16 and the v17 development branch.
- Frappe CRM 1.x. CRM 2.0 (Frappe 16 or newer) is best-effort.

## 1.2.0 - 2026-10-10 - fixes
- Fixed a frozen, blank tab: the Campaign Manager and the Meetings calendar, opened standalone, re-applied their theme attribute to
  a MutationObserver watching that same attribute (in a standalone tab the "parent" is the page itself). Any `storage` event
  (CRM writes localStorage constantly) or switching back to the tab started an endless loop. The theme is now only written when it
  changes and the page never observes itself.
- The Campaign Manager now shows the reason on screen (and a Reload button) if it cannot start, instead of a blank page.
