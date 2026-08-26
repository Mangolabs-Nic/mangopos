---
sidebar_position: 2
---

# Sale flow

The sale flow is the core business process. Every sale must be auditable and never silently changed or lost.

## Flow diagram

```mermaid
sequenceDiagram
    actor Cashier
    participant UI as POS Interface
    participant API as NestJS API
    participant DB as PostgreSQL
    participant AUDIT as Audit Log

    Cashier->>UI: Start new sale
    UI->>API: POST /sales
    API->>DB: BEGIN TRANSACTION
    API->>DB: Insert sale record
    API->>DB: Insert sale items
    API->>DB: Update inventory (decrement stock)
    API->>AUDIT: Log SALE_CREATED
    API->>DB: COMMIT
    API-->>UI: Sale created (with receipt)
    UI-->>Cashier: Show confirmation + receipt

    Note over Cashier,AUDIT: If any step fails, transaction rolls back
```

## Sale states

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Completed : Payment confirmed
    Pending --> Voided : Cashier voids (with reason)
    Completed --> Voided : Admin voids (with reason)

    note right of Pending : Sale created, awaiting payment
    note right of Completed : Payment received, stock updated
    note right of Voided : Sale cancelled, stock restored
```

## Void flow

```mermaid
sequenceDiagram
    actor User
    participant UI as POS Interface
    participant API as NestJS API
    participant DB as PostgreSQL
    participant AUDIT as Audit Log

    User->>UI: Select sale to void
    UI->>UI: Require void reason
    User->>UI: Enter reason
    UI->>API: POST /sales/:id/void
    API->>DB: BEGIN TRANSACTION
    API->>DB: Update sale status → voided
    API->>DB: Restore inventory (increment stock)
    API->>AUDIT: Log SALE_VOIDED with reason
    API->>DB: COMMIT
    API-->>UI: Void confirmed
    UI-->>User: Show voided receipt
```

## Rules

- A confirmed sale is auditable and is never silently changed or lost
- Do not delete cancelled sales; record the cancellation
- Void requires a reason (stored in audit log)
- Stock is automatically restored on void
- Only Admin and Cashier can void (Cashier with reason, Admin without restriction)
