import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { LEDGER_RATE_KEYS } from '@/lib/financial-ledger';

export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.number(), z.string()]).transform((value) => Number(value))
});

export async function PUT(request: Request) {
  await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Datos invalidos.' }, { status: 400 });
  }

  const { key, value } = parsed.data;

  if (!(LEDGER_RATE_KEYS as readonly string[]).includes(key)) {
    return Response.json({ ok: false, error: 'Ajuste desconocido.' }, { status: 400 });
  }

  if (!Number.isFinite(value) || value < 0) {
    return Response.json({ ok: false, error: 'Valor invalido.' }, { status: 400 });
  }

  await db.financialSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value }
  });

  return Response.json({ ok: true });
}
