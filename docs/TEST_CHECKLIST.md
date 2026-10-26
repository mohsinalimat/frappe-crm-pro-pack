# Test list by role (release 1.5.0)

Use three real users: **Sales User** (call them Asha), a second **Sales User** (Ben) who owns different leads, a **Campaign Manager** (Cara, with the Sales User role too) and a **Sales Manager** (Meera). Give Asha and Ben at least one lead, one logged call, one follow-up and one note each. Hard-refresh the CRM (Ctrl/Cmd + Shift + R) once before you start.

## Sales User (Asha)

**Must work**
1. Leads list shows only Asha's leads. Kanban the same.
2. Follow-ups: tabs *Today's work*, *Overdue*, *Due today*, *Upcoming*, *Done*. *Today's work* lists the calls and follow-ups logged today with lead, phone, status, organization, last call outcome, remark, next follow-up and the **Today** call count. There is **no** owner or "Everyone" picker.
3. Log a call on a lead: it appears under *Today's work* with the remark.
4. Sales Dashboard: only Asha's calls, connected calls and numbers; **no Customize button**; the *Campaigns* tab shows the company-wide numbers (the same figures Meera sees).
5. Campaigns: can open the list, a campaign, Reports and templates; **no** Create campaign / Create automation / Create template / Create audience buttons anywhere (list, empty states, Reports, dashboard Campaigns tab).
6. WhatsApp templates page: sees the templates, **no** Create template or Sync button.

**Must fail (try each)**
7. Open Ben's lead by address (`/crm/leads/<Ben's lead id>`): not found / no permission.
8. In Desk, `/app/crm-call-log`, `/app/fcrm-note`, `/app/crm-task`, `/app/crm-follow-up`: only Asha's rows. Open one of Ben's by name (`/app/crm-follow-up/<id>`): refused.
9. Follow-ups page opened as `/followups?scope=all&owner=ben@example.com`: still only Asha's.
10. Sales Dashboard opened as `/sales-dashboard?user=ben@example.com` (or the API `crm_addons.reports.get_sales_report?user=ben@example.com`): still only Asha's numbers.
11. API `crm_addons.dashboard.save_layout` / `reset_layout`: permission error. `crm_addons.campaigns.api.create_whatsapp_template`, `save_email_template`, `save_campaign`: permission error.

## Campaign Manager (Cara)

1. Campaigns list shows **Create campaign** (right after the page loads, without a refresh). Create, edit, duplicate, launch a campaign; create an automation.
2. WhatsApp templates: **Create template** (tie `{{1}}` to a lead field; the example fills in; the phone preview shows header image and values; use the template in a campaign step: the variables and the header file are already there) with a text header, a body with `{{1}}` and `{{2}}` plus example values, a footer and a quick-reply button. It appears as *Pending*. Missing example values or a wrong name is refused with a clear message before anything reaches Meta. **Sync status from Meta** updates it to Approved / Rejected once Meta has decided.
3. Email templates (each of Visual builder, HTML, Rich text):
   - **Change type** in the editor: switch to each other type; the confirmation says whether formatting is lost; the content is kept.
   - Library: eight ready-made templates (welcome, follow-up, missed call, admissions, event, newsletter, announcement, reminder) are listed and open in the visual builder.
   - Visual builder: one **Row** block; use + / - for 1 to 6 columns and pick the content of each column; Image alignment left / centre / right at 50% width; Text block with bold, italic, underline, font, size, colour, alignment, link, bullet and numbered lists; Heading font / size / bold / italic / underline; a **3 images in a row** block and a 2 column row with a line between columns; preview on Mobile (columns shrink or stack).
   - Selection: click a block, click another (only one is highlighted); click outside the builder or press Escape (nothing is highlighted); switch editor type (no leftover selection).
   - Scrolling: in the HTML and Rich text editors scroll the preview; the subject and toolbar stay put.
   - HTML editor: **Image** button (upload, a file on the site, a web address) inserts at the cursor.
   - Rich text: H1, H2, bold and italic still work.
   - Attach a 25 MB file in each editor type (accepted); a 35 MB file is refused and the screen says "30 MB".
4. Send a test email; merge fields `{{ first_name }}`, `{{ organization }}`, `{{ owner_name }}` are filled.
5. In CRM open a lead, **Email**, **Insert template** (the template picker): the template saved in step 3 is listed and renders the same with the lead's name, organization and owner. Edit it there, save, and the campaign library shows the edit. Make a new CRM email template for Leads: it appears in the campaign library.
6. Sales Dashboard *Campaigns* tab opens and shows company-wide numbers (needs Sales User as well).

## Sales Manager (Meera)

1. Sees every lead, follow-up, call, note, task and meeting; Follow-ups opens on *Everyone* and the owner picker narrows to one person.
2. Sales Dashboard: whole team or one person; **Customize** works and saves; Export works.
3. All Campaign Manager steps above that create or edit things (campaigns, automations, email templates, WhatsApp Create template and Sync).
4. Sales Dashboard *Campaigns* tab shows the same numbers as Asha.

## After an upgrade

1. `bench --site <site> migrate` then `bench restart`.
2. Open the CRM in a browser that had it open before the upgrade, **without** a hard refresh, and wait about a minute: the Pro Pack buttons and tabs still appear and no button is doubled. (After this first 1.4.0 load, later releases update themselves the same way.)
3. In CRM, open Settings > Email Templates: every campaign template is listed, and no template existed twice.

4. Watchdog: in the browser's developer tools block `/assets/crm_addons/addons.js` (Network > Block request URL) and open the CRM: after about 8 seconds the page reloads once by itself, and if the script is still blocked a "CRM Pro Pack did not load" bar with a Reload button appears. Unblock it and press Reload: everything appears and the bar does not come back.

## System Manager: lead assignment

1. The **Assignment** link shows in CRM's left menu for a System Manager, and for nobody else (Sales Manager and Campaign Manager do not see it; `/assignment` shows "Only System Managers can assign leads"; the API refuses). It is not in the Campaign Manager's side panel.
2. Create a rule "Bihar" (State = Bihar) to two people, round robin; create two new Bihar leads: they go one to each. Create a lead from Kerala: untouched. Both people get a CRM notification; no email arrives.
3. Create a rule "School" (Industry = School) to a third person with *All of them together*. The page warns that it can share leads with "Bihar"; agree. A new Bihar school lead is owned by the first person of "Bihar" and also assigned to the others; each of them can open it, nobody else can.
4. *Least workload*: give one person many open leads; new leads go to the other.
5. **Assign existing leads** on a rule: preview count, "only leads with no owner" versus "all matching", the clash warning when leads also match another rule, and the result in *History*.
6. **Assign leads now** with typed conditions, and **Move leads** from A to B, C: A no longer sees the leads, B and C do, in turn.

## Demo booking (backend)

Automated, on a bench with a test site: `bench --site <site> run-tests --module <module>` for each of
`crm_addons.demos.doctype.crm_demo_booking.test_demo_booking` (slot math without a database: weekly hours, date overrides, minimum notice, horizon, daylight saving start and end, the spring-forward gap, zones ahead of UTC;
phone / email / form-token / IP-hash rules; owners' meetings block slots, all owners, cancelled meetings, buffers, per-day cap, booked slot disappears, visitor-zone labels, range cap; booking creates lead, one meeting, attendees,
Meet link; Google missing or failing; lead match by email then phone and first-touch UTMs only on a new lead; double booking, the unique key alone, shared owners across demo types; reschedule frees the old slot and refuses a taken one;
cancel frees it; started demos cannot change; repeat-contact and per-IP limits; required fields; guests; the team cancelling / moving / closing the meeting in CRM),
`...test_messages` (rows and due times, too-soon reminders skipped, WhatsApp without consent skipped, reschedule re-plans, cancel drops the waiting rows; wording in the visitor's zone, sent once, claim once, reminders at their time,
started demo, failure isolated per row, no email account, resend, WhatsApp consent and STOP, unsubscribe list does not block email, unapproved template, stuck Sending, empty rendering; campaign variables),
`...test_api` (guest API shape and secrecy, full journey as Guest, error codes, honeypot, fill time, token isolation, ics, hashed IP, throttle; every manager function refuses a Sales User; create / edit / duplicate / delete and validation;
bookings list filters; booking detail and status; resend; embed code; permissions for Sales User, guest of the meeting, manager; report numbers; framing headers; hooks, route rules, fields and indexes; screen support),
`...test_concurrency` (real threads and connections: two or five visitors for one slot, different slots, two demo types with a shared owner, a move against a new booking, two workers for one message; this module commits and deletes its own data).
133 tests. Run them on a test site without an outgoing Email Account (see the note in the Campaign Manager doc).

Manual, with a real Google calendar, SMTP and Meta WhatsApp (not covered by the automated tests, which fake all three):

1. Create a demo type with two owners and a CC address; book a slot from `/book/<slug>`: one Google event, both owners and the CC invited, the first owner organizes, a Meet link, the confirmation email and WhatsApp arrive, the Lead shows the UTMs, the meeting shows in **Meetings > Bookings**.
2. Book from a phone whose time zone differs from the demo's: the email shows the visitor's time and zone name.
3. Reschedule and cancel from the links in the messages; Google's event moves / disappears; the old slot is free; a reminder planned for the old time does not arrive.
4. Embed `embed.js` on a second site that is listed under *Websites that may embed this page*, and on one that is not: the first shows the pop-up, the second shows a blocked frame.
5. Reply STOP to a WhatsApp message: later reminders for that number are skipped; the confirmation email is still sent.
6. Disconnect Google: the booking still works, the meeting says *Not synced*, the visitor gets the fixed link.
7. As a Sales User, **My demos** shows only your demos, and the Bookings admin API and page refuse you.


## Team and access

Automated: `crm_addons.team_access.test_access` (the registry, precedence override > preset > role default, admins cannot be limited, bad values refused, "My team" from the Sales Hierarchy using a stand-in table
when the CRM has none, the manager API and its permissions, presets, the password reset call) and `crm_addons.team_access.test_enforcement` (follow-ups, meetings, the dashboard report, demos and widgets,
lead assignment, and every Campaign Manager part at each level). Browser scripts under `crm_addons/team_access/tests_ui/`: `access_ui_test.js` (the screens) and `restricted_user_ui_test.js`
(a real limited user: template designer, view-only templates, widgets, assignment, meetings).

Manual (needs CRM with a Sales Hierarchy, which CRM 1.74 does not have):

1. In CRM Settings > Sales Hierarchy build boss -> lead -> two reps. In Team and access give the lead *Follow-ups: My team*: the lead sees their reps' follow-ups and the "My team" picker, the boss's and others' stay hidden.
2. Give a rep the **Template Designer** preset: the Campaign Manager menu shows only the two template screens; a campaign cannot be created or listed; the API refuses.
3. Give a person *Assignment: History only*: the Assignment page shows only History.
4. Set *Bookings: Own only* for a host: the Bookings page and the Bookings tab of Meetings show only their demos; switch the tab off and it disappears.
5. Reset a password from a person's panel: the email arrives.
