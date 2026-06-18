'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildMonthWeekPresets,
  dateInputFromDate,
  defaultRangeForPeriod,
  monthFromDateInput,
  monthInputFromDate,
  type PresetPeriod
} from '@/lib/sales-periods';

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
  byDay: { date: string; orders: number; revenue: number; units: number }[];
  byPlatform: { platform: string; orders: number; revenue: number }[];
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
const SYNC_STATUS_COLLAPSED_STORAGE_KEY = 'vgummies:sales-sync-status-collapsed';
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
    shopify: 'Shopify',
    shopify_backfill_2026: 'Shopify backfill 2026',
    tiktok_shop: 'TikTok Shop',
    tiktok_shop_backfill_2026: 'TikTok Shop backfill 2026'
  };
  return labels[value] || `${value[0]?.toUpperCase() || ''}${value.slice(1).replace(/_/g, ' ')}`;
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
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
    <div className="sales-chart">
      <div className="sales-chart-scale" aria-hidden="true">
        <span>{formatValue(actualMax)}</span>
        <span>{formatValue(Math.round(actualMax / 2))}</span>
        <span>0</span>
      </div>
      <div className="sales-chart-plot">
        {data.map((d, i) => {
          const value = values[i];
          const pct = Math.round((value / scaleMax) * 100);
          const showLabel = value > 0 && (data.length <= 14 || pct >= 24);
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

function PercentBar({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <div className="db-pct-row">
      <span className="db-pct-label">{label}</span>
      <div className="db-pct-track">
        <div className="db-pct-fill" style={{ width: `${Math.min(100, value)}%`, background: 'var(--gummy-teal)' }} />
      </div>
      <span className="db-pct-value">{hint ?? `${value}%`}</span>
    </div>
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
  const [collapsed, setCollapsed] = useState(false);
  const okCount = states.filter((s) => s.lastSyncStatus === 'ok').length;
  const failedCount = states.filter((s) => s.lastSyncStatus === 'failed').length;
  const statusSummary = states.length
    ? `${okCount} OK${failedCount ? `, ${failedCount} error` : ''}`
    : 'Sin ejecuciones';

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SYNC_STATUS_COLLAPSED_STORAGE_KEY) === '1');
    } catch {
      setCollapsed(false);
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SYNC_STATUS_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors; the panel still toggles for the current session.
      }
      return next;
    });
  }

  return (
    <section className="db-section panel" style={{ padding: collapsed ? '10px 14px' : 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>Estado de sincronización</strong>
          <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{statusSummary}</span>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="sales-sync-status-details"
        >
          {collapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </div>
      {!collapsed && (
        <div id="sales-sync-status-details" style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {!states.length ? (
            <p style={{ margin: 0 }}>Aún no se ha ejecutado ningún sync.</p>
          ) : (
            states.map((s) => {
              const ok = s.lastSyncStatus === 'ok';
              const failed = s.lastSyncStatus === 'failed';
              return (
                <div key={s.platform} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong>{formatPlatformName(s.platform)}</strong>
                  <span style={{ color: ok ? 'var(--gummy-teal)' : failed ? 'var(--error-red)' : 'var(--ink-soft)' }}>
                    {ok ? '✓ OK' : failed ? '✕ Error' : '— Sin info'}
                  </span>
                  {s.lastSyncRunAt && <span style={{ color: 'var(--ink-soft)' }}>último run {formatRelative(s.lastSyncRunAt)}</span>}
                  <span style={{ color: 'var(--ink-soft)' }}>{formatNumber(s.ordersImported)} pedidos importados</span>
                  {failed && s.lastSyncError && (
                    <span style={{ color: 'var(--error-red)', flexBasis: '100%' }}>{s.lastSyncError}</span>
                  )}
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
  const totalByPlatformRevenue = data?.byPlatform.reduce((s, p) => s + p.revenue, 0) ?? 0;
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

            <section className="db-section panel">
              <h2 className="db-section-title">Por plataforma</h2>
              {data.byPlatform.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.byPlatform.map((p) => {
                    const pct = totalByPlatformRevenue > 0 ? Math.round((p.revenue / totalByPlatformRevenue) * 100) : 0;
                    return (
                      <PercentBar
                        key={p.platform}
                        label={`${formatPlatformName(p.platform)} · ${formatNumber(p.orders)} pedidos`}
                        value={pct}
                        hint={`${formatMoney(p.revenue, currency)} · ${pct}%`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">Sin ventas en el periodo.</div>
              )}
            </section>

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = buildSalesQuery(period, platform, startDate, endDate);
      params.set('limit', '2000');
      const res = await fetch(`/api/sales/orders?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar.');
      setOrders(json.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [endDate, period, platform, startDate]);

  useEffect(() => {
    setOrders(null);
    void load();
  }, [load]);

  return (
    <section className="db-section panel">
      <div className="sales-orders-head">
        <div>
          <h2 className="db-section-title" style={{ margin: 0 }}>Pedidos del periodo</h2>
          <p className="sales-orders-meta">
            {orders ? `${formatNumber(orders.length)} de ${formatNumber(expectedTotal)} pedidos` : `${formatNumber(expectedTotal)} pedidos`}
            {expectedTotal > 2000 ? ' · tope visible 2.000' : ''}
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Recargando...' : 'Recargar'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
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
            <p className="sales-orders-meta">
              Mas antiguo: {formatFullDate(orders[orders.length - 1].processedAt)} · Mas reciente: {formatFullDate(orders[0].processedAt)}
            </p>
          </>
        ) : null}
      </div>
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
