# Meta (Facebook and Instagram) lead ads

Connect your lead ads so every lead lands in Leads within seconds, with the campaign, ad set and ad it came from. Everything is managed in the CRM under **Settings, Integrations, Meta**; the same steps are in the **Setup guide** button there.

How it works: Meta posts a notice to your CRM the moment someone submits a lead form. The CRM verifies the notice (signed with your app secret), fetches the lead from Meta, saves it as a CRM Lead with the source **Facebook** or **Instagram**, and records it in the log. A person who is already a lead is not duplicated: a note is added to the existing lead, its owner is notified, and the lead page offers **Update details** with one click. Every hour the CRM also asks Meta for the last three days of leads, so a missed notice never loses a lead. Failed leads can be retried.

## Before you start

- You need admin access to the Facebook Page that runs the lead ads, and to the Meta Business account that owns it.
- Everything below is done in Meta. Nothing here creates or changes anything at Meta except subscribing your Page to new leads.

## 1. Create a Meta app

- Create app, choose **Other**, then type **Business**. Name it, for example, "CRM Lead Sync", and attach your Business account.
- Open **App settings, Basic** and copy the **App ID** and the **App secret**. You will paste both in the Connection box here. The secret lets the CRM check that a notice really came from Meta.
- Add the **Webhooks** product to the app.

[Open Meta for Developers](https://developers.facebook.com/apps)

## 2. Make a system user and a permanent token

- Add a system user with the role **Admin**, for example "CRM".
- Choose **Add assets**: give it your **Page** (full control) and your **app** (full control).
- Choose **Generate new token**, pick your app, set the expiry to **Never**, and tick: **leads_retrieval**, **pages_show_list**, **pages_read_engagement**, **pages_manage_metadata**, **pages_manage_ads**. Also tick **ads_read** and **business_management** if you want campaign and ad names on every lead.
- Copy the token now: Meta shows it once. Paste it in the Connection box here.

[Open Business Settings, System users](https://business.facebook.com/settings/system-users)

## 3. Let the CRM read your leads

- Under **Integrations, Leads access** choose your Page, open the **CRMs** tab and assign your app. Without this Meta refuses to hand over the lead details.

[Open Business Settings, Leads access](https://business.facebook.com/settings/leads-access)

## 4. Connect the CRM

- Paste the token, App ID and App secret in the **Connection** box here and choose **Save**, then **Test connection**.
- The test lists every permission with a tick or a cross, and tells you how many Pages the token can reach. Fix anything that has a cross, then test again.

## 5. Send new leads to the CRM instantly

- In your app open **Webhooks**, choose the **Page** object and **Subscribe to this object**.
- Paste the **Callback address** and the **Verify token** shown in the "Instant leads" box here, then **Verify and save**.
- In the list of fields, subscribe to **leadgen**.
- Connecting a form here also subscribes your Page to new leads, so this is the only manual webhook step.

[Open your app, Webhooks](https://developers.facebook.com/apps)

## 6. Choose your forms

- Choose **Add a form**, pick the Page and the lead form, then match each question to a CRM field. Name and email or phone are required. Questions you do not match are still kept in a note on the lead.
- Leads from Instagram get the source **Instagram**, the rest **Facebook**. Each lead keeps its campaign, ad set and ad.

## 7. Test it

- Press **Test** on a form here first: it checks the Page, the form, the instant subscription and shows how a sample lead would be saved, without creating anything.
- Then in Meta's testing tool choose your Page and form and press **Create lead**. It should appear under "Recent Meta leads" here and in Leads within seconds. Delete the test lead in Meta's tool afterwards.

[Open Meta's Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing)

## 8. Going live

- For real ads, switch the app to **Live** mode (App settings, Basic needs a privacy policy address). While it is in development mode Meta only sends notices for people with a role on the app.
- If a notice is ever missed, the CRM asks Meta for the last three days of leads every hour, so nothing is lost. Failed leads can be retried here.

## Permissions the token needs

| Permission | Used for | Required |
|---|---|---|
| leads_retrieval | Read the leads from your forms | yes |
| pages_show_list | List the Pages the token can use | yes |
| pages_read_engagement | Read the Page and its forms | yes |
| pages_manage_metadata | Receive new leads instantly (webhook) | yes |
| pages_manage_ads | Read lead forms and leads of the Page | yes |
| ads_read | Campaign, ad set and ad names on the lead | optional |
| business_management | Use Pages that belong to a Business Manager | optional |

## Where the data goes

- Leads: source Facebook or Instagram, plus Meta Lead Form, Meta Campaign, Meta Ad Set and Meta Ad (and their IDs) on the lead.
- Log: Bookings, Log, filter **Meta ads**.
- Sales Dashboard: the **Meta lead ads** widget (leads and deals by campaign), also in the Excel export.

## Troubleshooting

- **Test connection shows a red cross**: that permission is missing from the token. Generate a new token with it ticked.
- **No Page found**: add the Page as an asset to the system user.
- **Leads do not arrive instantly**: check the app is Live, the Webhooks subscription has the field leadgen, and Leads access assigns your app to the Page. Leads still arrive within the hour through the catch-up.
- **A lead failed**: the reason is shown next to it; press Retry.
