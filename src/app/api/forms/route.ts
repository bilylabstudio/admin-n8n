import type { FormStatus, Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { formInboxGroups, type FormInboxGroup } from '@/lib/forms';
import { serializeForm } from '@/lib/form-serializer';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 150;
const VALID_GROUPS = new Set<FormInboxGroup>(['submitted', 'approved_sent', 'rejected_sent', 'manual', 'discarded']);

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get('status') || 'submitted';
  const group: FormInboxGroup = VALID_GROUPS.has(requested as FormInboxGroup)
    ? (requested as FormInboxGroup)
    : 'submitted';
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = clampLimit(Number(url.searchParams.get('limit') || DEFAULT_LIMIT));

  const searchWhere: Prisma.FormSubmissionWhereInput = q
    ? {
        OR: [
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { reason: { contains: q, mode: 'insensitive' } }
        ]
      }
    : {};

  const where: Prisma.FormSubmissionWhereInput = {
    status: group as FormStatus,
    ...searchWhere
  };

  const [forms, counts] = await Promise.all([
    db.formSubmission.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        images: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
        ticket: { select: { id: true, subject: true } },
        approvedBy: { select: { email: true } }
      }
    }),
    Promise.all(
      formInboxGroups.map(async (item) => {
        const count = await db.formSubmission.count({
          where: { status: item.id as FormStatus, ...searchWhere }
        });
        return [item.id, count] as const;
      })
    )
  ]);

  return NextResponse.json({
    ok: true,
    forms: forms.map(serializeForm),
    counts: Object.fromEntries(counts),
    selectedFormId: forms[0]?.id || null,
    serverTime: new Date().toISOString()
  });
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}
