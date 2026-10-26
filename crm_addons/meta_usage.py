"""What Meta says about the connected WhatsApp number: the daily messaging limit, the quality rating and what was charged recently.

Read-only, from the default outgoing WhatsApp Account's own credentials. Whatever Meta does not return (an account without
analytics access, a token without the permission, no network) is reported as "not available" with the reason, never guessed.
The token is used here and never sent to the browser.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cstr, get_datetime, today

TIERS = {
	"TIER_50": "50 customers a day", "TIER_250": "250 customers a day", "TIER_1K": "1,000 customers a day", "TIER_10K": "10,000 customers a day",
	"TIER_100K": "100,000 customers a day", "TIER_UNLIMITED": "Unlimited",
}


def _account():
	from crm_addons.campaigns.common import default_whatsapp_account

	name = default_whatsapp_account()
	if not name:
		return None
	doc = frappe.get_doc("WhatsApp Account", name)
	return doc


def _get(account, path, params):
	import requests

	base = cstr(account.url or "https://graph.facebook.com").rstrip("/")
	version = cstr(account.version or "v17.0").strip("/")
	token = account.get_password("token")
	res = requests.get(f"{base}/{version}/{path}", params=params, headers={"Authorization": f"Bearer {token}"}, timeout=(8, 20))
	body = {}
	try:
		body = res.json()
	except ValueError:
		pass
	if res.status_code >= 400:
		err = (body.get("error") or {}) if isinstance(body, dict) else {}
		raise RuntimeError(cstr(err.get("message") or f"Meta answered {res.status_code}")[:200])
	return body


def get_usage(days=30):
	"""{available, account, tier, limit_text, quality, charges: {...} | None, notes: [..]}. Never raises for Meta problems."""
	account = _account()
	if not account:
		return {"available": False, "reason": _("No active default outgoing WhatsApp account is set up.")}
	out = {"available": True, "account": account.name, "tier": None, "limit_text": None, "quality": None, "charges": None, "notes": []}
	if account.phone_id:
		try:
			info = _get(account, cstr(account.phone_id), {"fields": "messaging_limit_tier,quality_rating,display_phone_number"})
			out["tier"] = info.get("messaging_limit_tier")
			out["limit_text"] = TIERS.get(cstr(out["tier"]), cstr(out["tier"]) or None)
			out["quality"] = info.get("quality_rating")
			out["number"] = info.get("display_phone_number")
		except Exception as exc:
			out["notes"].append(_("The daily limit is not available: {0}").format(cstr(exc)))
	else:
		out["notes"].append(_("The WhatsApp account has no phone number id, so the daily limit is not available."))
	if account.business_id:
		try:
			end = get_datetime(today())
			start = get_datetime(add_days(today(), -int(days)))
			spec = f"pricing_analytics.start({int(start.timestamp())}).end({int(end.timestamp())}).granularity(MONTHLY).dimensions([\"PRICING_CATEGORY\"])"
			data = _get(account, cstr(account.business_id), {"fields": spec})
			points = ((data.get("pricing_analytics") or {}).get("data") or [{}])[0].get("data_points") or []
			by = {}
			for p in points:
				cat = cstr(p.get("pricing_category") or "OTHER")
				row = by.setdefault(cat, {"messages": 0, "cost": 0.0})
				row["messages"] += int(p.get("volume") or 0)
				row["cost"] += float(p.get("cost") or 0)
			out["charges"] = {"days": int(days), "by_category": by, "currency": cstr(data.get("currency") or "")}
		except Exception as exc:
			out["notes"].append(_("Charges are not available: {0}").format(cstr(exc)))
	else:
		out["notes"].append(_("The WhatsApp account has no business account id, so charges are not available."))
	return out
