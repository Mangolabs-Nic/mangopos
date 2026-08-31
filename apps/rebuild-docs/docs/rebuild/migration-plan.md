---
sidebar_position: 3
---

# Migration plan: Godot → NestJS

:::note
This document maps every module of the current [Godot legacy codebase](../architecture/godot-legacy) to the target NestJS + React + Supabase architecture. Each section identifies what moves, what changes, and what gets dropped.
:::

## Scope

**Source:** Godot 4.7 + GDScript + SQLite (v1.0.7)
**Target:** NestJS (backend) + React 19 (frontend) + Supabase (Postgres + Auth + RLS)

The migration is a full rewrite, not a transliteration. Every module is re-evaluated against modern web patterns before mapping.

## Module mapping

### 1. Auth & employees

| Godot | NestJS + Supabase |
| --- | --- |
| `empleados` table with PIN | Supabase Auth (`auth.users`) + `profiles` table |
| `login.gd` (PIN entry, lockout) | Supabase Auth login (email/password or magic link) |
| `recuperacion_preguntas` | Supabase Auth recovery (built-in email reset) |
| `permisos_empleados` | `user_roles` table + RLS policies |
| `web_sessions` (opaque tokens) | Supabase JWT (short-lived, auto-refresh) |

**Changes:**
- PIN → email/password (or PIN-to-email for simplicity)
- 3-attempt lockout → Supabase rate limiting
- Security questions → built-in password recovery
- Session tokens → JWT with `user_id` + `business_id` claims
- Role system: `admin | supervisor | cashier` mapped to RLS policies

### 2. Products & inventory

| Godot | NestJS + Supabase |
| --- | --- |
| `productos` table | `products` table (Supabase) |
| `categorias` table | `categories` table |
| `historial_stock` table | `stock_movements` table |
| `inventario.gd` | `InventoryModule` (NestJS service + controller) |
| Image upload via `upload_file` | Supabase Storage |

**Changes:**
- Add `business_id` FK for multi-tenancy
- RLS: `business_id = auth.jwt() ->> 'business_id'`
- Stock adjustments get audit trail via triggers
- Images stored in Supabase Storage (not local filesystem)
- SKU field added for barcode scanning

### 3. Sales

| Godot | NestJS + Supabase |
| --- | --- |
| `ventas` table | `sales` table |
| `detalle_venta` table | `sale_items` table |
| `ventas_cabecera` table | Merged into `sales` (tip, discount, tax columns) |
| `ventas.gd` | `SalesModule` (NestJS service + controller) |
| `web_server.gd` → `insertar_venta` | `POST /api/sales` (atomic via Supabase RPC) |

**Changes:**
- Sale creation wrapped in a Supabase database function (atomic insert + stock deduction)
- Receipt generation moves to server-side PDF (or client-side print template)
- Order status flow preserved: `pending → preparing → ready → served → paid`
- Void requires admin approval + reason (audit logged)
- Multi-currency: exchange rate stored in `business_settings`, applied at sale time

### 4. Expenses

| Godot | NestJS + Supabase |
| --- | --- |
| `gastos` table | `expenses` table |
| `gastos.gd` | `ExpensesModule` |

**Changes:**
- Add `business_id` for multi-tenancy
- Add `user_id` FK (who created the expense)
- RLS: users see only their business's expenses
- Category as FK to `expense_categories` (not free text)

### 5. Clients & suppliers

| Godot | NestJS + Supabase |
| --- | --- |
| `clientes` table | `customers` table |
| `proveedores` table | `suppliers` table |
| `clientes.gd` | `CustomersModule` |
| `proveedores.gd` | `SuppliersModule` |

**Changes:**
- Add `business_id` for multi-tenancy
- Optional: link customers to sales for loyalty tracking

### 6. Configuration

| Godot | NestJS + Supabase |
| --- | --- |
| `configuracion` table | `business_settings` table |
| `monedas` table | Merged into `business_settings` (JSONB) |
| `impuestos` table | `tax_rates` table |
| `configuracion.gd` | `SettingsModule` |

**Changes:**
- Per-business settings (not global)
- Tax rates as configurable array (not single IVA value)
- Multi-currency rates stored per-business
- Logo uploaded to Supabase Storage

### 7. Reports

| Godot | NestJS + Supabase |
| --- | --- |
| `reportes.gd` (in-memory calculations) | `ReportsModule` (PostgreSQL queries) |
| Sales summary | `GET /api/reports/sales?from=&to=` |
| Inventory valuation | `GET /api/reports/inventory` |
| Expense breakdown | `GET /api/reports/expenses` |
| Net profit | `GET /api/reports/financial` |

**Changes:**
- All reports become server-side PostgreSQL queries (not client-side loops)
- Date-range filtering via query params
- Export to CSV/PDF
- Real-time dashboard via Supabase Realtime (optional)

### 8. Audit & activity log

| Godot | NestJS + Supabase |
| --- | --- |
| `activity_log` table | `audit_log` table |
| Client-side logging only | Database triggers + NestJS interceptors |

**Changes:**
- Every INSERT/UPDATE/DELETE triggers an audit entry
- Sensitive operations (void sale, adjust stock, delete product) get extra detail
- Admin-only access to full audit trail
- `audit_log` is append-only (no UPDATE/DELETE)

### 9. Web server & static assets

| Godot | NestJS + Supabase |
| --- | --- |
| `web_server.gd` (built-in HTTPServer) | NestJS controllers |
| `web_assets.gd` (file serving) | Supabase Storage + CDN |
| `web/` directory (HTML/CSS/JS) | React SPA |

**Changes:**
- No more built-in web server — NestJS handles all HTTP
- Static assets served via Supabase Storage (or CDN)
- Frontend is a React SPA (Vite + React 19)

## Database migration strategy

### Schema mapping

| Godot table | Target table | Key changes |
| --- | --- | --- |
| `empleados` | `profiles` (Supabase) | `auth.users` for identity, `profiles` for app data |
| `productos` | `products` | Add `business_id`, `sku` |
| `categorias` | `categories` | Add `business_id` |
| `ventas` | `sales` | Add `business_id`, merge `ventas_cabecera` |
| `detalle_venta` | `sale_items` | Add `business_id` |
| `gastos` | `expenses` | Add `business_id`, `user_id` |
| `clientes` | `customers` | Add `business_id` |
| `proveedores` | `suppliers` | Add `business_id` |
| `configuracion` | `business_settings` | Per-business, JSONB for flexible config |
| `monedas` | (merged into settings) | JSONB column |
| `impuestos` | `tax_rates` | Add `business_id` |
| `historial_stock` | `stock_movements` | Add `business_id` |
| `permisos_empleados` | `user_roles` | FK to `auth.users` |
| `web_sessions` | (dropped) | Supabase JWT replaces this |
| `recuperacion_preguntas` | (dropped) | Supabase Auth recovery replaces this |
| `ventas_cabecera` | (merged into sales) | Columns moved to `sales` |
| `activity_log` | `audit_log` | Add `business_id`, server-side triggers |

### Data migration steps

1. **Export** — `sqlite3 sqlite_base.db .dump` from each pilot business
2. **Anonymize** — Strip names, PINs, emails; replace with test data
3. **Transform** — SQL scripts that:
   - Add `business_id` to every row
   - Convert PIN auth to Supabase Auth users
   - Normalize date formats (Godot uses `datetime('now','localtime')`)
   - Merge `ventas_cabecera` into `ventas`
4. **Import** — Supabase SQL editor or migration scripts
5. **Validate** — Row counts, sum totals, referential integrity checks

## Frontend migration

| Godot scene | React equivalent |
| --- | --- |
| `login/login.tscn` | `LoginPage` (Supabase Auth) |
| `cajero/cajero.tscn` | `POSPage` (React + React Flow) |
| `ventas/ventas.tscn` | `SalesHistoryPage` |
| `inventario/inventario.tscn` | `InventoryPage` |
| `clientes/clientes.tscn` | `CustomersPage` |
| `gastos/gastos.tscn` | `ExpensesPage` |
| `reportes/reportes.tscn` | `ReportsPage` |
| `configuracion/configuracion.tscn` | `SettingsPage` |
| `empleados/empleados.tscn` | `EmployeesPage` |
| `categorias/categorias.tscn` | `CategoriesPage` |

**UI principles preserved:**
- Spanish-first interface
- Large touch targets (POS environments)
- Offline-aware (service worker for cached reads)
- Responsive (desktop + tablet)

## Migration phases

| Phase | Scope | Exit gate |
| --- | --- | --- |
| **Phase 1** — Foundation | Auth, products, categories, business settings | CRUD works, RLS enforced |
| **Phase 2** — Sales | Sale creation, cart, receipts, void flow | End-to-end test sale completes |
| **Phase 3** — Operations | Expenses, reports, employees, audit | Reports match manual calculations |
| **Phase 4** — Data import | Anonymize → transform → import pilot data | Row counts and totals match |
| **Phase 5** — Pilot cutover | Deploy, train, 7-day stabilization | Zero lost sales in 7 days |

## Risk register

| Risk | Mitigation |
| --- | --- |
| Data loss during import | Backup before every step; validate with checksums |
| PIN auth change confuses employees | Keep PIN-to-email flow; minimal UX change |
| Offline mode breaks | Service worker + Supabase local-first library |
| Multi-currency rounding errors | Use `numeric` type in Postgres, never `float` |
| IVA calculation mismatch | Replicate exact Godot logic; test with known inputs |
