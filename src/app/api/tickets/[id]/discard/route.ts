import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirectToApp } from '@/lib/redirects';
import { canReview } from '@/lib/status';
import { markSeen } from '@/lib/webmail-sync';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({ where: { id: params.id } });

  if (!ticket || !canReview(ticket.status)) {
    return redirectToApp(`/tickets/${params.id}?error=not_reviewable`);
  }

  const seenSync = ticket.seenSyncedAt
    ? { ok: true, skipped: true, action: 'seen' as const, message: 'already_seen_synced' }
    : await markSeen({ uid: ticket.imapUid, mailbox: ticket.imapMailbox });
  const syncNow = new Date();

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: 'discarded',
      ...(seenSync.ok && !seenSync.skipped
        ? { seenSyncedAt: syncNow, webmailSyncError: null }
        : {}),
      ...(!seenSync.ok ? { webmailSyncError: seenSync.message || 'webmail_seen_failed' } : {})
    }
  });
  await db.auditEvent.create({
    data: {
      ticketId: ticket.id,
      userId: user.id,
      eventType: 'discarded',
      beforeStatus: ticket.status,
      afterStatus: 'discarded',
      metadataJson: {
        webmail_sync: {
          seen: seenSync
        }
      }
    }
  });

  return redirectToApp(`/tickets/${ticket.id}`);
}
