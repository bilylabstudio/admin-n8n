import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { ingestTicket, ingestTicketSchema } from '@/lib/tickets';
import { canUpdateFromIngest } from '@/lib/status';

// Regenera el borrador de IA de tickets abiertos desde el inbox (sesion de usuario),
// sin secretos en el navegador y SIN enviar nada al cliente. Misma logica que
// /api/n8n/reprocess (canal 'test' del agente + ingestTicket), pensada para tickets
// que quedaron con "fallback_agent_empty_reply" cuando el agente fallo.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SENTIMENTS = new Set(['molesto', 'neutral', 'contento']);

const schema = z.object({
  ids: z.array(z.string().min(1)).max(50).optional(),
  // Si no hay ids: tickets abiertos con fallback del agente recibidos desde esta fecha.
  fallback_since: z.string().datetime().optional(),
  dry_run: z.boolean().optional().default(false)
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  const { ids, fallback_since, dry_run } = parsed.data;

  const agentUrl = process.env.N8N_SHOPIFY_SUPPORT_WEBHOOK_URL || process.env.N8N_AGENT_WEBHOOK_URL || '';
  const agentHeaderName = process.env.N8N_SHOPIFY_SUPPORT_HEADER_NAME || 'X-Shopify-Support-Secret';
  const agentSecret = process.env.N8N_SHOPIFY_SUPPORT_SECRET || process.env.N8N_AGENT_SECRET || '';
  if (!agentUrl || !agentSecret) {
    return NextResponse.json({ ok: false, error: 'agent_webhook_not_configured' }, { status: 500 });
  }

  const candidates = ids?.length
    ? await db.ticket.findMany({ where: { id: { in: ids } } })
    : await db.ticket.findMany({
        where: {
          riskFlags: { contains: 'fallback_agent_empty_reply' },
          receivedAt: { gte: new Date(fallback_since || Date.now() - 3 * 86_400_000) }
        },
        orderBy: { receivedAt: 'asc' },
        take: 50
      });
  const tickets = candidates.filter((t) => canUpdateFromIngest(t.status));

  const baseUrl = String(process.env.APP_BASE_URL || env.APP_BASE_URL || '').replace(/\/+$/, '');
  const results: Record<string, unknown>[] = [];

  for (const ticket of tickets) {
    let agentResp: Record<string, unknown> = {};
    try {
      const res = await fetch(agentUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [agentHeaderName]: agentSecret },
        body: JSON.stringify({
          session_id: 'reprocess-' + ticket.externalMessageId,
          message: ticket.originalText,
          email: ticket.customerEmail,
          order_number: '',
          channel: 'test',
          page_context: 'email_support',
          review_admin_base_url: baseUrl,
          review_admin_ingest_secret: env.N8N_INGEST_SECRET,
          email_metadata: {
            subject: ticket.subject,
            from_name: ticket.customerName || '',
            from_email: ticket.customerEmail,
            message_id: ticket.externalMessageId,
            received_at: ticket.receivedAt.toISOString()
          }
        })
      });
      agentResp = ((await res.json().catch(() => ({}))) as Record<string, unknown>) || {};
    } catch {
      results.push({ id: ticket.id, ok: false, error: 'agent_call_failed' });
      continue;
    }

    const reply = String(agentResp.reply || '').trim();
    const riskFlags = String(agentResp.risk_flags || '');
    if (!reply || riskFlags.includes('fallback_agent_empty_reply')) {
      results.push({ id: ticket.id, ok: false, error: 'agent_empty_reply' });
      continue;
    }
    if (dry_run) {
      results.push({ id: ticket.id, ok: true, dry_run: true, reply_preview: reply.slice(0, 120), category: agentResp.category });
      continue;
    }

    const sentimentRaw = String(agentResp.sentiment || '');
    const updated = await ingestTicket(
      ingestTicketSchema.parse({
        external_message_id: ticket.externalMessageId,
        customer_email: ticket.customerEmail,
        customer_name: ticket.customerName || '',
        subject: ticket.subject,
        received_at: ticket.receivedAt.toISOString(),
        original_text: ticket.originalText,
        ai_reply: reply,
        category: String(agentResp.category || ''),
        intent: String(agentResp.intent || ''),
        risk_flags: riskFlags,
        escalation_recommended: Boolean(agentResp.escalation_recommended),
        confidence_label: String(agentResp.confidence_label || ''),
        routed_template_id: String(agentResp.routed_template_id || ''),
        route_source: String(agentResp.route_source || ''),
        sentiment: SENTIMENTS.has(sentimentRaw) ? sentimentRaw : null,
        requires_review: Boolean(agentResp.requires_review),
        case_reasoning: agentResp.case_reasoning,
        critic: agentResp.critic ?? agentResp.safety_review,
        source: ticket.source,
        message_id: ticket.messageId || '',
        in_reply_to: ticket.inReplyTo || '',
        references: ticket.references || '',
        imap_uid: ticket.imapUid || '',
        imap_mailbox: ticket.imapMailbox || ''
      })
    );
    results.push({ id: ticket.id, ok: updated.aiReply === reply, status: updated.status, category: updated.category });
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    processed: results.length,
    updated: results.filter((r) => r.ok && !r.dry_run).length,
    results
  });
}
