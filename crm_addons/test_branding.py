"""Branding: one place writes the name, logos, login page and footer to every record that holds them."""

import frappe
from frappe.tests.utils import FrappeTestCase

from crm_addons import branding, setup_page


class TestBranding(FrappeTestCase):
	def setUp(self):
		self.before = branding.get_branding()
		self.addCleanup(lambda: branding.save_branding(self.before))

	def test_save_reads_back_and_reaches_every_place(self):
		out = branding.save_branding({"name": "Acme CRM", "logo": "/files/acme.png", "favicon": "/files/fav.png", "copyright": "Acme", "hide_signup": 1})
		self.assertEqual((out["name"], out["logo"], out["favicon"], out["copyright"], out["hide_signup"]), ("Acme CRM", "/files/acme.png", "/files/fav.png", "Acme", 1))
		self.assertEqual(frappe.db.get_single_value("Website Settings", "app_name"), "Acme CRM")
		self.assertEqual(frappe.db.get_single_value("Website Settings", "favicon"), "/files/fav.png")
		self.assertEqual(frappe.db.get_single_value("Navbar Settings", "app_logo"), "/files/acme.png")
		if frappe.get_meta("FCRM Settings").has_field("brand_name"):
			self.assertEqual(frappe.db.get_single_value("FCRM Settings", "brand_name"), "Acme CRM")

	def test_bad_input_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			branding.save_branding({"nope": "x"})
		with self.assertRaises(frappe.ValidationError):
			branding.save_branding({"logo": "javascript:alert(1)"})
		with self.assertRaises(frappe.ValidationError):
			branding.save_branding({"logo": "/files/a\"onerror=\"x.png"})
		out = branding.save_branding({"logo": "/files/My logo (1) \u00e9.png"})  # spaces, brackets and accents are fine in a file name
		self.assertEqual(out["logo"], "/files/My logo (1) \u00e9.png")
		with self.assertRaises(frappe.ValidationError):
			branding.save_branding({"name": "x" * 200})

	def test_text_is_stripped_of_markup_and_reset_gives_the_default_look(self):
		out = branding.save_branding({"name": "<b>Acme</b><script>x</script>"})
		self.assertNotIn("<", out["name"])
		out = branding.reset_branding()
		self.assertEqual((out["name"], out["logo"], out["favicon"]), ("", "", ""))

	def test_only_system_managers_may_use_the_endpoints(self):
		user = frappe.get_doc({"doctype": "User", "email": "brand.rep@example.org", "first_name": "B", "roles": [{"role": "Sales User"}]}).insert(ignore_permissions=True)
		self.addCleanup(frappe.delete_doc, "User", user.name, force=True, ignore_permissions=True)
		self.addCleanup(frappe.set_user, "Administrator")
		self.addCleanup(setattr, frappe.flags, "in_test", frappe.flags.in_test)
		frappe.flags.in_test = False  # Frappe's only_for() lets everyone through while tests run; check it for real
		frappe.set_user(user.name)
		for fn, args in ((setup_page.get_branding, ()), (setup_page.save_branding, ("{}",)), (setup_page.reset_branding, ())):
			with self.assertRaises(frappe.PermissionError):
				fn(*args)


class TestImageLibrary(FrappeTestCase):
	def test_lists_public_images_only_and_filters_by_name(self):
		png = frappe.get_doc({"doctype": "File", "file_name": "brand-lib-test.png", "content": b"\x89PNG\r\n\x1a\n" + b"x" * 20, "is_private": 0}).insert(ignore_permissions=True)
		txt = frappe.get_doc({"doctype": "File", "file_name": "brand-lib-test.txt", "content": b"hello", "is_private": 0}).insert(ignore_permissions=True)
		priv = frappe.get_doc({"doctype": "File", "file_name": "brand-lib-private.png", "content": b"\x89PNG\r\n\x1a\n" + b"y" * 20, "is_private": 1}).insert(ignore_permissions=True)
		for d in (png, txt, priv):
			self.addCleanup(frappe.delete_doc, "File", d.name, force=True, ignore_permissions=True)
		names = [r["file_name"] for r in branding.image_library("brand-lib")]
		self.assertIn("brand-lib-test.png", names)
		self.assertNotIn("brand-lib-test.txt", names)
		self.assertNotIn("brand-lib-private.png", names)
		self.assertEqual([r["file_name"] for r in branding.image_library("no-such-file-xyz")], [])
