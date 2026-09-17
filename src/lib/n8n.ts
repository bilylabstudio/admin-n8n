import { env } from './env';

export type OutgoingAttachmentPayload = {
  filename: string;
  mime_type: string;
  content_base64: string;
};

export type SendApprovedPayload = {
  ticket_id: string;
  to_email: string;
  subject: string;
  final_reply: string;
  approved_by: string;
  approval_action: 'approved' | 'edited';
  in_reply_to_message_id?: string;
  imap_uid?: string;
  imap_mailbox?: string;
  message_id?: string;
  references?: string;
  // Files staged via POST /api/attachments and referenced by id at send
  // time. n8n's send-approved-reply workflow must attach these to the
  // outgoing email; see docs/superpowers/specs/2026-09-17-adjuntos-email-tickets-design.md.
  attachments?: OutgoingAttachmentPayload[];
};

export type SentAttachmentConfirmation = {
  filename: string;
  mime_type: string;
  size_bytes: number;
};

export type SentMessagePayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  sent_at: string;
  in_reply_to?: string;
  references?: string;
  // What n8n actually attached to the outgoing email, echoed back so the
  // audit log and the IMAP "Sent" copy stay honest about what really went out.
  attachments?: SentAttachmentConfirmation[];
};

export type N8nSendResult =
  | {
      ok: true;
      provider_message_id?: string;
      sent_at?: string;
      sent_message?: SentMessagePayload;
    }
  | { ok: false; error: string; message?: string };

export async function sendApprovedReply(payload: SendApprovedPayload): Promise<N8nSendResult> {
  let response: Response;
  try {
    response = await fetch(env.N8N_SEND_APPROVED_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Review-Admin-Token': env.N8N_SEND_APPROVED_SECRET
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return {
      ok: false,
      error: 'n8n_request_failed',
      message: error instanceof Error ? error.message : 'Could not reach n8n webhook.'
    };
  }

  const data = (await response.json().catch(() => null)) as N8nSendResult | null;

  if (!response.ok) {
    return {
      ok: false,
      error: 'n8n_http_error',
      message: data && 'message' in data ? data.message : `n8n returned HTTP ${response.status}`
    };
  }

  if (!data || typeof data.ok !== 'boolean') {
    return { ok: false, error: 'invalid_n8n_response', message: 'n8n did not return a valid JSON result.' };
  }

  return data;
}
