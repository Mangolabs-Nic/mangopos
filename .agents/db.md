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

Autenticación de empleados (Supabase Auth):
- `businesses.slug` — handle de login único.
- `employee_pins` — índice ciego `HMAC-SHA256(pin, PIN_PEPPER)`, sin PIN en claro.
  Solo lo escriben `set_employee_pin(...)` y lo lee `employee_pin_login(...)`.
- `pin_attempts` — límite de intentos por negocio + IP hasheada.
- `custom_access_token_hook(event)` — agrega `user_id`, `business_id`, `app_role` y
  `active` al JWT. Habilitarlo en `supabase/config.toml` o en el dashboard de Supabase.
- `current_business_id()` y `current_role()` exigen `active`, así que desactivar a un
  empleado corta el acceso en la siguiente petición.

Reportes (migración 013):
- `sale_items.unit_cost` — costo del producto congelado al escribir la línea. Base de
  COGS; lo escribe `sale_items_snapshot_cost()`, nunca el cliente.
- `businesses.timezone` — zona IANA para cortar día/semana/mes (default `America/Managua`).
- Funciones `SECURITY INVOKER` ejecutables por `authenticated`: `report_sales_summary`,
  `report_inventory_valuation`, `report_expense_breakdown`, `report_profit`. RLS aplica
  porque la API las llama con el JWT del usuario, no con `service_role`.
- Solo se suman ventas con `sales.currency = businesses.currency`; no hay tabla de tasas
  de cambio todavía.
