---
sidebar_position: 1
---

# PoopPOS rebuild

This documentation defines the eight-week path from the inherited PoopPOS baseline to a safe MangoLabs pilot for one business, one branch, and up to three users.

## Read this first

- The pilot protects sales, inventory, and recoverability before adding features.
- A pilot starts with one business and expands to 5–10 only after the first operates reliably for seven days.
- Electronic invoicing, multiple branches, offline sync, mobile apps, payment gateways, CRM, and advanced analytics are post-pilot work.

## Repository boundary

This repository hosts the **PoopPOS marketing landing page** plus this documentation workspace. The landing page remains static: `index.html`, images, JSON release messages, Tailwind from a CDN, and vanilla JavaScript. It does **not** contain the desktop POS source code or its database implementation.

The rebuild therefore begins with a verified copy of the actual POS source, a technical audit, and a written license/IP decision. Do not infer the desktop stack from this landing-page repository.

## Pilot outcome

The pilot installation must provide:

- MangoLabs branding and environment-specific configuration.
- Administrator, cashier, and supervisor roles.
- Product catalog, inventory movements, low-stock alerts, sales, expenses, receipts, and audit history.
- Daily, weekly, and monthly sales reports.
- A tested backup and restore procedure, plus an identified support owner.

## Documentation map

| Document | Use it for |
| --- | --- |
| [Roadmap](./rebuild/roadmap) | Phases, gates, and pilot exit criteria. |
| [Required decisions](./rebuild/decisions) | Decisions that block implementation or production data. |
| [Data migration](./rebuild/data-migration) | Repeatable imports and reconciliation. |
| [Pilot cutover](./rebuild/pilot-cutover) | Go-live, support, and rollback. |
| [Phase 1 docs](./rebuild/phase-1/identity) | Product identity, environments, roles, migrations, auditing. |
| [POS Features](./features/overview) | General overview and individual feature sections. |
| [Architecture](./architecture/overview) | System context, components, deployment, and security. |
| [Business flows](./flows/sale) | Sale, inventory, expense, and reporting processes. |
| [Development](./operations/development) | Local setup and project structure. |
| [Deployment](./operations/deployment) | Railway + Supabase deployment guide. |
| [API reference](./operations/api) | Endpoints, authentication, and response formats. |
| [Database](./operations/database) | Schema, entities, RLS, and audit triggers. |
| [GitHub Pages](./operations/github-pages) | Publishing this documentation without replacing the landing page. |
