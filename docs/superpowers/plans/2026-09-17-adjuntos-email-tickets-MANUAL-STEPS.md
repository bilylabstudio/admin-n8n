# Adjuntos de Email en Tickets — Pasos manuales (fuera de este repo / no automatizables por Claude)

Companion del spec (`2026-09-17-adjuntos-email-tickets-design.md`) y el plan (`2026-09-17-adjuntos-email-tickets.md`) en esta misma carpeta `docs/superpowers/`. Esto es la checklist de lo que un humano tiene que hacer; el código en sí lo implementa Claude directamente en el repo.

## 1. Revisión y publicación del código

- [ ] Revisar el diff (`git status` / `git diff`) de los cambios antes de confiar en ellos.
- [ ] Hacer commit y push a GitHub (Claude no toca el remoto sin que se le pida explícitamente).
- [ ] Ejecutar `npm install` y `npm test` en un entorno con acceso normal a internet — el sandbox donde se escribió el código no tiene acceso al registro de npm, así que la suite de tests nueva (`ticket-attachments.test.ts`, y las extensiones a `webmail-sync.test.ts` / `thread-messages.test.ts`) no se pudo ejecutar desde ahí.

## 2. Infraestructura (Easypanel)

- [ ] Añadir variables de entorno al servicio:
  ```
  TICKET_ATTACHMENTS_ROOT=/data/ticket-attachments
  TICKET_ATTACHMENT_MAX_BYTES=10485760
  TICKET_ATTACHMENT_MAX_FILES=5
  TICKET_ATTACHMENT_TOTAL_MAX_BYTES=26214400
  ```
- [ ] Crear un volumen para `/data/ticket-attachments` y **marcarlo como persistente explícitamente** en el panel del servicio (mismo caveat que `FORM_UPLOADS_ROOT` en el README: si no, se pierde todo al redeployar).
- [ ] La migración de Prisma se aplica sola en el deploy normal (el Dockerfile ya corre `prisma migrate deploy` antes de arrancar Next). Para aplicarla a mano antes: `npm run prisma:migrate` desde la consola del contenedor.

## 3. n8n — workflow de ENTRADA (lee el correo, crea el ticket)

Aditivo: si no se toca, el ticket se sigue creando igual, solo que sin adjuntos.

1. Abrir el workflow que hoy hace `POST {APP_BASE_URL}/api/n8n/tickets`.
2. Confirmar que el nodo de lectura de correo (IMAP/Email Trigger) está configurado para descargar los adjuntos como propiedades binarias.
3. Justo después de crear el ticket (la respuesta trae `ticket_id`), añadir un bucle sobre los adjuntos del email y, por cada uno, un nodo **HTTP Request**:
   - `POST {APP_BASE_URL}/api/n8n/tickets/{{ $json.ticket_id }}/attachments`
   - Header `X-N8N-Ingest-Token: {{ N8N_INGEST_SECRET }}` (mismo secreto que ya se usa para crear tickets)
   - Body `multipart/form-data`, campo `file` = binario del adjunto.

## 4. n8n — workflow de SALIDA (envía la respuesta aprobada)

1. Abrir el workflow que escucha en `N8N_SEND_APPROVED_WEBHOOK_URL`.
2. El payload entrante puede traer ahora `attachments`: `[{ filename, mime_type, content_base64 }]`.
3. Antes de enviar el email de verdad, añadir un nodo Code/Function que decodifique cada `content_base64` (`Buffer.from(item.content_base64, 'base64')`) y lo adjunte de verdad al nodo de envío.
4. En la respuesta que este workflow devuelve a la app, añadir `sent_message.attachments`: `[{ filename, mime_type, size_bytes }]` con lo realmente adjuntado, para que la copia en "Enviados" sea fiel.
5. Si esto no se hace todavía: no rompe nada, el envío de texto sigue funcionando igual — simplemente los adjuntos salientes no llegan al cliente hasta que se actualice este workflow.

## 5. Prueba manual de extremo a extremo

- [ ] Enviar un correo de prueba con un adjunto pequeño (PDF o imagen) al buzón de soporte.
- [ ] Comprobar en el panel que el ticket muestra el adjunto y que se puede ver/descargar.
- [ ] Aprobar una respuesta adjuntando un archivo desde el panel y comprobar que llega con el adjunto real.

