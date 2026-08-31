# poopPOS — Visión General de Funcionalidades

> Documento de referencia funcional del sistema. Describe cada módulo, sus funciones y la importancia de cada una, con el objetivo de servir como base para la migración a un nuevo sistema.
> No incluye detalles de implementación ni código.

---

## 1. Ventas

Módulo central del negocio. Registra todas las ventas y es la fuente principal de ingresos del sistema.

### 1.1 Registro de ventas
- **Función:** Lista cronológica de todas las ventas con búsqueda, paginación y detalle por venta.
- **Importancia:** Permite al negocio consultar historial completo de ventas, reimprimir recibos y verificar cada transacción realizada.

### 1.2 Carrito de venta
- **Función:** Formulario donde se agregan productos/servicios con cantidad, se elige cliente (opcional), moneda, cuenta de cobro, se aplican descuentos y cargos manuales, y se calcula el monto a pagar.
- **Importancia:** Es la herramienta de cobro diaria del cajero. Permite capturar toda la información de la transacción en un solo flujo eficiente.

### 1.3 Vista por categoría (grid de productos)
- **Función:** Alternativa al carrito clásico: los productos se muestran en grilla por categoría (con imágenes), para agregar rápido al carrito.
- **Importancia:** Reduce el tiempo de venta cuando se usan pantallas táctiles o hay muchos productos con foto, común en farmacias y tiendas.

### 1.4 Venta rápida
- **Función:** Modo de venta simplificado (overlay) para cobrar rápido sin salir del formulario.
- **Importancia:** Agiliza la atención en horas pico con filas de clientes.

### 1.5 Descuentos, cargos e impuestos
- **Función:** Cada venta admite descuento global, cargos manuales (impuestos o recargos definidos en configuración) y cálculo automático de IVA.
- **Importancia:** Refleja políticas de precios reales (ofertas, recargos de tarjeta) y cumple con obligaciones fiscales; el IVA es configurable como incluido o añadido al precio.

### 1.6 Cliente, cuenta y moneda
- **Función:** Toda venta puede asociarse a un cliente, a una cuenta de cobro (efectivo, banco, etc.) y a la moneda en que se paga (con conversión de tasa).
- **Importancia:** Permite historial de compras por cliente (gasto acumulado) y control de fondos por cuenta; soporta entornos multi-moneda como negocios fronterizos o con turismo.

### 1.7 Anulación de ventas
- **Función:** Permite anular una venta registrada, con registro del motivo.
- **Importancia:** Corrige errores de cobro manteniendo la trazabilidad y las cifras de reportes veraces (las anuladas se excluyen de los totales).

### 1.8 Impresión de recibo
- **Función:** Al completar la venta, se ofrece imprimir el recibo/ticket con datos del negocio, empleado, cliente, lotes consumidos y desglose de IVA.
- **Importancia:** Requisito de facturación para el negocio y respaldo documental para el cliente; el formato es configurable (texto, impresora genérica o térmica).

### 1.9 Ventas con lotes (FEFO)
- **Función:** Las ventas de productos con vencimiento consumen los lotes con fecha de expiración más cercana primero (First-Expiry-First-Out).
- **Importancia:** Evita pérdidas por productos caducados y es práctica obligatoria en farmacia. El ticket refleja los lotes vendidos hasta la unidad.

### 1.10 Advertencias por producto
- **Función:** Al vender un producto con advertencias activas, aparece un popup con el mensaje (p. ej. "requiere receta") y nota opcional; la nota queda en la descripción de la venta.
- **Importancia:** Cumplimiento legal/medicinal en farmacia; el sistema registra evidencia de que el vendedor fue advertido.

### 1.11 Clientela web (órdenes y ventas desde otro dispositivo)
- **Función:** Servidor web local (LAN) con código QR: otros empleados piden desde su navegador (móvil/tablet) con su propio PIN. Hay dos flujos: (a) crear una **orden** que queda en cola en el POS para ser preparada y cobrada, o (b) **venta directa** con checkout completo desde el navegador (cliente, moneda, descuento, cargos, pago con cambio, impresión).
- **Importancia:** Permite vender con varios dispositivos a la vez sin hardware extra; el QR facilita el acceso del personal; el stock se valida de forma atómica para evitar sobreventas entre dispositivos.

### 1.12 Order Flow (estados de venta)
- **Función:** Flujo de estados configurables (p. ej. "Recibida → En preparación → Lista") por el que pasan las ventas; los estados se cambian manualmente desde el módulo Order Flow web; el último estado marca la venta como completada.
- **Importancia:** Organiza operaciones tipo restaurante/bares: la cocina o preparación ve el pedido y avanza el estado; las ventas pendientes de entrega quedan visibles para todo el equipo.

---

## 2. Gastos

Módulo de egresos e inversión del negocio. Complementa las ventas para conocer la utilidad real.

### 2.1 Registro de gastos
- **Función:** Lista cronológica de gastos con búsqueda, paginación y detalle.
- **Importancia:** Permite controlar todos los egresos del negocio (compra de mercancía, servicios, arriendos, etc.).

### 2.2 Carrito de gasto
- **Función:** Formulario donde se agregan productos comprados con cantidad y precio unitario, se elige proveedor (opcional), cuenta de pago y moneda; los totales se calculan automáticamente.
- **Importancia:** La compra a proveedores se registra en minutos y deja listo el detalle de mercancía entrante, alimentando inventario, costos y márgenes.

### 2.3 Gasto rápido
- **Función:** Overlay simplificado para registrar un gasto de inmediato.
- **Importancia:** Favorece el registro oportuno de egresos; un gasto no registrado distorsiona utilidades y cortes.

### 2.4 Compra a crédito
- **Función:** Al marcar "A crédito", el gasto no descuenta saldo de la cuenta y crea automáticamente una cuenta por pagar al proveedor.
- **Importancia:** Registra deudas reales con proveedores y evita que el crédito confunda la caja del día.

### 2.5 Impacto en inventario y lotes
- **Función:** Los productos comprados en gastos entran al stock y generan lotes (proveedor, vencimiento, cantidad).
- **Importancia:** El inventario se mantiene al día sin teclearlo por producto; el costo de compra queda disponible para calcular márgenes de ganancia.

---

## 3. Inventario

Hub de control de mercancías: productos, servicios, categorías, lotes y movimientos. Incluye su propia bitácora de stock.

### 3.1 Productos
- **Función:** CRUD completo: nombre, descripción, precio, stock, stock mínimo, costo, código de barras, principio activo (farmacia), imagen, moneda, tags, categorías múltiples, lotes y advertencias.
- **Importancia:** Es el catálogo base del sistema: de aquí salen ventas, compras, reportes y la tienda web. El stock mínimo alimenta las alertas de reposición.

### 3.2 Servicios
- **Función:** Tipo de producto sin control de stock (p. ej. servicios técnicos o tarifas).
- **Importancia:** Permite vender servicios en el mismo carrito que productos, sin generar conteos de inventario falsos.

### 3.3 Categorías
- **Función:** Organización de productos en categorías; cada producto puede pertenecer a varias.
- **Importancia:** Hace útil la venta por grilla (el cajero encuentra rápido lo que busca) y permite filtrar reportes por rubro.

### 3.4 Lotes y vencimientos
- **Función:** Cada entrada de stock puede tener código de lote, proveedor y fecha de vencimiento; el sistema alerta lotes/próximos a vencer.
- **Importancia:** Control de caducidad (crítico en farmacia/despensa); permite consumir primero lo que vence antes y sacar de venta lo vencido.

### 3.5 Inventario físico (conteo)
- **Función:** Permite contabilizar el stock real frente al sistema, registrar el conteo por producto/lote, calcular la diferencia y aplicarla como ajuste con motivo y empleado.
- **Importancia:** Detecta mermas, robos o errores de registro; reconciliar el stock en físico es la única forma de estar seguro de que las ventas no fallan por falta de mercancía.

### 3.6 Movimientos de inventario
- **Función:** Bitácora de todas las entradas y salidas (compra, venta, ajuste, merma) con motivo, usuario, fecha y referencia.
- **Importancia:** Auditoría completa: cualquier diferencia en stock se puede explicar con su historial. Es la fuente de verdad para la trazabilidad.

### 3.7 Órdenes de compra
- **Función:** Flujo de compra a proveedor: crear orden con productos, cantidades y precios; consultar pendientes; al recibirla, los lotes y stock se actualizan automáticamente y se puede generar una cuenta por pagar; también se puede anular.
- **Importancia:** Planifica y controla las compras; separa "lo pedido" de "lo recibido" y evita quedar sin stock o comprar de más. Da registro previo de cada adquisición y su costo.

### 3.8 Trazabilidad por producto y recall
- **Función:** Historial total de un producto: compras, lotes, movimientos, ventas y utilidad por lote. Además, permite localizar a todos los clientes que compraron un lote específico (recall).
- **Importancia:** Obligación legal en farmacia y alimentación: si un lote sale defectuoso, se identifica en segundos a los afectados. La trazabilidad completa también respalda garantías y reclamos.

### 3.9 Alertas de inventario
- **Función:** Icono flotante en el menú principal que lista productos con stock bajo (≤ stock mínimo) y lotes próximos a vencer; con acceso directo al inventario.
- **Importancia:** Aviso temprano de reposición y de caducidades pendientes, sin revisar producto por producto.

### 3.10 Importación de productos (CSV)
- **Función:** Carga masiva de productos desde archivo CSV, respetando campos con comas (RFC-4180).
- **Importancia:** Migra una tienda entera en minutos; evita teclear cientos de productos a mano.

---

## 4. Clientes

### 4.1 Gestión de clientes
- **Función:** CRUD completo: nombre, código, identificación (cédula/RIF/NIT), teléfono y email.
- **Importancia:** Permite identificar al comprador, asociar ventas históricas y aplicar clientes frecuentes en la venta para mantener su historial de gasto.

### 4.2 Gasto acumulado por cliente
- **Función:** El sistema suma automáticamente el total de cada venta al gasto acumulado del cliente.
- **Importancia:** Refleja quiénes son los clientes más valiosos; base para lealtad, crédito y reportes de ventas por cliente.

### 4.3 Importación de clientes (CSV)
- **Función:** Carga masiva de clientes desde archivo CSV.
- **Importancia:** Permite arrancar el sistema con la cartera ya cargada.

---

## 5. Proveedores

### 5.1 Gestión de proveedores
- **Función:** CRUD completo: nombre, código, teléfono y email. El código corto facilita identificar y vincular compras.
- **Importancia:** Cuadro de abastecimiento ordenado; todo gasto, orden de compra y lote puede vincularse a su proveedor.

### 5.2 Gasto acumulado por proveedor
- **Función:** El sistema acumula en cada proveedor el total de compras registradas (gastos y órdenes recibidas).
- **Importancia:** Permite negociar volúmenes, detectar concentración de compras y comparar proveedores.

### 5.3 Importación de proveedores (CSV)
- **Función:** Carga masiva de proveedores desde archivo CSV.
- **Importancia:** Acelera el arranque del sistema con la lista de proveedores ya completa.

---

## 6. Empleados

### 6.1 Gestión de empleados
- **Función:** CRUD completo: nombre, puesto, teléfono, email, PIN de acceso y permisos por módulo.
- **Importancia:** Permite saber quién vendió, compró o ajustó el inventario y controlar qué módulos puede usar cada persona.

### 6.2 Acceso con PIN
- **Función:** Cada empleado inicia sesión en el POS con su PIN de 4+ dígitos.
- **Importancia:** Seguridad simple y rápida en pantalla táctil; evita que cualquier persona maneje las ventas.

### 6.3 Permisos por módulo
- **Función:** Los permisos definen a qué módulos accede cada empleado (ventas, gastos, inventario, configuración, etc.). Sin permisos configurados, el empleado accede a todo.
- **Importancia:** Principio de mínimo privilegio: cajeros solo venden, admin lo gestiona todo. Reduce errores costosos y fraudes.

### 6.4 Recuperación de PIN
- **Función:** El administrador puede restablecer/recuperar el PIN de un empleado con contraseña de recuperación.
- **Importancia:** Evita que el negocio quede bloqueado si un empleado olvida su PIN o se va sin entregar el acceso.

### 6.5 Identificación en operaciones
- **Función:** Ventas, movimientos de inventario, ajustes y bitácora registran qué empleado ejecutó cada acción.
- **Importancia:** Responsabiliza cada operación; base para auditoría y reportes de productividad por empleado.

---

## 7. Reportes

Centro de análisis: cierre de día, ventas/gastos por período, bitácora y reportes especializados de farmacia.

### 7.1 Corte de día (cierre)
- **Función:** Cierra el día con ventas y gastos no asociados a otro corte: totaliza (normalizado a la moneda principal), registra cantidad de transacciones y deja las ventas/gastos asociados al corte. Genera el rango desde el último corte.
- **Importancia:** Define el arqueo diario del negocio: el cajero sabe cuánto debe haber en caja y qué tan rentable fue el día. Es la base del control financiero a corto plazo.

### 7.2 Reportes generales por período
- **Función:** Ventas y gastos por semana, mes, año o rango personalizado, con normalización de monedas a la moneda principal.
- **Importancia:** Mide el desempeño del negocio en el tiempo (tendencias, temporadas, comparativos) y sustenta decisiones de compra e inversión.

### 7.3 Reportes de farmacia
- **Función:** Cuatro reportes especializados: (a) productos más vendidos, (b) productos/lotes próximos a vencer (incluye productos sin lotes con fecha), (c) márgenes de ganancia por producto (precio vs costo), (d) ventas por empleado.
- **Importancia:** En farmacia, rotación y caducidad son el negocio: qué vender más, qué sacar pronto, qué deja utilidad y quién vende más.

### 7.4 Bitácora de actividad
- **Función:** Historial legible de todas las acciones (crear, editar, borrar, anular, cobrar, cambiar estados) con fecha, usuario y detalle.
- **Importancia:** Auditoría completa: cualquier dato cambiado se puede reconstruir y responsabilizar; detecta errores y abusos.

### 7.5 Reportes web (consultas por navegador)
- **Función:** Desde los clientes web: resumen del día (ventas, gastos, stock bajo, caja), listados de ventas y gastos del día con búsqueda, y reporte de ventas en tiempo real.
- **Importancia:** El encargado ve el estado del negocio desde otro dispositivo, sin parar al cajero.

---

## 8. Cuentas

Módulo de dinero: cuentas de cobro/pago, balances por moneda, transferencias, cuentas por pagar y monedas.

### 8.1 Cuentas (caja, bancos, otros)
- **Función:** CRUD de cuentas: nombre, descripción, balance actual y monedas admitidas.
- **Importancia:** Separa el dinero físico (caja) del bancario y permite saber cuánto hay en cada fondo. Las ventas entran a la cuenta elegida y los gastos salen de ella.

### 8.2 Balances por moneda
- **Función:** Cada cuenta guarda su balance por moneda por separado (caja con $ y €).
- **Importancia:** En negocios que reciben monedas distintas, el balance por moneda es el único inventario de dinero confiable.

### 8.3 Transferencias entre cuentas
- **Función:** Mueve dinero de una cuenta a otra (p. ej. de caja a banco) con moneda y descuento de saldo.
- **Importancia:** Refleja movimientos reales de fondos sin falsificar ventas/gastos. La caja y los bancos quedan siempre cuadrados.

### 8.4 Cuentas por pagar
- **Función:** Deudas a proveedores (compra a crédito u órdenes recibidas): monto, moneda, fecha de vencimiento, descripción, estado pendiente/pagada y cuenta desde la que se paga. El pago descuenta el balance de la cuenta directamente.
- **Importancia:** Controla el pasivo del negocio y evita pagar deudas con dinero que la caja no tiene; cierre el ciclo crédito→pago.

### 8.5 Monedas y tasas de cambio
- **Función:** Define monedas disponibles, moneda principal y tasas de cambio relativas a la principal.
- **Importancia:** Multi-moneda real: las ventas en otra divisa se normalizan al convertir para totales, cortes y reportes; los balances por cuenta y cuentas por pagar conservan su moneda original.

---

## 9. Configuración

Ajustes globales del sistema. La mayoría solo el administrador debe acceder (protegido por permisos).

### 9.1 Datos del negocio
- **Función:** Nombre, RUC/RIF/NIT, dirección y teléfono.
- **Importancia:** Se imprimen en tickets y se muestran en la web; un ticket sin datos fiscales no sirve como comprobante.

### 9.2 Monedas, IVA e impuestos/recargos
- **Función:** Configuración de moneda principal y tasas; tasa de IVA e indicador de si va incluido en precios o se suma; catálogo de impuestos y recargos (porcentaje o monto fijo, automáticos o manuales, activables por switch).
- **Importancia:** Centraliza la política monetaria y fiscal del negocio: la misma configuración alimenta ventas, compras, cuadre de caja y reportes.

### 9.3 Personalización (layout)
- **Función:** Elige la vista de venta (clásica vs grilla por categoría) y muestra/oculta las tarjetas resumen del menú principal.
- **Importancia:** Adapta el POS al estilo del negocio y la pantalla disponible; puede elegirse mantener el layout ya configurado por negocio.

### 9.4 Datos por módulo utilitario (tags, advertencias)
- **Función:** Módulos de tags por producto (palabras sueltas para búsqueda) y advertencias (mensajes popup que se vinculan a productos).
- **Importancia:** El buscador entiende "gripe" → ibuprofeno; las advertencias cumplen la normativa farmacéutica.

### 9.5 Importación CSV
- **Función:** Carga masiva de productos, clientes y proveedores desde archivos CSV.
- **Importancia:** Puesta en marcha rápida del sistema sin digitación; evita errores de tipeo en catálogos grandes.

### 9.6 Acceso web (clientes web)
- **Función:** Activa el servidor web local (puerto configurable), genera URL + código QR para dispositivos de la LAN, con enlaces alternativos por interfaz de red, y switches de: órdenes web, ventas directas, login requerido, estado online. Muestra la cola de órdenes web con acciones Preparar/Cobrar/Cancelar y las conexiones web activas (dispositivo + empleado + tiempo). Los datos de negocio (nombre, etc.) se sirven automáticamente.
- **Importancia:** Multi-punto de venta sin software extra; el QR simplifica la conexión; ver quién está conectado es control operativo de los dispositivos.

### 9.7 Order Flow (configuración)
- **Función:** Activa/desactiva el flujo de estados, crea/ edita/reordena/elimina estados, define el estado inicial y evita borrar el último estado o usar "Completada" como estado.
- **Importancia:** Ajusta el flujo de preparación de pedidos al proceso real del negocio (cocina, despacho, dispensación) sin tocar código.

### 9.8 Impresión
- **Función:** Establece tipo de salida de impresión (archivo de texto, impresora genérica CUPS/Windows, o térmica ESC/POS), impresora (con detección de impresoras instaladas), copias, ancho del papel y codificación de caracteres; incluye test y vista previa de recibo.
- **Importancia:** La termoprintadora es el estándar en farmacias; esta configuración permite usar cualquier impresora disponible y que el ticket salga legible y con el formato del negocio.

### 9.9 Backup y restauración de base de datos
- **Función:** Exporta toda la DB a un archivo, importa de un archivo, con indicación de ruta y estado.
- **Importancia:** Protege el activo más valioso del sistema: los datos. Permite migrar de computador y recuperar si falla la máquina.

### 9.10 Restablecer (reset)
- **Función:** Borra todos los datos del sistema mediante confirmación en 3 pasos + PIN del administrador (con creación previa de backup).
- **Importancia:** Reutilización del POS para un negocio nuevo, destruyendo datos históricos de forma irreversible y acompañada de respaldo previo.

### 9.11 Actualizaciones (OTA)
- **Función:** Consulta un archivo de versión remoto para avisar si hay nueva versión y mostrar mensajes del desarrollador.
- **Importancia:** Distribuye correcciones y funcionalidades nuevas sin intervención técnica local.

### 9.12 Seguridad de acceso web
- **Función:** Llave de acceso web configurable, sesiones por dispositivo (con empleado y tiempo de actividad) y su invalidación al regenerar la llave.
- **Importancia:** Evita personas ajenas a la red local conozcan los datos del negocio y permite acceso protegido por PIN/permisos igual que el POS.
