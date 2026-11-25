import { PANEL_PLATFORMS, round2, type DailyPlatformRow } from '@/lib/panel';
import { dailyRows } from '@/lib/panel-queries';

// Métricas mensuales del P&L con caché por mes (cerrados 6 h, mes en curso 5 min).

export type MonthMetrics = { month: string; platform: string; revenue: number; units: number; orders: number; monthFraction: number };

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

export async function yearMetrics(year: number, today: string): Promise<MonthMetrics[]> {
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
export function yearMetricsShared(year: number, today: string) {
  const key = `${year}:${today}`;
  let p = running.get(key);
  if (!p) {
    p = yearMetrics(year, today).finally(() => setTimeout(() => running.delete(key), 60_000));
    running.set(key, p);
  }
  return p;
}

