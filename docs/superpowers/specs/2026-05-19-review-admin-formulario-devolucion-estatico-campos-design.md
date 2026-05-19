# Review Admin - Formulario de devolución estático con campos abiertos

Fecha: 2026-05-19
Estado: Aprobado para implementación
Alcance: Cambiar solo la experiencia del formulario de devolución y su visibilidad desde la sección admin de Formularios.

## Objetivo

El formulario de devolución debe poder verse y usarse como una página normal, sin token en la URL, desde:

- Página pública: `/forms/devolucion`
- Sección admin: `/forms`

El diseño visual existente de V-Gummies se mantiene. No se modifica el resto del admin, workflows, credenciales ni lógica de tickets.

## Campos del formulario

Todos los campos visibles son obligatorios:

- Email de compra
- Número de pedido
- Producto afectado
- Motivo de devolución
- Detalle del motivo
- Explicación del caso
- Fotos o evidencia

`Email de compra` reemplaza el email genérico actual. El formulario queda abierto para que el cliente escriba todos los datos.

## Arquitectura

Se mantiene la implementación actual de Next.js en `review-admin`.

- La página pública sigue usando `src/app/forms/devolucion/page.tsx`.
- El componente cliente sigue usando `src/app/forms/devolucion/form-client.tsx`.
- El submit sigue usando `POST /api/forms/devolucion/submit`.
- La bandeja admin sigue usando `/forms` y los endpoints admin existentes.

No hay migración de base de datos en esta iteración. Para mantener el cambio pequeño y reversible, los nuevos campos se guardan en la columna existente `reason` como texto estructurado con etiquetas claras. Los campos existentes se mapean así:

- `customerEmail`: valor de Email de compra.
- `purchaseEmail`: mismo valor de Email de compra, para que el admin lo vea en el strip actual como email de compra.
- `orderNumber`: Número de pedido.
- `reason`: bloque estructurado con producto, motivo, detalle y explicación.
- `images`: fotos o evidencia.

## Admin

En `/forms`, la bandeja existente se mantiene. Se añade una entrada visual simple en la sección de formularios para abrir/ver el formulario estático de devolución sin token.

El detalle de cada solicitud sigue mostrando:

- Email del cliente.
- Número de pedido.
- Email de compra.
- Motivo del cliente, ahora como bloque estructurado.
- Fotos adjuntas.
- Notas internas.
- Respuesta editable y acciones actuales.

## Validaciones

Cliente:

- Email de compra requerido y con formato básico de email.
- Número de pedido requerido.
- Producto afectado requerido.
- Motivo de devolución requerido.
- Detalle del motivo requerido.
- Explicación del caso requerida con longitud mínima razonable.
- Fotos o evidencia requerida, al menos un archivo.
- Se mantienen límites actuales de archivos: máximo 3, 5 MB por archivo, tipos permitidos por la implementación existente.

Servidor:

- Repite las validaciones críticas.
- Rechaza envíos sin email, pedido, producto, motivo, detalle, explicación o evidencia.
- Mantiene honeypot, rate limit, validación de mime real y escritura segura de archivos.

## Pruebas

Verificación mínima:

- Compilar o ejecutar el test suite disponible de `review-admin`.
- Revisar que `/forms/devolucion` renderiza los nuevos campos.
- Revisar que el submit construye el payload esperado.
- Confirmar que `/forms` sigue cargando la bandeja admin.

## Fuera de alcance

- Eliminar endpoints legacy de token.
- Cambiar workflows de n8n.
- Migrar columnas nuevas a Prisma.
- Cambiar plantillas de email.
- Cambiar credenciales, variables de entorno o despliegue.
