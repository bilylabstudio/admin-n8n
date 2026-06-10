import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { buildSentExportPayload, SENT_EXPORT_STATUSES } from '../../../../../lib/sent-export';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const tickets = await db.ticket.findMany({
      where: { status: { in: [...SENT_EXPORT_STATUSES] } },
      orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        subject: true,
        receivedAt: true,
        sentAt: true,
        status: true,
        originalText: true,
        aiReply: true,
        finalReply: true,
        updatedAt: true
      }
    });

    return NextResponse.json(buildSentExportPayload(tickets));
  } catch {
    return NextResponse.json(
      { ok: false, error: 'No se pudo exportar el historico de enviados.' },
      { status: 500 }
    );
  }
}
