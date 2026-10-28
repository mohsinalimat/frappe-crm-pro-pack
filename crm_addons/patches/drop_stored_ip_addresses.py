"""Visitors' plain IP addresses are no longer kept (only a one-way hash, to spot repeat visitors). Clears and drops the old column."""

import frappe

TABLES = ("tabCRM Demo Booking", "tabCRM Lead Form Entry")


def execute():
	for table in TABLES:
		if frappe.db.has_column(table[3:], "ip_address"):
			frappe.db.sql_ddl(f"alter table `{table}` drop column `ip_address`")
