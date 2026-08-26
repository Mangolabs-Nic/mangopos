---
sidebar_position: 3
---

# Expense flow

Expense tracking provides visibility into business costs and supports financial reporting.

## Flow diagram

```mermaid
sequenceDiagram
    actor User
    participant UI as POS Interface
    participant API as NestJS API
    participant DB as PostgreSQL
    participant AUDIT as Audit Log

    User->>UI: Create expense
    UI->>UI: Enter amount, category, description
    User->>UI: Submit expense
    UI->>API: POST /expenses
    API->>DB: Insert expense record
    API->>AUDIT: Log EXPENSE_CREATED
    API-->>UI: Expense confirmed
    UI-->>User: Show confirmation
```

## Expense categories

| Category | Description | Examples |
| --- | --- | --- |
| Rent | Monthly rent | Local commercial space |
| Utilities | Services | Electricity, water, internet |
| Supplies | Office supplies | Paper, toner, cleaning |
| Maintenance | Equipment repair | POS hardware, furniture |
| Transport | Delivery/logistics | Fuel, shipping |
| Other | Uncategorized | Miscellaneous costs |

## Rules

- Every expense requires a description and category
- Expenses can be edited by Admin and Supervisor
- Only Admin can delete expenses
- All changes are audited
