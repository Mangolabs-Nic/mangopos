---
sidebar_position: 2
---

# Inventory flow

Inventory management ensures stock accuracy and prevents negative stock without authorization.

## Flow diagram

```mermaid
sequenceDiagram
    actor User
    participant UI as POS Interface
    participant API as NestJS API
    participant DB as PostgreSQL
    participant AUDIT as Audit Log

    User->>UI: View inventory
    UI->>API: GET /inventory
    API->>DB: Query products with stock levels
    API-->>UI: Return product list
    UI-->>User: Display inventory

    User->>UI: Adjust stock
    UI->>UI: Require adjustment reason
    User->>UI: Enter quantity + reason
    UI->>API: POST /inventory/adjust
    API->>DB: BEGIN TRANSACTION
    API->>DB: Insert stock adjustment
    API->>DB: Update product stock level
    API->>AUDIT: Log STOCK_ADJUSTED
    API->>DB: COMMIT
    API-->>UI: Adjustment confirmed
```

## Stock operations

```mermaid
graph TB
    subgraph "Stock Changes"
        SALE[Sale] -->|Decrement| STOCK[Stock Level]
        VOID[Void Sale] -->|Increment| STOCK
        ADJUST[Manual Adjustment] -->|Set| STOCK
        RECEIVE[Receive Stock] -->|Increment| STOCK
        DAMAGE[Damage/Loss] -->|Decrement| STOCK
    end

    STOCK -->|Check| ALERT{Low Stock?}
    ALERT -->|Yes| NOTIFY[Send Alert]
    ALERT -->|No| OK[No Action]
```

## Low stock alerts

| Threshold | Action |
| --- | --- |
| Stock ≤ 0 | Critical alert — product unavailable |
| Stock ≤ low_stock_threshold | Warning alert — reorder needed |
| Stock > threshold | Normal — no action |

## Rules

- Do not permit negative stock without explicit authorization
- Every stock change requires a reason (stored in audit log)
- Stock adjustments are audited with before/after values
- Physical counts override system counts when reconciled
