import ExcelJS from 'exceljs';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { PANEL_PLATFORMS, todayInMadrid } from '@/lib/panel';
import { yearMetricsShared, type MonthMetrics } from '@/lib/pnl-metrics';
import { MONTH_RE, PNL_GROUP_LABELS, PNL_GROUP_ORDER, computePnl, mergeRules, sumPnl, type PnlRule } from '@/lib/pnl';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Exporta el P&L a Excel con el formato del Excel de Nico (bloques WEB y AMAZON, fórmulas vivas)
// y una pestaña con el detalle mensual. ?year=2026 y opcional &month=2026-10.

const LABEL: Record<string, string> = { shopify: 'WEB', amazon: 'AMAZON' };
const EUR = '#,##0 €;[Red]-#,##0 €';
const EUR2 = '#,##0.00 €;[Red]-#,##0.00 €';
const PCT = '0.0%';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const url = new URL(request.url);
  const today = todayInMadrid();
  const year = Number(url.searchParams.get('year') || today.slice(0, 4));
  const month = url.searchParams.get('month');
  if (!Number.isInteger(year) || (month && !MONTH_RE.test(month))) {
    return Response.json({ ok: false, error: 'Parámetros no válidos' }, { status: 400 });
  }

  const [metrics, overrides, actuals] = await Promise.all([
    yearMetricsShared(year, today),
    db.pnlRule.findMany(),
    db.pnlActual.findMany({ where: { month: { startsWith: `${year}-` } } })
  ]);
  const rules = mergeRules(overrides.map((o) => ({ platform: o.platform, key: o.key, value: Number(o.value), active: o.active })));
  const months = [...new Set(metrics.map((m) => m.month))].sort().filter((m) => !month || m === month);
  const actualFor = (p: string, m: string) =>
    Object.fromEntries(actuals.filter((a) => a.platform === p && a.month === m).map((a) => [a.key, Number(a.amount)]));
  const pnlFor = (p: string, m: string) =>
    computePnl(
      rules.filter((r) => r.platform === p),
      metrics.find((x) => x.platform === p && x.month === m) ?? ({ revenue: 0, units: 0, orders: 0, monthFraction: 0 } as MonthMetrics),
      actualFor(p, m)
    );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Panel de negocio V-Gummies';
  wb.calcProperties.fullCalcOnLoad = true;
  const period = month
    ? new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()
    : `${year}${String(year) === today.slice(0, 4) ? ` (hasta ${today.slice(8, 10)}/${today.slice(5, 7)})` : ''}`;

  // ---------- Hoja P&L (formato del Excel del cliente) ----------
  const ws = wb.addWorksheet('P&L', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [
    { width: 38 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 14 },
    { width: 3 },
    { width: 38 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 14 }
  ];

  PANEL_PLATFORMS.forEach((platform, idx) => {
    const c0 = idx === 0 ? 1 : 7; // columna inicial (A o G)
    const col = (o: number) => ws.getColumn(c0 + o).letter;
    const A = col(0), B = col(1), C = col(2), D = col(3), E = col(4);
    const res = sumPnl(months.map((m) => pnlFor(platform, m)));
    const pRules = rules.filter((r) => r.platform === platform && r.active && r.kind !== 'units_factor');
    const factor = rules.find((r) => r.platform === platform && r.kind === 'units_factor' && r.active);
    const fraction = months.reduce((a, m) => a + (metrics.find((x) => x.platform === platform && x.month === m)?.monthFraction ?? 0), 0);

    const set = (r: number, c: string, v: ExcelJS.CellValue, fmt?: string, bold = false) => {
      const cell = ws.getCell(`${c}${r}`);
      cell.value = v;
      if (fmt) cell.numFmt = fmt;
      if (bold) cell.font = { bold: true };
      return cell;
    };
    set(1, A, `${LABEL[platform]} ${period}`, undefined, true).font = { bold: true, size: 13 };
    ['Concepto', 'Estimado', '% ventas', 'Real', 'Diferencia'].forEach((h, i) => {
      const cell = set(2, col(i), h, undefined, true);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF0F4' } };
    });

    set(3, A, factor ? `unidades vendidas (botes = artículos × ${factor.value.toLocaleString('es-ES')})` : 'unidades vendidas');
    set(3, B, factor ? res.costUnits : res.units, '#,##0');
    set(4, A, 'pedidos');
    set(4, B, res.orders, '#,##0');
    set(5, A, 'precio unidad venta');
    set(5, B, { formula: `IF(${B}3=0,0,${B}6/${B}3)` }, EUR2);
    set(6, A, 'VENTAS / INGRESOS', undefined, true);
    set(6, B, res.revenue, EUR, true);
    set(6, C, 1, PCT);

    let r = 8;
    set(r - 1, A, `COSTES ${LABEL[platform]}`, undefined, true);
    const adsRows: number[] = [];
    const costRows: number[] = [];
    const rowOf: Record<string, number> = {};
    for (const group of PNL_GROUP_ORDER) {
      const gr = pRules.filter((x) => x.group === group);
      if (!gr.length) continue;
      set(r, A, PNL_GROUP_LABELS[group].toUpperCase()).font = { italic: true, color: { argb: 'FF7D778D' } };
      r++;
      for (const rule of gr) {
        rowOf[rule.key] = r;
        if (rule.group === 'ads') adsRows.push(r);
        costRows.push(r);
        r++;
      }
    }
    const v = (rule: PnlRule) => rule.value;
    const f = (n: number) => String(Number(n.toFixed(8)));
    for (const rule of pRules) {
      const rr = rowOf[rule.key];
      const line = res.lines.find((l) => l.key === rule.key);
      const label =
        rule.kind === 'pct_revenue' ? `${rule.label} ${v(rule).toLocaleString('es-ES')}% ventas`
        : rule.kind === 'per_unit' ? `${rule.label} ${v(rule).toLocaleString('es-ES')}€ ud`
        : rule.kind === 'per_order' ? `${rule.label} ${v(rule).toLocaleString('es-ES')}€ pedido`
        : rule.kind === 'fixed_month' ? `${rule.label} (fijo ${v(rule).toLocaleString('es-ES')}€/mes)`
        : `${rule.label} ${v(rule).toLocaleString('es-ES')}% de publicidad`;
      set(rr, A, label);
      const formula =
        rule.kind === 'pct_revenue' ? `${B}6*${f(v(rule) / 100)}`
        : rule.kind === 'per_unit' ? `${B}3*${v(rule)}`
        : rule.kind === 'per_order' ? `${B}4*${v(rule)}`
        : rule.kind === 'fixed_month' ? `${v(rule)}*${Math.round(fraction * 10000) / 10000}`
        : adsRows.length ? `(${adsRows.map((x) => `${B}${x}`).join('+')})*${f(v(rule) / 100)}` : '0';
      set(rr, B, { formula, result: line?.estimated ?? 0 }, EUR);
      set(rr, C, { formula: `IF(${B}$6=0,0,${B}${rr}/${B}$6)` }, PCT);
      if (line && line.actual !== null) {
        set(rr, D, line.actual, EUR);
        set(rr, E, { formula: `${D}${rr}-${B}${rr}` }, EUR);
      }
    }
    r++;
    set(r, A, 'COSTES TOTALES', undefined, true);
    set(r, B, { formula: costRows.length ? `SUM(${costRows.map((x) => `${B}${x}`).join(',')})` : '0' }, EUR, true);
    set(r, C, { formula: `IF(${B}$6=0,0,${B}${r}/${B}$6)` }, PCT);
    set(r, D, { formula: costRows.length ? costRows.map((x) => `IF(${D}${x}="",${B}${x},${D}${x})`).join('+') : '0' }, EUR);
    const totalRow = r;
    r++;
    const m = set(r, A, 'MARGEN OPERATIVO TOTAL', undefined, true);
    m.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F5F5' } };
    set(r, B, { formula: `${B}6-${B}${totalRow}` }, EUR, true).fill = m.fill;
    set(r, C, { formula: `IF(${B}$6=0,0,${B}${r}/${B}$6)` }, PCT, true).fill = m.fill;
    set(r, D, { formula: `${B}6-${D}${totalRow}` }, EUR, true).fill = m.fill;
    set(r + 1, D, 'Real: dato real donde lo hay, estimado en el resto').font = { italic: true, size: 9, color: { argb: 'FF7D778D' } };
  });

  // ---------- Hoja mensual ----------
  const wm = wb.addWorksheet('Mensual', { views: [{ state: 'frozen', ySplit: 1 }] });
  wm.columns = [
    { header: 'Mes', width: 14 },
    ...PANEL_PLATFORMS.flatMap((p) => [
      { header: `${LABEL[p]} facturación`, width: 16 },
      { header: `${LABEL[p]} unidades`, width: 13 },
      { header: `${LABEL[p]} pedidos`, width: 12 },
      { header: `${LABEL[p]} costes est.`, width: 16 },
      { header: `${LABEL[p]} margen est.`, width: 16 }
    ]),
    { header: 'Total facturación', width: 17 },
    { header: 'Total margen est.', width: 17 },
    { header: '% margen', width: 10 },
    { header: 'Margen con reales', width: 17 }
  ];
  wm.getRow(1).font = { bold: true };
  for (const mo of [...new Set(metrics.map((x) => x.month))].sort()) {
    const per = PANEL_PLATFORMS.map((p) => pnlFor(p, mo));
    const tot = sumPnl(per);
    wm.addRow([
      new Date(`${mo}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      ...per.flatMap((x) => [x.revenue, x.units, x.orders, x.estimatedCosts, x.estimatedMargin]),
      tot.revenue,
      tot.estimatedMargin,
      tot.revenue ? tot.estimatedMargin / tot.revenue : 0,
      tot.actualLines ? tot.blendedMargin : null
    ]);
  }
  const ncol = wm.columns.length;
  wm.columns.forEach((c, i) => {
    if (i === 0) return;
    const header = String(c.header);
    c.numFmt = header.includes('%') ? PCT : /unidades|pedidos/.test(header) ? '#,##0' : EUR;
  });
  wm.getColumn(ncol).numFmt = EUR;

  const buf = await wb.xlsx.writeBuffer();
  const name = `PnL-VGummies-${month || year}.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`
    }
  });
}
