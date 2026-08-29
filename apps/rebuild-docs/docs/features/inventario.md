---
sidebar_position: 4
---

# Inventario

Hub de control de mercancías: productos, servicios, categorías, lotes y movimientos. Incluye su propia bitácora de stock.

## Productos

- **Función:** CRUD completo: nombre, descripción, precio, stock, stock mínimo, costo, código de barras, principio activo (farmacia), imagen, moneda, tags, categorías múltiples, lotes y advertencias.
- **Importancia:** Es el catálogo base del sistema: de aquí salen ventas, compras, reportes y la tienda web. El stock mínimo alimenta las alertas de reposición.

## Servicios

- **Función:** Tipo de producto sin control de stock (p. ej. servicios técnicos o tarifas).
- **Importancia:** Permite vender servicios en el mismo carrito que productos, sin generar conteos de inventario falsos.

## Categorías

- **Función:** Organización de productos en categorías; cada producto puede pertenecer a varias.
- **Importancia:** Hace útil la venta por grilla (el cajero encuentra rápido lo que busca) y permite filtrar reportes por rubro.

## Lotes y vencimientos

- **Función:** Cada entrada de stock puede tener código de lote, proveedor y fecha de vencimiento; el sistema alerta lotes próximos a vencer.
- **Importancia:** Control de caducidad (crítico en farmacia/despensa); permite consumir primero lo que vence antes y sacar de venta lo vencido.

## Inventario físico (conteo)

- **Función:** Permite contabilizar el stock real frente al sistema, registrar el conteo por producto/lote, calcular la diferencia y aplicarla como ajuste con motivo y empleado.
- **Importancia:** Detecta mermas, robos o errores de registro; reconciliar el stock en físico es la única forma de estar seguro de que las ventas no fallan por falta de mercancía.

## Movimientos de inventario

- **Función:** Bitácora de todas las entradas y salidas (compra, venta, ajuste, merma) con motivo, usuario, fecha y referencia.
- **Importancia:** Auditoría completa: cualquier diferencia en stock se puede explicar con su historial. Es la fuente de verdad para la trazabilidad.

## Órdenes de compra

- **Función:** Flujo de compra a proveedor: crear orden con productos, cantidades y precios; consultar pendientes; al recibirla, los lotes y stock se actualizan automáticamente y se puede generar una cuenta por pagar; también se puede anular.
- **Importancia:** Planifica y controla las compras; separa "lo pedido" de "lo recibido" y evita quedar sin stock o comprar de más. Da registro previo de cada adquisición y su costo.

## Trazabilidad por producto y recall

- **Función:** Historial total de un producto: compras, lotes, movimientos, ventas y utilidad por lote. Además, permite localizar a todos los clientes que compraron un lote específico (recall).
- **Importancia:** Obligación legal en farmacia y alimentación: si un lote sale defectuoso, se identifica en segundos a los afectados. La trazabilidad completa también respalda garantías y reclamos.

## Alertas de inventario

- **Función:** Icono flotante en el menú principal que lista productos con stock bajo (≤ stock mínimo) y lotes próximos a vencer; con acceso directo al inventario.
- **Importancia:** Aviso temprano de reposición y de caducidades pendientes, sin revisar producto por producto.

## Importación de productos (CSV)

- **Función:** Carga masiva de productos desde archivo CSV, respetando campos con comas (RFC-4180).
- **Importancia:** Migra una tienda entera en minutos; evita teclear cientos de productos a mano.