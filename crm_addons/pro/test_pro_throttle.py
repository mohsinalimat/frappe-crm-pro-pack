import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons.pro import throttle


class TestThrottle(FrappeTestCase):
	def test_calls_over_the_budget_are_refused_with_429(self):
		frappe.local.request_ip = "203.0.113.9"
		for _ in range(3):
			throttle.check("unit", limit=3)
		with self.assertRaises(frappe.TooManyRequestsError):
			throttle.check("unit", limit=3)
		self.assertEqual(frappe.local.response.get("http_status_code"), 429)

	def test_another_address_has_its_own_budget(self):
		frappe.local.request_ip = "203.0.113.10"
		for _ in range(3):
			throttle.check("unit2", limit=3)
		frappe.local.request_ip = "203.0.113.11"
		throttle.check("unit2", limit=3)
