export function isDenseSalesChart(dataLength: number) {
  return dataLength > 18;
}

export function salesChartValueLabelInterval(dataLength: number) {
  if (dataLength <= 7) return 1;
  return Math.max(2, Math.ceil(dataLength / 4));
}

export function shouldShowSalesChartValueLabel({
  dataLength,
  index,
  value,
  percent
}: {
  dataLength: number;
  index: number;
  value: number;
  percent: number;
}) {
  if (value <= 0) return false;
  if (dataLength <= 7) return true;
  if (percent < 24) return false;

  const interval = salesChartValueLabelInterval(dataLength);
  const offset = Math.floor(interval / 2);
  return index >= offset && index < dataLength - 1 && (index - offset) % interval === 0;
}
