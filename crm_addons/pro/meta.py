"""Meta (Facebook and Instagram) lead ads, managed from Settings -> Integrations -> Meta, never from Desk.

How a lead travels:

1. Someone fills in a lead form on a Facebook or Instagram ad. Meta posts a small "leadgen" notice to ``webhook`` (instantly).
2. The notice is checked (Meta's signature, made with your app secret) and queued. A background job asks the Graph API for the lead (with the Page's token),
   including the campaign, ad set and ad it came from.
3. The answers are put on a CRM Lead with the mapping chosen for that form, with the source set to Facebook or Instagram. Somebody who is already a lead
   (same email or phone) is not duplicated: a note is written on the existing lead, its owner is notified, and the lead page offers "Update details" with one
   click (``apply_entry``).
4. Every lead, duplicate and failure is kept in ``CRM Meta Lead Log`` with what Meta sent. An hourly catch-up asks Meta for recent leads of every form, so a missed
   notice never loses a lead. Failed leads can be retried from the page.

Only an administrator can see or change any of this. Tokens are stored as Password fields and never sent back to the browser.
"""

import hashlib
import hmac
import json
import re
import secrets

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, get_url, now_datetime
from frappe.utils.html_utils import escape_html

SETTINGS = "CRM Meta Settings"
FORM = "CRM Meta Form"
LOG = "CRM Meta Lead Log"
LEAD = "CRM Lead"
GRAPH = "https://graph.facebook.com"
METHOD = "/api/method/crm_addons.pro.meta.webhook"
FULL_NAME = "__full_name"
LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,platform,is_organic"

# what the token must be allowed to do: (permission, what it is for, required)
PERMISSIONS = [
	("leads_retrieval", "Read the leads from your forms", True),
	("pages_show_list", "List the Pages the token can use", True),
	("pages_read_engagement", "Read the Page and its forms", True),
	("pages_manage_metadata", "Receive new leads instantly (webhook)", True),
	("pages_manage_ads", "Read lead forms and leads of the Page", True),
	("ads_read", "Show the campaign, ad set and ad names on the lead", False),
	("business_management", "Use Pages that belong to your Business Manager", False),
]
# a Meta question key -> the CRM Lead field it normally belongs in
DEFAULT_MAP = {
	"full_name": FULL_NAME, "first_name": "first_name", "last_name": "last_name", "email": "email", "phone_number": "mobile_no", "phone": "mobile_no",
	"company_name": "organization", "job_title": "job_title", "city": "city", "website": "website",
}
SOURCES = {"ig": "Instagram", "instagram": "Instagram"}


class MetaError(Exception):
	pass


def _admin():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only a System Manager can change this."), frappe.PermissionError)


def _settings():
	return frappe.get_single(SETTINGS)


def _verify_token():
	s = _settings()
	if not s.verify_token:
		s.verify_token = secrets.token_urlsafe(16)
		s.flags.ignore_permissions = True
		s.save()
	return s.verify_token


# -- the Graph API ---------------------------------------------------------------------------------------------------


def graph(path, token, params=None, method="get"):
	"""One Graph API call. Raises MetaError with Meta's own message."""
	import requests

	if not token:
		raise MetaError(_("No access token is saved yet."))
	version = _settings().api_version or "v23.0"
	try:
		res = requests.request(method, f"{GRAPH}/{version}/{path}", params=params or {}, headers={"Authorization": f"Bearer {token}"}, timeout=15)
		data = res.json()
	except Exception as exc:
		raise MetaError(_("Could not reach Meta: {0}").format(cstr(exc)[:150])) from exc
	if res.status_code >= 400 or (isinstance(data, dict) and data.get("error")):
		err = (data.get("error") if isinstance(data, dict) else None) or {}
		message = cstr(err.get("message") or res.status_code)
		if err.get("code") == 190:
			message = _("The access token is no longer valid ({0}). Create a new system user token and save it again.").format(message)
		raise MetaError(message[:400])
	return data


def _system_token():
	return _settings().get_password("system_token", raise_exception=False)


def _page_token(form):
	return frappe.utils.password.get_decrypted_password(FORM, form if isinstance(form, str) else form.name, "page_token", raise_exception=False)


def _pages(token):
	out, after = [], None
	for _i in range(5):
		data = graph("me/accounts", token, {"fields": "id,name,category,access_token", "limit": 100, **({"after": after} if after else {})})
		out += data.get("data", [])
		after = ((data.get("paging") or {}).get("cursors") or {}).get("after")
		if not (data.get("paging") or {}).get("next"):
			break
	return out


# -- the screen -------------------------------------------------------------------------------------------------------


@frappe.whitelist()
def get_overview():
	_admin()
	s = _settings()
	since = add_days(now_datetime(), -30)
	counts = {}
	for form, result, n in frappe.db.sql("SELECT form, result, COUNT(*) FROM `tabCRM Meta Lead Log` WHERE creation >= %s GROUP BY form, result", since):
		counts.setdefault(form, {})[result] = n
	forms = []
	for f in frappe.get_all(FORM, fields=["name", "form_id", "form_name", "page_id", "page_name", "enabled", "subscribed", "last_lead_at", "mapping"], order_by="creation asc", limit_page_length=100):
		c = counts.get(f.name, {})
		forms.append({
			"form_id": f.form_id, "form_name": f.form_name or f.form_id, "page_id": f.page_id, "page_name": f.page_name, "enabled": cint(f.enabled), "subscribed": cint(f.subscribed),
			"last_lead_at": cstr(f.last_lead_at or ""), "mapped": len([v for v in _json(f.mapping).values() if v]),
			"stats": {"received": sum(c.values()), "created": c.get("Created", 0), "duplicate": c.get("Duplicate", 0), "failed": c.get("Failed", 0)},
		})
	return {
		"connected": bool(_system_token()), "app_id": cstr(s.app_id), "has_secret": bool(s.get_password("app_secret", raise_exception=False)), "version": s.api_version or "v23.0",
		"webhook_url": f"{get_url()}{METHOD}", "verify_token": _verify_token(), "last_event": cstr(s.last_event or ""), "forms": forms,
		"permissions": [{"key": k, "label": label, "required": req} for k, label, req in PERMISSIONS],
		"recent": recent_log(15), "fields": crm_fields(),
	}


def crm_fields():
	"""The CRM Lead fields a form question can be put into: only fields the CRM already has."""
	from crm_addons.demos import leadforms

	meta = frappe.get_meta(LEAD)
	out = [{"value": FULL_NAME, "label": "Full name (split into first and last name)"}]
	for df in meta.fields:
		if df.fieldname in leadforms.CORE or leadforms._offerable(df):
			out.append({"value": df.fieldname, "label": df.label or df.fieldname})
	return out


def _json(value):
	try:
		out = json.loads(value) if value else {}
	except ValueError:
		return {}
	return out if isinstance(out, dict) else {}


@frappe.whitelist()
def save_connection(token=None, app_id=None, app_secret=None, api_version=None):
	"""Save what was typed. Empty boxes keep the saved value, so a password is never asked for again."""
	_admin()
	s = _settings()
	if cstr(token).strip():
		s.system_token = cstr(token).strip()
	if cstr(app_id).strip():
		if not cstr(app_id).strip().isdigit():
			frappe.throw(_("The App ID is a number."))
		s.app_id = cstr(app_id).strip()
	if cstr(app_secret).strip():
		s.app_secret = cstr(app_secret).strip()
	if cstr(api_version).strip():
		if not re.match(r"^v\d+\.\d+$", cstr(api_version).strip()):
			frappe.throw(_("The API version looks like v23.0."))
		s.api_version = cstr(api_version).strip()
	if not s.verify_token:
		s.verify_token = secrets.token_urlsafe(16)
	s.flags.ignore_permissions = True
	s.save()
	return {"saved": True}


@frappe.whitelist()
def disconnect():
	"""Forget the token and switch every form off. The leads already imported stay."""
	_admin()
	s = _settings()
	s.system_token = ""
	s.flags.ignore_permissions = True
	s.save()
	for name in frappe.get_all(FORM, pluck="name"):
		frappe.db.set_value(FORM, name, {"enabled": 0, "subscribed": 0})
	return {"ok": True}


@frappe.whitelist()
def test_connection():
	"""Is the token valid, what may it do, which Pages does it reach, and is anything missing. Reports problems instead of raising."""
	_admin()
	token = _system_token()
	if not token:
		return {"ok": False, "message": _("Save the access token first.")}
	try:
		me = graph("me", token, {"fields": "id,name"})
		granted = {p.get("permission") for p in graph("me/permissions", token).get("data", []) if p.get("status") == "granted"}
		pages = _pages(token)
	except MetaError as exc:
		return {"ok": False, "message": cstr(exc)}
	expires = None
	s = _settings()
	secret = s.get_password("app_secret", raise_exception=False)
	if s.app_id and secret:
		try:
			info = graph("debug_token", f"{s.app_id}|{secret}", {"input_token": token}).get("data", {})
			if info.get("is_valid") is False:
				return {"ok": False, "message": _("Meta says this token is not valid: {0}").format((info.get("error") or {}).get("message", ""))}
			expires = info.get("expires_at")
		except MetaError:
			pass
	perms = [{"key": k, "label": label, "required": req, "granted": k in granted} for k, label, req in PERMISSIONS]
	missing = [p["key"] for p in perms if p["required"] and not p["granted"]]
	ok = not missing and bool(pages)
	if missing:
		message = _("Connected as {0}, but the token lacks: {1}.").format(me.get("name"), ", ".join(missing))
	elif not pages:
		message = _("The token works, but no Page is assigned to it. Add your Page to the system user in Business Settings.")
	else:
		message = _("Connected as {0}. {1} Page(s) available.").format(me.get("name"), len(pages))
	return {"ok": ok, "message": message, "name": me.get("name"), "permissions": perms, "pages": len(pages), "never_expires": expires == 0, "expires_at": expires if expires else None}


@frappe.whitelist()
def list_pages():
	_admin()
	try:
		return [{"id": p["id"], "name": p.get("name"), "category": p.get("category")} for p in _pages(_system_token())]
	except MetaError as exc:
		frappe.throw(cstr(exc))


@frappe.whitelist()
def list_forms(page_id):
	"""The lead forms of a Page with their questions, and the mapping we would suggest for each."""
	_admin()
	token = _system_token()
	try:
		page = next((p for p in _pages(token) if p["id"] == cstr(page_id)), None)
		if not page:
			frappe.throw(_("This Page is not available to the token."))
		data = graph(f"{page_id}/leadgen_forms", page["access_token"], {"fields": "id,name,status,questions", "limit": 100})
	except MetaError as exc:
		frappe.throw(cstr(exc))
	added = set(frappe.get_all(FORM, pluck="form_id"))
	out = []
	for f in data.get("data", []):
		questions = [{"key": q.get("key"), "label": q.get("label") or q.get("key"), "type": q.get("type")} for q in f.get("questions", []) if q.get("key")]
		out.append({"id": f["id"], "name": f.get("name"), "status": f.get("status"), "questions": questions, "mapping": default_mapping(questions), "added": f["id"] in added})
	return out


def default_mapping(questions):
	allowed = {c["value"] for c in crm_fields()}
	return {q["key"]: (DEFAULT_MAP.get(q["key"]) if DEFAULT_MAP.get(q["key"]) in allowed else "") for q in questions}


def _clean_mapping(mapping, questions=None):
	mapping = _json(mapping) if not isinstance(mapping, dict) else mapping
	allowed = {c["value"] for c in crm_fields()}
	out = {}
	for key, target in mapping.items():
		target = cstr(target)
		if target and target not in allowed:
			frappe.throw(_("{0} is not a field the CRM has.").format(target))
		out[cstr(key)] = target
	targets = set(out.values())
	if not ({FULL_NAME, "first_name"} & targets):
		frappe.throw(_("Choose which question is the person's name (full name or first name). A lead needs one."))
	if not ({"email", "mobile_no"} & targets):
		frappe.throw(_("Choose which question is the email or the phone number, so duplicates can be found."))
	return out


@frappe.whitelist()
def add_form(page_id, form_id, mapping=None):
	"""Connect a lead form: keep the Page's token, subscribe the Page to new leads, and save the mapping."""
	_admin()
	token = _system_token()
	if frappe.db.exists(FORM, form_id):
		frappe.throw(_("This form is already connected."))
	try:
		page = next((p for p in _pages(token) if p["id"] == cstr(page_id)), None)
		if not page:
			frappe.throw(_("This Page is not available to the token."))
		form = graph(form_id, page["access_token"], {"fields": "id,name,questions"})
	except MetaError as exc:
		frappe.throw(cstr(exc))
	questions = [{"key": q.get("key"), "label": q.get("label") or q.get("key"), "type": q.get("type")} for q in form.get("questions", []) if q.get("key")]
	mapping = _clean_mapping(mapping if mapping else default_mapping(questions), questions)
	doc = frappe.get_doc({"doctype": FORM, "form_id": form["id"], "form_name": form.get("name"), "page_id": page["id"], "page_name": page.get("name"), "page_token": page["access_token"],
		"enabled": 1, "mapping": json.dumps(mapping), "questions": json.dumps(questions)}).insert(ignore_permissions=True)
	subscribed, note = _subscribe(page["id"], page["access_token"])
	doc.db_set("subscribed", 1 if subscribed else 0)
	return {"form_id": doc.form_id, "subscribed": subscribed, "note": note}


def _subscribe(page_id, page_token):
	try:
		graph(f"{page_id}/subscribed_apps", page_token, {"subscribed_fields": "leadgen"}, method="post")
		return True, ""
	except MetaError as exc:
		return False, cstr(exc)


@frappe.whitelist()
def save_mapping(form_id, mapping):
	_admin()
	doc = frappe.get_doc(FORM, form_id)
	doc.mapping = json.dumps(_clean_mapping(mapping))
	doc.save(ignore_permissions=True)
	return {"saved": True}


@frappe.whitelist()
def set_form(form_id, enabled):
	_admin()
	frappe.db.set_value(FORM, form_id, "enabled", 1 if cint(enabled) else 0)
	return {"enabled": 1 if cint(enabled) else 0}


@frappe.whitelist()
def form_detail(form_id):
	_admin()
	f = frappe.get_doc(FORM, form_id)
	return {"form_id": f.form_id, "form_name": f.form_name, "questions": _json(f.questions) if False else json.loads(f.questions or "[]"), "mapping": _json(f.mapping)}


@frappe.whitelist()
def remove_form(form_id):
	"""Disconnect a form. Its leads and log stay. The Page stops sending notices only when no other form of it is connected."""
	_admin()
	f = frappe.get_doc(FORM, form_id)
	page, token = f.page_id, _page_token(f)
	frappe.delete_doc(FORM, form_id, ignore_permissions=True)
	if token and not frappe.db.exists(FORM, {"page_id": page}):
		try:
			graph(f"{page}/subscribed_apps", token, method="delete")
		except MetaError:
			pass
	return {"removed": True}


@frappe.whitelist()
def test_form(form_id):
	"""Check one form end to end without creating anything: the Page token, the form, the Page's subscription, and what a lead would look like."""
	_admin()
	f = frappe.get_doc(FORM, form_id)
	token = _page_token(f)
	steps = []

	def step(label, ok, detail=""):
		steps.append({"label": label, "ok": bool(ok), "detail": cstr(detail)})
		return ok

	try:
		info = graph(f.form_id, token, {"fields": "id,name,status,leads_count"})
		step(_("Meta lets the CRM read this form"), True, _("{0}, status {1}").format(info.get("name"), info.get("status")))
	except MetaError as exc:
		step(_("Meta lets the CRM read this form"), False, exc)
		return {"ok": False, "steps": steps}
	try:
		subs = graph(f"{f.page_id}/subscribed_apps", token).get("data", [])
		on = any("leadgen" in (a.get("subscribed_fields") or []) for a in subs)
		step(_("The Page sends new leads to the CRM instantly"), on, "" if on else _("Not subscribed. Save the form again, or check pages_manage_metadata."))
		frappe.db.set_value(FORM, f.name, "subscribed", 1 if on else 0)
	except MetaError as exc:
		step(_("The Page sends new leads to the CRM instantly"), False, exc)
	s = _settings()
	step(_("The app secret is saved, so Meta's notices can be trusted"), bool(s.get_password("app_secret", raise_exception=False)), _("Add the App secret under Connection."))
	mapping = _json(f.mapping)
	sample = {"field_data": [{"name": k, "values": [_sample(k)]} for k in mapping]}
	values, extra = _map(mapping, sample["field_data"])
	_lead, how = _find_duplicate(values)
	step(_("A sample lead is mapped to CRM fields"), values.get("first_name"), ", ".join(f"{k}: {v}" for k, v in values.items()))
	return {"ok": all(x["ok"] for x in steps), "steps": steps, "sample": values}


def _sample(key):
	return {"full_name": "Asha Verma", "first_name": "Asha", "last_name": "Verma", "email": "asha.sample@example.com", "phone_number": "+919800000000", "phone": "+919800000000",
		"company_name": "Sample Co", "city": "Pune"}.get(key, "Sample answer")


# -- the webhook ---------------------------------------------------------------------------------------------------


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def webhook():
	"""Meta's address. GET answers Meta's verification; POST carries new-lead notices, accepted only with a valid signature."""
	from werkzeug.wrappers import Response

	if frappe.request.method == "GET":
		token = cstr(frappe.form_dict.get("hub.verify_token"))
		expected = cstr(_settings().verify_token)
		if frappe.form_dict.get("hub.mode") == "subscribe" and expected and hmac.compare_digest(token, expected):
			return Response(cstr(frappe.form_dict.get("hub.challenge")), status=200)
		frappe.throw(_("Verification failed."), frappe.PermissionError)
	raw = frappe.request.get_data()
	secret = _settings().get_password("app_secret", raise_exception=False)
	signature = cstr(frappe.get_request_header("X-Hub-Signature-256")).replace("sha256=", "")
	if not secret or not signature or not hmac.compare_digest(hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(), signature):
		frappe.throw(_("Not allowed."), frappe.PermissionError)
	try:
		payload = json.loads(raw or b"{}")
	except ValueError:
		frappe.throw(_("Not a valid message."))
	frappe.db.set_single_value(SETTINGS, "last_event", now_datetime())
	for entry in payload.get("entry", []):
		for change in entry.get("changes", []):
			value = change.get("value") or {}
			if change.get("field") == "leadgen" and value.get("leadgen_id"):
				frappe.enqueue("crm_addons.pro.meta.process_lead", queue="default", leadgen_id=cstr(value["leadgen_id"]), form_id=cstr(value.get("form_id")), via="Webhook", enqueue_after_commit=True)
	return Response("ok", status=200)


# -- one lead ----------------------------------------------------------------------------------------------------------


def _map(mapping, field_data):
	"""``({crm field: value}, [(label, value)])``: the answers that have a mapping, and the others for the note."""
	values, extra = {}, []
	for item in field_data or []:
		key = cstr(item.get("name"))
		answer = ", ".join(cstr(v) for v in (item.get("values") or []) if cstr(v).strip()).strip()
		if not answer:
			continue
		target = mapping.get(key)
		if target == FULL_NAME:
			first, _sep, last = answer.partition(" ")
			values.setdefault("first_name", first)
			if last.strip():
				values.setdefault("last_name", last.strip())
		elif target:
			values.setdefault(target, answer)
		else:
			extra.append((key.replace("_", " ").capitalize(), answer))
	return values, extra


def _find_duplicate(values):
	from crm_addons.demos import leadforms

	return leadforms.find_duplicate(cstr(values.get("email")).strip().lower() or None, values.get("mobile_no"))


def _source_of(platform):
	return SOURCES.get(cstr(platform).lower(), "Facebook")


def _record(leadgen_id, result, form=None, via="", data=None, values=None, lead=None, matched_by="", comment="", error=""):
	data = data or {}
	values = values or {}
	row = {
		"leadgen_id": leadgen_id, "form": form.name if form else cstr(data.get("form_id")), "form_name": (form.form_name if form else "") or "", "result": result, "via": via,
		"lead": lead, "matched_by": matched_by, "platform": cstr(data.get("platform")), "source": _source_of(data.get("platform")),
		"person_name": " ".join(x for x in (values.get("first_name"), values.get("last_name")) if x), "email": values.get("email"), "phone": values.get("mobile_no"),
		"campaign_id": data.get("campaign_id"), "campaign_name": data.get("campaign_name"), "adset_id": data.get("adset_id"), "adset_name": data.get("adset_name"),
		"ad_id": data.get("ad_id"), "ad_name": data.get("ad_name"), "lead_time": _time(data.get("created_time")), "values_json": json.dumps(values), "raw_json": json.dumps(data)[:60000],
		"error": cstr(error)[:1000], "comment": comment,
	}
	existing = frappe.db.get_value(LOG, {"leadgen_id": leadgen_id})
	if existing:
		doc = frappe.get_doc(LOG, existing)
		doc.update(row)
		doc.save(ignore_permissions=True)
		return doc.name
	return frappe.get_doc({"doctype": LOG, **row}).insert(ignore_permissions=True).name


def _time(value):
	try:
		return frappe.utils.get_datetime(cstr(value).replace("+0000", "")).replace(tzinfo=None) if value else None
	except Exception:
		return None


def process_lead(leadgen_id, form_id=None, via="Webhook", data=None):
	"""Turn one Meta lead into a CRM Lead (or a note on the lead it duplicates) and log it. Safe to run twice for the same lead."""
	frappe.set_user("Administrator")
	leadgen_id = cstr(leadgen_id)
	existing = frappe.db.get_value(LOG, {"leadgen_id": leadgen_id}, ["name", "result"], as_dict=True)
	if existing and existing.result in ("Created", "Duplicate"):
		return existing.result
	form = frappe.get_doc(FORM, form_id) if form_id and frappe.db.exists(FORM, form_id) else None
	if not form or not cint(form.enabled):
		_record(leadgen_id, "Ignored", form, via, data={"form_id": form_id}, error=_("This form is not connected, or is switched off."))
		return "Ignored"
	try:
		data = data or graph(leadgen_id, _page_token(form), {"fields": LEAD_FIELDS})
	except MetaError as exc:
		_record(leadgen_id, "Failed", form, via, data={"form_id": form_id}, error=cstr(exc))
		return "Failed"
	values, extra = _map(_json(form.mapping), data.get("field_data"))
	if not values.get("first_name"):
		values["first_name"] = (cstr(values.get("email")).split("@")[0] or _("Meta lead")).title()
	try:
		lead, how = _find_duplicate(values)
		if lead:
			comment = _note_duplicate(form, lead, how, values, extra, data)
			_record(leadgen_id, "Duplicate", form, via, data, values, lead=lead, matched_by=how, comment=comment)
			result = "Duplicate"
		else:
			name = _create_lead(form, values, extra, data)
			_record(leadgen_id, "Created", form, via, data, values, lead=name)
			result = "Created"
		frappe.db.set_value(FORM, form.name, "last_lead_at", now_datetime())
		return result
	except Exception:
		frappe.db.rollback()
		_record(leadgen_id, "Failed", form, via, data, values, error=frappe.get_traceback(with_context=False).splitlines()[-1])
		frappe.log_error(title="Meta lead ads: could not save a lead", message=frappe.get_traceback())
		return "Failed"


def _ad_html(data):
	rows = [(_("Campaign"), data.get("campaign_name")), (_("Ad set"), data.get("adset_name")), (_("Ad"), data.get("ad_name"))]
	rows = [(a, b) for a, b in rows if b]
	return "".join(f"<li>{escape_html(a)}: {escape_html(cstr(b))}</li>" for a, b in rows)


def _create_lead(form, values, extra, data):
	meta = frappe.get_meta(LEAD)
	doc = {"doctype": LEAD, **values, "source": _source_of(data.get("platform"))}
	attribution = {"crm_meta_form": form.form_name, "crm_meta_leadgen_id": data.get("id"), "crm_meta_campaign_id": data.get("campaign_id"), "crm_meta_campaign_name": data.get("campaign_name"),
		"crm_meta_adset_id": data.get("adset_id"), "crm_meta_adset_name": data.get("adset_name"), "crm_meta_ad_id": data.get("ad_id"), "crm_meta_ad_name": data.get("ad_name")}
	for key, value in attribution.items():
		if value and meta.has_field(key):
			doc[key] = value
	lead = frappe.get_doc(doc).insert(ignore_permissions=True)
	answers = "".join(f"<li>{escape_html(a)}: {escape_html(b)}</li>" for a, b in extra)
	platform = _source_of(data.get("platform"))
	lead.add_comment("Comment", f"<p><b>{escape_html(_('Came in through a {0} lead ad').format(platform))}</b>, form “{escape_html(form.form_name or '')}”.</p>"
		+ (f"<ul>{_ad_html(data)}</ul>" if _ad_html(data) else "") + (f"<p>{escape_html(_('Other answers:'))}</p><ul>{answers}</ul>" if answers else ""))
	return lead.name


def _note_duplicate(form, lead, how, values, extra, data):
	rows = "".join(f"<li>{escape_html(k)}: {escape_html(cstr(v))}</li>" for k, v in values.items())
	how_text = _("email address") if how == "email" else _("phone number")
	doc = frappe.get_doc(LEAD, lead)
	comment = doc.add_comment("Comment", f"<p><b>{escape_html(_('Filled in a Meta lead ad again'))}</b>, form “{escape_html(form.form_name or '')}” ({escape_html(_('same {0} as this lead').format(how_text))}). "
		f"{escape_html(_('They shared:'))}</p><ul>{rows}</ul>" + (f"<ul>{_ad_html(data)}</ul>" if _ad_html(data) else ""))
	owner = doc.get("lead_owner")
	if owner and owner != "Guest":
		try:
			frappe.get_doc({"doctype": "Notification Log", "for_user": owner, "type": "Alert", "document_type": LEAD, "document_name": lead, "from_user": "Administrator",
				"subject": _("{0} filled in a Meta lead ad again").format(doc.get("lead_name") or lead)}).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="Meta lead ads: could not notify the lead owner", message=frappe.get_traceback())
	return comment.name


def apply_entry(entry, lead):
	"""Update details: put what the person shared on the lead (only what differs). Returns the changed labels."""
	from crm_addons.demos import leadforms

	row = frappe.db.get_value(LOG, entry, ["lead", "values_json", "applied", "result"], as_dict=True)
	if not row or row.lead != lead or row.result != "Duplicate":
		frappe.throw(_("This update does not belong to this lead."))
	if cint(row.applied):
		frappe.throw(_("These details were already applied."))
	meta = frappe.get_meta(LEAD)
	doc = frappe.get_doc(LEAD, lead)
	changed = []
	for name, value in _json(row.values_json).items():
		df = meta.get_field(name)
		if not df or value in (None, "") or (name not in leadforms.CORE and not leadforms._offerable(df)):
			continue
		if cstr(doc.get(name)) != cstr(value):
			doc.set(name, value)
			changed.append(df.label or name)
	if changed:
		doc.save()
		doc.add_comment("Comment", f"<p>{escape_html(_('Details updated from the Meta lead ad:'))} {escape_html(', '.join(changed))}</p>")
	frappe.db.set_value(LOG, entry, {"applied": 1, "applied_on": now_datetime(), "applied_by": frappe.session.user}, update_modified=False)
	return changed


def entries_for_lead(lead):
	"""``{comment name: {entry, applied, form, changes, label}}`` for the lead's Meta duplicate notes, so the timeline can offer the button."""
	out = {}
	for e in frappe.get_all(LOG, filters={"lead": lead, "result": "Duplicate"}, fields=["name", "comment", "applied", "values_json", "form_name"], limit_page_length=100):
		if e.comment:
			out[e.comment] = {"entry": e.name, "applied": cint(e.applied), "form": e.form_name, "changes": len(_json(e.values_json)), "label": "Meta lead ad", "meta": 1}
	return out


# -- the log, retries, catching up ----------------------------------------------------------------------------------------


def recent_log(limit=15):
	return frappe.get_all(LOG, fields=["name", "creation", "result", "via", "form_name", "platform", "source", "person_name", "email", "phone", "lead", "campaign_name", "adset_name", "ad_name", "error", "applied"],
		order_by="creation desc", limit_page_length=limit)


@frappe.whitelist()
def retry(entry):
	"""Fetch a failed lead from Meta again and process it."""
	_admin()
	row = frappe.db.get_value(LOG, entry, ["leadgen_id", "form", "result"], as_dict=True)
	if not row or row.result not in ("Failed", "Ignored"):
		frappe.throw(_("Only a failed lead can be retried."))
	return {"result": process_lead(row.leadgen_id, row.form, "Retry")}


def catch_up():
	"""Hourly: ask Meta for the recent leads of every connected form and process the ones the log does not have. A missed notice never loses a lead."""
	if not frappe.db.exists("DocType", FORM) or not _system_token():
		return
	for f in frappe.get_all(FORM, filters={"enabled": 1}, pluck="name"):
		try:
			form = frappe.get_doc(FORM, f)
			since = int((frappe.utils.get_datetime(add_days(now_datetime(), -3))).timestamp())
			data = graph(f"{form.form_id}/leads", _page_token(form), {"fields": LEAD_FIELDS, "limit": 50, "filtering": json.dumps([{"field": "time_created", "operator": "GREATER_THAN", "value": since}])})
			for lead in data.get("data", []):
				if not frappe.db.exists(LOG, {"leadgen_id": cstr(lead.get("id")), "result": ["in", ["Created", "Duplicate"]]}):
					process_lead(lead.get("id"), form.form_id, "Catch-up", lead)
		except Exception:
			frappe.log_error(title="Meta lead ads: the hourly catch-up failed for a form", message=frappe.get_traceback())
