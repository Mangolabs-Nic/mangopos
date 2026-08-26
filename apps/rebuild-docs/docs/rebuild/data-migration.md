---
sidebar_position: 3
---

# Data migration

Migration is a rehearsed, versioned import—not a manual correction exercise.

## Target mapping to validate

| Legacy domain | MangoLabs target | Required handling |
| --- | --- | --- |
| Categories | Categories | Load before products; use `Unclassified` only for approved exceptions. |
| Products | Products | Preserve external ID, name, price, and state; resolve duplicate codes before import. |
| Stock | Opening balance and adjustment | Record cutover date, operator, and reason; physically count critical products. |
| Sales and lines | Sale and sale detail | Preserve date, total, state, source user, and legacy reference; cancellations remain cancellations. |
| Expenses | Expenses | Keep description, amount, date, and category; mark missing fields as incomplete. |
| Activity | Audit log | Preserve reliable type, date, reference, and author; distinguish migrated from new events. |
| Receipts | Sale references/documents | Revalidate numbering and format; do not issue a new fiscal document during import. |
| Users | New user accounts | Never migrate passwords or sessions; assign roles and require a password change. |

Exact tables and fields are unknown until the desktop source and data export are audited.

## Import sequence

1. Back up the source; record checksum, export version, date, and owner.
2. Validate required fields, encoding, dates, currency, and missing relationships.
3. Import organization/configuration, categories, and products.
4. Create new user accounts and distribute credentials securely.
5. Import opening stock and reconcile a physical sample.
6. Import expenses, sales, sale details, receipt references, and approved historical activity.
7. Run automated reconciliation and a business-owner review.
8. Freeze legacy changes during cutover, import the final delta, and obtain approval.

## Reconciliation gate

Check record counts by entity and period; compare sales, discounts, tax where present, expenses, and inventory value; sample at least 20 sales including cancellations, discounts, and stock-edge cases; and list every rejected, transformed, or skipped record with an owner-approved reason.

If reconciliation fails, block cutover. Fix the transformation, restore the test environment, and rerun the import. Never adjust production totals by hand merely to make them match.

