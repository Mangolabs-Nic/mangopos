---
sidebar_position: 1
---

# Rebuild roadmap

The plan is an eight-week pilot program. A phase is complete only when its exit gate passes.

| Phase | Timing | Goal | Exit gate |
| --- | --- | --- | --- |
| 0. Discovery and baseline | Week 1 | Verify the inherited system, license, security posture, and data. | The app starts from clean instructions, required notices are known, and no real secrets remain in the repository. |
| 1. Commercial foundation | Weeks 2–3 | Add product identity, environments, roles, migrations, and auditing. | Sensitive actions are server-authorized and a clean install can be updated without manual database edits. |
| 2. Operational integrity | Weeks 4–5 | Make sales, inventory, backups, and reports reliable. | A test sale updates stock and reports correctly; a recent backup restores within the agreed target. |
| 3. Migration rehearsal | Week 6 | Build a repeatable, idempotent importer and prove reconciliation. | Two anonymous-data rehearsals produce matching accepted totals and identified exceptions. |
| 4. Controlled pilot | Weeks 7–8 | Cut over the first business and stabilize it. | The business completes seven days without a lost sale or unexplained inventory difference. |

## Work in order

1. Close all [required decisions](./decisions).
2. Audit the actual desktop POS source and produce an anonymous database export.
3. Secure the foundation before changing commercial workflows.
4. Rehearse migration twice before a business cutover.
5. Launch one pilot first; ship only fixes that protect sales, inventory, security, or backups during stabilization.

## Non-negotiable rules

- A confirmed sale is auditable and is never silently changed or lost.
- Do not delete cancelled sales; record the cancellation.
- Do not permit negative stock without explicit authorization.
- Do not mix data between businesses.
- Do not move real customer data without a backup and business approval.

## Pilot success measures

- Zero lost or duplicated sales.
- One verified restore before cutover and monthly thereafter.
- Reconciled sales and inventory totals, with every exception approved and documented.
- A blocker-response target agreed with the business before installation.

