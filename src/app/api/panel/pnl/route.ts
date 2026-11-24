import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { PANEL_PLATFORMS, round2, todayInMadrid, type DailyPlatformRow } from '@/lib/panel';
import { dailyRows } from '@/lib/panel-queries';
import { DEFAULT_PNL_RULES, MONTH_RE, mergeRules } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

type MonthMetrics = { month: string; platform: string; revenue: number; units: number; orders: number; monthFraction: number };

function daysInMonth(month: string) {
  return new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
}

// Cache propia: los meses cerrados casi no cambian (6 h); el mes en curso se refresca cada 5 min.
type Entry = { at: number; ttl: number; promise: Promise<DailyPlatformRow[]> };
const store: Map<string, Entry> = ((globalThis as { __pnlCache?: Map<string, Entry> }).__pnlCache ??= new Map());

function monthRows(month: string, end: string, closed: boolean): Promise<DailyPlatformRow[]> {
  const key = `${month}:${end}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const promise = dailyRows({ start: `${month}-01`, end });
  promise.catch(() => store.delete(key));
  store.set(key, { at: Date.now(), ttl: closed ? 6 * 3_600_000 : 5 * 60_000, promise });
  return promise;
}

async function yearMetrics(year: number, today: string): Promise<MonthMetrics[]> {
  const start = `${year}-01-01`;
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;
  if (start > end) return [];
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    if (`${key}-01` <= end) months.push(key);
  }
  const lastDay = (m: string) => `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
  // De tres en tres para no saturar la base de datos.
  const rows: DailyPlatformRow[] = [];
  for (let i = 0; i < months.length; i += 3) {
    const chunk = await Promise.all(
      months.slice(i, i + 3).map((m) => {
        const closed = lastDay(m) < today;
        return monthRows(m, closed ? lastDay(m) : end, closed);
      })
    );
    rows.push(...chunk.flat());
  }
  const out: MonthMetrics[] = [];
  for (const month of months) {
    const covered = lastDay(month) <= end ? daysInMonth(month) : Number(end.slice(8, 10));
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

const running = new Map<string, Promise<MonthMetrics[]>>();
function yearMetricsShared(year: number, today: string) {
  const key = `${year}:${today}`;
  let p = running.get(key);
  if (!p) {
    p = yearMetrics(year, today).finally(() => setTimeout(() => running.delete(key), 60_000));
    running.set(key, p);
  }
  return p;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const today = todayInMadrid();
  const year = Number(new URL(request.url).searchParams.get('year') || today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return Response.json({ ok: false, error: 'Año no válido' }, { status: 400 });

  // Si el calculo tarda (primera vez tras desplegar), respondemos "pendiente" y la pagina reintenta.
  const metrics = await Promise.race([
    yearMetricsShared(year, today),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
  ]);
  if (!metrics) return Response.json({ ok: false, pending: true }, { status: 202 });
  const [overrides, actuals] = await Promise.all([
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
