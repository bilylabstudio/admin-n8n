import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isFormTokenValid } from '@/lib/forms';
import {
  deleteFormUploads,
  FORM_UPLOAD_LIMITS,
  FormUploadError,
  validateUpload,
  writeFormUploads
} from '@/lib/form-uploads';
import { rateLimit } from '@/lib/rate-limit';
import { sendFormEmail } from '@/lib/form-emails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

  const tokenLimit = rateLimit(`form-submit:token:${token}`, 5, 60 * 60 * 1000);
  const ipLimit = rateLimit(`form-submit:ip:${ip}`, 30, 60 * 60 * 1000);
  if (!tokenLimit.allowed || !ipLimit.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const form = await db.formSubmission.findUnique({ where: { token } });
  if (!form) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const validity = isFormTokenValid(form);
  if (!validity.ok) {
    return NextResponse.json({ ok: false, error: validity.reason }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form_data' }, { status: 400 });
  }

  const orderNumber = String(formData.get('orderNumber') ?? '').trim();
  const purchaseEmail = String(formData.get('purchaseEmail') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: 'missing_order_number' }, { status: 400 });
  }
  if (reason.length < 10) {
    return NextResponse.json({ ok: false, error: 'reason_too_short' }, { status: 400 });
  }

  const fileEntries = formData.getAll('files').filter((v): v is File => v instanceof File);
  if (fileEntries.length > FORM_UPLOAD_LIMITS.MAX_FILES) {
    return NextResponse.json({ ok: false, error: 'too_many_files' }, { status: 400 });
  }

  let validated;
  try {
    validated = await Promise.all(
      fileEntries.map(async (f) => {
        const buf = Buffer.from(await f.arrayBuffer());
        return validateUpload(buf);
      })
    );
  } catch (err) {
    const code = err instanceof FormUploadError ? err.code : 'invalid_upload';
    return NextResponse.json({ ok: false, error: code }, { status: 400 });
  }

  let written;
  try {
    written = await writeFormUploads(form.id, validated);
  } catch (err) {
    const code = err instanceof FormUploadError ? err.code : 'storage_error';
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  }

  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      const result = await tx.formSubmission.update({
        where: { id: form.id },
        data: {
          orderNumber,
          purchaseEmail: purchaseEmail || null,
          reason,
          status: 'submitted',
          submittedAt: new Date(),
          ipAddress: ip,
          userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null
        }
      });
      for (const w of written) {
        await tx.formImage.create({
          data: {
            formId: form.id,
            filename: w.filename,
            storagePath: w.relativePath,
            mimeType: w.mimeType,
            sizeBytes: w.sizeBytes
          }
        });
      }
      await tx.auditEvent.create({
        data: {
          formId: form.id,
          eventType: 'form_submitted',
          metadataJson: {
            images: written.length,
            ip
          }
        }
      });
      return result;
    });
  } catch (err) {
    // Rollback the file system writes if DB transaction failed
    await deleteFormUploads(form.id).catch(() => undefined);
    throw err;
  }

  // Fire receipt email asynchronously — failure is logged but does not block the response
  sendFormEmail({
    form: updated,
    templateKey: 'form_devolucion_recibida',
    approvedBy: 'system',
    approvalAction: 'auto_receipt'
  })
    .then((result) => {
      if (!result.ok) {
        console.error('form_receipt_email_failed', { formId: updated.id, error: result.error });
        db.auditEvent
          .create({
            data: {
              formId: updated.id,
              eventType: 'form_submitted',
              metadataJson: { receipt_email_error: result.error }
            }
          })
          .catch(() => undefined);
      }
    })
    .catch((err) => {
      console.error('form_receipt_email_threw', err);
    });

  return NextResponse.json({
    ok: true,
    form_id: updated.id,
    redirect_to: `/forms/devolucion/${token}/confirmacion`
  });
}
