import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from './auth';
import { db } from './db';
import { canTransition } from './forms';
import { sendFormEmail } from './form-emails';
import type { FormTemplateKey } from './form-templates';
import type { AuditEventType, FormStatus } from '@prisma/client';

export type FormAction = 'approve' | 'reject' | 'manual' | 'discard';

type ActionConfig = {
  targetStatus: FormStatus;
  auditEvent: AuditEventType;
  templateKey: FormTemplateKey | null;
  requiresReply: boolean;
};

const ACTIONS: Record<FormAction, ActionConfig> = {
  approve: {
    targetStatus: 'approved_sent',
    auditEvent: 'form_approved_sent',
    templateKey: 'form_devolucion_aprobada',
    requiresReply: true
  },
  reject: {
    targetStatus: 'rejected_sent',
    auditEvent: 'form_rejected_sent',
    templateKey: 'form_devolucion_rechazada',
    requiresReply: true
  },
  manual: {
    targetStatus: 'manual',
    auditEvent: 'form_manual',
    templateKey: null,
    requiresReply: false
  },
  discard: {
    targetStatus: 'discarded',
    auditEvent: 'form_discarded',
    templateKey: null,
    requiresReply: false
  }
};

export async function handleFormAction(
  req: NextRequest,
  formId: string,
  action: FormAction
): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const form = await db.formSubmission.findUnique({ where: { id: formId } });
  if (!form) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const config = ACTIONS[action];
  if (!canTransition(form.status, config.targetStatus)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_transition', from: form.status, to: config.targetStatus },
      { status: 409 }
    );
  }

  let finalReply = '';
  let reviewNotes = '';
  try {
    const body = await req.formData();
    finalReply = String(body.get('final_reply') ?? '').trim();
    reviewNotes = String(body.get('review_notes') ?? '').trim();
  } catch {
    // No body submitted; that's OK for manual/discard
  }

  if (config.requiresReply && !finalReply) {
    return NextResponse.json({ ok: false, error: 'final_reply_required' }, { status: 400 });
  }

  if (config.templateKey) {
    const result = await sendFormEmail({
      form,
      templateKey: config.templateKey,
      approvedBy: user.email,
      approvalAction: action,
      finalReplyOverride: finalReply
    });

    if (!result.ok) {
      await db.formSubmission.update({
        where: { id: form.id },
        data: { sendError: result.error }
      });
      return NextResponse.json(
        { ok: false, error: 'send_failed', detail: result.error },
        { status: 502 }
      );
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.formSubmission.update({
      where: { id: form.id },
      data: {
        status: config.targetStatus,
        finalReply: config.requiresReply ? finalReply : form.finalReply,
        reviewNotes: reviewNotes || form.reviewNotes,
        approvedByUserId: user.id,
        sentAt: config.requiresReply ? new Date() : form.sentAt,
        sendError: null
      }
    });
    await tx.auditEvent.create({
      data: {
        formId: form.id,
        userId: user.id,
        eventType: config.auditEvent,
        metadataJson: { action, requires_reply: config.requiresReply }
      }
    });
    return result;
  });

  return NextResponse.json({ ok: true, form_id: updated.id, status: updated.status });
}
