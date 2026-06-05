# Shopify Orders Backfill 2026 - Design

## Contexto

El flujo actual `Shopify - Finanzas Sync` sincroniza pedidos de Shopify hacia Review Admin usando:

- Credencial Shopify existente `Shopify account 2`.
- DataTable de configuracion admin `Y8KDGv2Ua1UCfz4D`.
- Endpoint `POST /api/n8n/orders`.
- Transformacion a la tabla `PlatformOrder`.

La inconsistencia detectada es que el flujo trae solo una pagina de Shopify con `limit: 250`. Si entre ejecuciones diarias hubo mas de 250 pedidos, algunos pudieron quedar fuera. La tabla destino ya tiene proteccion contra duplicados mediante `upsert` por `platform + externalOrderId`, asi que reinyectar pedidos existentes no crea duplicados.

## Objetivo

Crear un workflow temporal de n8n que, con una sola ejecucion manual, cargue todos los pedidos de Shopify desde el `2026-01-01T00:00:00.000Z` en adelante.

El workflow debe paginar automaticamente en bloques de 250 pedidos hasta terminar, guardar cada lote en Review Admin y poder borrarse o desactivarse al finalizar el backfill.

## No Objetivos

- No reemplazar el flujo diario `Shopify - Finanzas Sync`.
- No modificar credenciales de Shopify ni credenciales/base de datos existentes.
- No escribir directamente en Postgres desde n8n.
- No borrar ni truncar pedidos existentes.
- No crear un proceso recurrente permanente.
- No actualizar el cursor del flujo diario en `POST /api/n8n/sync-state`.

## Arquitectura Recomendada

Workflow nuevo: `Shopify - Finanzas Backfill Temporal 2026`.

Patron n8n: `Manual Trigger -> API pagination -> Transform -> HTTP write -> Loop`.

El workflow arranca con `Manual Trigger`, lee la misma configuracion admin que el flujo actual, inicializa estado local con:

- `created_at_min`: `2026-01-01T00:00:00.000Z`
- `since_id`: `0`
- `page`: `1`
- `total_imported`: `0`

Luego ejecuta un loop:

1. Llama a Shopify con `resource: order`, `operation: getAll`, `returnAll: false`, `limit: 250`, `status: any`, `createdAtMin: 2026-01-01T00:00:00.000Z` y `sinceId` actual.
2. Mapea cada pedido al payload que ya acepta `POST /api/n8n/orders`.
3. Agrupa el lote y calcula `max external_order_id` del lote.
4. Envia el lote al endpoint del admin con `X-N8N-Ingest-Token`.
5. Si el lote trae 250 pedidos, actualiza `since_id` al ID maximo y repite.
6. Si el lote trae menos de 250 pedidos, termina y devuelve resumen.

El backfill no debe llamar a `POST /api/n8n/sync-state`, porque no debe mover el cursor incremental usado por el workflow diario.

## Reutilizacion De Conexion

El flujo debe copiar del workflow existente:

- `Leer configuracion admin` con DataTable `Y8KDGv2Ua1UCfz4D`.
- `Aplanar settings` para construir `review_admin_orders_url` y leer `review_admin_ingest_secret`.
- Credencial Shopify OAuth2 `8TnWlcUV4oYH6N4o`, nombre `Shopify account 2`.
- Nodo de mapeo `Mapear pedido a fila`, manteniendo los mismos campos.
- POST al endpoint `POST /api/n8n/orders`.

## Datos Guardados

Cada pedido se transforma con la misma estructura actual:

- `platform`
- `external_order_id`
- `order_number`
- `currency`
- `processed_at`
- `financial_status`
- `fulfillment_status`
- `cancelled_at`
- `is_test`
- `subtotal`
- `total_tax`
- `total_shipping`
- `total_discounts`
- `total_price`
- `total_refunded`
- `total_units`
- `customer_email`
- `country_code`
- `channel`
- `raw_json`
- `external_updated_at`

Review Admin hace el `upsert` en `PlatformOrder`, por lo que un pedido ya existente se actualiza y un pedido faltante se crea.

## Control De Duplicados

No se necesita deduplicacion previa en n8n. La garantia principal vive en la app:

- Tabla `PlatformOrder` tiene `@@unique([platform, externalOrderId])`.
- `upsertPlatformOrders` usa `platform_externalOrderId`.

Esto permite que el backfill sea idempotente: si se ejecuta dos veces, no duplica filas.

## Manejo De Errores

Shopify:

- Mantener `retryOnFail: true`, `maxTries: 5`, `waitBetweenTries: 15000`.
- Si Shopify falla despues de reintentos, el workflow debe fallar para no marcar un backfill incompleto como exitoso.

Review Admin:

- Mantener `retryOnFail: true`, `maxTries: 2`, `waitBetweenTries: 3000` en el POST.
- Si el endpoint devuelve error, el workflow debe detenerse.
- Si el lote viene vacio, no llamar a `POST /api/n8n/orders`; terminar con resumen.

Datos vacios:

- Si Shopify devuelve 0 pedidos en la primera pagina, terminar con resumen `total_imported: 0`.
- Si Shopify devuelve menos de 250 pedidos, considerar que no hay mas paginas.

## Resumen Final

Al finalizar, el workflow debe emitir un unico item con:

- `ok: true`
- `started_at`
- `finished_at`
- `created_at_min`
- `pages_processed`
- `total_imported`
- `last_since_id`

Este resumen sirve para validar la ejecucion antes de borrar o desactivar el flujo temporal.

## Criterios De Aceptacion

- Existe un workflow nuevo y separado del flujo diario.
- Se ejecuta manualmente una sola vez y pagina solo internamente.
- Usa el mismo endpoint y token de Review Admin que el flujo actual.
- Usa la misma credencial Shopify que el flujo actual.
- Trae pedidos desde `2026-01-01T00:00:00.000Z`.
- Respeta el limite de 250 pedidos por llamada.
- Repite automaticamente hasta que Shopify devuelva menos de 250 pedidos.
- No duplica pedidos existentes gracias al `upsert`.
- Entrega un resumen final con paginas e importados.
- Puede desactivarse o borrarse al terminar.

## Supuestos

- Shopify devuelve pedidos ordenados de forma compatible con `sinceId`, como ya usa el flujo actual.
- Los IDs de Shopify son comparables como enteros grandes para calcular `max external_order_id`.
- `POST /api/n8n/orders` soporta lotes de hasta 250 pedidos.
- El backfill se ejecutara cuando sea aceptable consumir API de Shopify durante varios minutos.
