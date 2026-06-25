import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getTicketTags } from '@/lib/ticket-tags';
import { routeSourceLabel, templateLabelFor } from '@/lib/template-labels';

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
      routedTemplateId: t.routedTemplateId,
      routeSource: t.routeSource,
      templateLabel: t.routedTemplateId ? templateLabelFor(t.routedTemplateId) : null,
      routeSourceLabel: t.routeSource ? routeSourceLabel(t.routeSource) : null,
      category: t.category,
      intent: t.intent,
      riskFlags: t.riskFlags,
      tags: getTicketTags(t),
      escalationRecommended: t.escalationRecommended,
      status: t.status,
      sendError: t.sendError,
      imapUid: t.imapUid,
      imapMailbox: t.imapMailbox,
      seenSyncedAt: t.seenSyncedAt?.toISOString() || null,
      answeredSyncedAt: t.answeredSyncedAt?.toISOString() || null,
      sentFolderSyncedAt: t.sentFolderSyncedAt?.toISOString() || null,
      webmailSyncError: t.webmailSyncError,
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
