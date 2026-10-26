"""Keeping junk bookings out without a CAPTCHA or an OTP: phone and email checks, one upcoming demo per contact, a per-IP limit,
a honeypot field and a minimum fill time carried by a signed token. The visitor's IP is only ever stored as a salted hash."""

import hashlib
import hmac
import re
import time

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, now_datetime, validate_email_address

from crm_addons.demos import common
from crm_addons.demos.common import ACTIVE, BOOKING, fail

MIN_FILL_SECONDS = 3  # a person cannot choose a time and fill a form faster than this
TOKEN_MAX_AGE_SECONDS = 12 * 3600

DISPOSABLE_DOMAINS = frozenset(
	"""mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net
	temp-mail.org tempmail.com tempmail.net tempmailo.com temp-mail.io throwawaymail.com yopmail.com yopmail.net yopmail.fr trashmail.com
	trashmail.net getnada.com nada.email dispostable.com maildrop.cc mailnesia.com fakeinbox.com mintemail.com mytemp.email mohmal.com
	emailondeck.com spamgourmet.com spambox.us burnermail.io discard.email discardmail.com tempinbox.com moakt.com minutemail.com
	mail.tm emailfake.com fakemail.net mailcatch.com inboxkitten.com harakirimail.com tempr.email owlymail.com""".split()
)


# -- phone and email ------------------------------------------------------------------------------------------------


def _fake_number(national):
	"""Obvious keyboard-mash numbers: one digit repeated, or a straight run up or down."""
	if len(set(national)) == 1:
		return True
	steps = {(int(b) - int(a)) % 10 for a, b in zip(national, national[1:])}
	return steps in ({1}, {9})


def validate_phone(raw, default_country_code=None):
	"""A phone number as international digits (no +), or a friendly `invalid_phone` error.

	* India (the default country code unless the setting says otherwise): ``+91``, ``91`` or ``0`` in front is stripped and the
	  number must be 10 digits starting 6-9.
	* Any other country: the international number must be 8 to 15 digits; without a ``+`` the default country code is added to a short number.
	"""
	message = _("Enter a valid phone number, for example +91 98765 43210.")
	text = re.sub(r"[\s\-().]", "", cstr(raw))
	if text.startswith("00"):
		text = "+" + text[2:]
	if not re.fullmatch(r"\+?\d{7,16}", text):
		fail("invalid_phone", message)
	code = re.sub(r"\D", "", cstr(default_country_code)) or "91"
	international = text.startswith("+")
	digits = text.lstrip("+")
	if not international:
		digits = digits.lstrip("0")  # a national trunk prefix
		if digits.startswith(code) and len(digits) >= len(code) + (10 if code == "91" else 7):
			pass  # already carries the country code
		elif len(digits) <= 10:
			digits = code + digits
	if digits.startswith("91"):
		national = digits[2:]
		if not re.fullmatch(r"[6-9]\d{9}", national) or _fake_number(national):
			fail("invalid_phone", message)
	elif not 8 <= len(digits) <= 15 or _fake_number(digits[-8:]):
		fail("invalid_phone", message)
	return digits


def validate_email(raw):
	"""A lower-cased address, or a friendly `invalid_email` error. Throwaway-mail domains are refused."""
	email = cstr(raw).strip().lower()
	domain = email.rsplit("@", 1)[-1]
	if not email or len(email) > 140 or not validate_email_address(email) or "." not in domain:
		fail("invalid_email", _("Enter a valid email address."))
	if domain in DISPOSABLE_DOMAINS:
		fail("invalid_email", _("Please use a permanent email address, not a temporary one."))
	return email


# -- bots --------------------------------------------------------------------------------------------------------------


def _secret():
	from frappe.utils.password import get_encryption_key

	return get_encryption_key().encode()


def _sign(slug, stamp):
	return hmac.new(_secret(), f"demo-form|{slug}|{stamp}".encode(), hashlib.sha256).hexdigest()[:32]


def make_form_token(slug, at=None):
	"""A signed timestamp handed out with the page. Posting it back too early or too late is refused."""
	stamp = int(at if at is not None else time.time())
	return f"{stamp}.{_sign(slug, stamp)}"


def check_form_token(slug, token, now=None):
	now = now if now is not None else time.time()
	try:
		stamp, sig = cstr(token).split(".", 1)
		ok = hmac.compare_digest(sig, _sign(slug, int(stamp)))
		age = now - int(stamp)
	except (ValueError, TypeError):
		ok, age = False, 0
	if not ok or age > TOKEN_MAX_AGE_SECONDS:
		fail("form_expired", _("This page has expired. Please reload it and try again."))
	if age < MIN_FILL_SECONDS:
		fail("too_fast", _("That was very quick. Please check your details and try again."))


def ip_hash(ip):
	"""A salted hash of the visitor's address (never the address itself), or None when there is none."""
	if not ip:
		return None
	return hmac.new(_secret(), f"demo-ip|{ip}".encode(), hashlib.sha256).hexdigest()[:40]


def _cache():
	cache = frappe.cache
	return cache() if callable(cache) else cache  # a function in Frappe 15, an object later


def throttle(bucket, limit, seconds):
	"""At most ``limit`` calls per visitor address per ``seconds`` for a guest endpoint. Quietly does nothing without an address or a cache."""
	ip = getattr(frappe.local, "request_ip", None)
	if not ip:
		return
	key = f"crm_demo_rl:{frappe.local.site}:{bucket}:{ip_hash(ip)[:16]}"
	try:
		cache = _cache()
		cache.set(key, 0, ex=seconds, nx=True)
		used = cache.incr(key)
	except Exception:
		return
	if used > limit:
		fail("rate_limited", _("Too many requests. Please wait a little and try again."))


def check_ip_limit(hashed, limit):
	if not hashed or cint(limit) <= 0:
		return
	since = add_to_date(now_datetime(), hours=-1)
	used = frappe.db.count(BOOKING, {"ip_hash": hashed, "creation": [">=", since]})
	if used >= cint(limit):
		fail("rate_limited", _("Too many bookings from your network. Please try again later."))


def check_repeat_contact(demo, email, phone, exclude_booking=None):
	"""A phone number or email may hold only so many upcoming demos of one type."""
	limit = cint(demo.get("max_active_per_contact"))
	if limit <= 0:
		return
	rows = frappe.db.sql(
		f"""select name from `tab{BOOKING}` where demo_type = %(d)s and status in %(active)s and starts_utc >= %(now)s
		and (email = %(email)s or phone = %(phone)s)""",
		{"d": demo.name, "active": ACTIVE, "now": common.utcnow(), "email": email, "phone": phone},
	)
	if len([r for r in rows if r[0] != exclude_booking]) >= limit:
		fail(
			"repeat_contact",
			_("You already have a demo booked with this email or phone number. Use the link in your confirmation to change or cancel it."),
		)
