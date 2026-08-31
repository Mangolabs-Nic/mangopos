---
sidebar_position: 1
---

# Architecture overview

import { SystemContextDiagram } from '@site/src/components/diagrams';
import { ComponentArchitectureDiagram } from '@site/src/components/diagrams';
import { DeploymentArchDiagram } from '@site/src/components/diagrams';
import { SecurityModelDiagram } from '@site/src/components/diagrams';

## Current system (Godot + SQLite)

PoopPOS today is a **Godot 4.7 desktop application** with SQLite storage and a built-in web server. See the [Godot legacy documentation](./godot-legacy) for full details.

| Layer | Current | Target |
| --- | --- | --- |
| Runtime | Godot 4.7 (GDScript) | NestJS (TypeScript) |
| Frontend | Godot scenes (Control nodes) | React 19 (Vite) |
| Database | SQLite (file-based) | PostgreSQL (Supabase) |
| Auth | PIN + opaque tokens | JWT (Supabase Auth) |
| Hosting | Desktop / browser export | Railway + GitHub Pages |

## Target system (NestJS + React + Supabase)

The [migration plan](../rebuild/migration-plan) details how each Godot module maps to the NestJS architecture below.

**Drag nodes to rearrange. Scroll to zoom. MiniMap in bottom-right.**

<SystemContextDiagram />

## Component architecture

<div style={{ marginTop: '2rem' }}>
<ComponentArchitectureDiagram />
</div>

## Target technology stack

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
