# Integrations

All of these live in **Settings, Integrations** (System Managers). Each page has a connection card, a **Test connection** button, a short setup guide and a log with a date range.

## Email

Choose the provider that sends your mail: **Gmail**, **Amazon SES**, **Outlook**, **Microsoft 365**, **Yahoo**, **Yandex**, **SendGrid**, **SparkPost** or **any SMTP server**. The page creates (or updates) the outgoing Email Account Frappe uses, lets an administrator switch the sending account, and tests the connection. Passwords are stored by Frappe, never shown again, and can be replaced or removed.

For **Amazon SES** the page also gives the address of a signed notice endpoint: point an SNS topic at it and bounces, complaints and deliveries are recorded on the recipient, so reports and the opt-out list stay right. The endpoint is rate limited and checks Amazon's signature.

## WhatsApp

Connect, edit, switch, test and disconnect the WhatsApp numbers used through `frappe_whatsapp`, with the full details of each (account, phone number ID, status). See [WhatsApp Business](whatsapp-business.md).

## Calendar

Connect Google Calendar from the page: paste the OAuth client, sign in with Google, and the company calendar is created for you. Reconnect or disconnect at any time. A log lists every meeting sync with a retry for the ones that failed. Step by step: [Meetings and Google Meet](meetings-google.md).

## Meta lead ads (Facebook and Instagram)

Connection, instant leads by webhook, lead forms with a field mapping, recent leads and a full log. The lead keeps its campaign, ad set and ad. Full guide: [META_LEAD_ADS.md](META_LEAD_ADS.md).

## Webhook safety

The public Meta and Amazon SES endpoints verify a signature, and are limited per address per minute so a flood cannot slow the site.
