"""Bringing leads in from a sheet: an Excel or CSV file, or a Google Sheet link. Three steps, each its own call: read the sheet (``read_sheet``), match its
columns to lead fields (``suggest_mapping`` proposes a match, the person corrects it), add the rows in small batches (``add_rows``, first as a check that saves
nothing, then for real) so the page can show progress."""

import base64
import csv
import io
import re
from urllib.parse import urlparse

import frappe
from frappe import _
from frappe.utils import cint, cstr

LEAD = "CRM Lead"
MAX_ROWS = 5000
MAX_BYTES = 10_000_000
BATCH = 100
# what people call a lead's columns
SYNONYMS = {
	"name": "first_name", "full name": "first_name", "first name": "first_name", "firstname": "first_name", "last name": "last_name", "surname": "last_name",
	"e-mail": "email", "email id": "email", "email address": "email", "mail": "email",
	"phone": "mobile_no", "phone number": "mobile_no", "mobile": "mobile_no", "mobile number": "mobile_no", "contact number": "mobile_no", "whatsapp": "mobile_no",
	"company": "organization", "company name": "organization", "organisation": "organization", "title": "job_title", "designation": "job_title",
}


def _check():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	frappe.has_permission(LEAD, "create", throw=True)


def _cell(v):
	if v is None:
		return ""
	if isinstance(v, float) and v.is_integer():
		return str(int(v))
	return cstr(v).strip()


def _table(rows):
	rows = [[_cell(c) for c in r] for r in rows]
	while rows and not any(rows[-1]):
		rows.pop()
	if len(rows) < 2:
		frappe.throw(_("The sheet needs a header row and at least one lead."))
	if len(rows) - 1 > MAX_ROWS:
		frappe.throw(_("At most {0} leads at a time. This sheet has {1}.").format(MAX_ROWS, len(rows) - 1))
	width = max(len(r) for r in rows[:50])
	header = [h or _("Column {0}").format(i + 1) for i, h in enumerate((rows[0] + [""] * width)[:width])]
	return header, [(r + [""] * width)[:width] for r in rows[1:]]


def _google_csv(url):
	import requests

	m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]{20,})", cstr(url))
	if not m or urlparse(cstr(url)).hostname != "docs.google.com":
		frappe.throw(_("That is not a Google Sheets link. Copy it from the sheet's address bar or from Share."))
	gid = re.search(r"[#&?]gid=(\d+)", cstr(url))
	target = f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv" + (f"&gid={gid.group(1)}" if gid else "")
	for _hop in range(4):  # follow redirects by hand, only to Google
		host = urlparse(target).hostname or ""
		if not (host == "docs.google.com" or host.endswith(".googleusercontent.com")):
			frappe.throw(_("Google sent us somewhere unexpected."))
		r = requests.get(target, timeout=20, allow_redirects=False, stream=True)
		if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("Location"):
			target = r.headers["Location"]
			continue
		break
	else:
		frappe.throw(_("Could not open the sheet."))
	if r.status_code != 200 or "text/html" in r.headers.get("Content-Type", ""):
		frappe.throw(_("Could not read the sheet. Open it, click Share, and set \"Anyone with the link\" to Viewer."))
	body = r.raw.read(MAX_BYTES + 1, decode_content=True)
	if len(body) > MAX_BYTES:
		frappe.throw(_("That sheet is too big."))
	return body.decode("utf-8-sig", errors="replace")


@frappe.whitelist()
def read_sheet(kind, content=None, filename=None, url=None):
	"""``kind`` file (``content`` is the file in base64, ``filename`` its name; .csv or .xlsx) or sheet (``url`` of a Google Sheet shared by link).
	Returns {headers, rows, total}."""
	_check()
	if kind == "sheet":
		rows = list(csv.reader(io.StringIO(_google_csv(url))))
	else:
		try:
			raw = base64.b64decode(content or "", validate=False)
		except Exception:
			frappe.throw(_("That file could not be read."))
		if not raw or len(raw) > MAX_BYTES:
			frappe.throw(_("That file is empty or over 10 MB."))
		name = cstr(filename).lower()
		if name.endswith(".xlsx"):
			from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file

			try:
				rows = read_xlsx_file_from_attached_file(fcontent=raw)
			except Exception:
				frappe.throw(_("That Excel file could not be read. Save it as .xlsx or .csv and try again."))
		elif name.endswith((".csv", ".txt")):
			rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
		else:
			frappe.throw(_("Use an Excel (.xlsx) or CSV file, or a Google Sheet link."))
	headers, body = _table(rows)
	return {"headers": headers, "rows": body, "total": len(body)}


@frappe.whitelist()
def suggest_mapping(headers):
	"""The lead fields a person can map to (``fields``) and a guess per sheet column (``mapping``: a fieldname or empty)."""
	_check()
	from crm_addons.pro import form

	hs = frappe.parse_json(headers) if isinstance(headers, str) else headers
	allowed = form.writable()
	by = {}
	for n, spec in allowed.items():
		by[n.lower()] = n
		by[cstr(spec["label"]).strip().lower()] = n
	used, mapping = set(), []
	for h in hs:
		key = cstr(h).strip().lower()
		f = by.get(key) or SYNONYMS.get(key)
		if f in allowed and f not in used:
			used.add(f)
			mapping.append(f)
		else:
			mapping.append("")
	fields = [{"fieldname": n, "label": s["label"], "reqd": s["reqd"], "fieldtype": s["fieldtype"]} for n, s in allowed.items()]
	return {"fields": fields, "mapping": mapping}


@frappe.whitelist()
def add_rows(mapping, rows, dry_run=1, start=2):
	"""Add one batch of sheet rows. ``mapping``: a fieldname (or empty) for each column; ``start``: the sheet row number of the first row here, for messages.
	``dry_run`` checks every row and saves nothing. Returns {created, failed: [{row, reason}]}."""
	_check()
	from crm_addons.pro import form

	mp = frappe.parse_json(mapping) if isinstance(mapping, str) else mapping
	data_rows = frappe.parse_json(rows) if isinstance(rows, str) else rows
	if not isinstance(mp, list) or not isinstance(data_rows, list) or len(data_rows) > BATCH * 2:
		frappe.throw(_("Send the rows in smaller batches."))
	allowed = form.writable()
	if any(m and m not in allowed for m in mp):
		frappe.throw(_("A column is matched to a field that cannot be imported."))
	if len({m for m in mp if m}) != len([m for m in mp if m]):
		frappe.throw(_("Two columns are matched to the same field."))
	created, failed = 0, []
	for i, row in enumerate(data_rows, start=cint(start)):
		if not isinstance(row, list) or not any(cstr(c).strip() for c in row):
			continue
		values = {mp[j]: c for j, c in enumerate(row) if j < len(mp) and mp[j]}
		frappe.db.savepoint("pro_import_row")  # before anything can fail, so a failed row only rolls itself back
		try:
			data = {k: v for k, v in form.clean_values(values, allowed).items() if v is not None}
			if not cstr(data.get("first_name")).strip():
				frappe.throw(_("First name is needed."))
			frappe.get_doc({"doctype": LEAD, **data}).insert()
			if cint(dry_run):
				frappe.db.rollback(save_point="pro_import_row")
			created += 1
		except Exception as e:
			frappe.db.rollback(save_point="pro_import_row")
			failed.append({"row": i, "reason": frappe.utils.strip_html(cstr(e))[:160]})
	return {"created": created, "failed": failed}
