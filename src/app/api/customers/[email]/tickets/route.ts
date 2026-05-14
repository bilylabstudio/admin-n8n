import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { email: string } }
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const email = decodeURIComponent(params.email);

  const tickets = await db.ticket.findMany({
    where: { customerEmail: email },
    orderBy: { receivedAt: 'asc' },
    include: {
      auditEvents: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { email: true } } }
      }
    }
  });

  return NextResponse.json({
    ok: true,
    tickets: tickets.map((t) => ({
      id: t.id,
      customerEmail: t.customerEmail,
      customerName: t.customerName,
      subject: t.subject,
      receivedAt: t.receivedAt.toISOString(),
      originalText: t.originalText,
      aiReply: t.aiReply,
      finalReply: t.finalReply,
      category: t.category,
      intent: t.intent,
      riskFlags: t.riskFlags,
      escalationRecommended: t.escalationRecommended,
      status: t.status,
      sendError: t.sendError,
      updatedAt: t.updatedAt.toISOString(),
      auditEvents: t.auditEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        beforeStatus: e.beforeStatus,
        afterStatus: e.afterStatus,
        createdAt: e.createdAt.toISOString(),
        userEmail: e.user?.email || null
      }))
    }))
  });
}
