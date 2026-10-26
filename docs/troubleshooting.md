# Troubleshooting

Find your symptom. Server errors also appear in **Error Log** in Desk; the red message in a page is the server's own error. More detail for Google problems is in [ADMIN_GUIDE.md](ADMIN_GUIDE.md#troubleshooting).

## Installation and screens

| Symptom | Cause and fix |
|---|---|
| No buttons, tabs, menu rows or "CRM Pro Pack" at all | Run `bench --site your-site.com clear-cache`, restart the bench, hard-refresh (Ctrl/Cmd + Shift + R). CRM is an installable app that caches its page: if Pro Pack has not started 8 seconds after CRM loads, it clears CRM's saved copy and reloads once, then shows a "CRM Pro Pack did not load" bar with a **Reload** button. Then check Error Log. |
| A field, doctype, setting or option looks missing after an update | **Migrate is needed:** `bench --site your-site.com migrate`, then `bench restart`. Several releases add doctypes, hidden fields and settings only on migrate (for example 1.4.0's template mirror and WhatsApp variable mapping). |
| Tabs missing but buttons work | CRM's tab markup differs from what the app expects (tabs are built by cloning CRM's own). Open an issue with the HTML of CRM's tab bar. |
| A window opens blank or shows an error | Hard-refresh; files are versioned, so a stale cache should not remain. |
| Hidden Deals menu reappears after a CRM update | Check the two hide switches; open an issue with the menu's HTML. |
| Campaign templates missing from the email picker on a lead | Run migrate (the copy into CRM's Email Template list starts after it), then reload the CRM tab. |
| Assignment link missing | It is shown to System Managers only. |

## Campaigns

| Symptom | Cause and fix |
|---|---|
| "No Email Account is set as the default for outgoing mail" or every email fails | **The default outgoing Email Account is missing.** Frappe's mail queue needs an Email Account with *Enable Outgoing* **and** *Default Outgoing* ticked. Having an outgoing account that is not the default still makes every send fail. Fix it under Desk > Email Account; the setup checklist shows the same message. |
| Campaign stays Scheduled / Queued and nothing is sent | The scheduler is off (`bench --site your-site.com enable-scheduler`) or no worker listens to the `long` queue. The setup checklist checks both. |
| Messages sit in Pending | Outside the campaign's **Sending hours**, or the per-minute rate limit is reached, or the campaign is paused. |
| WhatsApp template cannot be picked | Only templates whose status is Approved can be chosen. Use **Sync status from Meta**. A template with variables also needs example values. |
| WhatsApp lead skipped: "not opted in" | The default consent mode requires the WhatsApp Opt-in box on the lead, or consent confirmed on the campaign. See [opt-outs and consent](campaigns.md#opt-outs-and-consent). |
| Lead skipped: variable empty | The lead has no value for a mapped variable; that lead is skipped with the reason shown. |
| WhatsApp failure after sending with no detail | `frappe_whatsapp` records only the status word for a late failed callback; failures at send time carry Meta's message. |
| No "Opened" numbers for email | Switch on *Track Email Status* on the outgoing Email Account, or enable click tracking in the campaign's advanced options. |
| "Campaign health" banner | The failure rate in the last hour passed the threshold, a login was refused or no outgoing account exists. Fix the cause, then **Retry failed** (only messages that never reached the provider are re-queued). |
| A Sales User cannot create a campaign | By design; give them the **Campaign Manager** role in Desk, then run `bench migrate` once if the role does not exist yet. |

## Meetings, reminders, Google

| Symptom | Cause and fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google Cloud differs from the one shown in the settings. Copy it exactly. |
| "Google rejected the saved login" / Meet links stop after a week | The consent screen is in Testing, where logins expire after 7 days. Publish the app (or use an Internal one) and authorize the Google Calendar again. |
| A meeting has no Meet link | "Add a video meeting" was off, or no calendar is connected; the meeting's details say which. |
| Reminders or stale alerts never arrive | The scheduler is off, or there is no outgoing Email Account (the in-app notification still arrives). `bench --site your-site.com scheduler status`. |
| A sales user cannot see a meeting | They did not create it and were not invited as a team member. |

## Still stuck?

1. Check **Error Log** in Desk.
2. For freezes, switch on the diagnostics described in [DEBUGGING.md](DEBUGGING.md).
3. Open an issue at <https://github.com/sidrajputt/frappe-crm-pro-pack/issues> with your Frappe and CRM versions, the steps and the exact error text. Do not paste secrets, tokens or customer data.
