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

export function buildMonthWeekPresets(monthInput: string) {
  const [year, month] = monthInput.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  const safeMonth = Number.isFinite(month) ? month : new Date().getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();

  return [
    { label: '1-7', start: 1, end: Math.min(7, lastDay) },
    { label: '8-14', start: 8, end: Math.min(14, lastDay) },
    { label: '15-21', start: 15, end: Math.min(21, lastDay) },
    { label: '22-fin', start: 22, end: lastDay }
  ]
    .filter((r) => r.start <= lastDay)
    .map((r) => ({
      label: r.label,
      startDate: makeDateInput(safeYear, safeMonth, r.start),
      endDate: makeDateInput(safeYear, safeMonth, r.end)
    }));
}

function makeDateInput(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
