import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  buildLedgerMatrix,
  MANUAL_LINE_KEYS,
  monthQueryRange,
  normalizeMonthInput,
  resolveRates
} from '@/lib/financial-ledger';
import { buildMonthWeekPresets } from '@/lib/sales-periods';

export const dynamic = 'force-dynamic';

// La contabilidad del cliente solo cuenta ventas cobradas y no devueltas. Verificado contra los
// datos reales de abril 2026: contar solo `paid` + `partially_paid` cuadra el total con el Excel
// (unidades +0,1 %, pedidos +0,4 %). Se excluyen `pending`/`authorized`/`voided` (no cobrados) y
// `refunded`/`partially_refunded` (devoluciones, que el contable trata como no-venta).
const SALE_FINANCIAL_STATUSES = ['paid', 'partially_paid'];

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const month = normalizeMonthInput(url.searchParams.get('month'));
  const platformParam = url.searchParams.get('platform') || 'all';
  const { since, until } = monthQueryRange(month);

  const [orders, entries, settings] = await Promise.all([
    db.platformOrder.findMany({
      where: {
        processedAt: { gte: since, lte: until },
        cancelledAt: null,
        isTest: false,
        financialStatus: { in: SALE_FINANCIAL_STATUSES },
        ...(platformParam !== 'all' ? { platform: platformParam } : {})
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
    db.financialLedgerEntry.findMany({
      where: { month },
      select: { periodLabel: true, lineKey: true, amount: true }
    }),
    db.financialSetting.findMany({ select: { key: true, value: true } })
  ]);

  const matrix = buildLedgerMatrix({ month, orders, rates: resolveRates(settings), entries });

  return Response.json({ ok: true, platform: platformParam, ...matrix });
}

const putSchema = z.object({
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

  if (!MANUAL_LINE_KEYS.includes(lineKey)) {
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
    where: { month_periodLabel_lineKey: { month, periodLabel, lineKey } },
    create: { month, periodLabel, lineKey, amount: value },
    update: { amount: value }
  });

  return Response.json({ ok: true });
}
