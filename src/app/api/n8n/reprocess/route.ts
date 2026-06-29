import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { ingestTicket, ingestTicketSchema } from '@/lib/tickets';

// Re-procesa tickets EXISTENTES por el flujo del agente y actualiza su borrador +
// etiqueta (routed_template_id / route_source), sin duplicar (clave
// external_message_id) y SIN enviar nada al cliente (el envio es un paso humano
// aparte). Llama al webhook del agente en canal 'test' (que NO ingesta ni envia,
// solo devuelve reply + ruteo) y reusa ingestTicket() para el upsert.
//
// Solo actualiza tickets en estado no-terminal (ingestTicket respeta
// canUpdateFromIngest: los ya enviados/descartados/manual se devuelven intactos).

const SENTIMENTS = new Set(['molesto', 'neutral', 'contento']);

const reprocessSchema = z
  .object({
    external_message_id: z.string().min(1).optional(),
    email: z.string().email().optional(),
    limit: z.number().int().min(1).max(20).optional().default(1),
    dry_run: z.boolean().optional().default(false)
  })
  .refine((v) => v.external_message_id || v.email, {
    message: 'external_message_id o email es obligatorio'
  });

export async function POST(request: Request) {
  const token = request.headers.get('x-n8n-ingest-token') || '';
  if (token !== env.N8N_INGEST_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reprocessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { external_message_id, email, limit, dry_run } = parsed.data;

  const agentUrl =
    process.env.N8N_SHOPIFY_SUPPORT_WEBHOOK_URL || process.env.N8N_AGENT_WEBHOOK_URL || '';
  const agentHeaderName =
    process.env.N8N_SHOPIFY_SUPPORT_HEADER_NAME || 'X-Shopify-Support-Secret';
  const agentSecret =
    process.env.N8N_SHOPIFY_SUPPORT_SECRET || process.env.N8N_AGENT_SECRET || '';
  if (!agentUrl || !agentSecret) {
    return NextResponse.json(
      { ok: false, error: 'agent_webhook_not_configured' },
      { status: 500 }
    );
  }

  const tickets = external_message_id
    ? await db.ticket
        .findUnique({ where: { externalMessageId: external_message_id } })
        .then((t) => (t ? [t] : []))
    : await db.ticket.findMany({
        where: { customerEmail: { equals: email as string, mode: 'insensitive' } },
        orderBy: { receivedAt: 'desc' },
        take: limit
      });

  if (!tickets.length) {
    return NextResponse.json({ ok: false, error: 'no_ticket_found' }, { status: 404 });
  }

  const baseUrl = String(process.env.APP_BASE_URL || env.APP_BASE_URL || '').replace(/\/+$/, '');
  const results: unknown[] = [];

  for (const ticket of tickets) {
    const before = { routedTemplateId: ticket.routedTemplateId, routeSource: ticket.routeSource };

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
      results.push({ external_message_id: ticket.externalMessageId, ok: false, error: 'agent_call_failed' });
      continue;
    }

    const reply = String(agentResp.reply || '');
    const after = {
      routed_template_id: String(agentResp.routed_template_id || ''),
      route_source: String(agentResp.route_source || ''),
      reply_preview: reply.slice(0, 100)
    };

    if (dry_run) {
      results.push({ external_message_id: ticket.externalMessageId, ok: true, dry_run: true, before, after });
      continue;
    }

    const sentimentRaw = String(agentResp.sentiment || '');
    const ingestInput = ingestTicketSchema.parse({
      external_message_id: ticket.externalMessageId,
      customer_email: ticket.customerEmail,
      customer_name: ticket.customerName || '',
      subject: ticket.subject,
      received_at: ticket.receivedAt.toISOString(),
      original_text: ticket.originalText,
      ai_reply: reply,
      category: String(agentResp.category || ''),
      intent: String(agentResp.intent || ''),
      risk_flags: String(agentResp.risk_flags || ''),
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
    });

    const updated = await ingestTicket(ingestInput);
    // ingestTicket devuelve el ticket SIN cambios si su estado es terminal
    // (enviado/descartado/manual): lo senalamos para que el operador lo sepa.
    const changed = updated.aiReply === reply;
    results.push({
      external_message_id: ticket.externalMessageId,
      ok: true,
      status: updated.status,
      applied: changed,
      note: changed ? 'updated' : 'skipped_terminal_status',
      before,
      after: { routedTemplateId: updated.routedTemplateId, routeSource: updated.routeSource }
    });
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
