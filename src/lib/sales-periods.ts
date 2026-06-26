export type PresetPeriod = 'ytd' | '7d' | '30d' | '90d';

const STORE_TIME_ZONE = 'Europe/Madrid';

export function dateInputFromDate(date: Date, timeZone = STORE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function monthInputFromDate(date: Date, timeZone = STORE_TIME_ZONE) {
  return dateInputFromDate(date, timeZone).slice(0, 7);
}

export function monthFromDateInput(value: string) {
  return value.slice(0, 7);
}

export function defaultRangeForPeriod(period: PresetPeriod, now = new Date()) {
  const today = dateInputFromDate(now);
  const year = Number(today.slice(0, 4));
  if (period === 'ytd') return { start: `${year}-01-01`, end: today };

  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { start: dateInputFromDate(start), end: today };
}

// Sub-periodos del mes al estilo del Excel financiero: 1-5, 6-12, 13-19, 20-26, 27-fin.
// El dia de inicio de cada bloque es fijo; el fin de cada bloque es el dia anterior al
// siguiente inicio (y el ultimo bloque llega al fin de mes).
export const EXCEL_PERIOD_STARTS = [1, 6, 13, 20, 27];

export function buildMonthWeekPresets(monthInput: string) {
  const [year, month] = monthInput.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  const safeMonth = Number.isFinite(month) ? month : new Date().getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();

  const starts = EXCEL_PERIOD_STARTS.filter((start) => start <= lastDay);

  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    const end = nextStart ? Math.min(nextStart - 1, lastDay) : lastDay;
    const label = nextStart ? `${start}-${end}` : `${start}-fin`;
    return {
      label,
      startDate: makeDateInput(safeYear, safeMonth, start),
      endDate: makeDateInput(safeYear, safeMonth, end)
    };
  });
}

function makeDateInput(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
