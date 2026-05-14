import { env } from './env';

export type SendApprovedPayload = {
  ticket_id: string;
  to_email: string;
  subject: string;
  final_reply: string;
  approved_by: string;
  approval_action: 'approved' | 'edited';
};

export type N8nSendResult =
  | { ok: true; provider_message_id?: string; sent_at?: string }
  | { ok: false; error: string; message?: string };

export async function sendApprovedReply(payload: SendApprovedPayload): Promise<N8nSendResult> {
  const response = await fetch(env.N8N_SEND_APPROVED_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Review-Admin-Token': env.N8N_SEND_APPROVED_SECRET
    },
    body: JSON.stringify(payload)
  });

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
