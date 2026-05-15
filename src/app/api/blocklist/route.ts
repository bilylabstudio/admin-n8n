import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  const blocked = await db.blockedEmail.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ ok: true, blocked });
}

const addSchema = z.object({
  email: z.string().email('Email inválido'),
  reason: z.string().optional().default('')
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload inválido' }, { status: 400 });
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || 'Email inválido' }, { status: 400 });
  }

  const entry = await db.blockedEmail.upsert({
    where: { email: parsed.data.email.toLowerCase() },
    create: { email: parsed.data.email.toLowerCase(), reason: parsed.data.reason },
    update: { reason: parsed.data.reason }
  });

  return NextResponse.json({ ok: true, blocked: entry });
}
