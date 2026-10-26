# Contributing to CRM Pro Pack

Thanks for helping. Bug reports, documentation fixes and pull requests are all welcome.

## Before you start

- Open an issue first for anything bigger than a small fix, so we agree on the approach.
- CRM Pro Pack must keep working **without changing Frappe CRM's own code**: it adds to CRM from the outside. Please keep it that way.
- Compatibility target: Frappe v15 with Frappe CRM 1.x, MariaDB, Python 3.10+.

## Development setup

You need a bench with Frappe v15 and Frappe CRM 1.x ([bench install guide](https://frappeframework.com/docs/user/en/installation)).

```bash
cd ~/frappe-bench
bench get-app crm --branch main
bench get-app https://github.com/<your-fork>/frappe-crm-pro-pack --branch main   # your fork
# optional, for the WhatsApp channel of the Campaign Manager:
bench get-app https://github.com/shridarpatil/frappe_whatsapp

bench new-site dev.localhost --install-app crm
bench --site dev.localhost install-app frappe_whatsapp crm_addons   # whatsapp is optional
bench --site dev.localhost migrate
bench start
```

The UI is plain Vue 3 and JavaScript with **no build step**: edit files under `crm_addons/public/`, reload the browser (hard refresh if CRM's service worker serves an older copy). Python changes need `bench restart` (or the dev server's reload).

Where things live: see the file map in the README's *Development* section and [docs/CAMPAIGN_MANAGER.md](docs/CAMPAIGN_MANAGER.md) for the campaign engine.

## Running the tests

```bash
bench --site dev.localhost set-config allow_tests true
bench --site dev.localhost run-tests --app crm_addons
# one module:
bench --site dev.localhost run-tests --module crm_addons.campaigns.doctype.crm_campaign.test_crm_campaign
bench --site dev.localhost set-config allow_tests false
```

Tests run in rolled-back transactions and do not seed sample data. Run them on a **test site without an outgoing Email Account** (see the note in [docs/CAMPAIGN_MANAGER.md](docs/CAMPAIGN_MANAGER.md#testing-checklist)). Providers are faked: no email leaves the site and Meta is never called. Add a test for every behaviour you change, especially permissions and anything that could send a message twice. [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md) is the manual checklist by role.

## Code style

- Python is formatted with [ruff](https://docs.astral.sh/ruff/) using the settings in `pyproject.toml` (line length 110, **tabs**, Python 3.10 target). Run `ruff format` and `ruff check` on the files you touch.
- Keep user-visible strings wrapped for translation (`_()` in Python).
- Enforce permissions on the server; the UI hiding a button is not security.
- No new Python dependencies beyond Frappe itself.
- No personal data, tokens, real addresses or production URLs in code, tests, docs or screenshots.

## Pull request flow

1. Fork, branch from `main` (`fix/short-name` or `feature/short-name`).
2. Make the change with tests and documentation (README, `docs/`, and a line in `CHANGELOG.md` under an "Unreleased" heading).
3. Run the tests as above.
4. Open a pull request that says what changed and why, how you tested it, and includes a screenshot for UI changes.
5. Maintainers review; small focused pull requests are merged fastest.

## Reporting bugs

Open an issue with your Frappe and Frappe CRM versions, the steps to reproduce, what you expected and the exact error text from the page or from **Error Log**. For security problems do **not** open a public issue: see [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
