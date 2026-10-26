# Screenshots

Every image in `docs/images/` is taken from a **showcase site filled with made-up sample data** (a fictional school group, `example.com`
addresses, fake phone numbers). Campaign numbers on it are inserted sample rows, not benchmarks.

To regenerate them on a development bench (Frappe 15 + Frappe CRM + `frappe_whatsapp` + this app, a throw-away site, never a real one):

1. `bench --site showcase.local execute` the seed in stages: `seed_showcase.py base`, then `infra`, then `node capture.js templates`, then `campaigns`
   (run each as `bench --site showcase.local console < ...` or via `execute`; read the header of the script).
2. Serve it and capture: `node capture.js shots` (or `node capture.js shots campaigns-list wizard-preview` for a few). Raw captures land in `.raw/` (ignored by git).
3. `node finish.js` optimises them into `docs/images/` and draws `social-preview.png`.

`capture.js` reads `SHOWCASE_URL`, `SHOWCASE_USER`, `SHOWCASE_PASSWORD` and `PLAYWRIGHT` (path of the Playwright node module).
