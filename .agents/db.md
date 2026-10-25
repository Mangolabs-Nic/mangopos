# PoopPOS - Base de Datos (App Desktop)

## Nota
Este repo NO contiene la app desktop. `db.md` documenta lo que la landing page referencia sobre la DB del sistema POS.

## Motor
SQLite (local, sin servidor)

## Módulos que usan DB

| Módulo | Descripción |
|--------|-------------|
| Ventas | Registro ventas, items vendidos, totales |
| Gastos | Registro gastos operativos |
| Inventario | Productos, servicios, stock |
| Clientes | Datos clientes, historial compras |
| Proveedores | Datos proveedores |
| Empleados | Empleados, accesos, roles |
| Reportes | Reportes ventas, gastos, inventario |
| Cuentas | Cuentas financieras, balance |
| Configuración | Settings globales sistema |

## Reglas
- Imágenes no se guardan en DB, solo rutas en carpeta `images/`
- PIN-based login (empleados)
- Currency multi-moneda

## Rebuild MangoPOS (NestJS + PostgreSQL/Supabase)
Este archivo describe la app desktop (SQLite). El esquema del rebuild vive en
`supabase/migrations/` y su documentación de referencia en:
- `apps/rebuild-docs/docs/operations/database.md` — tablas, RLS, roles, audit log.
- `apps/rebuild-docs/docs/rebuild/phase-1/auditing.md` — sistema de auditoría
  (`audit_log` append-only, redacción de secretos, severidad, acceso por rol).

Tablas del rebuild: `businesses`, `profiles`, `categories`, `products`, `sales`,
`sale_items`, `expenses`, `stock_adjustments`, `customers`, `payment_methods`, `audit_log`.
Verificación de invariantes: `scripts/verify-schema.sql`.

Escritura de auditoría desde la API:
- Los cambios de fila los registra el trigger `audit_row_change()`.
- Login/logout/backup y el contexto de anulaciones, ajustes de stock y borrados los
  registra `AuditInterceptor` (NestJS) mediante `public.audit_append(...)`.
  `audit_append` es `SECURITY DEFINER` y solo `service_role` puede ejecutarla; no hay
  grant de `INSERT` sobre `audit_log` para ningún rol.
