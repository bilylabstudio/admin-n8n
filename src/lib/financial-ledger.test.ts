import { describe, expect, it } from 'vitest';
import { buildLedgerMatrix, LEDGER_RATE_DEFAULTS, type LedgerOrderInput } from './financial-ledger';

function row(matrix: ReturnType<typeof buildLedgerMatrix>, key: string) {
  const found = matrix.rows.find((r) => r.key === key);
  if (!found) throw new Error(`row ${key} not found`);
  return found;
}

describe('buildLedgerMatrix', () => {
  const orders: LedgerOrderInput[] = [
    { processedAt: new Date('2026-06-03T12:00:00.000Z'), totalUnits: 2, subtotal: 100, totalShipping: 10 },
    { processedAt: new Date('2026-06-04T12:00:00.000Z'), totalUnits: 1, subtotal: 50, totalShipping: 5 },
    { processedAt: new Date('2026-06-10T12:00:00.000Z'), totalUnits: 3, subtotal: 200, totalShipping: 20 },
    // Fuera del mes: no debe contar en ningun sub-periodo.
    { processedAt: new Date('2026-05-30T12:00:00.000Z'), totalUnits: 9, subtotal: 999, totalShipping: 99 }
  ];

  const matrix = buildLedgerMatrix({
    month: '2026-06',
    orders,
    rates: LEDGER_RATE_DEFAULTS,
    entries: [
      { periodLabel: '1-5', lineKey: 'ads_meta', amount: 40 },
      { periodLabel: '1-5', lineKey: 'tipsa', amount: 12 }
    ]
  });

  it('crea los 5 sub-periodos del Excel', () => {
    expect(matrix.periods.map((p) => p.label)).toEqual(['1-5', '6-12', '13-19', '20-26', '27-fin']);
  });

  it('calcula metricas base desde los pedidos por sub-periodo', () => {
    expect(row(matrix, 'units').cells).toEqual([3, 3, 0, 0, 0]);
    expect(row(matrix, 'units').total).toBe(6);
    expect(row(matrix, 'orders').cells).toEqual([2, 1, 0, 0, 0]);
    expect(row(matrix, 'sales').cells[0]).toBe(165);
    expect(row(matrix, 'sales').cells[1]).toBe(220);
    expect(row(matrix, 'sales').total).toBe(385);
  });

  it('aplica las tasas configurables en las filas calculadas', () => {
    expect(row(matrix, 'commission_order').cells[0]).toBe(0.6); // 2 pedidos * 0.30
    expect(row(matrix, 'commission_sales').cells[0]).toBe(2.64); // 165 * 1.6%
    expect(row(matrix, 'product_cost').cells[0]).toBe(9.6); // 3 uds * 3.2
    expect(row(matrix, 'gift_cost').cells[0]).toBe(2.4); // 3 uds * 0.8
    expect(row(matrix, 'md_cost').cells[0]).toBe(4.5); // 3 uds * 1.5
  });

  it('respeta los valores manuales guardados', () => {
    expect(row(matrix, 'ads_meta').cells[0]).toBe(40);
    expect(row(matrix, 'tipsa').cells[0]).toBe(12);
    expect(row(matrix, 'replo').cells[0]).toBe(0);
  });

  it('suma costes y calcula el margen (ventas - costes)', () => {
    expect(row(matrix, 'total_costs').cells[0]).toBe(71.74);
    expect(row(matrix, 'margin').cells[0]).toBe(93.26);
    expect(row(matrix, 'total_costs').cells[1]).toBe(20.32);
    expect(row(matrix, 'margin').cells[1]).toBe(199.68);
  });
});
