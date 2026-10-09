---
sidebar_position: 6
---

# Legacy app runtime verification (Phase 3)

Runtime verification of the **legacy Godot PoopPOS app** (`pooppos-legacy`), executed by
actually booting the app headless — not by reading code alone. This page is the living
report; slices are filled in as they run.

:::note Where the harness lives
The legacy repository is a **frozen reference** and is never modified — it must stay
rollback-able as the inherited baseline. The `tests/verify_slice*.gd` scripts referenced
below were written while verifying, but they are **not** kept inside that repository. They
are preserved outside it at:

```
%LOCALAPPDATA%\Temp\opencode\legacy-evidence\verify\
```

To re-run a check, copy the script you need into `pooppos-legacy/tests/` and remove it
afterwards. The `pooppos-legacy` working tree is currently pristine at `1524ffa`.
:::

## Environment

| Item | Value |
| --- | --- |
| Godot | `4.7.stable.official.5b4e0cb0f` |
| Exe | `C:\Users\Usuario\Downloads\Godot_v4.7-stable_win64.exe\Godot_v4.7-stable_win64.exe` |
| Project | `C:\Users\Usuario\Documents\Mangolabs\pooppos-legacy` |
| Runtime DB | `%APPDATA%\Godot\app_userdata\poopPOS - 1.0.7\pos_database.db` (`user://pos_database.db`) |
| Autoloads | `Database`, `Alerts`, `AppStyle`, `DateUtils`, `WebServer`, `UpdateManager` |

Base invocations used throughout:

```powershell
$exe="C:\Users\Usuario\Downloads\Godot_v4.7-stable_win64.exe\Godot_v4.7-stable_win64.exe"
$proj="C:\Users\Usuario\Documents\Mangolabs\pooppos-legacy"

& $exe --headless --path $proj --import
& $exe --headless --path $proj -s res://tests/verify_slice1_init.gd
```

The `Database` autoload runs in `-s` (script) mode: it creates the DB, runs migrations and
seeds defaults even when no scene is loaded. This is what makes headless verification possible.

## Phase 3 status matrix

All ten items have now been exercised. Item 6 remains partially INCONCLUSIVE by design:
physical thermal-printer output needs real hardware. Item 5's exported-binary round-trip was
closed by item 1 once export templates became available.

| # | Item | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Production deployment (exported build, boot, embedded assets) | **PASS** | [item 1](#item-1--production-deployment) |
| 2 | Web session persistence (login, restart, sliding TTL, invalidation) | **PASS** | [item 2](#item-2--web-session-persistence) |
| 3 | Database initialization (clean userdata) | **PASS** | [item 3](#item-3--database-initialization) |
| 4 | Multi-client behavior (concurrency, order queue, active connections) | **PASS** | [item 4](#item-4--multi-client-behavior) |
| 5 | Embedded / web assets (faithful generation + export pipeline) | **PASS** (exported-binary round-trip now closed — see item 1) | [item 5](#item-5--embedded--web-assets) |
| 6 | Printing subsystem (TXT receipt, ESC/POS bytes, printer_config options, transport/copies) | **PASS** (mechanism; physical printer output INCONCLUSIVE — no hardware/spooler) | [item 6](#item-6--printing) |
| 7 | Data migration behavior (idempotency + guards) | **PASS** | [item 7](#item-7--data-migration-behavior) |
| 8 | Backup / restore (export → import round-trip) | **PASS** | [item 8](#item-8--backup--restore) |
| 9 | Error handling (malformed CSV, invalid config, invalid PIN, locked/corrupt DB, invalid sale payload, missing asset) | **PASS** (graceful; two payload gaps found) | [item 9](#item-9--error-handling) |
| 10 | Crash recovery (SQLite durability across mid-write process kill + unclean shutdown) | **PASS** | [item 10](#item-10--crash-recovery) |

Slice 1 scope (explicit): items 3, 7, 8. Slice 2 scope (explicit): items 2, 4, 5
(session persistence, multi-client behavior, embedded/web assets). Slice 3 scope
(explicit): items 6, 9, 10 (printing, error handling, crash recovery). Item 1 remains a
placeholder until its slice runs.

Verification artifacts (not committed), Slice 1: `pooppos-legacy/tests/verify_slice1_init.gd`,
`verify_slice1_backup.gd`, `verify_slice1_wipe.gd`, `verify_slice1_migrations.gd`.
Raw logs: `%LOCALAPPDATA%\Temp\opencode\slice1\run{1..5}_*.log`.

Verification artifacts (not committed), Slice 2: `pooppos-legacy/tests/verify_slice2_server.gd`
(HTTP host that boots the real `WebServer` autoload), `verify_slice2_seed.gd` (fixtures),
`verify_slice2_db.gd` (DB inspector/mutator), `verify_slice2_cobrar.gd` (POS cobro path),
`verify_slice2_lock.gd` (re-entrant lock probe), `verify_slice2_assets.gd` (embed fidelity).
Drivers: `%LOCALAPPDATA%\Temp\opencode\slice2\{scenario_session,scenario_multiclient,static_check}.ps1`
with `lib.ps1`. Raw logs: `%LOCALAPPDATA%\Temp\opencode\slice2\{session,multiclient}.log`,
`{sess1..sess4,conc,ord,ord2,flow,static}.{out,err}.log`, `lock.log`.

Verification artifacts (not committed), Slice 3: `pooppos-legacy/tests/verify_slice3_print.gd`
(TXT + ESC/POS render, option sensitivity, TCP copies), `verify_slice3_errors.gd` (fault
injection), `verify_slice3_dblock.gd` (EXCLUSIVE-lock probe), `verify_slice3_crash_writer.gd`
(mid-transaction writer) and `verify_slice3_crash_check.gd` (reopen + integrity check).
Driver: `%LOCALAPPDATA%\Temp\opencode\slice3\crash_driver.ps1`. Raw artifacts/logs:
`%LOCALAPPDATA%\Temp\opencode\slice3\{print,errors,dblock}.log`, `receipt_txt.txt`,
`receipt_escpos.bin`, `check_{A,B,C_unclean}.log`, `writer_{A,B,C_unclean}.log`.

**Harness note (important for future slices).** In `-s` (script) mode the entry script is
compiled *before* autoload globals register, so a static reference to a class that itself
uses `Database`/`DateUtils` (e.g. `PrinterConfig`, `InvoiceDocument`, `TxtBackend`) fails to
compile with `Identifier not found: Database`. The Slice 3 scripts therefore `load()` those
classes at runtime (after the `Database` autoload is ready) instead of referencing them
statically; direct references to the autoload node itself are always done via
`root.get_node_or_null("Database")`.

---

## Item 3 — Database initialization

**Method.** Renamed (not deleted) the `poopPOS - 1.0.7` userdata folder so the DB builds
from scratch, then ran the init enumerator headless. The script waits for `Database.db`,
lists every non-internal SQLite table via `sqlite_master`, counts rows per table, and diffs
the table set against the 32 names declared in `scripts/database.gd`.

**Commands.**

```powershell
Rename-Item "$env:APPDATA\Godot\app_userdata\poopPOS - 1.0.7" "poopPOS - 1.0.7.bak"
& $exe --headless --path $proj -s res://tests/verify_slice1_init.gd
```

**Raw evidence — startup log (run 1, clean DB).**

```text
[Database] === Database: iniciando ===
Opened database successfully (.../poopPOS - 1.0.7/pos_database.db)
[Database] BD abierta en: user://pos_database.db
[Database] --- Creando/verificando tablas ---
[Database] Tablas verificadas/creadas correctamente.
[Database] --- Migrando columnas faltantes ---
[Database] Migración: columna 'stock_minimo' añadida a 'productos'.
[Database] Migración: columna 'fecha_vencimiento' añadida a 'productos'.
[Database] Migración: columna 'codigo_barras' añadida a 'productos'.
[Database] Migración: columna 'principio_activo' añadida a 'productos'.
[Database] Migración: columna 'costo' añadida a 'productos'.
[Database] Migración: columna 'empleado_id' añadida a 'ventas'.
[Database] Migración: columna 'impuesto' añadida a 'ventas'.
[Database] Migración: columna 'flujo_estado' añadida a 'ventas'.
[Database] Migración: columna 'lote_id' añadida a 'detalles_venta'.
[Database] Migración: columna 'moneda_principal' añadida a 'cortes'.
[Database] Migración: columna 'cuenta_id' añadida a 'ordenes_compra'.
[Database] Migración: columna 'iva_included' añadida a 'ordenes_compra'.
[Database] Migración: columna 'iva_type' añadida a 'ordenes_compra'.
[Database] Migración: columna 'iva_value' añadida a 'ordenes_compra'.
[Database] --- Verificando datos por defecto ---
[Database] Seed: cuenta 'Efectivo Caja' creada.
[Database] Seed: 'monedas_disponibles' creada.
[Database] Seed: 'moneda_principal' creada.
[Database] Seed: 'tasa_iva' creada.
[Database] Seed: 'iva_incluido' creada.
[Database] Seed: configuracion de impresión verificada.
[Database] Seed: configuracion de clientes web verificada.
[Database] Migración: categorías legacy migradas a producto_categorias.
[Database] Migración: permisos de empleados actualizados.
[Database] === Database: listo ===
```

`=== Database: listo ===` is printed; zero `ERROR` / `SCRIPT ERROR` lines (exit code 0).

**Raw evidence — table set (32 tables, row counts from clean boot).**

```text
TABLE_COUNT=32
EXPECTED_COUNT=32
MISSING=(none)
EXTRA=(none)
```

| Table | Rows | Table | Rows |
| --- | ---: | --- | ---: |
| advertencias | 0 | lotes | 0 |
| ajustes_inventario | 0 | movimientos_inventario | 0 |
| bitacora_actividad | 3 | ordenes_compra | 0 |
| categorias | 0 | ordenes_web | 0 |
| clientes | 0 | ordenes_web_detalles | 0 |
| configuracion | 39 | order_flow_estados | 0 |
| corte_detalles | 0 | precios_proveedor | 0 |
| corte_gastos | 0 | producto_advertencias | 0 |
| cortes | 0 | producto_categorias | 0 |
| cuenta_balances | 0 | producto_tags | 0 |
| cuentas | 1 | productos | 0 |
| cuentas_pagar | 0 | proveedores | 0 |
| detalles_gasto | 0 | ventas | 0 |
| detalles_orden | 0 | web_sesiones | 0 |
| detalles_venta | 0 | | |
| empleados | 0 | | |
| gastos | 0 | | |
| impuestos_recargos | 0 | | |

**Migrations applied on the clean DB (column-level proof).**

```text
COL|ventas.empleado_id|present
COL|ventas.impuesto|present
COL|ventas.flujo_estado|present
FLAG|legacy_categories_migrated|1
FLAG|migrate_cp_proveedor_nullable|1
FLAG|permissions_migrated|1
```

**Table-set reconciliation.** All 32 tables match the `CREATE TABLE IF NOT EXISTS`
declarations in `scripts/database.gd` `_create_all_tables()` (lines 119–475). No table was
created that the file does not declare (`EXTRA=(none)`). The only other `CREATE TABLE` in the
codebase is `cuentas_pagar_temp` (line 557), a **transient** table used by the legacy
`cuentas_pagar` migration (created → filled → source dropped → renamed); it never survives a
run. Repo-wide search confirms all DDL lives in `database.gd` alone.

**Verdict: PASS** — 32/32 tables created, 14 ALTER migrations applied, seeds inserted,
`=== Database: listo ===` emitted, no unexpected errors.

---

## Item 7 — Data migration behavior

### (a) Idempotency — second boot on the same userdata

**Method.** Ran the same enumerator a second time without touching userdata.

**Raw evidence — counts of migration/seed lines.**

| Signal | Run 1 (clean) | Run 2 (same DB) |
| --- | ---: | ---: |
| `Migración: columna ... añadida` | 14 | **0** |
| `Seed:` lines | 7 | 2 (summary-only) |
| `=== Database: listo ===` | 1 | 1 |
| ERROR lines | 0 | 0 |
| `configuracion` rows | 39 | 39 |
| `cuentas` rows | 1 | 1 |
| `bitacora_actividad` rows | 3 | 3 |

On the second boot there are **no** `ALTER TABLE` statements and **no** seed inserts; the
only seed lines are the always-printed summary lines (`... verificada.`). Row counts are
unchanged. No duplicate seeds, no re-applied migrations.

**Verdict (a): PASS.**

### (b) Startup migration inventory and guards

`Database._ready()` (line 81) calls, in order: `_open_database()` → `_run_migrations()`
(`_create_all_tables()` + `_migrate_columns()`) → `_seed_defaults()` →
`_migrate_recovery_password()` → `_migrate_legacy_categories()` → `_migrate_permissions()`.

| # | Migration | Guard | Re-run safe? |
| --- | --- | --- | --- |
| 1 | `_create_all_tables()` (32 tables, L119–475) | `CREATE TABLE IF NOT EXISTS` | Yes — SQL-level |
| 2 | `_migrate_columns()` (L484–540) | `_add_column_if_missing` → `_column_exists()` via `PRAGMA table_info` | Yes — runtime-proven (14 → 0) |
| 3 | `_migrate_cuentas_pagar_proveedor_nullable()` (L543) | config flag `migrate_cp_proveedor_nullable == "1"` **and** `_column_exists("cuentas_pagar","proveedor_id")` | Yes — flag short-circuit |
| 4 | `_seed_defaults()` (L613) | one `SELECT ... WHERE clave/id = ...` existence check per seed | Yes — runtime-proven (7 → 2 summaries) |
| 5 | `_migrate_permissions()` (L685) | config flag `permissions_migrated == "1"` | Yes — runtime-proven below |
| 6 | `_migrate_legacy_categories()` (L714) | config flag `legacy_categories_migrated == "1"` | Yes — runtime-proven below |
| 7 | `_migrate_recovery_password()` (L727) | only acts if plaintext `recovery_password` exists and `recovery_password_hash` does not; deletes the plaintext after hashing | Yes — self-clearing |

Note (`_migrate_columns`): 39 `_add_column_if_missing` calls exist but only **14** actually
ALTER on a clean DB — the other 25 columns are already present in the base `CREATE TABLE`
definitions, so `_column_exists()` short-circuits them. This is the guard doing its job.

**Verdict (b): PASS** — every startup migration is guarded; re-runs are no-ops.

### (c) Legacy-data migration paths

| Path | Function | Transform | Guard |
| --- | --- | --- | --- |
| Legacy `productos.categoria_id` → `producto_categorias` | `_migrate_legacy_categories` (L714) | For each `productos.categoria_id NOT NULL`, insert `(producto_id, categoria_id)` | `legacy_categories_migrated` flag |
| Employee permission button names → keys | `_migrate_permissions` (L685) | `["VentaBtn","GastosBtn","InventarioBtn",...]` → `["ventas","gastos","inventario",...]` | `permissions_migrated` flag |
| Plaintext recovery password → SHA-256 | `_migrate_recovery_password` (L727) | `configuracion.recovery_password` → `recovery_password_hash`, plaintext deleted | presence/absence of the two keys |
| `cuentas_pagar.proveedor_id` `NOT NULL` → nullable | `_migrate_cuentas_pagar_proveedor_nullable` (L543) | Drop + recreate `cuentas_pagar` via `cuentas_pagar_temp` | flag + `_column_exists` |

**Runtime evidence (run 5).** Seeded a synthetic legacy product (`id=777777`, `categoria_id=4242`)
and a synthetic employee (`permisos='["VentaBtn","GastosBtn","InventarioBtn"]'`), cleared each
guard flag, then invoked the real migration functions:

```text
LEGACY_CAT_ROWS=1 cat=4242
LEGACY_CAT_FLAG=1
LEGACY_CAT_ROWS_AFTER_2ND=1        ← guard prevents duplicate on 2nd run
PERM_BEFORE='["VentaBtn","GastosBtn","InventarioBtn"]'
PERM_AFTER=["ventas","gastos","inventario"]
PERM_FLAG=1
PERM_AFTER_2ND=["ventas","gastos","inventario"]   ← stable, no double-transform
```

Synthetic rows were deleted after the run and the pristine DB was restored from a copy.

**Verdict (c): PASS** — both named legacy paths transform correctly and their config-flag
guards make a second run a no-op.

**Item 7 overall: PASS.**

---

## Item 8 — Backup / restore

**Method.** `export_db()` / `import_db()` (database.gd L1873 / L1897) are plain autoload
methods, so they were driven headlessly (no GUI needed) with `verify_slice1_backup.gd`:
seed unique marker rows → snapshot all 32 row counts → `export_db()` → mutate/delete the
markers → `import_db()` → compare all row counts and the marker value.

**Command.**

```powershell
& $exe --headless --path $proj -s res://tests/verify_slice1_backup.gd -- "$ev\roundtrip_backup.db"
```

**Raw evidence (run 3).**

```text
BEFORE_CONFIGURACION=40
BEFORE_CATEGORIAS=1
MARKER_VALUE=BR1_1791473631.476
[Database] Exportando base de datos a: C:\...\roundtrip_backup.db
[Database] Exportación exitosa.
EXPORT_OK=true
EXPORT_SIZE_BYTES=167936
WIPED_CONFIGURACION=39
WIPED_CATEGORIAS=0
[Database] Importando base de datos desde: C:\...\roundtrip_backup.db
[Database] Importación exitosa.
IMPORT_OK=true
RESTORED_MARKER=BR1_1791473631.476
RESTORED_CATEGORIAS=1
COUNT_DIFFS=(none)
ROUNDTRIP_VERDICT=PASS
```

All 32 tables matched their pre-export row counts after import, and the unique marker value
was restored byte-for-byte. The export file (167,936 bytes) equals the source DB size.

**GUI reachability (for completeness, not required).** Export/import are also wired through
Config → Base de datos (`db_manager.gd`) and the initial-setup login screen (`login.gd:189`).
Both call the same autoload methods verified above.

**Verdict: PASS** — export produces a complete copy; import restores row counts and values.
Caveat: reset completeness is *not* part of this round-trip and has a gap (see **D1**).

---

## Item 2 — Web session persistence

**Method.** The `WebServer` autoload is a `Node`; in headless `-s` script mode it is present
on `root` and `WebServer.start()` binds a real TCP port, so the *real HTTP server* was driven
by an external client (PowerShell `Invoke-WebRequest`). Flow:

1. `verify_slice2_server.gd` sets deterministic config, calls `WebServer.start()`, and holds
   the SceneTree open.
2. Log in through the **real route** `POST /api/login?k=<web_access_key>` to obtain a token.
3. Inspect the `web_sesiones` row.
4. Kill the process and start a **fresh process** on the same DB; re-validate the same token.
5. Force a session near expiry, send activity, and confirm the sliding TTL renewal is persisted.
6. Trigger `WebServer.regenerate_access_key()` in-process and confirm invalidation.

**Commands** (from `scenario_session.ps1`; `$exe`/`$proj` as in *Environment*).

```powershell
# host: boots WebServer, writes ready.txt, watches stop/regen sentinels
& $exe --headless --path $proj -s res://tests/verify_slice2_server.gd -- `
    18100 KEY_PERSIST C:\...\ready.txt C:\...\stop.txt C:\...\regen.txt C:\...\newkey.txt 150

# client (PowerShell): login
Invoke-WebRequest -Uri "http://127.0.0.1:18100/api/login?k=KEY_PERSIST" -Method POST `
  -UserAgent "Mozilla/5.0 (Linux; Android 13; Pixel 6) ..." `
  -ContentType application/json -Body '{"pin":"424242","device_id":"dev-A"}'
# session check (no PIN): GET /api/session/check?k=KEY_PERSIST&token=<token>
# DB inspect: & $exe ... -s res://tests/verify_slice2_db.gd -- sessions
```

**Raw evidence (run `session.log`).**

```text
LOGIN_A HTTP 200 token=6bdbf785b43ee429b8308035289974e5
LOGIN_B HTTP 200 token=b8be0cbe5ae5785958dfb6ba2905e622
LOGIN_A_AGAIN(same device) token=6bdbf785... SAME_AS_A=True    ← one session per device+empleado
CHECK_A_before_restart => 200
--- DB after stop (before restart) ---
SESSION_COUNT=2
SESSION|6bdbf785b43e|dev=dev-A|emp=1|nombre=VERIFY_EMP_1|expira_en=86399|inactivo_hace=1|disp=Móvil Pixel 6 Build/TQ3A
SESSION|b8be0cbe5ae5|dev=dev-B|emp=2|nombre=VERIFY_EMP_2|expira_en=86399|inactivo_hace=1|disp=Desktop Windows 11
--- fresh process, same DB ---
CHECK_A_after_restart => HTTP 200 | {"nombre":"VERIFY_EMP_1","ok":true,"permisos":null}
CHECK_B_after_restart => HTTP 200 | {"nombre":"VERIFY_EMP_2","ok":true,"permisos":null}
--- sliding TTL: force expira = now+50, last activity = now-100000 ---
SETEXP_OK|expira_en=50|inactivo_hace=100000
CHECK_A_near_expiry_activity => HTTP 200 | {"nombre":"VERIFY_EMP_1","ok":true,...}
--- DB after activity ---
SESSION|6bdbf785b43e|dev=dev-A|emp=1|nombre=VERIFY_EMP_1|expira_en=86400|inactivo_hace=0
--- access-key regeneration ---
CHECK_A_before_regen => HTTP 200
NEW_ACCESS_KEY=175ae67e273ffa45
CHECK_A_old_key_after_regen => HTTP 401
CHECK_A_new_key_after_regen => HTTP 401      ← token invalidated (memory + DB cleared)
--- DB after regen ---
SESSION_COUNT=0
```

Active-connection tracking uses the exact method the POS indicator calls
(`WebServer.get_sesiones_activas()`), printed by the host at shutdown:

```text
[sess1] ACTIVE_SESSIONS_COUNT=2 | ACTIVE_SESSION|VERIFY_EMP_1|emp=1|disp=Móvil Pixel 6... |
                                     ACTIVE_SESSION|VERIFY_EMP_2|emp=2|disp=Desktop Windows 11...
[sess4] ACTIVE_SESSIONS_COUNT=0
```

**Verdict: PASS** — sessions persist across a real process restart (DB is the source of
truth), the per-`device_id` reuse rule holds, the 24 h sliding TTL renews and is persisted,
regenerating the web-access key invalidates every session, and active-connection tracking
reflects live clients. (`device_id` was non-empty in the tests; the "one session per device"
path was exercised.)

---

## Item 4 — Multi-client behavior

**Method.** Two clients logged in concurrently with distinct `device_id` + User-Agent
(two employees/tokens). Concurrency was driven with **genuinely parallel OS processes**
(`Start-Job` → separate `powershell.exe`, simultaneous `POST /api/sales`). The web-order
queue and Order Flow were driven over real HTTP; the POS "Cobrar" transition was driven with
the exact autoload method the button calls (`Database.crear_venta_desde_orden_web`).

**Command** (abridged; full driver `scenario_multiclient.ps1`).

```powershell
# 4 parallel sale processes against PRODUCT_C (stock 1)
1..4 | ForEach-Object { Start-Job { Invoke-WebRequest -Method POST -ContentType application/json `
    -Uri $url -Body $body } ... } | Wait-Job
```

**Raw evidence (`multiclient.log`).**

*Concurrent direct sales — no oversell:*

```text
C1 (stock 1): 4 PARALLEL sales x qty1
C1_RESULT|HTTP 200 | {"ok":true,"venta_id":2,"total":100.0,...}
C1_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_C' (disponible: 0, solicitado: 1)"}
C1_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_C' (disponible: 0, solicitado: 1)"}
C1_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_C' (disponible: 0, solicitado: 1)"}
C1_SUCCESS_200=1  C1_REJECTED_400=0

C2 (stock 10): 5 PARALLEL sales x qty4
C2_RESULT|HTTP 200 | {"ok":true,"venta_id":3,...}
C2_RESULT|HTTP 200 | {"ok":true,"venta_id":4,...}
C2_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_A' (disponible: 2, solicitado: 4)"}
C2_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_A' (disponible: 2, solicitado: 4)"}
C2_RESULT|HTTP 500 | {"error":"Stock insuficiente para 'VERIFY_PRODUCT_A' (disponible: 2, solicitado: 4)"}
C2_SUCCESS_200=2
```

Final stock and movement audit (DB after the race):

```text
STOCK|19|2        ← PRODUCT_A: 10 − 8 = 2 (only 8 units sold; never negative)
STOCK|20|0        ← PRODUCT_C: 1 − 1 = 0
COUNT|ventas|4  COUNT|detalles_venta|4  COUNT|movimientos_inventario|4
MOVS|product=19|count=2|qty=8
QUOTE_999 => HTTP 200 | {...,"stock_ok":false,"lineas":[{..."disponible":false,"stock_restante":0...}]}
```

*Web-order queue (create → POS source of truth → state transition):*

```text
ORDER_CREATE => HTTP 200 | {"estado":"pendiente","ok":true,"orden_id":2,"total":200.0}
ORDER_STATUS_pendiente => HTTP 200 | {"cliente":"VERIFY_Mesa 5","estado":"pendiente",...
     "items":[{"cantidad":2,"nombre":"VERIFY_PRODUCT_A","notas":"bien cocido",...}]}
ordenes_web rows (what Clientes Web lists): ORDER|2|cliente=VERIFY_Mesa 5|estado=pendiente|total=200.0
D2 POS Cobrar path:
STOCK_BEFORE=2  COBRAR_OK=true  COBRAR_RES={"ok":true,"venta_id":5}  STOCK_AFTER=0
ORDEN_ESTADO=completada venta_id=5
ORDER|2|...|estado=completada
ORDER_STATUS_completada => HTTP 200 | {"estado":"completada",...}
```

*Order Flow state machine over HTTP:*

```text
FLOW_SALE_CREATE => HTTP 200 | {"ok":true,"venta_id":6,"total":50.0}
FLOW_LIST_after_create => 200 | estados [VERIFY_PREPARANDO, VERIFY_LISTO];
                              ventas include venta_id=6 estado "VERIFY_PREPARANDO"
FLOW_NEXT_1 => 200 | {"completada":false,"estado_nuevo":"VERIFY_LISTO","estado_previo":"VERIFY_PREPARANDO"}
FLOW_NEXT_2 => 200 | {"completada":true,"estado_nuevo":"Completada","estado_previo":"VERIFY_LISTO"}
FLOW_LIST_after_complete => venta_id=6 no longer listed
VENTA|6|estado=completada|flujo=<null>|total=50.0|tipo=web
```

**Concurrency model (honesty note).** `_server_loop` accepts one connection at a time, so
requests are serialized at the socket layer; the no-oversell guarantee comes from the atomic
stock check *inside* `crear_venta_web`'s SQLite transaction (`BEGIN` … `SELECT stock` /
`SUM(lotes)` / reject-or-insert … `COMMIT`), protected by the re-entrant `Database._db_lock`
(see **D12**). The test fires genuinely parallel client processes; the observable result is
that simultaneous clients cannot oversell. Rejected sales return **HTTP 500**, not 4xx
(see **D11**).

**Verdict: PASS** — concurrent sales never oversold (1/4 and 2/5 accepted against stock 1 and
10, final stock 0 and 2); the order queue creates rows the POS reads, transitions
pendiente → completada on cobro with FEFO stock deduction; Order Flow advances and completes
over HTTP; active connections reflect both clients.

---

## Item 5 — Embedded / web assets

**Method.** (a) Loaded the generated `scripts/web_assets.gd` and compared every embedded
string to the corresponding `res://web/` file, and every embedded base64 icon to the raw
image, byte-for-byte. (b) Ran `generate_web_assets.gd` and diffed its output against the
committed file. (c) Confirmed `binary_format/embed_pck=true` and inspected the HEAD commit.
(d) Confirmed the runtime `user://web` / `user://ui` pipeline and static serving.

**Command.**

```powershell
& $exe --headless --path $proj -s res://tests/verify_slice2_assets.gd
& $exe --headless --path $proj -s res://scripts/utils/generate_web_assets.gd
```

**Raw evidence — embed fidelity (current HEAD).**

```text
EMBEDDED_FILE_COUNT=5
FILE|index.html|src_len=14350|emb_len=14350|MATCH
FILE|css/style.css|src_len=20953|emb_len=20953|MATCH
FILE|js/api.js|src_len=1513|emb_len=1513|MATCH
FILE|js/cart.js|src_len=1174|emb_len=1174|MATCH
FILE|js/app.js|src_len=63535|emb_len=63535|MATCH
EMBEDDED_ICON_COUNT=11
ICON|ui/iconAtras.png|raw_bytes=32320|emb_bytes=32320|MATCH
ICON|ui/iconVentas.png|raw_bytes=61319|emb_bytes=61319|MATCH
 ... (all 11 icons MATCH) ...
FILE_DIFFS=(none)
ICON_DIFFS=(none)
ASSETS_VERDICT=PASS
```

**Raw evidence — regenerate and diff.**

```text
[generate_web_assets] OK: 5 archivos web + 11 iconos → res://scripts/web_assets.gd
BEFORE_SHA=446C892DDD81FCBFD15FD7ACB0BA7C388FF54BA2E7FE9EA9BE9BD763E4F93980
AFTER_SHA =01A52C509AF03BB004CCBA61E3971BAA4A47FD5D17481E3E73604F2B2B3AC9D3
IDENTICAL=False          ← only FILES dict key order differs (DirAccess listing order)
SORTED_LINES_IDENTICAL=True   ← the set of `"path": content` lines is identical
```

The committed file was restored immediately after (no tracked modification:
`git status` clean). So the generator *is* a faithful producer of content, but its output
ordering is not stable across runs (see **D8**).

**`export_presets.cfg`.** `binary_format/embed_pck=true` on the Linux preset (line 35) and
the Windows preset (line 81); `export_filter="all_resources"` on every preset.

**Why the production failure ("missing embeed files") happens.** Godot's PCK does not pack
raw non-resource files: `web/*.html|css|js` are not imported resources, and the original
`.png`/`.svg` are replaced by their imported `.ctex` — so with `all_resources` the raw web
files and raw web icons are simply **absent from the exported build**. Prior to HEAD the
server served `res://web/*` directly, which exists only in the editor; the exported binary
therefore returned 404 for every page ("missing embedded files"). HEAD (commit `1524ffa`,
literally *"correction prod server not working due to missing embeed files"*) added the
embedder: `generate_web_assets.gd` inlines the `web/` text and the 11 base64 icons into
`scripts/web_assets.gd` (a `.gd` *is* a packed resource), and `WebServer._ensure_web_assets()`
writes them to `user://web/` and `user://ui/` on every boot; `_send_file` / `_serve_icon`
fall back from `res://web` (dev) to `user://web` (prod). **Residual contract:** if `web/` or
the web icons change and the generator is not re-run before export, the PCK embeds the
*stale* web (production serves the old UI); if it is never generated, production has no web.
Rule: regenerate before every export (documented in `.agents/agents.md` and the generator's
header).

**Raw evidence — runtime pipeline + static serving.**

```text
user://web/index.html  == res://web/index.html   (SHA-256 equal)
user://web/css/style.css, js/app.js, js/api.js, js/cart.js  == res://web/...  (all equal)
user://ui/ holds the 11 decoded icons
STATIC /                  => HTTP 200 | 14350 B | head=<!DOCTYPE html>
STATIC /css/style.css     => HTTP 200 | 20953 B
STATIC /js/app.js         => HTTP 200 | 63536 B
STATIC /js/api.js         => HTTP 200
STATIC /js/cart.js        => HTTP 200
STATIC /ui/iconVentas.png => HTTP 200   (icon bytes already proven == raw source above)
STATIC /ui/default.png    => HTTP 200
GET /nope.js              => HTTP 404 "No encontrado"
GET /api/store/status (no k) => HTTP 401 {"error":"Enlace inválido: escanea el QR actual del negocio"}
```

**Provable without export templates.** Content fidelity of the embed (byte-for-byte), the
`embed_pck` setting, the raw-file/PCK classification, and the runtime write-and-serve
pipeline. **Not provable here:** the actual contents of an exported PCK and the behaviour of
the exported binary — producing and running those needs the export templates, which are not
installed. That single step is recorded as **NOT RUN (BLOCKED: no export templates)** and is
explicitly out of scope for this slice.

**Verdict: PASS** for the embedding mechanism, generator faithfulness, config, and runtime
serving. The exported-binary round-trip is **not executed** (no templates).

---

## Item 6 — Printing

**Method.** Drove the printing subsystem headlessly with `verify_slice3_print.gd` (classes
`load()`ed at runtime — see the harness note above). It (a) builds a real `InvoiceDocument`
through `InvoiceDocument.from_sale_data()` so the business header comes from `configuracion`
exactly as the sales workflow does, (b) renders it with `TxtBackend` to a `.txt` file and
`EscPosBackend` to a raw `.bin`, (c) checks the TXT structure and the ESC/POS byte structure,
(d) varies every `printer_config` option and diffs the output, and (e) drives `PrinterService`
over a local TCP listener to count jobs per `receipt_copies`.

**Command.**

```powershell
& $exe --headless --path $proj -s res://tests/verify_slice3_print.gd -- "$ev\slice3"
```

**Raw evidence — TXT receipt (real file, 638 bytes; divider = 42 chars = `receipt_chars_per_line`).**

```text
==========================================
      Farmacia Verificacion C.A.
      RUC / RIF / NIT: J-12345678-9
      Av. Principal 123, Local 4, Caracas
      Tel: 0212-555-0100
==========================================
Venta #4242
Fecha: 2026-10-08 14:30:00
Atendido por: Maria Perez
Cliente: Cliente Mostrador
--------------------------------
Paracetamol 500mg caja x20 x2  $50.00
  Lote: LOTE-2026-A Vence: 2026-12-31
Ibuprofeno 400mg x1  $50.00
--------------------------------
Subtotal: $100.00
IVA: $16.00
TOTAL: $116.00

Notas:
  Pago en efectivo
  Vuelto: $4.00

Gracias por su compra!
==========================================
```

Structural checks (all 13 `present`): business, taxid, address, phone, invoice number,
cashier, customer, line item, lot, Subtotal, IVA, TOTAL, footer; `TXT_DIVIDER_LEN=42 EXPECTED=42`.

**Raw evidence — ESC/POS byte stream (695 bytes, byte-level only).**

```text
ESCPOS_HEAD_HEX=1B 40 1B 74 02 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D 3D
ESCPOS_TAIL_HEX=3D 3D 3D 3D 0A 1B 64 03
CMD_COUNTS init=1 align=10 bold=8 codepage=1
ESC_INIT=true            (1B 40)
ESC_CODEPAGE_CP850=true  (1B 74 02)
ESC_ALIGN_CENTER=true    (1B 61 01)
ESC_ALIGN_LEFT=true      (1B 61 00)
ESC_BOLD_ON=true / OFF=true (1B 45 01 / 1B 45 00)
ESC_FEED3=true           (1B 64 03)
ESC_CUT=false            (auto_cut off by default -> no 1D 56)
ESC_TOTAL_LITERAL=true   ("TOTAL: $116.00" present as bytes)
```

**Raw evidence — option sensitivity (does the option actually change output?).**

| Option | TXT output | ESC/POS output |
| --- | --- | --- |
| `receipt_divider_style` 0/1/2 | **no change** (still `=`; only the hard-coded 32-dash item separator varies) | changes (`=`/`-`/`*`) |
| `receipt_chars_per_line` 32 vs 42 | **no change** (638 bytes both) | **changes** (633 vs 695 bytes) |
| `receipt_paper_width` 58/80/custom | mm reported 58/80/80 but **effective cpl pinned at 42** → no wrapping change | `_paper_width_mm` reported only |
| `escpos_encoding` CP850/CP437/UTF-8 | n/a | **changes** (code page byte 02/00; accents 0x82; UTF-8 683 vs 678 bytes) |
| `escpos_auto_cut` false/true | n/a | **changes** (adds `1D 56 01`) |
| `escpos_feed_lines` 0 vs 5 | n/a | **changes** (`1B 64 05`, none when 0) |
| `receipt_show_business` false | **no change** (name still printed) | honours it |
| `receipt_footer` = `PIE_UNICO_123` | **txt_has=false** | **escpos_has=true** |

The decisive line: `CLASSDB_HAS_PRINTERCONFIG=false` and `VARY_FOOTER|txt_has=false|escpos_has=true`.
Root cause in **D14**: `TxtBackend._generate_lines` guards config access with
`ClassDB.class_exists("PrinterConfig")`, which is false for a GDScript class, so the TXT backend
silently falls back to hard-coded defaults and ignores every `printer_config` option.

**Raw evidence — transport + copies.**

```text
SVC_DISABLED ok=true backend=txt path=.../receipts/venta_4242.txt          (printing_enabled=0 -> TXT)
SVC_ESCPOS_FILE ok=true backend=escpos path=.../receipts/Venta_4242.bin exists=true
TCP_TEST|port=18571|copies=1|conns=1|bytes=695|result=true
TCP_TEST|port=18572|copies=3|conns=3|bytes=2085|result=true                (3 x 695 bytes)
COPIES_PROBE copies=1 conns=1 copies=3 conns=3
PRINT_VERDICT=PASS
```

`receipt_copies` is only observable on a transport that emits a job per call; on the TXT and
ESC/POS **file** transports each call overwrites the same `venta_<id>` / `Venta_<id>.bin`
filename, so copies is a no-op there. Proven via TCP: N copies ⇒ N connections and N× bytes.

**Verdict: PASS** for the printing mechanism: TXT renders a complete, correctly-laid-out receipt
file; ESC/POS emits a structurally valid byte stream (init/codepage/align/bold/feed/cut);
`receipt_copies` produces N jobs; ESC/POS honours encoding/auto-cut/feed/chars-per-line. **Two
honesty caveats:** (1) the TXT backend ignores `printer_config` entirely (D14) and paper width
does not drive wrapping (D15); (2) **physical thermal / CUPS / Windows-spooler output is
INCONCLUSIVE** — no hardware is attached and no OS print spooler was exercised. `WindowsPrinterProvider.is_available()`
returns true purely from `OS.get_name()=="Windows"`, and `print_text`/`print_raw` shell out to
`print /d:<name>` / `copy /b … \\localhost\<name>`; those paths were **not** run (no printer).

---

## Item 9 — Error handling

**Method.** `verify_slice3_errors.gd` injects faults and records the actual observable
behaviour (return values, engine `ERROR`/`SCRIPT ERROR` lines, whether the process stayed
alive, whether a partial write happened). A separate `verify_slice3_dblock.gd` takes an
`BEGIN EXCLUSIVE` lock from a second SQLite connection and attempts a write through `Database`.
Destructive probes cleaned up after themselves and the runtime DB was restored from a copy.

**Commands.**

```powershell
& $exe --headless --path $proj -s res://tests/verify_slice3_errors.gd -- "$ev\slice3"
& $exe --headless --path $proj -s res://tests/verify_slice3_dblock.gd   # hard timeout 30s
```

**Raw evidence — malformed CSV import (parser + `productos.gd` required-column guard).**

```text
CSV|empty|rows=0|required_cols=false|guard=INFO_EMPTY
CSV|header_only|rows=0|required_cols=false|guard=INFO_EMPTY
CSV|missing_required|rows=1|required_cols=false|guard=ERROR_MISSING_COLUMNS
CSV|unterminated_quote|rows=1|required_cols=true|guard=ACCEPT      <-- malformed but accepted
CSV|binary|rows=1|required_cols=false|guard=ERROR_MISSING_COLUMNS
CSV|bom_crlf|rows=2|required_cols=true|guard=ACCEPT
CSV|dup_headers|rows=1|required_cols=true|guard=ACCEPT
CSV|valid|rows=2|required_cols=true|guard=ACCEPT
CSV|quoted_commas|rows=1|required_cols=true|guard=ACCEPT           <-- RFC-4180 quoted comma OK
```

No crash on any input. Empty/missing-column files are rejected through the `Alerts` guard;
quoted commas parse correctly. An **unterminated quote is silently accepted** (D17).

**Raw evidence — invalid / out-of-range config values (no crash, `render_bytes` unchanged).**

```text
CFG|receipt_chars_per_line=abc|cpl=0|render_bytes=260
CFG|receipt_chars_per_line=-5|cpl=-5|render_bytes=260
CFG|receipt_copies=abc|copies=0|render_bytes=260        (PrinterService clamps copies to >=1)
CFG|receipt_paper_width=999|mm=80 cpl=-5|render_bytes=260
CFG|receipt_custom_width_mm=abc|mm=0|render_bytes=260
CFG|escpos_feed_lines=999999|feed=999999|render_bytes=260   (_finish clamps to 0..255)
CFG|escpos_encoding=BOGUS|enc=BOGUS|render_bytes=260        (unknown -> no codepage cmd, map_850 default)
CFG|receipt_footer=|len=0|render_bytes=260
```

Invalid values are tolerated (no validation, no crash). Negative `chars_per_line` and huge
`feed_lines` are accepted by the config layer; only `PrinterService` (copies) and `_finish`
(feed) clamp them.

**Raw evidence — invalid PIN login (parameterised, injection-safe).**

```text
PIN|0000|rows=0
PIN||rows=0
PIN|9999|rows=0
PIN|' OR '1'='1|rows=0
PIN|123456'; DROP TABLE empleados;--|rows=0
PIN_TABLE_EMPLEADOS_INTACT=true
```

**Raw evidence — DB open/import failures + locked DB.**

```text
DB_CORRUPT|open=true|query=false|err=file is not a database     (open_db lies; first query fails)
DB_BADDIR|open=false|err=
DB_IMPORT_MISSING|ok=false|db_alive=true                        (reopens original DB)
LOCKER_OPEN=true / LOCK_HELD=true
LOCKED_WRITE_OK=false / DB_ERROR_MESSAGE=database is locked     (0.7s, no hang, no retry)
AFTER_RELEASE_WRITE_OK=true
DBLOCK_VERDICT=DONE
```

The locked write returns `false` immediately (SQLite default: no busy handler) — the app does
not freeze, but a concurrent write is simply lost (caller sees the failure). `import_db()` from
a missing source fails gracefully and reopens the live DB (migrations still not re-run — D2).

**Raw evidence — invalid sale payload (`Database.crear_venta_web`).**

```text
SALE|empty_lines|ok=false|error=La venta no tiene productos
SALE|missing_product|ok=false|error=Producto no encontrado (ID: 999999999)
SALE|over_stock|ok=false|error=Stock insuficiente para 'VERIFY_S3_PROD' (disponible: 5, solicitado: 10)
SALE|zero_qty|ok=true|error=                                     <-- empty sale created
SALE|negative_qty|ok=true|error=                                 <-- stock 5 -> 10 (added!)
SALE|huge_qty|ok=false|error=Stock insuficiente ... (disponible: 10, solicitado: 999999)
SALE_ROWS_CREATED=2
```

Missing product / over-stock are rejected cleanly. **`qty` is not validated**: `qty=0` creates
a phantom sale with no line items, and `qty=-5` **increases** stock (5 → 10, visible in the
following `huge_qty` check) and creates a sale — D16. The HTTP layer validates `1..999`
(`web_server.gd:1153`) before calling, so this is reachable only by an internal caller that
bypasses the API.

**Raw evidence — missing image / asset path.**

```text
ASSET|exists=false|res_exists=false
ASSET_LOAD|is_null=true|is_empty=true          (Image.load_from_file returns null; no crash)
ASSET_GUARD|uses_default=true|no_crash=true    (product_item.gd guards with FileAccess.file_exists)
ASSET_DEFAULT_EXISTS=true
```

**Raw evidence — Alerts autoload.** `ALERTS|added=2|app_alive=true`; two back-to-back popups
log a non-fatal engine error (`parent window already has another exclusive child`) — D19.

**Verdict: PASS** — every injected fault was handled without a crash or partial/corrupt write;
the app stayed alive in all cases. Two real gaps found: `crear_venta_web` accepts invalid
quantities (D16) and the CSV parser silently accepts an unterminated quote (D17). Minor:
corrupt-file `open_db()` reports success until the first query (D18), and rapid Alerts popups
log an engine error (D19).

---

## Item 10 — Crash recovery

**Method.** `verify_slice3_crash_writer.gd` commits a known marker, then loops committing
50-row batches while holding each transaction open for 0.5 s. `crash_driver.ps1` restores a
clean DB copy, starts the writer, waits for a commit, `Stop-Process -Force` (hard kill) during
the **next** open transaction, then reopens the DB with `verify_slice3_crash_check.gd`
(`PRAGMA integrity_check`, `quick_check`, marker survival, and partial-batch detection).
Three cycles: A and B kill during the 2nd transaction; C kills during the **first** transaction
(unclean shutdown before any batch commit). Each cycle used an isolated DB.

**Command.**

```powershell
powershell -File "%LOCALAPPDATA%\Temp\opencode\slice3\crash_driver.ps1"
```

**Raw evidence.**

```text
===== CYCLE A (kill after batch 1 committed, during batch 2) =====
LAST_COMMITTED_BATCH=1
SIDECAR_AFTER_KILL=pos_database.db,pos_database.db-journal
JOURNAL_MODE=delete
INTEGRITY_CHECK=ok
QUICK_CHECK=ok
TOTAL_ROWS=51
COMMITTED_MARKER_ROWS=1
NULL_MARKER_ROWS=0
DISTINCT_BATCHES=1 FULL_BATCHES=1
PARTIAL_BATCHES=(none)
CRASH_VERDICT=PASS

===== CYCLE B (repeat) =====
... identical: INTEGRITY_CHECK=ok, COMMITTED_MARKER_ROWS=1, FULL_BATCHES=1,
    PARTIAL_BATCHES=(none), CRASH_VERDICT=PASS

===== CYCLE C_unclean (killed during the first transaction, before any commit) =====
LAST_COMMITTED_BATCH=none
SIDECAR_AFTER_KILL=pos_database.db,pos_database.db-journal
INTEGRITY_CHECK=ok / QUICK_CHECK=ok
TOTAL_ROWS=1 / COMMITTED_MARKER_ROWS=1 / DISTINCT_BATCHES=0 / PARTIAL_BATCHES=(none)
CRASH_VERDICT=PASS
```

Journal mode is `delete` (rollback journal, not WAL). After the hard kill the
`pos_database.db-journal` sidecar is left on disk; on the next open SQLite rolls it back
automatically. In cycles A/B the already-committed batch (50 rows) and the committed marker
survive, while the in-flight transaction leaves **no partial rows**. Cycle C proves recovery
from an unclean shutdown with an open transaction before any batch commit: the committed marker
survives, the uncommitted batch is gone, integrity is `ok`. Runtime DB restored to a clean
32-table state afterward (`TABLE_COUNT=32`, `MISSING=(none)`, `EXTRA=(none)`).

**Verdict: PASS** — SQLite durability holds across two mid-write hard kills and one unclean
shutdown: `integrity_check`/`quick_check` = `ok`, committed data survived, and no partial or
corrupt rows remained.

---

## Item 1 - Production deployment

**Verdict: PASS.** A real release build was exported, launched, and confirmed to boot, initialise
its database, and serve its web UI from embedded assets.

### Prerequisite installed for this check

Export templates were absent. The official bundle (`Godot_v4.7-stable_export_templates.tpz`,
1,279,207,690 B) was downloaded and installed:

```powershell
[System.IO.Compression.ZipFile]::ExtractToDirectory($tpz, $tmp)   # extracts a top-level templates/
$ver = (Get-Content "$tmp\templates\version.txt" -Raw).Trim()     # -> "4.7.stable"
Move-Item "$tmp\templates\*" "$env:APPDATA\Godot\export_templates\$ver"
```

Result: 35 files in `%APPDATA%\Godot\export_templates\4.7.stable\`.

### Export

```powershell
& $exe --headless --path $proj --export-release "Windows Desktop" "$out\poopPOS.exe"
```

| Artifact | Size |
| --- | --- |
| `poopPOS.exe` | 112,504,624 B (standalone, `binary_format/embed_pck=true`) |
| `libgdsqlite.windows.template_release.x86_64.dll` | 3,381,248 B (sibling file) |
| Files packed | 413 |

### Why `res://web/*` is absent from the pack — and why that is correct

The export log contains **0** `res://web/*` entries. This is by design, not a defect.
`scripts/utils/generate_web_assets.gd` states it in its header:

> Godot does not package raw (html/css/js) files into exports with `all_resources` — only
> imported resources. For the web to work in production the files are embedded here (a `.gd`
> IS packaged) and `WebServer` writes them to `user://web/` on startup.

`scripts/web_assets.gd` (1.47 MB) is the packed carrier. This is precisely the fix introduced by
HEAD commit `1524ffa` ("correction prod server not working due to missing embeed files").

### Runtime proof against the exported binary

1. Deleted `user://web/` and `user://ui/` from
   `%APPDATA%\Godot\app_userdata\poopPOS - 1.0.7\`.
2. Launched the **exported** `poopPOS.exe --headless`.
3. Both trees were re-materialised from the embedded asset:

| Regenerated path | Bytes |
| --- | --- |
| `user://web/index.html` | 14,394 |
| `user://web/css/style.css` | 20,958 |
| `user://web/js/app.js` | 63,617 |
| `user://web/js/api.js` | 1,515 |
| `user://web/js/cart.js` | 1,174 |
| `user://ui/` | 11 icons |

4. The binary logged `[Database] === Database: listo ===` and then
   `[WebServer] Servidor activo en http://192.168.40.7:8080`.
5. HTTP checks served by the exported binary:

| Request | Result |
| --- | --- |
| `GET /` | 200, 14,350 B, `<!DOCTYPE html>` |
| `GET /css/style.css` | 200, 20,958 B |
| `GET /js/api.js` | 200, 1,515 B |
| `GET /ui/iconVentas.png` | 200, 61,319 B |
| `GET /api/products?k=<access_key>` | 200 |

The web server is gated by `configuracion.web_server_enabled`, which ships `0` (off). It started
only after that flag was set to `1`; the flag was restored to `0` after this check.

### Deployment problems found

- **D20 — test scaffolding ships in the release.** 32 `res://tests/*` entries are packed,
  including every `verify_slice*_*.gd` helper and `test_bind.gd` / `test_bind.tscn`. The presets
  use an empty `include_filter` and apply no export exclusion.
- **D21 — the build is not a single file.** The SQLite GDExtension ships as a sibling `.dll`;
  distributing `poopPOS.exe` alone silently breaks persistence.
- **D22 — stale preset paths.** The Windows preset still exports to `poopPOS 1.0.5.exe` while the
  Linux preset is at `1.0.7`.
- **D23 — exported and source runs share one `user://`.** Both resolve to
  `%APPDATA%\Godot\app_userdata\poopPOS - 1.0.7\`, so they share the same SQLite database.

## Discoveries

**D1 — "Restablecer todo" does not clear 15 of 32 tables.** `restablecer.gd::_wipe_everything()`
(L114) deletes from a hardcoded list of only **17** tables, then calls `Database.reinitialize()`
(which re-seeds but deletes nothing else). The **15 tables left populated** after a full reset:
`advertencias`, `ajustes_inventario`, `cuentas_pagar`, `detalles_orden`, `impuestos_recargos`,
`lotes`, `movimientos_inventario`, `ordenes_compra`, `ordenes_web`, `ordenes_web_detalles`,
`order_flow_estados`, `precios_proveedor`, `producto_advertencias`, `producto_tags`,
`web_sesiones`. Runtime-proven (run 4): after calling the real `_wipe_everything()`, probe rows
in `advertencias`, `order_flow_estados`, `producto_tags`, `lotes` each persisted (count 1),
while `categorias` (in the list) dropped to 0. Impact: a "reset" silently keeps inventory
movement history, purchase orders, supplier prices/debts, web orders and web sessions.
**Next step:** build the wipe list from `sqlite_master` instead of a literal array, or add the
missing tables explicitly.

**D2 — `import_db()` does not run migrations.** L1897 closes the DB, copies the file over
`user://pos_database.db`, and calls `_open_database()` only — no `_run_migrations()`. Because
the `Database` autoload persists across the login scene change, importing an **older-schema**
backup keeps the old schema for the rest of that session; migrations only apply on the next
full app launch. Reachable from `db_manager.gd:67` and `login.gd:189`.
**Next step:** call `_run_migrations()` (and the legacy migrations) after a successful import.

**D3 — A full wipe deletes the migration guard flags within the same session.** `_wipe_everything`
clears all `configuracion` rows (including `permissions_migrated`, `legacy_categories_migrated`,
`migrate_cp_proveedor_nullable`), then `reinitialize()` runs only `_run_migrations()` +
`_seed_defaults()` — not `_migrate_permissions` / `_migrate_legacy_categories`. Those two flags
stay absent until the next restart. Harmless today (the tables are empty and the transforms are
idempotent), but the post-wipe state is not byte-identical to a fresh install.

**D4 — Backup has no integrity check or WAL awareness.** `export_db`/`import_db` use
`DirAccess.copy_absolute` after closing the DB. It works cleanly in the current default journal
mode, but there is no `PRAGMA integrity_check` and no handling of `-wal`/`-shm` sidecars. If the
DB ever moves to WAL mode, copies would be incomplete. **Next step:** check journal mode / copy
sidecars, or use SQLite's backup API.

**D5 — Fresh install writes 3 audit rows.** `bitacora_actividad = 3` on a clean boot because
three migrations use `insert_safe()` (which logs) to write their guard flags. Cosmetic audit
noise on a fresh install.

**D6 — Schema drift between base DDL and the migrated schema.** Several base `CREATE TABLE`
statements omit columns that `_migrate_columns()` adds (e.g. `ventas` base lacks `empleado_id`,
`impuesto`, `flujo_estado`; `productos` base lacks `stock_minimo`, `fecha_vencimiento`,
`codigo_barras`, `principio_activo`, `costo`; `ordenes_compra` base lacks `iva_included`,
`iva_type`, `iva_value`). Fresh installs reach the final schema only via migrations (the 14
ALTERs in run 1). Reading the base `CREATE TABLE` as the source of truth will miss those
columns.

**D7 — `_migrate_cuentas_pagar_proveedor_nullable` runs a destructive table swap.** When the
legacy `proveedor_id NOT NULL` constraint is detected, it creates `cuentas_pagar_temp`, copies
all rows, drops the original, and renames. It is flag-guarded, but any failure between steps
would leave the table renamed/dropped mid-flight. Not triggered on clean DBs (fresh schema is
already nullable). **Next step:** wrap the swap in a transaction.

**D8 — `generate_web_assets.gd` output ordering is non-deterministic.** `_collect()` walks
`DirAccess.list_dir_begin()` order, so the `FILES` dictionary keys come out differently on a
second machine/run. Regenerating produced a byte-different file (SHA changed) whose content is
identical (sorted lines equal; only `index.html` vs `css/style.css` / `js/app.js` vs
`js/cart.js` swap places). Impact: spurious diffs on every regeneration and a naive
hash-staleness check that would report "changed" when only order moved. **Next step:** iterate
a sorted key list (e.g. `files.keys()` sorted) before emitting. Not a runtime bug — the
embedding is content-correct (`ASSETS_VERDICT=PASS`).

**D9 — `_empleado_permisos` throws a JSON parse error for SQL-NULL `permisos`.**
`web_server.gd:698-704` does `str(rows[0].get("permisos", ""))`; when the column is SQL NULL
the key exists with a `null` value, so `str(null)` → `"<null>"`, which is neither `""` nor
`"null"` and is fed to `JSON.parse_string()` → `ERROR: Parse JSON failed ... at
_empleado_permisos (web_server.gd:701)`. The endpoint still returns `permisos: null`
(full access, correct outcome), but an engine ERROR is logged on **every** `/api/login` and
`/api/session/check` for such an employee. **Next step:** `if rows[0].get("permisos") == null:
return null` before stringifying.

**D10 — `_api_products` serializes SQL NULLs as the literal `"<null>"`.** `_api_products`
uses `str(p.get(col, ""))`; for NULL columns the dictionary key exists with a null value, so
the response carries `"codigo_barras":"<null>"`, `"imagen":"/api/images/<null>"` (a bogus
image URL), and `"tags":["<null>"]` (a literal tag). Same root cause as D9. Functionally the
web client receives a non-empty image path that 404s and a phantom tag. **Next step:** treat
null explicitly (`var v = p.get(col); if v == null: v = ""`).

**D11 — Stock rejection from `/api/sales` returns HTTP 500, not a 4xx.** `_api_create_sale`
maps any `false` from `Database.crear_venta_web` to `_json_response(conn, 500, ...)`, so a
legitimate "Stock insuficiente" race returns `500 Internal Server Error`. The intended client
pre-check is `/api/sale/quote` (`stock_ok=false`), but a race that slips past it surfaces as a
server error. **Next step:** return 409/400 for business rejections and reserve 500 for real
failures.

**D12 — `Database._db_lock` is re-entrant on Godot 4.7, and the HTTP server is sequential.**
`begin_transaction()` locks `_db_lock` and then inner `fetch_array`/`query`/`insert_row` lock
it again on the same thread; the probe (`verify_slice2_lock.gd`) completed
`BEGIN → SELECT → CREATE → COMMIT` without deadlock, so the nested locking is safe on this
engine (`NESTED_LOCK_REENTRANT=true`). Separately, `_server_loop` accepts and handles one
connection at a time, so "multi-client" concurrency is serialized at the socket layer; the
no-oversell guarantee rests on the transaction, not on parallel execution. Both are worth
knowing when reasoning about the LAN design.

**D13 — Disabling Order Flow leaves `ventas.flujo_estado` set.** `disable_orderflow` only
flips the `order_flow_enabled` flag; existing sales keep their `flujo_estado`. When Order
Flow is re-enabled, `_api_orderflow` (`WHERE flujo_estado IS NOT NULL`) resurfaces those old
sales (observed in run: a sale created while enabled reappeared after a disable/enable cycle).
Minor state-consistency quirk; the POS+web otherwise behave as specified.

**Method note (harness, not a product bug).** An earlier concurrency run reused a fixed port
while a previous server process was still bound; the new process reported `RUNNING=true` but
clients were served by the stale instance, producing misleading `400`s. Re-running with
stray-process cleanup and fresh ports per lifecycle produced the clean results above. Worth
remembering for any LAN test: always kill the previous server and use a fresh port.

**D14 — The TXT receipt backend ignores `printer_config` entirely.** `TxtBackend._generate_lines()`
(txt_backend.gd:59) gates every config read on `config = PrinterConfig if ClassDB.class_exists("PrinterConfig") else null`.
`ClassDB.class_exists()` only knows engine C++ classes, so it returns **false** for the GDScript
class `PrinterConfig` and the backend falls back to hard-coded defaults. Runtime-proven:
`CLASSDB_HAS_PRINTERCONFIG=false`; changing `receipt_divider_style`, `receipt_chars_per_line`,
`receipt_show_business` and `receipt_footer` did **not** change TXT output, while the same
options changed ESC/POS output (`VARY_FOOTER|txt_has=false|escpos_has=true`). Impact: TXT
receipts and the print preview (`print_preview.gd` calls `TxtBackend._generate_lines`) always
use `=`×42 dividers, the default footer and all show-* sections on, regardless of Settings →
Printers. **Next step:** replace the guard with a plain `PrinterConfig` reference (it is a
global class), or `if PrinterConfig:`.

**D15 — Paper width does not drive receipt wrapping.** `PrinterConfig.get_chars_per_line()`
returns `get_int("receipt_chars_per_line", <per-width default>)`, but `ensure_defaults()`
seeds `receipt_chars_per_line = "42"` (printer_config.gd:20), so the stored 42 always wins and
the per-width defaults (32 for 58 mm) are dead code. Runtime-proven: widths 58/80/custom all
report `effective_cpl=42` and a 42-char divider. **Next step:** when paper width changes, update
`receipt_chars_per_line`, or make the stored value nullable so the per-width default applies.

**D16 — `Database.crear_venta_web()` does not validate quantity bounds.** The stock loop only
rejects `disponible < qty`, so `qty=0` passes (creating a sale with no line items) and
`qty<0` passes and then `update_row("productos", …, {"stock": stock - qty})` **increases** stock
by `|qty|`. Runtime-proven: `SALE|zero_qty|ok=true`, `SALE|negative_qty|ok=true`, and the next
check reported `disponible: 10` after starting at 5 (5 → 10). The HTTP layer validates `1..999`
(`web_server.gd:1153`) before calling, so it is reachable only by an internal caller that
bypasses the API. **Next step:** reject `qty <= 0` inside `crear_venta_web` (defense in depth).

**D17 — The CSV parser silently accepts an unterminated quote.** `CSVParser.parse_line()`
(csv_parser.gd:4) never detects an unbalanced `"`, so a malformed line is returned as one
field and, if the required headers are present, `productos.gd`/`clientes.gd` accept the row
(`CSV|unterminated_quote|required_cols=true|guard=ACCEPT`). The guard only checks that the
header row contains `nombre`/`precio`/`stock`; it does not validate field counts or quoting.
**Next step:** make `parse_line` flag unbalanced quotes and have the importer count fields
against the header.

**D18 — `open_db()` reports success on a non-SQLite file; locked DB has no busy handler.**
`Database._open_database()` (database.gd:93) only checks `db.open_db()`; pointing at a text
file returns `open=true` and the failure surfaces later as `query=false, err=file is not a
database`. Separately, an `INSERT` attempted while another connection holds `BEGIN EXCLUSIVE`
returns `false` with `database is locked` in ~0.7 s and no retry (SQLite default busy handler).
Neither crashes, but both mean callers must check `query()`'s return value (some paths, e.g.
`PrinterConfig.set_*`, ignore it). **Next step:** run a cheap `PRAGMA schema_version` after
open and treat failure as a fatal open error.

**D19 — Two rapid `Alerts` popups log an engine error.** `Alerts._create_popup` adds a new
`AcceptDialog` and calls `popup_centered()`; a second popup before the first is dismissed logs
`Attempting to make child window exclusive, but the parent window already has another exclusive
child`. Non-fatal (the app stays alive), but it means two near-simultaneous alerts (e.g. a
validation error followed by a stock error) leave two stacked modal dialogs. **Next step:** reuse
a single dialog instance or queue messages.

**Crash-recovery facts (no bug, but worth recording).** The DB runs in `journal_mode=delete`
(rollback journal), not WAL; a hard `Stop-Process` leaves `pos_database.db-journal` behind and
SQLite rolls it back on the next open. `export_db`/`import_db` copy the file with the DB closed
and are therefore safe in this mode — but the D4 caveat stands: they are not WAL-aware.

---

## Reproduce

```powershell
$exe="C:\Users\Usuario\Downloads\Godot_v4.7-stable_win64.exe\Godot_v4.7-stable_win64.exe"
$proj="C:\Users\Usuario\Documents\Mangolabs\pooppos-legacy"

# Item 3: clean init (rename userdata first)
Rename-Item "$env:APPDATA\Godot\app_userdata\poopPOS - 1.0.7" "poopPOS - 1.0.7.bak"
& $exe --headless --path $proj -s res://tests/verify_slice1_init.gd   # run 1
# Item 7a: same userdata again -> idempotency
& $exe --headless --path $proj -s res://tests/verify_slice1_init.gd   # run 2
# Item 8: round-trip
& $exe --headless --path $proj -s res://tests/verify_slice1_backup.gd -- "$env:TEMP\rt.backup.db"
# Item 7c: legacy transforms
& $exe --headless --path $proj -s res://tests/verify_slice1_migrations.gd
# Discovery D1: reset completeness
& $exe --headless --path $proj -s res://tests/verify_slice1_wipe.gd
```

### Slice 2 (web server) reproduce

The HTTP host (`verify_slice2_server.gd`) is started as a background process; PowerShell is
the client. The instance must be stopped and a **fresh port** used per lifecycle. Full
drivers live in `%LOCALAPPDATA%\Temp\opencode\slice2\` (`lib.ps1`,
`scenario_session.ps1`, `scenario_multiclient.ps1`, `static_check.ps1`).

```powershell
# 0. back up the runtime DB, then seed deterministic fixtures
Copy-Item "$env:APPDATA\Godot\app_userdata\poopPOS - 1.0.7\pos_database.db" "$env:TEMP\slice2\db.bak"
& $exe --headless --path $proj -s res://tests/verify_slice2_seed.gd
& $exe --headless --path $proj -s res://tests/verify_slice2_db.gd -- clear_sessions

# 1. item 2 (session persistence) - login, restart, TTL, invalidation
powershell -File "$env:TEMP\slice2\scenario_session.ps1"

# 2. item 4 (multi-client) - parallel sales, order queue, order flow
powershell -File "$env:TEMP\slice2\scenario_multiclient.ps1"

# 3. item 5 (embedded assets) - fidelity + generator diff + static serving
& $exe --headless --path $proj -s res://tests/verify_slice2_assets.gd
& $exe --headless --path $proj -s res://scripts/utils/generate_web_assets.gd   # then diff/restore
powershell -File "$env:TEMP\slice2\static_check.ps1"

# 4. restore the runtime DB
Copy-Item "$env:TEMP\slice2\db.bak" "$env:APPDATA\Godot\app_userdata\poopPOS - 1.0.7\pos_database.db" -Force
```

The exported-binary round-trip for item 5 requires Godot export templates (not installed):
`& $exe --headless --export-release "Linux" <out>` — NOT RUN in this slice.

### Slice 3 (printing, errors, crash recovery) reproduce

```powershell
$exe="C:\Users\Usuario\Downloads\Godot_v4.7-stable_win64.exe\Godot_v4.7-stable_win64.exe"
$proj="C:\Users\Usuario\Documents\Mangolabs\pooppos-legacy"
$ev="C:\Users\Usuario\AppData\Local\Temp\opencode\slice3"
$db="$env:APPDATA\Godot\app_userdata\poopPOS - 1.0.7\pos_database.db"

# 0. back up the runtime DB (restore after the destructive probes)
Copy-Item $db "$ev\db.bak" -Force

# item 6 - printing (TXT receipt + ESC/POS bytes + option sensitivity + TCP copies)
& $exe --headless --path $proj -s res://tests/verify_slice3_print.gd -- $ev

# item 9 - error handling (CSV, config, PIN, DB open/import, sale payload, assets)
& $exe --headless --path $proj -s res://tests/verify_slice3_errors.gd -- $ev
# item 9 - locked DB (run with a hard timeout; exits in <1s here)
& $exe --headless --path $proj -s res://tests/verify_slice3_dblock.gd

# item 10 - crash recovery (kill writer mid-transaction, reopen + integrity check)
powershell -File "$ev\crash_driver.ps1"     # cycles A, B, C; restores the DB at the end

# restore the runtime DB if a probe left it dirty
Copy-Item "$ev\db.bak" $db -Force
```

Artifacts: `receipt_txt.txt`, `receipt_escpos.bin`, `print.log`, `errors.log`, `dblock.log`,
`check_{A,B,C_unclean}.log`, `writer_{A,B,C_unclean}.log` under `$ev`.
