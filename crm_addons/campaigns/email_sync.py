"""Two-way sync between the Campaign Manager's email templates and CRM's own Email Template list.

CRM's "send an email" screen on a Lead picks from Frappe's ``Email Template`` documents (rendered with the Lead's fields as
the context). The campaign library keeps its own ``CRM Campaign Email Template``. So that a template made in either place
shows up in the other, and renders the same, a save on one side copies it to the other:

* the HTML is copied untouched (styles, tables and images are not rewritten or stripped);
* the merge fields are translated: ``{{ first_name }}`` works in both places as it is, while the computed ones
  (``owner_name``, ``sender_name``, ``today``, ``lead_url``) are written out as the Jinja CRM can evaluate, and translated back;
* a campaign template remembers its CRM twin in ``crm_email_template``; only Email Templates for Leads are mirrored back;
* a change that arrives through the sync does not start another sync (``frappe.flags.in_template_sync``).
"""

import re
from contextlib import contextmanager

import frappe

CRM_TEMPLATE = "Email Template"
CAMPAIGN_TEMPLATE = "CRM Campaign Email Template"
LEAD = "CRM Lead"
LINK = "crm_email_template"

# computed campaign variable -> what CRM's template renderer can evaluate for the same thing
TO_CRM = {
	"owner_name": "{{ frappe.get_fullname(lead_owner) if lead_owner else '' }}",
	"sender_name": "{{ frappe.full_name }}",
	"today": "{{ frappe.utils.formatdate(frappe.utils.nowdate()) }}",
	"lead_url": "{{ frappe.get_url() }}/crm/leads/{{ name }}",
}
_TOKEN = re.compile(r"\{\{\s*(\w+)\s*\}\}")
_DOC_FIELD = re.compile(r"\{\{\s*doc\.(\w+)\s*\}\}")


def to_crm(text):
	"""Campaign wording -> CRM wording."""
	return _TOKEN.sub(lambda m: TO_CRM.get(m.group(1), m.group(0)), text or "")


def from_crm(text):
	"""CRM wording -> campaign wording: the written-out computed fields and ``{{ doc.field }}`` become plain variables."""
	text = text or ""
	for name, jinja in TO_CRM.items():
		text = text.replace(jinja, "{{ %s }}" % name)
	return _DOC_FIELD.sub(lambda m: "{{ %s }}" % m.group(1), text)


@contextmanager
def syncing():
	before = frappe.flags.get("in_template_sync")
	frappe.flags.in_template_sync = True
	try:
		yield
	finally:
		frappe.flags.in_template_sync = before


def _available():
	return bool(frappe.db.exists("DocType", CRM_TEMPLATE) and frappe.get_meta(CAMPAIGN_TEMPLATE).has_field(LINK))


def _crm_name_for(doc):
	"""The Email Template this campaign template is (or will be) mirrored as."""
	linked = doc.get(LINK)
	if linked and frappe.db.exists(CRM_TEMPLATE, linked):
		return linked
	name = doc.template_name
	if frappe.db.exists(CRM_TEMPLATE, name):
		if frappe.db.exists(CAMPAIGN_TEMPLATE, {LINK: name, "name": ["!=", doc.name]}):
			name = f"{doc.template_name} (Campaign)"
		elif not frappe.db.exists(CAMPAIGN_TEMPLATE, {LINK: name}):
			# an Email Template somebody made in CRM with this name: do not overwrite it, mirror beside it
			name = f"{doc.template_name} (Campaign)"
	return name


def push(doc, method=None):
	"""``on_update`` of a campaign template: copy it to CRM's Email Template."""
	if frappe.flags.get("in_template_sync") or not _available():
		return
	try:
		name = _crm_name_for(doc)
		meta = frappe.get_meta(CRM_TEMPLATE)
		values = {"subject": to_crm(doc.subject), "use_html": 1, "response_html": to_crm(doc.body_html)}
		if meta.has_field("enabled"):
			values["enabled"] = 1 if doc.enabled else 0
		if meta.has_field("reference_doctype"):
			values["reference_doctype"] = LEAD
		with syncing():
			if frappe.db.exists(CRM_TEMPLATE, name):
				twin = frappe.get_doc(CRM_TEMPLATE, name)
				twin.update(values)
				twin.save(ignore_permissions=True)
			else:
				twin = frappe.get_doc({"doctype": CRM_TEMPLATE, **values})
				twin.__newname = name
				twin.insert(ignore_permissions=True)
		if doc.get(LINK) != twin.name:
			frappe.db.set_value(doc.doctype, doc.name, LINK, twin.name, update_modified=False)
			doc.set(LINK, twin.name)
	except Exception:
		frappe.log_error(title="Frappe CRM Suite Pro: could not copy the email template to CRM", message=frappe.get_traceback())


def disable_twin(doc, method=None):
	"""A deleted campaign template is switched off in CRM (never deleted there: someone may still use it)."""
	if frappe.flags.get("in_template_sync") or not _available():
		return
	twin = doc.get(LINK)
	if twin and frappe.db.exists(CRM_TEMPLATE, twin) and frappe.get_meta(CRM_TEMPLATE).has_field("enabled"):
		frappe.db.set_value(CRM_TEMPLATE, twin, "enabled", 0, update_modified=False)


def pull(doc, method=None):
	"""``on_update`` of a CRM Email Template: copy it into the campaign library (Lead templates, and the ones already linked)."""
	if frappe.flags.get("in_template_sync") or not _available():
		return
	try:
		linked = frappe.db.get_value(CAMPAIGN_TEMPLATE, {LINK: doc.name})
		if not linked and doc.get("reference_doctype") != LEAD:
			return
		body = doc.response_html if doc.use_html else doc.response
		subject, html = from_crm(doc.subject), from_crm(body)
		enabled = 1 if doc.get("enabled", 1) else 0
		with syncing():
			if linked:
				tpl = frappe.get_doc(CAMPAIGN_TEMPLATE, linked)
				if to_crm(tpl.body_html) == to_crm(html) and tpl.subject == subject and cint_eq(tpl.enabled, enabled):
					return  # nothing changed: keep the visual builder's blocks
				changed_body = to_crm(tpl.body_html) != to_crm(html)
				tpl.update({"subject": subject, "body_html": html, "enabled": enabled})
				if changed_body:  # edited as HTML in CRM, so the builder's blocks no longer describe it
					tpl.update({"editor_mode": "HTML", "builder_json": ""})
				tpl.save(ignore_permissions=True)
			elif not frappe.db.exists(CAMPAIGN_TEMPLATE, doc.name):
				frappe.get_doc(
					{
						"doctype": CAMPAIGN_TEMPLATE, "template_name": doc.name, "subject": subject, "body_html": html, "enabled": enabled,
						"editor_mode": "HTML" if doc.use_html else "Rich Text", LINK: doc.name,
					}
				).insert(ignore_permissions=True)
	except Exception:
		# usually a variable the campaign engine does not know: the template stays CRM-only
		frappe.logger().info(f"Frappe CRM Suite Pro: Email Template {doc.name} was not mirrored into the campaign library", exc_info=True)


def cint_eq(a, b):
	return int(a or 0) == int(b or 0)


def backfill():
	"""After install / migrate: mirror what already exists, both ways. Safe to run any number of times."""
	if not _available():
		return
	for name in frappe.get_all(CAMPAIGN_TEMPLATE, filters={LINK: ["in", ["", None]]}, pluck="name"):
		push(frappe.get_doc(CAMPAIGN_TEMPLATE, name))
	filters = {"reference_doctype": LEAD} if frappe.get_meta(CRM_TEMPLATE).has_field("reference_doctype") else {}
	for name in frappe.get_all(CRM_TEMPLATE, filters=filters, pluck="name"):
		if not frappe.db.exists(CAMPAIGN_TEMPLATE, {LINK: name}):
			pull(frappe.get_doc(CRM_TEMPLATE, name))
