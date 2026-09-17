import { readFile, stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { absolutePathFor, deleteTicketAttachmentFile } from '@/lib/ticket-attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serves an attachment (inbound or outbound). Every admin has equal access
// to every ticket in this app (no roles), so a valid session is the only
// check needed here, same as the forms image route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const attachment = await db.ticketAttachment.findUnique({ where: { id: params.id } });
  if (!attachment) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const absolutePath = absolutePathFor(attachment.storagePath);
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile()) throw new Error('not_a_file');
  } catch {
    return NextResponse.json({ ok: false, error: 'file_missing' }, { status: 404 });
  }

  const data = await readFile(absolutePath);
  const download = new URL(req.url).searchParams.get('download') === '1';
  const disposition = download ? 'attachment' : 'inline';
  const safeName = attachment.filename.replace(/["\r\n]/g, '_');

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Length': String(data.length),
      'Content-Disposition': `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// Removes a staged (not-yet-sent) attachment — the "x" on a composer chip.
// Anything already attached to a sent ticket/thread message is immutable.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const attachment = await db.ticketAttachment.findUnique({ where: { id: params.id } });
  if (!attachment) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (attachment.sentAt) {
    return NextResponse.json({ ok: false, error: 'already_sent' }, { status: 409 });
  }

  await deleteTicketAttachmentFile(attachment.storagePath);
  await db.ticketAttachment.delete({ where: { id: attachment.id } });

  return NextResponse.json({ ok: true });
}

