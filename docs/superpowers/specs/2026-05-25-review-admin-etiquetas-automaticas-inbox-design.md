# Review Admin Etiquetas Automaticas Inbox - Diseno MVP

Fecha: 2026-05-25

## Objetivo

Agregar etiquetas automaticas visibles en la bandeja del Review Admin para que el equipo pueda identificar rapido el motivo principal de cada mensaje, sin tocar el correo real, n8n, los estados actuales ni el flujo de envio.

Etiquetas iniciales:

- Escalar
- Devolucion
- Problema envio
- Problema producto

## Alcance

Incluido:

- Calcular etiquetas automaticamente desde datos ya existentes del ticket.
- Mostrar etiquetas como badges en la lista y en el detalle.
- Agregar filtro visual por etiqueta en la bandeja.
- Mantener estados actuales separados de etiquetas.
- Cubrir reglas con tests unitarios.

Fuera de alcance:

- Etiquetas manuales editables.
- Nuevas tablas o migraciones de base de datos.
- Cambios en n8n.
- Cambios en el bot o en prompts.
- Cambios en correo, IMAP, SMTP o sincronizacion webmail.
- Cambios en status como `pending_review`, `approved_sent`, `discarded`.

## Arquitectura

La primera version sera derivada y sin persistencia. Una funcion pura recibira un ticket y devolvera una lista de etiquetas:

`getTicketTags(ticket) -> TicketTag[]`

La funcion vivira en:

`src/lib/ticket-tags.ts`

La API de tickets agregara `tags` al JSON que ya consume la UI. La UI usara esos `tags` para pintar badges y filtrar tickets en memoria. No se guardan etiquetas en la base de datos.

## Datos De Entrada

La clasificacion usara campos existentes:

- `subject`
- `originalText`
- `category`
- `intent`
- `riskFlags`
- `escalationRecommended`

La funcion debe tolerar valores nulos, textos vacios y mojibake ya corregido por la UI cuando aplique.

## Reglas De Etiquetado

Una etiqueta puede convivir con otras. Por ejemplo, un ticket puede ser `Problema envio` y `Escalar`.

Orden de salida recomendado:

1. Escalar
2. Devolucion
3. Problema envio
4. Problema producto

### Escalar

Se aplica si:

- `escalationRecommended` es `true`.
- `riskFlags` contiene senales de riesgo o revision humana.

Esta etiqueta conserva el comportamiento actual de "Escalar"; solo se integra en el nuevo sistema visual.

### Devolucion

Se aplica si `subject`, `originalText`, `category` o `intent` contienen terminos relacionados:

- devolucion
- reembolso
- cancelar
- cancelacion
- baja
- dinero
- formulario

### Problema envio

Se aplica si `subject`, `originalText`, `category` o `intent` contienen terminos relacionados:

- envio
- pedido
- seguimiento
- tracking
- transportista
- tipsa
- no recibido
- no ha llegado
- no llega
- donde esta
- cuando llega
- direccion incompleta
- falta el numero

Tambien se aplica si `category` contiene logistica o si `intent` contiene `order_status`.

### Problema producto

Se aplica si `subject`, `originalText`, `category` o `intent` contienen terminos relacionados:

- producto
- gomitas
- dosis
- tomar
- efectos
- resultados
- salud
- ingredientes
- no noto
- me funciona
- diarrea
- hinchazon
- digestion

Tambien se aplica si `category` contiene producto o salud.

## UI

En la bandeja:

- Agregar una fila compacta de filtros junto al buscador o debajo del buscador:
  - Todos
  - Escalar
  - Devolucion
  - Problema envio
  - Problema producto
- Mostrar las etiquetas calculadas debajo del preview de cada ticket.
- Mantener `category`, `intent` y riesgo si actualmente ayudan, pero evitar duplicar visualmente "Escalar" dos veces.

En el detalle:

- Mostrar las etiquetas cerca de los metadatos del ticket.
- No cambiar el editor, botones de enviar/rechazar ni auditoria.

En conversacion:

- Mostrar etiquetas en cada mensaje/ticket, igual que hoy se muestran `category` e `intent`.

## Seguridad En Produccion

El cambio debe ser de bajo riesgo:

- No toca n8n.
- No toca correo.
- No cambia credenciales.
- No requiere migracion.
- No cambia envio de respuestas.
- No cambia estados del ticket.
- No bloquea la carga de tickets si no hay etiquetas.
- Si el filtro falla, "Todos" debe seguir mostrando la bandeja normal.

## Testing

Tests unitarios en:

`src/lib/ticket-tags.test.ts`

Casos minimos:

- Escalar por `escalationRecommended`.
- Devolucion por texto y por categoria.
- Problema envio por tracking, no recibido y logistica.
- Problema producto por dosis, efectos, resultados y salud.
- Multiples etiquetas en un mismo ticket.
- Sin coincidencias devuelve lista vacia.

Validacion local:

- `npm.cmd test`
- `npm.cmd run build` con env local/dummy si hace falta para Next.

## Criterios De Aceptacion

- La bandeja muestra filtros por etiqueta.
- Cada ticket muestra etiquetas automaticas coherentes.
- Filtrar por etiqueta no cambia estados ni datos.
- Los tickets sin etiqueta siguen apareciendo en `Todos`.
- No se toca n8n ni webmail.
- Tests unitarios cubren las reglas.

## Rollback

Rollback simple:

- Revertir los cambios de UI/API/helper.
- No hay migracion que revertir.
- No hay cambios en n8n ni correo.

## Revision De La Spec

- La feature esta acotada al Review Admin.
- La clasificacion inicial es automatica y derivada.
- No hay cambios persistentes en datos.
- No hay dependencia de servicios externos.
- El diseno permite una fase 2 de etiquetas manuales si el cliente la pide despues.
