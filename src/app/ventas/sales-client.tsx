'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildMonthWeekPresets,
  dateInputFromDate,
  defaultRangeForPeriod,
  monthFromDateInput,
  monthInputFromDate,
  type PresetPeriod
} from '@/lib/sales-periods';
import { isDenseSalesChart, shouldShowSalesChartValueLabel } from '@/lib/sales-chart';

type Period = PresetPeriod | 'custom';
type Platform = 'all' | 'shopify' | 'amazon' | 'tiktok_shop';
type ChartGranularity = 'day' | 'month';

type SyncStateView = {
  platform: string;
  lastSyncRunAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  ordersImported: number;
};

type SalesData = {
  ok: boolean;
  period: Period;
  platform: string;
  since: string;
  until: string;
  startDate: string;
  endDate: string;
  chartGranularity: ChartGranularity;
  syncState: SyncStateView[];
  kpis: {
    grossRevenue: number;
    netRevenue: number;
    totalOrders: number;
    refundedOrders: number;
    refundRate: number;
    totalUnits: number;
    unitsPerOrder: number;
    aov: number;
    currency: string;
  };
  financeKpis: {
    totalFees: number;
    feeRate: number;
    netAfterFees: number;
    coveredRevenue: number;
    coverageRate: number;
  };
  byDay: { date: string; orders: number; revenue: number; units: number }[];
  byPlatform: { platform: string; orders: number; revenue: number }[];
  byPlatformFinancial: {
    platform: string;
    orders: number;
    grossRevenue: number;
    refundedRevenue: number;
    netRevenue: number;
    salesMix: number;
    feeAmount: number;
    feeRate: number;
    netAfterFees: number;
    hasFeeData: boolean;
    feeProviders: string[];
  }[];
  byFinancialStatus: {
    status: string;
    orders: number;
    grossRevenue: number;
    refundedRevenue: number;
    netRevenue: number;
    units: number;
  }[];
};

const POLL_MS = 60_000;
const SYNC_STATUS_DETAILS_OPEN_STORAGE_KEY = 'vgummies:sales-sync-status-details-open';
const PERIODS: { id: PresetPeriod; label: string }[] = [
  { id: 'ytd', label: 'Este año' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' }
];
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'amazon', label: 'Amazon' },
  { id: 'tiktok_shop', label: 'TikTok Shop' }
];

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Madrid'
  }).format(new Date(iso));
}

function formatChartDate(iso: string, granularity: ChartGranularity) {
  if (granularity === 'month') {
    return new Intl.DateTimeFormat('es-ES', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC'
    }).format(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`));
  }
  return formatDate(iso);
}

function formatRelative(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatPlatformName(value: string) {
  const labels: Record<string, string> = {
    amazon: 'Amazon',
    amazon_backfill_2026: 'Amazon backfill 2026',
    amazon_finances: 'Amazon Finances',
    shopify: 'Shopify',
    shopify_backfill_2026: 'Shopify backfill 2026',
    shopify_payments: 'Shopify Payments',
    tiktok_shop: 'TikTok Shop',
    tiktok_shop_backfill_2026: 'TikTok Shop backfill 2026'
  };
  return labels[value] || `${value[0]?.toUpperCase() || ''}${value.slice(1).replace(/_/g, ' ')}`;
}

function formatProviderName(value: string) {
  const labels: Record<string, string> = {
    amazon_finances: 'Amazon Finances',
    shopify_payments: 'Shopify Payments'
  };
  return labels[value] || formatPlatformName(value);
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatPercent(value: number, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('es-ES', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function formatCompactMoney(value: number, currency: string) {
  if (Math.abs(value) >= 1000) {
    return `${formatCompactNumber(value)} ${currency}`;
  }
  return formatMoney(value, currency);
}

function formatInputDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function buildSalesQuery(period: Period, platform: Platform, startDate: string, endDate: string) {
  const params = new URLSearchParams({ platform });
  if (period === 'custom') {
    params.set('start', startDate);
    params.set('end', endDate);
  } else {
    params.set('period', period);
  }
  return params;
}

function SalesBarChart({
  data,
  valueKey,
  currency,
  kind,
  granularity
}: {
  data: { date: string; [k: string]: number | string }[];
  valueKey: 'revenue' | 'orders';
  currency: string;
  kind: 'money' | 'count';
  granularity: ChartGranularity;
}) {
  if (!data.length) {
    return <div className="empty-state" style={{ minHeight: 100 }}>Sin datos en el periodo.</div>;
  }
  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const actualMax = Math.max(...values, 0);
  const scaleMax = Math.max(actualMax, 1);
  const nonZeroValues = values.filter((value) => value > 0);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const chartClassName = isDenseSalesChart(data.length) ? 'sales-chart sales-chart-dense' : 'sales-chart';
  const formatValue = (value: number) => (kind === 'money' ? formatCompactMoney(value, currency) : formatCompactNumber(value));
  const formatFullValue = (value: number) => (kind === 'money' ? formatMoney(value, currency) : `${formatNumber(value)} pedidos`);
  const activePeriodLabel =
    granularity === 'month'
      ? kind === 'money'
        ? 'meses con venta'
        : 'meses con pedidos'
      : kind === 'money'
        ? 'dias con venta'
        : 'dias con pedidos';

  return (
    <div className={chartClassName}>
      <div className="sales-chart-scale" aria-hidden="true">
        <span>{formatValue(actualMax)}</span>
        <span>{formatValue(Math.round(actualMax / 2))}</span>
        <span>0</span>
      </div>
      <div className="sales-chart-plot">
        {data.map((d, i) => {
          const value = values[i];
          const pct = Math.round((value / scaleMax) * 100);
          const showLabel = shouldShowSalesChartValueLabel({
            dataLength: data.length,
            index: i,
            value,
            percent: pct
          });
          return (
            <div key={d.date} className="sales-chart-col">
              <span className={showLabel ? 'sales-chart-value' : 'sales-chart-value hidden'}>
                {showLabel ? formatValue(value) : '\u00A0'}
              </span>
              <div className="sales-chart-bar-wrap">
                <div
                  className={value > 0 ? 'sales-chart-bar' : 'sales-chart-bar empty'}
                  style={{ height: `${Math.max(value > 0 ? 4 : 0, pct)}%` }}
                  title={`${formatChartDate(String(d.date), granularity)} · ${formatFullValue(value)}`}
                />
              </div>
              {i % labelEvery === 0 || i === data.length - 1 ? (
                <span className="sales-chart-label">{formatChartDate(String(d.date), granularity)}</span>
              ) : (
                <span className="sales-chart-label ghost">&nbsp;</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="sales-chart-stats">
        <span>Max {formatFullValue(actualMax)}</span>
        <span>Prom {formatFullValue(average)}</span>
        <span>{nonZeroValues.length} {activePeriodLabel}</span>
      </div>
    </div>
  );
}

function BarChart({
  data,
  valueKey,
  currency,
  granularity
}: {
  data: { date: string; [k: string]: number | string }[];
  valueKey: 'revenue' | 'orders';
  currency: string;
  granularity: ChartGranularity;
}) {
  return (
    <SalesBarChart
      data={data}
      valueKey={valueKey}
      currency={currency}
      kind={valueKey === 'revenue' ? 'money' : 'count'}
      granularity={granularity}
    />
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'warning' | 'error' | 'ok';
}) {
  return (
    <div className={`db-kpi-card ${tone ? `db-kpi-${tone}` : ''}`}>
      <span className="db-kpi-label">{label}</span>
      <strong className="db-kpi-value">{value}</strong>
      {sub && <span className="db-kpi-sub">{sub}</span>}
    </div>
  );
}

const CHANNEL_MIX_COLORS = ['#63b2b7', '#334fb4', '#a891f6', '#7d5f00', '#5f596d'];

type LedgerRowKind = 'auto' | 'computed' | 'manual' | 'total';

type LedgerRow = {
  key: string;
  label: string;
  kind: LedgerRowKind;
  group: 'metric' | 'cost' | 'summary';
  format: 'money' | 'integer';
  cells: number[];
  total: number;
};

type LedgerResponse = {
  ok: boolean;
  platform: string;
  month: string;
  periods: { label: string; startDate: string; endDate: string }[];
  rows: LedgerRow[];
  rates: Record<string, number>;
  rateFields: { key: string; label: string; suffix: string }[];
  error?: string;
};

// El panel financiero solo aplica a plataformas con pedidos propios (no a "Todas").
const LEDGER_PLATFORMS = PLATFORMS.filter((option) => option.id !== 'all');

function FinancialLedgerPanel({ currency }: { currency: string }) {
  const [month, setMonth] = useState(() => monthInputFromDate(new Date()));
  const [platform, setPlatform] = useState<Platform>('shopify');
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ month, platform });
      const res = await fetch(`/api/sales/ledger?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as LedgerResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar el panel financiero.');
      setData(json);
      setDrafts({});
      setRateDrafts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      setLoading(false);
    }
  }, [month, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCell = useCallback(
    async (periodLabel: string, lineKey: string, raw: string) => {
      const trimmed = raw.trim();
      const amount = trimmed === '' ? 0 : Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(amount)) return;
      setSaving(true);
      try {
        const res = await fetch('/api/sales/ledger', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platform, month, periodLabel, lineKey, amount })
        });
        if (!res.ok) throw new Error('No se pudo guardar.');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al guardar.');
      } finally {
        setSaving(false);
      }
    },
    [load, month, platform]
  );

  const saveRate = useCallback(
    async (key: string, raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') return;
      const value = Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) return;
      setSaving(true);
      try {
        const res = await fetch('/api/sales/ledger/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platform, key, value })
        });
        if (!res.ok) throw new Error('No se pudo guardar el ajuste.');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al guardar.');
      } finally {
        setSaving(false);
      }
    },
    [load, platform]
  );

  const formatCell = (row: LedgerRow, value: number) =>
    row.format === 'integer' ? formatNumber(value) : formatMoney(value, currency);

  return (
    <section className="db-section panel fin-ledger">
      <div className="fin-ledger-head">
        <div>
          <h2 className="db-section-title" style={{ margin: 0 }}>Panel financiero (mensual)</h2>
          <p className="sales-orders-meta">
            Unidades, pedidos y ventas se calculan desde los pedidos de la plataforma elegida; el resto se introduce a mano.
          </p>
        </div>
        <div className="fin-ledger-controls">
          <label className="sales-date-field">
            <span>Plataforma</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {LEDGER_PLATFORMS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sales-date-field">
            <span>Mes</span>
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
          <button className="ghost-button" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="fin-ledger-rates">
        {(data?.rateFields ?? []).map((field) => {
          const current = data?.rates?.[field.key];
          const draftValue = rateDrafts[field.key];
          const currentText = current !== undefined ? String(current) : '';
          return (
            <label key={field.key} className="fin-ledger-rate">
              <span>{field.label}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={draftValue !== undefined ? draftValue : currentText}
                onChange={(e) => setRateDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={(e) => {
                  if (draftValue !== undefined && draftValue !== currentText) void saveRate(field.key, e.target.value);
                }}
                disabled={!data || saving}
              />
              <small>{field.suffix}</small>
            </label>
          );
        })}
      </div>

      {error ? <p style={{ color: 'var(--error-red)' }}>{error}</p> : null}
      {loading && !data ? (
        <div className="empty-state" style={{ minHeight: 80 }}>Cargando panel financiero...</div>
      ) : null}

      {data ? (
        <div className="sales-table-wrap">
          <table className="fin-ledger-table">
            <thead>
              <tr>
                <th className="fin-ledger-concept">Concepto</th>
                {data.periods.map((period) => (
                  <th key={period.label} className="num">
                    {period.label}
                  </th>
                ))}
                <th className="num fin-ledger-total-col">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key} className={`fin-ledger-row-${row.group} fin-ledger-kind-${row.kind}`}>
                  <td className="fin-ledger-concept">{row.label}</td>
                  {row.cells.map((value, index) => {
                    const period = data.periods[index];
                    const cellKey = `${period.label}::${row.key}`;
                    if (row.kind === 'manual') {
                      const draftValue = drafts[cellKey];
                      const display = draftValue !== undefined ? draftValue : value ? String(value) : '';
                      return (
                        <td key={cellKey} className="num fin-ledger-input-cell">
                          <input
                            type="number"
                            step="0.01"
                            value={display}
                            placeholder="0"
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [cellKey]: e.target.value }))}
                            onBlur={(e) => {
                              if (draftValue !== undefined) void saveCell(period.label, row.key, e.target.value);
                            }}
                            disabled={saving}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={cellKey}
                        className={`num${value < 0 ? ' fin-ledger-neg' : ''}${value === 0 ? ' muted' : ''}`}
                      >
                        {formatCell(row, value)}
                      </td>
                    );
                  })}
                  <td className={`num fin-ledger-total-col${row.total < 0 ? ' fin-ledger-neg' : ''}`}>
                    {formatCell(row, row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ChannelFinancePanel({
  rows,
  financeKpis,
  currency
}: {
  rows: SalesData['byPlatformFinancial'];
  financeKpis: SalesData['financeKpis'];
  currency: string;
}) {
  if (!rows.length) {
    return (
      <section className="db-section panel">
        <h2 className="db-section-title">Mix y contribucion API por canal</h2>
        <div className="empty-state">Sin ventas en el periodo.</div>
      </section>
    );
  }

  const hasFullFeeCoverage = financeKpis.coverageRate >= 99.5;

  return (
    <section className="db-section panel sales-channel-panel">
      <div className="sales-channel-heading">
        <div>
          <h2 className="db-section-title" style={{ margin: 0 }}>Mix y contribucion API por canal</h2>
          <p className="sales-channel-subtitle">Solo datos reales disponibles: ventas, reembolsos, Shopify Payments y Amazon Finances.</p>
        </div>
        <span className={hasFullFeeCoverage ? 'sales-channel-coverage ok' : 'sales-channel-coverage warning'}>
          {formatPercent(financeKpis.coverageRate, 0)} cobertura fees
        </span>
      </div>

      <div className="db-kpi-grid sales-finance-kpi-grid">
        <KpiCard
          label="Contribucion API detectada"
          value={formatMoney(financeKpis.netAfterFees, currency)}
          sub="ventas netas - fees API"
        />
        <KpiCard
          label="Comisiones API"
          value={formatMoney(financeKpis.totalFees, currency)}
          sub={`${formatPercent(financeKpis.feeRate, 2)} de ventas netas`}
          tone={financeKpis.feeRate > 12 ? 'warning' : undefined}
        />
        <KpiCard
          label="Ventas con fee real"
          value={formatMoney(financeKpis.coveredRevenue, currency)}
          sub={hasFullFeeCoverage ? 'Amazon + Shopify cubiertos' : 'faltan fees en algun canal'}
          tone={hasFullFeeCoverage ? 'ok' : 'warning'}
        />
      </div>

      <div className="sales-mix-stack" aria-label="Mix de ventas netas por canal">
        {rows.map((row, index) => (
          <span
            key={row.platform}
            className="sales-mix-segment"
            style={{
              width: `${Math.max(0, row.salesMix)}%`,
              background: CHANNEL_MIX_COLORS[index % CHANNEL_MIX_COLORS.length]
            }}
            title={`${formatPlatformName(row.platform)}: ${formatPercent(row.salesMix, 1)}`}
          />
        ))}
      </div>

      <div className="sales-channel-list">
        {rows.map((row, index) => {
          const providers = row.feeProviders.map(formatProviderName).join(', ');
          return (
            <div key={row.platform} className="sales-channel-row">
              <div className="sales-channel-name">
                <span
                  className="sales-channel-dot"
                  style={{ background: CHANNEL_MIX_COLORS[index % CHANNEL_MIX_COLORS.length] }}
                  aria-hidden="true"
                />
                <div>
                  <strong>{formatPlatformName(row.platform)}</strong>
                  <span>{formatPercent(row.salesMix, 1)} mix - {formatNumber(row.orders)} pedidos</span>
                </div>
              </div>
              <div className="sales-channel-metrics">
                <span>
                  <small>Ventas netas</small>
                  <strong>{formatMoney(row.netRevenue, currency)}</strong>
                </span>
                <span>
                  <small>Comisiones</small>
                  <strong>{row.hasFeeData ? formatMoney(row.feeAmount, currency) : 'Pendiente'}</strong>
                </span>
                <span>
                  <small>Contribucion API</small>
                  <strong>{row.hasFeeData ? formatMoney(row.netAfterFees, currency) : '-'}</strong>
                </span>
                <span>
                  <small>Fee rate</small>
                  <strong>{row.hasFeeData ? formatPercent(row.feeRate, 2) : '-'}</strong>
                </span>
              </div>
              <p className={row.hasFeeData ? 'sales-channel-source' : 'sales-channel-source warning'}>
                {row.hasFeeData ? `Fuente fee: ${providers}` : 'Sin fee API aun para este canal'}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function combineStatusBreakdown(
  rows: SalesData['byFinancialStatus'],
  statuses: string[]
): SalesData['byFinancialStatus'][number] {
  const wanted = new Set(statuses);
  return rows
    .filter((row) => wanted.has(row.status))
    .reduce(
      (acc, row) => ({
        status: statuses.join('+'),
        orders: acc.orders + row.orders,
        grossRevenue: acc.grossRevenue + row.grossRevenue,
        refundedRevenue: acc.refundedRevenue + row.refundedRevenue,
        netRevenue: acc.netRevenue + row.netRevenue,
        units: acc.units + row.units
      }),
      { status: statuses.join('+'), orders: 0, grossRevenue: 0, refundedRevenue: 0, netRevenue: 0, units: 0 }
    );
}

function formatFinancialStatusLabel(status: string, platform?: string) {
  const normalized = String(status || '').toLowerCase();
  if (platform === 'amazon' && normalized === 'pending') return 'pendiente de liquidación';
  const labels: Record<string, string> = {
    paid: 'pagado',
    pending: 'pendiente',
    partially_refunded: 'reembolso parcial',
    refunded: 'reembolsado',
    voided: 'anulado'
  };
  return labels[normalized] || status || '-';
}

function AmazonStatusBreakdown({
  rows,
  currency
}: {
  rows: SalesData['byFinancialStatus'];
  currency: string;
}) {
  const paid = combineStatusBreakdown(rows, ['paid']);
  const pending = combineStatusBreakdown(rows, ['pending']);
  const refunded = combineStatusBreakdown(rows, ['partially_refunded', 'refunded']);

  if (!rows.length) return null;

  return (
    <section className="db-section">
      <h2 className="db-section-title">Amazon por estado</h2>
      <div className="db-kpi-grid">
        <KpiCard
          label="Liberado / pagado"
          value={formatMoney(paid.grossRevenue, currency)}
          sub={`${formatNumber(paid.orders)} pedidos`}
          tone="ok"
        />
        <KpiCard
          label="Pendiente liquidación"
          value={formatMoney(pending.grossRevenue, currency)}
          sub={`${formatNumber(pending.orders)} pedidos Amazon`}
          tone={pending.orders > 0 ? 'warning' : undefined}
        />
        <KpiCard
          label="Con reembolso"
          value={formatMoney(refunded.grossRevenue, currency)}
          sub={`${formatNumber(refunded.orders)} pedidos · reembolsado ${formatMoney(refunded.refundedRevenue, currency)}`}
          tone={refunded.orders > 0 ? 'warning' : undefined}
        />
      </div>
    </section>
  );
}

function SyncStatusBanner({ states }: { states: SyncStateView[] }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const okCount = states.filter((s) => s.lastSyncStatus === 'ok').length;
  const failedCount = states.filter((s) => s.lastSyncStatus === 'failed').length;
  const totalImported = states.reduce((sum, state) => sum + state.ordersImported, 0);
  const lastSyncAt = states
    .map((state) => (state.lastSyncRunAt ? new Date(state.lastSyncRunAt).getTime() : 0))
    .reduce((latest, current) => Math.max(latest, current), 0);
  const statusLabel = states.length
    ? failedCount
      ? `${failedCount} con error`
      : `${okCount}/${states.length} fuentes OK`
    : 'Sin ejecuciones';

  useEffect(() => {
    try {
      setDetailsOpen(window.localStorage.getItem(SYNC_STATUS_DETAILS_OPEN_STORAGE_KEY) === '1');
    } catch {
      setDetailsOpen(false);
    }
  }, []);

  function toggleDetails() {
    setDetailsOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SYNC_STATUS_DETAILS_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors; the panel still toggles for the current session.
      }
      return next;
    });
  }

  return (
    <section className="sales-sync-card" aria-label="Estado de sincronización">
      <div className="sales-sync-summary">
        <strong>Sincronización</strong>
        <span className={failedCount ? 'sales-sync-pill warning' : 'sales-sync-pill ok'}>{statusLabel}</span>
        {lastSyncAt > 0 && <span className="sales-sync-muted">último run {formatRelative(new Date(lastSyncAt).toISOString())}</span>}
        <span className="sales-sync-muted">{formatNumber(totalImported)} registros importados</span>
      </div>
      <button
        className="sales-sync-info-button"
        type="button"
        onClick={toggleDetails}
        aria-expanded={detailsOpen}
        aria-controls="sales-sync-status-details"
        title={detailsOpen ? 'Ocultar detalle de sincronización' : 'Ver detalle de sincronización'}
      >
        i
      </button>
      {detailsOpen && (
        <div id="sales-sync-status-details" className="sales-sync-details">
          {!states.length ? (
            <p className="sales-sync-empty">Aún no se ha ejecutado ningún sync.</p>
          ) : (
            states.map((s) => {
              const ok = s.lastSyncStatus === 'ok';
              const failed = s.lastSyncStatus === 'failed';
              return (
                <div key={s.platform} className="sales-sync-row">
                  <strong>{formatPlatformName(s.platform)}</strong>
                  <span className={ok ? 'sales-sync-status ok' : failed ? 'sales-sync-status error' : 'sales-sync-status muted'}>
                    {ok ? 'OK' : failed ? 'Error' : 'Sin info'}
                  </span>
                  {s.lastSyncRunAt && <span>último run {formatRelative(s.lastSyncRunAt)}</span>}
                  <span>{formatNumber(s.ordersImported)} registros importados</span>
                  {failed && s.lastSyncError && <span className="sales-sync-error">{s.lastSyncError}</span>}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function SalesClient() {
  const initialMonth = monthInputFromDate(new Date());
  const initialRange = defaultRangeForPeriod('ytd');
  const [data, setData] = useState<SalesData | null>(null);
  const [period, setPeriod] = useState<Period>('ytd');
  const [platform, setPlatform] = useState<Platform>('all');
  const [rangeStart, setRangeStart] = useState(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.end);
  const [weekPresetMonth, setWeekPresetMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (p: Period, pl: Platform, startDate: string, endDate: string, initial = false) => {
      if (initial) setLoading(true);
      setError('');
      try {
        const params = buildSalesQuery(p, pl, startDate, endDate);
        const res = await fetch(`/api/sales?${params.toString()}`, { cache: 'no-store' });
        const json = (await res.json()) as SalesData & { error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar la vista.');
        setData(json);
        setUpdatedAt(new Date().toISOString());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar.');
      } finally {
        if (initial) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(period, platform, rangeStart, rangeEnd, true);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => void load(period, platform, rangeStart, rangeEnd), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, period, platform, rangeStart, rangeEnd]);

  const currency = data?.kpis.currency ?? 'EUR';
  const weekPresets = buildMonthWeekPresets(weekPresetMonth);
  const chartGranularity = data?.chartGranularity ?? 'day';
  const chartPeriodLabel = chartGranularity === 'month' ? 'mes' : 'día';
  const selectedRangeLabel = data
    ? `${formatInputDate(data.startDate)} - ${formatInputDate(data.endDate)}`
    : `${formatInputDate(rangeStart)} - ${formatInputDate(rangeEnd)}`;

  function applyPresetPeriod(nextPeriod: PresetPeriod) {
    const nextRange = defaultRangeForPeriod(nextPeriod);
    setPeriod(nextPeriod);
    setRangeStart(nextRange.start);
    setRangeEnd(nextRange.end);
    setWeekPresetMonth(monthInputFromDate(new Date()));
  }

  function applyCustomRange(startDate: string, endDate: string) {
    setPeriod('custom');
    setRangeStart(startDate);
    setRangeEnd(endDate);
    setWeekPresetMonth(monthFromDateInput(startDate));
  }

  function applyWeekPreset(startDate: string, endDate: string) {
    setPeriod('custom');
    setRangeStart(startDate);
    setRangeEnd(endDate);
    setWeekPresetMonth(monthFromDateInput(startDate));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
            style={{ width: 90, height: 'auto' }}
          />
          <h1>Ventas</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--ink-soft)', flexWrap: 'wrap' }}>
          <span className="db-updated">
            <span className="db-live-dot" />
            {updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Cargando...'}
          </span>
          <div className="db-period-selector">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={platform === p.id ? 'db-period-btn active' : 'db-period-btn'}
                type="button"
                onClick={() => setPlatform(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="db-period-selector">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                className={period === p.id ? 'db-period-btn active' : 'db-period-btn'}
                type="button"
                onClick={() => applyPresetPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <a href="/">← Volver al inbox</a>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1200 }}>
        {error && <p style={{ color: 'var(--error-red)', marginBottom: 16 }}>{error}</p>}
        {loading && !data && <div className="empty-state" style={{ marginTop: 40 }}>Cargando ventas...</div>}

        {data && (
          <>
            <SyncStatusBanner states={data.syncState} />

            <section className="db-section panel sales-filter-panel">
              <div className="sales-filter-grid">
                <div>
                  <h2 className="db-section-title" style={{ marginBottom: 6 }}>Periodo financiero</h2>
                  <p className="sales-range-label">{selectedRangeLabel}</p>
                </div>

                <div className="sales-date-controls">
                  <label className="sales-date-field">
                    <span>Fecha inicio</span>
                    <input
                      type="date"
                      value={rangeStart}
                      onChange={(e) => {
                        const nextStart = e.target.value;
                        if (!nextStart) return;
                        applyCustomRange(nextStart, rangeEnd >= nextStart ? rangeEnd : nextStart);
                      }}
                    />
                  </label>
                  <label className="sales-date-field">
                    <span>Fecha final</span>
                    <input
                      type="date"
                      value={rangeEnd}
                      onChange={(e) => {
                        const nextEnd = e.target.value;
                        if (!nextEnd) return;
                        applyCustomRange(rangeStart <= nextEnd ? rangeStart : nextEnd, nextEnd);
                      }}
                    />
                  </label>
                  <label className="sales-date-field sales-month-field">
                    <span>Mes semanas</span>
                    <input
                      type="month"
                      value={weekPresetMonth}
                      onChange={(e) => {
                        if (e.target.value) setWeekPresetMonth(e.target.value);
                      }}
                    />
                  </label>
                </div>

                <div className="db-period-selector sales-week-presets" aria-label="Semanas del mes">
                  {weekPresets.map((preset) => (
                    <button
                      key={preset.label}
                      className={
                        period === 'custom' && rangeStart === preset.startDate && rangeEnd === preset.endDate
                          ? 'db-period-btn active'
                          : 'db-period-btn'
                      }
                      type="button"
                      onClick={() => applyWeekPreset(preset.startDate, preset.endDate)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="db-section">
              <h2 className="db-section-title">Resumen del periodo</h2>
              <div className="db-kpi-grid">
                <KpiCard label="Ingresos brutos" value={formatMoney(data.kpis.grossRevenue, currency)} sub="suma de total_price" />
                <KpiCard label="Ingresos netos" value={formatMoney(data.kpis.netRevenue, currency)} sub="brutos − reembolsos" />
                <KpiCard label="Pedidos totales" value={formatNumber(data.kpis.totalOrders)} sub="excl. cancelados y test" />
                <KpiCard label="Ticket promedio (AOV)" value={formatMoney(data.kpis.aov, currency)} sub="bruto / pedidos" />
              </div>
              <div className="db-kpi-grid" style={{ marginTop: 12 }}>
                <KpiCard
                  label="Tasa de reembolso"
                  value={`${data.kpis.refundRate}%`}
                  sub={`${formatNumber(data.kpis.refundedOrders)} pedidos`}
                  tone={data.kpis.refundRate > 10 ? 'warning' : undefined}
                />
                <KpiCard label="Unidades vendidas" value={formatNumber(data.kpis.totalUnits)} sub="Σ line_items.quantity" />
                <KpiCard label="Unidades por pedido" value={formatNumber(data.kpis.unitsPerOrder, 2)} sub="promedio" />
              </div>
            </section>

            {platform === 'amazon' && <AmazonStatusBreakdown rows={data.byFinancialStatus} currency={currency} />}

            <div className="db-two-col">
              <section className="db-section panel">
                <h2 className="db-section-title">Ingresos por {chartPeriodLabel}</h2>
                <BarChart data={data.byDay} valueKey="revenue" currency={currency} granularity={chartGranularity} />
                <p className="db-chart-total">
                  {formatMoney(data.kpis.grossRevenue, currency)} en total · {selectedRangeLabel}
                </p>
              </section>

              <section className="db-section panel">
                <h2 className="db-section-title">Pedidos por {chartPeriodLabel}</h2>
                <BarChart data={data.byDay} valueKey="orders" currency={currency} granularity={chartGranularity} />
                <p className="db-chart-total">
                  {formatNumber(data.kpis.totalOrders)} pedidos en total
                </p>
              </section>
            </div>

            <FinancialLedgerPanel currency={currency} />

            <ChannelFinancePanel
              rows={data.byPlatformFinancial}
              financeKpis={data.financeKpis}
              currency={currency}
            />

            <RawOrdersSection
              platform={platform}
              period={period}
              startDate={rangeStart}
              endDate={rangeEnd}
              currency={currency}
              expectedTotal={data.kpis.totalOrders}
            />
          </>
        )}
      </div>
    </main>
  );
}

type RawOrder = {
  id: string;
  platform: string;
  externalOrderId: string;
  orderNumber: string | null;
  currency: string;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  isTest: boolean;
  totalPrice: number;
  totalRefunded: number;
  totalUnits: number;
  customerEmail: string | null;
  countryCode: string | null;
  channel: string | null;
  externalUpdatedAt: string;
};

type RawOrdersResponse = {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  count: number;
  orders: RawOrder[];
  error?: string;
};

function RawOrdersSection({
  platform,
  period,
  startDate,
  endDate,
  currency,
  expectedTotal
}: {
  platform: Platform;
  period: Period;
  startDate: string;
  endDate: string;
  currency: string;
  expectedTotal: number;
}) {
  const [orders, setOrders] = useState<RawOrder[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState('');
  const [financialStatus, setFinancialStatus] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [meta, setMeta] = useState({
    total: expectedTotal,
    page: 1,
    pageSize: 50,
    totalPages: Math.max(1, Math.ceil(expectedTotal / 50)),
    count: 0
  });

  const load = useCallback(async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    setError('');
    try {
      const params = buildSalesQuery(period, platform, startDate, endDate);
      params.set('page', String(nextPage));
      params.set('pageSize', String(nextPageSize));
      if (query.trim()) params.set('q', query.trim());
      if (financialStatus) params.set('financialStatus', financialStatus);
      if (channelFilter.trim()) params.set('channel', channelFilter.trim());
      if (countryFilter.trim()) params.set('country', countryFilter.trim());
      const res = await fetch(`/api/sales/orders?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as RawOrdersResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar.');
      setOrders(json.orders);
      setPage(json.page);
      setPageSize(json.pageSize);
      setMeta({
        total: json.total,
        page: json.page,
        pageSize: json.pageSize,
        totalPages: json.totalPages,
        count: json.count
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [channelFilter, countryFilter, endDate, financialStatus, page, pageSize, period, platform, query, startDate]);

  useEffect(() => {
    setIsOpen(false);
    setOrders(null);
    setPage(1);
    setError('');
    setMeta((current) => ({
      ...current,
      total: expectedTotal,
      page: 1,
      totalPages: Math.max(1, Math.ceil(expectedTotal / current.pageSize)),
      count: 0
    }));
  }, [endDate, expectedTotal, period, platform, startDate]);

  const openOrders = () => {
    setIsOpen(true);
    setPage(1);
    void load(1, pageSize);
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    void load(1, pageSize);
  };

  const changePageSize = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPageSize = Number(event.target.value);
    setPageSize(nextPageSize);
    setPage(1);
    void load(1, nextPageSize);
  };

  const goToPage = (nextPage: number) => {
    const boundedPage = Math.max(1, Math.min(nextPage, meta.totalPages));
    setPage(boundedPage);
    void load(boundedPage, pageSize);
  };

  const visibleFrom = orders && orders.length > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const visibleTo = orders && orders.length > 0 ? visibleFrom + orders.length - 1 : 0;

  return (
    <section className="db-section panel">
      <div className="sales-orders-head">
        <div>
          <h2 className="db-section-title" style={{ margin: 0 }}>Pedidos del periodo</h2>
          <p className="sales-orders-meta">
            {isOpen
              ? `${formatNumber(visibleFrom)}-${formatNumber(visibleTo)} de ${formatNumber(meta.total)} pedidos`
              : `${formatNumber(expectedTotal)} pedidos disponibles bajo demanda`}
          </p>
        </div>
        {isOpen ? (
          <button className="ghost-button" type="button" onClick={() => void load(page, pageSize)} disabled={loading}>
            {loading ? 'Recargando...' : 'Recargar'}
          </button>
        ) : (
          <button className="primary-action" type="button" onClick={openOrders} disabled={loading || expectedTotal === 0}>
            {loading ? 'Cargando...' : 'Ver pedidos del periodo'}
          </button>
        )}
      </div>

      {isOpen ? (
      <div style={{ marginTop: 12 }}>
        <form className="sales-orders-filters" onSubmit={applyFilters}>
          <label className="sales-date-field">
            <span>Buscar</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pedido o email"
            />
          </label>
          <label className="sales-date-field">
            <span>Estado financiero</span>
            <select value={financialStatus} onChange={(event) => setFinancialStatus(event.target.value)}>
              <option value="">Todos</option>
              <option value="paid">Pagado</option>
              <option value="pending">Pendiente</option>
              <option value="partially_refunded">Reembolso parcial</option>
              <option value="refunded">Reembolsado</option>
              <option value="voided">Anulado</option>
            </select>
          </label>
          <label className="sales-date-field">
            <span>Canal</span>
            <input
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              placeholder="web, amazon..."
            />
          </label>
          <label className="sales-date-field sales-country-field">
            <span>Pais</span>
            <input
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value.toUpperCase())}
              maxLength={2}
              placeholder="ES"
            />
          </label>
          <label className="sales-date-field sales-page-size-field">
            <span>Filas</span>
            <select value={pageSize} onChange={changePageSize}>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button className="ghost-button" type="submit" disabled={loading}>
            Aplicar filtros
          </button>
        </form>

        {error ? <p style={{ color: 'var(--error-red)' }}>{error}</p> : null}
        {loading && !orders ? <div className="empty-state" style={{ minHeight: 80 }}>Cargando pedidos...</div> : null}
        {orders && orders.length === 0 ? <div className="empty-state">Sin pedidos en el periodo.</div> : null}
        {orders && orders.length > 0 ? (
          <>
            <div className="sales-table-wrap">
              <table className="sales-orders-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Plataforma</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Pais</th>
                    <th>Canal</th>
                    <th className="num">Total</th>
                    <th className="num">Reemb.</th>
                    <th className="num">Neto</th>
                    <th className="num">Uds.</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const rowCurrency = o.currency || currency;
                    const net = o.totalPrice - o.totalRefunded;
                    return (
                      <tr key={o.id}>
                        <td className="nowrap">{formatFullDate(o.processedAt)}</td>
                        <td>{formatPlatformName(o.platform)}</td>
                        <td className="nowrap">{o.orderNumber || o.externalOrderId}</td>
                        <td>{o.customerEmail || '-'}</td>
                        <td>{o.countryCode || '-'}</td>
                        <td>{o.channel || '-'}</td>
                        <td className="num">{formatMoney(o.totalPrice, rowCurrency)}</td>
                        <td className={o.totalRefunded > 0 ? 'num refund' : 'num muted'}>
                          {o.totalRefunded > 0 ? formatMoney(o.totalRefunded, rowCurrency) : '-'}
                        </td>
                        <td className="num">{formatMoney(net, rowCurrency)}</td>
                        <td className="num">{o.totalUnits}</td>
                        <td>{formatFinancialStatusLabel(o.financialStatus, o.platform)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sales-orders-pagination">
              <p className="sales-orders-meta">
                Pagina {formatNumber(meta.page)} de {formatNumber(meta.totalPages)} - {formatNumber(meta.count)} filas cargadas
              </p>
              <div>
                <button className="ghost-button" type="button" onClick={() => goToPage(meta.page - 1)} disabled={loading || meta.page <= 1}>
                  Anterior
                </button>
                <button className="ghost-button" type="button" onClick={() => goToPage(meta.page + 1)} disabled={loading || meta.page >= meta.totalPages}>
                  Siguiente
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}

function formatFullDate(iso: string) {
  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  }).format(new Date(iso));
}
