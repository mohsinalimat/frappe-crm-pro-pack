"""Lead forms: a public web form (``/lead-form/<slug>``) that creates a CRM Lead, and the manager API behind the Lead forms tab of Bookings.

A form only offers fields that already exist on the CRM Lead, so nothing here adds a field or an option to the CRM. Phone and email are
asked by default; each can be made optional. A visitor who matches an existing lead (by email or by phone) never creates a second one:
the attempt is written on the existing lead as a comment with what they shared (and an "Update details" action, see ``apply_entry``),
the lead's owner is told, and the attempt goes in the log. Every submission is logged, so the numbers can be read back.
"""

import json
import re

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, escape_html, flt, get_url, now_datetime

from crm_addons.demos import booking, common, leadform_messages, spam
from crm_addons.campaigns.common import date_range
from crm_addons.demos.common import LEAD, fail, is_admin
from crm_addons.team_access import access
from crm_addons.utils import get_settings

FORM = "CRM Lead Form"
ENTRY = "CRM Lead Form Entry"
PUBLIC_TYPES = ("Data", "Small Text", "Text", "Long Text", "Select", "Link", "Check", "Int", "Float", "Phone", "Date")
CORE = ("first_name", "last_name", "email", "mobile_no")
# set by the form itself (or by CRM), never typed by a visitor
NOT_OFFERED = {"status", "lead_owner", "source", "lead_name", "lead_owner_name", "converted", "naming_series", "organization_logo"}
# a Link to these would list people or customers: never offered
NO_LINKS = {"User", "Contact", "Role", "CRM Organization", "Customer", "Lead"}
TEXT_LIMIT = {"Data": 300, "Phone": 40, "Small Text": 1000, "Text": 3000, "Long Text": 5000, "Select": 140, "Link": 140}
ASSIGNMENTS = ("Follow assignment rules", "Specific person", "Unassigned")
TOKEN_NS = "lf:"


# -- the fields ---------------------------------------------------------------------------------------------------------


def _meta():
	return frappe.get_meta(LEAD)


def _offerable(df):
	if not df or df.fieldtype not in PUBLIC_TYPES or df.hidden or df.read_only or df.fieldname in NOT_OFFERED or df.fieldname.startswith("crm_"):
		return False
	return not (df.fieldtype == "Link" and df.options in NO_LINKS)


def default_fields():
	return [
		{"fieldname": "first_name", "required": 1},
		{"fieldname": "last_name", "required": 0},
		{"fieldname": "email", "required": 1},
		{"fieldname": "mobile_no", "required": 1},
	]


def clean_fields(raw):
	"""The form's field list as stored: [{fieldname, label, required, placeholder, help}], only real, offerable Lead fields. First name, email and
	phone are always there (email and phone can be optional, the name cannot)."""
	rows = raw
	if isinstance(raw, str):
		try:
			rows = json.loads(raw) if raw.strip() else []
		except ValueError:
			frappe.throw(_("The field list is not valid."))
	rows = rows if isinstance(rows, list) and rows else default_fields()
	meta = _meta()
	out, seen = [], set()
	for row in rows[:40]:
		name = cstr((row or {}).get("fieldname")).strip()
		df = meta.get_field(name)
		if not name or name in seen or (name not in CORE and not _offerable(df)) or not df:
			if name and name not in seen and name not in CORE:
				frappe.throw(_("{0} cannot be asked on a form.").format(frappe.bold(name)))
			continue
		seen.add(name)
		out.append({
			"fieldname": name,
			"label": cstr(row.get("label")).strip()[:80],
			"required": 1 if cint(row.get("required")) or name == "first_name" else 0,
			"placeholder": cstr(row.get("placeholder")).strip()[:120],
			"help": cstr(row.get("help")).strip()[:200],
		})
	for name in ("first_name", "email", "mobile_no"):
		if name not in seen:
			out.insert(0 if name == "first_name" else len(out), {"fieldname": name, "label": "", "required": 1, "placeholder": "", "help": ""})
	return out


def dump_fields(rows):
	return json.dumps(rows, indent=1)


def load_fields(doc):
	try:
		rows = json.loads(doc.get("fields_json") or "[]")
	except ValueError:
		rows = []
	return rows or default_fields()


def _link_choices(doctype):
	if not doctype or doctype in NO_LINKS or not frappe.db.exists("DocType", doctype):
		return []
	if frappe.db.count(doctype) > 200:
		return []
	title = frappe.get_meta(doctype).title_field
	return [{"value": r.name, "label": (r.get(title) if title and title != "name" and r.get(title) else r.name)} for r in frappe.get_all(doctype, fields=["name"] + ([title] if title and title != "name" else []), order_by="name asc", limit_page_length=200)]


def _spec(df, cfg=None):
	cfg = cfg or {}
	spec = {
		"fieldname": df.fieldname, "label": cfg.get("label") or df.label or df.fieldname, "fieldtype": df.fieldtype,
		"required": 1 if cint(cfg.get("required")) or df.fieldname == "first_name" else 0, "placeholder": cfg.get("placeholder") or "", "help": cfg.get("help") or "",
		"options": [], "default_label": df.label or df.fieldname,
	}
	if df.fieldtype == "Select":
		spec["options"] = [o for o in cstr(df.options).split("\n")]
	elif df.fieldtype == "Link":
		spec["options"] = _link_choices(df.options)
		spec["link"] = df.options
	return spec


def catalog():
	"""Every field a form can ask: the fields CRM lays out for a lead (new-lead form, side panel, data fields) that a visitor may fill in."""
	from crm_addons.pro import form

	meta = _meta()
	names = [n for n in CORE if meta.has_field(n)]
	names += [n for n in form.writable() if n not in names]
	out = []
	for n in names:
		df = meta.get_field(n)
		if df and (n in CORE or _offerable(df)):
			spec = _spec(df)
			spec["reqd"] = cint(df.reqd)
			out.append(spec)
	return out


# -- the visitor's answers --------------------------------------------------------------------------------------------------


def clean_answers(form, answers):
	"""``{lead field: value}`` from what the visitor sent: required checks, types, a Select's options, an existing Link, a valid email and phone.
	Raises a friendly message (code ``field_required``, ``invalid_email`` or ``invalid_phone``)."""
	answers = answers if isinstance(answers, dict) else {}
	meta = _meta()
	out = {}
	for cfg in load_fields(form):
		name = cfg["fieldname"]
		df = meta.get_field(name)
		if not df:
			continue
		label = cfg.get("label") or df.label or name
		raw = answers.get(name)
		if df.fieldtype == "Check":
			value = 1 if raw in (1, True, "1", "true", "on", "yes") else 0
			if cint(cfg.get("required")) and not value:
				fail("field_required", _("Please tick {0}.").format(label))
			out[name] = value
			continue
		value = cstr(raw).strip()[: TEXT_LIMIT.get(df.fieldtype, 300)]
		if not value:
			if cint(cfg.get("required")) or name == "first_name":
				fail("field_required", _("Please fill in {0}.").format(label))
			continue
		if name == "email":
			value = spam.validate_email(value)
		elif name == "mobile_no":
			value = "+" + spam.validate_phone(value, get_settings().get("default_country_code"))
		elif df.fieldtype == "Select":
			if value not in [o for o in cstr(df.options).split("\n") if o]:
				fail("field_required", _("Please choose a valid option for {0}.").format(label))
		elif df.fieldtype == "Link":
			if df.options in NO_LINKS or not frappe.db.exists(df.options, value):
				fail("field_required", _("Please choose a valid option for {0}.").format(label))
		elif df.fieldtype == "Int":
			try:
				value = int(float(value))
			except ValueError:
				fail("field_required", _("{0} must be a number.").format(label))
		elif df.fieldtype == "Float":
			try:
				value = flt(value)
			except ValueError:
				fail("field_required", _("{0} must be a number.").format(label))
		elif df.fieldtype == "Date":
			try:
				value = str(frappe.utils.getdate(value))
			except Exception:
				fail("field_required", _("{0} must be a date.").format(label))
		elif name == "first_name" and re.search(r"https?://|www\.", value, re.I):
			fail("field_required", _("Please enter your name."))
		out[name] = value
	if not out.get("email") and not out.get("mobile_no"):
		fail("field_required", _("Please share an email address or a phone number."))
	return out


# -- finding the same person -----------------------------------------------------------------------------------------------


def find_duplicate(email, phone):
	"""``(lead name, 'email' | 'phone')`` for a lead that has this email or this phone number, or ``(None, '')``."""
	if email:
		row = frappe.db.sql(f"select name from `tab{LEAD}` where email = %s order by modified desc limit 1", email)
		if row:
			return row[0][0], "email"
	digits = re.sub(r"\D", "", cstr(phone))
	if len(digits) >= 7:
		meta = _meta()
		stripped = "replace(replace(replace(replace(replace(replace(`{c}`, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')"
		for column in ("mobile_no", "phone"):
			if meta.has_field(column):
				row = frappe.db.sql(f"select name from `tab{LEAD}` where {stripped.format(c=column)} like %s order by modified desc limit 1", "%" + digits[-10:])
				if row:
					return row[0][0], "phone"
	return None, ""


# -- the log -------------------------------------------------------------------------------------------------------------


def log_entry(form, result, answers=None, reason="", lead=None, matched_by="", utm=None, first_touch=None, landing_url="", referrer="", comment=None):
	utm, first_touch = utm or {}, first_touch or {}
	answers = answers or {}
	request = getattr(frappe.local, "request", None)
	agent = request.headers.get("User-Agent") if request else ""
	doc = frappe.get_doc({
		"doctype": ENTRY, "form": form, "result": result, "reason": cstr(reason)[:140], "lead": lead, "matched_by": matched_by, "comment": comment,
		"name_": " ".join(p for p in (cstr(answers.get("first_name")), cstr(answers.get("last_name"))) if p)[:140],
		"email": cstr(answers.get("email"))[:140], "phone": cstr(answers.get("mobile_no"))[:40],
		"values_json": json.dumps(answers), "first_touch": json.dumps(first_touch) if first_touch else None,
		"landing_url": cstr(landing_url)[:500], "referrer": cstr(referrer)[:500], "ip_hash": spam.ip_hash(getattr(frappe.local, "request_ip", None)), "ip_address": cstr(getattr(frappe.local, "request_ip", None))[:45], "user_agent": cstr(agent)[:300],
		**{k: cstr(utm.get(k))[:140] for k in ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content") if utm.get(k)},
	})
	doc.insert(ignore_permissions=True)
	return doc.name


# -- a new lead ----------------------------------------------------------------------------------------------------------


def _labels(form, answers):
	meta, rows = _meta(), []
	cfg = {c["fieldname"]: c for c in load_fields(form)}
	for name, value in answers.items():
		df = meta.get_field(name)
		if df:
			rows.append((cfg.get(name, {}).get("label") or df.label or name, "Yes" if df.fieldtype == "Check" and value else ("No" if df.fieldtype == "Check" else cstr(value))))
	return rows


def create_lead(form, answers, utm, first_touch, consent=0):
	meta = _meta()
	values = {"doctype": LEAD, **answers}
	if form.lead_source:
		values["source"] = form.lead_source
	if form.lead_status:
		values["status"] = form.lead_status
	for column, key in (("crm_demo_first_utm_source", "utm_source"), ("crm_demo_first_utm_medium", "utm_medium"), ("crm_demo_first_utm_campaign", "utm_campaign")):
		if meta.has_field(column) and first_touch.get(key):
			values[column] = first_touch[key]
	if consent and meta.has_field("crm_wa_opt_in"):
		values["crm_wa_opt_in"] = 1
	mode = form.assignment_mode or ASSIGNMENTS[0]
	if mode != ASSIGNMENTS[0]:
		frappe.flags.in_assignment = True  # the assignment rules are skipped: this form says who gets the lead
	try:
		lead = frappe.get_doc(values).insert(ignore_permissions=True)
	finally:
		frappe.flags.in_assignment = False
	if mode == "Specific person" and form.assign_to:
		from crm_addons import assignment

		try:
			assignment.assign_lead(lead.name, [form.assign_to], "New lead", mode="Lead form", note=form.title)
		except Exception:  # a lead must never be lost over its owner
			frappe.log_error(title="Lead form: could not assign the new lead", message=frappe.get_traceback())
	elif mode == "Unassigned" and meta.has_field("lead_owner") and frappe.db.get_value(LEAD, lead.name, "lead_owner"):
		frappe.db.set_value(LEAD, lead.name, "lead_owner", None, update_modified=False)
	rows = _labels(form, answers)
	utm_line = " / ".join(cstr(first_touch.get(k) or utm.get(k)) for k in ("utm_source", "utm_medium", "utm_campaign") if first_touch.get(k) or utm.get(k))
	body = "".join(f"<li>{escape_html(a)}: {escape_html(b)}</li>" for a, b in rows)
	lead.add_comment("Comment", f"<p><b>{escape_html(_('Came in through the lead form'))}</b> “{escape_html(form.title)}”.</p><ul>{body}</ul>" + (f"<p>{escape_html(_('Campaign'))}: {escape_html(utm_line)}</p>" if utm_line else ""))
	return lead.name


# -- someone who is already a lead -----------------------------------------------------------------------------------------


def note_duplicate(form, lead, matched_by, answers):
	"""Write the attempt on the existing lead and tell its owner. Returns the comment's name."""
	rows = "".join(f"<li>{escape_html(a)}: {escape_html(b)}</li>" for a, b in _labels(form, answers))
	how = _("email address") if matched_by == "email" else _("phone number")
	doc = frappe.get_doc(LEAD, lead)
	comment = doc.add_comment(
		"Comment",
		f"<p><b>{escape_html(_('Tried to register again'))}</b> through the lead form “{escape_html(form.title)}” "
		f"({escape_html(_('same {0} as this lead').format(how))}). {escape_html(_('They shared:'))}</p><ul>{rows}</ul>",
	)
	if cint(form.notify_owner) and doc.get("lead_owner") and doc.lead_owner not in ("Guest",):
		try:
			frappe.get_doc({
				"doctype": "Notification Log", "for_user": doc.lead_owner, "type": "Alert", "document_type": LEAD, "document_name": lead,
				"from_user": "Administrator", "subject": _("{0} tried to register again through {1}").format(doc.get("lead_name") or lead, form.title),
			}).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="Lead form: could not notify the lead owner", message=frappe.get_traceback())
	return comment.name


def apply_entry(entry, lead):
	"""The "Update details" action: put what the person shared on the lead (only what they shared, only what differs). Returns the changed labels."""
	row = frappe.db.get_value(ENTRY, entry, ["lead", "values_json", "applied", "result"], as_dict=True)
	if not row or row.lead != lead or row.result != "Duplicate":
		frappe.throw(_("This update does not belong to this lead."))
	if cint(row.applied):
		frappe.throw(_("These details were already applied."))
	meta = _meta()
	doc = frappe.get_doc(LEAD, lead)
	changed = []
	for name, value in (json.loads(row.values_json or "{}")).items():
		df = meta.get_field(name)
		if not df or value in (None, "") or (name not in CORE and not _offerable(df)):
			continue
		if cstr(doc.get(name)) != cstr(value):
			doc.set(name, value)
			changed.append(df.label or name)
	if changed:
		doc.save()
		doc.add_comment("Comment", f"<p>{escape_html(_('Details updated from the lead form:'))} {escape_html(', '.join(changed))}</p>")
	frappe.db.set_value(ENTRY, entry, {"applied": 1, "applied_on": now_datetime(), "applied_by": frappe.session.user}, update_modified=False)
	return changed


def entries_for_lead(lead):
	"""``{comment name: {entry, applied, rows}}`` for the lead's duplicate notes, so the timeline can show the button."""
	out = {}
	for e in frappe.get_all(ENTRY, filters={"lead": lead, "result": "Duplicate"}, fields=["name", "comment", "applied", "values_json", "form"], limit_page_length=100):
		if not e.comment:
			continue
		form = frappe.db.get_value(FORM, e.form, "title") if e.form else ""
		try:
			values = json.loads(e.values_json or "{}")
		except ValueError:
			values = {}
		out[e.comment] = {"entry": e.name, "applied": cint(e.applied), "form": form, "changes": len(values)}
	return out


# -- the public API ----------------------------------------------------------------------------------------------------------


def _form_by_slug(slug):
	slug = cstr(slug).strip().lower()
	if not slug or not common.SLUG_RE.match(slug) or not frappe.db.get_value(FORM, slug, "enabled"):
		fail("not_found", _("This form is not available."))
	return frappe.get_cached_doc(FORM, slug)


def _check_ip_limit(form):
	limit = cint(form.max_per_ip_per_hour)
	ip = spam.ip_hash(getattr(frappe.local, "request_ip", None))
	if limit > 0 and ip and frappe.db.count(ENTRY, {"form": form.name, "ip_hash": ip, "creation": [">=", add_to_date(now_datetime(), hours=-1)]}) >= limit:
		fail("rate_limited", _("Too many forms from your network. Please try again later."))


def _brand(form):
	return {
		"name": form.brand_name or form.title, "logo_url": form.logo or "", "accent": form.accent_color or "", "theme": (form.theme or "Auto").lower(),
		"heading": form.heading or form.title, "description": form.description or "", "button_text": form.button_text or _("Send"),
		"footer_text": form.footer_text or "", "success_title": form.success_title or _("Thank you"), "success_text": form.success_text or _("We have your details and will be in touch."),
		"redirect_url": form.redirect_url or "",
	}


def _json(value):
	if isinstance(value, dict):
		return value
	try:
		out = json.loads(value) if value else {}
	except ValueError:
		return {}
	return out if isinstance(out, dict) else {}


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def get_public_form(slug):
	spam.throttle("lf_page", 120, 600)
	form = _form_by_slug(slug)
	meta = _meta()
	fields = [_spec(meta.get_field(c["fieldname"]), c) for c in load_fields(form) if meta.get_field(c["fieldname"])]
	return {"slug": form.name, "title": form.title, "brand": _brand(form), "fields": fields, "consent": {"text": form.consent_text or "", "default": 1 if cint(form.consent_default) else 0}, "form_token": spam.make_form_token(TOKEN_NS + form.name)}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def submit(slug, answers=None, utm=None, landing_url=None, referrer=None, form_token=None, hp=None, consent=0):
	spam.throttle("lf_submit", 20, 3600)
	form = _form_by_slug(slug)
	utm_now, first = booking._utm_of(_json(utm))
	first = first or utm_now
	ok = {"ok": True, "brand": _brand(form)}
	if cstr(hp).strip():
		log_entry(form.name, "Blocked", reason="Hidden field filled", utm=utm_now, first_touch=first, landing_url=landing_url, referrer=referrer)
		return ok
	spam.check_form_token(TOKEN_NS + form.name, form_token)
	_check_ip_limit(form)
	values = clean_answers(form, _json(answers))
	consent = 1 if cint(consent) and form.consent_text else 0
	lead, how = find_duplicate(values.get("email"), values.get("mobile_no"))
	if lead:
		comment = note_duplicate(form, lead, how, values)
		log_entry(form.name, "Duplicate", values, lead=lead, matched_by=how, utm=utm_now, first_touch=first, landing_url=landing_url, referrer=referrer, comment=comment)
		return ok
	frappe.db.savepoint("lead_form")
	try:
		lead = create_lead(form, values, utm_now, first, consent)
	except Exception:
		frappe.db.rollback(save_point="lead_form")
		log_entry(form.name, "Failed", values, reason=(frappe.get_traceback().strip().splitlines() or [""])[-1], utm=utm_now, first_touch=first, landing_url=landing_url, referrer=referrer)
		frappe.db.commit()
		frappe.log_error(title="Lead form: a lead could not be created", message=frappe.get_traceback())
		fail("create_failed", _("We could not save your details. Please try again in a moment."))
	entry = log_entry(form.name, "Created", values, lead=lead, utm=utm_now, first_touch=first, landing_url=landing_url, referrer=referrer)
	try:
		leadform_messages.queue(form, entry, lead, consent)
	except Exception:  # a welcome message must never lose the lead
		frappe.log_error(title="Lead form: could not queue the messages", message=frappe.get_traceback())
	return ok


# -- the manager API ---------------------------------------------------------------------------------------------------------


def _manage(minimum="view"):
	access.require("demo_widgets", minimum, _("You do not have access to the lead forms."))


def public_url(slug):
	return get_url(f"/lead-form/{slug}")


def _counts(form=None, since=None):
	flt_ = {"form": form} if form else {}
	if since:
		flt_["creation"] = [">=", since]
	rows = frappe.get_all(ENTRY, filters=flt_, fields=["result", "count(name) as n"], group_by="result")
	out = {"Created": 0, "Duplicate": 0, "Blocked": 0, "Failed": 0}
	out.update({r.result: r.n for r in rows})
	return out


@frappe.whitelist()
def list_forms():
	_manage()
	out = []
	for f in frappe.get_all(FORM, fields=["name", "title", "slug", "enabled", "modified", "lead_source", "assignment_mode"], order_by="modified desc", limit_page_length=200):
		doc = frappe.get_doc(FORM, f.name)
		total = _counts(f.name)
		out.append({**f, "url": public_url(f.slug), "total": total, "entries": sum(total.values()), "field_count": len(load_fields(doc)), "message_count": len(leadform_messages.load_rules(doc))})
	return out


@frappe.whitelist()
def duplicate_form(name):
	_manage("manage")
	data = get_form_admin(name)["doc"]
	for key in ("name", "creation", "modified", "modified_by", "owner", "docstatus", "idx"):
		data.pop(key, None)
	base = (data.get("slug") or "form")[:50] + "-copy"
	slug, n = base, 1
	while frappe.db.exists(FORM, slug):
		n += 1
		slug = f"{base}-{n}"
	data.update({"slug": slug, "title": (data.get("title") or "Form") + " (copy)", "enabled": 0})
	return save_form(data)


@frappe.whitelist()
def get_form_admin(name):
	_manage()
	if not frappe.db.exists(FORM, name):
		frappe.throw(_("Form {0} was not found.").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc(FORM, name)
	data = doc.as_dict(convert_dates_to_str=True)
	data["fields_list"] = load_fields(doc)
	data["messages_list"] = leadform_messages.load_rules(doc)
	data.pop("fields_json", None)
	data.pop("messages_json", None)
	return {"doc": data, "url": public_url(doc.name), "counts": _counts(name)}


@frappe.whitelist()
def new_form_defaults():
	_manage("manage")
	return {"fields_list": default_fields(), "messages_list": [], "catalog": catalog(), **choices()}


@frappe.whitelist()
def choices():
	_manage()
	return {
		"sources": [r.name for r in frappe.get_all("CRM Lead Source", order_by="name asc", limit_page_length=300)],
		"statuses": [r.name for r in frappe.get_all("CRM Lead Status", order_by="position asc", limit_page_length=100)] if frappe.get_meta("CRM Lead Status").has_field("position") else [r.name for r in frappe.get_all("CRM Lead Status", limit_page_length=100)],
	}


@frappe.whitelist()
def get_catalog():
	_manage()
	return catalog()


@frappe.whitelist()
def save_form(doc):
	_manage("manage")
	data = frappe.parse_json(doc) if isinstance(doc, str) else doc
	data = dict(data or {})
	for key in ("creation", "modified", "modified_by", "owner", "docstatus", "idx", "fields_json", "messages_json"):
		data.pop(key, None)
	rows = data.pop("fields_list", None)
	data["fields_json"] = dump_fields(clean_fields(rows))
	data["messages_json"] = json.dumps(leadform_messages.clean_messages(data.pop("messages_list", [])))
	name = data.get("name")
	if name and frappe.db.exists(FORM, name):
		target = frappe.get_doc(FORM, name)
		data.pop("slug", None)
		target.update(data)
		target.save(ignore_permissions=True)
	else:
		target = frappe.get_doc({**data, "doctype": FORM})
		target.insert(ignore_permissions=True)
	return get_form_admin(target.name)


@frappe.whitelist()
def delete_form(name):
	_manage("manage")
	if frappe.db.count(ENTRY, {"form": name}):
		frappe.throw(_("This form has entries in its log, so it cannot be deleted. Switch it off instead."))
	frappe.delete_doc(FORM, name, ignore_permissions=True)
	return {"ok": True}


@frappe.whitelist()
def list_entries(form=None, result=None, search=None, from_date=None, to_date=None, page=1, page_size=25):
	_manage()
	filters = {}
	if form:
		filters["form"] = form
	if result in ("Created", "Duplicate", "Blocked", "Failed"):
		filters["result"] = result
	start, end = date_range(from_date, to_date)
	if start and end:
		filters["creation"] = ["between", [start, add_to_date(end, seconds=-1)]]
	elif start:
		filters["creation"] = [">=", start]
	elif end:
		filters["creation"] = ["<", end]
	or_filters = None
	txt = cstr(search).strip()
	if txt:
		or_filters = [[ENTRY, c, "like", f"%{txt}%"] for c in ("name_", "email", "phone", "utm_source", "utm_campaign")]
	size = max(1, min(cint(page_size) or 25, 100))
	rows = frappe.get_all(
		ENTRY, filters=filters, or_filters=or_filters, order_by="creation desc", limit_start=(max(1, cint(page)) - 1) * size, limit_page_length=size,
		fields=["name", "form", "result", "reason", "lead", "matched_by", "applied", "name_", "email", "phone", "utm_source", "utm_medium", "utm_campaign", "landing_url", "referrer", "creation", "ip_address"],
	)
	titles = {r.name: r.title for r in frappe.get_all(FORM, fields=["name", "title"], limit_page_length=300)}
	admin = is_admin()
	for r in rows:
		r["form_title"] = titles.get(r["form"], r["form"])
		r["ip"] = r.pop("ip_address") if admin else None
		r.pop("ip_address", None)
	total = cint(frappe.get_all(ENTRY, fields=["count(name) as n"], filters=filters, or_filters=or_filters)[0].n)
	return {"rows": rows, "total": total, "page": cint(page), "page_size": size, "show_ip": admin}


def _count_by(column, where, values, none):
	rows = frappe.db.sql(
		f"""select coalesce(nullif({column}, ''), %(none)s) as label, sum(result = 'Created') as created, sum(result = 'Duplicate') as duplicate
		from `tab{ENTRY}` e where {where} group by label order by created desc, duplicate desc, label limit 100""",
		{**values, "none": none}, as_dict=True,
	)
	return [{"label": r.label, "created": int(r.created or 0), "duplicate": int(r.duplicate or 0)} for r in rows]


def _where(from_date, to_date, form):
	start, end = date_range(from_date, to_date)
	parts, values = ["1 = 1"], {}
	if start:
		parts.append("e.creation >= %(start)s")
		values["start"] = start
	if end:
		parts.append("e.creation < %(end)s")
		values["end"] = end
	if form:
		parts.append("e.form = %(form)s")
		values["form"] = form
	return " and ".join(parts), values


@frappe.whitelist()
def report(from_date=None, to_date=None, form=None):
	"""The Lead form report: what came in over the dates, by form, by day and by where it came from."""
	_manage()
	where, values = _where(from_date, to_date, form)
	t = frappe.db.sql(
		f"""select count(*) as submissions, sum(result = 'Created') as created, sum(result = 'Duplicate') as duplicate, sum(result = 'Blocked') as blocked,
		sum(result = 'Failed') as failed, sum(result = 'Duplicate' and applied = 1) as applied from `tab{ENTRY}` e where {where}""", values, as_dict=True)[0]
	by_day = frappe.db.sql(
		f"""select date(e.creation) as date, sum(result = 'Created') as created, sum(result = 'Duplicate') as duplicate, sum(result = 'Blocked') as blocked
		from `tab{ENTRY}` e where {where} group by date(e.creation) order by date(e.creation)""", values, as_dict=True)
	titles = {r.name: r.title for r in frappe.get_all(FORM, fields=["name", "title"], limit_page_length=500)}
	by_form = _count_by("e.form", where, values, "(none)")
	for r in by_form:
		r["label"] = titles.get(r["label"], r["label"])
	return {
		"totals": {k: int(t[k] or 0) for k in ("submissions", "created", "duplicate", "blocked", "failed", "applied")},
		"by_day": [{"date": str(r.date), "created": int(r.created or 0), "duplicate": int(r.duplicate or 0), "blocked": int(r.blocked or 0)} for r in by_day],
		"by_source": _count_by("e.utm_source", where, values, "(direct)"), "by_medium": _count_by("e.utm_medium", where, values, "(none)"),
		"by_campaign": _count_by("e.utm_campaign", where, values, "(none)"), "by_form": by_form,
	}


def leads_overview(from_date=None, to_date=None):
	"""For the Sales dashboard: where leads came from in the period, from lead forms and from website bookings (no permission check: the caller has done it)."""
	start, end = date_range(from_date, to_date)
	where, values = ["1 = 1"], {}
	if start:
		where.append("creation >= %(start)s")
		values["start"] = start
	if end:
		where.append("creation < %(end)s")
		values["end"] = end
	w = " and ".join(where)
	forms = frappe.db.sql(f"select sum(result = 'Created') as created, sum(result = 'Duplicate') as duplicate, sum(result = 'Blocked') as blocked from `tab{ENTRY}` where {w}", values, as_dict=True)[0]
	bookings = frappe.db.sql(f"select count(*) as n, count(distinct lead) as leads from `tabCRM Demo Booking` where {w}", values, as_dict=True)[0]
	total = frappe.db.sql(f"select count(*) from `tab{LEAD}` where {w}", values)[0][0]
	by_day = {}
	for r in frappe.db.sql(f"select date(creation) as d, sum(result = 'Created') as n from `tab{ENTRY}` where {w} group by date(creation)", values, as_dict=True):
		by_day.setdefault(str(r.d), {"date": str(r.d), "forms": 0, "bookings": 0, "all": 0})["forms"] = int(r.n or 0)
	for r in frappe.db.sql(f"select date(creation) as d, count(*) as n from `tabCRM Demo Booking` where {w} group by date(creation)", values, as_dict=True):
		by_day.setdefault(str(r.d), {"date": str(r.d), "forms": 0, "bookings": 0, "all": 0})["bookings"] = int(r.n or 0)
	for r in frappe.db.sql(f"select date(creation) as d, count(*) as n from `tab{LEAD}` where {w} group by date(creation)", values, as_dict=True):
		by_day.setdefault(str(r.d), {"date": str(r.d), "forms": 0, "bookings": 0, "all": 0})["all"] = int(r.n or 0)
	by_source = frappe.db.sql(
		f"select coalesce(nullif(source, ''), '(none)') as label, count(*) as n from `tab{LEAD}` where {w} group by label order by n desc limit 10", values, as_dict=True)
	by_form = frappe.db.sql(
		f"select f.title as label, sum(e.result = 'Created') as created, sum(e.result = 'Duplicate') as duplicate from `tab{ENTRY}` e join `tab{FORM}` f on f.name = e.form where {w.replace('creation', 'e.creation')} group by f.title order by created desc limit 10", values, as_dict=True)
	return {
		"leads": int(total or 0), "from_forms": int(forms.created or 0), "duplicates": int(forms.duplicate or 0), "blocked": int(forms.blocked or 0),
		"bookings": int(bookings.n or 0), "booking_leads": int(bookings.leads or 0),
		"by_day": [by_day[k] for k in sorted(by_day)],
		"by_source": [{"label": r.label, "leads": int(r.n)} for r in by_source],
		"by_form": [{"label": r.label, "created": int(r.created or 0), "duplicate": int(r.duplicate or 0)} for r in by_form],
	}
