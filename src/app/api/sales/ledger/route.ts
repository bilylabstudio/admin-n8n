import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  buildLedgerMatrix,
  getLedgerConfig,
  manualLineKeys,
  monthQueryRange,
  normalizeMonthInput,
  resolveLedgerPlatform,
  resolveRates
} from '@/lib/financial-ledger';
import { buildMonthWeekPresets } from '@/lib/sales-periods';

export const dynamic = 'force-dynamic';

// La contabilidad del cliente solo cuenta ventas cobradas y no devueltas. Verificado contra los
// datos reales de abril 2026 (Shopify): contar solo `paid` + `partially_paid` cuadra el total con
// el Excel. Amazon y TikTok normalizan sus estados al mismo vocabulario, asi que aplica igual.
const SALE_FINANCIAL_STATUSES = ['paid', 'partially_paid'];

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const month = normalizeMonthInput(url.searchParams.get('month'));
  const platform = resolveLedgerPlatform(url.searchParams.get('platform'));
  const { since, until } = monthQueryRange(month);
  const needsFees = getLedgerConfig(platform).rows.some((row) => row.compute?.base === 'fee');

  const [orders, fees, entries, settings] = await Promise.all([
    db.platformOrder.findMany({
      where: {
        platform,
        processedAt: { gte: since, lte: until },
        cancelledAt: null,
        isTest: false,
        financialStatus: { in: SALE_FINANCIAL_STATUSES }
      },
      select: {
        processedAt: true,
        totalUnits: true,
        subtotal: true,
        totalShipping: true,
        totalTax: true,
        totalRefunded: true
      }
    }),
    needsFees
      ? db.platformFinancialTransaction.findMany({
          where: { platform, postedAt: { gte: since, lte: until } },
          select: { postedAt: true, transactionType: true, feeAmount: true }
        })
      : Promise.resolve([] as { postedAt: Date; transactionType: string | null; feeAmount: unknown }[]),
    db.financialLedgerEntry.findMany({
      where: { platform, month },
      select: { periodLabel: true, lineKey: true, amount: true }
    }),
    db.financialSetting.findMany({ where: { platform }, select: { key: true, value: true } })
  ]);

  const matrix = buildLedgerMatrix({
    platform,
    month,
    orders,
    fees: fees.map((fee) => ({
      postedAt: fee.postedAt,
      transactionType: fee.transactionType,
      amount: fee.feeAmount
    })),
    rates: resolveRates(platform, settings),
    entries
  });

  return Response.json({ ok: true, ...matrix });
}

const putSchema = z.object({
  platform: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  periodLabel: z.string().min(1),
  lineKey: z.string().min(1),
  amount: z.union([z.number(), z.string()]).transform((value) => Number(value))
});

export async function PUT(request: Request) {
  await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Datos invalidos.' }, { status: 400 });
  }

  const { month, periodLabel, lineKey, amount } = parsed.data;
  const platform = resolveLedgerPlatform(parsed.data.platform);

  if (!manualLineKeys(platform).includes(lineKey)) {
    return Response.json({ ok: false, error: 'Este concepto no es editable.' }, { status: 400 });
  }

  const validLabels = buildMonthWeekPresets(month).map((period) => period.label);
  if (!validLabels.includes(periodLabel)) {
    return Response.json({ ok: false, error: 'Periodo invalido.' }, { status: 400 });
  }

  if (!Number.isFinite(amount)) {
    return Response.json({ ok: false, error: 'Importe invalido.' }, { status: 400 });
  }

  const value = Math.round(amount * 100) / 100;

  await db.financialLedgerEntry.upsert({
    where: { platform_month_periodLabel_lineKey: { platform, month, periodLabel, lineKey } },
    create: { platform, month, periodLabel, lineKey, amount: value },
    update: { amount: value }
  });

  return Response.json({ ok: true });
}
