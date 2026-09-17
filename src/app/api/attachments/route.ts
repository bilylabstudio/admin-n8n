import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  assertBatchWithinLimits,
  assertOwnerIdSafe,
  TicketAttachmentError,
  validateAttachmentUpload,
  writeTicketAttachment,
  type ValidatedAttachment
} from '@/lib/ticket-attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stages one attachment before it is sent: the admin composer uploads a
// file the moment it's picked, gets an id back, and the send routes later
// just reference that id (see /api/tickets/[id]/send and
// /api/customers/[email]/thread/send). Not yet linked to a sent message,
// so `sentAt` stays null until the send succeeds.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const ticketId = String(form.get('ticket_id') || '').trim() || null;
  const threadMessageId = String(form.get('thread_message_id') || '').trim() || null;
  const file = form.get('file');

  if (Boolean(ticketId) === Boolean(threadMessageId)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_owner', message: 'Provide exactly one of ticket_id or thread_message_id.' },
      { status: 400 }
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'missing_file' }, { status: 400 });
  }

  const ownerId = (ticketId || threadMessageId) as string;
  try {
    assertOwnerIdSafe(ownerId);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_owner_id' }, { status: 400 });
  }

  if (ticketId) {
    const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!ticket) return NextResponse.json({ ok: false, error: 'ticket_not_found' }, { status: 404 });
  } else {
    const threadMessage = await db.threadMessage.findUnique({
      where: { id: threadMessageId as string },
      select: { id: true }
    });
    if (!threadMessage) {
      return NextResponse.json({ ok: false, error: 'thread_message_not_found' }, { status: 404 });
    }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const validated = await validateAttachmentUpload(buffer);

    const staged = await db.ticketAttachment.findMany({
      where: {
        sentAt: null,
        ...(ticketId ? { ticketId } : { threadMessageId })
      },
      select: { sizeBytes: true }
    });
    const batchForLimitCheck: ValidatedAttachment[] = [
      ...staged.map((row) => ({ buffer: Buffer.alloc(0), mimeType: '', ext: '', sizeBytes: row.sizeBytes })),
      validated
    ];
    assertBatchWithinLimits(batchForLimitCheck);

    const written = await writeTicketAttachment(ownerId, file.name || 'archivo', validated);

    const row = await db.ticketAttachment.create({
      data: {
        ticketId,
        threadMessageId,
        direction: 'outbound',
        source: 'admin',
        filename: written.filename,
        storagePath: written.relativePath,
        mimeType: written.mimeType,
        sizeBytes: written.sizeBytes,
        uploadedByUserId: user.id,
        sentAt: null
      }
    });

    return NextResponse.json({
      ok: true,
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes
    });
  } catch (err) {
    if (err instanceof TicketAttachmentError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    throw err;
  }
}

