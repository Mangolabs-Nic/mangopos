---
sidebar_position: 4
---

# Pilot cutover

Start with one business whose owner is available, catalog is manageable, and feedback will be frequent. Expand only after stable operation.

## Before cutover

| When | Required action | Owner |
| --- | --- | --- |
| Seven days before | Final rehearsal, report validation, training, and cutover-window approval. | Both founders and business |
| 24 hours before | Verify backup/restore, hosting capacity, accounts, and the support channel. | Kirk Incer |
| Cutover start | Freeze legacy changes; create final export and checksum. | Business administrator and technical owner |

Train the administrator and cashiers to complete sales, cancellations/returns, closing, and report review before the window opens.

## Cutover window

1. Run the versioned importer.
2. Reconcile counts, totals, stock, and agreed samples.
3. Have the business administrator approve the results.
4. Direct new sales to the MangoLabs POS.
5. Accompany the first full operating day and review errors daily for two weeks.

Migrate catalog and inventory first. Import historical sales only when they add business value and pass reconciliation.

## Rollback

Return temporarily to the legacy system if any of these occur:

- A confirmed sale is lost or duplicated.
- A valid backup cannot be restored.
- A repeatable calculation error affects totals.
- The POS cannot take payments for one hour during business hours.

Keep the legacy system read-only for the agreed post-cutover period. Preserve the original backup, migration report, and support incident record.

## Stabilization exit

The first pilot must operate for seven consecutive days without a critical incident. Only then reproduce the installation for the remaining 5–10 pilot businesses.

