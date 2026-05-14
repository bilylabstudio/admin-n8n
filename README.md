# Review Admin

Mini admin para revisar respuestas generadas por IA antes de enviarlas al cliente.

## Flujo

1. n8n lee el email del webmail.
2. n8n genera la respuesta sugerida con IA.
3. n8n crea un ticket en `POST /api/n8n/tickets`.
4. Un usuario humano revisa el ticket en el admin.
5. El humano puede aprobar, editar y enviar, descartar o marcar como respuesta manual.
6. Solo en aprobar o editar y enviar, la app llama al webhook de n8n para enviar el email.

## Variables

Copiar `.env.example` y configurar:

```env
DATABASE_URL=
APP_SESSION_SECRET=
N8N_INGEST_SECRET=
N8N_SEND_APPROVED_WEBHOOK_URL=
N8N_SEND_APPROVED_SECRET=
ADMIN_EMAILS=
APP_BASE_URL=
```

`ADMIN_EMAILS` es una lista separada por comas. No hay roles: todos los usuarios creados tienen el mismo acceso.

## Desarrollo local

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed:admin -- --email admin@example.com --password "cambiar-esto"
npm run dev
```

## Deploy en Easypanel

1. Crear una base Postgres.
2. Crear una app desde este directorio usando el `Dockerfile`.
3. Configurar las variables de entorno.
4. Desplegar. El contenedor ejecuta `prisma migrate deploy` antes de iniciar Next.
5. Crear el primer usuario con `npm run seed:admin -- --email ... --password ...` desde la consola del contenedor.

## Contrato n8n

Crear ticket:

```http
POST /api/n8n/tickets
Authorization: Bearer N8N_INGEST_SECRET
Content-Type: application/json
```

Campos principales:

```json
{
  "externalMessageId": "webmail-message-id",
  "customerEmail": "cliente@example.com",
  "subject": "Consulta pedido",
  "originalText": "Email original",
  "aiReply": "Respuesta sugerida",
  "receivedAt": "2026-05-13T12:00:00.000Z",
  "category": "pedido",
  "intent": "consulta",
  "riskFlags": "devolucion",
  "escalationRecommended": true,
  "metadata": {
    "threadId": "opcional"
  }
}
```

Enviar respuesta aprobada:

La app llama `N8N_SEND_APPROVED_WEBHOOK_URL` con:

```json
{
  "ticketId": "...",
  "externalMessageId": "...",
  "customerEmail": "cliente@example.com",
  "subject": "Consulta pedido",
  "reply": "Respuesta final",
  "mode": "approved",
  "approvedBy": "admin@example.com"
}
```

Header:

```http
Authorization: Bearer N8N_SEND_APPROVED_SECRET
```
