import type { Prisma } from '@prisma/client';

export type FormWithIncludes = Prisma.FormSubmissionGetPayload<{
  include: {
    images: { select: { id: true; filename: true; mimeType: true; sizeBytes: true } };
    ticket: { select: { id: true; subject: true } };
    approvedBy: { select: { email: true } };
  };
}>;

export function serializeForm(form: FormWithIncludes) {
  return {
    id: form.id,
    type: form.type,
    status: form.status,
    customerEmail: form.customerEmail,
    orderNumber: form.orderNumber,
    purchaseEmail: form.purchaseEmail,
    reason: form.reason,
    reviewNotes: form.reviewNotes,
    finalReply: form.finalReply,
    submittedAt: form.submittedAt?.toISOString() ?? null,
    sentAt: form.sentAt?.toISOString() ?? null,
    sendError: form.sendError,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    expiresAt: form.expiresAt.toISOString(),
    ticket: form.ticket,
    approvedBy: form.approvedBy?.email ?? null,
    images: form.images.map((img) => ({
      id: img.id,
      filename: img.filename,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes
    }))
  };
}
