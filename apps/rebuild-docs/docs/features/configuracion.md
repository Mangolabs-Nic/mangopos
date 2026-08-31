---
sidebar_position: 10
---

# Configuración

Ajustes globales del sistema. La mayoría solo el administrador debe acceder (protegido por permisos).

## Datos del negocio

- **Función:** Nombre, RUC/RIF/NIT, dirección y teléfono.
- **Importancia:** Se imprimen en tickets y se muestran en la web; un ticket sin datos fiscales no sirve como comprobante.

## Monedas, IVA e impuestos/recargos

- **Función:** Configuración de moneda principal y tasas; tasa de IVA e indicador de si va incluido en precios o se suma; catálogo de impuestos y recargos (porcentaje o monto fijo, automáticos o manuales, activables por switch).
- **Importancia:** Centraliza la política monetaria y fiscal del negocio: la misma configuración alimenta ventas, compras, cuadre de caja y reportes.

## Personalización (layout)

- **Función:** Elige la vista de venta (clásica vs grilla por categoría) y muestra/oculta las tarjetas resumen del menú principal.
- **Importancia:** Adapta el POS al estilo del negocio y la pantalla disponible; puede elegirse mantener el layout ya configurado por negocio.

## Datos por módulo utilitario (tags, advertencias)

- **Función:** Módulos de tags por producto (palabras sueltas para búsqueda) y advertencias (mensajes popup que se vinculan a productos).
- **Importancia:** El buscador entiende "gripe" → ibuprofeno; las advertencias cumplen la normativa farmacéutica.

## Importación CSV

- **Función:** Carga masiva de productos, clientes y proveedores desde archivos CSV.
- **Importancia:** Puesta en marcha rápida del sistema sin digitación; evita errores de tipeo en catálogos grandes.

## Acceso web (clientes web)

- **Función:** Activa el servidor web local (puerto configurable), genera URL + código QR para dispositivos de la LAN, con enlaces alternativos por interfaz de red, y switches de: órdenes web, ventas directas, login requerido, estado online. Muestra la cola de órdenes web con acciones Preparar/Cobrar/Cancelar y las conexiones web activas (dispositivo + empleado + tiempo). Los datos de negocio (nombre, etc.) se sirven automáticamente.
- **Importancia:** Multi-punto de venta sin software extra; el QR simplifica la conexión; ver quién está conectado es control operativo de los dispositivos.

## Order Flow (configuración)

- **Función:** Activa/desactiva el flujo de estados, crea/edita/reordena/elimina estados, define el estado inicial y evita borrar el último estado o usar "Completada" como estado.
- **Importancia:** Ajusta el flujo de preparación de pedidos al proceso real del negocio (cocina, despacho, dispensación) sin tocar código.

## Impresión

- **Función:** Establece tipo de salida de impresión (archivo de texto, impresora genérica CUPS/Windows, o térmica ESC/POS), impresora (con detección de impresoras instaladas), copias, ancho del papel y codificación de caracteres; incluye test y vista previa de recibo.
- **Importancia:** La termoprintadora es el estándar en farmacias; esta configuración permite usar cualquier impresora disponible y que el ticket salga legible y con el formato del negocio.

## Backup y restauración de base de datos

- **Función:** Exporta toda la DB a un archivo, importa de un archivo, con indicación de ruta y estado.
- **Importancia:** Protege el activo más valioso del sistema: los datos. Permite migrar de computador y recuperar si falla la máquina.

## Restablecer (reset)

- **Función:** Borra todos los datos del sistema mediante confirmación en 3 pasos + PIN del administrador (con creación previa de backup).
- **Importancia:** Reutilización del POS para un negocio nuevo, destruyendo datos históricos de forma irreversible y acompañada de respaldo previo.

## Actualizaciones (OTA)

- **Función:** Consulta un archivo de versión remoto para avisar si hay nueva versión y mostrar mensajes del desarrollador.
- **Importancia:** Distribuye correcciones y funcionalidades nuevas sin intervención técnica local.

## Seguridad de acceso web

- **Función:** Llave de acceso web configurable, sesiones por dispositivo (con empleado y tiempo de actividad) y su invalidación al regenerar la llave.
- **Importancia:** Evita que personas ajenas a la red local conozcan los datos del negocio y permite acceso protegido por PIN/permisos igual que el POS.