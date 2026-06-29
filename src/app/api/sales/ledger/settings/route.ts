import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { rateKeys, resolveLedgerPlatform } from '@/lib/financial-ledger';

export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  platform: z.string().optional(),
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
  const platform = resolveLedgerPlatform(parsed.data.platform);

  if (!rateKeys(platform).includes(key)) {
    return Response.json({ ok: false, error: 'Ajuste desconocido.' }, { status: 400 });
  }

  if (!Number.isFinite(value) || value < 0) {
    return Response.json({ ok: false, error: 'Valor invalido.' }, { status: 400 });
  }

  await db.financialSetting.upsert({
    where: { platform_key: { platform, key } },
    create: { platform, key, value },
    update: { value }
  });

  return Response.json({ ok: true });
}
