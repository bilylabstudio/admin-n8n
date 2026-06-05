# Review Admin Fallback Por Numero De Pedido - Diseno MVP

Fecha: 2026-06-05

## Objetivo

Mejorar el perfil compacto de pedidos en el hilo de soporte para encontrar pedidos aunque el email del ticket no coincida con `PlatformOrder.customerEmail`.

La mejora usara el numero de pedido escrito por el cliente en el asunto o mensaje, por ejemplo `#45405`, `pedido 45405` u `orden 45405`, y lo cruzara contra pedidos sincronizados localmente.

## Problema Actual

La primera version del perfil de ticket busca solo por email:

`Ticket.customerEmail -> PlatformOrder.customerEmail`

Eso falla cuando:

- El cliente escribe desde un correo diferente al correo de compra.
- Shopify sincronizo el pedido con otro email.
- El email de compra esta vacio o no coincide exactamente.
- El cliente menciona el numero de pedido en el mensaje, pero el sistema no lo usa como pista.

## Alcance

Incluido:

- Extraer candidatos de numero de pedido desde `subject` y `originalText` de tickets recientes.
- Buscar pedidos por email como hasta ahora.
- Buscar tambien por numero contra:
  - `PlatformOrder.orderNumber`
  - `PlatformOrder.externalOrderId`
- Incluir pedidos encontrados por numero aunque el email sea distinto.
- Unir resultados sin duplicados.
- Mantener la misma UI actual: `N pedidos encontrados` y tooltip.

Fuera de alcance:

- Consultar Shopify en vivo.
- Buscar cualquier numero suelto sin contexto.
- Crear matching manual desde la UI.
- Crear una tabla persistente de relaciones ticket-pedido.
- Cambiar el texto visual de la burbuja.
- Mostrar datos sensibles adicionales del pedido.

## Reglas De Extraccion

La extraccion debe ser conservadora para evitar falsos positivos con codigos postales, direcciones o telefonos.

Se aceptan candidatos si aparecen:

- Con prefijo `#`, por ejemplo `#45405`.
- Cerca de palabras de pedido:
  - `pedido`
  - `orden`
  - `order`
  - `compra`
  - `subscription`
  - `suscripcion`

No se deben extraer todos los numeros del mensaje. Por ejemplo, en:

`Calle Valle de Zuriza numero 20, 3B, 50015 Zaragoza`

no deben considerarse `20`, `3` ni `50015` como pedidos si no estan cerca de una palabra de pedido ni llevan `#`.

Los candidatos deben normalizarse en variantes:

- Numero sin espacios ni puntuacion irrelevante: `45405`
- Variante con `#`: `#45405`

## Arquitectura

Extender el helper existente:

`src/lib/customer-profile.ts`

Nuevas responsabilidades:

- Aceptar textos opcionales del hilo/ticket.
- Extraer numeros de pedido desde esos textos.
- Buscar pedidos por email y por numero en paralelo.
- Deduplicar por `PlatformOrder.id`.
- Mantener `recentOrders` limitado a 5.
- Mantener `orderCount` como el total deduplicado de pedidos encontrados por email o numero.

Firma propuesta:

```ts
type CustomerProfileLookupInput = {
  email: string | null | undefined;
  texts?: Array<string | null | undefined>;
};

getCustomerProfile(input: CustomerProfileLookupInput): Promise<CustomerProfile>
```

La funcion anterior `getCustomerProfileByEmail(email)` puede mantenerse como wrapper para compatibilidad interna.

## API

Actualizar:

`GET /api/customers/[email]/thread`

El endpoint ya carga tickets recientes antes de responder. Debe pasar al helper textos derivados de:

- `selectedTicket.subject`
- `selectedTicket.originalText`
- `recentTickets[].subject`
- `recentTickets[].originalText`

La respuesta sigue usando la misma propiedad:

```json
{
  "customerProfile": {
    "email": "cliente@email.com",
    "orderCount": 1,
    "recentOrders": []
  }
}
```

No cambia el contrato visual para la UI.

## Busqueda En Base De Datos

La busqueda debe combinar dos caminos:

1. Por email:
   - `customerEmail equals email`, case-insensitive.

2. Por numero:
   - `orderNumber in [raw, #raw]`
   - `externalOrderId in [raw]`

Si no hay candidatos de numero, no se ejecuta la busqueda por numero.

Si el mismo pedido aparece por email y por numero, debe mostrarse una sola vez.

Orden recomendado:

1. Pedidos encontrados por numero escrito en el ticket.
2. Pedidos encontrados por email.
3. Dentro de cada grupo, `processedAt desc`.

Esto prioriza la intencion explicita del cliente.

## UI

No cambia la UI.

La burbuja seguira mostrando:

`Cliente - email - fecha - N pedidos encontrados`

Y el tooltip seguira mostrando hasta 5 pedidos con:

- numero
- fecha
- total
- estado de pago
- estado de envio

## Manejo De Errores

- Si la extraccion no encuentra candidatos, se usa solo email.
- Si falla la busqueda por numero, el perfil debe seguir funcionando con email.
- Si falla toda la busqueda, devolver perfil vacio como ahora.
- No bloquear el hilo, el editor ni el envio.

## Testing

Tests unitarios en:

`src/lib/customer-profile.test.ts`

Casos minimos:

- Extrae `#45405` desde texto.
- Extrae `pedido 45405` y `orden 45405`.
- No extrae codigos postales o numeros de direccion sin contexto.
- Busca por `orderNumber` con `45405` y `#45405`.
- Busca por `externalOrderId` con el numero sin `#`.
- Incluye pedido encontrado por numero aunque el email sea distinto.
- Deduplica pedidos encontrados por email y numero.
- Mantiene maximo 5 `recentOrders`.
- Mantiene perfil vacio si no hay email ni numeros.

## Criterios De Aceptacion

- Tickets donde el cliente escribe `#45405` muestran el pedido aunque el email no coincida.
- Tickets sin numero de pedido siguen funcionando como ahora por email.
- No aparecen pedidos por codigos postales, direcciones o telefonos sueltos.
- La UI no cambia y sigue siendo compacta.
- Los tests cubren extraccion, busqueda y deduplicacion.
- No se consulta Shopify en vivo.

## Rollback

Rollback simple:

- Revertir cambios del helper y endpoint.
- No hay migracion obligatoria.
- No hay cambios en n8n ni Shopify.

## Revision De La Spec

- La mejora esta acotada al Review Admin.
- La causa raiz esta cubierta: email distinto al email de compra.
- El fallback usa solo datos locales ya sincronizados.
- La extraccion evita busquedas demasiado agresivas.
- La UI existente se conserva.
