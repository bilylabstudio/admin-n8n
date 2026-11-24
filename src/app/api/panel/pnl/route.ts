import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { PANEL_PLATFORMS, round2, todayInMadrid, type DailyPlatformRow } from '@/lib/panel';
import { cached, dailyRows } from '@/lib/panel-queries';
import { DEFAULT_PNL_RULES, MONTH_RE, mergeRules } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

type MonthMetrics = { month: string; platform: string; revenue: number; units: number; orders: number; monthFraction: number };

function daysInMonth(month: string) {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
}

async function yearMetrics(year: number, today: string): Promise<MonthMetrics[]> {
  const start = `${year}-01-01`;
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;
  if (start > end) return [];
  // Por meses para aprovechar la cache y no lanzar una consulta enorme.
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    if (`${key}-01` <= end) months.push(key);
  }
  const rows = (
    await Promise.all(
      months.map((m) => {
        const last = `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
        return dailyRows({ start: `${m}-01`, end: last < end ? last : end });
      })
    )
  ).flat() as DailyPlatformRow[];
  const out: MonthMetrics[] = [];
  for (const month of months) {
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const covered = last <= end ? daysInMonth(month) : Number(end.slice(8, 10));
    for (const platform of PANEL_PLATFORMS) {
      const r = rows.filter((x) => x.platform === platform && x.day.startsWith(month));
      out.push({
        month,
        platform,
        revenue: round2(r.reduce((a, x) => a + x.netSales, 0)),
        units: r.reduce((a, x) => a + x.units, 0),
        orders: r.reduce((a, x) => a + x.orders, 0),
        monthFraction: round2(covered / daysInMonth(month))
      });
    }
  }
  return out;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const today = todayInMadrid();
  const year = Number(new URL(request.url).searchParams.get('year') || today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return Response.json({ ok: false, error: 'Año no válido' }, { status: 400 });

  const [metrics, overrides, actuals] = await Promise.all([
    cached(`pnl:${year}:${today}`, () => yearMetrics(year, today)),
    db.pnlRule.findMany(),
    db.pnlActual.findMany({ where: { month: { startsWith: `${year}-` } } })
  ]);
  return Response.json({
    ok: true,
    year,
    today,
    platforms: PANEL_PLATFORMS,
    metrics,
    rules: mergeRules(overrides.map((o) => ({ platform: o.platform, key: o.key, value: Number(o.value), active: o.active }))),
    actuals: actuals.map((a) => ({ platform: a.platform, month: a.month, key: a.key, amount: Number(a.amount) }))
  });
}

/** Guarda un supuesto ({type:'rule', platform, key, value, active}) o un gasto real ({type:'actual', platform, month, key, amount|null}). */
export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: 'Petición vacía' }, { status: 400 });
  const platform = String(body.platform ?? '');
  const key = String(body.key ?? '');
  if (!DEFAULT_PNL_RULES.some((r) => r.platform === platform && r.key === key)) {
    return Response.json({ ok: false, error: 'Concepto desconocido' }, { status: 400 });
  }

  if (body.type === 'rule') {
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return Response.json({ ok: false, error: 'Valor no válido' }, { status: 400 });
    const active = body.active !== false;
    await db.pnlRule.upsert({
      where: { platform_key: { platform, key } },
      create: { platform, key, value, active, updatedBy: user.email },
      update: { value, active, updatedBy: user.email }
    });
    return Response.json({ ok: true });
  }

  if (body.type === 'actual') {
    const month = String(body.month ?? '');
    if (!MONTH_RE.test(month)) return Response.json({ ok: false, error: 'Mes no válido' }, { status: 400 });
    if (body.amount === null || body.amount === '') {
      await db.pnlActual.deleteMany({ where: { platform, month, key } });
      return Response.json({ ok: true });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) > 100_000_000) return Response.json({ ok: false, error: 'Importe no válido' }, { status: 400 });
    await db.pnlActual.upsert({
      where: { platform_month_key: { platform, month, key } },
      create: { platform, month, key, amount, updatedBy: user.email },
      update: { amount, updatedBy: user.email }
    });
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: 'Tipo no válido' }, { status: 400 });
}
