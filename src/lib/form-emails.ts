import { env } from './env';
import { renderTemplate, subjectForTemplate, type FormTemplateKey } from './form-templates';
import type { FormSubmission } from '@prisma/client';

export type SendFormEmailResult = { ok: true; providerMessageId?: string } | { ok: false; error: string };

export async function sendFormEmail(args: {
  form: FormSubmission;
  templateKey: FormTemplateKey;
  approvedBy: string;
  approvalAction: string;
  motivo?: string;
  finalReplyOverride?: string;
}): Promise<SendFormEmailResult> {
  const { form, templateKey, approvedBy, approvalAction, motivo, finalReplyOverride } = args;

  const nombre = form.customerEmail.split('@')[0];
  const body =
    finalReplyOverride?.trim() ||
    renderTemplate(templateKey, {
      nombre,
      orderNumber: form.orderNumber ?? undefined,
      formId: form.id,
      motivo
    });

  const subject = subjectForTemplate(templateKey);

  try {
    const response = await fetch(env.N8N_SEND_APPROVED_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Review-Admin-Token': env.N8N_SEND_APPROVED_SECRET
      },
      body: JSON.stringify({
        ticket_id: form.ticketId ?? form.id,
        to_email: form.customerEmail,
        subject,
        final_reply: body,
        approved_by: approvedBy,
        approval_action: approvalAction,
        template_type: templateKey,
        form_id: form.id
      })
    });

    if (!response.ok) {
      return { ok: false, error: `webhook_status_${response.status}` };
    }

    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; provider_message_id?: string };
    if (data.ok === false) {
      return { ok: false, error: 'webhook_rejected' };
    }
    return { ok: true, providerMessageId: data.provider_message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}
