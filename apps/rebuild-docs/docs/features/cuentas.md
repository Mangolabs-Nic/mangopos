---
sidebar_position: 9
---

# Cuentas

Módulo de dinero: cuentas de cobro/pago, balances por moneda, transferencias, cuentas por pagar y monedas.

## Cuentas (caja, bancos, otros)

- **Función:** CRUD de cuentas: nombre, descripción, balance actual y monedas admitidas.
- **Importancia:** Separa el dinero físico (caja) del bancario y permite saber cuánto hay en cada fondo. Las ventas entran a la cuenta elegida y los gastos salen de ella.

## Balances por moneda

- **Función:** Cada cuenta guarda su balance por moneda por separado (caja con $ y €).
- **Importancia:** En negocios que reciben monedas distintas, el balance por moneda es el único inventario de dinero confiable.

## Transferencias entre cuentas

- **Función:** Mueve dinero de una cuenta a otra (p. ej. de caja a banco) con moneda y descuento de saldo.
- **Importancia:** Refleja movimientos reales de fondos sin falsificar ventas/gastos. La caja y los bancos quedan siempre cuadrados.

## Cuentas por pagar

- **Función:** Deudas a proveedores (compra a crédito u órdenes recibidas): monto, moneda, fecha de vencimiento, descripción, estado pendiente/pagada y cuenta desde la que se paga. El pago descuenta el balance de la cuenta directamente.
- **Importancia:** Controla el pasivo del negocio y evita pagar deudas con dinero que la caja no tiene; cierra el ciclo crédito→pago.

## Monedas y tasas de cambio

- **Función:** Define monedas disponibles, moneda principal y tasas de cambio relativas a la principal.
- **Importancia:** Multi-moneda real: las ventas en otra divisa se normalizan al convertir para totales, cortes y reportes; los balances por cuenta y cuentas por pagar conservan su moneda original.