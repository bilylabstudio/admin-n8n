# Review Admin Perfil Por Ticket Con Pedidos - Diseno MVP

Fecha: 2026-06-05

## Objetivo

Agregar informacion de cliente en cada mensaje/ticket sin saturar el chat: mostrar nombre, correo y un contador compacto de pedidos encontrados por email. Al pasar el mouse o enfocar el texto de pedidos, el usuario ve un tooltip con los datos principales de los ultimos pedidos.

La fuente de pedidos sera la tabla local `PlatformOrder`, ya alimentada por el workflow de sincronizacion de Shopify. No se consultara Shopify en vivo al abrir tickets.

## Alcance

Incluido:

- Buscar pedidos por `customerEmail` usando el email del ticket o hilo.
- Mostrar en la cabecera de cada burbuja entrante:
  - nombre del cliente o `Cliente`
  - email del cliente
  - `N pedidos encontrados` cuando existan pedidos asociados
- Mostrar tooltip sobre el texto de pedidos encontrados.
- Incluir en el tooltip hasta 5 pedidos recientes.
- Mostrar por pedido: numero, fecha, total, estado de pago y estado de envio.
- No mostrar nada extra si no hay pedidos.
- Mantener el chat legible y sin paneles adicionales.

Fuera de alcance:

- Consultar Shopify en vivo desde el ticket.
- Crear una entidad nueva de cliente.
- Editar pedidos desde el Review Admin.
- Cambiar el workflow de sincronizacion de Shopify.
- Cambiar envio de emails, estados del ticket o acciones de aprobar/rechazar.
- Mostrar todo el historial completo si hay muchos pedidos.

## Fuente De Datos

Los tickets ya tienen:

- `Ticket.customerEmail`
- `Ticket.customerName`

Los pedidos sincronizados ya tienen:

- `PlatformOrder.customerEmail`
- `PlatformOrder.orderNumber`
- `PlatformOrder.externalOrderId`
- `PlatformOrder.processedAt`
- `PlatformOrder.totalPrice`
- `PlatformOrder.currency`
- `PlatformOrder.financialStatus`
- `PlatformOrder.fulfillmentStatus`
- `PlatformOrder.cancelledAt`

El cruce inicial sera por email. La consulta debe tolerar mayusculas/minusculas y emails vacios. Si el pedido no tiene `orderNumber`, se usara `externalOrderId` como fallback visual.

## Arquitectura

Crear un helper de lectura en el Review Admin, por ejemplo:

`src/lib/customer-profile.ts`

Responsabilidades:

- Normalizar el email recibido.
- Consultar pedidos recientes del cliente en `PlatformOrder`.
- Devolver un objeto listo para la UI:

```ts
type CustomerOrderSummary = {
  id: string;
  platform: string;
  orderNumber: string;
  processedAt: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
};

type CustomerProfile = {
  email: string;
  orderCount: number;
  recentOrders: CustomerOrderSummary[];
};
```

La consulta principal ordenara por `processedAt desc` y limitara `recentOrders` a 5. El contador puede calcularse con `count` para mostrar el total real asociado al email.

Si la tabla de pedidos crece, conviene agregar indice por email y fecha:

`@@index([customerEmail, processedAt])`

## API

Extender el endpoint de hilo:

`GET /api/customers/[email]/thread`

Respuesta nueva:

```json
{
  "customerProfile": {
    "email": "cliente@email.com",
    "orderCount": 3,
    "recentOrders": []
  }
}
```

La UI de conversacion ya carga este endpoint al seleccionar un ticket, asi que no hace falta cargar pedidos para toda la bandeja. Esto mantiene el coste bajo y evita hacer consultas por los 100 tickets visibles.

Para la pagina individual de ticket:

`src/app/tickets/[id]/page.tsx`

puede reutilizar el mismo helper y renderizar el mismo resumen compacto si esa vista sigue en uso.

## UI

En la cabecera de cada burbuja entrante, reemplazar el texto actual por un formato compacto:

`Lola Garcia - lola@email.com - 3 pedidos encontrados`

Reglas:

- El contador solo aparece si `orderCount > 0`.
- El texto `N pedidos encontrados` sera el elemento con tooltip.
- El tooltip aparece en hover y focus.
- En movil, el mismo elemento debe poder abrirse por tap/focus.
- El tooltip no debe cambiar el tamano de la burbuja ni empujar mensajes.
- El tooltip debe tener ancho maximo y hacer wrap para no romper layouts estrechos.

Contenido del tooltip por pedido:

`#27215069513 - 02/06/2026 - 49,90 EUR - pagado - enviado`

Formato:

- Usar fecha `es-ES`.
- Usar moneda con `Intl.NumberFormat`.
- Traducir estados comunes cuando sea sencillo:
  - `paid` -> `pagado`
  - `pending` -> `pendiente`
  - `refunded` -> `reembolsado`
  - `fulfilled` -> `enviado`
  - `partial` -> `parcial`
  - null/vacio -> `sin envio`
- Si `cancelledAt` existe, marcar el pedido como `cancelado`.

## Manejo De Errores

- Si el email del ticket esta vacio o no es valido, no se muestra contador.
- Si no hay pedidos, no se muestra texto extra.
- Si falla la consulta de pedidos, la conversacion debe seguir cargando sin perfil de pedidos.
- El tooltip nunca debe bloquear envio, rechazo ni seguimiento.
- No se debe exponer informacion sensible ni secretos.

## Testing

Tests unitarios recomendados:

- Helper devuelve `orderCount = 0` cuando no hay email.
- Helper devuelve contador total y maximo 5 pedidos recientes.
- Helper usa `orderNumber` y cae a `externalOrderId` cuando falta.
- Formateo de estados cubre pago, envio, cancelado y valores vacios.
- API de hilo incluye `customerProfile` sin cambiar mensajes existentes.

Validacion manual:

- Abrir un ticket con pedidos por email.
- Confirmar que la burbuja muestra `N pedidos encontrados`.
- Pasar el mouse por el texto y ver los pedidos.
- Confirmar que un cliente sin pedidos no muestra texto extra.
- Confirmar que el chat no queda mas alto ni saturado visualmente.
- Probar ancho movil o viewport estrecho.

## Criterios De Aceptacion

- Cada burbuja entrante del hilo puede mostrar pedidos asociados al email del cliente.
- El texto visible es compacto y no ocupa espacio adicional relevante.
- El tooltip muestra hasta 5 pedidos con numero, fecha, total, pago y envio.
- No se consulta Shopify en vivo al abrir tickets.
- Si no hay pedidos, la UI queda igual que antes.
- La carga del hilo no se rompe si la informacion de pedidos no esta disponible.

## Rollback

Rollback simple:

- Revertir helper/API/UI/CSS.
- Si se agrega indice de Prisma, revertir la migracion asociada.
- No hay cambios en n8n, Shopify, credenciales ni envio de correos.

## Revision De La Spec

- La feature esta acotada al Review Admin.
- La fuente de datos es local y ya sincronizada.
- El diseno mantiene el chat limpio.
- El tooltip evita paneles nuevos y reduce saturacion.
- No hay dependencias nuevas ni secretos.
