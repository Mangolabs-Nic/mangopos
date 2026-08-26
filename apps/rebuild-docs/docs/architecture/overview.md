---
sidebar_position: 1
---

# Architecture overview

import { SystemContextDiagram } from '@site/src/components/diagrams';
import { ComponentArchitectureDiagram } from '@site/src/components/diagrams';
import { DeploymentArchDiagram } from '@site/src/components/diagrams';
import { SecurityModelDiagram } from '@site/src/components/diagrams';

## System context

PoopPOS is a hybrid POS system: a cloud API and database with a React frontend that can operate in connected mode.

**Drag nodes to rearrange. Scroll to zoom. MiniMap in bottom-right.**

<SystemContextDiagram />

## Component architecture

<div style={{ marginTop: '2rem' }}>
<ComponentArchitectureDiagram />
</div>

## Technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19 | POS user interface |
| Backend | NestJS | REST API server |
| Database | PostgreSQL (Supabase) | Persistent data storage |
| Auth | Supabase Auth | JWT authentication + RLS |
| Hosting | Railway | API deployment |
| Docs | Docusaurus 3.10 | This documentation |
| Build | Turborepo | Monorepo task orchestration |

## Deployment architecture

<div style={{ marginTop: '2rem' }}>
<DeploymentArchDiagram />
</div>

## Security model

<div style={{ marginTop: '2rem' }}>
<SecurityModelDiagram />
</div>

**Key security principles:**
- Every request carries a JWT with `user_id` and `business_id`
- Row-Level Security (RLS) enforces multi-tenant isolation at the database level
- No direct database access from the frontend
- Audit logging captures all sensitive operations
