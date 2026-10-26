# Getting started

About 15 minutes from a bench with Frappe CRM to a working Frappe CRM Suite Pro.

## 1. Requirements

| Component | Supported | Notes |
|---|---|---|
| Frappe Framework | v15 (developed and tested on) | The Frappe APIs the app uses also exist on v16 and the v17 development branch, so newer versions are allowed (`pyproject.toml` says `>=15.0.0,<18.0.0`) but not tested. |
| Frappe CRM | 1.x (`main` branch) | CRM 2.0 needs Frappe 16 or newer and is best-effort. |
| Python | 3.10 - 3.12 | |
| Database | MariaDB | PostgreSQL is not supported. |
| For WhatsApp campaigns | the `frappe_whatsapp` app, an Active default WhatsApp Account and approved templates | Email-only sites work without it. |
| For email campaigns | an outgoing Email Account | |
| Background jobs | the scheduler and at least one worker | Campaign sending and reminders run as background jobs. |

## 2. Install

```bash
cd ~/frappe-bench
# only if CRM is not on the site yet
bench get-app crm --branch main
bench --site your-site.com install-app crm

bench get-app https://github.com/sidrajputt/frappe-crm-pro-pack --branch main
bench --site your-site.com install-app crm_addons
bench --site your-site.com migrate
bench build --app crm_addons        # only if the assets were not linked
bench restart
```

Then hard-refresh the CRM in the browser (Ctrl/Cmd + Shift + R). For WhatsApp campaigns also install `frappe_whatsapp` (`bench get-app https://github.com/shridarpatil/frappe_whatsapp`, then `install-app frappe_whatsapp`) and connect your WhatsApp Account as its own documentation describes.

Update later with `bench update --apps crm_addons`, then `bench --site your-site.com migrate` and `bench restart`.

## 3. First-time setup (the setup page)

Open **`/pro-pack-setup`** as a System Manager. It starts with a live checklist and shows what is missing and how to fix it:

![The setup page with the checklist](images/setup-page.png)

| Check | Why it matters |
|---|---|
| Google Meet and Calendar | Needed for Meet links only. Skip it to begin with Manual Link meetings. See [Meetings and Google Meet](meetings-google.md). |
| Outgoing email | Campaign emails, reminders and invitations. Needs an Email Account with "Enable Outgoing" ticked, and a default outgoing account. |
| Scheduler | `bench --site your-site.com enable-scheduler` |
| Background worker for campaigns | At least one worker must be running for the `long` queue (shown only with the Campaign Manager on) |
| WhatsApp | Active default WhatsApp Account in `frappe_whatsapp` (optional) |
| Default country code | Added to WhatsApp numbers of up to 10 digits that have no country code, for example `91` |

## 4. Give people roles

Roles are set in Desk (**User**). The CRM Users screen only offers Admin, Manager and Sales User, so give the extra role in Desk.

| Person | Roles |
|---|---|
| Sales team member | Sales User |
| Sales lead | Sales Manager |
| Marketing person who builds campaigns | Sales User **and** Campaign Manager |
| Administrator who sets things up and assigns leads | System Manager |

The full matrix is in [Roles and permissions](roles-and-permissions.md).

## 5. A 15-minute tour

1. **Look around CRM.** The left menu now has Sales Dashboard, Follow-ups, Meetings, Campaigns and (System Managers) Assignment. A Lead page has Meetings and Follow-ups tabs.
2. **Log a call.** Open a lead, click **Add Follow Up**, pick the outcome, set the next follow-up. See [Follow-ups](follow-ups.md).
3. **Open the Sales Dashboard** and change the date range. See [Sales Dashboard](sales-dashboard.md).
4. **Send your first email campaign** to three test leads you own. See [Campaigns](campaigns.md#your-first-email-campaign).
5. **Add an assignment rule** so new leads go to the right person. See [Lead assignment](lead-assignment.md).
6. **Optional: connect Google** and schedule a Meet. See [Meetings and Google Meet](meetings-google.md).

![Campaign Manager](images/campaigns-list.png)

## 6. Tidy the screens (optional)

On the setup page a System Manager can reorder or hide the left menu, set default list or Kanban views for everybody, and choose which counts the Sales Dashboard shows. All of it only changes what people see; permissions do not change. Every setting is explained in the [Settings reference](settings-reference.md).

## Next

[Campaigns](campaigns.md) - [Troubleshooting](troubleshooting.md) - [FAQ](faq.md)
