import { describe, expect, it } from 'vitest';
import {
  isDenseSalesChart,
  salesChartValueLabelInterval,
  shouldShowSalesChartValueLabel
} from './sales-chart';

describe('sales chart label helpers', () => {
  it('shows every non-zero value label for short series', () => {
    const values = [10, 20, 0, 30, 40, 50, 60];
    const max = Math.max(...values);
    const visible = values.map((value, index) =>
      shouldShowSalesChartValueLabel({
        dataLength: values.length,
        index,
        value,
        percent: Math.round((value / max) * 100)
      })
    );

    expect(visible).toEqual([true, true, false, true, true, true, true]);
  });

  it('spaces value labels in a crowded 23 day chart', () => {
    const values = [
      1083, 1019, 983, 781, 725, 608, 700, 841, 583, 513, 463, 318,
      174, 230, 347, 409, 389, 388, 177, 160, 262, 305, 364
    ];
    const max = Math.max(...values);
    const visibleIndexes = values
      .map((value, index) =>
        shouldShowSalesChartValueLabel({
          dataLength: values.length,
          index,
          value,
          percent: Math.round((value / max) * 100)
        })
          ? index
          : -1
      )
      .filter((index) => index >= 0);

    expect(visibleIndexes).toEqual([3, 9, 15, 21]);
  });

  it('detects dense charts separately from label spacing', () => {
    expect(isDenseSalesChart(14)).toBe(false);
    expect(isDenseSalesChart(23)).toBe(true);
    expect(salesChartValueLabelInterval(23)).toBe(6);
  });
});
