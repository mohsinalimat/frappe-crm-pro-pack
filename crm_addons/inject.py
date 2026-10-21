"""Load the add-on UI inside the CRM single-page app without editing CRM.

CRM's page (/crm) is a prebuilt HTML file with no place to include an app's script, so
after Frappe has built the response, the script tag is added just before </body>.
"""

import os
import time

import frappe

from crm_addons import __version__, debuglog

MARKER = b"crm_addons/addons.js"


# If Pro Pack has not started 8 seconds after the CRM page loaded (an old copy of the page, a script that did not download),
# clear the browser's saved copy of the CRM (its service worker and caches) and reload once. If it still is not there, say so
# with a Reload button instead of leaving the buttons missing for no visible reason. addons.js clears the "tried once" mark.
WATCHDOG = (
	"(function(){function banner(){if(document.getElementById('cra-missing'))return;var b=document.createElement('div');b.id='cra-missing';"
	"b.setAttribute('role','alert');b.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:12px;"
	"align-items:center;padding:10px 14px;border-radius:10px;background:#1f2937;color:#fff;font:13px/1.3 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)';"
	"b.textContent='CRM Pro Pack did not load.';var r=document.createElement('button');r.textContent='Reload';"
	"r.style.cssText='border:0;border-radius:6px;padding:6px 12px;background:#fff;color:#111;font-weight:600;cursor:pointer';"
	"r.onclick=function(){try{sessionStorage.removeItem('cra_rc')}catch(e){}location.reload()};b.appendChild(r);document.body.appendChild(b)}"
	"function recover(){var tried=false;try{tried=!!sessionStorage.getItem('cra_rc');sessionStorage.setItem('cra_rc','1')}catch(e){}"
	"if(tried){banner();return}var p=[];"
	"try{if(navigator.serviceWorker)p.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(x){return x.unregister()}))}))}catch(e){}"
	"try{if(window.caches)p.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}))}catch(e){}"
	"var done=false;function go(){if(!done){done=true;location.reload()}}setTimeout(go,2500);Promise.all(p).catch(function(){}).then(go)}"
	"window.addEventListener('load',function(){setTimeout(function(){if(!window.__crmAddonsUI)recover()},8000)})})();"
)

_VERSION_CACHE = {"at": 0.0, "value": ""}
_VERSION_TTL = 30  # seconds: walking the folder on every page load is wasted work


def asset_version():
	"""The release plus the newest modification time of any file under public/. Every script, page and stylesheet is
	requested with this as its ``?v=``, so a browser can never keep serving an older copy of one file next to a newer copy
	of another, and ``get_client_config`` hands the same value to the page so it can tell when it is running old files."""
	now = time.monotonic()
	if _VERSION_CACHE["value"] and now - _VERSION_CACHE["at"] < _VERSION_TTL:
		return _VERSION_CACHE["value"]
	newest = 1
	for folder, _dirs, files in os.walk(frappe.get_app_path("crm_addons", "public")):
		for name in files:
			try:
				newest = max(newest, int(os.path.getmtime(os.path.join(folder, name))))
			except OSError:
				continue
	_VERSION_CACHE.update(at=now, value=f"{__version__}-{newest}")
	return _VERSION_CACHE["value"]


_asset_version = asset_version  # the name older code and tests use


def add_addon_script(response=None, request=None, **kwargs):
	"""``after_request`` hook."""
	try:
		path = (getattr(request, "path", "") or "").rstrip("/")
		if path != "/crm" and not path.startswith("/crm/"):
			return
		if (
			response is None
			or response.status_code != 200
			or response.direct_passthrough
			or "text/html" not in (response.headers.get("Content-Type") or "")
			or frappe.session.user == "Guest"
		):
			return
		body = response.get_data()
		if MARKER in body or b"</body>" not in body:
			return
		version = asset_version()
		# TEMPORARY diagnostics (docs/DEBUGGING.md): load first, so it also sees what the other scripts do
		diagnostics = f'<script src="/assets/crm_addons/debug.js?v={version}"></script>' if debuglog.enabled() else ""
		tag = (
			f'<link rel="stylesheet" href="/assets/crm_addons/addons.css?v={version}">'
			f'{diagnostics}'
			f'<script src="/assets/crm_addons/addons.js?v={version}" defer></script>'
			f"<script>{WATCHDOG}</script>"
		).encode()
		response.set_data(body.replace(b"</body>", tag + b"</body>", 1))
		# the page itself must be asked for again each time, so the tag above is never one an old copy kept
		response.headers["Cache-Control"] = "no-cache"
	except Exception:
		# never break the CRM page over a decoration
		frappe.logger().error("CRM Add-ons: could not add the script to the CRM page", exc_info=True)
