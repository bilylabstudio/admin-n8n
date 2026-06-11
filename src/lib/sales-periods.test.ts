import { describe, expect, it } from 'vitest';
import { buildMonthWeekPresets, defaultRangeForPeriod, monthInputFromDate } from './sales-periods';

describe('sales period helpers', () => {
  it('builds weekly presets for the active month instead of the YTD start month', () => {
    const now = new Date('2026-06-11T12:00:00.000Z');
    const ytd = defaultRangeForPeriod('ytd', now);
    const month = monthInputFromDate(now);

    expect(ytd.start).toBe('2026-01-01');
    expect(buildMonthWeekPresets(month)[0]).toEqual({
      label: '1-7',
      startDate: '2026-06-01',
      endDate: '2026-06-07'
    });
  });

  it('uses the real last day for the final week of shorter months', () => {
    expect(buildMonthWeekPresets('2026-02')[3]).toEqual({
      label: '22-fin',
      startDate: '2026-02-22',
      endDate: '2026-02-28'
    });
  });
});
