import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { inboxGroups, isInboxGroup, statusesForGroup } from '@/lib/status';
import { getTicketTags } from '@/lib/ticket-tags';
import { routeSourceLabel, templateLabelFor } from '@/lib/template-labels';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 150;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedGroup = url.searchParams.get('status') || 'pending_review';
  const group = isInboxGroup(requestedGroup) ? requestedGroup : 'pending_review';
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = clampLimit(Number(url.searchParams.get('limit') || DEFAULT_LIMIT));
  const statuses = statusesForGroup(group);
  const searchWhere: Prisma.TicketWhereInput = q
    ? {
        OR: [
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } }
        ]
      }
    : {};

  const where: Prisma.TicketWhereInput = {
    status: { in: statuses },
    ...searchWhere
  };

  const [tickets, counts] = await Promise.all([
    db.ticket.findMany({
      where,
      orderBy: { receivedAt: 'asc' },
      take: limit,
      include: {
        auditEvents: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            user: {
              select: { email: true }
            }
          }
        }
      }
    }),
    Promise.all(
      inboxGroups.map(async (item) => {
        const count = await db.ticket.count({
          where: {
            status: { in: item.statuses },
            ...searchWhere
          }
        });
        return [item.id, count] as const;
      })
    )
  ]);

  return NextResponse.json({
    ok: true,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      externalMessageId: ticket.externalMessageId,
      customerEmail: ticket.customerEmail,
      customerName: ticket.customerName,
      subject: ticket.subject,
      receivedAt: ticket.receivedAt.toISOString(),
      source: ticket.source,
      originalText: ticket.originalText,
      aiReply: ticket.aiReply,
      finalReply: ticket.finalReply,
      routedTemplateId: ticket.routedTemplateId,
      routeSource: ticket.routeSource,
      templateLabel: ticket.routedTemplateId ? templateLabelFor(ticket.routedTemplateId) : null,
      routeSourceLabel: ticket.routeSource ? routeSourceLabel(ticket.routeSource) : null,
      category: ticket.category,
      intent: ticket.intent,
      riskFlags: ticket.riskFlags,
      tags: getTicketTags(ticket),
      escalationRecommended: ticket.escalationRecommended,
      aiConfidence: ticket.aiConfidence,
      confidenceLabel: ticket.confidenceLabel,
      requiresReview: ticket.requiresReview,
      caseReasoning: ticket.caseReasoningJson,
      critic: ticket.criticJson,
      status: ticket.status,
      sendError: ticket.sendError,
      sentAt: ticket.sentAt?.toISOString() || null,
      imapUid: ticket.imapUid,
      imapMailbox: ticket.imapMailbox,
      seenSyncedAt: ticket.seenSyncedAt?.toISOString() || null,
      answeredSyncedAt: ticket.answeredSyncedAt?.toISOString() || null,
      sentFolderSyncedAt: ticket.sentFolderSyncedAt?.toISOString() || null,
      webmailSyncError: ticket.webmailSyncError,
      updatedAt: ticket.updatedAt.toISOString(),
      auditEvents: ticket.auditEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        beforeStatus: event.beforeStatus,
        afterStatus: event.afterStatus,
        createdAt: event.createdAt.toISOString(),
        userEmail: event.user?.email || null
      }))
    })),
    counts: Object.fromEntries(counts),
    selectedTicketId: tickets[0]?.id || null,
    serverTime: new Date().toISOString()
  });
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}
