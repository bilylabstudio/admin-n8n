import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { renderTemplate, type FormTemplateKey } from '@/lib/form-templates';
import { serializeForm } from '@/lib/form-serializer';

export const dynamic = 'force-dynamic';

const VALID_TEMPLATES = new Set<FormTemplateKey>([
  'form_devolucion_aprobada',
  'form_devolucion_rechazada',
  'form_devolucion_recibida'
]);

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const form = await db.formSubmission.findUnique({
    where: { id: params.id },
    include: {
      images: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
      ticket: { select: { id: true, subject: true } },
      approvedBy: { select: { email: true } },
      auditEvents: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { email: true } } }
      }
    }
  });

  if (!form) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const renderTemplateKey = url.searchParams.get('renderTemplate') as FormTemplateKey | null;
  let renderedTemplate: string | null = null;
  if (renderTemplateKey && VALID_TEMPLATES.has(renderTemplateKey)) {
    renderedTemplate = renderTemplate(renderTemplateKey, {
      nombre: form.customerEmail.split('@')[0],
      orderNumber: form.orderNumber ?? undefined,
      formId: form.id
    });
  }

  return NextResponse.json({
    ok: true,
    form: {
      ...serializeForm(form),
      auditEvents: form.auditEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        createdAt: e.createdAt.toISOString(),
        userEmail: e.user?.email ?? null,
        metadataJson: e.metadataJson ?? null
      }))
    },
    renderedTemplate
  });
}
