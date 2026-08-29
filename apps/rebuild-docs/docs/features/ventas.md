---
sidebar_position: 2
---

# Ventas

Módulo central del negocio. Registra todas las ventas y es la fuente principal de ingresos del sistema.

## Registro de ventas

- **Función:** Lista cronológica de todas las ventas con búsqueda, paginación y detalle por venta.
- **Importancia:** Permite al negocio consultar historial completo de ventas, reimprimir recibos y verificar cada transacción realizada.

## Carrito de venta

- **Función:** Formulario donde se agregan productos/servicios con cantidad, se elige cliente (opcional), moneda, cuenta de cobro, se aplican descuentos y cargos manuales, y se calcula el monto a pagar.
- **Importancia:** Es la herramienta de cobro diaria del cajero. Permite capturar toda la información de la transacción en un solo flujo eficiente.

## Vista por categoría (grid de productos)

- **Función:** Alternativa al carrito clásico: los productos se muestran en grilla por categoría (con imágenes), para agregar rápido al carrito.
- **Importancia:** Reduce el tiempo de venta cuando se usan pantallas táctiles o hay muchos productos con foto, común en farmacias y tiendas.

## Venta rápida

- **Función:** Modo de venta simplificado (overlay) para cobrar rápido sin salir del formulario.
- **Importancia:** Agiliza la atención en horas pico con filas de clientes.

## Descuentos, cargos e impuestos

- **Función:** Cada venta admite descuento global, cargos manuales (impuestos o recargos definidos en configuración) y cálculo automático de IVA.
- **Importancia:** Refleja políticas de precios reales (ofertas, recargos de tarjeta) y cumple con obligaciones fiscales; el IVA es configurable como incluido o añadido al precio.

## Cliente, cuenta y moneda

- **Función:** Toda venta puede asociarse a un cliente, a una cuenta de cobro (efectivo, banco, etc.) y a la moneda en que se paga (con conversión de tasa).
- **Importancia:** Permite historial de compras por cliente (gasto acumulado) y control de fondos por cuenta; soporta entornos multi-moneda como negocios fronterizos o con turismo.

## Anulación de ventas

- **Función:** Permite anular una venta registrada, con registro del motivo.
- **Importancia:** Corrige errores de cobro manteniendo la trazabilidad y las cifras de reportes veraces (las anuladas se excluyen de los totales).

## Impresión de recibo

- **Función:** Al completar la venta, se ofrece imprimir el recibo/ticket con datos del negocio, empleado, cliente, lotes consumidos y desglose de IVA.
- **Importancia:** Requisito de facturación para el negocio y respaldo documental para el cliente; el formato es configurable (texto, impresora genérica o térmica).

## Ventas con lotes (FEFO)

- **Función:** Las ventas de productos con vencimiento consumen los lotes con fecha de expiración más cercana primero (First-Expiry-First-Out).
- **Importancia:** Evita pérdidas por productos caducados y es práctica obligatoria en farmacia. El ticket refleja los lotes vendidos hasta la unidad.

## Advertencias por producto

- **Función:** Al vender un producto con advertencias activas, aparece un popup con el mensaje (p. ej. "requiere receta") y nota opcional; la nota queda en la descripción de la venta.
- **Importancia:** Cumplimiento legal/medicinal en farmacia; el sistema registra evidencia de que el vendedor fue advertido.

## Clientela web (órdenes y ventas desde otro dispositivo)

- **Función:** Servidor web local (LAN) con código QR: otros empleados piden desde su navegador (móvil/tablet) con su propio PIN. Hay dos flujos: (a) crear una **orden** que queda en cola en el POS para ser preparada y cobrada, o (b) **venta directa** con checkout completo desde el navegador (cliente, moneda, descuento, cargos, pago con cambio, impresión).
- **Importancia:** Permite vender con varios dispositivos a la vez sin hardware extra; el QR facilita el acceso del personal; el stock se valida de forma atómica para evitar sobreventas entre dispositivos.

## Order Flow (estados de venta)

- **Función:** Flujo de estados configurables (p. ej. "Recibida → En preparación → Lista") por el que pasan las ventas; los estados se cambian manualmente desde el módulo Order Flow web; el último estado marca la venta como completada.
- **Importancia:** Organiza operaciones tipo restaurante/bares: la cocina o preparación ve el pedido y avanza el estado; las ventas pendientes de entrega quedan visibles para todo el equipo.