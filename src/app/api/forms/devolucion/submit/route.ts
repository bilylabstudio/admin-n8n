import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { formExpiryDate, generateFormToken } from '@/lib/forms';
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipLimit = rateLimit(`form-submit:ip:${ip}`, 3, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form_data' }, { status: 400 });
  }

  // Honeypot: if a bot filled this hidden field, fake-succeed without persisting
  const honeypot = String(formData.get('_hp') ?? '').trim();
  if (honeypot) {
    return NextResponse.json({ ok: true, form_id: 'hp_drop' });
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const orderNumber = String(formData.get('orderNumber') ?? '').trim();
  const purchaseEmail = String(formData.get('purchaseEmail') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }
  if (!orderNumber) {
    return NextResponse.json({ ok: false, error: 'missing_order_number' }, { status: 400 });
  }
  if (reason.length < 10) {
    return NextResponse.json({ ok: false, error: 'reason_too_short' }, { status: 400 });
  }

  // Idempotency: if the same email submitted in the last 24h and we still have it
  // pending or submitted, return that existing form instead of creating a duplicate.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.formSubmission.findFirst({
    where: {
      customerEmail: email,
      type: 'devolucion',
      status: { in: ['pending', 'submitted'] },
      createdAt: { gt: cutoff }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (recent) {
    return NextResponse.json({ ok: true, form_id: recent.id, deduped: true });
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

  // Create the form row first so we have the cuid for the upload folder
  const created = await db.formSubmission.create({
    data: {
      token: generateFormToken(),
      type: 'devolucion',
      customerEmail: email,
      orderNumber,
      purchaseEmail: purchaseEmail || null,
      reason,
      status: 'submitted',
      submittedAt: new Date(),
      ipAddress: ip,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      expiresAt: formExpiryDate()
    }
  });

  let written;
  try {
    written = await writeFormUploads(created.id, validated);
  } catch (err) {
    // Roll back the DB row if disk write fails
    await db.formSubmission.delete({ where: { id: created.id } }).catch(() => undefined);
    const code = err instanceof FormUploadError ? err.code : 'storage_error';
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  }

  try {
    await db.$transaction(async (tx) => {
      for (const w of written) {
        await tx.formImage.create({
          data: {
            formId: created.id,
            filename: w.filename,
            storagePath: w.relativePath,
            mimeType: w.mimeType,
            sizeBytes: w.sizeBytes
          }
        });
      }
      await tx.auditEvent.create({
        data: {
          formId: created.id,
          eventType: 'form_submitted',
          metadataJson: { images: written.length, ip }
        }
      });
    });
  } catch (err) {
    await deleteFormUploads(created.id).catch(() => undefined);
    await db.formSubmission.delete({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }

  // Fire receipt email (non-blocking)
  sendFormEmail({
    form: created,
    templateKey: 'form_devolucion_recibida',
    approvedBy: 'system',
    approvalAction: 'auto_receipt'
  })
    .then((result) => {
      if (!result.ok) {
        console.error('form_receipt_email_failed', { formId: created.id, error: result.error });
      }
    })
    .catch((err) => console.error('form_receipt_email_threw', err));

  return NextResponse.json({ ok: true, form_id: created.id });
}
