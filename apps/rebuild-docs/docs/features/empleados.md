---
sidebar_position: 7
---

# Empleados

## Gestión de empleados

- **Función:** CRUD completo: nombre, puesto, teléfono, email, PIN de acceso y permisos por módulo.
- **Importancia:** Permite saber quién vendió, compró o ajustó el inventario y controlar qué módulos puede usar cada persona.

## Acceso con PIN

- **Función:** Cada empleado inicia sesión en el POS con su PIN de 4+ dígitos.
- **Importancia:** Seguridad simple y rápida en pantalla táctil; evita que cualquier persona maneje las ventas.

## Permisos por módulo

- **Función:** Los permisos definen a qué módulos accede cada empleado (ventas, gastos, inventario, configuración, etc.). Sin permisos configurados, el empleado accede a todo.
- **Importancia:** Principio de mínimo privilegio: cajeros solo venden, admin lo gestiona todo. Reduce errores costosos y fraudes.

## Recuperación de PIN

- **Función:** El administrador puede restablecer/recuperar el PIN de un empleado con contraseña de recuperación.
- **Importancia:** Evita que el negocio quede bloqueado si un empleado olvida su PIN o se va sin entregar el acceso.

## Identificación en operaciones

- **Función:** Ventas, movimientos de inventario, ajustes y bitácora registran qué empleado ejecutó cada acción.
- **Importancia:** Responsabiliza cada operación; base para auditoría y reportes de productividad por empleado.