"""Meta usage: shows what Meta returns and says "not available" for the rest (no network in tests)."""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons import meta_usage


class TestMetaUsage(FrappeTestCase):
	def acct(self, **kw):
		d = {"name": "A", "url": "https://graph.facebook.com", "version": "v19.0", "phone_id": "111", "business_id": "222"}
		d.update(kw)
		return frappe._dict(d, get_password=lambda f: "secret")

	def test_no_account(self):
		with patch.object(meta_usage, "_account", return_value=None):
			self.assertFalse(meta_usage.get_usage()["available"])

	def test_limit_and_charges(self):
		def fake(account, path, params):
			if path == "111":
				return {"messaging_limit_tier": "TIER_1K", "quality_rating": "GREEN"}
			return {"pricing_analytics": {"data": [{"data_points": [{"pricing_category": "UTILITY", "volume": 10, "cost": 0.5}]}]}}

		with patch.object(meta_usage, "_account", return_value=self.acct()), patch.object(meta_usage, "_get", side_effect=fake):
			out = meta_usage.get_usage()
		self.assertEqual((out["limit_text"], out["quality"]), ("1,000 customers a day", "GREEN"))
		self.assertEqual(out["charges"]["by_category"]["UTILITY"], {"messages": 10, "cost": 0.5})

	def test_a_refusal_is_reported_not_raised_and_secret_not_returned(self):
		with patch.object(meta_usage, "_account", return_value=self.acct()), patch.object(meta_usage, "_get", side_effect=RuntimeError("no permission")):
			out = meta_usage.get_usage()
		self.assertIsNone(out["charges"])
		self.assertEqual(len(out["notes"]), 2)
		self.assertNotIn("secret", frappe.as_json(out))
