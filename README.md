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
N8N_FORMS_MINT_SECRET=
ADMIN_EMAILS=
APP_BASE_URL=

# Formularios / uploads (opcionales con defaults)
FORM_UPLOADS_ROOT=/data/form-uploads
FORM_UPLOAD_MAX_BYTES=5242880
FORM_UPLOAD_MAX_FILES=3
```

`ADMIN_EMAILS` es una lista separada por comas. No hay roles: todos los usuarios creados tienen el mismo acceso.

`N8N_FORMS_MINT_SECRET` es el secreto compartido con n8n para mintear tokens de formulario. Debe coincidir con la variable `FORMS_MINT_SECRET` en el servicio de n8n (Easypanel). Si está vacío, el endpoint `mint-token` devuelve `503` y el bot cae al link legacy.

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

## Formularios (devolución v1)

Sección de formularios cliente → admin para gestión de devoluciones.

**Flujo:**
1. El bot Susana detecta caso de devolución/reembolso y llama `POST /api/forms/devolucion/mint-token` para obtener una URL única.
2. La URL se embebe en la reply al cliente: `https://<APP_BASE_URL>/forms/devolucion/<token>`.
3. El cliente abre el link, rellena el formulario y sube hasta 3 fotos (5 MB c/u).
4. Recibe email automático de confirmación (template `form_devolucion_recibida`).
5. El admin revisa en la pestaña Formularios y aprueba/rechaza/manual/descarta.
6. Aprobar o rechazar envía respuesta automática al cliente via `send-approved-reply` con `template_type` apropiado.

**Volumen persistente:** las imágenes viven en `FORM_UPLOADS_ROOT` (default `/data/form-uploads`). En Easypanel hay que **marcar el volumen como persistente** explícitamente en el panel del servicio; si no, se pierden las imágenes al redeployar.

**Cleanup:** los tokens sin enviar (status `pending`) expiran a los 30 días. Para limpiar la BD de los expirados (con 7 días de gracia adicionales):

```bash
npm run cleanup:expired-forms
```

Recomendado correrlo via cron de Easypanel (semanal). Los formularios ya enviados (`submitted`, `approved_sent`, etc.) se preservan indefinidamente por auditoría.

**Endpoints internos:**

- `POST /api/forms/devolucion/mint-token` — n8n only, validado con `X-Review-Admin-Token: <N8N_FORMS_MINT_SECRET>`. Devuelve `{ url, token, form_id, expires_at, reused }`. Idempotente por `ticket_id`.
- `POST /api/forms/devolucion/<token>/submit` — público. `multipart/form-data` con `orderNumber`, `purchaseEmail`, `reason`, `files`. Rate-limited: 5 por token/hora, 30 por IP/hora.
- `GET /api/forms[?status=submitted|approved_sent|...]` — admin only. Lista paginada con counts.
- `GET /api/forms/<id>?renderTemplate=<key>` — admin only. Detalle + plantilla renderizada opcional.
- `POST /api/forms/<id>/{approve|reject|manual|discard}` — admin only. `multipart/form-data` con `final_reply` (requerido para approve/reject) y opcional `review_notes`.
- `GET /api/forms/<id>/images/<imageId>` — admin O `?t=<token>`. Stream binario.
