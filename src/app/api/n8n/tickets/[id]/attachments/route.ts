import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import {
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_TOTAL_MAX_BYTES,
  TicketAttachmentError,
  validateAttachmentUpload,
  writeTicketAttachment
} from '@/lib/ticket-attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Skipped = { filename: string; reason: string };
type Accepted = { id: string; filename: string; mimeType: string; sizeBytes: number };

// Called by n8n right after POST /api/n8n/tickets, once per attachment it
// found on the source email. Best-effort per file: one bad attachment is
// reported in `skipped` and never fails the whole call, so a ticket is
// never lost because of one attachment n8n couldn't push cleanly.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const ticket = await db.ticket.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'ticket_not_found' }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const files = form.getAll('file').filter((entry): entry is File => entry instanceof File);
  if (!files.length) {
    return NextResponse.json({ ok: false, error: 'no_files' }, { status: 400 });
  }

  const accepted: Accepted[] = [];
  const skipped: Skipped[] = [];
  let totalBytes = 0;

  for (const file of files) {
    const filename = file.name || 'archivo';

    if (accepted.length >= TICKET_ATTACHMENT_MAX_FILES) {
      skipped.push({ filename, reason: 'too_many_files' });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (totalBytes + buffer.length > TICKET_ATTACHMENT_TOTAL_MAX_BYTES) {
        skipped.push({ filename, reason: 'total_size_exceeded' });
        continue;
      }

      const validated = await validateAttachmentUpload(buffer);
      const written = await writeTicketAttachment(ticket.id, filename, validated);

      const row = await db.ticketAttachment.create({
        data: {
          ticketId: ticket.id,
          direction: 'inbound',
          source: 'webmail',
          filename: written.filename,
          storagePath: written.relativePath,
          mimeType: written.mimeType,
          sizeBytes: written.sizeBytes,
          // Inbound attachments belong to a message that already happened;
          // there is nothing left to "send", so lock them immediately.
          sentAt: new Date()
        }
      });

      totalBytes += buffer.length;
      accepted.push({ id: row.id, filename: row.filename, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
    } catch (err) {
      const reason = err instanceof TicketAttachmentError ? err.code : 'unknown_error';
      skipped.push({ filename, reason });
    }
  }

  return NextResponse.json({ ok: true, attachments: accepted, skipped });
}
