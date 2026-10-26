# Roles and permissions

Everything here is enforced on the server (lists, direct links, reports, exports and the APIs behind the screens). The screens only hide what you cannot use. The rules live in `permissions.py`, `campaigns/permissions.py` and `utils.py`.

## The roles

| Role | Meaning |
|---|---|
| **System Manager**, **Administrator** | Full access, plus the setup page and lead assignment |
| **Sales Manager** | Sees the whole team's data, customizes dashboards, runs campaigns |
| **Campaign Manager** (created on install and every migrate) | Builds and runs campaigns, automations and templates; sees every campaign. Give it together with **Sales User** |
| **Sales User** | Works their own leads; can look at campaigns but not create them |

"Managers" in the code means System Manager, Sales Manager and Administrator. "Campaign managers" means those plus the Campaign Manager role. The CRM Users screen only offers Admin, Manager and Sales User, so assign **Campaign Manager** in Desk (*User* > Roles).

## Who can do what

| | Sales User | Campaign Manager | Sales Manager | System Manager / Administrator |
|---|---|---|---|---|
| Leads, call logs, notes, tasks | Only their own (see below) | CRM's own access, unless they also hold a Sales role | All | All |
| Follow-ups | Own; no owner picker | Own, like a Sales User | All, narrow to one person | All |
| Meetings | Those they created, organize or were invited to; edit only their own | Own | All | All |
| Sales Dashboard (Sales tab) | Own numbers only | Own numbers only | Whole team or one person | Whole team or one person |
| Sales Dashboard (Campaigns tab) | Company-wide campaign numbers | Same | Same | Same |
| Customize a dashboard | No | No | Yes | Yes |
| See campaigns, results, reports | Campaigns they own or run | All | All | All |
| Create, edit, duplicate, launch campaigns | No | Yes | Yes | Yes |
| Create and change automations, email templates | No | Yes | Yes | Yes |
| Create WhatsApp templates, sync from Meta | No | Yes | Yes | Yes |
| Pause, resume, cancel, retry failed | On campaigns they own | Yes | Yes | Yes |
| Lead assignment page | No | No | No | Yes |
| Setup page (`/pro-pack-setup`) | No | No | No | Yes |

## "A Sales User only sees their own data"

For a Sales User the server adds a condition to **CRM Lead, CRM Call Log, Note (FCRM Note), CRM Task, CRM Follow Up and CRM Meeting**: a record is theirs when they own it, were assigned to it or took part in it, **or** it is attached to a lead they own or are assigned (so a lead's timeline stays complete after it is reassigned). Frappe CRM's own rule for leads is used when it exists; Suite Pro adds the same rule only for CRM versions that have none. The Follow-ups, Sales Dashboard and report APIs refuse another person's records too: opening `/followups?owner=someone-else` or `/sales-dashboard?user=someone-else` still shows only your own.

## Who sees the Campaigns shortcuts

Separately from permissions, the setup page option *Campaign Manager > Who sees the Campaigns shortcuts* lets you tick the roles that see the Campaigns button and menu link in CRM. Nothing ticked means everyone sees them. This is cosmetic: someone who opens `/campaigns` is still held to the table above.

## Recipes

- **Marketing person:** Sales User + Campaign Manager.
- **Read-only observer of campaigns:** Sales User.
- **Hand leads to people automatically:** a System Manager creates [assignment rules](lead-assignment.md).

For a hands-on check of every row of this table with real users, follow [TEST_CHECKLIST.md](TEST_CHECKLIST.md).
