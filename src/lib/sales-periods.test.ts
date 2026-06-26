import { describe, expect, it } from 'vitest';
import { buildMonthWeekPresets, defaultRangeForPeriod, monthInputFromDate } from './sales-periods';

describe('sales period helpers', () => {
  it('builds Excel-style sub-periods for the active month instead of the YTD start month', () => {
    const now = new Date('2026-06-11T12:00:00.000Z');
    const ytd = defaultRangeForPeriod('ytd', now);
    const month = monthInputFromDate(now);

    expect(ytd.start).toBe('2026-01-01');
    expect(buildMonthWeekPresets(month).map((p) => p.label)).toEqual(['1-5', '6-12', '13-19', '20-26', '27-fin']);
    expect(buildMonthWeekPresets(month)[0]).toEqual({
      label: '1-5',
      startDate: '2026-06-01',
      endDate: '2026-06-05'
    });
  });

  it('uses the real last day for the final sub-period of shorter months', () => {
    expect(buildMonthWeekPresets('2026-02')[4]).toEqual({
      label: '27-fin',
      startDate: '2026-02-27',
      endDate: '2026-02-28'
    });
  });
});
