---
sidebar_position: 4
---

# Reporting flow

Reports provide business insights based on sales, inventory, and expense data.

## Report types

```mermaid
graph TB
    subgraph "Sales Reports"
        DAILY[Daily Summary]
        WEEKLY[Weekly Summary]
        MONTHLY[Monthly Summary]
        CUSTOM[Custom Range]
    end

    subgraph "Inventory Reports"
        STOCK[Stock Levels]
        MOVEMENTS[Stock Movements]
        LOW[Low Stock Alert]
    end

    subgraph "Financial Reports"
        REVENUE[Revenue Summary]
        EXPENSES[Expense Summary]
        PROFIT[Profit/Loss]
    end

    DAILY --> SALES_DB[(Sales DB)]
    WEEKLY --> SALES_DB
    STOCK --> INV_DB[(Inventory DB)]
    REVENUE --> SALES_DB
    PROFIT --> SALES_DB
    PROFIT --> EXPENSES
```

## Sales report flow

```mermaid
sequenceDiagram
    actor User
    participant UI as POS Interface
    participant API as NestJS API
    participant DB as PostgreSQL

    User->>UI: Select report type + date range
    UI->>API: GET /reports/sales?from=&to=
    API->>DB: Query aggregated sales data
    API->>DB: Calculate totals, averages, top products
    API-->>UI: Return report data
    UI-->>User: Display report + charts

    User->>UI: Export report
    UI->>API: GET /reports/sales/export?format=pdf
    API->>API: Generate PDF/Excel
    API-->>UI: Return file download
    UI-->>User: Download report
```

## Report access by role

| Report | Admin | Supervisor | Cashier |
| --- | --- | --- | --- |
| Daily summary (all) | ✅ | ✅ | ❌ |
| Daily summary (own) | ✅ | ✅ | ✅ |
| Weekly/monthly | ✅ | ✅ | ❌ |
| Custom range | ✅ | ✅ | ❌ |
| Stock levels | ✅ | ✅ | ✅ (read-only) |
| Profit/loss | ✅ | ✅ | ❌ |
| Export (PDF/Excel) | ✅ | ✅ | ❌ |

## Export formats

| Format | Use case |
| --- | --- |
| PDF | Formal reports, printing |
| Excel | Data analysis, accounting import |
| CSV | Raw data export |
